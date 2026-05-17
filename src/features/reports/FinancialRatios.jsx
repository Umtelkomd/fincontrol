import { useMemo, useState } from 'react';
import {
 Activity,
 AlertTriangle,
 BarChart3,
 CheckCircle2,
 Clock,
 CreditCard,
 DollarSign,
 Info,
 Percent,
 Target,
 TrendingDown,
 TrendingUp,
 Wallet,
} from 'lucide-react';
import {
 Bar,
 BarChart,
 CartesianGrid,
 Cell,
 PolarAngleAxis,
 RadialBar,
 RadialBarChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { formatCurrency } from '../../utils/formatters';
import { MONTH_NAMES, resolvePeriodRange } from '../../finance/reporting';

const YEAR_OPTIONS = [
 { value: '2026', label: '2026 — Operación actual' },
 { value: '2025', label: '2025 — Histórico' },
 { value: 'all', label: 'Todos los años' },
];

const statusColors = {
 good: { bg: 'bg-transparent', text: 'text-[var(--color-ok)]', border: 'border-[var(--color-line-s)]', icon: 'text-[var(--color-ok)]' },
 warning: { bg: 'bg-transparent', text: 'text-[var(--color-warn)]', border: 'border-[var(--color-line-s)]', icon: 'text-[var(--color-warn)]' },
 bad: { bg: 'bg-transparent', text: 'text-[var(--color-accent)]', border: 'border-[var(--color-line-s)]', icon: 'text-[var(--color-accent)]' },
};

const getStatus = (value, benchmark, inverse = false) => {
 if (inverse) {
 if (value <= benchmark.good) return 'good';
 if (value <= benchmark.warning) return 'warning';
 return 'bad';
 }
 if (value >= benchmark.good) return 'good';
 if (value >= benchmark.warning) return 'warning';
 return 'bad';
};

const RatioCard = ({ title, value, unit = '', benchmark, inverse = false, description, icon }) => {
 const IconComponent = icon;
 const normalizedValue = Number.isFinite(value) ? value : 0;
 const status = getStatus(normalizedValue, benchmark, inverse);
 const colors = statusColors[status];
 const displayValue = Math.abs(normalizedValue) > 999 ? normalizedValue.toFixed(0) : normalizedValue.toFixed(1);
 const cap = inverse ? benchmark.warning * 1.8 : Math.max(benchmark.good * 1.8, 1);
 const gaugePercent = Math.min(100, Math.max(0, (Math.abs(normalizedValue) / cap) * 100));
 const gaugeData = [{ name: 'value', value: gaugePercent, fill: status === 'good' ? 'var(--color-ok)' : status === 'warning' ? 'var(--color-warn)' : 'var(--color-accent)' }];

 return (
 <div className={`overflow-hidden rounded-md border bg-[var(--color-bg-1)] ${colors.border}`}>
 <div className="p-4">
 <div className="mb-3 flex items-start justify-between gap-4">
 <div className="flex items-center gap-2">
 <div className={`rounded-md p-2 ${colors.bg}`}>
 <IconComponent className={colors.icon} size={18} />
 </div>
 <div>
 <h4 className="text-sm font-medium text-[var(--color-fg-1)]">{title}</h4>
 <p className="text-xs text-[var(--color-fg-3)]">{description}</p>
 </div>
 </div>
 {status === 'good' ? <CheckCircle2 className="text-[var(--color-ok)]" size={18} /> : <AlertTriangle className={colors.icon} size={18} />}
 </div>
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className={`font-display text-3xl font-medium ${colors.text}`}>{displayValue}{unit}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-4)]">
 Referencia {inverse ? 'máx.' : 'mín.'}: {benchmark.good}{unit}
 </p>
 </div>
 <div className="h-20 w-20">
 <ResponsiveContainer width="100%" height="100%">
 <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="100%" data={gaugeData} startAngle={180} endAngle={0}>
 <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
 <RadialBar background={{ fill: 'var(--color-line)' }} dataKey="value" cornerRadius={10} />
 </RadialBarChart>
 </ResponsiveContainer>
 </div>
 </div>
 </div>
 <div className={`px-4 py-2 text-xs font-medium ${colors.bg} ${colors.text}`}>
 {status === 'good' ? 'Saludable' : status === 'warning' ? 'Requiere atención' : 'Crítico'}
 </div>
 </div>
 );
};

