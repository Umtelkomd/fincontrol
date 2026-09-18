/**
 * Orchestration for correcting an archived invoice: EDIT, DELETE and REPLACE
 * PDF (odd/tasks/invoice-classification-catalog.md, T13). Every accounting
 * decision already happened in src/finance/invoiceAmendment.js
 * (planInvoiceEdit/planInvoiceDelete/planInvoiceReplace) — this module only
 * turns that plan into an ordered sequence of injected effect calls, exactly
 * like `archiveInvoice` does for intake. Pure orchestration: no Firebase, no
 * fetch, no Date.now() here — every effect and timestamp is supplied by the
 * caller (see components/InvoiceEditModal.jsx / InvoiceViewer.jsx for the
 * real Firestore-backed effects).
 */
import { planInvoiceDelete, planInvoiceEdit, planInvoiceReplace } from '../../../finance/invoiceAmendment';

/**
 * applyInvoiceEdit — EDIT. Ordering: owned obligation first, then linked
 * bank movements, then the archive metadata — matching the task's required
 * write order. Every stage is attempted independently (a failure in one does
 * not skip the next) so a partial failure is reported precisely instead of
 * leaving the operator guessing what did or did not land.
 *
 * @param {{invoiceDocument, obligations?, bankMovements?, form, projects?, uid, now}} args
 * @param {{
 *   updateObligation: (family: string, id: string, patch: object) => Promise<{success:boolean,error?:Error}>,
 *   updateMovement: (id: string, patch: object) => Promise<void>,
 *   updateArchive: (sha256: string, patch: object) => Promise<void>,
 *   writeAudit: (entry: object) => Promise<void>,
 * }} effects
 */
export const applyInvoiceEdit = async (
  { invoiceDocument, obligations = [], bankMovements = [], form, projects = [] } = {},
  effects,
) => {
  const plan = planInvoiceEdit({ invoiceDocument, obligations, bankMovements, form, projects });
  if (!plan.valid) return { success: false, plan };

  const failures = [];

  for (const { family, id, patch } of plan.obligationPatches) {
    try {
      const result = await effects.updateObligation(family, id, patch);
      if (!result?.success) failures.push({ stage: 'obligation', family, id, error: result?.error });
    } catch (error) {
      failures.push({ stage: 'obligation', family, id, error });
    }
  }

  for (const { id, patch } of plan.movementPatches) {
    try {
      await effects.updateMovement(id, patch);
    } catch (error) {
      failures.push({ stage: 'movement', id, error });
    }
  }

  if (Object.keys(plan.archivePatch).length > 0) {
    try {
      await effects.updateArchive(invoiceDocument.id, plan.archivePatch);
    } catch (error) {
      failures.push({ stage: 'archive', error });
    }
  }

  await effects.writeAudit?.({
    action: 'update',
    entityType: 'invoiceDocument',
    entityId: invoiceDocument.id,
    before: invoiceDocument,
    reason: form?.reason,
    plan,
    partial: failures.length > 0,
  });

  if (failures.length > 0) return { success: false, partial: true, plan, failures };
  return { success: true, plan };
};

/**
 * applyInvoiceDelete — DELETE. STRICT ordering, gated on success at every
 * step: back-references (and any requested cancellation) first, then the
 * PDF chunks, then the archive document LAST. A failure at any step stops
 * the chain — the archive row is deleted only once everything that must
 * happen before it has actually succeeded, so a failure midway leaves a
 * still-visible, retryable row instead of an invisible orphan (a deleted
 * archive doc with dangling chunks, or a payable still pointing at a PDF
 * that no longer exists).
 *
 * @param {{invoiceDocument, obligations?, bankMovements?, cancelObligations?, reason}} args
 * @param {{
 *   removeBackReference: (family: string, id: string, sha256: string) => Promise<void>,
 *   cancelObligation: (family: string, id: string, reason?: string) => Promise<{success:boolean,error?:Error}>,
 *   deleteChunks: (sha256: string, chunkCount: number) => Promise<void>,
 *   deleteArchive: (sha256: string) => Promise<void>,
 *   writeAudit: (entry: object) => Promise<void>,
 * }} effects
 */
