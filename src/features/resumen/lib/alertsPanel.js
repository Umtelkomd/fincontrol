/**
 * Resumen alerts builder — Spanish-localized, action-routed alerts for the
 * cockpit panel. Pure: inputs are precomputed aging buckets, forecast weeks,
 * cash position metadata and config; output is a sorted array of
 * `{ id, severity, title, detail, href }` ready to render.
 *
 * Severity contract: 'critical' | 'serious' | 'warning' — sorted in that
 * order, stable within a severity (creation order below).
 */

const SEVERITY_RANK = { critical: 0, serious: 1, warning: 2 };

/** Creditors whose overdue payables put the company at regulatory risk. */
const CRITICAL_CREDITOR_RE =
  /finanzamt|krankenkasse|sozialversicherung|sozialkasse|\baok\b|barmer|\btk\b|\bdak\b|knappschaft|minijob|berufsgenossenschaft|zoll/i;

const EUR = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtEur = (value) => `${EUR.format(value ?? 0)} €`;

const fmtDayMonth = (isoDate) => {
  if (typeof isoDate !== 'string' || isoDate.length < 10) return '';
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}`;
};

const daysBetween = (fromIso, toIso) => {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)),
    Number(fromIso.slice(5, 7)) - 1,
    Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)),
    Number(toIso.slice(5, 7)) - 1,
    Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86400000);
};

const monthNameEs = (monthKey) =>
  new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const overdueItems = (aging) =>
  ['d1_30', 'd31_60', 'd61_90', 'd90plus'].flatMap((bucket) => aging?.[bucket]?.items ?? []);

const overdueTotal = (aging) => aging?.totals?.overdue ?? 0;

const ANCHOR_STALE_DAYS = 45;

/**
 * @param {{
 *   position: { balance: number, anchor: { date: string }|null },
 *   forecast: Array<{ weekStart: string, projectedBalance: number }>,
 *   receivablesAging: object,
 *   payablesAging: object,
 *   importGap: { hasGap: boolean, lastMovementDate: string|null, quietBusinessDays: number|null },
 *   missingMonths: string[],
 *   today: string,
 *   config: { bufferEur: number, creditFloorEur?: number },
 * }} params
 * @returns {Array<{ id: string, severity: string, title: string, detail: string, href: string }>}
 */
export const buildResumenAlerts = ({
  position,
  forecast,
  receivablesAging,
  payablesAging,
  importGap,
  missingMonths,
  today,
  config,
}) => {
  const alerts = [];
  const bufferEur = config?.bufferEur ?? 10000;

  // 1. Projected balance under the buffer (or negative) within the horizon.
  const weeks = Array.isArray(forecast) ? forecast : [];
  if (weeks.length > 0) {
    const worst = weeks.reduce((min, week) =>
      week.projectedBalance < min.projectedBalance ? week : min,
    );
    if (worst.projectedBalance < bufferEur) {
      alerts.push({
        id: 'projected-balance-below-buffer',
        severity: worst.projectedBalance < 0 ? 'critical' : 'serious',
        title: 'Caja proyectada bajo el colchón',
        detail: `Mínimo proyectado: ${fmtEur(worst.projectedBalance)} en la semana del ${fmtDayMonth(worst.weekStart)}.`,
        href: '/gastos',
      });
    }
  }

  // 2. Overdue payables to regulatory-critical creditors.
  const criticalOverdue = overdueItems(payablesAging).filter((item) =>
    CRITICAL_CREDITOR_RE.test(item?.doc?.counterpartyName ?? item?.doc?.vendor ?? ''),
  );
  if (criticalOverdue.length > 0) {
    const amount = criticalOverdue.reduce((sum, item) => sum + (item.openAmount ?? 0), 0);
    alerts.push({
      id: 'payables-overdue-critical-creditors',
      severity: 'critical',
      title: 'Pagos vencidos a acreedores críticos',
      detail: `Finanzamt/Sozialversicherung y similares: ${fmtEur(amount)} vencidos.`,
      href: '/gastos',
    });
  }

  // 3. Overdue payables (total).
  const payablesOverdue = overdueTotal(payablesAging);
  if (payablesOverdue > 0.005) {
    alerts.push({
      id: 'payables-overdue',
      severity: 'serious',
      title: 'Cuentas por pagar vencidas',
      detail: `Total vencido: ${fmtEur(payablesOverdue)}.`,
      href: '/gastos',
    });
  }

  // 4. Overdue receivables.
  const receivablesOverdue = overdueTotal(receivablesAging);
  if (receivablesOverdue > 0.005) {
    alerts.push({
      id: 'receivables-overdue',
      severity: 'warning',
      title: 'Cobros vencidos sin gestionar',
      detail: `Facturas vencidas por ${fmtEur(receivablesOverdue)}.`,
      href: '/ingresos',
    });
  }

  // 5. Reconciliation anchor missing or stale.
  if (!position?.anchor) {
    alerts.push({
      id: 'reconciliation-stale',
      severity: 'warning',
      title: 'Caja sin conciliar',
      detail: 'No existe ningún ancla de conciliación.',
      href: '/configuracion',
    });
  } else {
    const anchorAge = daysBetween(position.anchor.date, today);
    if (anchorAge > ANCHOR_STALE_DAYS) {
      alerts.push({
        id: 'reconciliation-stale',
        severity: 'warning',
        title: 'Conciliación desactualizada',
        detail: `Último ancla del ${fmtDayMonth(position.anchor.date)}: hace ${anchorAge} días.`,
        href: '/configuracion',
      });
    }
  }

  // 6. Bank import gap.
  if (importGap?.hasGap) {
    alerts.push({
      id: 'import-gap',
      severity: 'warning',
      title: 'Extracto bancario sin importar',
      detail: `Sin movimientos desde el ${fmtDayMonth(importGap.lastMovementDate ?? '')}: ${importGap.quietBusinessDays} días hábiles.`,
      href: '/datev',
    });
  }

  // 7. Missing payroll months.
  for (const month of missingMonths ?? []) {
    const name = monthNameEs(month);
    alerts.push({
      id: `payroll-month-missing:${month}`,
      severity: 'warning',
      title: `Nómina de ${name} sin importar`,
      detail: `Importa la nómina de ${name} para mantener el forecast y las obligaciones al día.`,
      href: '/nominas',
    });
  }

  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.alert.severity] - SEVERITY_RANK[b.alert.severity] || a.index - b.index,
    )
    .map(({ alert }) => alert);
};

export default buildResumenAlerts;
