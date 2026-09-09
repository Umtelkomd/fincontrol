import { describe, expect, it } from 'vitest';

import {
  BANK_IMPORT_SOURCES,
  bankRowFingerprint,
  buildBankRowIdentity,
  classifyBankImportFiles,
  bankRowToMovementPayload,
  deriveMonthEndBalances,
  diffAgainstExisting,
  isBankImport,
  mergeParsedFiles,
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

describe('bank statement import dedupe classification', () => {
  it('dedupes within one file by rowHash while attaching run and file metadata to importable rows', () => {
    const row = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const result = classifyBankImportFiles(
      [{ file: { name: 'may.csv', size: 128, lastModified: 1778306400000 }, parsed: { rows: [row, { ...row, lineNumber: 3 }], errors: [] } }],
      [],
      'datev-run-1',
    );

    expect(result.files[0].diff.newRows).toHaveLength(1);
    expect(result.files[0].diff.newRows[0]).toMatchObject({
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 128, lastModified: 1778306400000 },
      importLineNumber: 2,
      rowHash: row.rowHash,
    });
    expect(result.files[0].diff.duplicateRows).toEqual([
      expect.objectContaining({ rowHash: row.rowHash, duplicateReason: 'intra-file' }),
    ]);
    expect(result.summary).toMatchObject({ newRows: 1, duplicates: 1, unsupportedFiles: 0 });
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

  it('treats a blank existing counterparty as matching a filled-in bank-name counterparty for the same date/amount/direction', () => {
    const row = { postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG' };
    const existing = [{ postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: '' }];

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
    const feeRow = { postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG', lineNumber: 2 };
    const existing = [{ postedDate: '2026-07-31', amount: 312.98, direction: 'out', counterpartyName: '' }];

    const result = classifyBankImportFiles(
      [{ file: { name: 'jul.csv' }, parsed: { rows: [feeRow], errors: [] } }],
      existing,
    );

    expect(result.summary).toMatchObject({ newRows: 0, duplicates: 1 });
    expect(result.files[0].diff.duplicateRows[0].duplicateReason).toBe('existing');
  });

  it('does NOT apply the loose blank/prefix tolerance to intra-file or intra-run dedup — only to matching the existing ledger', () => {
    // Two rows in the SAME batch, one blank one filled, same date/amount/direction:
    // intra-batch dedup must stay strict (this scenario should not occur from a
    // single real file, but the rule must not silently merge unrelated rows).
    const blank = { postedDate: '2026-07-31', amount: 10, direction: 'out', counterpartyName: '', lineNumber: 2, rowHash: 'x-1' };
    const filled = { postedDate: '2026-07-31', amount: 10, direction: 'out', counterpartyName: 'Volksbank Vorpommern eG', lineNumber: 3, rowHash: 'x-2' };

    const result = classifyBankImportFiles(
      [{ file: { name: 'jul.csv' }, parsed: { rows: [blank, filled], errors: [] } }],
      [],
    );

    expect(result.summary).toMatchObject({ newRows: 2, duplicates: 0 });
  });
});

describe('optional running-balance column', () => {
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
      balanceRowAt(kontobewegungenRow({ postedDate: '31.05.2026', valueDate: '31.05.2026' }), '1.214,20', 12),
      balanceRowAt(kontobewegungenRow({ postedDate: '15.05.2026', valueDate: '15.05.2026' }), '900,00', 12),
    ].join('\n');
    const parsed = parseBankStatementCSV(`${header}\n${rows}`);

    expect(parsed.balances).toEqual(deriveMonthEndBalances(parsed.rows));
    expect(parsed.balances).toEqual([{ date: '2026-05-31', balance: 1214.20 }]);
  });
});

describe('deriveMonthEndBalances', () => {
  const row = (postedDate, lineNumber, balanceAfter) => ({ postedDate, lineNumber, balanceAfter });

  it('returns [] when no row has a balance', () => {
    expect(deriveMonthEndBalances([row('2026-05-08', 2, null), row('2026-05-09', 3, null)])).toEqual([]);
    expect(deriveMonthEndBalances([])).toEqual([]);
  });

  it('picks the latest booking per month in a descending (newest-first) file', () => {
    const rows = [
      row('2026-06-30', 2, 5000),
      row('2026-06-15', 3, 4000),
      row('2026-05-31', 4, 1214.20),
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
      row('2026-05-31', 3, 1214.20),
      row('2026-06-15', 4, 4000),
      row('2026-06-30', 5, 5000),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-05-31', balance: 1214.20 },
      { date: '2026-06-30', balance: 5000 },
    ]);
  });

  it('breaks a same-day tie by the SMALLEST lineNumber in a descending file', () => {
    const rows = [
      row('2026-05-31', 2, 100), // top of file = latest booking of the day
      row('2026-05-31', 3, 50),
      row('2026-05-01', 4, 10),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });

  it('breaks a same-day tie by the LARGEST lineNumber in an ascending file', () => {
    const rows = [
      row('2026-05-01', 2, 10),
      row('2026-05-31', 3, 50),
      row('2026-05-31', 4, 100), // bottom of file = latest booking of the day
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });

  // ── Closing-date rounding: the reported date is normally the LAST CALENDAR
  // DAY of the month, since a bank's month-end closing booking can land a day
  // or two before it — EXCEPT for the newest month in the array, which stays
  // open (see the real Volksbank facts this locks in: a 2026-05-29 closing
  // booking means "balance as of 2026-05-31" once we know June happened, but
  // 2026-09-08 stays 2026-09-08 while it's genuinely the latest data seen).

  it("closes a non-newest month's date to the last calendar day even when its winning row lands earlier", () => {
    const rows = [
      row('2026-09-08', 2, -36044.51), // newest month → partial
      row('2026-08-27', 3, -31737.38), // not newest → closes to 08-31
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-08-31', balance: -31737.38 },
      { date: '2026-09-08', balance: -36044.51 },
    ]);
  });

  it('keeps the newest (and only) month partial when its last row is before month end', () => {
    // Mirrors the real Abril-Mayo file taken alone: its last booking is
    // 2026-05-29, and May is all this array knows about.
    const rows = [row('2026-05-29', 2, -37525.25)];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-29', balance: -37525.25 }]);
  });

  it('resolves a formerly-newest month to its calendar month-end once later rows are unioned in', () => {
    const mayOnly = [row('2026-05-29', 2, -37525.25)];
    expect(deriveMonthEndBalances(mayOnly)[0].date).toBe('2026-05-29');

    // Once a caller merges in the rows of later files/periods (June onward),
    // May is no longer the array's newest month and correctly closes.
    const merged = [
      row('2026-09-08', 2, -36044.51),
      row('2026-08-31', 3, -31737.38),
      row('2026-07-31', 4, -6680.53),
      row('2026-06-30', 5, -40142.55),
      row('2026-05-29', 6, -37525.25),
      row('2026-04-30', 7, -32985.34),
    ];
    const mayEntry = deriveMonthEndBalances(merged).find((b) => b.date.startsWith('2026-05'));
    expect(mayEntry).toEqual({ date: '2026-05-31', balance: -37525.25 });
  });

  it('handles February (28 days, 2026 is not a leap year) and January correctly', () => {
    const rows = [
      row('2026-03-31', 2, -33948.55), // newest
      row('2026-02-27', 3, -32796.33), // closes to 02-28
      row('2026-01-30', 4, 16235.41), // closes to 01-31
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-01-31', balance: 16235.41 },
      { date: '2026-02-28', balance: -32796.33 },
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

  it('defaults currency to EUR when the Waehrung cell is blank', () => {
    const csv = `${umsaetzeHeader}\n${umsaetzeRow({ currency: '' })}`;
    expect(parseBankStatementCSV(csv).rows[0].currency).toBe('EUR');
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

describe('mergeParsedFiles', () => {
  it('closes a month a single file left partial once a later file is unioned in', () => {
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
      { date: '2026-05-31', balance: -37525.25 }, // closed now that June exists
      { date: '2026-06-30', balance: -40142.55 }, // newest month → stays as its own last day (already month-end here)
    ]);
    expect(merged.rows).toHaveLength(3);
  });

  it('ignores files with no rows and tolerates an empty input', () => {
    expect(mergeParsedFiles([])).toEqual({ rows: [], balances: [] });
    expect(mergeParsedFiles([{ name: 'empty.csv', rows: [], period: null }])).toEqual({ rows: [], balances: [] });
  });
});

