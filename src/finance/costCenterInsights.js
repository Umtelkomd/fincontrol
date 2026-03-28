import { clampMoney } from './utils';
import { getCostCenterDisplayCode } from '../constants/costCenters';

const normalize = (value) => String(value || '').trim().toLowerCase();
const toMonthKey = (year, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
const UNASSIGNED_MARKERS = new Set(['sin asignar', 'sin centro', 'unassigned', 'none', 'ninguno', 'n/a', 'na', '-']);

const buildEvenMonthlyBudget = (annualBudget) => {
  const numericBudget = Number(annualBudget) || 0;
  if (numericBudget <= 0) return Array.from({ length: 12 }, () => 0);
  const base = Math.floor((numericBudget / 12) * 100) / 100;
  const values = Array.from({ length: 12 }, () => base);
  const assigned = base * 12;
  values[11] = clampMoney(numericBudget - assigned + base);
  return values;
};

export const findCostCenterMatch = (costCenters, value) => {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return null;

  return (
    costCenters.find((center) =>
      [center.businessCode, center.id, center.code, center.name, ...(center.aliases || [])]
        .filter(Boolean)
        .some((candidate) => normalize(candidate) === normalizedValue),
    ) || null
  );
};

export const resolveCostCenterIdentity = (costCenters, value) => {
  const match = findCostCenterMatch(costCenters, value);
  if (!match) {
    return {
      key: value || '',
      code: value || '',
      name: value || 'Sin centro',
      exists: false,
      budget: 0,
      responsible: '',
      type: '',
    };
  }

  return {
    key: getCostCenterDisplayCode(match),
    code: getCostCenterDisplayCode(match),
    name: match.name || match.code || match.id,
    exists: true,
    budget: Number(match.budget) || 0,
    responsible: match.responsible || '',
    type: match.type || '',
  };
};

export const hasAssignedCostCenter = (value) => {
  const normalizedValue = normalize(value);
  return Boolean(normalizedValue) && !UNASSIGNED_MARKERS.has(normalizedValue);
};

export const getCostCenterMonthlyBudgetMap = (center, year) => {
  const explicit = center?.monthlyBudgets || {};
  const evenValues = buildEvenMonthlyBudget(center?.annualBudgetByYear?.[year] ?? center?.budget ?? 0);

  return Object.fromEntries(
    Array.from({ length: 12 }, (_, monthIndex) => {
      const key = toMonthKey(year, monthIndex);
      return [key, clampMoney(Number(explicit[key] ?? evenValues[monthIndex] ?? 0))];
    }),
  );
};

export const getCostCenterMonthBudget = (center, year, monthIndex) => {
  const monthlyBudgetMap = getCostCenterMonthlyBudgetMap(center, year);
  return clampMoney(monthlyBudgetMap[toMonthKey(year, monthIndex)] || 0);
};

export const getCostCenterAnnualBudget = (center, year) => {
  return clampMoney(
    Object.values(getCostCenterMonthlyBudgetMap(center, year)).reduce((sum, amount) => sum + amount, 0),
  );
};

export const getCostCenterYTDBudget = (center, year, monthIndex) => {
  const monthlyBudgetMap = getCostCenterMonthlyBudgetMap(center, year);
  return clampMoney(
    Array.from({ length: monthIndex + 1 }, (_, index) => monthlyBudgetMap[toMonthKey(year, index)] || 0).reduce(
      (sum, amount) => sum + amount,
      0,
    ),
  );
};

export const summarizeMovementsByCostCenter = (movements, costCenters, options = {}) => {
  const { direction = null, from = null, to = null, includeUnknown = false } = options;
  const rows = new Map();

  movements.forEach((movement) => {
    if (direction && movement.direction !== direction) return;
    if (from && movement.postedDate < from) return;
    if (to && movement.postedDate > to) return;

    const center = resolveCostCenterIdentity(costCenters, movement.costCenterId);
    if (!center.exists && !includeUnknown) return;
    const key = center.key || '__unassigned__';
    const current = rows.get(key) || {
      key,
      code: center.code || '',
      name: center.name || 'Sin centro',
      exists: center.exists,
      responsible: center.responsible,
      budget: center.budget,
      inflows: 0,
      outflows: 0,
      net: 0,
      movements: 0,
      unassigned: !center.exists && !hasAssignedCostCenter(movement.costCenterId),
    };

    if (movement.direction === 'in') current.inflows += movement.amount;
    else current.outflows += movement.amount;
    current.net = current.inflows - current.outflows;
    current.movements += 1;

    rows.set(key, current);
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      inflows: clampMoney(row.inflows),
      outflows: clampMoney(row.outflows),
      net: clampMoney(row.net),
    }))
    .sort((left, right) => Math.abs(right.outflows || right.net) - Math.abs(left.outflows || left.net));
};

export const buildCostCenterBudgetAlerts = (movements, costCenters, year = new Date().getFullYear()) => {
  const currentMonthIndex =
    year === new Date().getFullYear() ? new Date().getMonth() : 11;

  const alerts = [];

  costCenters
    .filter((center) => center.type === 'Costos')
    .forEach((center) => {
      const executed = movements
        .filter((movement) => {
          if (movement.direction !== 'out') return false;
          if (!movement.postedDate) return false;
          if (new Date(movement.postedDate).getFullYear() !== year) return false;
          const match = findCostCenterMatch(costCenters, movement.costCenterId);
          return match && (match.id === center.id || match.code === center.code || match.name === center.name);
        })
        .reduce((sum, movement) => sum + movement.amount, 0);

      const annualBudget = getCostCenterAnnualBudget(center, year);
      const ytdBudget = getCostCenterYTDBudget(center, year, currentMonthIndex);
      const utilization = ytdBudget > 0 ? (executed / ytdBudget) * 100 : 0;

      if (annualBudget > 0 && utilization > 100) {
        alerts.push({
          type: 'over_budget',
          centerId: center.id,
          centerCode: center.code || center.id,
          centerName: center.name,
          executed: clampMoney(executed),
          budget: clampMoney(ytdBudget),
          utilization: clampMoney(utilization),
        });
      }
    });

  const unassignedExpenseMovements = movements.filter((movement) => {
    if (movement.direction !== 'out') return false;
    if (!movement.postedDate || new Date(movement.postedDate).getFullYear() !== year) return false;
    return !findCostCenterMatch(costCenters, movement.costCenterId);
  });

  if (unassignedExpenseMovements.length > 0) {
    alerts.push({
      type: 'missing_cost_center',
      count: unassignedExpenseMovements.length,
      amount: clampMoney(unassignedExpenseMovements.reduce((sum, movement) => sum + movement.amount, 0)),
    });
  }

  return alerts;
};
