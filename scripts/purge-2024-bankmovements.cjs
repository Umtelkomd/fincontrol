/**
 * FinControl — Purge 2024 bankMovements (orphan pre-history)
 *
 * Deletes every bankMovements doc whose postedDate (or date/valueDate) is in 2024.
 * These predate the company's tracked period (opening balance anchored Dec 2025)
 * and corrupt annual views. currentCash is anchored to the Dec-2025 opening
 * balance, so removing them does NOT change current cash.
 *
 * DRY-RUN by default. Pass --apply to actually delete.
 *
 *   node scripts/purge-2024-bankmovements.cjs            # preview
 *   node scripts/purge-2024-bankmovements.cjs --apply    # delete
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const APPLY = process.argv.includes('--apply');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

function getYear(d) {
  const v = d.postedDate || d.date || d.valueDate;
  if (!v) return null;
  if (typeof v === 'string') return parseInt(v.substring(0, 4), 10);
  if (v.toDate) return v.toDate().getFullYear();
  return null;
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const ref = db.collection(`artifacts/${APP_ID}/public/data/bankMovements`);

  console.log(`FinControl — Purge 2024 bankMovements  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('═══════════════════════════════════════════════\n');

  const snap = await ref.get();
  const targets = [];
  const byYear = {};
  snap.forEach((doc) => {
    const y = getYear(doc.data());
    byYear[y] = (byYear[y] || 0) + 1;
    if (y === 2024) targets.push(doc.id);
  });

  console.log('Year breakdown:', byYear);
  console.log(`2024 docs to delete: ${targets.length}\n`);

  if (!APPLY) {
    console.log('DRY-RUN — nothing deleted. Re-run with --apply.');
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const id of targets) {
    batch.delete(ref.doc(id));
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`✅ Deleted ${targets.length} 2024 bankMovements docs.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
