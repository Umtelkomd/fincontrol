import { MOVEMENT_KIND, MOVEMENT_STATUS } from './constants';
import { isCostScope } from './costScope';
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
  // VAT: an unknown rate is not 19%. See adaptBankMovementDoc for the full
  // reasoning — inventing a rate silently understates every consumer of
  // netAmount, and plenty of what this company pays carries no VAT at all.
  const taxRate = Number.isFinite(Number(raw.taxRate)) ? Number(raw.taxRate) : 0;
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
    projectCode: raw.projectCode || '',
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
    // S2 — Lumen integration / idempotency
    sourceKey: raw.sourceKey || '',
    sourceSystem: raw.sourceSystem || (String(raw.sourceKey || '').startsWith('insyte:') ? 'insyte' : raw.sourceKey ? 'lumen' : ''),
    lumenWorkOrderId: raw.lumenWorkOrderId || '',
    lumenOrderNumber: raw.lumenOrderNumber || '',
    lumenCycleId: raw.lumenCycleId || '',
    // F1 ops production gate (primarily payables; harmless on receivables)
    opsCleared: Boolean(raw.opsCleared),
    opsClearedAt: raw.opsClearedAt || null,
    opsClearedBy: raw.opsClearedBy || '',
    opsGateRequired: raw.opsGateRequired,
    productionWeekRef: raw.productionWeekRef || '',
    employeeIds: Array.isArray(raw.employeeIds) ? raw.employeeIds : [],
    numeroPresupuesto: raw.numeroPresupuesto || '',
    numeroPedido: raw.numeroPedido || '',
    fechaPresupuesto: raw.fechaPresupuesto || '',
    fechaPedido: raw.fechaPedido || '',
    referenciaObra: raw.referenciaObra || '',
    kw: raw.kw || raw.productionWeekRef || '',
    tipoObra: raw.tipoObra || '',
    obraPueblo: raw.obraPueblo || '',
    pep: raw.pep || '',
    estadoInsyte: raw.estadoInsyte || '',
    importePedido: raw.importePedido ?? null,
    importePresupuesto: raw.importePresupuesto ?? null,
    rechnungId: raw.rechnungId || '',
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
  // VAT: an unknown rate means "not known", never 19%.
  //
  // The Sparkasse account statement this app imports has no VAT column, so no
  // imported movement carries a rate. Defaulting to 19% therefore applied it to
  // the entire ledger — including taxes, social insurance, bank interest and
  // salaries, none of which carry German VAT — and BudgetVsActual and Nóminas
  // both read netAmount, so their figures came out 16% below what actually left
  // the bank. Rate 0 keeps net equal to gross until a real rate is known,
  // whether from the linked invoice or from the category's default.
  const taxRate = Number.isFinite(Number(raw.taxRate)) ? Number(raw.taxRate) : 0;
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
    // Cost destination: 'project' (obra) or 'overhead' (estructura). Anything
    // else is dropped so a malformed doc cannot be read back as a real scope.
    costScope: isCostScope(raw.costScope) ? raw.costScope : '',
    raw,
  };
};

