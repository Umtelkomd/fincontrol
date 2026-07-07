/**
 * Project cost control — pure PMP-style math, no React, no Firestore.
 *
 * Powers the "Control de Proyectos" view. Groups ledger entries by projectId
 * with a name fallback (the existing buildProjectMargins groups by name STRING
 * only, which splits canonical and legacy docs into different rows), applies
 * accrual cost logic (cash out + open payables + allocated labor), computes
 * classic EVM (PV/EV/AC/CPI/SPI/EAC/VAC) per project, and distributes the
 * overhead pool (indirect spend + unallocated payroll) over a chosen basis.
 *
 * All ratio outputs are null-safe: divisions are guarded so the module never
 * emits NaN or Infinity — nulls render as '—' in the UI.
 */

import { FINANCIAL_CONSTANTS } from '../../../constants/config';

export const OVERHEAD_KEY = '__overhead__';
// Legacy catalog label (src/constants/projects.js) still present on old docs.
export const OVERHEAD_LABEL = 'General / Overhead';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const clamp01 = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const clampPct = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

const toIso = (date) => {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 10) || null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  return null;
};

// ISO date → UTC epoch ms (null when unparseable). Anchoring at UTC midnight
// keeps schedule math independent of the viewer's timezone.
const toTime = (date) => {
  const iso = toIso(date);
  if (!iso) return null;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
};

const monthKeyOf = (iso) => (iso ? String(iso).slice(0, 7) : null);

/**
 * Index the project catalog for O(1) resolution of both canonical ids and
 * legacy name strings. byName keys: lowercased/trimmed name, displayName and
 * code — legacy docs stored any of the three.
 */
export const buildProjectIndex = (projects = []) => {
  const byId = new Map();
  const byName = new Map();
  (projects || []).forEach((project) => {
    if (!project || !project.id) return;
    byId.set(project.id, project);
    [project.name, project.displayName, project.code].forEach((fragment) => {
      const key = String(fragment || '').trim().toLowerCase();
      // First project wins on collisions so resolution stays deterministic.
      if (key && !byName.has(key)) byName.set(key, project);
    });
  });
  return { byId, byName };
};

/**
 * Resolve a ledger entry (movement / receivable / payable / payroll key) to a
 * grouping key. Buckets:
 *   'project'  — resolved to a catalog project (by id, else by name string)
 *   'overhead' — no project ('', 'Sin proyecto', legacy 'General / Overhead')
 *   'unknown'  — a non-empty name that matches NO catalog project. These MUST
 *                surface as their own rows (data-quality visibility); folding
 *                them into overhead would silently hide misclassified spend.
 */
export const resolveEntryKey = (entry, index) => {
  const idx = index || { byId: new Map(), byName: new Map() };
  const pid = entry?.projectId;
  if (pid && idx.byId.has(pid)) {
    const project = idx.byId.get(pid);
    return { key: pid, projectId: pid, name: project.displayName || project.name || pid, bucket: 'project' };
  }
  const rawName = String(entry?.projectName ?? '').trim();
  const norm = rawName.toLowerCase();
  if (norm && idx.byName.has(norm)) {
    const project = idx.byName.get(norm);
    return { key: project.id, projectId: project.id, name: project.displayName || project.name, bucket: 'project' };
  }
  if (!norm || norm === 'sin proyecto' || norm === OVERHEAD_LABEL.toLowerCase()) {
    return { key: OVERHEAD_KEY, projectId: null, name: OVERHEAD_LABEL, bucket: 'overhead' };
  }
  return { key: `name:${norm}`, projectId: null, name: rawName, bucket: 'unknown' };
};

const createActualsRow = ({ key, projectId, name, bucket }) => ({
  key,
  projectId,
  name,
  bucket,
  cashIn: 0,
  cashOut: 0,
  openReceivables: 0,
  openPayables: 0,
  labor: 0,
});

