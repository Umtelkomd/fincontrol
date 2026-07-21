/**
 * Pure financial engine — public surface.
 *
 * Everything here is side-effect free: no Firebase, no Date.now(), no
 * formatting. Callers pass `today` and plain arrays in; raw numbers come
 * out (round with `roundEur` at the presentation boundary).
 *
 * `dates.js` is internal plumbing and intentionally not re-exported.
 */

export * from './money.js';
export * from './movementAmount.js';
export * from './cashPosition.js';
export * from './burnRate.js';
export * from './aging.js';
export * from './obligations.js';
export * from './forecast.js';
export * from './alerts.js';
export * from './bankingDays.js';
export * from './fiscalCalendar.js';
