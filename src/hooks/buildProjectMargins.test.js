import { describe, expect, it } from 'vitest';
import { buildProjectMargins } from './useTreasuryMetrics.js';

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
