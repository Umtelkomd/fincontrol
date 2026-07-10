import { MOVEMENT_KIND, MOVEMENT_STATUS } from './constants';
import {
  clampMoney,
  deriveDocumentStage,
  deriveDocumentStatus,
  getAccountId,
  getCurrency,
  getGrossAmount,
  getOpenAmount,
  getPaidAmount,
  toISODate,
} from './utils';

const normalizePayments = (payments = []) => {
  return payments.map((payment, index) => ({
    id: payment.id || `${toISODate(payment.date) || 'payment'}-${index}`,
    amount: clampMoney(payment.amount),
    date: toISODate(payment.date || payment.timestamp) || toISODate(new Date()),
    method: payment.method || 'Transferencia',
    note: payment.note || payment.reference || '',
    user: payment.user || payment.registeredBy || '',
    timestamp: payment.timestamp || payment.date || null,
  }));
};

const normalizeDocument = (raw, kind, source) => {
  const grossAmount = getGrossAmount(raw);
  const openAmount = getOpenAmount(raw);
  const paidAmount = getPaidAmount(raw);
  const stage = deriveDocumentStage(raw.status, openAmount);
  const status = deriveDocumentStatus(stage, raw.dueDate || raw.date);
  // VAT fields — backward compat: if taxRate missing, assume 19%
  const taxRate = raw.taxRate ?? 0.19;
  const netAmount = raw.netAmount ?? (taxRate > 0 ? grossAmount / (1 + taxRate) : grossAmount);
  const taxAmount = raw.taxAmount ?? (grossAmount - netAmount);

  return {
    id: raw.id,
    kind,
    source,
    accountId: getAccountId(raw.accountId),
    currency: getCurrency(raw.currency),
    grossAmount,
    openAmount,
    paidAmount,
    stage,
    status,
    issueDate: toISODate(raw.issueDate || raw.date),
    dueDate: toISODate(raw.dueDate || raw.date),
    counterpartyName:
      raw.counterpartyName ||
      raw.client ||
      raw.vendor ||
      raw.description ||
      'Sin contraparte',
    description: raw.description || raw.category || '',
    documentNumber: raw.documentNumber || raw.invoiceNumber || '',
    projectId: raw.projectId || '',
    projectName: raw.projectName || raw.project || 'Sin proyecto',
    costCenterId: raw.costCenterId || raw.costCenter || '',
    payments: normalizePayments(raw.payments),
    linkedTransactionId: raw.linkedTransactionId || null,
    legacyTransactionId: raw.legacyTransactionId || raw.id || null,
    notes: raw.notes || '',
    createdBy: raw.createdBy || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || raw.lastModifiedBy || '',
    // VAT fields — German Umsatzsteuer
    taxRate,
    netAmount,
    taxAmount,
    // Payroll markers — surfaced as first-class fields so the Nóminas view can
    // join an obligation to its live payable (the filter keys off payrollPeriodId).
    payrollPeriodId: raw.payrollPeriodId || null,
    payrollKind: raw.payrollKind || null,
    sourceDocument: raw.sourceDocument || null,
    raw,
  };
};

export const adaptReceivableDoc = (raw, source = 'receivable') => normalizeDocument(raw, 'receivable', source);

export const adaptPayableDoc = (raw, source = 'payable') => normalizeDocument(raw, 'payable', source);

const normalizeImportFile = (importFile) => {
  if (importFile && typeof importFile === 'object') {
    return {
      name: importFile.name || '',
      size: Number(importFile.size) || 0,
      lastModified: Number(importFile.lastModified) || null,
    };
  }

  if (importFile) {
    return { name: String(importFile), size: 0, lastModified: null };
  }

  return null;
};

export const adaptBankMovementDoc = (raw, source = 'bankMovement') => {
  // VAT fields — backward compat: if taxRate missing, assume 19%
  const taxRate = raw.taxRate ?? 0.19;
  const grossAmount = clampMoney(raw.amount);
  const netAmount = raw.netAmount ?? (taxRate > 0 ? grossAmount / (1 + taxRate) : grossAmount);
  const taxAmount = raw.taxAmount ?? (grossAmount - netAmount);
  const importFile = normalizeImportFile(raw.importFile);

  return {
    id: raw.id,
    source,
    kind: raw.kind || MOVEMENT_KIND.ADJUSTMENT,
    status: raw.status || MOVEMENT_STATUS.POSTED,
    accountId: getAccountId(raw.accountId),
    currency: getCurrency(raw.currency),
    direction: raw.direction === 'out' ? 'out' : 'in',
    amount: grossAmount,
    postedDate: toISODate(raw.postedDate || raw.valueDate || raw.date) || toISODate(new Date()),
    valueDate: toISODate(raw.valueDate || raw.postedDate || raw.date) || toISODate(new Date()),
    description: raw.description || '',
    counterpartyName: raw.counterpartyName || raw.client || raw.vendor || '',
    documentNumber: raw.documentNumber || raw.invoiceNumber || '',
    projectId: raw.projectId || '',
    projectName: raw.projectName || raw.project || 'Sin proyecto',
    costCenterId: raw.costCenterId || raw.costCenter || '',
    receivableId: raw.receivableId || null,
    receivableIds: Array.isArray(raw.receivableIds) ? raw.receivableIds : [],
    receivableAllocations: Array.isArray(raw.receivableAllocations) ? raw.receivableAllocations : [],
    payableId: raw.payableId || null,
    payableIds: Array.isArray(raw.payableIds) ? raw.payableIds : [],
    payableAllocations: Array.isArray(raw.payableAllocations) ? raw.payableAllocations : [],
    linkedTransactionId: raw.linkedTransactionId || null,
    legacyTransactionId: raw.legacyTransactionId || null,
    reconciledAt: raw.reconciledAt || null,
    reconciliationId: raw.reconciliationId || null,
    reconciliationMode: raw.reconciliationMode || '',
    reconciledAmount: Number.isFinite(Number(raw.reconciledAmount)) ? clampMoney(raw.reconciledAmount) : 0,
    manualReconciliation: Boolean(raw.manualReconciliation),
    manualReason: raw.manualReason || '',
    importSource: raw.importSource || null,
    importRunId: raw.importRunId || '',
    importFile,
    importLineNumber: raw.importLineNumber || null,
    rowHash: raw.rowHash || '',
    rowFingerprint: raw.rowFingerprint || '',
    signedAmount: Number.isFinite(Number(raw.signedAmount))
      ? clampMoney(raw.signedAmount)
      : (raw.direction === 'out' ? -grossAmount : grossAmount),
    counterpartyIban: raw.counterpartyIban || '',
    counterpartyBic: raw.counterpartyBic || '',
    rawDatev: raw.rawDatev || null,
    createdBy: raw.createdBy || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || '',
    // VAT fields — German Umsatzsteuer
    taxRate,
    netAmount,
    taxAmount,
    categoryName: raw.categoryName || raw.category || '',
    raw,
  };
};

