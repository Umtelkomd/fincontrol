/**
 * Batch reconciliation — matching one incoming transfer to several invoices.
 *
 * UMTELKOMD invoices Insyte, and Insyte pays through CONFIRMING: a single
 * transfer arriving from CaixaBank, BBVA or Santander settles a handful of
 * invoices at once (77.590,18 € · 69.273,68 € · 42.281,66 € …). No bank
 * movement ever equals one document, so the one-invoice-per-movement flow in
 * `useClassifier` could never close them. The ledger drifted into showing
 * 225.166 € of receivables that had already been paid — money the aging
 * reported as overdue and the forecast expected to arrive twice.
 *
 * This module is the decision layer behind the batch screen. It answers three
 * questions and nothing else:
 *
 *   which invoices could this transfer have paid?   → buildBatchCandidates
 *   does the ticked selection add up?               → summarizeSelection
 *   is there one combination worth proposing?       → suggestCombination
 *
 * plus `resolveBatchAllocations`, the invariant gate the write path runs before
 * it touches Firestore.
 *
 * Two rules shape everything here:
 *
 *   1. The DIFFERENCE IS THE PRODUCT. A batch that does not add up means an
 *      invoice is missing, not that the tool should quietly cap the selection.
 *      Nothing in this module silently truncates an allocation to make the
 *      numbers work.
 *   2. SILENCE BEATS A WRONG GUESS. `suggestCombination` returns nothing when
 *      more than one subset hits the same total: a false suggestion moves money
 *      onto the wrong invoice, and nobody would notice.
 *
 * Pure: no React, no Firebase, no wall clock.
 */

import { clampMoney, getGrossAmount, getOpenAmount, getPaidAmount } from './utils';

/** One cent. Below this, two euro amounts are the same amount. */
export const RECONCILIATION_TOLERANCE = 0.01;

/**
 * Payment lines written by `scripts/settle-collected-receivables.cjs` carry
 * this id prefix. They record "collected via confirming, batch unknown" — a
 * placeholder a real reconciliation must REPLACE, never stack on top of, or the
 * invoice ends up paid twice in its own payment history.
 */
export const BULK_SETTLE_PAYMENT_PREFIX = 'bulk-settle-';

/** Widest pool `suggestCombination` will search, oldest invoices first. */
export const MAX_SUGGESTION_CANDIDATES = 12;

/** Largest subset `suggestCombination` will propose. */
export const MAX_SUGGESTION_INVOICES = 6;

/**
 * Company-form and branch words. They are noise for identity: "Insyte" and
 * "Insyte Deutschland GmbH" are the same payer, and the bank writes the name
 * differently every time.
 */
const LEGAL_FORM_TOKENS = new Set([
  'gmbh', 'mbh', 'ug', 'ag', 'kg', 'kgaa', 'ohg', 'gbr', 'ev', 'eg',
  'sa', 'sl', 'slu', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv', 'oy', 'ab',
  'ltd', 'limited', 'plc', 'inc', 'llc', 'corp', 'company',
  'branch', 'sucursal', 'niederlassung', 'filiale',
]);

/** Identity tokens must be this long to be matched as a substring. */
const MIN_IDENTITY_TOKEN_LENGTH = 3;

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    // German folds the bank applies inconsistently: "Roßdorf" arrives as
    // "ROSSDORF" and "Österreich" as "OSTERREICH", so both spellings have to
    // reduce to the same tokens. Eszett is a letter, not a diacritic, and
    // survives NFD untouched — it needs its own rule.
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const tokenize = (value) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The words that actually identify a payer, with company forms, punctuation
 * fragments ("S.A." → "s", "a") and pure numbers removed.
 *
 * @param {string} name
 * @returns {string[]}
 */
export const identityTokens = (name) =>
  tokenize(name).filter(
    (token) =>
      token.length >= MIN_IDENTITY_TOKEN_LENGTH &&
      !LEGAL_FORM_TOKENS.has(token) &&
      !/^\d+$/.test(token),
  );

