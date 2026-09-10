#!/usr/bin/env node
/**
 * diff-bank-statement.mjs — read-only reconciliation diff between one or
 * more fresh bank statement CSVs and the live bankMovements ledger. Each
 * file is parsed independently through `parseBankStatementCSV` (one format
 * per file, auto-detected — kontobewegungen_export or Umsätze, no ad-hoc
 * mapping), then combined via `mergeParsedFiles` — the same union logic
 * `BankImport.jsx` uses — so a month a single file left partial (e.g. an
 * Abril-Mayo export's last booking 2026-05-29) correctly closes to its
 * calendar month-end once a later file's rows cover that month too.
 *
 * Usage:
 *   node scripts/diff-bank-statement.mjs <csv path> [<csv path> ...]
 *
 * Prints, for the union of every file's period:
 *   - row counts per month: CSV vs ledger (non-void bankMovements)
 *   - CSV rows not found in the ledger — date, amount, counterparty
 *   - ledger rows (within the combined period) not found in the CSV —
 *     matched by rowHash first, then by movementFingerprint — same fields
 *   - if any file carries a balance column: a per-month "bank closing |
 *     ledger-derived | drift" table. The ledger-derived figure is computed
 *     from a SYNTHETIC opening balance implied by the oldest parsed row
 *     (its own balanceAfter minus its own signed amount = the balance right
 *     before it) plus every non-void ledger movement after that date —
 *     this is self-contained (it does not read settings/reconciliation).
 *
 * Read-only: never writes to Firestore. Exits 0 on a normal run (including
 * "nothing to report"); exits 1 only on a hard failure (bad path, Firestore
 * auth failure, etc); exits 2 when matching is incomplete and needs review.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  mergeParsedFiles,
  parseBankStatementCSV,
} from '../src/finance/bankStatementParser.js';
import { diffBankStatementFiles, formatBankMatchingIssues } from '../src/finance/bankStatementDiff.js';
import { deriveBalance } from '../src/lib/finance/cashPosition.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const MAX_LISTED_ROWS = 200;

const fmtEur = (n) =>
  Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signOf = (direction) => (direction === 'out' ? '-' : '+');

const csvPaths = process.argv.slice(2);
if (csvPaths.length === 0) {
  console.error('Usage: node scripts/diff-bank-statement.mjs <csv path> [<csv path> ...]');
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
  const parsedFiles = [];
  for (const csvPath of csvPaths) {
    const text = fs.readFileSync(csvPath, 'utf8');
    const parsed = parseBankStatementCSV(text);
    const name = path.basename(csvPath);
    console.log(`File: ${csvPath}`);
    if (parsed.errors.some((error) => error.type === 'unsupported-format')) {
      console.log(`  Unsupported CSV format: ${parsed.errors[0].message}`);
      continue;
    }
    console.log(`  Rows parsed: ${parsed.rows.length}  |  parse errors: ${parsed.errors.length}  |  format: ${parsed.rows[0]?.sourceFormat || 'n/a'}`);
    if (parsed.period) {
      console.log(`  Period: ${parsed.period.minDate} → ${parsed.period.maxDate}`);
    } else {
      console.log('  Period: (no valid rows)');
    }
    parsedFiles.push({ name, rows: parsed.rows, period: parsed.period });
  }
  console.log('');

  const merged = mergeParsedFiles(parsedFiles);
  if (merged.rows.length === 0) {
    console.log('No usable rows across the given file(s) — nothing to diff.');
    process.exit(0);
    return;
  }

  const minDate = merged.rows.reduce((min, row) => (row.postedDate < min ? row.postedDate : min), merged.rows[0].postedDate);
  const maxDate = merged.rows.reduce((max, row) => (row.postedDate > max ? row.postedDate : max), merged.rows[0].postedDate);
  console.log(`Combined period: ${minDate} → ${maxDate}  (${merged.rows.length} rows across ${parsedFiles.length} file(s))`);
  console.log('');

  const movementsSnap = await db.collection(`artifacts/${APP_ID}/public/data/bankMovements`).get();
  const allMovements = movementsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const nonVoidMovements = allMovements.filter((m) => m.status !== 'void');

  const inPeriod = (date) => typeof date === 'string' && date >= minDate && date <= maxDate;
  const ledgerInPeriod = nonVoidMovements.filter((m) => inPeriod(String(m.postedDate || '')));
  const report = diffBankStatementFiles(parsedFiles, ledgerInPeriod);

  // ── Per-month row counts: CSV vs ledger (non-void) ──────────────────────────
  const months = [...new Set([
    ...report.rows.map((row) => row.postedDate.slice(0, 7)),
    ...ledgerInPeriod.map((m) => String(m.postedDate || '').slice(0, 7)),
  ])].sort();

  const uncertain = (report.unresolved || []).length > 0 || (report.balanceIssues || []).length > 0;
  if (uncertain) console.log(formatBankMatchingIssues(report).join('\n'));
  else console.log('Rows per month — CSV vs ledger (non-void bankMovements):');
  for (const month of uncertain ? [] : months) {
    const csvCount = report.rows.filter((row) => row.postedDate.startsWith(month)).length;
    const ledgerCount = ledgerInPeriod.filter((m) => String(m.postedDate || '').startsWith(month)).length;
    const flag = csvCount !== ledgerCount ? '  <-- mismatch' : '';
    console.log(`  ${month}: csv=${csvCount} ledger=${ledgerCount}${flag}`);
  }
  console.log('');

  // ── CSV rows not present in the ledger ───────────────────────────────────────
  // Shared occurrence union and one-to-one ledger assignment: overlapping
  // exports are representations, not extra evidence for extra ledger documents.
  const { newRows, orphanLedgerRows } = report;
  console.log(`${uncertain ? 'Confirmed differences only — ' : ''}CSV rows not found in the ledger (${newRows.length}):`);
  listRows(newRows, (row) => `${row.postedDate}  ${signOf(row.direction)}${fmtEur(row.amount)}  ${row.counterpartyName}`);
  console.log('');

  // ── Ledger rows (within the combined period) not present in the CSV ─────────
  console.log(`${uncertain ? 'Confirmed differences only — ' : ''}Ledger rows in the CSV period not found in the CSV (${orphanLedgerRows.length}):`);
  listRows(
    orphanLedgerRows,
    (m) => `${m.postedDate}  ${signOf(m.direction)}${fmtEur(m.amount)}  ${m.counterpartyName || ''}  [${m.id}]`,
  );
  console.log('');

  // ── Balance drift, only when at least one file carries a balance column ─────
  if (report.balances.length > 0) {
    const syntheticAnchor = report.openingAnchor;
    if (!syntheticAnchor) {
      console.log('Earliest booking sequence is incomplete or ambiguous — cannot derive an opening balance for the drift table.');
    } else {
      // The pure helper backs out the earliest distinct booking and anchors
      // the previous day, so cashPosition includes every booking on day one.
      const openingBalance = syntheticAnchor.balance;
      console.log(`Observed closing balances — bank closing | ledger-derived | drift (opening ${fmtEur(openingBalance)} on ${syntheticAnchor.date}, implied by the oldest row):`);
      console.log('  date        bank closing      ledger-derived    drift');
      for (const entry of report.balances) {
        const derived = deriveBalance({
          anchors: [syntheticAnchor],
          movements: nonVoidMovements,
          today: entry.date,
        }).balance;
        const rawDrift = derived == null ? null : derived - entry.balance;
        // Avoid a cosmetic "-0,00" from float rounding when the true drift is zero.
        const drift = rawDrift == null ? null : (Math.abs(rawDrift) < 0.005 ? 0 : rawDrift);
        const driftText = drift == null ? 'n/a' : fmtEur(drift);
        console.log(
          `  ${entry.date}  ${fmtEur(entry.balance).padStart(14)}  ${(derived == null ? 'n/a' : fmtEur(derived)).padStart(16)}  ${driftText.padStart(10)}`,
        );
      }
    }
  } else {
    console.log('No authoritative closing balance — skipping the balance drift table.');
  }

  process.exit(uncertain ? 2 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
