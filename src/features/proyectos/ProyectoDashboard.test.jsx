/**
 * ProyectoDashboard — render smoke tests.
 *
 * Two distinct top-level shapes: the "no project" placeholder and the full
 * dashboard (KPIs, EVM block, monthly chart, category breakdown, movement
 * table). The recharts subtrees are the risky part here — jsdom has no layout,
 * so a chart mounts at zero size and draws nothing. That is deliberate: these
 * tests prove the surrounding JSX and the twelve `useMemo` transforms feeding it
 * do not throw, which is what a blank-app crash would come from.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import {
  bankMovementFixture,
  isoDaysFromNow,
  ledgerFixtures,
  projectFixture,
} from '@/test/fixtures';

/** Value rendered under a KPI title — the sibling `<p>` inside the KPI card. */
const kpiValue = (title) => screen.getByText(title).nextElementSibling.textContent;

const PROJECT = projectFixture({ id: 'proj-1', name: 'NE4 Rossdorf', code: 'NE4', client: 'Insyte' });

const MOVEMENTS = [
  bankMovementFixture({
    id: 'proj-in',
    direction: 'in',
    amount: 42000,
    description: 'Cobro certificación',
    counterpartyName: 'Insyte Deutschland',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    categoryName: 'Ventas',
    postedDate: isoDaysFromNow(-20),
  }),
  bankMovementFixture({
    id: 'proj-out',
    direction: 'out',
    amount: 12000,
    description: 'Material fibra',
    counterpartyName: 'Kabel Service GmbH',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    categoryName: 'Material',
    postedDate: isoDaysFromNow(-10),
  }),
];

const store = installFirebaseMocks(
  ledgerFixtures({ collections: { projects: [PROJECT], bankMovements: MOVEMENTS } }),
);

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: ProyectoDashboard } = await import('./ProyectoDashboard.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.collections.projects = [PROJECT];
  store.collections.bankMovements = MOVEMENTS;
});

describe('ProyectoDashboard — shell', () => {
  it('renders the header without throwing', () => {
    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Proyectos')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Rentabilidad y seguimiento por proyecto.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Proyecto')).toBeInTheDocument();
  });

  it('shows the loading branch while the ledger is still resolving', () => {
    renderScreen(<ProyectoDashboard user={null} />, { user: null });

    // Note the three ASCII periods — this screen does not use the ellipsis
    // character the other screens use.
    expect(screen.getByText('Cargando proyectos...')).toBeInTheDocument();
  });

  it('falls back to a placeholder when there is no project to show', () => {
    store.collections.projects = [];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Sin proyectos activos')).toBeInTheDocument();
    expect(screen.getByText('No hay proyecto seleccionado')).toBeInTheDocument();
    expect(
      screen.getByText('Selecciona un proyecto para revisar su comportamiento financiero.'),
    ).toBeInTheDocument();
  });

  it('ignores inactive projects when auto-selecting the first one', () => {
    store.collections.projects = [projectFixture({ id: 'proj-old', name: 'Obra cerrada', status: 'inactive' })];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('No hay proyecto seleccionado')).toBeInTheDocument();
  });
});

describe('ProyectoDashboard — selected project', () => {
  it('auto-selects the only project and renders its KPI block', () => {
    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Proyecto activo')).toBeInTheDocument();
    expect(screen.getByText('Ingresos realizados')).toBeInTheDocument();
    expect(screen.getByText('Gastos realizados')).toBeInTheDocument();
    expect(screen.getByText('Balance neto')).toBeInTheDocument();
    expect(screen.getByText('Margen')).toBeInTheDocument();

    expect(screen.getByText('42.000,00')).toBeInTheDocument();
    expect(screen.getByText('12.000,00')).toBeInTheDocument();
    expect(screen.getByText('+30.000,00')).toBeInTheDocument(); // net carries its sign
    expect(screen.getByText('71.4%')).toBeInTheDocument();
  });

  it('renders the movement table for the selected project', () => {
    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Movimientos del proyecto')).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(['Fecha', 'Descripción', 'Tipo', 'Contraparte', 'Importe']),
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Cobro certificación')).toBeInTheDocument();
    expect(within(table).getByText('Material fibra')).toBeInTheDocument();
  });

  it('renders the category breakdown and the monthly evolution sections', () => {
    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Gastos por categoría')).toBeInTheDocument();
    expect(screen.getByText('Evolución mensual')).toBeInTheDocument();
    expect(screen.getByText('Control de ejecución')).toBeInTheDocument();
  });

  it('shows the per-section empty copy when the project has no movements', () => {
    store.collections.bankMovements = [];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('Proyecto activo')).toBeInTheDocument();
    expect(screen.getByText('No hay gastos registrados en este proyecto.')).toBeInTheDocument();
    expect(
      screen.getByText('No hay movimientos registrados para este proyecto en la base actual.'),
    ).toBeInTheDocument();
  });
});

