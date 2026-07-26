/**
 * Cost Scope — where an expense lands
 * ─────────────────────────────────
 * Pure functions that answer one question about a bank movement:
 * is this cost part of a construction site (obra) or of the company
 * structure (estructura / overhead)?
 *
 *   normalizeCostScope(movement)            → 'project' | 'overhead' | ''
 *   validateClassification(movement, form)  → { valid, error }
 *   isClassified(movement)                  → boolean
 *   classificationCoverage(movements)       → coverage metrics
 *
 * Most real spend (taxes, health insurance, fuel, leasing, telecom, bank
 * fees) belongs to NO project. Requiring a project on every expense left
 * ~93% of the ledger unclassified, so the destination is modelled
 * explicitly instead of being inferred from the presence of a projectId.
 *
 * Backward compatibility: documents written before the `costScope` field
 * existed are derived — a projectName of "Overhead" means structure, a
 * non-empty projectId means site work, anything else is still unknown.
 *
 * No Firebase imports here — the module stays pure and unit-testable.
 */

import { signedAmountOf } from '../lib/finance/movementAmount.js';

/** The two destinations an outbound movement can be assigned to. */
export const COST_SCOPE = {
  PROJECT: 'project',
  OVERHEAD: 'overhead',
};

const COST_SCOPE_VALUES = Object.values(COST_SCOPE);

/** Legacy convention: 29 documents carry "Overhead" as the project name. */
const LEGACY_OVERHEAD_PROJECT_NAME = 'overhead';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** True when `value` is exactly one of the supported COST_SCOPE values. */
export const isCostScope = (value) => COST_SCOPE_VALUES.includes(value);

/**
 * normalizeCostScope — resolve the destination of a movement.
 *
 * Order matters: a stored scope always wins, then the legacy "Overhead"
 * project name, then the mere presence of a projectId.
 */
export const normalizeCostScope = (movement) => {
  if (!movement) return '';
  if (isCostScope(movement.costScope)) return movement.costScope;
  if (text(movement.projectName).toLowerCase() === LEGACY_OVERHEAD_PROJECT_NAME) {
    return COST_SCOPE.OVERHEAD;
  }
  if (text(movement.projectId)) return COST_SCOPE.PROJECT;
  return '';
};

/**
 * validateClassification — the business rule behind the categorize form.
 *
 * `form` carries the pending edits: { categoryName, costScope, projectId }.
 * Only outbound movements need a destination; a project is required for
 * site work and explicitly NOT required for overhead. Returns the first
 * failing rule so the UI can show a single message.
 */
export const validateClassification = (movement, form) => {
  const draft = form || {};

  if (!text(draft.categoryName)) {
    return { valid: false, error: 'La categoría es obligatoria' };
  }

  // Any direction other than 'out' is treated as an inflow, matching the
  // legacy import convention used by signedAmountOf.
  if (movement?.direction !== 'out') {
    return { valid: true, error: null };
  }

  if (!isCostScope(draft.costScope)) {
    return { valid: false, error: 'Indica si el gasto es de obra o de estructura' };
  }

  if (draft.costScope === COST_SCOPE.PROJECT && !text(draft.projectId)) {
    return { valid: false, error: 'Selecciona el proyecto de la obra' };
  }

  return { valid: true, error: null };
};

/**
 * isClassified — a movement is done when it has a category and, for
 * outbound movements, a resolved destination.
 *
 * Deliberately stricter than the legacy
 * `categoryName || costCenterId || projectId` check, which over-counted
 * every movement that carried any one of those fields.
 */
export const isClassified = (movement) => {
  if (!movement) return false;
  if (movement.status === 'void') return false;
  if (!text(movement.categoryName)) return false;
  if (movement.direction !== 'out') return true;

  const scope = normalizeCostScope(movement);
  if (scope === COST_SCOPE.OVERHEAD) return true;
  return scope === COST_SCOPE.PROJECT && !!text(movement.projectId);
};

/**
 * classificationCoverage — how much of the ledger is actually classified.
 *
 * `byScope` buckets every non-void movement by resolved destination, so
 * project + overhead + unresolved always equals `total`.
 * `unclassifiedOutflow` is the € still waiting to be assigned; the signed
 * amount is derived with signedAmountOf because movements imported before
 * May 2026 have no usable `signedAmount`.
 */
export const classificationCoverage = (movements) => {
  const list = Array.isArray(movements) ? movements : [];

  let total = 0;
  let classified = 0;
  let unclassifiedOutflow = 0;
  const byScope = { project: 0, overhead: 0, unresolved: 0 };

  for (const movement of list) {
    if (!movement || movement.status === 'void') continue;
    total += 1;

    const scope = normalizeCostScope(movement);
    if (scope === COST_SCOPE.PROJECT) byScope.project += 1;
    else if (scope === COST_SCOPE.OVERHEAD) byScope.overhead += 1;
    else byScope.unresolved += 1;

    if (isClassified(movement)) {
      classified += 1;
      continue;
    }

    const signed = signedAmountOf(movement);
    if (signed < 0) unclassifiedOutflow += Math.abs(signed);
  }

  const pct = total === 0 ? 0 : Math.round((classified / total) * 1000) / 10;

  return { total, classified, pct, byScope, unclassifiedOutflow };
};
