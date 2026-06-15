/**
 * FinControl — Purge NON-DATEV (manual) bankMovements
 *
 * Under the "DATEV is the single source of truth" doctrine, bank movements must
 * come ONLY from the DATEV import (importSource === 'datev'). Manual movements
 * created by the Conciliacion feature fabricate a new bank entry instead of
 * LINKING an existing DATEV movement, which double-counts income/expense.
 *
 * This deletes every bankMovements doc whose importSource !== 'datev'.
 * The affected receivables/payables revert to pending and should be re-matched
 * against the real DATEV deposit later.
 *
 * DRY-RUN by default. Pass --apply to delete.
 *
 *   node scripts/purge-manual-bankmovements.cjs            # preview
 *   node scripts/purge-manual-bankmovements.cjs --apply    # delete
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const APPLY = process.argv.includes('--apply');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

function signed(x) {
  return Number(x.signedAmount ?? (x.direction === 'out' ? -(x.amount || 0) : (x.amount || 0)));
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const ref = db.collection(`artifacts/${APP_ID}/public/data/bankMovements`);

  console.log(`FinControl — Purge NON-DATEV bankMovements  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('══════════════════════════════════════════════════════\n');

  const snap = await ref.get();
  const targets = [];
  let net = 0;
  snap.forEach((doc) => {
    const x = doc.data();
    if (x.importSource === 'datev') return;
    targets.push(doc.id);
    net += signed(x);
  });

  console.log(`NON-DATEV movements: ${targets.length}  |  net inflation: ${net.toFixed(2)}`);
  console.log(`(of ${snap.size} total bankMovements)\n`);

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
  console.log(`✅ Deleted ${targets.length} non-DATEV bankMovements.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
