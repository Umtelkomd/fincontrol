/**
 * Obligations calendar: everything the company must pay inside the horizon.
 *
 * Sources and rules:
 *   - `payable`: every open payable due on or before the horizon end. Overdue
 *     payables stay listed (with `overdue: true`) no matter how old — they are
 *     verifiably open documents. A payable without a due date counts as due
 *     today.
 *   - `payroll-net` / `social` / `wage-tax`: ESTIMATED monthly obligations,
 *     amounts averaged from the latest (up to 3) payroll periods. Generated
 *     only for due dates in [today, horizon end]: a past estimated due is
 *     either already paid (already reflected in the bank balance) or not
 *     provable from this data, so projecting it would double-count.
 *     Skip rule: a payroll period with status 'pagada' proves its month's net
 *     wages AND social security are paid (SV falls due before the wage
 *     transfer), so both are skipped for that month; wage tax is due the
 *     FOLLOWING month and can never be inferred paid, so it always stays.
 *     With no payroll history the dates are still emitted with amount 0 and
 *     `estimated: false`.
 *   - `vat`: manual estimates from config, placed on the 10th of M+2
 *     (Dauerfristverlaengerung, business-day shifted). Estimates stay listed
 *     when overdue — the config owner removes them once paid.
 *
 * Amounts are positive magnitudes; the direction is implied by the kind.
 * Sorted by date, then kind, then label.
 *
 * @typedef {Object} PayrollPeriod
 * @property {string} period - 'YYYY-MM'
 * @property {number} netWagesTotal
 * @property {number} socialTotal
 * @property {number} taxTotal
 * @property {number} [cashTotal]
 * @property {number} [employerCostTotal]
 * @property {number} [employeeCount]
 * @property {string} [status] - e.g. 'pagada' | 'parcial'
 *
 * @typedef {Object} VatEstimate
 * @property {string} month - 'YYYY-MM' the VAT belongs to
 * @property {number} amount
 *
 * @typedef {Object} Obligation
 * @property {string} date - due date 'YYYY-MM-DD'
 * @property {'payable'|'payroll-net'|'social'|'wage-tax'|'vat'} kind
 * @property {string} label
 * @property {number} amount - positive magnitude
 * @property {'payables'|'payroll-average'|'vat-estimates'} source
 * @property {boolean} overdue - due before today
 * @property {boolean} estimated - false for real documents and no-history fallbacks
 * @property {string} [month] - the 'YYYY-MM' the obligation refers to
 * @property {Object} [doc] - original payable doc (payable kind only)
 */

import { addDays, addMonthKey, isIsoDate, monthKeyOf, splitMonthKey } from './dates.js';
import {
  netWagesDate,
  socialSecurityDueDate,
  vatDueDate,
  wageTaxDueDate,
} from './fiscalCalendar.js';
import { isOpenAmount, openAmountOf as defaultOpenAmountOf } from './money.js';

const PAID_PERIOD_STATUS = 'pagada';
/** How many of the latest payroll periods feed the estimate average. */
const AVERAGE_PERIODS = 3;

const toFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const averageOf = (periods, field) => {
  if (periods.length === 0) return 0;
  const total = periods.reduce((sum, period) => sum + toFiniteNumber(period[field]), 0);
  return total / periods.length;
};

/**
 * Build the obligations calendar.
 *
 * @param {{
 *   payables: Object[],
 *   payrollPeriods: PayrollPeriod[],
 *   vatEstimates: VatEstimate[],
 *   today: string,
 *   horizonDays?: number,
 *   openAmountOf?: (doc: Object) => number,
 * }} params
 * @returns {Obligation[]}
 */
export const buildObligationsCalendar = ({
  payables,
  payrollPeriods,
  vatEstimates,
  today,
  horizonDays = 60,
  openAmountOf = defaultOpenAmountOf,
}) => {
  const horizonEnd = addDays(today, horizonDays);
  const items = [];

  // ── payables ────────────────────────────────────────────────────────────────
  for (const doc of payables || []) {
    const amount = openAmountOf(doc);
    if (!isOpenAmount(amount)) continue;
    const date = isIsoDate(doc?.dueDate) ? doc.dueDate : today;
    if (date > horizonEnd) continue;
    items.push({
      date,
      kind: 'payable',
      label: doc.counterpartyName || doc.vendor || doc.client || doc.invoiceNumber || 'Payable',
      amount,
      source: 'payables',
      overdue: date < today,
      estimated: false,
      doc,
    });
  }

  // ── payroll-derived estimates ───────────────────────────────────────────────
  const periods = (payrollPeriods || []).filter((p) => p && splitMonthKey(p.period));
  const latest = [...periods]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-AVERAGE_PERIODS);
  const hasHistory = latest.length > 0;
  const estimates = {
    'payroll-net': averageOf(latest, 'netWagesTotal'),
    social: averageOf(latest, 'socialTotal'),
    'wage-tax': averageOf(latest, 'taxTotal'),
  };
  const paidMonths = new Set(
    periods
      .filter((p) => String(p.status || '').toLowerCase() === PAID_PERIOD_STATUS)
      .map((p) => p.period),
  );

  const inWindow = (date) => Boolean(date) && date >= today && date <= horizonEnd;
  const pushPayrollItem = (kind, labelPrefix, date, month) => {
    items.push({
      date,
      kind,
      label: `${labelPrefix} ${month}`,
      amount: estimates[kind],
      source: 'payroll-average',
      overdue: date < today,
      estimated: hasHistory,
      month,
    });
  };

  // Scan enough months that every due date landing in the window is covered
  // (wage tax for month M falls due in M+1, hence the -2 lower buffer).
  const startKey = addMonthKey(monthKeyOf(today), -2);
  const endKey = monthKeyOf(horizonEnd);
  for (let key = startKey; key <= endKey; key = addMonthKey(key, 1)) {
    const monthIsPaid = paidMonths.has(key);
    const netDate = netWagesDate(key);
    if (inWindow(netDate) && !monthIsPaid) pushPayrollItem('payroll-net', 'Net wages', netDate, key);
    const socialDate = socialSecurityDueDate(key);
    if (inWindow(socialDate) && !monthIsPaid) pushPayrollItem('social', 'Social security', socialDate, key);
    const wageTaxDate = wageTaxDueDate(key);
    if (inWindow(wageTaxDate)) pushPayrollItem('wage-tax', 'Wage tax', wageTaxDate, key);
  }

  // ── VAT estimates ───────────────────────────────────────────────────────────
  for (const estimate of vatEstimates || []) {
    const date = vatDueDate(estimate?.month);
    if (!date || date > horizonEnd) continue;
    items.push({
      date,
      kind: 'vat',
      label: `VAT ${estimate.month}`,
      amount: toFiniteNumber(estimate.amount),
      source: 'vat-estimates',
      overdue: date < today,
      estimated: true,
      month: estimate.month,
    });
  }

  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.kind.localeCompare(b.kind) ||
      String(a.label).localeCompare(String(b.label)),
  );
};
