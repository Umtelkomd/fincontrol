/**
 * 13-week (configurable) cash-flow forecast bucketed into Monday-start weeks.
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
 * Scenarios:
 *   - 'committed' (default): only the open documents and provided obligations.
 *   - 'expected': committed + monthly recurrence of the estimated obligation
 *     kinds (payroll-net, social, wage-tax, vat). For each kind present in
 *     `obligations` (with a valid `month`), the latest month's amount repeats
 *     for every following month whose due date still falls inside the
 *     horizon. Kinds absent from `obligations` are not invented.
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

import { addDays, addMonthKey, diffDays, isIsoDate, mondayOfWeek, splitMonthKey } from './dates.js';
import {
  netWagesDate,
  socialSecurityDueDate,
  vatDueDate,
  wageTaxDueDate,
} from './fiscalCalendar.js';
import { isOpenAmount, openAmountOf as defaultOpenAmountOf } from './money.js';

/** Due-date resolver and label prefix per recurring obligation kind. */
const RECURRING_KINDS = {
  'payroll-net': { dueDateOf: netWagesDate, labelPrefix: 'Net wages' },
  social: { dueDateOf: socialSecurityDueDate, labelPrefix: 'Social security' },
  'wage-tax': { dueDateOf: wageTaxDueDate, labelPrefix: 'Wage tax' },
  vat: { dueDateOf: vatDueDate, labelPrefix: 'VAT' },
};

const toFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Positive magnitude → signed outflow, guarding against -0. */
const asOutflow = (magnitude) => (magnitude > 0 ? -magnitude : 0);

/**
 * Synthesize the 'expected' recurrence: repeat each recurring kind monthly
 * after its latest provided month, while the due date stays inside the
 * horizon. The repeated amount is the SUM of that kind's items in its latest
 * month (callers may split e.g. social security across payees).
 * @returns {Array<{ date: string, kind: string, label: string, amount: number, source: string }>}
 */
const synthesizeRecurring = ({ obligations, today, horizonEnd }) => {
  const synthesized = [];
  for (const [kind, { dueDateOf, labelPrefix }] of Object.entries(RECURRING_KINDS)) {
    const provided = (obligations || []).filter(
      (item) => item?.kind === kind && splitMonthKey(item.month),
    );
    if (provided.length === 0) continue;

    const lastMonth = provided.reduce(
      (max, item) => (item.month > max ? item.month : max),
      provided[0].month,
    );
    const amount = provided
      .filter((item) => item.month === lastMonth)
      .reduce((sum, item) => sum + toFiniteNumber(item.amount), 0);

    let month = addMonthKey(lastMonth, 1);
    let guard = 0;
    while (guard < 30) {
      const date = dueDateOf(month);
      if (!date || date > horizonEnd) break;
      if (date >= today) {
        synthesized.push({
          date,
          kind,
          label: `${labelPrefix} ${month}`,
          amount,
          source: 'recurring-estimate',
        });
      }
      month = addMonthKey(month, 1);
      guard += 1;
    }
  }
  return synthesized;
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
 *   scenario?: 'committed'|'expected',
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
  collectionSlipDays = 7,
  scenario = 'committed',
  openAmountOf = defaultOpenAmountOf,
}) => {
  if (scenario !== 'committed' && scenario !== 'expected') {
    throw new TypeError(`Unknown forecast scenario: ${scenario}`);
  }

  const firstWeekStart = mondayOfWeek(today);
  const horizonEnd = addDays(firstWeekStart, weeks * 7 - 1);
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

  if (scenario === 'expected') {
    for (const item of synthesizeRecurring({ obligations: usableObligations, today, horizonEnd })) {
      placeItem(item.date, {
        kind: item.kind,
        label: item.label,
        amount: asOutflow(item.amount),
        source: item.source,
      });
    }
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
