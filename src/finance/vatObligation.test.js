import { describe, expect, it } from 'vitest';
import { buildVatEstimates, computeVatByMonth, vatDueDate } from './vatObligation';

const TODAY = '2026-07-09';

/** Category rates as the owner configured them in settings/vatRates. */
const RATES = {
  Servicios: 0.19,
  Materiales: 0.19,
  Subcontratos: 0, // §13b reverse charge — the customer owes the VAT
  Salarios: 0,
  Impuestos: 0,
};

const receivable = (issueDate, amount, extra = {}) => ({
  id: `r-${issueDate}-${amount}`,
  issueDate,
  amount,
  status: 'issued',
  counterpartyName: 'Client A',
  ...extra,
});

const movement = (postedDate, amount, extra = {}) => ({
  id: `m-${postedDate}-${amount}`,
  postedDate,
  amount: Math.abs(amount),
  direction: amount < 0 ? 'out' : 'in',
  signedAmount: amount,
  status: 'posted',
  kind: amount < 0 ? 'payment' : 'collection',
  counterpartyName: 'Vendor B',
  ...extra,
});

const run = (overrides = {}) =>
  computeVatByMonth({
    movements: [],
    receivables: [],
    categoryRates: RATES,
    today: TODAY,
    ...overrides,
  });

const monthOf = (rows, month) => rows.find((row) => row.month === month);

// ─── output VAT: invoices issued ──────────────────────────────────────────────

describe('computeVatByMonth output VAT', () => {
  it('derives output VAT from the invoice rate, in the month it was issued', () => {
    const rows = run({ receivables: [receivable('2026-05-20', 11900, { taxRate: 0.19 })] });

    expect(rows).toHaveLength(1);
    expect(monthOf(rows, '2026-05')).toMatchObject({
      month: '2026-05',
      outputVat: 1900,
      inputVat: 0,
      net: 1900,
      coverage: 1,
    });
  });

  it('prefers the tax amount the invoice states over any derived figure', () => {
    const rows = run({
      receivables: [receivable('2026-05-20', 11900, { taxRate: 0.19, taxAmount: 1850.5 })],
    });

    expect(monthOf(rows, '2026-05').outputVat).toBe(1850.5);
  });

  it('counts VAT on an invoice already settled — VAT is owed on issue, not on collection', () => {
    const rows = run({
      receivables: [receivable('2026-05-20', 11900, { taxRate: 0.19, status: 'settled' })],
    });

    expect(monthOf(rows, '2026-05').outputVat).toBe(1900);
  });

  it('ignores cancelled invoices', () => {
    const rows = run({
      receivables: [receivable('2026-05-20', 11900, { taxRate: 0.19, status: 'cancelled' })],
    });

    expect(rows).toHaveLength(0);
  });

  it('falls back to the category rate when the invoice carries no rate of its own', () => {
    const rows = run({
      receivables: [receivable('2026-05-20', 11900, { categoryName: 'Servicios' })],
    });

    expect(monthOf(rows, '2026-05')).toMatchObject({ outputVat: 1900, coverage: 1 });
  });
});

// ─── input VAT: what actually left the bank ───────────────────────────────────

