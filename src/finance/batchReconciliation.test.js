/**
 * Batch reconciliation — the confirming case, in tests.
 *
 * Insyte pays through confirming: one transfer from CaixaBank/BBVA/Santander
 * settles several invoices at once, so no bank movement ever equals one
 * document. These tests pin the three things that make such a batch safe to
 * apply: which invoices are plausible candidates, what the discrepancy is, and
 * when a suggested combination is trustworthy enough to show.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SUGGESTION_CANDIDATES,
  buildAllocationDraft,
  buildBatchCandidates,
  isPendingBatch,
  isReconciliationPending,
  rawPaymentsOf,
  reconcilableAmountOf,
  resolveBatchAllocations,
  suggestCombination,
  summarizeSelection,
  supersededAmountOf,
  unreconciledAmountOf,
} from './batchReconciliation.js';

// A real confirming settlement: the bank counterparty is BBVA, and the only
// trace of the client is inside the DATEV description.
const CONFIRMING_MOVEMENT = {
  id: 'mov-bbva',
  direction: 'in',
  status: 'posted',
  amount: 29565.4,
  postedDate: '2026-07-17',
  counterpartyName: 'BANCO BILBAO VIZCAYA ARGENTARIA S',
  description:
    'EREF+NOTPROVIDEDSVWZ+SETTLEMENT BBVACONFIRMING ADVANCE INSYTE DEUTSCHLAND GMBH STADIONRING32 RATINGEN',
};

const receivable = (overrides = {}) => ({
  id: 'cxc-1',
  status: 'issued',
  counterpartyName: 'Insyte Deutschland GmbH',
  documentNumber: 'RE-2026-001',
  grossAmount: 10000,
  amount: 10000,
  openAmount: 10000,
  paidAmount: 0,
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  payments: [],
  ...overrides,
});

/** A receivable closed by scripts/settle-collected-receivables.cjs. */
const bulkSettled = (overrides = {}) =>
  receivable({
    status: 'settled',
    openAmount: 0,
    paidAmount: 10000,
    reconciliationPending: true,
    payments: [
      {
        id: 'bulk-settle-2026-07-27',
        amount: 10000,
        date: '2026-07-27',
        method: 'Confirming',
        note: 'Cierre masivo',
      },
    ],
    ...overrides,
  });

describe('reconcilableAmountOf — what a batch may claim from an invoice', () => {
  it('is the open amount of a normal invoice', () => {
    expect(reconcilableAmountOf(receivable())).toBe(10000);
  });

  it('is zero for an invoice already reconciled against a real bank movement', () => {
    const settled = receivable({
      status: 'settled',
      openAmount: 0,
      paidAmount: 10000,
      payments: [{ amount: 10000, date: '2026-07-01', bankMovementId: 'mov-other' }],
    });
    expect(reconcilableAmountOf(settled)).toBe(0);
  });

  it('is the bulk-settled amount for an invoice the closing script closed', () => {
    expect(reconcilableAmountOf(bulkSettled())).toBe(10000);
    expect(supersededAmountOf(bulkSettled())).toBe(10000);
  });

  it('adds the remaining open amount to what a partial bulk closure superseded', () => {
    const mixed = bulkSettled({
      openAmount: 4000,
      paidAmount: 6000,
      payments: [{ id: 'bulk-settle-2026-07-27', amount: 6000, date: '2026-07-27' }],
    });
    expect(reconcilableAmountOf(mixed)).toBe(10000);
  });
});

describe('reading through the adapter', () => {
  // adaptReceivableDoc normalizes `payments` and DROPS bankMovementId and
  // reconciliationPending. Rebuilding the array from the normalized copy would
  // erase the link of every earlier reconciliation, so both are read from `raw`.
  const adapted = {
    id: 'cxc-adapted',
    status: 'settled',
    openAmount: 0,
    paidAmount: 10000,
    payments: [{ id: 'bulk-settle-2026-07-27', amount: 10000, date: '2026-07-27' }],
    raw: {
      reconciliationPending: true,
      payments: [
        { id: 'bulk-settle-2026-07-27', amount: 10000, date: '2026-07-27' },
        { amount: 0, date: '2026-06-01', bankMovementId: 'mov-old', reconciliationMode: 'datev' },
      ],
    },
  };

  it('takes the payment lines from raw so no bankMovementId is lost', () => {
    expect(rawPaymentsOf(adapted)).toHaveLength(2);
    expect(rawPaymentsOf(adapted)[1].bankMovementId).toBe('mov-old');
  });

  it('finds reconciliationPending even though the adapter does not surface it', () => {
    expect(isReconciliationPending(adapted)).toBe(true);
    expect(isReconciliationPending(receivable())).toBe(false);
  });
});

