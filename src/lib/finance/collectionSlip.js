/**
 * Collection slip — measured, not assumed.
 *
 * The forecast has to decide WHEN a receivable turns into cash. That is the
 * single modelled assumption in the whole projection (see forecast.js), and it
 * used to be a hardcoded week. This module derives it from what this company's
 * customers actually did: for every invoice that has been collected in full,
 * how many days after its due date did the last euro arrive?
 *
 * Why a measurement is defensible here rather than an industry rule of thumb:
 * the overwhelming majority of this company's collections come from a single
 * client paying through confirming. One payer means one payment behaviour, so
 * the mean is a description of a process, not an average of unrelated
 * customers cancelling each other out.
 *
 * Three deliberate choices:
 *
 *   1. AMOUNT-WEIGHTED. Cash is not counted in invoices. A 40,000 EUR invoice
 *      paid 30 days late moves the bank balance; a 200 EUR one paid early does
 *      not. An unweighted mean flatters the forecast because the long tail of
 *      tiny private-customer invoices is settled promptly.
 *   2. FULLY COLLECTED ONLY. A partially paid invoice has no collection date
 *      yet — its last payment is not its final one. Counting it would report an
 *      earlier date than reality, and early is the dangerous direction to be
 *      wrong in when cash is negative.
 *   3. FALLS BACK RATHER THAN GUESSES. Below `MIN_COLLECTION_SLIP_SAMPLE`
 *      observations a single large invoice can swing the weighted mean by
 *      weeks, so the documented constant is used instead and the caller is told
 *      so via `confidence`.
 *
 * Pure: no Firebase, no wall clock, no mutation of the caller's documents.
 *
 * @typedef {Object} CollectionSlip
 * @property {number} slipDays - whole days, always within 0…MAX_COLLECTION_SLIP_DAYS
 * @property {number} sampleSize - fully collected receivables that carried signal
 * @property {'measured'|'default'} confidence - whether slipDays came from history
 */

import { diffDays, isIsoDate } from './dates.js';
import { COLLECTION_SLIP_DAYS } from './forecast.js';
import { isOpenAmount, openAmountOf as defaultOpenAmountOf } from './money.js';

/**
 * Minimum number of fully collected receivables before the measurement is
 * trusted over the documented default.
 *
 * TEN, because collections here arrive in payment runs rather than per invoice:
 * ten settled invoices already span several runs, so the weighted mean
 * describes a repeated behaviour instead of one client's one-off month. Under
 * ten, a single large invoice owns the mean — and a forecast assumption that
 * moves by weeks whenever one invoice settles is worse than a stated constant.
 *
 * @type {number}
 */
export const MIN_COLLECTION_SLIP_SAMPLE = 10;

/**
 * Hard ceiling on the returned slip. A quarter of a year is already far beyond
 * anything this company has observed, so hitting the clamp means the data is
 * wrong, not that the forecast should push every inflow past the horizon.
 * @type {number}
 */
export const MAX_COLLECTION_SLIP_DAYS = 90;

/**
 * Individual observations further than this from the due date (either way) are
 * treated as data-entry errors and dropped before the mean is taken. A mistyped
 * year would otherwise dominate a weighted average all by itself, and clamping
 * only the final result would silently pin the forecast to the ceiling.
 * @type {number}
 */
export const OBSERVABLE_SLIP_WINDOW_DAYS = 365;

/** Statuses whose payments describe a reversal, not a collection. */
const VOIDED_STATUSES = new Set(['cancelled', 'void']);

const isVoided = (doc) => VOIDED_STATUSES.has(String(doc?.status || '').toLowerCase());

/** 'YYYY-MM-DD' out of an ISO date or an ISO timestamp; null for anything else. */
const isoDateOf = (value) => {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return isIsoDate(date) ? date : null;
};

const positiveNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** Whole days inside [0, MAX_COLLECTION_SLIP_DAYS]. */
const clampSlip = (days) => Math.min(MAX_COLLECTION_SLIP_DAYS, Math.max(0, Math.round(days)));

/**
 * The day this invoice finished turning into cash, and how much cash that was.
 * Returns null when the document carries no collection signal.
 */
const observationOf = (doc, openAmountOf) => {
  if (!doc || isVoided(doc)) return null;
  // Still open → its final payment has not happened yet.
  if (isOpenAmount(openAmountOf(doc))) return null;

  const dueDate = isoDateOf(doc.dueDate);
  if (!dueDate) return null;

  const payments = Array.isArray(doc.payments) ? doc.payments : [];
  let lastPaymentDate = null;
  let collected = 0;
  for (const payment of payments) {
    const date = isoDateOf(payment?.date);
    if (date && (lastPaymentDate === null || date > lastPaymentDate)) lastPaymentDate = date;
    collected += positiveNumber(payment?.amount);
  }
  if (!lastPaymentDate || collected <= 0) return null;

  const delayDays = diffDays(dueDate, lastPaymentDate);
  if (Math.abs(delayDays) > OBSERVABLE_SLIP_WINDOW_DAYS) return null;

  return { delayDays, weight: collected };
};

/**
 * Derive the collection slip from settled history.
 *
 * @param {{
 *   receivables?: Object[],
 *   fallbackSlipDays?: number,
 *   minSampleSize?: number,
 *   openAmountOf?: (doc: Object) => number,
 * }} [params]
 * @returns {CollectionSlip}
 */
export const deriveCollectionSlip = ({
  receivables,
  fallbackSlipDays = COLLECTION_SLIP_DAYS,
  minSampleSize = MIN_COLLECTION_SLIP_SAMPLE,
  openAmountOf = defaultOpenAmountOf,
} = {}) => {
  const docs = Array.isArray(receivables) ? receivables : [];

  let sampleSize = 0;
  let totalWeight = 0;
  let weightedDelay = 0;
  for (const doc of docs) {
    const observation = observationOf(doc, openAmountOf);
    if (!observation) continue;
    sampleSize += 1;
    totalWeight += observation.weight;
    weightedDelay += observation.weight * observation.delayDays;
  }

  if (sampleSize < minSampleSize || totalWeight <= 0) {
    const fallback = Number.isFinite(Number(fallbackSlipDays))
      ? Number(fallbackSlipDays)
      : COLLECTION_SLIP_DAYS;
    return { slipDays: clampSlip(fallback), sampleSize, confidence: 'default' };
  }

  return { slipDays: clampSlip(weightedDelay / totalWeight), sampleSize, confidence: 'measured' };
};

export default deriveCollectionSlip;
