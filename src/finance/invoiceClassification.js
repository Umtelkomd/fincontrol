/**
 * Invoice classification suggester — the module behind acceptance criterion
 * #1: loading an invoice proposes category, project and cost center with a
 * visible reason, so `InvoiceIntakePanel` stops calling
 * `buildObligationPayload(header, { projectId })` with an always-empty
 * `projectId` (see odd/tasks/invoice-classification-catalog.md "Problem").
 *
 * `suggestInvoiceClassification` fills each field from the FIRST source that
 * has evidence, in this precedence order:
 *
 *   project:      PDF text mention (`findProjectMentions`) > counterparty
 *                 history > classification rule
 *   category:     counterparty history > classification rule > (receivables
 *                 only) the "Facturación obra" fallback
 *   cost center:  counterparty history > classification rule (both go through
 *                 `resolveLegacyCostCenter` and are dropped when unresolved)
 *                 > derived from the resolved project's line, else from the
 *                 resolved category
 *
 * `costScope` is never an independent source: it is always derived from the
 * resolved cost center (falling back to the category's own `defaultScope`).
 * A field this module has no evidence for stays '' — it never guesses.
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

import { normalizeRuleApplyTo } from './assetSchemas.js';
import {
  defaultCostCenterForCategory,
  resolveLegacyCostCenter,
  scopeOfCostCenter,
  validateCostCenterAssignment,
} from './costCenterCatalog.js';
import { PROJECT_REVENUE_CATEGORY } from './costScope.js';
import { defaultCostCenterForProject, findProjectMentions } from './projectCode.js';
import { findBestRule } from './ruleEngine.js';
import { CATEGORY_TYPE, categoryByName } from './taxonomy.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Legal forms that may trail a company name without changing its identity. */
const LEGAL_SUFFIX_TOKENS = new Set(['gmbh', 'mbh', 'ug', 'ag', 'kg', 'kgaa', 'ohg', 'gbr', 'ek', 'sl', 'sa', 'scp', 'sas', 'sarl', 'ltd', 'co']);

/** Accent/case/legal-suffix tolerant counterparty key for history matching. */
const normalizeCounterparty = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIX_TOKENS.has(token))
    .join(' ');

