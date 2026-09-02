/**
 * applyRulesToMovements — batched, not serial.
 *
 * "Aplicar reglas (n)" used to await one Firestore write per movement (plus one
 * per rule hit): 1.500 pending movements meant 3.000 round trips from the
 * browser. The bulk path now goes through WriteBatch chunks of 400 like
 * `bulkClassify`, with one hits++ per rule per chunk.
 *
 * Runs over the shared Firebase double so the real React hook (real
 * useState/useMemo) is exercised with rules read back through onSnapshot.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installFirebaseMocks } from '../test/firebaseMock.js';

const ARAL_RULE = {
  id: 'rule-aral',
  name: 'Aral — Combustible',
  active: true,
  priority: 10,
  field: 'counterpartyName',
  matchType: 'contains',
  pattern: 'Aral',
  direction: 'out',
  applyTo: { categoryName: 'Combustible', costScope: 'overhead' },
};

const store = installFirebaseMocks({ collections: { classificationRules: [ARAL_RULE] } });

const { act, renderHook } = await import('@testing-library/react');
const { updateDoc, writeBatch } = await import('firebase/firestore');
const { useClassificationRules } = await import('./useClassificationRules.js');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const pendingMovements = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `mov-${index}`,
    direction: 'out',
    amount: 60,
    counterpartyName: 'Aral AG',
    categoryName: '',
    postedDate: '2026-08-01',
  }));

const batches = () => writeBatch.mock.results.map((entry) => entry.value);

beforeEach(() => {
  writeBatch.mockClear();
  updateDoc.mockClear();
  store.collections.classificationRules = [ARAL_RULE];
});

describe('applyRulesToMovements', () => {
  it('issues at most ceil(n/400) commits for n movements', async () => {
    const { result } = renderHook(() => useClassificationRules(USER));
    const movements = pendingMovements(1000);

    let outcome;
    await act(async () => {
      outcome = await result.current.applyRulesToMovements(movements);
    });

    expect(outcome).toMatchObject({ applied: 1000, skipped: 0, errors: [] });
    expect(writeBatch).toHaveBeenCalledTimes(Math.ceil(1000 / 400));
    batches().forEach((batch) => expect(batch.commit).toHaveBeenCalledTimes(1));
    // No serial per-movement writes anymore.
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('writes one classification per movement plus one hits bump per rule per chunk', async () => {
    const { result } = renderHook(() => useClassificationRules(USER));

    await act(async () => {
      await result.current.applyRulesToMovements(pendingMovements(500));
    });

    const updates = batches().reduce((sum, batch) => sum + batch.update.mock.calls.length, 0);
    // 500 movements + 1 rule × 2 chunks.
    expect(updates).toBe(502);

    const movementUpdate = batches()[0].update.mock.calls[0];
    expect(movementUpdate[1]).toMatchObject({ categoryName: 'Combustible', costScope: 'overhead' });
  });

  it('skips movements no rule matches and touches nothing when nothing applies', async () => {
    const { result } = renderHook(() => useClassificationRules(USER));
    const strangers = [
      { id: 'mov-x', direction: 'out', amount: 10, counterpartyName: 'Finanzkasse', categoryName: '' },
    ];

    let outcome;
    await act(async () => {
      outcome = await result.current.applyRulesToMovements(strangers);
    });

    expect(outcome).toEqual({ applied: 0, skipped: 1, errors: [] });
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('reports a failed chunk without dropping the remaining ones', async () => {
    const { result } = renderHook(() => useClassificationRules(USER));
    let calls = 0;
    writeBatch.mockImplementation(() => ({
      set: () => {},
      update: () => {},
      delete: () => {},
      commit: async () => {
        calls += 1;
        if (calls === 1) throw new Error('unavailable');
      },
    }));

    let outcome;
    await act(async () => {
      outcome = await result.current.applyRulesToMovements(pendingMovements(500));
    });

    expect(outcome.applied).toBe(100);
    expect(outcome.errors).toHaveLength(400);
    expect(outcome.errors[0].movementId).toBe('mov-0');
  });
});
