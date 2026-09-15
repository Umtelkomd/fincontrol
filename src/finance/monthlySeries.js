/**
 * Monthly cash/invoicing series for charts and dashboards.
 *
 * `cobrado`/`pagado`/`neto` reuse `summarizeMovements` (see reporting.js) so
 * internal transfers stay excluded and movements imported before May 2026
 * (no usable `signedAmount`) still work — `summarizeMovements` only reads
 * `direction` and `amount`, never `signedAmount`.
 *
 * `facturado`/`recibido` are invoice-issued totals from receivables/payables,
 * independent of cash — an invoice issued this month may be collected/paid in
 * a later one.
 *
 * Pure: no Firebase, no I/O.
 */
import { SHORT_MONTH_NAMES, summarizeMovements } from './reporting';

const pad2 = (n) => String(n).padStart(2, '0');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * 'YYYY-MM' month key of an ISO-ish date string, or null when the date is
 * missing, malformed, or an impossible calendar date.
 *
 * @param {string} isoDate
 * @returns {string|null}
 */
export const monthKeyOf = (isoDate) => {
  if (typeof isoDate !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${match[1]}-${match[2]}`;
};

const CANCELLED_STATUSES = new Set(['cancelled', 'cancelada', 'anulada']);

const isCancelled = (row) => CANCELLED_STATUSES.has(String(row?.status || '').toLowerCase());

/** Sum of grossAmount (fallback amount) for rows issued in the given month key. */
const sumIssuedInMonth = (rows, key) =>
  round2(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => !isCancelled(row) && monthKeyOf(row?.issueDate) === key)
      .reduce((sum, row) => sum + (Number(row.grossAmount ?? row.amount) || 0), 0),
  );

/** The { year, month(0-indexed) } the window anchors on. Defaults to today. */
const resolveAnchorMonth = (referenceDate) => {
  if (referenceDate instanceof Date) {
    if (Number.isNaN(referenceDate.getTime())) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    }
    return { year: referenceDate.getFullYear(), month: referenceDate.getMonth() };
  }
  if (typeof referenceDate === 'string') {
    const match = /^(\d{4})-(\d{2})/.exec(referenceDate);
    if (match) return { year: Number(match[1]), month: Number(match[2]) - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
};

/**
 * Builds the monthly series ending at `referenceDate` (default: today),
 * oldest month first.
 *
 * @param {{
 *   movements?: Array<object>,
 *   receivables?: Array<object>,
 *   payables?: Array<object>,
 *   months?: number,
 *   referenceDate?: string|Date,
 * }} [options]
 * @returns {Array<{key:string,label:string,cobrado:number,pagado:number,neto:number,facturado:number,recibido:number}>}
 */
export const buildMonthlySeries = ({
  movements = [],
  receivables = [],
  payables = [],
  months = 12,
  referenceDate,
} = {}) => {
  const anchor = resolveAnchorMonth(referenceDate);
  const count = Number.isSafeInteger(months) && months > 0 ? months : 12;

  const monthList = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const totalMonths = anchor.year * 12 + anchor.month - i;
    const year = Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    monthList.push({ year, month });
  }

  const safeMovements = Array.isArray(movements) ? movements : [];

  return monthList.map(({ year, month }) => {
    const key = `${year}-${pad2(month + 1)}`;
    const monthMovements = safeMovements.filter((movement) => monthKeyOf(movement?.postedDate) === key);
    const { inflows, outflows, net } = summarizeMovements(monthMovements);
    return {
      key,
      label: `${SHORT_MONTH_NAMES[month]} ${pad2(year % 100)}`,
      cobrado: round2(inflows),
      pagado: round2(outflows),
      neto: round2(net),
      facturado: sumIssuedInMonth(receivables, key),
      recibido: sumIssuedInMonth(payables, key),
    };
  });
};
