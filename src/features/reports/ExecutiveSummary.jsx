import { useState } from 'react';
import {
 AlertTriangle,
 ArrowDownRight,
 ArrowUpRight,
 Landmark,
 ShieldAlert,
 Target,
} from 'lucide-react';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { formatCurrency } from '../../utils/formatters';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [
  ...Array.from({ length: CURRENT_YEAR - 2024 }, (_, i) => {
    const y = String(CURRENT_YEAR - i);
    return { value: y, label: i === 0 ? `${y} — Operación actual` : `${y} — Histórico` };
  }),
  { value: 'all', label: 'Todos los años' },
];

const Card = ({ title, value, subtitle, accent, icon }) => {
 const IconComponent = icon;
 return (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg-1)]">{value}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}20`, color: accent }}>
 <IconComponent size={18} />
 </div>
 </div>
 <p className="text-sm text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
 );
};

const ExecutiveSummary = ({ user }) => {
 const [selectedYear, setSelectedYear] = useState('2026');

 const yearRange = selectedYear === 'all'
 ? {}
 : { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` };

 const ledger = useFinanceLedgerContext();
 const metrics = useTreasuryMetrics({ user, ...yearRange, ledger });

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-28">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 );
 }

 const alerts = [
 {
 id: 'cash',
 title: 'Posición de caja',
 body: `Caja actual ${formatCurrency(metrics.currentCash)} y liquidez proyectada ${formatCurrency(metrics.projectedLiquidity)}.`,
 tone: metrics.projectedLiquidity >= 0 ? 'good' : 'bad',
 },
 {
 id: 'collections',
 title: 'Riesgo de cobranza',
 body: `${metrics.overdueReceivables.length} documentos vencidos por cobrar por ${formatCurrency(metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0))}.`,
 tone: metrics.overdueReceivables.length > 0 ? 'bad' : 'good',
 },
 {
 id: 'payments',
 title: 'Presión de pagos',
 body: `${metrics.upcomingPayables.length} pagos dentro de la siguiente ventana por ${formatCurrency(metrics.upcomingPayables.reduce((sum, entry) => sum + entry.openAmount, 0))}.`,
 tone: metrics.upcomingPayables.length > 0 ? 'warning' : 'good',
 },
 ];

 const recommendations = [
 'Actualizar conciliación bancaria semanalmente antes de revisar caja proyectada.',
 'Convertir la cartera vencida en foco comercial hasta que caiga por debajo del 10% de la CXC abierta.',
 'Usar presupuesto anual por proyecto como techo operativo y no solo como referencia histórica.',
 ];

 return (
 <div className="space-y-6">
 {/* Year selector */}
 <div className="flex items-center gap-3 flex-wrap">
 <span className="label-mono text-[var(--color-fg-4)]">Año fiscal</span>
 <div className="flex flex-wrap gap-2">
 {YEAR_OPTIONS.map((opt) => (
 <button
 key={opt.value}
 type="button"
 onClick={() => setSelectedYear(opt.value)}
 className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-all ${
 selectedYear === opt.value
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {opt.label}
 </button>
 ))}
 </div>
 </div>

 <div className="grid gap-4 lg:grid-cols-4">
 <Card title="Caja actual" value={formatCurrency(metrics.currentCash)} subtitle="Saldo operativo real." accent="var(--color-ok)" icon={Landmark} />
 <Card title="Liquidez proyectada" value={formatCurrency(metrics.projectedLiquidity)} subtitle="Caja mas CXC menos CXP." accent="var(--color-fg-3)" icon={Target} />
 <Card title="CXC vencida" value={formatCurrency(metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0))} subtitle={`${metrics.overdueReceivables.length} documentos`} accent="var(--color-accent)" icon={AlertTriangle} />
 <Card title="Cobertura de caja" value={metrics.runwayMonths == null ? 'N/A' : `${metrics.runwayMonths.toFixed(1)} meses`} subtitle="Meses cubiertos al ritmo promedio de egresos." accent="var(--color-warn)" icon={ShieldAlert} />
 </div>

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-5">
 <h3 className="text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Lectura ejecutiva</h3>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Resumen del estado operativo financiero a partir de la operación registrada.</p>
 </div>
 <div className="grid gap-4 lg:grid-cols-3">
 {alerts.map((alert) => (
 <div
 key={alert.id}
 className={`rounded-md border px-4 py-4 ${
 alert.tone === 'good'
 ? 'border-[var(--color-line-s)] bg-transparent'
 : alert.tone === 'warning'
 ? 'border-[var(--color-line-s)] bg-transparent'
 : 'border-[var(--color-line-s)] bg-transparent'
 }`}
 >
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{alert.title}</p>
 <p className="mt-2 text-sm leading-7 text-[var(--color-fg-4)]">{alert.body}</p>
 </div>
 ))}
 </div>
 </section>

 <section className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-5">
 <h3 className="text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Frente de vencimientos</h3>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Prioridades inmediatas de caja.</p>
 </div>
 <div className="space-y-3">
 {[...metrics.upcomingReceivables.slice(0, 3), ...metrics.upcomingPayables.slice(0, 3)].map((entry) => {
 const isInflow = entry.kind === 'receivable';
 return (
 <div key={entry.id} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-2 flex items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 {isInflow ? <ArrowUpRight size={16} className="text-[var(--color-ok)]" /> : <ArrowDownRight size={16} className="text-[var(--color-warn)]" />}
 <span className="text-sm font-medium text-[var(--color-fg-1)]">{entry.counterpartyName}</span>
 </div>
 <span className={`text-sm font-medium ${isInflow ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}>
 {isInflow ? '+' : '-'}
 {formatCurrency(entry.openAmount)}
 </span>
 </div>
 <p className="text-xs text-[var(--color-fg-3)]">{entry.documentNumber || 'Sin documento'} · {entry.dueDate}</p>
 </div>
 );
 })}
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-5">
 <h3 className="text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Recomendaciones</h3>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Acciones sugeridas para la siguiente semana operativa.</p>
 </div>
 <div className="space-y-3">
 {recommendations.map((recommendation) => (
 <div key={recommendation} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <p className="text-sm leading-7 text-[var(--color-fg-4)]">{recommendation}</p>
 </div>
 ))}
 </div>
 </div>
 </section>
 </div>
 );
};

export default ExecutiveSummary;
