import { describe, expect, it } from 'vitest';

import {
  buildCashFlowSectionSummary,
  buildCashFlowStatement,
  buildProfitLossByMonth,
  buildProfitLossSummary,
  classifyCashFlowMovement,
  classifyProfitLossMovement,
  getMonthKey,
  getMonthLabel,
} from './statements.js';

const movement = (overrides = {}) => ({
  id: 'movement-1',
  direction: 'in',
  amount: 100,
  postedDate: '2026-04-15',
  description: 'Customer collection',
  counterpartyName: 'Customer AG',
  projectName: 'Sin proyecto',
  ...overrides,
});

describe('finance statements classification helpers', () => {
  it('classifies cash-flow movements into operating, investing, and financing sections', () => {
    expect(classifyCashFlowMovement(movement({ description: 'Customer invoice paid' }))).toMatchObject({
      sectionKey: 'operating',
      sectionLabel: 'Operación',
      lineKey: 'collections',
      lineLabel: 'Cobros operativos',
    });
    expect(classifyCashFlowMovement(movement({ description: 'Reembolso proveedor' }))).toMatchObject({
      sectionKey: 'operating',
      lineKey: 'otherOperatingIn',
      lineLabel: 'Otros cobros operativos',
    });
    expect(classifyCashFlowMovement(movement({
      direction: 'out',
      description: 'Compra equipo capex',
    }))).toMatchObject({
      sectionKey: 'investing',
      sectionLabel: 'Inversión',
      lineKey: 'capex',
      lineLabel: 'Capex e inversión',
    });
    expect(classifyCashFlowMovement(movement({
      direction: 'out',
      description: 'Cuota bancaria préstamo',
    }))).toMatchObject({
      sectionKey: 'financing',
      sectionLabel: 'Financiación',
      lineKey: 'debtService',
      lineLabel: 'Servicio de deuda e intereses',
    });
  });

  it('classifies P&L movements while excluding capex from net result', () => {
    expect(classifyProfitLossMovement(movement({ description: 'Customer invoice paid' }))).toMatchObject({
      includeInPnl: true,
      lineKey: 'operatingRevenue',
      section: 'revenue',
    });
    expect(classifyProfitLossMovement(movement({ description: 'Reembolso cliente' }))).toMatchObject({
      includeInPnl: true,
      lineKey: 'otherIncome',
      section: 'revenue',
    });
    expect(classifyProfitLossMovement(movement({
      direction: 'out',
      description: 'Compra material proyecto',
      projectName: 'Rollout North',
    }))).toMatchObject({
      includeInPnl: true,
      lineKey: 'directCosts',
      section: 'grossMargin',
    });
    expect(classifyProfitLossMovement(movement({
      direction: 'out',
      description: 'Equipo capex',
    }))).toMatchObject({
      includeInPnl: false,
      lineKey: 'capex',
      lineLabel: 'Capex pagado',
    });
  });
});

