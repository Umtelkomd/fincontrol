const safeString = (value) => (value == null ? '' : String(value));

const normalizeDocumentStatus = (status) => {
  const normalized = safeString(status).toLowerCase();
  if (normalized === 'issued') return 'pending';
  if (normalized === 'settled') return 'paid';
  return normalized || 'pending';
};

const ORDER_CONFIG = {
  receivable: {
    idPrefix: 'receivable',
    label: 'CXC',
    type: 'income',
    category: 'receivable',
    categoryLabel: 'Factura CXC',
    counterpartyFallback: 'Pendiente de cobro',
    paymentActionLabel: 'Cobro',
    statusLabels: {
      issued: 'Emitida',
      pending: 'Pendiente',
      partial: 'Parcial',
      overdue: 'Vencida',
      settled: 'Liquidada',
      paid: 'Liquidada',
      cancelled: 'Cancelada',
    },
  },
  payable: {
    idPrefix: 'payable',
    label: 'CXP',
    type: 'expense',
    category: 'payable',
    categoryLabel: 'Factura CXP',
    counterpartyFallback: 'Pendiente de pago',
    paymentActionLabel: 'Pago',
    statusLabels: {
      issued: 'Emitida',
      pending: 'Pendiente',
      partial: 'Parcial',
      overdue: 'Vencida',
      settled: 'Liquidada',
      paid: 'Liquidada',
      cancelled: 'Cancelada',
    },
  },
};

export const buildFinanceOrderRecord = (order, family) => {
  const config = ORDER_CONFIG[family];
  if (!order || !config) return null;

  const status = normalizeDocumentStatus(order.status);
  const rawStatus = safeString(order.status).toLowerCase();
  const amount = Number(order.grossAmount ?? order.amount) || 0;
  const paidAmount = Number(order.paidAmount) || 0;
  const isCancelled = rawStatus === 'cancelled' || status === 'cancelled';
  const isSettled = rawStatus === 'settled' || status === 'paid';

  return {
    ...order,
    id: `${config.idPrefix}:${order.id}`,
    entityId: order.id,
    rawRecord: order,
    recordFamily: family,
    recordFamilyLabel: config.label,
    sourceKey: order.legacyTransactionId ? 'migrated' : 'canonical',
    sourceLabel: order.legacyTransactionId ? 'Integrado' : 'Operación actual',
    date: order.issueDate || order.dueDate,
    type: config.type,
    status,
    statusLabel: config.statusLabels[rawStatus] || config.statusLabels[status] || order.status,
    amount,
    paidAmount,
    project: order.projectName || 'Sin proyecto',
    projectId: order.projectId || '',
    category: config.category,
    categoryLabel: config.categoryLabel,
    costCenter: order.costCenterId || '',
    costCenterId: order.costCenterId || '',
    documentNumber: order.documentNumber || '',
    counterpartyName: order.counterpartyName || order.client || order.vendor || '',
    canEdit: !isCancelled,
    canDelete: false,
    canViewNotes: false,
    canRegisterPayment: ['pending', 'partial', 'overdue'].includes(status),
    canVoid: !paidAmount && !isCancelled && !isSettled,
    canChangeStatus: !isCancelled,
    voidActionLabel: 'Cancelar',
    paymentActionLabel: config.paymentActionLabel,
    notes: [],
    secondaryMeta: order.documentNumber || order.counterpartyName || config.counterpartyFallback,
    traceMeta: order.updatedBy || order.createdBy || '',
    lastEditor: order.updatedBy || order.createdBy || '',
    lastEditedAt: order.updatedAt || order.createdAt || null,
    year: (order.issueDate || order.dueDate) ? new Date(order.issueDate || order.dueDate).getFullYear() : null,
  };
};
