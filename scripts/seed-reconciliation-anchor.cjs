/**
 * FinControl — Seed the first reconciliation anchor (ONE-SHOT, idempotent)
 *
 * Creates `settings/reconciliation` with the verified 2026-05-31 balance
 * (+1,214.20 € — DATEV SuSa account 1200, May 2026) ONLY if the document
 * does not exist yet. Never overwrites existing anchors.
 *
 * HOW TO RUN:
 *   node scripts/seed-reconciliation-anchor.cjs
 *
 * Requires the service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const SERVICE_ACCOUNT = require(KEY_PATH);
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

const SEED_ANCHOR = {
  date: '2026-05-31',
  balance: 1214.2,
  source: 'DATEV SuSa cuenta 1200 (mayo 2026)',
  note: 'Ancla inicial verificada contra la contabilidad DATEV.',
  confirmedBy: 'seed-script',
  confirmedAt: new Date().toISOString(),
};

async function seed() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
  }
  const db = admin.firestore();
  const ref = db.doc(`artifacts/${APP_ID}/public/data/settings/reconciliation`);

  const snapshot = await ref.get();
  if (snapshot.exists) {
    const anchors = snapshot.data()?.anchors || [];
    console.log(`settings/reconciliation already exists (${anchors.length} anchor(s)). Nothing done.`);
    return;
  }

  await ref.set({
    anchors: [SEED_ANCHOR],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'seed-script',
  });
  console.log(`Seeded reconciliation anchor: ${SEED_ANCHOR.date} → ${SEED_ANCHOR.balance} €`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
