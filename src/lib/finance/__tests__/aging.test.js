import { describe, expect, it } from 'vitest';
import { agingBuckets } from '../aging.js';

const doc = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'open',
  counterpartyName: 'ACME GmbH',
  ...extra,
});

const TODAY = '2026-07-09';

// ─── bucket boundaries — due today is current; 30/31, 60/61, 90/91 edges ──────

describe('agingBuckets boundaries', () => {
  const report = agingBuckets({
    docs: [
      doc('2026-07-09', 100), // due today → current
      doc('2026-07-20', 110), // not yet due → current
      doc('2026-07-08', 120), // 1 day overdue
      doc('2026-06-09', 130), // 30 days overdue
      doc('2026-06-08', 140), // 31 days overdue
      doc('2026-05-10', 150), // 60 days overdue
      doc('2026-05-09', 160), // 61 days overdue
      doc('2026-04-10', 170), // 90 days overdue
      doc('2026-04-09', 180), // 91 days overdue
    ],
    today: TODAY,
  });

  it('keeps documents due today or later in current', () => {
    expect(report.current.count).toBe(2);
    expect(report.current.amount).toBe(210);
  });

  it('puts 1–30 days overdue in d1_30', () => {
    expect(report.d1_30.items.map((i) => i.daysOverdue)).toEqual([30, 1]);
    expect(report.d1_30.amount).toBe(250);
  });

  it('puts 31–60 days overdue in d31_60', () => {
    expect(report.d31_60.items.map((i) => i.daysOverdue)).toEqual([60, 31]);
  });

  it('puts 61–90 days overdue in d61_90', () => {
    expect(report.d61_90.items.map((i) => i.daysOverdue)).toEqual([90, 61]);
  });

  it('puts 91+ days overdue in d90plus', () => {
    expect(report.d90plus.items.map((i) => i.daysOverdue)).toEqual([91]);
    expect(report.d90plus.amount).toBe(180);
  });

  it('sorts items oldest-first inside each bucket', () => {
    expect(report.d1_30.items.map((i) => i.dueDate)).toEqual(['2026-06-09', '2026-07-08']);
  });

  it('aggregates totals across buckets', () => {
    expect(report.totals.open).toBe(100 + 110 + 120 + 130 + 140 + 150 + 160 + 170 + 180);
    expect(report.totals.overdue).toBe(120 + 130 + 140 + 150 + 160 + 170 + 180);
    expect(report.totals.overdueCount).toBe(7);
  });
});

// ─── filtering and overrides ───────────────────────────────────────────────────

describe('agingBuckets filtering', () => {
  it('drops settled documents and floating dust', () => {
    const report = agingBuckets({
      docs: [doc('2026-06-01', 0), doc('2026-06-01', 0.003), doc('2026-06-01', 50)],
      today: TODAY,
    });
    expect(report.d31_60.count).toBe(1);
    expect(report.totals.open).toBe(50);
  });

  it('treats documents without a due date as current (cannot be overdue)', () => {
    const report = agingBuckets({ docs: [doc(undefined, 75)], today: TODAY });
    expect(report.current.count).toBe(1);
    expect(report.current.items[0].daysOverdue).toBe(0);
  });

  it('accepts a custom openAmountOf reader', () => {
    const report = agingBuckets({
      docs: [{ dueDate: '2026-06-01', pendingAmount: 42 }],
      today: TODAY,
      openAmountOf: (row) => row.pendingAmount ?? 0,
    });
    expect(report.d31_60.amount).toBe(42);
  });

  it('exposes the original doc on each item', () => {
    const source = doc('2026-05-01', 10, { invoiceNumber: 'RE-77' });
    const report = agingBuckets({ docs: [source], today: TODAY });
    expect(report.d61_90.items[0].doc).toBe(source);
    expect(report.d61_90.items[0].openAmount).toBe(10);
  });

  it('returns an all-empty report for no docs', () => {
    const report = agingBuckets({ docs: [], today: TODAY });
    for (const key of ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus']) {
      expect(report[key]).toEqual({ amount: 0, count: 0, items: [] });
    }
    expect(report.totals).toEqual({ open: 0, overdue: 0, overdueCount: 0 });
  });
});
