/**
 * Sistema 5 — Reporte gerencial de 1 página (junta de socios).
 *
 * Pure calculation helpers for the monthly one-page management report:
 * 7 KPIs (each with objetivo | alarma thresholds) plus automatically derived
 * top risks. No Firestore access here — hooks feed the adapted ledger rows
 * (postedMovements = DATEV cash truth; receivables/payables = canonical AR/AP).
 *
 * Every helper degrades gracefully: missing/empty data yields status 'n/a'
 * and formatted '—', never NaN.
 */

import { DAY_MS, OPERATIONAL_DATA_START } from './constants';
import {
  addDays,
  clampMoney,
  compareIsoDate,
  daysUntil,
  isOpenDocument,
  sumMoney,
  toISODate,
} from './utils';
import { partnerComplianceStatus, payableRequiresOpsClear } from './opsControl';

/** KPI thresholds from the UMTELKOMD management model (objetivo | alarma). */
export const KPI_THRESHOLDS = {
  projectMargin: { target: 25, alarm: 15 }, // % margin per obra — higher is better
  ebitMonthly: { target: 10, alarm: 5 }, // % of monthly sales — higher is better
  productionInvoiceLag: { target: 7, alarm: 14 }, // days — lower is better
  dso: { target: 45, alarm: 60 }, // days — lower is better
  cashWeeks: { target: 6, alarm: 3 }, // weeks of coverage — higher is better
  clientConcentration: { target: 60 }, // % share of top client — alarm = no 2nd client
  financialCosts: { target: 1, alarm: 2 }, // % of monthly sales — lower is better
};

export const RISK_THRESHOLDS = {
  overdueReceivablesHigh: 15000, // € — overdue CXC above this is high severity
  opsUnclearedHigh: 10000, // € — un-validated CXP above this is high severity
  nearNegativeWeeks: 4, // projection turning negative within N weeks = critical
};

/** Movement text patterns (normalized, accent/ß-insensitive substring match). */
export const VAT_TAX_MOVEMENT_PATTERNS = [
  'umsatzsteuer',
  'mehrwertsteuer',
  'mwst',
  'vorsteuer',
  'koerperschaftsteuer',
  'körperschaftsteuer',
  'gewerbesteuer',
  'finanzamt',
  'finanzkasse',
];

export const FINANCING_MOVEMENT_PATTERNS = [
  'darlehen',
  'tilgung',
  'kredit',
  'zinsen',
  'bankgebühr',
  'bankgebuhr',
  'kontoführung',
  'kontofuhrung',
  'confirming',
  'factoring',
  'comision bancaria',
  'comisión bancaria',
  'bank fee',
];

export const FINANCIAL_COST_PATTERNS = [
  'bankgebühr',
  'bankgebuhr',
  'kontoführung',
  'kontofuhrung',
  'zinsen',
  'confirming',
  'factoring',
  'comision bancaria',
  'comisión bancaria',
  'comisiones bancarias',
  'bank fee',
  'entgeltabschluss',
  'financiero',
];

const INTERNAL_TRANSFER_PATTERNS = ['umbuchung'];

const UNKNOWN_PROJECT_LABELS = new Set(['', 'sin proyecto', 'sin asignar', 'n/a', 'unknown']);

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2 };

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();

const hasAny = (text, patterns) => patterns.some((pattern) => text.includes(normalizeText(pattern)));

const movementText = (movement) =>
  normalizeText(
    [
      movement?.categoryName,
      movement?.category,
      movement?.counterpartyName,
      movement?.vendor,
      movement?.description,
    ]
      .filter(Boolean)
      .join(' '),
  );

// Lohnsteuer (wage tax) IS an operating cost — only VAT / profit taxes are
// excluded from the EBIT approximation.
const isVatOrProfitTax = (text) => !text.includes('lohnsteuer') && hasAny(text, VAT_TAX_MOVEMENT_PATTERNS);

const isFinancialCost = (movement, text) =>
  hasAny(text, FINANCIAL_COST_PATTERNS) ||
  normalizeText(movement?.categoryName || movement?.category || '').includes('financier');

const formatNumber = (value, digits = 1) =>
  Number(value).toLocaleString('de-DE', { maximumFractionDigits: digits });

