import { describe, expect, it } from 'vitest';
import {
  obligationLockState,
  ownedLinks,
  planInvoiceDelete,
  planInvoiceEdit,
  planInvoiceReplace,
} from './invoiceAmendment.js';

const payable = (overrides = {}) => ({
  id: 'cxp-1',
  kind: 'payable',
  paidAmount: 0,
  payments: [],
  status: 'issued',
  counterpartyName: 'Kabel Service GmbH',
  documentNumber: 'RE-2026-050',
  invoiceNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  dueDate: '2026-07-01', // issueDate + 30d — the intake default
  // Matches planInvoiceEdit's baseArgs() form defaults below, so an
  // unmodified form is a genuine no-op against this stored obligation.
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC-120',
  categoryName: 'Materiales',
  grossAmount: 1190,
  ...overrides,
});

const receivable = (overrides = {}) => ({
  id: 'cxc-1',
  kind: 'receivable',
  paidAmount: 0,
  payments: [],
  status: 'issued',
  counterpartyName: 'Insyte Deutschland',
  documentNumber: 'CXC-1',
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC-120',
  categoryName: 'Facturación obra',
  grossAmount: 5000,
  ...overrides,
});

const movement = (overrides = {}) => ({
  id: 'mov-1',
  status: 'posted',
  payableId: null,
  payableIds: [],
  payableAllocations: [],
  receivableId: null,
  receivableIds: [],
  receivableAllocations: [],
  categoryName: '',
  projectId: '',
  projectName: '',
  costCenterId: '',
  costScope: '',
  ...overrides,
});

