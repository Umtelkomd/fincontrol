import { describe, expect, it } from 'vitest';

import {
  MOVEMENT_EVIDENCE,
  isReconciledMovement,
  linkedDocumentIds,
  movementEvidence,
} from './movementEvidence.js';

const docs = new Map([
  ['cxc-248', { id: 'cxc-248', documentNumber: '2025-248', status: 'settled' }],
  ['cxc-249', { id: 'cxc-249', documentNumber: '2025-249', status: 'settled' }],
  ['cxp-uta', { id: 'cxp-uta', invoiceNumber: '21555427', status: 'settled' }],
  ['cxp-nonum', { id: 'cxp-nonum', documentNumber: '', status: 'settled' }],
  ['cxc-cancelled', { id: 'cxc-cancelled', documentNumber: '2025-001', status: 'cancelled' }],
]);

describe('linkedDocumentIds', () => {
  it('merges single and grouped links without duplicates', () => {
    expect(linkedDocumentIds({ receivableId: 'a', receivableIds: ['a', 'b'], payableIds: ['c'] }))
      .toEqual({ payables: ['c'], receivables: ['a', 'b'] });
  });
});

describe('isReconciledMovement', () => {
  it('counts a movement reconciled against several documents', () => {
    expect(isReconciledMovement({ receivableId: null, receivableIds: ['cxc-248', 'cxc-249'] })).toBe(true);
  });

  it('counts documents kept in Excel as reconciled', () => {
    expect(isReconciledMovement({ payableIds: [], reconciliationMode: 'external-excel' })).toBe(true);
  });

  it('never counts a void or unlinked movement', () => {
    expect(isReconciledMovement({ status: 'void', payableId: 'cxp-uta' })).toBe(false);
    expect(isReconciledMovement({ payableIds: [] })).toBe(false);
  });
});

describe('movementEvidence', () => {
  it('shows the invoice number when the single document has one', () => {
    expect(movementEvidence({ receivableId: 'cxc-248' }, docs))
      .toMatchObject({ kind: MOVEMENT_EVIDENCE.INVOICED, label: 'Conciliado · 2025-248' });
  });

  it('counts the invoices of a grouped receipt', () => {
    expect(movementEvidence({ receivableIds: ['cxc-248', 'cxc-249'] }, docs))
      .toMatchObject({ kind: MOVEMENT_EVIDENCE.INVOICED, label: 'Conciliado · 2 facturas' });
  });

  it('accepts invoiceNumber as the invoice number', () => {
    expect(movementEvidence({ payableIds: ['cxp-uta'] }, docs).kind).toBe(MOVEMENT_EVIDENCE.INVOICED);
  });

  it.each([
    ['a document without a number', { payableIds: ['cxp-uta', 'cxp-nonum'] }],
    ['a link to a missing document', { receivableIds: ['cxc-248', 'ghost'] }],
    ['a link to a cancelled document', { receivableId: 'cxc-cancelled' }],
  ])('is "sin factura" with %s', (_, movement) => {
    expect(movementEvidence(movement, docs)).toMatchObject({ kind: MOVEMENT_EVIDENCE.NO_INVOICE, label: 'Conciliado sin factura' });
  });

  it('labels documents kept in Excel', () => {
    expect(movementEvidence({ reconciliationMode: 'external-excel' }, docs))
      .toMatchObject({ kind: MOVEMENT_EVIDENCE.EXTERNAL, label: 'Conciliado (Excel)' });
  });

  it('returns null for an unreconciled movement', () => {
    expect(movementEvidence({ categoryName: 'Material' }, docs)).toBeNull();
  });
});
