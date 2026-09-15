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
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useInvoiceDocuments } from '../../hooks/useInvoiceDocuments';
import MonthlyInvoicingChart from './components/MonthlyInvoicingChart';
import InvoiceIntakePanel from './components/InvoiceIntakePanel';
import InvoiceArchiveList from './components/InvoiceArchiveList';
import InvoiceViewer from './components/InvoiceViewer';

const Facturas = ({ user }) => {
  const ledger = useFinanceLedgerContext();
  const { documents, loading: documentsLoading, commitInvoiceArchive } = useInvoiceDocuments(user);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

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
          payables={ledger.payables}
          receivables={ledger.receivables}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  );
};

export default Facturas;
