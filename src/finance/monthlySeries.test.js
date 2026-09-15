import { describe, expect, it } from 'vitest';
import { buildMonthlySeries, monthKeyOf } from './monthlySeries';

describe('monthKeyOf', () => {
  it.each([
    ['2026-03-15', '2026-03'],
    ['2026-01-01', '2026-01'],
    ['2026-12-31', '2026-12'],
    ['2026-03-15T10:00:00.000Z', '2026-03'],
  ])('extracts %s -> %s', (isoDate, expected) => {
    expect(monthKeyOf(isoDate)).toBe(expected);
  });

  it.each([[''], [null], [undefined], [123], ['not-a-date'], ['2026-13-01'], ['2026-02-30']])(
    'returns null for invalid input: %j',
    (isoDate) => {
      expect(monthKeyOf(isoDate)).toBeNull();
    },
  );
});

describe('buildMonthlySeries', () => {
  const movement = (overrides = {}) => ({
    postedDate: '2026-03-10',
    direction: 'in',
    amount: 100,
    signedAmount: 100,
    status: 'posted',
    kind: 'payment',
    ...overrides,
  });

  const receivable = (overrides = {}) => ({
    issueDate: '2026-03-05',
    grossAmount: 500,
    status: 'issued',
    ...overrides,
  });

  const payable = (overrides = {}) => ({
    issueDate: '2026-03-05',
    grossAmount: 300,
    status: 'issued',
    ...overrides,
  });

  it('returns a single month for months=1, oldest first (the only entry)', () => {
    const result = buildMonthlySeries({ months: 1, referenceDate: '2026-03-15' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('2026-03');
    expect(result[0].label).toBe('Mar 26');
  });

  it('returns 12 months ending at referenceDate, oldest first', () => {
    const result = buildMonthlySeries({ months: 12, referenceDate: '2026-03-15' });
    expect(result).toHaveLength(12);
    expect(result[0].key).toBe('2025-04');
    expect(result[result.length - 1].key).toBe('2026-03');
  });

  it('defaults months to 12 when omitted', () => {
    const result = buildMonthlySeries({ referenceDate: '2026-06-01' });
    expect(result).toHaveLength(12);
    expect(result[result.length - 1].key).toBe('2026-06');
  });

  it('a month with no data returns zeros for every figure', () => {
    const result = buildMonthlySeries({ months: 1, referenceDate: '2026-03-15' });
    expect(result[0]).toEqual({
      key: '2026-03',
      label: 'Mar 26',
      cobrado: 0,
      pagado: 0,
      neto: 0,
      facturado: 0,
      recibido: 0,
    });
  });

  it('computes cobrado/pagado/neto from movements in that month via summarizeMovements', () => {
    const movements = [
      movement({ direction: 'in', amount: 1000, signedAmount: 1000 }),
      movement({ direction: 'out', amount: 400, signedAmount: -400 }),
    ];
    const [result] = buildMonthlySeries({ movements, months: 1, referenceDate: '2026-03-15' });
    expect(result.cobrado).toBe(1000);
    expect(result.pagado).toBe(400);
    expect(result.neto).toBe(600);
  });

  it('excludes movements outside the requested month', () => {
    const movements = [movement({ postedDate: '2026-02-28', amount: 1000 }), movement({ postedDate: '2026-04-01', amount: 2000 })];
    const [result] = buildMonthlySeries({ movements, months: 1, referenceDate: '2026-03-15' });
    expect(result.cobrado).toBe(0);
  });

  it('excludes internal transfers recognized by isInternalTransfer (kind: transfer)', () => {
    const movements = [
      movement({ direction: 'in', amount: 5000, signedAmount: 5000, kind: 'transfer' }),
      movement({ direction: 'out', amount: 5000, signedAmount: -5000, kind: 'transfer' }),
      movement({ direction: 'in', amount: 200, signedAmount: 200, kind: 'payment' }),
    ];
    const [result] = buildMonthlySeries({ movements, months: 1, referenceDate: '2026-03-15' });
    expect(result.cobrado).toBe(200);
    expect(result.pagado).toBe(0);
    expect(result.neto).toBe(200);
  });

  it('works via the direction fallback for movements lacking signedAmount (pre-May-2026)', () => {
    const movements = [
      movement({ direction: 'in', amount: 300, signedAmount: undefined }),
      movement({ direction: 'out', amount: 100, signedAmount: undefined }),
    ];
    const [result] = buildMonthlySeries({ movements, months: 1, referenceDate: '2026-03-15' });
    expect(result.cobrado).toBe(300);
    expect(result.pagado).toBe(100);
    expect(result.neto).toBe(200);
  });

  it('computes facturado from receivables issued in that month, gross amount', () => {
    const receivables = [receivable({ grossAmount: 500 }), receivable({ grossAmount: 250 })];
    const [result] = buildMonthlySeries({ receivables, months: 1, referenceDate: '2026-03-15' });
    expect(result.facturado).toBe(750);
  });

  it('falls back to amount when grossAmount is absent for receivables', () => {
    const receivables = [{ issueDate: '2026-03-05', amount: 400, status: 'issued' }];
    const [result] = buildMonthlySeries({ receivables, months: 1, referenceDate: '2026-03-15' });
    expect(result.facturado).toBe(400);
  });

  it('computes recibido from payables issued in that month, gross amount', () => {
    const payables = [payable({ grossAmount: 300 }), payable({ grossAmount: 150 })];
    const [result] = buildMonthlySeries({ payables, months: 1, referenceDate: '2026-03-15' });
    expect(result.recibido).toBe(450);
  });

  it('excludes cancelled receivables/payables (status: cancelled, cancelada, anulada)', () => {
    const receivables = [
      receivable({ grossAmount: 100, status: 'cancelled' }),
      receivable({ grossAmount: 200, status: 'cancelada' }),
      receivable({ grossAmount: 300, status: 'anulada' }),
      receivable({ grossAmount: 400, status: 'issued' }),
    ];
    const [result] = buildMonthlySeries({ receivables, months: 1, referenceDate: '2026-03-15' });
    expect(result.facturado).toBe(400);
  });

  it('excludes receivables/payables issued outside the requested month', () => {
    const receivables = [receivable({ issueDate: '2026-02-28', grossAmount: 999 })];
    const [result] = buildMonthlySeries({ receivables, months: 1, referenceDate: '2026-03-15' });
    expect(result.facturado).toBe(0);
  });

  it('accepts referenceDate as a Date object, equivalent to the ISO string', () => {
    const byString = buildMonthlySeries({ months: 1, referenceDate: '2026-03-15' });
    const byDate = buildMonthlySeries({ months: 1, referenceDate: new Date(2026, 2, 15) });
    expect(byDate).toEqual(byString);
  });

  it('rounds every figure to 2 decimals', () => {
    const movements = [movement({ direction: 'in', amount: 100.005, signedAmount: 100.005 })];
    const receivables = [receivable({ grossAmount: 250.004 })];
    const [result] = buildMonthlySeries({ movements, receivables, months: 1, referenceDate: '2026-03-15' });
    expect(result.cobrado).toBeCloseTo(100.01, 2);
    expect(result.facturado).toBeCloseTo(250, 2);
  });

  it('labels use SHORT_MONTH_NAMES and a 2-digit year', () => {
    const result = buildMonthlySeries({ months: 3, referenceDate: '2026-01-15' });
    expect(result.map((r) => r.label)).toEqual(['Nov 25', 'Dic 25', 'Ene 26']);
  });
});
