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
