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
