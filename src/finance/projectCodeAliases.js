/**
 * The project code dictionary (Lumen ↔ FinControl) — one table per question:
 *
 *   - `PROJECT_CODE_ALIASES` normalizes a legacy token to its legacy MASTER
 *     code, which is what gets STORED (`PROY-001` → `QFF`).
 *   - `LEGACY_PROJECT_CODE_MAP` maps legacy codes and names to the v2 scheme
 *     `CLI-SIT-LLn` (see projectCode.js for the scheme itself).
 *   - `canonicalObraKey` is the MATCHING key: ONE key per obra, so a legacy
 *     code, a legacy name, the `"CODE (Name)"` display form and the v2 code all
 *     answer the same. `projectCodesMatch` compares those keys.
 *
 * Both tables live here because they used to be separate dictionaries that
 * disagreed: `projectCodesMatch('INS-RSD-BL1', 'QFF')` was false, so a project
 * renamed to its v2 code read as a DIFFERENT obra from its own documents, and
 * `useProjects` would happily create a second project for one obra.
 *
 * `PROJECT_CODE_PATTERN`, `isStructuredProjectCode`, `LEGACY_PROJECT_CODE_MAP`
 * and `resolveLegacyProjectCode` live in this module, the one that imports
 * nothing, and projectCode.js re-exports them: the matching functions below
 * need the structured-code scheme, and projectCode.js needs
 * `canonicalizeProjectCode`, so the shared primitives belong to the lower
 * module rather than to a cycle.
 *
 * Keep in sync with: Lumen-esneider/src/config/projectCodeAliases.ts
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

export const PROJECT_CODE_ALIASES = {
  'PROY-001': 'QFF',
  'PROY-002': 'QDU',
  'PROY-003': 'FBX',
  'PROY-004': 'NE4',
  'PROY-005': 'AUSTRIA',
  QFF: 'QFF',
  QDU: 'QDU',
  FBX: 'FBX',
  NE4: 'NE4',
  HXT: 'HXT',
  RSD: 'RSD',
  WCB: 'WCB',
  WRZ: 'WRZ',
  EHR: 'EHR',
  AUSTRIA: 'AUSTRIA',
  GFP: 'GFP',
  UGG: 'UGG',
  DGF: 'DGF',
  // Seed codes present in LUMEN_CANONICAL_PROJECT_SEED (lumenContract.js) but
  // missing here — added so every known project token canonicalizes through
  // this single table instead of silently relying on the bare-uppercase
  // fallback for an entry that is supposed to be a first-class known code.
  BIE: 'BIE',
  WUR: 'WUR',
  BAM: 'BAM',
  LGN: 'LGN',
  // Production drift tokens (see odd/tasks/invoice-classification-catalog.md
  // "Problem"): ops-style work-order refs merge into their existing master
  // code, exactly like 'PROY-001' already merges into 'QFF'. Owner decision
  // 2026-09-18 (T11): QFF-002 ("Roßdorf 2") is the SAME project as QFF/
  // QFF-001 ("Roßdorf 1"), so it merges here too. WESTC_MDU stays apart — it
  // is a genuinely different site (the MDU line), not a split of the same
  // obra. The v2 project code scheme (src/finance/projectCode.js) is where
  // that distinction becomes a first-class field.
  'QFF-001': 'QFF',
  'QFF-002': 'QFF',
  'UGG-001': 'UGG',
  WSC: 'WSC',
  'WEST-001': 'WSC',
  WESTC_MDU: 'WESTC_MDU',
  'AMD-001': 'AMD-001',
  MESCHEDE: 'MESCHEDE',
};

/** Trim + uppercase. The structured-shape check ignores nothing else. */
const upper = (value) => String(value ?? '').trim().toUpperCase();

/** Lookup key for a legacy code or NAME: trimmed, lower-cased, accent-stripped. Mirrors costCenterCatalog.js. */
export const legacyKeyOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const PROJECT_CODE_PATTERN = /^[A-Z]{3}-[A-Z0-9]{3}-(TB|BL|N4|MD|SV|OH)[1-9][0-9]?$/;

export const isStructuredProjectCode = (code) => PROJECT_CODE_PATTERN.test(upper(code));

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
 *
 * Every value in `match` is also an obra ALIAS: `canonicalObraKey` reads this
 * table, so each entry is the statement "all of these name the same obra".
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

const LEGACY_ALIAS_INDEX = new Map();
LEGACY_PROJECT_CODE_MAP.forEach(({ match, code, confidence }) => {
  match.forEach((alias) => LEGACY_ALIAS_INDEX.set(legacyKeyOf(alias), { code, confidence }));
});

/**
 * extractProjectToken — the one token a free-text project reference is about.
 *
 * A STRUCTURED v2 code at the head wins outright. Everything else keeps the
 * older rule: a short (≤ 8 chars) or known parenthesized part beats the head,
 * because legacy values were written as "Nombre largo (QFF)". That rule is
 * wrong the moment the head is a v2 code: `useProjects.normalizeProjectPayload`
 * stores a displayName as `"CODE (Name)"`, so `VAN-UGG-N41 (UGG)` answered
 * `UGG` — the legacy code of the very project that had just been renamed.
 */
export function extractProjectToken(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const head = s.split(/[\s(/]/)[0]?.trim() ?? s;
  if (isStructuredProjectCode(head)) return upper(head);
  const paren = s.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    const inner = paren[1].trim().toUpperCase();
    if (PROJECT_CODE_ALIASES[inner] || inner.length <= 8) return PROJECT_CODE_ALIASES[inner] ?? inner;
  }
  return head.toUpperCase();
}

/**
 * canonicalizeProjectCode — the STORAGE normalizer: a legacy token becomes its
 * legacy master code (`QFF-001` → `QFF`), a structured code passes through, and
 * anything unknown comes back bare-uppercased. Deliberately NOT the obra key:
 * this value is persisted as `projects.code` and as `projectCode` on payables
 * and receivables, so it must keep answering with the code production actually
 * holds until the migration renames it.
 */
export function canonicalizeProjectCode(raw) {
  if (!raw) return '';
  const token = extractProjectToken(raw);
  if (!token) return '';
  return PROJECT_CODE_ALIASES[token] ?? token;
}

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

/**
 * canonicalObraKey — ONE key per obra, for comparing two project references.
 *
 * Every spelling the dictionary knows collapses onto the obra's v2 code: the
 * code itself, a legacy code, a legacy name, and the `"CODE (Name)"` display
 * form. An obra the dictionary does not map keeps its canonicalized value, so
 * two unknown codes match only when they are the same code. Never a guess.
 */
export const canonicalObraKey = (value) => resolveLegacyProjectCode(value).code;

/** Are these two references the same obra? Blank never matches, not even blank. */
export function projectCodesMatch(a, b) {
  const ka = canonicalObraKey(a);
  const kb = canonicalObraKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}
