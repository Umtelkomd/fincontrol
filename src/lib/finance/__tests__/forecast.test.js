import { describe, expect, it } from 'vitest';
import { forecastWeeks } from '../forecast.js';

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

  it('rejects unknown scenarios', () => {
    expect(() => run({ scenario: 'optimistic' })).toThrow(TypeError);
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

// ─── expected scenario — recurring monthly obligations extrapolated ───────────

describe('forecastWeeks expected scenario', () => {
  const baseObligations = [
    obligation('2026-07-10', 'wage-tax', 3500, '2026-06'),
    obligation('2026-07-10', 'vat', 13269.06, '2026-05'),
    obligation('2026-07-29', 'social', 14000, '2026-07'),
    obligation('2026-07-31', 'payroll-net', 22000, '2026-07'),
  ];

  const itemsOf = (weeksArr) => weeksArr.flatMap((w) => w.items);

  it('matches committed when no recurrence is requested (default scenario)', () => {
    const committed = run({ obligations: baseObligations });
    expect(itemsOf(committed)).toHaveLength(4);
  });

  it('repeats each recurring kind monthly until the horizon end', () => {
    const expected = run({ obligations: baseObligations, scenario: 'expected' });
    const items = itemsOf(expected);
    // Synthesized within 13 weeks (ends 2026-10-04):
    //   social: 2026-08-27, 2026-09-28  · payroll-net: 2026-08-31, 2026-09-30
    //   wage-tax: 2026-08-10, 2026-09-10 · vat: 2026-08-10, 2026-09-10
    expect(items).toHaveLength(12);

    const socials = items.filter((i) => i.kind === 'social').map((i) => i.date);
    expect(socials).toEqual(['2026-07-29', '2026-08-27', '2026-09-28']);

    const synthesized = items.find((i) => i.kind === 'social' && i.date === '2026-08-27');
    expect(synthesized.amount).toBe(-14000); // repeats the latest instance's amount
    expect(synthesized.source).toBe('recurring-estimate');
  });

  it('extrapolates nothing when the obligations input is empty', () => {
    const expected = run({ scenario: 'expected' });
    expect(itemsOf(expected)).toHaveLength(0);
  });
});
