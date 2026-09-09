#!/usr/bin/env node
/**
 * diff-bank-statement.mjs — read-only reconciliation diff between a fresh
 * Volksbank "kontobewegungen_export" CSV and the live bankMovements ledger.
 *
 * Usage:
 *   node scripts/diff-bank-statement.mjs <csv path>
 *
 * Prints, for the period the CSV covers:
 *   - row counts per month: CSV vs ledger (non-void bankMovements)
 *   - CSV rows not found in the ledger (via classifyBankImportFiles → newRows)
 *     — date, amount, counterparty
 *   - ledger rows (within the CSV's period) not found in the CSV — matched by
 *     rowHash first, then by movementFingerprint — same fields
 *   - if the CSV carries a running-balance column: for each month-end, the
 *     bank's own balance vs the balance this app's anchors + ledger would
 *     derive for that date, and the drift between them
 *
 * Read-only: never writes to Firestore. Always exits 0 on a normal run
 * (including "nothing to report"); exits 1 only on a hard failure (bad path,
 * Firestore auth failure, etc).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  classifyBankImportFiles,
  movementFingerprint,
  parseBankStatementCSV,
} from '../src/finance/bankStatementParser.js';
import { deriveBalance } from '../src/lib/finance/cashPosition.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const MAX_LISTED_ROWS = 200;

const fmtEur = (n) =>
  Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signOf = (direction) => (direction === 'out' ? '-' : '+');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/diff-bank-statement.mjs <csv path>');
  process.exit(1);
}

const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require(path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json')),
    ),
  });
}
const db = admin.firestore();

const listRows = (rows, formatOne) => {
  for (const row of rows.slice(0, MAX_LISTED_ROWS)) console.log(`  ${formatOne(row)}`);
  if (rows.length > MAX_LISTED_ROWS) {
    console.log(`  … and ${rows.length - MAX_LISTED_ROWS} more`);
  }
};

const main = async () => {
  const text = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseBankStatementCSV(text);

  console.log(`File: ${csvPath}`);
  if (parsed.errors.some((error) => error.type === 'unsupported-format')) {
    console.log(`Unsupported CSV format: ${parsed.errors[0].message}`);
    process.exit(0);
    return;
  }

  console.log(`Rows parsed: ${parsed.rows.length}  |  parse errors: ${parsed.errors.length}`);
  if (parsed.period) {
    console.log(`Period: ${parsed.period.minDate} → ${parsed.period.maxDate}`);
  } else {
    console.log('Period: (no valid rows)');
    process.exit(0);
    return;
  }
  console.log('');

  const movementsSnap = await db.collection(`artifacts/${APP_ID}/public/data/bankMovements`).get();
  const allMovements = movementsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const nonVoidMovements = allMovements.filter((m) => m.status !== 'void');

  const { minDate, maxDate } = parsed.period;
  const inPeriod = (date) => typeof date === 'string' && date >= minDate && date <= maxDate;
  const ledgerInPeriod = nonVoidMovements.filter((m) => inPeriod(String(m.postedDate || '')));

  // ── Per-month row counts: CSV vs ledger (non-void) ──────────────────────────
  const months = [...new Set([
    ...parsed.rows.map((row) => row.postedDate.slice(0, 7)),
    ...ledgerInPeriod.map((m) => String(m.postedDate || '').slice(0, 7)),
  ])].sort();

  console.log('Rows per month — CSV vs ledger (non-void bankMovements):');
  for (const month of months) {
    const csvCount = parsed.rows.filter((row) => row.postedDate.startsWith(month)).length;
    const ledgerCount = ledgerInPeriod.filter((m) => String(m.postedDate || '').startsWith(month)).length;
    const flag = csvCount !== ledgerCount ? '  <-- mismatch' : '';
    console.log(`  ${month}: csv=${csvCount} ledger=${ledgerCount}${flag}`);
  }
  console.log('');

  // ── CSV rows not present in the ledger ───────────────────────────────────────
  const classified = classifyBankImportFiles(
    [{ file: { name: path.basename(csvPath) }, parsed: { rows: parsed.rows, errors: parsed.errors } }],
    nonVoidMovements,
  );
  const newRows = classified.files[0].diff.newRows;
  console.log(`CSV rows not found in the ledger (${newRows.length}):`);
  listRows(newRows, (row) => `${row.postedDate}  ${signOf(row.direction)}${fmtEur(row.amount)}  ${row.counterpartyName}`);
  console.log('');

  // ── Ledger rows (within the CSV's period) not present in the CSV ────────────
  const csvHashes = new Set(parsed.rows.map((row) => row.rowHash).filter(Boolean));
  const csvFingerprints = new Set(parsed.rows.map(movementFingerprint));
  const orphanLedgerRows = ledgerInPeriod.filter((m) => {
    if (m.rowHash && csvHashes.has(m.rowHash)) return false;
    return !csvFingerprints.has(movementFingerprint(m));
  });
  console.log(`Ledger rows in the CSV period not found in the CSV (${orphanLedgerRows.length}):`);
  listRows(
    orphanLedgerRows,
    (m) => `${m.postedDate}  ${signOf(m.direction)}${fmtEur(m.amount)}  ${m.counterpartyName || ''}  [${m.id}]`,
  );
  console.log('');

  // ── Balance drift, only when the CSV carries a running-balance column ───────
  if (parsed.balances.length > 0) {
    const reconciliationSnap = await db
      .doc(`artifacts/${APP_ID}/public/data/settings/reconciliation`)
      .get();
    const anchors = reconciliationSnap.exists ? (reconciliationSnap.data()?.anchors || []) : [];
    console.log(`Month-end balances — CSV vs derived from ${anchors.length} anchor(s) + ledger:`);
    for (const entry of parsed.balances) {
      const derivedPosition = deriveBalance({ anchors, movements: nonVoidMovements, today: entry.date });
      const derived = derivedPosition.balance;
      const driftText = derived == null
        ? 'n/a (no anchor covers this date)'
        : `derived=${fmtEur(derived)}  drift=${fmtEur(derived - entry.balance)}`;
      console.log(`  ${entry.date}: bank=${fmtEur(entry.balance)}  ${driftText}`);
    }
  } else {
    console.log('CSV carries no running-balance column — skipping balance drift check.');
  }

  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
