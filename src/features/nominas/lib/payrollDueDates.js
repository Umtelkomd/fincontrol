/**
 * German payroll due-date helpers — pure, built on bankingCalendar.
 *
 * Three distinct outflow deadlines per period:
 *   - Krankenkassen (SV): drittletzter Bankarbeitstag of the contribution month.
 *   - Lohnsteuer (LSt):   10th of the FOLLOWING month, shifted to the next
 *                         banking day if it falls on a weekend/holiday.
 *   - Net wages:          the actual transfer/value date, else the last banking
 *                         day of the period month.
 *
 * resolvePayrollDueDates PREFERS the Fälligkeit dates DATEV already parsed from
 * the PDF (kkDueDate, tax.dueDate) and only computes the missing ones, so we
 * never diverge from what DATEV actually scheduled.
 */

import { nextBankingDay, nthToLastBankingDayOfMonth } from './bankingCalendar.js';

/** Parse a 'YYYY-MM' period key into { year, month } (month 1-based). */
const splitPeriod = (period) => {
  const [y, m] = String(period || '').split('-').map(Number);
  return { year: y, month: m };
};

/**
 * Drittletzter Bankarbeitstag (3rd-to-last banking day) of the period month.
 * @param {string} period - 'YYYY-MM'
 * @returns {string|null} ISO date
 */
export const krankenkassenDueDate = (period) => {
  const { year, month } = splitPeriod(period);
  if (!year || !month) return null;
  return nthToLastBankingDayOfMonth(year, month, 3);
};

/**
 * 10th of the month FOLLOWING the period, shifted to the next banking day.
 * @param {string} period - 'YYYY-MM'
 * @returns {string|null} ISO date
 */
export const lohnsteuerDueDate = (period) => {
  const { year, month } = splitPeriod(period);
  if (!year || !month) return null;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const tenth = `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;
  return nextBankingDay(tenth);
};

/**
 * Net-wages transfer/value date. Returns the provided transferDate verbatim;
 * otherwise the last banking day of the period month.
 * @param {string} period - 'YYYY-MM'
 * @param {{ transferDate?: string }} [opts]
 * @returns {string|null} ISO date
 */
export const netWagesDueDate = (period, { transferDate } = {}) => {
  if (transferDate) return transferDate;
  const { year, month } = splitPeriod(period);
  if (!year || !month) return null;
  return nthToLastBankingDayOfMonth(year, month, 1);
};

/**
 * Resolve the three payroll due dates, preferring parsed Fälligkeit dates and
 * computing only the gaps.
 *
 * @param {{
 *   period: string,
 *   parsed: {
 *     krankenkassen?: Array<{dueDate?: string|null}>,
 *     tax?: {dueDate?: string|null},
 *     netWages?: {dueDate?: string|null}
 *   }
 * }} params
 * @returns {{ kk: string|null, tax: string|null, netWages: string|null }}
 */
export const resolvePayrollDueDates = ({ period, parsed = {} } = {}) => {
  const parsedKk = (parsed.krankenkassen || []).find((k) => k && k.dueDate)?.dueDate || null;
  const parsedTax = parsed.tax?.dueDate || null;
  const parsedNet = parsed.netWages?.dueDate || null;

  return {
    kk: parsedKk || krankenkassenDueDate(period),
    tax: parsedTax || lohnsteuerDueDate(period),
    netWages: netWagesDueDate(period, { transferDate: parsedNet }),
  };
};

export default {
  krankenkassenDueDate,
  lohnsteuerDueDate,
  netWagesDueDate,
  resolvePayrollDueDates,
};