/**
 * Everything the bank told us about who sent the money.
 *
 * A confirming settlement names the FACTOR, not the client: `counterpartyName`
 * is "CAIXABANK S.A." or "BANCO BILBAO VIZCAYA ARGENTARIA S", and the only
 * trace of Insyte sits in the DATEV purpose text. Both are searched.
 */
const movementHaystack = (movement) =>
  normalize(
    [movement?.counterpartyName, movement?.description, movement?.documentNumber]
      .filter(Boolean)
      .join(' '),
  );

/**
 * Could this transfer have come from this client?
 *
 * EVERY identity token of the client name must appear in the bank text. That
 * strictness is load-bearing, not caution for its own sake: production carries
 * both "Insyte Deutschland GmbH" and "Insyte Österreich GmbH", and a movement
 * from the Austrian entity must not offer up German invoices. Requiring all
 * tokens separates them; requiring only one would not.
 *
 * The cost is a false negative when the bank abbreviates a client's name past
 * recognition. That surfaces as an empty candidate list — visible and safe —
 * whereas a false positive silently puts money on another client's invoice.
 *
 * @param {object} movement
 * @param {object} receivable
 * @returns {boolean}
 */
export const movementMatchesClient = (movement, receivable) => {
  const tokens = identityTokens(receivable?.counterpartyName || receivable?.client);
  if (tokens.length === 0) return false;
  const haystack = movementHaystack(movement);
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
};

/**
 * Payment lines as STORED, not as adapted.
 *
 * `adaptReceivableDoc` runs `payments` through `normalizePayments`, which drops
 * `bankMovementId` and `reconciliationMode`. Rebuilding the array from that
 * copy would erase the bank link of every earlier reconciliation, so anything
 * that rewrites `payments` has to start from `raw`.
 *
 * @param {object} receivable
 * @returns {object[]}
 */
export const rawPaymentsOf = (receivable) => {
  const raw = receivable?.raw?.payments;
  if (Array.isArray(raw)) return raw;
  return Array.isArray(receivable?.payments) ? receivable.payments : [];
};

/** A placeholder line left by the bulk closing script. */
export const isBulkSettlePayment = (payment) =>
  typeof payment?.id === 'string' && payment.id.startsWith(BULK_SETTLE_PAYMENT_PREFIX);

/** The bulk placeholder lines a real reconciliation would replace. */
export const supersededPaymentsOf = (receivable) => rawPaymentsOf(receivable).filter(isBulkSettlePayment);

/** How much money the bulk closure claimed without naming a bank movement. */
export const supersededAmountOf = (receivable) =>
  clampMoney(supersededPaymentsOf(receivable).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));

/**
 * The `reconciliationPending` flag the closing script stamped. Read through
 * `raw` as well — the adapter does not surface it.
 */
export const isReconciliationPending = (receivable) =>
  Boolean(receivable?.reconciliationPending ?? receivable?.raw?.reconciliationPending);

/**
 * How much of an invoice a batch may still claim.
 *
 * Open balance PLUS whatever the bulk closure closed without a bank movement:
 * that money is not really reconciled, it is only marked paid, so a real batch
 * is allowed to take it over. An invoice settled against an actual movement
 * contributes nothing and can never be picked up twice.
 *
 * @param {object} receivable
 * @returns {number}
 */
export const reconcilableAmountOf = (receivable) =>
  clampMoney(getOpenAmount(receivable) + supersededAmountOf(receivable));

const isLiveCollection = (movement) =>
  Boolean(movement) && movement.direction === 'in' && movement.status !== 'void';

/**
 * How much of a transfer is still waiting for a document.
 *
 * Under-allocation is allowed, so a remesa can legitimately leave the screen
 * half explained — the operator ticks the invoices they have and comes back
 * when the missing one is loaded. That only works if the transfer stays
 * reachable and the second pass can claim no more than the first one left, so
 * both facts are derived from `receivableAllocations`, the per-document record
 * every reconciliation writes onto the movement.
 *
 * A movement linked the old one-to-one way carries no measurable allocation.
 * It counts as fully explained on purpose: resurfacing it would invite a second
 * reconciliation of money that has already been applied, and nothing here can
 * prove how much that was.
 *
 * @param {object} movement
 * @returns {number}
 */
