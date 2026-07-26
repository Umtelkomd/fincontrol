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

/**
 * Overdue buckets, oldest-debt last. Screens that only chart late money
 * (CXC/CXP, treasury) iterate exactly these.
 * @type {ReadonlyArray<string>}
 */
export const OVERDUE_BUCKET_KEYS = ['d1_30', 'd31_60', 'd61_90', 'd90plus'];

/**
 * Every bucket of an aging report, `current` first.
 * @type {ReadonlyArray<string>}
 */
export const AGING_BUCKET_KEYS = ['current', ...OVERDUE_BUCKET_KEYS];

const BUCKET_KEYS = AGING_BUCKET_KEYS;

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

/**
 * Flatten an aging report into the ordered bucket list charts and tables read.
 *
 * This is the ONLY place a screen may narrow the report: pass
 * `includeCurrent: true` when not-yet-due money belongs in the view, leave it
 * off for the overdue-only tranches. Screens must never re-bucket documents
 * themselves — that is how the same invoice ended up in different tranches on
 * different pages.
 *
 * @param {AgingReport|null|undefined} report
 * @param {{ includeCurrent?: boolean }} [options]
 * @returns {Array<{ key: string, amount: number, count: number, items: AgingItem[] }>}
 */
export const agingBucketList = (report, { includeCurrent = false } = {}) =>
  (includeCurrent ? AGING_BUCKET_KEYS : OVERDUE_BUCKET_KEYS).map((key) => ({
    key,
    amount: report?.[key]?.amount ?? 0,
    count: report?.[key]?.count ?? 0,
    items: report?.[key]?.items ?? [],
  }));
