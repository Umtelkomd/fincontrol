/**
 * Metadata + embedded PDF for the selected archived invoice.
 * The blob fetch/object-URL lifecycle lives in useInvoicePdfBlob.
 */
import { Badge, Button } from '../../../components/ui/nexus';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { ARCHIVE_ERROR_MESSAGES } from '../lib/invoiceArchiveStore';
import { useInvoicePdfBlob } from '../hooks/useInvoicePdfBlob';

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

const InvoiceViewer = ({ document, user, payables = [], receivables = [], onClose }) => {
  const sha256 = document?.id;
  const { url, loading, error, retry } = useInvoicePdfBlob(user, sha256);

  if (!document) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
        <p className="label-mono text-[var(--color-fg-3)]">Selecciona una factura archivada para verla aquí.</p>
      </div>
    );
  }

  const links = Array.isArray(document.links) ? document.links : [];
  const errorMessage = error ? ARCHIVE_ERROR_MESSAGES[error.code] || error.message : null;

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

      <div className="mt-4 flex items-center gap-2">
        <a
          href={url || undefined}
          download={document.originalName}
          aria-disabled={!url}
          className={`nx-btn nx-btn-secondary ${!url ? 'pointer-events-none opacity-50' : ''}`}
        >
          Descargar
        </a>
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
    </div>
  );
};

export default InvoiceViewer;
