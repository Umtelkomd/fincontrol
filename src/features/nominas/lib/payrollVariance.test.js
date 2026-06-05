import { describe, expect, it } from 'vitest';
import { obligationVariance, periodVarianceSummary } from './payrollVariance.js';

// ─── obligationVariance ───────────────────────────────────────────────────────

describe('obligationVariance', () => {
  it('returns cuadra when reconciled equals expected', () => {
    const out = obligationVariance({
      obligation: { amount: 7721.08 },
      payable: { status: 'settled', paidAmount: 7721.08 },
    });
    expect(out.status).toBe('cuadra');
    expect(out.ok).toBe(true);
    expect(out.diff).toBe(0);
  });

  it('returns descuadre with signed diff when amounts differ', () => {
    const out = obligationVariance({
      obligation: { amount: 7721.08 },
      payable: { status: 'settled', paidAmount: 7700 },
    });
    expect(out.status).toBe('descuadre');
    expect(out.ok).toBe(false);
    expect(out.diff).toBeCloseTo(21.08, 2);
  });

  it('returns pending when no linked payable exists', () => {
    const out = obligationVariance({ obligation: { amount: 100 }, payable: null });
    expect(out.status).toBe('pending');
    expect(out.reconciled).toBe(0);
  });

  it('returns pending when the payable is still issued (not reconciled)', () => {
    const out = obligationVariance({
      obligation: { amount: 100 },
      payable: { status: 'issued', reconciledAmount: 0 },
    });
    expect(out.status).toBe('pending');
  });

  it('uses paidAmount (per-allocation share) and IGNORES reconciledAmount on the payable', () => {
    // reconciledAmount lives on the bank movement (the full allocated total);
    // using it would mis-compare a grouped movement against one payable.
    const out = obligationVariance({
      obligation: { amount: 100 },
      payable: { status: 'settled', reconciledAmount: 999, paidAmount: 100 },
    });
    expect(out.reconciled).toBe(100);
    expect(out.status).toBe('cuadra');
  });

  it('tolerates a one-cent rounding gap', () => {
    const out = obligationVariance({
      obligation: { amount: 100.0 },
      payable: { status: 'settled', paidAmount: 100.01 },
    });
    expect(out.ok).toBe(true);
    expect(out.status).toBe('cuadra');
  });
});

// ─── periodVarianceSummary ────────────────────────────────────────────────────

describe('periodVarianceSummary', () => {
  it('reports todo cuadra when every reconciled obligation matches', () => {
    const rows = [
      { status: 'cuadra', diff: 0, payee: 'BARMER' },
      { status: 'cuadra', diff: 0, payee: 'AOK' },
      { status: 'pending', diff: 0, payee: 'FA' },
    ];
    const out = periodVarianceSummary(rows);
    expect(out.label).toBe('todo cuadra');
    expect(out.allReconciled).toBe(false); // a pending one remains
    expect(out.descuadres).toEqual([]);
    expect(out.totalDiff).toBe(0);
  });

  it('reports descuadre and lists the offending obligations', () => {
    const rows = [
      { status: 'cuadra', diff: 0, payee: 'BARMER' },
      { status: 'descuadre', diff: 21.08, payee: 'AOK' },
    ];
    const out = periodVarianceSummary(rows);
    expect(out.label).toBe('descuadre');
    expect(out.descuadres).toHaveLength(1);
    expect(out.descuadres[0].payee).toBe('AOK');
    expect(out.totalDiff).toBeCloseTo(21.08, 2);
  });

  it('flags allReconciled true when no pending remain and all cuadra', () => {
    const rows = [
      { status: 'cuadra', diff: 0, payee: 'BARMER' },
      { status: 'cuadra', diff: 0, payee: 'AOK' },
    ];
    const out = periodVarianceSummary(rows);
    expect(out.allReconciled).toBe(true);
    expect(out.label).toBe('todo cuadra');
  });

  it('returns todo cuadra for an all-pending period (nothing reconciled yet)', () => {
    const rows = [
      { status: 'pending', diff: 0, payee: 'BARMER' },
      { status: 'pending', diff: 0, payee: 'AOK' },
    ];
    const out = periodVarianceSummary(rows);
    expect(out.label).toBe('todo cuadra');
    expect(out.allReconciled).toBe(false);
  });
});
