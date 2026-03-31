/**
 * FinControl — Bootstrap Users Script
 *
 * Run ONCE after deploying new firestore.rules.
 * Creates user documents in Firestore so the security rules work.
 *
 * BEFORE RUNNING:
 * 1. Go to Firebase Console > Authentication > select each user
 * 2. Copy the UID from the user detail page
 * 3. Add to BOOTSTRAP_USERS below
 *
 * HOW TO RUN:
 *   npm install firebase-admin --save-dev
 *   node scripts/bootstrap-users.js
 *
 * Requires a Firebase service account with Editor or Owner role.
 * Download from: Firebase Console > Project Settings > Service Accounts > Generate new private key
 */

const admin = require('firebase-admin');

// ── CONFIGURATION ─────────────────────────────────────────────
// Get your UID from: Firebase Console > Authentication > click user > UID
const SERVICE_ACCOUNT = require('./firebase-admin-key.json'); // Download from Firebase Console
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';   // From .env VITE_FIREBASE_APP_ID

// Add your users here (UID from Firebase Auth, role: admin|manager|editor)
const BOOTSTRAP_USERS = [
  { uid: 't1AjgeNg5adTiDqbL6dG96ebyeM2', email: 'jromero@umtelkomd.com', role: 'admin' },
  // { uid: 'REPLACE_WITH_ACTUAL_UID', email: 'bsandoval@umtelkomd.com', role: 'manager' },
];
// ───────────────────────────────────────────────────────────────

async function bootstrap() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(SERVICE_ACCOUNT),
    });
  }

  const db = admin.firestore();

  console.log(`FinControl User Bootstrap`);
  console.log(`App ID: ${APP_ID}`);
  console.log(`─────────────────────────────`);

  if (BOOTSTRAP_USERS.length === 0 || BOOTSTRAP_USERS[0].uid.startsWith('REPLACE')) {
    console.log('⚠️  Edit this script and add your Firebase Auth UIDs first.');
    console.log('');
    console.log('Steps:');
    console.log('  1. Firebase Console > Authentication > click your user');
    console.log('  2. Copy the UID (e.g., "abc123xyz...")');
    console.log('  3. Paste it in BOOTSTRAP_USERS in this script');
    console.log('  4. Run again: node scripts/bootstrap-users.js');
    return;
  }

  for (const user of BOOTSTRAP_USERS) {
    const userRef = db.collection('users').doc(user.uid);
    const existing = await userRef.get();

    if (existing.exists) {
      const currentRole = existing.data().role;
      if (currentRole !== user.role) {
        await userRef.update({ role: user.role, appId: APP_ID });
        console.log(`🔄 ${user.email} — updated role: ${currentRole} → ${user.role}`);
      } else {
        console.log(`⏭️  ${user.email} — already correct (${user.role}), skipping`);
      }
    } else {
      await userRef.set({
        email: user.email,
        role: user.role,
        appId: APP_ID,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ ${user.email} — created as ${user.role}`);
    }
  }

  console.log('');
  console.log('✅ Bootstrap complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Deploy rules: firebase deploy --only firestore:rules');
  console.log('  2. Test login at http://localhost:5173');
}

bootstrap().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
