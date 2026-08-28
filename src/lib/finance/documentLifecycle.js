/**
 * Document lifecycle — the money math for receivables (CXC) and payables (CXP).
 *
 * This module exists because that math used to live inside the Firestore hooks
 * (`usePayables`, `useReceivables`), where it could not be tested. The hooks now
 * own I/O only; every amount and every status transition is decided here.
 *
 * Two rules give the layer its shape:
 *
 *   1. A document becomes `partial` or `settled` ONLY through a payment that
 *      carries a `bankMovementId`. There is no decree path. The previous
 *      `forceStatus: 'settled'` escape hatch put 27 payables (55,257 EUR) into
 *      "paid" with no cash behind them; `applyCorrection` replaces it with two
 *      honest outcomes — cancel, or reopen.
 *
 *   2. Settlement is N:M. One document may be closed by several movements
 *      (April net wages left the bank as ~10 individual transfers), and one
 *      movement may close several documents (UTA debits one consolidated amount
 *      against many per-vehicle rows). `applyPayment` handles the first
 *      direction, `allocationSummary` the second.
 *
 * Pure: no Firebase, no Date.now(), no formatting. Callers pass documents in and
 * get a plain `next` patch out; persisting it is the hook's job.
 */

import { OPEN_AMOUNT_EPSILON, roundEur } from './money.js';

/** Minimum characters for a correction reason. "pago" is not a reason. */
export const MIN_REASON_LENGTH = 5;

/** Why a transition was refused. Callers map these to user-facing copy. */
export const REJECTION = {
  NO_BANK_LINK: 'no-bank-link',
  NON_POSITIVE: 'non-positive',
  EXCEEDS_OPEN: 'exceeds-open',
  DUPLICATE_ALLOCATION: 'duplicate-allocation',
  DOCUMENT_CLOSED: 'document-closed',
  SETTLED_REQUIRES_PAYMENT: 'settled-requires-payment',
  REASON_TOO_SHORT: 'reason-too-short',
  UNKNOWN_TARGET: 'unknown-target',
  HAS_PAYMENTS: 'has-payments',
  OVER_ALLOCATED: 'over-allocated',
};

/** The only two states a human correction may force a document into. */
export const CORRECTION_TARGET = {
  CANCELLED: 'cancelled',
  REOPENED: 'reopened',
};

const STATUS = {
  ISSUED: 'issued',
  PARTIAL: 'partial',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
};

/** Spanish user-facing copy — these surface directly in the CXC/CXP views. */
const MESSAGES = {
  [REJECTION.NO_BANK_LINK]:
    'Todo pago debe vincularse a un movimiento bancario (DATEV). Conciliá desde /cxp o /cxc.',
  [REJECTION.NON_POSITIVE]: 'El importe del pago debe ser mayor que cero.',
  [REJECTION.EXCEEDS_OPEN]: 'El pago excede el saldo abierto del documento.',
  [REJECTION.DUPLICATE_ALLOCATION]:
    'Ese movimiento bancario ya está vinculado a este documento.',
  [REJECTION.DOCUMENT_CLOSED]: 'El documento está anulado: no admite pagos.',
  [REJECTION.SETTLED_REQUIRES_PAYMENT]:
    'No se puede marcar como liquidado a mano. Vinculá el movimiento bancario, o anulá el documento si es un duplicado.',
  [REJECTION.REASON_TOO_SHORT]: `El motivo debe tener al menos ${MIN_REASON_LENGTH} caracteres.`,
  [REJECTION.UNKNOWN_TARGET]: 'Corrección no permitida.',
  [REJECTION.HAS_PAYMENTS]:
    'El documento tiene pagos con respaldo bancario: no se puede anular. Reabrilo si el importe es incorrecto.',
  [REJECTION.OVER_ALLOCATED]:
    'La suma asignada supera el importe del movimiento bancario.',
};

const reject = (reason) => ({ ok: false, reason, message: MESSAGES[reason] });

const finiteOrZero = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const paymentsOf = (doc) => (Array.isArray(doc?.payments) ? doc.payments : []);

const isCancelled = (doc) => doc?.status === STATUS.CANCELLED;

/**
 * Gross value of a document. Prefers `grossAmount`, falls back to the legacy
 * `amount`. Negative, missing and non-numeric values normalize to 0.
 *
 * @param {{ grossAmount?: number, amount?: number }|null|undefined} doc
 * @returns {number}
 */
