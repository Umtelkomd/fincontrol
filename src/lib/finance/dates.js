/**
 * Calendar-date math on strict 'YYYY-MM-DD' ISO strings.
 *
 * All arithmetic happens in UTC so results never drift across DST switches
 * or host timezones. No function reads the wall clock — callers always pass
 * dates in.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Strict guard for 'YYYY-MM-DD' strings (date-only; datetime strings fail).
 * @param {unknown} value
 * @returns {boolean}
 */
export const isIsoDate = (value) => typeof value === 'string' && ISO_DATE_RE.test(value);

/** Epoch milliseconds of an ISO date at 00:00 UTC. */
const utcMsOf = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Build a 'YYYY-MM-DD' string from numeric parts (month/day 1-based).
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {string}
 */
export const isoFromParts = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

/**
 * Add calendar days (negative allowed) to an ISO date.
 * @param {string} isoDate
 * @param {number} days
 * @returns {string}
 */
export const addDays = (isoDate, days) => {
  const date = new Date(utcMsOf(isoDate));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Signed day distance: positive when `toIso` is after `fromIso`.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
export const diffDays = (fromIso, toIso) =>
  Math.round((utcMsOf(toIso) - utcMsOf(fromIso)) / DAY_MS);

/**
 * Day of week in UTC: 0 = Sunday … 6 = Saturday.
 * @param {string} isoDate
 * @returns {number}
 */
export const isoWeekday = (isoDate) => new Date(utcMsOf(isoDate)).getUTCDay();

/**
 * The Monday that starts the week containing `isoDate` (weeks run Mon–Sun).
 * @param {string} isoDate
 * @returns {string}
 */
export const mondayOfWeek = (isoDate) => {
  const shift = (isoWeekday(isoDate) + 6) % 7;
  return addDays(isoDate, -shift);
};

/**
 * Month key ('YYYY-MM') of an ISO date.
 * @param {string} isoDate
 * @returns {string}
 */
export const monthKeyOf = (isoDate) => isoDate.slice(0, 7);

/**
 * Parse a 'YYYY-MM' month key. Returns null for anything malformed or with a
 * month outside 01–12.
 * @param {string} monthKey
 * @returns {{ year: number, month: number }|null}
 */
export const splitMonthKey = (monthKey) => {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return null;
  const [year, month] = monthKey.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  return { year, month };
};

/**
 * Add whole months (negative allowed) to a 'YYYY-MM' month key.
 * @param {string} monthKey
 * @param {number} months
 * @returns {string|null}
 */
export const addMonthKey = (monthKey, months) => {
  const parts = splitMonthKey(monthKey);
  if (!parts) return null;
  const total = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  return `${year}-${pad2(month)}`;
};

/** Number of calendar days in a month (month 1-based). */
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Last calendar day of a 'YYYY-MM' month key as an ISO date.
 * @param {string} monthKey
 * @returns {string|null}
 */
export const lastDayOfMonth = (monthKey) => {
  const parts = splitMonthKey(monthKey);
  if (!parts) return null;
  return isoFromParts(parts.year, parts.month, daysInMonth(parts.year, parts.month));
};

/**
 * Move an ISO date by whole months, clamping the day to the last day of the
 * target month (2026-05-31 minus 3 months → 2026-02-28).
 * @param {string} isoDate
 * @param {number} months
 * @returns {string}
 */
export const addMonthsToDate = (isoDate, months) => {
  const day = Number(isoDate.slice(8, 10));
  const targetKey = addMonthKey(monthKeyOf(isoDate), months);
  const { year, month } = splitMonthKey(targetKey);
  return isoFromParts(year, month, Math.min(day, daysInMonth(year, month)));
};
