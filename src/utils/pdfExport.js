import { formatCurrency, formatDate } from './formatters';
import {
  buildObligationsRows,
  buildPerEmployeeRows,
} from '../features/nominas/lib/payrollExport.js';

const loadPdf = async () => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
};

export const exportTransactionsToPDF = async (transactions, title = 'Reporte de Transacciones') => {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();

  // Header
  doc.setFontSize(20);
  doc.setTextColor(30, 58, 138); // blue-800
  doc.text('UMTELKOMD', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Sistema Financiero', 14, 26);

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(title, 14, 40);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 48);
  doc.text(`Total de registros: ${transactions.length}`, 14, 54);

  // Calculate totals
  const totals = transactions.reduce((acc, t) => {
    if (t.type === 'income') {
      acc.income += t.amount;
    } else {
      acc.expense += t.amount;
    }
    return acc;
  }, { income: 0, expense: 0 });

  // Summary box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(14, 60, 180, 25, 'F');

  doc.setFontSize(10);
  doc.setTextColor(34, 197, 94); // green-500
  doc.text(`Total Ingresos: ${formatCurrency(totals.income)}`, 20, 70);

  doc.setTextColor(239, 68, 68); // red-500
  doc.text(`Total Gastos: ${formatCurrency(totals.expense)}`, 80, 70);

  doc.setTextColor(30, 41, 59);
  doc.text(`Balance: ${formatCurrency(totals.income - totals.expense)}`, 140, 70);

  // Table
  const tableData = transactions.map(t => [
    formatDate(t.date),
    t.description,
    t.project || '-',
    t.category || '-',
    t.type === 'income' ? formatCurrency(t.amount) : '-',
    t.type === 'expense' ? formatCurrency(t.amount) : '-',
    t.status === 'paid' ? 'Pagado' : 'Pendiente'
  ]);

  autoTable(doc, {
    startY: 90,
    head: [['Fecha', 'Descripción', 'Proyecto', 'Categoría', 'Ingreso', 'Gasto', 'Estado']],
    body: tableData,
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontSize: 9,
      fontStyle: 'bold'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [51, 65, 85]
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 45 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 18, halign: 'center' }
    },
    margin: { left: 14, right: 14 }
  });

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Página ${i} de ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' }
    );
  }

  // Download
  const fileName = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};

export const exportCXPToPDF = async (transactions) => {
  const cxp = transactions.filter(t => t.type === 'expense' && t.status === 'pending');
  await exportTransactionsToPDF(cxp, 'Cuentas por Pagar (CXP)');
};

export const exportCXCToPDF = async (transactions) => {
  const cxc = transactions.filter(t => t.type === 'income' && t.status === 'pending');
  await exportTransactionsToPDF(cxc, 'Cuentas por Cobrar (CXC)');
};

export const exportReportToPDF = async (transactions, reportType = 'general') => {
  const titles = {
    general: 'Reporte General',
    monthly: 'Reporte Mensual',
    project: 'Reporte por Proyecto'
  };
  await exportTransactionsToPDF(transactions, titles[reportType] || 'Reporte');
};

