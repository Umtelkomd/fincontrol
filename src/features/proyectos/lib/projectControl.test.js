/**
 * Unit tests for projectControl.js — pure PMP cost-control math, no mocks.
 *
 * Vitest API. Pure-function tests use plain object factories, frozen dates,
 * no Firestore, and no React. Money assertions use toBeCloseTo(x, 5).
 */

import { describe, expect, it } from 'vitest';

import { allocatePayrollCost } from '../../nominas/lib/payrollAllocation.js';
import {
  buildProjectIndex,
  resolveEntryKey,
  buildProjectActuals,
  computeEvm,
  buildOverheadPool,
  allocateOverhead,
  computeUnallocatedLabor,
  buildControlRows,
  computePortfolioSummary,
  buildCostCurve,
  buildOverheadComposition,
  __internal,
} from './projectControl.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
const PROJECTS = [
  {
    id: 'p-alpha',
    code: 'ALP',
    name: 'Alpha',
    displayName: 'ALP (Alpha)',
    status: 'active',
    operator: 'INSYTE',
    contractValue: 120000,
    budget: 100000,
    percentComplete: 50,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  },
  {
    id: 'p-beta',
    code: 'BET',
    name: 'Beta',
    displayName: 'BET (Beta)',
    status: 'active',
    operator: 'VANCOM',
    budget: 0,
  },
  {
    id: 'p-old',
    code: 'OLD',
    name: 'Oldie',
    displayName: 'OLD (Oldie)',
    status: 'inactive',
  },
];

const index = () => buildProjectIndex(PROJECTS);

// ── buildProjectIndex ────────────────────────────────────────────────────────
describe('buildProjectIndex', () => {
  it('indexes by id and by lowercased name, displayName and code', () => {
    const { byId, byName } = index();
    expect(byId.get('p-alpha').code).toBe('ALP');
    expect(byName.get('alpha').id).toBe('p-alpha');
    expect(byName.get('alp (alpha)').id).toBe('p-alpha');
    expect(byName.get('alp').id).toBe('p-alpha');
  });

  it('skips empty name fragments and tolerates missing input', () => {
    const { byId, byName } = buildProjectIndex([{ id: 'x', name: '', code: null }]);
    expect(byId.size).toBe(1);
    expect(byName.size).toBe(0);
    expect(buildProjectIndex().byId.size).toBe(0);
  });
});

// ── resolveEntryKey ──────────────────────────────────────────────────────────
describe('resolveEntryKey', () => {
  it('resolves a canonical projectId to the project bucket', () => {
    const res = resolveEntryKey({ projectId: 'p-alpha' }, index());
    expect(res).toMatchObject({ key: 'p-alpha', projectId: 'p-alpha', bucket: 'project' });
  });

  it('resolves legacy name strings (name / displayName / code, case + spaces) to the SAME key', () => {
    const idx = index();
    const byId = resolveEntryKey({ projectId: 'p-alpha' }, idx);
    expect(resolveEntryKey({ projectName: 'Alpha' }, idx).key).toBe(byId.key);
    expect(resolveEntryKey({ projectName: '  alp (alpha) ' }, idx).key).toBe(byId.key);
    expect(resolveEntryKey({ projectName: 'ALP' }, idx).key).toBe(byId.key);
  });

  it('falls back to name resolution when projectId is stale (deleted project)', () => {
    const res = resolveEntryKey({ projectId: 'deleted-id', projectName: 'Beta' }, index());
    expect(res).toMatchObject({ key: 'p-beta', bucket: 'project' });
  });

  it("maps empty / 'Sin proyecto' / legacy 'General / Overhead' to the overhead bucket", () => {
    const idx = index();
    expect(resolveEntryKey({}, idx)).toMatchObject({ key: '__overhead__', bucket: 'overhead', projectId: null });
    expect(resolveEntryKey({ projectName: 'Sin proyecto' }, idx).bucket).toBe('overhead');
    expect(resolveEntryKey({ projectName: ' general / overhead ' }, idx).bucket).toBe('overhead');
  });

  it('keeps unresolved non-empty names as their own unknown-bucket key (data quality)', () => {
    const res = resolveEntryKey({ projectName: 'Misterio 3000' }, index());
    expect(res).toMatchObject({ key: 'name:misterio 3000', bucket: 'unknown', projectId: null });
    expect(res.name).toBe('Misterio 3000');
  });
});

