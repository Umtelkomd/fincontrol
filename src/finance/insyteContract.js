/**
 * Insyte Delegaciones ↔ FinControl CxC (2026+).
 * PK = numero_presupuesto (Num. Doc. padded to 10). Pedido is nullable.
 * Do not reuse Lumen sourceKey / lumen* fields.
 */

export const INSYTE_SOURCE_SYSTEM = 'insyte';
export const INSYTE_PROVEEDOR_SAP = '0000041337';

export function padPresupuesto(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(10, '0');
}

export function padPedido(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits;
}

export function insyteSourceKey(numeroPresupuesto) {
  const id = padPresupuesto(numeroPresupuesto);
  return id ? `insyte:cxc:${id}` : '';
}

export function parseKw(ref = '') {
  const m = String(ref).match(/KW\s*(\d{1,2})/i);
  return m ? `KW${m[1]}` : '';
}

/** Open Insyte presupuestos without pedido (cut 24.08.2026). Include in CxC. */
export const INSYTE_OPEN_SIN_PEDIDO = [
  { numero_presupuesto: '0026048505', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'M26-14 Rossdorf', kw: '', tipo_obra: 'M26', obra_pueblo: 'Roßdorf', estado_insyte: 'T', importe_presupuesto: 12608.36, pep: 'PD-004-06-73-0014' },
  { numero_presupuesto: '0026048476', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'Roßdorf QFF-001, 002 KW34 2026', kw: 'KW34', tipo_obra: 'QFF', obra_pueblo: 'Roßdorf', estado_insyte: 'T', importe_presupuesto: 2208.00, pep: 'PD-004-06-73-0045' },
  { numero_presupuesto: '0026048473', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'Reinheim QFC-001, 003 KW34 2026', kw: 'KW34', tipo_obra: 'QFC', obra_pueblo: 'Reinheim', estado_insyte: 'T', importe_presupuesto: 1150.00, pep: 'PD-004-06-73-0048' },
  { numero_presupuesto: '0026048468', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'Groß-Zimmern QGF-002 KW34 2026', kw: 'KW34', tipo_obra: 'QGF', obra_pueblo: 'Groß-Zimmern', estado_insyte: 'T', importe_presupuesto: 460.00, pep: 'PD-004-06-73-0046' },
  { numero_presupuesto: '0026048471', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'NAS Reinheim QFC-003 KW34 2026', kw: 'KW34', tipo_obra: 'NAS', obra_pueblo: 'Reinheim', estado_insyte: 'T', importe_presupuesto: 230.00, pep: 'PD-004-06-73-0033' },
  { numero_presupuesto: '0026048481', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'Roßdorf QFF-001, 002 KW34 2026', kw: 'KW34', tipo_obra: 'HAS2', obra_pueblo: 'Roßdorf', estado_insyte: 'X', importe_presupuesto: 80.00, pep: 'PD-004-06-73-0045' },
  { numero_presupuesto: '0025037088', numero_pedido: '', fecha_presupuesto: '2025-07-09', referencia_obra: 'Meschede QDU002_KW25_2025_Aktivieru', kw: 'KW25', tipo_obra: 'QDU', obra_pueblo: 'Meschede', estado_insyte: 'X', importe_presupuesto: 120.00, pep: 'PD-004-06-73-0024' },
  { numero_presupuesto: '0026048420', numero_pedido: '', fecha_presupuesto: '2026-08-24', referencia_obra: 'NAS Reinheim QFC-003 KW33 2026', kw: 'KW33', tipo_obra: 'NAS', obra_pueblo: 'Reinheim', estado_insyte: 'O', importe_presupuesto: 230.00, pep: 'PD-004-06-73-0033' },
];
