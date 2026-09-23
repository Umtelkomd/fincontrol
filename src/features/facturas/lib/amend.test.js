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

  it('treats a rejected archive patch (e.g. the key-allowlist guard) as a failure, not a silent success', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: true })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => ({ success: false, error: new Error('campo no editable') })),
      writeAudit: vi.fn(async () => {}),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'archive' })]));
  });

  it('throws before any mutation when effects.writeAudit is missing (a programming error, never a silent skip)', async () => {
    const effects = {
      updateObligation: vi.fn(),
      updateMovement: vi.fn(),
      updateArchive: vi.fn(),
    };

    await expect(
      applyInvoiceEdit(
        { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
        effects,
      ),
    ).rejects.toThrow();
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('reports auditFailed without flipping success when writeAudit resolves {success:false}', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: true })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => ({ success: false, error: new Error('audit store down') })),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(true);
    expect(result.auditFailed).toBe(true);
    expect(result.auditError).toBeInstanceOf(Error);
  });

  it('reports auditFailed without flipping success when writeAudit THROWS', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: true })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => {
        throw new Error('offline');
      }),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(true);
    expect(result.auditFailed).toBe(true);
    expect(result.auditError).toBeInstanceOf(Error);
  });

  it('never reports auditFailed on a genuine data-mutation failure plus a healthy audit write', async () => {
    const effects = {
      updateObligation: vi.fn(async () => ({ success: false, error: new Error('boom') })),
      updateMovement: vi.fn(async () => {}),
      updateArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => ({ success: true })),
    };

    const result = await applyInvoiceEdit(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], form: validForm() },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.auditFailed).toBeUndefined();
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

  it('returns the invalid plan and calls no effect when the reason is missing (mirrors applyInvoiceEdit)', async () => {
    const effects = {
      removeBackReference: vi.fn(),
      cancelObligation: vi.fn(),
      deleteChunks: vi.fn(),
      deleteArchive: vi.fn(),
      writeAudit: vi.fn(),
    };

    const result = await applyInvoiceDelete(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], reason: '   ' },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.plan.valid).toBe(false);
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('throws before any mutation when effects.writeAudit is missing', async () => {
    const effects = {
      removeBackReference: vi.fn(),
      cancelObligation: vi.fn(),
      deleteChunks: vi.fn(),
      deleteArchive: vi.fn(),
    };

    await expect(
      applyInvoiceDelete(
        { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], reason: 'Duplicada' },
        effects,
      ),
    ).rejects.toThrow();
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('reports auditFailed without flipping success when writeAudit resolves {success:false}', async () => {
    const effects = {
      removeBackReference: vi.fn(async () => {}),
      cancelObligation: vi.fn(async () => ({ success: true })),
      deleteChunks: vi.fn(async () => {}),
      deleteArchive: vi.fn(async () => {}),
      writeAudit: vi.fn(async () => ({ success: false, error: new Error('audit store down') })),
    };

    const result = await applyInvoiceDelete(
      { invoiceDocument: invoiceDocument(), obligations: [payable()], bankMovements: [], reason: 'Duplicada' },
      effects,
    );

    expect(result.success).toBe(true);
    expect(result.auditFailed).toBe(true);
    expect(result.auditError).toBeInstanceOf(Error);
  });
});

