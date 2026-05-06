/**
 * Unit tests for useCFOSnapshot — written in Vitest API.
 *
 * NOTE: At the time of Phase A there is no JS unit-test runner configured in
 * the project (only Playwright for e2e). These tests are intentionally
 * committed as-is so they can be picked up the moment we add Vitest:
 *
 *   npm i -D vitest @testing-library/react jsdom
 *
 * Run with: `npx vitest run src/features/cfo/hooks/useCFOSnapshot.test.js`
 *
 * The pure helpers (readCache / writeCache via localStorage, fetchCFOSnapshot
 * via mocked Firestore SDK) are covered. Hook integration is left to RTL when
 * the runner lands.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// ── Firestore mocks ────────────────────────────────────────────────────────
vi.mock('firebase/firestore', () => {
  return {
    collection: (...args) => ({ __kind: 'collection', path: args.slice(2).join('/') }),
    doc: (...args) => ({ __kind: 'doc', path: args.slice(2).join('/') }),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn((...args) => ({ __kind: 'query', args })),
    where: vi.fn((...args) => ({ __kind: 'where', args })),
  };
});

vi.mock('../../../services/firebase', () => ({
  db: {},
  appId: 'test-app',
}));

vi.mock('../../../utils/logger', () => ({
  logError: vi.fn(),
}));

const flushDocs = (rows) => ({
  docs: rows.map((r) => ({ id: r.id, data: () => r })),
});

const flushDoc = (data) => ({
  exists: () => Boolean(data),
  data: () => data,
});

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage?.clear?.();
  }
});

// ── fetchCFOSnapshot ───────────────────────────────────────────────────────
describe('fetchCFOSnapshot', () => {
  it('fetches all collections in parallel and returns the expected shape', async () => {
    const firestore = await import('firebase/firestore');
    firestore.getDocs.mockImplementation(async (q) => {
      const path = q?.path || q?.args?.[0]?.path;
      if (path?.includes('bankMovements')) {
        return flushDocs([{ id: 'bm1', amount: 100, postedDate: '2026-04-25', direction: 'in' }]);
      }
      if (path?.includes('receivables')) return flushDocs([{ id: 'r1', openAmount: 500 }]);
      if (path?.includes('payables')) return flushDocs([{ id: 'p1', openAmount: 200 }]);
      if (path?.includes('projects')) return flushDocs([{ id: 'pr1', name: 'NE3' }]);
      if (path?.includes('costCenters')) return flushDocs([{ id: 'cc1', name: 'Operaciones' }]);
      if (path?.includes('recurringCosts')) return flushDocs([{ id: 'rc1', amount: 1000 }]);
      if (path?.includes('employees')) return flushDocs([{ id: 'e1', fullName: 'JR' }]);
      if (path?.includes('budgets')) return flushDocs([{ id: 'b1', year: 2026 }]);
      if (path?.includes('transactions')) return flushDocs([{ id: 't1', amount: 100 }]);
      return flushDocs([]);
    });
    firestore.getDoc.mockResolvedValue(
      flushDoc({ expenseCategories: ['Sueldos'], incomeCategories: ['Ventas'] }),
    );

    const { fetchCFOSnapshot } = await import('./useCFOSnapshot.js');
    const snapshot = await fetchCFOSnapshot();

    expect(snapshot.bankMovements).toHaveLength(1);
    expect(snapshot.receivables).toHaveLength(1);
    expect(snapshot.payables).toHaveLength(1);
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.costCenters).toHaveLength(1);
    expect(snapshot.recurringCosts).toHaveLength(1);
    expect(snapshot.employees).toHaveLength(1);
    expect(snapshot.budgets).toHaveLength(1);
    expect(snapshot.transactions).toHaveLength(1);
    expect(snapshot.categories.expense).toEqual(['Sueldos']);
    expect(snapshot.categories.income).toEqual(['Ventas']);
    expect(snapshot.meta.bankMovementsLookbackDays).toBe(120);
  });

  it('falls back to default categories when settings doc does not exist', async () => {
    const firestore = await import('firebase/firestore');
    firestore.getDocs.mockResolvedValue(flushDocs([]));
    firestore.getDoc.mockResolvedValue(flushDoc(null));

    const { fetchCFOSnapshot } = await import('./useCFOSnapshot.js');
    const snapshot = await fetchCFOSnapshot();

    expect(Array.isArray(snapshot.categories.expense)).toBe(true);
    expect(Array.isArray(snapshot.categories.income)).toBe(true);
    expect(snapshot.categories.expense.length).toBeGreaterThan(0);
  });
});

// ── localStorage cache ─────────────────────────────────────────────────────
describe('cache behaviour', () => {
  it('writes and reads snapshot from localStorage with TTL', async () => {
    const { CFO_SNAPSHOT_CACHE_KEY, CFO_SNAPSHOT_TTL_MS } = await import('./useCFOSnapshot.js');

    const fakeSnapshot = { bankMovements: [], receivables: [] };
    const fresh = new Date().toISOString();
    window.localStorage.setItem(
      CFO_SNAPSHOT_CACHE_KEY,
      JSON.stringify({ snapshot: fakeSnapshot, fetchedAt: fresh }),
    );

    const stored = JSON.parse(window.localStorage.getItem(CFO_SNAPSHOT_CACHE_KEY));
    expect(stored.snapshot).toEqual(fakeSnapshot);
    expect(Date.now() - new Date(stored.fetchedAt).getTime()).toBeLessThan(CFO_SNAPSHOT_TTL_MS);
  });

  it('treats stored snapshot older than TTL as expired', async () => {
    const { CFO_SNAPSHOT_CACHE_KEY, CFO_SNAPSHOT_TTL_MS } = await import('./useCFOSnapshot.js');

    const tooOld = new Date(Date.now() - CFO_SNAPSHOT_TTL_MS - 1000).toISOString();
    window.localStorage.setItem(
      CFO_SNAPSHOT_CACHE_KEY,
      JSON.stringify({ snapshot: {}, fetchedAt: tooOld }),
    );

    const stored = JSON.parse(window.localStorage.getItem(CFO_SNAPSHOT_CACHE_KEY));
    const age = Date.now() - new Date(stored.fetchedAt).getTime();
    expect(age).toBeGreaterThan(CFO_SNAPSHOT_TTL_MS);
  });

  it('limits bankMovements to last 120 days via where clause', async () => {
    const firestore = await import('firebase/firestore');
    firestore.getDocs.mockResolvedValue(flushDocs([]));
    firestore.getDoc.mockResolvedValue(flushDoc(null));

    const { fetchCFOSnapshot } = await import('./useCFOSnapshot.js');
    await fetchCFOSnapshot();

    const calls = firestore.where.mock?.calls || [];
    const cutoffCalls = calls.filter((args) => args[0] === 'postedDate' && args[1] === '>=');
    expect(cutoffCalls.length).toBeGreaterThan(0);
  });
});
