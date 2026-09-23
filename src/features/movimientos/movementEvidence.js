/**
 * Movement evidence — what the "Estado" column says about a bank movement's
 * reconciliation, and whether its documents carry an invoice.
 *
 * A movement may settle one document (`payableId` / `receivableId`) or many
 * (`payableIds` / `receivableIds`: a confirming receipt paying twenty
 * certificates, one UTA debit covering several vehicles). Reading only the
 * single-id fields made every grouped reconciliation look unreconciled.
 */

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const uniqueIds = (single, many) =>
  [...new Set([text(single), ...(Array.isArray(many) ? many.map(text) : [])].filter(Boolean))];

/** Documents a movement is reconciled against, by collection. */
export const linkedDocumentIds = (movement) => ({
  payables: uniqueIds(movement?.payableId, movement?.payableIds),
  receivables: uniqueIds(movement?.receivableId, movement?.receivableIds),
});

/** Reconciled outside the program: documents kept in the old spreadsheet. */
export const isExternallyReconciled = (movement) => movement?.reconciliationMode === 'external-excel';

export const isReconciledMovement = (movement) => {
  if (!movement || movement.status === 'void') return false;
  const { payables, receivables } = linkedDocumentIds(movement);
  return payables.length + receivables.length > 0 || isExternallyReconciled(movement);
};

export const invoiceNumberOf = (doc) => text(doc?.documentNumber) || text(doc?.invoiceNumber);

export const MOVEMENT_EVIDENCE = {
  /** Reconciled, and every linked document carries an invoice number. */
  INVOICED: 'invoiced',
  /** Reconciled, but at least one linked document has no invoice number. */
  NO_INVOICE: 'no-invoice',
  /** Reconciled against documents managed in the old spreadsheet. */
  EXTERNAL: 'external',
};

/**
 * movementEvidence — the reconciliation badge for one movement.
 *
 * @param {object} movement
 * @param {Map<string, object>} documentsById receivables and payables by id
 * @returns {{ kind: string, label: string, title: string } | null} null when the movement is not reconciled
 */
export const movementEvidence = (movement, documentsById) => {
  if (!isReconciledMovement(movement)) return null;
  const { payables, receivables } = linkedDocumentIds(movement);
  const ids = [...payables, ...receivables];

  if (ids.length === 0) {
    return { kind: MOVEMENT_EVIDENCE.EXTERNAL, label: 'Conciliado (Excel)', title: 'Conciliado fuera del programa: documento llevado en Excel' };
  }

  // A link to a document that no longer exists (or was cancelled) is no invoice.
  const documents = ids.map((id) => documentsById?.get(id)).filter((doc) => doc && doc.status !== 'cancelled');
  const numbers = documents.map(invoiceNumberOf).filter(Boolean);
  const invoiced = documents.length === ids.length && numbers.length === documents.length;

  if (!invoiced) {
    return { kind: MOVEMENT_EVIDENCE.NO_INVOICE, label: 'Conciliado sin factura', title: 'Conciliado con CXC/CXP sin número de factura' };
  }
  const label = numbers.length === 1 ? `Conciliado · ${numbers[0]}` : `Conciliado · ${numbers.length} facturas`;
  return { kind: MOVEMENT_EVIDENCE.INVOICED, label, title: `Conciliado con factura: ${numbers.join(', ')}` };
};