// ── buildProjectActuals ──────────────────────────────────────────────────────
describe('buildProjectActuals', () => {
  it('groups canonical (projectId) and legacy (name string) docs into the SAME row', () => {
    const actuals = buildProjectActuals({
      movements: [
        { projectId: 'p-alpha', direction: 'in', amount: 10000 },
        { projectName: 'ALP (Alpha)', direction: 'in', amount: 5000 },
        { projectName: 'alpha', direction: 'out', amount: 2000 },
      ],
      projects: PROJECTS,
    });
    const alpha = actuals.get('p-alpha');
    expect(alpha.cashIn).toBeCloseTo(15000, 5);
    expect(alpha.cashOut).toBeCloseTo(2000, 5);
    // Only one row for Alpha — no name-vs-id split.
    const alphaRows = Array.from(actuals.values()).filter((r) => r.projectId === 'p-alpha');
    expect(alphaRows).toHaveLength(1);
  });

  it('adds only openAmount for receivables/payables (paid portion already counted as movements)', () => {
    const actuals = buildProjectActuals({
      movements: [{ projectId: 'p-alpha', direction: 'out', amount: 600 }],
      payables: [
        { projectId: 'p-alpha', status: 'partial', grossAmount: 1000, paidAmount: 600, openAmount: 400 },
      ],
      receivables: [
        { projectId: 'p-alpha', status: 'partial', grossAmount: 2000, paidAmount: 500, openAmount: 1500 },
      ],
      projects: PROJECTS,
    });
    const alpha = actuals.get('p-alpha');
    expect(alpha.openPayables).toBeCloseTo(400, 5);
    expect(alpha.openReceivables).toBeCloseTo(1500, 5);
    // Accrual AC counts the invoice exactly once: 600 paid (cash) + 400 open.
    expect(alpha.directCost).toBeCloseTo(1000, 5);
  });

  it('excludes cancelled receivables and payables', () => {
    const actuals = buildProjectActuals({
      movements: [{ projectId: 'p-alpha', direction: 'in', amount: 100 }],
      receivables: [{ projectId: 'p-alpha', status: 'cancelled', openAmount: 900 }],
      payables: [{ projectId: 'p-alpha', status: 'cancelled', openAmount: 700 }],
      projects: PROJECTS,
    });
    const alpha = actuals.get('p-alpha');
    expect(alpha.openReceivables).toBe(0);
    expect(alpha.openPayables).toBe(0);
    // Cancelled-only docs must not even materialize a row.
    expect(actuals.get('p-beta')).toBeUndefined();
  });

  it('resolves name-keyed payroll allocation into the right row labor', () => {
    const actuals = buildProjectActuals({
      projects: PROJECTS,
      payrollByProject: { Alpha: 3000, 'p-beta': 1200, Fantasma: 500 },
    });
    expect(actuals.get('p-alpha').labor).toBeCloseTo(3000, 5);
    // Id fallback keys (employee.projectIds not in projectNamesById) also resolve.
    expect(actuals.get('p-beta').labor).toBeCloseTo(1200, 5);
    // Unresolved payroll keys surface as unknown rows, never silently dropped.
    expect(actuals.get('name:fantasma').labor).toBeCloseTo(500, 5);
    expect(actuals.get('name:fantasma').bucket).toBe('unknown');
  });

  it('derives directCost (accrual AC) and revenueAccrued', () => {
    const actuals = buildProjectActuals({
      movements: [
        { projectId: 'p-alpha', direction: 'in', amount: 8000 },
        { projectId: 'p-alpha', direction: 'out', amount: 3000 },
      ],
      receivables: [{ projectId: 'p-alpha', status: 'issued', openAmount: 2000 }],
      payables: [{ projectId: 'p-alpha', status: 'issued', openAmount: 1000 }],
      projects: PROJECTS,
      payrollByProject: { Alpha: 500 },
    });
    const alpha = actuals.get('p-alpha');
    expect(alpha.directCost).toBeCloseTo(3000 + 1000 + 500, 5);
    expect(alpha.revenueAccrued).toBeCloseTo(8000 + 2000, 5);
  });

  it('id-keyed payroll lands on the right project even when two projects share a name', () => {
    const dupProjects = [
      { id: 'p-dup1', code: 'D1', name: 'Duplicado', status: 'active' },
      { id: 'p-dup2', code: 'D2', name: 'Duplicado', status: 'active' },
    ];
    const actuals = buildProjectActuals({
      projects: dupProjects,
      payrollByProject: { 'p-dup2': 1500 },
    });
    // Name-keyed resolution would collapse onto the FIRST 'Duplicado' match —
    // the id-first path must credit the actual assigned project.
    expect(actuals.get('p-dup2').labor).toBeCloseTo(1500, 5);
    expect(actuals.get('p-dup1')).toBeUndefined();
  });

  it("accumulates 'Sin proyecto' spend into the overhead bucket row", () => {
    const actuals = buildProjectActuals({
      movements: [{ projectName: 'Sin proyecto', direction: 'out', amount: 750 }],
      projects: PROJECTS,
    });
    const overhead = actuals.get('__overhead__');
    expect(overhead.bucket).toBe('overhead');
    expect(overhead.cashOut).toBeCloseTo(750, 5);
    expect(overhead.directCost).toBeCloseTo(750, 5);
  });
});

