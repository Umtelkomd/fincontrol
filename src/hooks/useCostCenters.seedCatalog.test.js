/**
 * useCostCenters.seedCatalog — T7: "Cargar predefinidos" seeds the cost
 * center catalogue v2 (src/finance/costCenterCatalog.js) idempotently.
 *
 * Key design decision (odd/tasks/invoice-classification-catalog.md): the
 * catalogue doc id EQUALS the code, written with setDoc(doc(ref, code), …,
 * { merge: true }) instead of createCostCenter's addDoc (which always
 * generates a random id). merge:true is what makes re-seeding safe: an
 * existing doc's budget/responsible are never included in the payload, so
 * they survive untouched.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import { COST_CENTER_CATALOG } from '../finance/costCenterCatalog.js';

const store = installFirebaseMocks({ collections: { costCenters: [] } });

const firestore = await import('firebase/firestore');
const { useCostCenters } = await import('./useCostCenters.js');

beforeEach(() => {
  store.collections.costCenters = [];
  firestore.setDoc.mockClear();
});

describe('seedCatalog — fresh install', () => {
  it('writes every catalogue entry with setDoc(doc(ref, code), …, { merge: true })', async () => {
    const { result } = renderHook(() => useCostCenters(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.seedCatalog();
    });

    expect(firestore.setDoc).toHaveBeenCalledTimes(COST_CENTER_CATALOG.length);
    firestore.setDoc.mock.calls.forEach(([ref, payload, options]) => {
      const entry = COST_CENTER_CATALOG.find((e) => e.code === ref.id);
      expect(entry).toBeTruthy();
      expect(payload).toMatchObject({
        code: entry.code,
        name: entry.name,
        kind: entry.kind,
        line: entry.line || '',
        catalogVersion: 2,
      });
      expect(options).toEqual({ merge: true });
    });
  });

  it('initializes budget/responsible only for a brand-new doc', async () => {
    const { result } = renderHook(() => useCostCenters(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.seedCatalog();
    });

    const [, payload] = firestore.setDoc.mock.calls[0];
    expect(payload.budget).toBe(0);
    expect(payload.responsible).toBe('');
  });
});

describe('seedCatalog — re-seeding an existing catalogue', () => {
  it('never resets an existing budget or responsible (merge omits them from the payload)', async () => {
    store.collections.costCenters = [
      { id: 'CC-100', code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct', budget: 50000, responsible: 'Jarl' },
    ];
    const { result } = renderHook(() => useCostCenters(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.seedCatalog();
    });

    const call = firestore.setDoc.mock.calls.find(([ref]) => ref.id === 'CC-100');
    expect(call[1]).not.toHaveProperty('budget');
    expect(call[1]).not.toHaveProperty('responsible');
    expect(call[2]).toEqual({ merge: true });
  });

  it('reports created vs. updated counts', async () => {
    store.collections.costCenters = [
      { id: 'CC-100', code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct' },
    ];
    const { result } = renderHook(() => useCostCenters(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.seedCatalog();
    });

    expect(outcome.success).toBe(true);
    expect(outcome.updated).toBe(1);
    expect(outcome.created).toBe(COST_CENTER_CATALOG.length - 1);
  });

  it('running seedCatalog twice never creates a duplicate doc id — same code, same ref every time', async () => {
    const { result } = renderHook(() => useCostCenters(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.seedCatalog();
    });
    const firstRunIds = firestore.setDoc.mock.calls.map(([ref]) => ref.id).sort();
    firestore.setDoc.mockClear();

    await act(async () => {
      await result.current.seedCatalog();
    });
    const secondRunIds = firestore.setDoc.mock.calls.map(([ref]) => ref.id).sort();

    expect(secondRunIds).toEqual(firstRunIds);
    expect(new Set(secondRunIds).size).toBe(COST_CENTER_CATALOG.length);
  });
});
