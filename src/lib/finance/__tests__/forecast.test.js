import { describe, expect, it } from 'vitest';
import { COLLECTION_SLIP_DAYS, forecastHorizon, forecastWeeks } from '../forecast.js';

const TODAY = '2026-07-09'; // Thursday → week 1 = 2026-07-06 … 2026-07-12

const receivable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'open',
  counterpartyName: 'Client A',
  ...extra,
});

const payable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'open',
  counterpartyName: 'Vendor B',
  ...extra,
});

const obligation = (date, kind, amount, month, extra = {}) => ({
  date,
  kind,
  label: `${kind} ${month || ''}`.trim(),
  amount,
  source: 'payroll-average',
  overdue: false,
  estimated: true,
  month,
  ...extra,
});

const run = (overrides = {}) =>
  forecastWeeks({
    startBalance: 10000,
    today: TODAY,
    receivables: [],
    payables: [],
    obligations: [],
    ...overrides,
  });

// ─── week skeleton — Monday-start weeks anchored on today's week ──────────────

describe('forecastWeeks skeleton', () => {
  it('builds the requested number of Monday-start weeks', () => {
    const result = run();
    expect(result).toHaveLength(13);
    expect(result[0]).toMatchObject({ weekStart: '2026-07-06', weekEnd: '2026-07-12' });
    expect(result[1]).toMatchObject({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
    expect(result[12]).toMatchObject({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
  });

  it('carries the start balance through empty weeks', () => {
    const result = run({ weeks: 3 });
    for (const week of result) {
      expect(week).toMatchObject({ inflow: 0, outflow: 0, net: 0, projectedBalance: 10000 });
    }
  });

});

// ─── horizon geometry — the single source of the week window ──────────────────

describe('forecastHorizon', () => {
  it('spans from the Monday of today\'s week to the last Sunday of the horizon', () => {
    expect(forecastHorizon({ today: TODAY, weeks: 13 })).toEqual({
      firstWeekStart: '2026-07-06',
      horizonEnd: '2026-10-04',
      horizonDays: 87, // 2026-07-09 → 2026-10-04
    });
  });

  it('matches the window forecastWeeks actually builds', () => {
    const horizon = forecastHorizon({ today: TODAY, weeks: 4 });
    const built = forecastWeeks({
      startBalance: 0,
      today: TODAY,
      weeks: 4,
      receivables: [],
      payables: [],
      obligations: [],
    });
    expect(built[0].weekStart).toBe(horizon.firstWeekStart);
    expect(built[built.length - 1].weekEnd).toBe(horizon.horizonEnd);
  });

  it('reports a zero-length horizon on a Monday start with one week', () => {
    expect(forecastHorizon({ today: '2026-07-06', weeks: 1 })).toEqual({
      firstWeekStart: '2026-07-06',
      horizonEnd: '2026-07-12',
      horizonDays: 6,
    });
  });
});

// ─── the collection-slip assumption — ONE named, overridable value ────────────

describe('collection slip assumption', () => {
  it('exposes the slip as a single named constant', () => {
    expect(COLLECTION_SLIP_DAYS).toBe(7);
  });

  it('defaults to COLLECTION_SLIP_DAYS when the caller says nothing', () => {
    const implicit = run({ receivables: [receivable('2026-07-10', 1000)] });
    const explicit = run({
      receivables: [receivable('2026-07-10', 1000)],
      collectionSlipDays: COLLECTION_SLIP_DAYS,
    });
    expect(implicit.map((w) => w.inflow)).toEqual(explicit.map((w) => w.inflow));
    expect(implicit[1].items[0].date).toBe('2026-07-17');
  });

  it('honours an explicit override', () => {
    const onTime = run({
      receivables: [receivable('2026-07-10', 1000)],
      collectionSlipDays: 0,
    });
    expect(onTime[0].inflow).toBe(1000); // no slip → stays in week 1
    expect(onTime[1].inflow).toBe(0);

    const slow = run({
      receivables: [receivable('2026-07-10', 1000)],
      collectionSlipDays: 21,
    });
    expect(slow[3].inflow).toBe(1000); // 2026-07-31 → week 4 (starts 2026-07-27)
  });
});

// ─── committed scenario — open documents in their due weeks ───────────────────

describe('forecastWeeks committed placement', () => {
  it('shifts receivables by the collection slip', () => {
    const result = run({
      receivables: [receivable('2026-07-10', 1000)], // +7 slip → 2026-07-17 → week 2
    });
    expect(result[0].inflow).toBe(0);
    expect(result[1].inflow).toBe(1000);
    expect(result[1].items[0]).toMatchObject({
      date: '2026-07-17',
      kind: 'receivable',
      amount: 1000,
      label: 'Client A',
    });
    expect(result[1].projectedBalance).toBe(11000);
  });

  it('lands overdue receivables and payables in week 1 (no slip applied)', () => {
    const result = run({
      receivables: [receivable('2026-07-01', 800)],
      payables: [payable('2026-06-15', 500)],
    });
    expect(result[0].inflow).toBe(800);
    expect(result[0].outflow).toBe(-500);
    expect(result[0].net).toBe(300);
    expect(result[0].projectedBalance).toBe(10300);
  });

  it('places payables in their due week without slip', () => {
    const result = run({ payables: [payable('2026-07-21', 500)] });
    expect(result[2].outflow).toBe(-500);
    expect(result[2].items[0]).toMatchObject({ date: '2026-07-21', kind: 'payable', amount: -500 });
  });

  it('buckets correctly across month boundaries', () => {
    const result = run({ payables: [payable('2026-08-01', 300)] }); // Saturday
    expect(result[3]).toMatchObject({ weekStart: '2026-07-27', outflow: -300 });
  });

  it('treats documents without a due date as due today', () => {
    const result = run({ receivables: [receivable(undefined, 400)] }); // today + 7 → 2026-07-16
    expect(result[1].inflow).toBe(400);
  });

  it('drops items landing beyond the horizon (including slip pushes)', () => {
    const result = run({
      weeks: 13, // horizon end 2026-10-04
      receivables: [
        receivable('2026-10-20', 999), // due beyond horizon
        receivable('2026-09-29', 888), // +7 slip → 2026-10-06 → beyond horizon
      ],
      payables: [payable('2026-10-05', 777)],
    });
    const totalIn = result.reduce((sum, w) => sum + w.inflow, 0);
    const totalOut = result.reduce((sum, w) => sum + w.outflow, 0);
    expect(totalIn).toBe(0);
    expect(totalOut).toBe(0);
  });

  it('skips dust and settled documents', () => {
    const result = run({
      receivables: [receivable('2026-07-15', 0.004)],
      payables: [payable('2026-07-15', 0)],
    });
    expect(result.every((w) => w.items.length === 0)).toBe(true);
  });

  it('places obligations at their date, sends overdue ones to week 1, and ignores payable-kind duplicates', () => {
    const result = run({
      payables: [payable('2026-07-21', 500)],
      obligations: [
        obligation('2026-07-29', 'social', 14000, '2026-07'),
        obligation('2026-06-30', 'wage-tax', 3500, '2026-05', { overdue: true }), // overdue → week 1
        { date: '2026-07-21', kind: 'payable', label: 'Vendor B', amount: 500, source: 'payables' },
      ],
    });
    expect(result[0].outflow).toBe(-3500);
    expect(result[3].outflow).toBe(-14000); // 2026-07-29 → week 4
    // The payable appears exactly once: obligations of kind 'payable' are ignored.
    expect(result[2].outflow).toBe(-500);
    expect(result[2].items).toHaveLength(1);
  });

  it('keeps a running projected balance across weeks', () => {
    const result = run({
      weeks: 4,
      receivables: [receivable('2026-07-09', 2000)], // due today, not overdue → slip → 2026-07-16 → week 2
      payables: [payable('2026-07-08', 1500)], // overdue → week 1
    });
    expect(result.map((w) => w.projectedBalance)).toEqual([8500, 10500, 10500, 10500]);
  });
});

// ─── every obligation kind the caller supplies reaches the outflows ───────────

describe('forecastWeeks obligation coverage', () => {
  it('places payroll, tax, VAT and recurring-cost obligations as outflows', () => {
    const result = run({
      obligations: [
        obligation('2026-07-10', 'wage-tax', 3500, '2026-06'),
        obligation('2026-07-10', 'vat', 13269.06, '2026-05'),
        obligation('2026-07-29', 'social', 14000, '2026-07'),
        obligation('2026-07-31', 'payroll-net', 22000, '2026-07'),
        obligation('2026-07-15', 'recurring', 900, '2026-07'),
      ],
    });
    const kinds = result.flatMap((week) => week.items).map((item) => item.kind).sort();
    expect(kinds).toEqual(['payroll-net', 'recurring', 'social', 'vat', 'wage-tax']);
    const totalOut = result.reduce((sum, week) => sum + week.outflow, 0);
    expect(totalOut).toBeCloseTo(-53669.06, 2);
  });
});