// ── computeEvm ───────────────────────────────────────────────────────────────
describe('computeEvm', () => {
  const base = {
    bac: 100000,
    percentComplete: 50,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    asOf: '2026-07-02', // exact midpoint of 364-day window → pv = bac / 2
    actualCost: 40000,
  };

  it('computes the full EVM set on the happy path', () => {
    const evm = computeEvm(base);
    expect(evm.ev).toBeCloseTo(50000, 5);
    expect(evm.pv).toBeCloseTo(50000, 5);
    expect(evm.ac).toBeCloseTo(40000, 5);
    expect(evm.cpi).toBeCloseTo(1.25, 5);
    expect(evm.spi).toBeCloseTo(1, 5);
    expect(evm.cv).toBeCloseTo(10000, 5);
    expect(evm.sv).toBeCloseTo(0, 5);
    expect(evm.eac).toBeCloseTo(80000, 5);
    expect(evm.etc).toBeCloseTo(40000, 5);
    expect(evm.vac).toBeCloseTo(20000, 5);
    expect(evm.percentSpent).toBeCloseTo(40, 5);
  });

  it('bac <= 0 → everything null except ac (and percentSpent null)', () => {
    const evm = computeEvm({ ...base, bac: 0 });
    expect(evm.ac).toBeCloseTo(40000, 5);
    ['pv', 'ev', 'cpi', 'spi', 'cv', 'sv', 'eac', 'etc', 'vac', 'percentSpent'].forEach((k) => {
      expect(evm[k]).toBeNull();
    });
  });

  it('missing or invalid dates → pv, spi, sv null', () => {
    const evm = computeEvm({ ...base, startDate: '', endDate: null });
    expect(evm.pv).toBeNull();
    expect(evm.spi).toBeNull();
    expect(evm.sv).toBeNull();
    expect(evm.ev).toBeCloseTo(50000, 5); // ev unaffected
    const inverted = computeEvm({ ...base, startDate: '2026-12-31', endDate: '2026-01-01' });
    expect(inverted.pv).toBeNull();
  });

  it('clamps pv to [0, bac] outside the schedule window', () => {
    expect(computeEvm({ ...base, asOf: '2025-06-01' }).pv).toBeCloseTo(0, 5);
    expect(computeEvm({ ...base, asOf: '2027-06-01' }).pv).toBeCloseTo(100000, 5);
    // pv === 0 → spi null (guarded division)
    expect(computeEvm({ ...base, asOf: '2025-06-01' }).spi).toBeNull();
  });

  it('clamps percentComplete to [0, 100]', () => {
    expect(computeEvm({ ...base, percentComplete: 150 }).ev).toBeCloseTo(100000, 5);
    expect(computeEvm({ ...base, percentComplete: -10 }).ev).toBeCloseTo(0, 5);
  });

  it('ac === 0 → cpi null but eac falls back to bac (no burn yet, plan holds)', () => {
    const evm = computeEvm({ ...base, actualCost: 0 });
    expect(evm.cpi).toBeNull();
    expect(evm.eac).toBeCloseTo(100000, 5);
    expect(evm.etc).toBeCloseTo(100000, 5);
    expect(evm.vac).toBeCloseTo(0, 5);
    expect(evm.percentSpent).toBeCloseTo(0, 5);
  });

  it('ev 0 with ac > 0 → cpi 0 and eac null (cannot forecast), never NaN/Infinity', () => {
    const evm = computeEvm({ ...base, percentComplete: 0 });
    expect(evm.cpi).toBe(0);
    expect(evm.eac).toBeNull();
    expect(evm.etc).toBeNull();
    expect(evm.vac).toBeNull();
    Object.values(evm).forEach((v) => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    });
  });
});

