import { describe, expect, it } from 'vitest';
import { pivotByEmployee } from './payrollPivot.js';

const period = (p, lines) => ({ period: p, lines });

describe('pivotByEmployee', () => {
  it('aggregates the same persNr across 3 periods into one row with months + YTD', () => {
    const periods = [
      period('2026-01', [{ persNr: '001', name: 'Ana', employeeId: 'e1', netto: 1000, brutto: 1500, gesamtkosten: 2000 }]),
      period('2026-02', [{ persNr: '001', name: 'Ana', employeeId: 'e1', netto: 1100, brutto: 1600, gesamtkosten: 2100 }]),
      period('2026-03', [{ persNr: '001', name: 'Ana', employeeId: 'e1', netto: 1200, brutto: 1700, gesamtkosten: 2200 }]),
    ];
    const out = pivotByEmployee(periods);
    expect(out).toHaveLength(1);
    const row = out[0];
    expect(row.persNr).toBe('001');
    expect(row.name).toBe('Ana');
    expect(row.months).toHaveLength(3);
    expect(row.ytd.netto).toBe(3300);
    expect(row.ytd.brutto).toBe(4800);
    expect(row.ytd.gesamtkosten).toBe(6300);
    expect(row.sparkline).toEqual([2000, 2100, 2200]);
  });

  it('orders months ascending even with unordered input periods', () => {
    const periods = [
      period('2026-03', [{ persNr: '001', name: 'Ana', netto: 3, brutto: 3, gesamtkosten: 3 }]),
      period('2026-01', [{ persNr: '001', name: 'Ana', netto: 1, brutto: 1, gesamtkosten: 1 }]),
    ];
    const out = pivotByEmployee(periods);
    expect(out[0].months.map((m) => m.period)).toEqual(['2026-01', '2026-03']);
    expect(out[0].sparkline).toEqual([1, 3]);
  });

  it('0-fills the sparkline for an employee absent in some months', () => {
    const periods = [
      period('2026-01', [
        { persNr: '001', name: 'Ana', netto: 1000, brutto: 1, gesamtkosten: 2000 },
        { persNr: '002', name: 'Bob', netto: 900, brutto: 1, gesamtkosten: 1800 },
      ]),
      period('2026-02', [
        { persNr: '001', name: 'Ana', netto: 1000, brutto: 1, gesamtkosten: 2000 },
        // Bob missing this month
      ]),
    ];
    const out = pivotByEmployee(periods);
    const bob = out.find((r) => r.persNr === '002');
    // sparkline keeps continuity across the full period axis: present, then 0
    expect(bob.sparkline).toEqual([1800, 0]);
    expect(bob.ytd.gesamtkosten).toBe(1800);
  });

  it('falls back to employeeId then name when persNr is empty', () => {
    const periods = [
      period('2026-01', [{ persNr: '', name: 'Carla', employeeId: 'e9', netto: 5, brutto: 5, gesamtkosten: 5 }]),
      period('2026-02', [{ persNr: '', name: 'Carla', employeeId: 'e9', netto: 5, brutto: 5, gesamtkosten: 5 }]),
    ];
    const out = pivotByEmployee(periods);
    expect(out).toHaveLength(1);
    expect(out[0].ytd.gesamtkosten).toBe(10);
  });

  it('keeps netto/brutto/gesamtkosten separate per month', () => {
    const periods = [
      period('2026-01', [{ persNr: '001', name: 'Ana', netto: 10, brutto: 20, gesamtkosten: 30 }]),
    ];
    const out = pivotByEmployee(periods);
    expect(out[0].months[0]).toMatchObject({ netto: 10, brutto: 20, gesamtkosten: 30 });
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(pivotByEmployee([])).toEqual([]);
    expect(pivotByEmployee(null)).toEqual([]);
  });
});
