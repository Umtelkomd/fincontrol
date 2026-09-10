import { describe, expect, it } from 'vitest';
import { diffBankStatementFiles } from './bankStatementDiff.js';

import {
  BANK_IMPORT_SOURCES,
  authoritativeBankEvidence,
  bankRowFingerprint,
  buildBankRowIdentity,
  classifyBankImportFiles,
  bankRowToMovementPayload,
  deriveMonthEndBalances,
  diffAgainstExisting,
  isBankImport,
  mergeParsedFiles,
  matchBookingOccurrences,
  movementFingerprint,
  normalizeBankRowAmount,
  normalizeBankRowCounterparty,
  normalizeBankRowDate,
  normalizeBankRowDescription,
  normalizeBankRowIbanBic,
  normalizeBankRowRawColumns,
  parseBankStatementCSV,
  parseSepaPurpose,
} from './bankStatementParser.js';

const kontobewegungenHeader = [
  'Automat',
  'Sammlerauflösung',
  'Buchungsdatum',
  'Valutadatum',
  'Empfängername/Auftraggeber',
  'IBAN/Kontonummer',
  'BIC/BLZ',
  'Verwendungszweck',
  'Betrag in EUR',
  'Notiz',
  'Anzahl Belege',
  'Geprüft',
].join(';');

const kontobewegungenRow = ({
  postedDate = '08.05.2026',
  valueDate = '09.05.2026',
  counterparty = 'ACME GmbH',
  iban = 'de89 3704 0044 0532 0130 00',
  bic = 'coba de ff xxx',
  description = 'Rechnung 4711',
  amount = '1.234,56',
} = {}) => [
  'Nein',
  'Nein',
  postedDate,
  valueDate,
  counterparty,
  iban,
  bic,
  description,
  amount,
  '',
  '0',
  'Ja',
].join(';');

/** Insert a balance column header/value at an arbitrary position (0-12). */
const withBalanceColumn = (line, value, position) => {
  const cols = line.split(';');
  cols.splice(position, 0, value);
  return cols.join(';');
};

const balanceHeaderAt = (position, name = 'Saldo') =>
  withBalanceColumn(kontobewegungenHeader, name, position);

const balanceRowAt = (rowLine, balance, position) =>
  withBalanceColumn(rowLine, balance, position);

const umsaetzeHeader = [
  'Bezeichnung Auftragskonto',
  'IBAN Auftragskonto',
  'BIC Auftragskonto',
  'Bankname Auftragskonto',
  'Buchungstag',
  'Valutadatum',
  'Name Zahlungsbeteiligter',
  'IBAN Zahlungsbeteiligter',
  'BIC (SWIFT-Code) Zahlungsbeteiligter',
  'Buchungstext',
  'Verwendungszweck',
  'Betrag',
  'Waehrung',
  'Saldo nach Buchung',
  'Bemerkung',
  'Gekennzeichneter Umsatz',
  'Glaeubiger ID',
  'Mandatsreferenz',
].join(';');

const umsaetzeRow = ({
  accountLabel = 'Geschäftskonto Klassik',
  accountIban = 'DE76130910540001342860',
  accountBic = 'GENODEF1HST',
  accountBankName = 'Volksbank Vorpommern eG',
  postedDate = '08.09.2026',
  valueDate = '08.09.2026',
  counterparty = 'ACME GmbH',
  counterpartyIban = 'DE49700400410225563601',
  counterpartyBic = 'COBADEFF',
  bookingText = 'Überweisungsauftrag',
  description = 'Rechnung 4711',
  amount = '-100,00',
  currency = 'EUR',
  balance = '-1000,00',
  remark = '',
  flagged = '',
  creditorId = '',
  mandateRef = '',
} = {}) => [
  accountLabel,
  accountIban,
  accountBic,
  accountBankName,
  postedDate,
  valueDate,
  counterparty,
  counterpartyIban,
  counterpartyBic,
  bookingText,
  description,
  amount,
  currency,
  balance,
  remark,
  flagged,
  creditorId,
  mandateRef,
].join(';');

describe('bank statement parser identity normalization', () => {
  it.each([['100', 100], ['100,0', 100], ['100,00', 100], [' +1.234,5 ', 1234.5], [' -1.234,56 ', -1234.56], ['-0,01', -0.01], ['1234567,89', 1234567.89]]
    .flatMap(([amount, expected]) => [false, true].map((umsaetze) => [amount, expected, umsaetze])))('accepts observed German amount %s unchanged (value=%s, umsaetze=%s)', (amount, expected, umsaetze) => {
    const header = umsaetze ? umsaetzeHeader : kontobewegungenHeader;
    const line = umsaetze ? umsaetzeRow({ amount }) : kontobewegungenRow({ amount });
    const parsed = parseBankStatementCSV(`${header}\n${line}`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].signedAmount).toBe(expected);
    expect(parsed.rows[0].raw.columns).toContain(amount);
    expect(normalizeBankRowAmount(amount)).toBe(expected.toFixed(2));
  });
  it('keeps legacy amount identity normalization permissive', () => {
    expect(normalizeBankRowAmount('100,00garbage')).toBe('100.00');
  });

  it('normalizes dates, amounts, counterparties, IBAN/BIC, descriptions, and raw columns for identity', () => {
    expect(normalizeBankRowDate('8.5.2026')).toBe('2026-05-08');
    expect(normalizeBankRowAmount('1.234,50')).toBe('1234.50');
    expect(normalizeBankRowAmount('-12,9')).toBe('-12.90');
    expect(normalizeBankRowAmount(1234.5)).toBe('1234.50');
    expect(normalizeBankRowCounterparty('  ACME   GmbH  ')).toBe('acme gmbh');
    expect(normalizeBankRowIbanBic(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(normalizeBankRowDescription(' Rechnung   4711\nFinal ')).toBe('rechnung 4711 final');
    expect(normalizeBankRowRawColumns([' A  ', 'B\nC', null])).toEqual(['A', 'B C', '']);
  });

  it('builds stable row identity independent of file order or import run metadata', () => {
    const baseRow = {
      sourceFormat: 'sparkasse-kontobewegungen',
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      signedAmount: 1234.56,
      counterpartyName: 'ACME GmbH',
      counterpartyIban: 'de89 3704 0044 0532 0130 00',
      counterpartyBic: 'coba de ff xxx',
      rawDescription: 'Rechnung 4711',
      raw: { columns: ['ACME GmbH', '1.234,56'], line: 7 },
      importRunId: 'run-a',
    };

    const sameLogicalRow = {
      ...baseRow,
      counterpartyName: '  acme   gmbh ',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      importRunId: 'run-b',
      raw: { columns: [' ACME   GmbH ', ' 1.234,56 '], line: 42 },
    };

    expect(buildBankRowIdentity(baseRow)).toEqual(buildBankRowIdentity(sameLogicalRow));
  });

  it('keeps similar rows distinct when identity-relevant bank fields differ', () => {
    const base = {
      sourceFormat: 'sparkasse-kontobewegungen',
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      signedAmount: -99.99,
      counterpartyName: 'ACME GmbH',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Invoice A',
      raw: { columns: ['ACME GmbH', 'Invoice A'], line: 2 },
    };

    const changedReference = {
      ...base,
      rawDescription: 'Invoice B',
      raw: { columns: ['ACME GmbH', 'Invoice B'], line: 3 },
    };

    expect(buildBankRowIdentity(base).rowHash).not.toBe(buildBankRowIdentity(changedReference).rowHash);
    expect(buildBankRowIdentity(base).rowFingerprint).not.toBe(buildBankRowIdentity(changedReference).rowFingerprint);
  });
});

describe('bank statement parser row identity fields', () => {
  it('parses signed inbound rows while keeping compatible absolute amount and direction', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: 1234.56,
      amount: 1234.56,
      direction: 'in',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Rechnung 4711',
      lineNumber: 2,
      sourceFormat: 'sparkasse-kontobewegungen',
    });
    expect(parsed.rows[0].rowHash).toBe(buildBankRowIdentity(parsed.rows[0]).rowHash);
    expect(parsed.rows[0].raw).toEqual({
      columns: kontobewegungenRow().split(';'),
      line: 2,
    });
  });

  it('parses signed outbound rows while preserving absolute amount compatibility', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-987,65', description: 'Miete Mai' })}`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: -987.65,
      amount: 987.65,
      direction: 'out',
      rawDescription: 'Miete Mai',
    });
  });
});

describe('bank statement row identity stability', () => {
  // rowHash is what stops a re-imported statement from creating duplicates, and
  // buildBankRowIdentity folds sourceFormat into the fingerprint. The label reads
  // "sparkasse-" for historical reasons — the format is the generic German
  // kontobewegungen_export, and this app is fed Volksbank files — but renaming
  // it would change every hash and make all 1576 stored movements look new on
  // the next import. If this test fails, the dedupe key moved: either revert,
  // or ship a migration that rewrites rowHash on the existing documents.
  it('keeps the stored dedupe key byte-stable', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

    expect(parsed.rows[0].sourceFormat).toBe('sparkasse-kontobewegungen');
    expect(parsed.rows[0].rowHash).toBe('datev-155358786fd928');
  });
});

