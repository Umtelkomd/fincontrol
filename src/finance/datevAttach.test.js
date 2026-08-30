/**
 * planDatevAttach — how one DATEV Rechnung lands on its Insyte rows.
 *
 * 1 Rechnung 2025-NNN groups N Insyte presupuestos. The plan stamps
 * rechnungId + numeroPedido on the rows that exist, reports pedidos it cannot
 * resolve or that have no row, flags rows already stamped with ANOTHER
 * Rechnung, and lists the aggregate "one row per DATEV" documents that must
 * go. It never proposes an amount change: the Insyte NET is the amount, the
 * DATEV Endbetrag is not.
 */
import { describe, expect, it } from 'vitest';

import { planDatevAttach } from './datevAttach.js';

const insyteRow = (overrides = {}) => ({
  id: 'row',
  sourceKey: 'insyte:cxc:0026048420',
  sourceSystem: 'insyte',
  numeroPresupuesto: '0026048420',
  numeroPedido: '',
  rechnungId: '',
  status: 'issued',
  grossAmount: 230,
  ...overrides,
});

const receivables = [
  insyteRow({ id: 'r-8420', numeroPresupuesto: '0026048420', sourceKey: 'insyte:cxc:0026048420' }),
  insyteRow({ id: 'r-8468', numeroPresupuesto: '0026048468', sourceKey: 'insyte:cxc:0026048468', numeroPedido: '2640164' }),
  insyteRow({ id: 'r-8471', numeroPresupuesto: '0026048471', sourceKey: 'insyte:cxc:0026048471', rechnungId: '2025-270' }),
  insyteRow({ id: 'r-8473', numeroPresupuesto: '0026048473', sourceKey: 'insyte:cxc:0026048473', rechnungId: '2025-269' }),
  // The aggregate row the old Slack script created for the same Rechnung.
  { id: 'agg-270', invoiceNumber: '2025-270', documentNumber: '2025-270', sourceKey: '', grossAmount: 5186.02, status: 'issued' },
  // A genuine B2C Leitungsweg row for another invoice — must be left alone.
  { id: 'sp-257', invoiceNumber: '2025-257', documentNumber: '2025-257', sourceKey: '', grossAmount: 79.99, status: 'issued' },
  // An Insyte row that mentions the Rechnung in its documentNumber must not be deleted.
  insyteRow({ id: 'r-weird', numeroPresupuesto: '0026048999', sourceKey: 'insyte:cxc:0026048999', documentNumber: '2025-270' }),
];

const map = {
  2640070: '0026048420',
  2640164: '0026048468',
  2640165: '0026048471',
  2640168: '0026048473',
  2640169: '0026048476', // no row loaded
};

describe('planDatevAttach', () => {
  const plan = planDatevAttach({
    rechnungId: '2025-270',
    pedidos: ['2640070', '2640164', '2640165', '2640168', '2640169', '2649999'],
    receivables,
    map,
    pdfNet: 4358,
    pdfGross: 5186.02,
  });

  it('attaches every pedido whose presupuesto has a row and no other Rechnung', () => {
    expect(plan.attach).toEqual([
      { receivableId: 'r-8420', numeroPresupuesto: '0026048420', numeroPedido: '2640070' },
      { receivableId: 'r-8468', numeroPresupuesto: '0026048468', numeroPedido: '2640164' },
      { receivableId: 'r-8471', numeroPresupuesto: '0026048471', numeroPedido: '2640165' },
    ]);
  });

  it('reports the pedidos it cannot land, with a reason', () => {
    expect(plan.missing).toEqual([
      { numeroPedido: '2640169', numeroPresupuesto: '0026048476', reason: 'no-row' },
      { numeroPedido: '2649999', numeroPresupuesto: null, reason: 'unresolved' },
    ]);
  });

  it('flags a row already stamped with a different Rechnung as a conflict', () => {
    expect(plan.conflicts).toEqual([
      { receivableId: 'r-8473', numeroPresupuesto: '0026048473', numeroPedido: '2640168', rechnungId: '2025-269' },
    ]);
  });

  it('deletes only the non-Insyte aggregate rows bearing this Rechnung number', () => {
    expect(plan.aggregateRowsToDelete).toEqual(['agg-270']);
  });

  it('never proposes an amount change', () => {
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/amount|grossAmount|openAmount/i);
    expect(plan).toMatchObject({ rechnungId: '2025-270', pdfNet: 4358, pdfGross: 5186.02 });
  });

  it('resolves a pedido through the loaded rows before the map', () => {
    const rows = [insyteRow({ id: 'x', numeroPresupuesto: '0026040001', sourceKey: 'insyte:cxc:0026040001', numeroPedido: '2640070' })];
    const result = planDatevAttach({ rechnungId: '2025-270', pedidos: ['2640070'], receivables: rows, map });
    expect(result.attach).toEqual([{ receivableId: 'x', numeroPresupuesto: '0026040001', numeroPedido: '2640070' }]);
  });

  it('refuses a rechnungId that is not 2025-NNN or an empty pedido list', () => {
    expect(planDatevAttach({ rechnungId: 'R-270', pedidos: ['2640070'], receivables, map }).error).toMatch(/rechnungId/);
    expect(planDatevAttach({ rechnungId: '2025-270', pedidos: [], receivables, map }).error).toMatch(/pedido/);
  });

  it('skips settled and cancelled rows instead of restamping them', () => {
    const rows = [insyteRow({ id: 's', status: 'settled' }), insyteRow({ id: 'c', numeroPresupuesto: '0026048468', sourceKey: 'insyte:cxc:0026048468', status: 'cancelled' })];
    const result = planDatevAttach({ rechnungId: '2025-270', pedidos: ['2640070', '2640164'], receivables: rows, map });
    expect(result.attach).toEqual([]);
    expect(result.missing).toEqual([
      { numeroPedido: '2640070', numeroPresupuesto: '0026048420', reason: 'settled' },
      { numeroPedido: '2640164', numeroPresupuesto: '0026048468', reason: 'cancelled' },
    ]);
  });
});

describe('planDatevAttach — parsed Insyte pedidos as resolver source', () => {
  it('resolves through pedidoRows before the seed map', () => {
    const rows = [insyteRow({ id: 'p', numeroPresupuesto: '0026040009', sourceKey: 'insyte:cxc:0026040009' })];
    const result = planDatevAttach({
      rechnungId: '2025-270',
      pedidos: ['2640070'],
      receivables: rows,
      map: { 2640070: '0026048420' },
      pedidoRows: [{ numeroPedido: '2640070', numeroPresupuesto: '0026040009', importePedido: 230 }],
    });
    expect(result.attach).toEqual([{ receivableId: 'p', numeroPresupuesto: '0026040009', numeroPedido: '2640070' }]);
  });
});
