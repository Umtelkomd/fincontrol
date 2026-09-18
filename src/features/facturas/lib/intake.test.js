import { describe, expect, it, vi } from 'vitest';
import { invoiceIdentityInput } from '../../../finance/invoiceArchive';
import {
  ISSUER_TENANT_ID,
  archiveInvoice,
  buildConfirmedHeader,
  buildInvoiceDocument,
  buildObligationPayload,
  normalizeCounterpartyId,
  obligationToLinkRow,
} from './intake';

const SHA = 'a'.repeat(64);

const file = (overrides = {}) => ({
  sha256: SHA,
  sizeBytes: 2048,
  mimeType: 'application/pdf',
  originalName: 'invoice.pdf',
  ...overrides,
});

const confirmedHeaderInput = (overrides = {}) => ({
  direction: 'outgoing',
  sourceSystem: 'ordinary',
  counterpartyName: 'Cliente GmbH',
  invoiceNumber: '2026-001',
  issueDate: '2026-03-15',
  netAmount: 100,
  taxAmount: 19,
  grossAmount: 119,
  ...overrides,
});

describe('normalizeCounterpartyId', () => {
  it('trims and NFC-normalizes', () => {
    expect(normalizeCounterpartyId('  café  ')).toBe('café'.normalize('NFC'));
    expect(normalizeCounterpartyId(' café ')).toBe(normalizeCounterpartyId('café'));
  });

  it('returns empty string for non-strings/undefined/null', () => {
    expect(normalizeCounterpartyId(undefined)).toBe('');
    expect(normalizeCounterpartyId(null)).toBe('');
    expect(normalizeCounterpartyId(123)).toBe('');
  });
});

describe('buildConfirmedHeader', () => {
  it('builds an outgoing header with issuerId = ISSUER_TENANT_ID', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    expect(header.issuerId).toBe(ISSUER_TENANT_ID);
    expect(header.counterpartyId).toBe('Cliente GmbH');
    expect(header.counterpartyName).toBe('Cliente GmbH');
    expect(header.grossAmount).toBe(119);
  });

  it('builds an incoming header with issuerId = counterpartyId', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ direction: 'incoming', counterpartyName: 'Proveedor GmbH' }));
    expect(header.issuerId).toBe('Proveedor GmbH');
    expect(header.direction).toBe('incoming');
  });

  it('coerces string amounts with a comma decimal separator', () => {
    const header = buildConfirmedHeader(
      confirmedHeaderInput({ netAmount: '100,00', taxAmount: '19,00', grossAmount: '119,00' }),
    );
    expect(header.netAmount).toBe(100);
    expect(header.taxAmount).toBe(19);
    expect(header.grossAmount).toBe(119);
  });

  it('treats an empty tax amount as 0', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ taxAmount: '', netAmount: 100, grossAmount: 100 }));
    expect(header.taxAmount).toBe(0);
  });

  it('rejects unbalanced totals (delegates to validateConfirmedInvoice)', () => {
    expect(() => buildConfirmedHeader(confirmedHeaderInput({ grossAmount: 999 }))).toThrow();
  });

  it('rejects a missing/empty net or gross amount rather than defaulting to 0', () => {
    expect(() => buildConfirmedHeader(confirmedHeaderInput({ netAmount: '' }))).toThrow();
    expect(() => buildConfirmedHeader(confirmedHeaderInput({ grossAmount: undefined }))).toThrow();
  });
});

describe('obligationToLinkRow', () => {
  it('maps a receivable doc to the planInvoiceLink row shape', () => {
    const doc = {
      id: 'cxc-1',
      client: 'Cliente GmbH',
      sourceSystem: 'ordinary',
      invoiceNumber: '2026-001',
      documentNumber: '2026-001',
      rechnungId: null,
      numeroPresupuesto: undefined,
      archivedInvoiceIdentity: null,
    };
    expect(obligationToLinkRow(doc, 'receivable')).toEqual({
      family: 'receivable',
      recordId: 'cxc-1',
      counterpartyId: 'Cliente GmbH',
      sourceSystem: 'ordinary',
      numeroPresupuesto: undefined,
      rechnungId: null,
      invoiceNumber: '2026-001',
      documentNumber: '2026-001',
      archivedInvoiceIdentity: null,
    });
  });

  it('prefers an explicit recordId over id', () => {
    expect(obligationToLinkRow({ id: 'doc-1', recordId: 'row-1' }, 'payable').recordId).toBe('row-1');
  });

  it('reads vendor for payables when counterpartyName is absent', () => {
    expect(obligationToLinkRow({ vendor: 'Proveedor GmbH' }, 'payable').counterpartyId).toBe('Proveedor GmbH');
  });

  it('defaults sourceSystem to ordinary', () => {
    expect(obligationToLinkRow({}, 'receivable').sourceSystem).toBe('ordinary');
  });
});