/** The most frequent non-empty value in `values`, and how many times it appears. */
const modeOf = (values) => {
  const counts = new Map();
  values.forEach((value) => {
    const key = text(value);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let best = '';
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return { value: best, count: bestCount };
};

/** History-sourced confidence: ≥2 agreeing rows is 'medium', a single one is 'low'. */
const historyConfidence = (count) => (count >= 2 ? 'medium' : 'low');

const projectDisplayName = (project, fallback = '') =>
  (project && (project.displayName || project.name || project.code)) || fallback;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };

/** First 200 characters of the PDF text — enough for a rule pattern to hit without hauling the whole document through the engine. */
const excerptOf = (value, max = 200) => text(value).slice(0, max);

/**
 * suggestInvoiceClassification — see the module doc comment for the full
 * precedence rules.
 *
 * @param {{
 *   header?: { counterpartyName?: string, invoiceNumber?: string, grossAmount?: number },
 *   text?: string,
 *   direction: 'payable'|'receivable',
 *   projects?: Array<{id:string, code?:string, name?:string, displayName?:string}>,
 *   rules?: Array<object>,
 *   history?: Array<{counterpartyName?:string, categoryName?:string, projectId?:string, projectName?:string, costCenterId?:string}>,
 * }} params
 * @returns {{
 *   categoryName: string, projectId: string, projectName: string,
 *   costCenterId: string, costScope: string,
 *   confidence: 'high'|'medium'|'low'|'none',
 *   reasons: Array<{field:string, source:string, detail:string}>,
 * }}
 */
export const suggestInvoiceClassification = ({ header, text: pdfText, direction, projects, rules, history } = {}) => {
  const projectList = Array.isArray(projects) ? projects : [];
  const ruleList = Array.isArray(rules) ? rules : [];
  const historyList = Array.isArray(history) ? history : [];
  const counterpartyName = text(header?.counterpartyName);

  const reasons = [];
  let confidence = 'none';
  const raise = (level) => {
    if (level && CONFIDENCE_RANK[level] > CONFIDENCE_RANK[confidence]) confidence = level;
  };

  // ── Counterparty history: rows for THIS counterparty, once ────────────────
  const counterpartyKey = normalizeCounterparty(counterpartyName);
  const historyMatches = counterpartyKey
    ? historyList.filter((row) => normalizeCounterparty(row?.counterpartyName) === counterpartyKey)
    : [];

  // ── Classification rule: the best match against the invoice-as-movement ───
  const ruleMovement = {
    counterpartyName,
    description: `${text(header?.invoiceNumber)} ${excerptOf(pdfText)}`.trim(),
    amount: Number(header?.grossAmount) || 0,
    direction: direction === 'payable' ? 'out' : 'in',
  };
  const bestRule = findBestRule(ruleMovement, ruleList);
  const ruleApplyTo = bestRule ? normalizeRuleApplyTo(bestRule.applyTo) : null;

  // ── 1. Project ──────────────────────────────────────────────────────────
  let projectId = '';
  let projectName = '';

  const mentions = findProjectMentions(pdfText, projectList);
  if (mentions.length > 0) {
    const primary = mentions[0];
    const ambiguous = new Set(mentions.map((m) => m.projectId)).size > 1;
    const project = projectList.find((p) => p.id === primary.projectId);
    projectId = primary.projectId;
    projectName = projectDisplayName(project, primary.code);
    const level = ambiguous ? 'medium' : 'high';
    raise(level);
    reasons.push({
      field: 'projectId',
      source: 'pdf-text',
      detail: ambiguous
        ? `Se mencionan varios proyectos en el texto de la factura; se usó la primera coincidencia (${primary.matched})`
        : `Proyecto detectado en el texto de la factura (${primary.matched})`,
    });
  }

  if (!projectId && historyMatches.length > 0) {
    const mode = modeOf(historyMatches.map((row) => row.projectId));
    if (mode.value) {
      const project = projectList.find((p) => p.id === mode.value);
      const nameMode = modeOf(historyMatches.filter((row) => text(row.projectId) === mode.value).map((row) => row.projectName));
      projectId = mode.value;
      projectName = projectDisplayName(project, nameMode.value);
      const level = historyConfidence(mode.count);
      raise(level);
      reasons.push({
        field: 'projectId',
        source: 'history',
        detail: `Proyecto usado en ${mode.count} de ${historyMatches.length} facturas anteriores de ${counterpartyName}`,
      });
    }
  }

  if (!projectId && ruleApplyTo?.projectId) {
    const project = projectList.find((p) => p.id === ruleApplyTo.projectId);
    projectId = ruleApplyTo.projectId;
    projectName = projectDisplayName(project, ruleApplyTo.projectName);
    raise('medium');
    reasons.push({
      field: 'projectId',
      source: 'rule',
      detail: `Regla de clasificación "${bestRule.name || bestRule.pattern}" asigna este proyecto`,
    });
  }

  // ── 2/3/4. Category ─────────────────────────────────────────────────────
  let categoryName = '';

  if (historyMatches.length > 0) {
    const mode = modeOf(historyMatches.map((row) => row.categoryName));
    if (mode.value && categoryByName(mode.value)) {
      categoryName = mode.value;
      const level = historyConfidence(mode.count);
      raise(level);
      reasons.push({
        field: 'categoryName',
        source: 'history',
        detail: `Categoría usada en ${mode.count} de ${historyMatches.length} facturas anteriores de ${counterpartyName}`,
      });
    }
  }

  if (!categoryName && ruleApplyTo?.categoryName && categoryByName(ruleApplyTo.categoryName)) {
    categoryName = ruleApplyTo.categoryName;
    raise('medium');
    reasons.push({
      field: 'categoryName',
      source: 'rule',
      detail: `Regla de clasificación "${bestRule.name || bestRule.pattern}" asigna esta categoría`,
    });
  }

  if (!categoryName && direction === 'receivable') {
    categoryName = PROJECT_REVENUE_CATEGORY;
    raise('low');
    reasons.push({
      field: 'categoryName',
      source: 'category-default',
      detail: `Sin otra evidencia, una factura emitida se clasifica como ${PROJECT_REVENUE_CATEGORY}`,
    });
  }

  // ── 5. Cost center ──────────────────────────────────────────────────────
  let costCenterId = '';

  if (historyMatches.length > 0) {
    const mode = modeOf(historyMatches.map((row) => row.costCenterId));
    if (mode.value) {
      const resolved = resolveLegacyCostCenter(mode.value);
      if (resolved.code) {
        costCenterId = resolved.code;
        raise(historyConfidence(mode.count));
        reasons.push({
          field: 'costCenterId',
          source: 'history',
          detail: `Centro de costo usado en ${mode.count} de ${historyMatches.length} facturas anteriores de ${counterpartyName}`,
        });
      }
    }
  }

  if (!costCenterId && ruleApplyTo?.costCenterId) {
    const resolved = resolveLegacyCostCenter(ruleApplyTo.costCenterId);
    if (resolved.code) {
      costCenterId = resolved.code;
      raise('medium');
      reasons.push({
        field: 'costCenterId',
        source: 'rule',
        detail: `Regla de clasificación "${bestRule.name || bestRule.pattern}" asigna este centro de costo`,
      });
    }
  }

  if (!costCenterId) {
    if (projectId) {
      const project = projectList.find((p) => p.id === projectId) || { id: projectId };
      const derived = defaultCostCenterForProject(project);
      if (derived) {
        costCenterId = derived;
        reasons.push({
          field: 'costCenterId',
          source: 'project-line',
          detail: 'Centro de costo por defecto según la línea del proyecto',
        });
      }
    } else if (categoryName) {
      const derived = defaultCostCenterForCategory(categoryName);
      if (derived) {
        costCenterId = derived;
        reasons.push({
          field: 'costCenterId',
          source: 'category-default',
          detail: 'Centro de costo por defecto según la categoría',
        });
      }
    }
  }

  // ── costScope is always DERIVED, never an independent source ──────────────
  const costScope = scopeOfCostCenter(costCenterId) || categoryByName(categoryName)?.defaultScope || '';

  return { categoryName, projectId, projectName, costCenterId, costScope, confidence, reasons };
};

/**
 * validateInvoiceClassification — the confirm-step gate.
 *
 *   - a category is required and must match the direction (expense for a
 *     payable, income for a receivable)
 *   - a payable requires a cost center, and it must pass
 *     `validateCostCenterAssignment` against the project
 *   - a receivable filed as "Facturación obra" requires a project; any other
 *     receivable category needs neither a project nor a cost center
 */
export const validateInvoiceClassification = ({ direction, categoryName, projectId, costCenterId } = {}) => {
  const errors = {};
  const category = categoryByName(categoryName);

  if (!category) {
    errors.categoryName = 'La categoría es obligatoria';
  } else {
    const expectedType = direction === 'payable' ? CATEGORY_TYPE.EXPENSE : CATEGORY_TYPE.INCOME;
    if (category.type !== expectedType) {
      errors.categoryName =
        direction === 'payable'
          ? 'Una factura de proveedor requiere una categoría de gasto'
          : 'Una factura emitida requiere una categoría de ingreso';
    }
  }

  if (direction === 'payable') {
    if (!text(costCenterId)) {
      errors.costCenterId = 'El centro de costo es obligatorio';
    } else {
      const assignment = validateCostCenterAssignment({ costCenterId, projectId });
      if (!assignment.valid) errors.costCenterId = assignment.error;
    }
  }

  if (direction === 'receivable' && category?.name === PROJECT_REVENUE_CATEGORY && !text(projectId)) {
    errors.projectId = 'Selecciona el proyecto de la obra';
  }

  return { valid: Object.keys(errors).length === 0, errors };
};

/**
 * buildClassificationFields — the exact shape persisted on the CXP/CXC
 * (`categoryName, projectId, projectName, costCenterId, costScope`), from a
 * confirmed form and the live `projects` list.
 */
export const buildClassificationFields = (form, projects) => {
  const draft = form || {};
  const projectList = Array.isArray(projects) ? projects : [];
  const projectId = text(draft.projectId);
  const project = projectId ? projectList.find((p) => p.id === projectId) : null;
  const categoryName = text(draft.categoryName);
  const costCenterId = text(draft.costCenterId);
  const costScope = scopeOfCostCenter(costCenterId) || categoryByName(categoryName)?.defaultScope || '';

  return {
    categoryName,
    projectId,
    projectName: project ? projectDisplayName(project) : '',
    costCenterId,
    costScope,
  };
};
