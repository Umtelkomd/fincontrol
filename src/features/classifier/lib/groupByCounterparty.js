/**
 * groupByCounterparty — the "Sin obra" tab's unit of work.
 *
 * Fifteen fuel receipts from the same station are one decision, not fifteen:
 * the operator picks the obra once and assigns the whole group. Groups are
 * ranked by the money they carry so the biggest unattributed cost is on top.
 *
 * Pure module — no React, no Firebase.
 */

const UNNAMED = 'Sin contraparte';

const normalize = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');

const round = (value) => Math.round(value * 100) / 100;

const byDateDesc = (left, right) =>
  String(right.postedDate || '').localeCompare(String(left.postedDate || ''));

/**
 * @param {object[]} movements
 * @returns {Array<{ key: string, counterparty: string, movements: object[], ids: string[], count: number, total: number }>}
 *   `total` is the sum of magnitudes; `movements` newest first.
 */
export const groupByCounterparty = (movements) => {
  const groups = new Map();

  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    if (!movement) return;
    const display = normalize(movement.counterpartyName) || UNNAMED;
    const key = display.toLowerCase();
    const held = groups.get(key) || { key, counterparty: display, movements: [], total: 0 };
    held.movements.push(movement);
    held.total += Math.abs(Number(movement.amount) || 0);
    groups.set(key, held);
  });

  return Array.from(groups.values())
    .map((group) => {
      const sorted = [...group.movements].sort(byDateDesc);
      return {
        ...group,
        movements: sorted,
        ids: sorted.map((entry) => entry.id),
        count: sorted.length,
        total: round(group.total),
      };
    })
    .sort(
      (left, right) =>
        right.total - left.total || left.counterparty.localeCompare(right.counterparty, 'es'),
    );
};

export default groupByCounterparty;
