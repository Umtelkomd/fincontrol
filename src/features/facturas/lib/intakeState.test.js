import { describe, expect, it } from 'vitest';
import { createInitialIntakeState, intakeReducer } from './intakeState';

describe('createInitialIntakeState', () => {
  it('starts on the choose step with ordinary/incoming defaults and an empty form', () => {
    const state = createInitialIntakeState();
    expect(state.step).toBe('choose');
    expect(state.direction).toBe('incoming');
    expect(state.sourceSystem).toBe('ordinary');
    expect(state.linkMode).toBe('create-ordinary');
    expect(state.selectedCandidateIds).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.file).toBeNull();
    expect(state.form).toEqual({
      counterpartyName: '',
      invoiceNumber: '',
      issueDate: '',
      netAmount: '',
      taxAmount: '',
      grossAmount: '',
    });
  });
});

describe('intakeReducer', () => {
  it('SELECT_DIRECTION switches direction and resets an insyte source back to ordinary for incoming', () => {
    const withInsyte = intakeReducer(createInitialIntakeState(), { type: 'SELECT_SOURCE_SYSTEM', sourceSystem: 'insyte' });
    // insyte is outgoing-only; select outgoing first so the source sticks.
    const outgoing = intakeReducer(
      { ...withInsyte, direction: 'outgoing' },
      { type: 'SELECT_DIRECTION', direction: 'incoming' },
    );
    expect(outgoing.direction).toBe('incoming');
    expect(outgoing.sourceSystem).toBe('ordinary');
  });

  it('SELECT_DIRECTION to outgoing keeps an already-chosen ordinary source untouched', () => {
    const state = intakeReducer(createInitialIntakeState(), { type: 'SELECT_DIRECTION', direction: 'outgoing' });
    expect(state.direction).toBe('outgoing');
    expect(state.sourceSystem).toBe('ordinary');
  });

  it('SELECT_DIRECTION clears any selected candidates — the pool belongs to the other family', () => {
    const state = intakeReducer(
      { ...createInitialIntakeState(), linkMode: 'attach-existing', selectedCandidateIds: ['a', 'b'] },
      { type: 'SELECT_DIRECTION', direction: 'outgoing' },
    );
    expect(state.selectedCandidateIds).toEqual([]);
  });

  it('SELECT_SOURCE_SYSTEM to insyte forces attach-existing and clears any selected candidates', () => {
    const state = intakeReducer(
      { ...createInitialIntakeState(), selectedCandidateIds: ['a', 'b'] },
      { type: 'SELECT_SOURCE_SYSTEM', sourceSystem: 'insyte' },
    );
    expect(state.sourceSystem).toBe('insyte');
    expect(state.linkMode).toBe('attach-existing');
    expect(state.selectedCandidateIds).toEqual([]);
  });

  it('FILE_PICKED moves to extracting and clears any previous error', () => {
    const state = intakeReducer(
      { ...createInitialIntakeState(), error: 'oops' },
      { type: 'FILE_PICKED' },
    );
    expect(state.step).toBe('extracting');
    expect(state.error).toBeNull();
  });

  it('EXTRACTION_SUCCEEDED stores the file descriptor, prefills the form from suggestions, and moves to confirm', () => {
    const state = intakeReducer(createInitialIntakeState(), {
      type: 'EXTRACTION_SUCCEEDED',
      payload: {
        hash: 'abc123',
        sizeBytes: 42,
        originalName: 'x.pdf',
        bytes: new ArrayBuffer(0),
        evidenceLines: ['line 1', 'line 2'],
        suggestions: {
          invoiceNumber: { value: 'RE-1', line: 'line 1' },
          issueDate: { value: '2026-01-05', line: 'line 1' },
          grossAmount: { value: 119, line: 'line 2' },
          netAmount: { value: 100, line: 'line 2' },
          taxAmount: { value: 19, line: 'line 2' },
          counterpartyName: null,
        },
      },
    });
    expect(state.step).toBe('confirm');
    expect(state.file).toEqual({ hash: 'abc123', sizeBytes: 42, originalName: 'x.pdf', bytes: expect.any(ArrayBuffer) });
    expect(state.evidenceLines).toEqual(['line 1', 'line 2']);
    expect(state.form).toEqual({
      counterpartyName: '',
      invoiceNumber: 'RE-1',
      issueDate: '2026-01-05',
      netAmount: 100,
      taxAmount: 19,
      grossAmount: 119,
    });
  });

  it('EXTRACTION_FAILED moves to the error step with the given message', () => {
    const state = intakeReducer(createInitialIntakeState(), { type: 'EXTRACTION_FAILED', message: 'boom' });
    expect(state.step).toBe('error');
    expect(state.error).toBe('boom');
  });

  it('RETRY returns from error to choose and clears the file and error', () => {
    const errored = intakeReducer(createInitialIntakeState(), { type: 'EXTRACTION_FAILED', message: 'boom' });
    const retried = intakeReducer(errored, { type: 'RETRY' });
    expect(retried.step).toBe('choose');
    expect(retried.error).toBeNull();
    expect(retried.file).toBeNull();
  });

  it('FIELD_CHANGED updates only the targeted form field', () => {
    const state = intakeReducer(createInitialIntakeState(), {
      type: 'FIELD_CHANGED',
      field: 'invoiceNumber',
      value: 'RE-9',
    });
    expect(state.form.invoiceNumber).toBe('RE-9');
    expect(state.form.counterpartyName).toBe('');
  });

  it('TOGGLE_CANDIDATE adds then removes an id', () => {
    const added = intakeReducer(createInitialIntakeState(), { type: 'TOGGLE_CANDIDATE', id: 'row-1' });
    expect(added.selectedCandidateIds).toEqual(['row-1']);
    const removed = intakeReducer(added, { type: 'TOGGLE_CANDIDATE', id: 'row-1' });
    expect(removed.selectedCandidateIds).toEqual([]);
  });

  it('SET_LINK_MODE to create-ordinary clears any selected candidates', () => {
    const state = intakeReducer(
      { ...createInitialIntakeState(), linkMode: 'attach-existing', selectedCandidateIds: ['x'] },
      { type: 'SET_LINK_MODE', linkMode: 'create-ordinary' },
    );
    expect(state.linkMode).toBe('create-ordinary');
    expect(state.selectedCandidateIds).toEqual([]);
  });

  it('walks SUBMIT_STARTED -> SUBMIT_SUCCEEDED to done with the resulting sha256', () => {
    const saving = intakeReducer(createInitialIntakeState(), { type: 'SUBMIT_STARTED' });
    expect(saving.step).toBe('saving');
    const done = intakeReducer(saving, { type: 'SUBMIT_SUCCEEDED', sha256: 'deadbeef' });
    expect(done.step).toBe('done');
    expect(done.sha256).toBe('deadbeef');
  });

  it('SUBMIT_FAILED returns to confirm (not the error step) with an inline message', () => {
    const saving = intakeReducer(createInitialIntakeState(), { type: 'SUBMIT_STARTED' });
    const failed = intakeReducer(saving, { type: 'SUBMIT_FAILED', message: 'No tienes acceso al archivo de facturas.' });
    expect(failed.step).toBe('confirm');
    expect(failed.error).toBe('No tienes acceso al archivo de facturas.');
  });

  it('RESET returns to the exact initial state', () => {
    const dirty = intakeReducer(createInitialIntakeState(), { type: 'SUBMIT_STARTED' });
    const reset = intakeReducer(dirty, { type: 'RESET' });
    expect(reset).toEqual(createInitialIntakeState());
  });

  it('returns the same state reference for an unknown action', () => {
    const state = createInitialIntakeState();
    expect(intakeReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

// ─── T5: classification slice (categoryName/projectId/costCenterId) ────────
describe('createInitialIntakeState — classification defaults', () => {
  it('starts with an empty classification, nothing touched and no suggestion', () => {
    const state = createInitialIntakeState();
    expect(state.classification).toEqual({ categoryName: '', projectId: '', costCenterId: '' });
    expect(state.touched).toEqual({ categoryName: false, projectId: false, costCenterId: false });
    expect(state.suggestion).toBeNull();
  });
});

describe('intakeReducer — CLASSIFICATION_SUGGESTED', () => {
  const suggestion = (overrides = {}) => ({
    categoryName: 'Materiales',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    costCenterId: 'CC-120',
    costScope: 'project',
    confidence: 'medium',
    reasons: [{ field: 'projectId', source: 'history', detail: 'Proyecto usado en 2 de 2 facturas anteriores' }],
    ...overrides,
  });

  it('fills every untouched classification field from the suggestion and stores it', () => {
    const state = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_SUGGESTED',
      suggestion: suggestion(),
    });
    expect(state.classification).toEqual({ categoryName: 'Materiales', projectId: 'proj-1', costCenterId: 'CC-120' });
    expect(state.suggestion).toEqual(suggestion());
  });

  it('never overwrites a field the human already touched', () => {
    const touchedProject = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: 'proj-manual',
    });
    const state = intakeReducer(touchedProject, { type: 'CLASSIFICATION_SUGGESTED', suggestion: suggestion() });
    expect(state.classification.projectId).toBe('proj-manual');
    expect(state.classification.categoryName).toBe('Materiales');
    // the suggestion itself is still stored (for reasons/confidence display) even though it was not applied to projectId
    expect(state.suggestion).toEqual(suggestion());
  });

  it('a null suggestion clears the stored suggestion without touching classification', () => {
    const withSuggestion = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_SUGGESTED',
      suggestion: suggestion(),
    });
    const cleared = intakeReducer(withSuggestion, { type: 'CLASSIFICATION_SUGGESTED', suggestion: null });
    expect(cleared.suggestion).toBeNull();
    expect(cleared.classification).toEqual(withSuggestion.classification);
  });
});

