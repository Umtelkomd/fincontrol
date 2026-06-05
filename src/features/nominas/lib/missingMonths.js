/**
 * Missing-month detection — pure month-sequence diff.
 *
 * Diffs the expected 'YYYY-MM' sequence (from the earliest loaded period up to
 * the current month) against the set of existing period keys → the sorted list
 * of months that have no loaded payroll period.
 */

import { periodKey } from './payroll.js';

/** Advance a 'YYYY-MM' key by one month. */
const nextMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, '0')}`;
};

/** Step a 'YYYY-MM' key back by one month. */
const prevMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
};

/**
 * @param {Array<{period:string}|string>} periods - currently loaded periods
 * @param {string} currentMonthIso - the current 'YYYY-MM'; the upper bound is the
 *   PREVIOUS completed month (this month's DATEV payroll isn't produced until
 *   month-end, so the in-progress month is never "missing").
 * @returns {string[]} sorted missing 'YYYY-MM' keys
 */
export const missingPayrollMonths = (periods, currentMonthIso) => {
  const keys = (periods || []).map(periodKey).filter(Boolean).sort();
  if (keys.length === 0) return [];

  const existing = new Set(keys);
  const start = keys[0];
  const lastExpected = currentMonthIso ? prevMonthKey(currentMonthIso) : keys[keys.length - 1];
  const end = lastExpected > start ? lastExpected : keys[keys.length - 1];

  const missing = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 600) {
    if (!existing.has(cur)) missing.push(cur);
    cur = nextMonthKey(cur);
    guard += 1;
  }
  return missing;
};

export default { missingPayrollMonths };
