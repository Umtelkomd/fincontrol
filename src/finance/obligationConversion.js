/**
 * obligationConversion — pure core of "this invoice was loaded on the wrong
 * side": turn a CXC into a CXP or vice versa (useReceivables.convertToPayable,
 * usePayables.convertToReceivable).
 *
 * The conversion creates the twin document in the other collection and
 * deletes the original, so it is only allowed while nothing else points at
 * the original: no money moved (payments / bank movement link) and no
 * archived PDF (`invoiceDocumentIds` — the archive's own `links` cannot be
 * re-pointed from the client, see src/features/facturas/README.md; the
 * fix for a PDF-backed invoice is delete + re-upload in /facturas with the
 * right direction).
 */
import { DEFAULT_CURRENCY, MAIN_ACCOUNT_ID } from './constants';
import { clampMoney } from './utils';

const FAMILY_LABEL = { receivable: 'CXC', payable: 'CXP' };

const hasItems = (value) => Array.isArray(value) && value.length > 0;

/**
 * Why `record` (an adapted CXC/CXP row, with `raw`) cannot be converted,
 * or null when it can.
 * @param {object} record
 * @param {'receivable'|'payable'} family
 * @returns {string|null}
 */
export const conversionBlocker = (record, family) => {
  const label = FAMILY_LABEL[family];
  const raw = record?.raw || record || {};
  if (!record?.id) return `${label} sin identificador`;
  if (record.status === 'cancelled') return `La ${label} está cancelada`;
  if (clampMoney(record.paidAmount || 0) > 0 || hasItems(raw.payments)) {
    return family === 'receivable'
      ? 'No se puede convertir una CXC con cobros registrados'
      : 'No se puede convertir una CXP con pagos registrados';
  }
  if (raw.bankMovementId || hasItems(raw.bankMovementIds) || raw.reconciledAt) {
    return `La ${label} está vinculada a un movimiento bancario. Deshaz la conciliación primero.`;
  }
  if (hasItems(raw.invoiceDocumentIds)) {
    return `La ${label} tiene un PDF archivado. Bórrala en Facturas y vuelve a subir el PDF con el tipo correcto.`;
  }
  return null;
};

/**
 * Payload of the twin document in the other collection. Only fields that
 * mean the same on both sides are carried over; the category is NOT
 * (income vs expense categories differ) and must be set again.
 * @param {object} record adapted CXC/CXP row (with `raw`)
 * @param {'receivable'|'payable'} fromFamily
 * @param {string} userEmail
 * @param {string} nowIso
 */
export const buildConvertedPayload = (record, fromFamily, userEmail, nowIso) => {
  const raw = record.raw || record;
  const amount = clampMoney(raw.grossAmount ?? raw.amount ?? record.grossAmount ?? 0);
  const counterparty = raw.counterpartyName || raw.client || raw.vendor || '';
  const documentNumber = raw.documentNumber || raw.invoiceNumber || '';
  const toFamily = fromFamily === 'receivable' ? 'payable' : 'receivable';

  const payload = {
    accountId: raw.accountId || MAIN_ACCOUNT_ID,
    currency: raw.currency || DEFAULT_CURRENCY,
    counterpartyName: counterparty,
    ...(toFamily === 'payable' ? { vendor: counterparty } : { client: counterparty }),
    documentNumber,
    invoiceNumber: documentNumber,
    projectId: raw.projectId || '',
    projectName: raw.projectName || raw.project || '',
    projectCode: raw.projectCode || '',
    costCenterId: raw.costCenterId || '',
    costScope: raw.costScope || '',
    categoryName: '',
    description: raw.description || '',
    grossAmount: amount,
    amount,
    openAmount: amount,
    pendingAmount: amount,
    paidAmount: 0,
    issueDate: raw.issueDate || null,
    dueDate: raw.dueDate || null,
    paymentTerms: raw.paymentTerms || 'net30',
    status: 'issued',
    payments: [],
    notes: raw.notes || '',
    _convertedFrom: { collection: `${fromFamily}s`, id: record.id },
    createdBy: userEmail,
    updatedBy: userEmail,
    auditTrail: [{
      action: 'create',
      user: userEmail,
      timestamp: nowIso,
      detail: `Convertida desde ${FAMILY_LABEL[fromFamily]} (ID: ${record.id}) por corrección de error`,
    }],
  };
  if (raw.taxRate != null) payload.taxRate = raw.taxRate;
  if (raw.netAmount != null) payload.netAmount = clampMoney(raw.netAmount);
  if (raw.taxAmount != null) payload.taxAmount = clampMoney(raw.taxAmount);
  return payload;
};
