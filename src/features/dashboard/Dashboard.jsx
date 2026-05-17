import {
 ArrowDownRight,
 ArrowUpRight,
 ChevronRight,
 FileDown,
 FileUp,
 Wallet,
} from 'lucide-react';
import {
 Bar,
 BarChart,
 CartesianGrid,
 Line,
 LineChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { summarizeVAT } from '../../finance/reporting';
import ForwardProjectionPanel from './ForwardProjectionPanel';

/* ===== NEXUS Tooltip ===== */
const ChartTooltip = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;
 return (
  <div className="border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-3 py-2.5 rounded-md">
  <p className="label-mono text-[var(--color-fg-3)] mb-1.5">{label}</p>
  {payload.map((entry) => (
  <p key={entry.name} className="font-mono text-[13px] tabular-nums" style={{ color: entry.color }}>
 {entry.name}: {formatCurrency(entry.value)}
 </p>
 ))}
 </div>
 );
};

/* ===== Segmented Meter ===== */
const SegmentedBar = ({ value, max, color = 'var(--color-fg-1)', segments = 20, height = 8 }) => {
 const filled = Math.min(segments, Math.round((Math.abs(value) / Math.max(max, 1)) * segments));
 return (
 <div className="flex gap-[2px]">
 {Array.from({ length: segments }).map((_, i) => (
 <div
 key={i}
 className="flex-1"
 style={{
 height,
  background: i < filled ? color : 'var(--color-line)',
 }}
 />
 ))}
 </div>
 );
};