export const grossOf = (doc) => {
  const raw = doc?.grossAmount ?? doc?.amount;
  const value = finiteOrZero(raw);
  return value > 0 ? value : 0;
};

/**
 * Paid amount, evidence first.
 *
 * When the document has a `payments` array the sum of those payments IS the
 * paid amount — the stored `paidAmount` is not trusted over them. When there
 * are no payments at all the stored value survives: ~89 legacy documents carry
 * `paidAmount` with no payment records, and zeroing them would resurrect about
 * 108k EUR of phantom debt. Use `isEvidenced` to tell the two apart.
 *
 * @param {{ payments?: Array, paidAmount?: number }|null|undefined} doc
 * @returns {number}
 */
export const paidOf = (doc) => {
  const payments = paymentsOf(doc);
  if (payments.length === 0) {
    const stored = finiteOrZero(doc?.paidAmount);
    return stored > 0 ? stored : 0;
  }
  const total = payments.reduce((sum, payment) => sum + finiteOrZero(payment?.amount), 0);
  return roundEur(total);
};

/**
 * Paid amount backed by an actual bank movement. Never falls back to the
 * stored `paidAmount` — an unlinked claim is worth zero here by definition.
 *
 * @param {{ payments?: Array }|null|undefined} doc
 * @returns {number}
 */
export const evidencedPaidOf = (doc) => {
  const total = paymentsOf(doc)
    .filter((payment) => payment?.bankMovementId)
    .reduce((sum, payment) => sum + finiteOrZero(payment?.amount), 0);
  return roundEur(total);
};

/**
 * Whether every paid cent traces back to a bank movement. True for documents
 * nobody has paid yet; false for anything force-settled.
 *
 * @param {object|null|undefined} doc
 * @returns {boolean}
 */
export const isEvidenced = (doc) => {
  const paid = paidOf(doc);
  if (paid <= OPEN_AMOUNT_EPSILON) return true;
  return Math.abs(paid - evidencedPaidOf(doc)) <= OPEN_AMOUNT_EPSILON;
};

/**
 * What is still owed. Never negative; floating dust collapses to 0.
 * A cancelled document owes nothing.
 *
 * @param {object|null|undefined} doc
 * @returns {number}
 */
export const outstandingOf = (doc) => {
  if (isCancelled(doc)) return 0;
  const remainder = grossOf(doc) - paidOf(doc);
  return remainder > OPEN_AMOUNT_EPSILON ? roundEur(remainder) : 0;
};

/**
 * Status implied by the document's own amounts. `overdue` is NOT derived here:
 * it is a function of the due date against a reference day and belongs to the
 * presentation adapters.
 *
 * @param {object|null|undefined} doc
 * @returns {'issued'|'partial'|'settled'|'cancelled'}
 */
export const deriveStatus = (doc) => {
  if (isCancelled(doc)) return STATUS.CANCELLED;
  const gross = grossOf(doc);
  // A zero-value document is not "settled" — there was never anything to pay.
  if (gross <= OPEN_AMOUNT_EPSILON) return STATUS.ISSUED;
  if (outstandingOf(doc) <= OPEN_AMOUNT_EPSILON) return STATUS.SETTLED;
  return paidOf(doc) > OPEN_AMOUNT_EPSILON ? STATUS.PARTIAL : STATUS.ISSUED;
};

const amountsPatch = (doc, payments) => {
  const next = { ...doc, payments };
  const paid = paidOf(next);
  const outstanding = outstandingOf(next);
  return {
    payments,
    paidAmount: paid,
    openAmount: outstanding,
    // `pendingAmount` mirrors `openAmount`; both are persisted for backward
    // compatibility with readers that predate the canonical adapters.
    pendingAmount: outstanding,
    status: deriveStatus(next),
  };
};

/**
 * Record a payment against a document.
 *
 * The only route to `partial` or `settled`. Rejects anything without a
 * `bankMovementId`, and refuses to allocate the same movement to the same
 * document twice — that double-allocation is what left a 66.26 EUR payable
 * carrying a 132.52 EUR paid amount.
 *
 * @param {object} doc - the document as stored
 * @param {{ bankMovementId: string, amount: number, date?: string, method?: string,
 *           reference?: string, note?: string, registeredBy?: string, timestamp?: string }} payment
 * @returns {{ ok: true, next: object }|{ ok: false, reason: string, message: string }}
 */