describe('buildBatchCandidates', () => {
  it('matches the client through the DATEV description when the payer is the bank', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [receivable(), receivable({ id: 'cxc-2', counterpartyName: 'Insyte' })],
    });
    expect(candidates.map((entry) => entry.id)).toEqual(['cxc-1', 'cxc-2']);
  });

  it('offers a client the bank spelled without its diacritics', () => {
    const candidates = buildBatchCandidates({
      movement: {
        ...CONFIRMING_MOVEMENT,
        description: 'SVWZ+PAGO POR CONFIRMING MONCOBRA SUCURSAL ROSSDORF',
      },
      receivables: [receivable({ id: 'moncobra', counterpartyName: 'Moncobra S.A. Roßdorf' })],
    });
    expect(candidates.map((entry) => entry.id)).toEqual(['moncobra']);
  });

  it('does not offer another client that merely shares a word', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [
        receivable({ id: 'other', counterpartyName: 'Deutsche Telekom AG' }),
        receivable({ id: 'austria', counterpartyName: 'Insyte Österreich GmbH' }),
      ],
    });
    expect(candidates).toEqual([]);
  });

  it('drops invoices issued after the money arrived', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [receivable({ id: 'later', issueDate: '2026-07-18' })],
    });
    expect(candidates).toEqual([]);
  });

  it('drops cancelled invoices and ones already reconciled elsewhere', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [
        receivable({ id: 'cancelled', status: 'cancelled' }),
        receivable({
          id: 'done',
          status: 'settled',
          openAmount: 0,
          paidAmount: 10000,
          payments: [{ amount: 10000, date: '2026-07-01', bankMovementId: 'mov-other' }],
        }),
      ],
    });
    expect(candidates).toEqual([]);
  });

  it('keeps an invoice the bulk closing script closed, so it can be superseded', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [bulkSettled({ id: 'pending' })],
    });
    expect(candidates.map((entry) => entry.id)).toEqual(['pending']);
  });

  it('keeps an invoice partly paid by another movement while it still has an open balance', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [
        receivable({
          id: 'partial',
          status: 'partial',
          openAmount: 4000,
          paidAmount: 6000,
          payments: [{ amount: 6000, date: '2026-06-20', bankMovementId: 'mov-other' }],
        }),
      ],
    });
    expect(candidates.map((entry) => entry.id)).toEqual(['partial']);
  });

  it('sorts oldest first — the order confirming actually pays in', () => {
    const candidates = buildBatchCandidates({
      movement: CONFIRMING_MOVEMENT,
      receivables: [
        receivable({ id: 'newer', issueDate: '2026-06-20' }),
        receivable({ id: 'undated', issueDate: null }),
        receivable({ id: 'oldest', issueDate: '2026-04-02' }),
      ],
    });
    expect(candidates.map((entry) => entry.id)).toEqual(['oldest', 'newer', 'undated']);
  });

  it('returns nothing for an outgoing or voided movement', () => {
    expect(
      buildBatchCandidates({
        movement: { ...CONFIRMING_MOVEMENT, direction: 'out' },
        receivables: [receivable()],
      }),
    ).toEqual([]);
    expect(
      buildBatchCandidates({
        movement: { ...CONFIRMING_MOVEMENT, status: 'void' },
        receivables: [receivable()],
      }),
    ).toEqual([]);
  });
});

describe('summarizeSelection — the discrepancy is the point', () => {
  const movement = { ...CONFIRMING_MOVEMENT, amount: 10000 };

  it('reports an exact batch inside the one-cent tolerance', () => {
    const summary = summarizeSelection({
      movement,
      selected: [receivable({ openAmount: 6000 }), receivable({ id: 'b', openAmount: 4000.004 })],
    });
    expect(summary.status).toBe('exact');
    expect(summary.difference).toBe(0);
    expect(summary.selectedTotal).toBe(10000);
    expect(summary.movementAmount).toBe(10000);
  });

  it('reports what is still unexplained when the selection falls short', () => {
    const summary = summarizeSelection({ movement, selected: [receivable({ openAmount: 6000 })] });
    expect(summary.status).toBe('under');
    expect(summary.difference).toBe(4000);
  });

  it('reports a negative difference when more is ticked than the bank sent', () => {
    const summary = summarizeSelection({ movement, selected: [receivable({ openAmount: 12000 })] });
    expect(summary.status).toBe('over');
    expect(summary.difference).toBe(-2000);
  });

  it('treats an empty selection as the whole transfer being unexplained', () => {
    const summary = summarizeSelection({ movement, selected: [] });
    expect(summary).toEqual({
      selectedTotal: 0,
      movementAmount: 10000,
      difference: 10000,
      status: 'under',
    });
  });
});

