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
import { CalendarClock, Scale, Wallet } from "lucide-react";
import { KPI, KPIGrid } from "@/components/ui/nexus";
import { formatCurrency } from "../../utils/formatters";
import { describeCashMeta, describeRunway } from "./liquidityCopy";

const LiquidityKpis = ({
	metrics = {},
	forecast = null,
	cashMeta,
	size = "md",
	className = "",
}) => {
	const sourceStatus = (cashMeta ?? metrics.cashMeta)?.status;
	const available =
		metrics.cashSource !== "unavailable" &&
		!["loading", "error"].includes(sourceStatus) &&
		Number.isFinite(metrics.currentCash);
	const unavailableValue =
		sourceStatus === "loading" ? "Cargando…" : "No disponible";
	const currentCash = metrics.currentCash;
	const netPosition = metrics.netPosition ?? metrics.projectedLiquidity;
	const cashSourceMeta = available
		? describeCashMeta({
				cashSource: metrics.cashSource,
				cashMeta: cashMeta ?? metrics.cashMeta,
			})
		: null;
	const runway =
		available && forecast?.available !== false
			? describeRunway({
					currentCash,
					weeksToNegative: forecast?.weeksToNegative ?? null,
					runwayMonths: metrics.runwayMonths ?? null,
				})
			: null;

	return (
		<KPIGrid cols={3} className={className}>
			<KPI
				label="Caja"
				value={available ? formatCurrency(currentCash) : unavailableValue}
				size={size}
				tone={available && currentCash < 0 ? "err" : "default"}
				icon={Wallet}
				meta={
					available ? cashSourceMeta : "Pendiente de conciliación verificada"
				}
			/>
			<KPI
				label="Posición neta"
				value={
					available && Number.isFinite(netPosition)
						? formatCurrency(netPosition)
						: unavailableValue
				}
				size={size}
				tone={!available ? "default" : netPosition >= 0 ? "ok" : "err"}
				icon={Scale}
				meta="Caja + por cobrar − por pagar"
			/>
			<KPI
				label="Runway"
				value={
					available && forecast?.available !== false
						? runway.value
						: unavailableValue
				}
				size={size}
				tone={
					available && forecast?.available !== false && runway.critical
						? "err"
						: "default"
				}
				icon={CalendarClock}
				meta={
					available && forecast?.available !== false
						? runway.meta
						: "No se puede evaluar la cobertura de caja"
				}
			/>
		</KPIGrid>
	);
};

export default LiquidityKpis;
