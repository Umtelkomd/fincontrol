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

import { categoryByName } from '../../finance/taxonomy.js';

/** German "Umbuchung" (internal rebooking) as a whole word. */
const REBOOKING_RE = /\bumbuchung\b/i;

/** Filed under the taxonomy's internal category ("Transferencia interna"). */
const isInternalCategory = (movement) =>
  categoryByName(movement?.categoryName)?.type === 'internal' || categoryByName(movement?.category)?.type === 'internal';

/**
 * Fields the rebooking keyword may legitimately appear in. The own-company name
 * is deliberately NOT looked for here — see `isOwnCompanyCounterparty`.
 */
const REBOOKING_FIELDS = ['counterpartyName', 'description', 'categoryName', 'category', 'vendor'];

/** The company's own name, as a bare token. */
const OWN_COMPANY_TOKEN = 'umtelkomd';

/**
 * German legal forms that may trail the company's own name without turning it
 * into a different company. Anything else disqualifies the match.
 */
const LEGAL_FORM_TOKENS = new Set(['gmbh', 'mbh', 'ag', 'ug', 'kg', 'kgaa', 'ohg', 'gbr', 'ek', 'co']);

/**
 * Counterparty text reduced to comparable tokens: accents folded, punctuation
 * turned into separators, case dropped. `UMTELKOMD ESPA.A S.L.` and
 * `UMTELKOMD ESPAÑA S.L.` therefore tokenize the same way.
 *
 * @param {string} value
 * @returns {string[]}
 */
const nameTokens = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Is this counterparty UMTELKOMD GmbH ITSELF (⇒ own-account transfer)?
 *
 * ── Why this is an allow-list and not /umtelkomd/i ─────────────────────────
 * There are TWO entities whose names differ by one word:
 *
 *   UMTELKOMD GmbH            the company. 29 movements, 72.9k € out / 85.7k € in.
 *   UMTELKOMD ESPAÑA S.L.     a SUBCONTRACTOR a contact registered under an
 *                             almost identical name. 15 movements, ~48.1k € of
 *                             real construction cost, spelled in the ledger as
 *                             "UMTELKOMD ESPA.A SOCIEDAD LIMITADA",
 *                             "UMTELKOMD ESPANA S.L.",
 *                             "UMTELKOMD ESPANA SOCIEDAD LIMITADA" and
 *                             "UMTELKOMD ESPA.A S.L.".
 *
 * A substring match swallows both, and silently deleting 48k € of obra cost is
 * far worse than the double-counted transfers this predicate exists to fix. So
 * the rule is inverted: the name matches only when EVERY token is either the
 * company token itself or a German legal form. Any extra qualifier —
 * `espa`, `espana`, `sociedad`, `limitada`, a future `polska` — means a
 * different company and returns false.
 *
 * Only the counterparty field is inspected. "Umtelkomd GmbH" also appears
 * inside the DATEV purpose line of customs payments, supplier invoices and
 * client collections; reading it out of free text would hide real money.
 *
 * @param {string} counterpartyName
 * @returns {boolean}
 */
const isOwnCompanyCounterparty = (counterpartyName) => {
  const tokens = nameTokens(counterpartyName);
  if (!tokens.includes(OWN_COMPANY_TOKEN)) return false;
  return tokens.every((token) => token === OWN_COMPANY_TOKEN || LEGAL_FORM_TOKENS.has(token));
};

/**
 * Conservative internal-transfer heuristic. A movement is internal only when:
 *
 *   1. `kind === 'transfer'` (explicitly categorized), or
 *   2. its category is the taxonomy's internal one ("Transferencia interna"),
 *      the declaration a user makes in the categorize form, or
 *   3. the counterparty IS the company itself (see `isOwnCompanyCounterparty`
 *      — an allow-list, not a substring match), or
 *   4. the whole word "Umbuchung" appears in the counterparty, description,
 *      category or vendor (bank wording for internal rebooking;
 *      "Überweisung" — an ordinary transfer to a third party — never matches).
 *
 * Deliberately narrow: a false negative only leaves a transfer inside an
 * operating total (where its two legs largely cancel), while a false positive
 * would silently hide real revenue or spend.
 *
 * WHERE THIS APPLIES: P&L only — income/expense totals, category breakdowns,
 * budget actuals, project cost and margins. It must NEVER reach the cash
 * position, the reconciliation anchors, the forecast or the runway: that money
 * really did leave and enter the main account, and the balance is only correct
 * if it counts.
 *
 * @param {BankMovement|null|undefined} movement
 * @returns {boolean}
 */
export const isInternalTransfer = (movement) => {
  if (!movement) return false;
  if (String(movement.kind || '').toLowerCase() === 'transfer') return true;
  if (isInternalCategory(movement)) return true;
  if (isOwnCompanyCounterparty(movement.counterpartyName)) return true;
  return REBOOKING_FIELDS.some((field) => REBOOKING_RE.test(String(movement[field] || '')));
};

/** Default magnitude of a movement, ignoring sign. */
const defaultAmountOf = (movement) => Math.abs(Number(movement?.amount) || 0);

/**
 * Split movements into what an operating (P&L) total may count and what it may
 * not, mirroring `splitPayrollSettlements` so both exclusions read the same way.
 *
 * @param {Array<BankMovement>} movements
 * @param {{ amountOf?: (movement: BankMovement) => number }} [options]
 *   `amountOf` lets the caller keep its own convention — screens that measure
 *   cost NET of VAT pass their net resolver.
 * @returns {{
 *   operationalMovements: Array<BankMovement>,
 *   internalTransfers: Array<BankMovement>,
 *   inflowTotal: number,
 *   outflowTotal: number,
 *   excludedTotal: number,
 * }}
 */
export const splitInternalTransfers = (movements, options = {}) => {
  const amountOf = typeof options.amountOf === 'function' ? options.amountOf : defaultAmountOf;

  const operationalMovements = [];
  const internalTransfers = [];
  let inflowTotal = 0;
  let outflowTotal = 0;

  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    if (!isInternalTransfer(movement)) {
      operationalMovements.push(movement);
      return;
    }
    internalTransfers.push(movement);
    const amount = Math.abs(amountOf(movement));
    if (movement?.direction === 'out') outflowTotal += amount;
    else inflowTotal += amount;
  });

  return {
    operationalMovements,
    internalTransfers,
    inflowTotal,
    outflowTotal,
    excludedTotal: inflowTotal + outflowTotal,
  };
};
