/**
 * Project code scheme v2 — `CLI-SIT-LLn`, WHICH contract earns/consumes a
 * euro (the second of the three orthogonal axes; see costCenterCatalog.js
 * for the first and taxonomy.js for the third).
 *
 * Three project code sources disagreed in production: `projectCodeAliases.js`
 * (13 short codes), the Lumen seed (17), and free-form production values
 * (`AMD-001`, `QFF-001/002`, `UGG-001`, `WSC`, `WEST-001`, `WESTC_MDU`,
 * `Meschede`, the typo `Würzwurg`). This module is the additive fix:
 *
 *   CLI-SIT-LLn
 *   ├── CLI  3 letters   who pays us (INS Insyte, VAN Vancom, WSC Wesconnect,
 *   │                    UMT internal — `PROJECT_CLIENTS` is a SUGGESTION
 *   │                    list, not a closed set: a new client is still a
 *   │                    valid code)
 *   ├── SIT  3 alnum      site or frame contract (RSD Roßdorf, HXT Höxter,
 *   │                    WRZ Würzburg, MSD Meschede, GEN generic)
 *   ├── LL   2 letters    line — one of `PROJECT_LINES`, which also carries
 *   │                    the line's default direct cost center
 *   └── n    1-99, no padding, the lot within that CLI-SIT-LL combination
 *
 * Legacy codes stay VALID — flagged `legacy` by `resolveLegacyProjectCode`,
 * never rejected. `LEGACY_PROJECT_CODE_MAP` is the mapping from the design
 * doc; the owner validated it on 2026-09-18 (T11, every entry is now
 * confidence `high`) — `confidence`/`--min-confidence` remain in place for
 * any future entry that has not yet been reviewed. On the SAME day the owner
 * additionally decided (T12) that the Roßdorf merge's same-year budgets are
 * SUMMED rather than reported as a conflict — `mergeBudgets: 'sum'` on that
 * entry is the opt-in signal `planProjectMerge` reads. `findProjectMentions`
 * is what lets an invoice PDF's free text resolve to a project by code,
 * legacy alias or name, in that priority.
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

import { defaultCostCenterForLine } from './costCenterCatalog.js';
import { canonicalizeProjectCode } from './projectCodeAliases.js';

const line = (code, label) => Object.freeze({ code, label, costCenter: defaultCostCenterForLine(code) });

/** Report/dropdown order. `costCenter` is derived from the catalogue — one source of truth. */
export const PROJECT_LINES = Object.freeze([
  line('TB', 'Obra civil'),
  line('BL', 'Soplado y fusiones'),
  line('N4', 'NE4'),
  line('MD', 'MDU'),
  line('SV', 'Dirección de obra'),
  line('OH', 'Estructura interna'),
]);

const LINE_CODES = PROJECT_LINES.map((entry) => entry.code);

/** Known clients — a SUGGESTION list for the builder UI, not a closed set. */
export const PROJECT_CLIENTS = Object.freeze(
  [
    { code: 'INS', label: 'Insyte' },
    { code: 'VAN', label: 'Vancom' },
    { code: 'WSC', label: 'Wesconnect' },
    { code: 'UMT', label: 'UMTELKOMD (interno)' },
  ].map(Object.freeze),
);

export const PROJECT_CODE_PATTERN = /^[A-Z]{3}-[A-Z0-9]{3}-(TB|BL|N4|MD|SV|OH)[1-9][0-9]?$/;

/** Strip accents/whitespace, uppercase — the shape check ignores nothing else. */
const upper = (value) => String(value ?? '').trim().toUpperCase();

export const isStructuredProjectCode = (code) => PROJECT_CODE_PATTERN.test(upper(code));

/** `{ client, site, line, lot } | null` — null for anything not shaped like a v2 code. */
export const parseProjectCode = (code) => {
  const value = upper(code);
  const match = PROJECT_CODE_PATTERN.exec(value);
  if (!match) return null;
  const [client, site, lineAndLot] = value.split('-');
  const lineCode = match[1];
  return { client, site, line: lineCode, lot: Number(lineAndLot.slice(lineCode.length)) };
};

/** Strip accents and anything that is not A-Z/0-9, uppercase. */
const alnumOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const CLIENT_RE = /^[A-Z]{3}$/;
const SITE_RE = /^[A-Z0-9]{3}$/;

/**
 * validateProjectCodeParts — the single source of truth for what a valid
 * `{ client, site, line, lot }` looks like. `buildProjectCode` calls this
 * before assembling the code, so the two never drift apart.
 */