const invoiceDocument = (overrides = {}) => ({
  id: 'a'.repeat(64),
  sha256: 'a'.repeat(64),
  sizeBytes: 51200,
  mimeType: 'application/pdf',
  originalName: 'factura.pdf',
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

describe('obligationLockState', () => {
  it('is unlocked for a fresh issued obligation with no payments and no bank movement', () => {
    expect(obligationLockState(payable(), [])).toEqual({ locked: false, reasons: [] });
  });

  it('locks on paidAmount > 0', () => {
    const result = obligationLockState(payable({ paidAmount: 500 }), []);
    expect(result.locked).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/pagos/i);
  });

  it('locks on a non-empty payments array', () => {
    const result = obligationLockState(payable({ payments: [{ amount: 100 }] }), []);
    expect(result.locked).toBe(true);
  });

  it.each(['partial', 'settled'])('locks on status %s', (status) => {
    const result = obligationLockState(payable({ status }), []);
    expect(result.locked).toBe(true);
  });

  it('locks when a posted bank movement references it via payableId', () => {
    const result = obligationLockState(payable(), [movement({ payableId: 'cxp-1' })]);
    expect(result.locked).toBe(true);
  });

  it('locks when a posted bank movement references it via payableIds', () => {
    const result = obligationLockState(payable(), [movement({ payableIds: ['cxp-1'] })]);
    expect(result.locked).toBe(true);
  });

  it('locks when a posted bank movement references it via payableAllocations', () => {
    const result = obligationLockState(payable(), [
      movement({ payableAllocations: [{ documentId: 'cxp-1', amount: 100 }] }),
    ]);
    expect(result.locked).toBe(true);
  });

  it('locks a receivable referenced via receivableId/receivableIds/receivableAllocations', () => {
    expect(obligationLockState(receivable(), [movement({ receivableId: 'cxc-1' })]).locked).toBe(true);
    expect(obligationLockState(receivable(), [movement({ receivableIds: ['cxc-1'] })]).locked).toBe(true);
    expect(
      obligationLockState(receivable(), [
        movement({ receivableAllocations: [{ documentId: 'cxc-1', amount: 100 }] }),
      ]).locked,
    ).toBe(true);
  });

  it('a VOID movement never locks', () => {
    const result = obligationLockState(payable(), [movement({ payableId: 'cxp-1', status: 'void' })]);
    expect(result.locked).toBe(false);
  });

  it('a movement referencing a DIFFERENT obligation does not lock', () => {
    const result = obligationLockState(payable(), [movement({ payableId: 'cxp-other' })]);
    expect(result.locked).toBe(false);
  });

  it('collects every applicable reason, not just the first', () => {
    const result = obligationLockState(payable({ paidAmount: 500, status: 'partial' }), [
      movement({ payableId: 'cxp-1' }),
    ]);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('ownedLinks', () => {
  it('treats the single link as owned for a create-ordinary document', () => {
    const result = ownedLinks(invoiceDocument());
    expect(result.owned).toEqual([{ family: 'payable', recordId: 'cxp-1' }]);
    expect(result.foreign).toEqual([]);
  });

  it('treats the link as foreign for an attach-existing document', () => {
    const result = ownedLinks(invoiceDocument({ linkMode: 'attach-existing' }));
    expect(result.owned).toEqual([]);
    expect(result.foreign).toEqual([{ family: 'payable', recordId: 'cxp-1' }]);
  });

  it('treats every link as foreign when a document accumulated more than one link (ambiguous provenance)', () => {
    const doc = invoiceDocument({
      linkMode: 'create-ordinary',
      links: [
        { family: 'payable', recordId: 'cxp-1' },
        { family: 'payable', recordId: 'cxp-2' },
      ],
    });
    const result = ownedLinks(doc);
    expect(result.owned).toEqual([]);
    expect(result.foreign).toHaveLength(2);
  });

  it('returns empty arrays for a document with no links', () => {
    const result = ownedLinks(invoiceDocument({ links: [] }));
    expect(result.owned).toEqual([]);
    expect(result.foreign).toEqual([]);
  });
});

describe('planInvoiceEdit', () => {
  const baseArgs = () => ({
    invoiceDocument: invoiceDocument(),
    obligations: [payable()],
    bankMovements: [],
    projects: [{ id: 'proj-1', name: 'NE4 Rossdorf', displayName: 'NE4 Rossdorf' }],
    form: {
      counterpartyName: 'Kabel Service GmbH',
      invoiceNumber: 'RE-2026-050',
      issueDate: '2026-06-01',
      netAmount: 1000,
      taxAmount: 190,
      grossAmount: 1190,
      categoryName: 'Materiales',
      projectId: 'proj-1',
      costCenterId: 'CC-120',
      reason: 'Corrección de proyecto',
    },
  });

  it('requires a correction reason', () => {
    const args = baseArgs();
    args.form = { ...args.form, reason: '' };
    const result = planInvoiceEdit(args);
    expect(result.valid).toBe(false);
    expect(result.errors.reason).toBeTruthy();
  });

  it('rejects an invalid category/cost-center combination via the existing classification validator', () => {
    const args = baseArgs();
    args.form = { ...args.form, projectId: '', costCenterId: 'CC-120' }; // direct center, no project
    const result = planInvoiceEdit(args);
    expect(result.valid).toBe(false);
    expect(result.errors.costCenterId).toBeTruthy();
  });

  it('a no-op edit yields empty patches', () => {
    const result = planInvoiceEdit(baseArgs());
    expect(result.valid).toBe(true);
    expect(result.archivePatch).toEqual({});
    expect(result.obligationPatches).toEqual([]);
    expect(result.movementPatches).toEqual([]);
  });

  it('patches archive metadata and the owned obligation on a counterparty rename', () => {
    const args = baseArgs();
    args.form = { ...args.form, counterpartyName: 'Kabel Service Neu GmbH' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    expect(result.archivePatch.counterpartyName).toBe('Kabel Service Neu GmbH');
    expect(result.archivePatch.counterpartyId).toBeTruthy();
    expect(result.archivePatch.identity).not.toBe(args.invoiceDocument.identity);

    const [obligationPatch] = result.obligationPatches;
    expect(obligationPatch).toMatchObject({ family: 'payable', id: 'cxp-1' });
    expect(obligationPatch.patch.counterpartyName).toBe('Kabel Service Neu GmbH');
  });

  it('propagates classification (incl. costScope) onto the owned obligation', () => {
    const args = baseArgs();
    args.form = { ...args.form, projectId: '', costCenterId: 'CC-300', categoryName: 'Asesoría y gestoría' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    const [obligationPatch] = result.obligationPatches;
    expect(obligationPatch.patch).toMatchObject({
      categoryName: 'Asesoría y gestoría',
      projectId: '',
      costCenterId: 'CC-300',
      costScope: 'overhead',
    });
  });

  it('shifts the obligation dueDate by the same delta when it still equals the intake default (issue + 30d)', () => {
    const args = baseArgs();
    args.form = { ...args.form, issueDate: '2026-06-11' }; // +10 days
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    const [obligationPatch] = result.obligationPatches;
    expect(obligationPatch.patch.issueDate).toBe('2026-06-11');
    expect(obligationPatch.patch.dueDate).toBe('2026-07-11');
  });

  it('leaves a custom dueDate untouched when it no longer equals the intake default', () => {
    const args = baseArgs();
    args.obligations = [payable({ dueDate: '2026-08-15' })]; // operator already moved it
    args.form = { ...args.form, issueDate: '2026-06-11' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    const [obligationPatch] = result.obligationPatches;
    expect(obligationPatch.patch).not.toHaveProperty('dueDate');
  });

  it('never allows direction into any patch (it is not part of the form contract)', () => {
    const result = planInvoiceEdit(baseArgs());
    expect(result.archivePatch).not.toHaveProperty('direction');
  });

  it('blocks an amount change when the owned obligation is LOCKED (paid)', () => {
    const args = baseArgs();
    args.obligations = [payable({ paidAmount: 500, status: 'partial' })];
    args.form = { ...args.form, grossAmount: 2000, netAmount: 1680, taxAmount: 320 };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(false);
    expect(result.errors.grossAmount).toBeTruthy();
    expect(result.lockedFields).toEqual(expect.arrayContaining(['netAmount', 'taxAmount', 'grossAmount']));
  });

  it('allows a non-amount edit even when the owned obligation is LOCKED', () => {
    const args = baseArgs();
    args.obligations = [payable({ paidAmount: 500, status: 'partial' })];
    args.form = { ...args.form, categoryName: 'Materiales' }; // amounts unchanged
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    expect(result.lockedFields.length).toBeGreaterThan(0);
  });

  it('does not touch a foreign (attach-existing) obligation, only the archive metadata', () => {
    const args = baseArgs();
    args.invoiceDocument = invoiceDocument({ linkMode: 'attach-existing' });
    args.form = { ...args.form, counterpartyName: 'Kabel Service Neu GmbH' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    expect(result.obligationPatches).toEqual([]);
    expect(result.archivePatch.counterpartyName).toBe('Kabel Service Neu GmbH');
  });

  it('propagates a classification change onto a bank movement linked ONLY to this obligation', () => {
    const args = baseArgs();
    args.bankMovements = [movement({ payableId: 'cxp-1', payableIds: ['cxp-1'] })];
    args.form = { ...args.form, categoryName: 'Asesoría y gestoría', projectId: '', costCenterId: 'CC-300' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    expect(result.movementPatches).toEqual([
      {
        id: 'mov-1',
        patch: expect.objectContaining({ categoryName: 'Asesoría y gestoría', costCenterId: 'CC-300', costScope: 'overhead' }),
      },
    ]);
    expect(result.skippedMovements).toEqual([]);
  });

  it('skips (never edits) a movement linked to several obligations, and lists it', () => {
    const args = baseArgs();
    args.bankMovements = [movement({ payableIds: ['cxp-1', 'cxp-2'] })];
    args.form = { ...args.form, categoryName: 'Asesoría y gestoría', projectId: '', costCenterId: 'CC-300' };
    const result = planInvoiceEdit(args);

    expect(result.valid).toBe(true);
    expect(result.movementPatches).toEqual([]);
    expect(result.skippedMovements).toEqual([{ id: 'mov-1', reason: expect.any(String) }]);
  });
});

describe('planInvoiceDelete', () => {
  it('plans chunk + archive deletion and a back-reference removal for every link, owned or foreign', () => {
    const doc = invoiceDocument({
      links: [
        { family: 'payable', recordId: 'cxp-1' },
      ],
    });
    const result = planInvoiceDelete({ invoiceDocument: doc, obligations: [payable()], bankMovements: [] });

    expect(result.archiveDelete).toBe(true);
    expect(result.chunkDeletes).toBeGreaterThan(0);
    expect(result.backReferenceRemovals).toEqual([{ family: 'payable', id: 'cxp-1' }]);
  });

  it('cancels an owned, unlocked obligation when requested', () => {
    const doc = invoiceDocument();
    const result = planInvoiceDelete({
      invoiceDocument: doc,
      obligations: [payable()],
      bankMovements: [],
      cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }],
    });

    expect(result.cancellations).toEqual([{ family: 'payable', id: 'cxp-1' }]);
    expect(result.blockedCancellations).toEqual([]);
  });

  it('blocks cancellation of a LOCKED owned obligation, with reasons', () => {
    const doc = invoiceDocument();
    const result = planInvoiceDelete({
      invoiceDocument: doc,
      obligations: [payable({ paidAmount: 500, status: 'partial' })],
      bankMovements: [],
      cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }],
    });

    expect(result.cancellations).toEqual([]);
    expect(result.blockedCancellations).toEqual([
      { family: 'payable', id: 'cxp-1', reasons: expect.any(Array) },
    ]);
  });

  it('blocks cancellation of a FOREIGN obligation even when requested', () => {
    const doc = invoiceDocument({ linkMode: 'attach-existing' });
    const result = planInvoiceDelete({
      invoiceDocument: doc,
      obligations: [payable()],
      bankMovements: [],
      cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }],
    });

    expect(result.cancellations).toEqual([]);
    expect(result.blockedCancellations).toEqual([
      { family: 'payable', id: 'cxp-1', reasons: expect.any(Array) },
    ]);
  });

  it('never plans a cancellation that was not explicitly requested', () => {
    const doc = invoiceDocument();
    const result = planInvoiceDelete({ invoiceDocument: doc, obligations: [payable()], bankMovements: [] });
    expect(result.cancellations).toEqual([]);
    expect(result.blockedCancellations).toEqual([]);
  });
});

describe('planInvoiceReplace', () => {
  const newFile = (overrides = {}) => ({
    sha256: 'b'.repeat(64),
    sizeBytes: 20480,
    mimeType: 'application/pdf',
    originalName: 'factura-corregida.pdf',
    ...overrides,
  });

  it('rejects the same sha256 (same file)', () => {
    const doc = invoiceDocument();
    const result = planInvoiceReplace({ invoiceDocument: doc, newFile: newFile({ sha256: doc.id }) });
    expect(result.valid).toBe(false);
    expect(result.errors.file).toMatch(/mismo archivo/i);
  });

  it('rejects a non-PDF mime type', () => {
    const result = planInvoiceReplace({
      invoiceDocument: invoiceDocument(),
      newFile: newFile({ mimeType: 'image/png' }),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.file).toBeTruthy();
  });

  it('rejects a file over 2 MiB', () => {
    const result = planInvoiceReplace({
      invoiceDocument: invoiceDocument(),
      newFile: newFile({ sizeBytes: 2 * 1024 * 1024 + 1 }),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.file).toMatch(/2 MB/);
  });

  it('carries the old metadata + links onto the new document and plans the back-reference swap', () => {
    const doc = invoiceDocument();
    const result = planInvoiceReplace({ invoiceDocument: doc, newFile: newFile() });

    expect(result.valid).toBe(true);
    expect(result.newDocument.id).toBe(newFile().sha256);
    expect(result.newDocument.data).toMatchObject({
      sha256: newFile().sha256,
      sizeBytes: newFile().sizeBytes,
      originalName: newFile().originalName,
      counterpartyName: doc.counterpartyName,
      invoiceNumber: doc.invoiceNumber,
      grossAmount: doc.grossAmount,
      links: doc.links,
      linkMode: doc.linkMode,
    });
    expect(result.oldSha256).toBe(doc.id);
    expect(result.backReferenceSwaps).toEqual([
      { family: 'payable', recordId: 'cxp-1', removeInvoiceDocumentId: doc.id, addInvoiceDocumentId: newFile().sha256 },
    ]);
  });
});
