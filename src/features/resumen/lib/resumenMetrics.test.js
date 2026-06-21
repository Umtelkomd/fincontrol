/**
 * Unit tests for resumenMetrics.js — pure math, no mocks needed.
 *
 * Vitest API. Style mirrors src/features/cfo/lib/runway.test.js:
 * plain object factories, a frozen asOfDate, no Firestore, no React.
 */

import { describe, expect, it } from 'vitest';

import {
  computeMonthlyResult,
  selectDueWithinDays,
  runwayWeeks,
  buildMonthlyCashFlowSeries,
  __internal,
} from './resumenMetrics.js';

// ── computeMonthlyResult ─────────────────────────────────────────────────────
describe('computeMonthlyResult', () => {
  it('income above expenses + payroll → positive result, isProfit true', () => {
    const result = computeMonthlyResult({ income: 50000, expenses: 8000, payrollCost: 39145.8 });
    expect(result.income).toBe(50000);
    expect(result.baseExpenses).toBe(8000);
    expect(result.payrollCost).toBe(39145.8);
    expect(result.totalExpenses).toBe(47145.8);
    expect(result.result).toBe(2854.2);
    expect(result.isProfit).toBe(true);
  });

  it('payroll pushes a cash-positive base into a loss (the core payroll-as-cost case)', () => {
    // income - baseExpenses is positive (+5000) but adding payroll makes it negative.
    const result = computeMonthlyResult({ income: 45000, expenses: 40000, payrollCost: 39145.8 });
    expect(result.income - result.baseExpenses).toBe(5000); // base alone looks healthy
    expect(result.totalExpenses).toBe(79145.8);
    expect(result.result).toBe(-34145.8);
    expect(result.isProfit).toBe(false);
  });

  it('payrollCost=0 (no permission / no period) → graceful no-payroll path', () => {
    const result = computeMonthlyResult({ income: 30000, expenses: 12000, payrollCost: 0 });
    expect(result.payrollCost).toBe(0);
    expect(result.totalExpenses).toBe(result.baseExpenses);
    expect(result.totalExpenses).toBe(12000);
    expect(result.result).toBe(18000);
    expect(result.isProfit).toBe(true);
  });

  it('missing payrollCost argument defaults to 0', () => {
    const result = computeMonthlyResult({ income: 30000, expenses: 12000 });
    expect(result.payrollCost).toBe(0);
    expect(result.result).toBe(18000);
  });

  it('negative / NaN / undefined inputs are coerced to 0', () => {
    const result = computeMonthlyResult({ income: undefined, expenses: NaN, payrollCost: -100 });
    expect(result.income).toBe(0);
    expect(result.baseExpenses).toBe(0);
    expect(result.payrollCost).toBe(0); // negative payroll coerced to 0, never reduces expenses
    expect(result.totalExpenses).toBe(0);
    expect(result.result).toBe(0);
    expect(result.isProfit).toBe(false); // zero is not a profit
  });

  it('rounds to 2 decimals (round2 parity with runway.js)', () => {
    const result = computeMonthlyResult({ income: 10.236, expenses: 0.004, payrollCost: 1.115 });
    expect(result.income).toBe(10.24);
    expect(result.baseExpenses).toBe(0); // 0.004 rounds to 0
    expect(result.payrollCost).toBe(1.12); // 1.115 -> 1.12
    expect(result.totalExpenses).toBe(1.12);
    expect(result.result).toBe(9.12);
  });

  it('exact break-even (result === 0) is not a profit', () => {
    const result = computeMonthlyResult({ income: 1000, expenses: 600, payrollCost: 400 });
    expect(result.result).toBe(0);
    expect(result.isProfit).toBe(false);
  });
});

// ── selectDueWithinDays ──────────────────────────────────────────────────────
const item = (dueDate, extra = {}) => ({
  id: extra.id || `${dueDate}-${extra.openAmount ?? 0}`,
  description: extra.description ?? 'Doc',
  counterpartyName: extra.counterpartyName ?? 'ACME',
  dueDate,
  openAmount: extra.openAmount ?? 100,
  ...extra,
});

