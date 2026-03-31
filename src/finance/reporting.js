import { clampMoney, compareIsoDate, toISODate } from './utils';

export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const SHORT_MONTH_NAMES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

const buildMonthRange = (year, monthIndex) => {
  const from = new Date(year, monthIndex, 1);
  const to = new Date(year, monthIndex + 1, 0);
  return { from: toISODate(from), to: toISODate(to) };
};

const buildQuarterRange = (year, quarterIndex) => {
  const startMonth = quarterIndex * 3;
  const from = new Date(year, startMonth, 1);
  const to = new Date(year, startMonth + 3, 0);
  return { from: toISODate(from), to: toISODate(to), quarter: quarterIndex + 1 };
};

export const resolvePeriodRange = (selectedPeriod, referenceDate = new Date(), offset = 0) => {
  const periodType = selectedPeriod.startsWith('month:') ? 'month' : selectedPeriod;
  const now = new Date(referenceDate);

  if (periodType === 'all') {
    return { periodType, from: null, to: null, label: 'Todo el período' };
  }

  if (periodType === 'month') {
    const key = selectedPeriod.slice(6);
    const [yearRaw, monthRaw] = key.split('-').map(Number);
    const anchor = new Date(yearRaw, (monthRaw || 1) - 1 - offset, 1);
    const range = buildMonthRange(anchor.getFullYear(), anchor.getMonth());
    return {
      periodType,
      from: range.from,
      to: range.to,
      label: `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`,
      key: `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`,
    };
  }

  if (periodType === 'quarter') {
    const quarterIndex = Math.floor(now.getMonth() / 3) - offset;
    const year = now.getFullYear() + Math.floor(quarterIndex / 4);
    const normalizedQuarter = ((quarterIndex % 4) + 4) % 4;
    const range = buildQuarterRange(year, normalizedQuarter);
    return {
      periodType,
      from: range.from,
      to: range.to,
      label: `Q${range.quarter} ${year}`,
    };
  }

  if (periodType === 'year') {
    const year = now.getFullYear() - offset;
    return {
      periodType,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `Año ${year}`,
    };
  }

  return { periodType: 'all', from: null, to: null, label: 'Todo el período' };
};

export const filterRowsByRange = (rows, getDate, range) => {
  return rows.filter((row) => {
    const iso = toISODate(getDate(row));
    if (!iso) return false;
    if (range.from && compareIsoDate(iso, range.from) < 0) return false;
    if (range.to && compareIsoDate(iso, range.to) > 0) return false;
    return true;
  });
};

export const summarizeMovements = (movements, { useNet = false } = {}) => {
  const getAmount = (entry) =>
    useNet && entry.netAmount != null ? entry.netAmount : entry.amount;

  const inflows = clampMoney(
    movements.filter((entry) => entry.direction === 'in').reduce((sum, entry) => sum + getAmount(entry), 0),
  );
  const outflows = clampMoney(
    movements.filter((entry) => entry.direction === 'out').reduce((sum, entry) => sum + getAmount(entry), 0),
  );

  return {
    inflows,
    outflows,
    net: clampMoney(inflows - outflows),
  };
};

/** Summarize VAT amounts from a set of movements or documents.
 *  For income: outputVAT = sum of taxAmount (Umsatzsteuer owed to Finanzamt)
 *  For expenses: inputVAT = sum of taxAmount (Vorsteuer reclaimable from Finanzamt)
 */
export const summarizeVAT = (rows) => {
  let outputVAT = 0; // Umsatzsteuer from income
  let inputVAT = 0;  // Vorsteuer from expenses

  rows.forEach((row) => {
    const taxAmount = clampMoney(row.taxAmount ?? 0);
    if (taxAmount <= 0) return;
    if (row.direction === 'in' || row.kind === 'receivable') {
      outputVAT = clampMoney(outputVAT + taxAmount);
    } else if (row.direction === 'out' || row.kind === 'payable') {
      inputVAT = clampMoney(inputVAT + taxAmount);
    }
  });

  return {
    outputVAT,   // Umsatzsteuer (output VAT) — you collected this
    inputVAT,    // Vorsteuer (input VAT) — you paid this
    netVAT: clampMoney(outputVAT - inputVAT), // positive = you owe Finanzamt, negative = they owe you
  };
};

export const getMovementCategory = (movement) => {
  return (
    movement.raw?.category ||
    movement.raw?.costCenter ||
    movement.costCenterId ||
    movement.projectName ||
    movement.counterpartyName ||
    movement.description ||
    (movement.direction === 'in' ? 'Cobros operativos' : 'Pagos operativos')
  );
};

export const toPdfTransaction = (entry) => ({
  id: entry.id,
  date: entry.date || entry.postedDate || entry.issueDate || entry.dueDate,
  description: entry.description || entry.counterpartyName || 'Movimiento',
  project: entry.projectName || 'Sin proyecto',
  category: entry.category || entry.kind || entry.source || '',
  amount: clampMoney(entry.amount),
  type: entry.type,
  status: entry.status || 'paid',
});
