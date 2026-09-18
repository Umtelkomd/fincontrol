/**
 * Invoice PDF intake wizard: pick a file, review the auto-suggested header
 * AND the auto-suggested classification (category/project/cost center —
 * acceptance #1), confirm both and archive the PDF alongside a
 * new-or-linked CXP/CXC obligation.
 *
 * All accounting invariants live in src/finance/invoiceArchive.js, reached
 * through buildConfirmedHeader/archiveInvoice (src/features/facturas/lib/intake.js).
 * Classification invariants live in src/finance/invoiceClassification.js,
 * reached through suggestInvoiceClassification/validateInvoiceClassification/
 * buildClassificationFields. This component only shapes form state (via the
 * intakeState reducer) and wires the three effects archiveInvoice needs:
 * upload, createObligation, commit.
 */
import { useReducer, useState } from 'react';
import { Button } from '../../../components/ui/nexus';
import { useToast } from '../../../contexts/ToastContext';
import { extractPdfText } from '../../../lib/pdf/extractPdfText';
import { suggestInvoiceHeader } from '../../../finance/invoiceHeaderParser';
import {
  buildClassificationFields,
  suggestInvoiceClassification,
  validateInvoiceClassification,
} from '../../../finance/invoiceClassification';
import { defaultCostCenterFor } from '../../../finance/classificationDefaults';
import { CATEGORY_TYPE } from '../../../finance/taxonomy';
import { db, appId } from '../../../services/firebase';
import { MAX_INVOICE_BYTES } from '../../../finance/invoiceChunks';
import { createInitialIntakeState, intakeReducer } from '../lib/intakeState';
import { archiveInvoice, buildConfirmedHeader, obligationToLinkRow } from '../lib/intake';
import { ARCHIVE_ERROR_MESSAGES, InvoiceArchiveError, uploadInvoicePdf } from '../lib/invoiceArchiveStore';
import { translateValidationMessage } from '../lib/validationMessages';
import ClassificationFields from './ClassificationFields';
import FieldLabel from './FieldLabel';
import InvoiceHeaderFields from './InvoiceHeaderFields';
import { formatCurrency } from '../../../utils/formatters';

const DIRECTION_OPTIONS = [
  { value: 'incoming', label: 'Proveedor (CXP)' },
  { value: 'outgoing', label: 'Cliente (CXC)' },
];

const SOURCE_OPTIONS = [
  { value: 'ordinary', label: 'Ordinaria' },
  { value: 'insyte', label: 'Insyte' },
];

