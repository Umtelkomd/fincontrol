#!/usr/bin/env node
/**
 * backfill-sepa-description.cjs — extract SEPA-structured purpose fields for
 * bankMovements imported before `parseSepaPurpose` existed.
 *
 * For every bankMovement with a raw Verwendungszweck text at
 * `rawDatev.columns[7]` and no `sepa` field yet, computes the SEPA breakdown
 * and plans:
 *   - description: sepa.purpose when non-empty, else the raw text — the same
 *     rule `parseBankStatementCSV` uses for new imports.
 *   - sepa: the parsed breakdown ({ endToEndRef, customerRef, mandateRef,
 *     creditorId, debtorId, purposeCode, purpose, alternativeCounterparty }).
 *
 * Default: DRY RUN. Prints the eligible count and up to 10 before/after
 * samples. Nothing is written unless --apply is passed.
 *
 * --apply writes in batches of 400, stamping
 * `updatedBy: 'backfill-sepa-description'` and appending one auditTrail entry
 * per document. rowHash/rowFingerprint/importSource are untouched — this only
 * ever rewrites `description` and adds `sepa`.
 *
 * Usage:
 *   node scripts/backfill-sepa-description.cjs           # dry run (default)
 *   node scripts/backfill-sepa-description.cjs --apply   # writes
 *
 * Requires the service account key at ~/.credentials/umtelkomd-firebase.json
 */
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BATCH_SIZE = 400;
const SAMPLE_SIZE = 10;

const apply = process.argv.includes('--apply');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require(path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json')),
    ),
  });
}
const db = admin.firestore();

const main = async () => {
  // The parser is an ES module; this script is CommonJS (Node 20+ resolves
  // ESM from CJS via a dynamic import of a file:// URL).
  const parserPath = path.join(__dirname, '..', 'src', 'finance', 'bankStatementParser.js');
  const { parseSepaPurpose } = await import(pathToFileURL(parserPath).href);

  const snapshot = await db.collection(`artifacts/${APP_ID}/public/data/bankMovements`).get();

  const candidates = [];
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const raw = String(data?.rawDatev?.columns?.[7] ?? '');
    if (!raw) return; // no raw Verwendungszweck to backfill from
    if (data.sepa != null) return; // already has a sepa field — nothing to do
    const sepa = parseSepaPurpose(raw);
    const description = sepa.purpose || raw;
    candidates.push({ id: doc.id, before: data.description || '', after: description, sepa });
  });

  console.log(`Eligible bankMovements (rawDatev.columns[7] present, no sepa field yet): ${candidates.length}`);
  console.log(`Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log('');
  console.log(`Sample (up to ${SAMPLE_SIZE} of ${candidates.length}):`);
  for (const candidate of candidates.slice(0, SAMPLE_SIZE)) {
    console.log(`  [${candidate.id}]`);
    console.log(`    before: ${JSON.stringify(candidate.before)}`);
    console.log(`    after:  ${JSON.stringify(candidate.after)}`);
  }

  if (!apply) {
    console.log('');
    console.log('Dry run only — pass --apply to write. Nothing was written.');
    process.exit(0);
    return;
  }

  let written = 0;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const chunk = candidates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    const nowIso = new Date().toISOString();
    for (const candidate of chunk) {
      const ref = db.doc(`artifacts/${APP_ID}/public/data/bankMovements/${candidate.id}`);
      batch.update(ref, {
        description: candidate.after,
        sepa: candidate.sepa,
        updatedBy: 'backfill-sepa-description',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        auditTrail: admin.firestore.FieldValue.arrayUnion({
          action: 'backfill-sepa-description',
          user: 'backfill-sepa-description',
          timestamp: nowIso,
          detail: `SEPA purpose extracted: ${JSON.stringify(candidate.before)} -> ${JSON.stringify(candidate.after)}`,
        }),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`Committed batch: ${written}/${candidates.length}`);
  }
  console.log(`Done. ${written} document(s) updated.`);
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
