import { describe, expect, it } from 'vitest';
import { buildObligationsRows, buildPerEmployeeRows } from './payrollExport.js';

const periods = [
  {
    period: '2026-01',
    label: 'Enero 2026',
    cashTotal: 30000,
    employerCostTotal: 42000,
    obligations: [
      { kind: 'krankenkasse', payee: 'AOK', amount: 5000, dueDate: '2026-01-28' },
      { kind: 'tax', payee: 'Finanzamt', amount: 8000, dueDate: '2026-02-10' },
      { kind: 'wages', payee: 'Sueldos netos', amount: 17000, dueDate: '2026-01-31' },
    ],
    lines: [
      { persNr: '001', name: 'Ana', netto: 1000, brutto: 1500, gesamtkosten: 2100 },
    ],
  },
  {
    period: '2026-02',
    label: 'Febrero 2026',
    cashTotal: 31000,
    employerCostTotal: 43000,
    obligations: [
      { kind: 'krankenkasse', payee: 'AOK', amount: 5100, dueDate: '2026-02-28' },
    ],
    lines: [
      { persNr: '001', name: 'Ana', netto: 1100, brutto: 1600, gesamtkosten: 2200 },
    ],
  },
];

describe('buildObligationsRows', () => {
  it('produces one row per obligation across all periods with label/kind/payee/amount', () => {
    const rows = buildObligationsRows(periods);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      periodLabel: 'Enero 2026',
      kind: 'krankenkasse',
      payee: 'AOK',
      amount: 5000,
      dueDate: '2026-01-28',
    });
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(buildObligationsRows([])).toEqual([]);
    expect(buildObligationsRows(null)).toEqual([]);
  });
});

describe('buildPerEmployeeRows', () => {
  it('pivots lines per employee with monthly + YTD totals', () => {
    const rows = buildPerEmployeeRows(periods);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      persNr: '001',
      name: 'Ana',
      ytdNetto: 2100,
      ytdBrutto: 3100,
      ytdGesamtkosten: 4300,
    });
    expect(rows[0].months).toHaveLength(2);
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(buildPerEmployeeRows([])).toEqual([]);
    expect(buildPerEmployeeRows(null)).toEqual([]);
  });
});
