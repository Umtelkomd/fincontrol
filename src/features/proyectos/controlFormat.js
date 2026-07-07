import { formatCurrency } from '../../utils/formatters';

/**
 * Display formatters for Control de Proyectos. Every metric in the engine is
 * null when it cannot be computed (guarded divisions) — the UI renders those
 * as an em dash instead of a fake zero, so "no data" never reads as "0%".
 */

export const DASH = '—';

export const fmtMoney = (value) => (value == null ? DASH : formatCurrency(value));

// Fraction (0..1 or negative) → 'xx,x %'.
export const fmtPctFraction = (fraction, digits = 1) => {
  if (fraction == null || !Number.isFinite(fraction)) return DASH;
  return `${(fraction * 100).toLocaleString('es-ES', { maximumFractionDigits: digits })} %`;
};

// Percent number (0..100 scale) → 'xx,x %'.
export const fmtPct = (pct, digits = 1) => {
  if (pct == null || !Number.isFinite(pct)) return DASH;
  return `${pct.toLocaleString('es-ES', { maximumFractionDigits: digits })} %`;
};

// Performance index (CPI/SPI) → '1,25'.
export const fmtRatio = (value) => {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
