/**
 * LiquidityKpis — Caja / Posición neta / Runway, once.
 *
 * Every cockpit (Resumen, Tesorería, the executive summary) renders this same
 * trio with the same labels, the same metas and the same numbers. Feed it the
 * result of `useTreasuryMetrics` (which owns the formulas) and, when available,
 * the `useCashForecast` result so the runway can prefer the committed-outflow
 * wall over the average-burn estimate.
 *
 *   <LiquidityKpis metrics={metrics} forecast={forecast} size="lg" />
 *
 * `cashMeta` defaults to `metrics.cashMeta`; pass it explicitly only when the
 * caller holds the ledger meta apart from the metrics object.
 */
import { CalendarClock, Scale, Wallet } from 'lucide-react';
import { KPI, KPIGrid } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';
import { describeCashMeta, describeRunway } from './liquidityCopy';

const LiquidityKpis = ({ metrics = {}, forecast = null, cashMeta, size = 'md', className = '' }) => {
  const currentCash = Number(metrics.currentCash) || 0;
  const netPosition = Number(metrics.netPosition ?? metrics.projectedLiquidity) || 0;
  const cashSourceMeta = describeCashMeta({
    cashSource: metrics.cashSource,
    cashMeta: cashMeta ?? metrics.cashMeta,
  });
  const runway = describeRunway({
    currentCash,
    weeksToNegative: forecast?.weeksToNegative ?? null,
    runwayMonths: metrics.runwayMonths ?? null,
  });

  return (
    <KPIGrid cols={3} className={className}>
      <KPI
        label="Caja"
        value={formatCurrency(currentCash)}
        size={size}
        tone={currentCash < 0 ? 'err' : 'default'}
        icon={Wallet}
        meta={cashSourceMeta}
      />
      <KPI
        label="Posición neta"
        value={formatCurrency(netPosition)}
        size={size}
        tone={netPosition >= 0 ? 'ok' : 'err'}
        icon={Scale}
        meta="Caja + por cobrar − por pagar"
      />
      <KPI
        label="Runway"
        value={runway.value}
        size={size}
        tone={runway.critical ? 'err' : 'default'}
        icon={CalendarClock}
        meta={runway.meta}
      />
    </KPIGrid>
  );
};

export default LiquidityKpis;
