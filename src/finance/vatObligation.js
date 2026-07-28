/**
 * VAT (Umsatzsteuer) obligation derived from the ledger.
 *
 * Until now the forecast read the monthly VAT figure from
 * `settings/treasury.vatEstimates` — a number a human types once per month.
 * That document is empty in production, so every projection silently assumed
 * the company owes no VAT, which is never true: the Voranmeldung leaves the
 * bank on the 10th of M+2 whether or not anybody typed it.
 *
 * This module derives the figure instead, from what the ledger already knows:
 *
 *   output VAT (repercutido)  invoices ISSUED — accrual, per German
 *                             Soll-Versteuerung: VAT is owed the month the
 *                             invoice is dated, not the month it is collected.
 *   input VAT (soportado)     money that actually LEFT the bank, at the rate of
 *                             the movement's category (settings/vatRates).
 *   net                       output − input; positive means "pay the
 *                             Finanzamt", negative means a refund is due.
 *
 * ── Why the two sides use different bases (and why that is not a bug) ────────
 * Mixing them is exactly how a figure gets counted twice. Sales are counted
 * ONCE, when invoiced; the collection movement that later settles that invoice
 * is never scanned for output VAT, so no invoice can be counted both as a
 * document and as cash. Purchases are counted ONCE, when paid; payables are
 * never scanned, so no supplier invoice can be counted both as a document and
 * as cash either. Each euro therefore has exactly one home.
 *
 * ── Coverage: this is a floor, not a total ──────────────────────────────────
 * Roughly a quarter of the bank movements still carry no category, and a
 * movement with no category has no rate — which this codebase deliberately
 * reads as "nobody decided this yet" (rate 0), never as 19%. Every month
 * therefore reports `coverage`: the share of the amounts behind it whose rate
 * was actually known. A month at 0.73 coverage is a number the real VAT bill
 * will exceed, and the UI has to say so out loud.
 */

import { isInternalTransfer, signedAmountOf } from '../lib/finance/movementAmount';
import { vatDueDate } from '../lib/finance/fiscalCalendar';
import { resolveVatRate, VAT_RATE_SOURCE, vatFromGross } from './vatRates';

/**
 * The German filing calendar is NOT reimplemented here: `vatDueDate` in
 * lib/finance/fiscalCalendar.js already encodes "10th of M+2" for this company
 * (Dauerfristverlängerung) and already shifts weekends and bank holidays
 * forward through `nextBankBusinessDay` in lib/finance/bankingDays.js — which
 * knows the Mecklenburg-Vorpommern holidays and the Dec 24 / Dec 31 bank
 * closures. Re-exported so consumers of this module get the same answer the
 * obligations calendar uses.
 */
export { vatDueDate };

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Invoice statuses that mean "this was never a sale". */
const VOID_DOCUMENT_STATUSES = new Set(['cancelled', 'void']);

/** A voided bank movement never happened, so it deducts no input VAT. */
const VOID_MOVEMENT_STATUS = 'void';

/**
 * Wages carry no VAT, and they are big: leaving them in would not change the
 * VAT (their rate is 0) but would inflate `coverage` with amounts that were
 * never in question. Bank movements carry no payroll marker of their own in
 * this ledger — 0 of 1576 have `payrollPeriodId` or `employeeIds` — so the
 * category is the usable signal, with the markers checked defensively.
 */
const PAYROLL_CATEGORIES = new Set(['salarios', 'nomina', 'nómina']);

const round2 = (value) => Math.round(value * 100) / 100;

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * The source document behind a record. Ledger-adapted docs (see
 * `src/finance/adapters.js`) materialize `taxRate`/`taxAmount` defaults of 0 on
 * every row, so reading them off the adapted shape would turn "unknown" into an
 * explicit "no VAT". The raw Firestore doc is the only authority on what was
 * actually stored — the same rule `storedRateOf` follows in vatRates.js.
 */
const sourceOf = (record) => (record?.raw && typeof record.raw === 'object' ? record.raw : record);

const grossOf = (record) => {
  const source = sourceOf(record);
  const gross =
    toFiniteNumber(record?.grossAmount) ??
    toFiniteNumber(source?.grossAmount) ??
    toFiniteNumber(source?.amount) ??
    0;
  return Math.abs(gross);
};

const categoryNameOf = (record) => {
  const source = sourceOf(record);
  const name = record?.categoryName || record?.category || source?.categoryName || source?.category;
  return typeof name === 'string' ? name.trim() : '';
};

