import { describe, expect, it } from 'vitest';
import { buildCompanyObligations } from './companyObligations';

// ─── Real production shapes ───────────────────────────────────────────────────
// payrollPeriods docs: { period 'YYYY-MM', netWagesTotal, socialTotal, taxTotal,
// status 'pagada'|'parcial'|'cargada' }. When a nómina is imported its
// obligations MATERIALIZE as payables with source 'payroll' + payrollPeriodId.

const period = (key, extra = {}) => ({
  period: key,
  netWagesTotal: 5000,
  socialTotal: 2000,
  taxTotal: 800,
  cashTotal: 7800,
  status: 'cargada',
  ...extra,
});

const payable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  counterpartyName: 'Proveedor X',
  status: 'issued',
  ...extra,
});

const payrollPayable = (dueDate, openAmount, payrollKind, extra = {}) =>
  payable(dueDate, openAmount, {
    source: 'payroll',
    payrollKind,
    payrollPeriodId: 'pp-1',
    payrollPeriod: '2026-06',
    ...extra,
  });

const TODAY = '2026-07-10';

const kinds = (items) => items.map((i) => `${i.kind}:${i.date}`);

describe('buildCompanyObligations — payroll estimate dedupe', () => {
  it('keeps wage-tax estimates for months WITHOUT a payroll period', () => {
    const items = buildCompanyObligations({
      payables: [],
      payrollPeriods: [period('2026-04', { status: 'pagada' }), period('2026-05', { status: 'parcial' })],
      vatEstimates: [],
      today: TODAY,
      horizonDays: 60,
    });

    // June has no period → its wage tax (due 10.07) stays as an estimate.
    expect(kinds(items)).toContain('wage-tax:2026-07-10');
    const juneWageTax = items.find((i) => i.kind === 'wage-tax' && i.month === '2026-06');
    expect(juneWageTax.estimated).toBe(true);
    expect(juneWageTax.amount).toBeCloseTo(800, 2);
  });

  it('drops ALL payroll estimates for months that HAVE a payroll period', () => {
    const items = buildCompanyObligations({
      payables: [
        // June nómina imported → its obligations exist as real payables.
        payrollPayable('2026-07-10', 800, 'tax'),
        payrollPayable('2026-06-30', 5000, 'wages'),
      ],
      payrollPeriods: [
        period('2026-04', { status: 'pagada' }),
        period('2026-05', { status: 'parcial' }),
        period('2026-06'),
      ],
      vatEstimates: [],
      today: TODAY,
      horizonDays: 60,
    });

    // No payroll-average item may survive for a month with a period doc —
    // the materialized payables carry the truth (incl. Lohnsteuer).
    const monthsWithPeriod = new Set(['2026-04', '2026-05', '2026-06']);
    const leakedEstimates = items.filter(
      (i) => i.source === 'payroll-average' && monthsWithPeriod.has(i.month),
    );
    expect(leakedEstimates).toEqual([]);

    // The materialized June tax payable is still present as a payable item.
    expect(items.some((i) => i.kind === 'payable' && i.date === '2026-07-10' && i.amount === 800)).toBe(true);

    // Months without a period (July, August) keep their estimates.
    expect(kinds(items)).toContain('payroll-net:2026-07-31');
    expect(kinds(items)).toContain('social:2026-07-29');
    expect(kinds(items)).toContain('wage-tax:2026-08-10'); // July wage tax
  });
});

describe('buildCompanyObligations — VAT estimates', () => {
  it('always passes VAT estimates through on the 10th of M+2', () => {
    const items = buildCompanyObligations({
      payables: [],
      payrollPeriods: [period('2026-05')],
      vatEstimates: [{ month: '2026-05', amount: 3000 }],
      today: TODAY,
      horizonDays: 60,
    });

    const vat = items.find((i) => i.kind === 'vat');
    expect(vat).toMatchObject({
      date: '2026-07-10',
      amount: 3000,
      estimated: true,
      month: '2026-05',
    });
  });

  it('keeps overdue VAT estimates listed', () => {
    const items = buildCompanyObligations({
      payables: [],
      payrollPeriods: [],
      vatEstimates: [{ month: '2026-04', amount: 1500 }], // due 10.06 < today
      today: TODAY,
      horizonDays: 30,
    });

    const vat = items.find((i) => i.kind === 'vat');
    expect(vat.date).toBe('2026-06-10');
    expect(vat.overdue).toBe(true);
  });
});

describe('buildCompanyObligations — UI-ready labels', () => {
  it('labels estimates in Spanish by kind', () => {
    const items = buildCompanyObligations({
      payables: [],
      payrollPeriods: [period('2026-05')],
      vatEstimates: [{ month: '2026-05', amount: 3000 }],
      today: TODAY,
      horizonDays: 60,
    });

    const labelOf = (kind, month) =>
      items.find((i) => i.kind === kind && i.month === month)?.label;
    expect(labelOf('payroll-net', '2026-07')).toBe('Nómina 2026-07');
    expect(labelOf('social', '2026-07')).toBe('Seguridad social 2026-07');
    expect(labelOf('wage-tax', '2026-06')).toBe('Lohnsteuer 2026-06');
    expect(labelOf('vat', '2026-05')).toBe('IVA 2026-05');
  });

  it('keeps counterparty labels for payable items', () => {
    const items = buildCompanyObligations({
      payables: [payable('2026-07-20', 950, { counterpartyName: 'Telekom' })],
      payrollPeriods: [],
      vatEstimates: [],
      today: TODAY,
      horizonDays: 30,
    });

    const doc = items.find((i) => i.kind === 'payable');
    expect(doc.label).toBe('Telekom');
    expect(doc.estimated).toBe(false);
    expect(doc.doc).toBeTruthy();
  });
});

describe('buildCompanyObligations — calendar behavior preserved', () => {
  it('keeps overdue open payables and sorts by date', () => {
    const items = buildCompanyObligations({
      payables: [
        payable('2026-05-01', 100, { counterpartyName: 'Viejo' }),
        payable('2026-07-15', 200, { counterpartyName: 'Nuevo' }),
      ],
      payrollPeriods: [],
      vatEstimates: [],
      today: TODAY,
      horizonDays: 30,
    });

    const dates = items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
    const overdue = items.find((i) => i.label === 'Viejo');
    expect(overdue.overdue).toBe(true);
  });

  it('tolerates empty inputs', () => {
    const items = buildCompanyObligations({ today: TODAY });
    expect(Array.isArray(items)).toBe(true);
    // No payroll history → landmark dates come out with amount 0.
    expect(items.every((i) => i.amount === 0)).toBe(true);
  });
});
