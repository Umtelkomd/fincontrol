import { Badge } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';
import { coverageBarWidth, coverageTone, formatCoverageSummary } from './lib/coverageSummary';

const TONE_TEXT = {
 ok: 'text-[var(--color-ok)]',
 warn: 'text-[var(--color-warn)]',
 err: 'text-[var(--color-err)]',
};

const TONE_LABEL = {
 ok: 'Al día',
 warn: 'Incompleto',
 err: 'Crítico',
};

/**
 * ClassificationCoverage — how much of the ledger is actually classified.
 *
 * Shared by the classifier inbox and the movements table so both views quote
 * the same number. Until this existed nobody could tell the ledger was sitting
 * near 7%, which is exactly why the backlog kept growing.
 */
const ClassificationCoverage = ({ coverage, title = 'Cobertura de clasificación', action = null }) => {
 const tone = coverageTone(coverage);
 const width = coverageBarWidth(coverage);
 const pending = Math.max(0, (coverage?.total || 0) - (coverage?.classified || 0));

 return (
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-5 py-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="min-w-0">
 <p className="label-mono text-[var(--color-fg-3)]">{title}</p>
 <p className={`mt-1.5 font-display text-[20px] font-light tracking-tight ${TONE_TEXT[tone]}`}>
 {formatCoverageSummary(coverage)}
 </p>
 <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-3)]">
 {pending} sin clasificar · €{formatCurrency(coverage?.unclassifiedOutflow || 0)} de salidas sin asignar
 </p>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant={tone} dot>{TONE_LABEL[tone]}</Badge>
 {action}
 </div>
 </div>

 <div
 className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-3)]"
 role="progressbar"
 aria-label={title}
 aria-valuemin={0}
 aria-valuemax={100}
 aria-valuenow={Number(coverage?.pct) || 0}
 >
 <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width }} />
 </div>

 {/* The four buckets add up to `total` — see classificationCoverage. */}
 <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--color-fg-3)]">
 <span>Obra {coverage?.byScope?.project || 0}</span>
 <span>Estructura {coverage?.byScope?.overhead || 0}</span>
 <span>Transferencia {coverage?.byScope?.transfer || 0}</span>
 <span>Sin destino {coverage?.byScope?.unresolved || 0}</span>
 </div>
 </section>
 );
};

export default ClassificationCoverage;