describe('bank statement parser unsupported format handling', () => {
  it('rejects DATEV classic headers with a file-level unsupported error and zero rows', () => {
    const classic = [
      'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto;Belegdatum;Buchungstext',
      '100,00;S;EUR;1200;8400;0805;DATEV classic',
    ].join('\n');

    const parsed = parseBankStatementCSV(classic);

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({
        type: 'unsupported-format',
        format: 'datev-classic',
        lineNumber: 1,
      }),
    ]);
    expect(parsed.period).toBeNull();
  });

  it('rejects unknown headers with a file-level unsupported error and zero rows', () => {
    const parsed = parseBankStatementCSV('Date;Amount;Name\n2026-05-08;12.34;ACME');

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({
        type: 'unsupported-format',
        format: 'unknown',
        lineNumber: 1,
      }),
    ]);
    expect(parsed.period).toBeNull();
  });
});

describe('bank movement payload mapping', () => {
  it('emits full identity metadata while preserving legacy amount and direction compatibility', () => {
    const row = {
      ...parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-42,13' })}`).rows[0],
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
    };

    expect(bankRowToMovementPayload(row, 'fallback.csv')).toMatchObject({
      kind: 'payment',
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      importSource: 'bank-csv',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: row.rowHash,
      rowFingerprint: row.rowFingerprint,
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      sepa: row.sepa,
      rawDatev: row.raw,
    });
  });
});

describe('bank import source compatibility', () => {
  it('recognizes both the legacy and current importSource values as a bank import', () => {
    expect(BANK_IMPORT_SOURCES).toEqual(['datev', 'bank-csv']);
    expect(isBankImport({ importSource: 'datev' })).toBe(true);
    expect(isBankImport({ importSource: 'bank-csv' })).toBe(true);
    expect(isBankImport({ importSource: 'manual' })).toBe(false);
    expect(isBankImport({ importSource: null })).toBe(false);
    expect(isBankImport({})).toBe(false);
    expect(isBankImport(null)).toBe(false);
    expect(isBankImport(undefined)).toBe(false);
  });
});

describe('SEPA purpose parsing', () => {
  it('parses a compact structured Verwendungszweck with EREF/MREF/CRED/SVWZ', () => {
    const parsed = parseSepaPurpose('EREF+85744504MREF+175323001CRED+DE06UTA00000010046SVWZ+58654564-1');

    expect(parsed).toEqual({
      endToEndRef: '85744504',
      customerRef: '',
      mandateRef: '175323001',
      creditorId: 'DE06UTA00000010046',
      debtorId: '',
      purposeCode: '',
      purpose: '58654564-1',
      alternativeCounterparty: '',
      tan: '',
      iban: '',
      bic: '',
    });
  });

  it('parses a longer structured Verwendungszweck with PURP and a trailing ABWA alternative counterparty', () => {
    const raw = 'EREF+2005849747 OB-83531045MREF+2811875354000002CRED+DE05ZZZ00000018503PURP+OTHRSVWZ+2005849747 OB-83531045 EUR 2.756,40. BEITRAG 0826 - 0826ABWA+AOK Rheinland/Hamburg - Die Gesundheitskasse';
    const parsed = parseSepaPurpose(raw);

    expect(parsed).toEqual({
      endToEndRef: '2005849747 OB-83531045',
      customerRef: '',
      mandateRef: '2811875354000002',
      creditorId: 'DE05ZZZ00000018503',
      debtorId: '',
      purposeCode: 'OTHR',
      purpose: '2005849747 OB-83531045 EUR 2.756,40. BEITRAG 0826 - 0826',
      alternativeCounterparty: 'AOK Rheinland/Hamburg - Die Gesundheitskasse',
      tan: '',
      iban: '',
      bic: '',
    });
  });

  it('returns the whole text as purpose when no SEPA tags are present', () => {
    expect(parseSepaPurpose('Miete Mai 2026')).toEqual({
      endToEndRef: '',
      customerRef: '',
      mandateRef: '',
      creditorId: '',
      debtorId: '',
      purposeCode: '',
      purpose: 'Miete Mai 2026',
      alternativeCounterparty: '',
      tan: '',
      iban: '',
      bic: '',
    });
  });

  it('returns all-empty fields for an empty string', () => {
    expect(parseSepaPurpose('')).toEqual({
      endToEndRef: '',
      customerRef: '',
      mandateRef: '',
      creditorId: '',
      debtorId: '',
      purposeCode: '',
      purpose: '',
      alternativeCounterparty: '',
      tan: '',
      iban: '',
      bic: '',
    });
  });
});

