import { describe, expect, it } from 'vitest';

import {
  AGING_BUCKET_LABELS,
  buildAgingView,
  toAgingChartBuckets,
} from './agingView';

const doc = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'issued',
  counterpartyName: 'ACME GmbH',
  ...extra,
});

const TODAY = '2026-07-09';

const DOCS = [
  doc('2026-07-20', 110), // not yet due  → current
  doc('2026-07-08', 120), // 1 day late   → d1_30
  doc('2026-06-08', 140), // 31 days late → d31_60
  doc('2026-05-09', 160), // 61 days late → d61_90
  doc('2026-04-09', 180), // 91 days late → d90plus
];

describe('buildAgingView', () => {
  it('returns the canonical report plus overdue-only chart buckets', () => {
    const { report, buckets } = buildAgingView({ docs: DOCS, today: TODAY });

    expect(report.totals.open).toBe(710);
    expect(report.totals.overdue).toBe(600);
    expect(buckets.map((b) => b.label)).toEqual(['0-30d', '31-60d', '61-90d', '>90d']);
    expect(buckets.map((b) => b.amount)).toEqual([120, 140, 160, 180]);
  });

  it('includes the current tranche on demand', () => {
    const { buckets } = buildAgingView({ docs: DOCS, today: TODAY, includeCurrent: true });
    expect(buckets).toHaveLength(5);
    expect(buckets[0]).toMatchObject({ key: 'current', label: 'Al día', amount: 110, count: 1 });
  });

  it('accepts a Date reference and normalizes it to a local ISO day', () => {
    const { buckets } = buildAgingView({ docs: DOCS, today: new Date(2026, 6, 9) });
    expect(buckets.map((b) => b.amount)).toEqual([120, 140, 160, 180]);
  });

  it('excludes documents whose open amount is dust or missing', () => {
    const { report, buckets } = buildAgingView({
      docs: [doc('2026-06-08', 0), doc('2026-06-08', 0.004), doc('2026-06-08', undefined)],
      today: TODAY,
    });
    expect(report.totals.open).toBe(0);
    expect(buckets.every((b) => b.amount === 0 && b.count === 0)).toBe(true);
  });

  it('keeps documents without a due date out of every overdue tranche', () => {
    const { buckets } = buildAgingView({ docs: [doc(null, 500)], today: TODAY });
    expect(buckets.reduce((sum, b) => sum + b.amount, 0)).toBe(0);
  });

  it('rounds amounts at the presentation boundary', () => {
    const { buckets } = buildAgingView({
      docs: [doc('2026-06-08', 10.005), doc('2026-06-08', 20.001)],
      today: TODAY,
    });
    expect(buckets[1].amount).toBe(30.01);
  });

  it('tolerates a missing docs array', () => {
    const { buckets } = buildAgingView({ docs: undefined, today: TODAY });
    expect(buckets.map((b) => b.amount)).toEqual([0, 0, 0, 0]);
  });
});

describe('toAgingChartBuckets', () => {
  it('labels every bucket key', () => {
    const { report } = buildAgingView({ docs: DOCS, today: TODAY });
    const labels = toAgingChartBuckets(report, { includeCurrent: true }).map((b) => b.label);
    expect(labels).toEqual(Object.values(AGING_BUCKET_LABELS));
  });

  it('carries the underlying items so tables and charts share one dataset', () => {
    const { report } = buildAgingView({ docs: DOCS, today: TODAY });
    const [first] = toAgingChartBuckets(report);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].daysOverdue).toBe(1);
  });
});