/** Category rate lookup, with the record's own stored rate winning. */
const rateOf = (record, categoryRates) =>
  resolveVatRate({
    movement: { ...record, categoryName: categoryNameOf(record) },
    categoryRates,
  });

const monthKeyOf = (isoDate) =>
  typeof isoDate === 'string' && ISO_DATE_RE.test(isoDate) ? isoDate.slice(0, 7) : '';

const issueDateOf = (doc) => {
  const source = sourceOf(doc);
  const date = doc?.issueDate || source?.issueDate || source?.date;
  return typeof date === 'string' ? date.slice(0, 10) : '';
};

const isPayrollMovement = (movement) => {
  const source = sourceOf(movement);
  if (source?.payrollPeriodId) return true;
  if (Array.isArray(source?.employeeIds) && source.employeeIds.length > 0) return true;
  return PAYROLL_CATEGORIES.has(categoryNameOf(movement).toLowerCase());
};

/**
 * Does this movement settle (or refund) a sales invoice?
 *
 * Such a movement is the cash leg of something the output side already counted
 * on its issue date. Counting it again — as revenue on the way in, or as a
 * purchase on the way out — is the double count this module exists to avoid.
 * The link itself is the signal: whether or not that invoice is inside the
 * `receivables` array handed in, its VAT belongs to its issue month, never to
 * the month the bank moved.
 */
const settlesReceivable = (movement) => {
  const source = sourceOf(movement);
  if (movement?.receivableId || source?.receivableId) return true;
  const ids = movement?.receivableIds || source?.receivableIds;
  return Array.isArray(ids) && ids.length > 0;
};

/**
 * VAT contained in one record, plus whether the rate behind it was known.
 *
 * An explicitly stated tax amount wins over anything derived — a receivable
 * created through the CXC form carries `taxAmount` computed from the amounts
 * the user actually typed. A stored 0 is NOT taken as authoritative (it is what
 * an absent field reads back as); that case falls through to the rate, which
 * knows the difference between a configured 0 and an unset one.
 */
const vatOf = (record, categoryRates) => {
  const gross = grossOf(record);
  const stated = toFiniteNumber(sourceOf(record)?.taxAmount);
  if (stated !== null && stated !== 0) {
    return { gross, vat: round2(Math.abs(stated)), known: true };
  }

  const { rate, source } = rateOf(record, categoryRates);
  return { gross, vat: vatFromGross(gross, rate), known: source !== VAT_RATE_SOURCE.UNSET };
};

/**
 * @typedef {Object} VatMonth
 * @property {string} month - 'YYYY-MM' the VAT belongs to
 * @property {number} outputVat - VAT charged on invoices issued that month
 * @property {number} inputVat - VAT paid on money that left the bank that month
 * @property {number} net - outputVat − inputVat; > 0 means the company pays
 * @property {number} coverage - 0..1 share of the month's amounts with a known rate
 * @property {number} knownAmount - gross behind the covered share
 * @property {number} totalAmount - gross considered for the month
 * @property {string|null} dueDate - filing date, 10th of M+2, banking-day shifted
 */

/**
 * Derive the VAT position of every calendar month the data covers.
 *
 * @param {{
 *   movements?: Object[],
 *   receivables?: Object[],
 *   categoryRates?: Record<string, number>,
 *   today: string,
 * }} params - `today` bounds the data: nothing dated after it exists yet.
 * @returns {VatMonth[]} ascending by month; months with no data are absent.
 */
