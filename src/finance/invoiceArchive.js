/**
 * Pure intake contracts, not persistence or extraction. A confirmed header is
 * separate from immutable PDF descriptors and obligation references. Drafts
 * cannot plan accounting work. No function infers payment state from a PDF.
 */
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

const text = (value, field) => {
  requireValue(
    typeof value === "string" && value.trim().length > 0,
    `${field} is required`,
  );
  const hasControl = Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  requireValue(!hasControl, `${field} contains control characters`);
  return value.trim().normalize("NFC");
};

const directionOf = (value) => {
  requireValue(
    value === "incoming" || value === "outgoing",
    "Invalid invoice direction",
  );
  return value;
};

const cents = (value, field) => {
  requireValue(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    `${field} must be nonnegative money`,
  );
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  requireValue(
    Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.000001,
    `${field} must have cent precision`,
  );
  return rounded;
};

/**
 * Stable identity INPUT, not a hash, storage key or concurrency guarantee.
 * issuerId is explicitly supplied by a trusted caller: the issuing company/tenant
 * for outgoing invoices, the supplier for incoming invoices. counterpartyId is
 * separately required for linkage (recipient for outgoing, supplier for incoming)
 * but does not scope deduplication. Neither ID may be an extracted name guess.
 * Persistence must verify trusted tenant/supplier relationships; syntax validation
 * cannot establish ownership. Case, punctuation, zeros and internal spacing stay
 * significant; only trim/NFC are normalized. v2 replaces recipient-scoped v1.
 */
export const invoiceIdentityInput = (data = {}) => {
  text(data.counterpartyId, "counterpartyId");
  return JSON.stringify([
    "invoice-v2",
    directionOf(data.direction),
    text(data.issuerId, "issuerId"),
    text(data.invoiceNumber, "invoiceNumber"),
  ]);
};

/** EUR-only v1; explicit totals support zero and mixed VAT without a taxRate. */
export const validateConfirmedInvoice = (data = {}) => {
  requireValue(data.confirmed === true, "Human confirmation is required");
  requireValue(
    data.documentType === "invoice",
    "Only invoices are supported; credit notes are unsupported",
  );
  invoiceIdentityInput(data);
  requireValue(
    ["ordinary", "insyte"].includes(data.sourceSystem),
    "Explicit sourceSystem is required",
  );
  requireValue(
    data.sourceSystem !== "insyte" || data.direction === "outgoing",
    "Insyte invoices must be outgoing",
  );
  const date = data.issueDate;
  requireValue(
    typeof date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !date.startsWith("0000"),
    "Invalid ISO invoice date",
  );
  const parsed = new Date(`${date}T00:00:00.000Z`);
  requireValue(
    Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date,
    "Invalid calendar invoice date",
  );
  requireValue(
    data.currency === "EUR",
    "Only EUR is supported; no currency conversion",
  );
  const net = cents(data.netAmount, "netAmount");
  const tax = cents(data.taxAmount, "taxAmount");
  const gross = cents(data.grossAmount, "grossAmount");
  requireValue(
    gross > 0 && Number.isSafeInteger(net + tax),
    "Invalid invoice totals",
  );
  // One cent permits explicit invoice rounding, without correcting any total.
  requireValue(Math.abs(net + tax - gross) <= 1, "Unbalanced invoice totals");
  return Object.freeze({
    confirmed: true,
    documentType: "invoice",
    direction: data.direction,
    sourceSystem: data.sourceSystem,
    issuerId: text(data.issuerId, "issuerId"),
    counterpartyId: text(data.counterpartyId, "counterpartyId"),
    invoiceNumber: data.invoiceNumber,
    issueDate: date,
    currency: data.currency,
    netAmount: data.netAmount,
    taxAmount: data.taxAmount,
    grossAmount: data.grossAmount,
  });
};

/**
 * Validates metadata only, NOT actual PDF bytes, MIME authenticity or storage.
 * SHA-256 describes exact bytes, not invoice identity: re-exports may differ.
 * The later intake/storage boundary must compute/verify the hash and retain the
 * original bytes; descriptors are append-only there, never overwritten here.
 */
export const validateInvoiceFile = (data = {}) => {
  requireValue(
    typeof data.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(data.sha256),
    "Invalid SHA-256",
  );
  requireValue(
    Number.isSafeInteger(data.sizeBytes) && data.sizeBytes > 0,
    "Invalid PDF size",
  );
  requireValue(
    data.mimeType === "application/pdf",
    "Only PDF files are supported",
  );
  text(data.originalName, "originalName");
  return Object.freeze({
    sha256: data.sha256.toLowerCase(),
    sizeBytes: data.sizeBytes,
    mimeType: data.mimeType,
    originalName: data.originalName,
  });
};

