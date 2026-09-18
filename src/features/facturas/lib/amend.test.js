/**
 * amend.js — orchestration tests. Only ordering/failure-reporting behaviour
 * is exercised here; every planning decision (locks, ownership, patches) is
 * already pinned by src/finance/invoiceAmendment.test.js.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyInvoiceDelete, applyInvoiceEdit, applyInvoiceReplace } from './amend.js';

const invoiceDocument = (overrides = {}) => ({
  id: 'a'.repeat(64),
  sizeBytes: 51200,
  direction: 'incoming',
  family: 'payable',
  sourceSystem: 'ordinary',
  counterpartyName: 'Kabel Service GmbH',
  counterpartyId: 'Kabel Service GmbH',
  invoiceNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  currency: 'EUR',
  netAmount: 1000,
  taxAmount: 190,
  grossAmount: 1190,
  identity: JSON.stringify(['invoice-v2', 'incoming', 'Kabel Service GmbH', 'RE-2026-050']),
  linkMode: 'create-ordinary',
  links: [{ family: 'payable', recordId: 'cxp-1' }],
  ...overrides,
});

const payable = (overrides = {}) => ({
  id: 'cxp-1',
  kind: 'payable',
  paidAmount: 0,
  payments: [],
  status: 'issued',
  counterpartyName: 'Kabel Service GmbH',
  documentNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC-120',
  categoryName: 'Materiales',
  grossAmount: 1190,
  ...overrides,
});

const validForm = (overrides = {}) => ({
  counterpartyName: 'Kabel Service Neu GmbH',
  invoiceNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  netAmount: 1000,
  taxAmount: 190,
  grossAmount: 1190,
  categoryName: 'Materiales',
  projectId: 'proj-1',
  costCenterId: 'CC-120',
  reason: 'Corrección de contraparte',
  ...overrides,
});

describe('applyInvoiceEdit', () => {
  it('returns the invalid plan and calls no effect when the form fails validation', async () => {
    const effects = {
      updateObligation: vi.fn(),
      updateMovement: vi.fn(),
      updateArchive: vi.fn(),
      writeAudit: vi.fn(),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: { ...validForm(), reason: '' } },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.plan.valid).toBe(false);
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('applies the owned obligation patch, then the archive patch, then writes one audit entry', async () => {
    const calls = [];
    const effects = {
      updateObligation: vi.fn(async (family, id) => {
        calls.push(`obligation:${family}:${id}`);
        return { success: true };
      }),
      updateMovement: vi.fn(async (id) => {
        calls.push(`movement:${id}`);
      }),
      updateArchive: vi.fn(async () => {
        calls.push('archive');
      }),
      writeAudit: vi.fn(async () => {
        calls.push('audit');
      }),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['obligation:payable:cxp-1', 'archive', 'audit']);
    expect(effects.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', entityType: 'invoiceDocument', entityId: invoiceDocument().id }),
    );
  });

  it('reports partial failure without throwing when the obligation write fails, and still tries the archive patch', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: false, error: new Error('boom') })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {}),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.failures).toEqual([expect.objectContaining({ stage: 'obligation' })]);
    expect(effects.updateArchive).toHaveBeenCalled();
  });

  it('skips the archive effect entirely when nothing on the archive doc changed', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: true })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {}),
    };
    // Only classification changes (no counterparty/number/date/amount change) → no archivePatch keys.
    const form = validForm({ counterpartyName: 'Kabel Service GmbH', categoryName: 'Materiales' });

    await applyInvoiceEdit({ invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form }, effects);

    expect(effects.updateArchive).not.toHaveBeenCalled();
  });
});

describe('applyInvoiceDelete', () => {
  it('removes every back-reference, then deletes chunks, then the archive doc, then writes one audit entry', async () => {
    const calls = [];
    const effects = {
      removeBackReference: vi.fn(async (family, id) => calls.push(`backref:${family}:${id}`)),
      cancelObligation: vi.fn(async () => ({ success: true })),
      deleteChunks: vi.fn(async () => calls.push('chunks')),
      deleteArchive: vi.fn(async () => calls.push('archive')),
      writeAudit: vi.fn(async () => calls.push('audit')),
    };

    const result = await applyInvoiceDelete(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], reason: 'Duplicada' },
      effects,
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['backref:payable:cxp-1', 'chunks', 'archive', 'audit']);
  });

  it('cancels an owned, unlocked obligation when requested, before deleting chunks', async () => {
    const calls = [];
    const effects = {
      removeBackReference: vi.fn(async () => calls.push('backref')),
      cancelObligation: vi.fn(async (family, id) => {
        calls.push(`cancel:${family}:${id}`);
        return { success: true };
      }),
      deleteChunks: vi.fn(async () => calls.push('chunks')),
      deleteArchive: vi.fn(async () => calls.push('archive')),
      writeAudit: vi.fn(async () => {}),
    };

    await applyInvoiceDelete(
      {
        invoiceDocument: invoiceDocument(),
        obligations: [payable()],
        bankMovements: [],
        cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }],
        reason: 'Duplicada',
      },
      effects,
    );

    expect(calls.indexOf('cancel:payable:cxp-1')).toBeLessThan(calls.indexOf('chunks'));
  });

  it('stops BEFORE deleting the archive doc when a back-reference removal fails — the row stays retryable', async () => {
    const effects = {
      removeBackReference: vi.fn(async () => {
        throw new Error('offline');
      }),
      cancelObligation: vi.fn(async () => ({ success: true })),
      deleteChunks: vi.fn(async () => {}),
      deleteArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {}),
    };

    const result = await applyInvoiceDelete(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], reason: 'Duplicada' },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(effects.deleteChunks).not.toHaveBeenCalled();
    expect(effects.deleteArchive).not.toHaveBeenCalled();
  });

  it('never cancels a blocked (locked or foreign) obligation, even when requested', async () => {
    const effects = {
      removeBackReference: vi.fn(async () => {}),
      cancelObligation: vi.fn(async () => ({ success: true })),
      deleteChunks: vi.fn(async () => {}),
      deleteArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {}),
    };

    await applyInvoiceDelete(
      {
        invoiceDocument: invoiceDocument(),
        obligations: [payable({ paidAmount: 500, status: 'partial' })],
        bankMovements: [],
        cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }],
        reason: 'Duplicada',
      },
      effects,
    );

    expect(effects.cancelObligation).not.toHaveBeenCalled();
  });
});

describe('applyInvoiceReplace', () => {
  const newFile = () => ({ sha256: 'b'.repeat(64), sizeBytes: 20480, mimeType: 'application/pdf', originalName: 'nueva.pdf' });

  it('returns invalid without calling any effect for the same sha256', async () => {
    const effects = {
      uploadPdf: vi.fn(),
      commitNewDocument: vi.fn(),
      swapBackReference: vi.fn(),
      deleteOldChunks: vi.fn(),
      deleteOldArchive: vi.fn(),
      writeAudit: vi.fn(),
    };
    const doc = invoiceDocument();

    const result = await applyInvoiceReplace(
      { invoiceDocument: doc, newFile: { ...newFile(), sha256: doc.id }, bytes: new Uint8Array(4) },
      effects,
    );

    expect(result.success).toBe(false);
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('uploads, commits the new document, swaps every back-reference, then deletes the OLD chunks and doc last', async () => {
    const calls = [];
    const effects = {
      uploadPdf: vi.fn(async ({ expectedSha256 }) => {
        calls.push('upload');
        return { sha256: expectedSha256, sizeBytes: 20480, mimeType: 'application/pdf' };
      }),
      commitNewDocument: vi.fn(async () => calls.push('commitNew')),
      swapBackReference: vi.fn(async (family, id) => calls.push(`swap:${family}:${id}`)),
      deleteOldChunks: vi.fn(async () => calls.push('deleteOldChunks')),
      deleteOldArchive: vi.fn(async () => calls.push('deleteOldArchive')),
      writeAudit: vi.fn(async () => calls.push('audit')),
    };

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4) },
      effects,
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['upload', 'commitNew', 'swap:payable:cxp-1', 'deleteOldChunks', 'deleteOldArchive', 'audit']);
  });

  it('fails closed and never deletes the old PDF when the uploaded hash does not match', async () => {
    const effects = {
      uploadPdf: vi.fn(async () => ({ sha256: 'c'.repeat(64), sizeBytes: 1 })), // wrong hash
      commitNewDocument: vi.fn(async () => {}),
      swapBackReference: vi.fn(async () => {}),
      deleteOldChunks: vi.fn(async () => {}),
      deleteOldArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {}),
    };

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4) },
      effects,
    );

    expect(result.success).toBe(false);
    expect(effects.commitNewDocument).not.toHaveBeenCalled();
    expect(effects.deleteOldChunks).not.toHaveBeenCalled();
    expect(effects.deleteOldArchive).not.toHaveBeenCalled();
  });
});
