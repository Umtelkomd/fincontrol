/**
 * Hook-level tests for useProjectControl — the year-filter / EVM contract.
 *
 * All Firestore-backed data hooks are mocked with static fixtures; only the
 * composition logic under test runs for real. Rendering uses a bare
 * react-dom/client root + React 19 act (no testing-library dependency).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../hooks/useFinanceLedger', () => ({
  useFinanceLedger: () => ({
    loading: false,
    postedMovements: [
      { projectId: 'p1', direction: 'out', amount: 1000, postedDate: '2025-06-10' },
      { projectId: 'p1', direction: 'in', amount: 5000, postedDate: '2026-02-01' },
    ],
    receivables: [],
    payables: [],
  }),
}));

vi.mock('../../hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [], loading: false }),
}));

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [
      {
        id: 'p1', name: 'P1', code: 'P1', status: 'active',
        budget: 10000, percentComplete: 50,
        startDate: '2025-01-01', endDate: '2026-12-31',
      },
    ],
    updateProject: async () => ({ success: true }),
  }),
}));

vi.mock('../nominas/usePayrollPeriods', () => ({
  usePayrollPeriods: () => ({ periods: [], loading: false }),
}));

vi.mock('./useOverheadConfig', () => ({
  useOverheadConfig: () => ({
    overheadBasis: 'directCost',
    setOverheadBasis: async () => ({ success: true }),
    loading: false,
  }),
}));

import { useProjectControl } from './useProjectControl';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let captured;
function Probe() {
  const value = useProjectControl({ uid: 'u-test' });
  // Capture after commit (not during render) — act() flushes effects, so
  // `captured` is current after every act block.
  useEffect(() => {
    captured = value;
  });
  return null;
}

describe('useProjectControl — period filter vs EVM', () => {
  let container;
  let root;

  beforeEach(() => {
    captured = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("EVM is populated on 'all' and nulled when a year filter slices the data", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });

    // Full history: ev 5000 (bac 10000 × 50%) vs ac 1000 → cpi populated.
    const rowAll = captured.rows.find((row) => row.key === 'p1');
    expect(rowAll.evm.cpi).not.toBeNull();
    expect(rowAll.evm.eac).not.toBeNull();
    expect(captured.availableYears).toEqual(['2026', '2025']);

    await act(async () => {
      captured.setPeriodFilter('2026');
    });

    // Year slice: AC is partial, so CPI/EAC/percentSpent must NOT render.
    const rowYear = captured.rows.find((row) => row.key === 'p1');
    expect(rowYear.evm.cpi).toBeNull();
    expect(rowYear.evm.eac).toBeNull();
    expect(rowYear.evm.percentSpent).toBeNull();
    expect(rowYear.marginForecast).toBeNull();
    // ...while the sliced actuals themselves still flow (2026 inflow only).
    expect(rowYear.revenueAccrued).toBeCloseTo(5000, 5);
    expect(rowYear.directCost).toBeCloseTo(0, 5);

    await act(async () => {
      captured.setPeriodFilter('all');
    });
    expect(captured.rows.find((row) => row.key === 'p1').evm.cpi).not.toBeNull();
  });

  it('S-curve slices stay UNFILTERED under a year filter (curve spans project lifetime)', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });

    await act(async () => {
      captured.setPeriodFilter('2026');
    });

    // Both movements (2025 + 2026) must remain available to the curve.
    expect(captured.curveMovements).toHaveLength(2);
    expect(captured.curvePayables).toHaveLength(0);
  });
});
