import { getOpenAmount as getFinanceOpenAmount, toISODate } from '../../../finance/utils';
import { computeCashToday } from './runway';

const CLOSED_STATUSES = new Set([
  'settled',
  'paid',
  'pagado',
  'closed',
  'cerrado',
  'cancelled',
  'void',
]);

const UNCATEGORIZED = new Set([
  '',
  'sin categoria',
  'sin categoría',
  'uncategorized',
  'unknown',
  'n/a',
]);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const normalized = value
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatIsoDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return formatIsoDate(value.toDate());
  return toISODate(value);
};

export const isClosedFinanceStatus = (status) =>
  CLOSED_STATUSES.has(String(status || '').trim().toLowerCase());

const getGrossAmount = (record) =>
  roundMoney(toNumber(record?.grossAmount ?? record?.amount ?? 0));

export const getOpenAmount = (record) => {
  if (!record) return 0;
  if (record.openAmount != null) return roundMoney(toNumber(record.openAmount));
  if (record.pendingAmount != null) return roundMoney(toNumber(record.pendingAmount));
  if (record.amount != null && record.paidAmount != null) {
    return roundMoney(Math.max(0, toNumber(record.amount) - toNumber(record.paidAmount)));
  }
  if (isClosedFinanceStatus(record.status)) return 0;
  return roundMoney(getFinanceOpenAmount(record));
};

export const isOverdue = (record, asOfDate) => {
  if (!record || isClosedFinanceStatus(record.status)) return false;
  if (getOpenAmount(record) <= 0) return false;
  const dueDate = formatIsoDate(record.dueDate || record.date);
  const today = formatIsoDate(asOfDate || new Date());
  return Boolean(dueDate && today && dueDate < today);
};

