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
 * auth failure, etc).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  classifyBankImportFiles,
  mergeParsedFiles,
  movementFingerprint,
  parseBankStatementCSV,
} from '../src/finance/bankStatementParser.js';
import { deriveBalance } from '../src/lib/finance/cashPosition.js';
import { addDays } from '../src/lib/finance/dates.js';

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

  // ── Per-month row counts: CSV vs ledger (non-void) ──────────────────────────
  const months = [...new Set([
    ...merged.rows.map((row) => row.postedDate.slice(0, 7)),
    ...ledgerInPeriod.map((m) => String(m.postedDate || '').slice(0, 7)),
  ])].sort();

  console.log('Rows per month — CSV vs ledger (non-void bankMovements):');
  for (const month of months) {
    const csvCount = merged.rows.filter((row) => row.postedDate.startsWith(month)).length;
    const ledgerCount = ledgerInPeriod.filter((m) => String(m.postedDate || '').startsWith(month)).length;
    const flag = csvCount !== ledgerCount ? '  <-- mismatch' : '';
    console.log(`  ${month}: csv=${csvCount} ledger=${ledgerCount}${flag}`);
  }
  console.log('');

  // ── CSV rows not present in the ledger ───────────────────────────────────────
  // Uses the SAME classifyBankImportFiles the real BankImport UI uses — one
  // "existing" check for both, so this report and a real import agree. Two
  // formats never share a rowHash by design (sourceFormat is part of the
  // identity), so historical rows imported under the OLD kontobewegungen
  // format only ever match a fresh Umsätze row through movementFingerprint,
  // which itself tolerates real production quirks beyond plain "&"/"+"
  // spelling: a blank old-format counterparty on fee/closing rows (this
  // parser fills those with the account's bank name) and the old export's
  // mid-word truncation of long counterparty names — see
  // counterpartiesMatchForDedup in bankStatementParser.js.
  const classified = classifyBankImportFiles(
    [{ file: { name: 'merged' }, parsed: { rows: merged.rows, errors: [] } }],
    nonVoidMovements,
  );
  const newRows = classified.files[0].diff.newRows;
  console.log(`CSV rows not found in the ledger (${newRows.length}):`);
  listRows(newRows, (row) => `${row.postedDate}  ${signOf(row.direction)}${fmtEur(row.amount)}  ${row.counterpartyName}`);
  console.log('');

  // ── Ledger rows (within the combined period) not present in the CSV ─────────
  // The reverse direction has no shared helper (classifyBankImportFiles only
  // checks CSV → ledger), so this mirrors its same three-step rule — rowHash,
  // then movementFingerprint, then a date+amount+direction match tolerating a
  // blank-or-truncated counterparty — consuming each CSV row at most once so
  // a single row can't silently "explain away" two different ledger entries.
  const normalizeLoose = (value) =>
    String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const counterpartiesLooselyMatch = (a, b) => {
    const na = normalizeLoose(a);
    const nb = normalizeLoose(b);
    if (na === nb) return true;
    if (!na || !nb) return true; // fee/closing row on one side
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    return shorter.length >= 15 && longer.startsWith(shorter); // truncated export
  };
  const tripleKey = (date, amount, direction) =>
    `${date}|${Math.abs(Number(amount) || 0).toFixed(2)}|${direction}`;

  const csvHashes = new Set(merged.rows.map((row) => row.rowHash).filter(Boolean));
  const csvFingerprints = new Set(merged.rows.map(movementFingerprint));
  const csvByTriple = new Map();
  for (const row of merged.rows) {
    const key = tripleKey(row.postedDate, row.amount, row.direction);
    if (!csvByTriple.has(key)) csvByTriple.set(key, []);
    csvByTriple.get(key).push({ row, consumed: false });
  }

  const orphanLedgerRows = ledgerInPeriod.filter((m) => {
    if (m.rowHash && csvHashes.has(m.rowHash)) return false;
    if (csvFingerprints.has(movementFingerprint(m))) return false;
    const candidates = csvByTriple.get(tripleKey(m.postedDate, m.amount, m.direction)) || [];
    const hit = candidates.find((c) => !c.consumed && counterpartiesLooselyMatch(m.counterpartyName, c.row.counterpartyName));
    if (hit) { hit.consumed = true; return false; }
    return true;
  });
  console.log(`Ledger rows in the CSV period not found in the CSV (${orphanLedgerRows.length}):`);
  listRows(
    orphanLedgerRows,
    (m) => `${m.postedDate}  ${signOf(m.direction)}${fmtEur(m.amount)}  ${m.counterpartyName || ''}  [${m.id}]`,
  );
  console.log('');

  // ── Balance drift, only when at least one file carries a balance column ─────
  if (merged.balances.length > 0) {
    // Self-contained: derive a synthetic opening anchor from the OLDEST
    // parsed row's own balanceAfter, rather than reading settings/reconciliation.
    // mergeParsedFiles orders rows newest-first across the union (files by
    // recency, each file's own newest-first order preserved), so the last
    // row is the globally oldest.
    const oldestRow = merged.rows[merged.rows.length - 1];
    if (typeof oldestRow.balanceAfter !== 'number') {
      console.log('Oldest row has no balanceAfter — cannot derive an opening balance for the drift table.');
    } else {
      const openingBalance = oldestRow.balanceAfter - oldestRow.signedAmount;
      // The anchor date is the day BEFORE the oldest row's own posted date —
      // never the same date — because deriveBalance treats movements dated
      // exactly on the anchor date as already inside its balance. Since
      // openingBalance backs out only the OLDEST row's own effect (there can
      // be same-day siblings, e.g. two 2026-01-02 rows), the anchor must sit
      // one day earlier so every movement dated oldestRow.postedDate —
      // oldestRow included — is counted going forward.
      const syntheticAnchor = { date: addDays(oldestRow.postedDate, -1), balance: openingBalance };
      console.log(`Month-end balances — bank closing | ledger-derived | drift (opening ${fmtEur(openingBalance)} on ${syntheticAnchor.date}, implied by the oldest row):`);
      console.log('  date        bank closing      ledger-derived    drift');
      for (const entry of merged.balances) {
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
    console.log('No file carries a running-balance column — skipping the balance drift table.');
  }

  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
