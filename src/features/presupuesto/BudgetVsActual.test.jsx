/**
 * BudgetVsActual — render smoke tests.
 *
 * 1.400 lines behind eight hooks, with two mutually exclusive tabs, an
 * admin-only action column and a recharts bar chart that only mounts once a
 * budget exists for the selected year. Both top-level shapes are covered: the
 * "no budget yet" onboarding state and a real budget with lines.
 *
 * The chart renders at zero size under jsdom (no layout engine, ResizeObserver
 * is stubbed in src/test/setup.js), so no SVG is asserted — the value is that
 * mounting it, and the actuals aggregation feeding it, does not throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { bankMovementFixture, ledgerFixtures } from '@/test/fixtures';

const YEAR = new Date().getFullYear();
const MONTH_INDEX = new Date().getMonth();

const monthly = (amount) => {
  const values = Array(12).fill(0);
  values[MONTH_INDEX] = amount;
  return values;
};

const BUDGET = {
  id: 'budget-current',
  year: YEAR,
  projectId: null,
  name: `Presupuesto ${YEAR}`,
  lines: [
    {
      id: 'line-income',
      categoryId: 'income',
      categoryName: 'Ingresos',
      type: 'income',
      monthlyBudget: monthly(50000),
      notes: '',
    },
    {
      id: 'line-material',
      categoryId: 'material',
      categoryName: 'Material',
      type: 'expense',
      monthlyBudget: monthly(20000),
      notes: '',
    },
  ],
};

const thisMonthIso = (day) =>
  `${YEAR}-${String(MONTH_INDEX + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const ACTUALS = [
  bankMovementFixture({
    id: 'budget-in',
    direction: 'in',
    amount: 30000,
    description: 'Cobro certificación',
    categoryName: 'Ingresos',
    postedDate: thisMonthIso(5),
  }),
  bankMovementFixture({
    id: 'budget-out',
    direction: 'out',
    amount: 8000,
    description: 'Compra material',
    categoryName: 'Material',
    postedDate: thisMonthIso(7),
  }),
];

const store = installFirebaseMocks(
  ledgerFixtures({ collections: { budgets: [BUDGET], bankMovements: ACTUALS } }),
);

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: BudgetVsActual } = await import('./BudgetVsActual.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.collections.budgets = [BUDGET];
  store.collections.bankMovements = ACTUALS;
});

describe('BudgetVsActual — shell', () => {
  it('renders the header and the filter controls without throwing', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByRole('heading', { name: 'Planificado vs. Real.' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Compara el presupuesto por categoría y mes contra la ejecución real (neto sin IVA).',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(`Presupuesto ${YEAR}`, { selector: 'p' })).toBeInTheDocument();
  });

  it('shows the loading branch while budgets and the ledger resolve', () => {
    renderScreen(<BudgetVsActual user={null} userRole="admin" />, { user: null });

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers to create one when no budget exists for the year', () => {
    store.collections.budgets = [];

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByText(`Sin presupuesto para ${YEAR}`)).toBeInTheDocument();
    expect(screen.getByText('Crea un presupuesto para empezar a comparar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Crear presupuesto ${YEAR}` })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('does not offer budget creation to a non-admin', () => {
    store.collections.budgets = [];

    renderScreen(<BudgetVsActual user={USER} userRole="manager" />);

    expect(screen.getByText(`Sin presupuesto para ${YEAR}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear presupuesto/ })).not.toBeInTheDocument();
  });
});

describe('BudgetVsActual — budget loaded', () => {
  it('renders the KPI row comparing planned against actual', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByText('Ingresos presupuestados')).toBeInTheDocument();
    expect(screen.getByText('Ingresos reales (neto)')).toBeInTheDocument();
    expect(screen.getByText('Gastos presupuestados')).toBeInTheDocument();
    expect(screen.getByText('Gastos reales (neto)')).toBeInTheDocument();
  });

  it('renders the per-category table with one row per budget line', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Categoría',
      'Tipo',
      'Presupuesto',
      'Real (neto)',
      'Desviación',
      '%',
      'Estado',
      'Acciones',
    ]);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Ingresos')).toBeInTheDocument();
    expect(within(table).getByText('Material')).toBeInTheDocument();
    expect(within(table).getByText('TOTALES')).toBeInTheDocument();
  });

  it('drops the actions column for a non-admin role', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="manager" />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).not.toContain('Acciones');
    expect(within(screen.getByRole('table')).getByText('Material')).toBeInTheDocument();
  });

  it('switches between the summary and the monthly detail tab', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByText('Resumen por categoría')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Detalle mensual' }));

    expect(screen.getByText('Detalle mensual por categoría')).toBeInTheDocument();
  });

  it('mounts the chart section without throwing under jsdom', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByText('Ingresos y Gastos por mes')).toBeInTheDocument();
    expect(screen.getByText('Barras: presupuesto. Línea: ejecución real.')).toBeInTheDocument();
  });

  it('renders the empty-lines copy for a budget with no lines yet', () => {
    store.collections.budgets = [{ ...BUDGET, lines: [] }];

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(
      screen.getByText('Sin líneas de presupuesto. Clica "Añadir línea" para empezar.'),
    ).toBeInTheDocument();
  });
});

/**
 * The cost-center filter compared two different things: the dropdown was keyed
 * by the live doc's NAME while the predicate read the movement's stored CODE
 * through a dictionary of its own (OPE/ADM/LOG/FIN/VEN) that knew neither
 * `CC-0xx` nor `CC-1xx`. Both sides now speak catalogue CODES, resolved through
 * `resolveLegacyCostCenter`, so every spelling of one center is one bucket.
 */
