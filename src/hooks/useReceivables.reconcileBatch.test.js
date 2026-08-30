/**
 * reconcileBatch — writing one confirming remesa across several invoices.
 *
 * The dangerous parts of this write are not the field names, they are the
 * guarantees around them:
 *
 *   ATOMIC   — one commit for the movement and every invoice. A half-applied
 *              remesa (invoices closed, movement unlinked) is worse than none.
 *   NO CASH  — reconciling LINKS documents to a movement; it never restates
 *              what the bank did. Proved by re-deriving the cash position from
 *              the movement after the payload is applied to it.
 *   SUPERSEDE— an invoice closed by scripts/settle-collected-receivables.cjs
 *              carries a `bulk-settle-*` payment line. The real reconciliation
 *              REPLACES it; appending would show the invoice paid twice.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const MOVEMENT = {
  id: 'mov-bbva',
  direction: 'in',
  status: 'posted',
  amount: 10000,
  postedDate: '2026-07-17',
  valueDate: '2026-07-17',
  signedAmount: 10000,
  currency: 'EUR',
  counterpartyName: 'BANCO BILBAO VIZCAYA ARGENTARIA S',
  description: 'SETTLEMENT BBVACONFIRMING ADVANCE INSYTE DEUTSCHLAND GMBH',
};

const OPEN_INVOICE = {
  id: 'cxc-open',
  status: 'issued',
  counterpartyName: 'Insyte Deutschland GmbH',
  documentNumber: 'RE-2026-001',
  grossAmount: 6000,
  amount: 6000,
  openAmount: 6000,
  paidAmount: 0,
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  payments: [],
};

const BULK_SETTLED_INVOICE = {
  id: 'cxc-bulk',
  status: 'settled',
  counterpartyName: 'Insyte Deutschland GmbH',
  documentNumber: 'RE-2026-002',
  grossAmount: 4000,
  amount: 4000,
  openAmount: 0,
  paidAmount: 4000,
  issueDate: '2026-06-05',
  dueDate: '2026-07-05',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  reconciliationPending: true,
  payments: [
    {
      id: 'bulk-settle-2026-07-27',
      amount: 4000,
      date: '2026-07-27',
      method: 'Confirming',
      note: 'Cierre masivo',
    },
    // An older real reconciliation whose bank link the adapter strips on read.
    { amount: 0, date: '2026-05-01', bankMovementId: 'mov-old', reconciliationMode: 'datev' },
  ],
};

const store = installFirebaseMocks({
  collections: { receivables: [OPEN_INVOICE, BULK_SETTLED_INVOICE] },
});

const firestore = await import('firebase/firestore');
const { useReceivables } = await import('./useReceivables.js');
const { deriveBalance } = await import('../lib/finance/index.js');
const { agingBuckets } = await import('../lib/finance/aging.js');

const mountReceivables = async () => {
  const { result } = renderHook(() => useReceivables(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

/** Every batch created during the call, with its update calls. */
const batches = () => firestore.writeBatch.mock.results.map((entry) => entry.value);

const updatesByPath = () => {
  const calls = batches().flatMap((batch) => batch.update.mock.calls);
  return new Map(calls.map(([ref, payload]) => [ref.path, payload]));
};

const movementPayload = () =>
  updatesByPath().get(`artifacts/test-app/public/data/bankMovements/${MOVEMENT.id}`);

const receivablePayload = (id) =>
  updatesByPath().get(`artifacts/test-app/public/data/receivables/${id}`);

const fullBatch = [
  { receivableId: 'cxc-open', amount: 6000 },
  { receivableId: 'cxc-bulk', amount: 4000 },
];

beforeEach(() => {
  store.collections.receivables = [OPEN_INVOICE, BULK_SETTLED_INVOICE];
  firestore.writeBatch.mockClear();
  firestore.updateDoc.mockClear();
});

describe('reconcileBatch — atomicity', () => {
  it('writes the movement and every invoice in a single commit', async () => {
    const result = await mountReceivables();

    expect(await result.current.reconcileBatch(MOVEMENT, fullBatch)).toMatchObject({
      success: true,
      count: 2,
    });

    expect(batches()).toHaveLength(1);
    expect(batches()[0].update).toHaveBeenCalledTimes(3); // movement + 2 invoices
    expect(batches()[0].commit).toHaveBeenCalledTimes(1);
  });

  it('writes nothing at all when one allocation breaks an invariant', async () => {
    const result = await mountReceivables();

    const rejected = await result.current.reconcileBatch(MOVEMENT, [
      { receivableId: 'cxc-open', amount: 6000 },
      { receivableId: 'cxc-open', amount: 4000 },
    ]);

    expect(rejected.success).toBe(false);
    expect(batches()).toHaveLength(0);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });

  it('refuses a remesa too large to commit atomically rather than splitting it', async () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      receivableId: `cxc-${index}`,
      amount: 1,
    }));
    const result = await mountReceivables();

    const rejected = await result.current.reconcileBatch(MOVEMENT, many);

    expect(rejected.success).toBe(false);
    expect(rejected.error.message).toMatch(/atómica|atomica/i);
    expect(batches()).toHaveLength(0);
  });
});

