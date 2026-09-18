/**
 * Classification catalogue migration — pure planning for the one-time move
 * from the mixed legacy cost-center/project values (see the "Problem"
 * section of odd/tasks/invoice-classification-catalog.md) to the v2
 * catalogue (costCenterCatalog.js) and the structured project code scheme
 * (projectCode.js). `scripts/migrate-classification-catalog.cjs` is the thin
 * I/O shell that reads Firestore, calls these functions, prints the report
 * and — only behind `--apply` — writes the plan back.
 *
 * Every function here is a pure `(state) => plan` computation: no Firestore,
 * no Date.now(), no I/O of any kind, so the whole migration is provable with
 * unit tests before it is ever pointed at production data. A legacy value
 * this module cannot resolve is always reported, never guessed.
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

import {
  COST_CENTER_CATALOG,
  costCenterByCode,
  resolveLegacyCostCenter,
} from './costCenterCatalog.js';
import { canonicalizeProjectCode } from './projectCodeAliases.js';
import {
  isStructuredProjectCode,
  LEGACY_PROJECT_CODE_MAP,
  parseProjectCode,
} from './projectCode.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

// ── Cost center catalogue ───────────────────────────────────────────────────

/** Collections whose documents carry a top-level `costCenterId`, verified one
 * by one against the hooks that write them (see the migration report). */
const COST_CENTER_TOP_LEVEL_COLLECTIONS = ['payables', 'receivables', 'bankMovements', 'recurringCosts'];

/**
 * planCostCenterMigration — resolves every stored cost center value (across
 * the catalogue itself and every document collection that references one) to
 * its v2 code.
 *
 * @param {{ costCenters?: Array<{id:string, code?:string, name?:string}>,
 *   documentsByCollection?: Record<string, Array<object>> }} params
 * @returns {{
 *   catalogUpserts: Array<{code:string, data:{code,name,kind,line}}>,
 *   remaps: Array<{collection:string, id:string, from:string, to:string}>,
 *   unresolved: Array<{collection:string, id:string, value:string}>,
 *   retire: Array<{id:string, code:string, name:string, resolvedTo:string}>,
 *   summary: object,
 * }}
 */
export const planCostCenterMigration = ({ costCenters, documentsByCollection } = {}) => {
  const liveCenters = Array.isArray(costCenters) ? costCenters : [];
  const byId = new Map(liveCenters.map((entry) => [entry.id, entry]));
  const docsByCollection = documentsByCollection || {};

  // ── 1. Catalogue upserts — the same "Cargar predefinidos" seed
  // (useCostCenters.js), but proposed rather than written: an entry is only
  // included when the live doc is missing or still disagrees with it, so a
  // second run over already-seeded data proposes nothing.
  const catalogUpserts = [];
  for (const entry of COST_CENTER_CATALOG) {
    const live = byId.get(entry.code);
    const data = { code: entry.code, name: entry.name, kind: entry.kind, line: entry.line || '' };
    const matches = live && live.name === data.name && live.kind === data.kind && (live.line || '') === data.line;
    if (!matches) catalogUpserts.push({ code: entry.code, data });
  }

  // A stored value may be a v2 code, a legacy code, a free-text label, or the
  // Firestore doc id of a live (possibly still-legacy) cost-center doc. Try
  // it as a code/label first; only a value that resolves to nothing on its
  // own falls back to a live-doc lookup, through the doc's OWN code/name.
  const resolveStoredValue = (value) => {
    const direct = resolveLegacyCostCenter(value);
    if (direct.status !== 'unresolved') return direct;
    const live = byId.get(value);
    if (!live) return direct;
    return resolveLegacyCostCenter(live.code || live.name, { liveName: live.name });
  };

  const remaps = [];
  const unresolved = [];
  const collectFrom = (collection, getValue) => {
    const docs = docsByCollection[collection];
    if (!Array.isArray(docs)) return;
    for (const document of docs) {
      const value = text(getValue(document));
      if (!value) continue; // '' is already correct — nothing to remap
      const resolved = resolveStoredValue(value);
      if (resolved.status === 'unresolved') {
        unresolved.push({ collection, id: document.id, value });
        continue;
      }
      if (resolved.code !== value) {
        remaps.push({ collection, id: document.id, from: value, to: resolved.code });
      }
    }
  };

  for (const collection of COST_CENTER_TOP_LEVEL_COLLECTIONS) {
    collectFrom(collection, (document) => document.costCenterId);
  }
  // `applyTo.costCenterId` is nested, and `budgets` is deliberately excluded:
  // neither budgets nor budget lines store a costCenterId anywhere in the app.
  collectFrom('classificationRules', (document) => document.applyTo?.costCenterId);

  // ── 3. Retire — a live cost-center doc superseded by a v2 catalogue entry
  // once its documents above have been remapped. Never deleted here, only
  // reported; the v2 doc with `id === code` is what stays live.
  const retire = [];
  for (const live of liveCenters) {
    const canonical = costCenterByCode(live.id);
    if (canonical && canonical.code === live.id) continue; // already one of the 14 seeded catalogue docs
    const resolved = resolveLegacyCostCenter(live.code || live.id, { liveName: live.name });
    if (resolved.status === 'unresolved') {
      unresolved.push({ collection: 'costCenters', id: live.id, value: live.code || live.name || live.id });
      continue;
    }
    if (resolved.code && resolved.code !== live.id) {
      retire.push({ id: live.id, code: live.code || '', name: live.name || '', resolvedTo: resolved.code });
    }
  }

  return {
    catalogUpserts,
    remaps,
    unresolved,
    retire,
    summary: {
      catalogUpserts: catalogUpserts.length,
      remaps: remaps.length,
      unresolved: unresolved.length,
      retire: retire.length,
    },
  };
};

