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

/**
 * Where the forecast's collection slip came from, in words.
 *
 * The slip decides WHEN every open invoice becomes cash, so it is the single
 * biggest lever in the projection. A screen that prints the number without its
 * basis invites the reader to trust a measurement that may just be the
 * fallback constant — which is how people end up planning against a forecast
 * they should have questioned. Every screen showing the slip renders this too.
 *
 * @param {{ sampleSize?: number, confidence?: string }|null|undefined} slip
 *   `forecast.collectionSlip` from `buildCashForecast`.
 * @returns {string} empty when there is no metadata to state
 */
export const formatCollectionSlipBasis = (slip) => {
  const sampleSize = Number(slip?.sampleSize) || 0;
  switch (slip?.confidence) {
    case 'measured':
      return `medido sobre ${sampleSize} ${sampleSize === 1 ? 'factura cobrada' : 'facturas cobradas'}`;
    case 'default':
      return sampleSize === 0
        ? 'supuesto por defecto — todavía no hay facturas cobradas'
        : `supuesto por defecto — solo ${sampleSize} ${sampleSize === 1 ? 'factura cobrada' : 'facturas cobradas'}, histórico insuficiente`;
    case 'override':
      return 'valor forzado manualmente, no medido';
    default:
      return '';
  }
};

/**
 * The full one-line statement of the forecast's collection assumption.
 *
 * @param {{ slipDays?: number, sampleSize?: number, confidence?: string }|null|undefined} slip
 * @returns {string}
 */
export const formatCollectionSlip = (slip) => {
  if (!slip || !Number.isFinite(Number(slip.slipDays))) return '';
  const days = Number(slip.slipDays);
  const timing =
    days === 0
      ? 'Cobro estimado el día del vencimiento'
      : `Cobro estimado a ${days} ${days === 1 ? 'día' : 'días'} del vencimiento`;
  const basis = formatCollectionSlipBasis(slip);
  return basis ? `${timing} (${basis})` : timing;
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
