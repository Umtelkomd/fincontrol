import { describe, expect, it } from 'vitest';

import {
  classifyOverheadMovement,
  computePayrollBurdenSplit,
  summarizeOverheadBurdenRate,
} from './overheadBurdenRate.js';

const movement = (postedDate, amount, overrides = {}) => ({
  id: `${postedDate}-${amount}`,
  postedDate,
  direction: 'out',
  status: 'posted',
  amount,
  ...overrides,
});

const snapshotBase = {
  projects: [
    { id: 'oh', code: 'AMD-001', name: 'Overhead', displayName: 'AMD-001 (Overhead)' },
    { id: 'ne4', code: 'NE4', name: 'WestConnect' },
  ],
  costCenters: [
    { id: 'CC-004', code: 'CC-004', name: 'Administrativo' },
    { id: 'CC-008', code: 'CC-008', name: 'Contratistas' },
  ],
};

const payrollPeriods = [
  {
    period: '2026-04',
    lines: [
      { name: 'Romero Lesmes, J.', employerCost: 6000 },
      { name: 'Sandoval Penaranda', employerCost: 3000 },
      { name: 'Herrera Romero, E.', employerCost: 4000 },
      { name: 'Pizarro Zapata, P.', employerCost: 3000 },
    ],
  },
];

describe('computePayrollBurdenSplit', () => {
  it('splits payroll into overhead/admin and direct/campo by employee names', () => {
    const split = computePayrollBurdenSplit(payrollPeriods, { asOfDate: '2026-06-15' });

    expect(split.period).toBe('2026-04');
    expect(split.overheadPayroll).toBe(9000);
    expect(split.directPayroll).toBe(7000);
    expect(split.overheadShare).toBeCloseTo(0.5625);
    expect(split.directShare).toBeCloseTo(0.4375);
  });
});

describe('classifyOverheadMovement', () => {
  it('classifies explicit overhead project as overhead', () => {
    const out = classifyOverheadMovement(
      movement('2026-05-05', 1000, { projectId: 'oh' }),
      {
        projectsById: new Map(snapshotBase.projects.map((p) => [p.id, p])),
        costCentersById: new Map(snapshotBase.costCenters.map((c) => [c.id, c])),
      },
      computePayrollBurdenSplit(payrollPeriods, { asOfDate: '2026-06-15' }),
    );

    expect(out.bucket).toBe('overhead');
  });

  it('classifies direct cost centers as direct costs', () => {
    const out = classifyOverheadMovement(
      movement('2026-05-05', 2000, { costCenterId: 'CC-008', categoryName: 'Subcontratos' }),
      {
        projectsById: new Map(snapshotBase.projects.map((p) => [p.id, p])),
        costCentersById: new Map(snapshotBase.costCenters.map((c) => [c.id, c])),
      },
      computePayrollBurdenSplit(payrollPeriods, { asOfDate: '2026-06-15' }),
    );

    expect(out.bucket).toBe('direct');
  });

  it('excludes VAT/tax movements from operating burden', () => {
    const out = classifyOverheadMovement(
      movement('2026-05-10', 5000, { counterpartyName: 'Finanzamt Stralsund', description: 'Umsatzsteuer Mai' }),
      {
        projectsById: new Map(),
        costCentersById: new Map(),
      },
      null,
    );

    expect(out.bucket).toBe('excluded');
  });

  it('splits payroll-related health insurance by latest payroll ratio', () => {
    const split = computePayrollBurdenSplit(payrollPeriods, { asOfDate: '2026-06-15' });
    const out = classifyOverheadMovement(
      movement('2026-05-15', 1600, { counterpartyName: 'BARMER', description: 'Krankenkasse' }),
      {
        projectsById: new Map(),
        costCentersById: new Map(),
      },
      split,
    );

    expect(out.bucket).toBe('split');
    expect(out.allocations).toEqual([
      { bucket: 'overhead', amount: 900 },
      { bucket: 'direct', amount: 700 },
    ]);
  });
});

describe('summarizeOverheadBurdenRate', () => {
  it('uses only complete months and returns quote-ready burden rates', () => {
    const summary = summarizeOverheadBurdenRate(
      {
        ...snapshotBase,
        payrollPeriods,
        bankMovements: [
          movement('2026-03-05', 1000, { projectId: 'oh' }),
          movement('2026-03-06', 3000, { projectId: 'ne4' }),
          movement('2026-04-01', 500, { counterpartyName: 'BARMER', description: 'Krankenkasse' }),
          movement('2026-04-02', 2000, { categoryName: 'Subcontratos' }),
          movement('2026-05-03', 400, { description: 'sin clasificar' }),
          movement('2026-05-04', 1000, { counterpartyName: 'Finanzamt', description: 'Umsatzsteuer' }),
          movement('2026-06-01', 9999, { projectId: 'oh' }), // current month ignored
        ],
      },
      { asOfDate: '2026-06-15', windowMonths: 5 },
    );

    expect(summary.months).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(summary.totals.direct).toBe(5218.75);
    expect(summary.totals.overhead).toBe(1281.25);
    expect(summary.totals.unknown).toBe(400);
    expect(summary.totals.excluded).toBe(1000);
    expect(summary.rates.baseRatePct).toBe(24.6);
    expect(summary.rates.bufferedRatePct).toBe(32.2);
    expect(summary.rates.internalRatePct).toBe(33);
    expect(summary.rates.recommendedQuoteRatePct).toBe(35);
    expect(summary.rates.directCostMultiplier).toBe(1.35);
  });
});