// ── Project code scheme ─────────────────────────────────────────────────────

/** Mirrors `resolveLegacyProjectCode` (projectCode.js) but against a caller-
 * supplied mapping table, so the owner's validated corrections take effect
 * without editing the shipped `LEGACY_PROJECT_CODE_MAP`. */
const keyOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const resolveWithMapping = (value, mapping) => {
  const raw = text(value);
  if (!raw) return { code: '', confidence: null, status: 'legacy' };

  const paren = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const codePart = (paren ? paren[1] : raw).trim();
  const namePart = paren ? paren[2].trim() : '';

  if (isStructuredProjectCode(codePart)) return { code: codePart.toUpperCase(), confidence: null, status: 'current' };

  for (const candidate of [codePart, namePart, raw]) {
    const key = keyOf(candidate);
    if (!key) continue;
    const entry = mapping.find((item) => item.match.some((alias) => keyOf(alias) === key));
    if (entry) return { code: entry.code, confidence: entry.confidence, status: 'mapped' };
  }

  return { code: canonicalizeProjectCode(raw), confidence: null, status: 'legacy' };
};

/**
 * planProjectCodeMigration — proposes a v2 `CLI-SIT-LLn` code for every
 * project still on a legacy code, at or above `minConfidence`. The project
 * doc id never changes, so `projectId` foreign keys stay valid; only `code`
 * and its structured parts move.
 *
 * @param {{ projects?: Array<{id:string, code?:string, name?:string}>,
 *   mapping?: Array<{match:string[], code:string, confidence:string}>,
 *   minConfidence?: 'high'|'medium'|'low' }} params
 * @returns {{
 *   renames: Array<{id, from, to, confidence, name, fields:{code,codeClient,site,line,lot,displayName,legacyCode}}>,
 *   skipped: Array<{id, code, reason, confidence}>,
 *   collisions: Array<{code, projects: Array<{id, from, confidence}>}>,
 *   summary: object,
 * }}
 */
