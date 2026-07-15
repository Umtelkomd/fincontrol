/**
 * Money helpers for the pure finance engine.
 *
 * Amounts are floats coming from Firestore. The engine keeps raw sums
 * internally and rounds ONLY at presentation boundaries — `roundEur` is that
 * boundary helper. Nothing in this layer formats or localizes numbers.
 */

/**
 * Floating dust threshold: receivable/payable docs carry residual cents from
 * partial-payment arithmetic (e.g. openAmount === 0.0000001). Anything at or
 * below this epsilon is treated as settled.
 * @type {number}
 */
export const OPEN_AMOUNT_EPSILON = 0.005;

/**
 * Round to 2 decimals, half-up (halves round AWAY from zero, the German
 * commercial rounding convention). Presentation-boundary helper only.
 *
 * A scale-relative epsilon nudges binary-float artifacts like 1.005
 * (stored as 1.00499…) over the half so they round up as intended.
 * Non-finite or non-number input normalizes to 0.
 *
 * @param {number} value
 * @returns {number}
 */
export const roundEur = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(value) * 100 * (1 + Number.EPSILON));
  return cents === 0 ? 0 : (sign * cents) / 100;
};

/**
 * Whether a numeric amount counts as "open" money (strictly above the
 * dust epsilon).
 *
 * @param {number} value
 * @returns {boolean}
 */
export const isOpenAmount = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > OPEN_AMOUNT_EPSILON;

/**
 * Default open-amount reader for receivable/payable docs. Reads `openAmount`
 * and normalizes missing or invalid values to 0. Modules that accept an
 * `openAmountOf` override use this as their default.
 *
 * @param {{ openAmount?: number }|null|undefined} doc
 * @returns {number}
 */
export const openAmountOf = (doc) => {
  const value = doc?.openAmount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};
