import { describe, expect, it } from 'vitest';

import {
  adaptBankMovementDoc,
  adaptPayableDoc,
  adaptReceivableDoc,
} from './adapters.js';

describe('finance adapters document mapping', () => {
  it('maps receivable documents with ownership, VAT defaults, payments, and legacy links', () => {
    const receivable = adaptReceivableDoc({
      id: 'invoice-1',
      amount: 119,
      paidAmount: 40,
      status: 'partial',
      issueDate: '2026-04-01T10:00:00.000Z',
      dueDate: '2027-04-30',
      client: 'Insyte Austria',
      description: 'Fiber works',
      invoiceNumber: 'RE-100',
      projectId: 'project-1',
      projectName: 'Rollout North',
      costCenter: 'cc-fiber',
      payments: [{ amount: '40.126', date: '2026-04-10', reference: 'bank-ref' }],
      linkedTransactionId: 'tx-1',
      createdBy: 'jromero',
      lastModifiedBy: 'bsandoval',
    });

    expect(receivable).toMatchObject({
      id: 'invoice-1',
      kind: 'receivable',
      source: 'receivable',
      accountId: 'main',
      currency: 'EUR',
      grossAmount: 119,
      openAmount: 79,
      paidAmount: 40,
      stage: 'partial',
      status: 'partial',
      issueDate: '2026-04-01',
      dueDate: '2027-04-30',
      counterpartyName: 'Insyte Austria',
      description: 'Fiber works',
      documentNumber: 'RE-100',
      projectId: 'project-1',
      projectName: 'Rollout North',
      costCenterId: 'cc-fiber',
      linkedTransactionId: 'tx-1',
      legacyTransactionId: 'invoice-1',
      createdBy: 'jromero',
      updatedBy: 'bsandoval',
      taxRate: 0.19,
      netAmount: 100,
      taxAmount: 19,
    });
    expect(receivable.payments).toEqual([
      {
        id: '2026-04-10-0',
        amount: 40.13,
        date: '2026-04-10',
        method: 'Transferencia',
        note: 'bank-ref',
        user: '',
        timestamp: '2026-04-10',
      },
    ]);
  });

  it('maps payable documents with explicit tax fields and fallback counterparty data', () => {
    const payable = adaptPayableDoc({
      id: 'bill-1',
      grossAmount: 200,
      openAmount: 0,
      status: 'paid',
      date: '2026-03-05',
      vendor: 'MQH Telecomunicaciones',
      category: 'Subcontractors',
      project: 'Sin proyecto',
      taxRate: 0.07,
      netAmount: 186.92,
      taxAmount: 13.08,
    }, 'manual-payable');

    expect(payable).toMatchObject({
      id: 'bill-1',
      kind: 'payable',
      source: 'manual-payable',
      grossAmount: 200,
      openAmount: 0,
      paidAmount: 200,
      stage: 'settled',
      status: 'settled',
      issueDate: '2026-03-05',
      dueDate: '2026-03-05',
      counterpartyName: 'MQH Telecomunicaciones',
      description: 'Subcontractors',
      projectName: 'Sin proyecto',
      taxRate: 0.07,
      netAmount: 186.92,
      taxAmount: 13.08,
    });
  });

  it('surfaces payroll markers as first-class fields for the Nóminas join', () => {
    const payable = adaptPayableDoc({
      id: 'pay-nom-1',
      grossAmount: 7721.08,
      openAmount: 7721.08,
      status: 'issued',
      vendor: 'EK BARMER',
      payrollPeriodId: 'PER_X',
      payrollKind: 'krankenkasse',
      sourceDocument: { periodId: 'PER_X', kind: 'zakf', fileName: 'zakf_2026-04.pdf', hash: 'abc123' },
    });

    // The Nóminas view filters payables by TOP-LEVEL payrollPeriodId; the adapter
    // must surface it (regression: it previously lived only under .raw, so the
    // obligation→payable join was always empty and live status never rendered).
    expect(payable.payrollPeriodId).toBe('PER_X');
    expect(payable.payrollKind).toBe('krankenkasse');
    expect(payable.sourceDocument).toMatchObject({ kind: 'zakf', hash: 'abc123' });
  });
});

describe('finance adapters bank movement mapping', () => {
  it('maps posted outbound bank movements with project, category, VAT, and reconciliation fields', () => {
    const movement = adaptBankMovementDoc({
      id: 'bank-1',
      kind: 'payment',
      direction: 'out',
      amount: 238,
      valueDate: '2026-04-15T12:00:00.000Z',
      description: 'Supplier payment',
      vendor: 'Fractalkom UG',
      invoiceNumber: 'F-1',
      project: 'Rollout South',
      costCenter: 'cc-build',
      payableId: 'payable-1',
      legacyTransactionId: 'legacy-1',
      reconciliationId: 'recon-1',
      category: 'Materials',
      createdBy: 'bsandoval',
    });

    expect(movement).toMatchObject({
      id: 'bank-1',
      source: 'bankMovement',
      kind: 'payment',
      status: 'posted',
      accountId: 'main',
      currency: 'EUR',
      direction: 'out',
      amount: 238,
      postedDate: '2026-04-15',
      valueDate: '2026-04-15',
      description: 'Supplier payment',
      counterpartyName: 'Fractalkom UG',
      documentNumber: 'F-1',
      projectName: 'Rollout South',
      costCenterId: 'cc-build',
      payableId: 'payable-1',
      legacyTransactionId: 'legacy-1',
      reconciliationId: 'recon-1',
      createdBy: 'bsandoval',
      taxRate: 0.19,
      netAmount: 200,
      taxAmount: 38,
      categoryName: 'Materials',
    });
  });

  it('preserves additive DATEV identity and import metadata safely', () => {
    const movement = adaptBankMovementDoc({
      id: 'datev-bank-1',
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      importSource: 'datev',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDatev: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    });

    expect(movement).toMatchObject({
      id: 'datev-bank-1',
      amount: 42.13,
      signedAmount: -42.13,
      direction: 'out',
      importSource: 'datev',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDatev: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    });
  });

  it('normalizes partial bank movement data to safe defaults', () => {
    const movement = adaptBankMovementDoc({ id: 'bank-partial', amount: '49.995', direction: 'sideways', taxRate: 0 });

    expect(movement).toMatchObject({
      id: 'bank-partial',
      kind: 'adjustment',
      status: 'posted',
      direction: 'in',
      amount: 50,
      projectName: 'Sin proyecto',
      receivableId: null,
      payableId: null,
      linkedTransactionId: null,
      legacyTransactionId: null,
      taxRate: 0,
      netAmount: 50,
      taxAmount: 0,
      categoryName: '',
    });
    expect(movement.postedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(movement.valueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

