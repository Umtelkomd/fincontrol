/**
 * Classifier — render tests for the weekly inbox.
 *
 * The Bandeja is scoped to the operational data (2026+) and splits what is
 * still pending into the three things it can ask: Sin categoría, Sin obra
 * and Sin conciliar. Only one tab panel is mounted at a time, so each gets
 * its own coverage here, plus the group-level "Asignar obra" bulk action —
 * the 30-minute job the tab exists for.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import {
  bankMovementFixture,
  isoDaysFromNow,
  ledgerFixtures,
  payableFixture,
  receivableFixture,
} from '@/test/fixtures';

const INCOME = bankMovementFixture({
  id: 'mov-in',
  direction: 'in',
  amount: 10000,
  description: 'Überweisung Insyte',
  counterpartyName: 'Insyte Deutschland',
  postedDate: isoDaysFromNow(-4),
});

// Same amount and a due date inside the ±21-day window ⇒ score ≥ 100, which is
// what puts the CXP suggestion card (with "Vincular") on the row.
const EXPENSE_WITH_MATCH = bankMovementFixture({
  id: 'mov-out-matched',
  direction: 'out',
  amount: 4000,
  description: 'Lastschrift Kabel Service',
  counterpartyName: 'Kabel Service GmbH',
  postedDate: isoDaysFromNow(-3),
});

const EXPENSE_SPONTANEOUS = bankMovementFixture({
  id: 'mov-out-loose',
  direction: 'out',
  amount: 87.4,
  description: 'Tankstelle Aral',
  counterpartyName: 'Aral AG',
  postedDate: isoDaysFromNow(-2),
});

const INBOX = [INCOME, EXPENSE_WITH_MATCH, EXPENSE_SPONTANEOUS];

// A categorised obra cost with no project — the "Sin obra" case, twice for
// the same counterparty so the group action has something to group.
const sinObra = (id, amount, postedDate) =>
  bankMovementFixture({
    id,
    direction: 'out',
    amount,
    description: `Tankstelle ${id}`,
    counterpartyName: 'Aral AG',
    categoryName: 'Combustible',
    costScope: 'project',
    projectId: '',
    projectName: '',
    postedDate,
  });

const store = installFirebaseMocks(
  ledgerFixtures({
    collections: {
      bankMovements: INBOX,
      payables: [payableFixture({ id: 'cxp-match', openAmount: 4000, amount: 4000, dueDate: isoDaysFromNow(-3) })],
      receivables: [receivableFixture({ id: 'cxc-open', openAmount: 10000, amount: 10000, dueDate: isoDaysFromNow(-4) })],
    },
  }),
);

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { writeBatch } = await import('firebase/firestore');
const { default: Classifier } = await import('./Classifier.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const kpiValue = (label) =>
  screen.getByText(label, { selector: 'p' }).closest('div').parentElement.querySelector(':scope > p');

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  store.collections.bankMovements = INBOX;
  store.collections.payables = [
    payableFixture({ id: 'cxp-match', openAmount: 4000, amount: 4000, dueDate: isoDaysFromNow(-3) }),
  ];
  store.collections.receivables = [
    receivableFixture({ id: 'cxc-open', openAmount: 10000, amount: 10000, dueDate: isoDaysFromNow(-4) }),
  ];
  store.collections.classificationRules = [];
  writeBatch.mockClear();
});

describe('Classifier — inbox shell', () => {
  it('renders one page header and the coverage banner without throwing', () => {
    renderScreen(<Classifier user={USER} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Clasificar movimientos' })).toBeInTheDocument();
    expect(screen.getByText('§ Bandeja')).toBeInTheDocument();
    expect(screen.getByText('2026 · 3 pendientes')).toBeInTheDocument();
    expect(screen.getByText(/Cobertura de clasificación/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Cobertura de clasificación/ })).toBeInTheDocument();
  });

  it('buckets the inbox across the KPI row by pending reason', () => {
    store.collections.bankMovements = [...INBOX, sinObra('mov-obra-1', 50, isoDaysFromNow(-5))];

    renderScreen(<Classifier user={USER} />);

    expect(kpiValue('Pendientes 2026')).toHaveTextContent('4');
    expect(kpiValue('Sin categoría')).toHaveTextContent('3');
    expect(kpiValue('Sin obra')).toHaveTextContent('1');
    expect(kpiValue('Sin conciliar')).toHaveTextContent('0');
  });

  it('reports an empty inbox as up to date rather than as an error', () => {
    store.collections.bankMovements = [];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByText('✓ Bandeja al día')).toBeInTheDocument();
    expect(screen.getByText('Sin pendientes de categoría')).toBeInTheDocument();
  });

  it('says it is loading instead of flashing "Bandeja al día / 0 %"', () => {
    renderScreen(<Classifier user={null} />, { user: null });

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText('✓ Bandeja al día')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Classifier — scope', () => {
  it('ignores everything posted before the operational year', () => {
    store.collections.bankMovements = [
      ...INBOX,
      bankMovementFixture({ id: 'mov-2025', direction: 'out', amount: 300, description: 'Alt', postedDate: '2025-12-20' }),
    ];

    renderScreen(<Classifier user={USER} />);

    expect(kpiValue('Pendientes 2026')).toHaveTextContent('3');
    expect(screen.queryByText('Alt')).not.toBeInTheDocument();
  });

  it('narrows the inbox and the coverage header to the selected month', () => {
    store.collections.bankMovements = [
      bankMovementFixture({ id: 'mov-mar', direction: 'out', amount: 10, description: 'Marzo', postedDate: '2026-03-10' }),
      bankMovementFixture({ id: 'mov-abr', direction: 'out', amount: 10, description: 'Abril', postedDate: '2026-04-12' }),
    ];

    renderScreen(<Classifier user={USER} />);
    expect(kpiValue('Pendientes 2026')).toHaveTextContent('2');

    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2026-03' } });

    expect(kpiValue('Pendientes 2026')).toHaveTextContent('1');
    expect(screen.getByText('Marzo')).toBeInTheDocument();
    expect(screen.queryByText('Abril')).not.toBeInTheDocument();
    expect(screen.getByText('Mar 2026 · 1 pendientes')).toBeInTheDocument();
    expect(screen.getByText('Cobertura de clasificación · Mar 2026')).toBeInTheDocument();
  });
});

describe('Classifier — Sin categoría', () => {
  it('opens on the tab and lists every movement without a category, in either direction', () => {
    renderScreen(<Classifier user={USER} />);

    const panel = screen.getByText('Sin categoría', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Überweisung Insyte')).toBeInTheDocument();
    expect(within(panel).getByText('Lastschrift Kabel Service')).toBeInTheDocument();
    expect(within(panel).getByText('Tankstelle Aral')).toBeInTheDocument();
  });

  it('offers Vincular on the CXP suggestion card and Categorizar / Regla on every row', () => {
    renderScreen(<Classifier user={USER} />);

    const matched = screen.getByText('Lastschrift Kabel Service').closest('div.px-5');
    expect(within(matched).getByText(/CXP sugerida/)).toBeInTheDocument();
    expect(within(matched).getByRole('button', { name: /Vincular/ })).toBeInTheDocument();

    const loose = screen.getByText('Tankstelle Aral').closest('div.px-5');
    expect(within(loose).queryByRole('button', { name: /Vincular/ })).not.toBeInTheDocument();
    expect(within(loose).queryByRole('button', { name: /Buscar/ })).not.toBeInTheDocument();
    expect(within(loose).getByRole('button', { name: /Categorizar/ })).toBeInTheDocument();
    expect(within(loose).getByRole('button', { name: /Regla/ })).toBeInTheDocument();
  });
});

describe('Classifier — Sin obra', () => {
  beforeEach(() => {
    store.collections.bankMovements = [
      ...INBOX,
      sinObra('mov-obra-1', 50, isoDaysFromNow(-5)),
      sinObra('mov-obra-2', 87.4, isoDaysFromNow(-1)),
    ];
  });

  it('groups the rows by counterparty with count and total in the header', () => {
    renderScreen(<Classifier user={USER} />);
    openTab(/Sin obra/);

    const group = screen.getByRole('region', { name: 'Aral AG' });
    expect(within(group).getByText(/2 movimientos/)).toBeInTheDocument();
    expect(within(group).getByText(/137,40/)).toBeInTheDocument();
    expect(within(group).getByText('Tankstelle mov-obra-1')).toBeInTheDocument();
    expect(within(group).getByText('Tankstelle mov-obra-2')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Asignar obra a los 2' })).toBeDisabled();
  });

  it('assigns the chosen project to every movement of the group in one batched write', async () => {
    renderScreen(<Classifier user={USER} />);
    openTab(/Sin obra/);

    const group = screen.getByRole('region', { name: 'Aral AG' });
    fireEvent.change(within(group).getByLabelText('Obra para Aral AG'), { target: { value: 'proj-1' } });
    const button = within(group).getByRole('button', { name: 'Asignar obra a los 2' });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await screen.findByText('2 movimiento(s) asignados a NE4 Rossdorf');

    // One WriteBatch, one update per movement of the group, carrying the trio.
    expect(writeBatch).toHaveBeenCalledTimes(1);
    const batch = writeBatch.mock.results[0].value;
    expect(batch.update).toHaveBeenCalledTimes(2);
    const ids = batch.update.mock.calls.map(([ref]) => ref.path.split('/').pop()).sort();
    expect(ids).toEqual(['mov-obra-1', 'mov-obra-2']);
    batch.update.mock.calls.forEach(([, payload]) => {
      expect(payload).toMatchObject({ projectId: 'proj-1', projectName: 'NE4 Rossdorf', costScope: 'project' });
    });
  });

  it('lets one row take a different project than its group', async () => {
    renderScreen(<Classifier user={USER} />);
    openTab(/Sin obra/);

    fireEvent.change(screen.getByLabelText('Obra para Tankstelle mov-obra-2'), { target: { value: 'proj-1' } });
    const row = screen.getByText('Tankstelle mov-obra-2').closest('div');
    fireEvent.click(within(row.parentElement).getByRole('button', { name: 'Asignar' }));

    await screen.findByText('1 movimiento(s) asignados a NE4 Rossdorf');

    const batch = writeBatch.mock.results[0].value;
    expect(batch.update).toHaveBeenCalledTimes(1);
    expect(batch.update.mock.calls[0][0].path.endsWith('mov-obra-2')).toBe(true);
  });

  it('shows a per-bucket empty state, not a blank panel', () => {
    store.collections.bankMovements = [INCOME];

    renderScreen(<Classifier user={USER} />);
    openTab(/Sin obra/);

    expect(screen.getByText('Sin pendientes de obra')).toBeInTheDocument();
  });
});

describe('Classifier — Sin conciliar', () => {
  it('lists obra revenue without a CXC link with its match card, Vincular and Categorizar', () => {
    store.collections.bankMovements = [
      bankMovementFixture({
        id: 'mov-rev',
        direction: 'in',
        amount: 10000,
        description: 'Zahlung Insyte RE-2026-001',
        counterpartyName: 'Insyte Deutschland',
        categoryName: 'Facturación obra',
        postedDate: isoDaysFromNow(-4),
      }),
    ];

    renderScreen(<Classifier user={USER} />);
    expect(kpiValue('Sin conciliar')).toHaveTextContent('1');
    openTab(/Sin conciliar/);

    const row = screen.getByText('Zahlung Insyte RE-2026-001').closest('div.px-5');
    expect(within(row).getByText(/CXC sugerida/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Vincular/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Categorizar/ })).toBeInTheDocument();
  });

  it('does not ask for a CXC on an inflow filed under any other category', () => {
    store.collections.bankMovements = [
      bankMovementFixture({ id: 'mov-refund', direction: 'in', amount: 120, description: 'Rückerstattung', categoryName: 'Devoluciones', postedDate: isoDaysFromNow(-4) }),
    ];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByText('✓ Bandeja al día')).toBeInTheDocument();
  });
});

describe('Classifier — search', () => {
  it('filters the active bucket by description', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'Insyte' } });

    expect(screen.getByText('Überweisung Insyte')).toBeInTheDocument();
    expect(screen.queryByText('Tankstelle Aral')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'zzz' } });

    expect(screen.getByText('Sin pendientes de categoría')).toBeInTheDocument();
  });
});

describe('Classifier — rule shortcut', () => {
  it('offers "Aplicar reglas" only when a rule matches something in the inbox', () => {
    renderScreen(<Classifier user={USER} />);
    expect(screen.queryByRole('button', { name: /Aplicar reglas/ })).not.toBeInTheDocument();
  });

  it('counts the inbox movements a stored rule would classify', () => {
    store.collections.classificationRules = [
      {
        id: 'rule-aral',
        active: true,
        priority: 10,
        matchType: 'contains',
        field: 'counterpartyName',
        pattern: 'Aral',
        categoryName: 'Combustible',
        costScope: 'overhead',
      },
    ];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByRole('button', { name: /Aplicar reglas \(1\)/ })).toBeInTheDocument();
  });
});

/**
 * Nómina vs subcontratista in the inbox.
 *
 * The owner's core ask: he has to tell them apart at a glance. The employee
 * master already knows (`type`), the bank only ever writes a free-text name, so
 * the row resolves the name to a person and says which one it is — plus the
 * classification that person's kind implies.
 */