export const applyInvoiceDelete = async (
  { invoiceDocument, obligations = [], bankMovements = [], cancelObligations = [], reason } = {},
  effects,
) => {
  const plan = planInvoiceDelete({ invoiceDocument, obligations, bankMovements, cancelObligations });
  const failures = [];

  for (const removal of plan.backReferenceRemovals) {
    if (failures.length > 0) break;
    try {
      await effects.removeBackReference(removal.family, removal.id, invoiceDocument.id);
    } catch (error) {
      failures.push({ stage: 'backReference', ...removal, error });
    }
  }

  for (const cancellation of plan.cancellations) {
    if (failures.length > 0) break;
    try {
      const result = await effects.cancelObligation(cancellation.family, cancellation.id, reason);
      if (!result?.success) failures.push({ stage: 'cancel', ...cancellation, error: result?.error });
    } catch (error) {
      failures.push({ stage: 'cancel', ...cancellation, error });
    }
  }

  if (failures.length === 0) {
    try {
      await effects.deleteChunks(invoiceDocument.id, plan.chunkDeletes);
    } catch (error) {
      failures.push({ stage: 'chunks', error });
    }
  }

  if (failures.length === 0) {
    try {
      await effects.deleteArchive(invoiceDocument.id);
    } catch (error) {
      failures.push({ stage: 'archive', error });
    }
  }

  await effects.writeAudit?.({
    action: 'delete',
    entityType: 'invoiceDocument',
    entityId: invoiceDocument.id,
    before: invoiceDocument,
    reason,
    plan,
    partial: failures.length > 0,
  });

  if (failures.length > 0) return { success: false, partial: true, plan, failures };
  return { success: true, plan };
};

/**
 * applyInvoiceReplace — REPLACE PDF. Ordering: upload the new bytes, commit
 * the new `invoiceDocuments/{newSha}` doc, re-point every obligation
 * back-reference — ALL BEFORE touching the old document — then delete the
 * old doc's chunks and the old doc itself LAST. A failure at any point before
 * the final deletes leaves the OLD PDF fully intact and the new one either
 * absent or an extra (recoverable) row, never a half-swapped, unreadable
 * invoice.
 *
 * @param {{invoiceDocument, newFile, bytes}} args
 * @param {{
 *   uploadPdf: (args: {bytes, expectedSha256}) => Promise<{sha256,sizeBytes,mimeType}>,
 *   commitNewDocument: (args: {document: object}) => Promise<void>,
 *   swapBackReference: (family: string, id: string, swap: {removeInvoiceDocumentId,addInvoiceDocumentId}) => Promise<void>,
 *   deleteOldChunks: (sha256: string, chunkCount: number) => Promise<void>,
 *   deleteOldArchive: (sha256: string) => Promise<void>,
 *   writeAudit: (entry: object) => Promise<void>,
 * }} effects
 */
export const applyInvoiceReplace = async ({ invoiceDocument, newFile, bytes } = {}, effects) => {
  const plan = planInvoiceReplace({ invoiceDocument, newFile });
  if (!plan.valid) return { success: false, errors: plan.errors };

  const uploaded = await effects.uploadPdf({ bytes, expectedSha256: plan.newDocument.data.sha256 });
  if (!uploaded || uploaded.sha256 !== plan.newDocument.data.sha256) {
    return { success: false, errors: { file: 'El PDF recibido no coincide con el archivo original.' } };
  }

  await effects.commitNewDocument({ document: plan.newDocument });

  for (const swap of plan.backReferenceSwaps) {
    await effects.swapBackReference(swap.family, swap.recordId, {
      removeInvoiceDocumentId: swap.removeInvoiceDocumentId,
      addInvoiceDocumentId: swap.addInvoiceDocumentId,
    });
  }

  await effects.deleteOldChunks(plan.oldSha256, invoiceDocument.chunkCount);
  await effects.deleteOldArchive(plan.oldSha256);

  await effects.writeAudit?.({
    action: 'replace',
    entityType: 'invoiceDocument',
    entityId: plan.newDocument.id,
    before: invoiceDocument,
    metadata: { oldSha256: plan.oldSha256, newSha256: plan.newDocument.id },
  });

  return { success: true, plan, newSha256: plan.newDocument.id };
};
