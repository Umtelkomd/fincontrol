/**
 * German fiscal due dates for the company (has Dauerfristverlaengerung).
 *
 * For a wage/VAT month M ('YYYY-MM'):
 *   - VAT (Umsatzsteuer-Voranmeldung):  10th of M+2
 *   - Wage tax (Lohnsteuer):            10th of M+1
 *   - Social security (SV):             third-to-last bank business day of M
 *   - Net wages:                        last bank business day of M
 *
 * The two "10th" deadlines shift forward to the next bank business day when
 * the 10th falls on a weekend or holiday (§108(3) AO) — this matches the
 * production Lohnsteuer behavior in src/features/nominas/lib/payrollDueDates.js.
 *
 * All functions return null for invalid month keys.
 */

import { addMonthKey, splitMonthKey } from './dates.js';
import { nextBankBusinessDay, nthLastBankBusinessDayOfMonth } from './bankingDays.js';

/** The 10th of `monthKey + monthOffset`, shifted to the next bank business day. */
const shiftedTenthOf = (monthKey, monthOffset) => {
  if (!splitMonthKey(monthKey)) return null;
  const targetMonth = addMonthKey(monthKey, monthOffset);
  return nextBankBusinessDay(`${targetMonth}-10`);
};

/**
 * VAT for month M is due the 10th of M+2 (Dauerfristverlaengerung),
 * e.g. May 2026 VAT → 2026-07-10.
 * @param {string} monthKey - 'YYYY-MM'
 * @returns {string|null}
 */
export const vatDueDate = (monthKey) => shiftedTenthOf(monthKey, 2);

/**
 * Wage tax (Lohnsteuer) for month M is due the 10th of M+1.
 * @param {string} monthKey - 'YYYY-MM'
 * @returns {string|null}
 */
export const wageTaxDueDate = (monthKey) => shiftedTenthOf(monthKey, 1);

/**
 * Social security (Sozialversicherung) for month M is due the third-to-last
 * bank business day of M.
 * @param {string} monthKey - 'YYYY-MM'
 * @returns {string|null}
 */
export const socialSecurityDueDate = (monthKey) =>
  nthLastBankBusinessDayOfMonth(monthKey, 3);

/**
 * Net wages for month M are paid around the last bank business day of M.
 * @param {string} monthKey - 'YYYY-MM'
 * @returns {string|null}
 */
export const netWagesDate = (monthKey) => nthLastBankBusinessDayOfMonth(monthKey, 1);
