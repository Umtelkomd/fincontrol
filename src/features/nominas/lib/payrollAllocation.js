/**
 * Payroll cost allocation (Phase 3, item 3) — pure, no side effects.
 *
 * Allocates the TRUE company cost (per-line gesamtkosten / employerCostTotal),
 * never the cash obligation (cashTotal), across:
 *   - cost centers, via employee.defaultCostCenter (fallback bucket otherwise)
 *   - projects, via employee.projectIds (equal split across the assigned projects)
 *
 * Output is plain serializable maps so it can flow straight into the treasury
 * project-margins engine and the ProyectoDashboard P&L without sanitizing.
 */

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const addTo = (map, key, amount) => {
  if (!key) return;
  map[key] = cents((map[key] || 0) + amount);
};

/**
 * @param {{
 *   periods: Array<{lines:Array<{employeeId:string, gesamtkosten:number}>}>,
 *   employeesById: Object<string, {defaultCostCenter?:string, projectIds?:string[]}>,
 *   projectNamesById?: Object<string,string>,  // resolve project id → name so byProject
 *                                              // keys match buildProjectMargins' projectName grouping
 *   fallbackCostCenter?: string
 * }} params
 * @returns {{ byCostCenter: Object<string,number>, byProject: Object<string,number> }}
 */
export const allocatePayrollCost = ({
  periods,
  employeesById,
  projectNamesById = {},
  fallbackCostCenter = 'CC-NOM',
} = {}) => {
  const byCostCenter = {};
  const byProject = {};
  const byId = employeesById || {};
  const nameById = projectNamesById || {};

  if (!Array.isArray(periods)) return { byCostCenter, byProject };

  for (const period of periods) {
    if (!period || !Array.isArray(period.lines)) continue;
    for (const line of period.lines) {
      const cost = cents(line.gesamtkosten);
      if (cost === 0) continue;
      const emp = byId[line.employeeId] || {};

      // Cost-center allocation: clean 1:1 via defaultCostCenter.
      const cc = emp.defaultCostCenter || fallbackCostCenter;
      addTo(byCostCenter, cc, cost);

      // Project allocation: equal split across the employee's projects.
      const projectIds = Array.isArray(emp.projectIds)
        ? emp.projectIds.filter(Boolean)
        : [];
      if (projectIds.length > 0) {
        const share = cost / projectIds.length;
        // Key by resolved project NAME when a map is given (so the labor merges
        // into buildProjectMargins' name-grouped rows); else fall back to id.
        projectIds.forEach((pid) => addTo(byProject, nameById[pid] || pid, share));
      }
    }
  }

  // Final rounding pass so equal-split rounding settles cleanly.
  Object.keys(byProject).forEach((k) => {
    byProject[k] = cents(byProject[k]);
  });

  return { byCostCenter, byProject };
};
