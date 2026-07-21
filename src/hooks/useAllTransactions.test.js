/**
 * Characterization tests for the useAllTransactions hook contract.
 *
 * These tests pin the OBSERVABLE contract of the hook — not the loading
 * mechanism — so they stay valid across the Plan 003 refactor (static 2025
 * bundle → Firestore-only source):
 *
 *   1. Return shape: { allTransactions, loading, error, csvError,
 *      transactions2025, transactions2026 }.
 *   2. allTransactions is sorted descending by date once settled.
 *   3. loading stays true while the live Firestore source is still loading —
 *      a resolved historical source alone never flips loading to false
 *      ("wait for both" semantic).
 *   4. Live records default source to 'firebase-live', preserve an explicit
 *      source, and derive year from date.
 *   5. transactions2025 / transactions2026 partition allTransactions strictly
 *      by OPERATIONAL_DATA_START (no overlap, no loss, no duplication).
 *   6. Firestore snapshot errors surface through `error`.
 *
 * Deliberately NOT asserted: where the 2025 records physically come from
 * (dynamic-import chunk vs Firestore docs), module-level caching, or chunk
 * names — those are implementation details the refactor is allowed to change.
 *
 * The live source (./useTransactions) is mocked; the static 2025 module is
 * NOT mocked or referenced, so this file keeps working after that module is
 * deleted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { OPERATIONAL_DATA_START } from '../finance/constants.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── Live-source mock (mutable per test) ─────────────────────────────────────

const mocks = vi.hoisted(() => ({
  live: { transactions: [], loading: true, error: null },
}));

vi.mock('./useTransactions', () => ({
  useTransactions: () => mocks.live,
}));

import { useAllTransactions } from './useAllTransactions';

// ── Minimal hook harness (no @testing-library dependency) ───────────────────

const activeRoots = [];

function renderHook(callback) {
  const result = { current: null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push({ root, container });

  function Harness() {
    result.current = callback();
    return null;
  }

  act(() => {
    root.render(React.createElement(Harness));
  });

  return {
    result,
    rerender: () =>
      act(() => {
        root.render(React.createElement(Harness));
      }),
  };
}

afterEach(() => {
  while (activeRoots.length > 0) {
    const { root, container } = activeRoots.pop();
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

/** Flush timers/microtasks inside act so async source resolution lands. */
const flush = async (times = 5) => {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};

/** Flush until the hook reports loading=false (fails loudly on timeout). */
const settle = async (result) => {
  for (let i = 0; i < 100; i += 1) {
    if (result.current.loading === false) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error('useAllTransactions never settled (loading stayed true)');
};

// ── Fixtures ────────────────────────────────────────────────────────────────

const USER = { uid: 'test-user' };

// Deliberately unsorted; one record without `source`, one with an explicit one.
const liveFixture = () => [
  { id: 'live-1', date: '2026-01-15', type: 'income', amount: 100 },
  { id: 'live-2', date: '2026-03-02', type: 'expense', amount: 50, source: 'datev' },
  { id: 'live-3', date: '2026-02-10', type: 'expense', amount: 75 },
];

const setLive = (state) => {
  mocks.live = { transactions: [], loading: false, error: null, ...state };
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useAllTransactions — contract', () => {
  it('returns the full contract shape', async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    expect(Array.isArray(result.current.allTransactions)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(result.current.error).toBeNull();
    expect(result.current.csvError).toBeNull();
    expect(Array.isArray(result.current.transactions2025)).toBe(true);
    expect(Array.isArray(result.current.transactions2026)).toBe(true);
  });

  it('keeps loading=true while the live source is still loading, even if historical data is ready', async () => {
    setLive({ loading: true });
    const { result } = renderHook(() => useAllTransactions(USER));

    // Give every other (historical) source ample time to resolve; the live
    // gate must still hold the hook in loading state.
    await flush();
    expect(result.current.loading).toBe(true);
  });

  it('settles to loading=false once the live source resolves', async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    expect(result.current.loading).toBe(false);
  });

  it('sorts allTransactions descending by date once settled', async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    const { allTransactions } = result.current;
    expect(allTransactions.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < allTransactions.length; i += 1) {
      const prev = new Date(allTransactions[i - 1].date).getTime();
      const next = new Date(allTransactions[i].date).getTime();
      expect(prev).toBeGreaterThanOrEqual(next);
    }
  });

  it('includes each live record exactly once (no duplication)', async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    for (const record of liveFixture()) {
      const matches = result.current.allTransactions.filter((t) => t.id === record.id);
      expect(matches).toHaveLength(1);
    }
    // No duplicate ids anywhere in the merged list.
    const ids = result.current.allTransactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults source to 'firebase-live' on live records, preserves explicit sources, derives year", async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    const byId = (id) => result.current.allTransactions.find((t) => t.id === id);
    expect(byId('live-1').source).toBe('firebase-live');
    expect(byId('live-1').year).toBe(2026);
    expect(byId('live-2').source).toBe('datev');
    expect(byId('live-3').source).toBe('firebase-live');
  });

  it('partitions transactions2025/transactions2026 strictly by OPERATIONAL_DATA_START', async () => {
    setLive({ transactions: liveFixture() });
    const { result } = renderHook(() => useAllTransactions(USER));
    await settle(result);

    const { allTransactions, transactions2025, transactions2026 } = result.current;

    for (const t of transactions2025) {
      expect(String(t.date) < OPERATIONAL_DATA_START).toBe(true);
    }
    for (const t of transactions2026) {
      if (t.date) {
        expect(String(t.date) >= OPERATIONAL_DATA_START).toBe(true);
      }
    }

    // The two buckets partition allTransactions exactly: same members, no
    // overlap, nothing lost.
    expect(transactions2025.length + transactions2026.length).toBe(allTransactions.length);
    const allIds = new Set(allTransactions.map((t) => t.id));
    const bucketIds = [...transactions2025, ...transactions2026].map((t) => t.id);
    expect(new Set(bucketIds).size).toBe(bucketIds.length);
    for (const id of bucketIds) {
      expect(allIds.has(id)).toBe(true);
    }
    // All live fixture records land in the 2026 bucket.
    const ids2026 = new Set(transactions2026.map((t) => t.id));
    for (const record of liveFixture()) {
      expect(ids2026.has(record.id)).toBe(true);
    }
  });

  it('surfaces live snapshot errors through error', async () => {
    const boom = new Error('firestore unavailable');
    setLive({ transactions: [], loading: false, error: boom });
    const { result } = renderHook(() => useAllTransactions(USER));
    await flush();

    expect(result.current.error).toBe(boom);
  });
});