/**
 * Aggregate ledger + payroll data into per-key actuals.
 *
 * Receivables/payables contribute ONLY their openAmount: the paid portion of
 * every document already exists as a posted bank movement (cashIn/cashOut), so
 * adding grossAmount would count the settled slice twice. Cancelled documents
 * are excluded entirely.
 *
 * Derived accrual measures:
 *   directCost     = cashOut + openPayables + labor   (accrual AC)
 *   revenueAccrued = cashIn + openReceivables
 */
export const buildProjectActuals = ({
  movements = [],
  receivables = [],
  payables = [],
  projects = [],
  payrollByProject = {},
} = {}) => {
  const index = buildProjectIndex(projects);
  const actuals = new Map();

  const rowFor = (resolution) => {
    if (!actuals.has(resolution.key)) actuals.set(resolution.key, createActualsRow(resolution));
    return actuals.get(resolution.key);
  };

  (movements || []).forEach((entry) => {
    const amount = Number(entry?.amount) || 0;
    if (amount === 0) return;
    const row = rowFor(resolveEntryKey(entry, index));
    if (entry.direction === 'in') row.cashIn += amount;
    else if (entry.direction === 'out') row.cashOut += amount;
  });

  (receivables || []).forEach((entry) => {
    if (!entry || entry.status === 'cancelled') return;
    const open = Number(entry.openAmount) || 0;
    if (open === 0) return;
    rowFor(resolveEntryKey(entry, index)).openReceivables += open;
  });

  (payables || []).forEach((entry) => {
    if (!entry || entry.status === 'cancelled') return;
    const open = Number(entry.openAmount) || 0;
    if (open === 0) return;
    rowFor(resolveEntryKey(entry, index)).openPayables += open;
  });

  // Payroll allocation arrives keyed by project NAME (allocatePayrollCost),
  // with raw project ids as fallback when the name map missed an id — resolve
  // both shapes through the same index so labor lands on the right row.
  Object.entries(payrollByProject || {}).forEach(([payrollKey, laborCost]) => {
    const cost = Number(laborCost) || 0;
    if (cost === 0) return;
    const resolution = index.byId.has(payrollKey)
      ? resolveEntryKey({ projectId: payrollKey }, index)
      : resolveEntryKey({ projectName: payrollKey }, index);
    rowFor(resolution).labor += cost;
  });

  actuals.forEach((row) => {
    row.cashIn = round2(row.cashIn);
    row.cashOut = round2(row.cashOut);
    row.openReceivables = round2(row.openReceivables);
    row.openPayables = round2(row.openPayables);
    row.labor = round2(row.labor);
    row.directCost = round2(row.cashOut + row.openPayables + row.labor);
    row.revenueAccrued = round2(row.cashIn + row.openReceivables);
  });

  return actuals;
};

/**
 * Classic EVM set for one project. PV uses a LINEAR baseline between start and
 * end dates — a deliberate PMP simplification: without a real schedule
 * baseline, planned value can only be interpolated over calendar time.
 * Every ratio is guarded so the result never contains NaN or Infinity.
 */
export const computeEvm = ({ bac, percentComplete, startDate, endDate, asOf, actualCost } = {}) => {
  const ac = Number(actualCost) || 0;
  const budget = Number(bac) || 0;

  if (budget <= 0) {
    // Without a cost baseline there is nothing to earn value against.
    return { pv: null, ev: null, ac, cpi: null, spi: null, cv: null, sv: null, eac: null, etc: null, vac: null, percentSpent: null };
  }

  const ev = budget * (clampPct(percentComplete) / 100);

  const start = toTime(startDate);
  const end = toTime(endDate);
  const reference = toTime(asOf) ?? Date.now();
  const pv = start != null && end != null && start < end
    ? budget * clamp01((reference - start) / (end - start))
    : null;

  const cpi = ac > 0 ? ev / ac : null;
  const spi = pv != null && pv > 0 ? ev / pv : null;
  const cv = ev - ac;
  const sv = pv != null ? ev - pv : null;

  // EAC assumes current cost performance persists (bac / cpi). Before any
  // spend the plan holds (eac = bac); with spend but zero earned value there
  // is no defensible forecast — null, never Infinity.
  const eac = cpi != null && cpi > 0 ? budget / cpi : (ac === 0 ? budget : null);
  const etc = eac != null ? eac - ac : null;
  const vac = eac != null ? budget - eac : null;
  const percentSpent = (ac / budget) * 100;

  return { pv, ev, ac, cpi, spi, cv, sv, eac, etc, vac, percentSpent };
};