describe('applyInvoiceReplace', () => {
  const validReason = 'PDF ilegible';
  const newFile = () => ({ sha256: 'b'.repeat(64), sizeBytes: 20480, mimeType: 'application/pdf', originalName: 'nueva.pdf' });

  const baseEffects = (overrides = {}) => ({
    uploadPdf: vi.fn(async ({ expectedSha256 }) => ({ sha256: expectedSha256, sizeBytes: 20480, mimeType: 'application/pdf' })),
    commitNewDocument: vi.fn(async () => {}),
    swapBackReference: vi.fn(async () => {}),
    deleteOldChunks: vi.fn(async () => {}),
    deleteOldArchive: vi.fn(async () => {}),
    writeAudit: vi.fn(async () => {}),
    findInvoiceDocument: vi.fn(async () => null),
    ...overrides,
  });

  it('returns invalid without calling any effect for the same sha256', async () => {
    const effects = {
      uploadPdf: vi.fn(),
      commitNewDocument: vi.fn(),
      swapBackReference: vi.fn(),
      deleteOldChunks: vi.fn(),
      deleteOldArchive: vi.fn(),
      writeAudit: vi.fn(),
      findInvoiceDocument: vi.fn(),
    };
    const doc = invoiceDocument();

    const result = await applyInvoiceReplace(
      { invoiceDocument: doc, newFile: { ...newFile(), sha256: doc.id }, bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(result.success).toBe(false);
    // The same-file rejection is known from the args alone — no Firestore
    // lookup is needed to reach it, so findInvoiceDocument must stay silent too.
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('uploads, commits the new document, swaps every back-reference, then deletes the OLD chunks and doc last', async () => {
    const calls = [];
    const effects = baseEffects({
      uploadPdf: vi.fn(async ({ expectedSha256 }) => {
        calls.push('upload');
        return { sha256: expectedSha256, sizeBytes: 20480, mimeType: 'application/pdf' };
      }),
      commitNewDocument: vi.fn(async () => calls.push('commitNew')),
      swapBackReference: vi.fn(async (family, id) => calls.push(`swap:${family}:${id}`)),
      deleteOldChunks: vi.fn(async () => calls.push('deleteOldChunks')),
      deleteOldArchive: vi.fn(async () => calls.push('deleteOldArchive')),
      writeAudit: vi.fn(async () => calls.push('audit')),
    });

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['upload', 'commitNew', 'swap:payable:cxp-1', 'deleteOldChunks', 'deleteOldArchive', 'audit']);
    expect(effects.findInvoiceDocument).toHaveBeenCalledWith(newFile().sha256);
  });

  it('fails closed and never deletes the old PDF when the uploaded hash does not match', async () => {
    const effects = baseEffects({
      uploadPdf: vi.fn(async () => ({ sha256: 'c'.repeat(64), sizeBytes: 1 })), // wrong hash
    });

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(result.success).toBe(false);
    expect(effects.commitNewDocument).not.toHaveBeenCalled();
    expect(effects.deleteOldChunks).not.toHaveBeenCalled();
    expect(effects.deleteOldArchive).not.toHaveBeenCalled();
  });

  it('returns invalid without calling any effect when the reason is missing', async () => {
    const effects = baseEffects();

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: '  ' },
      effects,
    );

    expect(result.success).toBe(false);
    ['uploadPdf', 'commitNewDocument', 'swapBackReference', 'deleteOldChunks', 'deleteOldArchive', 'writeAudit'].forEach(
      (key) => expect(effects[key]).not.toHaveBeenCalled(),
    );
  });

  it('fails closed BEFORE any upload when the new sha256 already belongs to a DIFFERENT archived invoice', async () => {
    const effects = baseEffects({
      findInvoiceDocument: vi.fn(async () => ({ id: newFile().sha256, invoiceNumber: 'RE-2026-777' })),
    });

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(result.success).toBe(false);
    expect(result.errors.file).toMatch(/ya está archivado como otra factura/i);
    expect(result.errors.file).toContain('RE-2026-777');
    ['uploadPdf', 'commitNewDocument', 'swapBackReference', 'deleteOldChunks', 'deleteOldArchive', 'writeAudit'].forEach(
      (key) => expect(effects[key]).not.toHaveBeenCalled(),
    );
  });

  it('throws before any lookup or mutation when effects.findInvoiceDocument is missing', async () => {
    const effects = baseEffects();
    delete effects.findInvoiceDocument;

    await expect(
      applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      ),
    ).rejects.toThrow();
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('throws before any lookup or mutation when effects.writeAudit is missing', async () => {
    const effects = baseEffects();
    delete effects.writeAudit;

    await expect(
      applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      ),
    ).rejects.toThrow();
    Object.values(effects).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('reports auditFailed without flipping success when writeAudit resolves {success:false}', async () => {
    const effects = baseEffects({
      writeAudit: vi.fn(async () => ({ success: false, error: new Error('audit store down') })),
    });

    const result = await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(result.success).toBe(true);
    expect(result.auditFailed).toBe(true);
    expect(result.auditError).toBeInstanceOf(Error);
  });

  it('passes the reason through to the audit entry', async () => {
    const effects = baseEffects();

    await applyInvoiceReplace(
      { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
      effects,
    );

    expect(effects.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ reason: validReason }));
  });

  /**
   * A swap is two writes on one obligation and cannot be one (see
   * swapInvoiceLink). Losing the connection between them used to reject the
   * whole promise: the caller saw a thrown error, the old PDF's chunks and
   * archive row were never deleted but nothing said which obligations had been
   * re-pointed, and the new archive row was already there. The old document
   * must stay fully readable and the operator must be told to retry.
   */
  describe('a failing back-reference swap', () => {
    const twoLinks = () =>
      invoiceDocument({
        links: [
          { family: 'payable', recordId: 'cxp-1' },
          { family: 'payable', recordId: 'cxp-2' },
        ],
      });

    it('is reported as partial, keeps the OLD chunks and archive row, and still writes the audit', async () => {
      const effects = baseEffects({
        swapBackReference: vi.fn(async () => {
          throw new Error('offline');
        }),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result).toMatchObject({ success: false, partial: true });
      expect(result.failures).toEqual([
        { stage: 'backReference', family: 'payable', recordId: 'cxp-1', error: expect.any(Error) },
      ]);
      expect(effects.deleteOldChunks).not.toHaveBeenCalled();
      expect(effects.deleteOldArchive).not.toHaveBeenCalled();
      expect(effects.writeAudit).toHaveBeenCalledTimes(1);
    });

    it('treats a {success:false} swap result exactly like a thrown one', async () => {
      const effects = baseEffects({
        swapBackReference: vi.fn(async () => ({ success: false, error: new Error('permission-denied') })),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result).toMatchObject({ success: false, partial: true });
      expect(result.failures).toHaveLength(1);
      expect(effects.deleteOldArchive).not.toHaveBeenCalled();
    });

    it('still attempts every other obligation — each one is independent', async () => {
      const effects = baseEffects({
        swapBackReference: vi.fn(async (family, recordId) => {
          if (recordId === 'cxp-1') throw new Error('offline');
        }),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: twoLinks(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(effects.swapBackReference).toHaveBeenCalledTimes(2);
      expect(result.failures.map((failure) => failure.recordId)).toEqual(['cxp-1']);
    });

    it('records the failures in the audit metadata, as messages rather than Error objects', async () => {
      const effects = baseEffects({
        swapBackReference: vi.fn(async () => {
          throw new Error('offline');
        }),
      });

      await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(effects.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          partial: true,
          metadata: expect.objectContaining({
            failures: [{ stage: 'backReference', family: 'payable', recordId: 'cxp-1', error: 'offline' }],
          }),
        }),
      );
    });

    it('reports auditFailed alongside the partial result, never flipping it to success', async () => {
      const effects = baseEffects({
        swapBackReference: vi.fn(async () => {
          throw new Error('offline');
        }),
        writeAudit: vi.fn(async () => ({ success: false, error: new Error('audit store down') })),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result).toMatchObject({ success: false, partial: true, auditFailed: true });
    });
  });

  /**
   * The cross-invoice guard reads "this sha256 already belongs to an archived
   * invoice". After a partial replace that is ALSO true of the replacement this
   * very invoice just committed — so the retry that is supposed to finish the
   * job would be refused. It must recognize its own half-finished work, and
   * only that: same archive identity AND the same link set.
   */
  describe('retrying a half-finished replace', () => {
    const halfWritten = (overrides = {}) => ({
      ...invoiceDocument(),
      id: newFile().sha256,
      sha256: newFile().sha256,
      ...overrides,
    });

    it('converges: the new document already committed by the first attempt is not a DIFFERENT invoice', async () => {
      const effects = baseEffects({ findInvoiceDocument: vi.fn(async () => halfWritten()) });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result.success).toBe(true);
      expect(effects.swapBackReference).toHaveBeenCalledTimes(1);
      expect(effects.deleteOldArchive).toHaveBeenCalledWith(invoiceDocument().id);
    });

    it('still fails closed when the stored document carries a DIFFERENT identity', async () => {
      const effects = baseEffects({
        findInvoiceDocument: vi.fn(async () =>
          halfWritten({ identity: JSON.stringify(['invoice-v2', 'incoming', 'Otro proveedor', 'RE-2026-777']) }),
        ),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result.success).toBe(false);
      expect(result.errors.file).toMatch(/ya está archivado como otra factura/i);
      expect(effects.uploadPdf).not.toHaveBeenCalled();
    });

    it('still fails closed when the identity matches but the links do not', async () => {
      const effects = baseEffects({
        findInvoiceDocument: vi.fn(async () => halfWritten({ links: [{ family: 'payable', recordId: 'cxp-9' }] })),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument(), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result.success).toBe(false);
      expect(result.errors.file).toMatch(/ya está archivado como otra factura/i);
    });

    it('still fails closed when neither document has an identity to compare', async () => {
      const effects = baseEffects({
        findInvoiceDocument: vi.fn(async () => halfWritten({ identity: '' })),
      });

      const result = await applyInvoiceReplace(
        { invoiceDocument: invoiceDocument({ identity: '' }), newFile: newFile(), bytes: new Uint8Array(4), reason: validReason },
        effects,
      );

      expect(result.success).toBe(false);
      expect(result.errors.file).toMatch(/ya está archivado como otra factura/i);
    });
  });
});
