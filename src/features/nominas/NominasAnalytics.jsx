import { useMemo } from 'react';
import { TrendingUp, Users, PieChart, Download } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Badge, KPI, KPIGrid, Panel } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';
import { buildPayrollTrend, momChange, rollingAverage } from './lib/payrollTrend.js';
import { pivotByEmployee } from './lib/payrollPivot.js';
import { payrollAsPctOfRevenue, sumPayrollCash } from './lib/payrollKpi.js';

/**
 * NominasAnalytics — Phase 3 analytics sub-tab (items 1, 2, 5).
 *
 * Presentational only: every number comes from the pure tested libs
 * (payrollTrend, payrollPivot, payrollKpi). The Recharts blueprint mirrors
 * CashPositionPanel exactly — gradient defs on var(--color-accent), dashed
 * CartesianGrid, var(--color-fg-4) ticks, custom dark tooltip,
 * isAnimationActive={false}.
 *
 * Props:
 *   periods: payroll periods (already in the Nóminas scope)
 *   revenue: optional company revenue for the % -of-revenue KPI (null hides it)
 *   onExportPersonnelPDF / onExportPersonnelExcel: export callbacks (item 8)
 */

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

const TrendTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-3 py-2">
      <p className="font-mono text-[11px] text-[var(--color-fg-3)]">{d.label}</p>
      <p className="font-mono text-[12px] tabular-nums text-[var(--color-fg-1)]">
        Caja {formatCurrency(d.cashTotal)}
      </p>
      <p className="font-mono text-[12px] tabular-nums text-[var(--color-fg-2)]">
        Costo empresa {formatCurrency(d.employerCostTotal)}
      </p>
      <p className="font-mono text-[11px] tabular-nums text-[var(--color-fg-4)]">
        Δ {formatCurrency(d.delta)}
      </p>
    </div>
  );
};

