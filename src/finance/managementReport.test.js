import { describe, expect, it } from 'vitest';
import {
  computeCashWeeks,
  computeClientConcentration,
  computeDso,
  computeFinancialCosts,
  computeKpis,
  computeMonthlyEbit,
  computeProductionInvoiceLag,
  computeProjectMargins,
  computeTopRisks,
  formatMonthKeyEs,
  lastClosedMonthKey,
  parseIsoWeek,
  projectMarginStatus,
} from './managementReport';

const REF = '2026-07-14';

const movementsJune = [
  {
    direction: 'in',
    amount: 50000,
    postedDate: '2026-06-10',
    projectName: 'NE4 Rossdorf',
    description: 'Abschlagsrechnung Insyte',
    status: 'posted',
  },
  {
    direction: 'out',
    amount: 30000,
    postedDate: '2026-06-15',
    projectName: 'NE4 Rossdorf',
    description: 'Subcontrato soplado',
    status: 'posted',
  },
  {
    direction: 'out',
    amount: 500,
    postedDate: '2026-06-20',
    projectName: '',
    description: 'Bankgebühren Kontoführung',
    status: 'posted',
  },
  {
    direction: 'out',
    amount: 5000,
    postedDate: '2026-06-18',
    projectName: '',
    description: 'Finanzamt Umsatzsteuer Mai',
    status: 'posted',
  },
];

const receivablesSynthetic = [
  {
    status: 'issued',
    openAmount: 10000,
    grossAmount: 10000,
    issueDate: '2026-06-25',
    dueDate: '2026-06-30',
    counterpartyName: 'Insyte',
    productionWeekRef: '2026-W25',
  },
  {
    status: 'settled',
    openAmount: 0,
    grossAmount: 40000,
    issueDate: '2026-05-10',
    dueDate: '2026-06-10',
    counterpartyName: 'Insyte',
  },
  {
    status: 'issued',
    openAmount: 2000,
    grossAmount: 2000,
    issueDate: '2026-07-01',
    dueDate: '2026-08-01',
    counterpartyName: 'Stadtwerke',
  },
];

describe('parseIsoWeek', () => {
  it('parses a regular week (Mon–Sun)', () => {
    const week = parseIsoWeek('2026-W28');
    expect(week).toMatchObject({ year: 2026, week: 28 });
    expect(week.startIso).toBe('2026-07-06');
    expect(week.endIso).toBe('2026-07-12');
  });

  it('handles week 1 spilling into the previous year', () => {
    const week = parseIsoWeek('2026-W01');
    expect(week.startIso).toBe('2025-12-29');
    expect(week.endIso).toBe('2026-01-04');
  });

  it('rejects malformed refs', () => {
    expect(parseIsoWeek('')).toBeNull();
    expect(parseIsoWeek(null)).toBeNull();
    expect(parseIsoWeek('2026W28')).toBeNull();
    expect(parseIsoWeek('2026-W60')).toBeNull();
  });
});

describe('lastClosedMonthKey / formatMonthKeyEs', () => {
  it('returns the previous calendar month', () => {
    expect(lastClosedMonthKey('2026-07-14')).toBe('2026-06');
    expect(lastClosedMonthKey('2026-01-15')).toBe('2025-12');
  });

  it('formats month keys in Spanish and tolerates garbage', () => {
    expect(formatMonthKeyEs('2026-06')).toContain('2026');
    expect(formatMonthKeyEs('not-a-month')).toBe('—');
  });
});

describe('computeProjectMargins', () => {
  it('groups revenue vs cost per project and computes margin', () => {
    const margins = computeProjectMargins(movementsJune);
    expect(margins).toHaveLength(1);
    expect(margins[0]).toMatchObject({
      name: 'NE4 Rossdorf',
      revenue: 50000,
      cost: 30000,
      net: 20000,
      marginPct: 40,
    });
  });

  it('excludes unassigned projects and pre-2026 movements', () => {
    const margins = computeProjectMargins([
      { direction: 'in', amount: 100, postedDate: '2025-11-01', projectName: 'Vieja obra' },
      { direction: 'in', amount: 100, postedDate: '2026-02-01', projectName: 'Sin proyecto' },
      { direction: 'in', amount: 100, postedDate: '2026-02-01', projectName: '' },
    ]);
    expect(margins).toHaveLength(0);
  });

  it('returns empty array on empty input', () => {
    expect(computeProjectMargins([])).toEqual([]);
    expect(computeProjectMargins()).toEqual([]);
  });

  it('folds allocated payroll cost into the project cost basis', () => {
    const margins = computeProjectMargins(movementsJune, {
      payrollByProject: { 'NE4 Rossdorf': 5000 },
    });
    expect(margins[0]).toMatchObject({
      name: 'NE4 Rossdorf',
      revenue: 50000,
      cost: 35000, // 30000 movement cost + 5000 payroll
      net: 15000,
      marginPct: 30,
    });
  });

  it('projectMarginStatus applies objetivo/alarma thresholds', () => {
    expect(projectMarginStatus(30)).toBe('ok');
    expect(projectMarginStatus(20)).toBe('warn');
    expect(projectMarginStatus(10)).toBe('alarm');
    expect(projectMarginStatus(null)).toBe('n/a');
  });
});

