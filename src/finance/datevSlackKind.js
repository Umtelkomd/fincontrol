/**
 * Classify a file posted to Slack #facturas.
 *
 * Business rule (Jeisson, 30.08.2026): only two kinds are income —
 *   · `insyte_ut`      a DATEV `Rechnung 2025-NNN.pdf` for Insyte (UT/NE3/NE4).
 *                      It groups N Insyte presupuestos and is ATTACHED to their
 *                      rows (rechnungId); it never becomes a CxC row itself.
 *   · `sp_leitungsweg` a B2C Servicepaket Leitungsweg: 1 DATEV = 1 CxC row.
 * Confirming settlements (cnf*.pdf, "Abrechnung Wegen Faktorisierung",
 * BBVA/CaixaBank/Santander/Bankinter), HKL, diesel, FeWo and Korrektur/Storno
 * are not income and must never create a receivable.
 */
import { parseDatevRechnungNumber } from './datevRechnungFooter.js';

export const SLACK_KINDS = Object.freeze({
  INSYTE_UT: 'insyte_ut',
  SP_LEITUNGSWEG: 'sp_leitungsweg',
  FEWO: 'fewo',
  CONFIRMING: 'confirming',
  KORREKTUR: 'korrektur',
  OTRO: 'otro',
});

const INCOME_KINDS = new Set([SLACK_KINDS.INSYTE_UT, SLACK_KINDS.SP_LEITUNGSWEG]);

const CONFIRMING_FILENAME = /^cnf/i;
const CONFIRMING_TEXT = /confirming|bankinter|caixabank|bbva|santander|abrechnung\s+wegen\s+faktorisierung/i;
const OTRO_TEXT = /\bhkl\b|diesel/i;
const FEWO_TEXT = /\bfewo\b/i;
const KORREKTUR_TEXT = /korrektur|storno/i;
const SP_TEXT = /leitungsweg|(^|[\s_-])sp[\s_-]/i;
const INSYTE_CAPTION = /insyte|\but\b|\bne3\b|\bne4\b/i;

/**
 * @param {{ filename?: string, caption?: string }} [file]
 * @returns {'insyte_ut'|'sp_leitungsweg'|'fewo'|'confirming'|'korrektur'|'otro'}
 */
export const classifyDatevSlackFile = ({ filename = '', caption = '' } = {}) => {
  const name = String(filename ?? '').trim();
  const text = `${name} ${String(caption ?? '')}`;

  if (CONFIRMING_FILENAME.test(name) || CONFIRMING_TEXT.test(text)) return SLACK_KINDS.CONFIRMING;
  if (OTRO_TEXT.test(text)) return SLACK_KINDS.OTRO;
  if (FEWO_TEXT.test(text)) return SLACK_KINDS.FEWO;
  if (KORREKTUR_TEXT.test(text)) return SLACK_KINDS.KORREKTUR;
  if (SP_TEXT.test(text)) return SLACK_KINDS.SP_LEITUNGSWEG;
  if (parseDatevRechnungNumber(name) && INSYTE_CAPTION.test(String(caption ?? ''))) {
    return SLACK_KINDS.INSYTE_UT;
  }
  return SLACK_KINDS.OTRO;
};

/** Only these kinds may ever be income. */
export const isIncomeKind = (kind) => INCOME_KINDS.has(kind);

const parseEuro = (raw) => {
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

/**
 * Loose reading of a Slack caption. Every field is null when absent; the euro
 * amount is NEVER filled in from anywhere else — a caption is not an invoice.
 *
 * @param {string} [caption]
 * @returns {{ datev: string|null, kw: string|null, obra: string|null, tier: 'NE3'|'NE4'|null, euro: number|null }}
 */
export const parseSlackCaption = (caption = '') => {
  const text = String(caption ?? '');
  const datev = text.match(/\b(\d{4}-\d{3})\b/);
  const kw = text.match(/\bKW\s*(\d{1,2})\b/i);
  const tier = text.match(/\b(NE3|NE4)\b/i);
  const euro = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:,\d{2}))\s*(?:€|eur)/i);
  // The obra is the first capitalised word that is not one of the known tokens.
  const obra = text
    .replace(/\b(\d{4}-\d{3})\b/g, ' ')
    .replace(/\bKW\s*\d{1,2}\b/gi, ' ')
    .replace(/\b(NE3|NE4|Rechnung|Insyte|UT)\b/gi, ' ')
    .match(/\b\p{Lu}[\p{L}ß-]{2,}\b/u);

  return {
    datev: datev ? datev[1] : null,
    kw: kw ? `KW${kw[1]}` : null,
    obra: obra ? obra[0] : null,
    tier: tier ? tier[1].toUpperCase() : null,
    euro: euro ? parseEuro(euro[1]) : null,
  };
};

/**
 * Guard for scripts/add-cxc-from-slack.cjs: a Slack-sourced CxC row is only
 * allowed for a B2C Servicepaket Leitungsweg. Throws with the reason otherwise.
 *
 * @param {{ documentNumber?: string, kind?: string, filename?: string, caption?: string }} entry
 * @returns {'sp_leitungsweg'} the accepted kind
 */
export const assertSlackCxcAllowed = (entry = {}) => {
  const kind = entry.kind || classifyDatevSlackFile({ filename: entry.filename, caption: entry.caption });
  if (kind === SLACK_KINDS.SP_LEITUNGSWEG) return kind;
  const label = entry.documentNumber || entry.filename || 'entrada sin documento';
  const why =
    kind === SLACK_KINDS.INSYTE_UT
      ? 'una Rechnung Insyte UT se adjunta a sus presupuestos (rechnungId), nunca crea una CxC'
      : isIncomeKind(kind)
        ? 'solo un Servicepaket Leitungsweg (B2C) puede crear una CxC desde Slack'
        : 'no es ingreso y nunca crea una CxC';
  throw new Error(`CxC rechazada para ${label}: kind "${kind}" — ${why}`);
};
