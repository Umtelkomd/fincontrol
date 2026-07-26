/**
 * Coverage summary — presentation helpers for `classificationCoverage`.
 *
 * The ledger sits around 7% classified and no view ever said so. These
 * helpers turn the raw coverage object into the three things the header
 * needs: a sentence, a bar width and a severity tone.
 *
 * Pure module — no React, no Firebase.
 */

const OK_THRESHOLD = 90;
const WARN_THRESHOLD = 50;

const toCount = (value) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

/** Percentage clamped to [0, 100]; anything unusable becomes 0. */
const toPercent = (coverage) => {
  const raw = Number(coverage?.pct);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, raw));
};

/**
 * formatCoverageSummary — "112 de 1576 movimientos clasificados (7,1%)".
 * Spanish decimal separator, no rounding up: the number has to sting.
 */
export const formatCoverageSummary = (coverage) => {
  const total = toCount(coverage?.total);
  const classified = toCount(coverage?.classified);
  const pct = toPercent(coverage).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return `${classified} de ${total} movimientos clasificados (${pct}%)`;
};

/**
 * coverageBarWidth — CSS width for the filled portion of the progress bar.
 * Always a dot separator: `width: 7,1%` is not valid CSS.
 */
export const coverageBarWidth = (coverage) => `${toPercent(coverage)}%`;

/** coverageTone — severity used for the badge / bar color. */
export const coverageTone = (coverage) => {
  const pct = toPercent(coverage);
  if (pct >= OK_THRESHOLD) return 'ok';
  if (pct >= WARN_THRESHOLD) return 'warn';
  return 'err';
};
