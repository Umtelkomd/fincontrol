import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'bankMovements' })),
  doc: vi.fn(() => ({ path: 'classificationRules/rule-1' })),
  increment: vi.fn((value) => ({ __increment: value })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
  writeAuditLogEntry: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: (fn) => fn,
}));

vi.mock('firebase/firestore', () => firestoreMocks);

vi.mock('../services/firebase', () => ({
  db: { mocked: true },
  appId: 'test-app',
}));

vi.mock('../utils/auditLog', () => auditMocks);

vi.mock('../utils/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('../finance/ruleEngine', () => ({
  findBestRule: vi.fn(() => null),
  buildClassificationPayload: vi.fn(() => ({})),
}));

const { useBankImport } = await import('./useBankImport.js');
const { adaptBankMovementDoc } = await import('../finance/adapters.js');
const { diffBankStatementFiles, formatBankMatchingIssues } = await import('../finance/bankStatementDiff.js');
const { parseBankStatementCSV, classifyBankImportFiles, buildBankRowIdentity, bankMovementMatchRank } = await import('../finance/bankStatementParser.js');

const evidenceFiles = (name = 'ACME', currency = 'EUR', remark = '') => [
  parseBankStatementCSV([
    'Automat;Sammlerauflösung;Buchungsdatum;Valutadatum;Empfängername/Auftraggeber;IBAN/Kontonummer;BIC/BLZ;Verwendungszweck;Betrag in EUR;Notiz;Anzahl Belege;Geprüft',
    `Nein;Nein;08.05.2026;08.05.2026;${name};;;KREF+CUSTOMER1SVWZ+Payment;-100,00;;0;Ja`,
  ].join('\n')),
  parseBankStatementCSV([
    'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz',
    `Synthetic;DEACCOUNT;;Synthetic Bank;08.05.2026;08.05.2026;${name};DE111;;Transfer;Payment;-100,00;${currency};900,00;${remark};;CREDITOR1;MANDATE1`,
  ].join('\n')),
];

const referenceFile = (reference, purpose = 'Payment', format = 0, iban) => {
  const source = evidenceFiles()[format];
  const columns = source.rows[0].raw.columns.map((value, index) => {
    if (index === (format === 0 ? 7 : 10)) return `${reference ? `KREF+${reference}` : ''}SVWZ+${purpose}`;
    if (iban !== undefined && index === (format === 0 ? 5 : 7)) return iban;
    return value;
  });
  return parseBankStatementCSV([source.header.join(';'), columns.join(';')].join('\n'));
};

