/**
 * Employee master data quality — the two defects that break personnel costing.
 *
 * 1. The same person entered twice. Production has `Sebastian Agudelo Grajales`
 *    (inactive) and `Sebatian Agudelo Grajales` (active): one typo, two records,
 *    two identities. A bank counterparty then resolves to whichever record it
 *    happens to match, and payroll cost can end up split across both.
 *
 * 2. An internal employee with no `projectIds`. `allocatePayrollCost` routes an
 *    employee's gesamtkosten through exactly that array — empty means the cost
 *    reaches NO obra and every project silently under-reports its labour. 12 of
 *    15 employees are in this state.
 *
 * Both are surfaced as warnings the user can act on, not console noise.
 *
 * Pure: no React, no Firebase.
 */

import { nameTokens, normalizeName } from '../../../utils/nameMatching.js';

/**
 * Levenshtein distance, abandoned as soon as it exceeds `max`.
 * Small inputs (person names), so the plain O(n·m) table is fine.
 */
const editDistanceWithin = (left, right, max) => {
  if (Math.abs(left.length - right.length) > max) return max + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }

  return previous[right.length];
};

/** Same words in any order — "Simon Pizarro Caufal" vs "Pizarro Caufal Simon". */
const sameTokenSet = (left, right) => {
  const a = nameTokens(left).sort();
  const b = nameTokens(right).sort();
  return a.length > 0 && a.length === b.length && a.every((token, index) => token === b[index]);
};

/**
 * Two records that are almost certainly one person.
 *
 * A one- or two-character difference on a name of at least 12 characters is a
 * typo; on a short name it is a different person ("Ana Ruiz" / "Ane Ruez"), so
 * the length floor is what keeps this from crying wolf.
 */
const looksLikeSamePerson = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (sameTokenSet(a, b)) return true;

  const longest = Math.max(a.length, b.length);
  if (longest < 12) return false;
  const tolerance = longest >= 18 ? 2 : 1;
  return editDistanceWithin(a, b, tolerance) <= tolerance;
};

/**
 * Group employees that look like the same person entered more than once.
 *
 * @param {Array<object>} employees
 * @returns {Array<{key:string, employees:Array<object>}>} groups of 2+, input order
 */
export const findDuplicateEmployees = (employees) => {
  const list = (Array.isArray(employees) ? employees : []).filter((e) => normalizeName(e?.fullName));

  const groups = [];
  const claimed = new Set();

  list.forEach((employee, index) => {
    if (claimed.has(employee.id ?? index)) return;

    const members = [employee];
    for (let other = index + 1; other < list.length; other += 1) {
      const candidate = list[other];
      const candidateKey = candidate.id ?? other;
      if (claimed.has(candidateKey)) continue;
      if (members.some((member) => looksLikeSamePerson(member.fullName, candidate.fullName))) {
        members.push(candidate);
        claimed.add(candidateKey);
      }
    }

    if (members.length > 1) {
      claimed.add(employee.id ?? index);
      groups.push({ key: normalizeName(employee.fullName), employees: members });
    }
  });

  return groups;
};

/**
 * Active internal employees whose payroll cost cannot reach any project.
 *
 * @param {Array<object>} employees
 * @returns {Array<object>}
 */
export const findEmployeesWithoutProjects = (employees) =>
  (Array.isArray(employees) ? employees : []).filter((employee) => {
    if (normalizeName(employee?.type) !== 'internal') return false;
    if (normalizeName(employee?.status) === 'inactive') return false;
    return !(Array.isArray(employee?.projectIds) && employee.projectIds.length > 0);
  });

/**
 * The warnings the Personal screen renders, in severity order.
 *
 * @param {Array<object>} employees
 * @returns {Array<{id:string, tone:string, title:string, detail:string, count:number, employees:Array<object>}>}
 */
export const employeeDataWarnings = (employees) => {
  const warnings = [];

  const duplicates = findDuplicateEmployees(employees);
  if (duplicates.length > 0) {
    const names = duplicates
      .map((group) => group.employees.map((employee) => employee.fullName).join(' / '))
      .join(' · ');
    warnings.push({
      id: 'duplicate-name',
      tone: 'err',
      title: 'Posible empleado duplicado',
      detail:
        `${names}. Parece la misma persona cargada dos veces (una con el nombre mal escrito). ` +
        'Dejá una sola ficha y borrá o desactivá la otra: con dos fichas, los pagos del banco se ' +
        'reparten entre ambas y el coste de nómina queda partido.',
      count: duplicates.length,
      employees: duplicates.flatMap((group) => group.employees),
    });
  }

  const orphans = findEmployeesWithoutProjects(employees);
  if (orphans.length > 0) {
    warnings.push({
      id: 'missing-projects',
      tone: 'warn',
      title: 'Nómina que no llega a ninguna obra',
      detail:
        `${orphans.length} empleado(s) de nómina no tienen proyectos asignados, así que su coste ` +
        'de empresa no se reparte a ninguna obra y los proyectos muestran menos mano de obra de la ' +
        'real. Editá la ficha y asigná sus proyectos.',
      count: orphans.length,
      employees: orphans,
    });
  }

  return warnings;
};
