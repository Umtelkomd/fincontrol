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

const SCENARIOS = [
  { id: 'optimista', label: 'Optimista', emoji: '🟢', varIngresos: 20, varGastos: -5, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
  { id: 'base', label: 'Base', emoji: '🟡', varIngresos: 0, varGastos: 0, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
  { id: 'pesimista', label: 'Pesimista', emoji: '🔴', varIngresos: -20, varGastos: 10, retrasoCobros: 0, nuevasContrataciones: 0, subidaPrecios: 0 },
];

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const COST_PER_HIRE = 2500;

function SliderControl({ label, value, onChange, min, max, step = 1, unit = '%' }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#344054]">{label}</span>
        <span className={`text-[13px] font-semibold tabular-nums ${value > 0 ? 'text-[#16a34a]' : value < 0 ? 'text-[#dc2626]' : 'text-[#5f7091]'}`}>
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
        className="w-full accent-blue-500"
        style={{ background: `linear-gradient(to right, #4d74ff ${pct}%, #e2e8f0 ${pct}%)` }}
      />
      <div className="flex justify-between text-[10px] text-[#8896ab]">
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
    <div className="rounded-2xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_8px_24px_rgba(124,148,191,0.1)] backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#5f7091]">{label}</p>
      <p className={`mt-1 text-[18px] font-bold tabular-nums ${isNegative ? 'text-[#dc2626]' : 'text-[#101938]'}`}>
        {prefix}{formatCurrency(value)}
      </p>
      {delta !== undefined && delta !== null && (
        <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${isPositive ? 'text-[#16a34a]' : isNegative ? 'text-[#dc2626]' : 'text-[#5f7091]'}`}>
          {isPositive ? <TrendingUp size={12} /> : isNegative ? <TrendingDown size={12} /> : null}
          <span>{isPositive ? '+' : ''}{prefix}{formatCurrency(delta)}</span>
        </div>
      )}
    </div>
  );
}

function ComparisonTable({ rows }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] shadow-[0_8px_24px_rgba(124,148,191,0.1)] backdrop-blur-xl">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[rgba(196,214,255,0.38)]">
            <th className="px-4 py-3 text-left font-semibold text-[#344054]">Métrica</th>
            <th className="px-4 py-3 text-right font-semibold text-[#344054]">Actual</th>
            <th className="px-4 py-3 text-right font-semibold text-[#344054]">Simulado</th>
            <th className="px-4 py-3 text-right font-semibold text-[#344054]">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.simulated - row.actual;
            const isPos = delta > 0;
            const isNeg = delta < 0;
            return (
              <tr key={row.label} className="border-b border-[rgba(196,214,255,0.2)] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[#344054]">{row.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#5f7091]">€{formatCurrency(row.actual)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${isNeg ? 'text-[#dc2626]' : 'text-[#101938]'}`}>
                  €{formatCurrency(row.simulated)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${isPos ? 'text-[#16a34a]' : isNeg ? 'text-[#dc2626]' : 'text-[#5f7091]'}`}>
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
      <div className="rounded-2xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-5 shadow-[0_8px_24px_rgba(124,148,191,0.1)] backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-[#16a34a]" />
          <p className="text-[12px] leading-relaxed text-[#344054]">
            <strong>SIN GASTOS:</strong> No hay gastos registrados en el escenario simulado. La caja se mantiene estable.
          </p>
        </div>
      </div>
    );
  }

  let icon, color, message;
  if (runwayMonths < 3) {
    icon = <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-[#dc2626]" />;
    color = 'border-red-200 bg-red-50/60';
    message = (
      <>
        <strong>CRÍTICO:</strong> Con este escenario la empresa tiene menos de 3 meses de vida ({runwayMonths.toFixed(1)} meses).
        Revisar urgente gastos e impulsar cobros pendientes.
      </>
    );
  } else if (runwayMonths <= 6) {
    icon = <Zap size={18} className="mt-0.5 flex-shrink-0 text-[#d97706]" />;
    color = 'border-amber-200 bg-amber-50/60';
    message = (
      <>
        <strong>ALERTA:</strong> Margen de operación ajustado ({runwayMonths.toFixed(1)} meses de runway).
        Priorizar cobros y reducir gastos variables.
      </>
    );
  } else {
    icon = <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-[#16a34a]" />;
    color = 'border-green-200 bg-green-50/60';
    message = (
      <>
        <strong>ESTABLE:</strong> Este escenario es sostenible ({runwayMonths.toFixed(1)} meses de runway).
        Considera invertir el excedente o acelerar crecimiento.
      </>
    );
  }

  return (
    <div className={`rounded-2xl border p-5 shadow-[0_8px_24px_rgba(124,148,191,0.1)] backdrop-blur-xl ${color}`}>
      <div className="flex items-start gap-3">
        {icon}
        <p className="text-[12px] leading-relaxed text-[#344054]">{message}</p>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[rgba(196,214,255,0.5)] bg-white/95 px-3 py-2 shadow-lg backdrop-blur-xl">
      <p className="mb-1 text-[11px] font-semibold text-[#344054]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-[11px] tabular-nums" style={{ color: entry.color }}>
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

    const { currentCash, cashInflows, cashOutflows, avgMonthlyOutflows, pendingReceivables, pendingPayables, netMovement } = metrics;

    const ingresosSim = cashInflows * (1 + varIngresos / 100) * (1 + subidaPrecios / 100);
    const gastosSim = avgMonthlyOutflows * (1 + varGastos / 100) + nuevasContrataciones * COST_PER_HIRE;
    const margenNeto = ingresosSim - gastosSim;
    const margenPct = gastosSim > 0 ? (margenNeto / gastosSim) * 100 : ingresosSim > 0 ? 100 : 0;
    const runwaySim = gastosSim > 0 ? currentCash / gastosSim : null;

    const impactoCobros = (retrasoCobros / 30) * pendingReceivables * 0.3;
    const caja30 = currentCash + margenNeto * 1 - impactoCobros;
    const caja60 = currentCash + margenNeto * 2 - impactoCobros;
    const caja90 = currentCash + margenNeto * 3 - impactoCobros;

    const puntoEquilibrio = gastosSim - ingresosSim;

    const netActual = cashInflows - avgMonthlyOutflows;
    const runwayActual = avgMonthlyOutflows > 0 ? currentCash / avgMonthlyOutflows : null;

    const dangerLevel = avgMonthlyOutflows * 2;

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
        ingresos: cashInflows,
        gastos: avgMonthlyOutflows,
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
          <Loader2 className="h-6 w-6 animate-spin text-[#4d74ff]" />
          <p className="text-[12px] text-[#5f7091]">Cargando simulador...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#101938]">Simulador What-If</h1>
          <p className="mt-1 text-[12px] text-[#5f7091]">Ajusta los parámetros y ve el impacto en tiempo real</p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/80 px-3 py-1.5 text-[11px] font-semibold text-[#4d74ff]">
          <Zap size={12} />
          Basado en datos reales
        </span>
      </div>

      {/* Scenarios */}
      <div className="flex flex-wrap gap-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => applyScenario(s)}
            className={`inline-flex items-center gap-2 rounded-2xl border px-5 py-3 text-[12px] font-semibold transition-all ${
              activeScenario === s.id
                ? 'border-[#4d74ff] bg-[#4d74ff]/10 text-[#4d74ff] shadow-[0_8px_20px_rgba(77,116,255,0.15)]'
                : 'border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] text-[#344054] hover:bg-[rgba(255,255,255,0.9)]'
            }`}
          >
            <span>{s.emoji}</span>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Controls */}
        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-3xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-5 shadow-[0_18px_46px_rgba(124,148,191,0.14)] backdrop-blur-xl">
            <h3 className="mb-4 text-[13px] font-semibold text-[#101938]">Parámetros de simulación</h3>
            <div className="space-y-5">
              <SliderControl label="Variación de ingresos" value={varIngresos} onChange={(v) => { setVarIngresos(v); setActiveScenario(null); }} min={-50} max={100} />
              <SliderControl label="Variación de gastos" value={varGastos} onChange={(v) => { setVarGastos(v); setActiveScenario(null); }} min={-30} max={50} />
              <SliderControl label="Retraso de cobros" value={retrasoCobros} onChange={(v) => { setRetrasoCobros(v); setActiveScenario(null); }} min={0} max={90} unit=" días" />
              <SliderControl label="Nuevas contrataciones" value={nuevasContrataciones} onChange={(v) => { setNuevasContrataciones(v); setActiveScenario(null); }} min={0} max={5} unit="" />
              <SliderControl label="Subida de precios" value={subidaPrecios} onChange={(v) => { setSubidaPrecios(v); setActiveScenario(null); }} min={0} max={30} />
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-6 lg:col-span-8">
          {/* KPI cards */}
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
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Caja a 30 días', value: sim.caja30 },
              { label: 'Caja a 60 días', value: sim.caja60 },
              { label: 'Caja a 90 días', value: sim.caja90 },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_8px_24px_rgba(124,148,191,0.1)] backdrop-blur-xl">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#5f7091]">{item.label}</p>
                <p className={`mt-1 text-[16px] font-bold tabular-nums ${item.value < 0 ? 'text-[#dc2626]' : 'text-[#101938]'}`}>
                  €{formatCurrency(item.value)}
                </p>
              </div>
            ))}
          </div>

          {/* Comparison table */}
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
          <div className="rounded-3xl border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-5 shadow-[0_18px_46px_rgba(124,148,191,0.14)] backdrop-blur-xl">
            <h3 className="mb-4 text-[13px] font-semibold text-[#101938]">Proyección de caja — 12 meses</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sim.chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(196,214,255,0.4)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5f7091' }} />
                <YAxis tick={{ fontSize: 11, fill: '#5f7091' }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={sim.dangerLevel} stroke="#dc2626" strokeDasharray="6 4" label={{ value: 'Peligro', fill: '#dc2626', fontSize: 10, position: 'right' }} />
                <Line type="monotone" dataKey="actual" name="Proyección actual" stroke="#4d74ff" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="simulado" name="Proyección simulada" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Insight */}
          <InsightPanel runwayMonths={sim.runwaySim} />
        </div>
      </div>
    </div>
  );
}
