import { describe, expect, it } from 'vitest';
import { buildConvertedPayload, conversionBlocker } from './obligationConversion';

const row = (raw = {}, overrides = {}) => ({
  id: 'doc-1',
  status: 'issued',
  paidAmount: 0,
  ...overrides,
  raw: { id: 'doc-1', grossAmount: 1190, ...raw },
});

describe('conversionBlocker', () => {
  it('allows an open, unlinked invoice', () => {
    expect(conversionBlocker(row(), 'receivable')).toBeNull();
    expect(conversionBlocker(row(), 'payable')).toBeNull();
  });

  it('blocks cancelled, paid, bank-linked and PDF-backed invoices', () => {
    expect(conversionBlocker(row({}, { status: 'cancelled' }), 'receivable')).toMatch(/cancelada/);
    expect(conversionBlocker(row({}, { paidAmount: 10 }), 'receivable')).toMatch(/cobros/);
    expect(conversionBlocker(row({ payments: [{ amount: 1 }] }), 'payable')).toMatch(/pagos/);
    expect(conversionBlocker(row({ bankMovementId: 'mov-1' }), 'payable')).toMatch(/movimiento bancario/);
    expect(conversionBlocker(row({ bankMovementIds: ['mov-1'] }), 'receivable')).toMatch(/movimiento bancario/);
    expect(conversionBlocker(row({ invoiceDocumentIds: ['abc'] }), 'receivable')).toMatch(/PDF archivado/);
  });

  it('works on a plain record without raw', () => {
    expect(conversionBlocker({ id: 'x', status: 'issued', bankMovementId: 'm' }, 'payable')).toMatch(/movimiento/);
  });
});

describe('buildConvertedPayload', () => {
  const source = row({
    client: 'ACME GmbH',
    counterpartyName: 'ACME GmbH',
    documentNumber: '2025-300',
    projectName: 'Roßdorf',
    costCenterId: 'CC-110',
    categoryName: 'Ventas',
    taxRate: 0.19,
    netAmount: 1000,
    taxAmount: 190,
    issueDate: '2026-09-01',
    dueDate: '2026-10-01',
  });

  it('turns a CXC into an open CXP for the same counterparty and amount', () => {
    const payload = buildConvertedPayload(source, 'receivable', 'a@b.c', '2026-09-30T10:00:00.000Z');
    expect(payload).toMatchObject({
      vendor: 'ACME GmbH',
      counterpartyName: 'ACME GmbH',
      documentNumber: '2025-300',
      invoiceNumber: '2025-300',
      grossAmount: 1190,
      openAmount: 1190,
      paidAmount: 0,
      status: 'issued',
      netAmount: 1000,
      taxAmount: 190,
      taxRate: 0.19,
      costCenterId: 'CC-110',
      categoryName: '',
      _convertedFrom: { collection: 'receivables', id: 'doc-1' },
      createdBy: 'a@b.c',
    });
    expect(payload.client).toBeUndefined();
    expect(payload.auditTrail[0].detail).toMatch(/desde CXC/);
  });

  it('turns a CXP into a CXC with client set', () => {
    const payload = buildConvertedPayload(row({ vendor: 'Würth', grossAmount: 50 }), 'payable', 'a@b.c', 'now');
    expect(payload).toMatchObject({ client: 'Würth', counterpartyName: 'Würth', grossAmount: 50 });
    expect(payload.vendor).toBeUndefined();
    expect(payload._convertedFrom.collection).toBe('payables');
  });
});