/**
 * Payroll cost that allocatePayrollCost could NOT assign to any project: lines
 * whose employee is missing or has an empty projectIds list. Mirrors its cents
 * rounding so pool + allocated always reconciles with total payroll — nothing
 * double-counted, nothing lost.
 */
export const computeUnallocatedLabor = ({ periods, employeesById } = {}) => {
  let total = 0;
  (periods || []).forEach((period) => {
    if (!period || !Array.isArray(period.lines)) return;
    period.lines.forEach((line) => {
      const cost = round2(line?.gesamtkosten);
      if (cost === 0) return;
      const employee = (employeesById || {})[line.employeeId];
      const projectIds = Array.isArray(employee?.projectIds) ? employee.projectIds.filter(Boolean) : [];
      if (projectIds.length === 0) total += cost;
    });
  });
  return round2(total);
};

/**
 * Overhead pool = indirect spend (the overhead bucket's accrual cost) plus the
 * payroll nobody's projectIds captured. This is what must be recovered through
 * the allocation rate.
 */
export const buildOverheadPool = ({ actuals, unallocatedLabor = 0 } = {}) => {
  const overheadRow = actuals?.get?.(OVERHEAD_KEY);
  const indirectCosts = round2(overheadRow ? overheadRow.directCost : 0);
  const labor = round2(unallocatedLabor);
  return { total: round2(indirectCosts + labor), indirectCosts, unallocatedLabor: labor };
};

/**
 * Predetermined overhead rate (PMP): rate = pool / allocation base. Only
 * project-bucket rows absorb overhead — unknown rows are data-quality noise
 * and the overhead row itself is the pool. Zero base → rate 0, no allocations.
 */
export const allocateOverhead = ({ pool = 0, rows = [], basis = 'directCost' } = {}) => {
  const measureOf = (row) => (basis === 'revenue' ? Number(row.revenueAccrued) || 0 : Number(row.directCost) || 0);
  const projectRows = (rows || []).filter((row) => row.bucket === 'project');
  const base = round2(projectRows.reduce((sum, row) => sum + measureOf(row), 0));
  const byKey = new Map();
  if (base <= 0) return { rate: 0, base, byKey };
  const rate = pool / base;
  projectRows.forEach((row) => {
    byKey.set(row.key, round2(rate * measureOf(row)));
  });
  return { rate, base, byKey };
};

const HEALTH = {
  CPI_ERR: 0.85,
  CPI_WARN: 0.97,
};

const computeHealth = ({ cpi, grossMarginToDate, netMarginToDate }) => {
  const reasons = [];
  if (cpi != null && cpi < HEALTH.CPI_ERR) reasons.push('CPI crítico');
  else if (cpi != null && cpi < HEALTH.CPI_WARN) reasons.push('CPI bajo');
  if (netMarginToDate != null && netMarginToDate < 0) reasons.push('Margen neto negativo');
  if (grossMarginToDate != null && grossMarginToDate * 100 < FINANCIAL_CONSTANTS.MARGIN_WARNING_PERCENT) {
    reasons.push('Margen bruto bajo');
  }

  const isErr = (cpi != null && cpi < HEALTH.CPI_ERR) || (netMarginToDate != null && netMarginToDate < 0);
  if (isErr) return { health: 'err', healthReasons: reasons };
  if (reasons.length > 0) return { health: 'warn', healthReasons: reasons };
  const hasData = cpi != null || grossMarginToDate != null || netMarginToDate != null;
  if (hasData) return { health: 'ok', healthReasons: ['En línea'] };
  return { health: 'neutral', healthReasons: ['Datos insuficientes'] };
};