/**
 * Project cost is measured NET. Input VAT is reclaimed from the tax office, so
 * charging it to the obra overstates cost and understates margin — and it is the
 * margin the owner prices the next job from.
 */
describe('ProyectoDashboard — net of VAT', () => {
  const VAT_MOVEMENTS = [
    bankMovementFixture({
      id: 'vat-in',
      direction: 'in',
      amount: 47600,
      description: 'Cobro certificación',
      categoryName: 'Servicios',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      postedDate: isoDaysFromNow(-20),
    }),
    bankMovementFixture({
      id: 'vat-out',
      direction: 'out',
      amount: 11900,
      description: 'Material fibra',
      categoryName: 'Materiales',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      postedDate: isoDaysFromNow(-10),
    }),
  ];

  it('reports KPIs net of VAT when the categories carry a rate', () => {
    store.collections.bankMovements = VAT_MOVEMENTS;
    store.documents.vatRates = { rates: { Servicios: 0.19, Materiales: 0.19 } };

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('40.000,00')).toBeInTheDocument(); // 47.600 / 1,19
    expect(screen.getByText('10.000,00')).toBeInTheDocument(); // 11.900 / 1,19
    expect(screen.getByText('+30.000,00')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
  });

  it('lets a rate stored on the movement override the category rate', () => {
    store.collections.bankMovements = [
      { ...VAT_MOVEMENTS[0], taxRate: 0.07 },
      VAT_MOVEMENTS[1],
    ];
    store.documents.vatRates = { rates: { Servicios: 0.19, Materiales: 0.19 } };

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('44.485,98')).toBeInTheDocument(); // 47.600 / 1,07
  });

  it('leaves an unconfigured category at gross rather than guessing 19%', () => {
    store.collections.bankMovements = VAT_MOVEMENTS;
    store.documents.vatRates = { rates: {} };

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getByText('47.600,00')).toBeInTheDocument();
    expect(screen.getByText('11.900,00')).toBeInTheDocument();
  });

  it('says on screen that the figures exclude VAT and that cash does not', () => {
    store.collections.bankMovements = VAT_MOVEMENTS;
    store.documents.vatRates = { rates: { Servicios: 0.19, Materiales: 0.19 } };

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.getAllByText(/neto, sin IVA/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Importes brutos, tal como salieron del banco/i)).toBeInTheDocument();
  });

  it('keeps the movement table on the gross amount the bank actually moved', () => {
    store.collections.bankMovements = VAT_MOVEMENTS;
    store.documents.vatRates = { rates: { Servicios: 0.19, Materiales: 0.19 } };

    renderScreen(<ProyectoDashboard user={USER} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('+47.600,00')).toBeInTheDocument();
    expect(within(table).getByText('-11.900,00')).toBeInTheDocument();
  });
});

/**
 * THE double count.
 *
 * Personnel cost reaches an obra twice over: `allocatePayrollCost` spreads each
 * employee's gesamtkosten across `employee.projectIds`, and the individual bank
 * transfer to that same person also sits in `bankMovements`. Charging both bills
 * the project twice for one day of work.
 *
 * Rule: a movement whose counterparty is an INTERNAL employee is payroll
 * settlement, not obra cost. A movement to an EXTERNAL one is a subcontractor
 * payment and IS obra cost.
 */
