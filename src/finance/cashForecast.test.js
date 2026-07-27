import { describe, expect, it } from 'vitest';
import { COLLECTION_SLIP_DAYS } from '../lib/finance';
import { buildCashForecast } from './cashForecast';

const TODAY = '2026-07-09'; // Thursday → week 1 = 2026-07-06 … 2026-07-12

const receivable = (dueDate, openAmount, extra = {}) => ({
  id: `r-${dueDate}-${openAmount}`,
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'Client A',
  ...extra,
});

const payable = (dueDate, openAmount, extra = {}) => ({
  id: `p-${dueDate}-${openAmount}`,
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'Vendor B',
  ...extra,
});

const rule = (extra = {}) => ({
  id: 'rule-rent',
  active: true,
  frequency: 'monthly',
  dayOfMonth: 15,
  amount: 900,
  concept: 'Oficina',
  ownerName: 'Arrendador',
  ...extra,
});

const run = (overrides = {}) =>
  buildCashForecast({
    startBalance: 10000,
    today: TODAY,
    receivables: [],
    payables: [],
    recurringCosts: [],
    payrollPeriods: [],
    vatEstimates: [],
    ...overrides,
  });

// ─── shape: 13 Monday weeks decorated for presentation ────────────────────────

describe('buildCashForecast shape', () => {
  it('returns 13 decorated Monday weeks by default', () => {
    const { weeks } = run();
    expect(weeks).toHaveLength(13);
    expect(weeks[0]).toMatchObject({
      week: 'W1',
      weekStart: '2026-07-06',
      weekEnd: '2026-07-12',
      label: '06 jul - 12 jul',
    });
    expect(weeks[12]).toMatchObject({ week: 'W13', weekStart: '2026-09-28' });
  });

  it('carries the injected start balance as day zero', () => {
    const forecast = run({ startBalance: 4321.5 });
    expect(forecast.startBalance).toBe(4321.5);
    expect(forecast.weeks[0].projectedBalance).toBe(4321.5);
    expect(forecast.endBalance).toBe(4321.5);
  });

  it('reports the horizon and the slip assumption it used', () => {
    const forecast = run();
    expect(forecast.horizonWeeks).toBe(13);
    expect(forecast.collectionSlipDays).toBe(COLLECTION_SLIP_DAYS);
  });
});

// ─── the business's real obligations must all be in the outflows ──────────────

describe('buildCashForecast obligation coverage', () => {
  it('includes recurring costs as outflows', () => {
    const forecast = run({ recurringCosts: [rule()] });
    const recurring = forecast.obligations.filter((item) => item.kind === 'recurring');
    // 2026-07-15, 2026-08-15, 2026-09-15 all fall inside the 13-week horizon.
    expect(recurring.map((item) => item.date)).toEqual(['2026-07-15', '2026-08-15', '2026-09-15']);
    expect(forecast.totalOutflow).toBeCloseTo(-2700, 2);
  });

  it('drops a recurring cost whose payable was already materialized', () => {
    const forecast = run({
      recurringCosts: [rule()],
      payables: [
        payable('2026-07-15', 900, { recurringCostId: 'rule-rent', recurringPeriod: '2026-07' }),
      ],
    });
    const recurring = forecast.obligations.filter((item) => item.kind === 'recurring');
    expect(recurring.map((item) => item.date)).toEqual(['2026-08-15', '2026-09-15']);
    // The July charge is counted exactly once — as the open payable.
    expect(forecast.totalOutflow).toBeCloseTo(-2700, 2);
  });

  it('reads the recurring markers off an adapted ledger payable (raw passthrough)', () => {
    const forecast = run({
      recurringCosts: [rule()],
      payables: [
        payable('2026-07-15', 900, {
          raw: { recurringCostId: 'rule-rent', recurringPeriod: '2026-07' },
        }),
      ],
    });
    expect(forecast.obligations.filter((item) => item.kind === 'recurring')).toHaveLength(2);
  });

  it('includes payroll and wage-tax estimates from payroll history', () => {
    const forecast = run({
      payrollPeriods: [
        { period: '2026-06', netWagesTotal: 22000, socialTotal: 14000, taxTotal: 3500 },
      ],
    });
    const kinds = new Set(forecast.obligations.map((item) => item.kind));
    expect(kinds.has('payroll-net')).toBe(true);
    expect(kinds.has('social')).toBe(true);
    expect(kinds.has('wage-tax')).toBe(true);
    expect(forecast.totalOutflow).toBeLessThan(0);
  });

  it('includes configured VAT estimates', () => {
    const forecast = run({ vatEstimates: [{ month: '2026-05', amount: 13269.06 }] });
    const vat = forecast.obligations.filter((item) => item.kind === 'vat');
    expect(vat).toHaveLength(1);
    expect(vat[0].amount).toBeCloseTo(13269.06, 2);
    expect(forecast.totalOutflow).toBeCloseTo(-13269.06, 2);
  });

  it('never double-counts a payable that also appears in the obligations calendar', () => {
    const forecast = run({ payables: [payable('2026-07-21', 500)] });
    // The calendar lists it as kind 'payable'; the forecast must count it once.
    expect(forecast.obligations.some((item) => item.kind === 'payable')).toBe(true);
    expect(forecast.totalOutflow).toBe(-500);
  });
});

// ─── document hygiene ─────────────────────────────────────────────────────────

