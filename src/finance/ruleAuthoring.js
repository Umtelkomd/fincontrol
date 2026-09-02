/**
 * Classification Rule Authoring
 * ─────────────────────────────────
 * Pure helpers behind the rule form and the "import starter rules" action.
 *
 *   validateRuleForm(form)                     → { valid, error }
 *   applyCostScopeToRuleForm(form, scope)      → next form
 *   ruleSeedKey(rule)                          → idempotency key
 *   selectMissingSeedRules(existing, catalog)  → { toCreate, skipped }
 *
 * The rules UI is a thin shell over these functions so the authoring rules —
 * "a structural rule never carries a project", "a destination alone is a valid
 * classification", "seeding twice creates nothing" — stay unit-testable without
 * rendering a modal.
 *
 * Error strings are Spanish: they are rendered verbatim in the form.
 * No Firebase imports here.
 */

import { normalizeRuleApplyTo, ruleHasClassificationTarget } from './assetSchemas.js';
import { COST_SCOPE, isCostScope } from './costScope.js';
import { SEED_CLASSIFICATION_RULES } from './seedRules.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * validateRuleForm — the submit gate of RuleFormModal.
 *
 * Returns the first failing rule so the form shows a single message.
 */
export const validateRuleForm = (form) => {
  const draft = form || {};

  if (!text(draft.pattern)) {
    return { valid: false, error: 'Ingresá un patrón a buscar' };
  }

  const applyTo = normalizeRuleApplyTo(draft.applyTo);

  if (!ruleHasClassificationTarget(applyTo)) {
    return {
      valid: false,
      error: 'Definí al menos un campo a aplicar (categoría / centro / proyecto / destino)',
    };
  }

  if (applyTo.costScope === COST_SCOPE.OVERHEAD && applyTo.projectId) {
    return { valid: false, error: 'Un gasto de estructura no puede llevar proyecto' };
  }

  // Mirror of the invariant `validateClassification` enforces on the categorize
  // form (src/finance/costScope.js). Without it a rule persists
  // `costScope: 'project'` with no projectId and stamps that half-classified
  // shape onto every movement it matches: `isClassified` returns false while
  // `classificationCoverage` still counts the row under `byScope.project`.
  if (applyTo.costScope === COST_SCOPE.PROJECT && !applyTo.projectId) {
    return { valid: false, error: 'Selecciona el proyecto de la obra' };
  }

  if (draft.matchType === 'regex') {
    try {
      new RegExp(draft.pattern);
    } catch {
      return { valid: false, error: 'La expresión regular no es válida' };
    }
  }

  return { valid: true, error: null };
};

/**
 * applyCostScopeToRuleForm — set the cost destination on a form.
 *
 * Choosing "estructura" drops the project: an overhead rule must never assign
 * one. Returns a new form; the input is never mutated.
 */
export const applyCostScopeToRuleForm = (form, scope) => {
  const draft = form || {};
  const costScope = isCostScope(scope) ? scope : '';
  const applyTo = { ...normalizeRuleApplyTo(draft.applyTo), costScope };

  if (costScope === COST_SCOPE.OVERHEAD) {
    applyTo.projectId = '';
    applyTo.projectName = '';
  }

  return { ...draft, applyTo };
};

/**
 * ruleSeedKey — identity of a rule for seeding purposes.
 *
 * Keyed on `field` + `matchType` + `pattern` (trimmed, lower-cased) +
 * `direction` rather than on `name`: two rules matching the same text on the
 * same field in the same direction are duplicates whatever they are called,
 * and a name the user edited must not resurrect a seed. Direction is part of
 * the identity because one counterparty can legitimately be two rules — a
 * partner is paid a salary (out) and lends the company money (in). A missing
 * or empty direction reads as `both`, a missing matchType as `contains`.
 */
export const ruleSeedKey = (rule) => {
  const pattern = text(rule?.pattern).toLowerCase();
  if (!pattern) return '';
  const field = text(rule?.field) || 'counterpartyName';
  const matchType = text(rule?.matchType) || 'contains';
  const direction = text(rule?.direction) || 'both';
  return `${field}::${matchType}::${pattern}::${direction}`;
};

/**
 * selectMissingSeedRules — which starter rules are not in the collection yet.
 *
 * Idempotent by construction: running it again after a successful import
 * returns an empty `toCreate`.
 */
export const selectMissingSeedRules = (existingRules, catalog = SEED_CLASSIFICATION_RULES) => {
  const seen = new Set(
    (Array.isArray(existingRules) ? existingRules : [])
      .map(ruleSeedKey)
      .filter(Boolean),
  );

  const toCreate = [];
  let skipped = 0;

  for (const seed of Array.isArray(catalog) ? catalog : []) {
    const key = ruleSeedKey(seed);
    if (!key || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    toCreate.push(seed);
  }

  return { toCreate, skipped };
};