/* ===== Dashboard ===== */
const Dashboard = ({ user, setView, onNewTransaction }) => {
 const metrics = useTreasuryMetrics({ user });
 const vatSummary = summarizeVAT(metrics.postedMovements || []);

 const overdueExposure =
 metrics.overdueReceivables.reduce((sum, e) => sum + e.openAmount, 0) +
 metrics.overduePayables.reduce((sum, e) => sum + e.openAmount, 0);

 const health =
 metrics.runwayMonths != null && metrics.runwayMonths < 3
  ? { label: 'CRITICA', color: 'var(--color-err)' }
  : (metrics.runwayMonths != null && metrics.runwayMonths < 6) || overdueExposure > 10000
  ? { label: 'ALERTA', color: 'var(--color-warn)' }
  : { label: 'ESTABLE', color: 'var(--color-ok)' };

 const netMarginPct =
 metrics.cashInflows > 0
 ? ((metrics.cashInflows - metrics.avgMonthlyOutflows) / metrics.cashInflows * 100).toFixed(1)
 : '0.0';

 const upcomingRows = [...metrics.upcomingReceivables, ...metrics.upcomingPayables]
 .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
 .slice(0, 8)
 .map((entry) => ({ ...entry, direction: entry.kind === 'receivable' ? 'in' : 'out' }));

 const quickActions = [
 { id: 'register-collection', title: 'Registrar cobro', desc: 'Entrada real de dinero.', icon: ArrowUpRight },
 { id: 'register-payment', title: 'Registrar pago', desc: 'Salida real ejecutada.', icon: ArrowDownRight },
 { id: 'create-receivable', title: 'Factura CXC', desc: 'Por cobrar, sin afectar caja.', icon: FileUp },
 { id: 'create-payable', title: 'Factura CXP', desc: 'Por pagar, sin afectar caja.', icon: FileDown },
 { id: 'bank-adjustment', title: 'Ajuste bancario', desc: 'Movimiento directo.', icon: Wallet },
 ];

 /* ===== Loading ===== */
 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-32">
  <p className="label-mono text-[var(--color-fg-3)]">
  Cargando…
 </p>
 </div>
 );
 }

 return (
 <div className="space-y-12 pb-16">

 {/* ===== HERO — Primary Layer: One number dominates ===== */}
 <section className="pt-4">
 <div className="flex flex-col gap-10 xl:flex-row xl:items-end xl:justify-between">
 <div>
  <p className="label-mono text-[var(--color-fg-3)] mb-3">
 Caja real
 </p>
   <p className={`font-display text-[clamp(44px,14vw,64px)] md:text-[80px] leading-[1] tracking-[-0.03em] tabular-nums ${
  metrics.currentCash >= 0 ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-err)]'
 }`}>
 {formatCurrency(metrics.currentCash)}
 </p>
  <p className="label-mono text-[var(--color-fg-4)] mt-2">
 EUR
 </p>

 <div className="flex items-center gap-6 mt-6">
 <span
  className="label-mono"
 style={{ color: health.color }}
 >
  {health.label}
 </span>
 {metrics.runwayMonths != null && (
  <span className="label-mono text-[var(--color-fg-4)]">
 Cobertura {metrics.runwayMonths.toFixed(1)} meses
 </span>
 )}
 </div>
 </div>

 {/* Secondary metrics — right side */}
  <div className="grid gap-px sm:grid-cols-3 xl:min-w-[420px] border border-[var(--color-line)] rounded-md overflow-hidden bg-[var(--color-line)]">
 <button
 type="button"
 onClick={() => setView?.('cashflow')}
  className="bg-[var(--color-bg-1)] px-5 py-4 text-left transition-colors hover:bg-[var(--color-bg-2)]"
 >
  <p className="label-mono text-[var(--color-fg-3)]">Liquidez proy.</p>
  <p className="font-mono text-[22px] tabular-nums text-[var(--color-fg-1)] mt-1">
 {formatCurrency(metrics.projectedLiquidity)}
 </p>
 </button>
 <button
 type="button"
 onClick={() => setView?.('cxc')}
  className="bg-[var(--color-bg-1)] px-5 py-4 text-left transition-colors hover:bg-[var(--color-bg-2)]"
 >
  <p className="label-mono text-[var(--color-fg-3)]">CXC abierta</p>
  <p className="font-mono text-[22px] tabular-nums text-[var(--color-fg-1)] mt-1">
 {formatCurrency(metrics.pendingReceivables)}
 </p>
 </button>
 <button
 type="button"
 onClick={() => setView?.('cxp')}
  className="bg-[var(--color-bg-1)] px-5 py-4 text-left transition-colors hover:bg-[var(--color-bg-2)]"
 >
  <p className="label-mono text-[var(--color-fg-3)]">CXP abierta</p>
  <p className="font-mono text-[22px] tabular-nums text-[var(--color-warn)] mt-1">
 {formatCurrency(metrics.pendingPayables)}
 </p>
 </button>
 </div>
 </div>
 </section>

 {/* ===== KPI ROW — Secondary Layer ===== */}
 <section>
  <div className="grid grid-cols-2 gap-px lg:grid-cols-5 border border-[var(--color-line)] rounded-md overflow-hidden bg-[var(--color-line)]">
 {[
 {
 label: 'Ventana 14d',
 value: `${metrics.next14Net >= 0 ? '+' : ''}${formatCurrency(metrics.next14Net)}`,
  color: metrics.next14Net >= 0 ? 'var(--color-fg-1)' : 'var(--color-err)',
 },
 {
 label: 'Exposicion vencida',
 value: formatCurrency(overdueExposure),
  color: overdueExposure > 0 ? 'var(--color-err)' : 'var(--color-fg-1)',
 onClick: () => setView?.('alertas'),
 },
 {
 label: 'Margen caja estim.',
 value: `${netMarginPct}%`,
  color: parseFloat(netMarginPct) >= 0 ? 'var(--color-ok)' : 'var(--color-err)',
 },
 {
 label: 'Egreso prom. mensual',
 value: formatCurrency(metrics.avgMonthlyOutflows),
  color: 'var(--color-fg-1)',
 },
 {
 label: 'Ingresos registrados',
 value: formatCurrency(metrics.cashInflows),
  color: 'var(--color-fg-1)',
 },
   ].map((kpi) => {
  const Root = kpi.onClick ? 'button' : 'div';
  return (
  <Root
  key={kpi.label}
  type={kpi.onClick ? 'button' : undefined}
  className={`bg-[var(--color-bg-1)] px-5 py-4 text-left ${kpi.onClick ? 'w-full cursor-pointer hover:bg-[var(--color-bg-2)] transition-colors' : ''}`}
  onClick={kpi.onClick}
  >
  <p className="label-mono text-[var(--color-fg-3)]">
 {kpi.label}
 </p>
  <p className="font-mono text-[20px] tabular-nums mt-1" style={{ color: kpi.color }}>
 {kpi.value}
 </p>
  </Root>
  );
  })}
 </div>
 </section>

 {/* ===== VAT — German Umsatzsteuer ===== */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 IVA Aleman — Umsatzsteuer
 </p>
   <div className="grid grid-cols-1 gap-px border border-[var(--color-line)] rounded-md overflow-hidden bg-[var(--color-line)] sm:grid-cols-3">
  <div className="bg-[var(--color-bg-1)] px-5 py-4">
  <p className="label-mono text-[var(--color-fg-3)]">USt (ingresos)</p>
  <p className="font-mono text-[20px] tabular-nums text-[var(--color-warn)] mt-1">{formatCurrency(vatSummary.outputVAT)}</p>
  <p className="font-mono text-[11px] text-[var(--color-fg-4)] mt-1">Debe a Finanzamt</p>
 </div>
   <div className="bg-[var(--color-bg-1)] px-5 py-4">
  <p className="label-mono text-[var(--color-fg-3)]">Vorsteuer (gastos)</p>
  <p className="font-mono text-[20px] tabular-nums text-[var(--color-fg-1)] mt-1">{formatCurrency(vatSummary.inputVAT)}</p>
  <p className="font-mono text-[11px] text-[var(--color-fg-4)] mt-1">Reclamable</p>
 </div>
   <div className="bg-[var(--color-bg-1)] px-5 py-4">
  <p className="label-mono text-[var(--color-fg-3)]">Neto VAT</p>
  <p className={`font-mono text-[20px] tabular-nums mt-1 ${vatSummary.netVAT >= 0 ? 'text-[var(--color-err)]' : 'text-[var(--color-ok)]'}`}>
 {vatSummary.netVAT >= 0 ? '+' : ''}{formatCurrency(vatSummary.netVAT)}
 </p>
  <p className="font-mono text-[11px] text-[var(--color-fg-4)] mt-1">
 {vatSummary.netVAT >= 0 ? 'Pagar' : 'A favor'}
 </p>
 </div>
 </div>
 </section>

 {/* ===== FORWARD PROJECTION — combines CXC, CXP and recurring rules ===== */}
 <ForwardProjectionPanel user={user} />

 {/* ===== CHARTS — Two columns ===== */}
 <div className="grid gap-8 xl:grid-cols-[1.4fr,1fr]">
 {/* Cash trend */}
 <section>
 <div className="flex items-center justify-between mb-4">
  <p className="label-mono text-[var(--color-fg-3)]">
 Caja — 12 semanas
 </p>
 <button
 type="button"
 onClick={() => setView?.('cashflow')}
  className="label-mono text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)] transition-colors"
 >
 Abrir tesoreria <ChevronRight size={12} className="inline" />
 </button>
 </div>
  <div className="border border-[var(--color-line)] rounded-md p-4 bg-[var(--color-bg-1)]">
 <div className="h-[280px]">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={metrics.cashSeries}>
  <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis
 dataKey="label"
  stroke="var(--color-fg-4)"
 tickLine={false}
 axisLine={false}
 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
 />
 <YAxis
  stroke="var(--color-fg-4)"
 tickLine={false}
 axisLine={false}
 tickFormatter={(v) => `${Math.round(v / 1000)}k`}
 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
 />
 <Tooltip content={<ChartTooltip />} />
 <Line
 type="monotone"
 dataKey="balance"
 name="Caja"
  stroke="var(--color-fg-1)"
 strokeWidth={2}
 dot={false}
  activeDot={{ r: 3, fill: 'var(--color-fg-1)' }}
 />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </div>
 </section>

 {/* Weekly projection */}
 <section>
 <div className="flex items-center justify-between mb-4">
  <p className="label-mono text-[var(--color-fg-3)]">
 Compromisos — 8 semanas
 </p>
 </div>
  <div className="border border-[var(--color-line)] rounded-md p-4 bg-[var(--color-bg-1)]">
 <div className="h-[280px]">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={metrics.weeklyProjection} barCategoryGap={12}>
  <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis
 dataKey="week"
  stroke="var(--color-fg-4)"
 tickLine={false}
 axisLine={false}
 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
 />
 <YAxis
  stroke="var(--color-fg-4)"
 tickLine={false}
 axisLine={false}
 tickFormatter={(v) => `${Math.round(v / 1000)}k`}
 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
 />
 <Tooltip content={<ChartTooltip />} />
  <Bar dataKey="committedIn" name="Cobros" fill="var(--color-fg-1)" radius={0} />
  <Bar dataKey="committedOut" name="Pagos" fill="var(--color-fg-4)" radius={0} />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </div>
 </section>
 </div>

 {/* ===== QUICK ACTIONS ===== */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 Acciones rapidas
 </p>
  <div className="grid gap-px grid-cols-2 lg:grid-cols-5 border border-[var(--color-line)] rounded-md overflow-hidden bg-[var(--color-line)]">
 {quickActions.map((action) => {
 const Icon = action.icon;
 return (
 <button
 key={action.id}
 type="button"
 onClick={() => onNewTransaction?.(action.id)}
className="group bg-[var(--color-bg-1)] px-4 py-5 text-left transition-colors hover:bg-[var(--color-bg-2)]"
 >
  <Icon size={16} className="text-[var(--color-fg-4)] mb-3 group-hover:text-[var(--color-fg-1)] transition-colors" />
<p className="label-mono text-[var(--color-fg-1)]">{action.title}</p>
<p className="mt-1 text-[12px] leading-5 text-[var(--color-fg-3)]">{action.desc}</p>
 </button>
 );
 })}
 </div>
 </section>

 {/* ===== UPCOMING + PROJECTS — Two columns ===== */}
 <div className="grid gap-8 xl:grid-cols-[1.2fr,0.8fr]">
 {/* Upcoming */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 Proximos vencimientos
 </p>
  <div className="border border-[var(--color-line)] rounded-md overflow-hidden">
 {upcomingRows.length === 0 ? (
 <div className="px-5 py-12 text-center">
  <p className="text-[14px] text-[var(--color-fg-4)]">No hay vencimientos próximos.</p>
  <p className="text-[12px] text-[var(--color-fg-4)] mt-1">Los documentos aparecerán a medida que se acerque su fecha de cobro o pago.</p>
 </div>
 ) : (
 upcomingRows.map((entry, i) => {
 const isIn = entry.direction === 'in';
 return (
 <div
 key={entry.id}
  className={`flex items-center justify-between gap-4 bg-[var(--color-bg-1)] px-5 py-3.5 transition-colors hover:bg-[var(--color-bg-2)] ${
  i > 0 ? 'border-t border-[var(--color-line)]' : ''
 }`}
 >
 <div className="flex items-center gap-3 min-w-0">
 {isIn ? (
  <ArrowUpRight size={14} className="flex-shrink-0 text-[var(--color-fg-3)]" />
 ) : (
  <ArrowDownRight size={14} className="flex-shrink-0 text-[var(--color-fg-3)]" />
 )}
 <div className="min-w-0">
  <p className="text-[14px] text-[var(--color-fg-1)] truncate">{entry.counterpartyName}</p>
  <p className="font-mono text-[11px] text-[var(--color-fg-4)]">
 {entry.documentNumber || '—'} · {formatDate(entry.dueDate)}
 </p>
 </div>
 </div>
  <p className={`font-mono text-[14px] tabular-nums flex-shrink-0 ${
  isIn ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-warn)]'
 }`}>
 {isIn ? '+' : '-'}{formatCurrency(entry.openAmount)}
 </p>
 </div>
 );
 })
 )}
 </div>
 </section>

 {/* Project margins */}
 <section>
 <div className="flex items-center justify-between mb-4">
  <p className="label-mono text-[var(--color-fg-3)]">
 Resultado por proyecto
 </p>
 <button
 type="button"
 onClick={() => setView?.('proyectos')}
  className="label-mono text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)] transition-colors"
 >
 Detalle <ChevronRight size={12} className="inline" />
 </button>
 </div>
  <div className="border border-[var(--color-line)] rounded-md overflow-hidden">
 {metrics.projectMargins.length === 0 ? (
 <div className="px-5 py-12 text-center">
  <p className="label-mono text-[var(--color-fg-4)]">
 Sin movimientos con proyecto asignado.
 </p>
 </div>
 ) : (
 metrics.projectMargins.map((project, i) => (
 <div
 key={project.name}
  className={`bg-[var(--color-bg-1)] px-5 py-4 ${i > 0 ? 'border-t border-[var(--color-line)]' : ''}`}
 >
 <div className="flex items-center justify-between mb-2">
  <p className="text-[14px] text-[var(--color-fg-1)]">{project.name}</p>
  <p className={`font-mono text-[14px] tabular-nums ${
  project.net >= 0 ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-err)]'
 }`}>
 {project.margin.toFixed(1)}%
 </p>
 </div>
 <SegmentedBar
 value={Math.abs(project.margin)}
 max={100}
  color={project.net >= 0 ? 'var(--color-fg-1)' : 'var(--color-err)'}
 segments={24}
 height={6}
 />
 <div className="flex items-center justify-between mt-2">
  <p className="font-mono text-[11px] text-[var(--color-fg-4)]">
 Ingresos {formatCurrency(project.inflows)} · Costos {formatCurrency(project.outflows)}
 </p>
  <p className={`font-mono text-[11px] ${project.net >= 0 ? 'text-[var(--color-fg-3)]' : 'text-[var(--color-err)]'}`}>
 {project.net >= 0 ? '+' : ''}{formatCurrency(project.net)}
 </p>
 </div>
 </div>
 ))
 )}
 </div>
 </section>
 </div>

 {/* ===== ALERTS + CASH COVERAGE — Tertiary Layer ===== */}
 <div className="grid gap-8 lg:grid-cols-3">
 {/* Radar */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 Radar operativo
 </p>
  <div className="space-y-px border border-[var(--color-line)] rounded-md overflow-hidden bg-[var(--color-line)]">
  <div className="bg-[var(--color-bg-1)] px-5 py-4">
  <p className="label-mono text-[var(--color-err)] mb-1">
  Cartera vencida
 </p>
  <p className="text-[14px] text-[var(--color-fg-1)]">
 {metrics.overdueReceivables.length} docs por cobrar
 </p>
  <p className="font-mono text-[14px] tabular-nums text-[var(--color-err)] mt-0.5">
 {formatCurrency(metrics.overdueReceivables.reduce((s, e) => s + e.openAmount, 0))}
 </p>
 </div>
  <div className="bg-[var(--color-bg-1)] px-5 py-4">
  <p className="label-mono text-[var(--color-warn)] mb-1">
  Pagos vencidos
 </p>
  <p className="text-[14px] text-[var(--color-fg-1)]">
 {metrics.overduePayables.length} docs por pagar
 </p>
  <p className="font-mono text-[14px] tabular-nums text-[var(--color-warn)] mt-0.5">
 {formatCurrency(metrics.overduePayables.reduce((s, e) => s + e.openAmount, 0))}
 </p>
 </div>
 </div>
 </section>

 {/* Cash coverage */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 Cobertura de caja
 </p>
  <div className="border border-[var(--color-line)] rounded-md bg-[var(--color-bg-1)] px-5 py-5">
  <p className="font-display text-[48px] leading-[1] tracking-[-0.02em] text-[var(--color-fg-1)]">
 {metrics.runwayMonths == null ? '—' : metrics.runwayMonths.toFixed(1)}
 </p>
  <p className="label-mono text-[var(--color-fg-4)] mt-1">
 Meses
 </p>
 <div className="mt-4">
 <SegmentedBar
 value={metrics.runwayMonths || 0}
 max={12}
 color={
 metrics.runwayMonths != null && metrics.runwayMonths < 3
  ? 'var(--color-accent)'
 : metrics.runwayMonths != null && metrics.runwayMonths < 6
  ? 'var(--color-warn)'
  : 'var(--color-fg-1)'
 }
 segments={12}
 height={10}
 />
 <div className="flex justify-between mt-1">
  <span className="font-mono text-[9px] text-[var(--color-fg-4)]">0</span>
  <span className="font-mono text-[9px] text-[var(--color-fg-4)]">12m</span>
 </div>
 </div>
  <p className="text-[13px] text-[var(--color-fg-4)] mt-4 leading-relaxed">
 Egreso prom. mensual: {formatCurrency(metrics.avgMonthlyOutflows)}
 </p>
 </div>
 </section>

 {/* Suggested action */}
 <section>
  <p className="label-mono text-[var(--color-fg-3)] mb-4">
 Accion sugerida
 </p>
  <div className="border border-[var(--color-line)] rounded-md bg-[var(--color-bg-1)] px-5 py-5">
  <p className="text-[14px] text-[var(--color-fg-3)] leading-relaxed">
 Prioriza el cobro de la cartera vencida y valida conciliacion semanalmente para mantener la caja proyectada alineada con banco.
 </p>
 <button
 type="button"
 onClick={() => setView?.('conciliacion')}
  className="mt-4 label-mono text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)] transition-colors"
 >
 Ir a conciliacion <ChevronRight size={12} className="inline" />
 </button>
 </div>
 </section>
 </div>
 </div>
 );
};

export default Dashboard;
