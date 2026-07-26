import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  Clock,
  Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Alert, Badge, KPI, KPIGrid, Panel } from '@/components/ui/nexus';
import { formatCurrency } from '../../../utils/formatters';
import { summarizeCashPosition } from '../lib/runway.js';

/**
 * CashPositionPanel — Phase B of the CFO views.
 *
 * All math is delegated to `lib/runway.js` (pure, tested); the panel is
 * presentational. `snapshot` carries the CASH inputs only — bank account,
 * canonical posted movements and the reconciliation anchors, handed down by
 * CFODashboard from the shared finance ledger.
 *
 * Provenance is part of the reading: when no anchor covers today the figure is
 * a legacy estimate from the static bank balance and is labelled as such. A
 * degraded number is never presented as a reconciled one.
 *
 * Visual highlights:
 *   - Cash today turns red below €10k (NEXUS accent)
 *   - Sparkline 90d with reference line at the critical threshold
 *   - Cash coverage + net coverage semantics
 */

const TooltipContent = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-3 py-2 rounded-md">
      <p className="font-mono text-[11px] text-[var(--color-fg-3)]">{d.date}</p>
      <p className="font-mono text-[12px] tabular-nums text-[var(--color-fg-1)]">
        {d.balance == null ? 'Sin ancla' : formatCurrency(d.balance)}
      </p>
    </div>
  );
};

const formatMonths = (months) => {
  if (!Number.isFinite(months)) return '∞';
  if (months >= 24) return `${(months / 12).toFixed(1)} años`;
  return `${months.toFixed(1)} meses`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const CashPositionPanel = ({ snapshot, reconciliationPending = false }) => {
  const summary = useMemo(() => {
    if (!snapshot) return null;
    return summarizeCashPosition(snapshot);
  }, [snapshot]);

  if (!snapshot) return null;

  const isReconciled = summary.cash.source === 'anchors';

  // With a usable anchor the bank-account document is no longer needed to
  // compute cash, so only ask for it when nothing is reconciled.
  if (!snapshot.bankAccount && !isReconciled) {
    return (
      <Panel title="Posición de caja" meta="Fase B" padding>
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-[var(--color-warn)] flex-shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-[14px] text-[var(--color-fg-1)]">
              No hay cuenta bancaria configurada.
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-fg-3)]">
              Definí saldo inicial + fecha de saldo en /configuracion → Cuenta bancaria
              para que la capa CFO pueda calcular caja actual y cobertura de caja.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  const {
    cash,
    burn30,
    burn90,
    runway,
    netRunway,
    net30PerMonth,
    net90PerMonth,
    cashCoverageMonths,
    netRunwayMonths,
    sparkline,
  } = summary;
  const cashCritical = cash.cashToday < runway.criticalThreshold;
  const netPositive = net30PerMonth >= 0;

  const originLabel = isReconciled ? 'Ancla conciliada' : 'Saldo estático banco';

  return (
    <Panel
      title="Posición de caja"
      meta={
        isReconciled
          ? `Ancla ${formatDate(cash.balanceDate)}`
          : reconciliationPending
            ? 'Conciliación cargando…'
            : 'Sin conciliar'
      }
      padding
    >
      <div className="space-y-4">
        {!isReconciled && !reconciliationPending && (
          <Alert variant="warn" title="Caja sin conciliar">
            No hay ancla de conciliación con fecha igual o anterior a hoy, así que esta caja
            es una estimación a partir del saldo estático del banco
            ({formatDate(cash.balanceDate)}), no una cifra conciliada. Registrá el saldo
            verificado en Configuración → Tesorería para que coincida con el Resumen.
          </Alert>
        )}

        <KPIGrid cols={4}>
          <KPI
            label="Caja actual"
            value={formatCurrency(cash.cashToday)}
            meta={`${originLabel} ${formatCurrency(cash.startingBalance)} ${cash.netSinceBalanceDate >= 0 ? '+' : ''}${formatCurrency(cash.netSinceBalanceDate)}`}
            tone={cashCritical ? 'err' : cash.cashToday > runway.criticalThreshold * 3 ? 'ok' : 'warn'}
            icon={Wallet}
          />
          <KPI
            label="Egreso prom. 30d"
            value={formatCurrency(burn30.perMonth)}
            meta={`${formatCurrency(burn30.perDay)}/día · neto ${formatCurrency(burn30.net)}`}
            tone={burn30.perMonth > 0 ? 'warn' : 'ok'}
            icon={ArrowDownRight}
          />
          <KPI
            label="Cobertura de caja"
            value={formatMonths(cashCoverageMonths)}
            meta={
              netPositive
                ? 'Neto 30d positivo'
                : `Quiebre neto ~${formatDate(netRunway.projectedZeroDate)}`
            }
            tone={
              cashCritical
                ? 'err'
                : netPositive || netRunwayMonths > 6
                ? 'ok'
                : 'warn'
            }
            icon={Clock}
          />
          <KPI
            label="Umbral crítico"
            value={
              runway.isCritical
                ? 'Hoy'
                : netPositive
                ? 'Nunca'
                : formatDate(netRunway.projectedCriticalDate)
            }
            meta={`Umbral ${formatCurrency(runway.criticalThreshold)}`}
            tone={runway.isCritical ? 'err' : 'neutral'}
            icon={AlertTriangle}
          />
        </KPIGrid>

        {cashCritical && (
          <div className="flex items-start gap-3 rounded-md border border-[var(--color-err)] bg-[var(--color-bg-1)] px-4 py-3">
            <AlertTriangle className="text-[var(--color-err)] flex-shrink-0 mt-0.5" size={16} />
            <div className="text-[12px] text-[var(--color-fg-1)]">
              Caja actual ({formatCurrency(cash.cashToday)}) está por debajo del umbral
              crítico de {formatCurrency(runway.criticalThreshold)}. Revisar cobranza y
              recortar gastos discrecionales.
            </div>
          </div>
        )}

        <div
          style={{ width: '100%', height: 200, minHeight: 200, minWidth: 0 }}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-3"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={sparkline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--color-fg-4)' }}
                tickFormatter={(v) => v.slice(5)}
                interval="preserveStartEnd"
                minTickGap={32}
                stroke="var(--color-line)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-fg-4)' }}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                width={42}
                stroke="var(--color-line)"
              />
              <Tooltip content={<TooltipContent />} cursor={{ stroke: 'var(--color-line-s)' }} />
              <ReferenceLine
                y={runway.criticalThreshold}
                stroke="var(--color-err)"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                fill="url(#cashFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-4)]">
          {isReconciled && sparkline.some((point) => point.balance == null) && (
            <Badge variant="neutral">
              Serie conciliada desde {formatDate(cash.balanceDate)}
            </Badge>
          )}
          <Badge variant="neutral">Egreso prom. 90d: {formatCurrency(burn90.perMonth)}/mes</Badge>
          <Badge variant={net90PerMonth >= 0 ? 'ok' : 'warn'}>
            Neto 90d: {formatCurrency(net90PerMonth)}/mes
          </Badge>
          <Badge variant="neutral">
            Volumen 30d: entradas {formatCurrency(burn30.totalIn)} · salidas {formatCurrency(burn30.totalOut)}
          </Badge>
          <span>Línea roja punteada = umbral crítico ({formatCurrency(runway.criticalThreshold)})</span>
        </div>
      </div>
    </Panel>
  );
};

export default CashPositionPanel;