describe('SEPA-aware description does not affect the frozen dedupe hash', () => {
  it('keeps rowHash identical whether or not description was rewritten from a structured SEPA purpose', () => {
    const structuredDescription = 'EREF+85744504MREF+175323001CRED+DE06UTA00000010046SVWZ+Miete Mai';
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: structuredDescription })}`);
    const row = parsed.rows[0];

    // description was rewritten to the extracted SVWZ purpose, but rawDescription
    // (which feeds the identity hash) is untouched.
    expect(row.description).toBe('Miete Mai');
    expect(row.rawDescription).toBe(structuredDescription);
    expect(row.rowHash).toBe(buildBankRowIdentity({ ...row, description: 'anything else entirely' }).rowHash);
  });
});

const permutations = (items) => items.length === 0 ? [[]] : items.flatMap((item, index) =>
  permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest]));

const repeatedPaymentFiles = () => {
  const common = { postedDate: '08.05.2026', valueDate: '08.05.2026', amount: '-100,00' };
  const konto = (balances) => parseBankStatementCSV([balanceHeaderAt(12), ...balances.map((balance) =>
    balanceRowAt(kontobewegungenRow(common), balance, 12))].join('\n'));
  const umsaetze = parseBankStatementCSV([umsaetzeHeader, ...['800,00', '900,00'].map((balance) =>
    umsaetzeRow({ ...common, balance, counterpartyIban: 'DE89370400440532013000' }))].join('\n'));
  return [konto(['']), umsaetze, konto(['900,00', '800,00'])];
};

// Review pass 2: conservation must hold across every representation and ledger.
describe('booking occurrence conservation', () => {
  it('does not use a note/hash difference or absent party and purpose as multiplicity proof', () => {
    const line = kontobewegungenRow({ counterparty: '', description: '', iban: '', bic: '', amount: '-100,00' });
    const changedNote = line.split(';').map((value, i) => i === 9 ? 'Copied representation' : value).join(';');
    const parsed = parseBankStatementCSV([kontobewegungenHeader, line, changedNote].join('\n'));
    expect(parsed.rows[0].rowHash).not.toBe(parsed.rows[1].rowHash);
    expect(classifyBankImportFiles([{ parsed }]).summary).toMatchObject({ newRows: 0, duplicates: 0, unresolved: 2 });
  });

  it.each(['complete', 'reversed', 'gap', 'missing', 'invalid', 'mixed-account', 'declared-only'])('requires real contiguous source evidence for a returning balance (%s)', (kind) => {
    let lines = [umsaetzeRow({ balance: '900,00' }),
      umsaetzeRow({ amount: '100,00', balance: kind === 'missing' ? '' : kind === 'invalid' ? 'bad' : '1000,00',
        accountIban: kind === 'mixed-account' ? 'DEOTHER' : undefined }),
      umsaetzeRow({ balance: '900,00' }), umsaetzeRow({ amount: '-50,00', balance: '850,00' })];
    if (kind === 'gap') lines.splice(1, 0, 'invalid skipped row');
    if (kind === 'declared-only') lines.splice(1, 1);
    if (kind === 'reversed') lines.reverse();
    const parsed = parseBankStatementCSV([umsaetzeHeader, ...lines].join('\n'));
    const proven = ['complete', 'reversed', 'missing'].includes(kind);
    if (kind === 'declared-only') parsed.rows.forEach((row) => { row.statementOrder = 'ascending'; });
    const result = classifyBankImportFiles([{ parsed }]);
    expect(result.summary).toMatchObject({ newRows: proven ? 4 : parsed.rows.length - 2, duplicates: 0 });
    expect(result.summary.unresolved || 0).toBe(proven ? 0 : 2);
  });

  it.each([1, 2])('consumes stored occurrences with balance evidence in format %s', (format) => {
    const parsed = repeatedPaymentFiles()[format];
    for (const storedRow of parsed.rows) {
      const ledger = [bankRowToMovementPayload(storedRow)];
      expect(diffAgainstExisting(parsed.rows, ledger).newRows).toHaveLength(1);
      expect(classifyBankImportFiles([{ parsed }], ledger).summary).toMatchObject({ newRows: 1, duplicates: 1 });
      expect(classifyBankImportFiles([{ parsed }], parsed.rows.map(bankRowToMovementPayload)).summary)
        .toMatchObject({ newRows: 0, duplicates: 2 });
    }
  });

  it('conserves two occurrences across all six three-file permutations and partial ledger states', () => {
    const files = repeatedPaymentFiles();
    for (const order of permutations(files)) {
      for (const ledger of [[], [bankRowToMovementPayload(files[1].rows[0])], files[1].rows.map(bankRowToMovementPayload)]) {
        const result = classifyBankImportFiles(order.map((parsed) => ({ parsed })), ledger);
        expect(result.summary).toMatchObject({ newRows: 2 - ledger.length, duplicates: 3 + ledger.length });
      }
    }
  });

  it.each([
    ['counterpartyIban', 'DE111', 'DE222'],
    ['counterpartyBic', 'BANKDE11', 'OTHERDE2'],
    ['accountIban', 'DE111', 'DE222'],
    ['creditorId', 'CREDITOR1', 'CREDITOR2'],
    ['mandateRef', 'MANDATE1', 'MANDATE2'],
    ['endToEndRef', 'REF1', 'REF2'],
  ])('rejects contradictory known %s despite the same blank name and purpose', (field, a, b) => {
    const base = { postedDate: '2026-05-08', amount: 100, direction: 'out', counterpartyName: '', description: 'Payment' };
    const withEvidence = (value) => ['creditorId', 'mandateRef', 'endToEndRef'].includes(field)
      ? { ...base, sepa: { [field]: value } } : { ...base, [field]: value };
    expect(diffAgainstExisting([withEvidence(a)], [withEvidence(b)]).newRows).toHaveLength(1);
    expect(diffAgainstExisting([withEvidence(a)], [withEvidence(a)]).duplicateRows).toHaveLength(1);
    expect(diffAgainstExisting([{ ...withEvidence(a), rowHash: 'datev-same' }], [{ ...withEvidence(b), rowHash: 'datev-same' }]).newRows).toHaveLength(1);
    for (const rows of permutations([withEvidence(a), withEvidence(b), base])) {
      expect(classifyBankImportFiles(rows.map((row) => ({ parsed: { rows: [row] } }))).summary)
        .toMatchObject({ newRows: 2, duplicates: 1 });
    }
  });
});

describe('bounded occurrence decisions', () => {
  it('shares the nonlinear context budget with multiplicity checks and preserves an independent group', () => {
    const rows = Array.from({ length: 2400 }, (_, i) => ({ postedDate: '2026-05-08', amount: 100 + Math.floor(i / 200),
      direction: 'out', counterpartyName: 'Synthetic', description: 'Payment', customerRef: `REF-${i}` }));
    rows.push({ ...rows[0], amount: 42 });
    const result = classifyBankImportFiles([{ parsed: { rows } }]);
    expect(result.summary).toMatchObject({ newRows: 1, unresolved: 2400, duplicates: 0 });
    const issues = [...new Set(result.files[0].diff.unresolvedRows.map((row) => row.matchingIssue))];
    expect(issues).toHaveLength(12);
    expect(issues.every((issue) => issue.reason === 'matching-work-budget-exceeded' && issue.work <= 25000)).toBe(true);
    expect(issues.reduce((sum, issue) => sum + issue.work, 0)).toBe(250000);
  });

  const dense = (reference, i) => ({ postedDate: '2026-05-08', amount: 100, direction: 'out',
    counterpartyName: 'Synthetic', description: 'Payment', customerRef: reference, lineNumber: i + 2 });

  it.each([false, true])('rolls back a dense component without losing an independent exact match (member exact=%s)', (exact) => {
    const left = Array.from({ length: 120 }, (_, i) => [dense(i % 2 ? 'A' : '', i)]);
    const right = Array.from({ length: 120 }, (_, i) => [dense(i % 2 ? 'B' : 'A', i)]);
    if (exact) {
      left[0][0] = { ...left[0][0], postedDate: '2026-05-09', rowHash: 'member-exact' };
      right[0][0].rowHash = 'member-exact';
    }
    left.push([{ ...dense('SAFE', 120), amount: 42, rowHash: 'safe' }]);
    right.push([{ ...left[120][0] }]);
    const stats = {};
    const result = matchBookingOccurrences(left, right, false, stats);
    expect([...result]).toEqual([[120, 120]]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({ reason: 'matching-work-budget-exceeded', sourceRows: 120, ledgerRows: 120 });
    expect(result.unresolved[0].discardedMatches).toBeGreaterThan(0);
    expect(result.unresolved[0].phase).toBe('assignment');
    expect(result.unresolved[0].sources).toHaveLength(120);
    expect(stats.searchWork).toBeLessThanOrEqual(250001);
    expect([...matchBookingOccurrences(left, right)]).toEqual([[120, 120]]);
  });

  it.each([[45, 45, 23555], [46, 0, 25000]])('stops at the work boundary for %s rows', (count, matched, work) => {
    const stats = {};
    const result = matchBookingOccurrences(
      Array.from({ length: count }, (_, i) => [dense(i % 2 ? 'A' : '', i)]),
      Array.from({ length: count }, (_, i) => [dense(i % 2 ? 'B' : 'A', i)]), false, stats);
    expect(result.size).toBe(matched);
    expect(stats.workUnits).toBe(work);
    expect(result.unresolved?.length || 0).toBe(count === matched ? 0 : 1);
  });

  it.each(['uniform', 'empty'])('caps total search work while retaining a later %s group', (kind) => {
    const left = [], right = [];
    for (let group = 0; group < 12; group += 1) for (let i = 0; i < 120; i += 1) {
      left.push([{ ...dense(i % 2 ? 'A' : '', i), amount: 100 + group }]);
      right.push([{ ...dense(i % 2 ? 'B' : 'A', i), amount: 100 + group }]);
    }
    const safe = { ...dense('SAFE', 0), amount: 42, rowHash: 'safe' };
    left.push([safe]); right.push([{ ...safe }]);
    for (let i = 0; i < (kind === 'uniform' ? 1000 : 1); i += 1) {
      left.push([{ ...safe, amount: 43, rowHash: '' }]);
      if (kind === 'uniform') right.push([{ ...safe, amount: 43, rowHash: '' }]);
    }
    const stats = {};
    const result = matchBookingOccurrences(left, right, false, stats);
    expect(result.unresolved.length).toBe(12);
    expect(result.size).toBe(kind === 'uniform' ? 1001 : 1);
    expect(result.get(1440)).toBe(1440);
    if (kind === 'uniform') expect([result.get(1441), result.get(2440)]).toEqual([2440, 1441]);
    expect(result.unresolved).toHaveLength(12);
    expect(stats.searchWork).toBe(250000);
    expect(result.unresolved.every((issue) => issue.work <= 25000)).toBe(true);
  });

  it.each([false, true])('conserves withheld source rows across files (reverse=%s)', (reverse) => {
    const files = [
      { name: 'a.csv', rows: Array.from({ length: 120 }, (_, i) => dense(i % 2 ? 'A' : '', i)) },
      { name: 'b.csv', rows: Array.from({ length: 120 }, (_, i) => dense(i % 2 ? 'B' : 'A', i)) },
      { name: 'safe.csv', rows: [{ ...dense('SAFE', 0), postedDate: '2026-06-30', amount: 42, balanceAfter: 42 }] },
    ];
    if (reverse) files.reverse();
    const result = classifyBankImportFiles(files.map((parsed) => ({ name: parsed.name, parsed })));
    expect(result.summary).toMatchObject({ newRows: 1, duplicates: 0, unresolved: 240 });
    const withheld = result.files.flatMap((file) => file.diff.unresolvedRows || []);
    expect(withheld).toHaveLength(240);
    expect(withheld.every((row) => row.matchingIssue?.reason === 'matching-work-budget-exceeded')).toBe(true);
    expect(mergeParsedFiles(files, withheld).balances).toEqual([]);
    expect(mergeParsedFiles(result.files.map((file) => file.parsed)).balances).toEqual([]);
    expect(files.flatMap((file) => file.rows).some((row) => row.matchingIssue)).toBe(false);
    const retained = result.files.find((file) => file.name === 'a.csv');
    expect(classifyBankImportFiles([retained]).summary).toMatchObject({ newRows: 0, duplicates: 0, unresolved: 120 });
    expect(mergeParsedFiles([retained.parsed]).balances).toEqual([]);
    expect(result.files.reduce((sum, file) => sum + Object.values(file.diff).reduce((n, rows) => n + rows.length, 0), 0)).toBe(241);
  });
});

// These low-level matcher fixtures supply slots, not proof of source cardinality.
// collectBankStatementOccurrences separately withholds unproven uniform source lines.
describe('indexed occurrence matching', () => {
  const row = (i, extra = {}) => ({ postedDate: '2026-05-08', amount: 100 + i, direction: 'out',
    counterpartyName: 'Synthetic', description: 'Payment', ...extra });

  it('compares only indexed candidates and prepares shared aliases once', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i));
    const ledger = rows.map((entry) => ({ ...entry }));
    const stats = {};
    const result = matchBookingOccurrences(rows.map((entry) => [entry, entry]), ledger.map((entry) => [entry]), false, stats);
    expect([...result]).toEqual(rows.map((_, i) => [i, i]));
    expect(stats.candidateComparisons).toBe(200);
    expect(stats.normalizedFacts).toBe(400);
  });

  it('bounds comparisons for sparse non-equivalent buckets too', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(Math.floor(i / 2), { customerRef: i % 2 ? 'A' : 'B' }));
    const stats = {};
    const result = matchBookingOccurrences(rows.map((entry) => [entry]), rows.map((entry) => [{ ...entry }]), false, stats);
    expect([...result]).toEqual(rows.map((_, i) => [i, i]));
    expect(stats.candidateComparisons).toBe(400);
    expect(stats.normalizedFacts).toBe(400);
  });

  it.each([false, true])('handles an equivalent capacity group without a dense graph (exact=%s)', (exact) => {
    const left = Array.from({ length: 120 }, () => [row(0, { rowHash: exact ? 'same' : '' })]);
    const right = Array.from({ length: 80 }, () => [row(0, { rowHash: exact ? 'same' : '' })]);
    const stats = {};
    const result = matchBookingOccurrences(left, right, false, stats);
    expect([...result]).toEqual(Array.from({ length: 80 }, (_, i) => [i, 79 - i]));
    expect(stats.candidateComparisons).toBe(1);
    expect(stats.normalizedFacts).toBe(200);
  });

  it('reroutes a long overlapping-alias path with linear candidate work', () => {
    const slots = Array.from({ length: 2001 }, (_, i) => row(0, { rowHash: `alias-${i}` }));
    const left = slots.slice(0, -1).map((entry, i) => [entry, slots[i + 1]]);
    left.push([slots[0]]);
    const stats = {};
    const result = matchBookingOccurrences(left, slots.map((entry) => [{ ...entry }]), false, stats);
    expect([...result]).toEqual([...slots.slice(0, -1).map((_, i) => [i, i + 1]), [2000, 0]]);
    expect(stats.candidateComparisons).toBe(4001);
    expect(stats.normalizedFacts).toBe(4002);
  });

  it('unions hash candidates with triples, keeps exact priority and refreshes mutated inputs', () => {
    const left = [[row(0, { rowHash: 'exact' })], [row(0)]];
    const right = [[row(0)], [row(9, { postedDate: '2026-06-01', rowHash: 'exact' })]];
    expect([...matchBookingOccurrences(left, right)]).toEqual([[0, 1], [1, 0]]);
    right[1][0].currency = 'USD';
    left[0][0].currency = 'EUR';
    expect([...matchBookingOccurrences(left, right)]).toEqual([[0, 0]]);
  });

  it('reroutes equal-rank fuzzy matches without consuming an exact owner', () => {
    const left = [[row(0)], [row(0, { customerRef: 'A' })], [row(1, { rowHash: 'exact' })]];
    const right = [[row(0, { customerRef: 'A' })], [row(0, { customerRef: 'B' })], [row(1, { rowHash: 'exact' })]];
    expect(new Map(matchBookingOccurrences(left, right))).toEqual(new Map([[2, 2], [1, 0], [0, 1]]));
  });
});

describe('decision-relevant bank references and purpose', () => {
  const payment = { postedDate: '2026-05-08', amount: 100, direction: 'out', counterpartyName: 'ACME', rowHash: 'datev-frozen' };

  it.each([
    [{ sepa: { customerRef: 'REF-A' } }, { sepa: { customerRef: 'REF-B' } }],
    [{ customerRef: 'REF-A' }, { customerRef: 'REF-B' }],
    [{ description: 'KREF+REF-ASVWZ+Payment' }, { description: 'KREF+REF-BSVWZ+Payment' }],
    [{ description: 'Invoice A' }, { description: 'Invoice B' }],
    [{ sepa: { purpose: 'Invoice A' } }, { purpose: 'Invoice B' }],
  ])('known conflicts veto even frozen hashes: %j versus %j', (first, second) => {
    const row = { ...payment, ...first }, ledger = { ...payment, ...second };
    expect(diffAgainstExisting([row], [ledger])).toEqual({ newRows: [row], duplicateRows: [] });
  });

  it.each(['description', 'rawDescription'].flatMap((field) =>
    [['customerRef', 'KREF'], ['endToEndRef', 'EREF'], ['creditorId', 'CRED'], ['mandateRef', 'MREF']].map(([key, tag]) => [field, key, tag])))('resolves %s tagged %s without preferring contradictory fields', (field, key, tag) => {
    const tagged = `${tag}+REF-ASVWZ+Payment`;
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: tagged })}`).rows[0];
    const row = { ...parsed, sepa: {}, description: '', rawDescription: '', [field]: tagged };
    expect(authoritativeBankEvidence(row).bankEvidence).toHaveLength(1);
    const contrary = { ...row, bankEvidence: row.bankEvidence.map((record) => ({ ...record, [key]: 'REF-B' })) };
    expect(authoritativeBankEvidence(contrary)).toEqual({});
    for (const conflict of [{ ...contrary, sepa: { [key]: 'REF-B' } }, { ...contrary, [key]: 'REF-B' }]) {
      expect(authoritativeBankEvidence(conflict)).toEqual({});
      expect(diffAgainstExisting([row], [conflict]).newRows).toHaveLength(1);
      expect(diffAgainstExisting([conflict], [row]).newRows).toHaveLength(1);
    }
    const placeholder = { ...row, sepa: { [key]: 'NOTPROVIDED' } };
    expect(authoritativeBankEvidence(placeholder).bankEvidence).toHaveLength(1);
    expect(diffAgainstExisting([row], [placeholder]).newRows).toEqual([]);
    const other = { ...parsed, sepa: { [key]: 'ref-a' }, description: 'Payment', rawDescription: '', bankEvidence: undefined };
    expect(diffAgainstExisting([placeholder], [other]).newRows).toHaveLength(1);
  });

  it.each(['Invoice: 4711', 'Überweisungsauftrag Invoice 4711'])('compares raw, structured and asserted purpose consistently: %s', (purpose) => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: `KREF+REF-4711SVWZ+${purpose}` })}`).rows[0];
    const row = { ...parsed, description: 'Invoice 4711', sepa: { ...parsed.sepa, purpose: 'Invoice 4711' } };
    expect(authoritativeBankEvidence(row).bankEvidence).toHaveLength(1);
    const contrary = { ...row, sepa: { ...row.sepa, purpose: 'Invoice B' },
      bankEvidence: row.bankEvidence.map((record) => ({ ...record, purpose: 'invoice b' })) };
    expect(authoritativeBankEvidence(contrary)).toEqual({});
    expect(diffAgainstExisting([row], [contrary]).newRows).toHaveLength(1);
    expect(diffAgainstExisting([contrary], [row]).newRows).toHaveLength(1);
  });

  it.each(['Invoice B', 'Invoice 4712', 'Invoice 4711 suffix', 'Invoice 4711 2026-05-08', 'Überweisungsauftrag 2026-05-08 Invoice 4711', 'Invoice 4711 Überweisungsauftrag'])('retains meaningful purpose distinction %j even with equal references/hashes', (purpose) => {
    const row = { ...payment, customerRef: 'REF-4711', purpose: 'Invoice 4711' };
    expect(diffAgainstExisting([row], [{ ...row, purpose }]).newRows).toHaveLength(1);
  });

  it.each(['', 'Payment', 'Überweisungsauftrag', 'SEPA-Überweisung', 'Entgelt/Auslagen', 'Abschluss'])('generic or missing purpose %j is not contradictory evidence', (description) => {
    const row = { ...payment, description: 'Invoice A' };
    expect(diffAgainstExisting([row], [{ ...payment, description }]).newRows).toEqual([]);
  });

  it.each(['', 'NOTPROVIDED', 'NONREF'])('treats reference placeholder %j as unknown', (customerRef) => {
    const row = { ...payment, sepa: { customerRef: 'REF-A' }, description: 'Invoice A' };
    expect(diffAgainstExisting([row], [{ ...payment, customerRef, description: ' invoice   A ' }]).newRows).toEqual([]);
  });
});

describe('bank statement import dedupe classification', () => {
  it.each([false, true])('matches cross-format bookings one-to-one before import (reverse=%s)', (reverse) => {
    const common = { postedDate: '08.05.2026', valueDate: '08.05.2026', amount: '-100,00', description: 'Invoice 123' };
    const konto = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow(common)}`);
    const umsaetze = parseBankStatementCSV([
      umsaetzeHeader,
      umsaetzeRow({ ...common, counterpartyIban: 'DE89370400440532013000', balance: '800,00' }),
      umsaetzeRow({ ...common, counterpartyIban: 'DE89370400440532013000', balance: '900,00' }),
    ].join('\n'));
    const entries = [{ parsed: konto }, { parsed: umsaetze }];
    if (reverse) entries.reverse();
    const result = classifyBankImportFiles(entries);
    expect(result.summary).toMatchObject({ newRows: 2, duplicates: 1 });
    expect(result.files.flatMap((file) => file.diff.newRows).reduce((sum, row) => sum + row.signedAmount, 0)).toBe(-200);
    expect(result.files[1].diff.duplicateRows[0].duplicateReason).toBe('run');
    expect(konto.rows[0].rowHash).not.toBe(umsaetze.rows[0].rowHash);
    // A third overlapping export cannot reintroduce either occurrence.
    expect(classifyBankImportFiles([...entries, { parsed: umsaetze }]).summary).toMatchObject({ newRows: 2, duplicates: 3 });
  });

  it('retains repeated Kontobewegungen bookings with distinct balances without changing legacy hashes', () => {
    const common = { postedDate: '08.05.2026', valueDate: '08.05.2026', amount: '-100,00' };
    const balances = ['900,00', '800,00'];
    const konto = parseBankStatementCSV([balanceHeaderAt(12), ...balances.map((balance) =>
      balanceRowAt(kontobewegungenRow(common), balance, 12))].join('\n'));
    const umsaetze = parseBankStatementCSV([umsaetzeHeader, ...balances.map((balance) =>
      umsaetzeRow({ ...common, counterpartyIban: 'DE89370400440532013000', balance }))].join('\n'));
    expect(konto.rows[0].rowHash).toBe(konto.rows[1].rowHash);
    expect(classifyBankImportFiles([{ parsed: konto }]).summary).toMatchObject({ newRows: 2, duplicates: 0 });
    for (const files of [[konto, umsaetze], [umsaetze, konto]]) {
      expect(classifyBankImportFiles(files.map((parsed) => ({ parsed }))).summary).toMatchObject({ newRows: 2, duplicates: 2 });
    }
    expect(classifyBankImportFiles([{ parsed: { rows: [konto.rows[0]] } }, { parsed: { rows: [umsaetze.rows[0]] } }]).summary)
      .toMatchObject({ newRows: 1, duplicates: 1 });
  });

  it('does not batch-match unrelated purposes or different known IBANs across formats', () => {
    const common = { postedDate: '08.05.2026', valueDate: '08.05.2026', amount: '-100,00' };
    const konto = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow(common)}`);
    for (const change of [{ description: 'Another invoice' }, { counterpartyIban: 'DE00000000000000000000' }]) {
      const umsaetze = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ ...common, counterpartyIban: 'DE89370400440532013000', ...change })}`);
      expect(classifyBankImportFiles([{ parsed: konto }, { parsed: umsaetze }]).summary).toMatchObject({ newRows: 2, duplicates: 0 });
    }
  });
  it('withholds unproven identical lines without losing run/file metadata', () => {
    const row = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const result = classifyBankImportFiles(
      [{ file: { name: 'may.csv', size: 128, lastModified: 1778306400000 }, parsed: { rows: [row, { ...row, lineNumber: 3 }], errors: [] } }],
      [],
      'datev-run-1',
    );

    expect(result.files[0].diff.newRows).toEqual([]);
    expect(result.files[0].diff.unresolvedRows).toHaveLength(2);
    expect(result.files[0].diff.unresolvedRows[0]).toMatchObject({
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 128, lastModified: 1778306400000 },
      importLineNumber: 2,
      rowHash: row.rowHash,
    });
    expect(result.files[0].diff.duplicateRows).toEqual([]);
    expect(result.summary).toMatchObject({ newRows: 0, duplicates: 0, unresolved: 2, unsupportedFiles: 0 });
    const stored = bankRowToMovementPayload(row);
    for (const ledger of [[], [stored], [stored, { ...stored }]]) {
      expect(diffAgainstExisting([row, { ...row }], ledger)).toMatchObject({ newRows: [], duplicateRows: [],
        unresolvedRows: [expect.objectContaining({ rowHash: row.rowHash }), expect.objectContaining({ rowHash: row.rowHash })] });
    }
  });

  it('dedupes across selected files before writes using a run-level rowHash set', () => {
    const first = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ counterparty: 'ACME GmbH' })}`).rows[0];
    const second = { ...first, lineNumber: 2 };
    const distinct = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Rechnung 4712' })}`).rows[0];

    const result = classifyBankImportFiles(
      [
        { file: { name: 'a.csv', size: 1, lastModified: 1 }, parsed: { rows: [first], errors: [] } },
        { file: { name: 'b.csv', size: 1, lastModified: 2 }, parsed: { rows: [second, distinct], errors: [] } },
      ],
      [],
      'datev-run-2',
    );

    expect(result.files[0].diff.newRows).toHaveLength(1);
    expect(result.files[1].diff.newRows).toHaveLength(1);
    expect(result.files[1].diff.duplicateRows).toEqual([
      expect.objectContaining({ rowHash: first.rowHash, duplicateReason: 'run' }),
    ]);
    expect(result.summary).toMatchObject({ newRows: 2, duplicates: 1 });
  });

  it('dedupes retries against existing rowHash and falls back to legacy movement fingerprint', () => {
    const hashed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Hash hit' })}`).rows[0];
    const legacy = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Legacy hit', amount: '-10,00' })}`).rows[0];
    const fresh = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Fresh row', amount: '20,00' })}`).rows[0];

    expect(diffAgainstExisting([hashed, legacy, fresh], [
      { rowHash: hashed.rowHash, postedDate: 'nope', amount: 0, direction: 'out', counterpartyName: 'wrong' },
      { postedDate: legacy.postedDate, amount: legacy.amount, direction: legacy.direction, counterpartyName: legacy.counterpartyName },
    ])).toMatchObject({
      newRows: [fresh],
      duplicateRows: [hashed, legacy],
    });
  });

  // ── Matching a fresh row against an ALREADY-STORED legacy movement, real
  // production quirks beyond plain "&"/"+" spelling: a blank ledger
  // counterparty (old-format fee/closing rows) and a truncated ledger name
  // (the old export cuts long names mid-word). Both are read-only matching
  // rules for existing-ledger comparison only — never part of rowHash.

  it('does not let a blank-counterparty fee suppress an unrelated payment', () => {
    const row = { postedDate: '2026-07-31', amount: 100, direction: 'out', counterpartyName: 'ACME', description: 'Invoice 123', rowHash: 'datev-payment' };
    const fee = { ...row, counterpartyName: '', description: 'Account fee', rowHash: 'datev-fee' };
    expect(diffAgainstExisting([row], [fee])).toEqual({ newRows: [row], duplicateRows: [] });
    expect(diffAgainstExisting([{ ...fee, rowHash: 'datev-other', description: 'Another fee' }], [fee]).newRows).toHaveLength(1);
  });

  it('requires corroborating purpose for a blank existing fee counterparty', () => {
    const row = { postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG', description: 'Account fee July' };
    const existing = [{ postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: '', description: 'Account fee July' }];

    expect(diffAgainstExisting([row], existing)).toMatchObject({ newRows: [], duplicateRows: [row] });
  });

  it('treats a long shared prefix as matching a truncated existing counterparty', () => {
    const row = {
      postedDate: '2026-02-10',
      amount: 898.45,
      direction: 'out',
      counterpartyName: 'Schomerus & Partner mbB Steuerberater Rechtsanwälte Wi', // truncated, as the real export does
    };
    const existing = [{
      postedDate: '2026-02-10',
      amount: 898.45,
      direction: 'out',
      counterpartyName: 'Schomerus + Partner mbB Steuerberater Rechtsanwälte Wirtschaftsprüfer',
    }];

    expect(diffAgainstExisting([row], existing)).toMatchObject({ newRows: [], duplicateRows: [row] });
  });

  it('does NOT match two different short counterparties that merely share a small accidental prefix', () => {
    const row = { postedDate: '2026-02-10', amount: 100, direction: 'out', counterpartyName: 'Deutsche Bahn AG' };
    const existing = [{ postedDate: '2026-02-10', amount: 100, direction: 'out', counterpartyName: 'Deutsche Bank AG' }];

    // Shared normalized prefix "deutsche ba" is under the 15-char floor.
    expect(diffAgainstExisting([row], existing)).toMatchObject({ newRows: [row], duplicateRows: [] });
  });

  it('classifyBankImportFiles reports fee-row/truncated-name matches against the ledger as duplicates, not new', () => {
    const feeRow = { postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG', description: 'Account fee July', lineNumber: 2 };
    const existing = [{ postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: '', description: 'Account fee July' }];

    const result = classifyBankImportFiles(
      [{ file: { name: 'jul.csv' }, parsed: { rows: [feeRow], errors: [] } }],
      existing,
    );

    expect(result.summary).toMatchObject({ newRows: 0, duplicates: 1 });
    expect(result.files[0].diff.duplicateRows[0].duplicateReason).toBe('existing');
  });

  it('withholds a blank/filled party ambiguity without silently merging the source rows', () => {
    // Neither a blank party nor a different representation hash proves a second
    // payment. Retain both rows for review, not as confirmed run duplicates.
    const blank = { postedDate: '2026-07-31', amount: 10, direction: 'out', counterpartyName: '', lineNumber: 2, rowHash: 'x-1' };
    const filled = { postedDate: '2026-07-31', amount: 10, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG', lineNumber: 3, rowHash: 'x-2' };

    const result = classifyBankImportFiles(
      [{ file: { name: 'jul.csv' }, parsed: { rows: [blank, filled], errors: [] } }],
      [],
    );

    expect(result.summary).toMatchObject({ newRows: 0, duplicates: 0, unresolved: 2 });
  });
});

describe('durable bank evidence contract', () => {
  it.each(['0,00', '', 'N/A'])('records observed balance validity without manufacturing values: %s', (balance) => {
    const row = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ balance, currency: '', valueDate: '', description: 'KREF+REF1SVWZ+PaymentTAN: 123456' })}`).rows[0];
    const [evidence] = row.bankEvidence;
    expect(row.bankEvidenceVersion).toBe(1);
    expect(evidence).toMatchObject({ signedCents: -10000, customerRef: 'REF1', purpose: 'payment', balanceState: balance === '0,00' ? 'valid' : balance ? 'invalid' : 'missing' });
    expect(evidence).not.toHaveProperty('currency');
    expect(evidence).not.toHaveProperty('valueDate');
    expect(evidence).not.toHaveProperty('tan');
    expect(Object.values(evidence).every((value) => typeof value === 'string' || Number.isSafeInteger(value))).toBe(true);
    if (balance === '0,00') expect(evidence.balanceCents).toBe(0);
    else expect(evidence).not.toHaveProperty('balanceCents');
  });

  it.each([['counterparty', 4097], ['description', 4097], ['creditorId', 257]])('blocks unsafe %s (%s characters) instead of importing without evidence', (field, length) => {
    const parsed = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ [field]: 'X'.repeat(length) })}`);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors).toEqual([expect.objectContaining({ type: 'invalid-bank-evidence' })]);
    expect(classifyBankImportFiles([{ parsed }]).summary.newRows).toBe(0);
  });

  it.each([['counterparty', 256], ['counterparty', 257], ['counterparty', 4096], ['description', 4096], ['creditorId', 256]])('retains safe %s at %s characters without truncation', (field, length) => {
    const parsed = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ [field]: 'X'.repeat(length) })}`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].raw.columns).toContain('X'.repeat(length));
    expect(bankRowToMovementPayload(parsed.rows[0]).bankEvidence).toEqual(parsed.rows[0].bankEvidence);
  });

  it('blocks fields whose canonical value exceeds the evidence bound', () => {
    const parsed = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ currency: 'ß'.repeat(129) })}`);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors).toEqual([expect.objectContaining({ type: 'invalid-bank-evidence' })]);
  });

  it('canonicalizes and deduplicates flat assertions independent of key and alias order', () => {
    const row = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const evidence = row.bankEvidence[0];
    const reordered = { ...Object.fromEntries(Object.entries(evidence).reverse()), counterpartyIban: ' de89 3704 0044 0532 0130 00 ', currency: 'eur' };
    const payload = bankRowToMovementPayload({ ...row, bankEvidence: [evidence, reordered] });
    expect(payload.bankEvidence).toEqual([evidence]);
    expect(JSON.parse(JSON.stringify(payload)).bankEvidence).toEqual(payload.bankEvidence);
  });

  it('unions complementary observations in either file order without duplicating raw or TAN data', () => {
    const common = { postedDate: '08.05.2026', valueDate: '08.05.2026', amount: '-100,00' };
    const konto = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ ...common, iban: '', bic: '', description: 'KREF+CUSTOMER1SVWZ+PaymentTAN: 123456' })}`);
    const ums = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ ...common, description: 'Payment', mandateRef: 'MANDATE1' })}`);
    const evidence = [[konto, ums], [ums, konto]].map((files) =>
      classifyBankImportFiles(files.map((parsed) => ({ parsed }))).files.flatMap((file) => file.diff.newRows)[0].bankEvidence);
    expect(evidence[0]).toEqual(evidence[1]);
    expect(evidence[0]).toHaveLength(2);
    expect(evidence[0].some((entry) => entry.customerRef === 'CUSTOMER1')).toBe(true);
    expect(evidence[0].some((entry) => entry.mandateRef === 'MANDATE1')).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/123456|rawDatev|columns/);
  });

  it('rejects inherited fields and mixed valid/malformed envelopes without partial authority', () => {
    const row = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const record = row.bankEvidence[0];
    for (const bankEvidence of [[Object.create(record)], [record, { ...record, balanceState: 'valid' }], [{ ...record, postedDate: '2026-02-30' }]]) {
      expect(bankRowToMovementPayload({ ...row, bankEvidence })).not.toHaveProperty('bankEvidence');
    }
    const zero = { ...record, balanceState: 'valid', balanceCents: 0 };
    expect(bankRowToMovementPayload({ ...row, bankEvidence: [record, zero, record] }).bankEvidence).toHaveLength(2);
  });

  it.each([
    [2, []], ['1', []], [1, null], [1, [{}]],
    [1, [{ signedCents: Infinity }]], [1, [{ nested: {} }]],
  ])('rejects malformed or unsupported metadata without serializing assertions: %j', (bankEvidenceVersion, bankEvidence) => {
    const payload = bankRowToMovementPayload({ direction: 'out', amount: 100, bankEvidenceVersion, bankEvidence });
    expect(payload).not.toHaveProperty('bankEvidenceVersion');
    expect(payload).not.toHaveProperty('bankEvidence');
  });
});