export const formatPct = (value, digits = 1) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${formatNumber(value, digits)} %`;

export const formatEur = (value) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `€ ${formatNumber(value, 0)}`;

const statusHigherBetter = (value, { target, alarm }) => {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  if (value >= target) return 'ok';
  if (value < alarm) return 'alarm';
  return 'warn';
};

const statusLowerBetter = (value, { target, alarm }) => {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  if (value <= target) return 'ok';
  if (value > alarm) return 'alarm';
  return 'warn';
};

/** Status of a single project margin (for the "margen por obra" table rows). */
export const projectMarginStatus = (marginPct) => statusHigherBetter(marginPct, KPI_THRESHOLDS.projectMargin);

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/** 'YYYY-MM' of the last fully-closed calendar month before referenceDate. */
export const lastClosedMonthKey = (referenceDate = new Date()) => {
  const iso = toISODate(referenceDate) || toISODate(new Date());
  const [year, month] = iso.split('-').map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
};

/** 'YYYY-MM' → 'junio de 2026' (es-ES month label). */
export const formatMonthKeyEs = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return '—';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};

/**
 * Parse an ISO-8601 week reference like '2026-W28'.
 * Returns { year, week, startIso (Monday), endIso (Sunday) } or null.
 */
export function parseIsoWeek(ref) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(ref || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  // ISO 8601: week 1 always contains January 4th.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoDay = jan4.getUTCDay() || 7;
  const mondayW1 = new Date(jan4.getTime() - (isoDay - 1) * DAY_MS);
  const start = new Date(mondayW1.getTime() + (week - 1) * 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return {
    year,
    week,
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// KPI building blocks
// ---------------------------------------------------------------------------

/**
 * Revenue vs cost per obra from posted bank movements (DATEV), grouped by
 * projectName. Movements without a real project are excluded — the report is
 * about margins per obra, not the unassigned bucket.
 */
export function computeProjectMargins(
  movements = [],
  { sinceIso = OPERATIONAL_DATA_START, payrollByProject = {} } = {},
) {
  const byProject = new Map();
  for (const movement of movements || []) {
    if (!movement || movement.status === 'void') continue;
    const posted = toISODate(movement.postedDate || movement.valueDate || movement.date);
    if (!posted) continue;
    if (sinceIso && compareIsoDate(posted, sinceIso) < 0) continue;
    const name = String(movement.projectName || movement.project || '').trim();
    if (UNKNOWN_PROJECT_LABELS.has(name.toLowerCase())) continue;
    const row = byProject.get(name) || { name, revenue: 0, cost: 0 };
    const amount = Math.abs(Number(movement.amount) || 0);
    if (amount === 0) continue;
    if (movement.direction === 'in') row.revenue += amount;
    else row.cost += amount;
    byProject.set(name, row);
  }

  // Fold allocated payroll cost into each project's cost basis so 'Margen por
  // obra' doesn't overstate profitability (mirrors useTreasuryMetrics'
  // buildProjectMargins, which already folds payroll for the Resumen view).
  Object.entries(payrollByProject || {}).forEach(([name, laborCost]) => {
    const cost = Number(laborCost) || 0;
    const row = byProject.get(name);
    if (cost === 0 || !row) return;
    row.cost += cost;
  });

  return [...byProject.values()]
    .map((row) => {
      const revenue = clampMoney(row.revenue);
      const cost = clampMoney(row.cost);
      const net = clampMoney(revenue - cost);
      return {
        name: row.name,
        revenue,
        cost,
        net,
        marginPct: revenue > 0 ? clampMoney((net / revenue) * 100) : null,
      };
    })
    .sort((left, right) => right.revenue - left.revenue);
}

/**
 * DSO — days sales outstanding: open AR / (invoiced sales in trailing window / days).
 */
export function computeDso(receivables = [], { referenceDate = new Date(), windowDays = 90 } = {}) {
  const refIso = toISODate(referenceDate) || toISODate(new Date());
  const fromIso = toISODate(addDays(refIso, -windowDays));
  const rows = (receivables || []).filter((row) => row && row.status !== 'cancelled');
  const openAr = sumMoney(rows.filter(isOpenDocument), (row) => Number(row.openAmount) || 0);
  const windowSales = sumMoney(
    rows.filter((row) => {
      const issueIso = toISODate(row.issueDate);
      return issueIso && compareIsoDate(issueIso, fromIso) >= 0 && compareIsoDate(issueIso, refIso) <= 0;
    }),
    (row) => Math.abs(Number(row.grossAmount ?? row.amount) || 0),
  );
  if (windowSales <= 0) return { dsoDays: null, openAr, windowSales, windowDays };
  return {
    dsoDays: Math.round(openAr / (windowSales / windowDays)),
    openAr,
    windowSales,
    windowDays,
  };
}

/**
 * Producción → factura: average days between the end of the production ISO week
 * (productionWeekRef, e.g. '2026-W28') and the invoice issueDate. Invoices cut
 * during the production week count as 0 lag.
 */
export function computeProductionInvoiceLag(
  receivables = [],
  { referenceDate = new Date(), windowDays = 180 } = {},
) {
  const refIso = toISODate(referenceDate) || toISODate(new Date());
  const fromIso = toISODate(addDays(refIso, -windowDays));
  const lags = [];
  for (const row of receivables || []) {
    if (!row || row.status === 'cancelled') continue;
    const week = parseIsoWeek(row.productionWeekRef);
    const issueIso = toISODate(row.issueDate);
    if (!week || !issueIso) continue;
    if (compareIsoDate(issueIso, fromIso) < 0 || compareIsoDate(issueIso, refIso) > 0) continue;
    lags.push(Math.max(0, daysUntil(issueIso, week.endIso)));
  }
  if (lags.length === 0) return { avgLagDays: null, maxLagDays: null, count: 0 };
  const avg = lags.reduce((sum, value) => sum + value, 0) / lags.length;
  return {
    avgLagDays: Math.round(avg * 10) / 10,
    maxLagDays: Math.max(...lags),
    count: lags.length,
  };
}

/**
 * Client concentration from invoiced revenue (receivables, trailing 12 months).
 */
export function computeClientConcentration(
  receivables = [],
  { referenceDate = new Date(), windowDays = 365 } = {},
) {
  const refIso = toISODate(referenceDate) || toISODate(new Date());
  const fromIso = toISODate(addDays(refIso, -windowDays));
  const byClient = new Map();
  for (const row of receivables || []) {
    if (!row || row.status === 'cancelled') continue;
    const issueIso = toISODate(row.issueDate);
    if (!issueIso || compareIsoDate(issueIso, fromIso) < 0 || compareIsoDate(issueIso, refIso) > 0) continue;
    const amount = Math.abs(Number(row.grossAmount ?? row.amount) || 0);
    if (amount === 0) continue;
    const name = String(row.counterpartyName || row.client || '').trim() || 'Sin cliente';
    byClient.set(name, clampMoney((byClient.get(name) || 0) + amount));
  }

  const clients = [...byClient.entries()]
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((left, right) => right.revenue - left.revenue);
  const totalRevenue = clampMoney(clients.reduce((sum, client) => sum + client.revenue, 0));
  const top = clients[0] || null;
  const second = clients[1] || null;

  return {
    totalRevenue,
    clientCount: clients.length,
    clients,
    topClient: top?.name || null,
    topRevenue: top?.revenue || 0,
    topSharePct: totalRevenue > 0 && top ? clampMoney((top.revenue / totalRevenue) * 100) : null,
    secondClient: second?.name || null,
    secondSharePct: totalRevenue > 0 && second ? clampMoney((second.revenue / totalRevenue) * 100) : null,
  };
}

/**
 * Weeks of cash coverage: currentCash / weekly burn (avg monthly outflows × 12/52).
 */
export function computeCashWeeks({ currentCash = null, avgMonthlyOutflows = 0 } = {}) {
  const cash = Number(currentCash);
  const monthly = Number(avgMonthlyOutflows) || 0;
  const weeklyBurn = clampMoney((monthly * 12) / 52);
  if (currentCash == null || !Number.isFinite(cash) || weeklyBurn <= 0) {
    return { weeks: null, weeklyBurn: weeklyBurn > 0 ? weeklyBurn : 0 };
  }
  return { weeks: Math.round((cash / weeklyBurn) * 10) / 10, weeklyBurn };
}

/**
 * One pass over a month's posted movements with EBIT-style exclusions:
 * - internal transfers (Umbuchung) ignored entirely
 * - financial costs (bank fees, interest, confirming…) tallied separately and
 *   kept OUT of EBIT costs (they are below-EBIT financial result)
 * - VAT / profit-tax flows (Finanzamt, USt…) excluded; Lohnsteuer stays a cost
 */
const summarizeMonthFlows = (movements = [], monthKey) => {
  let sales = 0;
  let costs = 0;
  let financialCosts = 0;
  let movementCount = 0;

  for (const movement of movements || []) {
    if (!movement || movement.status === 'void') continue;
    const iso = toISODate(movement.postedDate || movement.valueDate || movement.date);
    if (!iso || iso.slice(0, 7) !== monthKey) continue;
    const amount = Math.abs(Number(movement.amount) || 0);
    if (amount === 0) continue;
    const text = movementText(movement);
    if (hasAny(text, INTERNAL_TRANSFER_PATTERNS)) continue;
    movementCount += 1;
    if (movement.direction === 'out' && isFinancialCost(movement, text)) {
      financialCosts += amount;
      continue;
    }
    if (isVatOrProfitTax(text)) continue;
    if (hasAny(text, FINANCING_MOVEMENT_PATTERNS)) continue;
    if (movement.direction === 'in') sales += amount;
    else costs += amount;
  }

  sales = clampMoney(sales);
  costs = clampMoney(costs);
  financialCosts = clampMoney(financialCosts);
  const ebit = clampMoney(sales - costs);
  return {
    monthKey,
    sales,
    costs,
    ebit,
    ebitPct: sales > 0 ? clampMoney((ebit / sales) * 100) : null,
    financialCosts,
    movementCount,
  };
};

/** EBIT approximation for one month from DATEV cash movements. */
export function computeMonthlyEbit(movements = [], { monthKey, referenceDate = new Date() } = {}) {
  const key = monthKey || lastClosedMonthKey(referenceDate);
  const flows = summarizeMonthFlows(movements, key);
  return { monthKey: key, sales: flows.sales, costs: flows.costs, ebit: flows.ebit, ebitPct: flows.ebitPct };
}

/** Financial costs (bank fees / interest / confirming) as % of monthly sales. */
export function computeFinancialCosts(movements = [], { monthKey, referenceDate = new Date() } = {}) {
  const key = monthKey || lastClosedMonthKey(referenceDate);
  const flows = summarizeMonthFlows(movements, key);
  return {
    monthKey: key,
    financialCosts: flows.financialCosts,
    sales: flows.sales,
    pct: flows.sales > 0 ? clampMoney((flows.financialCosts / flows.sales) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// KPI assembly
// ---------------------------------------------------------------------------

/**
 * The 7 KPIs of the one-page management report.
 * Monthly KPIs (EBIT, costos financieros) use the last CLOSED calendar month;
 * stock KPIs (DSO, caja, concentración) are "as of" referenceDate.
 *
 * @returns {Array<{key, label, value, formatted, target, alarm, status, detail}>}
 */
export function computeKpis({
  receivables = [],
  movements = [],
  currentCash = null,
  avgMonthlyOutflows = 0,
  weeklyProjection = [],
  payrollByProject = {},
  referenceDate = new Date(),
} = {}) {
  const refIso = toISODate(referenceDate) || toISODate(new Date());
  const monthKey = lastClosedMonthKey(refIso);
  const monthLabel = formatMonthKeyEs(monthKey);
  const kpis = [];

  // 1 — Margen por obra (YTD, DATEV movements with an assigned project)
  const margins = computeProjectMargins(movements, { payrollByProject });
  const withRevenue = margins.filter((row) => row.revenue > 0);
  const marginRevenue = clampMoney(withRevenue.reduce((sum, row) => sum + row.revenue, 0));
  const marginNet = clampMoney(withRevenue.reduce((sum, row) => sum + row.net, 0));
  const projectMarginPct = marginRevenue > 0 ? clampMoney((marginNet / marginRevenue) * 100) : null;
  kpis.push({
    key: 'projectMargin',
    label: 'Margen por obra',
    value: projectMarginPct,
    formatted: formatPct(projectMarginPct),
    target: `≥ ${KPI_THRESHOLDS.projectMargin.target}%`,
    alarm: `< ${KPI_THRESHOLDS.projectMargin.alarm}%`,
    status: statusHigherBetter(projectMarginPct, KPI_THRESHOLDS.projectMargin),
    detail:
      projectMarginPct == null
        ? 'Sin movimientos con proyecto asignado'
        : `${withRevenue.length} obras con ingreso · YTD ${refIso.slice(0, 4)}`,
  });

  // 2 — EBIT mensual (approximation from operational cash flows)
  const monthFlows = summarizeMonthFlows(movements, monthKey);
  kpis.push({
    key: 'ebitMonthly',
    label: 'EBIT mensual',
    value: monthFlows.ebitPct,
    formatted: formatPct(monthFlows.ebitPct),
    target: `≥ ${KPI_THRESHOLDS.ebitMonthly.target}% ventas`,
    alarm: `< ${KPI_THRESHOLDS.ebitMonthly.alarm}%`,
    status: statusHigherBetter(monthFlows.ebitPct, KPI_THRESHOLDS.ebitMonthly),
    detail:
      monthFlows.sales > 0
        ? `${monthLabel}: ventas ${formatEur(monthFlows.sales)} · EBIT ${formatEur(monthFlows.ebit)}`
        : `Sin ventas registradas en ${monthLabel}`,
  });

  // 3 — Producción → factura (lag in days from productionWeekRef)
  const lag = computeProductionInvoiceLag(receivables, { referenceDate: refIso });
  kpis.push({
    key: 'productionInvoiceLag',
    label: 'Producción → factura',
    value: lag.avgLagDays,
    formatted: lag.avgLagDays == null ? '—' : `${formatNumber(lag.avgLagDays)} d`,
    target: `≤ ${KPI_THRESHOLDS.productionInvoiceLag.target}d`,
    alarm: `> ${KPI_THRESHOLDS.productionInvoiceLag.alarm}d`,
    status: statusLowerBetter(lag.avgLagDays, KPI_THRESHOLDS.productionInvoiceLag),
    detail:
      lag.count > 0
        ? `${lag.count} CXC con semana ref. · máx ${lag.maxLagDays} d`
        : 'Sin CXC con semana de producción',
  });

  // 4 — DSO
  const dso = computeDso(receivables, { referenceDate: refIso });
  kpis.push({
    key: 'dso',
    label: 'DSO',
    value: dso.dsoDays,
    formatted: dso.dsoDays == null ? '—' : `${formatNumber(dso.dsoDays, 0)} d`,
    target: `≤ ${KPI_THRESHOLDS.dso.target}d`,
    alarm: `> ${KPI_THRESHOLDS.dso.alarm}d`,
    status: statusLowerBetter(dso.dsoDays, KPI_THRESHOLDS.dso),
    detail:
      dso.dsoDays == null
        ? 'Sin ventas en los últimos 90 días'
        : `CXC abierta ${formatEur(dso.openAr)} · ventas 90d ${formatEur(dso.windowSales)}`,
  });

  // 5 — Caja en semanas de cobertura
  const cash = computeCashWeeks({ currentCash, avgMonthlyOutflows });
  const negativeWeek = (weeklyProjection || []).find((week) => Number(week?.projectedBalance) < 0);
  kpis.push({
    key: 'cashWeeks',
    label: 'Caja en semanas',
    value: cash.weeks,
    formatted: cash.weeks == null ? '—' : `${formatNumber(cash.weeks)} sem`,
    target: `≥ ${KPI_THRESHOLDS.cashWeeks.target} sem`,
    alarm: `< ${KPI_THRESHOLDS.cashWeeks.alarm} sem`,
    status: statusHigherBetter(cash.weeks, KPI_THRESHOLDS.cashWeeks),
    detail:
      cash.weeks == null
        ? 'Sin datos de caja o salida promedio'
        : `Caja ${formatEur(currentCash)} · salida sem. ${formatEur(cash.weeklyBurn)}${
            negativeWeek ? ` · proy. negativa en ${negativeWeek.week}` : ''
          }`,
  });

  // 6 — Concentración de cliente principal
  const concentration = computeClientConcentration(receivables, { referenceDate: refIso });
  let concentrationStatus = 'n/a';
  if (concentration.totalRevenue > 0) {
    if (concentration.clientCount < 2) concentrationStatus = 'alarm';
    else if (concentration.topSharePct > KPI_THRESHOLDS.clientConcentration.target) concentrationStatus = 'warn';
    else concentrationStatus = 'ok';
  }
  kpis.push({
    key: 'clientConcentration',
    label: 'Concentración cliente',
    value: concentration.topSharePct,
    formatted: formatPct(concentration.topSharePct),
    target: `≤ ${KPI_THRESHOLDS.clientConcentration.target}%`,
    alarm: 'sin 2º cliente',
    status: concentrationStatus,
    detail:
      concentration.totalRevenue > 0
        ? `${concentration.topClient}${
            concentration.secondClient
              ? ` · 2º: ${concentration.secondClient} ${formatPct(concentration.secondSharePct)}`
              : ' · sin 2º cliente'
          } · 12m`
        : 'Sin facturación en 12 meses',
  });

  // 7 — Costos financieros (% de la venta del mes cerrado)
  const financialPct =
    monthFlows.sales > 0 ? clampMoney((monthFlows.financialCosts / monthFlows.sales) * 100) : null;
  kpis.push({
    key: 'financialCosts',
    label: 'Costos financieros',
    value: financialPct,
    formatted: formatPct(financialPct),
    target: `≤ ${KPI_THRESHOLDS.financialCosts.target}% ventas`,
    alarm: `> ${KPI_THRESHOLDS.financialCosts.alarm}%`,
    status: statusLowerBetter(financialPct, KPI_THRESHOLDS.financialCosts),
    detail:
      financialPct == null
        ? `Sin ventas registradas en ${monthLabel}`
        : `${monthLabel}: ${formatEur(monthFlows.financialCosts)} en comisiones/intereses`,
  });

  return kpis;
}

// ---------------------------------------------------------------------------
// Top risks
// ---------------------------------------------------------------------------

const matchesPartnerName = (row, normalizedNames) => {
  const counterparty = normalizeText(row?.counterpartyName || row?.vendor || '');
  if (!counterparty) return false;
  return normalizedNames.some(
    (name) => name && (counterparty === name || counterparty.includes(name) || name.includes(counterparty)),
  );
};

/**
 * Automatically derived risks, ranked by severity (critical > high > medium)
 * then by € exposure. The view shows the top 3.
 *
 * @returns {Array<{key, severity, title, detail, amount, formattedAmount}>}
 */
export function computeTopRisks({
  receivables = [],
  payables = [],
  partners = [],
  currentCash = null,
  avgMonthlyOutflows = 0,
  weeklyProjection = [],
  referenceDate = new Date(),
} = {}) {
  const refIso = toISODate(referenceDate) || toISODate(new Date());
  const risks = [];

  // 1 — cash runway
  const cash = computeCashWeeks({ currentCash, avgMonthlyOutflows });
  if (currentCash != null && Number.isFinite(Number(currentCash))) {
    if (Number(currentCash) < 0) {
      risks.push({
        key: 'cash-negative',
        severity: 'critical',
        title: 'Caja en negativo',
        detail: 'El saldo bancario actual es negativo',
        amount: Number(currentCash),
      });
    } else if (cash.weeks != null && cash.weeks < KPI_THRESHOLDS.cashWeeks.alarm) {
      risks.push({
        key: 'cash-runway',
        severity: 'critical',
        title: 'Caja crítica',
        detail: `≈ ${formatNumber(cash.weeks)} semanas de cobertura (alarma < ${KPI_THRESHOLDS.cashWeeks.alarm})`,
        amount: Number(currentCash),
      });
    } else if (cash.weeks != null && cash.weeks < KPI_THRESHOLDS.cashWeeks.target) {
      risks.push({
        key: 'cash-runway',
        severity: 'high',
        title: 'Caja bajo objetivo',
        detail: `≈ ${formatNumber(cash.weeks)} semanas de cobertura (objetivo ≥ ${KPI_THRESHOLDS.cashWeeks.target})`,
        amount: Number(currentCash),
      });
    }
  }

  // 2 — committed 13-week projection dips negative
  const projection = weeklyProjection || [];
  const negativeIndex = projection.findIndex((week) => Number(week?.projectedBalance) < 0);
  if (negativeIndex >= 0) {
    const minBalance = Math.min(...projection.map((week) => Number(week?.projectedBalance) || 0));
    risks.push({
      key: 'projection-negative',
      severity: negativeIndex < RISK_THRESHOLDS.nearNegativeWeeks ? 'critical' : 'high',
      title: 'Proyección 13 semanas en negativo',
      detail: `Saldo comprometido negativo desde ${projection[negativeIndex].week}${
        projection[negativeIndex].label ? ` (${projection[negativeIndex].label})` : ''
      }`,
      amount: clampMoney(minBalance),
    });
  }

  // 3 — overdue receivables
  const overdue = (receivables || []).filter(
    (row) => row && isOpenDocument(row) && row.dueDate && daysUntil(row.dueDate, refIso) < 0,
  );
  const overdueTotal = sumMoney(overdue, (row) => Number(row.openAmount) || 0);
  if (overdueTotal > 0) {
    const worst = [...overdue].sort(
      (left, right) => (Number(right.openAmount) || 0) - (Number(left.openAmount) || 0),
    )[0];
    risks.push({
      key: 'overdue-receivables',
      severity: overdueTotal > RISK_THRESHOLDS.overdueReceivablesHigh ? 'high' : 'medium',
      title: 'CXC vencida',
      detail: `${overdue.length} factura(s) vencida(s) · mayor: ${worst?.counterpartyName || 'sin contraparte'}`,
      amount: overdueTotal,
    });
  }

  // 4 — partner compliance (F0: Freistellung/Mindestlohn expired or missing)
  const flaggedPartners = (partners || [])
    .filter(
      (partner) =>
        partner &&
        (partner.type === 'vendor' || partner.type === 'both') &&
        (partner.status || 'active') === 'active',
    )
    .map((partner) => ({
      partner,
      compliance: partner.compliance || partnerComplianceStatus(partner, refIso),
    }))
    .filter(({ compliance }) => compliance.status === 'expired' || compliance.status === 'missing');
  if (flaggedPartners.length > 0) {
    const names = flaggedPartners.map(({ partner }) => partner.name).filter(Boolean);
    const normalizedNames = names.map(normalizeText);
    const exposure = sumMoney(
      (payables || []).filter((row) => row && isOpenDocument(row) && matchesPartnerName(row, normalizedNames)),
      (row) => Number(row.openAmount) || 0,
    );
    risks.push({
      key: 'partner-compliance',
      severity: 'high',
      title: 'Compliance de subcontratistas',
      detail: `${flaggedPartners.length} con docs vencidos/faltantes: ${names.slice(0, 3).join(', ') || '—'}`,
      amount: exposure,
    });
  }

  // 5 — CXP sin producción validada (F1 ops gate)
  const uncleared = (payables || []).filter(
    (row) => row && isOpenDocument(row) && payableRequiresOpsClear(row) && !row.opsCleared,
  );
  const unclearedTotal = sumMoney(uncleared, (row) => Number(row.openAmount) || 0);
  if (unclearedTotal > 0) {
    risks.push({
      key: 'cxp-ops-uncleared',
      severity: unclearedTotal > RISK_THRESHOLDS.opsUnclearedHigh ? 'high' : 'medium',
      title: 'CXP sin producción validada',
      detail: `${uncleared.length} documento(s) esperando validación ops`,
      amount: unclearedTotal,
    });
  }

  // 6 — client concentration
  const concentration = computeClientConcentration(receivables, { referenceDate: refIso });
  if (concentration.totalRevenue > 0) {
    if (concentration.clientCount < 2) {
      risks.push({
        key: 'client-concentration',
        severity: 'high',
        title: 'Cliente único',
        detail: `Toda la venta 12m depende de ${concentration.topClient}`,
        amount: concentration.topRevenue,
      });
    } else if (concentration.topSharePct > KPI_THRESHOLDS.clientConcentration.target) {
      risks.push({
        key: 'client-concentration',
        severity: 'medium',
        title: 'Concentración de cliente',
        detail: `${concentration.topClient} = ${formatPct(concentration.topSharePct)} de la venta 12m`,
        amount: concentration.topRevenue,
      });
    }
  }

  return risks
    .map((risk) => ({
      ...risk,
      amount: clampMoney(risk.amount ?? 0),
      formattedAmount: formatEur(risk.amount ?? 0),
    }))
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        Math.abs(right.amount) - Math.abs(left.amount),
    );
}