const validateReference = (reference, family) => {
  requireValue(reference != null, "Missing obligation selection");
  requireValue(
    reference?.family === family,
    "Invalid or mixed obligation family",
  );
  const id = text(reference.recordId, "recordId");
  requireValue(
    id === reference.recordId && !id.includes("/") && id !== "." && id !== "..",
    "Invalid recordId",
  );
  return Object.freeze({ family, recordId: id });
};

const validateExistingInvoiceBinding = (row, header) => {
  const number = text(header.invoiceNumber, "invoiceNumber");
  const fields = ["rechnungId", "invoiceNumber"];
  // documentNumber can be a presupuesto, order or other operational identifier.
  // Only explicitly classified ordinary invoices give this alias invoice meaning.
  if (row.sourceSystem === "ordinary" && row.documentType === "invoice") {
    fields.push("documentNumber");
  }
  for (const field of fields) {
    const value = row[field];
    if (value == null || value === "") continue;
    requireValue(
      text(value, field) === number,
      `Existing invoice conflict: ${field}`,
    );
  }
  if (row.archivedInvoiceIdentity != null) {
    requireValue(
      row.archivedInvoiceIdentity === invoiceIdentityInput(header),
      "Existing archived invoice conflict or unresolved identity",
    );
  }
};

/**
 * create-ordinary requests ONE new obligation; it does not create a record or
 * allocate an ID. attach-existing requires explicitly selected, resolved rows.
 * Insyte is always link-only to existing presupuesto receivables, NEVER a new
 * aggregate CXC. The caller supplies trusted source classification and a current
 * snapshot shaped as { family, recordId, counterpartyId, sourceSystem, ... }.
 * Preserve existing rechnungId/invoiceNumber bindings in that snapshot. Include
 * documentType: 'invoice' only when an ordinary documentNumber is an invoice
 * number, never for a presupuesto/order. Insyte documentNumber is operational.
 * Optional archivedInvoiceIdentity must be the exact invoiceIdentityInput result
 * of the already linked archive header; unknown/old identities fail closed.
 * Storage IDs alone are not supported: callers must resolve them to this identity
 * and must not omit bindings when adapting rows. All supplied bindings must agree.
 * Settled rows are eligible. Row totals (Insyte NET), payments and statuses are
 * neither copied nor patched; no deletion is planned. Persistence must recheck
 * existence/identity atomically and enforce uniqueness, outside this module.
 */
export const planInvoiceLink = ({
  invoice,
  mode,
  links = [],
  existingObligations = [],
} = {}) => {
  const header = validateConfirmedInvoice(invoice);
  const family = header.direction === "incoming" ? "payable" : "receivable";
  requireValue(Array.isArray(links), "links must be an array");
  requireValue(
    mode === "create-ordinary" || mode === "attach-existing",
    "Explicit link mode is required",
  );
  if (mode === "create-ordinary") {
    requireValue(header.sourceSystem === "ordinary", "Insyte is link-only");
    requireValue(
      links.length === 0,
      "Creation cannot attach existing obligations",
    );
    return Object.freeze({ mode, family, links: Object.freeze([]) });
  }
  requireValue(
    links.length > 0 && Array.isArray(existingObligations),
    "Existing obligation references are required",
  );
  const seen = new Set();
  // Array.from visits holes as undefined, unlike map, so no selection is skipped.
  const resolved = Array.from(links, (link) => {
    const reference = validateReference(link, family);
    requireValue(!seen.has(reference.recordId), "Duplicate obligation link");
    seen.add(reference.recordId);
    const matches = existingObligations.filter(
      (row) => row?.family === family && row.recordId === reference.recordId,
    );
    requireValue(
      matches.length === 1,
      "Unresolved or ambiguous obligation reference",
    );
    const row = matches[0];
    requireValue(
      text(row.counterpartyId, "obligation counterpartyId") ===
        header.counterpartyId,
      "Counterparty mismatch",
    );
    requireValue(
      row.sourceSystem === header.sourceSystem,
      "Obligation source mismatch",
    );
    if (header.sourceSystem === "insyte")
      text(row.numeroPresupuesto, "numeroPresupuesto");
    validateExistingInvoiceBinding(row, header);
    return reference;
  });
  return Object.freeze({ mode, family, links: Object.freeze(resolved) });
};
