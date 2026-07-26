import { useMemo } from 'react';
import { AlertCircle, Clock, Download, TrendingDown, TrendingUp } from 'lucide-react';
import {
 Bar,
 BarChart,
 CartesianGrid,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { exportCXCToPDF, exportCXPToPDF } from '../../utils/pdfExport';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { toPdfTransaction } from '../../finance/reporting';
import { toAgingChartBuckets } from '../../finance/agingView';
import { roundEur } from '../../lib/finance';

const CONFIG = {
 cxc: {
 title: 'Reporte de Cuentas por Cobrar',
 detailTitle: 'Detalle de cartera abierta',
 totalLabel: 'Total por Cobrar',
 primaryColor: 'var(--color-ok)',
 accentClass: 'text-[var(--color-ok)]',
 TrendIcon: TrendingUp,
 exportFn: exportCXCToPDF,
 emptyMessage: 'No hay cuentas por cobrar abiertas',
 },
 cxp: {
 title: 'Reporte de Cuentas por Pagar',
 detailTitle: 'Detalle de deuda abierta',
 totalLabel: 'Total por Pagar',
 primaryColor: 'var(--color-accent)',
 accentClass: 'text-[var(--color-accent)]',
 TrendIcon: TrendingDown,
 exportFn: exportCXPToPDF,
 emptyMessage: 'No hay cuentas por pagar abiertas',
 },
};

const ReportCXCXP = ({ user, type = 'cxc' }) => {
 const cfg = CONFIG[type];
 const ledger = useFinanceLedgerContext();
 const metrics = useTreasuryMetrics({ user, ledger });

 // The aging report is computed once in useTreasuryMetrics by the single engine
 // (lib/finance/aging.js). This screen used to re-bucket the documents itself
 // and put not-yet-due invoices in the "0-30d" tranche, so its chart disagreed
 // with CXC/CXP and Resumen for the same portfolio.
 const report = type === 'cxc' ? metrics.receivablesAgingReport : metrics.payablesAgingReport;

 const rows = useMemo(
 () =>
 toAgingChartBuckets(report, { includeCurrent: true })
 .flatMap((bucket) => bucket.items)
 .map((item) => ({ ...item.doc, openAmount: item.openAmount, daysOverdue: item.daysOverdue }))
 .sort((left, right) => right.daysOverdue - left.daysOverdue),
 [report],
 );

 const totals = useMemo(
 () => ({
 totalAmount: roundEur(report?.totals?.open ?? 0),
 overdueAmount: roundEur(report?.totals?.overdue ?? 0),
 overdueCount: report?.totals?.overdueCount ?? 0,
 criticalAmount: roundEur(report?.d90plus?.amount ?? 0),
 criticalCount: report?.d90plus?.count ?? 0,
 currentAmount: roundEur(report?.current?.amount ?? 0),
 currentCount: report?.current?.count ?? 0,
 }),
 [report],
 );

 // Overdue tranches only — "Al corriente" has its own KPI above the chart.
 const agingData = useMemo(() => toAgingChartBuckets(report), [report]);

 const exportRows = rows.map((entry) =>
 toPdfTransaction({
 ...entry,
 date: entry.dueDate || entry.issueDate,
 amount: entry.openAmount,
 type: type === 'cxc' ? 'income' : 'expense',
 status: 'pending',
 category: entry.source,
 }),
 );

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-24">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 );
 }

 const TrendIcon = cfg.TrendIcon;

 return (
 <div className="space-y-6">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h2 className="text-xl font-medium text-[var(--color-fg-1)]">{cfg.title}</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Documentos abiertos pendientes de cobro o pago.</p>
 </div>
 <button
 type="button"
 onClick={() => cfg.exportFn(exportRows)}
 className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 text-sm font-medium text-[var(--color-fg-1)] transition-colors hover:bg-[var(--color-bg-1)]"
 >
 <Download size={16} />
 Exportar PDF
 </button>
 </div>

 <div className="grid gap-4 md:grid-cols-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-2 flex items-center justify-between">
 <span className="text-sm font-medium text-[var(--color-fg-3)]">{cfg.totalLabel}</span>
 <TrendIcon size={18} style={{ color: cfg.primaryColor }} />
 </div>
 <p className={`text-2xl font-medium ${cfg.accentClass}`}>{formatCurrency(totals.totalAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-4)]">{rows.length} documentos abiertos</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-2 flex items-center justify-between">
 <span className="text-sm font-medium text-[var(--color-fg-3)]">Vencido</span>
 <AlertCircle size={18} className="text-[var(--color-warn)]" />
 </div>
 <p className="text-2xl font-medium text-[var(--color-warn)]">{formatCurrency(totals.overdueAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-4)]">{totals.overdueCount} documentos</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-2 flex items-center justify-between">
 <span className="text-sm font-medium text-[var(--color-fg-3)]">Crítico (+90d)</span>
 <Clock size={18} className="text-[var(--color-warn)]" />
 </div>
 <p className="text-2xl font-medium text-[var(--color-warn)]">{formatCurrency(totals.criticalAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-4)]">{totals.criticalCount} documentos</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-2 flex items-center justify-between">
 <span className="text-sm font-medium text-[var(--color-fg-3)]">Al corriente</span>
 <TrendIcon size={18} className="text-[var(--color-fg-1)]" />
 </div>
 <p className="text-2xl font-medium text-[var(--color-fg-1)]">{formatCurrency(totals.currentAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-4)]">{totals.currentCount} documentos</p>
 </div>
 </div>

 <div className="grid gap-6 lg:grid-cols-2">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <h3 className="mb-4 text-lg font-medium text-[var(--color-fg-1)]">Antigüedad</h3>
 <ResponsiveContainer width="100%" height={260}>
 <BarChart data={agingData}>
 <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickLine={false} axisLine={false} />
 <YAxis tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} />
 <Tooltip
 formatter={(value) => formatCurrency(value)}
 contentStyle={{ backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)', border: '1px solid var(--color-line)', borderRadius: 18 }}
 />
 <Bar dataKey="amount" fill={cfg.primaryColor} radius={0} />
 </BarChart>
 </ResponsiveContainer>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <h3 className="mb-4 text-lg font-medium text-[var(--color-fg-1)]">Resumen por antigüedad</h3>
 <div className="space-y-3">
 {agingData.map((bucket) => (
 <div key={bucket.key} className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{bucket.label}</p>
 <p className="text-xs text-[var(--color-fg-3)]">{bucket.count} documentos</p>
 </div>
 <span className={`text-sm font-medium ${cfg.accentClass}`}>{formatCurrency(bucket.amount)}</span>
 </div>
 ))}
 </div>
 </div>
 </div>

 <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="border-b border-[var(--color-line)] px-5 py-4">
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">{cfg.detailTitle}</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full min-w-[860px] text-left">
 <thead>
 <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
 <th className="px-4 py-3">Vence</th>
 <th className="px-4 py-3">Contraparte</th>
 <th className="px-4 py-3">Documento</th>
 <th className="px-4 py-3">Proyecto</th>
 <th className="px-4 py-3 text-right">Abierto</th>
 <th className="px-4 py-3 text-center">Días</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {rows.map((entry) => (
 <tr key={entry.id} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.dueDate ? formatDate(entry.dueDate) : 'Sin fecha'}</td>
 <td className="px-4 py-3">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{entry.counterpartyName}</p>
 <p className="text-xs text-[var(--color-fg-3)]">{entry.description || 'Sin descripción'}</p>
 </td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-1)]">{entry.documentNumber || 'Sin documento'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.projectName || 'Sin proyecto'}</td>
 <td className={`px-4 py-3 text-right text-sm font-medium ${cfg.accentClass}`}>{formatCurrency(entry.openAmount)}</td>
 <td className="px-4 py-3 text-center">
 <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${entry.daysOverdue > 90 ? 'bg-transparent text-[var(--color-warn)]' : entry.daysOverdue > 30 ? 'bg-transparent text-[var(--color-warn)]' : 'bg-transparent text-[var(--color-ok)]'}`}>
 {entry.daysOverdue} d
 </span>
 </td>
 </tr>
 ))}
 {rows.length === 0 && (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-sm text-[var(--color-fg-3)]">
 {cfg.emptyMessage}
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};

export default ReportCXCXP;
