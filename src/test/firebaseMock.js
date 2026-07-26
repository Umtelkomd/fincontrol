/**
 * Reusable Firebase test double for screen (render) tests.
 *
 * The pure-function tests in this repo already stub `firebase/firestore` file by
 * file (see `src/hooks/useBankMovements.test.js`). Screen tests need the same
 * stub, but complete enough that the REAL data hooks run: every hook in
 * `src/hooks/` follows one shape —
 *
 *     const ref = useMemo(() => collection(db, 'artifacts', appId, …, name), []);
 *     useEffect(() => onSnapshot(ref, onNext, onError), [ref, user]);
 *
 * so a `onSnapshot` that resolves a fixture by the ref's LAST path segment drives
 * the whole ledger (bankMovements, receivables, payables, budgets, projects,
 * transactions, settings/*) with zero per-hook mocking. Screens are therefore
 * exercised through their real hook wiring, not through a hollowed-out shell.
 *
 * Usage (mocks must be registered before the component module is loaded, hence
 * `vi.doMock` + a dynamic `import()` — the same order the existing hook tests use):
 *
 *     import { installFirebaseMocks } from '@/test/firebaseMock';
 *
 *     const store = installFirebaseMocks({ collections: { receivables: [...] } });
 *     const { default: Screen } = await import('./Screen.jsx');
 *
 * `store.collections` / `store.documents` stay mutable after installation: a test
 * can swap fixtures between renders without re-installing the mocks.
 */
import { vi } from 'vitest';
import { ROLE_PERMISSIONS } from '../constants/config';

/** Firestore refs are opaque in production code; here they only carry a path. */
const COLLECTION = 'collection';
const DOCUMENT = 'document';

const pathOf = (segments) => segments.filter((segment) => segment != null).join('/');
const keyOf = (path) => path.slice(path.lastIndexOf('/') + 1);

/** Snapshot shapes the hooks consume: `snap.docs[].data()` / `snap.exists()`. */
const collectionSnapshot = (docs) => ({
  docs: docs.map(({ id, ...data }) => ({
    id,
    data: () => data,
    exists: () => true,
  })),
  size: docs.length,
  empty: docs.length === 0,
  forEach(callback) {
    this.docs.forEach(callback);
  },
});

const documentSnapshot = (id, data) => ({
  id,
  exists: () => data != null,
  data: () => data ?? undefined,
});

/**
 * @param {{
 *   collections?: Record<string, object[]>,
 *   documents?: Record<string, object>,
 *   errors?: Record<string, Error>,
 * }} fixtures
 *   All three are keyed by the last segment of the Firestore path —
 *   `receivables`, `bankMovements`, `reconciliation`, `treasury`, `bankAccount`, …
 *   An entry in `errors` makes that listener fail instead of emitting, which is
 *   how a screen's partial-data guard gets exercised.
 */
export const createFirestoreStore = (fixtures = {}) => ({
  collections: { ...(fixtures.collections || {}) },
  documents: { ...(fixtures.documents || {}) },
  errors: { ...(fixtures.errors || {}) },
});

/**
 * Builds the `firebase/firestore` module double. `onSnapshot` fires its listener
 * synchronously (React batches the resulting state updates inside `render`'s
 * `act`), so a screen is fully populated on its first assertion — no waitFor.
 */
