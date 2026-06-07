import { useMemo } from 'react';
import {
  AlertTriangle,
  Calculator,
  Gauge,
  Layers3,
  Percent,
  ShieldAlert,
} from 'lucide-react';
import { Alert, Badge, KPI, KPIGrid, Panel, Table } from '@/components/ui/nexus';
import { formatCurrency } from '../../../utils/formatters';
import { summarizeOverheadBurdenRate } from '../lib/overheadBurdenRate';

const money = (value) => `${formatCurrency(value)} €`;
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

const formatMonth = (month) => {
  if (!month) return '—';
  try {
    return new Date(`${month}-01T00:00:00`).toLocaleDateString('es-ES', {
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return month;
  }
};

const qualityMeta = {
  high: {
    badge: 'Alta confianza',
    variant: 'ok',
    message: 'Pocos movimientos sin clasificar; la tasa es usable para cotización.',
  },
  medium: {
    badge: 'Confianza media',
    variant: 'warn',
    message: 'Hay movimientos sin clasificar. La tasa incluye buffer para cubrirlos.',
  },
  low: {
    badge: 'Baja confianza',
    variant: 'err',
    message: 'Demasiados movimientos sin clasificar. Reclasifica banco antes de usarla como precio final.',
  },
};

const monthColumns = [
  {
    key: 'month',
    label: 'Mes',
    render: (_, value) => formatMonth(value),
  },
  {
    key: 'direct',
    label: 'Directo',
    align: 'right',
    mono: true,
    render: (_, value) => money(value),
  },
  {
    key: 'overhead',
    label: 'Overhead',
    align: 'right',
    mono: true,
    render: (_, value) => money(value),
  },
  {
    key: 'unknown',
    label: 'Sin clasif.',
    align: 'right',
    mono: true,
    render: (_, value) => money(value),
  },
  {
    key: 'bufferedRatePct',
    label: 'Rate c/buffer',
    align: 'right',
    mono: true,
    render: (_, value) => pct(value),
  },
];

const OverheadBurdenPanel = ({ snapshot }) => {
  const summary = useMemo(() => {
    if (!snapshot) return null;
    return summarizeOverheadBurdenRate(snapshot, { windowMonths: 5 });
  }, [snapshot]);

  if (!summary) return null;

  const quality = qualityMeta[summary.dataQuality] || qualityMeta.medium;
  const monthsLabel = summary.months.length > 0
    ? `${formatMonth(summary.months[0])} — ${formatMonth(summary.months[summary.months.length - 1])}`
    : 'Sin meses cerrados';
  const quoteRate = summary.rates.recommendedQuoteRatePct;
  const internalRate = summary.rates.internalRatePct;
  const costMultiplier = summary.rates.directCostMultiplier.toFixed(2);
  const priceAt15PctMargin = quoteRate > 0 ? (summary.rates.directCostMultiplier / 0.85).toFixed(3) : '—';

  return (
    <Panel
      title="Overhead burden rate"
      meta={monthsLabel}
      actions={<Badge variant={quality.variant}>{quality.badge}</Badge>}
      padding
    >
      {!summary.hasData ? (
        <Alert variant="warn" title="Sin base suficiente">
          No hay costes directos/overhead suficientes en meses cerrados para calcular la carga.
        </Alert>
      ) : (
        <div className="space-y-4">
          <KPIGrid cols={4}>
            <KPI
              label="Carga cotización"
              value={`${quoteRate}%`}
              meta={`Coste directo × ${costMultiplier}`}
              tone="warn"
              size="lg"
              icon={Percent}
            />
            <KPI
              label="Rate interno"
              value={`${internalRate}%`}
              meta={`Base ${pct(summary.rates.baseRatePct)} · recomend. ${pct(summary.rates.recommendationBasisRatePct)}`}
              tone="info"
              icon={Gauge}
            />
            <KPI
              label="Overhead mensual"
              value={money(summary.averages.overheadMonthly)}
              meta={`Nómina admin ${pct(summary.payrollSplit.overheadSharePct)}`}
              tone="default"
              icon={Layers3}
            />
            <KPI
              label="Coste directo mensual"
              value={money(summary.averages.directMonthly)}
              meta={summary.averages.directMonthly >= summary.guidance.highVolumeThreshold ? 'Volumen alto' : 'Volumen bajo/medio'}
              tone={summary.averages.directMonthly >= summary.guidance.highVolumeThreshold ? 'ok' : 'warn'}
              icon={Calculator}
            />
          </KPIGrid>

          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-4">
            <Panel title="Detalle mensual" meta={`${summary.months.length} meses cerrados`} padding={false}>
              <Table columns={monthColumns} rows={summary.byMonth} />
            </Panel>

            <Panel title="Cómo usarlo" meta="Presupuestos" padding>
              <div className="space-y-3 text-[13px] text-[var(--color-fg-3)]">
                <Alert variant={quality.variant} title={quality.message}>
                  Sin clasificar: {money(summary.averages.unknownMonthly)}/mes · {pct(summary.rates.unknownSharePct)} de la base operativa.
                </Alert>

                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-4">
                  <p className="label-mono text-[var(--color-fg-3)]">Formula operativa</p>
                  <p className="mt-2 font-mono text-[15px] tabular-nums text-[var(--color-fg-1)]">
                    coste cargado = directo × {costMultiplier}
                  </p>
                  <p className="mt-2 font-mono text-[12px] text-[var(--color-fg-4)]">
                    Con 15% margen neto: precio ≈ directo × {priceAt15PctMargin}
                  </p>
                </div>

                <div className="flex items-start gap-2 text-[12px] text-[var(--color-fg-4)]">
                  <ShieldAlert size={14} className="mt-0.5 text-[var(--color-warn)] flex-shrink-0" />
                  <p>
                    El cálculo excluye IVA/impuestos, financiación, intereses y transferencias internas. Nómina social/fiscal se reparte con el último payroll cargado ({summary.payrollSplit.period || 'sin payroll'}).
                  </p>
                </div>

                {summary.dataQuality !== 'high' && (
                  <div className="flex items-start gap-2 text-[12px] text-[var(--color-fg-4)]">
                    <AlertTriangle size={14} className="mt-0.5 text-[var(--color-err)] flex-shrink-0" />
                    <p>
                      Para bajar la carga con seguridad, primero reduce “Sin clasificar” y sostén costes directos &gt; {money(summary.guidance.highVolumeThreshold)}/mes.
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default OverheadBurdenPanel;
