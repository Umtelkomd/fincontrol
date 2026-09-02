/**
 * Copy for the three shared liquidity KPIs (Caja / Posición neta / Runway).
 *
 * Pure: no React, no Firebase, no Date.now(). Kept apart from the component so
 * the wording is unit-testable and so a screen that cannot mount the KPI grid
 * (a PDF export, a toast) can still say the same thing.
 */
import { formatDate } from '../../utils/formatters';

/** Below this many months of cover the runway tile turns red. */
export const CRITICAL_RUNWAY_MONTHS = 3;
/**
 * 9 weeks ≈ the 60-day alarm the KPI used before the forecast moved to weekly
 * buckets, so the threshold for "critical" is unchanged in practice.
 */
export const CRITICAL_RUNWAY_WEEKS = 9;

export const UNRECONCILED_CASH_META = 'Sin conciliar — registra un ancla en Configuración → Tesorería';

const formatMonths = (months) =>
  months.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/**
 * The runway rule every screen shares: prefer the committed-outflow wall from
 * the forecast (open payables, payroll, recurring costs and VAT by due week),
 * fall back to the average-burn estimate, and say "Bajo cero" — never a
 * negative number of months — once the cash is gone.
 *
 * @param {{ currentCash?: number, weeksToNegative?: number|null, runwayMonths?: number|null }} input
 * @returns {{ value: string, meta: string, critical: boolean }}
 */
export const describeRunway = ({ currentCash = 0, weeksToNegative = null, runwayMonths = null } = {}) => {
  if (!(Number(currentCash) > 0)) {
    return { value: 'Bajo cero', meta: 'La caja ya está en negativo', critical: true };
  }
  if (weeksToNegative != null) {
    return {
      value: `${weeksToNegative} sem.`,
      meta: 'Hasta caja en 0 (nómina, recurrentes, IVA y vencimientos incluidos)',
      critical: weeksToNegative < CRITICAL_RUNWAY_WEEKS,
    };
  }
  if (runwayMonths == null) {
    return { value: 'Sin gasto', meta: 'No hay salidas para proyectar', critical: false };
  }
  const months = Math.max(0, Number(runwayMonths) || 0);
  return {
    value: `${formatMonths(months)} meses`,
    meta: 'Al ritmo de gasto promedio',
    critical: months < CRITICAL_RUNWAY_MONTHS,
  };
};

/**
 * What the cash figure is anchored to. Anchor-derived cash names the anchor
 * date and the newest movement; anything else is flagged as unreconciled with
 * the action that fixes it.
 *
 * @param {{ cashSource?: string, cashMeta?: { anchor?: { date?: string }|null, lastMovementDate?: string|null } }} input
 */
export const describeCashMeta = ({ cashSource, cashMeta } = {}) => {
  if (cashSource === 'anchors' && cashMeta?.anchor?.date) {
    const lastMovement = cashMeta.lastMovementDate ? formatDate(cashMeta.lastMovementDate) : '—';
    return `Conciliado al ${formatDate(cashMeta.anchor.date)} · últ. mov. ${lastMovement}`;
  }
  return UNRECONCILED_CASH_META;
};
