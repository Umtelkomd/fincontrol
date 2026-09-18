/**
 * Shared project code dictionary (Lumen ↔ FinControl).
 * Keep in sync with: Lumen-esneider/src/config/projectCodeAliases.ts
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

export function extractProjectToken(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const paren = s.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    const inner = paren[1].trim().toUpperCase();
    if (PROJECT_CODE_ALIASES[inner] || inner.length <= 8) return PROJECT_CODE_ALIASES[inner] ?? inner;
  }
  const head = s.split(/[\s(/]/)[0]?.trim() ?? s;
  return head.toUpperCase();
}

export function canonicalizeProjectCode(raw) {
  if (!raw) return '';
  const token = extractProjectToken(raw);
  if (!token) return '';
  return PROJECT_CODE_ALIASES[token] ?? token;
}

export function projectCodesMatch(a, b) {
  const ca = canonicalizeProjectCode(a);
  const cb = canonicalizeProjectCode(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