describe('reconcileBatch — cash must not move', () => {
  const anchors = [{ date: '2026-07-01', balance: 1214.2, source: 'DATEV SuSa 1200' }];
  const cashOf = (movement) =>
    deriveBalance({ anchors, movements: [movement], today: '2026-07-31' }).balance;

  it('leaves the derived cash position identical after the movement is updated', async () => {
    const result = await mountReceivables();
    const before = cashOf(MOVEMENT);

    await result.current.reconcileBatch(MOVEMENT, fullBatch);
    const after = cashOf({ ...MOVEMENT, ...movementPayload() });

    expect(before).toBe(11214.2);
    expect(after).toBe(before);
  });

  it('never writes a field the cash position is derived from', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    ['amount', 'signedAmount', 'direction', 'postedDate', 'valueDate', 'status', 'currency', 'accountId']
      .forEach((field) => {
        expect(movementPayload()).not.toHaveProperty(field);
      });
  });

  it('never restates the face value of an invoice', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    ['grossAmount', 'amount', 'issueDate', 'dueDate'].forEach((field) => {
      expect(receivablePayload('cxc-open')).not.toHaveProperty(field);
    });
  });
});

describe('reconcileBatch — what it links', () => {
  it('links the movement back to every invoice it settled', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    expect(movementPayload()).toMatchObject({
      receivableId: 'cxc-open',
      receivableIds: ['cxc-open', 'cxc-bulk'],
      reconciliationMode: 'batch-confirming',
      reconciledAmount: 10000,
    });
    expect(movementPayload().receivableAllocations).toEqual([
      { documentId: 'cxc-open', amount: 6000, openAmountBefore: 6000, openAmountAfter: 0, confirmingDiscount: 0 },
      { documentId: 'cxc-bulk', amount: 4000, openAmountBefore: 4000, openAmountAfter: 0, confirmingDiscount: 0 },
    ]);
  });

  it('adds to what an earlier pass linked instead of replacing it', async () => {
    // A remesa may be finished in two sittings. The second pass must not drop
    // the first pass's links, and it may only claim what was left.
    const partiallyDone = {
      ...MOVEMENT,
      receivableId: 'cxc-earlier',
      receivableIds: ['cxc-earlier'],
      receivableAllocations: [
        { documentId: 'cxc-earlier', amount: 6000, openAmountBefore: 6000, openAmountAfter: 0 },
      ],
      reconciledAmount: 6000,
    };
    const result = await mountReceivables();

    const applied = await result.current.reconcileBatch(partiallyDone, [
      { receivableId: 'cxc-bulk', amount: 4000 },
    ]);

    expect(applied).toMatchObject({ success: true, difference: 0, status: 'exact' });
    expect(movementPayload()).toMatchObject({
      receivableId: 'cxc-earlier',
      receivableIds: ['cxc-earlier', 'cxc-bulk'],
      reconciledAmount: 10000,
    });
    expect(movementPayload().receivableAllocations).toHaveLength(2);
  });

  it('carries the project over only when every invoice agrees on it', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);
    expect(movementPayload().projectId).toBe('proj-1');

    firestore.writeBatch.mockClear();
    store.collections.receivables = [
      OPEN_INVOICE,
      { ...BULK_SETTLED_INVOICE, projectId: 'proj-2', projectName: 'Otro' },
    ];
    const mixed = await mountReceivables();
    await mixed.current.reconcileBatch(MOVEMENT, fullBatch);
    expect(movementPayload().projectId).toBe('');
  });

  it('settles the open invoice and records the bank movement on its payment', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    const payload = receivablePayload('cxc-open');
    expect(payload).toMatchObject({
      openAmount: 0,
      pendingAmount: 0,
      paidAmount: 6000,
      status: 'settled',
      reconciliationPending: false,
    });
    // No bulk line to replace, so the append-only path keeps the write
    // concurrency-safe: arrayUnion, not a rebuilt array.
    expect(firestore.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ bankMovementId: 'mov-bbva', amount: 6000 }),
    );
  });
});

