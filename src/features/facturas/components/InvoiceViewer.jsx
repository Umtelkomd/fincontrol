/**
 * Metadata + embedded PDF for the selected archived invoice, plus (T13,
 * admin/manager only) correcting a mistake: Editar, Reemplazar PDF, Eliminar.
 * The blob fetch/object-URL lifecycle lives in useInvoicePdfBlob. Every
 * accounting decision behind these three actions lives in
 * src/finance/invoiceAmendment.js; this component only collects input and
 * reports the outcome.
 */
import { useRef, useState } from 'react';
import { Badge, Button } from '../../../components/ui/nexus';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { useToast } from '../../../contexts/ToastContext';
import { obligationLockState, ownedLinks } from '../../../finance/invoiceAmendment';
import { MAX_INVOICE_BYTES, sha256Hex } from '../../../finance/invoiceChunks';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { ARCHIVE_ERROR_MESSAGES } from '../lib/invoiceArchiveStore';
import { useInvoicePdfBlob } from '../hooks/useInvoicePdfBlob';
import InvoiceEditModal from './InvoiceEditModal';

// Same vocabulary/labels as src/features/cxp/CXPIndependiente.jsx's statusLabels,
// so a linked obligation reads identically here and in its own CXP/CXC list.
const STATUS_LABELS = {
  issued: 'Emitida',
  partial: 'Parcial',
  overdue: 'Vencida',
  settled: 'Liquidada',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_VARIANT = {
  settled: 'ok',
  overdue: 'err',
  partial: 'warn',
  cancelled: 'neutral',
  issued: 'neutral',
};

/** `invoiceNumber || numeroPresupuesto` + status for a linked payable/receivable row. */
const resolveLinkLabel = (link, { payables, receivables }) => {
  const rows = link.family === 'payable' ? payables : receivables;
  const row = (rows || []).find((candidate) => candidate.id === link.recordId);
  if (!row) return { label: link.recordId, status: null };
  return { label: row.invoiceNumber || row.numeroPresupuesto || link.recordId, status: row.status || null };
};

const Field = ({ label, children }) => (
  <div>
    <dt className="label-mono text-[var(--color-fg-4)]">{label}</dt>
    <dd className="mt-0.5 text-sm text-[var(--color-fg-1)]">{children}</dd>
  </div>
);

const InvoiceViewer = ({
  document,
  user,
  userRole,
  payables = [],
  receivables = [],
  bankMovements = [],
  projects = [],
  onClose,
  onEditInvoice,
  onReplaceInvoice,
  onDeleteInvoice,
}) => {
  const { showToast } = useToast();
  const sha256 = document?.id;
  const { url, loading, error, retry } = useInvoicePdfBlob(user, sha256);
  const fileInputRef = useRef(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOwnedChecked, setCancelOwnedChecked] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const canAct = userRole === 'admin' || userRole === 'manager';
  const obligations = [...payables, ...receivables];

  if (!document) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
        <p className="label-mono text-[var(--color-fg-3)]">Selecciona una factura archivada para verla aquí.</p>
      </div>
    );
  }

  const links = Array.isArray(document.links) ? document.links : [];
  const errorMessage = error ? ARCHIVE_ERROR_MESSAGES[error.code] || error.message : null;

  const { owned } = ownedLinks(document);
  const ownedLink = owned[0] || null;
  const ownedObligation = ownedLink
    ? obligations.find((row) => row.kind === ownedLink.family && row.id === ownedLink.recordId) || null
    : null;
  const lockState = ownedObligation ? obligationLockState(ownedObligation, bankMovements) : { locked: false, reasons: [] };
  const cancelDisabledReason = !ownedLink
    ? 'Esta factura no creó ninguna obligación propia'
    : lockState.locked
      ? lockState.reasons.join('; ')
      : '';

  const handleEditSubmit = async (form) => {
    setSavingEdit(true);
    try {
      const result = await onEditInvoice?.(document, form);
      if (result?.success) {
        showToast('Factura actualizada', 'success');
        setEditOpen(false);
      } else if (result?.partial) {
        showToast('Se aplicaron algunos cambios, pero otros fallaron. Revisa el registro de auditoría.', 'warning');
      } else {
        showToast('No se pudo actualizar la factura', 'error');
      }
    } catch (thrown) {
      showToast(thrown?.message || 'No se pudo actualizar la factura', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleReplaceClick = () => fileInputRef.current?.click();

  const handleReplaceFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_INVOICE_BYTES) {
      showToast(ARCHIVE_ERROR_MESSAGES['too-large'], 'error');
      return;
    }
    setReplacing(true);
    try {
      const bytes = await file.arrayBuffer();
      const hash = await sha256Hex(bytes);
      const result = await onReplaceInvoice?.(document, {
        sha256: hash,
        sizeBytes: file.size,
        mimeType: 'application/pdf',
        originalName: file.name,
      }, bytes);
      if (result?.success) {
        showToast('PDF reemplazado correctamente', 'success');
      } else {
        showToast(result?.errors?.file || 'No se pudo reemplazar el PDF', 'error');
      }
    } catch (thrown) {
      showToast(thrown?.message || 'No se pudo reemplazar el PDF', 'error');
    } finally {
      setReplacing(false);
    }
  };

  const handleDeleteConfirm = async (reason) => {
    const cancelObligations = cancelOwnedChecked && ownedLink ? [{ family: ownedLink.family, recordId: ownedLink.recordId }] : [];
    try {
      const result = await onDeleteInvoice?.(document, { reason, cancelObligations });
      if (result?.success) {
        showToast('Factura eliminada del archivo', 'success');
        setCancelOwnedChecked(false);
        onClose?.();
        return true;
      }
      showToast('No se pudo eliminar la factura por completo. Revisa el registro de auditoría.', 'error');
      return false;
    } catch (thrown) {
      showToast(thrown?.message || 'No se pudo eliminar la factura', 'error');
      return false;
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-mono text-[var(--color-fg-3)]">Factura</p>
          <h3 className="font-display mt-1 truncate text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">
            {document.counterpartyName}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Nº">{document.invoiceNumber || '—'}</Field>
        <Field label="Fecha">{document.issueDate ? formatDate(document.issueDate) : '—'}</Field>
        <Field label="Origen">{document.sourceSystem === 'insyte' ? 'Insyte' : 'Ordinaria'}</Field>
        <Field label="Neto">
          <span className="font-mono">{formatCurrency(document.netAmount)}</span>
        </Field>
        <Field label="IVA">
          <span className="font-mono">{formatCurrency(document.taxAmount)}</span>
        </Field>
        <Field label="Bruto">
          <span className="font-mono">{formatCurrency(document.grossAmount)}</span>
        </Field>
      </dl>

      {links.length > 0 && (
        <div className="mt-4">
          <p className="label-mono text-[var(--color-fg-4)]">Vínculos</p>
          <ul className="mt-1 space-y-1 text-sm text-[var(--color-fg-2)]">
            {links.map((link) => {
              const { label, status } = resolveLinkLabel(link, { payables, receivables });
              return (
                <li key={`${link.family}-${link.recordId}`} className="flex items-center gap-2">
                  <span>{label}</span>
                  {status && (
                    <Badge variant={STATUS_BADGE_VARIANT[status] || 'neutral'}>
                      {STATUS_LABELS[status] || status}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={url || undefined}
          download={document.originalName}
          aria-disabled={!url}
          className={`nx-btn nx-btn-secondary ${!url ? 'pointer-events-none opacity-50' : ''}`}
        >
          Descargar
        </a>

        {canAct && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            <Button variant="secondary" size="sm" onClick={handleReplaceClick} loading={replacing} disabled={replacing}>
              Reemplazar PDF
            </Button>
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleReplaceFile} />
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              Eliminar
            </Button>
          </>
        )}
      </div>

      <div className="mt-4">
        {loading && <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>}
        {errorMessage && (
          <div className="nx-alert nx-alert-err flex flex-wrap items-center justify-between gap-3">
            <p>{errorMessage}</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              Reintentar
            </Button>
          </div>
        )}
        {url && !loading && !errorMessage && (
          <iframe
            title={`Factura ${document.invoiceNumber}`}
            src={url}
            className="h-[70vh] w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)]"
          />
        )}
      </div>

      {canAct && editOpen && (
        <InvoiceEditModal
          key={document.id}
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          document={document}
          obligations={obligations}
          bankMovements={bankMovements}
          projects={projects}
          submitting={savingEdit}
          onSubmit={handleEditSubmit}
        />
      )}

      {canAct && (
        <ConfirmModal
          isOpen={deleteOpen}
          onClose={() => {
            setCancelOwnedChecked(false);
            setDeleteOpen(false);
          }}
          onConfirm={handleDeleteConfirm}
          title="Eliminar factura archivada"
          message="Se eliminará el PDF y los vínculos de esta factura del archivo. Esta acción no se puede deshacer; no hay undo de una conciliación bancaria."
          confirmText="Eliminar"
          variant="danger"
          confirmKeyword={document.invoiceNumber || document.id}
          confirmKeywordLabel="Confirmación"
          reasonLabel="Motivo"
          reasonPlaceholder="Ej. factura duplicada, PDF equivocado…"
          details={[
            { label: 'Factura', value: document.invoiceNumber || document.id, emphasis: true },
            { label: 'Vínculos', value: String(links.length) },
          ]}
        >
          <label className="flex items-start gap-2 text-sm text-[var(--color-fg-2)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={cancelOwnedChecked}
              disabled={Boolean(cancelDisabledReason)}
              onChange={(event) => setCancelOwnedChecked(event.target.checked)}
            />
            <span>
              Anular también la CXP/CXC creada por esta factura
              {cancelDisabledReason && (
                <span className="block text-xs text-[var(--color-fg-4)]">{cancelDisabledReason}</span>
              )}
            </span>
          </label>
        </ConfirmModal>
      )}
    </div>
  );
};

export default InvoiceViewer;