describe('BudgetVsActual — cost-center filter', () => {
  const MATERIAL_BY_CENTER = [
    bankMovementFixture({ id: 'cc-v2', direction: 'out', amount: 1000, categoryName: 'Material', costCenterId: 'CC-120', postedDate: thisMonthIso(3) }),
    bankMovementFixture({ id: 'cc-legacy', direction: 'out', amount: 2000, categoryName: 'Material', costCenterId: 'CC-002', postedDate: thisMonthIso(4) }),
    bankMovementFixture({ id: 'cc-label', direction: 'out', amount: 4000, categoryName: 'Material', costCenterId: 'Instalaciones y Reparaciones', postedDate: thisMonthIso(5) }),
    bankMovementFixture({ id: 'cc-other', direction: 'out', amount: 8000, categoryName: 'Material', costCenterId: 'CC-300', postedDate: thisMonthIso(6) }),
  ];

  const selectCostCenter = (value) =>
    fireEvent.change(screen.getByRole('option', { name: 'Todos los CC' }).closest('select'), { target: { value } });

  beforeEach(() => {
    store.collections.bankMovements = MATERIAL_BY_CENTER;
  });

  it('offers the catalogue as the filter buckets', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getByRole('option', { name: 'CC-120 · NE4 (vivienda y MDU)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CC-NOM · Nómina y seguridad social' })).toBeInTheDocument();
  });

  it('counts every center in the unfiltered view', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getAllByText('15.000,00').length).toBeGreaterThan(0);
  });

  it('filters by the resolved code, whichever spelling the movement was stored with', () => {
    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    selectCostCenter('CC-120');

    // 1.000 (CC-120) + 2.000 (CC-002) + 4.000 ("Instalaciones y Reparaciones").
    expect(screen.getAllByText('7.000,00').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('15.000,00')).toHaveLength(0);
    expect(screen.getByText('CC: CC-120')).toBeInTheDocument();
  });

  it('keeps a live cost-center doc that resolves to no v2 code as its own filterable bucket', () => {
    // "Contratistas" has no recorded meaning anywhere, so it is never guessed
    // into a v2 center — it stays visible and filters under itself alone.
    store.collections.costCenters = [{ id: 'cc-doc-sub', code: 'CC-008', name: 'Contratistas' }];
    store.collections.bankMovements = [
      ...MATERIAL_BY_CENTER,
      bankMovementFixture({ id: 'cc-sub', direction: 'out', amount: 500, categoryName: 'Material', costCenterId: 'CC-008', postedDate: thisMonthIso(8) }),
    ];

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);
    expect(screen.getByRole('option', { name: 'CC-008 · Contratistas' })).toBeInTheDocument();

    selectCostCenter('CC-008');

    expect(screen.getAllByText('500,00').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('7.000,00')).toHaveLength(0);
  });

  it('resolves a movement stored as the Firestore doc id of a live legacy center', () => {
    store.collections.costCenters = [{ id: 'cc-doc-legacy', code: 'CC-002', name: 'Instalaciones y Reparaciones' }];
    store.collections.bankMovements = [
      bankMovementFixture({ id: 'cc-by-id', direction: 'out', amount: 900, categoryName: 'Material', costCenterId: 'cc-doc-legacy', postedDate: thisMonthIso(9) }),
    ];

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    selectCostCenter('CC-120');

    expect(screen.getAllByText('900,00').length).toBeGreaterThan(0);
  });
});

/**
 * The screen has always labelled its actuals "neto sin IVA"; until the category
 * rates existed the figure behind that label was the gross amount, because the
 * adapter's `netAmount` equals `amount` whenever no rate is known.
 */
describe('BudgetVsActual — net actuals', () => {
  const grossActuals = [
    bankMovementFixture({
      id: 'vat-in',
      direction: 'in',
      amount: 35700,
      description: 'Cobro certificación',
      categoryName: 'Ingresos',
      postedDate: thisMonthIso(5),
    }),
    bankMovementFixture({
      id: 'vat-out',
      direction: 'out',
      amount: 11900,
      description: 'Compra material',
      categoryName: 'Material',
      postedDate: thisMonthIso(7),
    }),
  ];

  it('nets the actuals against the configured category rate', () => {
    store.collections.bankMovements = grossActuals;
    store.documents.vatRates = { rates: { Ingresos: 0.19, Material: 0.19 } };

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getAllByText('30.000,00').length).toBeGreaterThan(0); // 35.700 / 1,19
    expect(screen.getAllByText('10.000,00').length).toBeGreaterThan(0); // 11.900 / 1,19
    expect(screen.queryAllByText('35.700,00')).toHaveLength(0);
    expect(screen.queryAllByText('11.900,00')).toHaveLength(0);
  });

  it('keeps an unconfigured category at gross instead of assuming 19%', () => {
    store.collections.bankMovements = grossActuals;
    store.documents.vatRates = { rates: {} };

    renderScreen(<BudgetVsActual user={USER} userRole="admin" />);

    expect(screen.getAllByText('35.700,00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('11.900,00').length).toBeGreaterThan(0);
  });
});
