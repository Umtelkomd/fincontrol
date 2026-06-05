/**
 * DATEV payroll PDF parser — pure functions, no pdfjs/Firebase imports.
 *
 * Works on TEXT already extracted from the DATEV PDFs (see extractPdfText.js).
 * Each DATEV report is a fixed form identified by its filename prefix:
 *   zakf — Übersicht Zahlungen (payment summary: the 6 obligations + totals)
 *   lojo — Lohnjournal (per-employee net / Auszahlungsbetrag)
 *   lops — Personalkostenübersicht (per-employee gross + employer cost)
 *   lsta — Lohnsteuer-Anmeldung (tax detail; not parsed for v1)
 *   kbnw — Beitragsnachweis (KK detail; not parsed for v1)
 *
 * DATEV amount formats:
 *   comma  — "7.721,08"  → 7721.08  (dot = thousands, comma = decimal)
 *   compact— "4.47023"   → 4470.23  (digits only, last 2 are cents)
 */

import { resolvePayrollDueDates } from './payrollDueDates.js';

const GERMAN_MONTHS = [
  'januar', 'februar', 'märz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember',
];

const KNOWN_TYPES = ['zakf', 'lojo', 'lops', 'lsta', 'kbnw'];

/** Classify a DATEV file by its filename prefix. */
export const classifyPayrollPdf = (fileName) => {
  const prefix = String(fileName || '').toLowerCase().split(/[_./\\ ]/)[0];
  return KNOWN_TYPES.includes(prefix) ? prefix : 'unknown';
};

