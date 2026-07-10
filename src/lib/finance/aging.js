/**
 * Aging buckets for receivables and payables (same shape, same math).
 *
 * Bucket rule against `today`:
 *   current  → due today or later (or no due date — cannot be overdue)
 *   d1_30    → 1–30 days overdue
 *   d31_60   → 31–60 days overdue
 *   d61_90   → 61–90 days overdue
 *   d90plus  → 91+ days overdue
 *
 * Only documents with real open money (openAmount above the dust epsilon)
 * participate. Amounts are raw sums — round at the presentation boundary.
 *
 * @typedef {Object} AgingItem
 * @property {Object} doc - the original document
 * @property {string|null} dueDate
 * @property {number} openAmount
 * @property {number} daysOverdue - 0 when not overdue
 *
 * @typedef {Object} AgingBucket
 * @property {number} amount
 * @property {number} count
 * @property {AgingItem[]} items - sorted oldest due date first
 *
 * @typedef {Object} AgingReport
 * @property {AgingBucket} current
 * @property {AgingBucket} d1_30
 * @property {AgingBucket} d31_60
 * @property {AgingBucket} d61_90
 * @property {AgingBucket} d90plus
 * @property {{ open: number, overdue: number, overdueCount: number }} totals
 */

import { diffDays, isIsoDate } from './dates.js';
import { isOpenAmount, openAmountOf as defaultOpenAmountOf } from './money.js';

const BUCKET_KEYS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'];

const bucketKeyFor = (daysOverdue) => {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90plus';
};

/**
 * Build the aging report for a set of receivable or payable docs.
 *
 * @param {{
 *   docs: Object[],
 *   today: string,
 *   openAmountOf?: (doc: Object) => number,
 * }} params
 * @returns {AgingReport}
 */
export const agingBuckets = ({ docs, today, openAmountOf = defaultOpenAmountOf }) => {
  const report = {};
  for (const key of BUCKET_KEYS) report[key] = { amount: 0, count: 0, items: [] };
  const totals = { open: 0, overdue: 0, overdueCount: 0 };

  for (const doc of docs || []) {
    const openAmount = openAmountOf(doc);
    if (!isOpenAmount(openAmount)) continue;

    const dueDate = isIsoDate(doc?.dueDate) ? doc.dueDate : null;
    const daysOverdue = dueDate ? Math.max(0, diffDays(dueDate, today)) : 0;
    const bucket = report[bucketKeyFor(daysOverdue)];
    bucket.items.push({ doc, dueDate, openAmount, daysOverdue });
    bucket.amount += openAmount;
    bucket.count += 1;

    totals.open += openAmount;
    if (daysOverdue > 0) {
      totals.overdue += openAmount;
      totals.overdueCount += 1;
    }
  }

  for (const key of BUCKET_KEYS) {
    // Oldest first; docs without a due date (current bucket only) sort last.
    report[key].items.sort((a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
    );
  }

  return { ...report, totals };
};
