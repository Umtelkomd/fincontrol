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
 * A merge group breaks that last guarantee on its own, though: `QFF-002` and
 * "Roßdorf 2" map to `INS-RSD-BL1` because the two Roßdorf sites are ONE obra
 * AFTER the migration merges them — until then the second site is a separate
 * LIVE project doc holding exactly those values as its own code and name, and
 * renaming the first one by hand in the Proyectos screen is enough to make a
 * payable carrying `projectName: 'Roßdorf 2'` appear under both obras at once.
 * That is why `buildProjectTokens` accepts the caller's project list: an alias
 * that is another live project's own identity is withheld while that project
 * is live, and admitted once it is inactive or `mergedInto` — the exact state
 * the migration leaves behind, where the survivor SHOULD answer for the
 * absorbed obra's old documents.
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
 * Comparison key for "is this alias another project's own identity": accents
 * folded and inner whitespace collapsed on top of `normalizeToken`, because a
 * project doc may well store "Hoxter Nord" where the dictionary says "Höxter
 * Nord". Deliberately NOT used to build tokens — those keep their accents so a
 * document storing "Roßdorf" verbatim keeps matching.
 */
const claimKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A project doc still in play: neither status nor the older `active` flag
 * retired it, and no merge has already absorbed it into another project. */
const isLiveProject = (project) =>
  project?.status !== 'inactive' && project?.active !== false && !project?.mergedInto;

/**
 * Every identifier the OTHER live projects already answer to under their own
 * name — the set an alias must stay out of. `displayName` is this app's
 * `"CODE (Name)"` form (see `normalizeProjectPayload` in useProjects.js); the
 * same form is rebuilt from code+name so an alias written that way, or a doc
 * saved before displayName existed, is caught too.
 */
const identitiesClaimedByLiveSiblings = (project, liveProjects) => {
  const claimed = new Set();
  if (!Array.isArray(liveProjects)) return claimed;

  for (const sibling of liveProjects) {
    if (!sibling || sibling === project) continue;
    if (sibling.id && project?.id && sibling.id === project.id) continue;
    if (!isLiveProject(sibling)) continue;

    const ownIdentities = [sibling.code, sibling.name, sibling.displayName, sibling.legacyCode];
    if (sibling.code && sibling.name) ownIdentities.push(`${sibling.code} (${sibling.name})`);
    if (sibling.legacyCode && sibling.name) ownIdentities.push(`${sibling.legacyCode} (${sibling.name})`);

    ownIdentities.map(claimKey).filter(Boolean).forEach((key) => claimed.add(key));
  }

  return claimed;
};

/**
 * buildProjectTokens — every string a document might carry to identify this
 * project, normalized and deduplicated.
 *
 * @param {{ id?:string, code?:string, name?:string, displayName?:string, legacyCode?:string }} project
 * @param {{ liveProjects?: Array<object> }} [options] the caller's project
 *   list. It may hold inactive and merged docs — liveness is decided here, so
 *   callers pass the list they already have. Omitting it keeps the tokens a
 *   caller without a list has always got.
 * @returns {string[]}
 */
export const buildProjectTokens = (project, { liveProjects } = {}) => {
  if (!project) return [];

  const claimed = identitiesClaimedByLiveSiblings(project, liveProjects);
  // Only the DICTIONARY aliases are filtered. The project's own fields below
  // are never withheld: a project always answers to its own identity.
  const aliases = legacyAliasesFor(project.code).filter((alias) => !claimed.has(claimKey(alias)));

  const rawTokens = [
    project.id,
    project.code,
    project.name,
    project.displayName,
    project.legacyCode,
    `${project.code || ''} (${project.name || ''})`,
    project.legacyCode ? `${project.legacyCode} (${project.name || ''})` : '',
    ...aliases,
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
