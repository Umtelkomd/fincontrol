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
