/**
 * Confirming Abrechnung — bank settlement statement (BBVA, CaixaBank,
 * Santander, Bankinter; `cnf*.pdf`, "Abrechnung Wegen Faktorisierung").
 *
 * It lists the Rechnungen the bank pays in one transfer, the gross it covers,
 * the discount/fee it keeps and the net it actually sends. It is NOT a
 * Rechnung: this parser exposes no rechnungId and nothing here may create a
 * CxC row. Its output feeds `resolveBatchAllocations({ confirmingDiscount })`.
 */

const REF_TOKEN = /\b(?:R-\d{3}|\d{4}-\d{3})\b/g;
const AMOUNT = '(\\d{1,3}(?:\\.\\d{3})*(?:,\\d{2})?|\\d+(?:,\\d{2})?)';
const GROSS_LINE = new RegExp(`(?:brutto(?:betrag)?|gesamt(?:betrag)?|importe\\s+bruto)\\D*${AMOUNT}`, 'i');
const DISCOUNT_LINE = new RegExp(`(?:abzug|diskont|skonto|geb[üu]hr|descuento|comisi[oó]n)\\D*${AMOUNT}`, 'i');
const NET_LINE = new RegExp(`(?:netto(?:betrag)?|auszahlung(?:sbetrag)?|importe\\s+neto|l[ií]quido)\\D*${AMOUNT}`, 'i');

const round = (value) => Math.round(value * 100) / 100;

const parseAmount = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

/**
 * @param {string} text pdftotext output of an Abrechnung / cnf*.pdf
 * @returns {{ rechnungRefs: string[], gross: number|null, discount: number|null, net: number|null }}
 */
export const parseConfirmingAbrechnung = (text) => {
  const source = String(text ?? '');
  const rechnungRefs = [...new Set(source.match(REF_TOKEN) || [])];

  const gross = parseAmount(source, GROSS_LINE);
  const net = parseAmount(source, NET_LINE);
  let discount = parseAmount(source, DISCOUNT_LINE);
  if (discount === null && gross !== null && net !== null) discount = round(gross - net);

  return { rechnungRefs, gross, discount, net };
};
