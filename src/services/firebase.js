import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Fail fast if any Firebase value is missing. A bundle compiled without the
// .env ships an empty config and crashes at runtime with the opaque
// `auth/invalid-api-key`; this surfaces the real cause instead. The build is
// also guarded in vite.config.js so a broken artifact is never produced.
const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missingConfig.length > 0) {
  throw new Error(
    `Firebase config is incomplete (missing: ${missingConfig.join(', ')}). ` +
      'This build was likely compiled without the VITE_FIREBASE_* env vars — ' +
      'check your .env file (see .env.example) and rebuild.'
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Tenant key — must match the appId used in Firestore rules. Validated above so
// data never accidentally mixes under a fallback id.
export const appId = firebaseConfig.appId;
