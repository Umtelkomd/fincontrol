import { describe, expect, it } from 'vitest';

import {
  buildBulkClassificationPayload,
  buildBulkValidationTarget,
  formatBulkResult,
  movementDestinationLabel,
  resolveProjectName,
  summarizeBulkImpact,
} from './bulkClassification.js';

const PROJECTS = [
  { id: 'p1', nombre: 'Obra Stralsund' },
  { id: 'p2', name: 'Obra Rostock' },
  { id: 'p3', codigo: 'NE-003' },
];

describe('resolveProjectName', () => {
  it('prefers the Spanish name field, then the English one, then the code', () => {
    expect(resolveProjectName(PROJECTS, 'p1')).toBe('Obra Stralsund');
    expect(resolveProjectName(PROJECTS, 'p2')).toBe('Obra Rostock');
    expect(resolveProjectName(PROJECTS, 'p3')).toBe('NE-003');
  });

  it('falls back to the id when the project is unknown', () => {
    expect(resolveProjectName(PROJECTS, 'ghost')).toBe('ghost');
  });

  it('returns an empty string without a project id', () => {
    expect(resolveProjectName(PROJECTS, '')).toBe('');
    expect(resolveProjectName(null, null)).toBe('');
  });
});

/**
 * `bulkClassify` writes only the keys it receives, so every field the user
 * leaves blank must be absent from the payload — otherwise a bulk edit meant
 * to set a category would silently wipe the cost center of 200 movements.
 */
describe('buildBulkClassificationPayload', () => {
  it('omits every field the user left blank', () => {
    const payload = buildBulkClassificationPayload(
      { categoryName: 'Impuestos', costCenterId: '', costScope: '', projectId: '' },
      PROJECTS,
    );

    expect(payload).toEqual({ categoryName: 'Impuestos' });
  });

  it('returns an empty payload when nothing was filled in', () => {
    expect(buildBulkClassificationPayload({}, PROJECTS)).toEqual({});
    expect(buildBulkClassificationPayload(null, PROJECTS)).toEqual({});
  });

  it('trims the category and keeps the cost center', () => {
    expect(
      buildBulkClassificationPayload({ categoryName: '  Combustible  ', costCenterId: 'CC-1' }, PROJECTS),
    ).toEqual({ categoryName: 'Combustible', costCenterId: 'CC-1' });
  });

  it('carries the project and its resolved name for site work', () => {
    expect(
      buildBulkClassificationPayload({ costScope: 'project', projectId: 'p1' }, PROJECTS),
    ).toEqual({ costScope: 'project', projectId: 'p1', projectName: 'Obra Stralsund' });
  });

  it('clears the project when the destination is structure', () => {
    expect(
      buildBulkClassificationPayload({ costScope: 'overhead', projectId: 'p1' }, PROJECTS),
    ).toEqual({ costScope: 'overhead', projectId: '', projectName: '' });
  });

  it('ignores an unsupported cost scope', () => {
    expect(buildBulkClassificationPayload({ costScope: 'nonsense' }, PROJECTS)).toEqual({});
  });

  it('still assigns a project when no destination was chosen', () => {
    expect(buildBulkClassificationPayload({ projectId: 'p2' }, PROJECTS)).toEqual({
      projectId: 'p2',
      projectName: 'Obra Rostock',
    });
  });

  it('does not carry a project id when the destination is site work but none was picked', () => {
    expect(buildBulkClassificationPayload({ costScope: 'project', projectId: '' }, PROJECTS)).toEqual({
      costScope: 'project',
    });
  });
});

/**
 * A bulk write is unrecoverable from inside the app, so the confirmation step
 * has to say how many movements it touches AND how many of those already carry
 * a classification it would replace. The second number is the dangerous one:
 * filling blanks is cheap, overwriting reviewed history is not.
 */