const importLocally = async (rows, importRows) => {
  const stored = [];
  firestoreMocks.addDoc.mockImplementation(async (_, payload) => {
    const id = `synthetic-${stored.length}`;
    stored.push(JSON.parse(JSON.stringify({ ...payload, id })));
    return { id };
  });
  await importRows(rows, 'synthetic.csv');
  return stored;
};
const orders = [[0, 1], [1, 0], [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const permutations = (items) => {
  if (!items.length) return [[]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
};

describe('useBankImport metadata persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.addDoc.mockResolvedValue({ id: 'movement-1' });
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it.each(['copied', 'missing', 'balances', 'references', 'cycle'])('conserves %s multiplicity through storage, report and reimport in every file order', async (kind) => {
    const template = evidenceFiles()[1];
    const lines = kind === 'cycle' ? [[-100, 900, ''], [100, 1000, ''], [-100, 900, '']]
      : [[-100, 900, 'A'], [-100, kind === 'balances' ? 800 : 900, 'B']];
    const parsed = parseBankStatementCSV([template.header.join(';'), ...lines.map(([amount, balance, ref]) =>
      template.rows[0].raw.columns.map((value, i) => i === 11 ? `${amount},00`
        : i === 13 ? (kind === 'missing' ? '' : `${balance},00`)
          : i === 10 && kind === 'references' ? `KREF+${ref}SVWZ+Payment` : value).join(';'))].join('\n'));
    const sparse = referenceFile('', 'Payment');
    const safeSource = referenceFile('SAFE', 'Independent payment');
    const safe = parseBankStatementCSV([safeSource.header.join(';'),
      safeSource.rows[0].raw.columns.map((value) => value === '-100,00' ? '-42,00' : value).join(';')].join('\n'));
    const ambiguous = ['copied', 'missing'].includes(kind);
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    for (const order of permutations([parsed, sparse, parsed])) for (const count of [0, 1, 2]) {
      const stored = await importLocally(parsed.rows.slice(0, count), importRows);
      const initialWrites = stored.length;
      const ledger = () => stored.map((doc) => adaptBankMovementDoc(JSON.parse(JSON.stringify(doc))));
      const entries = [...order, safe].map((file, i) => ({ name: `${i}.csv`, parsed: file }));
      const result = classifyBankImportFiles(entries, ledger());
      const report = diffBankStatementFiles(entries.map((entry) => ({ name: entry.name, rows: entry.parsed.rows })), ledger());
      if (ambiguous) {
        expect(result.summary).toMatchObject({ newRows: 1, duplicates: 0, unresolved: 5 });
        expect(report).toMatchObject({ openingAnchor: null, balances: [], orphanLedgerRows: [] });
        expect(report.unresolvedRows).toHaveLength(5);
        expect(report.unresolvedLedgerRows).toHaveLength(count);
        expect(report.unresolved[0].reason).toBe('unproven-booking-multiplicity');
      } else {
        expect(result.summary.unresolved || 0).toBe(0);
        expect(result.summary.newRows).toBe(parsed.rows.length - count + 1);
      }
      await importRows(result.files.flatMap((file) => file.diff.newRows));
      expect(stored).toHaveLength(ambiguous ? initialWrites + 1 : parsed.rows.length + 1);
      const retry = classifyBankImportFiles(result.files, ledger());
      expect(retry.summary.newRows).toBe(0);
      const beforeRetry = stored.length;
      await importRows(retry.files.flatMap((file) => [...file.diff.newRows, ...(file.diff.unresolvedRows || [])]));
      expect(stored).toHaveLength(beforeRetry);
      expect(parsed.rows.map((row) => buildBankRowIdentity(row).rowHash)).toEqual(parsed.rows.map((row) => row.rowHash));
    }
  });

  it.each(['accountIban', 'currency'].flatMap((field) => [false, true].flatMap((absent) =>
    [false, true].map((reverse) => [field, absent, reverse]))))('withholds repeated debits when bridge %s is unknown (absent=%s, reverse=%s)', async (field, absent, reverse) => {
    const source = evidenceFiles()[1];
    const lines = [0, 1, 2].map((n) => source.rows[0].raw.columns.map((value, i) =>
      i === 11 ? (n === 1 ? '100,00' : '-100,00') : i === 13 ? (n === 1 ? '1000,00' : '900,00')
        : i === 14 ? `Representation ${n}` : n === 1 && i === (field === 'currency' ? 12 : 1) ? '' : value).join(';'));
    if (reverse) lines.reverse();
    const parsed = parseBankStatementCSV([source.header.join(';'), ...lines].join('\n'));
    if (absent) parsed.rows[1][field] = undefined;
    const entries = [{ parsed }, { parsed: { rows: [parsed.rows[0]] } }];
    if (reverse) entries.reverse();
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const result = classifyBankImportFiles(entries);
    expect(result.summary).toMatchObject({ newRows: 1, unresolved: 3, duplicates: 0 });
    const stored = await importLocally(result.files.flatMap((file) => file.parsed.rows), importRows);
    expect(stored).toHaveLength(1);
    expect(stored[0].direction).toBe('in');
    const ledger = stored.map((doc) => adaptBankMovementDoc(JSON.parse(JSON.stringify(doc))));
    const retry = classifyBankImportFiles(result.files, ledger);
    expect(retry.summary).toMatchObject({ newRows: 0, unresolved: 3, duplicates: 1 });
    await importRows(retry.files.flatMap((file) => file.diff.unresolvedRows || []));
    expect(stored).toHaveLength(1);
  });

  it.each([0, 1].flatMap((format) => ['100,00garbage', '1.0.0,00', '100,001', 'N/A', '90071992547409,92', '90071992547409,90', '-90071992547409,92']
    .flatMap((amount) => [false, true].map((reverse) => [format, amount, reverse]))))('rejects malformed bridge amounts before persistence (%s, %s, reverse=%s)', async (format, amount, reverse) => {
    const source = evidenceFiles()[format];
    const header = format ? source.header : [...source.header, 'Saldo'];
    const lines = [['-100,00', '900,00'], [amount, '1000,00'], ['-100,00', '900,00'], ['42,00', '942,00']]
      .map(([value, balance]) => {
        const columns = source.rows[0].raw.columns.map((cell, i) => i === (format ? 11 : 8) ? value : format && i === 13 ? balance : cell);
        return (format ? columns : [...columns, balance]).join(';');
      });
    if (reverse) lines.reverse();
    const parsed = parseBankStatementCSV([header.join(';'), ...lines].join('\n'));
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].raw).toContain(amount);
    const classified = classifyBankImportFiles([{ parsed }]);
    expect(classified.summary).toMatchObject({ newRows: 1, unresolved: 2, errors: 1 });
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(classified.files[0].parsed.rows, importRows);
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(42);
    const ledger = stored.map((doc) => adaptBankMovementDoc(JSON.parse(JSON.stringify(doc))));
    const report = diffBankStatementFiles([parsed], ledger);
    expect(report).toMatchObject({ balances: [], openingAnchor: null });
    expect(formatBankMatchingIssues(report).join('\n')).toContain('UNKNOWN');
    const retry = classifyBankImportFiles(classified.files, ledger);
    expect(retry.summary.newRows).toBe(0);
    await importRows(retry.files[0].diff.unresolvedRows);
    expect(stored).toHaveLength(1);
  });

  it('rejects unresolved rows at the actual write boundary, including retries', async () => {
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const safe = referenceFile('SAFE').rows[0];
    const row = { postedDate: '2026-05-08', amount: 999, signedAmount: -999, direction: 'out',
      counterpartyName: 'Synthetic', description: 'Payment' };
    const incoming = Array.from({ length: 120 }, (_, i) => ({ ...row, customerRef: i % 2 ? 'A' : '' }));
    const ledger = incoming.map((row, i) => ({ ...row, customerRef: i % 2 ? 'B' : 'A' }));
    const classified = classifyBankImportFiles([{ parsed: { rows: [...incoming, safe] } }], ledger).files[0];
    const withheld = classified.diff.unresolvedRows;
    expect(withheld).toHaveLength(120);
    // Even bypassing the UI's newRows filter must not authorize held source rows.
    const stored = await importLocally(classified.parsed.rows, importRows);
    expect(stored).toHaveLength(1);
    expect(stored[0].rowHash).toBe(safe.rowHash);
    const retry = await importRows(withheld);
    expect(retry).toMatchObject({ success: false, imported: 0 });
    expect(retry.errors).toHaveLength(120);
    expect(retry.errors[0].error).toMatch(/revisión/);
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each(orders.flatMap((order) => [4, 256, 257, 4096].map((length) => [order, length])))('roundtrips order %j with name length %s', async (order, length) => {
    const sources = evidenceFiles('A'.repeat(length));
    sources.push(parseBankStatementCSV([
      sources[0].header.join(';'),
      sources[0].rows[0].raw.columns.map((value, i) => i === 6 ? 'BANKDE11' : value).join(';'),
    ].join('\n')));
    const parsed = order.map((index) => sources[index]);
    const originalHashes = parsed.map((file) => file.rows[0].rowHash);
    const entries = parsed.map((file) => ({ parsed: file }));
    const rows = classifyBankImportFiles(entries).files.flatMap((file) => file.diff.newRows);
    const stored = await importLocally(rows, useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    expect(stored).toHaveLength(1);
    const ledger = stored.map((doc) => adaptBankMovementDoc(doc));
    const distinct = sources[1].rows[0];
    // Parse genuinely different bytes, not a row with stale evidence metadata.
    const otherFile = parseBankStatementCSV([sources[1].header.join(';'),
      distinct.raw.columns.map((value) => value === 'DE111' ? 'DE222' : value === '900,00' ? '800,00' : value).join(';'),
    ].join('\n'));
    expect(otherFile.rows[0]).toMatchObject({ counterpartyIban: 'DE222', balanceAfter: 800 });
    expect(classifyBankImportFiles([{ parsed: otherFile }], ledger).summary).toMatchObject({ newRows: 1, duplicates: 0 });
    const reimport = classifyBankImportFiles(entries, ledger);
    expect(reimport.summary).toMatchObject({ newRows: 0, duplicates: order.length });
    await useBankImport({ email: 'synthetic@example.invalid' }).importRows(reimport.files.flatMap((file) => file.diff.newRows));
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    expect(stored[0].counterpartyName).toBe('A'.repeat(length));
    expect(stored[0].bankEvidenceVersion).toBe(1);
    expect(stored[0].bankEvidence).toHaveLength(order.length);
    expect(ledger[0].bankEvidence).toEqual(stored[0].bankEvidence);
    expect(stored[0].bankEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerRef: 'CUSTOMER1', balanceState: 'missing' }),
      expect.objectContaining({ counterpartyIban: 'DE111', mandateRef: 'MANDATE1', creditorId: 'CREDITOR1', balanceCents: 90000 }),
    ]));
    expect(stored[0]).toMatchObject({ rowHash: rows[0].rowHash, rawDatev: rows[0].raw });
    expect(parsed.map((file) => buildBankRowIdentity(file.rows[0]).rowHash)).toEqual(originalHashes);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each([{ postedDate: '2025-01-01', counterpartyIban: 'DE222' }, { signedCents: 777, counterpartyIban: 'DE222' }, { balanceCents: 80000 }, { counterpartyIban: 'DE222' }])('ignores inconsistent persisted metadata %j without breaking self-reimport', async (change) => {
    const parsed = evidenceFiles()[1];
    const [stored] = await importLocally(parsed.rows, useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    stored.balanceAfter = null; // No owner balance to manufacture a contradiction.
    stored.bankEvidence.push({ ...stored.bankEvidence[0], ...change });
    if (change.postedDate || change.signedCents) {
      stored.counterpartyIban = ''; // Only the booking date/amount can reject this lone assertion.
      stored.bankEvidence = stored.bankEvidence.slice(1);
    }
    const loaded = adaptBankMovementDoc(JSON.parse(JSON.stringify(stored)));
    expect(classifyBankImportFiles([{ parsed }], [loaded]).summary).toMatchObject({ newRows: 0, duplicates: 1 });
    expect(loaded).not.toHaveProperty('bankEvidence');
  });

  it.each(['', 'EUR', 'USD'].flatMap((currency) => [false, true].flatMap((reverse) =>
    [1, 99].map((version) => [currency, reverse, version]))))('preserves currency %j, reversed=%s, version=%s', async (currency, reverse, version) => {
    let parsed = evidenceFiles('ACME', currency)[1];
    if (reverse) parsed = parseBankStatementCSV([
      [...parsed.header].reverse().join(';'), [...parsed.rows[0].raw.columns].reverse().join(';'),
    ].join('\n'));
    const [stored] = await importLocally(parsed.rows, useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    expect(stored).not.toHaveProperty('bankCurrencyDefaulted');
    expect(stored.bankEvidence[0].currency).toBe(currency || undefined);
    stored.bankCurrencyDefaulted = !stored.bankCurrencyDefaulted;
    stored.bankEvidenceVersion = version;
    delete stored.bankEvidence[0].currency; // Sparse metadata must not erase observed raw currency.
    const loaded = adaptBankMovementDoc(JSON.parse(JSON.stringify(stored)));
    expect(stored.currency).toBe(currency);
    expect(loaded.currency).toBe(currency || 'EUR');
    expect(bankMovementMatchRank(evidenceFiles('ACME', 'USD')[1].rows[0], loaded) > 0).toBe(currency !== 'EUR');
    expect(bankMovementMatchRank(evidenceFiles('ACME', 'EUR')[1].rows[0], loaded) > 0).toBe(currency !== 'USD');
  });

  it.each([0, 1].flatMap((format) => (format === 0 ? ['canonical', 'reordered', 'legacy']
    : ['canonical', 'reordered', 'legacy', 'copied-header', 'missing-header']).flatMap((layout) =>
    [false, true].map((contrary) => [format, layout, contrary]))))('structured currency survives untrusted provenance: format %s, %s, contrary=%s', async (format, layout, contrary) => {
    let parsed = evidenceFiles('ACME', 'EUR', 'USD')[format];
    const header = [...parsed.header];
    const columns = [...parsed.rows[0].raw.columns];
    if (layout.endsWith('header')) {
      const currency = header.indexOf('Waehrung');
      const remark = header.indexOf('Bemerkung');
      [header[currency], header[remark]] = [header[remark], header[currency]];
      if (layout === 'missing-header') {
        [columns[currency], columns[remark]] = [columns[remark], columns[currency]];
        parsed = parseBankStatementCSV([header.join(';'), columns.join(';')].join('\n'));
      }
    }
    if (layout === 'reordered') parsed = parseBankStatementCSV([
      [...parsed.header].reverse().join(';'), [...parsed.rows[0].raw.columns].reverse().join(';'),
    ].join('\n'));
    const damage = (value) => ({ ...value, bankCurrencyDefaulted: !layout.endsWith('header'),
      bankEvidence: [{ ...value.bankEvidence[0], currency: contrary ? 'USD' : undefined }],
      bankSourceHeader: layout === 'copied-header' ? header : layout === 'missing-header' || layout === 'legacy' ? undefined : value.bankSourceHeader,
    });
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const [stored] = await importLocally(parsed.rows, importRows);
    const loaded = adaptBankMovementDoc(JSON.parse(JSON.stringify(damage(stored))));
    const usd = evidenceFiles('ACME', 'USD')[1];
    expect(classifyBankImportFiles([{ parsed }], [loaded]).summary.newRows).toBe(0);
    expect(bankMovementMatchRank(usd.rows[0], loaded)).toBe(0);
    expect(classifyBankImportFiles([{ parsed: usd }], [loaded]).summary.newRows).toBe(1);
    if (contrary) expect(loaded).not.toHaveProperty('bankEvidence');
    const [produced] = await importLocally([damage(parsed.rows[0])], importRows);
    expect(produced).toMatchObject({ currency: 'EUR', rowHash: stored.rowHash, rawDatev: stored.rawDatev });
    expect(produced).not.toHaveProperty('bankCurrencyDefaulted');
    expect(produced).not.toHaveProperty('bankSourceHeader');
    if (contrary) expect(produced).not.toHaveProperty('bankEvidence');
  });

  it.each([false, true])('enriches unknown currency only with compatible observations (reverse=%s)', async (reverse) => {
    const files = evidenceFiles('ACME', '');
    if (reverse) files.reverse();
    const rows = classifyBankImportFiles(files.map((parsed) => ({ parsed }))).files.flatMap((file) => file.diff.newRows);
    const [stored] = await importLocally(rows, useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    expect(stored.currency).toBe('EUR');
    expect(stored.bankEvidence).toHaveLength(2);
    expect(bankMovementMatchRank(evidenceFiles('ACME', 'USD')[1].rows[0], adaptBankMovementDoc(stored))).toBe(0);
  });

  it.each([0, 1].flatMap((format) => [{}, { iban: 'DE111' }, { purpose: 'Payment' }, { customerRef: 'NOTPROVIDED' }, { customerRef: 'NONREF' }]
    .map((sepa) => [format, sepa])))('sparse SEPA cannot hide tagged references: format %s, %j', async (format, sepa) => {
    const files = ['REF-A', 'REF-B'].map((reference) => {
      const parsed = referenceFile(reference, 'Payment', format);
      const row = parsed.rows[0];
      return { rows: [{ ...row, description: row.rawDescription, sepa, bankEvidence: undefined, bankEvidenceVersion: undefined }] };
    });
    const classified = classifyBankImportFiles(files.map((parsed) => ({ parsed })));
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(classified.files.flatMap((file) => file.diff.newRows), importRows);
    expect(stored).toHaveLength(2);
    const ledger = stored.map((doc) => adaptBankMovementDoc(doc));
    const report = diffBankStatementFiles(files, ledger);
    expect(report.rows).toHaveLength(2);
    expect(report.newRows).toEqual([]);
    expect(report.orphanLedgerRows).toEqual([]);
    const reimport = classifyBankImportFiles(files.map((parsed) => ({ parsed })), ledger);
    await importRows(reimport.files.flatMap((file) => file.diff.newRows));
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(2);
    expect(classifyBankImportFiles([{ parsed: referenceFile('REF-C', 'Payment', format) }], ledger).summary.newRows).toBe(1);
  });

  it.each(['Invoice: 4711', 'Überweisungsauftrag Invoice 4711'].flatMap((purpose) =>
    [false, true].map((reverse) => [purpose, reverse])))('equivalent purpose %j survives cross-format reload (reverse=%s)', async (purpose, reverse) => {
    const files = [referenceFile('REF-4711', 'Invoice 4711', 0, 'DE111'), referenceFile('REF-4711', purpose, 1, 'DE111')];
    if (reverse) files.reverse();
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(files[0].rows, importRows);
    const ledger = stored.map((doc) => adaptBankMovementDoc(doc));
    const next = classifyBankImportFiles([{ parsed: files[1] }], ledger);
    await importRows(next.files.flatMap((file) => file.diff.newRows));
    expect(stored).toHaveLength(1);
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    const report = diffBankStatementFiles([files[1]], ledger);
    expect(report.newRows).toEqual([]);
    expect(report.orphanLedgerRows).toEqual([]);
    const batch = classifyBankImportFiles(files.map((parsed) => ({ parsed })));
    expect(batch.summary.newRows).toBe(1);
    expect(batch.files.flatMap((file) => file.diff.newRows)[0].bankEvidence).toHaveLength(2);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each([0, 1].flatMap((format) => permutations([0, 1, 2, 3]).map((order) => [format, order])))('keeps two payments across four equivalent aliases (format %s, order %j)', async (format, order) => {
    const files = [4711, 4711, 4712, 4712].map((number, i) => referenceFile(`REF-${number}`,
      i % 2 ? `Überweisungsauftrag Invoice ${number}` : `Invoice: ${number}`, i % 2 ? 1 - format : format, 'DE111'));
    const entries = order.map((index) => ({ parsed: files[index] }));
    const classified = classifyBankImportFiles(entries);
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(classified.files.flatMap((file) => file.diff.newRows), importRows);
    expect(stored).toHaveLength(2);
    for (const doc of stored) expect(doc.bankEvidence).toHaveLength(2);
    const ledger = stored.map((doc) => adaptBankMovementDoc(doc));
    const reimport = classifyBankImportFiles(entries, ledger);
    await importRows(reimport.files.flatMap((file) => file.diff.newRows));
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(2);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
    const report = diffBankStatementFiles(files, ledger);
    expect(report.rows).toHaveLength(2);
    expect(report.newRows).toEqual([]);
    expect(report.orphanLedgerRows).toEqual([]);
  });

  it('rejects internally contradictory persisted references without choosing a winning source', async () => {
    const parsed = referenceFile('REF-A');
    const row = { ...parsed.rows[0], description: parsed.rows[0].rawDescription, sepa: {} };
    const stored = await importLocally([row], useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    stored[0].sepa.customerRef = 'REF-B';
    stored[0].bankEvidence[0].customerRef = 'REF-B';
    const loaded = adaptBankMovementDoc(JSON.parse(JSON.stringify(stored[0])));
    expect(loaded).not.toHaveProperty('bankEvidence');
    for (const reference of ['REF-A', 'REF-B']) {
      const source = referenceFile(reference);
      expect(classifyBankImportFiles([{ parsed: source }], [loaded]).summary.newRows).toBe(1);
      const report = diffBankStatementFiles([source], [loaded]);
      expect(report.newRows).toHaveLength(1);
      expect(report.orphanLedgerRows).toHaveLength(1);
    }
  });

  it.each(['reference', 'purpose'])('does not suppress an unrelated %s after actual persistence/reload', async (field) => {
    const first = referenceFile('REF-A', 'Invoice A');
    const second = referenceFile(field === 'reference' ? 'REF-B' : 'REF-A', field === 'purpose' ? 'Invoice B' : 'Invoice A');
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(first.rows, importRows);
    const diff = classifyBankImportFiles([{ parsed: second }], stored.map((doc) => adaptBankMovementDoc(doc)));
    expect(diff.summary).toMatchObject({ newRows: 1, duplicates: 0 });
    await importRows(diff.files[0].diff.newRows);
    expect(stored).toHaveLength(2);
    const reimport = classifyBankImportFiles([first, second].map((parsed) => ({ parsed })), stored.map((doc) => adaptBankMovementDoc(doc)));
    await importRows(reimport.files.flatMap((file) => file.diff.newRows));
    expect(reimport.summary.newRows).toBe(0);
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(2);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each([{ customerRef: 'REF-B' }, { purpose: 'invoice b' }])('invalidates evidence contradicting owned bank facts: %j', async (change) => {
    const parsed = referenceFile('REF-A', 'Invoice A');
    const [stored] = await importLocally(parsed.rows, useBankImport({ email: 'synthetic@example.invalid' }).importRows);
    stored.bankEvidence[0] = { ...stored.bankEvidence[0], ...change };
    const loaded = adaptBankMovementDoc(JSON.parse(JSON.stringify(stored)));
    expect(loaded).not.toHaveProperty('bankEvidence');
    expect(classifyBankImportFiles([{ parsed }], [loaded]).summary.newRows).toBe(0);
  });

  it.each(['', 'NOTPROVIDED', 'NONREF'].flatMap((placeholder) => orders.filter((order) => order.length === 3)
    .map((order) => [order, placeholder])))('an unknown reference cannot bridge conflicting aliases in order %j (%j)', async (order, placeholder) => {
    const sources = [referenceFile('REF-A'), referenceFile('REF-B'), referenceFile(placeholder, 'Payment', 1)];
    const entries = order.map((index) => ({ parsed: sources[index] }));
    const diff = classifyBankImportFiles(entries);
    expect(diff.summary.newRows).toBe(2);
    const { importRows } = useBankImport({ email: 'synthetic@example.invalid' });
    const stored = await importLocally(diff.files.flatMap((file) => file.diff.newRows), importRows);
    expect(stored).toHaveLength(2);
    for (const doc of stored) expect(new Set(doc.bankEvidence.map((record) => record.customerRef).filter((ref) => ['REF-A', 'REF-B'].includes(ref))).size).toBe(1);
    const ledger = stored.map((doc) => adaptBankMovementDoc(doc));
    const reimport = classifyBankImportFiles(entries, ledger);
    expect(reimport.summary.newRows).toBe(0);
    await importRows(reimport.files.flatMap((file) => file.diff.newRows));
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(2);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it('persists bank statement identity, run, file, raw, and signed amount metadata while keeping amount/direction compatibility', async () => {
    const { importRows } = useBankImport({ email: 'jarl@example.com' });
    const row = {
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      description: 'Invoice payment',
      counterpartyName: 'Supplier GmbH',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      raw: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    };

    const result = await importRows([row], 'fallback.csv');

    expect(result).toMatchObject({ success: true, imported: 1 });
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      amount: 42.13,
      signedAmount: -42.13,
      direction: 'out',
      importSource: 'bank-csv',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDatev: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    });
  });

  it('falls back to legacy filename and row line number when parser metadata is absent', async () => {
    const { importRows } = useBankImport({ email: 'jarl@example.com' });

    await importRows([
      {
        direction: 'in',
        amount: 19.99,
        postedDate: '2026-05-08',
        description: 'Refund',
        counterpartyName: 'Customer',
        lineNumber: 4,
      },
    ], 'legacy.csv');

    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      amount: 19.99,
      signedAmount: 19.99,
      direction: 'in',
      importFile: { name: 'legacy.csv', size: 0, lastModified: null },
      importLineNumber: 4,
    });
  });

  it('persists sepa, bookingText, accountIban, and balanceAfter for an Umsätze-format row', async () => {
    const { importRows } = useBankImport({ email: 'jarl@example.com' });
    const sepa = {
      endToEndRef: '', customerRef: '', mandateRef: 'T0010001B000006115585469',
      creditorId: 'DE9700000000142462', debtorId: '', purposeCode: '',
      purpose: 'Kd-Nr.: 6115585469', alternativeCounterparty: '', tan: '', iban: '', bic: '',
    };
    const row = {
      direction: 'out',
      amount: 25,
      signedAmount: -25,
      postedDate: '2026-09-07',
      valueDate: '2026-09-07',
      description: sepa.purpose,
      counterpartyName: 'Telefonica Germany GmbH + Co. OHG',
      sepa,
      bookingText: 'Basislastschrift',
      accountIban: 'DE76130910540001342860',
      balanceAfter: -28752.98,
      lineNumber: 5,
    };

    await importRows([row], 'umsaetze.csv');

    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      sepa,
      bookingText: 'Basislastschrift',
      accountIban: 'DE76130910540001342860',
      balanceAfter: -28752.98,
    });
  });

  it('defaults sepa to null, bookingText/accountIban to empty, and balanceAfter to null for a kontobewegungen row without those fields', async () => {
    const { importRows } = useBankImport({ email: 'jarl@example.com' });

    await importRows([
      {
        direction: 'in',
        amount: 19.99,
        postedDate: '2026-05-08',
        description: 'Refund',
        counterpartyName: 'Customer',
        lineNumber: 4,
      },
    ], 'legacy.csv');

    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      sepa: null,
      bookingText: '',
      accountIban: '',
      balanceAfter: null,
    });
  });
});
