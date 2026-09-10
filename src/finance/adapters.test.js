import { describe, expect, it } from 'vitest';
import { bankMovementMatchRank } from './bankStatementParser.js';

import {
  adaptBankMovementDoc,
  adaptPayableDoc,
  adaptReceivableDoc,
} from './adapters.js';

describe('finance adapters document mapping', () => {
  it('maps receivable documents with ownership, payments, and legacy links', () => {
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
      // No taxRate on the source document, so none is invented: net stays gross.
      taxRate: 0,
      netAmount: 119,
      taxAmount: 0,
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
  const assertion = { sourceFormat: 'sparkasse-kontobewegungen', rowHash: 'datev-synthetic', postedDate: '2026-05-08', signedCents: -10000, balanceState: 'valid', balanceCents: 0 };

  it('retains validated flat evidence and excludes malformed versions/records', () => {
    const valid = adaptBankMovementDoc({ postedDate: assertion.postedDate, signedAmount: -100, bankEvidenceVersion: 1, bankEvidence: [assertion] });
    expect(valid.bankEvidenceVersion).toBe(1);
    expect(valid.bankEvidence).toEqual([assertion]);
    for (const metadata of [
      { bankEvidenceVersion: 2, bankEvidence: [assertion] },
      { bankEvidenceVersion: 1, bankEvidence: [{ ...assertion, balanceCents: null }] },
      { bankEvidenceVersion: 1, bankEvidence: [{ ...assertion, tan: 'unwanted' }] },
    ]) expect(adaptBankMovementDoc(metadata)).not.toHaveProperty('bankEvidence');
  });

  it('gives unknown or malformed metadata no contradiction authority over legacy observations', () => {
    const actual = { postedDate: '2026-05-08', amount: 100, direction: 'out', counterpartyName: 'ACME', counterpartyIban: 'DE111' };
    const contrary = { ...assertion, counterpartyIban: 'DE222' };
    for (const metadata of [
      { bankEvidenceVersion: 99, bankEvidence: [contrary] },
      { bankEvidenceVersion: '1', bankEvidence: [contrary] },
      { bankEvidenceVersion: 1, bankEvidence: [{ ...contrary, signedCents: '10000' }] },
    ]) {
      const adapted = adaptBankMovementDoc({ ...actual, ...metadata });
      expect(adapted).not.toHaveProperty('bankEvidence');
      expect(bankMovementMatchRank(actual, adapted)).toBeGreaterThan(0);
      expect(bankMovementMatchRank({ ...actual, counterpartyIban: 'DE222' }, adapted)).toBe(0);
    }
  });

  it('does not let sparse durable metadata hide actual bank fields or known currency', () => {
    const raw = { postedDate: '2026-05-08', amount: 100, direction: 'out', counterpartyName: 'ACME', counterpartyIban: 'DE111', currency: 'USD', bankEvidenceVersion: 1, bankEvidence: [assertion] };
    const adapted = adaptBankMovementDoc(raw);
    expect(bankMovementMatchRank({ ...raw, bankEvidenceVersion: undefined, counterpartyIban: 'DE222' }, adapted)).toBe(0);
    expect(bankMovementMatchRank({ ...raw, bankEvidenceVersion: undefined, currency: 'EUR' }, adapted)).toBe(0);
  });

  it('uses only actually present legacy fields, never display defaults as observations', () => {
    const raw = { id: 'legacy', importSource: 'datev', postedDate: '2026-05-08', amount: 100, direction: 'out', counterpartyName: 'ACME', counterpartyIban: 'DE111' };
    const adapted = adaptBankMovementDoc(raw);
    expect(adapted).toMatchObject({ id: 'legacy', importSource: 'datev', currency: 'EUR', accountId: 'main' });
    expect(adapted).not.toHaveProperty('bankEvidence');
    expect(bankMovementMatchRank({ ...raw, currency: 'USD' }, adapted)).toBeGreaterThan(0);
    expect(bankMovementMatchRank({ ...raw, counterpartyIban: 'DE222' }, adapted)).toBe(0);
    expect(raw).not.toHaveProperty('currency');
  });
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
      // Imported from a bank statement, which carries no VAT column.
      taxRate: 0,
      netAmount: 238,
      taxAmount: 0,
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

  it('passes the parsed SEPA purpose breakdown through, defaulting to null when absent', () => {
    const withSepa = adaptBankMovementDoc({
      id: 'bank-csv-1',
      direction: 'out',
      amount: 42.13,
      importSource: 'bank-csv',
      sepa: {
        endToEndRef: '85744504',
        customerRef: '',
        mandateRef: '175323001',
        creditorId: 'DE06UTA00000010046',
        debtorId: '',
        purposeCode: '',
        purpose: '58654564-1',
        alternativeCounterparty: '',
      },
    });

    expect(withSepa.sepa).toEqual({
      endToEndRef: '85744504',
      customerRef: '',
      mandateRef: '175323001',
      creditorId: 'DE06UTA00000010046',
      debtorId: '',
      purposeCode: '',
      purpose: '58654564-1',
      alternativeCounterparty: '',
    });

    const withoutSepa = adaptBankMovementDoc({ id: 'bank-csv-2', direction: 'out', amount: 10 });
    expect(withoutSepa.sepa).toBeNull();
  });

  it('passes through the Umsätze-only fields (bookingText, accountIban, balanceAfter), defaulting safely when absent', () => {
    const umsaetze = adaptBankMovementDoc({
      id: 'umsaetze-1',
      direction: 'out',
      amount: 25,
      bookingText: 'Basislastschrift',
      accountIban: 'DE76130910540001342860',
      balanceAfter: -28752.98,
    });
    expect(umsaetze).toMatchObject({
      bookingText: 'Basislastschrift',
      accountIban: 'DE76130910540001342860',
      balanceAfter: -28752.98,
    });

    const legacy = adaptBankMovementDoc({ id: 'legacy-1', direction: 'out', amount: 10 });
    expect(legacy).toMatchObject({ bookingText: '', accountIban: '', balanceAfter: null });
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
    expect(movement.costScope).toBe('');
  });

  // Every movement reaching the UI is adapted first (useBankMovements), so a
  // cost destination that does not survive this mapping is invisible to the
  // classification inbox and undercounts the coverage widget.
  it('carries the stored cost destination through to the UI', () => {
    const overhead = adaptBankMovementDoc({
      id: 'bank-overhead',
      direction: 'out',
      amount: 1200,
      costScope: 'overhead',
      categoryName: 'Impuestos',
    });
    expect(overhead.costScope).toBe('overhead');

    const site = adaptBankMovementDoc({
      id: 'bank-site',
      direction: 'out',
      amount: 800,
      costScope: 'project',
      projectId: 'proj-1',
      projectName: 'QFF',
    });
    expect(site.costScope).toBe('project');
  });

  // A Sparkasse account statement carries no VAT column, so an imported
  // movement has no rate. Assuming 19% there invented 317,274 EUR of tax
  // across the ledger — including on taxes, insurance and salaries, which
  // carry no German VAT at all — and BudgetVsActual/Nóminas read netAmount,
  // so every one of those figures came out 16% short. With no rate known,
  // net must equal gross.
  it('does not invent VAT when the movement carries no rate', () => {
    const movement = adaptBankMovementDoc({
      id: 'bank-no-rate',
      direction: 'out',
      amount: 1190,
      categoryName: 'Impuestos',
    });
    expect(movement.taxRate).toBe(0);
    expect(movement.netAmount).toBe(1190);
    expect(movement.taxAmount).toBe(0);
  });

  it('honours an explicit rate when one is actually known', () => {
    const movement = adaptBankMovementDoc({
      id: 'bank-rated',
      direction: 'out',
      amount: 1190,
      taxRate: 0.19,
    });
    expect(movement.netAmount).toBe(1000);
    expect(movement.taxAmount).toBe(190);
  });

  it('treats an explicit zero rate as zero, not as missing', () => {
    const movement = adaptBankMovementDoc({ id: 'bank-zero', direction: 'out', amount: 500, taxRate: 0 });
    expect(movement.netAmount).toBe(500);
    expect(movement.taxAmount).toBe(0);
  });

  it('drops an unrecognized cost destination instead of propagating it', () => {
    const movement = adaptBankMovementDoc({
      id: 'bank-garbage',
      direction: 'out',
      amount: 10,
      costScope: 'nonsense',
    });
    expect(movement.costScope).toBe('');
  });
});

