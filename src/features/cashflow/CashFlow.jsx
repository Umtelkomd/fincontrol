import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
 ArrowDownLeft,
 ArrowDownRight,
 ArrowUpRight,
 CheckCircle2,
 Clock3,
 Landmark,
 ShieldAlert,
} from 'lucide-react';
import HelpButton from '../../components/ui/HelpButton';
import PageHeader from '../../components/layout/PageHeader';
import LiquidityKpis from '../../components/finance/LiquidityKpis';
import { Badge, KPI, KPIGrid } from '@/components/ui/nexus';
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
import { useCashForecast } from '../../hooks/useCashForecast';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { isInternalTransfer } from '../../lib/finance/movementAmount';
import {
 formatCollectionSlip,
 formatCurrency,
 formatDate,
 formatVatCoverage,
} from '../../utils/formatters';

const TooltipCard = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;
 return (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-3 ">
 <p className="label-mono text-[var(--color-fg-3)] mb-2">{label}</p>
 {payload.map((entry) => (
 <p key={entry.name} className="font-mono text-sm" style={{ color: entry.color }}>
 {entry.name}: {formatCurrency(entry.value)}
 </p>
 ))}
 </div>
 );
};

const Section = ({ title, subtitle, children, help }) => (
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-5">
 <div className="flex items-center gap-2">
 <h3 className="font-display text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">{title}</h3>
 {help}
 </div>
 {subtitle && <p className="mt-1 text-sm text-[var(--color-fg-3)]">{subtitle}</p>}
 </div>
 {children}
 </section>
);

const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** 'YYYY-MM' → 'Jul 2026'; unparseable keys are shown as they are. */
const monthLabel = (monthKey) => {
 const [year, month] = String(monthKey || '').split('-');
 const name = SHORT_MONTHS[Number(month) - 1];
 return name ? `${name} ${year}` : monthKey;
};

