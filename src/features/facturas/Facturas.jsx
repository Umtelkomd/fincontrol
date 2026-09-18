/**
 * Facturas — invoice PDF intake, private archive and viewer.
 *
 * Composes the shared finance ledger (for the monthly chart and the CXP/CXC
 * obligation candidates the intake wizard links against) with its own
 * invoiceDocuments subscription (useInvoiceDocuments).
 */
import { useState } from 'react';
import PageHeader from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/nexus';
import { db, appId } from '../../services/firebase';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useInvoiceDocuments } from '../../hooks/useInvoiceDocuments';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { writeAuditLogEntry } from '../../utils/auditLog';
import { applyInvoiceDelete, applyInvoiceEdit, applyInvoiceReplace } from './lib/amend';
import { deleteInvoicePdf, uploadInvoicePdf } from './lib/invoiceArchiveStore';
import MonthlyInvoicingChart from './components/MonthlyInvoicingChart';
import InvoiceIntakePanel from './components/InvoiceIntakePanel';
import InvoiceArchiveList from './components/InvoiceArchiveList';
import InvoiceViewer from './components/InvoiceViewer';

const Facturas = ({ user, userRole }) => {
  const ledger = useFinanceLedgerContext();
  const {
    documents,
    loading: documentsLoading,
    commitInvoiceArchive,
    updateInvoiceDocument,
    deleteInvoiceDocument,
    removeInvoiceLink,
    swapInvoiceLink,
    findInvoiceDocument,
  } = useInvoiceDocuments(user);
  // Feeds InvoiceIntakePanel's classification suggester (T5, acceptance #1):
  // rules come from the same hook every other classification surface uses
  // (Classifier, Rules, Movimientos); history is every past CXP/CXC.
  const { rules } = useClassificationRules(user);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const obligations = [...ledger.payables, ...ledger.receivables];

  /**
   * writeAuditLogEntry wired to each of the three invoice-amendment effects
   * below: a full `before` snapshot of the archive doc plus the mandatory
   * reason, exactly what applyInvoiceEdit/Delete/Replace already assembled
   * into the plan's audit entry.
   */
  const writeAmendAudit = (entry) =>
    writeAuditLogEntry({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      description:
        entry.action === 'update'
          ? `Factura archivada corregida: ${entry.before?.invoiceNumber || entry.entityId}`
          : entry.action === 'delete'
            ? `Factura archivada eliminada: ${entry.before?.invoiceNumber || entry.entityId}`
            : `PDF de factura reemplazado: ${entry.before?.invoiceNumber || entry.entityId}`,
      userEmail: user.email,
      before: entry.before,
      metadata: { reason: entry.reason || '', partial: Boolean(entry.partial), ...(entry.metadata || {}) },
    });

  const handleEditInvoice = (invoiceDocument, form) =>
    applyInvoiceEdit(
      { invoiceDocument, obligations, bankMovements: ledger.postedMovements, form, projects: ledger.projects },
      {
        updateObligation: async (family, id, patch) => {
          const row = obligations.find((entry) => entry.kind === family && entry.id === id);
          if (!row) return { success: false, error: new Error('La obligación vinculada ya no existe') };
          return family === 'payable'
            ? ledger.actions.payables.updatePayable(row, patch)
            : ledger.actions.receivables.updateReceivable(row, patch);
        },
        updateMovement: async (id, patch) => {
          const result = await ledger.actions.bankMovements.updateBankMovement(id, patch);
          if (!result?.success) throw result?.error || new Error('No se pudo actualizar el movimiento bancario');
        },
        updateArchive: (sha256, patch) => updateInvoiceDocument(sha256, patch),
        writeAudit: writeAmendAudit,
      },
    );

  const handleDeleteInvoice = (invoiceDocument, { reason, cancelObligations }) =>
    applyInvoiceDelete(
      { invoiceDocument, obligations, bankMovements: ledger.postedMovements, cancelObligations, reason },
      {
        removeBackReference: (family, id, sha256) => removeInvoiceLink(family, id, sha256),
        // The DELETE reason (already validated by planInvoiceDelete) is
        // re-purposed as a context-aware auditTrail detail on the cancelled
        // obligation itself — otherwise it always said the same generic
        // "cancelada desde la mesa maestra" no matter why.
        cancelObligation: async (family, id, cancelReason) => {
          const row = obligations.find((entry) => entry.kind === family && entry.id === id);
          if (!row) return { success: false, error: new Error('La obligación vinculada ya no existe') };
          const options = cancelReason
            ? {
                reason: `Anulada al eliminar la factura archivada Nº ${invoiceDocument.invoiceNumber || invoiceDocument.id}. Motivo: ${cancelReason}`,
                source: 'invoice-archive-delete',
              }
            : undefined;
          return family === 'payable'
            ? ledger.actions.payables.cancelPayable(row, options)
            : ledger.actions.receivables.cancelReceivable(row, options);
        },
        deleteChunks: (sha256, chunkCount) => deleteInvoicePdf({ db, appId, sha256, chunkCount }),
        deleteArchive: (sha256) => deleteInvoiceDocument(sha256),
        writeAudit: writeAmendAudit,
      },
    );

  const handleReplaceInvoice = (invoiceDocument, newFile, bytes, reason) =>
    applyInvoiceReplace(
      { invoiceDocument, newFile, bytes, reason },
      {
        uploadPdf: ({ bytes: uploadBytes, expectedSha256 }) => uploadInvoicePdf({ db, appId, bytes: uploadBytes, expectedSha256 }),
        commitNewDocument: ({ document: newDocument }) => commitInvoiceArchive({ document: newDocument, linkUpdates: [] }),
        swapBackReference: (family, id, swap) => swapInvoiceLink(family, id, swap),
        deleteOldChunks: (oldSha256, chunkCount) => deleteInvoicePdf({ db, appId, sha256: oldSha256, chunkCount }),
        deleteOldArchive: (oldSha256) => deleteInvoiceDocument(oldSha256),
        writeAudit: writeAmendAudit,
        findInvoiceDocument: (sha256) => findInvoiceDocument(sha256),
      },
    );

  const selectedDocument = documents.find((document) => document.id === selectedId) || null;

  const handleViewInvoice = (sha256) => {
    setSelectedId(sha256);
    setIntakeOpen(false);
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        section="Facturas"
        title="Facturas"
        subtitle="Ingreso, archivo privado y visor de facturas PDF"
        actions={
          <Button variant="primary" onClick={() => setIntakeOpen((open) => !open)}>
            Nueva factura
          </Button>
        }
      />

      {ledger.loading ? (
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      ) : (
        <MonthlyInvoicingChart
          movements={ledger.postedMovements}
          receivables={ledger.receivables}
          payables={ledger.payables}
        />
      )}

      {intakeOpen && !ledger.loading && (
        <InvoiceIntakePanel
          user={user}
          payables={ledger.payables}
          receivables={ledger.receivables}
          projects={ledger.projects}
          rules={rules}
          history={[...ledger.payables, ...ledger.receivables]}
          createPayable={ledger.actions.payables.createPayable}
          createReceivable={ledger.actions.receivables.createReceivable}
          commitInvoiceArchive={commitInvoiceArchive}
          onViewInvoice={handleViewInvoice}
          onClose={() => setIntakeOpen(false)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <InvoiceArchiveList
          documents={documents}
          loading={documentsLoading}
          onSelect={(document) => setSelectedId(document.id)}
        />
        <InvoiceViewer
          document={selectedDocument}
          user={user}
          userRole={userRole}
          payables={ledger.payables}
          receivables={ledger.receivables}
          bankMovements={ledger.postedMovements}
          projects={ledger.projects}
          onClose={() => setSelectedId(null)}
          onEditInvoice={handleEditInvoice}
          onReplaceInvoice={handleReplaceInvoice}
          onDeleteInvoice={handleDeleteInvoice}
        />
      </div>
    </div>
  );
};

export default Facturas;