describe('unreconciledAmountOf — a remesa can be finished in two sittings', () => {
  // Under-allocation is allowed, so a transfer can leave the screen half
  // explained. It has to remain reachable, and the second pass may only claim
  // what the first one left.
  const withAllocations = (allocations, extra = {}) => ({
    ...CONFIRMING_MOVEMENT,
    amount: 10000,
    receivableId: allocations[0]?.documentId || null,
    receivableIds: allocations.map((entry) => entry.documentId),
    receivableAllocations: allocations,
    reconciledAmount: allocations.reduce((sum, entry) => sum + entry.amount, 0),
    ...extra,
  });

  it('is the whole transfer while nothing is linked', () => {
    expect(unreconciledAmountOf({ ...CONFIRMING_MOVEMENT, amount: 10000 })).toBe(10000);
    expect(isPendingBatch({ ...CONFIRMING_MOVEMENT, amount: 10000 })).toBe(true);
  });

  it('is what the first pass left behind', () => {
    const movement = withAllocations([{ documentId: 'cxc-1', amount: 6000 }]);
    expect(unreconciledAmountOf(movement)).toBe(4000);
    expect(isPendingBatch(movement)).toBe(true);
  });

  it('is nothing once the transfer is fully explained', () => {
    const movement = withAllocations([
      { documentId: 'cxc-1', amount: 6000 },
      { documentId: 'cxc-2', amount: 4000 },
    ]);
    expect(unreconciledAmountOf(movement)).toBe(0);
    expect(isPendingBatch(movement)).toBe(false);
  });

  it('leaves a legacy link alone when its allocation cannot be measured', () => {
    // Reopening one of these would invite a second reconciliation of money
    // that was already applied, and nothing here can prove how much that was.
    const legacy = { ...CONFIRMING_MOVEMENT, amount: 10000, receivableId: 'cxc-1' };
    expect(unreconciledAmountOf(legacy)).toBe(0);
    expect(isPendingBatch(legacy)).toBe(false);
  });

  it('measures the selection against what is left, not the full transfer', () => {
    const movement = withAllocations([{ documentId: 'cxc-1', amount: 6000 }]);
    const summary = summarizeSelection({ movement, selected: [receivable({ openAmount: 4000 })] });

    expect(summary.movementAmount).toBe(4000);
    expect(summary.status).toBe('exact');
  });

  it('refuses a second pass that claims more than the first one left', () => {
    const movement = withAllocations([{ documentId: 'cxc-1', amount: 6000 }]);
    const result = resolveBatchAllocations({
      movement,
      allocations: [{ receivableId: 'cxc-2', amount: 5000 }],
      receivables: [receivable({ id: 'cxc-2', openAmount: 5000 })],
    });

    expect(result.error).toBeTruthy();
  });
});