describe('buildObligationPayload', () => {
  it('builds a receivable payload (client field) for an outgoing header', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    const payload = buildObligationPayload(header, { projectId: 'proj-1', description: 'Certificación' });
    expect(payload).toMatchObject({
      invoiceNumber: '2026-001',
      client: 'Cliente GmbH',
      grossAmount: 119,
      amount: 119,
      netAmount: 100,
      taxAmount: 19,
      issueDate: '2026-03-15',
      dueDate: '2026-04-14',
      currency: 'EUR',
      sourceSystem: 'ordinary',
      description: 'Certificación',
      projectId: 'proj-1',
    });
    expect(payload).not.toHaveProperty('vendor');
  });

  it('builds a payable payload (vendor field) for an incoming header', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ direction: 'incoming', counterpartyName: 'Proveedor GmbH' }));
    const payload = buildObligationPayload(header);
    expect(payload.vendor).toBe('Proveedor GmbH');
    expect(payload).not.toHaveProperty('client');
    expect(payload.description).toBe('');
    expect(payload.projectId).toBe('');
  });

  it('computes dueDate as issueDate + 30 days across a month/year boundary', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ issueDate: '2026-12-15' }));
    expect(buildObligationPayload(header).dueDate).toBe('2027-01-14');
  });
});

describe('buildObligationPayload — classification (T5)', () => {
  const classification = {
    categoryName: 'Materiales',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    costCenterId: 'CC-120',
    costScope: 'project',
  };

  it('persists the five classification fields alongside the base payload', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ direction: 'incoming', counterpartyName: 'Proveedor GmbH' }));
    const payload = buildObligationPayload(header, { classification });
    expect(payload).toMatchObject(classification);
    expect(payload.vendor).toBe('Proveedor GmbH');
  });

  it('keeps the legacy projectId-only option working when no classification is given (backward compatible)', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    const payload = buildObligationPayload(header, { projectId: 'proj-legacy' });
    expect(payload.projectId).toBe('proj-legacy');
    expect(payload).not.toHaveProperty('categoryName');
    expect(payload).not.toHaveProperty('costCenterId');
  });

  it('classification.projectId takes precedence over the legacy projectId option when both are given', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    const payload = buildObligationPayload(header, { projectId: 'legacy', classification: { ...classification, projectId: 'proj-2' } });
    expect(payload.projectId).toBe('proj-2');
  });
});

describe('buildInvoiceDocument', () => {
  it('builds the document id/data shape, deriving family from direction', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    const result = buildInvoiceDocument({
      header,
      file: file(),
      links: [{ family: 'receivable', recordId: 'row-1' }],
      linkMode: 'attach-existing',
      uid: 'user-1',
      now: '2026-03-15T10:00:00.000Z',
    });
    expect(result.id).toBe(SHA);
    expect(result.data).toMatchObject({
      sha256: SHA,
      sizeBytes: 2048,
      mimeType: 'application/pdf',
      originalName: 'invoice.pdf',
      direction: 'outgoing',
      family: 'receivable',
      sourceSystem: 'ordinary',
      counterpartyName: 'Cliente GmbH',
      counterpartyId: 'Cliente GmbH',
      invoiceNumber: '2026-001',
      issueDate: '2026-03-15',
      currency: 'EUR',
      netAmount: 100,
      taxAmount: 19,
      grossAmount: 119,
      linkMode: 'attach-existing',
      createdBy: 'user-1',
      createdAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-03-15T10:00:00.000Z',
    });
    expect(result.data.identity).toBe(invoiceIdentityInput(header));
    expect(result.data.links).toEqual([{ family: 'receivable', recordId: 'row-1' }]);
  });

  it('derives family = payable for an incoming header', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput({ direction: 'incoming', counterpartyName: 'Proveedor GmbH' }));
    const result = buildInvoiceDocument({ header, file: file(), links: [], linkMode: 'create-ordinary', uid: 'u', now: 'n' });
    expect(result.data.family).toBe('payable');
  });

  it('rejects an invalid file descriptor before touching header data', () => {
    const header = buildConfirmedHeader(confirmedHeaderInput());
    expect(() =>
      buildInvoiceDocument({ header, file: { ...file(), mimeType: 'image/png' }, links: [], linkMode: 'create-ordinary', uid: 'u', now: 'n' }),
    ).toThrow();
  });
});