export const planProjectCodeMigration = ({ projects, mapping = LEGACY_PROJECT_CODE_MAP, minConfidence = 'high' } = {}) => {
  const list = Array.isArray(projects) ? projects : [];
  const minRank = CONFIDENCE_RANK[minConfidence] ?? CONFIDENCE_RANK.high;

  const candidates = [];
  const skipped = [];

  for (const project of list) {
    const rawCode = text(project.code || project.codigo || '');
    if (isStructuredProjectCode(rawCode)) continue; // already v2 — nothing to propose

    const resolved = resolveWithMapping(rawCode || project.name || project.displayName || '', mapping);
    if (resolved.status !== 'mapped') {
      // Never guessed: no entry in the mapping claims this value at all.
      skipped.push({ id: project.id, code: rawCode, reason: 'unmapped', confidence: null });
      continue;
    }
    if (CONFIDENCE_RANK[resolved.confidence] < minRank) {
      skipped.push({ id: project.id, code: rawCode, reason: 'below-min-confidence', confidence: resolved.confidence });
      continue;
    }
    candidates.push({ project, from: rawCode, to: resolved.code, confidence: resolved.confidence });
  }

  // A target code claimed by more than one project is a collision: renaming
  // either one would silently merge two different sites/contracts under one
  // code, so neither is renamed.
  const byTarget = new Map();
  for (const candidate of candidates) {
    if (!byTarget.has(candidate.to)) byTarget.set(candidate.to, []);
    byTarget.get(candidate.to).push(candidate);
  }

  const renames = [];
  const collisions = [];
  for (const [code, group] of byTarget) {
    if (group.length > 1) {
      collisions.push({
        code,
        projects: group.map((candidate) => ({ id: candidate.project.id, from: candidate.from, confidence: candidate.confidence })),
      });
      continue;
    }
    const [{ project, from, to, confidence }] = group;
    const parsed = parseProjectCode(to);
    const name = text(project.name) || from;
    renames.push({
      id: project.id,
      from,
      to,
      confidence,
      name,
      fields: {
        code: to,
        codeClient: parsed.client,
        site: parsed.site,
        line: parsed.line,
        lot: parsed.lot,
        displayName: `${to} (${name})`,
        // Preserves the pre-migration code so `findProjectMentions` and any
        // operator still typing the old code keep resolving to this project.
        legacyCode: from,
      },
    });
  }

  return {
    renames,
    skipped,
    collisions,
    summary: { renames: renames.length, skipped: skipped.length, collisions: collisions.length },
  };
};

// ── Denormalised projectName refresh ────────────────────────────────────────

/** Collections that denormalise `projectName` next to a `projectId` — same
 * list `scripts/merge-projects.cjs` moves on a project merge. `budgets` and
 * `employees` are deliberately absent: budgets key off `projectId` alone with
 * no name to refresh, and `employees.projectIds` is an array of ids with no
 * parallel name field at all. */
const PROJECT_NAME_TARGETS = [
  { collection: 'bankMovements', field: 'projectName', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'receivables', field: 'projectName', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'payables', field: 'projectName', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'workInProgress', field: 'projectName', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  {
    collection: 'classificationRules',
    field: 'applyTo.projectName',
    getProjectId: (d) => d.applyTo?.projectId,
    getName: (d) => d.applyTo?.projectName,
  },
];

/**
 * planProjectNameRefresh — after `planProjectCodeMigration`, brings every
 * document's denormalised `projectName` back in sync with the renamed
 * project's own name wherever the two have drifted apart (e.g. a document
 * that stored the bare legacy code as its "name").
 *
 * @param {{ renames?: ReturnType<typeof planProjectCodeMigration>['renames'],
 *   documentsByCollection?: Record<string, Array<object>> }} params
 * @returns {{ updates: Array<{collection, id, field, from, to}>, summary: object }}
 */
export const planProjectNameRefresh = ({ renames, documentsByCollection } = {}) => {
  const renameList = Array.isArray(renames) ? renames : [];
  const nameById = new Map(renameList.map((rename) => [rename.id, rename.name]));
  const docsByCollection = documentsByCollection || {};

  const updates = [];
  for (const target of PROJECT_NAME_TARGETS) {
    const docs = docsByCollection[target.collection];
    if (!Array.isArray(docs)) continue;
    for (const document of docs) {
      const projectId = target.getProjectId(document);
      if (!projectId || !nameById.has(projectId)) continue;
      const nextName = nameById.get(projectId);
      const currentName = text(target.getName(document));
      if (currentName === text(nextName)) continue;
      updates.push({ collection: target.collection, id: document.id, field: target.field, from: currentName, to: nextName });
    }
  }

  return { updates, summary: { updates: updates.length } };
};
