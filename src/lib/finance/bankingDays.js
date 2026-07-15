/**
 * German bank business days for the company's calendar
 * (nationwide + Mecklenburg-Vorpommern), aligned with the production payroll
 * calendar in src/features/nominas/lib/bankingCalendar.js:
 *
 *   - Reformation Day (10-31) is always a holiday in M-V.
 *   - International Womens Day (03-08) is an M-V holiday since 2023.
 *   - Dec 24 and Dec 31 are bank-closed (Bundesbank/TARGET2) even though they
 *     are not public holidays — without this the December SV Faelligkeit
 *     drifts by a banking day.
 *
 * Intended coverage is 2025–2027; the Easter computation (anonymous
 * Gregorian / Gauss-style algorithm) is valid for any Gregorian year, so the
 * helpers degrade gracefully outside that range.
 */

import { addDays, isIsoDate, isoFromParts, isoWeekday, lastDayOfMonth, splitMonthKey } from './dates.js';

/**
 * Easter Sunday for a year (anonymous Gregorian algorithm, Meeus/Jones/
 * Butcher variant of the Gauss computation).
 * @param {number} year
 * @returns {string} ISO date
 */
export const computeEasterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoFromParts(year, month, day);
};

/**
 * Public holidays observed by the company's banks (nationwide + M-V) for a
 * year, as a Set of ISO dates.
 * @param {number} year
 * @returns {Set<string>}
 */
export const germanBankHolidays = (year) => {
  const easter = computeEasterSunday(year);
  const holidays = new Set([
    isoFromParts(year, 1, 1), // New Year
    isoFromParts(year, 5, 1), // Labour Day
    isoFromParts(year, 10, 3), // German Unity Day
    isoFromParts(year, 10, 31), // Reformation Day (always M-V)
    isoFromParts(year, 12, 25), // Christmas Day
    isoFromParts(year, 12, 26), // Boxing Day
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    addDays(easter, 39), // Ascension
    addDays(easter, 50), // Whit Monday
  ]);
  // International Womens Day became an M-V public holiday in 2023.
  if (year >= 2023) holidays.add(isoFromParts(year, 3, 8));
  return holidays;
};

/**
 * Whether an ISO date is a bank business day: Mon–Fri, not a holiday, and
 * not Dec 24 / Dec 31 (bank-closed).
 * @param {string} isoDate
 * @returns {boolean}
 */
export const isBankBusinessDay = (isoDate) => {
  if (!isIsoDate(isoDate)) return false;
  const weekday = isoWeekday(isoDate);
  if (weekday === 0 || weekday === 6) return false;
  const monthDay = isoDate.slice(5);
  if (monthDay === '12-24' || monthDay === '12-31') return false;
  return !germanBankHolidays(Number(isoDate.slice(0, 4))).has(isoDate);
};

/**
 * First bank business day ON or AFTER the given date.
 * @param {string} isoDate
 * @returns {string}
 */
export const nextBankBusinessDay = (isoDate) => {
  let current = isoDate;
  let guard = 0;
  while (!isBankBusinessDay(current) && guard < 30) {
    current = addDays(current, 1);
    guard += 1;
  }
  return current;
};

/**
 * The n-th-to-last bank business day of a month (n=1 → last business day,
 * n=3 → the German SV "drittletzter Bankarbeitstag").
 * @param {string} monthKey - 'YYYY-MM'
 * @param {number} n - 1-based count from the end of the month
 * @returns {string|null} ISO date, or null for invalid input
 */
export const nthLastBankBusinessDayOfMonth = (monthKey, n) => {
  const lastDay = lastDayOfMonth(monthKey);
  if (!lastDay || !Number.isInteger(n) || n < 1) return null;
  let current = lastDay;
  let count = 0;
  let guard = 0;
  while (guard < 45) {
    if (isBankBusinessDay(current)) {
      count += 1;
      if (count === n) return current;
    }
    current = addDays(current, -1);
    guard += 1;
  }
  return null;
};

/**
 * Count of bank business days in the window (fromExclusive, toInclusive].
 * Returns 0 for same-date, inverted, or invalid ranges.
 * @param {string} fromIsoExclusive
 * @param {string} toIsoInclusive
 * @returns {number}
 */
export const bankBusinessDaysBetween = (fromIsoExclusive, toIsoInclusive) => {
  if (!isIsoDate(fromIsoExclusive) || !isIsoDate(toIsoInclusive)) return 0;
  if (toIsoInclusive <= fromIsoExclusive) return 0;
  let current = fromIsoExclusive;
  let count = 0;
  let guard = 0;
  while (current < toIsoInclusive && guard < 10000) {
    current = addDays(current, 1);
    if (isBankBusinessDay(current)) count += 1;
    guard += 1;
  }
  return count;
};

/**
 * Reuse of splitMonthKey so consumers of this module don't need dates.js for
 * month-key validation.
 */
export { splitMonthKey };
