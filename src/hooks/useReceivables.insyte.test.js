/**
 * Insyte CxC writes — upsert by presupuesto and DATEV Rechnung attachment.
 *
 * The rules these tests pin (Jeisson, 30.08.2026):
 *   · the amount of an Insyte row is coalesce(importePedido, importePresupuesto)
 *     NET Insyte — a DATEV Endbetrag may NEVER overwrite it
 *   · a partial upsert leaves rechnungId, numeroPedido, pep, estadoInsyte,
 *     tipoObra, obraPueblo, fechaPedido and kw alone when the caller omits them
 *   · attaching a Rechnung stamps rechnungId + numeroPedido only, moves a
 *     pending row to issued, deletes the aggregate "one row per DATEV"
 *     document and never creates a row whose invoiceNumber is 2025-NNN
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const insyteRow = (overrides = {}) => ({
  id: 'r-8420',
  sourceKey: 'insyte:cxc:0026048420',
  sourceSystem: 'insyte',
  numeroPresupuesto: '0026048420',
  numeroPedido: '',
  rechnungId: '',
  pep: 'PD-004-06-73-0033',
  estadoInsyte: 'O',
  tipoObra: 'NAS',
  obraPueblo: 'Reinheim',
  fechaPedido: '2026-08-20',
  kw: 'KW33',
  status: 'issued',
  grossAmount: 230,
  amount: 230,
  openAmount: 230,
  paidAmount: 0,
  importePresupuesto: 230,
  importePedido: null,
  counterpartyName: 'INSYTE',
  documentNumber: '0026048420',
  issueDate: '2026-08-24',
  dueDate: '2026-09-23',
  payments: [],
  ...overrides,
});

const ROW_8420 = insyteRow();
const ROW_8468 = insyteRow({
  id: 'r-8468',
  sourceKey: 'insyte:cxc:0026048468',
  numeroPresupuesto: '0026048468',
  documentNumber: '0026048468',
  status: 'pending',
  grossAmount: 460,
  amount: 460,
  openAmount: 460,
  importePresupuesto: 460,
});
const AGGREGATE_270 = {
  id: 'agg-270',
  invoiceNumber: '2025-270',
  documentNumber: '2025-270',
  sourceKey: '',
  status: 'issued',
  grossAmount: 5186.02,
  amount: 5186.02,
  openAmount: 5186.02,
  paidAmount: 0,
  counterpartyName: 'Insyte Deutschland GmbH',
  issueDate: '2026-08-28',
  dueDate: '2026-09-27',
  payments: [],
};

const store = installFirebaseMocks({
  collections: { receivables: [ROW_8420, ROW_8468, AGGREGATE_270] },
});

const firestore = await import('firebase/firestore');
const { useReceivables } = await import('./useReceivables.js');

const mount = async () => {
  const { result } = renderHook(() => useReceivables(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

const snapshotOf = (docs) => ({
  empty: docs.length === 0,
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
});

/** addDoc is shared with the audit log; only receivables writes count here. */
const receivableAdds = () =>
  firestore.addDoc.mock.calls.filter(([ref]) => String(ref?.path || '').endsWith('/receivables'));

const updatePayloads = () =>
  new Map(firestore.updateDoc.mock.calls.map(([ref, payload]) => [ref.id, payload]));

beforeEach(() => {
  store.collections.receivables = [ROW_8420, ROW_8468, AGGREGATE_270];
  firestore.updateDoc.mockClear();
  firestore.deleteDoc.mockClear();
  firestore.addDoc.mockClear();
  firestore.getDocs.mockReset();
});

