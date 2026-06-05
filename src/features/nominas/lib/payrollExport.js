/**
 * Pure row-shaping for personnel-cost exports (Phase 3, item 8).
 *
 * These build plain row arrays the PDF (jsPDF/autoTable) and Excel/CSV writers
 * consume. Keeping the shaping pure makes it unit-testable; the file-write side
 * (jsPDF, Blob download) stays in src/utils/* and is exercised manually.
 */

import { pivotByEmployee } from './payrollPivot.js';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One row per obligation across every period.
 * @param {Array<{period:string, label:string, obligations:Array}>} periods
 * @returns {Array<{period:string, periodLabel:string, kind:string, payee:string, amount:number, dueDate:string|null}>}
 */
export const buildObligationsRows = (periods) => {
  if (!Array.isArray(periods)) return [];
  const rows = [];
  for (const period of periods) {
    if (!period) continue;
    const obligations = Array.isArray(period.obligations) ? period.obligations : [];
    for (const ob of obligations) {
      rows.push({
        period: period.period || '',
        periodLabel: period.label || period.period || '',
        kind: ob.kind || '',
        payee: ob.payee || '',
        amount: cents(ob.amount),
        dueDate: ob.dueDate || null,
      });
    }
  }
  return rows;
};

/**
 * One row per employee with monthly breakdown + YTD totals.
 * Reuses the pivot engine so the export and the on-screen timeline never drift.
 * @param {Array} periods
 * @returns {Array<{persNr:string, name:string, months:Array, ytdNetto:number, ytdBrutto:number, ytdGesamtkosten:number}>}
 */
export const buildPerEmployeeRows = (periods) => {
  if (!Array.isArray(periods) || periods.length === 0) return [];
  return pivotByEmployee(periods).map((row) => ({
    persNr: row.persNr,
    name: row.name,
    months: row.months,
    ytdNetto: row.ytd.netto,
    ytdBrutto: row.ytd.brutto,
    ytdGesamtkosten: row.ytd.gesamtkosten,
  }));
};