describe('ProyectoDashboard — nómina vs subcontratista', () => {
  const JEISSON = {
    id: 'e-jeisson',
    fullName: 'Jeisson Lesmes Linares',
    firstName: 'Jeisson',
    lastName: 'Lesmes Linares',
    type: 'internal',
    status: 'active',
    projectIds: [],
  };
  const JORGE = {
    id: 'e-jorge',
    fullName: 'Jorge Moran',
    firstName: 'Jorge',
    lastName: 'Moran',
    type: 'external',
    status: 'active',
    projectIds: ['proj-1'],
  };

  const onProject = (overrides) =>
    bankMovementFixture({
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      postedDate: isoDaysFromNow(-10),
      ...overrides,
    });

  const INCOME = onProject({
    id: 'p-in',
    direction: 'in',
    amount: 42000,
    description: 'Cobro certificación',
    counterpartyName: 'Insyte Deutschland',
    postedDate: isoDaysFromNow(-20),
  });
  const MATERIAL = onProject({
    id: 'p-material',
    direction: 'out',
    amount: 12000,
    description: 'Material fibra',
    counterpartyName: 'Kabel Service GmbH',
  });
  const PAYROLL_TRANSFER = onProject({
    id: 'p-payroll',
    direction: 'out',
    amount: 3000,
    description: 'Überweisung Gehalt',
    counterpartyName: 'Jeisson Lesmes Linares',
  });

  beforeEach(() => {
    store.documents.vatRates = { rates: {} };
    store.collections.employees = [JEISSON, JORGE];
    store.collections.payrollPeriods = [];
  });

  it('does NOT charge the obra for a transfer to a company-payroll employee', () => {
    store.collections.bankMovements = [INCOME, MATERIAL, PAYROLL_TRANSFER];

    renderScreen(<ProyectoDashboard user={USER} />);

    // 12.000 of material only — the 3.000 salary transfer is payroll settlement.
    expect(kpiValue('Gastos realizados')).toContain('12.000,00');
    expect(kpiValue('Balance neto')).toContain('+30.000,00');
  });

  it('DOES charge the obra for a payment to a subcontractor', () => {
    store.collections.bankMovements = [
      INCOME,
      MATERIAL,
      onProject({
        id: 'p-sub',
        direction: 'out',
        amount: 5000,
        description: 'Pago cuadrilla',
        counterpartyName: 'Jorge Moran',
      }),
    ];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(kpiValue('Gastos realizados')).toContain('17.000,00');
  });

  it('counts the payroll allocation once, not once per route', () => {
    // Same person, both routes live: allocation says 4.000 of employer cost lands
    // on proj-1, and the bank shows a 3.000 transfer to him on the same project.
    store.collections.employees = [{ ...JEISSON, projectIds: ['proj-1'] }, JORGE];
    store.collections.payrollPeriods = [
      { id: 'per-1', period: isoDaysFromNow(-10).slice(0, 7), lines: [{ employeeId: 'e-jeisson', gesamtkosten: 4000 }] },
    ];
    store.collections.bankMovements = [INCOME, MATERIAL, PAYROLL_TRANSFER];

    renderScreen(<ProyectoDashboard user={USER} />);

    // 12.000 material + 4.000 allocated labor. NOT 19.000.
    expect(kpiValue('Gastos realizados')).toContain('16.000,00');
    expect(screen.getByText(/Incluye 4\.000,00 de mano de obra/)).toBeInTheDocument();
  });

  it('explains on screen why that money is not on the obra', () => {
    store.collections.bankMovements = [INCOME, MATERIAL, PAYROLL_TRANSFER];

    renderScreen(<ProyectoDashboard user={USER} />);

    const panel = screen.getByTestId('payroll-settlement-panel');
    expect(within(panel).getByText(/Nómina de empresa/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Jeisson Lesmes Linares/)).toBeInTheDocument();
    // The excluded total is stated in the copy, in the chip and per row.
    expect(within(panel).getAllByText(/3\.000,00/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/ya está contabilizada en la asignación de nómina/i)).toBeInTheDocument();
  });

  it('keeps the excluded movement visible in the table, flagged as nómina', () => {
    store.collections.bankMovements = [INCOME, MATERIAL, PAYROLL_TRANSFER];

    renderScreen(<ProyectoDashboard user={USER} />);

    const table = screen.getByRole('table');
    const row = within(table).getByText('Überweisung Gehalt').closest('tr');
    expect(within(row).getByText('Nómina')).toBeInTheDocument();
    expect(within(row).getByText('-3.000,00')).toBeInTheDocument();
  });

  it('says nothing about payroll when the project has none', () => {
    store.collections.bankMovements = [INCOME, MATERIAL];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(screen.queryByTestId('payroll-settlement-panel')).not.toBeInTheDocument();
  });

  /**
   * Master "Pedro Pizarro Caufal" vs bank "Pedro Luis Pizarro Zapata": probable,
   * not proven. Removing real cost on a guess is worse than showing it, so the
   * movement stays charged and the screen asks for an alias.
   */
  it('keeps a probable payroll match charged and asks for an alias instead', () => {
    store.collections.employees = [
      {
        id: 'e-pedro',
        fullName: 'Pedro Pizarro Caufal',
        firstName: 'Pedro',
        lastName: 'Pizarro Caufal',
        type: 'internal',
        status: 'active',
        projectIds: [],
      },
    ];
    store.collections.bankMovements = [
      INCOME,
      MATERIAL,
      onProject({
        id: 'p-maybe',
        direction: 'out',
        amount: 2200,
        description: 'Überweisung',
        counterpartyName: 'Pedro Luis Pizarro Zapata',
      }),
    ];

    renderScreen(<ProyectoDashboard user={USER} />);

    expect(kpiValue('Gastos realizados')).toContain('14.200,00');
    const review = screen.getByTestId('payroll-review-panel');
    expect(within(review).getByText(/Pedro Pizarro Caufal/)).toBeInTheDocument();
    expect(within(review).getByText(/alias/i)).toBeInTheDocument();
  });
});