describe('selectDueWithinDays', () => {
  const asOf = '2026-06-06';

  it('returns only items with dueDate within [asOf, asOf+N] inclusive', () => {
    const items = [
      item('2026-06-01'), // past → excluded
      item('2026-06-06'), // exactly asOf → included
      item('2026-06-10'), // within → included
      item('2026-06-20'), // exactly asOf+14 → included
      item('2026-06-21'), // beyond window → excluded
    ];
    const out = selectDueWithinDays(items, 14, asOf);
    expect(out.map((d) => d.dueDate)).toEqual(['2026-06-06', '2026-06-10', '2026-06-20']);
  });

  it('sorts ascending by dueDate; ties stay stable in input order', () => {
    const items = [
      item('2026-06-15', { id: 'b' }),
      item('2026-06-08', { id: 'a' }),
      item('2026-06-15', { id: 'c' }), // tie with b, comes after in input
    ];
    const out = selectDueWithinDays(items, 30, asOf);
    expect(out.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips items missing a dueDate', () => {
    const items = [
      item('2026-06-10'),
      { id: 'x', description: 'No date', openAmount: 50 }, // no dueDate
      item(null, { id: 'nulldate' }),
    ];
    const out = selectDueWithinDays(items, 30, asOf);
    expect(out.map((d) => d.id)).toEqual([item('2026-06-10').id]);
  });

  it('preserves mixed CXC/CXP shape fields on output (openAmount, payrollKind, counterpartyName)', () => {
    const items = [
      item('2026-06-09', { id: 'cxp', openAmount: 5000, payrollKind: 'krankenkasse', counterpartyName: 'AOK' }),
    ];
    const [out] = selectDueWithinDays(items, 30, asOf);
    expect(out.openAmount).toBe(5000);
    expect(out.payrollKind).toBe('krankenkasse');
    expect(out.counterpartyName).toBe('AOK');
  });

  it('includes payroll-kind payables like any other payable (no special-casing)', () => {
    const items = [
      item('2026-06-12', { id: 'kk', payrollKind: 'krankenkasse' }),
      item('2026-06-13', { id: 'fa', payrollKind: 'tax' }),
      item('2026-06-14', { id: 'net', payrollKind: 'wages' }),
      item('2026-06-15', { id: 'normal', payrollKind: null }),
    ];
    const out = selectDueWithinDays(items, 30, asOf);
    expect(out.map((d) => d.id)).toEqual(['kk', 'fa', 'net', 'normal']);
  });

  it('handles empty / nullish input lists', () => {
    expect(selectDueWithinDays([], 30, asOf)).toEqual([]);
    expect(selectDueWithinDays(null, 30, asOf)).toEqual([]);
    expect(selectDueWithinDays(undefined, 30, asOf)).toEqual([]);
  });

  it('accepts a Date asOf and normalizes it to an ISO day', () => {
    const items = [item('2026-06-10')];
    const out = selectDueWithinDays(items, 30, new Date('2026-06-06T15:00:00Z'));
    expect(out).toHaveLength(1);
  });
});

// ── runwayWeeks ──────────────────────────────────────────────────────────────
describe('runwayWeeks', () => {
  it('Infinity months → Infinity weeks (no burn / infinite runway sentinel)', () => {
    expect(runwayWeeks(Infinity)).toBe(Infinity);
  });

  it('null / undefined / NaN months → Infinity (treated as no finite runway)', () => {
    expect(runwayWeeks(null)).toBe(Infinity);
    expect(runwayWeeks(undefined)).toBe(Infinity);
    expect(runwayWeeks(NaN)).toBe(Infinity);
  });

  it('finite months convert via 4.345 weeks/month, rounded to 1 decimal', () => {
    expect(runwayWeeks(1)).toBe(4.3);
    expect(runwayWeeks(3)).toBe(13);
    expect(runwayWeeks(6)).toBe(26.1);
  });

  it('zero months → 0 weeks', () => {
    expect(runwayWeeks(0)).toBe(0);
  });
});

// ── buildMonthlyCashFlowSeries ───────────────────────────────────────────────
const movement = (postedDate, direction, amount, extra = {}) => ({
  id: extra.id || `${postedDate}-${direction}-${amount}`,
  postedDate,
  direction,
  amount,
  accountId: 'main',
  ...extra,
});

describe('buildMonthlyCashFlowSeries', () => {
  const asOf = new Date('2026-06-15T00:00:00Z');

  it('returns N monthly buckets ending with the month of referenceDate', () => {
    const series = buildMonthlyCashFlowSeries({
      postedMovements: [],
      referenceDate: asOf,
      monthsCount: 12,
      startingBalance: 5000,
    });
    expect(series).toHaveLength(12);
    expect(series[0].key).toBe('2025-07');
    expect(series[11].key).toBe('2026-06');
  });

  it('aggregates inflows and outflows per month and computes net', () => {
    const movs = [
      movement('2026-06-05', 'in', 10000),
      movement('2026-06-12', 'out', 3000),
      movement('2026-05-20', 'in', 5000),
      movement('2026-05-22', 'out', 2000),
    ];
    const series = buildMonthlyCashFlowSeries({
      postedMovements: movs,
      referenceDate: asOf,
      monthsCount: 3,
      startingBalance: 0,
    });
    const may = series.find((s) => s.key === '2026-05');
    const jun = series.find((s) => s.key === '2026-06');
    expect(may.inflows).toBe(5000);
    expect(may.outflows).toBe(2000);
    expect(may.net).toBe(3000);
    expect(jun.inflows).toBe(10000);
    expect(jun.outflows).toBe(3000);
    expect(jun.net).toBe(7000);
  });

  it('walks running balance forward from startingBalance', () => {
    const movs = [
      movement('2026-05-20', 'in', 5000),
      movement('2026-06-05', 'in', 10000),
      movement('2026-06-12', 'out', 3000),
    ];
    const series = buildMonthlyCashFlowSeries({
      postedMovements: movs,
      referenceDate: asOf,
      monthsCount: 3,
      startingBalance: 1000,
    });
    const apr = series.find((s) => s.key === '2026-04');
    const may = series.find((s) => s.key === '2026-05');
    const jun = series.find((s) => s.key === '2026-06');
    expect(apr.balance).toBe(1000);
    expect(may.balance).toBe(6000); // 1000 + 5000
    expect(jun.balance).toBe(13000); // 6000 + 10000 - 3000
  });

  it('skips movements outside the window', () => {
    const movs = [
      movement('2025-06-01', 'in', 99999), // before window
      movement('2026-07-01', 'in', 99999), // after window (future)
      movement('2026-06-05', 'in', 1000), // in window
    ];
    const series = buildMonthlyCashFlowSeries({
      postedMovements: movs,
      referenceDate: asOf,
      monthsCount: 12,
      startingBalance: 0,
    });
    const totalInflows = series.reduce((sum, s) => sum + s.inflows, 0);
    expect(totalInflows).toBe(1000);
  });

  it('handles empty movements (all buckets zero inflow/outflow, balance = starting)', () => {
    const series = buildMonthlyCashFlowSeries({
      postedMovements: [],
      referenceDate: asOf,
      monthsCount: 6,
      startingBalance: 2000,
    });
    expect(series).toHaveLength(6);
    series.forEach((bucket) => {
      expect(bucket.inflows).toBe(0);
      expect(bucket.outflows).toBe(0);
      expect(bucket.net).toBe(0);
      expect(bucket.balance).toBe(2000);
    });
  });

  it('labels months in short Spanish form', () => {
    const series = buildMonthlyCashFlowSeries({
      postedMovements: [],
      referenceDate: asOf,
      monthsCount: 3,
      startingBalance: 0,
    });
    expect(series[2].label).toMatch(/jun/);
    expect(series[2].label).toMatch(/26/);
  });

  it('default monthsCount is 12 and default referenceDate is now', () => {
    const series = buildMonthlyCashFlowSeries({ postedMovements: [], startingBalance: 0 });
    expect(series).toHaveLength(12);
  });
});

// ── internal helpers exposed for parity testing ─────────────────────────────
describe('__internal', () => {
  it('round2 matches runway.js rounding semantics (incl. IEEE-754 ties)', () => {
    // Same Math.round((n*100))/100 used by runway.js — binary float ties land
    // wherever the IEEE-754 representation falls. These assert the real result.
    expect(__internal.round2(10.005)).toBe(10.01);
    expect(__internal.round2(1.005)).toBe(1); // 1.005 is stored just below the tie
    expect(__internal.round2(NaN)).toBe(0);
    expect(__internal.round2(-2.345)).toBe(-2.35);
  });

  it('toIso normalizes Date and string inputs to YYYY-MM-DD', () => {
    expect(__internal.toIso('2026-06-06T12:00:00Z')).toBe('2026-06-06');
    expect(__internal.toIso(new Date('2026-06-06T00:00:00Z'))).toBe('2026-06-06');
    expect(__internal.toIso(null)).toBe(null);
  });

  it('WEEKS_PER_MONTH constant is the canonical 4.345', () => {
    expect(__internal.WEEKS_PER_MONTH).toBe(4.345);
  });
});
