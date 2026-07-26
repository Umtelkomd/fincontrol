/**
 * 13-week (configurable) cash-flow forecast bucketed into Monday-start weeks.
 *
 * THIS IS THE ONLY CASH-FLOW PROJECTION ENGINE IN THE APP. Every screen that
 * shows a forward cash figure goes through it (via `buildCashForecast` in
 * src/finance/cashForecast.js). Do not add a second one: three parallel
 * engines used to disagree about the same invoice, which is what made the
 * app's forecasts untrustworthy.
 *
 * Placement rules:
 *   - Week 1 is the Monday-week containing `today`.
 *   - Receivables: expected collection = dueDate + collectionSlipDays.
 *     Overdue receivables (due before today) land in week 1 with no slip.
 *   - Payables: placed in their due week; overdue ones land in week 1.
 *   - Obligations: placed at their calendar date; overdue ones land in
 *     week 1. Items of kind 'payable' inside `obligations` are IGNORED —
 *     open payables are already provided separately and would double-count.
 *   - Documents without a due date count as due today.
 *   - Anything landing after the last week is dropped (including receivables
 *     whose slip pushes them past the horizon).
 *
 * Only committed money is projected: the open documents and the obligations
 * the caller supplies. The engine never invents revenue, costs or scenario
 * multipliers — the sole modelled assumption is `collectionSlipDays`, and it
 * re-times money that is already on the books, it never changes the amount.
 *
 * Sign convention: inflows positive, outflows negative;
 * `net = inflow + outflow`; `projectedBalance` runs from `startBalance`.
 *
 * @typedef {Object} ForecastItem
 * @property {string} date - the date used for bucketing
 * @property {string} kind - 'receivable' | 'payable' | obligation kinds
 * @property {string} label
 * @property {number} amount - signed
 * @property {string} source
 *
 * @typedef {Object} ForecastWeek
 * @property {string} weekStart - Monday
 * @property {string} weekEnd - Sunday
 * @property {number} inflow - >= 0
 * @property {number} outflow - <= 0
 * @property {number} net
 * @property {number} projectedBalance
 * @property {ForecastItem[]} items
 */

import { addDays, diffDays, isIsoDate, mondayOfWeek } from './dates.js';
import { isOpenAmount, openAmountOf as defaultOpenAmountOf } from './money.js';

/**
 * Days added to a receivable's due date to get its expected collection date.
 *
 * BASIS: German B2B construction/telecom clients settle on their own payment
 * runs rather than on the invoice due date, and the company's own aging
 * report has consistently shown collection landing inside the week AFTER the
 * due date. One week is the conservative, round approximation of that lag.
 *
 * This is the ONE place the assumption is stated. It is deliberately a single
 * documented number rather than a per-screen default: when two screens each
 * picked their own slip, the same invoice appeared in two different weeks.
 * Callers may override it via `collectionSlipDays` for sensitivity analysis,
 * but no caller should hardcode a different default.
 *
 * Applies only to receivables that are NOT yet overdue — money already past
 * due is expected immediately (week 1), since a slip on top of a slip is not
 * evidence, it is guessing.
 *
 * @type {number}
 */
export const COLLECTION_SLIP_DAYS = 7;

/** Positive magnitude → signed outflow, guarding against -0. */
const asOutflow = (magnitude) => (magnitude > 0 ? -magnitude : 0);

const toFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * The exact calendar window `forecastWeeks` will cover, so callers can size
 * the obligations calendar they feed it to the same horizon (no gap, no
 * overshoot).
 *
 * @param {{ today: string, weeks?: number }} params
 * @returns {{ firstWeekStart: string, horizonEnd: string, horizonDays: number }}
 *   `horizonDays` is measured from `today` (not from the Monday), matching
 *   `buildObligationsCalendar`'s `horizonDays` semantics.
 */
export const forecastHorizon = ({ today, weeks = 13 }) => {
  const firstWeekStart = mondayOfWeek(today);
  const horizonEnd = addDays(firstWeekStart, weeks * 7 - 1);
  return { firstWeekStart, horizonEnd, horizonDays: diffDays(today, horizonEnd) };
};

/**
 * Build the weekly cash-flow forecast.
 *
 * @param {{
 *   startBalance: number,
 *   today: string,
 *   weeks?: number,
 *   receivables: Object[],
 *   payables: Object[],
 *   obligations: import('./obligations.js').Obligation[],
 *   collectionSlipDays?: number,
 *   openAmountOf?: (doc: Object) => number,
 * }} params
 * @returns {ForecastWeek[]}
 */
export const forecastWeeks = ({
  startBalance,
  today,
  weeks = 13,
  receivables,
  payables,
  obligations,
  collectionSlipDays = COLLECTION_SLIP_DAYS,
  openAmountOf = defaultOpenAmountOf,
}) => {
  const { firstWeekStart, horizonEnd } = forecastHorizon({ today, weeks });
  const weekList = Array.from({ length: weeks }, (_, index) => ({
    weekStart: addDays(firstWeekStart, index * 7),
    weekEnd: addDays(firstWeekStart, index * 7 + 6),
    inflow: 0,
    outflow: 0,
    net: 0,
    projectedBalance: 0,
    items: [],
  }));

  const placeItem = (rawDate, item) => {
    // Overdue money is expected to move immediately → week 1.
    const date = rawDate < today ? today : rawDate;
    if (date > horizonEnd) return;
    const week = weekList[Math.floor(diffDays(firstWeekStart, date) / 7)];
    week.items.push({ ...item, date });
    if (item.amount >= 0) week.inflow += item.amount;
    else week.outflow += item.amount;
  };

  for (const doc of receivables || []) {
    const amount = openAmountOf(doc);
    if (!isOpenAmount(amount)) continue;
    const dueDate = isIsoDate(doc?.dueDate) ? doc.dueDate : today;
    const collectionDate = dueDate < today ? today : addDays(dueDate, collectionSlipDays);
    placeItem(collectionDate, {
      kind: 'receivable',
      label: doc.counterpartyName || doc.client || doc.invoiceNumber || 'Receivable',
      amount,
      source: 'receivables',
    });
  }

  for (const doc of payables || []) {
    const amount = openAmountOf(doc);
    if (!isOpenAmount(amount)) continue;
    const dueDate = isIsoDate(doc?.dueDate) ? doc.dueDate : today;
    placeItem(dueDate, {
      kind: 'payable',
      label: doc.counterpartyName || doc.vendor || doc.invoiceNumber || 'Payable',
      amount: asOutflow(amount),
      source: 'payables',
    });
  }

  const usableObligations = (obligations || []).filter(
    (item) => item && item.kind !== 'payable' && isIsoDate(item.date),
  );
  for (const item of usableObligations) {
    placeItem(item.date, {
      kind: item.kind,
      label: item.label,
      amount: asOutflow(toFiniteNumber(item.amount)),
      source: item.source,
    });
  }

  let runningBalance = toFiniteNumber(startBalance);
  for (const week of weekList) {
    week.items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind) ||
        String(a.label).localeCompare(String(b.label)),
    );
    week.net = week.inflow + week.outflow;
    runningBalance += week.net;
    week.projectedBalance = runningBalance;
  }
  return weekList;
};