describe('intakeReducer — CLASSIFICATION_FIELD_CHANGED', () => {
  it('sets the field value and marks it touched', () => {
    const state = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'categoryName',
      value: 'Materiales',
    });
    expect(state.classification.categoryName).toBe('Materiales');
    expect(state.touched.categoryName).toBe(true);
    expect(state.touched.projectId).toBe(false);
  });

  it('a projectId change applies the given costCenterDefault when the cost center is untouched', () => {
    const state = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: 'proj-2',
      costCenterDefault: 'CC-110',
    });
    expect(state.classification).toEqual({ categoryName: '', projectId: 'proj-2', costCenterId: 'CC-110' });
    expect(state.touched.projectId).toBe(true);
    // the default was applied programmatically, not by the human — it stays untouched
    expect(state.touched.costCenterId).toBe(false);
  });

  it('a projectId change never overrides a manually touched cost center', () => {
    const manualCenter = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'costCenterId',
      value: 'CC-210',
    });
    const state = intakeReducer(manualCenter, {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: 'proj-2',
      costCenterDefault: 'CC-110',
    });
    expect(state.classification.costCenterId).toBe('CC-210');
    expect(state.classification.projectId).toBe('proj-2');
  });

  it('clearing the project (empty costCenterDefault) resets an untouched cost center to the category default', () => {
    const withProject = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: 'proj-2',
      costCenterDefault: 'CC-110',
    });
    const state = intakeReducer(withProject, {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: '',
      costCenterDefault: '',
    });
    expect(state.classification).toEqual({ categoryName: '', projectId: '', costCenterId: '' });
  });
});

