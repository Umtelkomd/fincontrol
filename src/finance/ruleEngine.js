/**
 * Classification Rule Engine
 * ─────────────────────────────────
 * Pure functions that evaluate classification rules against bank movements.
 *
 *   matchRule(movement, rule)            → boolean
 *   findBestRule(movement, rules)        → rule | null
 *   buildClassificationPayload(rule, movement) → object to merge into bankMovement
 *
 * Rules are matched by:
 *   - direction filter (in/out/both)
 *   - amount range (optional)
 *   - field match against counterpartyName or description
 *
 * Match types:
 *   contains   → case-insensitive substring
 *   exact      → case-insensitive equality (trimmed)
 *   startsWith → case-insensitive prefix
 *   regex      → JS RegExp, case-insensitive flag added if missing
 *
 * The engine is fully stateless — Firestore writes happen in the calling hook.
 */

import { isCostScope, normalizeCostScope } from './costScope.js';
import { isInternalTransfer } from '../lib/finance/movementAmount.js';

const norm = (s) => String(s || '').toLowerCase().trim();

const fieldValue = (movement, field) => {
  if (!movement) return '';
  const raw = field === 'description' ? movement.description : movement.counterpartyName;
  return norm(raw);
};

const matchesPattern = (haystack, rule) => {
  const pattern = String(rule.pattern || '').trim();
  if (!pattern) return false;

  const matchType = rule.matchType || 'contains';
  const needle = norm(pattern);

  switch (matchType) {
    case 'exact':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'regex': {
      try {
        const re = new RegExp(pattern, 'i');
        return re.test(haystack);
      } catch {
        return false;
      }
    }
    case 'contains':
    default:
      return haystack.includes(needle);
  }
};

const matchesDirection = (movement, rule) => {
  const dir = rule.direction || 'both';
  if (dir === 'both') return true;
  return movement.direction === dir;
};

const matchesAmount = (movement, rule) => {
  const amount = Math.abs(Number(movement.amount) || 0);
  const min = rule.amountMin == null ? null : Number(rule.amountMin);
  const max = rule.amountMax == null ? null : Number(rule.amountMax);
  if (min != null && Number.isFinite(min) && amount < min) return false;
  if (max != null && Number.isFinite(max) && amount > max) return false;
  return true;
};

/**
 * matchRule — decide if a single rule applies to a movement.
 */
export const matchRule = (movement, rule) => {
  if (!movement || !rule) return false;
  if (rule.active === false) return false;
  if (!matchesDirection(movement, rule)) return false;
  if (!matchesAmount(movement, rule)) return false;
  const haystack = fieldValue(movement, rule.field);
  if (!haystack) return false;
  return matchesPattern(haystack, rule);
};

/**
 * findBestRule — pick the highest-priority active rule that matches.
 * Tie-break: most recent lastHitAt, then highest hits, then alphabetical name.
 */
export const findBestRule = (movement, rules) => {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const candidates = rules.filter((r) => matchRule(movement, r));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = Number(a.priority) || 0;
    const pb = Number(b.priority) || 0;
    if (pa !== pb) return pb - pa;
    const la = a.lastHitAt || '';
    const lb = b.lastHitAt || '';
    if (la !== lb) return lb.localeCompare(la);
    const ha = Number(a.hits) || 0;
    const hb = Number(b.hits) || 0;
    if (ha !== hb) return hb - ha;
    return (a.name || '').localeCompare(b.name || '');
  });
  return candidates[0];
};

/**
 * buildClassificationPayload — produce the partial update to apply on a movement.
 * Only includes non-empty fields — never overrides existing data with blanks.
 *
 * `costScope` follows the same never-overwrite semantics: it is only applied
 * when the rule carries a valid COST_SCOPE value and the movement has no
 * destination yet — including the legacy ones derived from an "Overhead"
 * project name or a bare projectId.
 */
export const buildClassificationPayload = (rule, movement) => {
  if (!rule || !rule.applyTo) return {};
  const apply = rule.applyTo;
  const out = {};
  if (apply.categoryName && !movement?.categoryName) out.categoryName = apply.categoryName;
  if (apply.costCenterId && !movement?.costCenterId) out.costCenterId = apply.costCenterId;
  if (apply.projectId && !movement?.projectId) out.projectId = apply.projectId;
  if (apply.projectName && !movement?.projectName) out.projectName = apply.projectName;
  if (isCostScope(apply.costScope) && !normalizeCostScope(movement)) out.costScope = apply.costScope;
  return out;
};

/**
 * previewMatches — given a list of pending movements and a rule,
 * return the ones it WOULD classify (does not write).
 */
export const previewMatches = (movements, rule, limit = 50) => {
  if (!Array.isArray(movements) || !rule) return [];
  const out = [];
  for (const m of movements) {
    if (matchRule(m, rule)) out.push(m);
    if (out.length >= limit) break;
  }
  return out;
};

/**
 * groupUnclassifiedByCounterparty — utility for the alerts dashboard.
 * Returns top counterparties of unclassified movements with their totals,
 * useful for suggesting "create a rule for X".
 */
export const groupUnclassifiedByCounterparty = (movements, topN = 10) => {
  const map = new Map();
  for (const m of movements || []) {
    if (m.status === 'void') continue;
    // Own-account transfers need no rule: they are resolved by nature and are
    // already excluded from every cost report. `UMTELKOMD ESPAÑA S.L.` is a
    // subcontractor with an almost identical name and still deserves a rule.
    if (isInternalTransfer(m)) continue;
    if (m.categoryName || m.costCenterId || m.receivableId || m.payableId) continue;
    const key = (m.counterpartyName || 'Sin contraparte').trim();
    if (!map.has(key)) {
      map.set(key, { counterparty: key, count: 0, totalIn: 0, totalOut: 0, samples: [] });
    }
    const entry = map.get(key);
    entry.count += 1;
    const amt = Math.abs(Number(m.amount) || 0);
    if (m.direction === 'in') entry.totalIn += amt;
    else entry.totalOut += amt;
    if (entry.samples.length < 3) entry.samples.push(m);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
};
