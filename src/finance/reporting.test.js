import { describe, expect, it } from 'vitest';

import {
  filterRowsByRange,
  getMovementCategory,
  resolvePeriodRange,
  summarizeMovements,
  summarizeVAT,
  toPdfTransaction,
} from './reporting.js';

describe('finance reporting period ranges and filters', () => {
  it('resolves explicit month periods and offsets across year boundaries', () => {
    expect(resolvePeriodRange('month:2026-01', new Date('2026-04-15'), 1)).toEqual({
      periodType: 'month',
      from: '2025-12-01',
      to: '2025-12-31',
      label: 'Diciembre 2025',
      key: '2025-12',
    });
  });

  it('resolves quarter and year periods from a fixed reference date', () => {
    expect(resolvePeriodRange('quarter', new Date('2026-05-15'), 0)).toMatchObject({
      periodType: 'quarter',
      from: '2026-04-01',
      to: '2026-06-30',
      label: 'Q2 2026',
    });
    expect(resolvePeriodRange('year', new Date('2026-05-15'), 1)).toEqual({
      periodType: 'year',
      from: '2025-01-01',
      to: '2025-12-31',
      label: 'Año 2025',
    });
  });

  it('keeps all-period and unknown selections structurally zero-filter safe', () => {
    expect(resolvePeriodRange('all')).toEqual({
      periodType: 'all',
      from: null,
      to: null,
      label: 'Todo el período',
    });
    expect(resolvePeriodRange('unsupported')).toEqual({
      periodType: 'all',
      from: null,
      to: null,
      label: 'Todo el período',
    });
  });

  it('filters rows inclusively by normalized ISO dates and excludes invalid dates', () => {
    const rows = [
      { id: 'before', postedDate: '2026-03-31' },
      { id: 'start', postedDate: '2026-04-01T10:30:00.000Z' },
      { id: 'inside', postedDate: '2026-04-15' },
      { id: 'end', postedDate: '2026-04-30' },
      { id: 'after', postedDate: '2026-05-01' },
      { id: 'invalid', postedDate: '' },
    ];

    const filtered = filterRowsByRange(rows, (row) => row.postedDate, {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(filtered.map((row) => row.id)).toEqual(['start', 'inside', 'end']);
  });
});

describe('finance reporting grouped totals and VAT summaries', () => {
  it('summarizes gross movement totals by direction with cent rounding', () => {
    const summary = summarizeMovements([
      { direction: 'in', amount: 119.995 },
      { direction: 'in', amount: 50.111 },
      { direction: 'out', amount: 40.126 },
      { direction: 'out', amount: 10.119 },
    ]);

    expect(summary).toEqual({
      inflows: 170.11,
      outflows: 50.25,
      net: 119.86,
    });
  });

  it('prefers net amounts when requested and falls back to gross amounts when net is absent', () => {
    const summary = summarizeMovements([
      { direction: 'in', amount: 119, netAmount: 100 },
      { direction: 'out', amount: 59.5, netAmount: 50 },
      { direction: 'out', amount: 25 },
    ], { useNet: true });

    expect(summary).toEqual({
      inflows: 100,
      outflows: 75,
      net: 25,
    });
  });

  it('returns zero-safe movement totals for empty filtered datasets', () => {
    expect(summarizeMovements([])).toEqual({
      inflows: 0,
      outflows: 0,
      net: 0,
    });
  });

  it('separates output VAT from income/receivables and input VAT from expenses/payables', () => {
    const vat = summarizeVAT([
      { direction: 'in', taxAmount: 19.004 },
      { kind: 'receivable', taxAmount: 38 },
      { direction: 'out', taxAmount: 7.995 },
      { kind: 'payable', taxAmount: 11 },
      { direction: 'in', taxAmount: 0 },
      { direction: 'out', taxAmount: -3 },
    ]);

    expect(vat).toEqual({
      outputVAT: 57,
      inputVAT: 19,
      netVAT: 38,
    });
  });
});

describe('finance reporting transaction shaping', () => {
  it('resolves movement categories through raw metadata before operational fallbacks', () => {
    expect(getMovementCategory({ raw: { category: 'Materials' }, direction: 'out' })).toBe('Materials');
    expect(getMovementCategory({ raw: { costCenter: 'cc-build' }, direction: 'out' })).toBe('cc-build');
    expect(getMovementCategory({ costCenterId: 'cc-admin', direction: 'in' })).toBe('cc-admin');
    expect(getMovementCategory({ projectName: 'Rollout North', direction: 'out' })).toBe('Rollout North');
    expect(getMovementCategory({ counterpartyName: 'Customer AG', direction: 'in' })).toBe('Customer AG');
    expect(getMovementCategory({ description: 'Bank fee', direction: 'out' })).toBe('Bank fee');
    expect(getMovementCategory({ direction: 'in' })).toBe('Cobros operativos');
    expect(getMovementCategory({ direction: 'out' })).toBe('Pagos operativos');
  });

  it('shapes PDF transactions with date, project, category, amount, and status fallbacks', () => {
    expect(toPdfTransaction({
      id: 'movement-1',
      postedDate: '2026-04-15',
      counterpartyName: 'Supplier GmbH',
      kind: 'payment',
      source: 'bankMovement',
      amount: '49.995',
      type: 'expense',
    })).toEqual({
      id: 'movement-1',
      date: '2026-04-15',
      description: 'Supplier GmbH',
      project: 'Sin proyecto',
      category: 'payment',
      amount: 50,
      type: 'expense',
      status: 'paid',
    });

    expect(toPdfTransaction({
      id: 'receivable-1',
      issueDate: '2026-04-01',
      dueDate: '2026-04-30',
      description: 'Invoice RE-1',
      projectName: 'Rollout South',
      category: 'Services',
      amount: 119,
      status: 'issued',
    })).toMatchObject({
      date: '2026-04-01',
      description: 'Invoice RE-1',
      project: 'Rollout South',
      category: 'Services',
      amount: 119,
      status: 'issued',
    });
  });
});
