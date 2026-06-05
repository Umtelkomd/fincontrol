import { describe, expect, it } from 'vitest';
import {
  monthLabel,
  computePayrollTotals,
  buildPayrollPayables,
} from './payroll.js';

// ─── monthLabel ───────────────────────────────────────────────────────────────

describe('monthLabel', () => {
  it('converts 2026-04 to Abril 2026', () => {
    expect(monthLabel('2026-04')).toBe('Abril 2026');
  });
  it('converts 2026-01 to Enero 2026', () => {
    expect(monthLabel('2026-01')).toBe('Enero 2026');
  });
  it('converts 2025-12 to Diciembre 2025', () => {
    expect(monthLabel('2025-12')).toBe('Diciembre 2025');
  });
  it('converts 2026-07 to Julio 2026', () => {
    expect(monthLabel('2026-07')).toBe('Julio 2026');
  });
  it('converts 2026-02 to Febrero 2026', () => {
    expect(monthLabel('2026-02')).toBe('Febrero 2026');
  });
});

// ─── April 2026 DATEV fixtures ────────────────────────────────────────────────
// Real reconciled figures — sum must be exact to the cent.

const APRIL_KK = [
  { payee: 'BARMER', amount: 7721.08 },
  { payee: 'AOK Rheinland/Hamburg', amount: 2756.40 },
  { payee: 'EK Techniker-Krankenkasse', amount: 2343.42 },
  { payee: 'BKK TUI', amount: 839.93 },
];

const APRIL_TAX = { amount: 3742.93 };
const APRIL_NET_WAGES = { amount: 21065.46 };

// Per-employee snapshot matching the April 2026 reconciliation.
// employerCostTotal = sum of gesamtkosten = 39145.80
// employeeCount = 11, payCount = 10 (one employee with netto = 0)
// gesamtkosten values are set so they sum exactly to 39145.80:
//   4100 + 3750 + 3200 + 2780 + 2990 + 2640 + 3500 + 2840 + 3145.80 + 1800 + 6400 = 39145.80
const APRIL_LINES = [
  { employeeId: 'e1', name: 'Ana García',       netto: 2800.00, brutto: 3400.00, gesamtkosten: 4100.00 },
  { employeeId: 'e2', name: 'Juan López',        netto: 2600.00, brutto: 3100.00, gesamtkosten: 3750.00 },
  { employeeId: 'e3', name: 'Maria Schmidt',     netto: 2200.00, brutto: 2650.00, gesamtkosten: 3200.00 },
  { employeeId: 'e4', name: 'Peter Müller',      netto: 1900.00, brutto: 2300.00, gesamtkosten: 2780.00 },
  { employeeId: 'e5', name: 'Luisa Fernández',   netto: 2050.00, brutto: 2480.00, gesamtkosten: 2990.00 },
  { employeeId: 'e6', name: 'Klaus Wagner',      netto: 1800.00, brutto: 2190.00, gesamtkosten: 2640.00 },
  { employeeId: 'e7', name: 'Sofia Reyes',       netto: 2400.00, brutto: 2900.00, gesamtkosten: 3500.00 },
  { employeeId: 'e8', name: 'Thomas Becker',     netto: 1950.00, brutto: 2350.00, gesamtkosten: 2840.00 },
  { employeeId: 'e9', name: 'Carmen Torres',     netto: 2165.46, brutto: 2600.00, gesamtkosten: 3145.80 },
  { employeeId: 'e10', name: 'Ralf Hoffmann',    netto: 1200.00, brutto: 1450.00, gesamtkosten: 1800.00 },
  { employeeId: 'e11', name: 'Ingrid Blank',     netto: 0,       brutto: 0,       gesamtkosten: 8400.00 }, // on leave — higher employer cost (benefits etc.)
];

// ─── computePayrollTotals ─────────────────────────────────────────────────────