const Sparkline = ({ values }) => {
  const data = useMemo(() => (values || []).map((v, i) => ({ i, v })), [values]);
  if (!data.length) return <span className="text-[var(--color-fg-4)]">—</span>;
  return (
    <div style={{ width: 120, height: 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const NominasAnalytics = ({
  periods = [],
  revenue = null,
  onExportPersonnelPDF,
  onExportPersonnelExcel,
}) => {
  const trend = useMemo(() => buildPayrollTrend(periods), [periods]);
  const cashMoM = useMemo(() => momChange(trend, 'cashTotal'), [trend]);
  const cashRolling = useMemo(() => rollingAverage(trend, 'cashTotal', 3), [trend]);
  const pivot = useMemo(() => pivotByEmployee(periods), [periods]);

  const totalCash = useMemo(() => sumPayrollCash(periods), [periods]);
  const revenueKpi = useMemo(
    () => payrollAsPctOfRevenue({ payrollCost: totalCash, revenue }),
    [totalCash, revenue],
  );

  const lastMoM = cashMoM.length ? cashMoM[cashMoM.length - 1] : null;
  const lastRolling = cashRolling.length ? cashRolling[cashRolling.length - 1] : null;

  if (!trend.length) {
    return (
      <Panel title="Analítica de nómina" meta="Fase 3" padding>
        <p className="text-[13px] text-[var(--color-fg-4)]">
          Cargá al menos un período para ver tendencias y costos por empleado.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI row: MoM, rolling avg, % of revenue */}
      <KPIGrid cols={revenue !== null ? 3 : 2}>
        <KPI
          label="Variación caja MoM"
          value={fmtPct(lastMoM)}
          meta="Mes vs mes anterior (gasto en caja)"
          tone={lastMoM !== null && lastMoM > 0 ? 'warn' : 'ok'}
          icon={TrendingUp}
        />
        <KPI
          label="Promedio móvil 3m"
          value={lastRolling !== null ? formatCurrency(lastRolling) : '—'}
          meta="Gasto en caja, media trimestral"
          icon={TrendingUp}
        />
        {revenue !== null && (
          <KPI
            label="Nómina % de ingresos"
            value={revenueKpi.pct === null ? '—' : `${revenueKpi.pct.toFixed(1)}%`}
            meta={
              revenueKpi.pct === null
                ? 'Sin ingresos en la ventana'
                : `${formatCurrency(totalCash)} / ${formatCurrency(revenue)}`
            }
            tone={revenueKpi.pct !== null && revenueKpi.pct > 50 ? 'err' : 'neutral'}
            icon={PieChart}
          />
        )}
      </KPIGrid>

      {/* Monthly trend chart — cashTotal vs employerCostTotal */}
      <Panel
        title="Tendencia mensual"
        meta="Caja vs costo empresa"
        padding
        actions={
          onExportPersonnelPDF || onExportPersonnelExcel ? (
            <div className="flex items-center gap-2">
              {onExportPersonnelPDF && (
                <button type="button" className="nx-btn nx-btn-ghost" onClick={onExportPersonnelPDF}>
                  <Download size={14} /> PDF
                </button>
              )}
              {onExportPersonnelExcel && (
                <button type="button" className="nx-btn nx-btn-ghost" onClick={onExportPersonnelExcel}>
                  <Download size={14} /> Excel
                </button>
              )}
            </div>
          ) : null
        }
      >
        <div
          style={{ width: '100%', height: 240, minHeight: 240, minWidth: 0 }}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-3"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={trend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="payrollCashFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--color-fg-4)' }}
                interval="preserveStartEnd"
                minTickGap={24}
                stroke="var(--color-line)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-fg-4)' }}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                width={42}
                stroke="var(--color-line)"
              />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--color-line-s)' }} />
              <Area
                type="monotone"
                dataKey="cashTotal"
                name="Gasto en caja"
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                fill="url(#payrollCashFill)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="employerCostTotal"
                name="Costo empresa"
                stroke="var(--color-fg-3)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-4)]">
          <Badge variant="neutral">Línea naranja: gasto en caja (KK + LSt + netos)</Badge>
          <Badge variant="neutral">Línea gris: costo empresa (gesamtkosten)</Badge>
          <Badge variant={lastMoM !== null && lastMoM > 0 ? 'warn' : 'ok'}>
            MoM caja {fmtPct(lastMoM)}
          </Badge>
        </div>
      </Panel>

      {/* Per-employee timeline with sparklines */}
      <Panel title="Costo por empleado" meta={`${pivot.length} empleados`} padding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
                <th className="px-4 py-3">Empleado</th>
                <th className="px-4 py-3 text-right">YTD Neto</th>
                <th className="px-4 py-3 text-right">YTD Bruto</th>
                <th className="px-4 py-3 text-right">YTD Costo empresa</th>
                <th className="px-4 py-3 text-center">Tendencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {pivot.map((row) => (
                <tr key={row.persNr || row.employeeId || row.name} className="hover:bg-[var(--color-bg-2)]">
                  <td className="px-4 py-3 text-sm text-[var(--color-fg-1)]">
                    {row.persNr ? (
                      <span className="font-mono text-[12px] text-[var(--color-fg-4)] mr-2">
                        [{row.persNr}]
                      </span>
                    ) : null}
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-2)]">
                    {formatCurrency(row.ytd.netto)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-2)]">
                    {formatCurrency(row.ytd.brutto)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-1)]">
                    {formatCurrency(row.ytd.gesamtkosten)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center">
                      <Sparkline values={row.sparkline} />
                    </div>
                  </td>
                </tr>
              ))}
              {pivot.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    <p className="label-mono text-[var(--color-fg-4)]">Sin líneas por empleado</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--color-fg-4)]">
          <Users size={12} /> Sparkline: costo empresa (gesamtkosten) por mes, eje completo.
        </p>
      </Panel>
    </div>
  );
};

export default NominasAnalytics;
