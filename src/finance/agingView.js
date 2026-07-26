/**
 * Presentation adapter for the ONE aging engine (`lib/finance/aging.js`).
 *
 * Every screen that charts or tabulates receivable/payable ageing goes through
 * here. The pure engine buckets the documents; this module only labels the
 * buckets and rounds at the presentation boundary. Screens must not re-bucket
 * documents on their own — historically three private implementations existed
 * and disagreed about whether a not-yet-due invoice belongs in the first
 * tranche, so the same invoice appeared in different tranches on CXC, CXP and
 * the CXC/CXP report.
 *
 * Screen-specific views are expressed as options, never as new maths:
 *   includeCurrent: false (default) → the four overdue tranches only
 *   includeCurrent: true            → `Al día` first, then the overdue tranches
 */

import { agingBucketList, agingBuckets, roundEur } from '../lib/finance';
import { toISODate } from './utils';

/**
 * Bucket labels, in report order. `0-30d` is the established chart notation
 * for "1 to 30 days overdue" — a document due today is `Al día`, never `0-30d`.
 * @type {Record<string, string>}
 */
export const AGING_BUCKET_LABELS = {
  current: 'Al día',
  d1_30: '0-30d',
  d31_60: '31-60d',
  d61_90: '61-90d',
  d90plus: '>90d',
};

/**
 * Label + round an aging report for charts and tables.
 *
 * @param {import('../lib/finance/aging.js').AgingReport|null|undefined} report
 * @param {{ includeCurrent?: boolean }} [options]
 * @returns {Array<{ key: string, label: string, amount: number, count: number, items: object[] }>}
 */
export const toAgingChartBuckets = (report, options = {}) =>
  agingBucketList(report, options).map((bucket) => ({
    ...bucket,
    label: AGING_BUCKET_LABELS[bucket.key] || bucket.key,
    amount: roundEur(bucket.amount),
  }));

/**
 * Build both halves a screen needs in one pass: the canonical report (totals,
 * items, per-bucket detail) and the labelled chart buckets.
 *
 * `today` accepts a Date or an ISO string; Dates are read in local time so the
 * boundary day matches what the user sees in the UI.
 *
 * @param {{
 *   docs: object[],
 *   today: string|Date,
 *   includeCurrent?: boolean,
 *   openAmountOf?: (doc: object) => number,
 * }} params
 * @returns {{ report: import('../lib/finance/aging.js').AgingReport, buckets: object[] }}
 */
export const buildAgingView = ({ docs, today, includeCurrent = false, openAmountOf }) => {
  const todayIso = toISODate(today) || toISODate(new Date());
  const report = agingBuckets({
    docs: docs || [],
    today: todayIso,
    ...(openAmountOf ? { openAmountOf } : {}),
  });
  return { report, buckets: toAgingChartBuckets(report, { includeCurrent }) };
};

export default buildAgingView;
