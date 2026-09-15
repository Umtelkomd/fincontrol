/**
 * Suggests invoice header fields from PDF-extracted text (see
 * src/lib/pdf/extractPdfText.js for the line-reconstruction adapter).
 *
 * This module PROPOSES, it never decides: every field is a `{ value, line }`
 * suggestion with the exact source line it was read from, or `null` when
 * nothing matched. The human confirms before `validateConfirmedInvoice`
 * (src/finance/invoiceArchive.js) is ever called — that function, not this
 * one, enforces net + tax ≈ gross and every other accounting invariant.
 *
 * Pure: no I/O, no Firebase, no Date.now() (dates are read only from `text`).
 */

const LABEL_GROUPS = {
  invoiceNumber: [
    'Rechnungsnummer',
    'Rechnungs-Nr',
    'Rechnung Nr',
    'Re-Nr',
    'RE-Nr',
    'Invoice No',
    'Invoice Number',
    'Invoice #',
    'Factura Nº',
    'Factura No',
    'Nº de factura',
  ],
  issueDate: ['Rechnungsdatum', 'Datum', 'Invoice Date', 'Date', 'Fecha de factura', 'Fecha'],
  grossAmount: [
    'Gesamtbetrag',
    'Rechnungsbetrag',
    'Bruttobetrag',
    'Brutto',
    'Zahlbetrag',
    'Endbetrag',
    'Total',
    'Gesamt',
    'Importe total',
    'Total a pagar',
  ],
  netAmount: ['Nettobetrag', 'Netto', 'Zwischensumme', 'Subtotal', 'Net', 'Base imponible'],
  taxAmount: ['MwSt', 'USt', 'Umsatzsteuer', 'VAT', 'IVA', 'Mehrwertsteuer'],
};

/** Escape a label for use inside a RegExp. */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a case-insensitive label matcher: the label must start at the
 * beginning of the line or after whitespace, and must not be immediately
 * followed by another letter/digit (so "Total" does not match inside a
 * longer word). A trailing `\b` would fail for labels ending in punctuation
 * such as "Invoice #" or "RE-Nr.", so a lookahead is used instead.
 */
const labelPattern = (label) => new RegExp(`(?:^|\\s)${escapeRegExp(label)}(?![A-Za-z0-9])`, 'i');

const NON_EMPTY_LINES = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Parses a money token in German/English/mixed formats.
 *
 * Heuristic: if both '.' and ',' are present, the LAST separator is the
 * decimal separator. If only one kind of separator is present, exactly 2
 * trailing digits mean decimal, exactly 3 mean thousands.
 *
 * @param {string} token
 * @returns {number|null}
 */
export const parseMoneyToken = (token) => {
  if (typeof token !== 'string') return null;
  let value = token.trim();
  if (!value) return null;

  let negative = false;
  if (value.endsWith('-')) {
    negative = true;
    value = value.slice(0, -1).trim();
  }
  value = value.replace(/^[€]\s*/, '').replace(/\s*(€|EUR)$/i, '');
  value = value.trim();
  if (!value) return null;
  // Non-breaking / thin space used as a thousands separator in some exports.
  value = value.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^-?[0-9.,]+$/.test(value)) return null;

  const hasDot = value.includes('.');
  const hasComma = value.includes(',');
  let normalized;

  if (hasDot && hasComma) {
    const lastDot = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    const decimalIndex = value.lastIndexOf(decimalSeparator);
    const integerPart = value.slice(0, decimalIndex).split(thousandsSeparator).join('');
    const fractionPart = value.slice(decimalIndex + 1);
    if (!/^\d+$/.test(integerPart) || !/^\d+$/.test(fractionPart)) return null;
    normalized = `${integerPart}.${fractionPart}`;
  } else if (hasDot || hasComma) {
    const separator = hasDot ? '.' : ',';
    const parts = value.split(separator);
    if (parts.length !== 2) return null;
    const [integerPart, fractionPart] = parts;
    if (!/^\d*$/.test(integerPart) || !/^\d+$/.test(fractionPart)) return null;
    if (fractionPart.length === 3) {
      // Thousands separator: no fractional part.
      normalized = `${integerPart}${fractionPart}`;
    } else {
      normalized = `${integerPart || '0'}.${fractionPart}`;
    }
  } else {
    if (!/^\d+$/.test(value)) return null;
    normalized = value;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  const signed = negative ? -numeric : numeric;
  return Math.round(signed * 100) / 100;
};

const MONEY_TOKEN_RE = /-?(?:€\s*)?[0-9][0-9.,\s\u00a0\u202f]*(?:\s*(?:€|EUR))?-?/g;

/**
 * Find the first money-looking token after a label match on a line, skipping
 * any token immediately followed by '%' — that is a tax RATE (e.g. the "19"
 * in "VAT 19%: 95.00"), not the amount.
 */
const findMoneyOnLine = (line, label) => {
  const pattern = labelPattern(label);
  const match = pattern.exec(line);
  if (!match) return null;
  const rest = line.slice(match.index + match[0].length);
  const re = new RegExp(MONEY_TOKEN_RE.source, 'g');
  let tokenMatch = re.exec(rest);
  while (tokenMatch) {
    const after = rest.slice(tokenMatch.index + tokenMatch[0].length).trimStart();
    if (!after.startsWith('%')) {
      const value = parseMoneyToken(tokenMatch[0].trim());
      if (value !== null) return value;
    }
    tokenMatch = re.exec(rest);
  }
  return null;
};