describe('computeVatByMonth input VAT', () => {
  it('derives input VAT from an outbound movement category rate', () => {
    const rows = run({ movements: [movement('2026-05-04', -1190, { categoryName: 'Materiales' })] });

    expect(monthOf(rows, '2026-05')).toMatchObject({
      outputVat: 0,
      inputVat: 190,
      net: -190,
      coverage: 1,
    });
  });

  it('nets input against output inside the same month', () => {
    const rows = run({
      receivables: [receivable('2026-05-20', 11900, { taxRate: 0.19 })],
      movements: [movement('2026-05-04', -1190, { categoryName: 'Materiales' })],
    });

    expect(monthOf(rows, '2026-05')).toMatchObject({ outputVat: 1900, inputVat: 190, net: 1710 });
  });

  it('ignores inbound movements — the sale was already counted when invoiced', () => {
    const rows = run({ movements: [movement('2026-05-04', 1190, { categoryName: 'Servicios' })] });

    expect(rows).toHaveLength(0);
  });

  it('never double-counts an invoice that its collection movement settles', () => {
    const invoice = receivable('2026-05-20', 11900, { taxRate: 0.19 });
    const collection = movement('2026-06-02', 11900, {
      categoryName: 'Factura CXC',
      receivableId: invoice.id,
    });

    const rows = run({ receivables: [invoice], movements: [collection] });

    expect(rows.map((row) => row.outputVat)).toEqual([1900]);
    expect(monthOf(rows, '2026-06')).toBeUndefined();
  });

  it('skips an outbound movement that refunds an invoice already counted', () => {
    const invoice = receivable('2026-05-20', 11900, { taxRate: 0.19 });
    const refund = movement('2026-06-02', -11900, {
      categoryName: 'Servicios',
      receivableIds: [invoice.id],
    });

    const rows = run({ receivables: [invoice], movements: [refund] });

    expect(monthOf(rows, '2026-06')).toBeUndefined();
  });

  it('excludes internal transfers — moving own money generates no VAT', () => {
    const rows = run({
      movements: [
        movement('2026-05-04', -5000, {
          categoryName: 'Materiales',
          counterpartyName: 'UMTELKOMD GmbH',
        }),
      ],
    });

    expect(rows).toHaveLength(0);
  });

  it('excludes wages — payroll carries no VAT and must not dilute coverage', () => {
    const rows = run({
      movements: [
        movement('2026-05-04', -3000, { categoryName: 'Salarios', counterpartyName: 'Employee' }),
        movement('2026-05-05', -1190, { categoryName: 'Materiales' }),
      ],
    });

    expect(monthOf(rows, '2026-05')).toMatchObject({ inputVat: 190, totalAmount: 1190 });
  });

  it('ignores voided movements — money that never left claims no Vorsteuer', () => {
    const rows = run({
      movements: [movement('2026-05-04', -1190, { categoryName: 'Materiales', status: 'void' })],
    });

    expect(rows).toHaveLength(0);
  });

  it('reads the direction fallback for movements imported without a usable signedAmount', () => {
    const rows = run({
      movements: [
        movement('2026-05-04', -1190, { categoryName: 'Materiales', signedAmount: 0 }),
      ],
    });

    expect(monthOf(rows, '2026-05').inputVat).toBe(190);
  });
});

// ─── §13b reverse charge ──────────────────────────────────────────────────────

describe('computeVatByMonth reverse charge', () => {
  it('claims no input VAT on §13b subcontractor invoices, and still counts them as known', () => {
    const rows = run({
      movements: [movement('2026-05-04', -10000, { categoryName: 'Subcontratos' })],
    });

    expect(monthOf(rows, '2026-05')).toMatchObject({
      inputVat: 0,
      coverage: 1,
      knownAmount: 10000,
    });
  });
});

// ─── coverage: the figure is a floor, and says so ─────────────────────────────

describe('computeVatByMonth coverage', () => {
  it('reports the share of the month whose rate was actually known', () => {
    const rows = run({
      movements: [
        movement('2026-05-04', -1000, { categoryName: 'Materiales' }),
        movement('2026-05-05', -3000, {}), // uncategorised → rate unknown
      ],
    });

    expect(monthOf(rows, '2026-05')).toMatchObject({
      coverage: 0.25,
      knownAmount: 1000,
      totalAmount: 4000,
    });
  });

  it('does not treat an unknown rate as no VAT — it reports it as uncovered', () => {
    const rows = run({ movements: [movement('2026-05-05', -3000, { categoryName: 'Otros' })] });

    expect(monthOf(rows, '2026-05')).toMatchObject({ inputVat: 0, coverage: 0 });
  });

  it('counts an invoice with no rate against coverage too', () => {
    const rows = run({ receivables: [receivable('2026-05-20', 10000)] });

    expect(monthOf(rows, '2026-05')).toMatchObject({ outputVat: 0, coverage: 0 });
  });
});

// ─── bounds ───────────────────────────────────────────────────────────────────

describe('computeVatByMonth bounds', () => {
  it('ignores documents and movements dated after today', () => {
    const rows = run({
      receivables: [receivable('2026-08-20', 11900, { taxRate: 0.19 })],
      movements: [movement('2026-08-04', -1190, { categoryName: 'Materiales' })],
    });

    expect(rows).toHaveLength(0);
  });

  it('returns months in ascending order with their filing due date', () => {
    const rows = run({
      receivables: [
        receivable('2026-06-20', 11900, { taxRate: 0.19 }),
        receivable('2026-05-20', 11900, { taxRate: 0.19 }),
      ],
    });

    expect(rows.map((row) => row.month)).toEqual(['2026-05', '2026-06']);
    expect(rows.map((row) => row.dueDate)).toEqual(['2026-07-10', '2026-08-10']);
  });

  it('survives empty input', () => {
    expect(computeVatByMonth({ today: TODAY })).toEqual([]);
  });
});

