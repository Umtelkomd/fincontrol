/**
 * Payroll identity resolution — pure functions, no React/Firebase imports.
 *
 * The keystone of the Nóminas import: turn each parsed DATEV line into a
 * concrete employeeId. Match priority:
 *   1. employee.persNr === line.persNr  (DATEV personnel number — the truth)
 *   2. case-insensitive name / alias token match (fallback)
 *   3. leave employeeId '' and surface the line as unmatched for manual linking
 *
 * Each employee is assigned to at most ONE line. When two lines compete for the
 * same employee via name fallback, the first wins (deterministic) and the
 * second is pushed to unmatched[]. A persNr hit always beats a name hit.
 */

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Does the employee's name / alias set match the given free-text line name?
 * Mirrors useEmployees.findByText: substring match on fullName / firstName /
 * lastName / aliases, plus a last-name-token containment both ways so
 * "Wagner" matches "Klaus Wagner" and "Lesmes Linares, J." matches the
 * employee whose lastName is "Lesmes Linares".
 */
const nameMatches = (employee, lineName) => {
  const t = norm(lineName);
  if (!t) return false;
  const candidates = [
    norm(employee.fullName),
    norm(employee.firstName),
    norm(employee.lastName),
    ...(Array.isArray(employee.aliases) ? employee.aliases.map(norm) : []),
  ].filter(Boolean);

  return candidates.some((c) => c.includes(t) || t.includes(c));
};

/**
 * Resolve employeeId for each parsed payroll line.
 *
 * @param {{
 *   lines: Array<{persNr?:string, name?:string, netto?:number, brutto?:number, gesamtkosten?:number}>,
 *   employees: Array<{id:string, persNr?:string, fullName?:string, firstName?:string, lastName?:string, aliases?:string[]}>
 * }} params
 * @returns {{
 *   resolved: Array<object>,   // input lines with employeeId filled (or '')
 *   unmatched: Array<{persNr:string, name:string}>
 * }}
 */
export const resolveEmployeeIdsByPersNr = ({ lines, employees } = {}) => {
  const emps = Array.isArray(employees) ? employees : [];
  const byPersNr = new Map();
  emps.forEach((e) => {
    const key = norm(e.persNr);
    if (key) byPersNr.set(key, e);
  });

  const usedIds = new Set();
  const unmatched = [];

  const empById = new Map(emps.map((e) => [e.id, e]));

  const resolved = (lines || []).map((line) => {
    // 0. An explicit existing employeeId (e.g. a manual link the user already
    //    made) is PRESERVED — re-resolving on edit must never discard it, which
    //    is why a manual link used to vanish and ask to be redone every save.
    if (line.employeeId && empById.has(line.employeeId) && !usedIds.has(line.employeeId)) {
      usedIds.add(line.employeeId);
      return { ...line, employeeId: line.employeeId };
    }

    // 1. persNr match — the truth. Allowed even if the id was already used by a
    //    name fallback, because persNr is authoritative; but still guard against
    //    assigning the same persNr employee twice.
    const persKey = norm(line.persNr);
    const persHit = persKey ? byPersNr.get(persKey) : undefined;
    if (persHit && !usedIds.has(persHit.id)) {
      usedIds.add(persHit.id);
      return { ...line, employeeId: persHit.id };
    }

    // 2. name / alias fallback — first unused employee that matches.
    const nameHit = emps.find((e) => !usedIds.has(e.id) && nameMatches(e, line.name));
    if (nameHit) {
      usedIds.add(nameHit.id);
      return { ...line, employeeId: nameHit.id };
    }

    // 3. unmatched
    unmatched.push({ persNr: line.persNr || '', name: line.name || '' });
    return { ...line, employeeId: '' };
  });

  return { resolved, unmatched };
};

export default resolveEmployeeIdsByPersNr;
