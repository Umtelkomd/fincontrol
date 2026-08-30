/**
 * DATEV Rechnung (pdftotext) — footer pedidos and filename number.
 *
 * Layout assumed (see src/finance/__fixtures__/datev/README.md):
 *
 *   positions …  10-digit presupuesto codes, quantities, amounts
 *   Zwischensumme / USt
 *   Endbetrag        <gross>
 *   footer …         7-digit Insyte Bestellnummern (pedidos), payment terms, bank data
 *
 * Only the text AFTER the LAST `Endbetrag` line is inspected: above it every
 * line is a position whose numbers are presupuestos, quantities or money, and
 * none of those may ever be mistaken for a pedido. A 7-digit run is accepted
 * only when it is not part of a longer digit run (10-digit presupuestos), a
 * date (`24.08.2026`) or a formatted amount (`1.234.567,00`).
 */

const ENDBETRAG_LINE = /^\s*Endbetrag\b/i;
const RECHNUNG_FILENAME = /rechnung[\s_-]*(\d{4}-\d{3})\b/i;
// Exactly seven digits: not preceded by a digit, `.` or `,` (10-digit codes,
// `1.234.567,00`), not followed by a digit (`72195330`, `DE342168532`) nor by
// a decimal separator with a digit (`2640070,00`). A trailing " ." (2025-272)
// is fine because the `.` is not followed by a digit.
const PEDIDO_TOKEN = /(?<![\d.,])(\d{7})(?!\d)(?![.,]\d)/g;
const HEADER_NUMBER = /Rechnungs-Nr\.?:\s*(\d{4}-\d{3})/i;
const SUMME_LINE = /\bSumme:\s*([\d.]+,\d{2})/gi;
const ENDBETRAG_AMOUNT = /\bEndbetrag:\s*([\d.]+,\d{2})/gi;

const germanAmount = (raw) => {
  if (!raw) return null;
  const value = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

const lastMatch = (text, pattern) => {
  let found = null;
  for (const match of text.matchAll(pattern)) found = match[1];
  return found;
};

const lastEndbetragIndex = (lines) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (ENDBETRAG_LINE.test(lines[index])) return index;
  }
  return -1;
};

/**
 * @param {string} text pdftotext output of a DATEV Rechnung
 * @returns {string[]} unique 7-digit pedidos, in order of first appearance,
 *   from the section after the last `Endbetrag` line; `[]` when there is none
 */
export const parseDatevFooterPedidos = (text) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const start = lastEndbetragIndex(lines);
  if (start < 0) return [];

  const footer = lines.slice(start + 1).join('\n');
  const seen = new Set();
  const pedidos = [];
  for (const match of footer.matchAll(PEDIDO_TOKEN)) {
    const pedido = match[1];
    if (seen.has(pedido)) continue;
    seen.add(pedido);
    pedidos.push(pedido);
  }
  return pedidos;
};

/**
 * `Rechnung 2025-270.pdf` → `'2025-270'`; case and separator tolerant.
 * @param {string} filename
 * @returns {string|null}
 */
export const parseDatevRechnungNumber = (filename) => {
  const match = String(filename ?? '').match(RECHNUNG_FILENAME);
  return match ? match[1] : null;
};

/**
 * Header/total lines of a DATEV Rechnung: `Rechnungs-Nr.: 2025-270`,
 * `Summe: 4.358,00` (net), `Endbetrag: 5.186,02` (gross). The LAST Summe and
 * Endbetrag win (a two-page invoice repeats neither, but Übertrag/Vortrag
 * blocks are not totals). Anything absent is null — never inferred.
 *
 * @param {string} text
 * @returns {{ rechnungId: string|null, summe: number|null, endbetrag: number|null }}
 */
export const parseDatevRechnungHeader = (text) => {
  const source = String(text ?? '');
  const number = source.match(HEADER_NUMBER);
  return {
    rechnungId: number ? number[1] : null,
    summe: germanAmount(lastMatch(source, SUMME_LINE)),
    endbetrag: germanAmount(lastMatch(source, ENDBETRAG_AMOUNT)),
  };
};
