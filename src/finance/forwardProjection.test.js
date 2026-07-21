import { describe, expect, it } from 'vitest';
import { buildForwardProjection } from './forwardProjection';

const TODAY = '2026-07-10';

const receivable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'Cliente',
  ...extra,
});

const payable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'Proveedor',
  ...extra,
});

describe('buildForwardProjection — documents and balance walk', () => {
  it('projects open documents onto the daily series from the starting balance', () => {
    const result = buildForwardProjection({
      startingBalance: 6227.11,
      today: TODAY,
      horizonDays: 90,
      receivables: [receivable('2026-07-15', 1000)],
      payables: [payable('2026-07-12', 500)],
    });

    expect(result.series).toHaveLength(91);
    expect(result.series[0].date).toBe('2026-07-10');
    expect(result.series[0].balance).toBeCloseTo(6227.11, 2);

    const day12 = result.series.find((d) => d.date === '2026-07-12');
    expect(day12.outflow).toBe(500);
    expect(day12.balance).toBeCloseTo(5727.11, 2);

    const day15 = result.series.find((d) => d.date === '2026-07-15');
    expect(day15.inflow).toBe(1000);
    expect(day15.balance).toBeCloseTo(6727.11, 2);

    expect(result.totalInflows).toBe(1000);
    expect(result.totalOutflows).toBe(500);
    expect(result.projectedEndBalance).toBeCloseTo(6727.11, 2);
    expect(result.firstNegativeDay).toBeUndefined();
  });

  it('skips settled/cancelled documents and documents outside the horizon', () => {
    const result = buildForwardProjection({
      startingBalance: 0,
      today: TODAY,
      horizonDays: 30,
      receivables: [
        receivable('2026-07-15', 100, { status: 'settled' }),
        receivable('2027-01-01', 100),
      ],
      payables: [payable('2026-07-15', 100, { status: 'cancelled' })],
    });

    expect(result.totalInflows).toBe(0);
    expect(result.totalOutflows).toBe(0);
  });

  it('detects the first negative day', () => {
    const result = buildForwardProjection({
      startingBalance: 100,
      today: TODAY,
      horizonDays: 30,
      payables: [payable('2026-07-12', 500)],
    });

    expect(result.firstNegativeDay.date).toBe('2026-07-12');
    expect(result.firstNegativeDay.balance).toBeCloseTo(-400, 2);
  });
});

describe('buildForwardProjection — recurring costs', () => {
  const rule = {
    id: 'r1',
    active: true,
    frequency: 'monthly',
    dayOfMonth: 25,
    amount: 300,
    concept: 'Alquiler',
    ownerName: 'Oficina',
  };

  it('expands active rules month by month inside the horizon', () => {
    const result = buildForwardProjection({
      startingBalance: 0,
      today: TODAY,
      horizonDays: 90, // ends 2026-10-08 → Jul/Aug/Sep instances
      recurringCosts: [rule],
    });

    expect(result.outflowsRecurring.map((o) => o.date)).toEqual([
      '2026-07-25',
      '2026-08-25',
      '2026-09-25',
    ]);
    expect(result.totalOutflows).toBe(900);
  });

  it('dedupes rules against already-materialized payables', () => {
    const result = buildForwardProjection({
      startingBalance: 0,
      today: TODAY,
      horizonDays: 90,
      recurringCosts: [rule],
      payables: [
        payable('2026-07-25', 300, { recurringCostId: 'r1', recurringPeriod: '2026-07' }),
      ],
    });

    // July comes from the payable; the rule only fills Aug + Sep.
    expect(result.outflowsRecurring.map((o) => o.date)).toEqual(['2026-08-25', '2026-09-25']);
    expect(result.totalOutflows).toBe(900); // 300 payable + 600 recurring
  });

  it('ignores inactive rules', () => {
    const result = buildForwardProjection({
      startingBalance: 0,
      today: TODAY,
      horizonDays: 90,
      recurringCosts: [{ ...rule, active: false }],
    });
    expect(result.outflowsRecurring).toEqual([]);
  });
});

describe('buildForwardProjection — fiscal obligations merge', () => {
  const obligations = [
    { date: '2026-07-10', kind: 'vat', label: 'IVA 2026-05', amount: 3000, estimated: true },
    { date: '2026-07-29', kind: 'social', label: 'Seguridad social 2026-07', amount: 2000, estimated: true },
    { date: '2026-07-01', kind: 'wage-tax', label: 'Lohnsteuer 2026-05', amount: 100, estimated: true },
    { date: '2026-12-10', kind: 'vat', label: 'IVA 2026-10', amount: 4000, estimated: true },
    { date: '2026-07-20', kind: 'payable', label: 'Proveedor', amount: 999, estimated: false },
  ];

  it('adds non-payable obligations as outflows on their due dates', () => {
    const result = buildForwardProjection({
      startingBalance: 6227.11,
      today: TODAY,
      horizonDays: 90,
      obligations,
    });

    // 'payable' kind ignored (open payables arrive separately) and the
    // December VAT falls outside the horizon.
    expect(result.outflowsObligations).toHaveLength(3);

    // Overdue estimate clamps to today — money expected to leave immediately.
    const day0 = result.series[0];
    expect(day0.outflow).toBe(3100); // 3000 VAT + 100 overdue wage tax
    expect(day0.balance).toBeCloseTo(6227.11 - 3100, 2);

    const day29 = result.series.find((d) => d.date === '2026-07-29');
    expect(day29.outflow).toBe(2000);

    expect(result.totalOutflows).toBe(5100);
    expect(result.projectedEndBalance).toBeCloseTo(1127.11, 2);
  });

  it('skips zero-amount obligation landmarks', () => {
    const result = buildForwardProjection({
      startingBalance: 0,
      today: TODAY,
      horizonDays: 30,
      obligations: [{ date: '2026-07-15', kind: 'payroll-net', label: 'Nómina 2026-07', amount: 0 }],
    });
    expect(result.outflowsObligations).toEqual([]);
  });

  it('keeps working with no obligations at all (legacy call shape)', () => {
    const result = buildForwardProjection({
      startingBalance: 50,
      today: TODAY,
      horizonDays: 30,
    });
    expect(result.outflowsObligations).toEqual([]);
    expect(result.projectedEndBalance).toBe(50);
  });
});
