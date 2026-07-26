import { describe, expect, it } from 'vitest';
import { buildAgingBuckets } from './useTreasuryMetrics.js';

const REFERENCE = '2026-07-09';

const row = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'ACME GmbH',
  ...extra,
});

describe('buildAgingBuckets — treasury aging delegates to the single engine', () => {
  it('charts the four overdue tranches, oldest last', () => {
    const buckets = buildAgingBuckets(
      [
        row('2026-07-08', 120), // 1 day late
        row('2026-06-09', 130), // 30 days late
        row('2026-06-08', 140), // 31 days late
        row('2026-05-09', 160), // 61 days late
        row('2026-04-09', 180), // 91 days late
      ],
      REFERENCE,
    );

    expect(buckets.map((b) => b.label)).toEqual(['0-30d', '31-60d', '61-90d', '>90d']);
    expect(buckets.map((b) => b.amount)).toEqual([250, 140, 160, 180]);
    expect(buckets.map((b) => b.count)).toEqual([2, 1, 1, 1]);
  });

  it('keeps not-yet-due documents out of the first tranche', () => {
    const buckets = buildAgingBuckets(
      [row('2026-07-09', 100), row('2026-08-01', 200), row('2026-07-08', 50)],
      REFERENCE,
    );
    expect(buckets[0].amount).toBe(50);
    expect(buckets.reduce((sum, b) => sum + b.amount, 0)).toBe(50);
  });

  it('ignores documents without a due date', () => {
    const buckets = buildAgingBuckets([row(null, 900), row(undefined, 800)], REFERENCE);
    expect(buckets.every((b) => b.amount === 0)).toBe(true);
  });

  it('never emits NaN for rows with a missing or dust open amount', () => {
    const buckets = buildAgingBuckets(
      [row('2026-06-08', undefined), row('2026-06-08', 0.004), row('2026-06-08', 25)],
      REFERENCE,
    );
    expect(buckets[1].amount).toBe(25);
    expect(buckets.every((b) => Number.isFinite(b.amount))).toBe(true);
  });

  it('accepts a Date reference like the hook passes it', () => {
    const buckets = buildAgingBuckets([row('2026-06-08', 140)], new Date(2026, 6, 9));
    expect(buckets[1].amount).toBe(140);
  });

  it('rounds tranche totals to cents', () => {
    const buckets = buildAgingBuckets(
      [row('2026-07-08', 10.005), row('2026-07-08', 20.001)],
      REFERENCE,
    );
    expect(buckets[0].amount).toBe(30.01);
  });
});