describe('computePayrollTotals', () => {
  const result = computePayrollTotals({
    krankenkassen: APRIL_KK,
    tax: APRIL_TAX,
    netWages: APRIL_NET_WAGES,
    lines: APRIL_LINES,
  });

  it('socialTotal = sum of all KK amounts = 13660.83', () => {
    expect(result.socialTotal).toBeCloseTo(13660.83, 2);
  });

  it('taxTotal = Lohnsteuer amount = 3742.93', () => {
    expect(result.taxTotal).toBeCloseTo(3742.93, 2);
  });

  it('netWagesTotal = net wages amount = 21065.46', () => {
    expect(result.netWagesTotal).toBeCloseTo(21065.46, 2);
  });

  it('cashTotal = social + tax + netWages = 38469.22', () => {
    expect(result.cashTotal).toBeCloseTo(38469.22, 2);
  });

  it('employerCostTotal = sum of lines.gesamtkosten = 39145.80', () => {
    expect(result.employerCostTotal).toBeCloseTo(39145.80, 2);
  });

  it('employeeCount = 11 (total lines)', () => {
    expect(result.employeeCount).toBe(11);
  });

  it('payCount = 10 (lines with netto > 0)', () => {
    expect(result.payCount).toBe(10);
  });

  it('returns all expected keys', () => {
    const keys = ['socialTotal', 'taxTotal', 'netWagesTotal', 'cashTotal', 'employerCostTotal', 'employeeCount', 'payCount'];
    keys.forEach((key) => expect(result).toHaveProperty(key));
  });

  it('handles empty lines gracefully', () => {
    const r = computePayrollTotals({
      krankenkassen: [],
      tax: { amount: 0 },
      netWages: { amount: 0 },
      lines: [],
    });
    expect(r.cashTotal).toBe(0);
    expect(r.employeeCount).toBe(0);
    expect(r.payCount).toBe(0);
  });
});

// ─── buildPayrollPayables ─────────────────────────────────────────────────────

describe('buildPayrollPayables', () => {
  const payables = buildPayrollPayables({
    period: '2026-04',
    periodId: 'period-abc123',
    label: 'Abril 2026',
    costCenterId: 'cc-nom-id',
    krankenkassen: APRIL_KK,
    tax: APRIL_TAX,
    netWages: APRIL_NET_WAGES,
  });

  it('returns exactly 6 payables (4 KK + 1 tax + 1 wages)', () => {
    expect(payables).toHaveLength(6);
  });

  it('all payables have the payrollPeriod marker field', () => {
    payables.forEach((p) => expect(p.payrollPeriod).toBe('2026-04'));
  });

  it('all payables have the payrollPeriodId marker field', () => {
    payables.forEach((p) => expect(p.payrollPeriodId).toBe('period-abc123'));
  });

  it('all payables have source: payroll', () => {
    payables.forEach((p) => expect(p.source).toBe('payroll'));
  });

  it('all payables have categoryName: Salarios', () => {
    payables.forEach((p) => expect(p.categoryName).toBe('Salarios'));
  });

  it('all payables have the resolved costCenterId', () => {
    payables.forEach((p) => expect(p.costCenterId).toBe('cc-nom-id'));
  });

  it('KK payables have payrollKind: krankenkasse', () => {
    const kkPayables = payables.filter((p) => p.payrollKind === 'krankenkasse');
    expect(kkPayables).toHaveLength(4);
  });

  it('tax payable has payrollKind: tax', () => {
    const taxPayable = payables.find((p) => p.payrollKind === 'tax');
    expect(taxPayable).toBeDefined();
    expect(taxPayable.amount).toBeCloseTo(3742.93, 2);
  });

  it('wages payable has payrollKind: wages', () => {
    const wagesPayable = payables.find((p) => p.payrollKind === 'wages');
    expect(wagesPayable).toBeDefined();
    expect(wagesPayable.amount).toBeCloseTo(21065.46, 2);
  });

  it('wages payable vendor includes the label', () => {
    const wagesPayable = payables.find((p) => p.payrollKind === 'wages');
    expect(wagesPayable.vendor).toBe('Sueldos netos Abril 2026');
  });

  it('KK amounts match DATEV fixtures', () => {
    const kkPayables = payables.filter((p) => p.payrollKind === 'krankenkasse');
    const sortedAmounts = kkPayables.map((p) => p.amount).sort((a, b) => b - a);
    expect(sortedAmounts[0]).toBeCloseTo(7721.08, 2);
    expect(sortedAmounts[1]).toBeCloseTo(2756.40, 2);
    expect(sortedAmounts[2]).toBeCloseTo(2343.42, 2);
    expect(sortedAmounts[3]).toBeCloseTo(839.93, 2);
  });

  it('each payable has vendor and amount fields', () => {
    payables.forEach((p) => {
      expect(p).toHaveProperty('vendor');
      expect(p).toHaveProperty('amount');
      expect(typeof p.amount).toBe('number');
    });
  });

  it('works when costCenterId is empty (no crash)', () => {
    const result = buildPayrollPayables({
      period: '2026-04',
      periodId: 'p1',
      label: 'Abril 2026',
      costCenterId: '',
      krankenkassen: APRIL_KK,
      tax: APRIL_TAX,
      netWages: APRIL_NET_WAGES,
    });
    expect(result).toHaveLength(6);
    result.forEach((p) => expect(p.costCenterId).toBe(''));
  });
});
