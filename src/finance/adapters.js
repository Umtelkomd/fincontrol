import { balances2025 } from '../data/balances2025';
import {
  DEFAULT_CURRENCY,
  DOCUMENT_STATUS,
  MAIN_ACCOUNT_ID,
  MOVEMENT_KIND,
  MOVEMENT_STATUS,
} from './constants';
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
    raw,
  };
};

export const adaptReceivableDoc = (raw, source = 'receivable') => normalizeDocument(raw, 'receivable', source);

export const adaptPayableDoc = (raw, source = 'payable') => normalizeDocument(raw, 'payable', source);

export const adaptBankMovementDoc = (raw, source = 'bankMovement') => {
  // VAT fields — backward compat: if taxRate missing, assume 19%
  const taxRate = raw.taxRate ?? 0.19;
  const grossAmount = clampMoney(raw.amount);
  const netAmount = raw.netAmount ?? (taxRate > 0 ? grossAmount / (1 + taxRate) : grossAmount);
  const taxAmount = raw.taxAmount ?? (grossAmount - netAmount);

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
    payableId: raw.payableId || null,
    linkedTransactionId: raw.linkedTransactionId || null,
    legacyTransactionId: raw.legacyTransactionId || null,
    reconciledAt: raw.reconciledAt || null,
    reconciliationId: raw.reconciliationId || null,
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

export const adaptLegacyTransactionToMovement = (transaction) => {
  const settledAmount = (() => {
    const status = String(transaction?.status || '').toLowerCase();
    if (status === 'paid' || status === 'completed') return getGrossAmount(transaction);
    if (status === 'partial') return getPaidAmount(transaction);
    return 0;
  })();

  if (settledAmount <= 0) return null;

  // For VAT tracking: backward compat assumes 19% if taxRate not stored
  const grossAmount = settledAmount;
  const taxRate = transaction.taxRate ?? 0.19;
  const netAmount = taxRate > 0 ? grossAmount / (1 + taxRate) : grossAmount;
  const taxAmount = grossAmount - netAmount;

  return adaptBankMovementDoc(
    {
      id: `legacy-movement-${transaction.id}`,
      kind: transaction.type === 'income' ? MOVEMENT_KIND.LEGACY_COLLECTION : MOVEMENT_KIND.LEGACY_PAYMENT,
      status: MOVEMENT_STATUS.POSTED,
      accountId: MAIN_ACCOUNT_ID,
      currency: DEFAULT_CURRENCY,
      direction: transaction.type === 'income' ? 'in' : 'out',
      amount: grossAmount,
      postedDate: transaction.paidDate || transaction.date,
      valueDate: transaction.paidDate || transaction.date,
      description: transaction.description || '',
      counterpartyName: transaction.counterparty || transaction.description || '',
      documentNumber: transaction.invoiceNumber || '',
      projectName: transaction.project || 'Sin proyecto',
      costCenterId: transaction.costCenter || '',
      legacyTransactionId: transaction.id,
      linkedTransactionId: transaction.id,
      createdBy: transaction.createdBy || 'legacy',
      createdAt: transaction.createdAt || transaction.date,
      updatedAt: transaction.lastModifiedAt || transaction.createdAt || transaction.date,
      // VAT fields — German Umsatzsteuer (Vorsteuer for expenses, Umsatzsteuer for income)
      taxRate,
      netAmount,
      taxAmount,
      categoryName: transaction.category || transaction.categoryName || '',
      category: transaction.category || '',
    },
    'legacy-transaction',
  );
};

export const adaptLegacyTransactionToReceivable = (transaction) => {
  if (transaction.type !== 'income') return null;
  const openAmount = getOpenAmount(transaction);
  if (openAmount <= 0) return null;

  return adaptReceivableDoc(
    {
      ...transaction,
      id: `legacy-receivable-${transaction.id}`,
      grossAmount: getGrossAmount(transaction),
      openAmount,
      paidAmount: getPaidAmount(transaction),
      issueDate: transaction.date,
      dueDate: transaction.dueDate || transaction.date,
      counterpartyName: transaction.counterparty || transaction.description,
      projectName: transaction.project || 'Sin proyecto',
      legacyTransactionId: transaction.id,
      linkedTransactionId: transaction.id,
    },
    'legacy-transaction',
  );
};

export const adaptLegacyTransactionToPayable = (transaction) => {
  if (transaction.type !== 'expense') return null;
  const openAmount = getOpenAmount(transaction);
  if (openAmount <= 0) return null;

  return adaptPayableDoc(
    {
      ...transaction,
      id: `legacy-payable-${transaction.id}`,
      grossAmount: getGrossAmount(transaction),
      openAmount,
      paidAmount: getPaidAmount(transaction),
      issueDate: transaction.date,
      dueDate: transaction.dueDate || transaction.date,
      counterpartyName: transaction.counterparty || transaction.description,
      projectName: transaction.project || 'Sin proyecto',
      legacyTransactionId: transaction.id,
      linkedTransactionId: transaction.id,
    },
    'legacy-transaction',
  );
};

export const createLegacyOpeningReceivables = () => {
  return balances2025.cxcPendiente.map((item, index) =>
    adaptReceivableDoc(
      {
        id: `legacy-opening-cxc-${index + 1}`,
        status: DOCUMENT_STATUS.OVERDUE,
        accountId: MAIN_ACCOUNT_ID,
        currency: DEFAULT_CURRENCY,
        grossAmount: item.saldo,
        openAmount: item.saldo,
        issueDate: '2025-12-31',
        dueDate: item.vencimiento,
        client: item.cliente,
        description: item.concepto,
        project: 'Saldo inicial 2025',
        documentNumber: `SALDO-2025-CXC-${index + 1}`,
        legacyTransactionId: `opening-cxc-${index + 1}`,
        createdBy: 'legacy',
        createdAt: '2025-12-31',
      },
      'legacy-opening',
    ),
  );
};

export const createLegacyOpeningPayables = () => {
  return balances2025.cxpPendiente.map((item, index) =>
    adaptPayableDoc(
      {
        id: `legacy-opening-cxp-${index + 1}`,
        status: DOCUMENT_STATUS.OVERDUE,
        accountId: MAIN_ACCOUNT_ID,
        currency: DEFAULT_CURRENCY,
        grossAmount: item.saldo,
        openAmount: item.saldo,
        issueDate: '2025-12-31',
        dueDate: item.vencimiento,
        vendor: item.proveedor,
        description: item.concepto,
        project: 'Saldo inicial 2025',
        documentNumber: `SALDO-2025-CXP-${index + 1}`,
        legacyTransactionId: `opening-cxp-${index + 1}`,
        createdBy: 'legacy',
        createdAt: '2025-12-31',
      },
      'legacy-opening',
    ),
  );
};
