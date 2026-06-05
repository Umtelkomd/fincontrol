/**
 * Payroll period status lifecycle — pure derivation over obligation liveStatuses.
 *
 * Derived READ-ONLY from the 6 obligations' live payable statuses (no settlement
 * path here — settlement only flows through bank-movement conciliation):
 *   borrador — no obligations yet (draft).
 *   cargada  — all obligations issued/overdue, none settled or partial.
 *   parcial  — mixed: some settled/partial, some still open.
 *   pagada   — every obligation is terminal (settled or cancelled).
 *
 * Statuses map to issued/partial/settled/cancelled/overdue from DOCUMENT_STATUS.
 */

const TERMINAL = new Set(['settled', 'cancelled']);

/**
 * @param {Array<{liveStatus?: string}>} obligations
 * @returns {'borrador'|'cargada'|'parcial'|'pagada'}
 */
export const derivePeriodStatus = (obligations) => {
  const rows = Array.isArray(obligations) ? obligations : [];
  if (rows.length === 0) return 'borrador';

  const statuses = rows.map((o) => o?.liveStatus || 'issued');
  const allTerminal = statuses.every((s) => TERMINAL.has(s));
  const anySettled = statuses.some((s) => s === 'settled');
  // Every obligation terminal: 'pagada' only if at least one was actually
  // settled — an all-cancelled period is 'cancelada', not paid.
  if (allTerminal) return anySettled ? 'pagada' : 'cancelada';

  const anyProgress = statuses.some((s) => s === 'settled' || s === 'partial');
  if (anyProgress) return 'parcial';

  return 'cargada';
};

const LABELS = {
  borrador: 'Borrador',
  cargada: 'Cargada',
  parcial: 'Parcial',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
};

const TONES = {
  borrador: 'neutral',
  cargada: 'info',
  parcial: 'warn',
  pagada: 'ok',
  cancelada: 'err',
};

/** Spanish label for a period status. */
export const statusLabel = (status) => LABELS[status] || status || '';

/** Nexus Badge tone for a period status. */
export const statusBadgeTone = (status) => TONES[status] || 'neutral';

/** Stable audit-detail string for a status transition. */
export const periodStatusTransition = (prev, next) =>
  `Estado del período: ${statusLabel(prev)} → ${statusLabel(next)}`;

export default {
  derivePeriodStatus,
  statusLabel,
  statusBadgeTone,
  periodStatusTransition,
};
