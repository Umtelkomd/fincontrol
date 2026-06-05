/**
 * Banking-day calendar for Mecklenburg-Vorpommern (M-V), Germany.
 *
 * Pure module — no Date stored, no Firebase, plain 'YYYY-MM-DD' ISO strings only.
 * Used to compute German payroll due dates (Krankenkassen drittletzter
 * Bankarbeitstag, Lohnsteuer 10th-of-following-month, net-wages transfer date).
 *
 * M-V specifics that MUST be honored (else KK due dates drift by a banking day):
 *   - Reformationstag (10-31) is ALWAYS a public holiday in M-V.
 *   - Internationaler Frauentag (03-08) is a M-V public holiday since 2023.
 *   - Fronleichnam and Allerheiligen are NOT M-V holidays — excluded.
 */

const pad2 = (n) => String(n).padStart(2, '0');

/** Build a 'YYYY-MM-DD' string from numeric parts (month is 1-based). */
const iso = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

/**
 * Compute Ostersonntag (Easter Sunday) for a given year using the
 * Anonymous Gregorian (Meeus/Jones/Butcher) algorithm.
 * @param {number} year
 * @returns {string} ISO date of Easter Sunday
 */
export const computeEaster = (year) => {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
};

/** Add `days` to an ISO date in UTC and return the resulting ISO date. */
const addIsoDays = (isoDate, days) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

/**
 * Set of M-V public holidays for a given year as 'YYYY-MM-DD' strings.
 * @param {number} year
 * @returns {Set<string>}
 */
export const mvHolidays = (year) => {
  const easter = computeEaster(year);
  const set = new Set([
    iso(year, 1, 1), // Neujahr
    iso(year, 5, 1), // Tag der Arbeit
    iso(year, 10, 3), // Tag der Deutschen Einheit
    iso(year, 10, 31), // Reformationstag — always a holiday in M-V
    iso(year, 12, 25), // 1. Weihnachtsfeiertag
    iso(year, 12, 26), // 2. Weihnachtsfeiertag
    addIsoDays(easter, -2), // Karfreitag
    addIsoDays(easter, 1), // Ostermontag
    addIsoDays(easter, 39), // Christi Himmelfahrt
    addIsoDays(easter, 50), // Pfingstmontag
  ]);
  // Internationaler Frauentag became a M-V public holiday in 2023.
  if (year >= 2023) set.add(iso(year, 3, 8));
  return set;
};

/** Day-of-week for an ISO date in UTC (0 = Sunday … 6 = Saturday). */
const isoWeekday = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * Whether an ISO date is a banking day: not Saturday/Sunday and not a M-V holiday.
 * @param {string} isoDate
 * @returns {boolean}
 */
export const isBankingDay = (isoDate) => {
  if (!isoDate) return false;
  const dow = isoWeekday(isoDate);
  if (dow === 0 || dow === 6) return false;
  // Heiligabend (24.12) and Silvester (31.12) are bank-closed for German
  // SV-Fälligkeit purposes (Bundesbank/TARGET2 closed) even though they are not
  // public holidays — otherwise the December drittletzter Bankarbeitstag drifts.
  const mmdd = isoDate.slice(5);
  if (mmdd === '12-24' || mmdd === '12-31') return false;
  const year = Number(isoDate.slice(0, 4));
  return !mvHolidays(year).has(isoDate);
};

/**
 * The first banking day on or after the given date.
 * @param {string} isoDate
 * @returns {string}
 */
export const nextBankingDay = (isoDate) => {
  let cur = isoDate;
  let guard = 0;
  while (!isBankingDay(cur) && guard < 30) {
    cur = addIsoDays(cur, 1);
    guard += 1;
  }
  return cur;
};

/**
 * The first banking day on or before the given date.
 * @param {string} isoDate
 * @returns {string}
 */
export const previousBankingDay = (isoDate) => {
  let cur = isoDate;
  let guard = 0;
  while (!isBankingDay(cur) && guard < 30) {
    cur = addIsoDays(cur, -1);
    guard += 1;
  }
  return cur;
};

/** Last calendar day of a month (month is 1-based). */
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The n-th-to-last banking day of a month (n=1 → last banking day,
 * n=3 → drittletzter Bankarbeitstag).
 * @param {number} year
 * @param {number} month - 1-based
 * @param {number} n - 1-based count from the end
 * @returns {string} ISO date
 */
export const nthToLastBankingDayOfMonth = (year, month, n) => {
  let cur = iso(year, month, lastDayOfMonth(year, month));
  let count = 0;
  let guard = 0;
  while (guard < 40) {
    if (isBankingDay(cur)) {
      count += 1;
      if (count === n) return cur;
    }
    cur = addIsoDays(cur, -1);
    guard += 1;
  }
  return cur;
};

/**
 * Count of banking days from `fromIso` to `toIso` (signed). 0 when equal,
 * negative when `toIso` is in the past. Counts banking-day steps, so a
 * weekend gap between two adjacent banking days counts as a single step.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
export const bankingDaysBetween = (fromIso, toIso) => {
  if (!fromIso || !toIso || fromIso === toIso) return 0;
  const forward = fromIso < toIso;
  const step = forward ? 1 : -1;
  let cur = fromIso;
  let count = 0;
  let guard = 0;
  while (cur !== toIso && guard < 5000) {
    cur = addIsoDays(cur, step);
    if (isBankingDay(cur)) count += 1;
    guard += 1;
  }
  return forward ? count : -count;
};

export default {
  computeEaster,
  mvHolidays,
  isBankingDay,
  nextBankingDay,
  previousBankingDay,
  nthToLastBankingDayOfMonth,
  bankingDaysBetween,
};
