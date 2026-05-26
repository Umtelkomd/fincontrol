import { describe, expect, it } from 'vitest';

import {
  buildMovementAllocations,
  getDocumentOpenAmount,
  sumDocumentOpenAmount,
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