describe('optional running-balance column', () => {
  it.each(['N/A', '123,45junk', '1.23,45', 'Infinity', '0,00', '', '-1.234,56'])('distinguishes invalid, missing and valid balances: %s', (balance) => {
    const valid = { '0,00': 0, '-1.234,56': -1234.56 };
    for (const csv of [
      `${balanceHeaderAt(12)}\n${balanceRowAt(kontobewegungenRow(), balance, 12)}`,
      `${umsaetzeHeader}\n${umsaetzeRow({ balance })}`,
    ]) {
      const parsed = parseBankStatementCSV(csv);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0].balanceAfter).toBe(valid[balance] ?? null);
      if (balance && !(balance in valid)) {
        expect(parsed.errors).toEqual([expect.objectContaining({ type: 'invalid-balance', lineNumber: 2 })]);
        expect(parsed.balances).toEqual([]);
      } else {
        expect(parsed.errors).toEqual([]);
        expect(parsed.balances).toHaveLength(balance ? 1 : 0);
      }
    }
  });

  it('does not promote an earlier balance when the closing booking has an invalid saldo', () => {
    const parsed = parseBankStatementCSV([umsaetzeHeader,
      umsaetzeRow({ postedDate: '31.05.2026', balance: 'N/A' }),
      umsaetzeRow({ postedDate: '30.05.2026', balance: '900,00' }),
    ].join('\n'));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.balances).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
  });
  it('parses a balance column appended at the end, recognizing every candidate header name', () => {
    for (const name of ['Saldo', 'saldo nach buchung', 'KONTOSTAND', 'Saldo in EUR', 'Kontostand nach Buchung']) {
      const header = balanceHeaderAt(12, name);
      const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '2.500,00', 12)}`;
      const parsed = parseBankStatementCSV(csv);
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows[0].balanceAfter).toBe(2500);
    }
  });

  it('resolves the balance column by name when inserted in the middle of the row', () => {
    // Insert right after "Betrag in EUR" (index 8), before "Notiz".
    const header = balanceHeaderAt(9, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '999,50', 9)}`;
    const parsed = parseBankStatementCSV(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: 1234.56,
      amount: 1234.56,
      direction: 'in',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Rechnung 4711',
      balanceAfter: 999.5,
    });
  });

  it('sets balanceAfter to null and balances to [] when the file has no balance column', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);
    expect(parsed.rows[0].balanceAfter).toBeNull();
    expect(parsed.balances).toEqual([]);
  });

  it('sets balanceAfter to null for a blank balance cell', () => {
    const header = balanceHeaderAt(12, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '', 12)}`;
    const parsed = parseBankStatementCSV(csv);
    expect(parsed.rows[0].balanceAfter).toBeNull();
  });

  it('keeps rowHash byte-identical whether or not the file carries a balance column, at any position', () => {
    const withoutBalance = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];

    const header = balanceHeaderAt(9, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '999,50', 9)}`;
    const withBalance = parseBankStatementCSV(csv).rows[0];

    expect(withBalance.rowHash).toBe(withoutBalance.rowHash);
    expect(withBalance.rowFingerprint).toBe(withoutBalance.rowFingerprint);
    expect(withBalance.raw.columns).toEqual(withoutBalance.raw.columns);
  });

  it('includes parsed.balances = deriveMonthEndBalances(rows) in the parse result', () => {
    const header = balanceHeaderAt(12, 'Saldo');
    const rows = [
      balanceRowAt(kontobewegungenRow({ postedDate: '31.05.2026', valueDate: '31.05.2026', amount: '314,20' }), '1.214,20', 12),
      balanceRowAt(kontobewegungenRow({ postedDate: '15.05.2026', valueDate: '15.05.2026' }), '900,00', 12),
    ].join('\n');
    const parsed = parseBankStatementCSV(`${header}\n${rows}`);

    expect(parsed.balances).toEqual(deriveMonthEndBalances(parsed.rows));
    expect(parsed.balances).toEqual([{ date: '2026-05-31', balance: 1214.20 }]);
  });
});

