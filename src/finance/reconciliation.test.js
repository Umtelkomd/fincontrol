import { describe, expect, it } from 'vitest';

import {
  buildMovementAllocations,
  getDocumentOpenAmount,
  movementNeedsAction,
  sumDocumentOpenAmount,
  unallocatedAmountOf,
} from './reconciliation.js';

describe('reconciliation helpers', () => {
  it('sums document open amounts consistently', () => {
    expect(sumDocumentOpenAmount([
      { id: 'a', openAmount: 10.124 },
      { id: 'b', grossAmount: 20 },
      { id: 'c', amount: 5.555 },
    ])).toBe(35.68);
    expect(getDocumentOpenAmount({ amount: '9.999' })).toBe(10);
  });

  it('allocates one movement across multiple documents in order', () => {
    const result = buildMovementAllocations(100, [
      { id: 'a', openAmount: 40 },
      { id: 'b', openAmount: 75 },
    ]);

    expect(result.isFullyAllocated).toBe(true);
    expect(result.remainingMovementAmount).toBe(0);
    expect(result.allocations).toEqual([
      expect.objectContaining({
        documentId: 'a',
        amount: 40,
        nextOpenAmount: 0,
        nextStatus: 'settled',
      }),
      expect.objectContaining({
        documentId: 'b',
        amount: 60,
        nextOpenAmount: 15,
        nextStatus: 'partial',
      }),
    ]);
  });

  it('reports leftover movement amount when selected documents do not explain the DATEV entry', () => {
    const result = buildMovementAllocations(100, [
      { id: 'a', openAmount: 40 },
      { id: 'b', openAmount: 30 },
    ]);

    expect(result.isFullyAllocated).toBe(false);
    expect(result.remainingMovementAmount).toBe(30);
  });
});

// ─── partial allocation ──────────────────────────────────────────────────────
//
// A DATEV debit routinely covers more than the documents captured so far: UTA
// debits one consolidated 6,178.14 charge against per-vehicle rows that trickle
// in later. Demanding a fully-explained movement left `forceStatus` as the only
// way out, which is how 27 payables reached "settled" with no cash behind them.

describe('unallocatedAmountOf', () => {
  it('is the full amount for an untouched movement', () => {
    expect(unallocatedAmountOf({ amount: 6178.14 })).toBe(6178.14);
  });

  it('is what the recorded allocations left behind', () => {
    expect(unallocatedAmountOf({ amount: 6178.14, reconciledAmount: 2666 })).toBe(3512.14);
  });

  it('prefers an explicitly stored remainder', () => {
    expect(unallocatedAmountOf({ amount: 6178.14, reconciledAmount: 2666, unallocatedAmount: 3000 })).toBe(3000);
  });

  it('is 0 once the movement is fully explained', () => {
    expect(unallocatedAmountOf({ amount: 100, reconciledAmount: 100 })).toBe(0);
  });

  it('never goes negative and ignores the movement sign', () => {
    expect(unallocatedAmountOf({ amount: -2050.15, reconciledAmount: 2050.15 })).toBe(0);
    expect(unallocatedAmountOf({ amount: 100, reconciledAmount: 250 })).toBe(0);
  });

  it('collapses cent-level dust to 0', () => {
    expect(unallocatedAmountOf({ amount: 100, reconciledAmount: 99.995 })).toBe(0);
  });
});

describe('movementNeedsAction', () => {
  it('ignores voided movements', () => {
    expect(movementNeedsAction({ status: 'void', direction: 'in', amount: 500 })).toBe(false);
  });

  it('flags an inflow with no receivable linked', () => {
    expect(movementNeedsAction({ direction: 'in', amount: 500 })).toBe(true);
  });

  it('clears an inflow fully allocated to a receivable', () => {
    expect(movementNeedsAction({ direction: 'in', amount: 500, receivableId: 'r1', reconciledAmount: 500 })).toBe(false);
  });

  // The case the old inbox filter got wrong: a linked movement with money left.
  it('keeps a PARTIALLY allocated movement in the inbox', () => {
    expect(movementNeedsAction({ direction: 'in', amount: 500, receivableId: 'r1', reconciledAmount: 200 })).toBe(true);
    expect(movementNeedsAction({ direction: 'out', amount: 6178.14, payableId: 'p1', reconciledAmount: 2666 })).toBe(true);
  });

  it('flags an outflow that is neither linked nor categorized', () => {
    expect(movementNeedsAction({ direction: 'out', amount: 300 })).toBe(true);
  });

  it('clears an outflow that is categorized instead of linked', () => {
    expect(movementNeedsAction({ direction: 'out', amount: 300, categoryName: 'Alquiler' })).toBe(false);
    expect(movementNeedsAction({ direction: 'out', amount: 300, costCenterId: 'cc-1' })).toBe(false);
  });

  it('clears an outflow fully allocated to payables', () => {
    expect(movementNeedsAction({ direction: 'out', amount: 300, payableId: 'p1', reconciledAmount: 300 })).toBe(false);
  });
});
