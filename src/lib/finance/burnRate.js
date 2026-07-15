/**
 * Burn rate over a trailing window and runway projection.
 *
 * Sign convention (consistent across the engine): inflows are positive,
 * outflows negative. `totalOut` is therefore <= 0 and `net = totalIn + totalOut`.
 * A NEGATIVE net burn means the company is losing cash.
 */

import { addDays, addMonthsToDate, diffDays, isIsoDate } from './dates.js';
import { isInternalTransfer, signedAmountOf } from './movementAmount.js';

/** Average Gregorian month length (365.25 / 12) used for month↔day conversion. */
const DAYS_PER_MONTH = 30.4375;

const toFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Signed cash flow over the window (today - windowMonths, today].
 *
 * The window start is `today` moved back `windowMonths` calendar months
 * (month-end clamped) and is EXCLUSIVE; `today` is inclusive. Internal
 * transfers (see isInternalTransfer) are excluded by default so own-account
 * shuffling does not inflate `totalIn`/`totalOut`.
 *
 * @param {{
 *   movements: import('./movementAmount.js').BankMovement[],
 *   today: string,
 *   windowMonths?: number,
 *   excludeInternal?: boolean,
 * }} params
 * @returns {{ from: string, days: number, totalIn: number, totalOut: number, net: number, perDay: number, perMonth: number }}
 *   `perDay` is net/actual window days; `perMonth` is net/windowMonths.
 */
export const computeBurn = ({ movements, today, windowMonths = 3, excludeInternal = true }) => {
  const from = addMonthsToDate(today, -windowMonths);
  const days = diffDays(from, today);

  let totalIn = 0;
  let totalOut = 0;
  for (const movement of movements || []) {
    const date = movement?.postedDate;
    if (!isIsoDate(date) || date <= from || date > today) continue;
    if (excludeInternal && isInternalTransfer(movement)) continue;
    const signed = signedAmountOf(movement);
    if (signed >= 0) totalIn += signed;
    else totalOut += signed;
  }

  const net = totalIn + totalOut;
  return {
    from,
    days,
    totalIn,
    totalOut,
    net,
    perDay: days > 0 ? net / days : 0,
    perMonth: windowMonths > 0 ? net / windowMonths : 0,
  };
};

/**
 * Runway against balance + available credit.
 *
 * Only a NEGATIVE `burnPerMonth` consumes runway; zero or positive burn means
 * the runway is infinite. `zeroDate` is only projected when `today` is
 * provided (the function never reads the wall clock) and is floored to whole
 * days — the conservative side.
 *
 * @param {{ balance: number, creditAvailable?: number, burnPerMonth: number, today?: string }} params
 * @returns {{ months: number, weeks: number, zeroDate: string|null, isInfinite: boolean }}
 */
export const computeRunway = ({ balance, creditAvailable = 0, burnPerMonth, today }) => {
  const burn = toFiniteNumber(burnPerMonth);
  if (burn >= 0) {
    return { months: Infinity, weeks: Infinity, zeroDate: null, isInfinite: true };
  }

  const available = toFiniteNumber(balance) + toFiniteNumber(creditAvailable);
  const hasToday = isIsoDate(today);
  if (available <= 0) {
    return { months: 0, weeks: 0, zeroDate: hasToday ? today : null, isInfinite: false };
  }

  const months = available / Math.abs(burn);
  const runwayDays = months * DAYS_PER_MONTH;
  return {
    months,
    weeks: runwayDays / 7,
    zeroDate: hasToday ? addDays(today, Math.floor(runwayDays)) : null,
    isInfinite: false,
  };
};
