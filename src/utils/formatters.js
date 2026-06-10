export const formatCurrency = (amount) => {
  return `${Number(amount).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const formatDateTime = (value) => {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getDaysOverdue = (dateString) => {
  const [y, m, d] = dateString.split('-').map(Number);
  const transactionDate = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((todayUTC - transactionDate) / (1000 * 60 * 60 * 24));
};

/** Safe stringifier for display — avoids [object Object] */
export const safe = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Tolerance for financial floating-point comparisons (1 cent) */
export const MONEY_TOLERANCE = 0.01;

/** Format a tax rate as a percentage string */
export const formatTaxRate = (rate) => {
  if (rate == null) return '19%';
  const pct = Number(rate) * 100;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
};

/** Round a monetary value to 2 decimal places (banker-safe, avoids 119/1.19 = 99.999…). */
const roundMoney = (v) => Math.round(v * 100) / 100;

/**
 * Compute net amount from gross and tax rate, rounded to 2 decimal places.
 * For backward compat: if taxRate is missing/null, assumes 19% (standard German VAT).
 * Example: computeNetFromGross(119, 0.19) === 100 (not 99.99999…)
 */
export const computeNetFromGross = (grossAmount, taxRate) => {
  const rate = taxRate ?? 0.19;
  if (rate === 0) return grossAmount;
  return roundMoney(grossAmount / (1 + rate));
};

/**
 * Compute VAT amount from gross and tax rate, rounded to 2 decimal places.
 * For backward compat: if taxRate is missing/null, assumes 19%.
 * Example: computeTaxFromGross(119, 0.19) === 19
 */
export const computeTaxFromGross = (grossAmount, taxRate) => {
  const rate = taxRate ?? 0.19;
  const net = computeNetFromGross(grossAmount, rate);
  return roundMoney(grossAmount - net);
};
