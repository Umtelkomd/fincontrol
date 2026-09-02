/**
 * The ledger fans one `user` out to eight subscribing hooks, each of which keys
 * its Firestore reference off that value. A caller passing a fresh object
 * literal — `useFinanceLedger({ uid, email })` inline in a render — therefore
 * tears down and reopens eight listeners on every render, which loops until the
 * tab runs out of memory. Auth hands down a stable object today, so this is a
 * trap for the next caller rather than a live failure.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { installFirebaseMocks, TEST_USER } from '../test/firebaseMock.js';

installFirebaseMocks();

const { renderHook } = await import('@testing-library/react');
const { onSnapshot } = await import('firebase/firestore');
const { useFinanceLedger } = await import('./useFinanceLedger.js');

describe('useFinanceLedger subscription identity', () => {
  beforeEach(() => {
    onSnapshot.mockClear();
  });

  it('does not resubscribe when the same user arrives as a new object', () => {
    const { rerender } = renderHook(({ user }) => useFinanceLedger(user), {
      initialProps: { user: { ...TEST_USER } },
    });

    const afterFirstRender = onSnapshot.mock.calls.length;
    expect(afterFirstRender).toBeGreaterThan(0);

    // Same person, different object identity — exactly what an inline literal
    // or a token refresh produces.
    rerender({ user: { ...TEST_USER } });
    rerender({ user: { ...TEST_USER } });

    expect(onSnapshot.mock.calls.length).toBe(afterFirstRender);
  });

  it('does resubscribe when a different user signs in', () => {
    const { rerender } = renderHook(({ user }) => useFinanceLedger(user), {
      initialProps: { user: { ...TEST_USER } },
    });

    const afterFirstRender = onSnapshot.mock.calls.length;
    rerender({ user: { uid: 'other-uid', email: 'bsandoval@umtelkomd.com' } });

    expect(onSnapshot.mock.calls.length).toBeGreaterThan(afterFirstRender);
  });

  it('survives a null user without subscribing', () => {
    expect(() => renderHook(() => useFinanceLedger(null))).not.toThrow();
  });
});

/**
 * The ledger also carries the MUTATORS of the hooks it fans out to, so a
 * screen that reads `ledger.bankMovements` from the context can write through
 * `ledger.actions.bankMovements.bulkClassify` without opening a second
 * subscription of its own. The references are stable across renders, so a
 * consumer may list them as effect/memo dependencies without churn.
 */
describe('useFinanceLedger — mutators travel with the data', () => {
  it('exposes the bank movement, receivable and payable actions without their data', () => {
    const { result } = renderHook(() => useFinanceLedger({ ...TEST_USER }));
    const { actions } = result.current;

    [
      'createBankMovement',
      'updateBankMovement',
      'bulkClassify',
      'voidBankMovement',
      'reconcileMovement',
      'unreconcileMovement',
    ].forEach((name) => expect(typeof actions.bankMovements[name]).toBe('function'));
    ['createReceivable', 'registerPayment', 'updateReceivable', 'cancelReceivable', 'markAsPaid'].forEach(
      (name) => expect(typeof actions.receivables[name]).toBe('function'),
    );
    ['createPayable', 'registerPayment', 'updatePayable', 'cancelPayable', 'setOpsCleared'].forEach(
      (name) => expect(typeof actions.payables[name]).toBe('function'),
    );

    expect(actions.bankMovements.bankMovements).toBeUndefined();
    expect(actions.receivables.receivables).toBeUndefined();
    expect(actions.payables.loading).toBeUndefined();
  });

  it('keeps the same references across renders', () => {
    const { result, rerender } = renderHook(({ user }) => useFinanceLedger(user), {
      initialProps: { user: { ...TEST_USER } },
    });
    const first = result.current.actions;

    rerender({ user: { ...TEST_USER } });
    rerender({ user: { ...TEST_USER } });

    expect(result.current.actions).toBe(first);
    expect(result.current.actions.bankMovements.bulkClassify).toBe(first.bankMovements.bulkClassify);
    expect(result.current.actions.payables.createPayable).toBe(first.payables.createPayable);
  });

  it('forwards a call to the underlying mutator', async () => {
    const { result } = renderHook(() => useFinanceLedger({ ...TEST_USER }));

    // No ids ⇒ the real bulkClassify refuses before touching Firestore.
    const outcome = await result.current.actions.bankMovements.bulkClassify([], { categoryName: 'X' });

    expect(outcome.success).toBe(false);
    expect(outcome.error.message).toBe('No hay movimientos seleccionados');
  });
});
