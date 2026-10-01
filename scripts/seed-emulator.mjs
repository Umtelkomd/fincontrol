/**
 * Seeds the local Auth + Firestore emulators with a login the app accepts.
 *
 * Creates one admin user and its `users/{uid}` registry document (role +
 * appId), which the Firestore rules require before any tenant data is
 * readable. Idempotent: re-running keeps the same user and resets its role.
 *
 * Usage (with `npm run emulators` running in another terminal):
 *   npm run seed:emulator
 */
import process from 'node:process';
import { loadEnv } from 'vite';

const PROJECT_ID = 'demo-fincontrol';
const ADMIN = { email: 'admin@fincontrol.local', password: 'fincontrol', role: 'admin' };

// Pin the Admin SDK to the emulators BEFORE it is imported, so it can never
// fall back to real credentials or the production project.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

// The tenant key in Firestore paths and rules; must match what the app uses.
const { VITE_FIREBASE_APP_ID: appId } = loadEnv('development', process.cwd(), 'VITE_');
if (!appId) {
  throw new Error('VITE_FIREBASE_APP_ID is missing — create .env from .env.example first.');
}

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);

let user;
try {
  user = await auth.getUserByEmail(ADMIN.email);
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error;
  user = await auth.createUser({ email: ADMIN.email, password: ADMIN.password });
}

await getFirestore(app)
  .doc(`users/${user.uid}`)
  .set({ email: ADMIN.email, role: ADMIN.role, appId });

console.log(`Emulator seeded. Log in with ${ADMIN.email} / ${ADMIN.password}`);