describe('finance statements cash-flow outputs', () => {
  it('builds monthly running balances from opening balance and prior movements', () => {
    const months = buildCashFlowStatement([
      movement({ id: 'prior', amount: 200, postedDate: '2026-03-20' }),
      movement({ id: 'apr-in', amount: 500.125, postedDate: '2026-04-10' }),
      movement({ id: 'apr-out', direction: 'out', amount: 125.555, postedDate: '2026-04-15', description: 'Pago servicio software' }),
      movement({ id: 'may-out', direction: 'out', amount: 60, postedDate: '2026-05-01', description: 'Compra equipo capex' }),
      movement({ id: 'future', amount: 999, postedDate: '2026-06-01' }),
    ], 1000, '2026-03-01', ['2026-04', '2026-05']);

    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({
      key: '2026-04',
      label: 'Abr 26',
      openingBalance: 1200,
      operating: 374.57,
      investing: 0,
      financing: 0,
      netChange: 374.57,
      closingBalance: 1574.57,
    });
    expect(months[0].lines).toEqual([
      expect.objectContaining({ sectionKey: 'operating', lineKey: 'collections', amount: 500.13 }),
      expect.objectContaining({ sectionKey: 'operating', lineKey: 'operatingPayments', amount: -125.55 }),
    ]);
    expect(months[1]).toMatchObject({
      key: '2026-05',
      label: 'May 26',
      openingBalance: 1574.57,
      operating: 0,
      investing: -60,
      financing: 0,
      netChange: -60,
      closingBalance: 1514.57,
    });
  });

  it('returns requested empty months with zero totals and preserved running balance', () => {
    const months = buildCashFlowStatement([], 750, '2026-01-01', ['2026-02']);

    expect(months).toEqual([
      {
        key: '2026-02',
        label: 'Feb 26',
        openingBalance: 750,
        operating: 0,
        investing: 0,
        financing: 0,
        netChange: 0,
        closingBalance: 750,
        lines: [],
      },
    ]);
    expect(buildCashFlowStatement([], 750, '2026-01-01')).toEqual([]);
  });

  it('summarizes cash-flow sections and line totals by absolute line size', () => {
    const summary = buildCashFlowSectionSummary([
      movement({ id: 'in', amount: 300, description: 'Customer paid' }),
      movement({ id: 'out', direction: 'out', amount: 50.555, description: 'Pago servicio software' }),
      movement({ id: 'capex', direction: 'out', amount: 120, description: 'Compra equipo capex' }),
      movement({ id: 'loan', amount: 200, description: 'Prestamo bancario' }),
    ]);

    expect(summary).toEqual([
      {
        sectionKey: 'operating',
        sectionLabel: 'Operación',
        total: 249.45,
        lines: [
          { lineKey: 'collections', lineLabel: 'Cobros operativos', amount: 300 },
          { lineKey: 'operatingPayments', lineLabel: 'Pagos operativos', amount: -50.55 },
        ],
      },
      {
        sectionKey: 'investing',
        sectionLabel: 'Inversión',
        total: -120,
        lines: [{ lineKey: 'capex', lineLabel: 'Capex e inversión', amount: -120 }],
      },
      {
        sectionKey: 'financing',
        sectionLabel: 'Financiación',
        total: 200,
        lines: [{ lineKey: 'financingIn', lineLabel: 'Entradas financieras', amount: 200 }],
      },
    ]);
  });
});

describe('finance statements profit and loss summaries', () => {
  it('builds P&L totals with direct costs, operating expenses, financial result, and capex exclusion', () => {
    const summary = buildProfitLossSummary([
      movement({ amount: 1000, description: 'Customer invoice paid' }),
      movement({ amount: 40, description: 'Reembolso proveedor' }),
      movement({ direction: 'out', amount: 250, description: 'Compra material proyecto', projectName: 'Rollout North' }),
      movement({ direction: 'out', amount: 120, description: 'Salario mensual' }),
      movement({ direction: 'out', amount: 80, description: 'Servicio software saas' }),
      movement({ direction: 'out', amount: 30, description: 'Cuota bancaria préstamo' }),
      movement({ amount: 10, description: 'Interes bancario' }),
      movement({ direction: 'out', amount: 500, description: 'Compra equipo capex' }),
    ]);

    expect(summary).toMatchObject({
      operatingRevenue: 1000,
      otherIncome: 40,
      directCosts: 250,
      payroll: 120,
      services: 80,
      financialIncome: 10,
      financial: 30,
      capexExcluded: 500,
      revenue: 1040,
      grossProfit: 790,
      operatingExpenses: 200,
      operatingResult: 590,
      financialResult: -20,
      netResult: 570,
    });
  });

  it('builds monthly P&L buckets with zero-safe months and month labels', () => {
    const months = buildProfitLossByMonth([
      movement({ amount: 300, postedDate: '2026-04-10', description: 'Customer invoice paid' }),
      movement({ direction: 'out', amount: 100, postedDate: '2026-04-11', description: 'Compra material proyecto', projectName: 'Rollout North' }),
      movement({ direction: 'out', amount: 20, postedDate: '2026-05-05', description: 'Servicio software' }),
    ], ['2026-04', '2026-05', '2026-06']);

    expect(months.map(({ key, label, revenue, directCosts, services, netResult }) => ({
      key,
      label,
      revenue,
      directCosts,
      services,
      netResult,
    }))).toEqual([
      { key: '2026-04', label: 'Abr 26', revenue: 300, directCosts: 100, services: 0, netResult: 200 },
      { key: '2026-05', label: 'May 26', revenue: 0, directCosts: 0, services: 20, netResult: -20 },
      { key: '2026-06', label: 'Jun 26', revenue: 0, directCosts: 0, services: 0, netResult: 0 },
    ]);
  });

  it('normalizes month keys and Spanish short month labels', () => {
    expect(getMonthKey('2026-04-15T10:30:00.000Z')).toBe('2026-04');
    expect(getMonthKey('')).toBeNull();
    expect(getMonthKey(null)).toBeNull();
    expect(getMonthLabel('2026-12')).toBe('Dic 26');
  });
});
