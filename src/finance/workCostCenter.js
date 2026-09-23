/**
 * Work → cost center: which production line a piece of text describes.
 *
 * Insyte invoices and certificates name the work with article codes
 * (DGF_ACT_001 "HÜP-GFTA-ONT, FUSION + ACTIVAC.", DGF_BLOW_002 "SOPLADO",
 * WESTC_MDU_100 "STANDARD AUSBAU", NAS_DGF "Kopflöcher Einblasen", …) or with
 * a reference such as "KW31_BDRIB-KERN_Umtelkomd_NE4 Reklamation". Reading
 * those gives each receivable/payable its production line without anyone
 * classifying it by hand.
 *
 * Returns a single code only when the text points to ONE line; a text that
 * mixes lines (an invoice with blowing and activation positions) returns ''
 * with the candidates, and the caller asks a human — never a guess.
 *
 * Pure: no I/O.
 */

// Token boundaries that treat "_" as a separator ("…_Umtelkomd_NE4"), which
// the regex \b does not. `word('NE4')` matches NE4 as a whole token only.
const B = '(?<![A-Z0-9ÄÖÜ])';
const E = '(?![A-Z0-9ÄÖÜ])';
const word = (token) => `${B}${token}${E}`;
const rule = (code, family, ...alternatives) => ({ code, family, pattern: new RegExp(alternatives.join('|')) });

const RULES = [
  // A claim/rework certificate is a repair, whatever work it re-does.
  rule('CC-160', 'repair', word('REKLAMATION'), `${B}REPARA`, word('AVER[IÍ]A'), `${B}INCIDEN`, word('ST[ÖO]RUNG'), word('NACHBESSERUNG')),
  rule('CC-150', 'survey', word('HBG'), 'BEGEHUNG', `_350${E}`),
  rule('CC-115', 'activation', 'DGF_ACT', 'H[ÜU]E?P[-\\s]?GFTA', `${B}ACTIVAC`, `${B}AKTIVIERUNG`),
  rule('CC-110', 'deployment', 'DGF_BLOW', `${B}SOPLAD`, `${B}BLOW`, 'MONTAJE DP', word('POP'), 'BANDEJA'),
  rule('CC-140', 'connection', word('NAS'), 'NAS_', 'HAUSANSCHLUSS', 'KOPFL[ÖO]CH', word('HAS\\d?'), 'ACOMETIDA'),
  rule('CC-120', 'ne4', 'WESTC_MDU', word('NE4'), word('MDU'), 'ONT[-\\s]?MONTAGE', 'AUSBAU EINER WOHN'),
  rule('CC-100', 'civil', 'TIEFBAU', 'OBRA CIVIL', 'ZANJA', 'GRABEN', 'ERDARBEIT'),
  rule('CC-190', 'supervision', 'AUFMA(SS|ß)', 'DOKUMENTATION', 'BAULEITUNG', 'DIRECCI[OÓ]N DE OBRA'),
];

const normalize = (text) => String(text ?? '').toUpperCase().replace(/\s+/g, ' ');

/**
 * @param {...string} texts description, referenciaObra, notes, line items…
 * @returns {{ code: string, candidates: string[] }}
 */
export const costCenterForWork = (...texts) => {
  const text = normalize(texts.filter(Boolean).join(' | '));
  if (!text.trim()) return { code: '', candidates: [] };

  const matched = RULES.filter((rule) => rule.pattern.test(text));
  if (matched.some((rule) => rule.family === 'repair')) return { code: 'CC-160', candidates: ['CC-160'] };

  const candidates = [...new Set(matched.map((rule) => rule.code))];
  // A first survey ("Erstbegehung") inside an NE4 install is part of that install.
  const effective = candidates.includes('CC-120') ? candidates.filter((code) => code !== 'CC-150') : candidates;
  return { code: effective.length === 1 ? effective[0] : '', candidates: effective };
};
