/**
 * migrate2025ToFirestore — moves the 419 bundled 2025 transactions into the
 * live Firestore `transactions` collection (Plan 003, Option A).
 *
 * Modes:
 *   node scripts/migrate2025ToFirestore.mjs --dry-run   # print count + sample, write NOTHING
 *   node scripts/migrate2025ToFirestore.mjs --check     # READ-ONLY report on the live collection
 *   node scripts/migrate2025ToFirestore.mjs             # real migration (419 idempotent writes)
 *
 * Idempotency: each record's own stable id (`sheet-2025-N`) is used as the
 * Firestore doc id, so re-running overwrites instead of duplicating.
 *
 * Data source: `src/data/transactions2025.js` if present in the working tree;
 * otherwise falls back to `git show HEAD:src/data/transactions2025.js` (the
 * refactor deletes the file from the working tree before the migration runs).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import admin from 'firebase-admin';

const DEFAULT_APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const DEFAULT_KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const OPERATIONAL_DATA_START = '2026-01-01'; // mirrors src/finance/constants.js
const SHEET_ID_PREFIX = 'sheet-2025-';

const expandHome = (value) => (value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const appIdArg = args.find((entry) => entry.startsWith('--app-id='))?.split('=')[1];
const keyPathArg = args.find((entry) => entry.startsWith('--service-account='))?.split('=')[1];

const appId = process.env.FINCONTROL_APP_ID || appIdArg || DEFAULT_APP_ID;
const serviceAccountPath = expandHome(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || keyPathArg || DEFAULT_KEY_PATH,
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const dataFilePath = path.join(repoRoot, 'src', 'data', 'transactions2025.js');
const collectionPath = ['artifacts', appId, 'public', 'data', 'transactions'].join('/');

// ── Load the 2025 dataset (working tree, or git HEAD fallback) ──────────────

const load2025Records = async () => {
  if (fs.existsSync(dataFilePath)) {
    const mod = await import(pathToFileURL(dataFilePath).href);
    return { records: mod.transactions2025 || mod.default || [], origin: dataFilePath };
  }
  // The refactor removes the file from the working tree; read it from HEAD.
  const source = execFileSync('git', ['show', 'HEAD:src/data/transactions2025.js'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const tempPath = path.join(os.tmpdir(), `transactions2025-${process.pid}.mjs`);
  fs.writeFileSync(tempPath, source);
  try {
    const mod = await import(pathToFileURL(tempPath).href);
    return {
      records: mod.transactions2025 || mod.default || [],
      origin: 'git show HEAD:src/data/transactions2025.js',
    };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
};

const { records, origin } = await load2025Records();

const invalid = records.filter((record) => !record.id || !String(record.id).startsWith(SHEET_ID_PREFIX));
if (invalid.length > 0) {
  console.error(`Aborting: ${invalid.length} record(s) missing a stable ${SHEET_ID_PREFIX}* id.`);
  process.exit(1);
}
const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
if (duplicateIds > 0) {
  console.error(`Aborting: ${duplicateIds} duplicate id(s) in the 2025 dataset.`);
  process.exit(1);
}

console.log(`Loaded ${records.length} records from: ${origin}`);
console.log(`Target collection: ${collectionPath}`);

// ── Dry run: report and exit before touching Firestore ──────────────────────

if (dryRun) {
  console.log(`Mode: dry-run (no writes)`);
  console.log(`Planned writes: ${records.length}`);
  console.log('Sample (first 3):');
  for (const record of records.slice(0, 3)) {
    console.log(`  ${record.id}  ${record.date}  ${record.type}  ${record.amount}  ${record.description}`);
  }
  console.log('Sample (last 1):');
  const last = records[records.length - 1];
  console.log(`  ${last.id}  ${last.date}  ${last.type}  ${last.amount}  ${last.description}`);
  process.exit(0);
}

// ── Firestore init (check + real modes only) ────────────────────────────────

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Service account not found: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const transactionsCollection = db.collection(collectionPath);

// ── Check mode: READ-ONLY report on the live collection ─────────────────────

if (checkOnly) {
  console.log('Mode: check (read-only)');
  const snapshot = await transactionsCollection.get();
  const docs = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

  const pre2026 = docs.filter(
    (entry) => entry.date && String(entry.date).slice(0, 10) < OPERATIONAL_DATA_START,
  );
  const sheetDocs = docs.filter((entry) => entry.id.startsWith(SHEET_ID_PREFIX));
  const pre2026NonSheet = pre2026.filter((entry) => !entry.id.startsWith(SHEET_ID_PREFIX));

  console.log(`Total docs in collection:            ${docs.length}`);
  console.log(`Docs with date < ${OPERATIONAL_DATA_START}:        ${pre2026.length}`);
  console.log(`Docs with id ${SHEET_ID_PREFIX}*:           ${sheetDocs.length}`);
  console.log(`Pre-2026 docs NOT ${SHEET_ID_PREFIX}* (STOP condition if > 0): ${pre2026NonSheet.length}`);
  if (pre2026NonSheet.length > 0) {
    console.log('Offending docs:');
    for (const entry of pre2026NonSheet.slice(0, 20)) {
      console.log(`  ${entry.id}  ${entry.date}  ${entry.type ?? '?'}  ${entry.amount ?? '?'}  ${entry.description ?? ''}`);
    }
    if (pre2026NonSheet.length > 20) console.log(`  ... and ${pre2026NonSheet.length - 20} more`);
  }
  process.exit(0);
}

// ── Real migration: idempotent setDoc per record, batches of 400 ────────────

const chunk = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

console.log('Mode: write');
let written = 0;
for (const batchRecords of chunk(records, 400)) {
  const batch = db.batch();
  for (const record of batchRecords) {
    const ref = transactionsCollection.doc(record.id);
    batch.set(ref, {
      ...record,
      source: record.source || '2025-sheet',
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      migratedBy: 'migrate2025ToFirestore',
    });
  }
  await batch.commit();
  written += batchRecords.length;
  console.log(`Committed ${written}/${records.length}`);
}

const verify = await transactionsCollection
  .where(admin.firestore.FieldPath.documentId(), '>=', SHEET_ID_PREFIX)
  .where(admin.firestore.FieldPath.documentId(), '<', `${SHEET_ID_PREFIX}\uf8ff`)
  .get();

console.log(JSON.stringify({ planned: records.length, written, sheetDocsInFirestore: verify.size }, null, 2));
