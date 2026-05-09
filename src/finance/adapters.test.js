import { describe, expect, it } from 'vitest';

import { balances2025 } from '../data/balances2025.js';
import {
  adaptBankMovementDoc,
  adaptLegacyTransactionToMovement,
  adaptLegacyTransactionToPayable,
  adaptLegacyTransactionToReceivable,
  adaptPayableDoc,
  adaptReceivableDoc,
  createLegacyOpeningPayables,
  createLegacyOpeningReceivables,
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

describe('finance adapters legacy transaction mapping', () => {
  it('converts paid legacy income to an inbound collection movement with VAT metadata', () => {
    const movement = adaptLegacyTransactionToMovement({
      id: 'legacy-income-1',
      type: 'income',
      status: 'completed',
      amount: 119,
      paidDate: '2026-04-20',
      date: '2026-04-01',
      description: 'Customer invoice',
      counterparty: 'Jorge Moran',
      invoiceNumber: 'INV-1',
      project: 'Housing',
      costCenter: 'cc-admin',
      category: 'Services',
      createdBy: 'jromero',
    });

    expect(movement).toMatchObject({
      id: 'legacy-movement-legacy-income-1',
      source: 'legacy-transaction',
      kind: 'legacy-collection',
      direction: 'in',
      amount: 119,
      postedDate: '2026-04-20',
      valueDate: '2026-04-20',
      counterpartyName: 'Jorge Moran',
      documentNumber: 'INV-1',
      projectName: 'Housing',
      costCenterId: 'cc-admin',
      linkedTransactionId: 'legacy-income-1',
      legacyTransactionId: 'legacy-income-1',
      createdBy: 'jromero',
      taxRate: 0.19,
      netAmount: 100,
      taxAmount: 19,
      categoryName: 'Services',
    });
  });

  it('converts partially paid legacy expenses to outbound payment movements and ignores unsettled rows', () => {
    const movement = adaptLegacyTransactionToMovement({
      id: 'legacy-expense-1',
      type: 'expense',
      status: 'partial',
      amount: 500,
      paidAmount: 125.555,
      date: '2026-04-03',
      description: 'Supplier bill',
      counterparty: 'Supplier GmbH',
      taxRate: 0,
    });

    expect(movement).toMatchObject({
      id: 'legacy-movement-legacy-expense-1',
      kind: 'legacy-payment',
      direction: 'out',
      amount: 125.56,
      postedDate: '2026-04-03',
      valueDate: '2026-04-03',
      counterpartyName: 'Supplier GmbH',
      taxRate: 0,
      netAmount: 125.56,
      taxAmount: 0,
    });
    expect(adaptLegacyTransactionToMovement({ id: 'draft-1', type: 'income', status: 'issued', amount: 300 })).toBeNull();
  });

  it('creates open receivables and payables from legacy rows while filtering closed or wrong-type rows', () => {
    const receivable = adaptLegacyTransactionToReceivable({
      id: 'income-open-1',
      type: 'income',
      status: 'partial',
      amount: 250,
      paidAmount: 100,
      date: '2026-04-05',
      dueDate: '2027-05-01',
      counterparty: 'Customer AG',
      project: 'Expansion',
    });
    const payable = adaptLegacyTransactionToPayable({
      id: 'expense-open-1',
      type: 'expense',
      status: 'issued',
      amount: 400,
      paidAmount: 0,
      date: '2026-04-06',
      dueDate: '2027-05-02',
      counterparty: 'Vendor AG',
      project: 'Expansion',
    });

    expect(receivable).toMatchObject({
      id: 'legacy-receivable-income-open-1',
      kind: 'receivable',
      source: 'legacy-transaction',
      grossAmount: 250,
      paidAmount: 100,
      openAmount: 150,
      stage: 'partial',
      status: 'partial',
      counterpartyName: 'Customer AG',
      projectName: 'Expansion',
      legacyTransactionId: 'income-open-1',
      linkedTransactionId: 'income-open-1',
    });
    expect(payable).toMatchObject({
      id: 'legacy-payable-expense-open-1',
      kind: 'payable',
      source: 'legacy-transaction',
      grossAmount: 400,
      paidAmount: 0,
      openAmount: 400,
      stage: 'issued',
      status: 'issued',
      counterpartyName: 'Vendor AG',
      projectName: 'Expansion',
      legacyTransactionId: 'expense-open-1',
      linkedTransactionId: 'expense-open-1',
    });
    expect(adaptLegacyTransactionToReceivable({ id: 'expense-closed', type: 'expense', amount: 100 })).toBeNull();
    expect(adaptLegacyTransactionToPayable({ id: 'income-closed', type: 'income', amount: 100 })).toBeNull();
    expect(adaptLegacyTransactionToReceivable({ id: 'income-paid', type: 'income', amount: 100, paidAmount: 100 })).toBeNull();
  });
});

describe('finance adapters opening balance mapping', () => {
  it('creates opening receivables from 2025 CXC balances', () => {
    const receivables = createLegacyOpeningReceivables();

    expect(receivables).toHaveLength(balances2025.cxcPendiente.length);
    expect(receivables[0]).toMatchObject({
      id: 'legacy-opening-cxc-1',
      kind: 'receivable',
      source: 'legacy-opening',
      grossAmount: 342.48,
      openAmount: 342.48,
      paidAmount: 0,
      issueDate: '2025-12-31',
      dueDate: '2026-01-09',
      counterpartyName: 'Insyte Austria',
      description: 'Trabajos de soplado y fusiones FCP',
      projectName: 'Saldo inicial 2025',
      documentNumber: 'SALDO-2025-CXC-1',
      legacyTransactionId: 'opening-cxc-1',
      createdBy: 'legacy',
      taxRate: 0.19,
    });
  });

  it('creates opening payables from 2025 CXP balances', () => {
    const payables = createLegacyOpeningPayables();

    expect(payables).toHaveLength(balances2025.cxpPendiente.length);
    expect(payables[0]).toMatchObject({
      id: 'legacy-opening-cxp-1',
      kind: 'payable',
      source: 'legacy-opening',
      grossAmount: 1060,
      openAmount: 1060,
      paidAmount: 0,
      issueDate: '2025-12-31',
      dueDate: '2025-12-08',
      counterpartyName: 'Jorge Lider Moran',
      description: 'R-3',
      projectName: 'Saldo inicial 2025',
      documentNumber: 'SALDO-2025-CXP-1',
      legacyTransactionId: 'opening-cxp-1',
      createdBy: 'legacy',
      taxRate: 0.19,
    });
  });
});
