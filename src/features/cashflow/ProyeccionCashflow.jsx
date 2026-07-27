import { useMemo } from 'react';
import {
 Activity,
 AlertTriangle,
 Calendar,
 Target,
 Wallet,
 Zap,
} from 'lucide-react';
import {
 Area,
 AreaChart,
 CartesianGrid,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useCashForecast } from '../../hooks/useCashForecast';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { formatCollectionSlip, formatCollectionSlipBasis, formatCurrency } from '../../utils/formatters';

const StatCard = ({ title, value, subtitle, accent, icon }) => {
 const IconComponent = icon;

 return (
 <div
 className="rounded-md border p-5 "
 style={{ background: 'var(--color-bg-1)', borderColor: 'var(--color-line)' }}
 >
 <div className="mb-4 flex items-center justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 font-display font-display text-[28px] font-medium tracking-tight text-[var(--color-fg-1)]">{value}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--color-bg-1)', color: accent }}>
 <IconComponent size={18} />
 </div>
 </div>
 <p className="text-sm text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
 );
};

const OutlookCard = ({ title, balance, delta, accent, subtitle }) => (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 font-display text-[28px] font-medium tracking-tight" style={{ color: accent }}>{formatCurrency(balance)}</p>
 {delta != null && (
 <p className={`mt-2 text-sm font-medium ${delta >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {delta >= 0 ? '+' : ''}{formatCurrency(delta)}
 </p>
 )}
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
);

const ProyeccionCashflow = ({ user }) => {
 const ledger = useFinanceLedgerContext();
 const metrics = useTreasuryMetrics({ user, ledger });
 const forecast = useCashForecast(user, { ledger });

 // One committed projection. There is deliberately no optimistic/pessimistic
 // band: the previous version multiplied the committed flows by invented
 // constants (in × 1.1, out × 0.95 …) and presented the result as a forecast.
 // Nothing backed those numbers, so they were removed rather than re-tuned.
 const projectionData = useMemo(
 () =>
 forecast.weeks.map((week) => ({
 label: week.week,
 range: week.label,
 committedIn: week.inflow,
 committedOut: Math.abs(week.outflow),
 net: week.net,
 base: week.projectedBalance,
 })),
 [forecast.weeks],
 );

 const alerts = useMemo(() => {
 const items = [];

 if (forecast.firstNegativeWeek) {
 items.push({
 type: 'critical',
 text: `Saldo proyectado negativo durante ${forecast.firstNegativeWeek.label} (${formatCurrency(forecast.firstNegativeWeek.projectedBalance)}).`,
 });
 }

 if (metrics.next14Net < 0) {
 items.push({ type: 'warning', text: `La ventana de 14 días ya muestra una presión neta de ${formatCurrency(metrics.next14Net)}.` });
 }

 if ((metrics.runwayMonths || 0) > 0 && metrics.runwayMonths < 2) {
 items.push({ type: 'critical', text: `La cobertura de caja estimada es menor a 2 meses (${metrics.runwayMonths.toFixed(1)} meses).` });
 }

 return items;
 }, [forecast.firstNegativeWeek, metrics.next14Net, metrics.runwayMonths]);

 // Where the collection slip came from — the projection's one assumption.
 const collectionSlipBasis = formatCollectionSlipBasis(forecast.collectionSlip);

 if (metrics.loading || forecast.loading) {
 return (
 <div className="flex items-center justify-center py-28">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12">
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7 ">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-3)] mb-3">Proyección de tesorería</p>
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Horizonte de {forecast.horizonWeeks} semanas usando CXC, CXP, nómina, recurrentes e IVA.</h2>
 <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-3)]">
 Parte de la caja conciliada de hoy y solo mueve compromisos reales: facturas abiertas,
 obligaciones de nómina, costos recurrentes activos y estimados de IVA. Único supuesto:
 los cobros entran {forecast.collectionSlipDays} días después del vencimiento
 {collectionSlipBasis ? ` (${collectionSlipBasis})` : ''}.
 </p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)]">Horizonte</p>
 <p className="mt-1 text-sm font-medium text-[var(--color-fg-1)]">Próximas {forecast.horizonWeeks} semanas</p>
 </div>
 </div>
 </section>

 {alerts.length > 0 && (
 <div className="space-y-2">
 {alerts.map((alert) => (
 <div
 key={alert.text}
 className={`flex items-center gap-3 rounded-md border px-4 py-3 ${
 alert.type === 'critical'
 ? 'border-[var(--color-line-s)] bg-transparent'
 : 'border-[var(--color-line-s)] bg-transparent'
 }`}
 >
 <AlertTriangle size={16} className={alert.type === 'critical' ? 'text-[var(--color-accent)]' : 'text-[var(--color-warn)]'} />
 <span className={`text-sm ${alert.type === 'critical' ? 'text-[var(--color-accent)]' : 'text-[var(--color-warn)]'}`}>{alert.text}</span>
 </div>
 ))}
 </div>
 )}

 <div className="grid gap-4 lg:grid-cols-4">
 <StatCard title="Caja actual" value={formatCurrency(metrics.currentCash)} subtitle="Saldo bancario real a hoy" accent={metrics.currentCash >= 0 ? 'var(--color-fg-4)' : 'var(--color-accent)'} icon={Wallet} />
 <StatCard title="Ventana 14d" value={formatCurrency(metrics.next14Net)} subtitle={`${metrics.upcomingReceivables.length} cobros y ${metrics.upcomingPayables.length} pagos`} accent={metrics.next14Net >= 0 ? 'var(--color-ok)' : 'var(--color-warn)'} icon={Calendar} />
 <StatCard title="Liquidez proyectada" value={formatCurrency(metrics.projectedLiquidity)} subtitle="Caja actual + CXC abiertas - CXP abiertas" accent={metrics.projectedLiquidity >= 0 ? 'var(--color-ok)' : 'var(--color-accent)'} icon={Target} />
 <StatCard title="Cobertura de caja" value={metrics.runwayMonths ? `${metrics.runwayMonths.toFixed(1)} meses` : 'N/A'} subtitle={`Egreso prom. mensual ${formatCurrency(metrics.avgMonthlyOutflows)}`} accent="var(--color-fg-4)" icon={Zap} />
 </div>

 <div className="grid gap-4 md:grid-cols-3">
 <OutlookCard
 title={`Saldo a ${forecast.horizonWeeks} semanas`}
 balance={forecast.endBalance}
 delta={forecast.endBalance - forecast.startBalance}
 accent={forecast.endBalance >= 0 ? 'var(--color-fg-4)' : 'var(--color-accent)'}
 subtitle="Cierre del horizonte con todo lo comprometido"
 />
 <OutlookCard
 title="Semana más baja"
 balance={forecast.lowestWeek?.projectedBalance ?? forecast.startBalance}
 delta={null}
 accent={(forecast.lowestWeek?.projectedBalance ?? 0) >= 0 ? 'var(--color-fg-4)' : 'var(--color-accent)'}
 subtitle={forecast.lowestWeek ? `${forecast.lowestWeek.week} · ${forecast.lowestWeek.label}` : 'Sin datos'}
 />
 <OutlookCard
 title="Primera semana en negativo"
 balance={forecast.firstNegativeWeek?.projectedBalance ?? 0}
 delta={null}
 accent={forecast.firstNegativeWeek ? 'var(--color-accent)' : 'var(--color-ok)'}
 subtitle={
 forecast.firstNegativeWeek
 ? `${forecast.firstNegativeWeek.week} · en ${forecast.weeksToNegative} sem.`
 : 'La caja no cruza a negativo en el horizonte'
 }
 />
 </div>

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4">
 <p className="label-mono text-[var(--color-fg-4)]">Curva de liquidez</p>
 <h3 className="font-display mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Saldo proyectado por semana</h3>
 </div>
 <ResponsiveContainer width="100%" height={360}>
 <AreaChart
 data={[
 { label: 'Hoy', range: 'Hoy', base: forecast.startBalance },
 ...projectionData,
 ]}
 >
 <defs>
 <linearGradient id="projection-base" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="var(--color-fg-4)" stopOpacity={0.35} />
 <stop offset="100%" stopColor="var(--color-fg-4)" stopOpacity={0.04} />
 </linearGradient>
 </defs>
 <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
 <XAxis dataKey="label" tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickLine={false} axisLine={false} />
 <YAxis tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} />
 <Tooltip
 formatter={(value) => formatCurrency(value)}
 labelFormatter={(_, payload) => payload?.[0]?.payload?.range || ''}
 contentStyle={{ backgroundColor: 'var(--color-bg-0)', border: '1px solid var(--color-line)', borderRadius: 18 }}
 />
 <Area type="monotone" dataKey="base" name="Saldo proyectado" stroke="var(--color-fg-3)" fill="url(#projection-base)" strokeWidth={2.5} />
 </AreaChart>
 </ResponsiveContainer>
 </section>

 <section className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="border-b border-[var(--color-line)] px-5 py-4">
 <h3 className="font-display flex items-center gap-2 text-lg font-medium text-[var(--color-fg-1)]">
 <Activity size={18} className="text-[var(--color-fg-3)]" />
 Desglose semanal comprometido
 </h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full min-w-[860px] text-sm">
 <thead>
 <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
 <th className="px-4 py-3 text-left">Semana</th>
 <th className="px-4 py-3 text-left">Rango</th>
 <th className="px-4 py-3 text-right">Cobros comprometidos</th>
 <th className="px-4 py-3 text-right">Pagos comprometidos</th>
 <th className="px-4 py-3 text-right">Neto</th>
 <th className="px-4 py-3 text-right">Saldo proyectado</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {projectionData.map((row) => (
 <tr key={row.label} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 font-medium text-[var(--color-fg-1)]">{row.label}</td>
 <td className="px-4 py-3 text-[var(--color-fg-3)]">{row.range}</td>
 <td className="px-4 py-3 text-right text-[var(--color-ok)]">{formatCurrency(row.committedIn)}</td>
 <td className="px-4 py-3 text-right text-[var(--color-accent)]">{formatCurrency(row.committedOut)}</td>
 <td className={`px-4 py-3 text-right ${row.net >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>{formatCurrency(row.net)}</td>
 <td className={`px-4 py-3 text-right font-medium ${row.base >= 0 ? 'text-[var(--color-fg-3)]' : 'text-[var(--color-accent)]'}`}>{formatCurrency(row.base)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </section>

 <div className="rounded-md border border-[var(--color-line-s)] bg-transparent p-5">
 <div className="flex items-start gap-3">
 <Target className="mt-0.5 text-[var(--color-fg-3)]" size={18} />
 <div className="grid gap-3 md:grid-cols-3">
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Punto de partida</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">La caja conciliada de hoy ({formatCurrency(forecast.startBalance)}), la misma que usan el Resumen y las alertas operativas.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Qué mueve el saldo</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Solo compromisos reales: CXC y CXP abiertas, obligaciones de nómina, costos recurrentes activos y estimados de IVA. No se asumen ventas ni compras futuras.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Único supuesto</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">{formatCollectionSlip(forecast.collectionSlip)}; lo ya vencido se espera de inmediato. El plazo sale del histórico de cobros de la empresa, no de un porcentaje inventado.</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default ProyeccionCashflow;