/**
 * Join catalog projects with actuals, EVM, margins and overhead allocation
 * into display-ready rows. Margins are fractions (0..1) or null. Unknown
 * actuals rows are appended flagged (no EVM, no overhead) so misclassified
 * spend stays visible. The overhead pool row itself is excluded — it feeds
 * buildOverheadPool, not the project table.
 *
 * includeEvm: EVM is cumulative-to-date BY DEFINITION (PMP) — percentComplete
 * and the schedule baseline are lifetime measures. When the caller feeds a
 * time-sliced actuals set (year filter), comparing a sliced AC against
 * lifetime EV/PV would fabricate CPI/EAC (an over-budget project could read
 * healthy). Pass includeEvm: false in that case: every EVM-derived field
 * (incl. marginForecast) becomes null and health falls back to margins only.
 */
export const buildControlRows = ({ actuals, projects = [], overhead, asOf, includeEvm = true } = {}) => {
  const emptyRow = createActualsRow({ key: '', projectId: null, name: '', bucket: 'project' });
  const rows = [];

  (projects || []).forEach((project) => {
    const actual = actuals?.get?.(project.id) || { ...emptyRow, directCost: 0, revenueAccrued: 0 };
    const contractValue = Number(project.contractValue) || 0;
    const bac = Number(project.budget) || 0;
    const evm = includeEvm
      ? computeEvm({
        bac,
        percentComplete: project.percentComplete,
        startDate: project.startDate,
        endDate: project.endDate,
        asOf,
        actualCost: actual.directCost,
      })
      : {
        pv: null, ev: null, ac: actual.directCost, cpi: null, spi: null,
        cv: null, sv: null, eac: null, etc: null, vac: null, percentSpent: null,
      };

    const overheadAllocated = round2(overhead?.byKey?.get?.(project.id) || 0);
    const burdenedCost = round2(actual.directCost + overheadAllocated);
    const revenue = actual.revenueAccrued;

    // Both plan figures must exist: a contract without a loaded cost budget
    // (bac 0) would otherwise read as a fake 100% planned margin.
    const marginPlanned = contractValue > 0 && bac > 0 ? (contractValue - bac) / contractValue : null;
    const grossMarginToDate = revenue > 0 ? (revenue - actual.directCost) / revenue : null;
    const netMarginToDate = revenue > 0 ? (revenue - burdenedCost) / revenue : null;
    const marginForecast = !includeEvm
      ? null
      : contractValue > 0 && evm.eac != null
        ? (contractValue - evm.eac) / contractValue
        : marginPlanned;

    rows.push({
      key: project.id,
      projectId: project.id,
      code: project.code || '',
      name: project.name || '',
      displayName: project.displayName || project.name || project.code || project.id,
      operator: project.operator || '',
      status: project.status || 'active',
      unknown: false,
      bucket: 'project',
      cashIn: actual.cashIn,
      cashOut: actual.cashOut,
      openReceivables: actual.openReceivables,
      openPayables: actual.openPayables,
      labor: actual.labor,
      directCost: actual.directCost,
      revenueAccrued: revenue,
      contractValue,
      bac,
      percentComplete: clampPct(project.percentComplete),
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      evm,
      marginPlanned,
      grossMarginToDate,
      overheadAllocated,
      burdenedCost,
      netMarginToDate,
      marginForecast,
      ...computeHealth({ cpi: evm.cpi, grossMarginToDate, netMarginToDate }),
    });
  });

  actuals?.forEach?.((actual, key) => {
    if (actual.bucket !== 'unknown') return;
    const revenue = actual.revenueAccrued;
    const grossMarginToDate = revenue > 0 ? (revenue - actual.directCost) / revenue : null;
    rows.push({
      key,
      projectId: null,
      code: '',
      name: actual.name,
      displayName: actual.name,
      operator: '',
      status: 'unknown',
      unknown: true,
      bucket: 'unknown',
      cashIn: actual.cashIn,
      cashOut: actual.cashOut,
      openReceivables: actual.openReceivables,
      openPayables: actual.openPayables,
      labor: actual.labor,
      directCost: actual.directCost,
      revenueAccrued: revenue,
      contractValue: null,
      bac: null,
      percentComplete: null,
      startDate: '',
      endDate: '',
      evm: null,
      marginPlanned: null,
      grossMarginToDate,
      overheadAllocated: 0,
      burdenedCost: actual.directCost,
      netMarginToDate: grossMarginToDate,
      marginForecast: null,
      health: 'neutral',
      healthReasons: ['Sin catalogar'],
    });
  });

  const rankOf = (row) => {
    if (row.unknown) return 2;
    return row.status === 'active' ? 0 : 1;
  };

  return rows.sort((left, right) => {
    const rank = rankOf(left) - rankOf(right);
    if (rank !== 0) return rank;
    return right.revenueAccrued - left.revenueAccrued;
  });
};

