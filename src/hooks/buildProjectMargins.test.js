import { describe, expect, it } from 'vitest';
import { buildProjectMargins, buildUnassignedMargin } from './useTreasuryMetrics.js';

const movements = [
  { projectName: 'Alpha', direction: 'in', amount: 10000 },
  { projectName: 'Alpha', direction: 'out', amount: 3000 },
];

describe('buildProjectMargins — payroll allocation (Phase 3, item 3)', () => {
  it('preserves the current output when payrollByProject is empty (regression)', () => {
    const withDefault = buildProjectMargins(movements);
    const withEmpty = buildProjectMargins(movements, {});
    expect(withDefault).toEqual(withEmpty);
    const alpha = withDefault.find((p) => p.name === 'Alpha');
    expect(alpha.inflows).toBe(10000);
    expect(alpha.outflows).toBe(3000);
    expect(alpha.net).toBe(7000);
    expect(alpha.margin).toBeCloseTo(70, 5);
  });

  it('increases a project outflows and lowers net/margin by the allocated labor cost', () => {
    const out = buildProjectMargins(movements, { Alpha: 2000 });
    const alpha = out.find((p) => p.name === 'Alpha');
    expect(alpha.outflows).toBe(5000); // 3000 bank + 2000 labor
    expect(alpha.net).toBe(5000); // 10000 - 5000
    expect(alpha.margin).toBeCloseTo(50, 5); // 5000 / 10000
  });

  it('creates a project entry from labor cost even with no bank movements', () => {
    const out = buildProjectMargins([], { Beta: 1500 });
    const beta = out.find((p) => p.name === 'Beta');
    expect(beta).toBeTruthy();
    expect(beta.outflows).toBe(1500);
    expect(beta.net).toBe(-1500);
    expect(beta.margin).toBe(0); // no inflows → margin guarded to 0
  });
});

/**
 * The Resumen margin table and the management report must agree on what a
 * project is. `computeProjectMargins` (src/finance/managementReport.js) has
 * always dropped the unassigned bucket; buildProjectMargins used to rank it as
 * a real project, where it topped the table with the whole unclassified cash
 * flow behind it.
 */
describe('buildProjectMargins — unassigned bucket', () => {
  it('excludes movements with no project from the project list', () => {
    const out = buildProjectMargins([
      ...movements,
      { projectName: 'Sin proyecto', direction: 'in', amount: 90000 },
      { projectName: 'Sin proyecto', direction: 'out', amount: 1000 },
    ]);

    expect(out.map((p) => p.name)).toEqual(['Alpha']);
  });

  it('excludes every unassigned alias, case-insensitively', () => {
    const out = buildProjectMargins([
      { projectName: '', direction: 'in', amount: 100 },
      { projectName: '   ', direction: 'in', amount: 100 },
      { projectName: 'SIN PROYECTO', direction: 'in', amount: 100 },
      { projectName: 'Sin asignar', direction: 'in', amount: 100 },
      { projectName: 'N/A', direction: 'in', amount: 100 },
      { projectName: 'unknown', direction: 'in', amount: 100 },
      { direction: 'in', amount: 100 },
    ]);

    expect(out).toEqual([]);
  });

  it('does not let the unassigned bucket take a slot in the top 6', () => {
    const projects = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((name, index) => ({
      projectName: name,
      direction: 'in',
      amount: 1000 - index,
    }));
    const out = buildProjectMargins([
      { projectName: 'Sin proyecto', direction: 'in', amount: 999999 },
      ...projects,
    ]);

    expect(out).toHaveLength(6);
    expect(out.map((p) => p.name)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  });

  it('ignores payroll allocated to an unassigned bucket key', () => {
    const out = buildProjectMargins(movements, { Alpha: 1000, 'Sin proyecto': 5000 });

    expect(out.map((p) => p.name)).toEqual(['Alpha']);
    expect(out[0].outflows).toBe(4000); // 3000 bank + 1000 labor
  });
});

describe('buildUnassignedMargin', () => {
  it('surfaces the unassigned money as a separate figure instead of dropping it', () => {
    const unassigned = buildUnassignedMargin([
      ...movements,
      { projectName: 'Sin proyecto', direction: 'in', amount: 4000 },
      { direction: 'out', amount: 1000 },
      { projectName: 'N/A', direction: 'out', amount: 500 },
    ]);

    expect(unassigned).toMatchObject({ inflows: 4000, outflows: 1500, net: 2500 });
    expect(unassigned.margin).toBeCloseTo(62.5, 5);
  });

  it('folds payroll allocated to an unassigned key into the same figure', () => {
    const unassigned = buildUnassignedMargin(
      [{ projectName: 'Sin proyecto', direction: 'in', amount: 1000 }],
      { 'Sin proyecto': 400, Alpha: 9999 },
    );

    expect(unassigned.outflows).toBe(400);
    expect(unassigned.net).toBe(600);
  });

  it('returns null when every movement belongs to a real project', () => {
    expect(buildUnassignedMargin(movements)).toBeNull();
    expect(buildUnassignedMargin([])).toBeNull();
  });
});

/**
 * Own-account transfers between UMTELKOMD's bank accounts are neither revenue
 * nor cost, so they must not reach a project's margin. The Spanish
 * subcontractor `UMTELKOMD ESPAÑA S.L.` shares almost the same name and IS real
 * obra cost — this pins both halves.
 */
describe('buildProjectMargins — internal transfers', () => {
  const internalTransfer = {
    projectName: 'Alpha',
    direction: 'out',
    amount: 10000,
    counterpartyName: 'UMTELKOMD GmbH',
  };
  const subcontractor = {
    projectName: 'Alpha',
    direction: 'out',
    amount: 2000,
    counterpartyName: 'UMTELKOMD ESPA.A SOCIEDAD LIMITADA',
  };

  it('keeps own-account transfers out of project outflows', () => {
    const alpha = buildProjectMargins([...movements, internalTransfer]).find((p) => p.name === 'Alpha');
    expect(alpha.outflows).toBe(3000);
    expect(alpha.net).toBe(7000);
  });

  it('keeps own-account inflows out of project revenue', () => {
    const alpha = buildProjectMargins([
      ...movements,
      { projectName: 'Alpha', direction: 'in', amount: 25000, counterpartyName: 'UMTELKOMD GmbH' },
    ]).find((p) => p.name === 'Alpha');
    expect(alpha.inflows).toBe(10000);
  });

  it('still charges the UMTELKOMD ESPAÑA subcontractor to the obra', () => {
    const alpha = buildProjectMargins([...movements, subcontractor]).find((p) => p.name === 'Alpha');
    expect(alpha.outflows).toBe(5000);
  });

  it('keeps them out of the unassigned bucket too', () => {
    expect(buildUnassignedMargin([{ ...internalTransfer, projectName: '' }])).toBeNull();
  });
});
