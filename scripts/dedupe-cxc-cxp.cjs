/**
 * FinControl — Dedupe CXC (receivables) & CXP (payables)
 *
 * Groups docs by a stable fingerprint and, within each duplicate group,
 * KEEPS the best record (most payments recorded, then earliest createdAt)
 * and flags the rest for deletion.
 *
 * DRY-RUN by default. Pass --apply to actually delete.
 *
 *   node scripts/dedupe-cxc-cxp.cjs            # preview only
 *   node scripts/dedupe-cxc-cxp.cjs --apply    # delete redundant docs
 *
 * Requires service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const APPLY = process.argv.includes('--apply');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());

function fingerprint(d) {
  const party = norm(d.vendor || d.client || d.counterpartyName);
  const invoice = norm(d.invoiceNumber || d.documentNumber);
  const amount = d.grossAmount ?? d.amount ?? '';
  const due = norm(d.dueDate || d.issueDate);
  return [party, invoice, amount, due].join('|');
}

const DEAD_STATUS = new Set(['cancelled', 'canceled', 'void', 'voided', 'annulled']);

// Higher score = more worth keeping
function score(d) {
  const active = DEAD_STATUS.has(norm(d.status)) ? 0 : 1; // ALWAYS prefer an active doc over a cancelled/void one
  const payments = Array.isArray(d.payments) ? d.payments.length : 0;
  const paid = Number(d.paidAmount || 0) > 0 ? 1 : 0;
  const created = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : Number.MAX_SAFE_INTEGER;
  // active first, then payments, then paid, then EARLIER createdAt (negative so earlier wins)
  return active * 1e16 + payments * 1e15 + paid * 1e14 - created;
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const base = `artifacts/${APP_ID}/public/data`;

  console.log(`FinControl — Dedupe CXC/CXP  [${APPLY ? 'APPLY (will delete)' : 'DRY-RUN (preview)'}]`);
  console.log('═══════════════════════════════════════════════════════════\n');

  let totalToDelete = 0;
  const toDelete = [];

  for (const coll of ['receivables', 'payables']) {
    const snap = await db.collection(`${base}/${coll}`).get();
    const groups = new Map();
    snap.forEach((doc) => {
      const fp = fingerprint(doc.data());
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push({ id: doc.id, data: doc.data() });
    });

    console.log(`■ ${coll} — ${snap.size} docs`);
    let collDel = 0;
    for (const [fp, docs] of groups) {
      if (docs.length < 2) continue;
      docs.sort((a, b) => score(b.data) - score(a.data));
      const keep = docs[0];
      const drop = docs.slice(1);
      collDel += drop.length;
      console.log(`\n  DUP (${docs.length}×): ${fp}`);
      console.log(`    KEEP  ${keep.id}  amount=${keep.data.grossAmount ?? keep.data.amount} status=${keep.data.status} payments=${(keep.data.payments || []).length} createdBy=${keep.data.createdBy || '?'}`);
      for (const x of drop) {
        console.log(`    DROP  ${x.id}  amount=${x.data.grossAmount ?? x.data.amount} status=${x.data.status} payments=${(x.data.payments || []).length} createdBy=${x.data.createdBy || '?'}`);
        toDelete.push(`${base}/${coll}/${x.id}`);
      }
    }
    console.log(`\n  → ${coll}: ${collDel} redundant docs\n`);
    totalToDelete += collDel;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total redundant docs: ${totalToDelete}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing deleted. Re-run with --apply to delete the DROP docs.');
    return;
  }

  const db2 = admin.firestore();
  let batch = db2.batch();
  let n = 0;
  for (const fullPath of toDelete) {
    batch.delete(db2.doc(fullPath));
    if (++n % 400 === 0) { await batch.commit(); batch = db2.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`\n✅ Deleted ${toDelete.length} redundant docs.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