// ─── filing calendar (reused from lib/finance/fiscalCalendar) ─────────────────

describe('vatDueDate', () => {
  it('files VAT for month M on the 10th of M+2 (Dauerfristverlängerung)', () => {
    expect(vatDueDate('2026-05')).toBe('2026-07-10');
  });

  it('shifts a weekend due date to the next banking day', () => {
    // 2026-10-10 is a Saturday.
    expect(vatDueDate('2026-08')).toBe('2026-10-12');
  });
});

// ─── forecast feed: manual beats derived ──────────────────────────────────────

describe('buildVatEstimates', () => {
  const derivable = {
    receivables: [
      receivable('2026-05-20', 11900, { taxRate: 0.19 }),
      receivable('2026-06-20', 11900, { taxRate: 0.19 }),
    ],
    categoryRates: RATES,
    today: TODAY,
  };

  it('derives an estimate for a month the owner never typed', () => {
    const entries = buildVatEstimates(derivable);

    expect(entries).toEqual([
      expect.objectContaining({ month: '2026-05', amount: 1900, source: 'derived', dueDate: '2026-07-10' }),
      expect.objectContaining({ month: '2026-06', amount: 1900, source: 'derived', dueDate: '2026-08-10' }),
    ]);
  });

  it('keeps the manually entered amount for a month that has one', () => {
    const entries = buildVatEstimates({
      ...derivable,
      vatEstimates: [{ month: '2026-05', amount: 2500 }],
    });

    expect(entries).toEqual([
      expect.objectContaining({ month: '2026-05', amount: 2500, source: 'manual' }),
      expect.objectContaining({ month: '2026-06', amount: 1900, source: 'derived' }),
    ]);
  });

  it('keeps a manual zero — an explicit human zero is a decision, not a gap', () => {
    const entries = buildVatEstimates({
      ...derivable,
      vatEstimates: [{ month: '2026-05', amount: 0 }],
    });

    expect(entries[0]).toMatchObject({ month: '2026-05', amount: 0, source: 'manual' });
  });

  it('carries the coverage of the month it derived, so the UI can caveat it', () => {
    const entries = buildVatEstimates({
      ...derivable,
      movements: [movement('2026-05-04', -1000, {})],
    });

    expect(entries[0].coverage).toBeCloseTo(11900 / 12900, 6);
    // The weights travel too: a screen showing several months has to aggregate
    // coverage by amount, not average percentages.
    expect(entries[0]).toMatchObject({ knownAmount: 11900, totalAmount: 12900 });
  });

  it('never projects a derived refund month as an outflow', () => {
    const entries = buildVatEstimates({
      receivables: [],
      movements: [movement('2026-05-04', -11900, { categoryName: 'Materiales' })],
      categoryRates: RATES,
      today: TODAY,
    });

    expect(entries).toEqual([]);
  });

  it('drops a derived month already past its filing date — that money is gone from the anchor', () => {
    const entries = buildVatEstimates({
      receivables: [receivable('2026-04-20', 11900, { taxRate: 0.19 })],
      categoryRates: RATES,
      today: TODAY, // 2026-04 was filed on 2026-06-10
    });

    expect(entries).toEqual([]);
  });

  it('keeps a manual estimate whose due date already passed — the owner clears those', () => {
    const entries = buildVatEstimates({
      receivables: [],
      categoryRates: RATES,
      today: TODAY,
      vatEstimates: [{ month: '2026-04', amount: 800 }],
    });

    expect(entries).toEqual([
      expect.objectContaining({ month: '2026-04', amount: 800, source: 'manual' }),
    ]);
  });

  it('ignores malformed manual entries instead of projecting NaN', () => {
    const entries = buildVatEstimates({
      receivables: [],
      categoryRates: RATES,
      today: TODAY,
      vatEstimates: [{ month: 'not-a-month', amount: 800 }, { month: '2026-09', amount: 'abc' }],
    });

    expect(entries).toEqual([]);
  });
});
