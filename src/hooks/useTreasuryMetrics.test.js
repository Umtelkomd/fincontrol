/**
 * useTreasuryMetrics — the one liquidity formula.
 *
 * `netPosition` (cash + open receivables − open payables) is what Resumen, the
 * CashFlow hero and the executive summary all print. It must be the SAME
 * number on every screen, which means the `from/to` range a screen passes for
 * its movement tables can never leak into it: ExecutiveSummary asked for
 * 2026-01-01..2026-12-31 and silently lost every open invoice issued in 2025
 * or with a blank issueDate — the 120 € discrepancy nobody could explain.
 *
 * The hook still needs a ledger; the Firebase double keeps its internal
 * fallback subscription idle so the tests hand it a plain object.
 */
import { describe, expect, it } from 'vitest';
import { installFirebaseMocks } from '../test/firebaseMock.js';

installFirebaseMocks();

const { renderHook } = await import('@testing-library/react');
const { useTreasuryMetrics } = await import('./useTreasuryMetrics.js');

const REFERENCE_DATE = '2026-09-02';

const movement = (overrides = {}) => ({
  id: `mov-${Math.random().toString(36).slice(2)}`,
  accountId: 'main',
  status: 'posted',
  direction: 'in',
  amount: 100,
  postedDate: '2026-03-01',
  projectId: '',
  projectName: 'Sin proyecto',
  ...overrides,
});

const document = (overrides = {}) => ({
  id: `doc-${Math.random().toString(36).slice(2)}`,
  accountId: 'main',
  status: 'issued',
  openAmount: 100,
  grossAmount: 100,
  issueDate: '2026-02-01',
  dueDate: '2026-03-01',
  projectId: '',
  counterpartyName: 'Contraparte',
  ...overrides,
});

const ledgerWith = ({ movements = [], receivables = [], payables = [], cash = 1000 } = {}) => ({
  loading: false,
  error: null,
  sourceErrors: {},
  bankAccount: { id: 'main', openingBalance: 0, openingDate: '2025-12-31', creditLineLimit: 0 },
  postedMovements: movements,
  bankMovements: movements,
  receivables,
  payables,
  budgets: [],
  projects: [],
  anchors: [],
  cashSource: 'anchors',
  cashMeta: { anchor: { date: '2026-05-31' }, lastMovementDate: '2026-08-01', importGap: { hasGap: false } },
  summary: { currentCash: cash, creditUsed: 0, availableCredit: 0, pendingReceivables: 0, pendingPayables: 0 },
});

const metricsFor = (ledger, options = {}) =>
  renderHook(() => useTreasuryMetrics({ user: null, ledger, referenceDate: REFERENCE_DATE, ...options }))
    .result.current;

describe('useTreasuryMetrics — netPosition ignores the movement range', () => {
  const ledger = ledgerWith({
    cash: 1000,
    receivables: [
      // Issued last year, still open — the invoice the year filter used to drop.
      document({ id: 'cxc-2025', openAmount: 120, issueDate: '2025-11-03', dueDate: '2025-12-03' }),
      // No issue date at all: unparseable for a range filter, still money owed.
      document({ id: 'cxc-blank', openAmount: 500, issueDate: '', dueDate: '2026-09-10' }),
      document({ id: 'cxc-settled', openAmount: 0, status: 'settled' }),
    ],
    payables: [
      document({ id: 'cxp-2025', openAmount: 200, issueDate: '2025-12-15', dueDate: '2026-01-15' }),
    ],
  });

  it('counts every open document regardless of from/to', () => {
    const metrics = metricsFor(ledger, { from: '2026-01-01', to: '2026-12-31' });

    expect(metrics.pendingReceivables).toBe(620);
    expect(metrics.pendingPayables).toBe(200);
    expect(metrics.netPosition).toBe(1000 + 620 - 200);
  });

  it('produces the same figure with and without a range', () => {
    const ranged = metricsFor(ledger, { from: '2026-01-01', to: '2026-12-31' });
    const unranged = metricsFor(ledger);

    expect(ranged.netPosition).toBe(unranged.netPosition);
    expect(ranged.overdueReceivables.map((entry) => entry.id)).toEqual(
      unranged.overdueReceivables.map((entry) => entry.id),
    );
    expect(ranged.upcomingReceivables.map((entry) => entry.id)).toEqual(['cxc-blank']);
  });

  it('keeps projectedLiquidity as an alias of netPosition for one release', () => {
    const metrics = metricsFor(ledger, { from: '2026-01-01', to: '2026-12-31' });

    expect(metrics.projectedLiquidity).toBe(metrics.netPosition);
  });
});

describe('useTreasuryMetrics — movement totals still respect the range', () => {
  const ledger = ledgerWith({
    movements: [
      movement({ id: 'in-2025', direction: 'in', amount: 300, postedDate: '2025-12-20' }),
      movement({ id: 'in-2026', direction: 'in', amount: 400, postedDate: '2026-03-01' }),
      movement({ id: 'out-2026', direction: 'out', amount: 100, postedDate: '2026-04-01' }),
    ],
  });

  it('sums inflows and outflows inside from/to only', () => {
    const metrics = metricsFor(ledger, { from: '2026-01-01', to: '2026-12-31' });

    expect(metrics.filteredMovements.map((entry) => entry.id)).toEqual(['in-2026', 'out-2026']);
    expect(metrics.cashInflows).toBe(400);
    expect(metrics.cashOutflows).toBe(100);
    expect(metrics.netMovement).toBe(300);
  });

  it('sums everything when no range is given', () => {
    const metrics = metricsFor(ledger);

    expect(metrics.cashInflows).toBe(700);
  });
});

describe('useTreasuryMetrics — runwayMonths never goes negative', () => {
  // 900 € out inside the trailing 90 days ⇒ 300 €/month over the 3-month window.
  const burn = [movement({ id: 'burn', direction: 'out', amount: 900, postedDate: '2026-08-15' })];

  it('divides positive cash by the average monthly outflow', () => {
    const metrics = metricsFor(ledgerWith({ cash: 3000, movements: burn }));

    expect(metrics.avgMonthlyOutflows).toBe(300);
    expect(metrics.runwayMonths).toBe(10);
  });

  it('returns 0 when cash is already below zero', () => {
    const metrics = metricsFor(ledgerWith({ cash: -500, movements: burn }));

    expect(metrics.runwayMonths).toBe(0);
  });

  it('returns 0 for zero cash even when nothing is being spent', () => {
    expect(metricsFor(ledgerWith({ cash: 0 })).runwayMonths).toBe(0);
  });

  it('returns null when there is cash but no outflow to burn it', () => {
    expect(metricsFor(ledgerWith({ cash: 3000 })).runwayMonths).toBeNull();
  });
});
