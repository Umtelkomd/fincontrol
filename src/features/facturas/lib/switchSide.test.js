import { describe, expect, it } from 'vitest';
import { planInvoiceSwitchSide, switchSideBlocker } from './switchSide';

const SHA = 'a'.repeat(64);

const archived = (overrides = {}) => ({
  id: SHA,
  direction: 'outgoing',
  family: 'receivable',
  counterpartyName: 'Würth',
  counterpartyId: 'Würth',
  invoiceNumber: 'W-123',
  grossAmount: 119,
  linkMode: 'create-ordinary',
  links: [{ family: 'receivable', recordId: 'cxc-1' }],
  ...overrides,
});

const cxc = (overrides = {}) => ({
  id: 'cxc-1',
  kind: 'receivable',
  status: 'issued',
  paidAmount: 0,
  payments: [],
  raw: {
    id: 'cxc-1',
    client: 'Würth',
    counterpartyName: 'Würth',
    documentNumber: 'W-123',
    grossAmount: 119,
    netAmount: 100,
    taxAmount: 19,
    projectName: 'Roßdorf',
    costCenterId: 'CC-110',
    categoryName: 'Ventas',
    invoiceDocumentIds: [SHA],
  },
  ...overrides,
});

const plan = (overrides = {}) =>
  planInvoiceSwitchSide({
    invoiceDocument: archived(),
    obligations: [cxc()],
    bankMovements: [],
    reason: 'Es una factura de proveedor',
    userEmail: 'b@umtelkomd.com',
    nowIso: '2026-09-30T10:00:00.000Z',
    ...overrides,
  });

describe('planInvoiceSwitchSide', () => {
  it('moves an emitted invoice and its CXC to the CXP side', () => {
    const result = plan();
    expect(result.valid).toBe(true);
    expect(result.fromFamily).toBe('receivable');
    expect(result.toFamily).toBe('payable');
    expect(result.archivePatch.direction).toBe('incoming');
    expect(result.archivePatch.family).toBe('payable');
    // incoming invoices are issued by the supplier, not by us
    expect(JSON.parse(result.archivePatch.identity)).toEqual(['invoice-v2', 'incoming', 'Würth', 'W-123']);
    expect(result.obligation.id).toBe('cxc-1');
    expect(result.obligation.payload).toMatchObject({
      vendor: 'Würth',
      documentNumber: 'W-123',
      grossAmount: 119,
      openAmount: 119,
      netAmount: 100,
      costCenterId: 'CC-110',
      categoryName: '',
      invoiceDocumentIds: [SHA],
      _convertedFrom: { collection: 'receivables', id: 'cxc-1' },
    });
    expect(result.obligation.payload.auditTrail[0].detail).toMatch(/Motivo: Es una factura de proveedor/);
  });

  it('moves a received invoice to CXC with UMTELKOMD as issuer', () => {
    const result = plan({
      invoiceDocument: archived({ direction: 'incoming', family: 'payable', links: [{ family: 'payable', recordId: 'cxp-1' }] }),
      obligations: [{ ...cxc(), id: 'cxp-1', kind: 'payable', raw: { id: 'cxp-1', vendor: 'Würth', grossAmount: 119 } }],
    });
    expect(result.valid).toBe(true);
    expect(result.toFamily).toBe('receivable');
    expect(JSON.parse(result.archivePatch.identity)[2]).toBe('umtelkomd');
    expect(result.obligation.payload.client).toBe('Würth');
  });

  it('flips an unlinked archive without touching any obligation', () => {
    const result = plan({ invoiceDocument: archived({ links: [] }) });
    expect(result.valid).toBe(true);
    expect(result.obligation).toBeNull();
    expect(result.archivePatch.family).toBe('payable');
  });

  it('requires a reason', () => {
    expect(plan({ reason: '  ' })).toMatchObject({ valid: false });
  });

  it('refuses when the obligation carries money or is gone', () => {
    expect(plan({ obligations: [cxc({ paidAmount: 50 })] }).valid).toBe(false);
    expect(plan({ obligations: [cxc({ status: 'settled' })] }).valid).toBe(false);
    expect(plan({ obligations: [cxc({ status: 'cancelled' })] }).error).toMatch(/cancelada/);
    expect(plan({ obligations: [] }).error).toMatch(/ya no existe/);
    expect(
      plan({ bankMovements: [{ id: 'm1', receivableId: 'cxc-1', status: 'posted' }] }).valid,
    ).toBe(false);
  });

  it('refuses an archive linked to several obligations', () => {
    const doc = archived({ links: [{ family: 'receivable', recordId: 'cxc-1' }, { family: 'receivable', recordId: 'cxc-2' }] });
    expect(switchSideBlocker({ invoiceDocument: doc, obligations: [cxc()] })).toMatch(/varias/);
  });
});
