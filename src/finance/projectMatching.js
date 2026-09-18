/**
 * projectMatching — "which documents belong to this obra", extracted from
 * `ProyectoDashboard.jsx` so it is provable without rendering a screen.
 *
 * A document may carry no `projectId` at all (captured before the project
 * had one, or typed by hand against its free-text name), so matching falls
 * back to a set of TOKENS the project is known under. Before the v2 project
 * code migration (`classificationMigration.js` / `projectCode.js`) those
 * tokens were only the project's own id/code/name/displayName. Once a
 * project is renamed to its structured `CLI-SIT-LLn` code, every document
 * still holding the pre-rename free-text value (typically `projectName`,
 * since `projectId` never changes) would otherwise silently stop matching —
 * so tokens also include `legacyCode`, the `"legacyCode (name)"` form, and
 * every alias in `LEGACY_PROJECT_CODE_MAP` whose target equals the
 * project's CURRENT code. That last source is scoped to THIS project only:
 * an alias is added only when its mapped target is this project's own
 * code, so a sibling project sharing a legacy prefix (`QFF` vs `QFF-002`)
 * never bleeds into the wrong obra.
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

import { LEGACY_PROJECT_CODE_MAP } from './projectCode.js';

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

/** Every alias mapped to `code` in LEGACY_PROJECT_CODE_MAP, or [] when `code`
 * is not (yet) any legacy entry's target — e.g. a project still on its own
 * legacy code, which is itself the source, not the target, of a mapping. */
const legacyAliasesFor = (code) => {
  if (!code) return [];
  const upper = String(code).trim().toUpperCase();
  return LEGACY_PROJECT_CODE_MAP.filter((entry) => entry.code === upper).flatMap((entry) => entry.match);
};

/**
 * buildProjectTokens — every string a document might carry to identify this
 * project, normalized and deduplicated.
 *
 * @param {{ id?:string, code?:string, name?:string, displayName?:string, legacyCode?:string }} project
 * @returns {string[]}
 */
export const buildProjectTokens = (project) => {
  if (!project) return [];

  const rawTokens = [
    project.id,
    project.code,
    project.name,
    project.displayName,
    project.legacyCode,
    `${project.code || ''} (${project.name || ''})`,
    project.legacyCode ? `${project.legacyCode} (${project.name || ''})` : '',
    ...legacyAliasesFor(project.code),
  ];

  return Array.from(new Set(rawTokens.map(normalizeToken).filter(Boolean)));
};

/**
 * matchesProject — does `record` belong to this project: either a direct
 * `projectId` match, or one of its free-text fields (`projectName`,
 * `project`, and the same two read through `raw`/`rawRecord`, for records
 * that wrap the original document) matching one of `tokens`.
 *
 * @param {object} record
 * @param {string[]} tokens - from `buildProjectTokens`
 * @param {string} [projectId]
 * @returns {boolean}
 */
export const matchesProject = (record, tokens, projectId) => {
  const directId = normalizeToken(record?.projectId);
  if (projectId && directId && directId === normalizeToken(projectId)) return true;

  const candidates = [
    record?.projectName,
    record?.project,
    record?.raw?.projectName,
    record?.raw?.project,
    record?.rawRecord?.projectName,
    record?.rawRecord?.project,
  ]
    .map(normalizeToken)
    .filter(Boolean);

  return candidates.some((candidate) => tokens.includes(candidate));
};
