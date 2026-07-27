/**
 * Classifier — render smoke tests.
 *
 * The weekly DATEV inbox. Three mutually exclusive tab panels, each with its
 * own empty state, plus a coverage header shared with Movimientos. Only one
 * panel is mounted at a time, so two thirds of this screen's JSX had never been
 * evaluated by anything before these tests.
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
// what routes an outflow into the "Gastos con CXP sugerida" bucket.
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
const { default: Classifier } = await import('./Classifier.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

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
});

describe('Classifier — inbox shell', () => {
  it('renders the header and the coverage banner without throwing', () => {
    renderScreen(<Classifier user={USER} />);

    expect(screen.getByRole('heading', { name: 'Clasificar movimientos' })).toBeInTheDocument();
    expect(screen.getByText('Bandeja semanal')).toBeInTheDocument();
    expect(screen.getByText('Cobertura de clasificación')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Cobertura de clasificación' })).toBeInTheDocument();
  });

  it('buckets the inbox across the KPI row', () => {
    renderScreen(<Classifier user={USER} />);

    // One inflow + one matched outflow + one loose outflow. The bucket labels
    // also appear on the tabs (inside a <span>), so each KPI is read from its
    // own tile: label <p> → header row → tile root → the tile's value <p>.
    const kpiValue = (label) =>
      screen
        .getByText(label, { selector: 'p' })
        .closest('div')
        .parentElement.querySelector(':scope > p');

    expect(kpiValue('Pendientes total')).toHaveTextContent('3');
    expect(kpiValue('Con CXP sugerida')).toHaveTextContent('1');
    expect(kpiValue('Gastos espontáneos')).toHaveTextContent('1');
  });

  it('reports an empty inbox as up to date rather than as an error', () => {
    store.collections.bankMovements = [];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByText('✓ Bandeja al día')).toBeInTheDocument();
    expect(screen.getByText('[Sin ingresos pendientes]')).toBeInTheDocument();
  });
});

describe('Classifier — tab panels', () => {
  it('opens on the income bucket and lists the unreconciled inflow', () => {
    renderScreen(<Classifier user={USER} />);

    const panel = screen.getByText('Ingresos sin conciliar', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Überweisung Insyte')).toBeInTheDocument();
    expect(within(panel).queryByText('Tankstelle Aral')).not.toBeInTheDocument();
  });

  it('switches to the suggested-CXP bucket and renders its match', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /Gastos con CXP sugerida/ }));

    const panel = screen.getByText('Gastos con CXP sugerida', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Lastschrift Kabel Service')).toBeInTheDocument();
    expect(within(panel).queryByText('Überweisung Insyte')).not.toBeInTheDocument();
  });

  it('switches to the spontaneous bucket for outflows with no CXP candidate', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /Gastos espontáneos/ }));

    const panel = screen.getByText('Gastos espontáneos', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Tankstelle Aral')).toBeInTheDocument();
  });

  it('shows a per-bucket empty state, not a blank panel', () => {
    store.collections.bankMovements = [INCOME];

    renderScreen(<Classifier user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: /Gastos espontáneos/ }));

    expect(screen.getByText('[Sin gastos por categorizar]')).toBeInTheDocument();
    expect(
      screen.getByText('Todos los gastos están conciliados o categorizados.'),
    ).toBeInTheDocument();
  });
});

describe('Classifier — search', () => {
  it('filters the active bucket by description', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'Insyte' } });

    expect(screen.getByText('Überweisung Insyte')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'zzz' } });

    expect(screen.getByText('[Sin ingresos pendientes]')).toBeInTheDocument();
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

  const openSpontaneous = () =>
    fireEvent.click(screen.getByRole('button', { name: /Gastos espontáneos/ }));

  beforeEach(() => {
    store.collections.employees = [JEISSON, JORGE];
    store.collections.payables = [];
  });

  it('badges a transfer to company payroll as Nómina and names the person', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    const badge = within(row).getByText('Nómina');
    // The badge names the person it resolved to, next to the badge itself.
    expect(badge.parentElement).toHaveTextContent('Jeisson Lesmes Linares');
  });

  it('badges a payment to an external collaborator as Subcontratista', () => {
    store.collections.bankMovements = [subMovement];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Überweisung').closest('div.px-5');
    expect(within(row).getByText('Subcontratista')).toBeInTheDocument();
  });

  it('pre-suggests Salarios / estructura for payroll', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    expect(within(row).getByText(/Salarios/)).toBeInTheDocument();
    expect(within(row).getByText(/Estructura/)).toBeInTheDocument();
    expect(within(row).getByText(/no se carga a la obra/i)).toBeInTheDocument();
  });

  it('pre-suggests Subcontratos / obra and says a project is required', () => {
    store.collections.bankMovements = [subMovement];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Überweisung').closest('div.px-5');
    expect(within(row).getByText(/Subcontratos/)).toBeInTheDocument();
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
    openSpontaneous();

    const row = screen.getByText('Überweisung SEPA').closest('div.px-5');
    expect(within(row).getByText(/Sin confirmar/i)).toBeInTheDocument();
    expect(within(row).getByText(/alias/i)).toBeInTheDocument();
  });

  it('says nothing for a counterparty that is not a person in the master', () => {
    store.collections.bankMovements = [EXPENSE_SPONTANEOUS];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Tankstelle Aral').closest('div.px-5');
    expect(within(row).queryByText('Nómina')).not.toBeInTheDocument();
    expect(within(row).queryByText('Subcontratista')).not.toBeInTheDocument();
  });

  it('opens the categorize modal already carrying the certain suggestion', () => {
    store.collections.bankMovements = [salaryMovement];

    renderScreen(<Classifier user={USER} />);
    openSpontaneous();

    const row = screen.getByText('Überweisung Gehalt').closest('div.px-5');
    fireEvent.click(within(row).getByRole('button', { name: /Categorizar/ }));

    expect(screen.getByLabelText('Categoría *')).toHaveValue('Salarios');
    expect(screen.getByRole('button', { name: 'Estructura' })).toHaveAttribute('aria-pressed', 'true');
  });
});
