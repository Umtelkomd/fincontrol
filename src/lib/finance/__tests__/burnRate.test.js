import { describe, expect, it } from 'vitest';
import { computeBurn, computeRunway } from '../burnRate.js';

const mv = (postedDate, direction, amount, extra = {}) => ({
  postedDate,
  direction,
  amount,
  status: 'posted',
  ...extra,
});

// ─── computeBurn — signed flows over a trailing calendar-month window ─────────

describe('computeBurn', () => {
  it('sums signed flows inside (today - windowMonths, today]', () => {
    const result = computeBurn({
      movements: [
        mv('2026-04-09', 'in', 77777), // exactly on the window start → excluded
        mv('2026-04-10', 'in', 2000),
        mv('2026-06-15', 'in', 1000),
        mv('2026-07-01', 'out', 1000),
        mv('2026-07-09', 'out', 0), // on today → included (contributes 0)
        mv('2026-07-10', 'out', 55555), // after today → excluded
      ],
      today: '2026-07-09',
    });
    expect(result.totalIn).toBe(3000);
    expect(result.totalOut).toBe(-1000);
    expect(result.net).toBe(2000);
    expect(result.days).toBe(91); // 2026-04-09 → 2026-07-09
    expect(result.perDay).toBeCloseTo(2000 / 91, 6);
    expect(result.perMonth).toBeCloseTo(2000 / 3, 6);
  });

  it('excludes internal transfers by default and includes them on request', () => {
    const movements = [
      mv('2026-06-01', 'in', 500),
      mv('2026-06-10', 'out', 5000, { kind: 'transfer' }),
      mv('2026-06-10', 'in', 5000, { description: 'Umbuchung Tagesgeld' }),
    ];
    const excluded = computeBurn({ movements, today: '2026-07-09' });
    expect(excluded.totalIn).toBe(500);
    expect(excluded.totalOut).toBe(0);

    const included = computeBurn({ movements, today: '2026-07-09', excludeInternal: false });
    expect(included.totalIn).toBe(5500);
    expect(included.totalOut).toBe(-5000);
  });

  it('respects a nonzero signedAmount over the direction field', () => {
    const result = computeBurn({
      movements: [mv('2026-06-01', 'in', 250.5, { signedAmount: -250.5 })],
      today: '2026-07-09',
    });
    expect(result.totalOut).toBe(-250.5);
    expect(result.totalIn).toBe(0);
  });

  it('supports a custom window length and clamps month-end starts', () => {
    const result = computeBurn({
      movements: [mv('2026-03-01', 'out', 300), mv('2026-02-28', 'out', 999)],
      today: '2026-05-31',
      windowMonths: 3,
    });
    // Window start = 2026-05-31 minus 3 months → 2026-02-28 (clamped, exclusive).
    expect(result.totalOut).toBe(-300);
  });

  it('returns zeros (never NaN) for an empty window', () => {
    const result = computeBurn({ movements: [], today: '2026-07-09' });
    expect(result).toMatchObject({ totalIn: 0, totalOut: 0, net: 0, perDay: 0, perMonth: 0 });
  });
});

// ─── computeRunway — months of cash left against balance + credit ─────────────

describe('computeRunway', () => {
  it('divides available cash by the monthly burn', () => {
    const result = computeRunway({ balance: 30000, creditAvailable: 0, burnPerMonth: -10000 });
    expect(result.months).toBeCloseTo(3, 6);
    expect(result.weeks).toBeCloseTo((3 * 30.4375) / 7, 6);
    expect(result.isInfinite).toBe(false);
  });

  it('extends the runway with available credit', () => {
    const result = computeRunway({ balance: 10000, creditAvailable: 20000, burnPerMonth: -10000 });
    expect(result.months).toBeCloseTo(3, 6);
  });

  it('projects the zero-cash date when today is provided', () => {
    const result = computeRunway({
      balance: 30000,
      creditAvailable: 0,
      burnPerMonth: -10000,
      today: '2026-07-09',
    });
    expect(result.zeroDate).toBe('2026-10-08'); // today + floor(3 * 30.4375) days
  });

  it('omits the zero date when today is not provided', () => {
    const result = computeRunway({ balance: 30000, creditAvailable: 0, burnPerMonth: -10000 });
    expect(result.zeroDate).toBeNull();
  });

  it('is infinite when the net burn is zero or positive', () => {
    expect(computeRunway({ balance: 100, creditAvailable: 0, burnPerMonth: 5000 })).toEqual({
      months: Infinity,
      weeks: Infinity,
      zeroDate: null,
      isInfinite: true,
    });
    expect(computeRunway({ balance: 100, creditAvailable: 0, burnPerMonth: 0 }).isInfinite).toBe(true);
  });

  it('reports zero runway when cash plus credit is already exhausted', () => {
    const result = computeRunway({
      balance: -50000,
      creditAvailable: 40000,
      burnPerMonth: -1000,
      today: '2026-07-09',
    });
    expect(result.months).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.zeroDate).toBe('2026-07-09');
    expect(result.isInfinite).toBe(false);
  });

  it('treats missing creditAvailable as 0', () => {
    expect(computeRunway({ balance: 10000, burnPerMonth: -10000 }).months).toBeCloseTo(1, 6);
  });
});
