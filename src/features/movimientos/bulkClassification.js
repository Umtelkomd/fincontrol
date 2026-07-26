/**
 * Bulk classification — payload building for `bulkClassify`.
 *
 * 1464 unclassified movements concentrate in 257 counterparties, so the
 * backlog is cleared by assigning many rows at once. `bulkClassify` writes
 * only the keys it receives, which makes the blank-field rule critical: a
 * field the user left empty must be ABSENT from the payload, or a bulk edit
 * meant to set a category would wipe the cost center of every selected row.
 *
 * The one deliberate exception is structure: choosing "Estructura" clears
 * `projectId` / `projectName`, because a structural cost must not keep a
 * stale project.
 */

import { COST_SCOPE, isCostScope, normalizeCostScope } from '../../finance/costScope.js';

const DESTINATION_LABEL = {
  [COST_SCOPE.PROJECT]: 'Obra',
  [COST_SCOPE.OVERHEAD]: 'Estructura',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * resolveProjectName — readable label for a project id, falling back to the
 * id itself so a bulk write never stores an empty name next to a real id.
 */
export const resolveProjectName = (projects, projectId) => {
  const id = text(projectId);
  if (!id) return '';
  const project = (Array.isArray(projects) ? projects : []).find((entry) => entry?.id === id);
  return String(
    project?.nombre || project?.name || project?.displayName || project?.codigo || project?.code || id,
  );
};

/** buildBulkClassificationPayload — only the fields the user actually filled in. */
export const buildBulkClassificationPayload = (form, projects) => {
  const draft = form || {};
  const payload = {};

  const categoryName = text(draft.categoryName);
  if (categoryName) payload.categoryName = categoryName;

  const costCenterId = text(draft.costCenterId);
  if (costCenterId) payload.costCenterId = costCenterId;

  const projectId = text(draft.projectId);
  const costScope = isCostScope(draft.costScope) ? draft.costScope : '';

  if (costScope) payload.costScope = costScope;

  if (costScope === COST_SCOPE.OVERHEAD) {
    payload.projectId = '';
    payload.projectName = '';
    return payload;
  }

  if (projectId) {
    payload.projectId = projectId;
    payload.projectName = resolveProjectName(projects, projectId);
  }

  return payload;
};

/** The fields a bulk write can replace — everything else is left alone. */
const OVERWRITABLE_FIELDS = ['categoryName', 'costCenterId', 'projectId', 'projectName'];

/**
 * wouldOverwrite — does this payload replace data the movement already has?
 *
 * Filling a blank field is not an overwrite; replacing a non-empty value with
 * a DIFFERENT one is. Clearing a project (structural assignment) counts, since
 * the stored value is lost. The destination is compared through
 * `normalizeCostScope` so a legacy row whose scope was only ever derived is
 * treated as classified too.
 */
const wouldOverwrite = (movement, payload) => {
  if (!movement) return false;

  if (payload.costScope !== undefined) {
    const current = normalizeCostScope(movement);
    if (current && current !== payload.costScope) return true;
  }

  return OVERWRITABLE_FIELDS.some((field) => {
    if (payload[field] === undefined) return false;
    const current = text(movement[field]);
    return Boolean(current) && current !== text(payload[field]);
  });
};

/**
 * summarizeBulkImpact — what the operator is about to do, in two numbers.
 *
 * `total` is the size of the selection; `overwrites` is how many of those rows
 * already carry a classification this payload would replace. A bulk write
 * cannot be undone from inside the app, so the confirmation step shows both
 * and leads with the second.
 */
export const summarizeBulkImpact = (movements, payload) => {
  const list = Array.isArray(movements) ? movements : [];
  const patch = payload || {};

  return {
    total: list.length,
    overwrites: list.filter((movement) => wouldOverwrite(movement, patch)).length,
  };
};

/**
 * buildBulkValidationTarget — the movement `validateClassification` is run
 * against. A mixed selection is represented by its strictest member: a single
 * outflow makes the destination mandatory for the whole batch.
 */
export const buildBulkValidationTarget = (movements) => {
  const list = Array.isArray(movements) ? movements : [];
  return { direction: list.some((movement) => movement?.direction === 'out') ? 'out' : 'in' };
};

/** movementDestinationLabel — column value: Obra / Estructura / —. */
export const movementDestinationLabel = (movement) =>
  DESTINATION_LABEL[normalizeCostScope(movement)] || '—';

/**
 * formatBulkResult — toast message + tone for a `bulkClassify` result.
 *
 * `bulkClassify` commits in chunks and reports `success: false` as soon as one
 * chunk fails, so a partial run carries counts on both sides. Those counts are
 * what the operator needs; the raw Firestore error only surfaces when nothing
 * was written at all.
 */
export const formatBulkResult = (result) => {
  const updated = Number(result?.updated) || 0;
  const failed = Number(result?.failed) || 0;

  if (updated > 0 && failed > 0) {
    return {
      message: `${updated} movimiento(s) clasificados · ${failed} con error`,
      tone: 'warning',
    };
  }

  if (!result?.success) {
    return {
      message: result?.error?.message || 'No se pudo clasificar la selección',
      tone: 'error',
    };
  }

  return { message: `${updated} movimiento(s) clasificados`, tone: 'success' };
};