export const applyPayment = (doc, payment) => {
  if (isCancelled(doc)) return reject(REJECTION.DOCUMENT_CLOSED);

  const bankMovementId = payment?.bankMovementId;
  if (!bankMovementId) return reject(REJECTION.NO_BANK_LINK);

  const amount = payment?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return reject(REJECTION.NON_POSITIVE);
  }

  const existing = paymentsOf(doc);
  // Checked before the balance test on purpose: re-linking a movement to an
  // already-settled document must read as "already linked", not "no balance".
  if (existing.some((entry) => entry?.bankMovementId === bankMovementId)) {
    return reject(REJECTION.DUPLICATE_ALLOCATION);
  }

  if (amount > outstandingOf(doc) + OPEN_AMOUNT_EPSILON) {
    return reject(REJECTION.EXCEEDS_OPEN);
  }

  const recorded = { ...payment, bankMovementId, amount: roundEur(amount) };
  return { ok: true, next: amountsPatch(doc, [...existing, recorded]) };
};

/**
 * Correct a document without lying about cash.
 *
 * `CANCELLED` retires a duplicate or a document that should never have existed.
 * `REOPENED` strips an unevidenced paid claim and puts the real balance back on
 * the books, keeping whatever payments do have a bank movement behind them.
 *
 * There is deliberately no path to `settled`.
 *
 * @param {object} doc
 * @param {{ target: 'cancelled'|'reopened', reason: string, actor?: string }} correction
 * @returns {{ ok: true, next: object }|{ ok: false, reason: string, message: string }}
 */
export const applyCorrection = (doc, correction) => {
  const target = correction?.target;

  // Reported ahead of every other check so the caller learns WHY the old
  // forceStatus path is gone, rather than "reason too short".
  if (target === STATUS.SETTLED) return reject(REJECTION.SETTLED_REQUIRES_PAYMENT);
  if (target !== CORRECTION_TARGET.CANCELLED && target !== CORRECTION_TARGET.REOPENED) {
    return reject(REJECTION.UNKNOWN_TARGET);
  }

  if (String(correction?.reason || '').trim().length < MIN_REASON_LENGTH) {
    return reject(REJECTION.REASON_TOO_SHORT);
  }

  if (target === CORRECTION_TARGET.CANCELLED) {
    if (evidencedPaidOf(doc) > OPEN_AMOUNT_EPSILON) return reject(REJECTION.HAS_PAYMENTS);
    return {
      ok: true,
      next: {
        status: STATUS.CANCELLED,
        openAmount: 0,
        pendingAmount: 0,
        paidAmount: 0,
        payments: [],
      },
    };
  }

  // Reopen: only bank-backed payments survive. The stored `paidAmount` is
  // cleared first — leaving it would let `paidOf`'s legacy fallback restore the
  // very claim this correction exists to withdraw.
  const evidenced = paymentsOf(doc).filter((payment) => payment?.bankMovementId);
  return {
    ok: true,
    next: amountsPatch({ ...doc, status: STATUS.ISSUED, paidAmount: 0 }, evidenced),
  };
};

/**
 * Split one bank movement across several documents.
 *
 * The other half of N:M: a single consolidated debit (one UTA charge, one
 * collective transfer) settling many documents at once. Direction is carried by
 * the movement, so only the magnitude matters here.
 *
 * @param {{ amount: number }} movement
 * @param {Array<{ documentId: string, amount: number }>} allocations
 * @returns {{ ok: true, movementAmount: number, allocated: number, remainder: number }
 *          |{ ok: false, reason: string, message: string }}
 */
export const allocationSummary = (movement, allocations) => {
  const movementAmount = roundEur(Math.abs(finiteOrZero(movement?.amount)));
  const rows = Array.isArray(allocations) ? allocations : [];

  const seen = new Set();
  let allocated = 0;
  for (const row of rows) {
    const amount = row?.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return reject(REJECTION.NON_POSITIVE);
    }
    if (seen.has(row?.documentId)) return reject(REJECTION.DUPLICATE_ALLOCATION);
    seen.add(row?.documentId);
    allocated += amount;
  }

  allocated = roundEur(allocated);
  if (allocated > movementAmount + OPEN_AMOUNT_EPSILON) {
    return reject(REJECTION.OVER_ALLOCATED);
  }

  const remainder = roundEur(movementAmount - allocated);
  return {
    ok: true,
    movementAmount,
    allocated,
    remainder: remainder > OPEN_AMOUNT_EPSILON ? remainder : 0,
  };
};