describe('Classifier — personas conocidas', () => {
  const employee = (overrides) => ({
    id: 'e-x',
    fullName: '',
    firstName: '',
    lastName: '',
    type: 'internal',
    status: 'active',
    projectIds: [],
    aliases: [],
    ...overrides,
  });

  const JEISSON = employee({
    id: 'e-jeisson',
    fullName: 'Jeisson Lesmes Linares',
    firstName: 'Jeisson',
    lastName: 'Lesmes Linares',
  });
  const JORGE = employee({
    id: 'e-jorge',
    fullName: 'Jorge Moran',
    firstName: 'Jorge',
    lastName: 'Moran',
    type: 'external',
    projectIds: ['proj-1'],
  });

  const salaryMovement = bankMovementFixture({
    id: 'mov-salary',
    direction: 'out',
    amount: 2400,
    description: 'Überweisung Gehalt',
    counterpartyName: 'Jeisson Lesmes Linares',
    postedDate: isoDaysFromNow(-2),
  });
  const subMovement = bankMovementFixture({
    id: 'mov-sub',
    direction: 'out',
    amount: 5000,
    description: 'Überweisung',
    counterpartyName: 'Jorge Moran',
    postedDate: isoDaysFromNow(-2),
  });

  beforeEach(() => {
    store.collections.employees = [JEISSON, JORGE];
    store.collections.payables = [];
  });

  it('badges a transfer to company payroll as Nómina and names the person', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    const badge = within(row).getByText('Nómina');
    // The badge names the person it resolved to, next to the badge itself.
    expect(badge.parentElement).toHaveTextContent('Jeisson Lesmes Linares');
  });

  it('badges a payment to an external collaborator as Subcontratista', () => {
    store.collections.bankMovements = [subMovement];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung').closest('div.px-5');
    expect(within(row).getByText('Subcontratista')).toBeInTheDocument();
  });

  it('pre-suggests Salarios / estructura for payroll', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    expect(within(row).getByText(/Salarios/)).toBeInTheDocument();
    expect(within(row).getByText(/Estructura/)).toBeInTheDocument();
    expect(within(row).getByText(/no se carga a la obra/i)).toBeInTheDocument();
  });

  it('pre-suggests Subcontratas / obra and says a project is required', () => {
    store.collections.bankMovements = [subMovement];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung').closest('div.px-5');
    expect(within(row).getByText(/Subcontratas/)).toBeInTheDocument();
    expect(within(row).getByText(/Obra/)).toBeInTheDocument();
    expect(within(row).getByText(/requiere proyecto/i)).toBeInTheDocument();
  });

  it('asks for confirmation instead of asserting on a probable match', () => {
    store.collections.employees = [
      employee({
        id: 'e-pedro',
        fullName: 'Pedro Pizarro Caufal',
        firstName: 'Pedro',
        lastName: 'Pizarro Caufal',
      }),
    ];
    store.collections.bankMovements = [
      bankMovementFixture({
        id: 'mov-maybe',
        direction: 'out',
        amount: 2200,
        description: 'Überweisung SEPA',
        counterpartyName: 'Pedro Luis Pizarro Zapata',
        postedDate: isoDaysFromNow(-2),
      }),
    ];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung SEPA').closest('div.px-5');
    expect(within(row).getByText(/Sin confirmar/i)).toBeInTheDocument();
    expect(within(row).getByText(/alias/i)).toBeInTheDocument();
  });

  it('says nothing for a counterparty that is not a person in the master', () => {
    store.collections.bankMovements = [EXPENSE_SPONTANEOUS];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Tankstelle Aral').closest('div.px-5');
    expect(within(row).queryByText('Nómina')).not.toBeInTheDocument();
    expect(within(row).queryByText('Subcontratista')).not.toBeInTheDocument();
  });

  it('opens the categorize modal already carrying the certain suggestion', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    fireEvent.click(within(row).getByRole('button', { name: /Categorizar/ }));

    expect(screen.getByLabelText('Categoría *')).toHaveValue('Salarios');
    expect(screen.getByRole('button', { name: 'Estructura' })).toHaveAttribute('aria-pressed', 'true');
  });
});