export const createFirestoreModule = (store) => {
  const noopConstraint = (...args) => ({ __constraint: true, args });

  const onSnapshot = vi.fn((ref, next, error) => {
    const listener = typeof next === 'function' ? next : next?.next;
    const onError = typeof error === 'function' ? error : next?.error;
    const failure = store.errors[keyOf(ref?.path ?? '')];
    if (failure) {
      onError?.(failure);
      return () => {};
    }
    try {
      if (ref?.__type === DOCUMENT) {
        listener?.(documentSnapshot(ref.id, store.documents[keyOf(ref.path)] ?? null));
      } else {
        listener?.(collectionSnapshot(store.collections[keyOf(ref?.path ?? '')] ?? []));
      }
    } catch (thrown) {
      // Mirrors Firestore: a throwing listener must not take the caller down.
      onError?.(thrown);
    }
    return () => {};
  });

  return {
    collection: vi.fn((_db, ...segments) => ({ __type: COLLECTION, path: pathOf(segments) })),
    doc: vi.fn((_db, ...segments) => {
      const path = pathOf(segments);
      return { __type: DOCUMENT, path, id: keyOf(path) };
    }),
    // `query(ref, ...constraints)` must return something `onSnapshot` can resolve,
    // so it passes the ref straight through; constraints are inert here.
    query: vi.fn((ref) => ref),
    where: vi.fn(noopConstraint),
    orderBy: vi.fn(noopConstraint),
    limit: vi.fn(noopConstraint),
    onSnapshot,
    getDoc: vi.fn(async (ref) => documentSnapshot(ref.id, store.documents[keyOf(ref.path)] ?? null)),
    getDocs: vi.fn(async (ref) => collectionSnapshot(store.collections[keyOf(ref?.path ?? '')] ?? [])),
    addDoc: vi.fn(async (ref, data) => ({ id: `new-${keyOf(ref?.path ?? 'doc')}`, ...data })),
    setDoc: vi.fn(async () => undefined),
    updateDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    runTransaction: vi.fn(async (_db, updateFunction) =>
      updateFunction({
        get: async (ref) => documentSnapshot(ref.id, store.documents[keyOf(ref.path)] ?? null),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }),
    ),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(async () => undefined),
    })),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: vi.fn((...items) => items),
    increment: vi.fn((value) => value),
    getFirestore: vi.fn(() => ({ __mockDb: true })),
  };
};

/** `firebase/auth` double — no screen under test drives a sign-in flow. */
export const createAuthModule = () => ({
  getAuth: vi.fn(() => ({ __mockAuth: true })),
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithEmailAndPassword: vi.fn(async () => ({ user: null })),
  signOut: vi.fn(async () => undefined),
  updateProfile: vi.fn(async () => undefined),
  updatePassword: vi.fn(async () => undefined),
  reauthenticateWithCredential: vi.fn(async () => undefined),
  EmailAuthProvider: { credential: vi.fn(() => ({ __mockCredential: true })) },
});

export const TEST_APP_ID = 'test-app';

export const TEST_USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com', displayName: 'Test User' };

/**
 * Registers every module a screen touches on its way to Firebase.
 *
 * `useAuth` is stubbed rather than driven through the `firebase/auth` double on
 * purpose: the real hook resolves the role via an awaited `getDoc` inside an
 * auth callback, which lands outside React's `act()` and produces noise unrelated
 * to what a smoke test is proving. Role comes from `permissions` instead.
 *
 * @param {{
 *   collections?: Record<string, object[]>,
 *   documents?: Record<string, object>,
 *   errors?: Record<string, Error>,
 *   user?: object|null,
 *   userRole?: string,
 *   permissions?: string[]|null,
 *   ledger?: object|null,
 * }} [options] `permissions: null` means "use the real role table for userRole".
 *   `ledger` replaces `useFinanceLedger` wholesale for the rare screen test that
 *   needs a hand-built ledger shape rather than one derived from fixtures.
 * @returns {{ collections: object, documents: object, errors: object, auth: object }}
 *   the live store — mutate any of its four sections between renders.
 */
export const installFirebaseMocks = (options = {}) => {
  const {
    collections = {},
    documents = {},
    errors = {},
    user = TEST_USER,
    userRole = 'admin',
    permissions = null,
    ledger = null,
  } = options;

  const store = createFirestoreStore({ collections, documents, errors });
  store.auth = { user, userRole, permissions };

  vi.doMock('firebase/firestore', () => createFirestoreModule(store));
  vi.doMock('firebase/auth', () => createAuthModule());
  vi.doMock('firebase/app', () => ({ initializeApp: vi.fn(() => ({ __mockApp: true })) }));

  vi.doMock('@/services/firebase', () => ({
    db: { __mockDb: true },
    auth: { __mockAuth: true },
    appId: TEST_APP_ID,
  }));

  // Resolved on every call so a test can change the role mid-file
  // (`store.auth.userRole = 'editor'`) and re-render, without resetting the
  // module registry just to re-stub one hook. `permissions: null` ⇒ derive from
  // the role using the app's own table.
  vi.doMock('@/hooks/useAuth', () => ({
    useAuth: () => ({
      user: store.auth.user,
      userRole: store.auth.userRole,
      loading: false,
      hasPermission: (section) =>
        (store.auth.permissions ??
          ROLE_PERMISSIONS[store.auth.userRole] ??
          ROLE_PERMISSIONS.editor).includes(section),
    }),
  }));

  if (ledger) {
    vi.doMock('@/hooks/useFinanceLedger', () => ({
      useFinanceLedger: () => ledger,
      default: () => ledger,
    }));
  }

  return store;
};
