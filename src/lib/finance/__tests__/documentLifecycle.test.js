import { describe, expect, it } from 'vitest';
import {
  CORRECTION_TARGET,
  REJECTION,
  allocationSummary,
  applyCorrection,
  applyPayment,
  deriveStatus,
  evidencedPaidOf,
  grossOf,
  isEvidenced,
  outstandingOf,
  paidOf,
} from '../documentLifecycle.js';

/** Minimal receivable/payable shaped like the Firestore docs the app stores. */
const doc = (overrides = {}) => ({
  id: 'doc-1',
  grossAmount: 1000,
  paidAmount: 0,
  openAmount: 1000,
  status: 'issued',
  payments: [],
  ...overrides,
});

const payment = (overrides = {}) => ({
  bankMovementId: 'mov-1',
  amount: 400,
  date: '2026-07-10',
  ...overrides,
});

// ─── amount readers ──────────────────────────────────────────────────────────

describe('grossOf', () => {
  it('prefers grossAmount and falls back to amount', () => {
    expect(grossOf({ grossAmount: 250.5 })).toBe(250.5);
    expect(grossOf({ amount: 90 })).toBe(90);
    expect(grossOf({ grossAmount: 250.5, amount: 999 })).toBe(250.5);
  });

  it('normalizes missing, non-finite and negative values to 0', () => {
    expect(grossOf({})).toBe(0);
    expect(grossOf(null)).toBe(0);
    expect(grossOf({ grossAmount: NaN })).toBe(0);
    expect(grossOf({ grossAmount: '500' })).toBe(0);
    expect(grossOf({ grossAmount: -30 })).toBe(0);
  });
});

describe('paidOf', () => {
  it('sums the recorded payments', () => {
    const row = doc({ payments: [payment({ amount: 300 }), payment({ bankMovementId: 'mov-2', amount: 250 })] });
    expect(paidOf(row)).toBe(550);
  });

  it('ignores the stored paidAmount when payments exist', () => {
    const row = doc({ paidAmount: 9999, payments: [payment({ amount: 300 })] });
    expect(paidOf(row)).toBe(300);
  });

  // The 89 legacy docs carry paidAmount with no payments array. Returning 0
  // would resurrect ~108k EUR of phantom debt across CXP the moment this
  // module goes live, so the stored claim survives — flagged, not erased.
  it('falls back to the stored paidAmount when no payments are recorded', () => {
    expect(paidOf(doc({ paidAmount: 1000, payments: [] }))).toBe(1000);
    expect(paidOf(doc({ paidAmount: 1000, payments: undefined }))).toBe(1000);
  });
});

describe('evidencedPaidOf', () => {
  it('counts only payments carrying a bankMovementId', () => {
    const row = doc({
      payments: [payment({ amount: 300 }), { amount: 250, date: '2026-07-11' }],
    });
    expect(evidencedPaidOf(row)).toBe(300);
  });

  it('never falls back to the stored paidAmount', () => {
    expect(evidencedPaidOf(doc({ paidAmount: 1000, payments: [] }))).toBe(0);
  });
});

describe('isEvidenced', () => {
  it('is true when every paid cent traces to a bank movement', () => {
    expect(isEvidenced(doc({ payments: [payment({ amount: 1000 })] }))).toBe(true);
  });

  it('is true for a document nobody has paid yet', () => {
    expect(isEvidenced(doc())).toBe(true);
  });

  it('is false for a force-settled document with no payments', () => {
    expect(isEvidenced(doc({ status: 'settled', paidAmount: 1000, openAmount: 0 }))).toBe(false);
  });

  it('is false when only part of the paid amount is linked', () => {
    const row = doc({ payments: [payment({ amount: 300 }), { amount: 200 }] });
    expect(isEvidenced(row)).toBe(false);
  });
});

describe('outstandingOf', () => {
  it('is gross minus paid', () => {
    expect(outstandingOf(doc({ payments: [payment({ amount: 400 })] }))).toBe(600);
  });

  it('never goes negative', () => {
    expect(outstandingOf(doc({ paidAmount: 1500 }))).toBe(0);
  });

  it('is 0 for a cancelled document', () => {
    expect(outstandingOf(doc({ status: 'cancelled' }))).toBe(0);
  });

  it('absorbs floating dust', () => {
    expect(outstandingOf(doc({ grossAmount: 66.26, paidAmount: 66.259999 }))).toBe(0);
  });
});

// ─── status derivation ───────────────────────────────────────────────────────

describe('deriveStatus', () => {
  it('keeps cancelled documents cancelled', () => {
    expect(deriveStatus(doc({ status: 'cancelled', paidAmount: 1000 }))).toBe('cancelled');
  });

  it('is issued when nothing is paid', () => {
    expect(deriveStatus(doc())).toBe('issued');
  });

  it('is partial when some is paid', () => {
    expect(deriveStatus(doc({ payments: [payment({ amount: 400 })] }))).toBe('partial');
  });

  it('is settled when nothing is outstanding', () => {
    expect(deriveStatus(doc({ payments: [payment({ amount: 1000 })] }))).toBe('settled');
  });

  it('does not settle a zero-value document by accident', () => {
    expect(deriveStatus(doc({ grossAmount: 0, paidAmount: 0, openAmount: 0 }))).toBe('issued');
  });
});

