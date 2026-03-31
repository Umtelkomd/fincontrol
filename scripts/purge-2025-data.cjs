/**
 * FinControl — Purge 2025 Data Script
 *
 * DELETES all transactions, movements, receivables, payables from 2025.
 * Only 2026+ data is kept.
 *
 * HOW TO RUN:
 *   node scripts/purge-2025-data.cjs
 *
 * Requires: firebase-admin, firebase-admin-key.json in scripts/
 */

const admin = require('firebase-admin');

const SERVICE_ACCOUNT = require('./firebase-admin-key.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

/** Extract year from a date value (string 'YYYY-MM-DD' or Firebase Timestamp) */
function getYear(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') return parseInt(dateVal.substring(0, 4), 10);
  if (dateVal.toDate) {
    const d = dateVal.toDate();
    return d.getFullYear();
  }
  return null;
}

async function purge2025() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
  }

  const db = admin.firestore();
  const dataRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data');
  const basePath = `artifacts/${APP_ID}/public/data`;

  // Collections to clean
  const collections = [
    'transactions',
    'bankMovements',
    'receivables',
    'payables',
  ];

  console.log('FinControl — Purge 2025 Data');
  console.log('─────────────────────────────');
  console.log(`App ID: ${APP_ID}`);
  console.log('⚠️  This will DELETE all 2025 data from transactions, bankMovements, receivables, payables');
  console.log('');

  // First, count what would be deleted
  let total2025 = 0;
  let total2026plus = 0;

  for (const coll of collections) {
    const snapshot = await db.collection(`${basePath}/${coll}`).get();
    let count2025 = 0;
    let count2026 = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const year = getYear(data.date || data.dueDate || data.transactionDate);
      if (year === 2025) count2025++;
      else count2026++;
    });

    console.log(`  ${coll}: ${count2025} docs from 2025 (DELETE), ${count2026} from 2026+ (KEEP)`);
    total2025 += count2025;
    total2026plus += count2026;
  }

  console.log('');
  console.log(`Total: ${total2025} docs to DELETE, ${total2026plus} to KEEP`);
  console.log('');

  if (total2025 === 0) {
    console.log('✅ No 2025 data found. Nothing to do.');
    return;
  }

  // Confirm before proceeding
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const answer = await new Promise((resolve) => {
    rl.question('Type DELETE to confirm: ', resolve);
  });
  rl.close();

  if (answer !== 'DELETE') {
    console.log('Aborted.');
    return;
  }

  // Delete 2025 docs from each collection
  for (const coll of collections) {
    const snapshot = await db.collection(`${basePath}/${coll}`).get();
    let deleted = 0;

    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const year = getYear(data.date || data.dueDate || data.transactionDate);
      if (year === 2025) {
        batch.delete(docSnap.ref);
        deleted++;
      }
    });

    await batch.commit();
    console.log(`  ✅ Deleted ${deleted} docs from ${coll}`);
  }

  console.log('');
  console.log('✅ 2025 data purged. Only 2026+ data remains.');
}

purge2025().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
