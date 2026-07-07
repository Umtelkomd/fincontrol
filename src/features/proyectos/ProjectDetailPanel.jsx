/**
 * Project detail — EVM breakdown, accrual cost composition, S-curve and
 * inline baseline editing for one selected control row.
 *
 * Remounted via key={row.key} by the parent, so draft state resets cleanly on
 * selection change without effect-based syncing.
 */
import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { KPI, KPIGrid, Panel, Button, EmptyState } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';
import { buildCostCurve } from './lib/projectControl';
import { fmtMoney, fmtPctFraction, fmtRatio } from './controlFormat';

const clampPct = (value) => Math.min(100, Math.max(0, value));

const BreakdownRow = ({ label, value, strong = false, tone }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <p className={`text-[13px] ${strong ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-fg-3)]'}`}>{label}</p>
    <p
      className={`font-mono text-[13px] tabular-nums ${strong ? 'font-medium' : ''}`}
      style={{ color: tone || (strong ? 'var(--color-fg-1)' : 'var(--color-fg-2)') }}
    >
      {value}
    </p>
  </div>
);

const CurveTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-3 shadow-lg">
      <p className="label-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-4)] mb-2">{label}</p>
      <div className="space-y-1.5 text-[12px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--color-fg-3)]">Costo real</span>
          <span className="font-mono tabular-nums text-[var(--color-accent)]">
            {point.actual == null ? '—' : formatCurrency(point.actual)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--color-fg-3)]">PV lineal</span>
          <span className="font-mono tabular-nums text-[var(--color-fg-3)]">{formatCurrency(point.pv)}</span>
        </div>
      </div>
    </div>
  );
};

const BaselineField = ({ label, value, onChange, suffix = '€', max }) => (
  <div>
    <label className="mb-2 block label-mono text-[var(--color-fg-3)]">{label}</label>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--color-fg-4)]">{suffix}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] py-2 pl-8 pr-3 font-mono text-[13px] tabular-nums text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-line-s)]"
      />
    </div>
  </div>
);