const SummaryMetric = ({ label, value, subvalue, tone }) => (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4 ">
 <p className="text-sm text-[var(--color-fg-3)]">{label}</p>
 <p className={`mt-1 text-2xl font-medium ${tone}`}>{value}</p>
 {subvalue && <p className="mt-1 text-xs text-[var(--color-fg-4)]">{subvalue}</p>}
 </div>
);

const FinancialRatios = ({ user }) => {
 const now = new Date();
 const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
 const [selectedPeriod, setSelectedPeriod] = useState(`month:${defaultMonth}`);
 const [selectedYear, setSelectedYear] = useState('2026');

 const yearRange = selectedYear === 'all'
 ? {}
 : { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` };

 const globalMetrics = useTreasuryMetrics({ user, ...yearRange });
 const periodRange = resolvePeriodRange(selectedPeriod, now, 0);
 const periodMetrics = useTreasuryMetrics({ user, from: periodRange.from, to: periodRange.to });
 const ledger = useFinanceLedger(user);

 const ratioData = useMemo(() => {
 const receivables = globalMetrics.pendingReceivables;
 const payables = globalMetrics.pendingPayables;
 const currentCash = globalMetrics.currentCash;
 const currentRatio = payables > 0 ? (currentCash + receivables) / payables : currentCash + receivables > 0 ? 999 : 1;
 const quickRatio = payables > 0 ? currentCash / payables : currentCash > 0 ? 999 : 1;
 const workingCapital = currentCash + receivables - payables;
 const coverage14d = globalMetrics.upcomingPayables.length > 0
 ? globalMetrics.upcomingReceivables.reduce((sum, entry) => sum + entry.openAmount, 0) /
 globalMetrics.upcomingPayables.reduce((sum, entry) => sum + entry.openAmount, 0)
 : globalMetrics.upcomingReceivables.length > 0
 ? 999
 : 1;

 const monthlyIn = Math.max(periodMetrics.cashInflows || 0, 1);
 const monthlyOut = Math.max(periodMetrics.cashOutflows || 0, 1);
 const avgDaysReceivable = (receivables / (monthlyIn / 30));
 const avgDaysPayable = (payables / (monthlyOut / 30));
 const cashCycle = avgDaysReceivable - avgDaysPayable;
 const receivablesTurnover = receivables > 0 ? (monthlyIn * 12) / receivables : 0;
 const payablesTurnover = payables > 0 ? (monthlyOut * 12) / payables : 0;

 const cashMargin = periodMetrics.cashInflows > 0 ? (periodMetrics.netMovement / periodMetrics.cashInflows) * 100 : 0;
 const projectedMargin = globalMetrics.projectedLiquidity !== 0
 ? ((globalMetrics.projectedLiquidity - currentCash) / Math.max(Math.abs(currentCash), 1)) * 100
 : 0;
 const overdueShare = receivables > 0
 ? (globalMetrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0) / receivables) * 100
 : 0;
 const payablePressure = payables > 0
 ? (globalMetrics.overduePayables.reduce((sum, entry) => sum + entry.openAmount, 0) / payables) * 100
 : 0;

 return {
 currentRatio,
 quickRatio,
 workingCapital,
 coverage14d,
 avgDaysReceivable,
 avgDaysPayable,
 cashCycle,
 receivablesTurnover,
 payablesTurnover,
 cashMargin,
 projectedMargin,
 overdueShare,
 payablePressure,
 };
 }, [globalMetrics, periodMetrics]);

 const comparisonData = [
 { name: 'Ratio corriente', value: Math.min(ratioData.currentRatio, 4), benchmark: 1.5 },
 { name: 'Prueba ácida', value: Math.min(ratioData.quickRatio, 4), benchmark: 1.0 },
 { name: 'Cobertura 14d', value: Math.min(ratioData.coverage14d, 4), benchmark: 1.1 },
 { name: 'Margen caja', value: Math.max(ratioData.cashMargin, 0), benchmark: 15 },
 { name: 'Cobertura caja', value: Math.min(globalMetrics.runwayMonths || 0, 12), benchmark: 3 },
 ];

 if (globalMetrics.loading || periodMetrics.loading || ledger.loading) {
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
 <p className="mb-3 label-mono text-[var(--color-fg-3)]">Ratios financieros</p>
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Liquidez, cobertura y eficiencia operativa.</h2>
 <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-4)]">
 Los indicadores se calculan desde caja real, facturas abiertas y ritmo de entradas y salidas para ofrecer una lectura útil de la operación.
 </p>
 </div>
 <div className="flex flex-col gap-3">
 {/* Year selector */}
 <div className="flex flex-wrap gap-2">
 {YEAR_OPTIONS.map((opt) => (
 <button
 key={opt.value}
 type="button"
 onClick={() => setSelectedYear(opt.value)}
  className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
 selectedYear === opt.value
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {opt.label}
 </button>
 ))}
 </div>
 {/* Month selector for period metrics */}
 <div className="flex flex-wrap gap-2">
 {[0, 1, 2].map((offset) => {
 const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
 const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
 return (
 <button
 key={key}
 type="button"
 onClick={() => setSelectedPeriod(`month:${key}`)}
  className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
 selectedPeriod === `month:${key}`
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {MONTH_NAMES[date.getMonth()]}
 </button>
 );
 })}
 </div>
 </div>
 </div>
 </section>

 <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
 <SummaryMetric label="Caja actual" value={formatCurrency(globalMetrics.currentCash)} tone={globalMetrics.currentCash >= 0 ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-warn)]'} />
 <SummaryMetric label="Liquidez proyectada" value={formatCurrency(globalMetrics.projectedLiquidity)} subvalue="Caja + CXC abiertas - CXP abiertas" tone={globalMetrics.projectedLiquidity >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'} />
 <SummaryMetric label="Próximos 14 días" value={formatCurrency(globalMetrics.next14Net)} subvalue={`${globalMetrics.upcomingReceivables.length} cobros y ${globalMetrics.upcomingPayables.length} pagos`} tone={globalMetrics.next14Net >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'} />
 <SummaryMetric label="Cobertura de caja" value={globalMetrics.runwayMonths ? `${globalMetrics.runwayMonths.toFixed(1)} meses` : 'N/A'} subvalue={`Egreso prom. mensual ${formatCurrency(globalMetrics.avgMonthlyOutflows)}`} tone="text-[var(--color-fg-1)]" />
 <SummaryMetric label="Período" value={formatCurrency(periodMetrics.netMovement)} subvalue={`Caja realizada ${periodRange.label}`} tone={periodMetrics.netMovement >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'} />
 </div>

 <div>
 <div className="mb-4 flex items-center gap-3">
 <div className="rounded-md bg-[var(--color-bg-1)] p-2">
 <Wallet className="text-[var(--color-fg-1)]" size={18} />
 </div>
 <div>
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Liquidez</h3>
 <p className="text-sm text-[var(--color-fg-3)]">Capacidad de sostener obligaciones desde caja real y compromisos abiertos.</p>
 </div>
 </div>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <RatioCard title="Ratio corriente" value={ratioData.currentRatio} unit="x" benchmark={{ good: 1.5, warning: 1.0 }} description="(Caja + CXC) / CXP" icon={Activity} />
 <RatioCard title="Prueba ácida" value={ratioData.quickRatio} unit="x" benchmark={{ good: 1.0, warning: 0.6 }} description="Caja / CXP" icon={CreditCard} />
 <RatioCard title="Cobertura 14d" value={ratioData.coverage14d} unit="x" benchmark={{ good: 1.1, warning: 0.9 }} description="Cobros próximos / pagos próximos" icon={Target} />
 <RatioCard title="Capital operativo" value={ratioData.workingCapital} benchmark={{ good: 0, warning: -5000 }} description="Caja + CXC - CXP" icon={DollarSign} />
 </div>
 </div>

 <div>
 <div className="mb-4 flex items-center gap-3">
 <div className="rounded-md bg-transparent p-2">
 <Clock className="text-[var(--color-warn)]" size={18} />
 </div>
 <div>
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Actividad</h3>
 <p className="text-sm text-[var(--color-fg-3)]">Velocidad de cobro y pago sobre el saldo abierto actual.</p>
 </div>
 </div>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <RatioCard title="Días de cobro" value={ratioData.avgDaysReceivable} unit=" d" benchmark={{ good: 30, warning: 45 }} inverse description="CXC / ritmo mensual de cobro" icon={TrendingUp} />
 <RatioCard title="Días de pago" value={ratioData.avgDaysPayable} unit=" d" benchmark={{ good: 35, warning: 50 }} inverse description="CXP / ritmo mensual de pago" icon={TrendingDown} />
 <RatioCard title="Ciclo de caja" value={ratioData.cashCycle} unit=" d" benchmark={{ good: 15, warning: 40 }} inverse description="Días cobro - días pago" icon={Activity} />
 <RatioCard title="Rotación CXC" value={ratioData.receivablesTurnover} unit="x" benchmark={{ good: 8, warning: 4 }} description="Veces al año" icon={BarChart3} />
 </div>
 </div>

 <div>
 <div className="mb-4 flex items-center gap-3">
 <div className="rounded-md bg-transparent p-2">
 <Percent className="text-[var(--color-ok)]" size={18} />
 </div>
 <div>
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Rentabilidad y presión</h3>
 <p className="text-sm text-[var(--color-fg-3)]">Indicadores gerenciales basados en caja y envejecimiento de cartera y deuda.</p>
 </div>
 </div>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <RatioCard title="Margen de caja" value={ratioData.cashMargin} unit="%" benchmark={{ good: 15, warning: 5 }} description="Resultado del período / ingresos realizados" icon={TrendingUp} />
 <RatioCard title="Margen proyectado" value={ratioData.projectedMargin} unit="%" benchmark={{ good: 5, warning: 0 }} description="Liquidez proyectada vs caja actual" icon={Target} />
 <RatioCard title="Mora CXC" value={ratioData.overdueShare} unit="%" benchmark={{ good: 15, warning: 30 }} inverse description="Saldo vencido / CXC abiertas" icon={AlertTriangle} />
 <RatioCard title="Presión CXP" value={ratioData.payablePressure} unit="%" benchmark={{ good: 20, warning: 35 }} inverse description="Saldo vencido / CXP abiertas" icon={TrendingDown} />
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="mb-6 flex items-center gap-3">
 <div className="rounded-md bg-[var(--color-bg-1)] p-2">
 <BarChart3 className="text-[var(--color-fg-1)]" size={18} />
 </div>
 <div>
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Comparativa frente a referencia</h3>
 <p className="text-sm text-[var(--color-fg-3)]">Referencia rápida para liquidez y resistencia operativa.</p>
 </div>
 </div>
 <ResponsiveContainer width="100%" height={300}>
 <BarChart data={comparisonData} layout="vertical" margin={{ left: 110 }}>
 <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-line)" />
 <XAxis type="number" tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} axisLine={false} tickLine={false} />
 <YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-fg-1)', fontSize: 12 }} axisLine={false} tickLine={false} />
 <Tooltip
 formatter={(value, name) => [Number(value).toFixed(1), name === 'value' ? 'Actual' : 'Benchmark']}
 contentStyle={{ backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)', border: '1px solid var(--color-line)', borderRadius: 18 }}
 />
 <Bar dataKey="value" name="Actual" radius={0}>
 {comparisonData.map((entry, index) => (
 <Cell
 key={`${entry.name}-${index}`}
 fill={entry.value >= entry.benchmark ? 'var(--color-ok)' : entry.value >= entry.benchmark * 0.75 ? 'var(--color-warn)' : 'var(--color-accent)'}
 />
 ))}
 </Bar>
 <Bar dataKey="benchmark" name="Benchmark" fill="var(--color-fg-4)" radius={0} opacity={0.55} />
 </BarChart>
 </ResponsiveContainer>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-start gap-3">
 <Info className="mt-0.5 text-[var(--color-fg-1)]" size={18} />
 <div className="grid gap-3 md:grid-cols-3">
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Liquidez</p>
 <p className="mt-1 text-sm text-[var(--color-fg-4)]">El ratio corriente y la prueba ácida usan caja real más compromisos abiertos, sin adelantar cobros que aún no ocurrieron.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Actividad</p>
 <p className="mt-1 text-sm text-[var(--color-fg-4)]">Los días de cobro y pago se estiman con saldo abierto actual frente al ritmo del período seleccionado.</p>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Rentabilidad</p>
 <p className="mt-1 text-sm text-[var(--color-fg-4)]">El margen mostrado corresponde a caja realizada. Una contabilidad completa requeriría un libro contable fuera del alcance de esta fase.</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default FinancialRatios;