describe('computeDso', () => {
  it('computes open AR against trailing-window sales', () => {
    const dso = computeDso(receivablesSynthetic, { referenceDate: REF });
    // open 12.000 / (52.000 / 90d) ≈ 20,8 → 21
    expect(dso.openAr).toBe(12000);
    expect(dso.windowSales).toBe(52000);
    expect(dso.dsoDays).toBe(21);
  });

  it('returns null DSO without sales in the window', () => {
    expect(computeDso([], { referenceDate: REF }).dsoDays).toBeNull();
    const stale = computeDso(
      [{ status: 'issued', openAmount: 500, grossAmount: 500, issueDate: '2024-01-01' }],
      { referenceDate: REF },
    );
    expect(stale.dsoDays).toBeNull();
    expect(stale.openAr).toBe(500);
  });
});

describe('computeProductionInvoiceLag', () => {
  it('averages days between production-week end and issueDate', () => {
    // 2026-W25 ends 2026-06-21; issued 2026-06-25 → 4 days
    const lag = computeProductionInvoiceLag(receivablesSynthetic, { referenceDate: REF });
    expect(lag.count).toBe(1);
    expect(lag.avgLagDays).toBe(4);
    expect(lag.maxLagDays).toBe(4);
  });

  it('clamps invoices issued during the production week to 0', () => {
    const lag = computeProductionInvoiceLag(
      [{ status: 'issued', issueDate: '2026-06-18', productionWeekRef: '2026-W25' }],
      { referenceDate: REF },
    );
    expect(lag.avgLagDays).toBe(0);
  });

  it('returns n/a shape when no receivable carries productionWeekRef', () => {
    const lag = computeProductionInvoiceLag(
      [{ status: 'issued', issueDate: '2026-06-18' }],
      { referenceDate: REF },
    );
    expect(lag).toEqual({ avgLagDays: null, maxLagDays: null, count: 0 });
  });
});

describe('computeClientConcentration', () => {
  it('computes top/second client shares over 12 months', () => {
    const result = computeClientConcentration(receivablesSynthetic, { referenceDate: REF });
    expect(result.topClient).toBe('Insyte');
    expect(result.topSharePct).toBeCloseTo(96.15, 1);
    expect(result.secondClient).toBe('Stadtwerke');
    expect(result.clientCount).toBe(2);
  });

  it('flags a single-client book', () => {
    const result = computeClientConcentration(
      [{ status: 'issued', grossAmount: 1000, issueDate: '2026-06-01', counterpartyName: 'Insyte' }],
      { referenceDate: REF },
    );
    expect(result.clientCount).toBe(1);
    expect(result.topSharePct).toBe(100);
    expect(result.secondClient).toBeNull();
  });

  it('handles empty input', () => {
    const result = computeClientConcentration([], { referenceDate: REF });
    expect(result.totalRevenue).toBe(0);
    expect(result.topSharePct).toBeNull();
  });
});

describe('computeCashWeeks', () => {
  it('derives weeks of coverage from monthly outflows', () => {
    // 26.000 × 12 / 52 = 6.000/sem → 30.000 / 6.000 = 5 semanas
    const result = computeCashWeeks({ currentCash: 30000, avgMonthlyOutflows: 26000 });
    expect(result.weeklyBurn).toBe(6000);
    expect(result.weeks).toBe(5);
  });

  it('returns null without burn data', () => {
    expect(computeCashWeeks({ currentCash: 30000, avgMonthlyOutflows: 0 }).weeks).toBeNull();
    expect(computeCashWeeks({ currentCash: null, avgMonthlyOutflows: 26000 }).weeks).toBeNull();
    expect(computeCashWeeks().weeks).toBeNull();
  });
});

describe('computeMonthlyEbit / computeFinancialCosts', () => {
  it('excludes VAT, financing and bank fees from EBIT', () => {
    const ebit = computeMonthlyEbit(movementsJune, { monthKey: '2026-06' });
    expect(ebit.sales).toBe(50000);
    expect(ebit.costs).toBe(30000);
    expect(ebit.ebit).toBe(20000);
    expect(ebit.ebitPct).toBe(40);
  });

  it('only counts movements of the requested month', () => {
    const ebit = computeMonthlyEbit(
      [...movementsJune, { direction: 'in', amount: 99999, postedDate: '2026-05-31' }],
      { monthKey: '2026-06' },
    );
    expect(ebit.sales).toBe(50000);
  });

  it('captures bank fees as financial costs (% of sales)', () => {
    const fin = computeFinancialCosts(movementsJune, { monthKey: '2026-06' });
    expect(fin.financialCosts).toBe(500);
    expect(fin.pct).toBe(1);
  });

  it('returns null pct when the month has no sales', () => {
    const fin = computeFinancialCosts([], { monthKey: '2026-06' });
    expect(fin.pct).toBeNull();
    expect(computeMonthlyEbit([], { monthKey: '2026-06' }).ebitPct).toBeNull();
  });
});

