/**
 * Expected collection — WHEN and HOW MUCH an open receivable turns into cash,
 * learned per payer from what the bank actually received.
 *
 * The weekly forecast used to place every receivable at `dueDate + one global
 * slip` for its booked amount. For this company that was wrong in both axes:
 *
 *   - AMOUNT. Insyte, the dominant payer, is booked NET (without VAT) and pays
 *     through confirming: the bank receives net × 1.19 minus the ~2.4 % the
 *     confirming bank keeps. Small private customers are booked net and pay
 *     gross. So the booked amount under-states the cash by ~16–19 %.
 *   - DATE. Confirming advances arrive 2–11 days after the INVOICE date, not
 *     after the due date.
 *
 * Both are measured here from reconciled history instead of being hard-coded:
 * for every bank receipt linked to receivables, `movement.amount / Σ booked
 * amounts` is the cash ratio and `receipt date − issue date` the lag, grouped
 * by payer. Below `MIN_PAYER_SAMPLE` receipts a payer has no profile and the
 * caller falls back to the global slip.
 *
 * Overdue money is no longer "expected this week": it is expected next week,
 * and once it is `AT_RISK_DAYS` past its expected date it leaves the forecast
 * and is reported as at risk — counting it as incoming cash is how a forecast
 * talks a company into paying bills it cannot cover.
 *
 * Pure: no Firebase, no wall clock.
 */
import { addDays, diffDays, isIsoDate } from './dates.js';

/** Receipts needed before a payer's measured behaviour is trusted. */
export const MIN_PAYER_SAMPLE = 3;
/** Days past the expected date after which a receivable is "at risk". */
export const AT_RISK_DAYS = 60;
/** Overdue money is expected at the earliest this many days from today. */
export const OVERDUE_EXPECTED_IN_DAYS = 7;
/** Plausibility window for a measured cash ratio (net-booked with VAT ≈ 1.19). */
const RATIO_BOUNDS = [0.5, 1.5];
const LAG_BOUNDS = [-30, 180];

const round2 = (value) => Math.round(value * 100) / 100;
const isoOf = (value) => (typeof value === 'string' && isIsoDate(value.slice(0, 10)) ? value.slice(0, 10) : null);
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Normalised payer key: the counterparty, case/space/punctuation-insensitive. */
export const payerKeyOf = (doc) =>
  String(doc?.counterpartyName || doc?.client || '')
    .toLowerCase()
    .replace(/\b(gmbh|s\.?a\.?|s\.?l\.?|ag|kg|ug)\b/g, '')
    .replace(/[^a-z0-9äöüß]/g, '');

const receivableIdsOf = (movement) => [
  ...new Set([movement?.receivableId, ...(Array.isArray(movement?.receivableIds) ? movement.receivableIds : [])].filter(Boolean)),
];

/**
 * Per-payer cash ratio and issue→cash lag, from reconciled receipts.
 *
 * @param {{ receivables: object[], movements: object[] }} input
 * @returns {Map<string, { label: string, cashRatio: number, lagDays: number, sampleSize: number }>}
 */
export const buildPayerProfiles = ({ receivables = [], movements = [] } = {}) => {
  const byId = new Map((receivables || []).filter(Boolean).map((doc) => [doc.id, doc]));
  const samples = new Map();

  for (const movement of movements || []) {
    if (!movement || movement.status === 'void' || movement.direction !== 'in') continue;
    const docs = receivableIdsOf(movement).map((id) => byId.get(id)).filter((doc) => doc && doc.status !== 'cancelled');
    if (!docs.length) continue;
    const payer = payerKeyOf(docs[0]);
    if (!payer || docs.some((doc) => payerKeyOf(doc) !== payer)) continue;

    const booked = docs.reduce((sum, doc) => sum + Math.abs(Number(doc.grossAmount ?? doc.amount) || 0), 0);
    const cash = Math.abs(Number(movement.amount) || 0);
    const date = isoOf(movement.postedDate);
    if (booked <= 0 || cash <= 0 || !date) continue;
    const ratio = cash / booked;

    const issues = docs.map((doc) => isoOf(doc.issueDate)).filter(Boolean).sort();
    const lag = issues.length ? diffDays(issues[issues.length - 1], date) : null;

    if (!samples.has(payer)) samples.set(payer, { ratios: [], lags: [], label: docs[0].counterpartyName || docs[0].client || payer });
    const bucket = samples.get(payer);
    if (ratio >= RATIO_BOUNDS[0] && ratio <= RATIO_BOUNDS[1]) bucket.ratios.push(ratio);
    if (lag !== null && lag >= LAG_BOUNDS[0] && lag <= LAG_BOUNDS[1]) bucket.lags.push(lag);
  }

  const profiles = new Map();
  for (const [payer, { ratios, lags, label }] of samples) {
    if (ratios.length < MIN_PAYER_SAMPLE || lags.length < MIN_PAYER_SAMPLE) continue;
    profiles.set(payer, {
      label,
      cashRatio: Math.round(median(ratios) * 10000) / 10000,
      lagDays: Math.max(0, Math.round(median(lags))),
      sampleSize: Math.min(ratios.length, lags.length),
    });
  }
  return profiles;
};

/**
 * Expected cash for one open receivable.
 *
 * @param {object} doc
 * @param {{ today: string, openAmount: number, profiles: Map, fallbackSlipDays: number }} context
 * @returns {{ date: string, amount: number, atRisk: boolean, basis: 'payer'|'default', daysLate: number }}
 */
export const expectedCollectionOf = (doc, { today, openAmount, profiles, fallbackSlipDays }) => {
  const profile = profiles?.get(payerKeyOf(doc)) || null;
  const issueDate = isoOf(doc?.issueDate);
  const dueDate = isoOf(doc?.dueDate) || today;

  const expected = profile && issueDate ? addDays(issueDate, profile.lagDays) : addDays(dueDate, fallbackSlipDays);
  const amount = round2(openAmount * (profile ? profile.cashRatio : 1));
  const daysLate = expected < today ? diffDays(expected, today) : 0;

  return {
    date: daysLate > 0 ? addDays(today, OVERDUE_EXPECTED_IN_DAYS) : expected,
    amount,
    atRisk: daysLate > AT_RISK_DAYS,
    basis: profile ? 'payer' : 'default',
    daysLate,
  };
};
