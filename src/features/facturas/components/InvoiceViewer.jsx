/**
 * Metadata + embedded PDF for the selected archived invoice, plus (admin/
 * manager only) correcting a mistake: Editar, Reemplazar PDF, Eliminar.
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
import { FAMILY_LABEL, switchSideBlocker } from '../lib/switchSide';

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

// A data mutation (edit/delete/replace) can succeed while its own audit-log
// write fails afterwards (src/features/facturas/lib/amend.js's `auditFailed`)
// — that is never plain success, so every one of the three handlers below
// surfaces this SAME distinct warning instead of the ordinary success toast.
const AUDIT_FAILED_MESSAGE =
  'La corrección se guardó, pero no se pudo registrar en la auditoría. Anota el motivo y avisa al administrador.';

/** `documentNumber || invoiceNumber || numeroPresupuesto` + status for a linked payable/receivable row. */
const resolveLinkLabel = (link, { payables, receivables }) => {
  const rows = link.family === 'payable' ? payables : receivables;
  const row = (rows || []).find((candidate) => candidate.id === link.recordId);
  if (!row) return { label: link.recordId, status: null };
  return {
    label: row.documentNumber || row.invoiceNumber || row.numeroPresupuesto || link.recordId,
    status: row.status || null,
  };
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
  onSwitchSide,
}) => {
  const { showToast } = useToast();
  const sha256 = document?.id;
  const { url, loading, error, retry } = useInvoicePdfBlob(user, sha256);
  const fileInputRef = useRef(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [cancelOwnedChecked, setCancelOwnedChecked] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // Holds the picked file (already hashed) while its mandatory reason is
  // collected — mirrors DELETE's own reason dialog (planInvoiceReplace now
  // rejects an empty reason exactly like planInvoiceDelete, see T14).
  const [pendingReplaceFile, setPendingReplaceFile] = useState(null);

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

  const currentFamily = document.direction === 'incoming' ? 'payable' : 'receivable';
  const targetFamily = currentFamily === 'payable' ? 'receivable' : 'payable';
  const switchBlocker = switchSideBlocker({ invoiceDocument: document, obligations, bankMovements });

  const handleSwitchConfirm = async (reason) => {
    try {
      const result = await onSwitchSide?.(document, reason);
      if (result?.success) {
        showToast(
          result.auditFailed ? AUDIT_FAILED_MESSAGE : `Factura cambiada de ${result.from} a ${result.to}. Revisa la categoría.`,
          result.auditFailed ? 'warning' : 'success',
        );
        return true;
      }
      showToast(result?.error?.message || 'No se pudo cambiar el tipo de la factura', 'error');
      return false;
    } catch (thrown) {
      showToast(thrown?.message || 'No se pudo cambiar el tipo de la factura', 'error');
      return false;
    }
  };

  const handleEditSubmit = async (form) => {
    setSavingEdit(true);
    try {
      const result = await onEditInvoice?.(document, form);
      if (result?.success) {
        showToast(result.auditFailed ? AUDIT_FAILED_MESSAGE : 'Factura actualizada', result.auditFailed ? 'warning' : 'success');
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

  /** Picks + hashes the file, then opens the reason dialog — nothing is sent yet. */
  const handleReplaceFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_INVOICE_BYTES) {
      showToast(ARCHIVE_ERROR_MESSAGES['too-large'], 'error');
      return;
    }
    const bytes = await file.arrayBuffer();
    const hash = await sha256Hex(bytes);
    setPendingReplaceFile({
      bytes,
      sha256: hash,
      sizeBytes: file.size,
      mimeType: 'application/pdf',
      originalName: file.name,
    });
  };

  /** Confirmed from the reason dialog: actually calls onReplaceInvoice. */
  const handleReplaceConfirm = async (reason) => {
    if (!pendingReplaceFile) return false;
    setReplacing(true);
    try {
      const { bytes, ...fileMeta } = pendingReplaceFile;
      const result = await onReplaceInvoice?.(document, fileMeta, bytes, reason);
      if (result?.success) {
        showToast(result.auditFailed ? AUDIT_FAILED_MESSAGE : 'PDF reemplazado correctamente', result.auditFailed ? 'warning' : 'success');
        return true;
      }
      // A partial replace is not a failed upload: the new PDF IS stored, the
      // old one was deliberately kept, and every obligation still points at a
      // readable document. Retrying converges (see lib/amend.js), so the toast
      // says that instead of sending the operator hunting for a lost file.
      if (result?.partial) {
        const pending = Array.isArray(result.failures) ? result.failures.length : 0;
        showToast(
          `El PDF nuevo se guardó, pero no se pudo actualizar el enlace en ${pending} documento(s). El PDF anterior se conserva: vuelve a intentar el reemplazo.`,
          'warning',
        );
        return false;
      }
      showToast(result?.errors?.file || result?.errors?.reason || 'No se pudo reemplazar el PDF', 'error');
      return false;
    } catch (thrown) {
      showToast(thrown?.message || 'No se pudo reemplazar el PDF', 'error');
      return false;
    } finally {
      setReplacing(false);
    }
  };

  const handleDeleteConfirm = async (reason) => {
    const cancelObligations = cancelOwnedChecked && ownedLink ? [{ family: ownedLink.family, recordId: ownedLink.recordId }] : [];
    try {
      const result = await onDeleteInvoice?.(document, { reason, cancelObligations });
      if (result?.success) {
        showToast(result.auditFailed ? AUDIT_FAILED_MESSAGE : 'Factura eliminada del archivo', result.auditFailed ? 'warning' : 'success');
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

  // Open the browser's PDF viewer showing the WHOLE page (`view=Fit`) and
  // without its thumbnail sidebar (`navpanes=0`), which otherwise eats a
  // third of the frame for a one-page invoice.
  const pdfSrc = url ? `${url}#navpanes=0&view=Fit` : null;

  return (
    <div className="order-first flex flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] lg:order-none lg:sticky lg:top-0 lg:h-[calc(100vh-11rem)]">
      <div className="flex-shrink-0 border-b border-[var(--color-line)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={currentFamily === 'payable' ? 'warn' : 'info'}>{FAMILY_LABEL[currentFamily]}</Badge>
              <p className="label-mono truncate text-[var(--color-fg-3)]">
                {document.invoiceNumber || '—'} · {document.issueDate ? formatDate(document.issueDate) : '—'} ·{' '}
                {document.sourceSystem === 'insyte' ? 'Insyte' : 'Ordinaria'}
              </p>
            </div>
            <h3
              className="font-display mt-1.5 truncate text-[20px] font-medium tracking-tight text-[var(--color-fg-1)]"
              title={document.counterpartyName}
            >
              {document.counterpartyName}
            </h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Field label="Neto">
              <span className="font-mono">{formatCurrency(document.netAmount)}</span>
            </Field>
            <Field label="IVA">
              <span className="font-mono">{formatCurrency(document.taxAmount)}</span>
            </Field>
            <Field label="Bruto">
              <span className="font-mono font-medium">{formatCurrency(document.grossAmount)}</span>
            </Field>
            {links.length > 0 && (
              <div>
                <dt className="label-mono text-[var(--color-fg-4)]">Vínculos</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-2)]">
                  {links.map((link) => {
                    const { label, status } = resolveLinkLabel(link, { payables, receivables });
                    return (
                      <span key={`${link.family}-${link.recordId}`} className="flex items-center gap-1.5">
                        <span className="font-mono">
                          {FAMILY_LABEL[link.family]} {label}
                        </span>
                        {status && (
                          <Badge variant={STATUS_BADGE_VARIANT[status] || 'neutral'}>
                            {STATUS_LABELS[status] || status}
                          </Badge>
                        )}
                      </span>
                    );
                  })}
                </dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={url || undefined}
              download={document.originalName}
              aria-disabled={!url}
              className={`nx-btn nx-btn-secondary nx-btn-sm ${!url ? 'pointer-events-none opacity-50' : ''}`}
            >
              Descargar
            </a>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="nx-btn nx-btn-secondary nx-btn-sm">
                Abrir
              </a>
            )}

            {canAct && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                  Editar
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReplaceClick} loading={replacing} disabled={replacing}>
                  Reemplazar PDF
                </Button>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleReplaceFile} />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSwitchOpen(true)}
                  disabled={Boolean(switchBlocker)}
                  title={switchBlocker || `Esta factura está como ${FAMILY_LABEL[currentFamily]}: pasarla a ${FAMILY_LABEL[targetFamily]}`}
                >
                  Cambiar a {FAMILY_LABEL[targetFamily]}
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                  Eliminar
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-[75vh] flex-1 flex-col p-2 lg:min-h-0">
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <p className="label-mono text-[var(--color-fg-3)]">Cargando PDF…</p>
          </div>
        )}
        {errorMessage && (
          <div className="nx-alert nx-alert-err m-2 flex flex-wrap items-center justify-between gap-3">
            <p>{errorMessage}</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              Reintentar
            </Button>
          </div>
        )}
        {pdfSrc && !loading && !errorMessage && (
          <iframe
            key={pdfSrc}
            title={`Factura ${document.invoiceNumber}`}
            src={pdfSrc}
            className="w-full flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)]"
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
          isOpen={Boolean(pendingReplaceFile)}
          onClose={() => setPendingReplaceFile(null)}
          onConfirm={handleReplaceConfirm}
          title="Reemplazar PDF de la factura"
          message="Se subirá el nuevo PDF y sustituirá el archivo actual. Esta acción no se puede deshacer."
          confirmText="Reemplazar"
          variant="warning"
          reasonLabel="Motivo"
          reasonPlaceholder="Ej. PDF ilegible, versión incorrecta…"
          details={[
            { label: 'Factura', value: document.invoiceNumber || document.id, emphasis: true },
            { label: 'Archivo nuevo', value: pendingReplaceFile?.originalName || '—' },
          ]}
        />
      )}

      {canAct && (
        <ConfirmModal
          isOpen={switchOpen}
          onClose={() => setSwitchOpen(false)}
          onConfirm={handleSwitchConfirm}
          title={`Cambiar factura de ${FAMILY_LABEL[currentFamily]} a ${FAMILY_LABEL[targetFamily]}`}
          message={`La factura y su ${FAMILY_LABEL[currentFamily]} pasan a ${FAMILY_LABEL[targetFamily]} con el mismo número, contraparte, importes, fechas, proyecto y centro de costo. El PDF se mantiene. La categoría queda vacía: asígnala después.`}
          confirmText={`Cambiar a ${FAMILY_LABEL[targetFamily]}`}
          variant="warning"
          reasonLabel="Motivo"
          reasonPlaceholder="Ej. factura de proveedor cargada como emitida…"
          details={[
            { label: 'Factura', value: document.invoiceNumber || document.id, emphasis: true },
            { label: 'Contraparte', value: document.counterpartyName || '—' },
            { label: 'Bruto', value: formatCurrency(document.grossAmount) },
          ]}
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