describe('deriveMonthEndBalances', () => {
  const row = (postedDate, lineNumber, balanceAfter, signedAmount = 0) => ({ postedDate, lineNumber, balanceAfter, signedAmount, currency: 'EUR' });

  it('returns [] when no row has a balance', () => {
    expect(deriveMonthEndBalances([row('2026-05-08', 2, null), row('2026-05-09', 3, null)])).toEqual([]);
    expect(deriveMonthEndBalances([])).toEqual([]);
  });

  it('picks the latest booking per month in a descending (newest-first) file', () => {
    const rows = [
      row('2026-06-30', 2, 5000, 1000),
      row('2026-06-15', 3, 4000, 2785.80),
      row('2026-05-31', 4, 1214.20, 314.20),
      row('2026-05-10', 5, 900),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-05-31', balance: 1214.20 },
      { date: '2026-06-30', balance: 5000 },
    ]);
  });

  it('picks the latest booking per month in an ascending (oldest-first) file', () => {
    const rows = [
      row('2026-05-10', 2, 900),
      row('2026-05-31', 3, 1214.20, 314.20),
      row('2026-06-15', 4, 4000, 2785.80),
      row('2026-06-30', 5, 5000, 1000),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-05-31', balance: 1214.20 },
      { date: '2026-06-30', balance: 5000 },
    ]);
  });

  it('breaks a same-day tie by the SMALLEST lineNumber in a descending file', () => {
    const rows = [
      row('2026-05-31', 2, 100, 50), // top of file = latest booking of the day
      row('2026-05-31', 3, 50, 40),
      row('2026-05-01', 4, 10),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });

  it('breaks a same-day tie by the LARGEST lineNumber in an ascending file', () => {
    const rows = [
      row('2026-05-01', 2, 10),
      row('2026-05-31', 3, 50, 40),
      row('2026-05-31', 4, 100, 50), // bottom of file = latest booking of the day
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });

  // A verified booking is evidence at its actual date, not at an unseen month end.
  it('keeps the observed date of a non-newest month', () => {
    const rows = [
      row('2026-09-08', 2, -36044.51, -4307.13),
      row('2026-08-27', 3, -31737.38),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-08-27', balance: -31737.38 },
      { date: '2026-09-08', balance: -36044.51 },
    ]);
  });

  it('keeps the newest (and only) month partial when its last row is before month end', () => {
    // Mirrors the real Abril-Mayo file taken alone: its last booking is
    // 2026-05-29, and May is all this array knows about.
    const rows = [row('2026-05-29', 2, -37525.25)];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-29', balance: -37525.25 }]);
  });

  it('does not extend a partial month when later rows are unioned in', () => {
    const mayOnly = [row('2026-05-29', 2, -37525.25)];
    expect(deriveMonthEndBalances(mayOnly)[0].date).toBe('2026-05-29');

    // Later balanced movements still do not extend May's observed date.
    const merged = [
      row('2026-09-08', 2, -36044.51, -4307.13),
      row('2026-08-31', 3, -31737.38, -25056.85),
      row('2026-07-31', 4, -6680.53, 33462.02),
      row('2026-06-30', 5, -40142.55, -2617.30),
      row('2026-05-29', 6, -37525.25, -4539.91),
      row('2026-04-30', 7, -32985.34),
    ];
    const mayEntry = deriveMonthEndBalances(merged).find((b) => b.date.startsWith('2026-05'));
    expect(mayEntry).toEqual({ date: '2026-05-29', balance: -37525.25 });
  });

  it('handles February (28 days, 2026 is not a leap year) and January correctly', () => {
    const rows = [
      row('2026-03-31', 2, -33948.55, -1152.22),
      row('2026-02-27', 3, -32796.33, -49031.74),
      row('2026-01-30', 4, 16235.41),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-01-30', balance: 16235.41 },
      { date: '2026-02-27', balance: -32796.33 },
      { date: '2026-03-31', balance: -33948.55 },
    ]);
  });
});