describe('upsertReceivableByInsyteKey — partial updates', () => {
  it('does not overwrite the Insyte amount with a DATEV Endbetrag', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([ROW_8420]));
    const result = await mount();

    const outcome = await result.current.upsertReceivableByInsyteKey({
      numeroPresupuesto: '0026048420',
      rechnungId: '2025-270',
      amount: 5186.02,
    });

    expect(outcome).toMatchObject({ success: true, action: 'updated', id: 'r-8420' });
    const payload = updatePayloads().get('r-8420');
    expect(payload.rechnungId).toBe('2025-270');
    ['amount', 'grossAmount', 'openAmount', 'pendingAmount', 'importePedido', 'importePresupuesto'].forEach((key) => {
      expect(payload).not.toHaveProperty(key);
    });
  });

  it('does not blank rechnungId, numeroPedido or the Insyte metadata when omitted', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([insyteRow({ rechnungId: '2025-270', numeroPedido: '2640070' })]));
    const result = await mount();

    await result.current.upsertReceivableByInsyteKey({
      numeroPresupuesto: '0026048420',
      importePresupuesto: 230,
    });

    const payload = updatePayloads().get('r-8420');
    ['rechnungId', 'numeroPedido', 'pep', 'estadoInsyte', 'tipoObra', 'obraPueblo', 'fechaPedido', 'kw'].forEach((key) => {
      expect(payload).not.toHaveProperty(key);
    });
    expect(payload).toMatchObject({ grossAmount: 230, amount: 230, openAmount: 230, importePresupuesto: 230 });
  });

  it('recomputes the amount from importePedido over importePresupuesto', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([ROW_8420]));
    const result = await mount();

    await result.current.upsertReceivableByInsyteKey({
      numeroPresupuesto: '0026048420',
      numeroPedido: '2640070',
      importePedido: 250,
      importePresupuesto: 230,
    });

    expect(updatePayloads().get('r-8420')).toMatchObject({
      numeroPedido: '2640070',
      grossAmount: 250,
      amount: 250,
      openAmount: 250,
      importePedido: 250,
      importePresupuesto: 230,
    });
  });

  it('creates a complete row with empty defaults when the presupuesto is new', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([]));
    const result = await mount();

    const outcome = await result.current.upsertReceivableByInsyteKey({
      numeroPresupuesto: '26048682',
      numeroPedido: '2640321',
      importePedido: 1383,
      referenciaObra: 'KW32_HARSEWINKEL-OST_Umtelkomd_NE4',
    });

    expect(outcome).toMatchObject({ success: true, action: 'created' });
    const [, payload] = receivableAdds()[0];
    expect(payload).toMatchObject({
      sourceKey: 'insyte:cxc:0026048682',
      numeroPresupuesto: '0026048682',
      numeroPedido: '2640321',
      invoiceNumber: '0026048682',
      documentNumber: '0026048682',
      grossAmount: 1383,
      amount: 1383,
      rechnungId: '',
      pep: '',
      kw: 'KW32',
    });
  });

  it('skips settled and cancelled rows', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([insyteRow({ status: 'settled' })]));
    const result = await mount();

    const outcome = await result.current.upsertReceivableByInsyteKey({ numeroPresupuesto: '0026048420', rechnungId: '2025-270' });

    expect(outcome).toMatchObject({ action: 'skipped', reason: 'settled' });
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });
});