const buildStatusCounts = (records) =>
  (records || []).reduce((acc, record) => {
    const status = String(record?.status || 'unknown').trim().toLowerCase() || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

const normalizeFinanceRecord = (record, asOfDate) => {
  const openAmount = getOpenAmount(record);
  const grossAmount = getGrossAmount(record);
  const dueDate = formatIsoDate(record?.dueDate || record?.date);
  const overdue = isOverdue(record, asOfDate);

  return {
    id: record?.id || record?.documentNumber || record?.invoiceNumber || `${record?.counterpartyName || 'row'}-${dueDate || 'no-date'}`,
    counterpartyName:
      record?.counterpartyName ||
      record?.client ||
      record?.vendor ||
      record?.description ||
      'Sin contraparte',
    description: record?.description || record?.concept || record?.category || '',
    documentNumber: record?.documentNumber || record?.invoiceNumber || record?.reference || '',
    projectId: record?.projectId || '',
    projectName: record?.projectName || record?.project || '',
    dueDate,
    status: record?.status || 'issued',
    grossAmount,
    openAmount,
    overdue,
    raw: record,
  };
};

const sortOpenByUrgency = (left, right) => {
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  const leftDue = left.dueDate || '9999-12-31';
  const rightDue = right.dueDate || '9999-12-31';
  const dueCompare = leftDue.localeCompare(rightDue);
  if (dueCompare !== 0) return dueCompare;
  return right.openAmount - left.openAmount;
};

const summarizeDocuments = (records, asOfDate, topKey) => {
  const rows = (records || []).map((record) => normalizeFinanceRecord(record, asOfDate));
  const openRows = rows.filter((row) => row.openAmount > 0 && !isClosedFinanceStatus(row.status));
  const overdueRows = openRows.filter((row) => row.overdue);

  return {
    count: rows.length,
    grossTotal: roundMoney(rows.reduce((sum, row) => sum + row.grossAmount, 0)),
    openTotal: roundMoney(openRows.reduce((sum, row) => sum + row.openAmount, 0)),
    overdueTotal: roundMoney(overdueRows.reduce((sum, row) => sum + row.openAmount, 0)),
    overdueCount: overdueRows.length,
    byStatus: buildStatusCounts(records),
    [topKey]: [...openRows].sort(sortOpenByUrgency).slice(0, 10),
  };
};

export const summarizeReceivables = (receivables, asOfDate) =>
  summarizeDocuments(receivables, asOfDate, 'topOpen');

export const summarizePayables = (payables, asOfDate) =>
  summarizeDocuments(payables, asOfDate, 'topUrgent');

const addDaysIso = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isUsableMovement = (movement) =>
  String(movement?.status || 'posted').trim().toLowerCase() !== 'void';

const getMovementDate = (movement) =>
  formatIsoDate(movement?.postedDate || movement?.valueDate || movement?.date);

const getMovementSignedAmount = (movement) => {
  const amount = Math.abs(toNumber(movement?.amount));
  if (movement?.direction === 'out') return -amount;
  return amount;
};

const summarizeMovementWindow = (bankMovements, days, asOfDate) => {
  const today = formatIsoDate(asOfDate || new Date());
  const fromExclusive = addDaysIso(today, -days);
  let totalIn = 0;
  let totalOut = 0;

  for (const movement of bankMovements || []) {
    if (!isUsableMovement(movement)) continue;
    const date = getMovementDate(movement);
    if (!date || date <= fromExclusive || date > today) continue;
    const amount = Math.abs(toNumber(movement.amount));
    if (movement.direction === 'out') totalOut += amount;
    else totalIn += amount;
  }

  return {
    totalIn: roundMoney(totalIn),
    totalOut: roundMoney(totalOut),
    net: roundMoney(totalIn - totalOut),
  };
};

export const summarizeBankMovements = (bankMovements, asOfDate) => {
  const today = formatIsoDate(asOfDate || new Date());
  const window30 = summarizeMovementWindow(bankMovements, 30, today);
  const window90 = summarizeMovementWindow(bankMovements, 90, today);
  const monthly = {};

  for (const movement of bankMovements || []) {
    if (!isUsableMovement(movement)) continue;
    const date = getMovementDate(movement);
    if (!date || date > today) continue;
    const key = date.slice(0, 7);
    monthly[key] = roundMoney((monthly[key] || 0) + getMovementSignedAmount(movement));
  }

  return {
    count: (bankMovements || []).length,
    totalIn30: window30.totalIn,
    totalOut30: window30.totalOut,
    net30: window30.net,
    totalIn90: window90.totalIn,
    totalOut90: window90.totalOut,
    net90: window90.net,
    monthlyNet: Object.fromEntries(
      Object.entries(monthly).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
};

const normalizeRef = (value) => String(value || '').trim().toLowerCase();

const hasUsefulCategory = (movement) => {
  const value = normalizeRef(
    movement?.categoryId ||
      movement?.categoryName ||
      movement?.category ||
      movement?.classification,
  );
  return !UNCATEGORIZED.has(value);
};

const buildProjectRefs = (projects) => {
  const ids = new Set();
  const names = new Set();
  for (const project of projects || []) {
    if (project?.id) ids.add(normalizeRef(project.id));
    if (project?.name) names.add(normalizeRef(project.name));
    if (project?.projectName) names.add(normalizeRef(project.projectName));
    if (project?.code) names.add(normalizeRef(project.code));
  }
  return { ids, names };
};

const hasUnknownProject = (record, projectRefs) => {
  const projectId = normalizeRef(record?.projectId);
  const projectName = normalizeRef(record?.projectName || record?.project);
  if (projectId && !projectRefs.ids.has(projectId)) return true;
  if (!projectId && projectName && projectName !== 'sin proyecto' && !projectRefs.names.has(projectName)) {
    return true;
  }
  return false;
};

// Same fingerprints as scripts/diagnose-data.cjs — keep in sync. Duplicated
// bank movements double-count cash/burn/runway, so this is the single most
// financially dangerous data-health invariant; it must be visible in-app, not
// only in the offline script.
const countDuplicates = (rows, fingerprint) => {
  const counts = new Map();
  for (const row of rows) {
    const fp = fingerprint(row);
    counts.set(fp, (counts.get(fp) || 0) + 1);
  }
  let groups = 0;
  let redundant = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      groups += 1;
      redundant += count - 1;
    }
  }
  return { groups, redundant };
};

// The purpose/reference is part of the fingerprint on purpose: date+amount+
// counterparty alone flags real distinct payments (e.g. office rent €50 AND a
// loan installment €50 to the same person on the same day — verified against
// production 2026-07: all 31 coarse-fingerprint groups were legitimate pairs).
// A true re-import carries the identical bank purpose string.
const movementFingerprint = (m) =>
  [m.postedDate || m.date, m.amount ?? m.signedAmount, m.direction,
    (m.counterpartyName || '').trim().toLowerCase(),
    (m.purpose || m.description || '').trim().toLowerCase().slice(0, 60)].join('|');

// With an invoice number, vendor+invoice+amount is a true duplicate. Without
// one, installment series (same vendor, same amount, monthly) are normal —
// require same description AND same issueDate before calling it a duplicate.
const documentFingerprint = (d) => {
  const vendor = (d.vendor || d.client || d.counterpartyName || '').trim().toLowerCase();
  const amount = d.amount ?? d.total ?? '';
  const invoice = d.invoiceNumber || d.invoice || '';
  if (invoice) return `${vendor}|inv:${invoice}|${amount}`;
  return `${vendor}|desc:${(d.description || '').trim().toLowerCase()}|${d.issueDate || ''}|${amount}`;
};

export const summarizeDataQuality = (snapshot = {}) => {
  const warnings = [];
  const bankMovements = snapshot.bankMovements || [];
  const financeRows = [
    ...(snapshot.receivables || []),
    ...(snapshot.payables || []),
    ...bankMovements,
  ];
  const projectRefs = buildProjectRefs(snapshot.projects || []);
  const uncategorizedBankMovements = bankMovements.filter((movement) => !hasUsefulCategory(movement));
  const unknownProjectRefs = financeRows.filter((record) => hasUnknownProject(record, projectRefs));
  const budgets = snapshot.budgets || [];

  if ((snapshot.transactions || []).length === 0) {
    warnings.push({
      id: 'transactions-empty',
      variant: 'warn',
      title: 'transactions vacía',
      message: 'La colección legacy no tiene registros. Confirmar que el modelo canónico cubre todo.',
    });
  }

  if ((snapshot.recurringCosts || []).length === 0) {
    warnings.push({
      id: 'recurring-costs-empty',
      variant: 'warn',
      title: 'Costes recurrentes vacíos',
      message: 'El forecast y la vista CFO pierden gastos fijos si recurringCosts no está poblado.',
    });
  }

  if (uncategorizedBankMovements.length > 0) {
    warnings.push({
      id: 'bank-movements-uncategorized',
      variant: 'info',
      title: 'Movimientos sin categoría útil',
      message: `${uncategorizedBankMovements.length} movimientos bancarios necesitan clasificación.`,
    });
  }

  if (unknownProjectRefs.length > 0) {
    warnings.push({
      id: 'unknown-project-refs',
      variant: 'warn',
      title: 'Referencias de proyecto no canónicas',
      message: `${unknownProjectRefs.length} registros apuntan a proyectos no encontrados.`,
    });
  }

  if (budgets.length === 0 || budgets.length < Math.max(1, (snapshot.projects || []).length)) {
    warnings.push({
      id: 'budgets-insufficient',
      variant: 'info',
      title: 'Presupuestos insuficientes',
      message: `${budgets.length} presupuestos para ${(snapshot.projects || []).length} proyectos.`,
    });
  }

  const duplicateMovements = countDuplicates(bankMovements, movementFingerprint);
  if (duplicateMovements.redundant > 0) {
    warnings.push({
      id: 'bank-movements-duplicated',
      variant: 'warn',
      title: 'Movimientos bancarios posiblemente duplicados',
      message:
        `${duplicateMovements.redundant} movimientos comparten fecha, importe, dirección y contraparte con otro ` +
        `(${duplicateMovements.groups} grupos). Duplicados inflan caja, burn y runway — revisar con scripts/diagnose-data.cjs.`,
    });
  }

  const duplicateReceivables = countDuplicates(snapshot.receivables || [], documentFingerprint);
  const duplicatePayables = countDuplicates(snapshot.payables || [], documentFingerprint);
  if (duplicateReceivables.redundant + duplicatePayables.redundant > 0) {
    warnings.push({
      id: 'documents-duplicated',
      variant: 'warn',
      title: 'CXC/CXP posiblemente duplicadas',
      message:
        `${duplicateReceivables.redundant} CXC y ${duplicatePayables.redundant} CXP repiten proveedor, factura e importe. ` +
        'Duplicados distorsionan los pendientes de cobro/pago.',
    });
  }

  return {
    warnings,
    stats: {
      transactions: (snapshot.transactions || []).length,
      recurringCosts: (snapshot.recurringCosts || []).length,
      uncategorizedBankMovements: uncategorizedBankMovements.length,
      unknownProjectRefs: unknownProjectRefs.length,
      budgets: budgets.length,
      projects: (snapshot.projects || []).length,
      duplicateBankMovements: duplicateMovements.redundant,
      duplicateReceivables: duplicateReceivables.redundant,
      duplicatePayables: duplicatePayables.redundant,
    },
  };
};

export const summarizeCFOOrder = (snapshot = {}, options = {}) => {
  const asOfDate = formatIsoDate(options.asOfDate || new Date());
  const cash = computeCashToday(
    {
      bankAccount: snapshot.bankAccount,
      bankMovements: snapshot.bankMovements,
    },
    asOfDate,
  );

  return {
    asOfDate,
    cash: {
      bankName: snapshot.bankAccount?.bankName || '',
      startingBalance: cash.startingBalance,
      balanceDate: cash.balanceDate,
      netSinceBalanceDate: cash.netSinceBalanceDate,
      cashToday: cash.cashToday,
      creditLineLimit: roundMoney(toNumber(snapshot.bankAccount?.creditLineLimit)),
    },
    receivables: summarizeReceivables(snapshot.receivables || [], asOfDate),
    payables: summarizePayables(snapshot.payables || [], asOfDate),
    bankMovements: summarizeBankMovements(snapshot.bankMovements || [], asOfDate),
    dataQuality: summarizeDataQuality(snapshot),
  };
};
