/**
 * Pure orchestration for invoice PDF intake: turns a confirmed header, an
 * uploaded PDF descriptor and a link decision into the exact effect calls
 * needed to archive the invoice — without performing any I/O itself.
 *
 * Delegates every accounting invariant to src/finance/invoiceArchive.js
 * (validateConfirmedInvoice, validateInvoiceFile, planInvoiceLink,
 * invoiceIdentityInput) — this module never re-implements or loosens those
 * checks, it only shapes data around them.
 *
 * Pure: no Firebase, no fetch, no Date.now() — every effect (upload, create,
 * commit) and every timestamp (`now`) is injected by the caller.
 */
import {
  invoiceIdentityInput,
  planInvoiceLink,
  validateConfirmedInvoice,
  validateInvoiceFile,
} from '../../../finance/invoiceArchive';

/** UMTELKOMD's own tenant id — the issuer of every outgoing invoice. */
export const ISSUER_TENANT_ID = 'umtelkomd';

/** Trimmed, NFC-normalized counterparty id (or '' for anything unusable). */
export const normalizeCounterpartyId = (name) => {
  if (typeof name !== 'string') return '';
  return name.trim().normalize('NFC');
};

/** Coerce a form value (number or comma/dot string) to a Number, or NaN. */
const coerceAmount = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace(',', '.'));
  return NaN;
};

/** Same as coerceAmount, but an empty/missing value means explicit zero VAT. */
const coerceTaxAmount = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  return coerceAmount(value);
};

/**
 * Builds and validates a confirmed invoice header from raw (possibly
 * string-typed, form-shaped) input. Delegates every invariant to
 * validateConfirmedInvoice; this only derives issuerId/counterpartyId and
 * coerces amounts. Re-attaches `counterpartyName` for downstream use
 * (validateConfirmedInvoice's frozen result does not carry it).
 */
export const buildConfirmedHeader = ({
  direction,
  sourceSystem,
  counterpartyName,
  invoiceNumber,
  issueDate,
  netAmount,
  taxAmount,
  grossAmount,
} = {}) => {
  const counterpartyId = normalizeCounterpartyId(counterpartyName);
  const issuerId = direction === 'incoming' ? counterpartyId : ISSUER_TENANT_ID;
  const validated = validateConfirmedInvoice({
    confirmed: true,
    documentType: 'invoice',
    currency: 'EUR',
    direction,
    sourceSystem,
    issuerId,
    counterpartyId,
    invoiceNumber,
    issueDate,
    netAmount: coerceAmount(netAmount),
    taxAmount: coerceTaxAmount(taxAmount),
    grossAmount: coerceAmount(grossAmount),
  });
  return Object.freeze({ ...validated, counterpartyName: counterpartyId });
};

/**
 * Maps a persisted receivable/payable document to the row shape
 * `planInvoiceLink` expects in `existingObligations` (see
 * src/finance/invoiceArchive.js and its test for the exact field names).
 *
 * @param {object} doc a receivable or payable Firestore document
 * @param {'receivable'|'payable'} family
 */
export const obligationToLinkRow = (doc = {}, family) => ({
  family,
  recordId: doc.recordId ?? doc.id,
  counterpartyId: normalizeCounterpartyId(doc.counterpartyName || doc.vendor || doc.client),
  sourceSystem: doc.sourceSystem || 'ordinary',
  numeroPresupuesto: doc.numeroPresupuesto,
  rechnungId: doc.rechnungId,
  invoiceNumber: doc.invoiceNumber,
  documentNumber: doc.documentNumber,
  archivedInvoiceIdentity: doc.archivedInvoiceIdentity,
});

/** ISO 'YYYY-MM-DD' + `days` calendar days, in UTC to avoid DST drift. */
const addDaysIso = (isoDate, days) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/**
 * Builds the data payload for `createPayable` (incoming) / `createReceivable`
 * (outgoing) from a confirmed header.
 */
export const buildObligationPayload = (header, { projectId, description } = {}) => {
  const counterpartyField = header.direction === 'incoming' ? 'vendor' : 'client';
  return {
    invoiceNumber: header.invoiceNumber,
    [counterpartyField]: header.counterpartyName,
    grossAmount: header.grossAmount,
    amount: header.grossAmount,
    netAmount: header.netAmount,
    taxAmount: header.taxAmount,
    issueDate: header.issueDate,
    dueDate: addDaysIso(header.issueDate, 30),
    currency: 'EUR',
    sourceSystem: 'ordinary',
    description: description || '',
    projectId: projectId || '',
  };
};

