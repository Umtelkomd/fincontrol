// Payroll Excel/CSV export (Phase 3, item 8).
//
// The "2-sheet workbook" requirement (Sheet 1 = obligations, Sheet 2 =
// per-employee) is delivered as TWO Excel-compatible BOM-CSV files. The shared
// excelExport.js util is CSV-only and cannot author a true multi-sheet .xlsx;
// adding a sheetjs (xlsx) dependency was deliberately deferred (bundle size +
// new dep) — see the Phase 3 report. The BOM + semicolon + download-link
// pattern below mirrors src/utils/excelExport.js exactly.

import {
  buildObligationsRows,
  buildPerEmployeeRows,
} from '../features/nominas/lib/payrollExport.js';

const BOM = '﻿';

const escapeCell = (cell) => {
  const str = String(cell ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsv = (headers, rows) =>
  [headers.join(';'), ...rows.map((row) => row.map(escapeCell).join(';'))].join('\n');

const download = (csvContent, filename) => {
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Export the two personnel-cost "sheets" as two BOM-CSV files.
 * @param {Array} periods - payroll periods
 */
export const exportPayrollWorkbook = (periods = []) => {
  // Sheet 1 — obligations
  const obligationRows = buildObligationsRows(periods);
  const obligationsCsv = toCsv(
    ['Periodo', 'Tipo', 'Acreedor', 'Importe', 'Vence'],
    obligationRows.map((o) => [o.periodLabel, o.kind, o.payee, o.amount, o.dueDate || '']),
  );
  download(obligationsCsv, 'nomina_obligaciones');

  // Sheet 2 — per-employee with YTD totals
  const employeeRows = buildPerEmployeeRows(periods);
  const employeeCsv = toCsv(
    ['Pers.-Nr', 'Empleado', 'YTD Neto', 'YTD Bruto', 'YTD Coste empresa', 'Meses'],
    employeeRows.map((r) => [
      r.persNr || '',
      r.name,
      r.ytdNetto,
      r.ytdBrutto,
      r.ytdGesamtkosten,
      r.months.length,
    ]),
  );
  download(employeeCsv, 'nomina_por_empleado');
};
