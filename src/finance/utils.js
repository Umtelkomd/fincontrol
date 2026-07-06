import {
  DAY_MS,
  DEFAULT_CURRENCY,
  DOCUMENT_STAGE,
  DOCUMENT_STATUS,
  MAIN_ACCOUNT_ID,
  MOVEMENT_STATUS,
} from './constants';

export const clampMoney = (value) => {
  const numeric = Number(value) || 0;
  return Math.round(numeric * 100) / 100;
};

// Format using LOCAL date parts, never toISOString(): startOfDay/addDays build
// local-midnight Dates, and in Europe/Berlin (UTC+1/+2) toISOString() lands on
// the PREVIOUS day (22:00/23:00 UTC), shifting every boundary date back by one.
const formatLocalISO = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const toISODate = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatLocalISO(parsed);
    }
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalISO(value);
  }
  return null;
};

export const startOfDay = (value = new Date()) => {
  const day = toISODate(value) || toISODate(new Date());
  return new Date(`${day}T00:00:00`);
};

export const endOfDay = (value = new Date()) => {
  const date = startOfDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

export const addDays = (value, days) => {
  const date = startOfDay(value);
  date.setDate(date.getDate() + days);
  return date;
};

export const compareIsoDate = (left, right) => {
  const a = toISODate(left) || '';
  const b = toISODate(right) || '';
  return a.localeCompare(b);
};

export const daysUntil = (dateValue, referenceDate = new Date()) => {
  const target = startOfDay(dateValue);
  const ref = startOfDay(referenceDate);
  return Math.ceil((target - ref) / DAY_MS);
};

export const isWithinRange = (dateValue, from, to) => {
  const iso = toISODate(dateValue);
  if (!iso) return false;
  if (from && compareIsoDate(iso, from) < 0) return false;
  if (to && compareIsoDate(iso, to) > 0) return false;
  return true;
};

export const getGrossAmount = (row) => {
  return clampMoney(row?.grossAmount ?? row?.amount ?? 0);
};

export const getPaidAmount = (row) => {
  const grossAmount = getGrossAmount(row);
  if (row?.paidAmount != null) return clampMoney(row.paidAmount);
  if (row?.openAmount != null) return clampMoney(grossAmount - row.openAmount);
  if (row?.pendingAmount != null) return clampMoney(grossAmount - row.pendingAmount);
  return 0;
};

export const getOpenAmount = (row) => {
  const grossAmount = getGrossAmount(row);
  if (row?.openAmount != null) return clampMoney(row.openAmount);
  if (row?.pendingAmount != null) return clampMoney(row.pendingAmount);
  return clampMoney(Math.max(0, grossAmount - getPaidAmount(row)));
};

export const deriveDocumentStage = (status, openAmount) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === DOCUMENT_STAGE.CANCELLED) return DOCUMENT_STAGE.CANCELLED;
  if (normalized === DOCUMENT_STAGE.SETTLED || normalized === 'paid' || normalized === 'completed') {
    return DOCUMENT_STAGE.SETTLED;
  }
  if (openAmount <= 0) return DOCUMENT_STAGE.SETTLED;
  if (normalized === DOCUMENT_STAGE.PARTIAL) return DOCUMENT_STAGE.PARTIAL;
  return DOCUMENT_STAGE.ISSUED;
};

export const deriveDocumentStatus = (stage, dueDate, referenceDate = new Date()) => {
  if (stage === DOCUMENT_STAGE.CANCELLED) return DOCUMENT_STATUS.CANCELLED;
  if (stage === DOCUMENT_STAGE.SETTLED) return DOCUMENT_STATUS.SETTLED;
  if (dueDate && daysUntil(dueDate, referenceDate) < 0) return DOCUMENT_STATUS.OVERDUE;
  return stage === DOCUMENT_STAGE.PARTIAL ? DOCUMENT_STATUS.PARTIAL : DOCUMENT_STATUS.ISSUED;
};

export const isOpenDocument = (row) => {
  return ![DOCUMENT_STATUS.SETTLED, DOCUMENT_STATUS.CANCELLED].includes(row.status);
};

export const isPostedMovement = (row) => row?.status === MOVEMENT_STATUS.POSTED;

export const getSignedMovementAmount = (row) => {
  const amount = clampMoney(row?.amount ?? 0);
  return row?.direction === 'out' ? -amount : amount;
};

export const getCurrency = (value) => value || DEFAULT_CURRENCY;

export const getAccountId = (value) => value || MAIN_ACCOUNT_ID;

export const sumMoney = (rows, selector) => {
  return clampMoney(rows.reduce((total, row) => total + selector(row), 0));
};
