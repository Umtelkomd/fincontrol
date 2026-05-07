import React from 'react';
import { TrendingDown, Clock, AlertCircle, Download } from 'lucide-react';
import { formatCurrency, formatDate, getDaysOverdue } from '../../utils/formatters';
import { exportCXPToPDF } from '../../utils/pdfExport';
import {
 BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Button } from '@/components/ui/nexus';

const ReportCXP = ({ transactions }) => {
 // Filtrar solo gastos pendientes
 const payables = transactions.filter(t => t.type === 'expense' && ['pending', 'partial', 'overdue', 'issued'].includes(t.status));

 // Calcular métricas
 const totalPayable = payables.reduce((sum, t) => sum + t.amount, 0);

 // Análisis de antigüedad
 const agingAnalysis = {
 current: { label: '0-30 dias', count: 0, amount: 0 },
 days30_60: { label: '31-60 dias', count: 0, amount: 0 },
 days60_90: { label: '61-90 dias', count: 0, amount: 0 },
 over90: { label: '90+ dias', count: 0, amount: 0 }
 };

 payables.forEach(t => {
 const daysOverdue = getDaysOverdue(t.dueDate || t.date);
 if (daysOverdue <= 30) {
 agingAnalysis.current.count++;
 agingAnalysis.current.amount += t.amount;
 } else if (daysOverdue <= 60) {
 agingAnalysis.days30_60.count++;
 agingAnalysis.days30_60.amount += t.amount;
 } else if (daysOverdue <= 90) {
 agingAnalysis.days60_90.count++;
 agingAnalysis.days60_90.amount += t.amount;
 } else {
 agingAnalysis.over90.count++;
 agingAnalysis.over90.amount += t.amount;
 }
 });

 const chartData = Object.values(agingAnalysis).map(item => ({
 name: item.label,
 monto: item.amount
 }));

 // Métricas resumen
 const overdueAmount = agingAnalysis.over90.amount;
 const criticalAmount = agingAnalysis.days60_90.amount + agingAnalysis.over90.amount;
 const currentAmount = agingAnalysis.current.amount;

 return (
 <div className="space-y-6">
 <div className="flex justify-between items-center">
 <div>
 <h2 className="text-xl font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Reporte de cuentas por pagar</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Antigüedad, vencimientos y detalle operativo de pagos pendientes.</p>
 </div>
 <Button variant="primary" icon={Download} onClick={() => exportCXPToPDF(transactions)}>
 Exportar PDF
 </Button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-fg-3)]">Total por pagar</h3>
 <TrendingDown className="text-[var(--color-accent)]" size={20} />
 </div>
 <p className="text-2xl font-medium text-[var(--color-accent)]">{formatCurrency(totalPayable)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">{payables.length} facturas</p>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-fg-3)]">Monto vencido</h3>
 <AlertCircle className="text-[var(--color-accent)]" size={20} />
 </div>
 <p className="text-2xl font-medium text-[var(--color-accent)]">{formatCurrency(overdueAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">{agingAnalysis.over90.count} facturas</p>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-fg-3)]">Crítico (90+ días)</h3>
 <Clock className="text-[var(--color-warn)]" size={20} />
 </div>
 <p className="text-2xl font-medium text-[var(--color-warn)]">{formatCurrency(criticalAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">{agingAnalysis.days60_90.count + agingAnalysis.over90.count} facturas</p>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-fg-3)]">Al corriente</h3>
 <TrendingDown className="text-[var(--color-ok)]" size={20} />
 </div>
 <p className="text-2xl font-medium text-[var(--color-ok)]">{formatCurrency(currentAmount)}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">{agingAnalysis.current.count} facturas</p>
 </div>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <h3 className="mb-4 text-lg font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Análisis de antigüedad</h3>
 <ResponsiveContainer width="100%" height={250}>
 <BarChart data={chartData}>
 <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
 <XAxis dataKey="name" tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} />
 <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} />
 <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: '16px', border: '1px solid var(--color-line)', backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)' }} />
 <Bar dataKey="monto" fill="var(--color-accent)" radius={0} />
 </BarChart>
 </ResponsiveContainer>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <h3 className="mb-4 text-lg font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Resumen por antigüedad</h3>
 <table className="w-full">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="py-2 text-left text-sm font-medium text-[var(--color-fg-3)]">Periodo</th>
 <th className="py-2 text-center text-sm font-medium text-[var(--color-fg-3)]">Facturas</th>
 <th className="py-2 text-right text-sm font-medium text-[var(--color-fg-3)]">Monto</th>
 </tr>
 </thead>
 <tbody>
 {Object.values(agingAnalysis).map((item, idx) => (
 <tr key={idx} className="border-b border-[var(--color-bg-1)]">
 <td className="py-3 text-sm text-[var(--color-fg-1)]">{item.label}</td>
 <td className="py-3 text-center text-sm text-[var(--color-fg-4)]">{item.count}</td>
 <td className="py-3 text-right text-sm font-medium text-[var(--color-accent)]">{formatCurrency(item.amount)}</td>
 </tr>
 ))}
 <tr className="bg-[var(--color-bg-2)]">
 <td className="py-3 text-sm font-medium text-[var(--color-fg-1)]">Total</td>
 <td className="py-3 text-center text-sm font-medium text-[var(--color-fg-1)]">{payables.length}</td>
 <td className="py-3 text-right text-sm font-medium text-[var(--color-accent)]">{formatCurrency(totalPayable)}</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="border-b border-[var(--color-line)] px-6 py-4">
 <h3 className="text-lg font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Detalle de cuentas por pagar</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <tr>
 <th className="px-4 py-3 text-xs font-medium uppercase text-[var(--color-fg-3)]">Fecha</th>
 <th className="px-4 py-3 text-xs font-medium uppercase text-[var(--color-fg-3)]">Descripción</th>
 <th className="px-4 py-3 text-xs font-medium uppercase text-[var(--color-fg-3)]">Proyecto</th>
 <th className="px-4 py-3 text-xs font-medium uppercase text-[var(--color-fg-3)]">Categoría</th>
 <th className="px-4 py-3 text-right text-xs font-medium uppercase text-[var(--color-fg-3)]">Monto</th>
 <th className="px-4 py-3 text-center text-xs font-medium uppercase text-[var(--color-fg-3)]">Días</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {payables.map(t => {
 const days = getDaysOverdue(t.dueDate || t.date);
 return (
 <tr key={t.id} className="transition-colors hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{formatDate(t.date)}</td>
 <td className="px-4 py-3 text-sm font-medium text-[var(--color-fg-1)]">{t.description}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-4)]">{t.project || '-'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-4)]">{t.category || '-'}</td>
 <td className="px-4 py-3 text-right text-sm font-medium text-[var(--color-accent)]">{formatCurrency(t.amount)}</td>
 <td className="px-4 py-3 text-center">
 <span className={`px-2 py-1 rounded-full text-xs font-medium ${
 days > 90 ? 'bg-transparent text-[var(--color-accent)]' :
 days > 60 ? 'bg-transparent text-[var(--color-warn)]' :
 days > 30 ? 'bg-transparent text-[var(--color-warn)]' :
 'bg-transparent text-[var(--color-ok)]'
 }`}>
 {days} días
 </span>
 </td>
 </tr>
 );
 })}
 {payables.length === 0 && (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-[var(--color-fg-3)]">
 No hay cuentas por pagar pendientes
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

export default ReportCXP;