// ─── applyPayment — the policy gate ──────────────────────────────────────────

describe('applyPayment', () => {
  it('records a payment and moves the document to partial', () => {
    const result = applyPayment(doc(), payment({ amount: 400 }));
    expect(result.ok).toBe(true);
    expect(result.next.paidAmount).toBe(400);
    expect(result.next.openAmount).toBe(600);
    expect(result.next.status).toBe('partial');
    expect(result.next.payments).toHaveLength(1);
  });

  it('settles the document when the payment closes it', () => {
    const result = applyPayment(doc(), payment({ amount: 1000 }));
    expect(result.ok).toBe(true);
    expect(result.next.status).toBe('settled');
    expect(result.next.openAmount).toBe(0);
  });

  it('accumulates several movements against one document', () => {
    const first = applyPayment(doc(), payment({ bankMovementId: 'mov-1', amount: 400 }));
    const second = applyPayment(
      { ...doc(), ...first.next },
      payment({ bankMovementId: 'mov-2', amount: 600 }),
    );
    expect(second.ok).toBe(true);
    expect(second.next.payments).toHaveLength(2);
    expect(second.next.paidAmount).toBe(1000);
    expect(second.next.status).toBe('settled');
  });

  it('rejects a payment with no bank movement — this is the closed door', () => {
    const result = applyPayment(doc(), { amount: 400, date: '2026-07-10' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.NO_BANK_LINK);
  });

  it('rejects non-positive or non-finite amounts', () => {
    expect(applyPayment(doc(), payment({ amount: 0 })).reason).toBe(REJECTION.NON_POSITIVE);
    expect(applyPayment(doc(), payment({ amount: -50 })).reason).toBe(REJECTION.NON_POSITIVE);
    expect(applyPayment(doc(), payment({ amount: NaN })).reason).toBe(REJECTION.NON_POSITIVE);
    expect(applyPayment(doc(), payment({ amount: '400' })).reason).toBe(REJECTION.NON_POSITIVE);
  });

  it('rejects a payment larger than the outstanding balance', () => {
    const result = applyPayment(doc({ grossAmount: 500, openAmount: 500 }), payment({ amount: 600 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.EXCEEDS_OPEN);
  });

  it('tolerates a cent of overshoot so exact settlements are not blocked', () => {
    const row = doc({ grossAmount: 66.26, openAmount: 66.26 });
    expect(applyPayment(row, payment({ amount: 66.264 })).ok).toBe(true);
  });

  // This is the defect that produced paidAmount 132.52 on a 66.26 payable.
  it('rejects linking the same bank movement twice to the same document', () => {
    const first = applyPayment(doc({ grossAmount: 66.26, openAmount: 66.26 }), payment({ amount: 66.26 }));
    const again = applyPayment(
      { ...doc({ grossAmount: 66.26 }), ...first.next },
      payment({ amount: 66.26 }),
    );
    expect(again.ok).toBe(false);
    expect(again.reason).toBe(REJECTION.DUPLICATE_ALLOCATION);
  });

  it('refuses to pay a cancelled document', () => {
    const result = applyPayment(doc({ status: 'cancelled' }), payment());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.DOCUMENT_CLOSED);
  });

  it('carries the payment metadata through untouched', () => {
    const result = applyPayment(
      doc(),
      payment({ amount: 400, method: 'SEPA', reference: 'R-42', registeredBy: 'jromero@umtelkomd.com' }),
    );
    expect(result.next.payments[0]).toMatchObject({
      bankMovementId: 'mov-1',
      amount: 400,
      method: 'SEPA',
      reference: 'R-42',
      registeredBy: 'jromero@umtelkomd.com',
    });
  });

  it('does not mutate the input document', () => {
    const row = doc();
    applyPayment(row, payment());
    expect(row.payments).toHaveLength(0);
    expect(row.paidAmount).toBe(0);
  });
});

// ─── applyCorrection — the honest replacement for forceStatus ────────────────

describe('applyCorrection', () => {
  it('cancels a document with a reason', () => {
    const result = applyCorrection(doc(), {
      target: CORRECTION_TARGET.CANCELLED,
      reason: 'Duplicado de Finanzamt 5qypMJ',
      actor: 'jromero@umtelkomd.com',
    });
    expect(result.ok).toBe(true);
    expect(result.next.status).toBe('cancelled');
    expect(result.next.openAmount).toBe(0);
  });

  it('reopens a force-settled document and drops the unevidenced claim', () => {
    const forced = doc({ status: 'settled', paidAmount: 1000, openAmount: 0, payments: [] });
    const result = applyCorrection(forced, {
      target: CORRECTION_TARGET.REOPENED,
      reason: 'Sin respaldo bancario',
      actor: 'jromero@umtelkomd.com',
    });
    expect(result.ok).toBe(true);
    expect(result.next.status).toBe('issued');
    expect(result.next.paidAmount).toBe(0);
    expect(result.next.openAmount).toBe(1000);
  });

  it('keeps evidenced payments when reopening', () => {
    const partly = doc({ status: 'settled', paidAmount: 1000, openAmount: 0, payments: [payment({ amount: 400 })] });
    const result = applyCorrection(partly, {
      target: CORRECTION_TARGET.REOPENED,
      reason: 'Solo 400 tiene respaldo',
      actor: 'jromero@umtelkomd.com',
    });
    expect(result.ok).toBe(true);
    expect(result.next.paidAmount).toBe(400);
    expect(result.next.openAmount).toBe(600);
    expect(result.next.status).toBe('partial');
  });

  // The whole point: 27 CXP reached "settled" this way, 55,257 EUR of it.
  it('refuses to settle a document by decree', () => {
    const result = applyCorrection(doc(), {
      target: 'settled',
      reason: 'pago',
      actor: 'jromero@umtelkomd.com',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.SETTLED_REQUIRES_PAYMENT);
  });

  it('demands a meaningful reason', () => {
    const short = applyCorrection(doc(), { target: CORRECTION_TARGET.CANCELLED, reason: 'pago', actor: 'x' });
    expect(short.ok).toBe(false);
    expect(short.reason).toBe(REJECTION.REASON_TOO_SHORT);

    const blank = applyCorrection(doc(), { target: CORRECTION_TARGET.CANCELLED, reason: '        ', actor: 'x' });
    expect(blank.reason).toBe(REJECTION.REASON_TOO_SHORT);
  });

  it('rejects an unknown correction target', () => {
    const result = applyCorrection(doc(), { target: 'liquidada', reason: 'motivo suficiente', actor: 'x' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.UNKNOWN_TARGET);
  });

  it('refuses to cancel a document that really received money', () => {
    const paid = doc({ payments: [payment({ amount: 400 })] });
    const result = applyCorrection(paid, {
      target: CORRECTION_TARGET.CANCELLED,
      reason: 'Ya no aplica esta factura',
      actor: 'x',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.HAS_PAYMENTS);
  });

  it('does not mutate the input document', () => {
    const row = doc({ status: 'settled', paidAmount: 1000, openAmount: 0 });
    applyCorrection(row, { target: CORRECTION_TARGET.REOPENED, reason: 'sin respaldo', actor: 'x' });
    expect(row.status).toBe('settled');
    expect(row.paidAmount).toBe(1000);
  });
});

// ─── allocationSummary — one bank movement across many documents ─────────────

describe('allocationSummary', () => {
  const movement = { id: 'mov-1', amount: 6178.14, direction: 'out' };

  it('splits one movement across several documents', () => {
    const result = allocationSummary(movement, [
      { documentId: 'uta-1', amount: 4000 },
      { documentId: 'uta-2', amount: 2178.14 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.allocated).toBe(6178.14);
    expect(result.remainder).toBe(0);
  });

  it('reports what is left to allocate', () => {
    const result = allocationSummary(movement, [{ documentId: 'uta-1', amount: 1000 }]);
    expect(result.ok).toBe(true);
    expect(result.remainder).toBe(5178.14);
  });

  it('rejects allocating more than the movement carries', () => {
    const result = allocationSummary(movement, [
      { documentId: 'uta-1', amount: 4000 },
      { documentId: 'uta-2', amount: 3000 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.OVER_ALLOCATED);
  });

  it('handles an unallocated movement', () => {
    const result = allocationSummary(movement, []);
    expect(result.ok).toBe(true);
    expect(result.allocated).toBe(0);
    expect(result.remainder).toBe(6178.14);
  });

  it('ignores the sign of the movement amount', () => {
    const result = allocationSummary({ id: 'mov-2', amount: -2050.15 }, [
      { documentId: 'payroll-1', amount: 2050.15 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.remainder).toBe(0);
  });

  it('rejects non-positive allocations', () => {
    const result = allocationSummary(movement, [{ documentId: 'uta-1', amount: 0 }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.NON_POSITIVE);
  });

  it('rejects allocating twice to the same document', () => {
    const result = allocationSummary(movement, [
      { documentId: 'uta-1', amount: 100 },
      { documentId: 'uta-1', amount: 200 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REJECTION.DUPLICATE_ALLOCATION);
  });

  it('absorbs floating dust when the split lands exactly', () => {
    const result = allocationSummary({ id: 'mov-3', amount: 100 }, [
      { documentId: 'a', amount: 33.33 },
      { documentId: 'b', amount: 33.33 },
      { documentId: 'c', amount: 33.34 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.remainder).toBe(0);
  });
});
