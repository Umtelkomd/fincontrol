/**
 * Shared settlement-matching rules for the CXC/CXP audit and repair scripts.
 *
 * Both `match-unlinked-settlements.cjs` (report) and `repair-cxc-cxp.cjs`
 * (write) MUST agree on what counts as a confident match — if they drift, the
 * repair acts on documents the report never showed. One module, one rule set.
 */

/** The "every payment links a bankMovement" rule shipped with PR #16. */
const POLICY_START = '2026-05-09';
/** Beyond this a movement is a different event, not the same payment. */
const DATE_WINDOW_DAYS = 45;
/** Cents of tolerance when comparing a document total to a movement. */
const AMOUNT_TOLERANCE = 0.01;
/** Below this a candidate is noise. */
const MIN_SCORE = 50;
/** A lone candidate at or above this is safe to link unattended. */
const CONFIDENT_SCORE = 85;
/** A confident match must also beat the runner-up by this margin. */
const CONFIDENT_MARGIN = 15;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const iso = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  if (value._seconds) return new Date(value._seconds * 1000).toISOString().slice(0, 10);
  return '';
};

const daysBetween = (left, right) => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((new Date(left) - new Date(right)) / 86400000));
};

const label = (doc) =>
  doc.counterpartyName || doc.vendor || doc.client || doc.description || doc.id;

const docNumber = (doc) => String(doc.documentNumber || doc.invoiceNumber || '').trim();

const grossOf = (doc) => num(doc.grossAmount ?? doc.amount);

/** Legal-form words carry no identifying signal. */
const NOISE = new Set(['gmbh', 'sl', 'slu', 'scp', 'sa', 'ag', 'ltd', 'the', 'und', 'von', 'der']);

const tokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !NOISE.has(token));

const nameOverlap = (left, right) => {
  const a = new Set(tokens(left));
  const b = tokens(right);
  if (a.size === 0 || b.length === 0) return 0;
  return b.filter((token) => a.has(token)).length / Math.max(a.size, b.length);
};

/** A settlement with no payment tied to a bank movement. */
const isUnlinkedSettlement = (doc) => {
  if (doc.status !== 'settled' && doc.status !== 'partial') return false;
  const payments = Array.isArray(doc.payments) ? doc.payments : [];
  return !payments.some((payment) => payment && payment.bankMovementId);
};

/** When the settlement was claimed — used for both windowing and policy age. */
const settledOn = (doc) => iso(doc.updatedAt) || iso(doc.dueDate);

const isPrePolicy = (doc) => {
  const when = settledOn(doc);
  return !when || when < POLICY_START;
};

/**
 * Score a movement as the cash counterpart of a document. Amount is the
 * backbone; date and name refine. A movement already spoken for by a DIFFERENT
 * document is disqualified, not penalised.
 *
 * @returns {object|null} null when the movement cannot be this payment
 */
const scoreCandidate = (doc, movement, idField) => {
  if (Math.abs(grossOf(doc) - num(movement.amount)) > AMOUNT_TOLERANCE) return null;

  const takenBy = movement[idField];
  if (takenBy && takenBy !== doc.id) return null;

  const gap = Math.min(
    daysBetween(movement.postedDate, settledOn(doc)),
    daysBetween(movement.postedDate, iso(doc.dueDate)),
  );
  if (gap > DATE_WINDOW_DAYS) return null;

  let score = 50;
  if (gap <= 5) score += 30;
  else if (gap <= 15) score += 20;
  else if (gap <= 30) score += 10;

  const overlap = nameOverlap(label(doc), movement.counterpartyName);
  const descriptionOverlap = nameOverlap(label(doc), movement.description);
  if (overlap >= 0.5) score += 20;
  else if (overlap > 0) score += 10;
  else if (descriptionOverlap > 0) score += 5;

  if (!movement.reconciledAt) score += 5;

  return {
    id: movement.id,
    postedDate: movement.postedDate,
    amount: num(movement.amount),
    counterparty: movement.counterpartyName || '',
    gapDays: gap,
    score,
    // Amount and date alone are circumstantial: a 1,232.84 Sixt invoice and a
    // 1,232.84 DZ BANK debit days apart score 85 while naming different parties.
    // Unattended linking requires the counterparty to actually corroborate.
    nameEvidence: overlap > 0 || descriptionOverlap > 0,
    alreadyLinkedTo: takenBy || null,
  };
};

/**
 * Rank every plausible movement for a document, best first.
 *
 * @param {object} doc
 * @param {Array<object>} movements - already filtered to the right direction
 * @param {'payableId'|'receivableId'} idField
 */
const candidatesFor = (doc, movements, idField) =>
  movements
    .map((movement) => scoreCandidate(doc, movement, idField))
    .filter(Boolean)
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score);

/**
 * CONFIABLE  — one clear winner; safe to link unattended.
 * AMBIGUO    — several plausible; a human picks.
 * SIN RASTRO — nothing with that amount nearby.
 *
 * "SIN RASTRO" does NOT mean unpaid: a consolidated debit or a payroll run
 * split into individual transfers will never match 1:1 on amount.
 */
const verdictFor = (candidates) => {
  if (candidates.length === 0) return 'SIN RASTRO';
  const [best, runnerUp] = candidates;
  const clearWinner =
    best.score >= CONFIDENT_SCORE && (!runnerUp || best.score - runnerUp.score >= CONFIDENT_MARGIN);
  // Name evidence is mandatory, never traded against a high score.
  if (clearWinner && best.nameEvidence) return 'CONFIABLE';
  return 'AMBIGUO';
};

/**
 * A duplicate is a document whose amount is already settled and bank-linked by
 * a DIFFERENT document. Keyed on amount + the movement that paid it, never on
 * the counterparty name — the real duplicates hide behind spelling variants
 * ("Tui" / "BKK TUI" / "TUI BKK", "Finanzamt" / "Finanzamt Stralsund").
 *
 * @returns {{ twinId: string, movementId: string }|null}
 */
const duplicateOf = (doc, siblings, movements, idField) => {
  if (!isUnlinkedSettlement(doc)) return null;
  const gross = grossOf(doc);
  if (gross <= 0) return null;

  for (const movement of movements) {
    if (Math.abs(num(movement.amount) - gross) > AMOUNT_TOLERANCE) continue;
    const twinId = movement[idField];
    if (!twinId || twinId === doc.id) continue;
    const twin = siblings.find((entry) => entry.id === twinId);
    if (!twin) continue;
    if (Math.abs(grossOf(twin) - gross) > AMOUNT_TOLERANCE) continue;
    const twinPayments = Array.isArray(twin.payments) ? twin.payments : [];
    if (!twinPayments.some((payment) => payment && payment.bankMovementId)) continue;
    return { twinId, movementId: movement.id };
  }
  return null;
};

module.exports = {
  AMOUNT_TOLERANCE,
  CONFIDENT_SCORE,
  DATE_WINDOW_DAYS,
  MIN_SCORE,
  POLICY_START,
  candidatesFor,
  docNumber,
  duplicateOf,
  grossOf,
  isPrePolicy,
  isUnlinkedSettlement,
  iso,
  label,
  num,
  settledOn,
  verdictFor,
};
