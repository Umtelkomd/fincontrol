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
 * `buildWritePlan` is the last step: it merges the three plans above into
 * exactly ONE Firestore write per `collection/id`, because a document can
 * legitimately need changes from more than one of them (e.g. a payable
 * needing both a cost-center remap and a projectName refresh) — two
 * independent `batch.update()` calls for the same doc would each set the
 * whole `migration.classificationCatalogV2.previous` field, the second
 * silently destroying the first's rollback data. `parseMigrationArgs` is the
 * script's argv parser, extracted so its fail-closed behaviour (an empty or
 * unknown flag value is a hard error, never a silent default) is unit-tested
 * without ever running the script itself.
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

/** A project counts as inactive when either legacy-Projects.jsx signal
 * (`status`, set on the create/edit form) or the boolean toggle (`active`,
 * set by `toggleProjectStatus`) says so — either is enough, since both exist
 * in production data and neither alone is authoritative. */
const isInactiveProject = (project) => project?.status === 'inactive' || project?.active === false;

/** A "bare" legacy code (`QFF`) has no trailing `-NNN` ops-order suffix
 * (`QFF-001`); used only to break a merge-survivor tie, never to resolve a
 * code on its own. */
const isBareLegacyCode = (value) => !/-\d+$/.test(String(value ?? '').trim());

/** Milliseconds since epoch for a project's `createdAt`, accepting an ISO
 * string, a Firestore-Timestamp-shaped `{seconds}` plain object (what a doc
 * looks like once sanitized/JSON-round-tripped), or a missing value. A
 * missing or unparsable value sorts LAST (never guessed as "the oldest"). */
const createdAtMillis = (project) => {
  const value = project?.createdAt;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  }
  if (value && typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  return Number.POSITIVE_INFINITY;
};

/**
 * mergeGroupOrder — the deterministic total order for ≥2 live projects
 * resolving to the same merge-flagged target code: (1) active over inactive,
 * (2) a bare legacy code over a suffixed one, (3) the OLDEST createdAt, (4)
 * the smallest doc id. Every step is a total order, so the result never
 * depends on object/Map/Firestore-read iteration order. Applied to the WHOLE
 * group (not just to pick a winner) so the runners-up are ALSO ordered
 * deterministically — needed so a 3+-project merge sums loser budgets in a
 * stable, reproducible fold order (`planProjectMerge`, T12).
 */
const mergeGroupOrder = (group) =>
  [...group].sort((a, b) => {
    const activeDelta = Number(isInactiveProject(a.project)) - Number(isInactiveProject(b.project));
    if (activeDelta !== 0) return activeDelta;
    const bareDelta = Number(!isBareLegacyCode(a.from)) - Number(!isBareLegacyCode(b.from));
    if (bareDelta !== 0) return bareDelta;
    // Both missing → both +Infinity → equal-but-unsubtractable (Infinity -
    // Infinity is NaN); compare the values themselves first, never their
    // difference, so a true tie always falls through to the id tie-break.
    const createdA = createdAtMillis(a.project);
    const createdB = createdAtMillis(b.project);
    if (createdA !== createdB) return createdA - createdB;
    return String(a.project.id).localeCompare(String(b.project.id));
  });

/**
 * planProjectCodeMigration — proposes a v2 `CLI-SIT-LLn` code for every
 * project still on a legacy code, at or above `minConfidence`. The project
 * doc id never changes, so `projectId` foreign keys stay valid; only `code`
 * and its structured parts move. A project already carrying `mergedInto`
 * (a previous merge's loser) is settled and skipped entirely — neither a
 * rename nor a merge candidate.
 *
 * When ≥2 live projects resolve to the SAME target code:
 *   - the mapping entry has `merge: true` → they are the same obra
 *     (owner-confirmed, see `LEGACY_PROJECT_CODE_MAP`): `mergeGroupOrder`
 *     picks one deterministic survivor, which gets the normal rename; the
 *     rest become `losers` (in that same deterministic order) in a
 *     `merges[]` item instead of a collision.
 *   - no `merge` flag → unchanged: a collision, nobody is renamed.
 *
 * @param {{ projects?: Array<{id:string, code?:string, name?:string, status?:string,
 *   active?:boolean, createdAt?:string|{seconds:number}, mergedInto?:string}>,
 *   mapping?: Array<{match:string[], code:string, confidence:string, merge?:boolean}>,
 *   minConfidence?: 'high'|'medium'|'low' }} params
 * @returns {{
 *   renames: Array<{id, from, to, confidence, name, fields:{code,codeClient,site,line,lot,displayName,legacyCode}}>,
 *   skipped: Array<{id, code, reason, confidence}>,
 *   collisions: Array<{code, projects: Array<{id, from, confidence}>}>,
 *   merges: Array<{code, survivor:{id,from,name}, losers:Array<{id,from,name}>, fields:object, mergeBudgets:'sum'|null}>,
 *   summary: object,
 * }}
 */