/** "7.721,08" → 7721.08 */
export const parseAmountComma = (str) => {
  if (str == null) return 0;
  const cleaned = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** "4.47023" → 4470.23, "78266" → 782.66 (last 2 digits are cents) */
export const parseAmountCompact = (str) => {
  if (str == null) return 0;
  const digits = String(str).replace(/[^\d]/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
};

/** Find a German month + year anywhere in the text → "YYYY-MM". */
export const parseGermanPeriod = (text) => {
  const monthAlt = GERMAN_MONTHS.join('|');
  const re = new RegExp(`(${monthAlt})\\s+(\\d{4})`, 'i');
  const m = String(text || '').match(re);
  if (!m) return '';
  const idx = GERMAN_MONTHS.indexOf(m[1].toLowerCase());
  if (idx < 0) return '';
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
};

/** "28.04.2026" → "2026-04-28" */
const parseGermanDate = (str) => {
  const m = String(str || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const cleanTaxPayee = (raw) => {
  // "FA Stralsund 18409 Stralsund" → "Finanzamt Stralsund"
  const beforePlz = String(raw).replace(/\s+\d{5}\b.*$/, '').trim();
  return beforePlz.replace(/^FA\b/, 'Finanzamt').trim();
};

/**
 * Parse the zakf payment summary into the 6 obligations + period.
 * @returns {{ period, krankenkassen:[{payee,amount,dueDate}], tax:{payee,amount,dueDate}, netWages:{amount,dueDate} }}
 */
export const parseZakf = (text) => {
  const lines = String(text || '').split('\n');
  const period = parseGermanPeriod(text);
  const krankenkassen = [];
  let kkDueDate = null;
  let tax = null;
  let netWages = 0;

  for (const raw of lines) {
    const line = raw.trim();

    // Krankenkasse: "001 EK BARMER Lastschrift 83531045 7.721,08"
    const kk = line.match(/^(\d{3})\s+(.+?)\s+Lastschrift\s+\S+\s+([\d.]+,\d{2})/);
    if (kk) {
      krankenkassen.push({ payee: kk[2].trim(), amount: parseAmountComma(kk[3]) });
      continue;
    }

    // Lohnsteuer / Finanzamt: "4082 FA Stralsund ... Überweisung LSt 04/2026 ... 3.742,93"
    if (!tax && /Überweisung/.test(line) && /LSt|Lohnsteuer/i.test(line)) {
      const fa = line.match(/^\d{3,4}\s+(.+?)\s+Überweisung\b.*?([\d.]+,\d{2})\s*\*?\s*$/);
      if (fa) {
        tax = { payee: cleanTaxPayee(fa[1]), amount: parseAmountComma(fa[2]), dueDate: null };
        continue;
      }
    }

    // Due dates: first Fälligkeit (before tax) → KK; next (after tax) → tax
    const fal = line.match(/Fälligkeit bis:\s*(\d{2}\.\d{2}\.\d{4})/);
    if (fal) {
      const iso = parseGermanDate(fal[1]);
      if (!tax && !kkDueDate) kkDueDate = iso;
      else if (tax && !tax.dueDate) tax.dueDate = iso;
      continue;
    }

    // Net wages: "Lohn- und Gehaltszahlungen 21.065,46 *"
    const nw = line.match(/Lohn-\s*und\s*Gehaltszahlungen\s+([\d.]+,\d{2})/);
    if (nw) {
      netWages = parseAmountComma(nw[1]);
      continue;
    }
  }

  return {
    period,
    krankenkassen: krankenkassen.map((k) => ({ ...k, dueDate: kkDueDate })),
    tax: tax || { payee: 'Finanzamt', amount: 0, dueDate: null },
    netWages: { amount: netWages, dueDate: null },
  };
};

/**
 * Parse the lops Personalkostenübersicht → per-employee gross + employer cost.
 * @returns {Array<{persNr, name, brutto, gesamtkosten}>}
 */
export const parseLops = (text) => {
  const lines = String(text || '').split('\n');
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    // "00001 Lesmes Linares, J. 3.66667 78266 2090 4.47023"
    const m = line.match(/^(\d{5})\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/);
    if (m) {
      rows.push({
        persNr: m[1],
        name: m[2].trim(),
        brutto: parseAmountCompact(m[3]),
        gesamtkosten: parseAmountCompact(m[6]),
      });
    }
  }
  return rows;
};

/**
 * Parse the lojo Lohnjournal → map of personnel number to net pay.
 * Net (Auszahlungsbetrag) is the last token of the employee's BGRS "01111" line.
 * @returns {Object<string, number>} persNr → netto
 */
export const parseLojo = (text) => {
  const lines = String(text || '').split('\n');
  const map = {};
  let currentPersNr = null;
  for (const raw of lines) {
    const line = raw.trim();

    // BGRS line FIRST — "01111" is itself 5 digits, must not be read as a Pers.-Nr.
    if (/^0?1111\b/.test(line)) {
      const m = line.match(/(\d\.\d{5})\s*$/);
      if (m && currentPersNr) map[currentPersNr] = parseAmountCompact(m[1]);
      continue;
    }

    // Employee block start — 5-digit Pers.-Nr. followed by Steuerklasse digit
    const start = line.match(/^(\d{5})\s+\d/);
    if (start) {
      currentPersNr = start[1];
    }
  }
  return map;
};

/**
 * Merge the parsed DATEV texts into the payroll form structure consumed by
 * useNominas.loadPayrollPeriod / computePayrollTotals.
 *
 * @param {{ zakf?: string, lojo?: string, lops?: string }} texts
 * @returns {{ period, krankenkassen, tax, netWages, lines }}
 */
export const buildPayrollFromTexts = ({ zakf, lojo, lops } = {}) => {
  const base = zakf
    ? parseZakf(zakf)
    : { period: '', krankenkassen: [], tax: { payee: 'Finanzamt', amount: 0, dueDate: null }, netWages: { amount: 0, dueDate: null } };

  const lopsRows = lops ? parseLops(lops) : [];
  const nettoByPers = lojo ? parseLojo(lojo) : {};

  const lines = lopsRows.map((r) => ({
    employeeId: '',
    persNr: r.persNr,
    name: r.name,
    netto: nettoByPers[r.persNr] ?? 0,
    brutto: r.brutto,
    gesamtkosten: r.gesamtkosten,
  }));

  // Phase 2, item 1 — stamp correct German due dates. Prefer the parsed
  // Fälligkeit (kkDueDate / tax.dueDate) and only compute the gaps
  // (net-wages transfer date always; KK/LSt only when the PDF carried none).
  const due = resolvePayrollDueDates({ period: base.period, parsed: base });

  return {
    ...base,
    krankenkassen: base.krankenkassen.map((k) => ({ ...k, dueDate: k.dueDate || due.kk })),
    tax: { ...base.tax, dueDate: base.tax.dueDate || due.tax },
    netWages: { ...base.netWages, dueDate: base.netWages.dueDate || due.netWages },
    lines,
  };
};
