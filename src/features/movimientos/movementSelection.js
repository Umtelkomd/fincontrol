/**
 * Movement selection — pure reducers behind the bulk-assign checkboxes.
 *
 * Selection is an array of movement ids (not a Set) so React state comparison
 * stays trivial and the value can be logged as-is. Every function returns a
 * new array; none of them mutate their input.
 */

const toIdList = (value) => (Array.isArray(value) ? value.filter(Boolean).map(String) : []);

const unique = (ids) => [...new Set(ids)];

/**
 * isSelectableMovement — may a bulk write target this row?
 *
 * A void movement is cancelled: the row's "Editar" action is disabled for it,
 * and classification data written onto a cancelled movement is invisible in
 * every report that skips voids. Filtering to "Anulados" and hitting
 * select-all must therefore select nothing.
 */
export const isSelectableMovement = (movement) =>
  Boolean(movement) && movement.status !== 'void';

/**
 * selectableMovementIds — the ids a bulk write is allowed to touch.
 *
 * Feed BOTH the page checkbox and `pruneSelection` from this list: the
 * cancelled-row invariant then holds at the selection layer, whatever the UI
 * renders and whatever was selected before a row got voided.
 */
export const selectableMovementIds = (movements) =>
  (Array.isArray(movements) ? movements : [])
    .filter(isSelectableMovement)
    .map((movement) => String(movement.id ?? ''))
    .filter(Boolean);

/** toggleMovementSelection — add the id if missing, drop it if present. */
export const toggleMovementSelection = (selectedIds, id) => {
  const current = unique(toIdList(selectedIds));
  if (!id) return current;
  const key = String(id);
  return current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
};

/**
 * setPageSelection — select or clear every row of the current page while
 * leaving selections made on other pages untouched.
 */
export const setPageSelection = (selectedIds, pageIds, selected) => {
  const current = unique(toIdList(selectedIds));
  const page = unique(toIdList(pageIds));
  if (page.length === 0) return current;
  if (!selected) return current.filter((entry) => !page.includes(entry));
  return unique([...current, ...page]);
};

/** pageSelectionState — drives the header checkbox: none / partial / all. */
export const pageSelectionState = (selectedIds, pageIds) => {
  const current = new Set(toIdList(selectedIds));
  const page = unique(toIdList(pageIds));
  if (page.length === 0) return 'none';
  const hits = page.filter((entry) => current.has(entry)).length;
  if (hits === 0) return 'none';
  return hits === page.length ? 'all' : 'partial';
};

/**
 * pruneSelection — drop ids that fell out of the visible set.
 *
 * Without this a filter change would keep invisible rows selected and a bulk
 * write would hit movements the user can no longer see.
 */
export const pruneSelection = (selectedIds, visibleIds) => {
  const visible = new Set(toIdList(visibleIds));
  return unique(toIdList(selectedIds)).filter((entry) => visible.has(entry));
};
