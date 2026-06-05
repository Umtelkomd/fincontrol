import { describe, expect, it } from 'vitest';
import {
  monthLabel,
  computePayrollTotals,
  buildPayrollPayables,
  periodKey,
  findDuplicatePeriod,
  computeLineVariances,
  reconcileNetWages,
  buildDocumentDescriptor,
  buildPayrollAuditEntry,
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

  // ─── sourceDocument stamping (Phase 1, item 6) ──────────────────────────────

  it('stamps sourceDocument on every payable when a descriptor is supplied', () => {
    const documentRef = { periodId: 'period-abc123', kind: 'zakf', fileName: 'zakf_2026-04.pdf', hash: 'abc123' };
    const result = buildPayrollPayables({
      period: '2026-04',
      periodId: 'period-abc123',
      label: 'Abril 2026',
      costCenterId: 'cc-nom-id',
      krankenkassen: APRIL_KK,
      tax: APRIL_TAX,
      netWages: APRIL_NET_WAGES,
      documentRef,
    });
    expect(result).toHaveLength(6);
    result.forEach((p) => {
      expect(p.sourceDocument).toEqual({
        periodId: 'period-abc123',
        kind: 'zakf',
        fileName: 'zakf_2026-04.pdf',
        hash: 'abc123',
      });
    });
  });

  it('defaults sourceDocument to null cleanly when no descriptor is supplied', () => {
    const result = buildPayrollPayables({
      period: '2026-04',
      periodId: 'period-abc123',
      label: 'Abril 2026',
      costCenterId: 'cc-nom-id',
      krankenkassen: APRIL_KK,
      tax: APRIL_TAX,
      netWages: APRIL_NET_WAGES,
    });
    expect(result).toHaveLength(6);
    result.forEach((p) => expect(p.sourceDocument).toBeNull());
  });
});

// ─── periodKey + findDuplicatePeriod (Phase 1, item 1) ────────────────────────

describe('periodKey', () => {
  it('normalizes a period object to its YYYY-MM key', () => {
    expect(periodKey({ period: '2026-04' })).toBe('2026-04');
  });
  it('accepts a raw string', () => {
    expect(periodKey('2026-04')).toBe('2026-04');
  });
  it('returns empty string for missing input', () => {
    expect(periodKey(null)).toBe('');
    expect(periodKey({})).toBe('');
  });
});

describe('findDuplicatePeriod', () => {
  const periods = [
    { id: 'p1', period: '2026-04' },
    { id: 'p2', period: '2026-03' },
  ];
  it('returns the existing period when one shares the same YYYY-MM', () => {
    const found = findDuplicatePeriod(periods, { period: '2026-04' });
    expect(found).toEqual({ id: 'p1', period: '2026-04' });
  });
  it('returns null when no period matches', () => {
    expect(findDuplicatePeriod(periods, { period: '2026-05' })).toBeNull();
  });
  it('returns null for an empty list', () => {
    expect(findDuplicatePeriod([], { period: '2026-04' })).toBeNull();
  });
  it('accepts a raw period string as the second arg', () => {
    const found = findDuplicatePeriod(periods, '2026-03');
    expect(found?.id).toBe('p2');
  });
});

// ─── reconcileNetWages (Phase 1, item 4) ──────────────────────────────────────

describe('reconcileNetWages', () => {
  it('ok:true when sum(lines.netto) exactly equals the aggregate', () => {
    const r = reconcileNetWages({
      lines: [{ netto: 10000 }, { netto: 11065.46 }],
      netWages: 21065.46,
    });
    expect(r.ok).toBe(true);
    expect(r.sumLines).toBeCloseTo(21065.46, 2);
    expect(r.aggregate).toBeCloseTo(21065.46, 2);
    expect(r.diff).toBeCloseTo(0, 2);
  });
  it('ok:true within the 0.01 tolerance (21065.45 vs 21065.46)', () => {
    const r = reconcileNetWages({
      lines: [{ netto: 21065.45 }],
      netWages: 21065.46,
    });
    expect(r.ok).toBe(true);
  });
  it('ok:false at a 0.02 difference', () => {
    const r = reconcileNetWages({
      lines: [{ netto: 21065.44 }],
      netWages: 21065.46,
    });
    expect(r.ok).toBe(false);
    expect(r.diff).toBeCloseTo(0.02, 2);
  });
  it('accepts netWages as an object {amount}', () => {
    const r = reconcileNetWages({
      lines: [{ netto: 100 }],
      netWages: { amount: 100 },
    });
    expect(r.ok).toBe(true);
  });
  it('handles empty lines (sum 0)', () => {
    const r = reconcileNetWages({ lines: [], netWages: 0 });
    expect(r.sumLines).toBe(0);
    expect(r.ok).toBe(true);
  });
});