const ProjectDetailPanel = ({ row, movements, payables, projects, asOf, onSave }) => {
  const [drafts, setDrafts] = useState({
    contractValue: row.contractValue ?? 0,
    bac: row.bac ?? 0,
    percentComplete: row.percentComplete ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const series = useMemo(
    () =>
      buildCostCurve({
        movements,
        payables,
        projects,
        projectKey: row.key,
        bac: row.bac,
        startDate: row.startDate,
        endDate: row.endDate,
        asOf,
      }),
    [movements, payables, projects, row.key, row.bac, row.startDate, row.endDate, asOf],
  );

  if (row.unknown) {
    return (
      <Panel title={row.name} meta="Proyecto sin catalogar">
        <EmptyState
          title="Sin catalogar"
          description="Estos movimientos usan un nombre de proyecto que no existe en el catálogo. Crea el proyecto en Configuración o corrige el nombre en los documentos para incluirlo en el control."
        />
      </Panel>
    );
  }

  const handleSave = async () => {
    // Money baselines can never be negative — mirror the percent clamp.
    const contractValue = Math.max(0, parseFloat(drafts.contractValue) || 0);
    const budget = Math.max(0, parseFloat(drafts.bac) || 0);
    const percentComplete = clampPct(parseFloat(drafts.percentComplete) || 0);
    setSaving(true);
    const result = await onSave(row.projectId, { contractValue, budget, percentComplete });
    setSaving(false);
    setSaveResult(result?.success ? 'ok' : 'error');
  };

  const evm = row.evm || {};

  return (
    <Panel
      title={`Detalle · ${row.displayName}`}
      meta="PV: costo planificado a hoy · EV: valor ganado según avance · AC: costo real devengado"
    >
      {/* EVM strip */}
      <KPIGrid cols={4}>
        <KPI label="PV" value={fmtMoney(evm.pv)} size="sm" meta="Valor planificado" />
        <KPI label="EV" value={fmtMoney(evm.ev)} size="sm" meta="Valor ganado" />
        <KPI label="AC" value={fmtMoney(evm.ac)} size="sm" meta="Costo real" />
        <KPI
          label="CPI"
          value={fmtRatio(evm.cpi)}
          size="sm"
          tone={evm.cpi == null ? 'default' : evm.cpi < 0.85 ? 'err' : evm.cpi < 0.97 ? 'warn' : 'ok'}
          meta="Eficiencia de costo"
        />
        <KPI
          label="SPI"
          value={fmtRatio(evm.spi)}
          size="sm"
          tone={evm.spi == null ? 'default' : evm.spi < 0.85 ? 'err' : evm.spi < 0.97 ? 'warn' : 'ok'}
          meta="Eficiencia de cronograma"
        />
        <KPI label="EAC" value={fmtMoney(evm.eac)} size="sm" meta="Costo estimado al cierre" />
        <KPI
          label="VAC"
          value={fmtMoney(evm.vac)}
          size="sm"
          tone={evm.vac == null ? 'default' : evm.vac < 0 ? 'err' : 'ok'}
          meta="Variación al cierre"
        />
        <KPI label="% Gastado" value={evm.percentSpent == null ? '—' : `${evm.percentSpent.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`} size="sm" meta="AC / BAC" />
      </KPIGrid>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Cost breakdown */}
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
          <p className="label-mono text-[var(--color-fg-3)] mb-1">Composición de costo e ingreso</p>
          <div className="divide-y divide-[var(--color-line)]">
            <BreakdownRow label="Pagado (caja)" value={formatCurrency(row.cashOut)} />
            <BreakdownRow label="Comprometido (CXP abiertas)" value={formatCurrency(row.openPayables)} />
            <BreakdownRow label="Nómina asignada" value={formatCurrency(row.labor)} />
            <BreakdownRow label="Overhead asignado" value={formatCurrency(row.overheadAllocated)} />
            <BreakdownRow label="Costo total cargado" value={formatCurrency(row.burdenedCost)} strong />
            <BreakdownRow
              label="Ingreso devengado (cobrado + por cobrar)"
              value={formatCurrency(row.revenueAccrued)}
              strong
            />
            <BreakdownRow
              label="Margen bruto"
              value={fmtPctFraction(row.grossMarginToDate)}
              tone={row.grossMarginToDate != null && row.grossMarginToDate < 0 ? 'var(--color-err)' : 'var(--color-ok)'}
            />
            <BreakdownRow
              label="Margen neto (con overhead)"
              value={fmtPctFraction(row.netMarginToDate)}
              tone={row.netMarginToDate != null && row.netMarginToDate < 0 ? 'var(--color-err)' : 'var(--color-ok)'}
            />
          </div>
        </div>

        {/* S-curve */}
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-3">
          <p className="label-mono text-[var(--color-fg-3)] mb-2 px-1">Curva S — costo acumulado vs. baseline</p>
          {series.length === 0 ? (
            <EmptyState
              title="Sin baseline"
              description="Define fecha inicio, fecha fin y presupuesto de costos para trazar la curva planificada."
            />
          ) : (
            <div style={{ width: '100%', height: 220, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart data={series} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 6" stroke="var(--color-line)" vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-fg-4)', fontFamily: 'var(--font-mono)' }}
                    interval="preserveStartEnd"
                    minTickGap={20}
                    axisLine={{ stroke: 'var(--color-line)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--color-fg-4)', fontFamily: 'var(--font-mono)' }}
                    tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                    width={48}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CurveTooltip />} cursor={{ stroke: 'var(--color-line-s)' }} />
                  <Line
                    type="monotone"
                    dataKey="pv"
                    name="PV lineal"
                    stroke="var(--color-fg-4)"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Costo real"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: 'var(--color-accent)', strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Baseline inline edit */}
      <div className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-4">
        <p className="label-mono text-[var(--color-fg-3)] mb-3">Baseline del proyecto</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
          <BaselineField
            label="Contrato (EUR)"
            value={drafts.contractValue}
            onChange={(value) => setDrafts((prev) => ({ ...prev, contractValue: value }))}
          />
          <BaselineField
            label="Presupuesto de costos (EUR)"
            value={drafts.bac}
            onChange={(value) => setDrafts((prev) => ({ ...prev, bac: value }))}
          />
          <BaselineField
            label="Avance físico (%)"
            suffix="%"
            max={100}
            value={drafts.percentComplete}
            onChange={(value) => setDrafts((prev) => ({ ...prev, percentComplete: value }))}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={Save} loading={saving} onClick={handleSave}>
              Guardar
            </Button>
            {saveResult === 'ok' && (
              <span className="label-mono text-[var(--color-ok)]">Guardado</span>
            )}
            {saveResult === 'error' && (
              <span className="label-mono text-[var(--color-err)]">Error al guardar</span>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
};

export default ProjectDetailPanel;