describe('computeKpis', () => {
  it('returns the 7 KPIs with coherent statuses on synthetic data', () => {
    const kpis = computeKpis({
      receivables: receivablesSynthetic,
      movements: movementsJune,
      currentCash: 30000,
      avgMonthlyOutflows: 26000,
      weeklyProjection: [],
      referenceDate: REF,
    });
    expect(kpis).toHaveLength(7);
    const byKey = Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));

    expect(byKey.projectMargin.status).toBe('ok'); // 40% ≥ 25%
    expect(byKey.ebitMonthly.status).toBe('ok'); // 40% ≥ 10%
    expect(byKey.productionInvoiceLag.status).toBe('ok'); // 4d ≤ 7d
    expect(byKey.dso.status).toBe('ok'); // 21d ≤ 45d
    expect(byKey.cashWeeks.status).toBe('warn'); // 5 sem entre 3 y 6
    expect(byKey.clientConcentration.status).toBe('warn'); // 96% > 60% con 2º cliente
    expect(byKey.financialCosts.status).toBe('ok'); // 1% ≤ 1%
  });

  it('degrades to n/a on empty data — never NaN', () => {
    const kpis = computeKpis({ referenceDate: REF });
    expect(kpis).toHaveLength(7);
    for (const kpi of kpis) {
      expect(kpi.status).toBe('n/a');
      expect(kpi.formatted).toBe('—');
      expect(typeof kpi.detail).toBe('string');
      expect(kpi.detail).not.toContain('NaN');
    }
  });

  it('marks single-client revenue as alarm (sin 2º cliente)', () => {
    const kpis = computeKpis({
      receivables: [
        { status: 'issued', grossAmount: 1000, openAmount: 1000, issueDate: '2026-06-01', counterpartyName: 'Insyte' },
      ],
      referenceDate: REF,
    });
    const concentration = kpis.find((kpi) => kpi.key === 'clientConcentration');
    expect(concentration.status).toBe('alarm');
  });
});

describe('computeTopRisks', () => {
  const riskInput = {
    receivables: receivablesSynthetic,
    payables: [
      {
        status: 'issued',
        openAmount: 8000,
        opsGateRequired: true,
        opsCleared: false,
        counterpartyName: 'Melgarejo',
        dueDate: '2026-08-01',
      },
    ],
    partners: [{ type: 'vendor', name: 'Melgarejo', status: 'active' }],
    currentCash: 30000,
    avgMonthlyOutflows: 26000,
    weeklyProjection: [
      { week: 'W1', projectedBalance: 5000, label: '14 jul - 20 jul' },
      { week: 'W2', projectedBalance: -2000, label: '21 jul - 27 jul' },
    ],
    referenceDate: REF,
  };

  it('ranks critical risks first, then by exposure', () => {
    const risks = computeTopRisks(riskInput);
    const keys = risks.map((risk) => risk.key);

    expect(risks[0].key).toBe('projection-negative');
    expect(risks[0].severity).toBe('critical');
    expect(risks[1].key).toBe('cash-runway'); // high, €30.000 > compliance €8.000
    expect(keys).toContain('partner-compliance');
    expect(keys).toContain('cxp-ops-uncleared');
    expect(keys).toContain('overdue-receivables');
    expect(keys).toContain('client-concentration');
  });

  it('detects CXP without validated production and compliance exposure', () => {
    const risks = computeTopRisks(riskInput);
    const ops = risks.find((risk) => risk.key === 'cxp-ops-uncleared');
    expect(ops.amount).toBe(8000);
    expect(ops.severity).toBe('medium'); // 8.000 ≤ 10.000

    const compliance = risks.find((risk) => risk.key === 'partner-compliance');
    expect(compliance.severity).toBe('high');
    expect(compliance.amount).toBe(8000); // open CXP to Melgarejo
    expect(compliance.detail).toContain('Melgarejo');
  });

  it('flags negative cash as critical', () => {
    const risks = computeTopRisks({ currentCash: -500, avgMonthlyOutflows: 1000, referenceDate: REF });
    expect(risks[0].key).toBe('cash-negative');
    expect(risks[0].severity).toBe('critical');
  });

  it('returns an empty list with no data', () => {
    expect(computeTopRisks({ referenceDate: REF })).toEqual([]);
    expect(computeTopRisks()).toEqual([]);
  });

  it('every risk carries a formatted amount', () => {
    for (const risk of computeTopRisks(riskInput)) {
      expect(typeof risk.formattedAmount).toBe('string');
      expect(risk.formattedAmount).not.toContain('NaN');
      expect(['critical', 'high', 'medium']).toContain(risk.severity);
    }
  });
});
