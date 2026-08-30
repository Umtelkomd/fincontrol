/**
 * Insyte purchase-order export ("pedidos de compra") → normalised rows.
 *
 * Two shapes exist: the full export (every field quoted, extra columns
 * cod_proveedor/proveedor, importe `"230.00 €"`) and the small subset
 * (unquoted, importe `230.00 EUR`). Both are header-driven, so column order
 * and extra columns do not matter. Dates are dd/mm/yyyy → ISO. The importe is
 * the Insyte NET of the pedido and is what a CxC row is worth.
 */
import { padPedido, padPresupuesto, parseKw } from './insyteContract.js';

/** RFC-4180-ish line splitter: quoted fields, doubled quotes, CRLF. */
export const parseCsvRecords = (text) => {
  const source = String(text ?? '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  return records.filter((entry) => entry.some((value) => String(value).trim() !== ''));
};

const toIsoDate = (raw) => {
  const match = String(raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return String(raw ?? '').trim();
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
};

/** `"230.00 €"`, `230.00 EUR`, `1,234.50 €` → 230 / 1234.5; null when absent. */
const toImporte = (raw) => {
  const digits = String(raw ?? '').replace(/[^\d.,-]/g, '');
  if (!digits) return null;
  // Insyte exports with a dot decimal; a comma can only be a thousands separator here.
  const value = Number(digits.replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};

/**
 * @param {string} text CSV export
 * @returns {Array<{ numeroPedido: string, fechaPedido: string, numeroPresupuesto: string, fechaPresupuesto: string, referenciaObra: string, importePedido: number|null, kw: string }>}
 */
export const parseInsytePedidosCsv = (text) => {
  const records = parseCsvRecords(text);
  if (records.length < 2) return [];
  const header = records[0].map((name) => String(name).trim().toLowerCase());
  const column = (name) => header.indexOf(name);
  const at = (record, name) => {
    const index = column(name);
    return index >= 0 ? String(record[index] ?? '').trim() : '';
  };

  return records
    .slice(1)
    .map((record) => {
      const referenciaObra = at(record, 'ref_proveedor');
      return {
        numeroPedido: padPedido(at(record, 'num_doc')),
        fechaPedido: toIsoDate(at(record, 'fecha_pedido')),
        numeroPresupuesto: padPresupuesto(at(record, 'codigo_presupuesto')),
        fechaPresupuesto: toIsoDate(at(record, 'fecha_presupuesto')),
        referenciaObra,
        importePedido: toImporte(at(record, 'importe')),
        kw: parseKw(referenciaObra),
      };
    })
    .filter((row) => row.numeroPedido && row.numeroPresupuesto);
};
