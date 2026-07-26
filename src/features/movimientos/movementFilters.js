/**
 * Movement filters — the predicate behind the Movimientos table.
 *
 * Extracted from the view so the "Sin clasificar" rule is testable and can
 * share `isClassified` with the classifier inbox. The previous inline check
 * (`categoryName || costCenterId || projectId`) counted a movement carrying
 * only a cost center as done, which is why the ledger looked healthier than
 * it was.
 */

import { isClassified } from '../../finance/costScope.js';

export const DEFAULT_MOVEMENT_FILTERS = {
  year: 'all',
  month: 'all',
  direction: 'all',
  statusFilter: 'all',
  searchQuery: '',
};

const isReconciled = (movement) => Boolean(movement?.receivableId || movement?.payableId);

const matchesSearch = (movement, query) => {
  if (!query) return true;
  const haystack = [
    movement.description,
    movement.counterpartyName,
    movement.categoryName,
    movement.projectName,
    String(movement.amount || ''),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
};

const matchesStatus = (movement, statusFilter) => {
  const isVoid = movement.status === 'void';
  if (statusFilter === 'void') return isVoid;
  if (isVoid) return false;
  if (statusFilter === 'classified') return isClassified(movement);
  if (statusFilter === 'unclassified') return !isClassified(movement);
  if (statusFilter === 'reconciled') return isReconciled(movement);
  return true;
};

/**
 * filterMovements — apply the filter bar and sort by posted date descending.
 * Returns a new array; the source is never mutated.
 */
export const filterMovements = (movements, filters) => {
  const { year, month, direction, statusFilter, searchQuery } = {
    ...DEFAULT_MOVEMENT_FILTERS,
    ...(filters || {}),
  };
  const query = (searchQuery || '').trim().toLowerCase();
  const paddedMonth = month === 'all' ? null : String(month).padStart(2, '0');

  return (Array.isArray(movements) ? movements : [])
    .filter((movement) => {
      if (!movement) return false;
      if (year !== 'all' && !(movement.postedDate || '').startsWith(year)) return false;
      if (paddedMonth && (movement.postedDate || '').slice(5, 7) !== paddedMonth) return false;
      if (direction !== 'all' && movement.direction !== direction) return false;
      if (!matchesStatus(movement, statusFilter)) return false;
      return matchesSearch(movement, query);
    })
    .sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));
};
