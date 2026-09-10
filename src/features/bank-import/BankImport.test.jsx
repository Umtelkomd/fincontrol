/**
 * BankImport — full-year statement import support.
 *
 * These tests protect the "Saldos de cierre detectados" panel: a CSV that
 * carries a running-balance column must surface one row per month, mark the
 * months that already have a reconciliation anchor on that exact date, and
 * let an admin register the missing ones with one click — without ever
 * writing anything before that click.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { reconciliationDoc } from '@/test/fixtures';

const KONTOBEWEGUNGEN_HEADER =
  'Automat;Sammlerauflösung;Buchungsdatum;Valutadatum;Empfängername/Auftraggeber;IBAN/Kontonummer;BIC/BLZ;Verwendungszweck;Betrag in EUR;Notiz;Anzahl Belege;Geprüft;Saldo';

const csvRow = (postedDate, amount, balance) =>
  `Nein;Nein;${postedDate};${postedDate};ACME GmbH;DE89370400440532013000;COBADEFFXXX;Rechnung;${amount};;0;Ja;${balance}`;

// Covers two months: May (already anchored on 2026-05-31) and June (missing).
const CSV_TEXT = [
  KONTOBEWEGUNGEN_HEADER,
  csvRow('31.05.2026', '1.234,56', '1.214,20'),
  csvRow('30.06.2026', '3.785,80', '5.000,00'),
].join('\n');

const store = installFirebaseMocks({
  documents: {
    reconciliation: reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]),
  },
});

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: BankImport } = await import('./BankImport.jsx');

const initialSnapshot = firestore.onSnapshot.getMockImplementation();
beforeEach(() => {
  firestore.onSnapshot.mockImplementation(initialSnapshot);
  firestore.addDoc.mockReset().mockResolvedValue({ id: 'synthetic' });
  store.collections.bankMovements = [];
  firestore.setDoc.mockReset().mockResolvedValue(undefined);
  store.documents.reconciliation = reconciliationDoc([
    { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
  ]);
});

const uploadCsv = async (name = 'kontobewegungen_export.csv') => {
  const file = new File([CSV_TEXT], name, { type: 'text/csv' });
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('Saldos de cierre detectados');
};

describe('BankImport — unresolved matching eligibility', () => {
  it.each([false, true].flatMap((copied) => [[false, false], [true, false], [false, true], [true, true]]
    .map(([reverse, existing]) => [reverse, existing, copied])))('imports only the independent payment through the real hook (reverse=%s, ledger=%s, copied=%s)', async (reverse, existing, copied) => {
    const count = copied ? 2 : 120;
    const stored = [];
    const initialLedger = existing ? Array.from({ length: count }, (_, i) => ({ id: `existing-${i}`,
      kind: 'payment', status: 'posted', amount: 100, direction: 'out', currency: 'EUR',
      postedDate: '2026-05-08', counterpartyName: 'Synthetic', counterpartyIban: 'DE111',
      description: 'Payment', sepa: { customerRef: i % 2 ? 'B' : 'A' }, balanceAfter: 900 })) : [];
    store.collections.bankMovements = JSON.parse(JSON.stringify(initialLedger));
    const listeners = new Set();
    firestore.onSnapshot.mockImplementation((ref, next, error) => {
      if (!ref.path.endsWith('/bankMovements')) return initialSnapshot(ref, next, error);
      const emit = () => initialSnapshot(ref, next, error);
      listeners.add(emit);
      emit();
      return () => listeners.delete(emit);
    });
    firestore.addDoc.mockImplementation(async (ref, payload) => {
      if (!ref.path.endsWith('/bankMovements')) return { id: 'synthetic-audit' };
      const id = `synthetic-${stored.length}`;
      stored.push(JSON.parse(JSON.stringify({ ...payload, id })));
      store.collections.bankMovements = [...initialLedger, ...stored];
      listeners.forEach((emit) => emit());
      return { id };
    });
    const denseFile = (second) => copied ? [
      'Buchungstag;Valutadatum;Name Zahlungsbeteiligter;Verwendungszweck;Betrag;Saldo nach Buchung;IBAN Zahlungsbeteiligter;Waehrung',
      ...Array(2).fill('08.05.2026;08.05.2026;Synthetic;Payment;-100,00;900,00;DE111;EUR'),
      ...(!second ? ['30.06.2026;30.06.2026;ACME;Independent;42,00;942,00;DE111;EUR'] : []),
    ].join('\n') : [KONTOBEWEGUNGEN_HEADER,
      ...Array.from({ length: 120 }, (_, i) => {
        const reference = second ? (i % 2 ? 'B' : 'A') : (i % 2 ? 'A' : '');
        const purpose = `${reference ? `KREF+${reference}` : ''}SVWZ+Payment TAN: ${second ? '2' : '1'}${i}`;
        return `Nein;Nein;08.05.2026;08.05.2026;Synthetic;DE111;;${purpose};-100,00;;0;Ja;900,00`;
      }),
      ...(!second ? [csvRow('30.06.2026', '42,00', '942,00')] : []),
    ].join('\n');
    const files = [new File([denseFile(false)], 'a.csv'), new File([denseFile(true)], 'b.csv')];
    if (reverse) files.reverse();
    renderScreen(<BankImport user={{ uid: 'u1', email: 'synthetic@example.invalid' }} />);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files } });
    await waitFor(() => expect(document.body.textContent).toContain(`${count * 2} movimientos retenidos para revisión`));
    if (copied) expect(document.body.textContent).toContain('repeticiones sin prueba de pagos distintos');
    expect(stored).toEqual([]);
    expect(screen.queryByRole('button', { name: /Registrar \/ corregir anclas/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Importar todos los pendientes' }));
    await waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0]).toMatchObject({ amount: 42, postedDate: '2026-06-30' });
    expect(document.body.textContent).toContain(`${count * 2} movimientos retenidos para revisión`);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Importar todos los pendientes' })).not.toBeInTheDocument());
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [files[0]] } });
    await screen.findByText('3 archivo(s)');
    expect(document.body.textContent).toContain(`${count * 3} movimientos retenidos para revisión`);
    expect(screen.queryByRole('button', { name: 'Importar todos los pendientes' })).not.toBeInTheDocument();
    expect(stored).toHaveLength(1);
    expect(firestore.addDoc.mock.calls.filter(([ref]) => ref.path.endsWith('/bankMovements'))).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0]);
    await screen.findByText('2 archivo(s)');
    expect(screen.queryByRole('button', { name: 'Importar todos los pendientes' })).not.toBeInTheDocument();
    expect(stored).toHaveLength(1);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe('BankImport — arithmetic anchor eligibility', () => {
  it.each([0, 1].flatMap((format) => ['100,00garbage', '1.0.0,00', '100,001', 'N/A', ...(format ? ['100,00'] : [])]
    .flatMap((amount) => [false, true].map((reverse) => [format, amount, reverse]))))('never authorizes malformed bridge payments or anchors (%s, %s, reverse=%s)', async (format, amount, reverse) => {
    const saved = [], movements = [];
    firestore.setDoc.mockImplementation(async (_, payload) => { saved.push(JSON.parse(JSON.stringify(payload))); });
    firestore.addDoc.mockImplementation(async (ref, payload) => {
      if (ref.path.endsWith('/bankMovements')) movements.push(JSON.parse(JSON.stringify(payload)));
      return { id: `synthetic-${movements.length}` };
    });
    const header = format ? 'Buchungstag;Valutadatum;Name Zahlungsbeteiligter;Verwendungszweck;Betrag;Saldo nach Buchung;IBAN Auftragskonto;Waehrung' : KONTOBEWEGUNGEN_HEADER;
    const lines = [['-100,00', '900,00'], [amount, '1000,00'], ['-100,00', '900,00']].map(([value, balance]) => format
      ? `08.05.2026;08.05.2026;ACME;Payment;${value};${balance};DEACCOUNT;EUR` : csvRow('08.05.2026', value, balance));
    if (reverse) lines.reverse();
    renderScreen(<BankImport user={{ uid: 'u1', email: 'synthetic@example.invalid' }} />);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([[header, ...lines].join('\n')], 'amount.csv')] } });
    await screen.findByText('amount.csv');
    if (amount === '100,00') {
      fireEvent.click(screen.getByRole('button', { name: 'Importar todos los pendientes' }));
      await waitFor(() => expect(movements).toHaveLength(3));
      fireEvent.click(screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/ }));
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0].anchors).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-05-08', balance: 900 })]));
    } else {
      expect(screen.queryByRole('button', { name: /Registrar \/ corregir anclas/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Importar todos los pendientes' })).not.toBeInTheDocument();
      expect(document.body.textContent).toContain('Saldos no verificables');
      expect([movements, saved]).toEqual([[], []]);
    }
  });

  it.each(['800,00', '750,00', 'N/A'])('writes one atomic anchor batch only for a verified chain ending %s', async (last) => {
    const saved = [];
    firestore.setDoc.mockImplementation(async (_, payload) => {
      saved.push(JSON.parse(JSON.stringify(payload)));
      store.documents.reconciliation = saved.at(-1);
    });
    const text = [KONTOBEWEGUNGEN_HEADER, csvRow('07.05.2026', '-100,00', '1000,00'),
      csvRow('08.05.2026', '-100,00', '900,00'), csvRow('08.05.2026', '-100,00', last)].join('\n');
    renderScreen(<BankImport user={{ uid: 'u1', email: 'synthetic@example.invalid' }} />);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File([text], 'sequence.csv')] } });
    await screen.findByText('sequence.csv');
    expect(saved).toEqual([]);
    if (last === '800,00') {
      fireEvent.click(screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/ }));
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0].anchors).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-05-08', balance: 800 })]));
    } else {
      expect(screen.queryByRole('button', { name: /Registrar \/ corregir anclas/ })).not.toBeInTheDocument();
      expect(document.body.textContent).toContain('Saldos no verificables');
      expect(saved).toEqual([]);
    }
  });
});

describe('BankImport — detected month-end balances', () => {
  it.each([false, true])('saves every pending anchor atomically (failure=%s)', async (fails) => {
    const untouched = { date: '2026-07-27', balance: 42, source: 'manual' };
    store.documents.reconciliation = reconciliationDoc([untouched]);
    if (fails) firestore.setDoc.mockRejectedValueOnce(new Error('synthetic write failure'));
    renderScreen(<BankImport user={{ uid: 'u1', email: 'test@example.invalid' }} />);
    await uploadCsv();
    fireEvent.click(screen.getByRole('button', { name: /Registrar \/ corregir anclas \(2\)/i }));
    await screen.findByText(fails ? '2 con error' : '2 registrada(s)');
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(firestore.setDoc.mock.calls[0][1].anchors).toEqual([
      untouched,
      expect.objectContaining({ date: '2026-06-30', balance: 5000 }),
      expect.objectContaining({ date: '2026-05-31', balance: 1214.2 }),
    ]);
    expect(screen.queryByText(fails ? '1 registrada(s), 1 con error' : '1 registrada(s)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar \/ corregir anclas/ })).toBeEnabled();
  });
  it('lists one row per month and marks the month that already has an anchor', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    expect(screen.getByText(/mayo de 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/junio de 2026/i)).toBeInTheDocument();
    expect(screen.getByText('1.214,20')).toBeInTheDocument();
    expect(screen.getByText('5.000,00')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const mayRow = rows.find((r) => /mayo/i.test(r.textContent));
    const juneRow = rows.find((r) => /junio/i.test(r.textContent));
    expect(mayRow.textContent).toMatch(/Ya registrada/);
    expect(juneRow.textContent).toMatch(/Pendiente/);
  });

  it('only offers to register the missing month, and writes nothing before the click', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    expect(firestore.setDoc).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    expect(payload.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-05-31', balance: 1214.2 }),
        expect.objectContaining({
          date: '2026-06-30',
          balance: 5000,
          source: 'Extracto Volksbank (import kontobewegungen_export.csv)',
        }),
      ]),
    );
    expect(payload.anchors).toHaveLength(2);
  });
});

describe('BankImport — discrepant anchors', () => {
  it('flags an existing anchor whose balance disagrees with the detected one, and the button corrects it', async () => {
    // Seed a WRONG June anchor (real production shape: an anchor exists on
    // the exact closing date but with a stale/incorrect balance).
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
      { date: '2026-06-30', balance: 4000, source: 'manual (wrong)' },
    ]);

    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    const rows = screen.getAllByRole('row');
    const juneRow = rows.find((r) => /junio/i.test(r.textContent));
    expect(juneRow.textContent).toMatch(/Discrepante/);
    expect(juneRow.textContent).toContain('4.000,00');
    expect(juneRow.textContent).toContain('5.000,00');

    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    expect(payload.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-05-31', balance: 1214.2 }),
        expect.objectContaining({
          date: '2026-06-30',
          balance: 5000,
          source: 'Extracto Volksbank (import kontobewegungen_export.csv)',
          note: 'Corrige 5.000,00 € (antes 4.000,00 €)',
        }),
      ]),
    );
    expect(payload.anchors).toHaveLength(2);

    // Reset for any later test in this file.
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]);
  });

  it('never touches an anchor on a non-month-end date (e.g. 2026-07-27)', async () => {
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
      { date: '2026-07-27', balance: -16395.13, source: 'bank statement' },
    ]);

    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    // Only May and June are detected month-end dates; 07-27 never appears.
    expect(screen.queryByText(/27\.07/)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    // The 07-27 anchor survives untouched.
    expect(payload.anchors).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2026-07-27', balance: -16395.13 })]),
    );

    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]);
  });
});

describe('BankImport — no balance column', () => {
  it('never shows the balances panel for a plain 12-column file', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    const plainHeader =
      'Automat;Sammlerauflösung;Buchungsdatum;Valutadatum;Empfängername/Auftraggeber;IBAN/Kontonummer;BIC/BLZ;Verwendungszweck;Betrag in EUR;Notiz;Anzahl Belege;Geprüft';
    const plainCsv = [plainHeader, 'Nein;Nein;08.05.2026;08.05.2026;ACME;DE89;COBA;Rechnung;100,00;;0;Ja'].join('\n');
    const file = new File([plainCsv], 'sin-saldo.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('sin-saldo.csv');
    expect(screen.queryByText('Saldos de cierre detectados')).not.toBeInTheDocument();
  });
});
