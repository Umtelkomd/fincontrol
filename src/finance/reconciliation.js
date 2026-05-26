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