export const exportAuditTrailToPDF = async (record, entries = []) => {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();

  const safeRecordName = record?.description || record?.documentNumber || 'Registro';
  const fileLabel = `${record?.recordFamilyLabel || 'Registro'} · ${safeRecordName}`;

  doc.setFontSize(20);
  doc.setTextColor(30, 58, 138);
  doc.text('UMTELKOMD', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Historial de auditoría por registro', 14, 26);

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Trazabilidad del registro', 14, 40);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 48);
  doc.text(`Registro: ${fileLabel}`, 14, 54);
  doc.text(`Total de eventos: ${entries.length}`, 14, 60);

  doc.setFillColor(248, 250, 252);
  doc.rect(14, 68, 180, 22, 'F');

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`Documento: ${record?.documentNumber || 'Sin documento'}`, 20, 77);
  doc.text(`Contraparte: ${record?.counterpartyName || 'Sin contraparte'}`, 20, 83);
  doc.text(`Importe: €${formatCurrency(record?.amount || 0)}`, 110, 77);
  doc.text(`Estado: ${record?.statusLabel || record?.status || '—'}`, 110, 83);

  const tableData = entries.map((entry) => [
    formatDate(entry.timestamp || new Date().toISOString()),
    entry.action || '-',
    entry.user || 'Sistema',
    entry.source === 'global' ? 'Global' : 'Documento',
    entry.description || '-',
  ]);

  autoTable(doc, {
    startY: 98,
    head: [['Fecha', 'Acción', 'Usuario', 'Origen', 'Detalle']],
    body: tableData,
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [51, 65, 85],
      valign: 'top',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 24 },
      2: { cellWidth: 36 },
      3: { cellWidth: 20 },
      4: { cellWidth: 84 },
    },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Página ${i} de ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' },
    );
  }

  const fileName = `audit_${safeRecordName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};

// ─── Phase 3, item 8 — Personnel-cost report (Steuerberater) ──────────────────

/**
 * Monthly + YTD personnel-cost PDF for the tax advisor.
 * Reuses the UMTELKOMD header, autoTable styling and footer loop from the rest
 * of this module. All numbers come from the pure payrollExport shaping helpers.
 *
 * @param {Array} periods - payroll periods (with obligations[] + lines[])
 */
export const exportPersonnelCostPDF = async (periods = []) => {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();

  const obligationRows = buildObligationsRows(periods);
  const employeeRows = buildPerEmployeeRows(periods);

  const ytd = employeeRows.reduce(
    (acc, r) => ({
      netto: acc.netto + r.ytdNetto,
      brutto: acc.brutto + r.ytdBrutto,
      gesamtkosten: acc.gesamtkosten + r.ytdGesamtkosten,
    }),
    { netto: 0, brutto: 0, gesamtkosten: 0 },
  );

  doc.setFontSize(20);
  doc.setTextColor(30, 58, 138);
  doc.text('UMTELKOMD', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Coste de personal — Steuerberater', 14, 26);

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Reporte de coste de personal', 14, 40);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 48);
  doc.text(`Períodos: ${periods.length} · Empleados: ${employeeRows.length}`, 14, 54);

  doc.setFillColor(248, 250, 252);
  doc.rect(14, 60, 180, 22, 'F');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`YTD Neto: ${formatCurrency(ytd.netto)}`, 20, 70);
  doc.text(`YTD Bruto: ${formatCurrency(ytd.brutto)}`, 80, 70);
  doc.text(`YTD Coste empresa: ${formatCurrency(ytd.gesamtkosten)}`, 140, 70);

  autoTable(doc, {
    startY: 90,
    head: [['Empleado', 'Pers.-Nr', 'YTD Neto', 'YTD Bruto', 'YTD Coste empresa']],
    body: employeeRows.map((r) => [
      r.name,
      r.persNr || '-',
      formatCurrency(r.ytdNetto),
      formatCurrency(r.ytdBrutto),
      formatCurrency(r.ytdGesamtkosten),
    ]),
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 24 },
      2: { cellWidth: 33, halign: 'right' },
      3: { cellWidth: 33, halign: 'right' },
      4: { cellWidth: 34, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  const afterEmployees = doc.lastAutoTable?.finalY || 90;
  autoTable(doc, {
    startY: afterEmployees + 10,
    head: [['Período', 'Tipo', 'Acreedor', 'Importe', 'Vence']],
    body: obligationRows.map((o) => [
      o.periodLabel,
      o.kind,
      o.payee,
      formatCurrency(o.amount),
      o.dueDate ? formatDate(o.dueDate) : '-',
    ]),
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Página ${i} de ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' },
    );
  }

  doc.save(`coste_personal_${new Date().toISOString().split('T')[0]}.pdf`);
};

/**
 * Immutable closed-period dossier (Phase 3, item 8). Embeds the persisted
 * document fingerprints (sha-256) and the audit trail recorded at load time.
 *
 * NOTE ON IMMUTABILITY: this certifies what was RECORDED when the period was
 * loaded (the stored hashes + auditTrail), not a re-hash of the source files on
 * disk at export time. The copy makes that explicit.
 *
 * @param {object} period - a payroll period doc with documents[] + auditTrail[]
 */
export const exportPayrollDossierPDF = async (period) => {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();

  const label = period?.label || period?.period || 'Período';
  const documents = Array.isArray(period?.documents) ? period.documents : [];
  const auditTrail = Array.isArray(period?.auditTrail) ? period.auditTrail : [];

  doc.setFontSize(20);
  doc.setTextColor(30, 58, 138);
  doc.text('UMTELKOMD', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Dossier de nómina — período cerrado', 14, 26);

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(`Dossier ${label}`, 14, 40);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 48);
  doc.text(`Estado: ${period?.status || '—'}`, 14, 54);

  doc.setFillColor(248, 250, 252);
  doc.rect(14, 60, 180, 22, 'F');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`Gasto en caja: ${formatCurrency(period?.cashTotal || 0)}`, 20, 70);
  doc.text(`Coste empresa: ${formatCurrency(period?.employerCostTotal || 0)}`, 110, 70);
  doc.text(`Empleados: ${period?.payCount || 0} / ${period?.employeeCount || 0}`, 20, 77);

  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text('Documentos origen (huella SHA-256)', 14, 92);
  autoTable(doc, {
    startY: 96,
    head: [['Archivo', 'Tipo', 'SHA-256', 'Importado']],
    body: documents.map((d) => [
      d.fileName || '-',
      d.kind || '-',
      d.hash || '(sin huella)',
      d.importedAt ? formatDate(d.importedAt) : '-',
    ]),
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7, textColor: [51, 65, 85], valign: 'top' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 18 },
      2: { cellWidth: 96 },
      3: { cellWidth: 26 },
    },
    margin: { left: 14, right: 14 },
  });

  const afterDocs = doc.lastAutoTable?.finalY || 96;
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text('Historial de auditoría', 14, afterDocs + 12);
  autoTable(doc, {
    startY: afterDocs + 16,
    head: [['Fecha', 'Acción', 'Usuario', 'Detalle']],
    body: auditTrail.map((e) => [
      e.timestamp ? formatDate(e.timestamp) : '-',
      e.action || '-',
      e.user || 'Sistema',
      e.detail || '-',
    ]),
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85], valign: 'top' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  // Immutability disclaimer
  const afterAudit = doc.lastAutoTable?.finalY || afterDocs + 16;
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    'Este dossier certifica las huellas y el historial registrados al cargar el período, no un nuevo cálculo de los archivos de origen.',
    14,
    afterAudit + 8,
    { maxWidth: 180 },
  );

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Página ${i} de ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' },
    );
  }

  doc.save(`dossier_nomina_${(period?.period || 'periodo')}_${new Date().toISOString().split('T')[0]}.pdf`);
};
