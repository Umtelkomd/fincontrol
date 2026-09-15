/**
 * Pure state machine for the invoice PDF intake wizard (InvoiceIntakePanel).
 *
 * Steps: 'choose' -> 'extracting' -> 'confirm' -> 'saving' -> 'done' | 'error'.
 * 'error' is reserved for a failed PDF extraction (unreadable/scanned file);
 * a failed submission (validation or an archive effect) returns to 'confirm'
 * with an inline `error` message instead, so the user can fix the form without
 * losing the extracted file or their edits.
 *
 * Pure: no I/O, no Date.now() — every side effect (extraction, archiving) is
 * driven by the caller and reported back through an action.
 */

const EMPTY_FORM = Object.freeze({
  counterpartyName: '',
  invoiceNumber: '',
  issueDate: '',
  netAmount: '',
  taxAmount: '',
  grossAmount: '',
});

/** Fresh wizard state: incoming/ordinary, empty form, no file. */
export const createInitialIntakeState = () => ({
  step: 'choose',
  direction: 'incoming',
  sourceSystem: 'ordinary',
  file: null,
  evidenceLines: [],
  form: { ...EMPTY_FORM },
  linkMode: 'create-ordinary',
  selectedCandidateIds: [],
  error: null,
  sha256: null,
});

/** A suggestion's `.value` (or '' when there is no suggestion for that field). */
const valueOf = (suggestion) => (suggestion && suggestion.value !== undefined && suggestion.value !== null ? suggestion.value : '');

const toggleId = (ids, id) => (ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]);

export const intakeReducer = (state, action) => {
  switch (action.type) {
    case 'SELECT_DIRECTION': {
      const direction = action.direction;
      // Insyte is outgoing-only; switching to incoming with insyte selected
      // would leave an invalid combination, so fall back to ordinary.
      const sourceSystem = direction === 'incoming' && state.sourceSystem === 'insyte' ? 'ordinary' : state.sourceSystem;
      // The candidate obligation pool depends on direction (family); a prior
      // selection from the other family would no longer resolve.
      return { ...state, direction, sourceSystem, selectedCandidateIds: [] };
    }

    case 'SELECT_SOURCE_SYSTEM': {
      const sourceSystem = action.sourceSystem;
      if (sourceSystem === 'insyte') {
        // Insyte is always link-only to existing presupuestos.
        return { ...state, sourceSystem, linkMode: 'attach-existing', selectedCandidateIds: [] };
      }
      return { ...state, sourceSystem };
    }

    case 'FILE_PICKED':
      return { ...state, step: 'extracting', error: null };

    case 'EXTRACTION_SUCCEEDED': {
      const { hash, sizeBytes, originalName, bytes, evidenceLines = [], suggestions = {} } = action.payload || {};
      return {
        ...state,
        step: 'confirm',
        error: null,
        file: { hash, sizeBytes, originalName, bytes },
        evidenceLines,
        form: {
          counterpartyName: valueOf(suggestions.counterpartyName),
          invoiceNumber: valueOf(suggestions.invoiceNumber),
          issueDate: valueOf(suggestions.issueDate),
          netAmount: valueOf(suggestions.netAmount),
          taxAmount: valueOf(suggestions.taxAmount),
          grossAmount: valueOf(suggestions.grossAmount),
        },
      };
    }

    case 'EXTRACTION_FAILED':
      return { ...state, step: 'error', error: action.message };

    case 'RETRY':
      return {
        ...state,
        step: 'choose',
        error: null,
        file: null,
        evidenceLines: [],
        form: { ...EMPTY_FORM },
      };

    case 'FIELD_CHANGED':
      return { ...state, form: { ...state.form, [action.field]: action.value } };

    case 'SET_LINK_MODE': {
      const linkMode = action.linkMode;
      return { ...state, linkMode, selectedCandidateIds: linkMode === 'create-ordinary' ? [] : state.selectedCandidateIds };
    }

    case 'TOGGLE_CANDIDATE':
      return { ...state, selectedCandidateIds: toggleId(state.selectedCandidateIds, action.id) };

    case 'SUBMIT_STARTED':
      return { ...state, step: 'saving', error: null };

    case 'SUBMIT_SUCCEEDED':
      return { ...state, step: 'done', error: null, sha256: action.sha256 };

    case 'SUBMIT_FAILED':
      return { ...state, step: 'confirm', error: action.message };

    case 'RESET':
      return createInitialIntakeState();

    default:
      return state;
  }
};