export const unreconciledAmountOf = (movement) => {
  const amount = clampMoney(Math.abs(Number(movement?.amount) || 0));
  const allocations = Array.isArray(movement?.receivableAllocations) ? movement.receivableAllocations : [];
  const linked =
    Boolean(movement?.receivableId) ||
    (Array.isArray(movement?.receivableIds) ? movement.receivableIds.length : 0) > 0 ||
    allocations.length > 0;
  if (!linked) return amount;

  const allocated = allocations.length
    ? clampMoney(allocations.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0))
    : clampMoney(Number(movement?.reconciledAmount) || 0);
  if (allocated <= 0) return 0;

  return clampMoney(Math.max(0, amount - allocated));
};

/** A live incoming transfer that still has money nobody has explained. */
export const isPendingBatch = (movement) =>
  isLiveCollection(movement) && unreconciledAmountOf(movement) > RECONCILIATION_TOLERANCE;

const sortKey = (receivable) => ({
  issue: receivable?.issueDate || '9999-12-31',
  due: receivable?.dueDate || '9999-12-31',
  document: String(receivable?.documentNumber || ''),
  id: String(receivable?.id || ''),
});

/**
 * The invoices this collection could plausibly have paid.
 *
 * Same client, issued on or before the day the money landed, still carrying
 * money a batch may claim, not cancelled. Sorted oldest first, which is the
 * order confirming actually pays in.
 *
 * @param {{ movement: object, receivables: object[] }} params
 * @returns {object[]}
 */
export const buildBatchCandidates = ({ movement, receivables }) => {
  if (!isLiveCollection(movement)) return [];
  const paidOn = movement.postedDate || movement.valueDate || '';

  return (Array.isArray(receivables) ? receivables : [])
    .filter((receivable) => {
      if (!receivable?.id) return false;
      if (receivable.status === 'cancelled') return false;
      if (reconcilableAmountOf(receivable) <= RECONCILIATION_TOLERANCE) return false;
      // An invoice issued after the money arrived cannot be what it paid. An
      // invoice with no issue date proves nothing either way, so it stays.
      if (paidOn && receivable.issueDate && receivable.issueDate > paidOn) return false;
      return movementMatchesClient(movement, receivable);
    })
    .sort((left, right) => {
      const a = sortKey(left);
      const b = sortKey(right);
      return (
        a.issue.localeCompare(b.issue) ||
        a.due.localeCompare(b.due) ||
        a.document.localeCompare(b.document) ||
        a.id.localeCompare(b.id)
      );
    });
};

/**
 * The ticked selection against the transfer.
 *
 * `difference` is what the bank still has unexplained: positive means invoices
 * are missing from the selection, negative means more was ticked than arrived.
 * It is returned rounded to the cent and is never suppressed — a batch that
 * does not add up is the whole signal this screen exists to show.
 *
 * `movementAmount` is the part of the transfer still open for allocation. For
 * an untouched movement that IS the full transfer; for one an earlier pass
 * already explained in part, it is the remainder, so the difference keeps
 * meaning the same thing on the second sitting.
 *
 * @param {{ movement: object, selected: object[] }} params
 * @returns {{ selectedTotal: number, movementAmount: number, difference: number, status: 'exact'|'under'|'over' }}
 */
export const summarizeSelection = ({ movement, selected }) => {
  const movementAmount = unreconciledAmountOf(movement);
  const selectedTotal = clampMoney(
    (Array.isArray(selected) ? selected : []).reduce(
      (sum, entry) => sum + reconcilableAmountOf(entry),
      0,
    ),
  );
  const difference = clampMoney(movementAmount - selectedTotal);

  let status = 'exact';
  if (difference > RECONCILIATION_TOLERANCE) status = 'under';
  else if (difference < -RECONCILIATION_TOLERANCE) status = 'over';

  return { selectedTotal, movementAmount, difference, status };
};