export const planProjectCodeMigration = ({ projects, mapping = LEGACY_PROJECT_CODE_MAP, minConfidence = 'high' } = {}) => {
  const list = Array.isArray(projects) ? projects : [];
  const minRank = CONFIDENCE_RANK[minConfidence] ?? CONFIDENCE_RANK.high;

  const candidates = [];
  const skipped = [];

  for (const project of list) {
    if (project.mergedInto) continue; // a previous merge's loser — already settled, nothing left to propose

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

  // A target code claimed by more than one project is either a MERGE (the
  // mapping entry says so — the same obra under different legacy refs) or a
  // COLLISION (no merge flag — renaming either one would silently combine
  // two different sites/contracts under one code, so neither is renamed).
  const byTarget = new Map();
  for (const candidate of candidates) {
    if (!byTarget.has(candidate.to)) byTarget.set(candidate.to, []);
    byTarget.get(candidate.to).push(candidate);
  }

  const buildRenameFields = (to, name, legacyFrom) => {
    const parsed = parseProjectCode(to);
    return {
      code: to,
      codeClient: parsed.client,
      site: parsed.site,
      line: parsed.line,
      lot: parsed.lot,
      displayName: `${to} (${name})`,
      // Preserves the pre-migration code so `findProjectMentions` and any
      // operator still typing the old code keep resolving to this project.
      legacyCode: legacyFrom,
    };
  };

  const renames = [];
  const collisions = [];
  const merges = [];
  for (const [code, group] of byTarget) {
    if (group.length > 1) {
      const mappingEntry = mapping.find((entry) => entry.code === code);
      if (mappingEntry?.merge) {
        // Sorted ONCE, by the same total order: the winner is the survivor,
        // the rest are the losers, already in deterministic "survivor-rule"
        // order for a 3+-project merge (T12 budget-summing fold order).
        const sortedGroup = mergeGroupOrder(group);
        const survivor = sortedGroup[0];
        const losers = sortedGroup.slice(1);
        const survivorName = text(survivor.project.name) || survivor.from;
        const fields = buildRenameFields(code, survivorName, survivor.from);

        renames.push({ id: survivor.project.id, from: survivor.from, to: code, confidence: survivor.confidence, name: survivorName, fields });
        merges.push({
          code,
          survivor: { id: survivor.project.id, from: survivor.from, name: survivorName },
          losers: losers.map((loser) => ({ id: loser.project.id, from: loser.from, name: text(loser.project.name) || loser.from })),
          fields,
          // T12 (owner decision 2026-09-18): opt-in per merge group — 'sum'
          // when the mapping entry says so, otherwise null (keeps the
          // budgetConflicts report `planProjectMerge` has always produced).
          mergeBudgets: mappingEntry.mergeBudgets || null,
        });
        continue;
      }

      collisions.push({
        code,
        projects: group.map((candidate) => ({ id: candidate.project.id, from: candidate.from, confidence: candidate.confidence })),
      });
      continue;
    }
    const [{ project, from, to, confidence }] = group;
    const name = text(project.name) || from;
    renames.push({ id: project.id, from, to, confidence, name, fields: buildRenameFields(to, name, from) });
  }

  return {
    renames,
    skipped,
    collisions,
    merges,
    summary: { renames: renames.length, skipped: skipped.length, collisions: collisions.length, merges: merges.length },
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

// ── Budget line summing (T12: owner decision 2026-09-18) ───────────────────

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const numOr0 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const isEmptyValue = (value) => value === undefined || value === null || value === '';

/** Identity key a budget line is matched by across a merge: `type` plus its
 * normalized category name (accent/case-insensitive, mirrors `keyOf` above).
 * `categoryId` carries no extra signal here — the budget UI itself sets it to
 * the SAME string as `categoryName` (see `BudgetLineModal` in
 * BudgetVsActual.jsx), so it is not part of the identity. */
const budgetLineKey = (line) => `${text(line?.type)}|${keyOf(line?.categoryName)}`;

/**
 * matchBudgetLines — pairs each SURVIVOR line with the first not-yet-used
 * LOSER line sharing its identity key, 1:1. Extracted so both `sumBudgetLines`
 * (the merge itself) and `planProjectMerge` (the dry-run's matched/appended
 * counts) share the exact same matching rule instead of two implementations
 * silently drifting apart.
 */
const matchBudgetLines = (survivorLines, loserLines) => {
  const survivor = Array.isArray(survivorLines) ? survivorLines : [];
  const loser = Array.isArray(loserLines) ? loserLines : [];
  const loserUsed = new Array(loser.length).fill(false);

  const pairs = survivor.map((survivorLine) => {
    const key = budgetLineKey(survivorLine);
    const loserIndex = loser.findIndex((line, index) => !loserUsed[index] && budgetLineKey(line) === key);
    if (loserIndex === -1) return { survivorLine, loserLine: null };
    loserUsed[loserIndex] = true;
    return { survivorLine, loserLine: loser[loserIndex] };
  });

  const appendedLoserLines = loser.filter((_, index) => !loserUsed[index]);
  return { pairs, appendedLoserLines };
};

/** Combines one survivor/loser line PAIR: monthly amounts add element-wise
 * over all 12 months (missing/NaN/non-numeric treated as 0, rounded to cents
 * so the sum never drifts into floating-point noise); every other field
 * keeps the SURVIVOR's value, falling back to the loser's only when the
 * survivor's is empty — this includes `id`, so a merged line is never
 * assigned a new/random id. */
const mergeBudgetLine = (survivorLine, loserLine) => {
  const fieldNames = new Set([...Object.keys(survivorLine || {}), ...Object.keys(loserLine || {})]);
  fieldNames.delete('monthlyBudget');

  const merged = {};
  for (const field of fieldNames) {
    const survivorValue = survivorLine?.[field];
    merged[field] = isEmptyValue(survivorValue) ? loserLine?.[field] : survivorValue;
  }

  const survivorMonthly = Array.isArray(survivorLine?.monthlyBudget) ? survivorLine.monthlyBudget : [];
  const loserMonthly = Array.isArray(loserLine?.monthlyBudget) ? loserLine.monthlyBudget : [];
  merged.monthlyBudget = Array.from({ length: 12 }, (_, month) => round2(numOr0(survivorMonthly[month]) + numOr0(loserMonthly[month])));

  return merged;
};

/**
 * sumBudgetLines — merges a loser budget's lines into a survivor budget's
 * lines (T12: owner decision 2026-09-18, opt-in per merge group via
 * `mergeBudgets: 'sum'` on a `LEGACY_PROJECT_CODE_MAP` entry — see
 * `planProjectMerge` below). A matched pair (same `type` + normalized
 * `categoryName`) sums its `monthlyBudget`; an unmatched loser line is
 * appended after every survivor line, so the survivor's own line order is
 * preserved. Pure: neither input array nor any of its line objects is
 * mutated, and nothing is randomly generated — a carried-over `id` is always
 * the survivor's.
 *
 * @param {Array<object>} survivorLines
 * @param {Array<object>} loserLines
 * @returns {Array<object>} the merged lines
 */
export const sumBudgetLines = (survivorLines, loserLines) => {
  const { pairs, appendedLoserLines } = matchBudgetLines(survivorLines, loserLines);
  const merged = pairs.map(({ survivorLine, loserLine }) =>
    loserLine
      ? mergeBudgetLine(survivorLine, loserLine)
      : { ...survivorLine, monthlyBudget: [...(Array.isArray(survivorLine.monthlyBudget) ? survivorLine.monthlyBudget : [])] },
  );
  return [...merged, ...appendedLoserLines.map((line) => ({ ...line, monthlyBudget: [...(Array.isArray(line.monthlyBudget) ? line.monthlyBudget : [])] }))];
};

/** Gross total across every line's `monthlyBudget` (income and expense lines
 * summed together) — a single display/report number for `budgetMerges[]` and
 * the migration script's dry-run output, not used for any income/expense-
 * specific calculation elsewhere. */
const budgetLinesTotal = (lines) =>
  round2(
    (Array.isArray(lines) ? lines : []).reduce(
      (sum, line) => sum + (Array.isArray(line?.monthlyBudget) ? line.monthlyBudget : []).reduce((s, v) => s + numOr0(v), 0),
      0,
    ),
  );

// ── Project merges (T11) ─────────────────────────────────────────────────────

/** Collections with a top-level `projectId` + denormalised `projectName`
 * that get repointed on a merge — the exact list `scripts/merge-projects.cjs`
 * moves by hand (READ-ONLY reference: it has performed exactly this Roßdorf
 * merge before). `classificationRules` (nested `applyTo.*`), `budgets`
 * (`projectId` only, no name) and `employees` (`projectIds` array, no name)
 * are each handled separately below — their shapes do not fit this table. */
const MERGE_PROJECT_NAME_TARGETS = [
  { collection: 'bankMovements', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'receivables', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'payables', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
  { collection: 'workInProgress', getProjectId: (d) => d.projectId, getName: (d) => d.projectName },
];

/**
 * planProjectMerge — after `planProjectCodeMigration` proposes a `merges[]`
 * item, repoints every document that pointed at a LOSER project onto the
 * survivor (`projectId`, plus `projectName` when it has drifted from the
 * survivor's new name). Budgets follow the merge group's `mergeBudgets` flag
 * (T12, owner decision 2026-09-18): by default, a survivor and a loser both
 * holding a budget for the same year is reported in `budgetConflicts` for a
 * human to resolve — the loser's budget doc is still repointed (its
 * `projectId` alone, never its amounts). A `mergeBudgets: 'sum'` group sums
 * that same-year pair's lines into the survivor's budget instead
 * (`budgetMerges[]`) and leaves the loser budget's `projectId` untouched,
 * stamping it `mergedInto`/`mergedIntoProjectId` so it is never deleted yet
 * never counted again.
 *
 * @param {{ merges?: ReturnType<typeof planProjectCodeMigration>['merges'],
 *   documentsByCollection?: Record<string, Array<object>> }} params
 * @returns {{
 *   updates: Array<{collection, id, field, from, to}>,
 *   loserUpdates: Array<{collection, id, fields:Record<string,{from?, to}>}>,
 *   budgetConflicts: Array<{year, survivorProjectId, survivorBudgetId, loserProjectId, loserBudgetId}>,
 *   budgetMerges: Array<{year, survivorBudgetId, loserBudgetId, mergedLines, loserTotal,
 *     survivorTotalBefore, survivorTotalAfter, matchedLines, appendedLines}>,
 *   summary: object,
 * }}
 */
export const planProjectMerge = ({ merges, documentsByCollection } = {}) => {
  const mergeList = Array.isArray(merges) ? merges : [];
  const docsByCollection = documentsByCollection || {};

  // One global loser → survivor map, built from every merge group up front,
  // so a document touched by more than one merge group in the same run
  // (e.g. an employee who worked on two different merged sites) still gets
  // repointed correctly in a single pass, instead of one merge's write
  // clobbering another's when processed group-by-group.
  const survivorOf = new Map(); // loserId -> { id, name }
  for (const merge of mergeList) {
    const survivor = { id: merge.survivor.id, name: merge.survivor.name };
    for (const loser of merge.losers) survivorOf.set(loser.id, survivor);
  }

  const updates = [];
  // Declared here (not where it is populated below) because the budgets
  // block further down — T12, owner decision 2026-09-18 — already needs to
  // push a loser budget's `mergedInto` stamp onto it.
  const loserUpdates = [];

  for (const target of MERGE_PROJECT_NAME_TARGETS) {
    const docs = docsByCollection[target.collection];
    if (!Array.isArray(docs)) continue;
    for (const document of docs) {
      const projectId = target.getProjectId(document);
      const survivor = survivorOf.get(projectId);
      if (!survivor) continue;
      updates.push({ collection: target.collection, id: document.id, field: 'projectId', from: projectId, to: survivor.id });
      const currentName = text(target.getName(document));
      if (currentName !== text(survivor.name)) {
        updates.push({ collection: target.collection, id: document.id, field: 'projectName', from: currentName, to: survivor.name });
      }
    }
  }

  const rules = docsByCollection.classificationRules;
  if (Array.isArray(rules)) {
    for (const document of rules) {
      const projectId = document.applyTo?.projectId;
      const survivor = survivorOf.get(projectId);
      if (!survivor) continue;
      updates.push({ collection: 'classificationRules', id: document.id, field: 'applyTo.projectId', from: projectId, to: survivor.id });
      const currentName = text(document.applyTo?.projectName);
      if (currentName !== text(survivor.name)) {
        updates.push({ collection: 'classificationRules', id: document.id, field: 'applyTo.projectName', from: currentName, to: survivor.name });
      }
    }
  }

  // Budgets (T12: owner decision 2026-09-18 — `mergeBudgets: 'sum'` on the
  // Roßdorf entry of LEGACY_PROJECT_CODE_MAP). Two policies, chosen PER
  // MERGE GROUP:
  //   - default (no `mergeBudgets` flag): repoint `projectId` only, exactly
  //     as before T12 — a survivor+loser pair for the SAME year is a human
  //     decision, reported through `budgetConflicts`, never summed.
  //   - `mergeBudgets: 'sum'`: a same-year pair is summed line-by-line into
  //     the survivor's budget instead (`budgetMerges[]`). The loser budget's
  //     `projectId` is deliberately NEVER repointed to the survivor — doing
  //     so would make it count a SECOND time wherever budgets are matched by
  //     project (BudgetVsActual's exact-id lookup is safe, but
  //     ProyectoDashboard's free-text `projectTokens` match is NOT — see the
  //     `!budget.mergedInto` guard added there). It stays pointing at the
  //     (now inactive) loser project and is stamped `mergedInto` instead. A
  //     loser budget for a year the survivor has none is simply repointed,
  //     same as the default policy — nothing to sum.
  const budgetConflicts = [];
  const budgetMerges = [];
  const budgets = docsByCollection.budgets;
  if (Array.isArray(budgets)) {
    // `${projectId}:${year}` -> budget doc, excluding every loser's OWN
    // budget, so in a multi-loser group one loser's budget is never mistaken
    // for the true survivor budget when checking a DIFFERENT loser's year.
    const survivorBudgetByKey = new Map();
    for (const document of budgets) {
      if (survivorOf.has(document.projectId)) continue;
      survivorBudgetByKey.set(`${document.projectId}:${document.year}`, document);
    }
    const budgetsByProjectId = new Map();
    for (const document of budgets) {
      const list = budgetsByProjectId.get(document.projectId) || [];
      list.push(document);
      budgetsByProjectId.set(document.projectId, list);
    }

    // Running per-survivor-budget state (budgetId -> { before, lines }), so a
    // THIRD (or later) loser for the same survivor+year folds onto what the
    // previous loser already produced, instead of re-reading the original
    // unmerged survivor budget every time.
    const survivorBudgetState = new Map();

    // Iterated per MERGE GROUP, in `merge.losers`' own order — the SAME
    // deterministic survivor-rule order `planProjectCodeMigration` already
    // sorted the whole group by — so a 3+-project merge sums budgets in a
    // stable, reproducible fold order regardless of the Firestore read order.
    for (const merge of mergeList) {
      const sumEnabled = merge.mergeBudgets === 'sum';
      for (const loser of merge.losers) {
        // A loser budget already stamped `mergedInto` was summed on a prior
        // `--apply` and is settled: re-summing it on a second run would
        // silently double the survivor's budget — the critical idempotency
        // guard this filter exists for.
        const loserBudgets = (budgetsByProjectId.get(loser.id) || []).filter((document) => !document.mergedInto);

        for (const loserBudget of loserBudgets) {
          const survivorBudget = sumEnabled ? survivorBudgetByKey.get(`${merge.survivor.id}:${loserBudget.year}`) : undefined;

          if (survivorBudget) {
            const state = survivorBudgetState.get(survivorBudget.id) || { before: survivorBudget.lines || [], lines: survivorBudget.lines || [] };
            const { appendedLoserLines } = matchBudgetLines(state.lines, loserBudget.lines);
            const appended = appendedLoserLines.length;
            const matched = (Array.isArray(loserBudget.lines) ? loserBudget.lines.length : 0) - appended;

            const survivorTotalBefore = budgetLinesTotal(state.lines);
            const mergedLines = sumBudgetLines(state.lines, loserBudget.lines);
            const survivorTotalAfter = budgetLinesTotal(mergedLines);

            state.lines = mergedLines;
            survivorBudgetState.set(survivorBudget.id, state);

            budgetMerges.push({
              year: loserBudget.year,
              survivorBudgetId: survivorBudget.id,
              loserBudgetId: loserBudget.id,
              mergedLines,
              loserTotal: budgetLinesTotal(loserBudget.lines),
              survivorTotalBefore,
              survivorTotalAfter,
              matchedLines: matched,
              appendedLines: appended,
            });

            // Never deleted, never repointed to the survivor project — see
            // the policy comment above. `mergedIntoProjectId` mirrors the
            // `mergedIntoCode` convention project loser docs already carry,
            // for the same audit purpose.
            loserUpdates.push({
              collection: 'budgets',
              id: loserBudget.id,
              fields: { mergedInto: { to: survivorBudget.id }, mergedIntoProjectId: { to: merge.survivor.id } },
            });
            continue;
          }

          // Default policy, or a `mergeBudgets: 'sum'` group with no
          // same-year survivor budget: repoint projectId, exactly as before T12.
          updates.push({ collection: 'budgets', id: loserBudget.id, field: 'projectId', from: loserBudget.projectId, to: merge.survivor.id });
          const conflictBudget = !sumEnabled ? survivorBudgetByKey.get(`${merge.survivor.id}:${loserBudget.year}`) : null;
          if (conflictBudget) {
            budgetConflicts.push({
              year: loserBudget.year,
              survivorProjectId: merge.survivor.id,
              survivorBudgetId: conflictBudget.id,
              loserProjectId: loserBudget.projectId,
              loserBudgetId: loserBudget.id,
            });
          }
        }
      }
    }

    // One write per survivor budget touched, carrying its FINAL folded lines
    // (after every loser for that year has been summed in) — buildWritePlan
    // records `state.before` (the true pre-merge original) under
    // `migration.classificationCatalogV2.previous.lines`, so the sum stays
    // reversible.
    for (const [budgetId, state] of survivorBudgetState) {
      updates.push({ collection: 'budgets', id: budgetId, field: 'lines', from: state.before, to: state.lines });
    }
  }

  // Employees: replace every loser id with the survivor id and DE-DUPLICATE
  // — an employee assigned to both the survivor and a loser ends up with the
  // survivor once, in its first-seen position.
  const employees = docsByCollection.employees;
  if (Array.isArray(employees)) {
    for (const document of employees) {
      const ids = Array.isArray(document.projectIds) ? document.projectIds : [];
      if (!ids.some((id) => survivorOf.has(id))) continue;
      const next = [];
      for (const id of ids) {
        const mapped = survivorOf.get(id)?.id ?? id;
        if (!next.includes(mapped)) next.push(mapped);
      }
      updates.push({ collection: 'employees', id: document.id, field: 'projectIds', from: ids, to: next });
    }
  }

  // Loser project docs: deactivated, never deleted, reversible. `status`
  // and `active` only carry a `from` when the live doc was supplied (never
  // invents a "previous" value it does not actually know); `mergedInto` and
  // `mergedIntoCode` are brand-new fields with no meaningful prior value.
  const liveProjectsById = new Map((docsByCollection.projects || []).map((project) => [project.id, project]));
  for (const merge of mergeList) {
    for (const loser of merge.losers) {
      const live = liveProjectsById.get(loser.id);
      const fields = { mergedInto: { to: merge.survivor.id }, mergedIntoCode: { to: merge.code } };
      fields.status = live && live.status !== undefined ? { from: live.status, to: 'inactive' } : { to: 'inactive' };
      fields.active = live && live.active !== undefined ? { from: live.active, to: false } : { to: false };
      loserUpdates.push({ collection: 'projects', id: loser.id, fields });
    }
  }

  return {
    updates,
    loserUpdates,
    budgetConflicts,
    budgetMerges,
    summary: {
      updates: updates.length,
      loserUpdates: loserUpdates.length,
      budgetConflicts: budgetConflicts.length,
      budgetMerges: budgetMerges.length,
    },
  };
};

// ── Merged write plan ───────────────────────────────────────────────────────

/** Resolves a dotted path (e.g. `'applyTo.costCenterId'`) against a plain
 * object, the same NESTED shape Firestore hands back after a dotted-path
 * `update()` (`batch.update(ref, {'a.b': 1})` reads back as `{ a: { b: 1 } }`
 * — Firestore never stores a literal `'a.b'` map key). Returns `undefined`
 * for any missing segment. */
const getAtPath = (object, dottedPath) =>
  dottedPath.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);

/**
 * buildWritePlan — the single place migration writes are assembled, so a
 * document touched by more than one planner above (typically a cost-center
 * remap together with a projectName refresh) gets exactly ONE write instead
 * of two independent `batch.update()` calls that would each set the whole
 * `migration.classificationCatalogV2.previous` object, the second silently
 * destroying the first's rollback data.
 *
 * `previous` key naming: each rolled-back field keeps ITS OWN name —
 * `costCenterId` / `applyTo.costCenterId` for a cost-center remap,
 * `projectName` / `applyTo.projectName` for a denormalised name refresh,
 * `code` for a project rename, `projectId` / `applyTo.projectId` /
 * `projectIds` / `status` / `active` for a project merge (T11), `lines` for a
 * summed survivor budget and `mergedInto` / `mergedIntoProjectId` (no
 * `previous` — brand-new fields) for the loser budget it absorbed (T12) —
 * and is written through its OWN dotted Firestore path,
 * `migration.classificationCatalogV2.previous.<field>`. Because Firestore
 * treats every dot in an `update()` key as a nested path segment, each leaf
 * write only ever touches that one leaf: two different `<field>`s on the
 * same document (e.g. `costCenterId` and `projectName`, or the nested
 * `applyTo.costCenterId` and `applyTo.projectName`) can never clobber each
 * other, however many of them land in the same `data` object.
 *
 * Re-run safety: when `existingDocsByCollection` shows the live document
 * already carries a `previous` value for a field this run would also set,
 * that `previous` key is NOT written again — the first-ever original always
 * wins. The field's live value is still updated to the newly resolved
 * target; only the (redundant, and potentially wrong) `previous` write is
 * skipped.
 *
 * @param {{
 *   costCenterPlan?: { catalogUpserts?: Array<{code, data}>, remaps?: Array<{collection,id,from,to}> },
 *   projectPlan?: { renames?: Array<{id,from,to,fields}> },
 *   nameRefreshPlan?: { updates?: Array<{collection,id,field,from,to}> },
 *   mergePlan?: { updates?: Array<{collection,id,field,from,to}>,
 *     loserUpdates?: Array<{collection,id,fields:Record<string,{from?,to}>}> },
 *   existingDocsByCollection?: Record<string, Array<{id:string, migration?:object}>>,
 * }} params
 * @returns {Array<{ kind:'set'|'update', collection:string, id:string,
 *   data:object, merge?:boolean, label:string }>}
 */
export const buildWritePlan = ({ costCenterPlan, projectPlan, nameRefreshPlan, mergePlan, existingDocsByCollection } = {}) => {
  const docsByCollection = existingDocsByCollection || {};

  const existingPreviousOf = (collection, id) => {
    const docs = docsByCollection[collection];
    const found = Array.isArray(docs) ? docs.find((entry) => entry.id === id) : null;
    return found?.migration?.classificationCatalogV2?.previous || {};
  };

  const entries = new Map(); // `${collection}/${id}` → one working entry, in first-seen order
  const entryFor = (kind, collection, id) => {
    const key = `${collection}/${id}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { kind, collection, id, data: {}, existingPrevious: existingPreviousOf(collection, id) };
      entries.set(key, entry);
    }
    return entry;
  };

  /** Records `fromValue` under its own dotted previous path — unless the
   * live document already has one for `field`, in which case that recorded
   * original is left untouched (re-run safety, see doc comment above). */
  const setPrevious = (entry, field, fromValue) => {
    if (getAtPath(entry.existingPrevious, field) !== undefined) return;
    entry.data[`migration.classificationCatalogV2.previous.${field}`] = fromValue;
  };

  for (const upsert of costCenterPlan?.catalogUpserts || []) {
    const entry = entryFor('set', 'costCenters', upsert.code);
    entry.merge = true;
    Object.assign(entry.data, upsert.data);
  }

  for (const remap of costCenterPlan?.remaps || []) {
    const entry = entryFor('update', remap.collection, remap.id);
    const field = remap.collection === 'classificationRules' ? 'applyTo.costCenterId' : 'costCenterId';
    entry.data[field] = remap.to;
    setPrevious(entry, field, remap.from);
  }

  for (const rename of projectPlan?.renames || []) {
    const entry = entryFor('update', 'projects', rename.id);
    Object.assign(entry.data, rename.fields);
    setPrevious(entry, 'code', rename.from);
  }

  for (const update of nameRefreshPlan?.updates || []) {
    const entry = entryFor('update', update.collection, update.id);
    entry.data[update.field] = update.to;
    setPrevious(entry, update.field, update.from);
  }

  // T11 — project merges: repointed projectId/projectName (and the nested
  // applyTo./budgets./employees.projectIds variants) share the exact same
  // {collection,id,field,from,to} shape as a name refresh, so they merge
  // into the SAME per-document entry through the SAME setPrevious call.
  for (const update of mergePlan?.updates || []) {
    const entry = entryFor('update', update.collection, update.id);
    entry.data[update.field] = update.to;
    setPrevious(entry, update.field, update.from);
  }

  // A loser project doc's fields each carry their own optional `from` — only
  // status/active have one (a genuinely known prior value); mergedInto and
  // mergedIntoCode are new fields with nothing to roll back to.
  for (const loserUpdate of mergePlan?.loserUpdates || []) {
    const entry = entryFor('update', loserUpdate.collection, loserUpdate.id);
    for (const [field, change] of Object.entries(loserUpdate.fields)) {
      entry.data[field] = change.to;
      if ('from' in change) setPrevious(entry, field, change.from);
    }
  }

  return Array.from(entries.values()).map((entry) => ({
    kind: entry.kind,
    collection: entry.collection,
    id: entry.id,
    data: entry.data,
    ...(entry.merge ? { merge: true } : {}),
    label: `${entry.collection}/${entry.id}`,
  }));
};

// ── Script argv parsing ─────────────────────────────────────────────────────

const MIGRATION_ONLY_VALUES = ['cost-centers', 'projects'];
const MIGRATION_CONFIDENCE_VALUES = ['high', 'medium', 'low'];

/** The raw string after `--<name>=`, or `undefined` when the flag is absent
 * entirely — kept distinct from an EMPTY value (`--<name>=`), which is the
 * bug this parser fixes: the script used to fold "absent" and "present but
 * empty" into the same fallback, silently widening a dry-run's scope. */
const rawFlagValue = (argv, name) => {
  const prefix = `--${name}=`;
  const entry = argv.find((item) => item.startsWith(prefix));
  return entry === undefined ? undefined : entry.slice(prefix.length);
};

/**
 * parseMigrationArgs — pure argv parser for
 * `scripts/migrate-classification-catalog.cjs`. Fails CLOSED: a misspelled
 * flag, `--apply=<value>` (it is a bare flag), the space-separated
 * `--confirm x` form, or an empty/unrecognised `--only=`/`--min-confidence=`
 * value are all hard errors — never silently ignored or defaulted, which
 * would let an operator's mistyped guard run wider than intended.
 *
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{ ok:true, apply:boolean, confirm:string, only:string, minConfidence:string }
 *   | { ok:false, error:string }}
 */
export const parseMigrationArgs = (argv) => {
  const list = Array.isArray(argv) ? argv : [];

  const only = rawFlagValue(list, 'only');
  if (only === '') {
    return { ok: false, error: `--only no puede estar vacío. Usa uno de: ${MIGRATION_ONLY_VALUES.join(', ')}` };
  }
  if (only !== undefined && !MIGRATION_ONLY_VALUES.includes(only)) {
    return { ok: false, error: `--only debe ser uno de: ${MIGRATION_ONLY_VALUES.join(', ')}` };
  }

  const minConfidence = rawFlagValue(list, 'min-confidence');
  if (minConfidence === '') {
    return { ok: false, error: `--min-confidence no puede estar vacío. Usa uno de: ${MIGRATION_CONFIDENCE_VALUES.join(', ')}` };
  }
  if (minConfidence !== undefined && !MIGRATION_CONFIDENCE_VALUES.includes(minConfidence)) {
    return { ok: false, error: `--min-confidence debe ser uno de: ${MIGRATION_CONFIDENCE_VALUES.join(', ')}` };
  }

  const knownExact = new Set(['--apply']);
  const knownPrefixed = /^--(confirm|only|min-confidence)=/;
  const unknown = list.filter((entry) => !knownExact.has(entry) && !knownPrefixed.test(entry));
  if (unknown.length > 0) {
    return { ok: false, error: `Argumento no reconocido: ${unknown.join(', ')}` };
  }

  return {
    ok: true,
    apply: list.includes('--apply'),
    confirm: rawFlagValue(list, 'confirm') || '',
    only: only || '',
    minConfidence: minConfidence || 'high',
  };
};
