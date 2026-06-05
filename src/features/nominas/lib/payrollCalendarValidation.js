/**
 * Joiner/leaver mid-month validation (Phase 3, item 6) — pure, no side effects.
 *
 * Cross-checks a period's lines against the employee roster using startDate /
 * endDate to surface two anomalies:
 *   - ghosts: a line for someone whose endDate is BEFORE the period started
 *     (paid after they left — a real error). A mid-month leaver (endDate inside
 *     the period) is NOT a ghost.
 *   - missingActives: an employee active during the period (startDate <= period
 *     end AND (no endDate OR endDate >= period start)) with no matching line.
 *
 * allowPartialOverride suppresses BOTH flags so an operator can deliberately
 * load a partial-month roster after reviewing the warnings.
 */

/** First day of a YYYY-MM period, e.g. '2026-03' → '2026-03-01'. */
const periodStart = (period) => `${period}-01`;

/** Last day of a YYYY-MM period, e.g. '2026-03' → '2026-03-31'. */
const periodEnd = (period) => {
  const [year, month] = String(period).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // month is 1-based here
  return `${period}-${String(lastDay).padStart(2, '0')}`;
};

const matchLineToEmployee = (line, emp) => {
  if (line.employeeId && emp.id && line.employeeId === emp.id) return true;
  if (line.persNr && emp.persNr && line.persNr === emp.persNr) return true;
  return false;
};

/**
 * @param {{
 *   period: string,
 *   lines: Array<{employeeId?:string, persNr?:string, name?:string}>,
 *   employees: Array<{id:string, persNr?:string, fullName?:string, status?:string, startDate?:string, endDate?:string}>,
 *   allowPartialOverride?: boolean
 * }} params
 * @returns {{ ghosts:Array, missingActives:Array, ok:boolean }}
 */
export const validatePayrollRoster = ({
  period,
  lines,
  employees,
  allowPartialOverride = false,
} = {}) => {
  const safeLines = Array.isArray(lines) ? lines : [];
  const safeEmployees = Array.isArray(employees) ? employees : [];

  if (allowPartialOverride || !period) {
    return { ghosts: [], missingActives: [], ok: true };
  }

  const start = periodStart(period);
  const end = periodEnd(period);

  // ── Ghosts: a line whose matched employee left before the period started ──
  const ghosts = [];
  for (const line of safeLines) {
    const emp = safeEmployees.find((e) => matchLineToEmployee(line, e));
    if (!emp) continue; // unmatched lines are handled elsewhere
    if (emp.endDate && emp.endDate < start) {
      ghosts.push({
        persNr: line.persNr || emp.persNr || '',
        name: line.name || emp.fullName || '',
        reason: `endDate ${emp.endDate} < período`,
      });
    }
  }

  // ── Missing actives: an employee active in the period with no line ──
  const missingActives = [];
  for (const emp of safeEmployees) {
    const startedByEnd = !emp.startDate || emp.startDate <= end;
    const notLeftBeforeStart = !emp.endDate || emp.endDate >= start;
    const activeInPeriod = startedByEnd && notLeftBeforeStart;
    if (!activeInPeriod) continue;
    // Only consider employees whose status marks them as currently employed.
    if (emp.status && emp.status === 'inactive') continue;
    const hasLine = safeLines.some((line) => matchLineToEmployee(line, emp));
    if (!hasLine) {
      missingActives.push({
        employeeId: emp.id || '',
        persNr: emp.persNr || '',
        name: emp.fullName || '',
      });
    }
  }

  return {
    ghosts,
    missingActives,
    ok: ghosts.length === 0 && missingActives.length === 0,
  };
};
