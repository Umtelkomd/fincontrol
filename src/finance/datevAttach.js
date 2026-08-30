/**
 * Plan how a DATEV `Rechnung 2025-NNN` attaches to its Insyte CxC rows.
 *
 * Pure. The write path (`attachDatevRechnungToInsyte` in useReceivables)
 * applies exactly this plan and nothing more:
 *
 *   attach     rows that get `rechnungId` + `numeroPedido` stamped
 *   missing    pedidos with no landing spot (unresolved / no row / closed)
 *   conflicts  rows already carrying a DIFFERENT rechnungId — never restamped
 *   aggregateRowsToDelete
 *              the "one row per DATEV" documents an older script created for
 *              this Rechnung (invoiceNumber/documentNumber === rechnungId and
 *              no `insyte:` sourceKey). Insyte rows are never in this list.
 *
 * Amounts are NOT part of the plan. `pdfNet`/`pdfGross` travel as metadata
 * only; the receivable amount stays the Insyte net.
 */
import { padPedido, padPresupuesto, resolvePresupuestoForPedido } from './insyteContract.js';

export const DATEV_RECHNUNG_ID = /^\d{4}-\d{3}$/;

const isInsyteRow = (row) => String(row?.sourceKey || '').startsWith('insyte:');

const isAggregateFor = (row, rechnungId) =>
  !isInsyteRow(row) &&
  (String(row?.invoiceNumber || '') === rechnungId || String(row?.documentNumber || '') === rechnungId);

/**
 * @param {{
 *   rechnungId: string,
 *   pedidos: string[],
 *   receivables: object[],
 *   map?: Record<string,string>,
 *   pedidoRows?: object[],   parsed Insyte pedidos (insytePedidosCsv.js), ranked before `map`
 *   pdfNet?: number|null,
 *   pdfGross?: number|null,
 * }} params
 */
export const planDatevAttach = ({ rechnungId, pedidos, receivables, map, pedidoRows, pdfNet = null, pdfGross = null }) => {
  const id = String(rechnungId || '').trim();
  if (!DATEV_RECHNUNG_ID.test(id)) return { error: `rechnungId inválido: "${rechnungId}" (esperado 2025-NNN)` };

  const wanted = [...new Set((Array.isArray(pedidos) ? pedidos : []).map(padPedido).filter(Boolean))];
  if (wanted.length === 0) return { error: 'Sin pedidos en el pie de la Rechnung' };

  const rows = Array.isArray(receivables) ? receivables : [];
  const resolverOptions = { receivables: rows, pedidos: Array.isArray(pedidoRows) ? pedidoRows : [] };
  if (map) resolverOptions.map = map;

  const attach = [];
  const missing = [];
  const conflicts = [];

  for (const numeroPedido of wanted) {
    const numeroPresupuesto = resolvePresupuestoForPedido(numeroPedido, resolverOptions);
    if (!numeroPresupuesto) {
      missing.push({ numeroPedido, numeroPresupuesto: null, reason: 'unresolved' });
      continue;
    }

    const row = rows.find(
      (entry) => isInsyteRow(entry) && padPresupuesto(entry.numeroPresupuesto) === numeroPresupuesto,
    );
    if (!row) {
      missing.push({ numeroPedido, numeroPresupuesto, reason: 'no-row' });
      continue;
    }
    if (row.status === 'settled' || row.status === 'cancelled') {
      missing.push({ numeroPedido, numeroPresupuesto, reason: row.status });
      continue;
    }
    const current = String(row.rechnungId || '');
    if (current && current !== id) {
      conflicts.push({ receivableId: row.id, numeroPresupuesto, numeroPedido, rechnungId: current });
      continue;
    }
    attach.push({ receivableId: row.id, numeroPresupuesto, numeroPedido });
  }

  const aggregateRowsToDelete = rows.filter((row) => isAggregateFor(row, id)).map((row) => row.id);

  return { rechnungId: id, pdfNet, pdfGross, attach, missing, conflicts, aggregateRowsToDelete };
};