describe('attachDatevRechnungToInsyte', () => {
  const map = { 2640070: '0026048420', 2640164: '0026048468', 2640169: '0026048476' };

  it('stamps rechnungId + numeroPedido only and moves a pending row to issued', async () => {
    const result = await mount();

    const outcome = await result.current.attachDatevRechnungToInsyte({
      rechnungId: '2025-270',
      pedidos: ['2640070', '2640164'],
      map,
      pdfNet: 690,
      pdfGross: 821.1,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.plan.attach).toHaveLength(2);
    const payloads = updatePayloads();
    expect(Object.keys(payloads.get('r-8420')).sort()).toEqual(
      ['auditTrail', 'datevMeta', 'numeroPedido', 'rechnungId', 'updatedAt', 'updatedBy'].sort(),
    );
    expect(payloads.get('r-8420')).toMatchObject({
      rechnungId: '2025-270',
      numeroPedido: '2640070',
      datevMeta: { pdfNet: 690, pdfGross: 821.1 },
    });
    expect(payloads.get('r-8420')).not.toHaveProperty('status');
    expect(payloads.get('r-8468')).toMatchObject({ rechnungId: '2025-270', numeroPedido: '2640164', status: 'issued' });
  });

  it('never writes an amount, even when the PDF totals are passed', async () => {
    const result = await mount();
    await result.current.attachDatevRechnungToInsyte({ rechnungId: '2025-270', pedidos: ['2640070'], map, pdfGross: 5186.02 });

    ['amount', 'grossAmount', 'openAmount', 'pendingAmount', 'importePedido', 'importePresupuesto'].forEach((key) => {
      expect(updatePayloads().get('r-8420')).not.toHaveProperty(key);
    });
  });

  it('deletes the aggregate row created per DATEV and leaves Insyte rows', async () => {
    const result = await mount();
    const outcome = await result.current.attachDatevRechnungToInsyte({ rechnungId: '2025-270', pedidos: ['2640070'], map });

    expect(outcome.plan.aggregateRowsToDelete).toEqual(['agg-270']);
    expect(firestore.deleteDoc).toHaveBeenCalledTimes(1);
    expect(firestore.deleteDoc.mock.calls[0][0].id).toBe('agg-270');
  });

  it('leaves an unresolved or row-less pedido in missing without creating anything', async () => {
    const result = await mount();
    const outcome = await result.current.attachDatevRechnungToInsyte({ rechnungId: '2025-270', pedidos: ['2640169', '2649999'], map });

    expect(outcome.plan.missing).toEqual([
      { numeroPedido: '2640169', numeroPresupuesto: '0026048476', reason: 'no-row' },
      { numeroPedido: '2649999', numeroPresupuesto: null, reason: 'unresolved' },
    ]);
    expect(receivableAdds()).toHaveLength(0);
    expect(outcome.created).toEqual([]);
  });

  it('creates a missing row only from Insyte data carrying an importe, never with the Rechnung as invoiceNumber', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([]));
    const result = await mount();

    const outcome = await result.current.attachDatevRechnungToInsyte({
      rechnungId: '2025-270',
      pedidos: ['2640169'],
      map,
      insyteRows: [
        { numeroPresupuesto: '0026048476', numeroPedido: '2640169', importePresupuesto: 2208, referenciaObra: 'Roßdorf QFF-001, 002 KW34 2026' },
      ],
    });

    expect(outcome.created).toEqual([expect.objectContaining({ numeroPresupuesto: '0026048476', success: true })]);
    const [, payload] = receivableAdds()[0];
    expect(payload).toMatchObject({
      sourceKey: 'insyte:cxc:0026048476',
      invoiceNumber: '0026048476',
      documentNumber: '0026048476',
      rechnungId: '2025-270',
      numeroPedido: '2640169',
      grossAmount: 2208,
    });
    expect(payload.invoiceNumber).not.toMatch(/^\d{4}-\d{3}$/);
  });

  it('creates a missing row from parsed pedidoRows (CSV) with importePedido as the amount', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshotOf([]));
    const result = await mount();

    const outcome = await result.current.attachDatevRechnungToInsyte({
      rechnungId: '2025-271',
      pedidos: ['2640178'],
      map: {},
      pedidoRows: [
        { numeroPedido: '2640178', numeroPresupuesto: '0026048505', fechaPedido: '2026-08-25', fechaPresupuesto: '2026-08-25', referenciaObra: 'M26-14 Rossdorf', importePedido: 12608.36, kw: '' },
      ],
    });

    expect(outcome.success).toBe(true);
    expect(outcome.plan.attach).toEqual([]);
    expect(outcome.created).toEqual([expect.objectContaining({ numeroPresupuesto: '0026048505', success: true })]);
    const [, payload] = receivableAdds()[0];
    expect(payload).toMatchObject({
      sourceKey: 'insyte:cxc:0026048505',
      invoiceNumber: '0026048505',
      numeroPedido: '2640178',
      rechnungId: '2025-271',
      grossAmount: 12608.36,
      importePedido: 12608.36,
      fechaPedido: '2026-08-25',
    });
  });

  it('does not create a row from Insyte data without an importe', async () => {
    const result = await mount();
    const outcome = await result.current.attachDatevRechnungToInsyte({
      rechnungId: '2025-270',
      pedidos: ['2640169'],
      map,
      insyteRows: [{ numeroPresupuesto: '0026048476', numeroPedido: '2640169' }],
    });

    expect(receivableAdds()).toHaveLength(0);
    expect(outcome.plan.missing).toEqual([{ numeroPedido: '2640169', numeroPresupuesto: '0026048476', reason: 'no-row' }]);
  });

  it('refuses a conflicting Rechnung stamp and a bad rechnungId', async () => {
    store.collections.receivables = [insyteRow({ rechnungId: '2025-269' })];
    const result = await mount();

    const outcome = await result.current.attachDatevRechnungToInsyte({ rechnungId: '2025-270', pedidos: ['2640070'], map });
    expect(outcome.plan.conflicts).toHaveLength(1);
    expect(firestore.updateDoc).not.toHaveBeenCalled();

    const bad = await result.current.attachDatevRechnungToInsyte({ rechnungId: 'R-270', pedidos: ['2640070'], map });
    expect(bad.success).toBe(false);
  });

  it('refuses without a signed-in user', async () => {
    const { result } = renderHook(() => useReceivables(null));
    expect((await result.current.attachDatevRechnungToInsyte({ rechnungId: '2025-270', pedidos: ['2640070'] })).success).toBe(false);
  });
});