/** The obligation family an invoice header belongs to. */
const familyOf = (header) => (header.direction === 'incoming' ? 'payable' : 'receivable');

/**
 * Builds the `invoiceDocuments/{sha256}` document to persist, validating the
 * file descriptor first.
 */
export const buildInvoiceDocument = ({ header, file, links, linkMode, uid, now }) => {
  const validatedFile = validateInvoiceFile(file);
  return {
    id: validatedFile.sha256,
    data: {
      sha256: validatedFile.sha256,
      sizeBytes: validatedFile.sizeBytes,
      mimeType: validatedFile.mimeType,
      originalName: validatedFile.originalName,
      direction: header.direction,
      family: familyOf(header),
      sourceSystem: header.sourceSystem,
      counterpartyName: header.counterpartyName,
      counterpartyId: header.counterpartyId,
      invoiceNumber: header.invoiceNumber,
      issueDate: header.issueDate,
      currency: header.currency,
      netAmount: header.netAmount,
      taxAmount: header.taxAmount,
      grossAmount: header.grossAmount,
      identity: invoiceIdentityInput(header),
      linkMode,
      links,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    },
  };
};

/**
 * Archives one invoice PDF end to end: validates the file, plans the
 * obligation link, uploads the bytes, optionally creates a new ordinary
 * obligation, then commits the invoice document and every link update in one
 * effect call.
 *
 * FAILS CLOSED at every step — a thrown validation, a rejected upload, or a
 * hash mismatch aborts before any obligation is created or committed.
 *
 * @param {{
 *   header: object, file: object, bytes: ArrayBuffer|Uint8Array,
 *   mode: 'create-ordinary'|'attach-existing', links?: Array<object>,
 *   existingObligations?: Array<object>, uid: string, now: string,
 * }} params
 * @param {{
 *   upload: (args: {bytes, expectedSha256}) => Promise<{sha256,sizeBytes,mimeType}>,
 *   createObligation: (family: string, payload: object) => Promise<string>,
 *   commit: (args: {document, linkUpdates}) => Promise<void>,
 * }} effects
 * @returns {Promise<{ sha256: string, obligationIds: string[], created: boolean }>}
 */
export const archiveInvoice = async (
  { header, file, bytes, mode, links = [], existingObligations = [], uid, now } = {},
  effects,
) => {
  // (a) Validate the file descriptor before anything else.
  const validatedFile = validateInvoiceFile(file);

  // (b) Plan the obligation link — every accounting invariant lives here.
  const plan = planInvoiceLink({ invoice: header, mode, links, existingObligations });

  // (c) Upload the bytes and assert the server confirms the SAME hash.
  const uploaded = await effects.upload({ bytes, expectedSha256: validatedFile.sha256 });
  if (!uploaded || uploaded.sha256 !== validatedFile.sha256) {
    throw new Error('Uploaded PDF hash does not match the expected SHA-256');
  }

  // (d) create-ordinary requests exactly one new obligation.
  let resolvedLinks = plan.links;
  if (mode === 'create-ordinary') {
    const payload = buildObligationPayload(header);
    const id = await effects.createObligation(plan.family, payload);
    resolvedLinks = [{ family: plan.family, recordId: id }];
  }

  // (e) Every resolved link gets the same archive identity + document id.
  const identity = invoiceIdentityInput(header);
  const linkUpdates = resolvedLinks.map((link) => ({
    family: link.family,
    recordId: link.recordId,
    patch: {
      archivedInvoiceIdentity: identity,
      invoiceDocumentIds: [validatedFile.sha256],
      updatedAt: now,
      updatedBy: uid,
    },
  }));

  const document = buildInvoiceDocument({
    header,
    file: validatedFile,
    links: resolvedLinks,
    linkMode: mode,
    uid,
    now,
  });

  // (f) Commit the document and every link update together.
  await effects.commit({ document, linkUpdates });

  return {
    sha256: validatedFile.sha256,
    obligationIds: resolvedLinks.map((link) => link.recordId),
    created: mode === 'create-ordinary',
  };
};
