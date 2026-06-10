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
 Legend,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { formatCurrency } from '../../utils/formatters';

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

const ScenarioCard = ({ title, balance, delta, accent, subtitle }) => (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 font-display text-[28px] font-medium tracking-tight" style={{ color: accent }}>{formatCurrency(balance)}</p>
 <p className={`mt-2 text-sm font-medium ${delta >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {delta >= 0 ? '+' : ''}{formatCurrency(delta)}
 </p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
);

const ProyeccionCashflow = ({ user }) => {
 const ledger = useFinanceLedgerContext();
 const metrics = useTreasuryMetrics({ user, ledger });

 const projectionData = useMemo(() => {
 const state = metrics.weeklyProjection.reduce((accumulator, row) => {
 const optimisticDelta = row.committedIn * 1.1 - row.committedOut * 0.95;
 const pessimisticDelta = row.committedIn * 0.8 - row.committedOut * 1.1;

 const optimisticBalance = accumulator.optimistic + optimisticDelta;
 const pessimisticBalance = accumulator.pessimistic + pessimisticDelta;

 accumulator.rows.push({
 label: row.week,
 range: row.label,
 committedIn: row.committedIn,
 committedOut: row.committedOut,
 base: row.projectedBalance,
 optimistic: Math.round(optimisticBalance * 100) / 100,
 pessimistic: Math.round(pessimisticBalance * 100) / 100,
 });
 accumulator.optimistic = optimisticBalance;
 accumulator.pessimistic = pessimisticBalance;

 return accumulator;
 }, {
 optimistic: metrics.currentCash,
 pessimistic: metrics.currentCash,
 rows: [],
 });

 return state.rows;
 }, [metrics.currentCash, metrics.weeklyProjection]);

 const alerts = useMemo(() => {
 const items = [];
 const negativeBase = projectionData.find((entry) => entry.base < 0);
 const negativePessimistic = projectionData.find((entry) => entry.pessimistic < 0);

 if (negativeBase) {
 items.push({ type: 'critical', text: `Saldo negativo proyectado en escenario base durante ${negativeBase.range}.` });
 } else if (negativePessimistic) {
 items.push({ type: 'warning', text: `En un escenario pesimista podrías entrar en saldo negativo durante ${negativePessimistic.range}.` });
 }

 if (metrics.next14Net < 0) {
 items.push({ type: 'warning', text: `La ventana de 14 días ya muestra una presión neta de ${formatCurrency(metrics.next14Net)}.` });
 }

 if ((metrics.runwayMonths || 0) > 0 && metrics.runwayMonths < 2) {
 items.push({ type: 'critical', text: `La cobertura de caja estimada es menor a 2 meses (${metrics.runwayMonths.toFixed(1)} meses).` });
 }

 return items;
 }, [metrics.next14Net, metrics.runwayMonths, projectionData]);

 const finalScenario = projectionData[projectionData.length - 1];

 if (metrics.loading) {
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
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Horizonte de 8 semanas usando CXC, CXP y caja real.</h2>
 <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-3)]">
 La proyección parte del saldo bancario actual y suma o resta solo compromisos abiertos con vencimiento conocido.
 </p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)]">Horizonte</p>
 <p className="mt-1 text-sm font-medium text-[var(--color-fg-1)]">Próximas 8 semanas</p>
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
 <ScenarioCard
 title="Escenario optimista"
 balance={finalScenario?.optimistic ?? metrics.currentCash}
 delta={(finalScenario?.optimistic ?? metrics.currentCash) - metrics.currentCash}
 accent="var(--color-ok)"
 subtitle="+10% cobros comprometidos y -5% pagos comprometidos"
 />
 <ScenarioCard
 title="Escenario base"
 balance={finalScenario?.base ?? metrics.currentCash}
 delta={(finalScenario?.base ?? metrics.currentCash) - metrics.currentCash}
 accent="var(--color-fg-4)"
 subtitle="Solo compromisos actualmente abiertos"
 />
 <ScenarioCard
 title="Escenario pesimista"
 balance={finalScenario?.pessimistic ?? metrics.currentCash}
 delta={(finalScenario?.pessimistic ?? metrics.currentCash) - metrics.currentCash}
 accent="var(--color-accent)"
 subtitle="-20% cobros comprometidos y +10% pagos comprometidos"
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
 { label: 'Hoy', range: 'Hoy', base: metrics.currentCash, optimistic: metrics.currentCash, pessimistic: metrics.currentCash },
 ...projectionData,
 ]}
 >
 <defs>
 <linearGradient id="projection-base" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="var(--color-fg-4)" stopOpacity={0.35} />
 <stop offset="100%" stopColor="var(--color-fg-4)" stopOpacity={0.04} />
 </linearGradient>
 <linearGradient id="projection-optimistic" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="var(--color-ok)" stopOpacity={0.22} />
 <stop offset="100%" stopColor="var(--color-ok)" stopOpacity={0.04} />
 </linearGradient>
 <linearGradient id="projection-pessimistic" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.18} />
 <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.03} />
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
 <Legend />
 <Area type="monotone" dataKey="optimistic" name="Optimista" stroke="var(--color-ok)" fill="url(#projection-optimistic)" strokeWidth={2} />
 <Area type="monotone" dataKey="base" name="Base" stroke="var(--color-fg-3)" fill="url(#projection-base)" strokeWidth={2.5} />
 <Area type="monotone" dataKey="pessimistic" name="Pesimista" stroke="var(--color-accent)" fill="url(#projection-pessimistic)" strokeWidth={2} strokeDasharray="4 4" />
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
 <th className="px-4 py-3 text-right">Saldo base</th>
 <th className="px-4 py-3 text-right">Saldo optimista</th>
 <th className="px-4 py-3 text-right">Saldo pesimista</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {projectionData.map((row) => (
 <tr key={row.label} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 font-medium text-[var(--color-fg-1)]">{row.label}</td>
 <td className="px-4 py-3 text-[var(--color-fg-3)]">{row.range}</td>
 <td className="px-4 py-3 text-right text-[var(--color-ok)]">{formatCurrency(row.committedIn)}</td>
 <td className="px-4 py-3 text-right text-[var(--color-accent)]">{formatCurrency(row.committedOut)}</td>
 <td className={`px-4 py-3 text-right font-medium ${row.base >= 0 ? 'text-[var(--color-fg-3)]' : 'text-[var(--color-accent)]'}`}>{formatCurrency(row.base)}</td>
 <td className={`px-4 py-3 text-right ${row.optimistic >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>{formatCurrency(row.optimistic)}</td>
 <td className="px-4 py-3 text-right text-[var(--color-accent)]">{formatCurrency(row.pessimistic)}</td>
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
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Base</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Usa únicamente CXC y CXP abiertas por vencimiento, sin asumir ventas o compras futuras todavía no registradas.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Optimista</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Asume mejor conversión de cobro y algo menos de salida sobre los pagos comprometidos.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-3)]">Pesimista</p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Asume retrasos de cobro y mayor presión de pagos. Útil para anticipar necesidades de liquidez.</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default ProyeccionCashflow;
