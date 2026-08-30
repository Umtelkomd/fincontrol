/**
 * Insyte CxC contract — padding helpers and pedido → presupuesto resolution.
 *
 * The receivable PK is the 10-digit presupuesto. A DATEV Rechnung only names
 * pedidos (7 digits), so attaching one to its rows needs pedido → presupuesto.
 * That mapping is NEVER guessed: it comes from the loaded rows first and from
 * the documented seed map second, or it is null.
 */
import { describe, expect, it } from 'vitest';

import {
  INSYTE_PEDIDO_PRESUPUESTO_MAP,
  insyteSourceKey,
  padPedido,
  padPresupuesto,
  parseKw,
  resolvePresupuestoForPedido,
} from './insyteContract.js';

describe('pad helpers', () => {
  it('pads a presupuesto to 10 digits and strips non-digits', () => {
    expect(padPresupuesto('26048682')).toBe('0026048682');
    expect(padPresupuesto(26048682)).toBe('0026048682');
    expect(padPresupuesto('0026048682')).toBe('0026048682');
    expect(padPresupuesto('Nr. 26-048-682')).toBe('0026048682');
    expect(padPresupuesto('')).toBe('');
    expect(padPresupuesto(null)).toBe('');
  });

  it('keeps a pedido as bare digits without padding', () => {
    expect(padPedido('2640321')).toBe('2640321');
    expect(padPedido(' 2640321 ')).toBe('2640321');
    expect(padPedido('')).toBe('');
    expect(padPedido(undefined)).toBe('');
  });

  it('builds the sourceKey from the padded presupuesto', () => {
    expect(insyteSourceKey('26048682')).toBe('insyte:cxc:0026048682');
    expect(insyteSourceKey('')).toBe('');
  });

  it('parses the KW out of a referencia', () => {
    expect(parseKw('Roßdorf QFF-001 KW34 2026')).toBe('KW34');
    expect(parseKw('KW 7 obra')).toBe('KW7');
    expect(parseKw('sin semana')).toBe('');
  });
});

describe('INSYTE_PEDIDO_PRESUPUESTO_MAP — documented seed', () => {
  it('carries the pairs confirmed on 30.08.2026', () => {
    expect(INSYTE_PEDIDO_PRESUPUESTO_MAP).toMatchObject({
      2640321: '0026048682',
      2640322: '0026048686',
      2640070: '0026048420',
      2640164: '0026048468',
      2640165: '0026048471',
      2640168: '0026048473',
      2640169: '0026048476',
      2640170: '0026048481',
    });
  });

  it('only holds 10-digit presupuestos keyed by 7-digit pedidos', () => {
    Object.entries(INSYTE_PEDIDO_PRESUPUESTO_MAP).forEach(([pedido, presupuesto]) => {
      expect(pedido).toMatch(/^\d{7}$/);
      expect(presupuesto).toMatch(/^\d{10}$/);
    });
  });
});

describe('resolvePresupuestoForPedido', () => {
  const receivables = [
    { id: 'a', numeroPedido: '2640999', numeroPresupuesto: '0026049999' },
    { id: 'b', numeroPedido: '2640321', numeroPresupuesto: '0026040001' }, // disagrees with the map
    { id: 'c', numeroPedido: '', numeroPresupuesto: '0026048682' },
  ];

  it('prefers the loaded receivable whose numeroPedido matches', () => {
    expect(resolvePresupuestoForPedido('2640999', { receivables })).toBe('0026049999');
    expect(resolvePresupuestoForPedido('2640321', { receivables })).toBe('0026040001');
  });

  it('falls back to the map when no receivable carries the pedido', () => {
    expect(resolvePresupuestoForPedido('2640322', { receivables })).toBe('0026048686');
    expect(resolvePresupuestoForPedido('2640322', { map: { 2640322: '26040002' }, receivables: [] })).toBe('0026040002');
  });

  it('never guesses', () => {
    expect(resolvePresupuestoForPedido('2649999', { receivables })).toBeNull();
    expect(resolvePresupuestoForPedido('', { receivables })).toBeNull();
    expect(resolvePresupuestoForPedido(undefined, {})).toBeNull();
    expect(resolvePresupuestoForPedido('2640322', { map: {}, receivables: [] })).toBeNull();
  });

  it('normalises the pedido and the receivable pedido before comparing', () => {
    expect(resolvePresupuestoForPedido(' 2640999 ', { receivables })).toBe('0026049999');
    expect(resolvePresupuestoForPedido(2640999, { receivables })).toBe('0026049999');
  });
});

describe('resolvePresupuestoForPedido — parsed Insyte pedidos', () => {
  const pedidos = [{ numeroPedido: '2640321', numeroPresupuesto: '0026040009', importePedido: 1 }];

  it('ranks the parsed pedidos above the seed map, below loaded receivables', () => {
    expect(resolvePresupuestoForPedido('2640321', { pedidos, receivables: [] })).toBe('0026040009');
    expect(resolvePresupuestoForPedido('2640321', { pedidos, receivables: [{ numeroPedido: '2640321', numeroPresupuesto: '0026040001' }] })).toBe('0026040001');
    expect(resolvePresupuestoForPedido('2640322', { pedidos, receivables: [] })).toBe('0026048686'); // seed map still works
  });
});