describe('volksbank-umsaetze format', () => {
  it('detects the format and maps the core fields', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow()}`;
    const parsed = parseBankStatementCSV(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      sourceFormat: 'volksbank-umsaetze',
      postedDate: '2026-09-08',
      valueDate: '2026-09-08',
      counterpartyName: 'ACME GmbH',
      counterpartyIban: 'DE49700400410225563601',
      counterpartyBic: 'COBADEFF',
      rawDescription: 'Rechnung 4711',
      direction: 'out',
      amount: 100,
      signedAmount: -100,
      balanceAfter: -1000,
      bookingText: 'Überweisungsauftrag',
      accountIban: 'DE76130910540001342860',
      currency: 'EUR',
    });
  });

  it('falls back valueDate to postedDate when Valutadatum is blank', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({ valueDate: '' })}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.valueDate).toBe(row.postedDate);
  });

  it('falls back counterpartyName to Bankname Auftragskonto for fee/closing rows with an empty Name Zahlungsbeteiligter', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({
      counterparty: '',
      bookingText: 'Abschluss',
      description: 'Abschluss per 30.06.2026',
      amount: '-50,00',
    })}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.counterpartyName).toBe('Volksbank Vorpommern eG');
  });

  it('preserves missing currency when the Waehrung cell is blank', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({ currency: '' })}`;
    expect(parseBankStatementCSV(csv).rows[0].currency).toBe('');
  });

  it('falls back sepa creditorId/mandateRef to the Glaeubiger ID / Mandatsreferenz columns when the purpose text carries neither', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({
      description: 'Kd-Nr.: 123, Rg-Nr.: 456',
      creditorId: 'DE9700000000142462',
      mandateRef: 'T0010001B000006115585469',
    })}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.sepa.creditorId).toBe('DE9700000000142462');
    expect(row.sepa.mandateRef).toBe('T0010001B000006115585469');
  });

  it('prefers CRED/MREF extracted from the purpose text over the file columns when both are present', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({
      description: 'Kd-Nr.: 123 EREF: X MREF: FROM-TEXT CRED: DE00FROMTEXT',
      creditorId: 'DE-FROM-COLUMN',
      mandateRef: 'FROM-COLUMN',
    })}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.sepa.creditorId).toBe('DE00FROMTEXT');
    expect(row.sepa.mandateRef).toBe('FROM-TEXT');
  });

  it('keeps ALL 18 columns, including Saldo nach Buchung, in raw.columns for identity', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow()}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.raw.columns).toHaveLength(18);
    expect(row.raw.columns).toEqual(umsaetzeRow().split(';'));
  });

  it('changes rowHash when only the balance differs — balance stays IN identity for this format', () => {
    const a = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ balance: '-1000,00' })}`).rows[0];
    const b = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({ balance: '-2000,00' })}`).rows[0];
    expect(a.rowHash).not.toBe(b.rowHash);
    expect(a.rowFingerprint).not.toBe(b.rowFingerprint);
  });

  it('never collides rowHash with an equivalent-looking kontobewegungen row — sourceFormat is part of the identity', () => {
    const kontoRow = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const umsRow = parseBankStatementCSV(`${umsaetzeHeader}\n${umsaetzeRow({
      postedDate: '08.05.2026',
      valueDate: '09.05.2026',
      counterparty: 'ACME GmbH',
      description: 'Rechnung 4711',
      amount: '1.234,56',
    })}`).rows[0];
    expect(kontoRow.rowHash).not.toBe(umsRow.rowHash);
  });

  it('still parses a mixed-case description with SEPA colon-tags, extracting purpose/tan/iban/bic', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({
      description: 'VISA Abrechnung J. LESMES LINARES EREF: KKV13091054800134286000 MREF: DZ2705800134286020221020 CRED: DE58ZZZ00000056252 IBAN: DE15130910549198100004 BIC: GENODEF1HST',
    })}`;
    const row = parseBankStatementCSV(csv).rows[0];
    expect(row.description).toBe('VISA Abrechnung J. LESMES LINARES');
    expect(row.sepa).toMatchObject({
      endToEndRef: 'KKV13091054800134286000',
      mandateRef: 'DZ2705800134286020221020',
      creditorId: 'DE58ZZZ00000056252',
      iban: 'DE15130910549198100004',
      bic: 'GENODEF1HST',
    });
  });
});

describe('SEPA purpose parsing — Umsätze "TAG: value" syntax', () => {
  it('parses "VISA Abrechnung" with EREF/MREF/CRED/IBAN/BIC, purpose is the leading free text', () => {
    const raw = 'VISA Abrechnung J. LESMES LINARES EREF: KKV13091054800134286000 MREF: DZ2705800134286020221020 CRED: DE58ZZZ00000056252 IBAN: DE15130910549198100004 BIC: GENODEF1HST';
    expect(parseSepaPurpose(raw)).toMatchObject({
      purpose: 'VISA Abrechnung J. LESMES LINARES',
      endToEndRef: 'KKV13091054800134286000',
      mandateRef: 'DZ2705800134286020221020',
      creditorId: 'DE58ZZZ00000056252',
      iban: 'DE15130910549198100004',
      bic: 'GENODEF1HST',
    });
  });

  it('parses "Rechnungs-Nr : 2026-085 TAN: 797655 IBAN: … BIC: …", purpose keeps its own internal colon', () => {
    const raw = 'Rechnungs-Nr : 2026-085 TAN: 797655 IBAN: DE12476501301111657852 BIC: WELADE3LXXX';
    expect(parseSepaPurpose(raw)).toMatchObject({
      purpose: 'Rechnungs-Nr : 2026-085',
      tan: '797655',
      iban: 'DE12476501301111657852',
      bic: 'WELADE3LXXX',
    });
  });

  it('parses "ReNr 2025-219 ANAM: …" into purpose + alternativeCounterparty', () => {
    const raw = 'ReNr 2025-219 ANAM: Christof Salzmann-Courtpozanis';
    expect(parseSepaPurpose(raw)).toMatchObject({
      purpose: 'ReNr 2025-219',
      alternativeCounterparty: 'Christof Salzmann-Courtpozanis',
    });
  });

  it('leaves plain text with no tags unchanged', () => {
    expect(parseSepaPurpose('Abschluss per 31.05.2026')).toMatchObject({
      purpose: 'Abschluss per 31.05.2026',
    });
  });

  it('strips a trailing "TAN: 123456" glued onto old-format SVWZ text with no separating space', () => {
    // Real production example from the kontobewegungen-era description.
    const raw = 'Darlehn vom 27.05.2025 aus JuliTAN: 131919';
    expect(parseSepaPurpose(raw)).toMatchObject({
      purpose: 'Darlehn vom 27.05.2025 aus Juli',
      tan: '131919',
    });
  });
});

describe('movementFingerprint / bankRowFingerprint — punctuation-insensitive counterparty', () => {
  const REAL_SPELLING_PAIRS = [
    ['Schomerus & Partner mbB Steuerberater', 'Schomerus + Partner mbB Steuerberater'],
    ['E&F Elektrotechnik GmbH', 'E+F Elektrotechnik GmbH'],
    ['Vetter & Wasik Vermögensverwaltung GbR', 'Vetter + Wasik Vermögensverwaltung GbR'],
  ];

  it.each(REAL_SPELLING_PAIRS)('fingerprints "%s" the same as "%s" (movementFingerprint)', (a, b) => {
    const base = { postedDate: '2026-05-08', amount: 100, direction: 'out' };
    expect(movementFingerprint({ ...base, counterpartyName: a }))
      .toBe(movementFingerprint({ ...base, counterpartyName: b }));
  });

  it.each(REAL_SPELLING_PAIRS)('fingerprints "%s" the same as "%s" (bankRowFingerprint)', (a, b) => {
    const base = { postedDate: '2026-05-08', amount: 100, direction: 'out' };
    expect(bankRowFingerprint({ ...base, counterpartyName: a }))
      .toBe(bankRowFingerprint({ ...base, counterpartyName: b }));
  });

  it('keeps umlauts', () => {
    const fp = movementFingerprint({ postedDate: '2026-05-08', amount: 1, direction: 'out', counterpartyName: 'Müller' });
    expect(fp).toContain('müller');
  });

  it('is tolerant of leading/trailing whitespace on postedDate and counterpartyName', () => {
    const a = movementFingerprint({ postedDate: '2026-05-08', amount: 1, direction: 'out', counterpartyName: '  ACME GmbH  ' });
    const b = movementFingerprint({ postedDate: ' 2026-05-08 ', amount: 1, direction: 'out', counterpartyName: 'ACME GmbH' });
    expect(a).toBe(b);
  });

  it('still distinguishes genuinely different counterparties', () => {
    const base = { postedDate: '2026-05-08', amount: 100, direction: 'out' };
    expect(movementFingerprint({ ...base, counterpartyName: 'ACME GmbH' }))
      .not.toBe(movementFingerprint({ ...base, counterpartyName: 'Other GmbH' }));
  });
});

describe('multidate arithmetic evidence', () => {
  it.each(['valid', 'inconsistent', 'malformed-last', 'missing-last', 'missing-interior', 'invalid-interior', 'unproved', 'skipped'])('validates %s in both source directions and overlapping file orders', (kind) => {
    const balances = [kind === 'unproved' ? '' : '1000,00',
      ['missing-interior', 'unproved'].includes(kind) ? '' : kind === 'invalid-interior' ? 'N/A' : '900,00',
      kind === 'inconsistent' ? '750,00' : kind === 'malformed-last' ? 'N/A' : kind === 'missing-last' ? '' : '800,00'];
    const valid = ['valid', 'missing-interior'].includes(kind);
    for (const reverse of [false, true]) {
      const lines = balances.map((balance, i) => umsaetzeRow({ postedDate: i ? '08.05.2026' : '07.05.2026', balance }));
      if (kind === 'skipped') lines.splice(1, 0, 'unparsed movement');
      if (reverse) lines.reverse();
      const parsed = parseBankStatementCSV([umsaetzeHeader, ...lines].join('\n'));
      expect(parsed.balances).toEqual(valid ? [{ date: '2026-05-08', balance: 800 }] : []);
      if (!valid) expect(parsed.balanceIssues.length).toBeGreaterThan(0);
      const subset = parseBankStatementCSV([umsaetzeHeader, lines.at(-1)].join('\n'));
      for (const files of [[parsed, subset], [subset, parsed]]) {
        const report = diffBankStatementFiles(files, []);
        expect(report.balances).toEqual(valid ? [{ date: '2026-05-08', balance: 800 }] : []);
        expect(report.openingAnchor).toEqual(valid ? { date: '2026-05-06', balance: 1100 } : null);
        if (!valid) expect(report.balanceIssues.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('incomplete single-day balance sequences', () => {
  it.each([
    ['900,00', 'N/A'], ['N/A', '900,00'],
    ['900,00', 'N/A', '700,00'], ['700,00', 'N/A', '900,00'],
    ['900,00', '750,00'],
  ])('withholds an ambiguous closing for %j', (...balances) => {
    const parsed = parseBankStatementCSV([umsaetzeHeader, ...balances.map((balance) => umsaetzeRow({ balance }))].join('\n'));
    expect(parsed.rows).toHaveLength(balances.length);
    expect(parsed.balances).toEqual([]);
    expect(mergeParsedFiles([parsed]).balances).toEqual([]);
  });

  it('does not let declared order override malformed interior or terminal balances', () => {
    const parsed = parseBankStatementCSV([umsaetzeHeader,
      ...['900,00', 'N/A', '700,00'].map((balance) => umsaetzeRow({ balance })),
    ].join('\n'));
    const knownAscending = parsed.rows.map((row) => ({ ...row, statementOrder: 'ascending' }));
    expect(deriveMonthEndBalances(knownAscending)).toEqual([]);
    expect(deriveMonthEndBalances(knownAscending.slice(0, 2))).toEqual([]);
    const knownDescending = [...knownAscending].reverse().map((row, i) => ({ ...row, lineNumber: i + 2, statementOrder: 'descending' }));
    expect(deriveMonthEndBalances(knownDescending)).toEqual([]);
    expect(deriveMonthEndBalances(knownDescending.slice(1))).toEqual([]);
  });

  it('bridges an absent interior balance only with corroborating arithmetic and order', () => {
    const parsed = parseBankStatementCSV([umsaetzeHeader,
      umsaetzeRow({ postedDate: '07.09.2026', balance: '1000,00' }),
      umsaetzeRow({ balance: '' }), umsaetzeRow({ balance: '800,00' }),
    ].join('\n'));
    expect(parsed.balances).toEqual([{ date: '2026-09-08', balance: 800 }]);
  });
});

describe('closing balance order regressions', () => {
  it.each(['konto', 'umsaetze'])('infers single-day booking order from running balances in %s', (format) => {
    for (const descending of [true, false]) {
      const balances = descending ? ['800,00', '900,00'] : ['900,00', '800,00'];
      const csv = format === 'konto'
        ? [balanceHeaderAt(12), ...balances.map((balance) => balanceRowAt(kontobewegungenRow({ amount: '-100,00' }), balance, 12))]
        : [umsaetzeHeader, ...balances.map((balance) => umsaetzeRow({ balance }))];
      expect(parseBankStatementCSV(csv.join('\n')).balances[0].balance).toBe(800);
    }
  });

  it('keeps each file’s ascending/descending evidence and observed closing dates', () => {
    const may = parseBankStatementCSV([
      balanceHeaderAt(12),
      balanceRowAt(kontobewegungenRow({ postedDate: '01.05.2026', amount: '10,00' }), '10,00', 12),
      balanceRowAt(kontobewegungenRow({ postedDate: '29.05.2026', amount: '40,00' }), '50,00', 12),
      balanceRowAt(kontobewegungenRow({ postedDate: '29.05.2026', amount: '50,00' }), '100,00', 12),
    ].join('\n'));
    const june = parseBankStatementCSV([umsaetzeHeader,
      umsaetzeRow({ postedDate: '30.06.2026', balance: '800,00' }),
      umsaetzeRow({ postedDate: '30.06.2026', balance: '900,00' }),
    ].join('\n'));
    expect(may.balances).toEqual([{ date: '2026-05-29', balance: 100 }]);
    for (const files of [[may, june], [june, may]]) {
      const merged = mergeParsedFiles(files);
      expect(merged.balances).toEqual([{ date: '2026-05-29', balance: 100 }, { date: '2026-06-30', balance: 800 }]);
      expect(merged.rows.at(-1).balanceAfter).toBe(10);
      expect(merged.rows.find((row) => row.balanceAfter === 100).lineNumber).toBe(4);
    }
  });

  it('omits a truly ambiguous same-day closing instead of guessing from line number', () => {
    const parsed = parseBankStatementCSV([balanceHeaderAt(12),
      balanceRowAt(kontobewegungenRow({ amount: '100,00' }), '800,00', 12),
      balanceRowAt(kontobewegungenRow({ amount: '-100,00' }), '900,00', 12),
    ].join('\n'));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.balances).toEqual([]);
  });
});

describe('mergeParsedFiles', () => {
  it('preserves partial closing dates when later files are unioned in', () => {
    const april = parseBankStatementCSV([
      umsaetzeHeader,
      umsaetzeRow({ postedDate: '30.04.2026', description: 'Abschluss per 30.04.2026', bookingText: 'Abschluss', amount: '-10,00', balance: '-32985,34', counterparty: '' }),
    ].join('\n'));
    const mayPartial = parseBankStatementCSV([
      umsaetzeHeader,
      umsaetzeRow({ postedDate: '29.05.2026', description: 'Abschluss per 31.05.2026', bookingText: 'Abschluss', amount: '-5,00', balance: '-37525,25', counterparty: '' }),
    ].join('\n'));
    const june = parseBankStatementCSV([
      umsaetzeHeader,
      umsaetzeRow({ postedDate: '30.06.2026', description: 'Abschluss per 30.06.2026', bookingText: 'Abschluss', amount: '-3,00', balance: '-40142,55', counterparty: '' }),
    ].join('\n'));

    // Taken alone, May's own file leaves it partial (its own newest month).
    expect(mayPartial.balances).toEqual([{ date: '2026-05-29', balance: -37525.25 }]);

    const merged = mergeParsedFiles([
      { name: 'apr.csv', rows: april.rows, period: april.period },
      { name: 'may.csv', rows: mayPartial.rows, period: mayPartial.period },
      { name: 'jun.csv', rows: june.rows, period: june.period },
    ]);

    expect(merged.balances).toEqual([
      { date: '2026-04-30', balance: -32985.34 },
      { date: '2026-05-29', balance: -37525.25 }, // June does not establish May 31 coverage
      { date: '2026-06-30', balance: -40142.55 }, // newest month → stays as its own last day (already month-end here)
    ]);
    expect(merged.rows).toHaveLength(3);
  });

  it('ignores files with no rows and tolerates an empty input', () => {
    expect(mergeParsedFiles([])).toEqual({ rows: [], balances: [] });
    expect(mergeParsedFiles([{ name: 'empty.csv', rows: [], period: null }])).toEqual({ rows: [], balances: [] });
  });
});