describe('suggestCombination — silent about anything dubious', () => {
  const movement = { ...CONFIRMING_MOVEMENT, amount: 10000 };
  const candidate = (id, openAmount) => receivable({ id, openAmount });

  it('returns the one subset that adds up', () => {
    const result = suggestCombination({
      movement,
      candidates: [candidate('a', 6000), candidate('b', 4000), candidate('c', 777)],
    });
    expect(result.combination.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(result.total).toBe(10000);
    expect(result.alternatives).toBe(1);
  });

  it('returns nothing when several different combinations hit the same total', () => {
    const result = suggestCombination({
      movement,
      candidates: [candidate('a', 10000), candidate('b', 6000), candidate('c', 4000)],
    });
    expect(result.combination).toBeNull();
    expect(result.alternatives).toBe(2);
  });

  it('returns nothing when no subset matches', () => {
    const result = suggestCombination({
      movement,
      candidates: [candidate('a', 3000), candidate('b', 2500)],
    });
    expect(result.combination).toBeNull();
    expect(result.alternatives).toBe(0);
  });

  it('never proposes more invoices than maxInvoices allows', () => {
    const candidates = [
      candidate('a', 2000),
      candidate('b', 2000),
      candidate('c', 2000),
      candidate('d', 2000),
      candidate('e', 2000),
    ];
    expect(suggestCombination({ movement, candidates, maxInvoices: 4 }).combination).toBeNull();
    expect(
      suggestCombination({ movement, candidates, maxInvoices: 5 }).combination,
    ).toHaveLength(5);
  });

  it('bounds the search and says so when the pool is longer than the cap', () => {
    const many = Array.from({ length: MAX_SUGGESTION_CANDIDATES + 3 }, (_, index) =>
      candidate(`c${index}`, 1000 + index),
    );
    const result = suggestCombination({ movement, candidates: many });
    expect(result.truncated).toBe(true);
    expect(result.searched).toBe(MAX_SUGGESTION_CANDIDATES);
  });

  it('ignores dust candidates so they cannot invent alternatives', () => {
    const result = suggestCombination({
      movement,
      candidates: [candidate('a', 10000), candidate('dust', 0.004)],
    });
    expect(result.combination.map((entry) => entry.id)).toEqual(['a']);
    expect(result.alternatives).toBe(1);
  });
});

describe('resolveBatchAllocations — the invariants the write path leans on', () => {
  const movement = { ...CONFIRMING_MOVEMENT, amount: 10000 };
  const draftOf = (entries) => entries.map(([receivableId, amount]) => ({ receivableId, amount }));

  it('refuses to allocate more than an invoice has open', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 9000]]),
      receivables: [receivable({ openAmount: 5000 })],
    });
    expect(result.error).toMatch(/RE-2026-001/);
  });

  it('refuses a total above the movement amount', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 6000], ['cxc-2', 6000]]),
      receivables: [receivable(), receivable({ id: 'cxc-2' })],
    });
    expect(result.error).toMatch(/12\.?000|12000/);
  });

  it('refuses the same invoice twice', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 1000], ['cxc-1', 1000]]),
      receivables: [receivable()],
    });
    expect(result.error).toBeTruthy();
  });

  it('refuses an invoice it cannot see', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['ghost', 1000]]),
      receivables: [receivable()],
    });
    expect(result.error).toBeTruthy();
  });

  it('refuses a cancelled invoice, a zero amount and an empty batch', () => {
    expect(
      resolveBatchAllocations({
        movement,
        allocations: draftOf([['cxc-1', 1000]]),
        receivables: [receivable({ status: 'cancelled' })],
      }).error,
    ).toBeTruthy();
    expect(
      resolveBatchAllocations({
        movement,
        allocations: draftOf([['cxc-1', 0]]),
        receivables: [receivable()],
      }).error,
    ).toBeTruthy();
    expect(resolveBatchAllocations({ movement, allocations: [], receivables: [receivable()] }).error)
      .toBeTruthy();
  });

  it('refuses an outgoing or voided movement', () => {
    expect(
      resolveBatchAllocations({
        movement: { ...movement, direction: 'out' },
        allocations: draftOf([['cxc-1', 1000]]),
        receivables: [receivable()],
      }).error,
    ).toBeTruthy();
    expect(
      resolveBatchAllocations({
        movement: { ...movement, status: 'void' },
        allocations: draftOf([['cxc-1', 1000]]),
        receivables: [receivable()],
      }).error,
    ).toBeTruthy();
  });

  it('accepts an under-allocated batch — the gap is a signal, not an error', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 4000]]),
      receivables: [receivable()],
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('under');
    expect(result.difference).toBe(6000);
    expect(result.allocations[0]).toMatchObject({
      receivableId: 'cxc-1',
      amount: 4000,
      openAmountBefore: 10000,
      openAmountAfter: 6000,
      paidAmountAfter: 4000,
      nextStatus: 'partial',
      supersededAmount: 0,
    });
  });

  it('supersedes the bulk closure instead of paying the invoice twice', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 10000]]),
      receivables: [bulkSettled()],
    });
    expect(result.error).toBeUndefined();
    expect(result.allocations[0]).toMatchObject({
      amount: 10000,
      supersededAmount: 10000,
      paidAmountAfter: 10000,
      openAmountAfter: 0,
      nextStatus: 'settled',
    });
    expect(result.allocations[0].supersededPayments).toHaveLength(1);
  });

  it('reopens what the bulk closure over-closed when the batch covers less', () => {
    const result = resolveBatchAllocations({
      movement,
      allocations: draftOf([['cxc-1', 6000]]),
      receivables: [bulkSettled()],
    });
    expect(result.allocations[0]).toMatchObject({
      paidAmountAfter: 6000,
      openAmountAfter: 4000,
      nextStatus: 'partial',
    });
  });
});

describe('buildAllocationDraft', () => {
  it('turns ticked invoices into the { receivableId, amount } shape the write path takes', () => {
    expect(buildAllocationDraft([receivable(), bulkSettled({ id: 'cxc-2' })])).toEqual([
      { receivableId: 'cxc-1', amount: 10000 },
      { receivableId: 'cxc-2', amount: 10000 },
    ]);
  });
});