// ── computeUnallocatedLabor ──────────────────────────────────────────────────
describe('computeUnallocatedLabor', () => {
  const periods = [
    {
      period: '2026-05',
      lines: [
        { employeeId: 'e1', gesamtkosten: 1000.34 },
        { employeeId: 'e2', gesamtkosten: 500.1 },
        { employeeId: 'ghost', gesamtkosten: 99.99 },
        { employeeId: 'e1', gesamtkosten: 0 },
      ],
    },
  ];
  const employeesById = {
    e1: { projectIds: ['p-alpha', 'p-beta'] },
    e2: { projectIds: [] },
  };

  it('sums lines whose employee is missing or has empty projectIds', () => {
    expect(computeUnallocatedLabor({ periods, employeesById })).toBeCloseTo(600.09, 5);
  });

  it('conservation: allocated (allocatePayrollCost) + unallocated === total payroll', () => {
    const { byProject } = allocatePayrollCost({ periods, employeesById });
    const allocated = Object.values(byProject).reduce((s, v) => s + v, 0);
    const unallocated = computeUnallocatedLabor({ periods, employeesById });
    expect(allocated + unallocated).toBeCloseTo(1000.34 + 500.1 + 99.99, 2);
  });

  it('tolerates empty input', () => {
    expect(computeUnallocatedLabor({})).toBe(0);
    expect(computeUnallocatedLabor({ periods: [], employeesById: {} })).toBe(0);
  });
});

// ── buildOverheadPool ────────────────────────────────────────────────────────
describe('buildOverheadPool', () => {
  it('pool = overhead-bucket directCost + unallocated labor', () => {
    const actuals = buildProjectActuals({
      movements: [{ projectName: 'Sin proyecto', direction: 'out', amount: 800 }],
      payables: [{ projectName: '', status: 'issued', openAmount: 200 }],
      projects: PROJECTS,
    });
    const pool = buildOverheadPool({ actuals, unallocatedLabor: 500 });
    expect(pool.indirectCosts).toBeCloseTo(1000, 5);
    expect(pool.unallocatedLabor).toBeCloseTo(500, 5);
    expect(pool.total).toBeCloseTo(1500, 5);
  });

  it('missing overhead row → indirect 0', () => {
    const pool = buildOverheadPool({ actuals: new Map(), unallocatedLabor: 0 });
    expect(pool).toEqual({ total: 0, indirectCosts: 0, unallocatedLabor: 0 });
  });
});

// ── allocateOverhead ─────────────────────────────────────────────────────────
describe('allocateOverhead', () => {
  const rows = [
    { key: 'p-alpha', bucket: 'project', directCost: 6000, revenueAccrued: 10000 },
    { key: 'p-beta', bucket: 'project', directCost: 4000, revenueAccrued: 0 },
    { key: 'name:misterio', bucket: 'unknown', directCost: 5000, revenueAccrued: 5000 },
    { key: '__overhead__', bucket: 'overhead', directCost: 1000, revenueAccrued: 0 },
  ];

  it('allocates proportionally over directCost; only project rows absorb', () => {
    const { rate, base, byKey } = allocateOverhead({ pool: 1000, rows, basis: 'directCost' });
    expect(base).toBeCloseTo(10000, 5);
    expect(rate).toBeCloseTo(0.1, 5);
    expect(byKey.get('p-alpha')).toBeCloseTo(600, 5);
    expect(byKey.get('p-beta')).toBeCloseTo(400, 5);
    expect(byKey.has('name:misterio')).toBe(false);
    expect(byKey.has('__overhead__')).toBe(false);
    // Fully distributed — nothing lost, nothing invented.
    const sum = Array.from(byKey.values()).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1000, 5);
  });

  it("basis 'revenue' uses revenueAccrued as the base measure", () => {
    const { rate, byKey } = allocateOverhead({ pool: 1000, rows, basis: 'revenue' });
    expect(rate).toBeCloseTo(0.1, 5);
    expect(byKey.get('p-alpha')).toBeCloseTo(1000, 5);
    expect(byKey.get('p-beta')).toBeCloseTo(0, 5);
  });

  it('zero base → rate 0 and empty allocations (no division blow-up)', () => {
    const { rate, base, byKey } = allocateOverhead({
      pool: 1000,
      rows: [{ key: 'p-alpha', bucket: 'project', directCost: 0, revenueAccrued: 0 }],
      basis: 'directCost',
    });
    expect(base).toBe(0);
    expect(rate).toBe(0);
    expect(byKey.size).toBe(0);
  });
});

