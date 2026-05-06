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
import { Badge, KPI, KPIGrid, Panel } from '@/components/ui/nexus';
import { formatCurrency } from '../../../utils/formatters';
import { summarizeCashPosition } from '../lib/runway.js';

/**
 * CashPositionPanel — Phase B of the CFO views.
 *
 * Reads from the CFO snapshot only. All math is delegated to
 * `lib/runway.js` (pure, tested). The panel itself is presentational.
 *
 * Visual highlights:
 *   - Cash today turns red below €10k (NEXUS accent)
 *   - Sparkline 90d with reference line at the critical threshold
 *   - Cash coverage + net runway semantics
 */

const TooltipContent = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="border border-[var(--border-visible)] bg-[var(--surface)] px-3 py-2 rounded-md">
      <p className="nd-mono text-[11px] text-[var(--text-secondary)]">{d.date}</p>
      <p className="nd-mono text-[12px] tabular-nums text-[var(--text-primary)]">
        {formatCurrency(d.balance)}
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

const CashPositionPanel = ({ snapshot }) => {
  const summary = useMemo(() => {
    if (!snapshot) return null;
    return summarizeCashPosition(snapshot);
  }, [snapshot]);

  if (!snapshot) return null;

  if (!snapshot.bankAccount) {
    return (
      <Panel title="Cash Position" meta="Fase B" padding>
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-[var(--warning)] flex-shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-[14px] text-[var(--text-primary)]">
              No hay cuenta bancaria configurada.
            </p>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Definí starting balance + balance date en /configuracion → Cuenta bancaria
              para que la capa CFO pueda calcular cash hoy y runway.
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

  return (
    <Panel
      title="Cash Position"
      meta={`Bal. ${formatDate(cash.balanceDate)}`}
      padding
    >
      <div className="space-y-4">
        <KPIGrid cols={4}>
          <KPI
            label="Cash hoy"
            value={formatCurrency(cash.cashToday)}
            meta={`Start ${formatCurrency(cash.startingBalance)} ${cash.netSinceBalanceDate >= 0 ? '+' : ''}${formatCurrency(cash.netSinceBalanceDate)}`}
            tone={cashCritical ? 'err' : cash.cashToday > runway.criticalThreshold * 3 ? 'ok' : 'warn'}
            icon={Wallet}
          />
          <KPI
            label="Burn 30d"
            value={formatCurrency(burn30.perMonth)}
            meta={`${formatCurrency(burn30.perDay)}/día · neto ${formatCurrency(burn30.net)}`}
            tone={burn30.perMonth > 0 ? 'warn' : 'ok'}
            icon={ArrowDownRight}
          />
          <KPI
            label="Coverage"
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
            label="Cash crítico"
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
          <div className="flex items-start gap-3 rounded-md border border-[var(--error)] bg-[var(--surface)] px-4 py-3">
            <AlertTriangle className="text-[var(--error)] flex-shrink-0 mt-0.5" size={16} />
            <div className="text-[12px] text-[var(--text-primary)]">
              Cash actual ({formatCurrency(cash.cashToday)}) está por debajo del umbral
              crítico de {formatCurrency(runway.criticalThreshold)}. Revisar cobranza y
              recortar gastos discrecionales.
            </div>
          </div>
        )}

        <div
          style={{ width: '100%', height: 200, minHeight: 200, minWidth: 0 }}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-3"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={sparkline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}
                tickFormatter={(v) => v.slice(5)}
                interval="preserveStartEnd"
                minTickGap={32}
                stroke="var(--border)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                width={42}
                stroke="var(--border)"
              />
              <Tooltip content={<TooltipContent />} cursor={{ stroke: 'var(--border-visible)' }} />
              <ReferenceLine
                y={runway.criticalThreshold}
                stroke="var(--error)"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="var(--accent)"
                strokeWidth={1.5}
                fill="url(#cashFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-disabled)]">
          <Badge variant="neutral">90d burn: {formatCurrency(burn90.perMonth)}/mes</Badge>
          <Badge variant={net90PerMonth >= 0 ? 'ok' : 'warn'}>
            Neto 90d: {formatCurrency(net90PerMonth)}/mes
          </Badge>
          <Badge variant="neutral">
            Volumen 30d: in {formatCurrency(burn30.totalIn)} · out {formatCurrency(burn30.totalOut)}
          </Badge>
          <span>Línea roja punteada = umbral crítico ({formatCurrency(runway.criticalThreshold)})</span>
        </div>
      </div>
    </Panel>
  );
};

export default CashPositionPanel;