const CashFlow = ({ user }) => {
 const ledger = useFinanceLedgerContext();
 const metrics = useTreasuryMetrics({ user, ledger });
 const forecast = useCashForecast(user, { ledger });
 const navigate = useNavigate();
 const movementsRef = useRef(null);
 const reconciliationRef = useRef(null);

 // The weekly commitment bars read the single forecast. Outflows come out of
 // the engine signed negative; the chart wants magnitudes.
 const weeklyCommitments = useMemo(
 () =>
 forecast.weeks.map((week) => ({
 week: week.week,
 label: week.label,
 committedIn: week.inflow,
 committedOut: Math.abs(week.outflow),
 })),
 [forecast.weeks],
 );

 // Explicitly a P&L strip: own-account transfers are excluded from both bars.
 // The forecast and balance blocks on this screen keep counting them.
 const monthlyPL = useMemo(() => {
 const now = new Date();
 const months = [];
 for (let i = 5; i >= 0; i--) {
 const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
 const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
 months.push({ ym, label: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`, inflows: 0, outflows: 0, net: 0 });
 }
 (metrics.postedMovements || []).forEach((m) => {
 const ym = m.postedDate?.slice(0, 7);
 if (!ym) return;
 if (isInternalTransfer(m)) return;
 const bucket = months.find((b) => b.ym === ym);
 if (!bucket) return;
 if (m.direction === 'in') bucket.inflows += m.amount;
 else bucket.outflows += m.amount;
 });
 months.forEach((b) => { b.net = b.inflows - b.outflows; });
 return months;
 }, [metrics.postedMovements]);

 // Upcoming Umsatzsteuer, in filing order. A month the owner typed by hand has
 // already won by the time it reaches here (see finance/vatObligation.js); this
 // screen only decides what to show and how honestly to label it.
 const vatUpcoming = useMemo(
 () =>
 (forecast.vatObligations || [])
 .filter((entry) => entry.dueDate && entry.dueDate >= forecast.today)
 .sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
 [forecast.vatObligations, forecast.today],
 );

 // Weighted by amount, never an average of percentages: one fully classified
 // 200 € month must not paper over a 40%-classified 20.000 € one.
 const vatCoverage = useMemo(() => {
 const derived = vatUpcoming.filter((entry) => entry.source === 'derived');
 const total = derived.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
 const known = derived.reduce((sum, entry) => sum + (entry.knownAmount || 0), 0);
 return total > 0 ? known / total : null;
 }, [vatUpcoming]);

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-28">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 );
 }

 const recentMovements = [...metrics.filteredMovements]
 .sort((left, right) => (right.postedDate || '').localeCompare(left.postedDate || ''))
 .slice(0, 12);

 return (
 <div className="space-y-6 pb-12">
 <PageHeader
 section="Tesorería"
 title="Caja y"
 accent="vencimientos"
 subtitle="Caja conciliada, próximos cobros y pagos, IVA y movimientos"
 />

 {/* The same three numbers Resumen and the executive summary print. */}
 <LiquidityKpis metrics={metrics} forecast={forecast} size="lg" />

 <KPIGrid cols={2}>
 <KPI
 label="Cobros próximos"
 value={formatCurrency(metrics.upcomingReceivables.reduce((sum, entry) => sum + entry.openAmount, 0))}
 tone="ok"
 icon={ArrowUpRight}
 meta={`${metrics.upcomingReceivables.length} documento(s) CXC con vencimiento en 14 días`}
 onClick={() => movementsRef.current?.scrollIntoView({ behavior: 'smooth' })}
 />
 <KPI
 label="Pagos próximos"
 value={formatCurrency(metrics.upcomingPayables.reduce((sum, entry) => sum + entry.openAmount, 0))}
 tone="warn"
 icon={ArrowDownRight}
 meta={`${metrics.upcomingPayables.length} documento(s) CXP con vencimiento en 14 días`}
 onClick={() => reconciliationRef.current?.scrollIntoView({ behavior: 'smooth' })}
 />
 </KPIGrid>

 <p className="text-[12px] text-[var(--color-fg-4)]">
 Caja conciliada: último ancla + movimientos bancarios posteriores.
 </p>

 <Section title="Estado de Resultados" subtitle="Ingresos vs gastos realizados, agrupados por mes." help={
 <HelpButton title="Estado de Resultados" size={14}>
 <p>Resumen de ingresos y gastos reales de los ultimos 6 meses.</p>
 <p>Solo incluye movimientos contabilizados (cobros y pagos ejecutados), no compromisos pendientes.</p>
 </HelpButton>
 }>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="px-3 py-2.5 label-mono text-[var(--color-fg-3)]">Mes</th>
 <th className="px-3 py-2.5 text-right label-mono text-[var(--color-fg-3)]">Ingresos</th>
 <th className="px-3 py-2.5 text-right label-mono text-[var(--color-fg-3)]">Gastos</th>
 <th className="px-3 py-2.5 text-right label-mono text-[var(--color-fg-3)]">Resultado</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {monthlyPL.map((row) => (
 <tr key={row.ym} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-3 py-3 text-[13px] font-medium text-[var(--color-fg-1)]">{row.label}</td>
 <td className="px-3 py-3 text-right text-[13px] font-medium text-[var(--color-ok)]">{formatCurrency(row.inflows)}</td>
 <td className="px-3 py-3 text-right text-[13px] font-medium text-[var(--color-warn)]">{formatCurrency(row.outflows)}</td>
 <td className={`px-3 py-3 text-right text-[13px] font-medium ${row.net >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 <span className="inline-flex items-center justify-end gap-2">
 <Badge variant={row.net >= 0 ? 'ok' : 'err'} dot>{row.net >= 0 ? 'Positivo' : 'Negativo'}</Badge>
 {formatCurrency(row.net)}
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 <div className="mt-5 h-[280px]">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={monthlyPL}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" stroke="var(--color-fg-4)" tickLine={false} axisLine={false} />
 <YAxis stroke="var(--color-fg-4)" tickLine={false} axisLine={false} tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
 <Tooltip content={<TooltipCard />} />
 <Bar dataKey="inflows" name="Ingresos" fill="var(--color-fg-1)" radius={0} />
 <Bar dataKey="outflows" name="Gastos" fill="var(--color-warn)" radius={0} />
 <Bar dataKey="net" name="Resultado" radius={0} fill="var(--color-ok)" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </Section>

 <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
 <Section title="Balance de caja semanal" subtitle="Historico reciente derivado de movimientos contabilizados." help={
 <HelpButton title="Balance de caja semanal" size={14}>
 <p>Evolucion del saldo bancario semana a semana, basado en movimientos reales.</p>
 <p>Permite detectar tendencias de consumo o acumulacion de liquidez.</p>
 </HelpButton>
 }>
 <div className="h-[300px]">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={metrics.cashSeries}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" stroke="var(--color-fg-4)" tickLine={false} axisLine={false} />
 <YAxis stroke="var(--color-fg-4)" tickLine={false} axisLine={false} tickFormatter={(value) => `€${Math.round(value / 1000)}k`} />
 <Tooltip content={<TooltipCard />} />
 <Line type="monotone" dataKey="balance" name="Caja" stroke="var(--color-fg-1)" strokeWidth={2.8} dot={false} />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </Section>

 <Section title="Compromisos por semana" subtitle={`Entradas y salidas comprometidas en la siguiente ventana de ${forecast.horizonWeeks} semanas.`} help={
 <HelpButton title="Compromisos por semana" size={14}>
 <p>Cobros, pagos, nomina, costos recurrentes e IVA agrupados por semana.</p>
 <p>Sale de la misma proyeccion que usan el Resumen y la vista de Proyeccion.</p>
 <p>{formatCollectionSlip(forecast.collectionSlip)}.</p>
 </HelpButton>
 }>
 <div className="h-[300px]">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={weeklyCommitments}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="week" stroke="var(--color-fg-4)" tickLine={false} axisLine={false} />
 <YAxis stroke="var(--color-fg-4)" tickLine={false} axisLine={false} tickFormatter={(value) => `€${Math.round(value / 1000)}k`} />
 <Tooltip content={<TooltipCard />} />
 <Bar dataKey="committedIn" name="Cobros" fill="var(--color-ok)" radius={0} />
 <Bar dataKey="committedOut" name="Pagos" fill="var(--color-warn)" radius={0} />
 </BarChart>
 </ResponsiveContainer>
 </div>
 {/* The bars move with this assumption, so it does not hide in a tooltip. */}
 <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-fg-4)]">
 {formatCollectionSlip(forecast.collectionSlip)}. Lo ya vencido se espera de inmediato.
 </p>
 </Section>
 </div>

 <Section
 title="IVA por liquidar"
 subtitle="Umsatzsteuer por mes. Con Dauerfristverlängerung se paga el 10 del segundo mes siguiente."
 help={
 <HelpButton title="IVA por liquidar" size={14}>
 <p>IVA repercutido de las facturas emitidas menos IVA soportado de los pagos ya clasificados.</p>
 <p>Los meses marcados como Manual vienen de Configuracion → Tesoreria y mandan sobre el calculo.</p>
 <p>La cobertura dice que parte de los importes tiene tipo de IVA configurado.</p>
 </HelpButton>
 }
 >
 {vatUpcoming.length === 0 ? (
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-fg-3)]">
 Sin IVA estimado por liquidar: no hay facturas emitidas ni pagos clasificados en los meses todavía sin declarar.
 </div>
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="px-3 py-2.5 label-mono text-[var(--color-fg-3)]">Periodo</th>
 <th className="px-3 py-2.5 label-mono text-[var(--color-fg-3)]">Vence</th>
 <th className="px-3 py-2.5 text-right label-mono text-[var(--color-fg-3)]">Cobertura</th>
 <th className="px-3 py-2.5 text-right label-mono text-[var(--color-fg-3)]">Importe</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {vatUpcoming.map((entry) => (
 <tr key={entry.month} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-3 py-3 text-[13px] font-medium text-[var(--color-fg-1)]">
 {monthLabel(entry.month)}
 <span className={`nx-badge ml-2 ${entry.source === 'manual' ? 'nx-badge-info' : 'nx-badge-neutral'}`}>
 {entry.source === 'manual' ? 'Manual' : 'Estimado'}
 </span>
 </td>
 <td className="px-3 py-3 text-[13px] text-[var(--color-fg-3)]">{formatDate(entry.dueDate)}</td>
 <td className="px-3 py-3 text-right text-[13px] text-[var(--color-fg-3)]">
 {entry.coverage == null ? '—' : `${Math.round(entry.coverage * 100)}%`}
 </td>
 <td className="px-3 py-3 text-right text-[13px] font-medium text-[var(--color-warn)]">
 {formatCurrency(entry.amount)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 {/* The estimate moves with the classification, so the caveat travels with it. */}
 {vatCoverage != null && (
 <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-fg-4)]">
 {formatVatCoverage(vatCoverage)}
 </p>
 )}
 </>
 )}
 </Section>

 <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
 <div ref={movementsRef}>
 <Section title="Movimientos recientes" subtitle="Ultimas entradas y salidas contabilizadas en la cuenta principal.">
 <div className="space-y-3">
 {recentMovements.map((movement) => {
 const isInflow = movement.direction === 'in';
 return (
 <div
 key={movement.id}
 className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-4"
 >
 <div className="flex items-center gap-3">
 <div
 className="flex h-11 w-11 items-center justify-center rounded-md"
 style={{
 backgroundColor: isInflow ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 176, 32, 0.12)',
 color: isInflow ? 'var(--color-ok)' : 'var(--color-warn)',
 }}
 >
 {isInflow ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{movement.description || 'Movimiento sin descripción'}</p>
 <p className="text-xs text-[var(--color-fg-3)]">
 {movement.counterpartyName || 'Sin contraparte'} · {formatDate(movement.postedDate)}
 </p>
 </div>
 </div>
 <div className="text-right">
 <p className={`text-sm font-medium ${isInflow ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}>
 {isInflow ? '+' : '-'}
 {formatCurrency(movement.amount)}
 </p>
 <p className="text-xs text-[var(--color-fg-3)]">{movement.kind}</p>
 </div>
 </div>
 );
 })}
 </div>
 </Section>
 </div>

 <div ref={reconciliationRef}>
 <Section title="Pendiente de conciliacion" subtitle="Movimientos bancarios aun no vinculados a un cierre mensual.">
 <div className="space-y-3">
 {metrics.unreconciledMovements.length === 0 && (
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-fg-3)]">
 No hay movimientos pendientes de conciliación.
 </div>
 )}
 {metrics.unreconciledMovements.slice(0, 10).map((movement) => (
 <div
 key={movement.id}
 className="rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-4"
 >
 <div className="mb-2 flex items-center justify-between gap-3">
 <div className="flex items-center gap-2 text-[var(--color-fg-1)]">
 <Landmark size={16} className="text-[var(--color-fg-1)]" />
 <span className="text-sm font-medium">{movement.description || 'Movimiento sin descripción'}</span>
 </div>
 <span className="text-sm font-medium text-[var(--color-fg-1)]">{formatCurrency(movement.amount)}</span>
 </div>
 <p className="text-xs text-[var(--color-fg-3)]">
 {movement.counterpartyName || 'Sin contraparte'} · {formatDate(movement.postedDate)}
 </p>
 </div>
 ))}
 </div>
 </Section>
 </div>
 </div>

 <div className="grid gap-6 lg:grid-cols-2">
 <div
 className="cursor-pointer rounded-md"
 onClick={() => navigate('/cxc')}
 role="button"
 tabIndex={0}
 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/cxc'); } }}
 >
 <Section title="Cobros vencidos" subtitle="Documentos abiertos con vencimiento pasado.">
 <div className="flex items-center gap-4">
 <div className="flex h-12 w-12 items-center justify-center rounded-md border border-[var(--color-line)] text-[var(--color-warn)]">
 <ShieldAlert size={18} />
 </div>
 <div>
 <p className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">
 {metrics.overdueReceivables.length}
 </p>
 <p className="text-sm text-[var(--color-fg-3)]">
 {formatCurrency(metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0))}
 </p>
 </div>
 </div>
 </Section>
 </div>

 <div
 className="cursor-pointer rounded-md"
 onClick={() => navigate('/cxp')}
 role="button"
 tabIndex={0}
 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/cxp'); } }}
 >
 <Section title="Pagos por salir" subtitle="Compromisos abiertos dentro de la siguiente ventana.">
 <div className="flex items-center gap-4">
 <div className="flex h-12 w-12 items-center justify-center rounded-md border border-[var(--color-line)] text-[var(--color-warn)]">
 <Clock3 size={18} />
 </div>
 <div>
 <p className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">
 {metrics.upcomingPayables.length}
 </p>
 <p className="text-sm text-[var(--color-fg-3)]">
 {formatCurrency(metrics.upcomingPayables.reduce((sum, entry) => sum + entry.openAmount, 0))}
 </p>
 </div>
 </div>
 </Section>
 </div>
 </div>

 <Section title="Estado de control" subtitle="Referencia rápida para la operación diaria.">
 <div className="grid gap-4 md:grid-cols-3">
 <div className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-2 flex items-center gap-2 text-[var(--color-ok)]">
 <CheckCircle2 size={16} />
 <span className="text-sm font-medium">Caja registrada</span>
 </div>
 <p className="text-sm leading-6 text-[var(--color-fg-3)]">Los movimientos confirmados alimentan el saldo disponible y la conciliación.</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-2 flex items-center gap-2 text-[var(--color-fg-1)]">
 <Landmark size={16} />
 <span className="text-sm font-medium">Control por documento</span>
 </div>
 <p className="text-sm leading-6 text-[var(--color-fg-3)]">Las facturas abiertas se siguen por separado hasta que el cobro o el pago ocurre.</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-2 flex items-center gap-2 text-[var(--color-warn)]">
 <Clock3 size={16} />
 <span className="text-sm font-medium">Disciplina semanal</span>
 </div>
 <p className="text-sm leading-6 text-[var(--color-fg-3)]">Revisar y conciliar cada semana mejora la calidad del cierre y de la proyección.</p>
 </div>
 </div>
 </Section>
 </div>
 );
};

export default CashFlow;