/** Ticked invoices → the `[{ receivableId, amount }]` shape the write path takes. */
export const buildAllocationDraft = (selected) =>
  (Array.isArray(selected) ? selected : []).map((receivable) => ({
    receivableId: receivable.id,
    amount: reconcilableAmountOf(receivable),
  }));

/**
 * Find the subset of candidates that sums to the transfer — or say nothing.
 *
 * Bounded on purpose: the pool is capped at MAX_SUGGESTION_CANDIDATES (oldest
 * first) and subsets at `maxInvoices`, so the search is at most a few thousand
 * combinations and cannot stall the screen. `truncated` says when the cap bit.
 *
 * The honesty rule lives here. When two or more DIFFERENT subsets reach the
 * same total, there is no way to know which invoices the factor actually paid,
 * so nothing is proposed and `alternatives` reports how many were found — the
 * screen turns that into "hay varias combinaciones posibles, revisalo". A
 * suggestion that is wrong is worse than no suggestion: the user confirms it,
 * and the money lands on an invoice nobody will look at again.
 *
 * @param {{ movement: object, candidates: object[], maxInvoices?: number }} params
 * @returns {{ combination: object[]|null, total: number, alternatives: number, truncated: boolean, searched: number }}
 */
export const suggestCombination = ({ movement, candidates, maxInvoices = MAX_SUGGESTION_INVOICES }) => {
  const target = clampMoney(Math.abs(Number(movement?.amount) || 0));
  const usable = (Array.isArray(candidates) ? candidates : []).filter(
    (entry) => reconcilableAmountOf(entry) > RECONCILIATION_TOLERANCE,
  );
  const truncated = usable.length > MAX_SUGGESTION_CANDIDATES;
  const pool = usable.slice(0, MAX_SUGGESTION_CANDIDATES);
  const limit = Math.min(Math.max(1, Number(maxInvoices) || MAX_SUGGESTION_INVOICES), MAX_SUGGESTION_INVOICES);
  const empty = { combination: null, total: 0, alternatives: 0, truncated, searched: pool.length };

  if (target <= RECONCILIATION_TOLERANCE || pool.length === 0) return empty;

  const amounts = pool.map(reconcilableAmountOf);
  const matches = [];

  // Depth-first over index combinations. Every amount is positive, so a prefix
  // already above the target can never come back down — that prune is what
  // keeps the walk small.
  const walk = (start, picked, sum) => {
    if (sum > target + RECONCILIATION_TOLERANCE) return;
    if (picked.length > 0 && Math.abs(sum - target) <= RECONCILIATION_TOLERANCE) {
      matches.push([...picked]);
      // A superset of an exact match would overshoot, so stop descending.
      return;
    }
    if (picked.length >= limit) return;
    for (let index = start; index < pool.length; index += 1) {
      picked.push(index);
      walk(index + 1, picked, clampMoney(sum + amounts[index]));
      picked.pop();
    }
  };
  walk(0, [], 0);

  if (matches.length !== 1) {
    return { ...empty, alternatives: matches.length };
  }

  const combination = matches[0].map((index) => pool[index]);
  return {
    combination,
    total: clampMoney(matches[0].reduce((sum, index) => sum + amounts[index], 0)),
    alternatives: 1,
    truncated,
    searched: pool.length,
  };
};

const documentLabel = (receivable) =>
  receivable?.documentNumber || receivable?.counterpartyName || receivable?.id;

const eur = (value) => `${clampMoney(value).toFixed(2)} €`;

const failure = (message) => ({ error: message });

