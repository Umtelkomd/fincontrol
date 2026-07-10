/**
 * Cash position derived from reconciliation anchors + bank movements.
 *
 * An anchor is a human/DATEV-confirmed balance snapshot; the engine never
 * trusts a stored "current balance" field. The balance for any day D is:
 * latest anchor with date <= D, plus signed movements posted STRICTLY AFTER
 * the anchor date up to and including D (movements on the anchor date are
 * already inside the anchor balance).
 *
 * @typedef {Object} ReconciliationAnchor
 * @property {string} date - 'YYYY-MM-DD' the balance was confirmed for
 * @property {number} balance - account balance at end of that day
 * @property {string} source - provenance, e.g. 'datev'
 * @property {string} [note]
 * @property {string} [confirmedBy]
 * @property {string} [confirmedAt]
 *
 * @typedef {Object} CashPosition
 * @property {number|null} balance - null when no anchor covers `today`
 * @property {ReconciliationAnchor|null} anchor - the anchor used
 * @property {number} movementsApplied - movements summed on top of the anchor
 * @property {string|null} lastMovementDate - newest postedDate <= today
 * @property {number|null} staleDays - calendar days since lastMovementDate
 */

import { addDays, diffDays, isIsoDate } from './dates.js';
import { bankBusinessDaysBetween } from './bankingDays.js';
import { signedAmountOf } from './movementAmount.js';

const isUsableAnchor = (anchor) =>
  Boolean(anchor) && isIsoDate(anchor.date) && typeof anchor.balance === 'number' && Number.isFinite(anchor.balance);

/**
 * Latest usable anchor with date <= asOf. When two anchors share the same
 * date, the later one in the input array wins (assumed newest correction).
 * @param {ReconciliationAnchor[]} anchors
 * @param {string} asOf
 * @returns {ReconciliationAnchor|null}
 */
const latestAnchorOnOrBefore = (anchors, asOf) => {
  let best = null;
  for (const anchor of anchors || []) {
    if (!isUsableAnchor(anchor) || anchor.date > asOf) continue;
    if (!best || anchor.date >= best.date) best = anchor;
  }
  return best;
};

/**
 * Derive the balance as of `today` from anchors + movements.
 *
 * Movement window: postedDate > anchor.date AND postedDate <= today.
 * `lastMovementDate`/`staleDays` describe import freshness and consider ALL
 * movements posted on or before today (even ones before the anchor).
 *
 * @param {{ anchors: ReconciliationAnchor[], movements: import('./movementAmount.js').BankMovement[], today: string }} params
 * @returns {CashPosition}
 */
export const deriveBalance = ({ anchors, movements, today }) => {
  const anchor = latestAnchorOnOrBefore(anchors, today);

  let net = 0;
  let movementsApplied = 0;
  let lastMovementDate = null;
  for (const movement of movements || []) {
    const date = movement?.postedDate;
    if (!isIsoDate(date) || date > today) continue;
    if (!lastMovementDate || date > lastMovementDate) lastMovementDate = date;
    if (anchor && date > anchor.date) {
      net += signedAmountOf(movement);
      movementsApplied += 1;
    }
  }

  return {
    balance: anchor ? anchor.balance + net : null,
    anchor,
    movementsApplied: anchor ? movementsApplied : 0,
    lastMovementDate,
    staleDays: lastMovementDate ? diffDays(lastMovementDate, today) : null,
  };
};

/**
 * Daily balance series over [from, to], carrying the balance forward on quiet
 * days. Anchors inside the range re-anchor the series on their own date
 * (their balance replaces the running one; movements that day are inside the
 * anchor). Days before the first anchor have `balance: null`.
 *
 * @param {{ anchors: ReconciliationAnchor[], movements: import('./movementAmount.js').BankMovement[], from: string, to: string }} params
 * @returns {Array<{ date: string, balance: number|null }>}
 */
export const dailyBalanceSeries = ({ anchors, movements, from, to }) => {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];

  // Later array entries win for same-date anchors — same rule as deriveBalance.
  const anchorByDate = new Map();
  for (const anchor of anchors || []) {
    if (isUsableAnchor(anchor)) anchorByDate.set(anchor.date, anchor);
  }

  const movementSumByDate = new Map();
  for (const movement of movements || []) {
    const date = movement?.postedDate;
    if (!isIsoDate(date)) continue;
    movementSumByDate.set(date, (movementSumByDate.get(date) || 0) + signedAmountOf(movement));
  }

  const series = [];
  let balance = deriveBalance({ anchors, movements, today: from }).balance;
  series.push({ date: from, balance });

  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    const anchor = anchorByDate.get(date);
    if (anchor) {
      balance = anchor.balance;
    } else if (balance !== null) {
      balance += movementSumByDate.get(date) || 0;
    }
    series.push({ date, balance });
  }
  return series;
};

/**
 * Detect a bank-import gap: how many bank business days have passed with no
 * imported movement. `today` itself counts as quiet when nothing is posted on
 * it, so with the default tolerance of 5 the alert fires on the 6th quiet
 * business day. No usable movement at all ⇒ gap.
 *
 * @param {{ movements: import('./movementAmount.js').BankMovement[], today: string, maxQuietBusinessDays?: number }} params
 * @returns {{ hasGap: boolean, lastMovementDate: string|null, quietBusinessDays: number|null }}
 */
export const detectImportGap = ({ movements, today, maxQuietBusinessDays = 5 }) => {
  let lastMovementDate = null;
  for (const movement of movements || []) {
    const date = movement?.postedDate;
    if (!isIsoDate(date) || date > today) continue;
    if (!lastMovementDate || date > lastMovementDate) lastMovementDate = date;
  }

  if (!lastMovementDate) {
    return { hasGap: true, lastMovementDate: null, quietBusinessDays: null };
  }

  const quietBusinessDays = bankBusinessDaysBetween(lastMovementDate, today);
  return {
    hasGap: quietBusinessDays > maxQuietBusinessDays,
    lastMovementDate,
    quietBusinessDays,
  };
};
