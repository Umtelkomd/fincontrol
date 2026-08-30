/**
 * Insyte purchase-order export (pedidos de compra) — the source of truth for
 * pedido → presupuesto and for the Insyte NET amount of every CxC.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseInsytePedidosCsv } from './insytePedidosCsv.js';
import { parseDatevFooterPedidos, parseDatevRechnungHeader } from './datevRechnungFooter.js';
import { resolvePresupuestoForPedido } from './insyteContract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(HERE, '__fixtures__', ...segments), 'utf8');
const SAMPLE = read('insyte', 'pedidos_compra_sample.csv');

describe('parseInsytePedidosCsv', () => {
  it('parses the 9-row export with EUR suffix and quoted references containing commas', () => {
    const rows = parseInsytePedidosCsv(SAMPLE);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({
      numeroPedido: '2640070',
      fechaPedido: '2026-08-25',
      numeroPresupuesto: '0026048420',
      fechaPresupuesto: '2026-08-24',
      referenciaObra: 'NAS Reinheim QFC-003 KW33 2026',
      importePedido: 230,
      kw: 'KW33',
    });
    expect(rows[3]).toMatchObject({ numeroPedido: '2640168', referenciaObra: 'Reinheim QFC-001, 003 KW34 2026', importePedido: 1150, kw: 'KW34' });
    expect(rows[6]).toMatchObject({ numeroPedido: '2640178', numeroPresupuesto: '0026048505', importePedido: 12608.36, kw: '' });
  });

  it('parses the full-export shape: every field quoted, extra columns, "230.00 €", CRLF', () => {
    const text =
      'num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,cod_proveedor,proveedor,ref_proveedor,importe\r\n' +
      '"2640036","24/08/2026","0026048097","24/08/2026","41337","UMTELKOMD GMBH","NAS Reinheim QFC-003 KW33 2026","230.00 €"\r\n' +
      '"2639817","24/08/2026","0026047763","20/08/2026","41337","UMTELKOMD GMBH","QFF- 001, 002 KW31 2026","80.00 €"\r\n';
    expect(parseInsytePedidosCsv(text)).toEqual([
      { numeroPedido: '2640036', fechaPedido: '2026-08-24', numeroPresupuesto: '0026048097', fechaPresupuesto: '2026-08-24', referenciaObra: 'NAS Reinheim QFC-003 KW33 2026', importePedido: 230, kw: 'KW33' },
      { numeroPedido: '2639817', fechaPedido: '2026-08-24', numeroPresupuesto: '0026047763', fechaPresupuesto: '2026-08-20', referenciaObra: 'QFF- 001, 002 KW31 2026', importePedido: 80, kw: 'KW31' },
    ]);
  });

  it('handles escaped quotes, a thousands separator and returns nothing for empty input', () => {
    const text = 'num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,ref_proveedor,importe\n"2640001","01/02/2026","26048001","01/02/2026","Obra ""X""","1,234.50 €"\n';
    expect(parseInsytePedidosCsv(text)[0]).toMatchObject({ numeroPresupuesto: '0026048001', referenciaObra: 'Obra "X"', importePedido: 1234.5, fechaPedido: '2026-02-01' });
    expect(parseInsytePedidosCsv('')).toEqual([]);
    expect(parseInsytePedidosCsv(null)).toEqual([]);
  });

  it('skips rows without a pedido or presupuesto', () => {
    const text = 'num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,ref_proveedor,importe\n,,,,,\n2640001,01/02/2026,,01/02/2026,x,1.00 EUR\n';
    expect(parseInsytePedidosCsv(text)).toEqual([]);
  });
});

describe('real DATEV footers resolved through the Insyte export', () => {
  const pedidos = parseInsytePedidosCsv(SAMPLE);
  const byPedido = new Map(pedidos.map((row) => [row.numeroPedido, row]));

  it('2025-271 → pedido 2640178 → presupuesto 0026048505 with importePedido 12608.36', () => {
    const text = read('datev', 'extract_2025-271.txt');
    const [pedido] = parseDatevFooterPedidos(text);
    expect(pedido).toBe('2640178');
    expect(resolvePresupuestoForPedido(pedido, { pedidos, map: {}, receivables: [] })).toBe('0026048505');
    expect(byPedido.get(pedido).importePedido).toBe(12608.36);
    // Sanity: the Insyte net equals the PDF Summe.
    expect(parseDatevRechnungHeader(text).summe).toBe(12608.36);
  });

  it('2025-270 → six pedidos → their presupuestos, whose importes sum to the PDF Summe', () => {
    const text = read('datev', 'extract_2025-270.txt');
    const found = parseDatevFooterPedidos(text);
    expect(found.map((p) => resolvePresupuestoForPedido(p, { pedidos, map: {}, receivables: [] }))).toEqual([
      '0026048420', '0026048468', '0026048471', '0026048473', '0026048476', '0026048481',
    ]);
    const sum = found.reduce((total, p) => total + byPedido.get(p).importePedido, 0);
    expect(Math.round(sum * 100) / 100).toBe(4358);
    expect(parseDatevRechnungHeader(text).summe).toBe(4358);
  });
});
