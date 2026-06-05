/**
 * Per-employee payroll pivot (Phase 3, item 2) — pure, no side effects.
 *
 * Pivots period.lines[] by a stable employee key (persNr → employeeId → name)
 * into one row per employee carrying monthly netto/brutto/gesamtkosten, YTD
 * totals, and a gesamtkosten sparkline that is 0-filled across the full period
 * axis so the line stays continuous even when an employee is absent some months.
 */

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const employeeKey = (line) =>
  line.persNr || line.employeeId || line.name || 'desconocido';

/**
 * @param {Array<{period:string, lines:Array<{persNr?:string, employeeId?:string, name?:string, netto:number, brutto:number, gesamtkosten:number}>}>} periods
 * @returns {Array<{persNr:string, employeeId:string, name:string,
 *   months:Array<{period:string, netto:number, brutto:number, gesamtkosten:number}>,
 *   ytd:{netto:number, brutto:number, gesamtkosten:number},
 *   sparkline:Array<number>}>}
 */
export const pivotByEmployee = (periods) => {
  if (!Array.isArray(periods) || periods.length === 0) return [];

  // Full sorted period axis — used to 0-fill sparklines for continuity.
  const periodAxis = [...periods]
    .filter((p) => p && p.period)
    .map((p) => p.period)
    .sort((a, b) => a.localeCompare(b));

  const byEmployee = new Map();

  for (const period of periods) {
    if (!period || !Array.isArray(period.lines)) continue;
    for (const line of period.lines) {
      const key = employeeKey(line);
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          persNr: line.persNr || '',
          employeeId: line.employeeId || '',
          name: line.name || '',
          monthsByPeriod: new Map(),
        });
      }
      const row = byEmployee.get(key);
      // Backfill identity if a later line carries more info.
      if (!row.persNr && line.persNr) row.persNr = line.persNr;
      if (!row.employeeId && line.employeeId) row.employeeId = line.employeeId;
      if (!row.name && line.name) row.name = line.name;
      row.monthsByPeriod.set(period.period, {
        period: period.period,
        netto: cents(line.netto),
        brutto: cents(line.brutto),
        gesamtkosten: cents(line.gesamtkosten),
      });
    }
  }

  return [...byEmployee.values()].map((row) => {
    const months = [...row.monthsByPeriod.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    const ytd = months.reduce(
      (acc, m) => ({
        netto: cents(acc.netto + m.netto),
        brutto: cents(acc.brutto + m.brutto),
        gesamtkosten: cents(acc.gesamtkosten + m.gesamtkosten),
      }),
      { netto: 0, brutto: 0, gesamtkosten: 0 },
    );
    // Sparkline 0-filled across the full axis for visual continuity.
    const sparkline = periodAxis.map(
      (p) => row.monthsByPeriod.get(p)?.gesamtkosten ?? 0,
    );
    return {
      persNr: row.persNr,
      employeeId: row.employeeId,
      name: row.name,
      months,
      ytd,
      sparkline,
    };
  });
};