export const validateProjectCodeParts = ({ client, site, line: lineCode, lot } = {}) => {
  const errors = {};
  const c = alnumOf(client);
  const s = alnumOf(site);
  const l = upper(lineCode);
  const n = Number(lot);

  if (!CLIENT_RE.test(c)) errors.client = 'El cliente debe tener exactamente 3 letras (ej. INS)';
  if (!SITE_RE.test(s)) errors.site = 'El sitio debe tener exactamente 3 caracteres alfanuméricos (ej. RSD)';
  if (!LINE_CODES.includes(l)) errors.line = 'Selecciona una línea de proyecto válida';
  if (!Number.isInteger(n) || n < 1 || n > 99) errors.lot = 'El lote debe ser un número entero entre 1 y 99';

  return { valid: Object.keys(errors).length === 0, errors };
};

/** Assembles a v2 code from parts, or '' when `validateProjectCodeParts` rejects them. */
export const buildProjectCode = (parts = {}) => {
  if (!validateProjectCodeParts(parts).valid) return '';
  const c = alnumOf(parts.client);
  const s = alnumOf(parts.site);
  const l = upper(parts.line);
  const n = Number(parts.lot);
  return `${c}-${s}-${l}${n}`;
};

/** Smallest lot ≥ 1 not already used by an existing structured code with the same client/site/line. */
export const nextLot = (existingCodes, { client, site, line: lineCode } = {}) => {
  const c = alnumOf(client);
  const s = alnumOf(site);
  const l = upper(lineCode);
  const used = new Set(
    (Array.isArray(existingCodes) ? existingCodes : [])
      .map((code) => parseProjectCode(code))
      .filter((parsed) => parsed && parsed.client === c && parsed.site === s && parsed.line === l)
      .map((parsed) => parsed.lot),
  );
  let lot = 1;
  while (used.has(lot)) lot += 1;
  return lot;
};

/** `options.merge: true` flags a target code that more than one LIVE project
 * may resolve to as the SAME project, not a collision — see
 * `planProjectCodeMigration`'s merge handling in classificationMigration.js.
 * `options.mergeBudgets: 'sum'` is the separate, per-merge-group opt-in
 * (owner decision 2026-09-18, T12): when set, `planProjectMerge` sums a
 * same-year survivor+loser budget line-by-line instead of reporting it under
 * `budgetConflicts`. A merge entry without it keeps the conflict-report
 * default — `mergeBudgets` only makes sense alongside `merge: true`. */
const legacyEntry = (match, code, confidence, options = {}) =>
  Object.freeze({
    match: Object.freeze([...match]),
    code,
    confidence,
    ...(options.merge ? { merge: true } : {}),
    ...(options.mergeBudgets ? { mergeBudgets: options.mergeBudgets } : {}),
  });

/**
 * Legacy → v2 mapping from the design doc, owner-validated on 2026-09-18
 * (T11): every entry below is `confidence: 'high'`. QFF, QFF-001, QFF-002,
 * PROY-001, RSD, "Roßdorf 1" and "Roßdorf 2" are ONE project — `merge: true`
 * is the explicit signal that several live projects resolving to this code
 * are the same obra and must be MERGED (one survivor absorbs the others),
 * never treated as a collision. Everything not covered here (QDU, AUSTRIA,
 * EHR, BIE, BAM, LGN, GFP, DGF, WCB, ...) stays `legacy` —
 * `resolveLegacyProjectCode` never guesses a target for it. `confidence` and
 * `--min-confidence` remain useful for any future, not-yet-validated entry.
 */
export const LEGACY_PROJECT_CODE_MAP = Object.freeze([
  legacyEntry(
    ['QFF', 'QFF-001', 'QFF-002', 'PROY-001', 'RSD', 'Roßdorf 1', 'Roßdorf 2'],
    'INS-RSD-BL1',
    'high',
    { merge: true, mergeBudgets: 'sum' },
  ),
  legacyEntry(['NE4', 'PROY-004', 'WRZ', 'WUR', 'Würzburg', 'Würzwurg'], 'INS-WRZ-N41', 'high'),
  legacyEntry(['UGG', 'UGG-001', 'Vancom NE4'], 'VAN-UGG-N41', 'high'),
  legacyEntry(['WSC', 'WEST-001', 'Wesconnect', 'NE4 West-connect'], 'WSC-GEN-N41', 'high'),
  legacyEntry(['WESTC_MDU'], 'WSC-GEN-MD1', 'high'),
  legacyEntry(['FBX', 'PROY-003', 'HXT', 'Höxter Nord'], 'INS-HXT-TB1', 'high'),
  legacyEntry(['Meschede'], 'INS-MSD-TB1', 'high'),
  legacyEntry(['AMD-001', 'Overhead'], 'UMT-ADM-OH1', 'high'),
]);

/** Lookup key: trimmed, lower-cased, accent-stripped. Mirrors costCenterCatalog.js. */
const legacyKeyOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const LEGACY_ALIAS_INDEX = new Map();
LEGACY_PROJECT_CODE_MAP.forEach(({ match, code, confidence }) => {
  match.forEach((alias) => LEGACY_ALIAS_INDEX.set(legacyKeyOf(alias), { code, confidence }));
});