/** Extracts a labelled string token (invoice number): [A-Za-z0-9/_.-]+ after the separator. */
const findTokenOnLine = (line, label) => {
  const pattern = labelPattern(label);
  const match = pattern.exec(line);
  if (!match) return null;
  let rest = line.slice(match.index + match[0].length);
  rest = rest.replace(/^[\s:.]+/, '');
  const tokenMatch = /^[A-Za-z0-9/_.-]+/.exec(rest);
  if (!tokenMatch) return null;
  return tokenMatch[0];
};

const DATE_LABEL_RE = (label) => labelPattern(label);

const DATE_TOKEN_RE = /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/;

/** Normalize DD.MM.YYYY / DD/MM/YYYY / YYYY-MM-DD to ISO 'YYYY-MM-DD', or null. */
export const normalizeInvoiceDate = (token) => {
  if (typeof token !== 'string' || !token.trim()) return null;
  const value = token.trim();

  let year;
  let month;
  let day;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    return null;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1000 || year > 9999) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;

  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
};

const findDateOnLine = (line, label) => {
  const pattern = DATE_LABEL_RE(label);
  const match = pattern.exec(line);
  if (!match) return null;
  const rest = line.slice(match.index + match[0].length);
  const tokenMatch = DATE_TOKEN_RE.exec(rest);
  if (!tokenMatch) return null;
  const normalized = normalizeInvoiceDate(tokenMatch[0]);
  return normalized === null ? null : normalized;
};

/** True when a line looks like it carries a labelled field, not free text. */
const isLabelLine = (line) => {
  const allLabels = Object.values(LABEL_GROUPS).flat();
  return allLabels.some((label) => labelPattern(label).test(line));
};

/** True when a line is dominated by a date or money token (best-effort heuristic). */
const isDateOrAmountLine = (line) => {
  if (DATE_TOKEN_RE.test(line)) return true;
  const stripped = line.replace(/[0-9.,\s€EUR%-]+/gi, '').trim();
  return stripped.length === 0;
};

const suggestByLabels = (lines, labels, finder) => {
  for (const label of labels) {
    for (const line of lines) {
      const value = finder(line, label);
      if (value !== null && value !== undefined) {
        return { value, line };
      }
    }
  }
  return null;
};

/** Tax rate (percent) on the same line as a matched tax-amount label. */
const suggestTaxRate = (lines, taxAmountSuggestion) => {
  if (!taxAmountSuggestion) {
    // Still try: a rate may appear on any line even without a resolved tax amount.
    for (const line of lines) {
      const rateMatch = /(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(line);
      if (rateMatch && LABEL_GROUPS.taxAmount.some((label) => labelPattern(label).test(line))) {
        const rate = Number(rateMatch[1].replace(',', '.'));
        if (Number.isFinite(rate)) return { value: rate, line };
      }
    }
    return null;
  }
  const rateMatch = /(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(taxAmountSuggestion.line);
  if (!rateMatch) return null;
  const rate = Number(rateMatch[1].replace(',', '.'));
  if (!Number.isFinite(rate)) return null;
  return { value: rate, line: taxAmountSuggestion.line };
};

const suggestCounterpartyName = (lines) => {
  for (const line of lines) {
    if (isLabelLine(line)) continue;
    if (isDateOrAmountLine(line)) continue;
    return { value: line.slice(0, 80), line };
  }
  return null;
};

const suggestIssueDate = (lines) => {
  const labelled = suggestByLabels(lines, LABEL_GROUPS.issueDate, findDateOnLine);
  if (labelled) return labelled;

  // Fall back to the first date-looking token in the first 15 lines.
  const firstFifteen = lines.slice(0, 15);
  for (const line of firstFifteen) {
    const tokenMatch = DATE_TOKEN_RE.exec(line);
    if (!tokenMatch) continue;
    const normalized = normalizeInvoiceDate(tokenMatch[0]);
    if (normalized !== null) return { value: normalized, line };
  }
  return null;
};

/**
 * Proposes invoice header field suggestions from extracted PDF text.
 *
 * @param {string} text line-reconstructed text (see extractPdfText.js)
 * @param {{ direction?: 'incoming'|'outgoing' }} [options] currently informational
 * @returns {{ suggestions: object, evidence: { lines: string[] } }}
 */
export const suggestInvoiceHeader = (text, { direction } = {}) => {
  void direction; // Not used to alter extraction today; kept for forward compatibility.
  const allLines = NON_EMPTY_LINES(text);
  const evidenceLines = allLines.slice(0, 200);

  const invoiceNumber = suggestByLabels(allLines, LABEL_GROUPS.invoiceNumber, findTokenOnLine);
  const issueDate = suggestIssueDate(allLines);
  const grossAmount = suggestByLabels(allLines, LABEL_GROUPS.grossAmount, findMoneyOnLine);
  const netAmount = suggestByLabels(allLines, LABEL_GROUPS.netAmount, findMoneyOnLine);
  const taxAmount = suggestByLabels(allLines, LABEL_GROUPS.taxAmount, findMoneyOnLine);
  const taxRate = suggestTaxRate(allLines, taxAmount);
  const counterpartyName = suggestCounterpartyName(allLines);

  return {
    suggestions: {
      invoiceNumber,
      issueDate,
      grossAmount,
      netAmount,
      taxAmount,
      taxRate,
      counterpartyName,
    },
    evidence: { lines: evidenceLines },
  };
};