describe('summarizeBulkImpact', () => {
  it('counts the whole selection as affected', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { categoryName: 'Impuestos' },
    );

    expect(impact.total).toBe(3);
  });

  it('counts no overwrite when the fields being written are all empty', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a' }, { id: 'b', categoryName: '   ' }],
      { categoryName: 'Impuestos', costCenterId: 'CC-1' },
    );

    expect(impact.overwrites).toBe(0);
  });

  it('counts a movement whose category would be replaced', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', categoryName: 'Combustible' }, { id: 'b' }],
      { categoryName: 'Impuestos' },
    );

    expect(impact).toEqual({ total: 2, overwrites: 1 });
  });

  it('does not count a movement that already holds exactly that value', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', categoryName: 'Impuestos', costCenterId: 'CC-1' }],
      { categoryName: 'Impuestos', costCenterId: 'CC-1' },
    );

    expect(impact.overwrites).toBe(0);
  });

  it('counts a project that a structural assignment would clear', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', projectId: 'p1', projectName: 'Obra Stralsund' }],
      { costScope: 'overhead', projectId: '', projectName: '' },
    );

    expect(impact.overwrites).toBe(1);
  });

  it('counts a stored destination that would flip', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', costScope: 'overhead' }],
      { costScope: 'project', projectId: 'p1', projectName: 'Obra Stralsund' },
    );

    expect(impact.overwrites).toBe(1);
  });

  it('counts a legacy destination that was only derived, never stored', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', projectName: 'Overhead' }, { id: 'b', projectId: 'p1', projectName: 'Obra' }],
      { costScope: 'overhead' },
    );

    // 'Overhead' already resolves to structure; the site-work row does not.
    expect(impact.overwrites).toBe(1);
  });

  it('counts a movement only once however many fields it would lose', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', categoryName: 'Combustible', costCenterId: 'CC-9', projectId: 'p9', projectName: 'Vieja' }],
      { categoryName: 'Impuestos', costCenterId: 'CC-1', projectId: 'p1', projectName: 'Obra Stralsund' },
    );

    expect(impact).toEqual({ total: 1, overwrites: 1 });
  });

  it('ignores fields the payload does not write', () => {
    const impact = summarizeBulkImpact(
      [{ id: 'a', costCenterId: 'CC-9', projectId: 'p9', projectName: 'Vieja' }],
      { categoryName: 'Impuestos' },
    );

    expect(impact.overwrites).toBe(0);
  });

  it('tolerates a missing selection, payload or movement', () => {
    expect(summarizeBulkImpact(null, null)).toEqual({ total: 0, overwrites: 0 });
    expect(summarizeBulkImpact([null], { categoryName: 'Impuestos' }))
      .toEqual({ total: 1, overwrites: 0 });
  });
});

/**
 * The bulk form validates through `validateClassification`, which needs a
 * movement to know whether a destination is mandatory. A mixed selection is
 * represented by its strictest member: one outflow makes the rule apply.
 */
describe('buildBulkValidationTarget', () => {
  it('is outbound when at least one selected movement is an outflow', () => {
    expect(buildBulkValidationTarget([{ direction: 'in' }, { direction: 'out' }])).toEqual({
      direction: 'out',
    });
  });

  it('is inbound when every selected movement is an inflow', () => {
    expect(buildBulkValidationTarget([{ direction: 'in' }, { direction: 'in' }])).toEqual({
      direction: 'in',
    });
  });

  it('is inbound for an empty or missing selection', () => {
    expect(buildBulkValidationTarget([])).toEqual({ direction: 'in' });
    expect(buildBulkValidationTarget(null)).toEqual({ direction: 'in' });
  });
});

describe('movementDestinationLabel', () => {
  it('labels site work and structure', () => {
    expect(movementDestinationLabel({ costScope: 'project' })).toBe('Obra');
    expect(movementDestinationLabel({ costScope: 'overhead' })).toBe('Estructura');
  });

  it('derives the label from legacy documents', () => {
    expect(movementDestinationLabel({ projectId: 'p1' })).toBe('Obra');
    expect(movementDestinationLabel({ projectName: 'Overhead' })).toBe('Estructura');
  });

  it('shows a dash when the destination is unknown', () => {
    expect(movementDestinationLabel({})).toBe('—');
    expect(movementDestinationLabel(null)).toBe('—');
  });
});

describe('formatBulkResult', () => {
  it('reports a clean run as a success', () => {
    expect(formatBulkResult({ success: true, updated: 12, failed: 0 })).toEqual({
      message: '12 movimiento(s) clasificados',
      tone: 'success',
    });
  });

  /**
   * `bulkClassify` chunks its writes and reports `success: false` as soon as
   * one chunk fails, so a partial run arrives with counts on BOTH sides. The
   * operator needs the counts, not the raw Firestore error.
   */
  it('warns with both counts when part of the batch failed', () => {
    expect(formatBulkResult({ success: false, updated: 10, failed: 2, error: new Error('boom') })).toEqual({
      message: '10 movimiento(s) clasificados · 2 con error',
      tone: 'warning',
    });
  });

  it('surfaces the error message when nothing was written', () => {
    expect(formatBulkResult({ success: false, updated: 0, failed: 3, error: new Error('boom') })).toEqual({
      message: 'boom',
      tone: 'error',
    });
  });

  it('falls back to a generic error message', () => {
    expect(formatBulkResult(null)).toEqual({
      message: 'No se pudo clasificar la selección',
      tone: 'error',
    });
  });
});
