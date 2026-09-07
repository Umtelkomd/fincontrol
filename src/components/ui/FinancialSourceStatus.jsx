import { Button } from "@/components/ui/nexus";

/** Presentation only: retry belongs to the caller's existing listener. */
const FinancialSourceStatus = ({
	status,
	onRetry,
	label = "Caja",
	retryLabel = "Reintentar conciliación",
}) => {
	if (status === "ready") return null;
	const loading = status === "loading";
	return (
		<div
			role={loading ? "status" : "alert"}
			className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-[13px] text-[var(--color-fg-3)]"
		>
			<p
				className={loading ? "font-mono" : "font-mono text-[var(--color-err)]"}
			>
				{loading ? "Cargando conciliación…" : `${label} no disponible`}
			</p>
			<p className="mt-1 mb-2">
				{loading
					? "Esperando la lectura de conciliación. No se muestran importes sin verificar."
					: "No se pudo leer la conciliación. Reintenta para recuperar los importes verificados."}
			</p>
			{!loading && onRetry && (
				<Button type="button" onClick={onRetry}>
					{retryLabel}
				</Button>
			)}
		</div>
	);
};

export default FinancialSourceStatus;
