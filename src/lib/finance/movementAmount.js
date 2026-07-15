/**
 * Bank-movement amount semantics.
 *
 * @typedef {Object} BankMovement
 * @property {string} postedDate - 'YYYY-MM-DD'
 * @property {string} [valueDate] - 'YYYY-MM-DD'
 * @property {number} amount - unsigned magnitude
 * @property {number} [signedAmount] - signed amount; movements imported before
 *   May 2026 have it missing or 0 and are NOT usable
 * @property {'in'|'out'} [direction]
 * @property {string} [kind]
 * @property {string} [status] - e.g. 'posted'
 * @property {string} [counterpartyName]
 * @property {string} [description]
 * @property {string} [receivableId]
 * @property {string} [payableId]
 * @property {string} [projectId]
 * @property {string} [costCenterId]
 */

/**
 * Signed amount of a movement.
 *
 * Rule: a `signedAmount` that is a nonzero finite number wins. Otherwise fall
 * back to `direction === 'out' ? -Math.abs(amount) : Math.abs(amount)` —
 * i.e. any direction other than 'out' is treated as an inflow, matching the
 * legacy import convention. Missing/invalid amounts yield 0.
 *
 * @param {BankMovement|null|undefined} movement
 * @returns {number}
 */
export const signedAmountOf = (movement) => {
  if (!movement) return 0;
  const { signedAmount } = movement;
  if (typeof signedAmount === 'number' && Number.isFinite(signedAmount) && signedAmount !== 0) {
    return signedAmount;
  }
  const { amount } = movement;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0;
  return movement.direction === 'out' ? -Math.abs(amount) : Math.abs(amount);
};

/** German "Umbuchung" (internal rebooking) as a whole word. */
const REBOOKING_RE = /\bumbuchung\b/i;
/** The company's own name as counterparty ⇒ same-owner account transfer. */
const OWN_COMPANY_RE = /umtelkomd/i;

/**
 * Conservative internal-transfer heuristic, used to exclude own-account
 * shuffling from burn-rate math. A movement is internal only when:
 *
 *   1. `kind === 'transfer'` (explicitly categorized), or
 *   2. the counterparty is the company itself (UMTELKOMD ⇒ money moved
 *      between own accounts), or
 *   3. the description or counterparty contains the whole word "Umbuchung"
 *      (bank wording for internal rebooking; "Überweisung" never matches).
 *
 * Deliberately narrow: a false negative only leaves a transfer inside the
 * burn window (where its two legs cancel in `net`), while a false positive
 * would silently hide real revenue or spend.
 *
 * @param {BankMovement|null|undefined} movement
 * @returns {boolean}
 */
export const isInternalTransfer = (movement) => {
  if (!movement) return false;
  if (String(movement.kind || '').toLowerCase() === 'transfer') return true;
  const counterparty = String(movement.counterpartyName || '');
  if (OWN_COMPANY_RE.test(counterparty)) return true;
  if (REBOOKING_RE.test(counterparty)) return true;
  return REBOOKING_RE.test(String(movement.description || ''));
};
