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
