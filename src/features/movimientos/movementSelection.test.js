import { describe, expect, it } from 'vitest';

import {
  isSelectableMovement,
  pageSelectionState,
  pruneSelection,
  selectableMovementIds,
  setPageSelection,
  toggleMovementSelection,
} from './movementSelection.js';

describe('toggleMovementSelection', () => {
  it('adds an unselected id', () => {
    expect(toggleMovementSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an already selected id', () => {
    expect(toggleMovementSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('never duplicates an id', () => {
    expect(toggleMovementSelection(['a', 'a'], 'b')).toEqual(['a', 'b']);
  });

  it('ignores a blank id and tolerates a missing list', () => {
    expect(toggleMovementSelection(['a'], '')).toEqual(['a']);
    expect(toggleMovementSelection(null, 'a')).toEqual(['a']);
  });

  it('returns a new array instead of mutating the input', () => {
    const selected = ['a'];
    expect(toggleMovementSelection(selected, 'b')).not.toBe(selected);
    expect(selected).toEqual(['a']);
  });
});

describe('setPageSelection', () => {
  it('adds every id on the page while keeping off-page selections', () => {
    expect(setPageSelection(['z'], ['a', 'b'], true)).toEqual(['z', 'a', 'b']);
  });

  it('removes every id on the page while keeping off-page selections', () => {
    expect(setPageSelection(['z', 'a', 'b'], ['a', 'b'], false)).toEqual(['z']);
  });

  it('is idempotent when the page is already selected', () => {
    expect(setPageSelection(['a', 'b'], ['a', 'b'], true)).toEqual(['a', 'b']);
  });

  it('tolerates missing inputs', () => {
    expect(setPageSelection(null, null, true)).toEqual([]);
  });
});

describe('pageSelectionState', () => {
  it('reports none when nothing on the page is selected', () => {
    expect(pageSelectionState(['z'], ['a', 'b'])).toBe('none');
  });

  it('reports partial when only some rows are selected', () => {
    expect(pageSelectionState(['a'], ['a', 'b'])).toBe('partial');
  });

  it('reports all when every row on the page is selected', () => {
    expect(pageSelectionState(['a', 'b', 'z'], ['a', 'b'])).toBe('all');
  });

  it('reports none for an empty page', () => {
    expect(pageSelectionState(['a'], [])).toBe('none');
  });
});

/**
 * A void movement is cancelled: the row's "Editar" button is disabled for it,
 * so a bulk write must not reach it either. Filtering the table to "Anulados"
 * and hitting select-all used to write classification onto cancelled rows.
 */
describe('isSelectableMovement', () => {
  it('rejects a void movement', () => {
    expect(isSelectableMovement({ id: 'a', status: 'void' })).toBe(false);
  });

  it('accepts every other status', () => {
    expect(isSelectableMovement({ id: 'a', status: 'posted' })).toBe(true);
    expect(isSelectableMovement({ id: 'a' })).toBe(true);
  });

  it('rejects a missing movement', () => {
    expect(isSelectableMovement(null)).toBe(false);
    expect(isSelectableMovement(undefined)).toBe(false);
  });
});

describe('selectableMovementIds', () => {
  it('drops void movements from the selectable set', () => {
    const movements = [
      { id: 'a', status: 'posted' },
      { id: 'b', status: 'void' },
      { id: 'c' },
    ];

    expect(selectableMovementIds(movements)).toEqual(['a', 'c']);
  });

  it('drops movements without an id', () => {
    expect(selectableMovementIds([{ status: 'posted' }, { id: '', status: 'posted' }])).toEqual([]);
  });

  it('returns ids as strings and tolerates a missing list', () => {
    expect(selectableMovementIds([{ id: 7 }])).toEqual(['7']);
    expect(selectableMovementIds(null)).toEqual([]);
  });

  it('keeps a bulk write off cancelled rows even when they were selected first', () => {
    const movements = [
      { id: 'a', status: 'posted' },
      { id: 'b', status: 'void' },
    ];

    expect(pruneSelection(['a', 'b'], selectableMovementIds(movements))).toEqual(['a']);
  });

  it('leaves cancelled rows out of a select-all-on-page', () => {
    const pageRows = [
      { id: 'a', status: 'void' },
      { id: 'b', status: 'posted' },
    ];

    expect(setPageSelection([], selectableMovementIds(pageRows), true)).toEqual(['b']);
  });

  it('reports a fully-void page as nothing to select', () => {
    const pageRows = [{ id: 'a', status: 'void' }, { id: 'b', status: 'void' }];

    expect(pageSelectionState([], selectableMovementIds(pageRows))).toBe('none');
    expect(setPageSelection(['z'], selectableMovementIds(pageRows), true)).toEqual(['z']);
  });
});

describe('pruneSelection', () => {
  it('drops ids that are no longer visible after a filter change', () => {
    expect(pruneSelection(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('keeps the original order of the surviving ids', () => {
    expect(pruneSelection(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a']);
  });

  it('returns an empty selection when nothing is visible', () => {
    expect(pruneSelection(['a'], [])).toEqual([]);
    expect(pruneSelection(null, ['a'])).toEqual([]);
  });
});