const familyOf = (direction) => (direction === 'incoming' ? 'payable' : 'receivable');

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const InvoiceIntakePanel = ({
  user,
  payables = [],
  receivables = [],
  projects = [],
  rules = [],
  history = [],
  createPayable,
  createReceivable,
  commitInvoiceArchive,
  onArchived,
  onViewInvoice,
  onClose,
}) => {
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(intakeReducer, undefined, createInitialIntakeState);
  const [candidateSearch, setCandidateSearch] = useState('');
  // The full extracted PDF text — kept outside the (Firestore-bound) reducer
  // state purely so the classification suggestion can be recomputed if the
  // direction changes after extraction; evidenceLines only holds the header
  // parser's shorter evidence excerpt, not the whole document.
  const [pdfText, setPdfText] = useState('');
  const [classificationErrors, setClassificationErrors] = useState({});

  const family = familyOf(state.direction);
  const candidates = (family === 'payable' ? payables : receivables).filter(
    (row) => (row.sourceSystem || 'ordinary') === state.sourceSystem,
  );
  const filteredCandidates = candidates.filter((row) => {
    const needle = candidateSearch.trim().toLowerCase();
    if (!needle) return true;
    const counterparty = row.counterpartyName || row.vendor || row.client || '';
    const number = row.invoiceNumber || row.numeroPresupuesto || '';
    return String(counterparty).toLowerCase().includes(needle) || String(number).toLowerCase().includes(needle);
  });

  const activeProjects = projects.filter((project) => (project.status || 'active') === 'active');
  const categoryType = family === 'payable' ? CATEGORY_TYPE.EXPENSE : CATEGORY_TYPE.INCOME;

  const handleFieldChange = (field) => (event) =>
    dispatch({ type: 'FIELD_CHANGED', field, value: event.target.value });

  /**
   * Suggests category/project/cost center for the current form + direction.
   * `direction` here is the wizard's own 'incoming'/'outgoing' token — mapped
   * to the suggester's 'payable'/'receivable' contract via familyOf. Never
   * throws — a suggester with no evidence just returns empty fields.
   */
  const suggestClassification = (direction, text) =>
    suggestInvoiceClassification({
      header: {
        counterpartyName: state.form.counterpartyName,
        invoiceNumber: state.form.invoiceNumber,
        grossAmount: toNumber(state.form.grossAmount),
      },
      text,
      direction: familyOf(direction),
      projects,
      rules,
      history,
    });

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    dispatch({ type: 'FILE_PICKED' });
    setPdfText('');
    setClassificationErrors({});
    if (file.size > MAX_INVOICE_BYTES) {
      dispatch({ type: 'EXTRACTION_FAILED', message: ARCHIVE_ERROR_MESSAGES['too-large'] });
      return;
    }
    try {
      const { text, hash } = await extractPdfText(file);
      const { suggestions, evidence } = suggestInvoiceHeader(text, { direction: state.direction });
      const bytes = await file.arrayBuffer();
      dispatch({
        type: 'EXTRACTION_SUCCEEDED',
        payload: {
          hash,
          sizeBytes: file.size,
          originalName: file.name,
          bytes,
          evidenceLines: evidence?.lines || [],
          suggestions,
        },
      });
      setPdfText(text);
      dispatch({
        type: 'CLASSIFICATION_SUGGESTED',
        suggestion: suggestInvoiceClassification({
          header: {
            counterpartyName: suggestions?.counterpartyName?.value ?? '',
            invoiceNumber: suggestions?.invoiceNumber?.value ?? '',
            grossAmount: toNumber(suggestions?.grossAmount?.value ?? 0),
          },
          text,
          direction: family,
          projects,
          rules,
          history,
        }),
      });
    } catch {
      dispatch({
        type: 'EXTRACTION_FAILED',
        message: 'No se pudo leer el PDF. Asegúrate de que sea un PDF con texto (no escaneado).',
      });
    }
  };

  const handleDirectionChange = (direction) => {
    dispatch({ type: 'SELECT_DIRECTION', direction });
    // Direction changes the category type (expense vs income); recompute the
    // suggestion when it happens after a file has already been extracted.
    if (pdfText) dispatch({ type: 'CLASSIFICATION_SUGGESTED', suggestion: suggestClassification(direction, pdfText) });
  };

  const handleClassificationFieldChange = (field) => (event) => {
    setClassificationErrors((previous) => ({ ...previous, [field]: undefined }));
    dispatch({ type: 'CLASSIFICATION_FIELD_CHANGED', field, value: event.target.value });
  };

  const handleProjectChange = (event) => {
    const projectId = event.target.value;
    const project = activeProjects.find((candidate) => candidate.id === projectId) || null;
    const costCenterDefault = defaultCostCenterFor({ projectId, project, categoryName: state.classification.categoryName });
    setClassificationErrors((previous) => ({ ...previous, projectId: undefined, costCenterId: undefined }));
    dispatch({ type: 'CLASSIFICATION_FIELD_CHANGED', field: 'projectId', value: projectId, costCenterDefault });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // Classification is validated BEFORE the header/archive attempt (acceptance
    // #2): an invalid category/project/cost-center combination blocks confirm
    // with inline errors and never reaches 'saving' — no reducer transition, no
    // archive effect runs.
    const classificationCheck = validateInvoiceClassification({
      direction: family,
      categoryName: state.classification.categoryName,
      projectId: state.classification.projectId,
      costCenterId: state.classification.costCenterId,
    });
    if (!classificationCheck.valid) {
      setClassificationErrors(classificationCheck.errors);
      return;
    }
    setClassificationErrors({});

    dispatch({ type: 'SUBMIT_STARTED' });

    let header;
    try {
      header = buildConfirmedHeader({
        direction: state.direction,
        sourceSystem: state.sourceSystem,
        counterpartyName: state.form.counterpartyName,
        invoiceNumber: state.form.invoiceNumber,
        issueDate: state.form.issueDate,
        netAmount: state.form.netAmount,
        taxAmount: state.form.taxAmount,
        grossAmount: state.form.grossAmount,
      });
    } catch (thrown) {
      dispatch({ type: 'SUBMIT_FAILED', message: translateValidationMessage(thrown) });
      return;
    }

    const effects = {
      upload: ({ bytes, expectedSha256 }) => uploadInvoicePdf({ db, appId, bytes, expectedSha256 }),
      createObligation: async (obligationFamily, payload) => {
        const result =
          obligationFamily === 'payable' ? await createPayable(payload) : await createReceivable(payload);
        if (!result?.success) {
          throw result?.error instanceof Error
            ? result.error
            : new Error(String(result?.error || 'No se pudo crear la obligación'));
        }
        return result.id;
      },
      commit: commitInvoiceArchive,
    };

    try {
      const result = await archiveInvoice(
        {
          header,
          file: {
            sha256: state.file.hash,
            sizeBytes: state.file.sizeBytes,
            mimeType: 'application/pdf',
            originalName: state.file.originalName,
          },
          bytes: state.file.bytes,
          mode: state.linkMode,
          links: state.selectedCandidateIds.map((id) => ({ family, recordId: id })),
          existingObligations: candidates.map((row) => obligationToLinkRow(row, family)),
          classification: buildClassificationFields(state.classification, projects),
          uid: user.uid,
          now: new Date().toISOString(),
        },
        effects,
      );
      dispatch({ type: 'SUBMIT_SUCCEEDED', sha256: result.sha256 });
      showToast('Factura archivada', 'success');
      onArchived?.(result.sha256);
    } catch (thrown) {
      const message =
        thrown instanceof InvoiceArchiveError
          ? ARCHIVE_ERROR_MESSAGES[thrown.code] || thrown.message
          : translateValidationMessage(thrown);
      dispatch({ type: 'SUBMIT_FAILED', message });
    }
  };

  const net = toNumber(state.form.netAmount);
  const tax = toNumber(state.form.taxAmount);
  const gross = toNumber(state.form.grossAmount);
  const mismatch = Math.abs(net + tax - gross) > 0.01;

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
      {state.step === 'choose' && (
        <div className="space-y-4">
          <fieldset>
            <legend className="label-mono mb-2 text-[var(--color-fg-4)]">Tipo</legend>
            <div className="flex flex-wrap gap-4">
              {DIRECTION_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-[var(--color-fg-1)]">
                  <input
                    type="radio"
                    name="facturas-direction"
                    value={option.value}
                    checked={state.direction === option.value}
                    onChange={() => handleDirectionChange(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <FieldLabel label="Origen" htmlFor="facturas-source">
            <select
              id="facturas-source"
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
              value={state.sourceSystem}
              onChange={(event) => dispatch({ type: 'SELECT_SOURCE_SYSTEM', sourceSystem: event.target.value })}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} disabled={option.value === 'insyte' && state.direction !== 'outgoing'}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldLabel>

          <FieldLabel label="PDF de la factura" htmlFor="facturas-file">
            <input
              id="facturas-file"
              type="file"
              accept="application/pdf"
              onChange={handleFile}
              className="block w-full text-sm text-[var(--color-fg-3)] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[var(--color-line)] file:bg-[var(--color-bg-2)] file:px-3 file:py-2 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.1em] file:text-[var(--color-fg-1)] file:transition-colors hover:file:bg-[var(--color-bg-3)]"
            />
          </FieldLabel>
          <p className="label-mono -mt-2 text-[var(--color-fg-4)]">Máximo 2 MB por PDF</p>

          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      )}

      {state.step === 'extracting' && (
        <p className="label-mono text-[var(--color-fg-3)]">Extrayendo texto del PDF…</p>
      )}

      {state.step === 'error' && (
        <div className="nx-alert nx-alert-err flex flex-wrap items-center justify-between gap-3">
          <p>{state.error}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setPdfText('');
              setClassificationErrors({});
              dispatch({ type: 'RETRY' });
            }}
          >
            Reintentar
          </Button>
        </div>
      )}

      {(state.step === 'confirm' || state.step === 'saving') && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <InvoiceHeaderFields idPrefix="facturas" form={state.form} onFieldChange={handleFieldChange} mismatch={mismatch} />

          <ClassificationFields
            idPrefix="facturas"
            categoryType={categoryType}
            projects={activeProjects}
            classification={state.classification}
            suggestion={state.suggestion}
            errors={classificationErrors}
            onCategoryChange={handleClassificationFieldChange('categoryName')}
            onProjectChange={handleProjectChange}
            onCostCenterChange={handleClassificationFieldChange('costCenterId')}
          />

          {state.evidenceLines.length > 0 && (
            <details className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] p-3">
              <summary className="label-mono cursor-pointer text-[var(--color-fg-4)]">Texto detectado</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-fg-3)]">
                {state.evidenceLines.slice(0, 40).join('\n')}
              </pre>
            </details>
          )}

          <fieldset>
            <legend className="label-mono mb-2 text-[var(--color-fg-4)]">Vínculo</legend>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-fg-1)]">
                <input
                  type="radio"
                  name="facturas-link-mode"
                  checked={state.linkMode === 'create-ordinary'}
                  disabled={state.sourceSystem === 'insyte'}
                  onChange={() => dispatch({ type: 'SET_LINK_MODE', linkMode: 'create-ordinary' })}
                />
                Crear obligación nueva
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-fg-1)]">
                <input
                  type="radio"
                  name="facturas-link-mode"
                  checked={state.linkMode === 'attach-existing'}
                  onChange={() => dispatch({ type: 'SET_LINK_MODE', linkMode: 'attach-existing' })}
                />
                Vincular a existentes
              </label>
            </div>
          </fieldset>

          {state.linkMode === 'attach-existing' && (
            <div>
              <input
                className="mb-2 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
                placeholder="Filtrar obligaciones…"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
                aria-label="Filtrar obligaciones existentes"
              />
              <div className="max-h-56 space-y-1 overflow-auto">
                {filteredCandidates.length === 0 && (
                  <p className="label-mono text-[var(--color-fg-3)]">Sin obligaciones que coincidan.</p>
                )}
                {filteredCandidates.map((row) => (
                  <label
                    key={row.id}
                    className="flex items-center gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
                  >
                    <input
                      type="checkbox"
                      checked={state.selectedCandidateIds.includes(row.id)}
                      onChange={() => dispatch({ type: 'TOGGLE_CANDIDATE', id: row.id })}
                    />
                    <span className="flex-1 truncate">{row.counterpartyName || row.vendor || row.client}</span>
                    <span className="font-mono text-xs text-[var(--color-fg-4)]">
                      {row.invoiceNumber || row.numeroPresupuesto}
                    </span>
                    <span className="font-mono text-xs text-[var(--color-fg-1)]">{formatCurrency(row.grossAmount)}</span>
                    <span className="label-mono text-[var(--color-fg-4)]">{row.status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {state.error && <p className="text-sm text-[var(--color-err)]">{state.error}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={state.step === 'saving'} disabled={state.step === 'saving'}>
              Archivar factura
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={state.step === 'saving'}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {state.step === 'done' && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-fg-1)]">Factura archivada correctamente.</p>
          <p className="font-mono text-xs text-[var(--color-fg-3)]">{state.sha256}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => onViewInvoice?.(state.sha256)}>
              Ver factura
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPdfText('');
                setClassificationErrors({});
                dispatch({ type: 'RESET' });
              }}
            >
              Archivar otra
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceIntakePanel;