/**
 * resolveLegacyProjectCode — v2 code for a legacy code/name, never a guess.
 *
 *   - a current v2 code                        → { code: <same>, confidence: null, status: 'current' }
 *   - a mapped legacy code or name              → { code, confidence, status: 'mapped' }
 *   - tolerates the "CODE (Name)" displayName form (tries the code part, the
 *     parenthesized name, then the whole string)
 *   - unknown/unmapped, incl. blank             → { code: <canonicalized input>, confidence: null, status: 'legacy' }
 *     (blank input canonicalizes to '')
 */
export const resolveLegacyProjectCode = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return { code: '', confidence: null, status: 'legacy' };

  const paren = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const codePart = (paren ? paren[1] : raw).trim();
  const namePart = paren ? paren[2].trim() : '';

  if (isStructuredProjectCode(codePart)) {
    return { code: upper(codePart), confidence: null, status: 'current' };
  }

  for (const candidate of [codePart, namePart, raw]) {
    const key = legacyKeyOf(candidate);
    const hit = key && LEGACY_ALIAS_INDEX.get(key);
    if (hit) return { code: hit.code, confidence: hit.confidence, status: 'mapped' };
  }

  return { code: canonicalizeProjectCode(raw), confidence: null, status: 'legacy' };
};

/** Project line code for a project doc, or '' when it cannot be resolved. */
export const lineOfProject = (project) => {
  const rawCode = String(project?.code || project?.codigo || '').trim();

  const direct = parseProjectCode(rawCode);
  if (direct) return direct.line;

  const fallbackValue = rawCode || project?.name || project?.displayName || '';
  const resolved = resolveLegacyProjectCode(fallbackValue);
  const resolvedParsed = parseProjectCode(resolved.code);
  return resolvedParsed ? resolvedParsed.line : '';
};

/** The direct cost center the project's line defaults to, or '' when unresolved. */
export const defaultCostCenterForProject = (project) => defaultCostCenterForLine(lineOfProject(project));

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index of the first WORD-BOUNDARY-SAFE occurrence of `token` in `text`, or -1. */
const boundaryIndexOf = (text, token) => {
  if (!token) return -1;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(token)}(?![A-Za-z0-9])`, 'i');
  const match = re.exec(text);
  return match ? match.index : -1;
};

/**
 * findProjectMentions — every project mentioned in free text (typically an
 * invoice PDF's extracted text), ordered by first occurrence.
 *
 * Per project, three candidate groups are tried IN PRIORITY ORDER — code,
 * then legacy alias, then name — and the first group with any hit wins (even
 * if a lower-priority group would have matched earlier in the text). Matching
 * is case-insensitive and word-boundary safe: `NE4` never matches inside
 * `LINE4X`, and a short legacy code must be a standalone token.
 *
 * @param {string} text
 * @param {Array<{id:string, code?:string, codigo?:string, name?:string, displayName?:string}>} projects
 * @returns {Array<{projectId:string, code:string, matched:string, kind:'code'|'alias'|'name'}>}
 */
export const findProjectMentions = (text, projects) => {
  const haystack = String(text || '');
  if (!haystack || !Array.isArray(projects) || projects.length === 0) return [];

  const hits = [];

  for (const project of projects) {
    if (!project || !project.id) continue;

    const ownCode = String(project.code || project.codigo || '').trim();
    const ownCodeKey = legacyKeyOf(ownCode);
    const canonicalCode = isStructuredProjectCode(ownCode) ? upper(ownCode) : resolveLegacyProjectCode(ownCode).code;

    const codeCandidates = ownCode ? [ownCode] : [];

    const aliasCandidates = [];
    if (canonicalCode) {
      LEGACY_PROJECT_CODE_MAP.forEach((entry) => {
        if (entry.code !== canonicalCode) return;
        entry.match.forEach((alias) => {
          if (legacyKeyOf(alias) === ownCodeKey) return; // already covered by the code group
          aliasCandidates.push(alias);
        });
      });
    }

    const nameCandidates = [project.name, project.displayName].filter((value) => typeof value === 'string' && value.trim());

    let best = null;
    for (const [kind, candidates] of [
      ['code', codeCandidates],
      ['alias', aliasCandidates],
      ['name', nameCandidates],
    ]) {
      for (const candidate of candidates) {
        const index = boundaryIndexOf(haystack, candidate);
        if (index === -1) continue;
        if (!best || index < best.index) best = { index, matched: candidate, kind };
      }
      if (best) break; // a higher-priority group already matched — stop here
    }

    if (best) {
      hits.push({
        index: best.index,
        mention: { projectId: project.id, code: ownCode || canonicalCode, matched: best.matched, kind: best.kind },
      });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits.map((hit) => hit.mention);
};
