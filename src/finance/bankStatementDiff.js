import {
  collectBankStatementOccurrences,
  matchBookingOccurrences,
  mergeParsedFiles,
  validateBankStatementSequence,
  representativeBankOccurrence,
} from './bankStatementParser.js';
import { addDays } from '../lib/finance/dates.js';

/** Pure report inputs; shares the importer's occurrence union and ledger match. */
export const diffBankStatementFiles = (files, ledger) => {
  const occurrences = collectBankStatementOccurrences(files);
  const matches = matchBookingOccurrences(occurrences, ledger.map((row) => [row]));
  const unresolved = matches.unresolved || [];
  const heldLeft = new Set(unresolved.flatMap((issue) => issue.left));
  const heldRight = new Set(unresolved.flatMap((issue) => issue.right));
  const unresolvedRows = occurrences.flatMap((aliases, i) => heldLeft.has(i) ? aliases : []);
  // Prefer known evidence per occurrence, not per file or upload position.
  const representatives = occurrences.map(representativeBankOccurrence);
  const rows = representatives.filter((_, i) => !heldLeft.has(i));
  const analysis = mergeParsedFiles(files, unresolvedRows);
  const balanceIssues = [...(analysis.balanceIssues || [])];
  // A source covering the union establishes chronology without quadratic day
  // searches. Separate partial exports do not prove coverage between them.
  const coverage = new Map();
  occurrences.forEach((aliases, i) => aliases.forEach((alias) => {
    if (!coverage.has(alias.sourceFileIndex)) coverage.set(alias.sourceFileIndex, []);
    coverage.get(alias.sourceFileIndex).push({ ...representatives[i], lineNumber: alias.lineNumber,
      balanceSourceIncomplete: alias.balanceSourceIncomplete });
  }));
  const complete = [...coverage.values()].find((group) => group.length === occurrences.length);
  const sequence = validateBankStatementSequence(complete || []);
  if (sequence.reason) balanceIssues.push({ reason: sequence.reason });
  const oldest = sequence.ordered?.[0];
  const consumedLedger = new Set(matches.values());
  return {
    rows,
    ...(unresolved.length ? { unresolved, unresolvedRows, unresolvedLedgerRows: ledger.filter((_, i) => heldRight.has(i)) } : {}),
    balances: analysis.balances,
    ...(balanceIssues.length ? { balanceIssues } : {}),
    newRows: representatives.filter((_, i) => !heldLeft.has(i) && !matches.has(i)),
    orphanLedgerRows: ledger.filter((_, i) => !heldRight.has(i) && !consumedLedger.has(i)),
    openingAnchor: !unresolved.length && !balanceIssues.length && oldest
      ? { date: addDays(oldest.postedDate, -1), balance: sequence.openingCents / 100 }
      : null,
  };
};

// Pure CLI text keeps incomplete evidence distinguishable from a clean report.
export const formatBankMatchingIssues = (report) => {
  const balanceLines = report.balanceIssues?.length
    ? ['Balance sequence unavailable/invalid: drift is UNKNOWN.', ...report.balanceIssues.map((issue) => `  ${issue.reason}`)] : [];
  if (!report.unresolved?.length) return balanceLines;
  const lines = [
    `NEEDS REVIEW: ${report.unresolvedRows.length} source rows and ${report.unresolvedLedgerRows.length} ledger rows withheld.`,
    'Complete booking counts, orphan totals and balance drift are UNKNOWN; only confirmed differences follow.',
  ];
  for (const issue of report.unresolved) {
    lines.push(`  ${issue.reason} (${issue.phase}, ${issue.work} work units)`);
    for (const source of issue.sources) lines.push(`    ${source.file}: line ${source.line} [${source.rowHash}]`);
  }
  return [...lines, ...balanceLines];
};

/** Reverse diff; unresolved components are withheld, not confirmed orphans. */
export const findOrphanLedgerRows = (rows, ledger) => {
  const occurrences = collectBankStatementOccurrences([{ rows }]);
  const matches = matchBookingOccurrences(occurrences, ledger.map((row) => [row]));
  const consumed = new Set(matches.values());
  const held = new Set((matches.unresolved || []).flatMap((issue) => issue.right));
  const orphans = ledger.filter((_, i) => !held.has(i) && !consumed.has(i));
  if (matches.unresolved) orphans.unresolved = matches.unresolved;
  return orphans;
};
