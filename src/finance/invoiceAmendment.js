/**
 * Invoice amendment — the pure planning core behind correcting an archived
 * invoice from Facturas: EDIT, REPLACE PDF and DELETE. Every accounting
 * decision lives here; the store/hook layer (src/features/facturas/lib/amend.js)
 * only turns a plan into Firestore effects, and the UI only collects the form.
 *
 * ── LOCK ────────────────────────────────────────────────────────────────
 * An obligation is LOCKED when touching its amounts or cancelling it would
 * silently disagree with money that already moved: it has `paidAmount > 0`,
 * a non-empty `payments[]`, status `partial`/`settled`, or a non-void bank
 * movement already references it (`obligationLockState`).
 *
 * ── OWNERSHIP ───────────────────────────────────────────────────────────
 * `invoiceDocument.linkMode` is a per-DOCUMENT field, not per-link: when a
 * document accumulated links from more than one archive operation (a PDF
 * re-archived and attached to further obligations), the stored `linkMode`
 * only reflects the LATEST operation and cannot tell which, if any, of
 * several links a `create-ordinary` call actually created. The schema keeps
 * no per-link provenance (no timestamp, no "created by this archive" flag),
 * so — per the task's own instruction to fail closed rather than guess —
 * `ownedLinks` treats a link as OWNED only in the single unambiguous case:
 * `linkMode === 'create-ordinary'` AND the document carries EXACTLY ONE
 * link. That is provably the one obligation `archiveInvoice`'s `create-
 * ordinary` step created (create-ordinary always produces exactly one
 * link, and nothing else could have added a second one without also
 * flipping the document's `linkMode`). Every other shape — multiple links,
 * or `linkMode === 'attach-existing'` — is treated as FOREIGN: this module
 * never cancels or rewrites an obligation it cannot prove it created.
 *
 * Pure: no React, no Firebase, no Date.now() — every value comes from the
 * caller, and outputs are patches/plans, never a side effect.
 */
import { addDays, toISODate } from './utils.js';
import { MAX_INVOICE_BYTES } from './invoiceChunks.js';
import { validateInvoiceFile } from './invoiceArchive.js';
import { buildClassificationFields, validateInvoiceClassification } from './invoiceClassification.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Trimmed, NFC-normalized counterparty id — mirrors intake.js's own helper. */
const normalizeCounterpartyId = (name) => {
  if (typeof name !== 'string') return '';
  return name.trim().normalize('NFC');
};

/** ISO 'YYYY-MM-DD' + `days` calendar days (delegates to the shared date utils). */
const addDaysIso = (isoDate, days) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(isoDate || ''))) return null;
  return toISODate(addDays(isoDate, days));
};

/** True when `value` is a finite, cent-precision, nonnegative money amount. */
const isMoney = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return false;
  const scaled = Math.round(numeric * 100);
  return Math.abs(numeric * 100 - scaled) < 1e-6;
};

// ─────────────────────────────────────────────────────────────────────────
// LOCK
// ─────────────────────────────────────────────────────────────────────────

const FAMILY_FIELDS = {
  payable: { id: 'payableId', ids: 'payableIds', allocations: 'payableAllocations' },
  receivable: { id: 'receivableId', ids: 'receivableIds', allocations: 'receivableAllocations' },
};

/** Whether a non-void `movement` references `obligationId` for `family`. */
const movementReferences = (movement, family, obligationId) => {
  if (!movement || movement.status === 'void') return false;
  const fields = FAMILY_FIELDS[family];
  if (!fields) return false;
  if (movement[fields.id] === obligationId) return true;
  if (Array.isArray(movement[fields.ids]) && movement[fields.ids].includes(obligationId)) return true;
  if (
    Array.isArray(movement[fields.allocations]) &&
    movement[fields.allocations].some((allocation) => allocation?.documentId === obligationId)
  )
    return true;
  return false;
};

/**
 * obligationLockState — see the module doc's LOCK definition.
 * @param {object} obligation an adapted payable/receivable (adaptPayableDoc/
 *   adaptReceivableDoc): `.kind` ('payable'|'receivable'), `.id`,
 *   `.paidAmount`, `.payments`, `.status`.
 * @param {Array<object>} bankMovements adapted bank movements (adaptBankMovementDoc).
 * @returns {{ locked: boolean, reasons: string[] }}
 */
