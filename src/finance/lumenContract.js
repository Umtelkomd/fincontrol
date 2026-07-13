/**
 * Lumen ↔ FinControl integration contract (S1/S2).
 *
 * sourceKey is the idempotency key for finance documents originating in Lumen.
 * Never invent production in FinControl — only materialize Lumen facts.
 *
 * @see umtelkomd-gerencia/docs/product/ARQUITECTURA_SISTEMA.md
 */

import { canonicalizeProjectCode } from './projectCodeAliases.js';

export const LUMEN_SOURCE_SYSTEM = 'lumen';

/** CXC from a work order that reached client_accepted */
export function cxcSourceKey(workOrderId) {
  let id = String(workOrderId || '').trim();
  if (!id) return '';
  id = id.replace(/^wo-/i, '');
  return `lumen:cxc:wo-${id}`;
}

/** CXP from a published collaborator cycle (weekly close) */
export function cxpSourceKey(cycleId) {
  let id = String(cycleId || '').trim();
  if (!id) return '';
  id = id.replace(/^cycle-/i, '');
  return `lumen:cxp:cycle-${id}`;
}

/**
 * Build / normalize sourceKey from an ops-week CSV row (or event payload).
 * Prefers explicit source_key; else derives from lumen ids.
 */
export function sourceKeyFromOpsRow(row = {}) {
  const explicit = String(row.source_key || row.sourceKey || '').trim();
  if (explicit) return explicit;

  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'cxc') {
    return cxcSourceKey(row.lumen_work_order_id || row.lumenWorkOrderId || '');
  }
  if (kind === 'clear') {
    return cxpSourceKey(row.lumen_cycle_id || row.lumenCycleId || '');
  }
  return '';
}

/** Normalize project code for storage on finance docs and project master. */
export function normalizeProjectCode(raw) {
  return canonicalizeProjectCode(raw);
}

/**
 * Pick projectId from FinControl projects list using canonical code.
 */
export function resolveProjectIdByCode(projects, projectCode) {
  const canon = normalizeProjectCode(projectCode);
  if (!canon || !Array.isArray(projects)) return { projectId: '', projectName: '', projectCode: canon };
  const match = projects.find((p) => {
    const pc = normalizeProjectCode(p.code || p.codigo || '');
    if (pc && pc === canon) return true;
    return normalizeProjectCode(p.name || p.displayName || '') === canon;
  });
  if (!match) {
    return { projectId: '', projectName: canon, projectCode: canon };
  }
  return {
    projectId: match.id || '',
    projectName: match.displayName || match.name || match.code || canon,
    projectCode: normalizeProjectCode(match.code) || canon,
  };
}

/** Lumen master seed codes (keep aligned with Lumen projects + alias map). */
export const LUMEN_CANONICAL_PROJECT_SEED = [
  { code: 'QFF', name: 'QFF', operator: 'INSYTE', zone: '' },
  { code: 'QDU', name: 'QDU', operator: 'INSYTE', zone: '' },
  { code: 'FBX', name: 'FBX', operator: 'INSYTE', zone: '' },
  { code: 'NE4', name: 'NE4', operator: 'INSYTE', zone: '' },
  { code: 'HXT', name: 'HXT', operator: 'INSYTE', zone: '' },
  { code: 'RSD', name: 'RSD', operator: 'INSYTE', zone: '' },
  { code: 'WCB', name: 'WCB', operator: 'INSYTE', zone: '' },
  { code: 'WRZ', name: 'WRZ', operator: 'INSYTE', zone: '' },
  { code: 'EHR', name: 'Ehrenkirchen', operator: 'VANCOM', zone: 'Baden-Württemberg' },
  { code: 'BIE', name: 'Bielefeld', operator: 'INSYTE', zone: 'Nordrhein-Westfalen' },
  { code: 'WUR', name: 'Würzburg', operator: 'INSYTE', zone: 'Bayern' },
  { code: 'BAM', name: 'Bamberg', operator: 'INSYTE', zone: 'Bayern' },
  { code: 'LGN', name: 'Langenau', operator: 'VANCOM', zone: 'Baden-Württemberg' },
  { code: 'GFP', name: 'GFP', operator: 'INSYTE', zone: '' },
  { code: 'UGG', name: 'UGG', operator: 'INSYTE', zone: '' },
  { code: 'DGF', name: 'DGF', operator: 'INSYTE', zone: '' },
  { code: 'AUSTRIA', name: 'Austria', operator: 'INSYTE', zone: '' },
];