// ── buildControlRows ─────────────────────────────────────────────────────────
describe('buildControlRows', () => {
  const asOf = '2026-07-02';

  const makeRows = ({ movements = [], receivables = [], payables = [], projects = PROJECTS, payrollByProject = {}, overhead } = {}) => {
    const actuals = buildProjectActuals({ movements, receivables, payables, projects, payrollByProject });
    return buildControlRows({ actuals, projects, overhead, asOf });
  };

  it('joins project meta, actuals, EVM and margins', () => {
    const rows = makeRows({
      movements: [
        { projectId: 'p-alpha', direction: 'in', amount: 60000 },
        { projectId: 'p-alpha', direction: 'out', amount: 40000 },
      ],
      overhead: { rate: 0.1, base: 40000, byKey: new Map([['p-alpha', 4000]]) },
    });
    const alpha = rows.find((r) => r.key === 'p-alpha');
    expect(alpha.code).toBe('ALP');
    expect(alpha.contractValue).toBe(120000);
    expect(alpha.bac).toBe(100000);
    expect(alpha.evm.ev).toBeCloseTo(50000, 5);
    expect(alpha.evm.cpi).toBeCloseTo(50000 / 40000, 5);
    // marginPlanned = (120000 - 100000) / 120000
    expect(alpha.marginPlanned).toBeCloseTo(1 / 6, 5);
    expect(alpha.grossMarginToDate).toBeCloseTo((60000 - 40000) / 60000, 5);
    expect(alpha.overheadAllocated).toBeCloseTo(4000, 5);
    expect(alpha.burdenedCost).toBeCloseTo(44000, 5);
    expect(alpha.netMarginToDate).toBeCloseTo((60000 - 44000) / 60000, 5);
    // eac = bac / cpi = 100000 / 1.25 = 80000 → forecast = (120000 - 80000) / 120000
    expect(alpha.marginForecast).toBeCloseTo(40000 / 120000, 5);
  });

  it('marginForecast falls back to marginPlanned when eac is null (ev 0 with spend)', () => {
    const projects = [{ ...PROJECTS[0], percentComplete: 0 }];
    const rows = makeRows({
      projects,
      movements: [{ projectId: 'p-alpha', direction: 'out', amount: 5000 }],
    });
    const alpha = rows.find((r) => r.key === 'p-alpha');
    expect(alpha.evm.eac).toBeNull();
    expect(alpha.marginForecast).toBeCloseTo(alpha.marginPlanned, 5);
  });

  it('projects with no actuals still get a row (zeros, neutral health)', () => {
    const rows = makeRows({});
    const oldie = rows.find((r) => r.key === 'p-old');
    expect(oldie).toBeTruthy();
    expect(oldie.directCost).toBe(0);
    expect(oldie.health).toBe('neutral');
  });

  describe('health thresholds (boundaries)', () => {
    // Helper: one project with tunable bac/pct + movements to shape cpi/margins.
    const healthOf = ({ bac, pct, cashIn, cashOut }) => {
      const projects = [{ id: 'p-h', name: 'H', code: 'H', status: 'active', budget: bac, percentComplete: pct }];
      const rows = makeRows({
        projects,
        movements: [
          { projectId: 'p-h', direction: 'in', amount: cashIn },
          { projectId: 'p-h', direction: 'out', amount: cashOut },
        ],
      });
      return rows.find((r) => r.key === 'p-h');
    };

    it("cpi < 0.85 → 'err' with Spanish reason", () => {
      // ev = 40000, ac = 50000 → cpi 0.8
      const row = healthOf({ bac: 100000, pct: 40, cashIn: 200000, cashOut: 50000 });
      expect(row.evm.cpi).toBeCloseTo(0.8, 5);
      expect(row.health).toBe('err');
      expect(row.healthReasons).toContain('CPI crítico');
    });

    it("cpi exactly 0.85 → not err, but warn (cpi < 0.97)", () => {
      // ev = 8500, ac = 10000 → cpi 0.85
      const row = healthOf({ bac: 10000, pct: 85, cashIn: 100000, cashOut: 10000 });
      expect(row.evm.cpi).toBeCloseTo(0.85, 5);
      expect(row.health).toBe('warn');
      expect(row.healthReasons).toContain('CPI bajo');
    });

    it("netMarginToDate < 0 → 'err'", () => {
      // Healthy cpi (1.0) but costs above revenue.
      const row = healthOf({ bac: 100000, pct: 50, cashIn: 10000, cashOut: 50000 });
      expect(row.evm.cpi).toBeCloseTo(1, 5);
      expect(row.health).toBe('err');
      expect(row.healthReasons).toContain('Margen neto negativo');
    });

    it("gross margin below MARGIN_WARNING_PERCENT (20) → 'warn'", () => {
      // cpi = 1.0; gross = (10000 - 8100) / 10000 = 19%
      const row = healthOf({ bac: 10000, pct: 81, cashIn: 10000, cashOut: 8100 });
      expect(row.evm.cpi).toBeCloseTo(1, 5);
      expect(row.health).toBe('warn');
      expect(row.healthReasons).toContain('Margen bruto bajo');
    });

    it("gross margin exactly 20% with healthy cpi → 'ok'", () => {
      // cpi = 1.0; gross = (10000 - 8000) / 10000 = 20%
      const row = healthOf({ bac: 10000, pct: 80, cashIn: 10000, cashOut: 8000 });
      expect(row.health).toBe('ok');
    });

    it("no usable data → 'neutral'", () => {
      const projects = [{ id: 'p-n', name: 'N', code: 'N', status: 'active' }];
      const rows = makeRows({ projects });
      expect(rows.find((r) => r.key === 'p-n').health).toBe('neutral');
    });
  });

  it('marginPlanned is null when a contract exists but the cost budget is not loaded (bac 0)', () => {
    const projects = [
      { id: 'p-c', name: 'C', code: 'C', status: 'active', contractValue: 150000, budget: 0 },
    ];
    const rows = makeRows({ projects });
    const row = rows.find((r) => r.key === 'p-c');
    // (150000 - 0) / 150000 would read as a fake 100% planned margin.
    expect(row.marginPlanned).toBeNull();
    expect(row.marginForecast).toBeNull();
  });

  it('includeEvm:false nulls every EVM-derived field and computes health from margins only', () => {
    const projects = [
      {
        id: 'p-y', code: 'Y', name: 'Y', status: 'active',
        contractValue: 120000, budget: 100000, percentComplete: 40,
        startDate: '2026-01-01', endDate: '2026-12-31',
      },
    ];
    const movements = [
      { projectId: 'p-y', direction: 'in', amount: 60000 },
      { projectId: 'p-y', direction: 'out', amount: 50000 },
    ];
    // Sanity with EVM on: ev 40000 vs ac 50000 → cpi 0.8 → err.
    const withEvm = makeRows({ projects, movements }).find((r) => r.key === 'p-y');
    expect(withEvm.evm.cpi).toBeCloseTo(0.8, 5);
    expect(withEvm.health).toBe('err');

    const actuals = buildProjectActuals({ movements, projects });
    const row = buildControlRows({ actuals, projects, asOf, includeEvm: false })
      .find((r) => r.key === 'p-y');
    ['pv', 'ev', 'cpi', 'spi', 'cv', 'sv', 'eac', 'etc', 'vac', 'percentSpent'].forEach((k) => {
      expect(row.evm[k]).toBeNull();
    });
    expect(row.evm.ac).toBeCloseTo(50000, 5);
    // Forecast is EVM-derived (EAC) — null too, no silent fallback to plan.
    expect(row.marginForecast).toBeNull();
    // Health from margins only: gross 16.7% < 20 → warn, and NO CPI reasons.
    expect(row.health).toBe('warn');
    expect(row.healthReasons).toContain('Margen bruto bajo');
    expect(row.healthReasons).not.toContain('CPI crítico');
    expect(row.healthReasons).not.toContain('CPI bajo');
    // Plan data (marginPlanned) is not EVM-derived and stays available.
    expect(row.marginPlanned).toBeCloseTo(1 / 6, 5);
  });

  it('includes unknown-bucket rows flagged, without EVM or overhead', () => {
    const rows = makeRows({
      movements: [{ projectName: 'Misterio', direction: 'out', amount: 123 }],
      overhead: { rate: 0.5, base: 123, byKey: new Map() },
    });
    const unknown = rows.find((r) => r.key === 'name:misterio');
    expect(unknown.unknown).toBe(true);
    expect(unknown.evm).toBeNull();
    expect(unknown.overheadAllocated).toBe(0);
    expect(unknown.directCost).toBeCloseTo(123, 5);
  });

  it('sorts: active by revenueAccrued desc, then inactive, then unknown', () => {
    const projects = [
      { id: 'a1', name: 'A1', code: 'A1', status: 'active' },
      { id: 'a2', name: 'A2', code: 'A2', status: 'active' },
      { id: 'i1', name: 'I1', code: 'I1', status: 'inactive' },
    ];
    const rows = makeRows({
      projects,
      movements: [
        { projectId: 'a1', direction: 'in', amount: 100 },
        { projectId: 'a2', direction: 'in', amount: 500 },
        { projectId: 'i1', direction: 'in', amount: 900 },
        { projectName: 'Fantasma', direction: 'in', amount: 1000 },
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(['a2', 'a1', 'i1', 'name:fantasma']);
  });
});

// ── computePortfolioSummary ──────────────────────────────────────────────────
describe('computePortfolioSummary', () => {
  const rows = [
    {
      bucket: 'project', unknown: false, health: 'ok',
      contractValue: 100, bac: 80, directCost: 40, revenueAccrued: 100, burdenedCost: 50,
    },
    {
      bucket: 'project', unknown: false, health: 'warn',
      contractValue: 200, bac: 150, directCost: 60, revenueAccrued: 100, burdenedCost: 70,
    },
    {
      bucket: 'unknown', unknown: true, health: 'neutral',
      contractValue: null, bac: null, directCost: 20, revenueAccrued: 0, burdenedCost: 20,
    },
  ];
  const overhead = {
    pool: { total: 55, indirectCosts: 40, unallocatedLabor: 15 },
    allocation: { rate: 0.25, base: 220, byKey: new Map() },
  };

  it('totals, revenue-weighted margins, overhead passthrough and risk count', () => {
    const s = computePortfolioSummary({ rows, overhead });
    expect(s.contractTotal).toBeCloseTo(300, 5);
    expect(s.bacTotal).toBeCloseTo(230, 5);
    expect(s.directCostTotal).toBeCloseTo(120, 5);
    expect(s.revenueAccruedTotal).toBeCloseTo(200, 5);
    // Weighted: (Σrev − Σcost) / Σrev — NOT an average of row percentages.
    expect(s.grossMarginPct).toBeCloseTo(((200 - 120) / 200) * 100, 5);
    expect(s.netMarginPct).toBeCloseTo(((200 - 140) / 200) * 100, 5);
    expect(s.overheadPool).toBeCloseTo(55, 5);
    expect(s.overheadRate).toBeCloseTo(0.25, 5);
    expect(s.atRiskCount).toBe(1);
  });

  it('empty portfolio → zero totals and null margins (no NaN)', () => {
    const s = computePortfolioSummary({ rows: [] });
    expect(s.contractTotal).toBe(0);
    expect(s.revenueAccruedTotal).toBe(0);
    expect(s.grossMarginPct).toBeNull();
    expect(s.netMarginPct).toBeNull();
    expect(s.atRiskCount).toBe(0);
  });
});

// ── buildCostCurve ───────────────────────────────────────────────────────────
describe('buildCostCurve', () => {
  const curveArgs = {
    projects: PROJECTS,
    projectKey: 'p-alpha',
    bac: 40000,
    startDate: '2026-01-01',
    endDate: '2026-05-01',
    asOf: '2026-03-15',
    movements: [
      { projectId: 'p-alpha', direction: 'out', amount: 5000, postedDate: '2025-12-15' },
      { projectName: 'Alpha', direction: 'out', amount: 10000, postedDate: '2026-02-10' },
      { projectId: 'p-alpha', direction: 'in', amount: 99999, postedDate: '2026-02-11' },
      { projectId: 'p-beta', direction: 'out', amount: 777, postedDate: '2026-02-12' },
    ],
    payables: [
      { projectId: 'p-alpha', status: 'issued', openAmount: 3000, issueDate: '2026-03-05' },
      { projectId: 'p-alpha', status: 'cancelled', openAmount: 5555, issueDate: '2026-03-06' },
    ],
  };

  it('returns [] when bac or dates are missing/invalid', () => {
    expect(buildCostCurve({ ...curveArgs, bac: 0 })).toEqual([]);
    expect(buildCostCurve({ ...curveArgs, startDate: '' })).toEqual([]);
    expect(buildCostCurve({ ...curveArgs, startDate: '2026-06-01', endDate: '2026-01-01' })).toEqual([]);
  });

  it('builds monthly cumulative actual cost vs linear PV, truncating actuals after asOf', () => {
    const series = buildCostCurve(curveArgs);
    expect(series.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
    // Cumulative actuals: pre-start spend folds into the first bucket.
    expect(series[0].actual).toBeCloseTo(5000, 5);
    expect(series[1].actual).toBeCloseTo(15000, 5); // + legacy-name movement
    expect(series[2].actual).toBeCloseTo(18000, 5); // + open payable (cancelled excluded)
    // Months after asOf carry no actual (line must stop, not flat-line).
    expect(series[3].actual).toBeNull();
    expect(series[4].actual).toBeNull();
    // Linear PV baseline at each month end, clamped to bac.
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2026, 4, 1);
    const janEnd = Date.UTC(2026, 0, 31);
    expect(series[0].pv).toBeCloseTo((40000 * (janEnd - start)) / (end - start), 5);
    expect(series[4].pv).toBeCloseTo(40000, 5);
    // PV is monotonically non-decreasing.
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].pv).toBeGreaterThanOrEqual(series[i - 1].pv);
    }
  });
});