export const obligationLockState = (obligation, bankMovements = []) => {
  const reasons = [];
  if ((Number(obligation?.paidAmount) || 0) > 0) {
    reasons.push('La obligación ya tiene pagos registrados (importe pagado mayor a cero)');
  }
  if (Array.isArray(obligation?.payments) && obligation.payments.length > 0) {
    reasons.push('La obligación tiene un historial de pagos');
  }
  if (obligation?.status === 'partial' || obligation?.status === 'settled') {
    reasons.push(`La obligación está en estado "${obligation.status}"`);
  }
  const family = obligation?.kind === 'receivable' ? 'receivable' : 'payable';
  const referenced = (Array.isArray(bankMovements) ? bankMovements : []).some((movement) =>
    movementReferences(movement, family, obligation?.id),
  );
  if (referenced) {
    reasons.push('Un movimiento bancario ya está conciliado con esta obligación');
  }
  return { locked: reasons.length > 0, reasons };
};

// ─────────────────────────────────────────────────────────────────────────
// OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────

/**
 * ownedLinks — see the module doc's OWNERSHIP rule.
 * @param {object} invoiceDocument raw invoiceDocuments doc: `.linkMode`, `.links`.
 * @returns {{ owned: Array<{family,recordId}>, foreign: Array<{family,recordId}> }}
 */
export const ownedLinks = (invoiceDocument) => {
  const links = Array.isArray(invoiceDocument?.links) ? invoiceDocument.links : [];
  const provablyCreated = invoiceDocument?.linkMode === 'create-ordinary' && links.length === 1;
  return provablyCreated ? { owned: [...links], foreign: [] } : { owned: [], foreign: [...links] };
};

// ─────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────

const AMOUNT_FIELDS = ['netAmount', 'taxAmount', 'grossAmount'];

/**
 * planInvoiceEdit — plans an in-place correction of an archived invoice.
 *
 * @param {{
 *   invoiceDocument: object, obligations?: Array<object>, bankMovements?: Array<object>,
 *   form: {
 *     counterpartyName, invoiceNumber, issueDate, netAmount, taxAmount, grossAmount,
 *     categoryName, projectId, costCenterId, reason,
 *   },
 *   projects?: Array<object>,
 * }} params
 * @returns {{
 *   valid: boolean, errors: object,
 *   archivePatch: object, obligationPatches: Array<{family,id,patch}>,
 *   movementPatches: Array<{id,patch}>, skippedMovements: Array<{id,reason}>,
 *   lockedFields: string[],
 * }}
 */