/**
 * Turn a `[{ receivableId, amount }]` draft into the plan the write path
 * applies — or refuse it with a reason a human can act on.
 *
 * Every invariant that protects the ledger lives here, so the hook stays pure
 * plumbing and each rule is testable without Firestore:
 *
 *   · the movement is a live INCOMING collection
 *   · every invoice is loaded, not cancelled, and appears once
 *   · every amount is real money (above one cent)
 *   · no invoice receives more than it still has open
 *   · the batch never totals more than the bank actually sent
 *
 * Under-allocation is deliberately ALLOWED. A confirming remesa routinely
 * covers invoices that are not in the system yet; refusing the whole batch for
 * that is exactly the rigidity that made these transfers unreconcilable. The
 * gap comes back as `difference`/`status` for the screen to show.
 *
 * @param {{ movement: object, allocations: Array<{receivableId: string, amount: number}>, receivables: object[] }} params
 * @returns {{ error: string }|{ allocations: object[], total: number, movementAmount: number, difference: number, status: string }}
 */
export const resolveBatchAllocations = ({ movement, allocations, receivables }) => {
  if (!movement?.id) return failure('Movimiento bancario inválido');
  if (!isLiveCollection(movement)) {
    return failure('Solo un cobro entrante vigente puede conciliar facturas de venta');
  }

  const draft = Array.isArray(allocations) ? allocations : [];
  if (draft.length === 0) return failure('Seleccioná al menos una factura');

  const byId = new Map((Array.isArray(receivables) ? receivables : []).map((entry) => [entry?.id, entry]));
  const seen = new Set();
  const resolved = [];
  let total = 0;

  for (const entry of draft) {
    const receivableId = entry?.receivableId;
    if (!receivableId) return failure('Asignación sin factura');
    if (seen.has(receivableId)) return failure(`La factura ${receivableId} aparece dos veces en la remesa`);
    seen.add(receivableId);

    const receivable = byId.get(receivableId);
    if (!receivable) return failure(`No se encontró la factura ${receivableId}`);
    if (receivable.status === 'cancelled') {
      return failure(`La factura ${documentLabel(receivable)} está cancelada`);
    }

    const amount = clampMoney(entry.amount);
    if (!(amount > RECONCILIATION_TOLERANCE)) {
      return failure(`El importe asignado a ${documentLabel(receivable)} no es válido`);
    }

    const reconcilable = reconcilableAmountOf(receivable);
    if (amount > reconcilable + RECONCILIATION_TOLERANCE) {
      return failure(
        `No se puede asignar ${eur(amount)} a ${documentLabel(receivable)}: solo tiene ${eur(reconcilable)} pendientes`,
      );
    }

    const superseded = supersededPaymentsOf(receivable);
    const supersededAmount = supersededAmountOf(receivable);
    const grossAmount = getGrossAmount(receivable);
    const paidAmountBefore = getPaidAmount(receivable);
    // The bulk line stops counting as paid the moment the real batch replaces
    // it, which is what lets a smaller batch reopen what it over-closed.
    const paidAmountAfter = clampMoney(Math.max(0, paidAmountBefore - supersededAmount + amount));
    const openAmountAfter = clampMoney(Math.max(0, grossAmount - paidAmountAfter));

    resolved.push({
      receivableId,
      receivable,
      amount,
      grossAmount,
      openAmountBefore: reconcilable,
      openAmountAfter,
      paidAmountBefore,
      paidAmountAfter,
      nextStatus: openAmountAfter <= RECONCILIATION_TOLERANCE ? 'settled' : 'partial',
      supersededAmount,
      supersededPayments: superseded,
    });
    total = clampMoney(total + amount);
  }

  // What is left of the transfer, not its face value: a second pass may only
  // claim what the first one did not.
  const movementAmount = unreconciledAmountOf(movement);
  if (total > movementAmount + RECONCILIATION_TOLERANCE) {
    return failure(
      `La remesa asigna ${eur(total)} pero al movimiento solo le quedan ${eur(movementAmount)} sin conciliar`,
    );
  }

  const difference = clampMoney(movementAmount - total);
  return {
    allocations: resolved,
    total,
    movementAmount,
    difference,
    status: difference > RECONCILIATION_TOLERANCE ? 'under' : 'exact',
  };
};