// ── buildOverheadComposition ─────────────────────────────────────────────────
describe('buildOverheadComposition', () => {
  it('groups overhead-bucket outflows + open payables by category, adds unallocated payroll row', () => {
    const composition = buildOverheadComposition({
      movements: [
        { projectName: 'Sin proyecto', direction: 'out', amount: 100, categoryName: 'Alquiler' },
        { projectName: '', direction: 'out', amount: 50, categoryName: 'Alquiler' },
        { projectName: 'General / Overhead', direction: 'out', amount: 30, categoryName: 'Software' },
        { projectName: 'Sin proyecto', direction: 'in', amount: 999, categoryName: 'Alquiler' }, // ignored: inflow
        { projectId: 'p-alpha', direction: 'out', amount: 40, categoryName: 'Alquiler' }, // ignored: project bucket
      ],
      payables: [
        { projectName: 'Sin proyecto', status: 'issued', openAmount: 20, categoryName: 'Software' },
        { projectName: 'Sin proyecto', status: 'cancelled', openAmount: 500, categoryName: 'Software' },
      ],
      projects: PROJECTS,
      unallocatedLabor: 500,
    });
    expect(composition).toEqual([
      { label: 'Nómina sin asignar', amount: 500 },
      { label: 'Alquiler', amount: 150 },
      { label: 'Software', amount: 50 },
    ]);
  });

  it('empty inputs → empty composition', () => {
    expect(buildOverheadComposition({ projects: PROJECTS })).toEqual([]);
  });
});

// ── internals ────────────────────────────────────────────────────────────────
describe('__internal', () => {
  it('round2 and clampPct behave', () => {
    expect(__internal.round2(1.239)).toBeCloseTo(1.24, 5);
    expect(__internal.clampPct(150)).toBe(100);
    expect(__internal.clampPct(-5)).toBe(0);
    expect(__internal.clampPct(NaN)).toBe(0);
  });
});