describe('reconcileBatch — superseding the bulk closure', () => {
  it('replaces the bulk-settle line instead of stacking a second payment', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    const payments = receivablePayload('cxc-bulk').payments;
    expect(Array.isArray(payments)).toBe(true);
    expect(payments.filter((entry) => String(entry.id || '').startsWith('bulk-settle-'))).toHaveLength(0);
    expect(payments.filter((entry) => entry.bankMovementId === 'mov-bbva')).toHaveLength(1);
    expect(payments.reduce((sum, entry) => sum + entry.amount, 0)).toBe(4000);
  });

  it('keeps the bank link of payments the adapter would have stripped', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    const payments = receivablePayload('cxc-bulk').payments;
    expect(payments.some((entry) => entry.bankMovementId === 'mov-old')).toBe(true);
  });

  it('clears reconciliationPending once the invoice has a real movement behind it', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    expect(receivablePayload('cxc-bulk').reconciliationPending).toBe(false);
  });

  it('reopens the balance the bulk closure over-closed when the remesa covers less', async () => {
    const result = await mountReceivables();

    await result.current.reconcileBatch(MOVEMENT, [{ receivableId: 'cxc-bulk', amount: 2500 }]);

    expect(receivablePayload('cxc-bulk')).toMatchObject({
      paidAmount: 2500,
      openAmount: 1500,
      status: 'partial',
    });
  });
});

describe('reconcileBatch — what moves in the aging', () => {
  it('drops the reconciled invoices out of the open portfolio', async () => {
    const today = '2026-07-31';
    const docs = [OPEN_INVOICE, { ...BULK_SETTLED_INVOICE, openAmount: 4000, status: 'issued' }];
    const before = agingBuckets({ docs, today });

    const result = await mountReceivables();
    await result.current.reconcileBatch(MOVEMENT, fullBatch);

    const after = agingBuckets({
      docs: docs.map((entry) => ({ ...entry, ...receivablePayload(entry.id) })),
      today,
    });

    expect(before.totals.open).toBe(10000);
    expect(before.totals.overdue).toBe(10000);
    expect(after.totals.open).toBe(0);
    expect(after.totals.overdue).toBe(0);
  });
});

describe('reconcileBatch — refusals', () => {
  it('refuses without a signed-in user', async () => {
    const { result } = renderHook(() => useReceivables(null));
    expect((await result.current.reconcileBatch(MOVEMENT, fullBatch)).success).toBe(false);
  });

  it('refuses a bare movement id — the invariants need the amount and the date', async () => {
    const result = await mountReceivables();

    const rejected = await result.current.reconcileBatch('mov-bbva', fullBatch);

    expect(rejected.success).toBe(false);
    expect(batches()).toHaveLength(0);
  });

  it('refuses a batch that totals more than the bank actually sent', async () => {
    const result = await mountReceivables();

    const rejected = await result.current.reconcileBatch(
      { ...MOVEMENT, amount: 5000 },
      fullBatch,
    );

    expect(rejected.success).toBe(false);
    expect(batches()).toHaveLength(0);
  });

  it('accepts a batch that explains only part of the transfer', async () => {
    const result = await mountReceivables();

    const applied = await result.current.reconcileBatch(MOVEMENT, [
      { receivableId: 'cxc-open', amount: 6000 },
    ]);

    expect(applied).toMatchObject({ success: true, count: 1, difference: 4000, status: 'under' });
  });
});

describe('reconcileBatch — confirming discount', () => {
  // The bank kept 100 as its fee: 10.000 of invoices arrived as 9.900.
  const feeMovement = { ...MOVEMENT, amount: 9900, signedAmount: 9900 };

  it('closes every invoice in full and persists the discount on the movement', async () => {
    const result = await mountReceivables();

    const applied = await result.current.reconcileBatch(feeMovement, fullBatch, { confirmingDiscount: 100 });

    expect(applied).toMatchObject({ success: true, count: 2, difference: 0, status: 'exact', confirmingDiscount: 100 });
    expect(movementPayload()).toMatchObject({ confirmingDiscount: 100, reconciledAmount: 10000 });
    expect(receivablePayload('cxc-open')).toMatchObject({ openAmount: 0, status: 'settled', paidAmount: 6000 });
    expect(receivablePayload('cxc-bulk')).toMatchObject({ openAmount: 0, status: 'settled' });
  });

  it('splits the discount across the allocations in proportion, summing exactly', async () => {
    const result = await mountReceivables();
    await result.current.reconcileBatch(feeMovement, fullBatch, { confirmingDiscount: 100 });

    const allocations = movementPayload().receivableAllocations;
    expect(allocations.map((entry) => entry.confirmingDiscount)).toEqual([60, 40]);
    expect(allocations.reduce((sum, entry) => sum + entry.confirmingDiscount, 0)).toBe(100);
    expect(firestore.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ bankMovementId: 'mov-bbva', amount: 6000, confirmingDiscount: 60 }),
    );
  });

  it('refuses invoices beyond the transfer when no discount explains them', async () => {
    const result = await mountReceivables();
    const rejected = await result.current.reconcileBatch(feeMovement, fullBatch);
    expect(rejected.success).toBe(false);
    expect(batches()).toHaveLength(0);
  });
});
