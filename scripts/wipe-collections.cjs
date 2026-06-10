/**
 * FinControl — Wipe Collections Script
 *
 * DELETES all documents from the specified collections.
 * Designed for the "ola limpia" before importing fresh DATEV history.
 *
 * USAGE:
 *   node scripts/wipe-collections.cjs <collection> [<collection> ...]
 *
 *   Example:
 *     node scripts/wipe-collections.cjs transactions bankMovements
 *
 * REQUIREMENTS:
 *   - firebase-admin installed (already in node_modules)
 *   - Service account key at ~/.credentials/umtelkomd-firebase.json
 *     (or set GOOGLE_APPLICATION_CREDENTIALS to an alternate path)
 *
 * SAFETY:
 *   - Lists docs first, asks for confirmation by typing the collection name
 *   - Deletes in batches of 500
 *   - Logs every batch and final summary
 *   - DOES NOT touch /artifacts metadata or other paths
 *
 * PRODUCTION CAUTION:
 *   This is irreversible without a backup. Run a Backup Completo first.
 */

const admin = require('firebase-admin');
const readline = require('readline');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || require('path').join(require('os').homedir(), '.credentials', 'umtelkomd-firebase.json');
const SERVICE_ACCOUNT = require(KEY_PATH);
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

const ALLOWED = [
  'transactions',
  'bankMovements',
  'receivables',
  'payables',
  'recurringCosts',
  'employees',
  'properties',
  'vehicles',
  'insurances',
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function deleteCollection(db, collectionPath) {
  const ref = db.collection(collectionPath);
  let total = 0;
  while (true) {
    const snapshot = await ref.limit(500).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snapshot.size;
    console.log(`  Deleted batch of ${snapshot.size} (total: ${total})`);
    if (snapshot.size < 500) break;
  }
  return total;
}

async function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('Usage: node scripts/wipe-collections.cjs <collection> [<collection> ...]');
    console.error(`Allowed collections: ${ALLOWED.join(', ')}`);
    process.exit(1);
  }
  for (const t of targets) {
    if (!ALLOWED.includes(t)) {
      console.error(`Unknown collection: "${t}". Allowed: ${ALLOWED.join(', ')}`);
      process.exit(1);
    }
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
  }
  const db = admin.firestore();
  const basePath = `artifacts/${APP_ID}/public/data`;

  console.log('FinControl — Wipe Collections');
  console.log('═════════════════════════════════');
  console.log(`App ID: ${APP_ID}`);
  console.log(`Targets: ${targets.join(', ')}`);
  console.log('');

  // Pre-count
  console.log('Inspecting...');
  const counts = {};
  for (const t of targets) {
    const snap = await db.collection(`${basePath}/${t}`).get();
    counts[t] = snap.size;
    console.log(`  ${t}: ${snap.size} docs`);
  }
  console.log('');

  const totalDocs = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalDocs === 0) {
    console.log('Nothing to delete. Exiting.');
    process.exit(0);
  }

  console.log(`About to DELETE ${totalDocs} documents in total. This is IRREVERSIBLE.`);
  console.log('');
  const phrase = `DELETE ${targets.join(',')}`;
  const answer = await ask(`Type exactly "${phrase}" to confirm: `);
  if (answer.trim() !== phrase) {
    console.log('Confirmation failed. Aborting.');
    process.exit(1);
  }

  console.log('');
  console.log('Proceeding...');
  const results = {};
  for (const t of targets) {
    console.log(`\n→ Wiping ${t}`);
    results[t] = await deleteCollection(db, `${basePath}/${t}`);
  }

  console.log('');
  console.log('═════════════════════════════════');
  console.log('Wipe complete.');
  Object.entries(results).forEach(([col, n]) => {
    console.log(`  ${col}: ${n} docs deleted`);
  });
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