// ─── computeLineVariances (Phase 1, item 4) ───────────────────────────────────

describe('computeLineVariances', () => {
  const employeesById = {
    e1: { nettoMonthly: 2000, bruttoMonthly: 2500, gesamtkostenMonthly: 3000 },
  };

  it('flags a line when netto deviates >5% from the employee reference', () => {
    const out = computeLineVariances({
      lines: [{ employeeId: 'e1', persNr: '00001', name: 'A', netto: 2200, brutto: 2500, gesamtkosten: 3000 }],
      employeesById,
    });
    expect(out[0].deltas.netto.flagged).toBe(true);
    expect(out[0].deltas.netto.pct).toBeCloseTo(0.1, 3);
    expect(out[0].deltas.netto.ref).toBe(2000);
    expect(out[0].deltas.netto.value).toBe(2200);
    expect(out[0].deltas.brutto.flagged).toBe(false);
    expect(out[0].deltas.gesamtkosten.flagged).toBe(false);
  });

  it('does NOT flag at exactly 5%', () => {
    const out = computeLineVariances({
      lines: [{ employeeId: 'e1', netto: 2100, brutto: 2500, gesamtkosten: 3000 }],
      employeesById,
    });
    expect(out[0].deltas.netto.pct).toBeCloseTo(0.05, 3);
    expect(out[0].deltas.netto.flagged).toBe(false);
  });

  it('tolerates a missing reference (ref 0 -> not flagged, no divide-by-zero)', () => {
    const out = computeLineVariances({
      lines: [{ employeeId: 'unknown', netto: 2200, brutto: 0, gesamtkosten: 0 }],
      employeesById,
    });
    expect(out[0].deltas.netto.ref).toBe(0);
    expect(out[0].deltas.netto.flagged).toBe(false);
    expect(Number.isFinite(out[0].deltas.netto.pct)).toBe(true);
  });

  it('carries employeeId, persNr, name through', () => {
    const out = computeLineVariances({
      lines: [{ employeeId: 'e1', persNr: '00001', name: 'Ana', netto: 2000, brutto: 2500, gesamtkosten: 3000 }],
      employeesById,
    });
    expect(out[0]).toMatchObject({ employeeId: 'e1', persNr: '00001', name: 'Ana' });
  });
});

// ─── buildDocumentDescriptor (Phase 1, item 6) ────────────────────────────────

describe('buildDocumentDescriptor', () => {
  it('returns a plain sanitizer-safe object with no Date/undefined leaks', () => {
    const d = buildDocumentDescriptor({
      hashHex: 'deadbeef',
      fileName: 'zakf_2026-04.pdf',
      kind: 'zakf',
      pageCount: 2,
    });
    expect(d).toMatchObject({
      hash: 'deadbeef',
      fileName: 'zakf_2026-04.pdf',
      kind: 'zakf',
      pageCount: 2,
    });
    expect(typeof d.importedAt).toBe('string');
    Object.values(d).forEach((v) => {
      expect(v).not.toBeUndefined();
      expect(v instanceof Date).toBe(false);
    });
  });
  it('defaults pageCount to 0 when missing', () => {
    const d = buildDocumentDescriptor({ hashHex: 'x', fileName: 'f.pdf', kind: 'lojo' });
    expect(d.pageCount).toBe(0);
  });
});

// ─── buildPayrollAuditEntry (Phase 1, item 7) ─────────────────────────────────

describe('buildPayrollAuditEntry', () => {
  it.each(['create', 'update', 'delete', 'replace'])(
    'produces a normalized plain entry for the %s action',
    (action) => {
      const entry = buildPayrollAuditEntry({
        action,
        user: 'jromero@umtelkomd.de',
        detail: 'detalle',
        period: { period: '2026-04', label: 'Abril 2026' },
      });
      expect(entry.action).toBe(action);
      expect(entry.user).toBe('jromero@umtelkomd.de');
      expect(entry.detail).toBe('detalle');
      expect(typeof entry.timestamp).toBe('string');
      // ISO 8601 string, no undefined leaks
      expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
      Object.values(entry).forEach((v) => expect(v).not.toBeUndefined());
    },
  );
  it('falls back to empty strings instead of undefined', () => {
    const entry = buildPayrollAuditEntry({ action: 'create' });
    expect(entry.user).toBe('');
    expect(entry.detail).toBe('');
  });
});
