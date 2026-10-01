import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectAuthEmulator = vi.fn();
const connectFirestoreEmulator = vi.fn();

const CONFIG = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'umtelkomd-finance.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'umtelkomd-finance',
  VITE_FIREBASE_STORAGE_BUCKET: 'umtelkomd-finance.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
};

const loadFirebase = async (env) => {
  for (const [key, value] of Object.entries({ ...CONFIG, ...env })) vi.stubEnv(key, value);
  vi.doMock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
  vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator }));
  vi.doMock('firebase/firestore', () => ({
    connectFirestoreEmulator,
    getFirestore: vi.fn(() => ({})),
    initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(),
    persistentMultipleTabManager: vi.fn(),
  }));
  return import('./firebase.js');
};

describe('firebase service emulator wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    connectAuthEmulator.mockClear();
    connectFirestoreEmulator.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('firebase/app');
    vi.doUnmock('firebase/auth');
    vi.doUnmock('firebase/firestore');
  });

  it('talks to the real project when emulator mode is off', async () => {
    await loadFirebase({ VITE_USE_FIREBASE_EMULATOR: '' });

    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('connects Auth and Firestore to the local emulators under a demo- project', async () => {
    await loadFirebase({
      VITE_USE_FIREBASE_EMULATOR: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-fincontrol',
    });

    expect(connectAuthEmulator).toHaveBeenCalledWith(expect.anything(), 'http://127.0.0.1:9099');
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', 8080);
  });

  it('refuses emulator mode against a non-demo project', async () => {
    await expect(loadFirebase({ VITE_USE_FIREBASE_EMULATOR: 'true' })).rejects.toThrow(
      /requires a demo- project, got "umtelkomd-finance"/
    );
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });
});