describe('buildCashForecast document filtering', () => {
  it('ignores cancelled, settled and dust documents', () => {
    const forecast = run({
      receivables: [
        receivable('2026-07-20', 5000, { status: 'cancelled' }),
        receivable('2026-07-20', 0.004),
      ],
      payables: [
        payable('2026-07-20', 5000, { status: 'settled' }),
        payable('2026-07-20', 5000, { status: 'void' }),
      ],
    });
    expect(forecast.totalInflow).toBe(0);
    expect(forecast.totalOutflow).toBe(0);
  });

  it('keeps overdue documents instead of dropping them', () => {
    const forecast = run({
      receivables: [receivable('2026-05-01', 3000)],
      payables: [payable('2026-04-15', 1000)],
    });
    expect(forecast.weeks[0].inflow).toBe(3000);
    expect(forecast.weeks[0].outflow).toBe(-1000);
  });
});

// ─── derived figures every screen reads ───────────────────────────────────────

describe('buildCashForecast derived figures', () => {
  it('finds the first negative week and the lowest week', () => {
    const forecast = run({
      startBalance: 1000,
      payables: [payable('2026-07-21', 4000), payable('2026-08-11', 1000)],
    });
    expect(forecast.firstNegativeWeek).toMatchObject({
      week: 'W3',
      weekStart: '2026-07-20',
      projectedBalance: -3000,
    });
    expect(forecast.lowestWeek).toMatchObject({ week: 'W6', projectedBalance: -4000 });
    expect(forecast.endBalance).toBe(-4000);
    expect(forecast.weeksToNegative).toBe(2); // W3 is two weeks out
  });

  it('reports zero weeks to negative when cash is already under water this week', () => {
    const forecast = run({ startBalance: 100, payables: [payable('2026-07-01', 500)] });
    expect(forecast.firstNegativeWeek).toMatchObject({ week: 'W1' });
    expect(forecast.weeksToNegative).toBe(0);
  });

  it('returns null markers when cash never dips negative', () => {
    const forecast = run({ receivables: [receivable('2026-07-20', 500)] });
    expect(forecast.firstNegativeWeek).toBeNull();
    expect(forecast.weeksToNegative).toBeNull();
    expect(forecast.lowestWeek).toMatchObject({ week: 'W1', projectedBalance: 10000 });
    expect(forecast.netHorizon).toBe(500);
  });

  it('exposes committed totals per week for the weekly tables', () => {
    const forecast = run({
      receivables: [receivable('2026-07-06', 2000)], // overdue → week 1, no slip
      payables: [payable('2026-07-08', 800)],
    });
    expect(forecast.weeks[0]).toMatchObject({ inflow: 2000, outflow: -800, net: 1200 });
    expect(forecast.totalInflow).toBe(2000);
    expect(forecast.totalOutflow).toBe(-800);
  });
});

// ─── the slip stays a single, overridable assumption ──────────────────────────

/** A fully collected invoice — history, not a projected inflow. */
const collected = (dueDate, amount, paidOn) => ({
  id: `c-${dueDate}-${amount}-${paidOn}`,
  dueDate,
  openAmount: 0,
  paidAmount: amount,
  status: 'settled',
  counterpartyName: 'Client A',
  payments: [{ date: paidOn, amount }],
});

/** `count` invoices collected exactly `delay` days after their due date. */
const collectionHistory = (count, delay, amount = 5000) =>
  Array.from({ length: count }, (_, index) => {
    const due = `2026-03-${String(index + 1).padStart(2, '0')}`;
    const paid = `2026-03-${String(index + 1).padStart(2, '0')}`;
    // Keep the arithmetic obvious: same month, delay added to the day number.
    return collected(due, amount, paid.replace(/-\d{2}$/, `-${String(index + 1 + delay).padStart(2, '0')}`));
  });

describe('buildCashForecast collection slip', () => {
  it('falls back to COLLECTION_SLIP_DAYS when there is no collection history', () => {
    const forecast = run({ receivables: [receivable('2026-07-10', 1000)] });
    expect(forecast.weeks[1].inflow).toBe(1000); // 2026-07-17
    expect(forecast.weeks[0].inflow).toBe(0);
    expect(forecast.collectionSlipDays).toBe(COLLECTION_SLIP_DAYS);
    expect(forecast.collectionSlip).toEqual({
      slipDays: COLLECTION_SLIP_DAYS,
      sampleSize: 0,
      confidence: 'default',
    });
  });

  it('derives the slip from the settled receivables it was given', () => {
    const forecast = run({
      receivables: [...collectionHistory(12, 21), receivable('2026-07-10', 1000)],
    });
    expect(forecast.collectionSlip).toEqual({
      slipDays: 21,
      sampleSize: 12,
      confidence: 'measured',
    });
    expect(forecast.collectionSlipDays).toBe(21);
    // 2026-07-10 + 21 → 2026-07-31 → week 4, NOT week 2 as the 7-day
    // assumption used to claim.
    expect(forecast.weeks[1].inflow).toBe(0);
    expect(forecast.weeks[3].inflow).toBe(1000);
  });

  it('measures the settled history without projecting it as future cash', () => {
    const forecast = run({ receivables: collectionHistory(12, 21) });
    expect(forecast.collectionSlip.sampleSize).toBe(12);
    expect(forecast.totalInflow).toBe(0);
  });

  it('lets the caller override the slip and says so', () => {
    const forecast = run({
      receivables: [...collectionHistory(12, 21), receivable('2026-07-10', 1000)],
      collectionSlipDays: 0,
    });
    expect(forecast.weeks[0].inflow).toBe(1000);
    expect(forecast.collectionSlipDays).toBe(0);
    expect(forecast.collectionSlip).toEqual({
      slipDays: 0,
      sampleSize: 12,
      confidence: 'override',
    });
  });
});
