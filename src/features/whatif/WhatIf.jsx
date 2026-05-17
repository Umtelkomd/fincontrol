import { useState, useMemo } from 'react';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Zap } from 'lucide-react';
import {
 LineChart,
 Line,
 CartesianGrid,
 XAxis,
 YAxis,
 Tooltip,
 ResponsiveContainer,
 ReferenceLine,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { formatCurrency } from '../../utils/formatters';
import HelpButton from '../../components/ui/HelpButton';

const SCENARIOS = [
 { id: 'optimista', label: 'Optimista', emoji: '●', emojiColor: 'var(--color-ok)', varIngresos: 20, varGastos: -5, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
 { id: 'base', label: 'Base', emoji: '●', emojiColor: 'var(--color-warn)', varIngresos: 0, varGastos: 0, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
 { id: 'pesimista', label: 'Pesimista', emoji: '●', emojiColor: 'var(--color-err)', varIngresos: -20, varGastos: 10, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
];

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const COST_PER_HIRE = 2500;

function SliderControl({ label, value, onChange, min, max, step = 1, unit = '%' }) {
 return (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-[12px] font-medium text-[var(--color-fg-3)]">{label}</span>
 <span className={`text-[13px] font-medium tabular-nums ${value > 0 ? 'text-[var(--color-ok)]' : value < 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-4)]'}`}>
 {value > 0 ? '+' : ''}{value}{unit}
 </span>
 </div>
 <input
 type="range"
 min={min}
 max={max}
 step={step}
 value={value}
 onChange={(e) => onChange(Number(e.target.value))}
 className="w-full accent-[var(--color-fg-1)]"
        style={{ background: 'var(--color-bg-1)' }}
 />
 <div className="flex justify-between text-[10px] text-[var(--color-fg-3)]">
 <span>{min}{unit}</span>
 <span>{max}{unit}</span>
 </div>
 </div>
 );
}

function MetricCard({ label, value, delta, prefix = '€' }) {
 const isPositive = delta > 0;
 const isNegative = delta < 0;
 return (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4 ">
 <p className="label-mono text-[var(--color-fg-4)]">{label}</p>
 <p className={`mt-1 text-[18px] font-medium tabular-nums ${isNegative ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-1)]'}`}>
 {prefix}{formatCurrency(value)}
 </p>
 {delta !== undefined && delta !== null && (
 <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${isPositive ? 'text-[var(--color-ok)]' : isNegative ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-4)]'}`}>
 {isPositive ? <TrendingUp size={12} /> : isNegative ? <TrendingDown size={12} /> : null}
 <span>{isPositive ? '+' : ''}{prefix}{formatCurrency(delta)}</span>
 </div>
 )}
 </div>
 );
}

function ComparisonTable({ rows }) {
 return (
 <div className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <table className="w-full text-[12px]">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="px-4 py-3 text-left font-medium text-[var(--color-fg-3)]">Métrica</th>
 <th className="px-4 py-3 text-right font-medium text-[var(--color-fg-3)]">Actual</th>
 <th className="px-4 py-3 text-right font-medium text-[var(--color-fg-3)]">Simulado</th>
 <th className="px-4 py-3 text-right font-medium text-[var(--color-fg-3)]">Δ</th>
 </tr>
 </thead>
 <tbody>
 {rows.map((row) => {
 const delta = row.simulated - row.actual;
 const isPos = delta > 0;
 const isNeg = delta < 0;
 return (
 <tr key={row.label} className="border-b border-[var(--color-line)] last:border-0">
 <td className="px-4 py-2.5 font-medium text-[var(--color-fg-3)]">{row.label}</td>
 <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-fg-4)]">€{formatCurrency(row.actual)}</td>
 <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${isNeg ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'}`}>
 €{formatCurrency(row.simulated)}
 </td>
 <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${isPos ? 'text-[var(--color-ok)]' : isNeg ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-4)]'}`}>
 {isPos ? '+' : ''}€{formatCurrency(delta)}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 );
}

function InsightPanel({ runwayMonths }) {
 if (runwayMonths === null || runwayMonths === undefined || !isFinite(runwayMonths)) {
 return (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-start gap-3">
 <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-[var(--color-ok)]" />
 <p className="text-[12px] leading-relaxed text-[var(--color-fg-3)]">
 <strong>SIN GASTOS:</strong> No hay gastos registrados en el escenario simulado. La caja se mantiene estable.
 </p>
 </div>
 </div>
 );
 }

 let icon, color, message;
 if (runwayMonths < 3) {
 icon = <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-[var(--color-accent)]" />;
 color = 'border-[var(--color-accent)] bg-transparent';
 message = (
 <>
 <strong>CRÍTICO:</strong> Con este escenario la empresa tiene menos de 3 meses de vida ({runwayMonths.toFixed(1)} meses).
 Revisar urgente gastos e impulsar cobros pendientes.
 </>
 );
 } else if (runwayMonths <= 6) {
 icon = <Zap size={18} className="mt-0.5 flex-shrink-0 text-[var(--color-warn)]" />;
 color = 'border-[var(--color-warn)] bg-transparent';
 message = (
 <>
 <strong>ALERTA:</strong> Margen de operación ajustado ({runwayMonths.toFixed(1)} meses de runway).
 Priorizar cobros y reducir gastos variables.
 </>
 );
 } else {
 icon = <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-[var(--color-ok)]" />;
 color = 'border-[var(--color-ok)] bg-transparent';
 message = (
 <>
 <strong>ESTABLE:</strong> Este escenario es sostenible ({runwayMonths.toFixed(1)} meses de runway).
 Considera invertir el excedente o acelerar crecimiento.
 </>
 );
 }

 return (
 <div className={`rounded-lg border p-5 ${color}`}>
 <div className="flex items-start gap-3">
 {icon}
 <p className="text-[12px] leading-relaxed text-[var(--color-fg-3)]">{message}</p>
 </div>
 </div>
 );
}

const CustomTooltip = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;
 return (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 ">
 <p className="mb-1 text-[11px] font-medium text-[var(--color-fg-3)]">{label}</p>
 {payload.map((entry) => (
 <p key={entry.dataKey} className="font-mono text-[11px] tabular-nums" style={{ color: entry.color }}>
 {entry.name}: €{formatCurrency(entry.value)}
 </p>
 ))}
 </div>
 );
};

export default function WhatIf({ user }) {
 const metrics = useTreasuryMetrics({ user });

 const [varIngresos, setVarIngresos] = useState(0);
 const [varGastos, setVarGastos] = useState(0);
 const [retrasoCobros, setRetrasoCobros] = useState(0);
 const [nuevasContrataciones, setNuevasContrataciones] = useState(0);
 const [subidaPrecios, setSubidaPrecios] = useState(0);
 const [activeScenario, setActiveScenario] = useState('base');
 const [gastoBaseManual, setGastoBaseManual] = useState(null); // null = usar dato real

 const applyScenario = (scenario) => {
 setActiveScenario(scenario.id);
 setVarIngresos(scenario.varIngresos);
 setVarGastos(scenario.varGastos);
 setRetrasoCobros(scenario.retrasoCobros);
 setNuevasContrataciones(scenario.nuevasContrataciones);
 setSubidaPrecios(scenario.subidaPrecios);
 };

 const sim = useMemo(() => {
 if (metrics.loading) return null;

 const { currentCash, avgMonthlyInflows, avgMonthlyOutflows, pendingReceivables, pendingPayables } = metrics;
 // Use manual override if set, otherwise use calculated 2026 average
 const gastoBase = gastoBaseManual !== null ? gastoBaseManual : avgMonthlyOutflows;

 // Base: promedios mensuales reales (últimos 90 días / 3)
 const ingresosSim = avgMonthlyInflows * (1 + varIngresos / 100) * (1 + subidaPrecios / 100);
 const gastosSim = gastoBase * (1 + varGastos / 100) + nuevasContrataciones * COST_PER_HIRE;
 const margenNeto = ingresosSim - gastosSim;
 const margenPct = gastosSim > 0 ? (margenNeto / gastosSim) * 100 : ingresosSim > 0 ? 100 : 0;
 const runwaySim = gastosSim > 0 ? currentCash / gastosSim : null;

 const impactoCobros = (retrasoCobros / 30) * pendingReceivables * 0.3;
 const caja30 = currentCash + margenNeto * 1 - impactoCobros;
 const caja60 = currentCash + margenNeto * 2 - impactoCobros;
 const caja90 = currentCash + margenNeto * 3 - impactoCobros;

 const puntoEquilibrio = gastosSim - ingresosSim;

 const netActual = avgMonthlyInflows - gastoBase;
 const runwayActual = gastoBase > 0 ? currentCash / gastoBase : null;

 const dangerLevel = gastoBase * 2;

 const now = new Date();
 const startMonth = now.getMonth();
 const chartData = Array.from({ length: 12 }, (_, i) => {
 const monthIdx = (startMonth + i) % 12;
 return {
 name: MONTH_LABELS[monthIdx],
 actual: currentCash + netActual * (i + 1),
 simulado: currentCash + margenNeto * (i + 1) - (i >= retrasoCobros / 30 ? 0 : impactoCobros),
 peligro: dangerLevel,
 };
 });

 return {
 ingresosSim,
 gastosSim,
 margenNeto,
 margenPct,
 runwaySim,
 caja30,
 caja60,
 caja90,
 puntoEquilibrio,
 chartData,
 dangerLevel,
 actual: {
 ingresos: avgMonthlyInflows,
 gastos: gastoBase,
 margenNeto: netActual,
 runway: runwayActual,
 currentCash,
 pendingReceivables,
 pendingPayables,
 },
 };
 }, [metrics, varIngresos, varGastos, retrasoCobros, nuevasContrataciones, subidaPrecios]);

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-20">
 <div className="flex flex-col items-center gap-3">
 <Loader2 className="h-6 w-6 animate-spin text-[var(--color-fg-1)]" />
 <p className="text-[12px] text-[var(--color-fg-4)]">Cargando simulador...</p>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 {/* Header */}
 <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-[22px] font-light tracking-tight text-[var(--color-fg-1)]">Simulador What-If</h1>
 <HelpButton title="Simulador What-If">
 <p>Permite simular escenarios financieros modificando variables clave. Los resultados son estimaciones basadas en datos actuales y no representan proyecciones reales.</p>
 </HelpButton>
 </div>
 <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">Ajusta los parámetros y ve el impacto en tiempo real</p>
 </div>
 <div className="flex items-center gap-2">
 <HelpButton title="Aviso importante" size={14}>
 <p>Los valores mostrados son simulaciones basadas en tendencias históricas y parámetros ajustables. No son predicciones — la realidad puede variar según condiciones del mercado, cobros, pagos inesperados, etc.</p>
 </HelpButton>
 <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--color-line-s)] bg-[var(--color-bg-1)]/80 px-3 py-1.5 text-[11px] font-medium text-[var(--color-fg-1)]">
 <Zap size={12} />
 Basado en datos reales
 </span>
 </div>
 </div>

 {/* Scenarios */}
 <div className="flex flex-wrap items-center gap-3">
 {SCENARIOS.map((s) => (
 <button
 key={s.id}
 type="button"
 onClick={() => applyScenario(s)}
 className={`inline-flex items-center gap-2 rounded-lg border px-5 py-3 text-[12px] font-medium transition-all ${
 activeScenario === s.id
 ? 'border-[var(--color-fg-1)] bg-[var(--color-fg-1)]/10 text-[var(--color-fg-1)] '
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-1)]'
 }`}
 >
 <span style={{ color: s.emojiColor }}>{s.emoji}</span>
 {s.label}
 </button>
 ))}
 <HelpButton title="Escenarios predefinidos" size={14}>
 <p><strong>Optimista:</strong> Ingresos +20%, gastos -5%. Simula un mes con buen rendimiento comercial y control de costos.</p>
 <p><strong>Base:</strong> Sin cambios. Refleja la situación actual tal cual.</p>
 <p><strong>Pesimista:</strong> Ingresos -20%, gastos +10%. Simula un escenario adverso con caída de facturación y aumento de costos.</p>
 </HelpButton>
 </div>

 <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
 {/* Controls */}
 <div className="space-y-5 lg:col-span-4">
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center gap-2">
 <h3 className="text-[13px] font-medium text-[var(--color-fg-1)]">Parámetros de simulación</h3>
 <HelpButton title="Parámetros" size={14}>
 <p>Cada control modifica una variable financiera. Al mover un slider, los resultados se recalculan en tiempo real. Puedes combinar varios parámetros para simular escenarios complejos.</p>
 </HelpButton>
 </div>
 <div className="space-y-5">
 <div className="flex items-start gap-1">
 <div className="flex-1">
 {/* Gasto mensual base — override manual */}
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <div className="flex items-center justify-between mb-2">
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Gasto mensual base</p>
 <p className="text-xs text-[var(--color-fg-4)]">
 {gastoBaseManual !== null
 ? `Manual: ${formatCurrency(gastoBaseManual)} EUR/mes`
 : `Auto (2026): ${formatCurrency(metrics.avgMonthlyOutflows)} EUR/mes`}
 </p>
 </div>
 {gastoBaseManual !== null && (
 <button
 onClick={() => setGastoBaseManual(null)}
 className="text-xs text-[var(--color-fg-1)] hover:underline"
 >
 Usar dato real
 </button>
 )}
 </div>
 <input
 type="range"
 min={0}
 max={Math.max(100000, Math.round((metrics.avgMonthlyOutflows || 50000) * 3))}
 step={500}
 value={gastoBaseManual !== null ? gastoBaseManual : (metrics.avgMonthlyOutflows || 0)}
 onChange={(e) => { setGastoBaseManual(Number(e.target.value)); setActiveScenario(null); }}
 className="w-full accent-[var(--color-fg-1)] h-2 cursor-pointer"
 />
 <div className="flex justify-between text-[10px] text-[var(--color-fg-4)] mt-1">
 <span>€0</span>
 <span>€{formatCurrency(Math.round((metrics.avgMonthlyOutflows || 50000) * 1.5))}</span>
 <span>€{formatCurrency(Math.max(100000, Math.round((metrics.avgMonthlyOutflows || 50000) * 3)))}</span>
 </div>
 </div>

 <SliderControl label="Variación de ingresos" value={varIngresos} onChange={(v) => { setVarIngresos(v); setActiveScenario(null); }} min={-50} max={100} />
 </div>
 <HelpButton title="Variación de ingresos" size={13}>
 <p>Ajusta el porcentaje de cambio sobre los ingresos mensuales actuales. Un valor positivo simula mayor facturación; uno negativo, una caída en ventas o cobros.</p>
 </HelpButton>
 </div>
 <div className="flex items-start gap-1">
 <div className="flex-1">
 <SliderControl label="Variación de gastos" value={varGastos} onChange={(v) => { setVarGastos(v); setActiveScenario(null); }} min={-30} max={50} />
 </div>
 <HelpButton title="Variación de gastos" size={13}>
 <p>Ajusta el porcentaje de cambio sobre los gastos mensuales actuales. Un valor positivo aumenta los gastos (ej. nuevos proveedores); uno negativo simula recortes o ahorros.</p>
 </HelpButton>
 </div>
 <div className="flex items-start gap-1">
 <div className="flex-1">
 <SliderControl label="Retraso de cobros" value={retrasoCobros} onChange={(v) => { setRetrasoCobros(v); setActiveScenario(null); }} min={0} max={90} unit=" días" />
 </div>
 <HelpButton title="Retraso de cobros" size={13}>
 <p>Simula que los clientes tardan más en pagar. Cada día de retraso impacta el flujo de caja a corto plazo, reduciendo la liquidez disponible proporcionalmente a las cuentas por cobrar pendientes.</p>
 </HelpButton>
 </div>
 <div className="flex items-start gap-1">
 <div className="flex-1">
 <SliderControl label="Nuevas contrataciones" value={nuevasContrataciones} onChange={(v) => { setNuevasContrataciones(v); setActiveScenario(null); }} min={0} max={5} unit="" />
 </div>
 <HelpButton title="Nuevas contrataciones" size={13}>
 <p>Cada nueva contratación agrega un costo fijo mensual de {formatCurrency(COST_PER_HIRE)} EUR a los gastos. Útil para evaluar si la empresa puede soportar crecimiento de equipo.</p>
 </HelpButton>
 </div>
 <div className="flex items-start gap-1">
 <div className="flex-1">
 <SliderControl label="Subida de precios" value={subidaPrecios} onChange={(v) => { setSubidaPrecios(v); setActiveScenario(null); }} min={0} max={30} />
 </div>
 <HelpButton title="Subida de precios" size={13}>
 <p>Simula un aumento porcentual en los precios de venta. Se aplica sobre los ingresos junto con la variación de ingresos. Útil para evaluar el impacto de ajustes de tarifa.</p>
 </HelpButton>
 </div>
 </div>
 </div>
 </div>

 {/* Results */}
 <div className="space-y-6 lg:col-span-8">
 {/* KPI cards */}
 <div className="mb-1 flex items-center gap-2">
 <span className="label-mono text-[var(--color-fg-4)]">Métricas simuladas</span>
 <HelpButton title="Métricas simuladas" size={13}>
 <p><strong>Ingresos sim.:</strong> Ingresos mensuales proyectados con los ajustes aplicados. El delta muestra la diferencia vs. el valor actual.</p>
 <p><strong>Gastos sim.:</strong> Gastos mensuales proyectados incluyendo variaciones y contrataciones. Delta positivo = más gasto.</p>
 <p><strong>Margen neto:</strong> Diferencia entre ingresos y gastos simulados. Si es negativo, la empresa pierde dinero cada mes.</p>
 <p><strong>Runway sim.:</strong> Meses que la empresa puede operar con la caja actual al ritmo de gasto simulado. Menos de 3 meses es crítico.</p>
 </HelpButton>
 </div>
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
 <MetricCard label="Ingresos sim." value={sim.ingresosSim} delta={sim.ingresosSim - sim.actual.ingresos} />
 <MetricCard label="Gastos sim." value={sim.gastosSim} delta={sim.gastosSim - sim.actual.gastos} />
 <MetricCard
 label="Margen neto"
 value={sim.margenNeto}
 delta={sim.margenNeto - sim.actual.margenNeto}
 />
 <MetricCard
 label="Runway sim."
 value={sim.runwaySim ?? 0}
 delta={sim.runwaySim !== null && sim.actual.runway !== null ? sim.runwaySim - sim.actual.runway : null}
 prefix=""
 />
 </div>

 {/* Cash impact */}
 <div className="mb-1 flex items-center gap-2">
 <span className="label-mono text-[var(--color-fg-4)]">Impacto en caja</span>
 <HelpButton title="Proyección de caja" size={13}>
 <p>Muestra la caja estimada a 30, 60 y 90 días considerando el margen neto simulado y el impacto del retraso de cobros. Si algún valor es negativo (rojo), significa que la empresa necesitaría financiamiento externo.</p>
 </HelpButton>
 </div>
 <div className="grid grid-cols-3 gap-3">
 {[
 { label: 'Caja a 30 días', value: sim.caja30 },
 { label: 'Caja a 60 días', value: sim.caja60 },
 { label: 'Caja a 90 días', value: sim.caja90 },
 ].map((item) => (
 <div key={item.label} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4 ">
 <p className="label-mono text-[var(--color-fg-4)]">{item.label}</p>
 <p className={`mt-1 text-[16px] font-medium tabular-nums ${item.value < 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'}`}>
 €{formatCurrency(item.value)}
 </p>
 </div>
 ))}
 </div>

 {/* Comparison table */}
 <div className="mb-1 flex items-center gap-2">
 <span className="label-mono text-[var(--color-fg-4)]">Comparación actual vs. simulado</span>
 <HelpButton title="Tabla comparativa" size={13}>
 <p>Compara lado a lado los valores reales actuales con los valores simulados. La columna delta (Δ) muestra la diferencia: verde indica mejora, rojo indica deterioro respecto a la situación actual.</p>
 </HelpButton>
 </div>
 <ComparisonTable
 rows={[
 { label: 'Ingresos mensuales', actual: sim.actual.ingresos, simulated: sim.ingresosSim },
 { label: 'Gastos mensuales', actual: sim.actual.gastos, simulated: sim.gastosSim },
 { label: 'Margen neto', actual: sim.actual.margenNeto, simulated: sim.margenNeto },
 { label: 'Caja actual', actual: sim.actual.currentCash, simulated: sim.caja30 },
 { label: 'CXC pendiente', actual: sim.actual.pendingReceivables, simulated: sim.actual.pendingReceivables },
 { label: 'CXP pendiente', actual: sim.actual.pendingPayables, simulated: sim.actual.pendingPayables },
 ]}
 />

 {/* Chart */}
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center gap-2">
 <h3 className="text-[13px] font-medium text-[var(--color-fg-1)]">Proyección de caja — 12 meses</h3>
 <HelpButton title="Gráfico de proyección" size={14}>
 <p><strong>Línea azul:</strong> Proyección de caja sin cambios (escenario actual mantenido 12 meses).</p>
 <p><strong>Línea naranja:</strong> Proyección con los parámetros simulados aplicados.</p>
 <p><strong>Línea roja punteada:</strong> Nivel de peligro — equivale a 2 meses de gastos actuales. Si la caja cae por debajo, la empresa está en riesgo.</p>
 <p>Pasa el cursor sobre el gráfico para ver valores exactos por mes.</p>
 </HelpButton>
 </div>
 <ResponsiveContainer width="100%" height={300}>
 <LineChart data={sim.chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="rgba(196,214,255,0.4)" />
 <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} />
 <YAxis tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
 <Tooltip content={<CustomTooltip />} />
 <ReferenceLine y={sim.dangerLevel} stroke="var(--color-accent)" strokeDasharray="6 4" label={{ value: 'Peligro', fill: 'var(--color-accent)', fontSize: 10, position: 'right' }} />
 <Line type="monotone" dataKey="actual" name="Proyección actual" stroke="var(--color-fg-1)" strokeWidth={2} dot={false} />
 <Line type="monotone" dataKey="simulado" name="Proyección simulada" stroke="var(--color-warn)" strokeWidth={2} dot={false} />
 </LineChart>
 </ResponsiveContainer>
 </div>

 {/* Insight */}
 <div className="mb-1 flex items-center gap-2">
 <span className="label-mono text-[var(--color-fg-4)]">Diagnóstico</span>
 <HelpButton title="Diagnóstico automático" size={13}>
 <p>Evaluación automática basada en el runway simulado (meses de operación restantes):</p>
 <p><strong>Crítico (rojo):</strong> Menos de 3 meses — acción urgente requerida.</p>
 <p><strong>Alerta (ámbar):</strong> Entre 3 y 6 meses — margen ajustado, priorizar cobros.</p>
 <p><strong>Estable (verde):</strong> Más de 6 meses — situación sostenible.</p>
 </HelpButton>
 </div>
 <InsightPanel runwayMonths={sim.runwaySim} />
 </div>
 </div>
 </div>
 );
}