describe('intakeReducer — classification resets alongside the rest of the wizard', () => {
  it('EXTRACTION_SUCCEEDED resets classification, touched flags and the stored suggestion for the new file', () => {
    const dirty = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'categoryName',
      value: 'Materiales',
    });
    const state = intakeReducer(dirty, {
      type: 'EXTRACTION_SUCCEEDED',
      payload: { hash: 'abc', sizeBytes: 1, originalName: 'x.pdf', bytes: new ArrayBuffer(0), evidenceLines: [], suggestions: {} },
    });
    expect(state.classification).toEqual({ categoryName: '', projectId: '', costCenterId: '' });
    expect(state.touched).toEqual({ categoryName: false, projectId: false, costCenterId: false });
    expect(state.suggestion).toBeNull();
  });

  it('RETRY resets classification, touched flags and the stored suggestion', () => {
    const dirty = intakeReducer(createInitialIntakeState(), {
      type: 'CLASSIFICATION_FIELD_CHANGED',
      field: 'projectId',
      value: 'proj-9',
    });
    const errored = intakeReducer(dirty, { type: 'EXTRACTION_FAILED', message: 'boom' });
    const state = intakeReducer(errored, { type: 'RETRY' });
    expect(state.classification).toEqual({ categoryName: '', projectId: '', costCenterId: '' });
    expect(state.touched).toEqual({ categoryName: false, projectId: false, costCenterId: false });
    expect(state.suggestion).toBeNull();
  });
});
