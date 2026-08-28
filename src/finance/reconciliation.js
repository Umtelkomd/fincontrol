import { clampMoney } from './utils';

export const RECONCILIATION_EPSILON = 0.01;

export const getDocumentOpenAmount = (document) =>
  clampMoney(document?.openAmount ?? document?.grossAmount ?? document?.amount ?? 0);

export const sumDocumentOpenAmount = (documents = []) =>
  clampMoney(documents.reduce((sum, document) => sum + getDocumentOpenAmount(document), 0));

export const buildMovementAllocations = (movementAmount, documents = []) => {
  let remaining = clampMoney(Math.abs(Number(movementAmount) || 0));
  const allocations = [];

  documents.forEach((document) => {
    if (remaining <= RECONCILIATION_EPSILON) return;
    const openAmount = getDocumentOpenAmount(document);
    if (openAmount <= RECONCILIATION_EPSILON) return;

    const amount = clampMoney(Math.min(openAmount, remaining));
    const nextOpenAmount = clampMoney(Math.max(0, openAmount - amount));
    remaining = clampMoney(Math.max(0, remaining - amount));

    allocations.push({
      document,
      documentId: document.id,
      amount,
      openAmount,
      nextOpenAmount,
      nextStatus: nextOpenAmount <= RECONCILIATION_EPSILON ? 'settled' : 'partial',
    });
  });

  return {
    allocations,
    movementAmount: clampMoney(Math.abs(Number(movementAmount) || 0)),
    selectedOpenAmount: sumDocumentOpenAmount(documents),
    remainingMovementAmount: remaining,
    isFullyAllocated: remaining <= RECONCILIATION_EPSILON,
  };
};

/**
 * How much of a bank movement is still unexplained.
 *
 * Reconciliation is N:M and rarely lands exactly: one UTA debit covers rows
 * that have not been captured yet, one payroll obligation leaves as many
 * transfers. A movement may therefore be linked AND still carry a remainder —
 * `unallocatedAmount` when the writer recorded one, otherwise derived from
 * `reconciledAmount`.
 *
 * @param {{ amount?: number, reconciledAmount?: number, unallocatedAmount?: number }} movement
 * @returns {number} never negative; dust below the epsilon collapses to 0
 */
export const unallocatedAmountOf = (movement) => {
  const total = clampMoney(Math.abs(Number(movement?.amount) || 0));
  const stored = movement?.unallocatedAmount;
  const remainder =
    typeof stored === 'number' && Number.isFinite(stored)
      ? clampMoney(stored)
      : total - clampMoney(Math.abs(Number(movement?.reconciledAmount) || 0));
  if (remainder <= RECONCILIATION_EPSILON) return 0;
  return clampMoney(Math.min(remainder, total));
};

/**
 * Whether a movement still needs a human: unlinked, or linked but with money
 * left to explain. Drives the Bandeja (inbox).
 *
 * An outflow may also be cleared by categorization alone — rent or software has
 * no invoice to match, and forcing one would just recreate the pressure to fake
 * a settlement.
 *
 * @param {object} movement
 * @returns {boolean}
 */
export const movementNeedsAction = (movement) => {
  if (!movement || movement.status === 'void') return false;
  if (unallocatedAmountOf(movement) > 0) {
    if (movement.direction === 'in') return true;
    return !(movement.categoryName || movement.costCenterId);
  }
  return false;
};
