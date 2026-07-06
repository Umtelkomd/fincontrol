/**
 * FinControl — Data Health Diagnostic (READ-ONLY)
 *
 * Reads Firestore and reports, per collection:
 *   - total docs, split by year
 *   - origin breakdown (importSource / source / migrationSource)
 *   - duplicate detection for bankMovements (by rowHash, then by fingerprint)
 *   - duplicate detection for receivables/payables (vendor|invoice|amount)
 *
 * DOES NOT WRITE OR DELETE ANYTHING.
 *
 * HOW TO RUN:
 *   node scripts/diagnose-data.cjs
 *
 * Requires service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const SERVICE_ACCOUNT = require(KEY_PATH);
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';

function getYear(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') return parseInt(dateVal.substring(0, 4), 10);
  if (dateVal.toDate) return dateVal.toDate().getFullYear();
  return null;
}

function bump(map, key) {
  const k = key == null ? '(none)' : String(key);
  map.set(k, (map.get(k) || 0) + 1);
}

function printMap(label, map) {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`    ${label}:`);
  for (const [k, v] of entries) console.log(`      ${k.padEnd(28)} ${v}`);
}

async function diagnose() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
  }
  const db = admin.firestore();
  const basePath = `artifacts/${APP_ID}/public/data`;

  const collections = ['transactions', 'bankMovements', 'receivables', 'payables'];

  console.log('FinControl — DATA HEALTH DIAGNOSTIC (read-only)');
  console.log('════════════════════════════════════════════════');
  console.log(`App ID: ${APP_ID}\n`);

  for (const coll of collections) {
    const snap = await db.collection(`${basePath}/${coll}`).get();
    const byYear = new Map();
    const byOrigin = new Map();
    const hashCounts = new Map();      // bankMovements: rowHash
    const fpCounts = new Map();        // bankMovements: date|amount|dir|cp
    const apFpCounts = new Map();      // receivables/payables: vendor|invoice|amount

    snap.forEach((doc) => {
      const d = doc.data();
      bump(byYear, getYear(d.date || d.dueDate || d.transactionDate || d.postedDate));
      bump(byOrigin, d.importSource || d.migrationSource || d.source || '(untagged)');

      // Fingerprints mirror src/features/cfo/lib/cfoMetrics.js — keep in sync.
      // Purpose is included because date|amount|dir|counterparty alone flags
      // legitimate distinct payments (rent + loan installment, same day/person).
      if (coll === 'bankMovements') {
        if (d.rowHash) bump(hashCounts, d.rowHash);
        const fp = [d.postedDate || d.date, d.amount ?? d.signedAmount, d.direction,
          (d.counterpartyName || '').trim().toLowerCase(),
          (d.purpose || d.description || '').trim().toLowerCase().slice(0, 60)].join('|');
        bump(fpCounts, fp);
      }
      // Installment series (same vendor+amount, no invoice, different dates)
      // are normal — only same invoice number, or same description+issueDate,
      // counts as a duplicate.
      if (coll === 'receivables' || coll === 'payables') {
        const vendor = (d.vendor || d.client || d.counterpartyName || '').trim().toLowerCase();
        const amount = d.amount ?? d.total ?? '';
        const invoice = d.invoiceNumber || d.invoice || '';
        const fp = invoice
          ? `${vendor}|inv:${invoice}|${amount}`
          : `${vendor}|desc:${(d.description || '').trim().toLowerCase()}|${d.issueDate || ''}|${amount}`;
        bump(apFpCounts, fp);
      }
    });

    console.log(`\n■ ${coll} — ${snap.size} docs`);
    printMap('by year', byYear);
    printMap('by origin', byOrigin);

    if (coll === 'bankMovements') {
      const dupHash = [...hashCounts.values()].filter(v => v > 1);
      const dupFp = [...fpCounts.values()].filter(v => v > 1);
      const extraHash = dupHash.reduce((s, v) => s + (v - 1), 0);
      const extraFp = dupFp.reduce((s, v) => s + (v - 1), 0);
      console.log(`    duplicates by rowHash:      ${dupHash.length} groups, ${extraHash} redundant docs`);
      console.log(`    duplicates by fingerprint:  ${dupFp.length} groups, ${extraFp} redundant docs`);
    }
    if (coll === 'receivables' || coll === 'payables') {
      const dup = [...apFpCounts.values()].filter(v => v > 1);
      const extra = dup.reduce((s, v) => s + (v - 1), 0);
      console.log(`    duplicates by vendor|invoice|amount: ${dup.length} groups, ${extra} redundant docs`);
    }
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('Read-only. Nothing was modified.');
}

diagnose().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