describe('archiveInvoice', () => {
  const makeEffects = (overrides = {}) => ({
    upload: vi.fn().mockResolvedValue({ sha256: SHA, sizeBytes: 2048, mimeType: 'application/pdf' }),
    createObligation: vi.fn().mockResolvedValue('new-obligation-1'),
    commit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const baseArgs = (overrides = {}) => ({
    header: buildConfirmedHeader(confirmedHeaderInput()),
    file: file(),
    bytes: new Uint8Array([1, 2, 3]),
    mode: 'create-ordinary',
    links: [],
    existingObligations: [],
    uid: 'user-1',
    now: '2026-03-15T10:00:00.000Z',
    ...overrides,
  });

  it('create-ordinary: uploads, creates exactly one obligation, and commits one link update', async () => {
    const effects = makeEffects();
    const result = await archiveInvoice(baseArgs(), effects);

    expect(effects.upload).toHaveBeenCalledTimes(1);
    expect(effects.upload).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), expectedSha256: SHA });
    expect(effects.createObligation).toHaveBeenCalledTimes(1);
    expect(effects.createObligation).toHaveBeenCalledWith('receivable', expect.objectContaining({ invoiceNumber: '2026-001' }));
    expect(effects.commit).toHaveBeenCalledTimes(1);
    const [{ document, linkUpdates }] = effects.commit.mock.calls[0];
    expect(linkUpdates).toHaveLength(1);
    expect(linkUpdates[0]).toMatchObject({
      family: 'receivable',
      recordId: 'new-obligation-1',
      patch: { updatedBy: 'user-1', updatedAt: '2026-03-15T10:00:00.000Z' },
    });
    expect(linkUpdates[0].patch.invoiceDocumentIds).toEqual([SHA]);
    expect(document.id).toBe(SHA);
    expect(result).toEqual({ sha256: SHA, obligationIds: ['new-obligation-1'], created: true });
  });

  it('attach-existing: commits one link update per resolved obligation and never creates one', async () => {
    const effects = makeEffects();
    const rows = [
      { family: 'receivable', recordId: 'row-1', counterpartyId: 'Cliente GmbH', sourceSystem: 'ordinary' },
      { family: 'receivable', recordId: 'row-2', counterpartyId: 'Cliente GmbH', sourceSystem: 'ordinary' },
    ];
    const result = await archiveInvoice(
      baseArgs({
        mode: 'attach-existing',
        links: [{ family: 'receivable', recordId: 'row-1' }, { family: 'receivable', recordId: 'row-2' }],
        existingObligations: rows,
      }),
      effects,
    );

    expect(effects.createObligation).not.toHaveBeenCalled();
    expect(effects.commit).toHaveBeenCalledTimes(1);
    const [{ linkUpdates }] = effects.commit.mock.calls[0];
    expect(linkUpdates).toHaveLength(2);
    expect(result.obligationIds).toEqual(['row-1', 'row-2']);
    expect(result.created).toBe(false);
  });

  it('attaches two Insyte presupuesto rows: commits two link updates, never creates an obligation', async () => {
    const effects = makeEffects();
    const insyteHeader = buildConfirmedHeader(
      confirmedHeaderInput({ direction: 'outgoing', sourceSystem: 'insyte', counterpartyName: 'Insyte Deutschland' }),
    );
    const rows = [
      { family: 'receivable', recordId: 'row-1', counterpartyId: 'Insyte Deutschland', sourceSystem: 'insyte', numeroPresupuesto: '001' },
      { family: 'receivable', recordId: 'row-2', counterpartyId: 'Insyte Deutschland', sourceSystem: 'insyte', numeroPresupuesto: '002' },
    ];
    const result = await archiveInvoice(
      baseArgs({
        header: insyteHeader,
        mode: 'attach-existing',
        links: [{ family: 'receivable', recordId: 'row-1' }, { family: 'receivable', recordId: 'row-2' }],
        existingObligations: rows,
      }),
      effects,
    );

    expect(effects.createObligation).not.toHaveBeenCalled();
    const [{ linkUpdates }] = effects.commit.mock.calls[0];
    expect(linkUpdates).toHaveLength(2);
    expect(result.obligationIds).toEqual(['row-1', 'row-2']);
  });

  it('aborts on upload hash mismatch: no createObligation, no commit', async () => {
    const effects = makeEffects({ upload: vi.fn().mockResolvedValue({ sha256: 'b'.repeat(64), sizeBytes: 1, mimeType: 'application/pdf' }) });
    await expect(archiveInvoice(baseArgs(), effects)).rejects.toThrow();
    expect(effects.createObligation).not.toHaveBeenCalled();
    expect(effects.commit).not.toHaveBeenCalled();
  });

  it('aborts when the upload effect itself rejects: no createObligation, no commit', async () => {
    const effects = makeEffects({ upload: vi.fn().mockRejectedValue(new Error('network')) });
    await expect(archiveInvoice(baseArgs(), effects)).rejects.toThrow();
    expect(effects.createObligation).not.toHaveBeenCalled();
    expect(effects.commit).not.toHaveBeenCalled();
  });

  it('rejects an unresolved attach-existing plan before ever uploading', async () => {
    const effects = makeEffects();
    await expect(archiveInvoice(baseArgs({ mode: 'attach-existing', links: [], existingObligations: [] }), effects)).rejects.toThrow();
    expect(effects.upload).not.toHaveBeenCalled();
    expect(effects.createObligation).not.toHaveBeenCalled();
    expect(effects.commit).not.toHaveBeenCalled();
  });

  it('rejects Insyte + create-ordinary (Insyte is link-only) before uploading', async () => {
    const effects = makeEffects();
    const insyteHeader = buildConfirmedHeader(
      confirmedHeaderInput({ sourceSystem: 'insyte', direction: 'outgoing', counterpartyName: 'Insyte Deutschland' }),
    );
    await expect(archiveInvoice(baseArgs({ header: insyteHeader, mode: 'create-ordinary' }), effects)).rejects.toThrow();
    expect(effects.upload).not.toHaveBeenCalled();
  });

  it('rejects a header with net + tax != gross before uploading', async () => {
    const effects = makeEffects();
    const unbalancedHeader = {
      confirmed: true,
      documentType: 'invoice',
      direction: 'outgoing',
      sourceSystem: 'ordinary',
      issuerId: ISSUER_TENANT_ID,
      counterpartyId: 'Cliente GmbH',
      counterpartyName: 'Cliente GmbH',
      invoiceNumber: '2026-001',
      issueDate: '2026-03-15',
      currency: 'EUR',
      netAmount: 100,
      taxAmount: 19,
      grossAmount: 999,
    };
    await expect(archiveInvoice(baseArgs({ header: unbalancedHeader }), effects)).rejects.toThrow();
    expect(effects.upload).not.toHaveBeenCalled();
  });

  it('rejects an invalid file descriptor before ever planning or uploading', async () => {
    const effects = makeEffects();
    await expect(archiveInvoice(baseArgs({ file: { ...file(), sizeBytes: 0 } }), effects)).rejects.toThrow();
    expect(effects.upload).not.toHaveBeenCalled();
  });

  it('propagates a commit failure after upload and createObligation already ran', async () => {
    const effects = makeEffects({ commit: vi.fn().mockRejectedValue(new Error('firestore unavailable')) });
    await expect(archiveInvoice(baseArgs(), effects)).rejects.toThrow('firestore unavailable');
    expect(effects.createObligation).toHaveBeenCalledTimes(1);
  });

  it('create-ordinary: threads classification into the created obligation payload (acceptance #1)', async () => {
    const effects = makeEffects();
    const classification = {
      categoryName: 'Materiales',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      costCenterId: 'CC-120',
      costScope: 'project',
    };
    await archiveInvoice(baseArgs({ classification }), effects);
    expect(effects.createObligation).toHaveBeenCalledWith('receivable', expect.objectContaining(classification));
  });

  it('attach-existing: never patches classification onto the linked obligation — the link update only carries the archive identity', async () => {
    const effects = makeEffects();
    const rows = [{ family: 'receivable', recordId: 'row-1', counterpartyId: 'Cliente GmbH', sourceSystem: 'ordinary' }];
    const classification = { categoryName: 'Materiales', projectId: 'proj-1', costCenterId: 'CC-120' };
    await archiveInvoice(
      baseArgs({
        mode: 'attach-existing',
        links: [{ family: 'receivable', recordId: 'row-1' }],
        existingObligations: rows,
        classification,
      }),
      effects,
    );
    expect(effects.createObligation).not.toHaveBeenCalled();
    const [{ linkUpdates }] = effects.commit.mock.calls[0];
    expect(linkUpdates[0].patch).not.toHaveProperty('categoryName');
    expect(linkUpdates[0].patch).not.toHaveProperty('projectId');
    expect(linkUpdates[0].patch).not.toHaveProperty('costCenterId');
  });

  it('rejects duplicate obligation links without ever uploading', async () => {
    const effects = makeEffects();
    const rows = [{ family: 'receivable', recordId: 'row-1', counterpartyId: 'Cliente GmbH', sourceSystem: 'ordinary' }];
    await expect(
      archiveInvoice(
        baseArgs({
          mode: 'attach-existing',
          links: [{ family: 'receivable', recordId: 'row-1' }, { family: 'receivable', recordId: 'row-1' }],
          existingObligations: rows,
        }),
        effects,
      ),
    ).rejects.toThrow();
    expect(effects.upload).not.toHaveBeenCalled();
  });
});