export const planInvoiceEdit = ({
  invoiceDocument,
  obligations = [],
  bankMovements = [],
  form = {},
  projects = [],
} = {}) => {
  const errors = {};
  const family = invoiceDocument?.family || (invoiceDocument?.direction === 'incoming' ? 'payable' : 'receivable');

  if (!text(form.reason)) {
    errors.reason = 'El motivo de la corrección es obligatorio';
  }
  if (!text(form.counterpartyName)) {
    errors.counterpartyName = 'La contraparte es obligatoria';
  }
  if (!text(form.invoiceNumber)) {
    errors.invoiceNumber = 'El número de factura es obligatorio';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.issueDate || ''))) {
    errors.issueDate = 'La fecha es obligatoria';
  }
  AMOUNT_FIELDS.forEach((field) => {
    if (!isMoney(form[field])) errors[field] = 'Importe inválido';
  });
  if (!errors.netAmount && !errors.taxAmount && !errors.grossAmount) {
    const net = Number(form.netAmount);
    const tax = Number(form.taxAmount);
    const gross = Number(form.grossAmount);
    if (Math.abs(net + tax - gross) > 0.01) {
      errors.grossAmount = 'Los totales de la factura no cuadran';
    }
  }

  const classificationCheck = validateInvoiceClassification({
    direction: family,
    categoryName: form.categoryName,
    projectId: form.projectId,
    costCenterId: form.costCenterId,
  });
  if (!classificationCheck.valid) Object.assign(errors, classificationCheck.errors);

  const { owned } = ownedLinks(invoiceDocument);
  const ownedLink = owned[0] || null;
  const ownedObligation = ownedLink
    ? (obligations || []).find((o) => o.kind === ownedLink.family && o.id === ownedLink.recordId) || null
    : null;
  const lockState = ownedObligation ? obligationLockState(ownedObligation, bankMovements) : { locked: false, reasons: [] };

  const amountsChanged =
    Number(invoiceDocument?.netAmount) !== Number(form.netAmount) ||
    Number(invoiceDocument?.taxAmount) !== Number(form.taxAmount) ||
    Number(invoiceDocument?.grossAmount) !== Number(form.grossAmount);
  const lockedFields = ownedObligation && lockState.locked ? [...AMOUNT_FIELDS] : [];
  if (ownedObligation && lockState.locked && amountsChanged && !errors.grossAmount) {
    errors.grossAmount = `Importe bloqueado: ${lockState.reasons.join('; ')}`;
  }

  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors,
      archivePatch: {},
      obligationPatches: [],
      movementPatches: [],
      skippedMovements: [],
      lockedFields,
    };
  }

  const counterpartyId = normalizeCounterpartyId(form.counterpartyName);
  // For an outgoing invoice the issuer is always UMTELKOMD itself (a fixed
  // tenant constant this pure module does not hardcode) and never changes
  // with an edit, so it is recovered from the document's OWN existing
  // identity string rather than duplicated here. For an incoming invoice the
  // issuer IS the counterparty, so it is recomputed from the edited name.
  let issuerId = counterpartyId;
  if (invoiceDocument?.direction === 'outgoing') {
    try {
      issuerId = JSON.parse(invoiceDocument.identity)[2] || '';
    } catch {
      issuerId = invoiceDocument?.counterpartyId || '';
    }
  }
  const newIdentity = JSON.stringify(['invoice-v2', invoiceDocument.direction, issuerId, text(form.invoiceNumber)]);

  const archivePatch = {};
  if (form.counterpartyName !== invoiceDocument.counterpartyName) {
    archivePatch.counterpartyName = form.counterpartyName;
    archivePatch.counterpartyId = counterpartyId;
  }
  if (text(form.invoiceNumber) !== invoiceDocument.invoiceNumber) {
    archivePatch.invoiceNumber = text(form.invoiceNumber);
  }
  if (form.issueDate !== invoiceDocument.issueDate) {
    archivePatch.issueDate = form.issueDate;
  }
  if (amountsChanged) {
    archivePatch.netAmount = Number(form.netAmount);
    archivePatch.taxAmount = Number(form.taxAmount);
    archivePatch.grossAmount = Number(form.grossAmount);
  }
  if (newIdentity !== invoiceDocument.identity) {
    archivePatch.identity = newIdentity;
  }

  const obligationPatches = [];
  const classification = buildClassificationFields(
    { categoryName: form.categoryName, projectId: form.projectId, costCenterId: form.costCenterId },
    projects,
  );

  if (ownedLink && ownedObligation) {
    const patch = {};
    if (form.counterpartyName !== ownedObligation.counterpartyName) patch.counterpartyName = form.counterpartyName;
    if (text(form.invoiceNumber) !== ownedObligation.documentNumber) patch.documentNumber = text(form.invoiceNumber);
    if (form.issueDate !== ownedObligation.issueDate) {
      patch.issueDate = form.issueDate;
      // Only follow a still-default dueDate (issueDate + 30d, the intake
      // default) — an operator-adjusted dueDate is never silently moved.
      const priorDefaultDueDate = addDaysIso(invoiceDocument.issueDate, 30);
      if (ownedObligation.dueDate === priorDefaultDueDate) {
        patch.dueDate = addDaysIso(form.issueDate, 30);
      }
    }
    if (amountsChanged) patch.amount = Number(form.grossAmount);
    if (classification.categoryName !== (ownedObligation.categoryName || '')) patch.categoryName = classification.categoryName;
    if (classification.projectId !== (ownedObligation.projectId || '')) {
      patch.projectId = classification.projectId;
      patch.projectName = classification.projectName;
    }
    if (classification.costCenterId !== (ownedObligation.costCenterId || '')) patch.costCenterId = classification.costCenterId;
    if (Object.keys(patch).length > 0) {
      // costScope always rides along with a classification change — it is
      // derived, never independent (see invoiceClassification.js), and both
      // updatePayable/updateReceivable whitelist it explicitly for this.
      if ('categoryName' in patch || 'projectId' in patch || 'costCenterId' in patch) {
        patch.costScope = classification.costScope;
      }
      obligationPatches.push({ family: ownedLink.family, id: ownedLink.recordId, patch });
    }
  }

  // Movement propagation — ONLY when the classification actually changed AND
  // the movement is linked to this ONE obligation exclusively (never a
  // movement shared by several documents, so inheritance stays true).
  const classificationChanged = obligationPatches.some(
    (entry) => 'categoryName' in entry.patch || 'projectId' in entry.patch || 'costCenterId' in entry.patch,
  );
  const movementPatches = [];
  const skippedMovements = [];
  if (classificationChanged && ownedLink) {
    const fields = FAMILY_FIELDS[ownedLink.family];
    (bankMovements || []).forEach((movement) => {
      if (!movement || movement.status === 'void') return;
      if (!movementReferences(movement, ownedLink.family, ownedLink.recordId)) return;
      const ids = Array.isArray(movement[fields.ids]) && movement[fields.ids].length > 0
        ? movement[fields.ids]
        : movement[fields.id]
          ? [movement[fields.id]]
          : (movement[fields.allocations] || []).map((a) => a.documentId);
      const exclusivelyThisOne = ids.length === 1 && ids[0] === ownedLink.recordId;
      if (!exclusivelyThisOne) {
        skippedMovements.push({ id: movement.id, reason: 'Vinculado a varias facturas' });
        return;
      }
      movementPatches.push({
        id: movement.id,
        patch: {
          categoryName: classification.categoryName,
          projectId: classification.projectId,
          projectName: classification.projectName,
          costCenterId: classification.costCenterId,
          costScope: classification.costScope,
        },
      });
    });
  }

  return { valid: true, errors: {}, archivePatch, obligationPatches, movementPatches, skippedMovements, lockedFields };
};