/**
 * Portfolio-level aggregation for the header KPIs. Margins are revenue-
 * weighted percentages ((Σrevenue − Σcost) / Σrevenue × 100), which is the
 * honest blend — averaging row percentages would let tiny projects distort
 * the portfolio picture. Unknown rows carry real money, so their cost and
 * revenue are included; they have no contract/BAC to add.
 */
export const computePortfolioSummary = ({ rows = [], overhead } = {}) => {
  let contractTotal = 0;
  let bacTotal = 0;
  let directCostTotal = 0;
  let revenueAccruedTotal = 0;
  let burdenedTotal = 0;
  let atRiskCount = 0;

  (rows || []).forEach((row) => {
    if (!row.unknown) {
      contractTotal += Number(row.contractValue) || 0;
      bacTotal += Number(row.bac) || 0;
    }
    directCostTotal += Number(row.directCost) || 0;
    revenueAccruedTotal += Number(row.revenueAccrued) || 0;
    burdenedTotal += Number(row.burdenedCost) || 0;
    if (row.health === 'err' || row.health === 'warn') atRiskCount += 1;
  });

  contractTotal = round2(contractTotal);
  bacTotal = round2(bacTotal);
  directCostTotal = round2(directCostTotal);
  revenueAccruedTotal = round2(revenueAccruedTotal);
  burdenedTotal = round2(burdenedTotal);

  return {
    contractTotal,
    bacTotal,
    directCostTotal,
    revenueAccruedTotal,
    grossMarginPct: revenueAccruedTotal > 0
      ? ((revenueAccruedTotal - directCostTotal) / revenueAccruedTotal) * 100
      : null,
    netMarginPct: revenueAccruedTotal > 0
      ? ((revenueAccruedTotal - burdenedTotal) / revenueAccruedTotal) * 100
      : null,
    overheadPool: overhead?.pool?.total ?? 0,
    overheadRate: overhead?.allocation?.rate ?? 0,
    atRiskCount,
  };
};

// Guard against pathological catalog dates producing a runaway series.
const MAX_CURVE_MONTHS = 240;

/**
 * Monthly S-curve series for one project: cumulative accrual cost (cash out +
 * open payables by issue date) vs the linear PV baseline, between startDate
 * and endDate. Costs BEFORE the window fold into the first bucket (cumulative
 * cost to date must not hide early spend); costs AFTER the window are outside
 * the plan and excluded. Actuals stop at asOf's month (null afterwards) so the
 * chart line ends at today instead of flat-lining into the future.
 */