export const computeVatByMonth = ({ movements = [], receivables = [], categoryRates = {}, today } = {}) => {
  const buckets = new Map();

  const bucketFor = (month) => {
    if (!buckets.has(month)) {
      buckets.set(month, { month, outputVat: 0, inputVat: 0, knownAmount: 0, totalAmount: 0 });
    }
    return buckets.get(month);
  };

  // ── output VAT: invoices issued (accrual) ─────────────────────────────────
  for (const doc of Array.isArray(receivables) ? receivables : []) {
    if (VOID_DOCUMENT_STATUSES.has(doc?.status)) continue;
    const issueDate = issueDateOf(doc);
    if (!issueDate || (today && issueDate > today)) continue;
    const month = monthKeyOf(issueDate);
    if (!month) continue;

    const { gross, vat, known } = vatOf(doc, categoryRates);
    if (gross === 0) continue;
    const bucket = bucketFor(month);
    bucket.outputVat += vat;
    bucket.totalAmount += gross;
    if (known) bucket.knownAmount += gross;
  }

  // ── input VAT: money that left the bank ───────────────────────────────────
  for (const movement of Array.isArray(movements) ? movements : []) {
    // Only outflows: an inbound movement is either a collection of an invoice
    // already counted above, or income this module has no invoice for. Neither
    // may add output VAT here.
    if (signedAmountOf(movement) >= 0) continue;
    if (movement?.status === VOID_MOVEMENT_STATUS) continue;
    if (isInternalTransfer(movement)) continue;
    if (isPayrollMovement(movement)) continue;
    if (settlesReceivable(movement)) continue;

    const postedDate = typeof movement?.postedDate === 'string' ? movement.postedDate.slice(0, 10) : '';
    if (!postedDate || (today && postedDate > today)) continue;
    const month = monthKeyOf(postedDate);
    if (!month) continue;

    const { gross, vat, known } = vatOf(movement, categoryRates);
    if (gross === 0) continue;
    const bucket = bucketFor(month);
    bucket.inputVat += vat;
    bucket.totalAmount += gross;
    if (known) bucket.knownAmount += gross;
  }

  return [...buckets.values()]
    .map((bucket) => {
      const outputVat = round2(bucket.outputVat);
      const inputVat = round2(bucket.inputVat);
      const totalAmount = round2(bucket.totalAmount);
      const knownAmount = round2(bucket.knownAmount);
      return {
        month: bucket.month,
        outputVat,
        inputVat,
        net: round2(outputVat - inputVat),
        coverage: totalAmount > 0 ? knownAmount / totalAmount : 1,
        knownAmount,
        totalAmount,
        dueDate: vatDueDate(bucket.month),
      };
    })
    .sort((left, right) => left.month.localeCompare(right.month));
};

/**
 * @typedef {Object} VatEstimateEntry
 * @property {string} month
 * @property {number} amount - positive magnitude the forecast will pay out
 * @property {string|null} dueDate
 * @property {'manual'|'derived'} source
 * @property {number|null} coverage - null for manual entries (a human owns them)
 * @property {number} [knownAmount] - gross behind the covered share (derived only)
 * @property {number} [totalAmount] - gross considered for the month (derived only)
 * @property {number} [outputVat]
 * @property {number} [inputVat]
 */

/**
 * The VAT estimates the forecast should use.
 *
 * PRECEDENCE: a manually entered month always wins, including a manual 0 —
 * a human who typed a number made a decision, and a computed figure does not
 * get to overrule it. Derived months only fill the gaps.
 *
 * Two derived months are deliberately dropped:
 *   - net ≤ 0: a refund is not an outflow, and this app has no mechanism to
 *     project an incoming Finanzamt payment. Silence beats a wrong sign.
 *   - already past its filing date: that money either left the bank (so it is
 *     already inside the reconciliation anchor the forecast starts from) or is
 *     a late filing nobody can prove from this data. Projecting it would
 *     double-count against today's cash. Manual entries keep their existing
 *     behavior — they stay listed until the owner removes them.
 *
 * @param {{
 *   movements?: Object[],
 *   receivables?: Object[],
 *   categoryRates?: Record<string, number>,
 *   today: string,
 *   vatEstimates?: Array<{ month: string, amount: number }>,
 * }} params
 * @returns {VatEstimateEntry[]} ascending by month
 */
export const buildVatEstimates = ({
  movements = [],
  receivables = [],
  categoryRates = {},
  today,
  vatEstimates = [],
} = {}) => {
  const manual = [];
  const manualMonths = new Set();

  for (const estimate of Array.isArray(vatEstimates) ? vatEstimates : []) {
    const month = typeof estimate?.month === 'string' ? estimate.month : '';
    if (!MONTH_KEY_RE.test(month) || manualMonths.has(month)) continue;
    const amount = toFiniteNumber(estimate?.amount);
    if (amount === null) continue;
    manualMonths.add(month);
    manual.push({
      month,
      amount,
      dueDate: vatDueDate(month),
      source: 'manual',
      coverage: null,
    });
  }

  const derived = computeVatByMonth({ movements, receivables, categoryRates, today })
    .filter((row) => !manualMonths.has(row.month))
    .filter((row) => row.net > 0)
    .filter((row) => row.dueDate && (!today || row.dueDate >= today))
    .map((row) => ({
      month: row.month,
      amount: row.net,
      dueDate: row.dueDate,
      source: 'derived',
      coverage: row.coverage,
      // The weights behind `coverage`, so a screen listing several months can
      // aggregate by amount instead of averaging percentages.
      knownAmount: row.knownAmount,
      totalAmount: row.totalAmount,
      outputVat: row.outputVat,
      inputVat: row.inputVat,
    }));

  return [...manual, ...derived].sort((left, right) => left.month.localeCompare(right.month));
};

export default computeVatByMonth;