// ─────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────

/**
 * planInvoiceDelete — plans removing an archived invoice.
 *
 * @param {{
 *   invoiceDocument: object, obligations?: Array<object>, bankMovements?: Array<object>,
 *   cancelObligations?: Array<{family,recordId}>, reason: string,
 * }} params
 * @returns {{
 *   valid: boolean, errors: object,
 *   chunkDeletes: number, archiveDelete: boolean,
 *   backReferenceRemovals: Array<{family,id}>,
 *   cancellations: Array<{family,id}>, blockedCancellations: Array<{family,id,reasons}>,
 * }}
 */
export const planInvoiceDelete = ({
  invoiceDocument,
  obligations = [],
  bankMovements = [],
  cancelObligations = [],
  reason,
} = {}) => {
  // Mirrors planInvoiceEdit's own reason requirement: the UI (ConfirmModal's
  // `reasonLabel`) already enforces this, but a future or programmatic caller
  // must never be able to bypass it by skipping the dialog.
  if (!text(reason)) {
    return {
      valid: false,
      errors: { reason: 'El motivo de la corrección es obligatorio' },
      chunkDeletes: 0,
      archiveDelete: false,
      backReferenceRemovals: [],
      cancellations: [],
      blockedCancellations: [],
    };
  }

  const links = Array.isArray(invoiceDocument?.links) ? invoiceDocument.links : [];
  const backReferenceRemovals = links.map((link) => ({ family: link.family, id: link.recordId }));
  const chunkCount = Math.max(1, Number(invoiceDocument?.chunkCount) || Math.ceil((invoiceDocument?.sizeBytes || 0) / (768 * 1024)) || 1);

  const { owned } = ownedLinks(invoiceDocument);
  const isOwned = (family, recordId) => owned.some((link) => link.family === family && link.recordId === recordId);

  const cancellations = [];
  const blockedCancellations = [];
  (cancelObligations || []).forEach((request) => {
    if (!isOwned(request.family, request.recordId)) {
      blockedCancellations.push({
        family: request.family,
        id: request.recordId,
        reasons: ['Esta factura no creó esa obligación (vínculo ajeno): no se puede anular desde aquí'],
      });
      return;
    }
    const obligation = (obligations || []).find((o) => o.kind === request.family && o.id === request.recordId) || null;
    const lockState = obligationLockState(obligation, bankMovements);
    if (lockState.locked) {
      blockedCancellations.push({ family: request.family, id: request.recordId, reasons: lockState.reasons });
      return;
    }
    cancellations.push({ family: request.family, id: request.recordId });
  });

  return {
    valid: true,
    errors: {},
    chunkDeletes: chunkCount,
    archiveDelete: true,
    backReferenceRemovals,
    cancellations,
    blockedCancellations,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// REPLACE PDF
// ─────────────────────────────────────────────────────────────────────────

/**
 * planInvoiceReplace — plans swapping an archived invoice's PDF for a new
 * file, keeping every other field (header + classification-independent
 * links) unchanged. Same 2 MiB / PDF validation as intake.
 *
 * `existingDocument` is the archive doc (if any) the orchestrator found
 * already stored under the NEW file's sha256 — an authoritative lookup, not
 * a guess (see src/features/facturas/lib/amend.js's applyInvoiceReplace).
 * When present it can only mean the new PDF is ALREADY a different archived
 * invoice: this module rejects the replace outright rather than letting
 * `commitInvoiceArchive`'s `merge:true` + `arrayUnion(links)` silently pool
 * two invoices' link sets and overwrite one's metadata with the other's.
 *
 * @param {{
 *   invoiceDocument: object, newFile: {sha256,sizeBytes,mimeType,originalName},
 *   existingDocument?: object|null, reason: string,
 * }} params
 * @returns {{
 *   valid: boolean, errors: object,
 *   newDocument?: { id: string, data: object }, oldSha256?: string,
 *   backReferenceSwaps?: Array<{family,recordId,removeInvoiceDocumentId,addInvoiceDocumentId}>,
 * }}
 */
export const planInvoiceReplace = ({ invoiceDocument, newFile, existingDocument = null, reason } = {}) => {
  if (!text(reason)) {
    return { valid: false, errors: { reason: 'El motivo de la corrección es obligatorio' } };
  }

  const oldSha256 = String(invoiceDocument?.id || invoiceDocument?.sha256 || '').toLowerCase();

  if (newFile?.sha256 && String(newFile.sha256).toLowerCase() === oldSha256) {
    return { valid: false, errors: { file: 'Es el mismo archivo' } };
  }

  if (existingDocument) {
    const label = existingDocument.invoiceNumber || existingDocument.id || newFile?.sha256;
    return {
      valid: false,
      errors: {
        file: `Ese PDF ya está archivado como otra factura (Nº ${label}). Elimina una de las dos antes de reemplazar.`,
      },
    };
  }

  let validated;
  try {
    validated = validateInvoiceFile(newFile);
  } catch {
    return { valid: false, errors: { file: 'El archivo no es un PDF válido.' } };
  }
  if (validated.sizeBytes > MAX_INVOICE_BYTES) {
    return { valid: false, errors: { file: 'El PDF supera el máximo de 2 MB.' } };
  }

  const links = Array.isArray(invoiceDocument.links) ? invoiceDocument.links : [];
  return {
    valid: true,
    errors: {},
    newDocument: {
      id: validated.sha256,
      data: {
        sha256: validated.sha256,
        sizeBytes: validated.sizeBytes,
        mimeType: validated.mimeType,
        originalName: validated.originalName,
        direction: invoiceDocument.direction,
        family: invoiceDocument.family,
        sourceSystem: invoiceDocument.sourceSystem,
        counterpartyName: invoiceDocument.counterpartyName,
        counterpartyId: invoiceDocument.counterpartyId,
        invoiceNumber: invoiceDocument.invoiceNumber,
        issueDate: invoiceDocument.issueDate,
        currency: invoiceDocument.currency,
        netAmount: invoiceDocument.netAmount,
        taxAmount: invoiceDocument.taxAmount,
        grossAmount: invoiceDocument.grossAmount,
        identity: invoiceDocument.identity,
        linkMode: invoiceDocument.linkMode,
        links,
      },
    },
    oldSha256: invoiceDocument.id,
    backReferenceSwaps: links.map((link) => ({
      family: link.family,
      recordId: link.recordId,
      removeInvoiceDocumentId: invoiceDocument.id,
      addInvoiceDocumentId: validated.sha256,
    })),
  };
};