export const buildCostCurve = ({
  movements = [],
  payables = [],
  projects = [],
  projectKey,
  bac,
  startDate,
  endDate,
  asOf,
} = {}) => {
  const budget = Number(bac) || 0;
  const start = toTime(startDate);
  const end = toTime(endDate);
  if (budget <= 0 || start == null || end == null || start >= end) return [];

  const startIso = toIso(startDate);
  const endIso = toIso(endDate);
  const firstMonth = new Date(`${startIso.slice(0, 7)}-01T00:00:00Z`);
  const lastKey = monthKeyOf(endIso);

  const buckets = [];
  const cursor = new Date(firstMonth);
  while (buckets.length < MAX_CURVE_MONTHS) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.push({
      key,
      label: cursor.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
      cost: 0,
    });
    if (key >= lastKey) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (buckets[buckets.length - 1].key < lastKey) return []; // range too long

  const byKey = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  const firstKey = buckets[0].key;
  const index = buildProjectIndex(projects);

  const addCost = (iso, amount) => {
    const key = monthKeyOf(iso);
    if (!key || amount === 0) return;
    if (key > lastKey) return; // outside the plan window
    const bucketKey = key < firstKey ? firstKey : key;
    buckets[byKey.get(bucketKey)].cost += amount;
  };

  (movements || []).forEach((entry) => {
    if (entry?.direction !== 'out') return;
    if (resolveEntryKey(entry, index).key !== projectKey) return;
    addCost(toIso(entry.postedDate || entry.date), Number(entry.amount) || 0);
  });

  (payables || []).forEach((entry) => {
    if (!entry || entry.status === 'cancelled') return;
    if (resolveEntryKey(entry, index).key !== projectKey) return;
    addCost(toIso(entry.issueDate || entry.dueDate), Number(entry.openAmount) || 0);
  });

  const asOfKey = monthKeyOf(toIso(asOf) || toIso(new Date()));
  let cumulative = 0;
  return buckets.map((bucket) => {
    cumulative = round2(cumulative + bucket.cost);
    const [year, month] = bucket.key.split('-').map(Number);
    const monthEnd = Date.UTC(year, month, 0); // last calendar day of the month
    return {
      key: bucket.key,
      label: bucket.label,
      actual: bucket.key <= asOfKey ? cumulative : null,
      pv: round2(budget * clamp01((monthEnd - start) / (end - start))),
    };
  });
};

/**
 * Overhead pool composition for the Overhead tab: indirect spend grouped by
 * category (overhead-bucket outflows + open payables), plus the unallocated
 * payroll as its own labelled row. Sorted by amount desc.
 */
export const buildOverheadComposition = ({
  movements = [],
  payables = [],
  projects = [],
  unallocatedLabor = 0,
} = {}) => {
  const index = buildProjectIndex(projects);
  const byCategory = new Map();

  const add = (categoryName, amount) => {
    if (amount === 0) return;
    const label = String(categoryName || '').trim() || 'Sin categoría';
    byCategory.set(label, (byCategory.get(label) || 0) + amount);
  };

  (movements || []).forEach((entry) => {
    if (entry?.direction !== 'out') return;
    if (resolveEntryKey(entry, index).bucket !== 'overhead') return;
    add(entry.categoryName, Number(entry.amount) || 0);
  });

  (payables || []).forEach((entry) => {
    if (!entry || entry.status === 'cancelled') return;
    if (resolveEntryKey(entry, index).bucket !== 'overhead') return;
    add(entry.categoryName, Number(entry.openAmount) || 0);
  });

  const composition = Array.from(byCategory, ([label, amount]) => ({ label, amount: round2(amount) }));
  const labor = round2(unallocatedLabor);
  if (labor > 0) composition.push({ label: 'Nómina sin asignar', amount: labor });

  return composition.sort((left, right) => right.amount - left.amount);
};

// Exposed for tests
export const __internal = {
  round2,
  clamp01,
  clampPct,
  toIso,
  toTime,
  monthKeyOf,
  OVERHEAD_KEY,
  OVERHEAD_LABEL,
  computeHealth,
};
