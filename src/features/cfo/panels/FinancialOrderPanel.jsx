import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import { Alert, Badge, KPI, KPIGrid, Panel, Table } from '@/components/ui/nexus';
import { formatCurrency } from '../../../utils/formatters';
import { summarizeCFOOrder } from '../lib/cfoMetrics';

const money = (value) => `${formatCurrency(value)} €`;

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const StatusBadge = ({ status, overdue }) => {
  const normalized = String(status || '').toLowerCase();
  let variant = 'neutral';
  if (overdue) variant = 'warn';
  if (['settled', 'paid', 'pagado'].includes(normalized)) variant = 'ok';
  if (['cancelled', 'void'].includes(normalized)) variant = 'err';
  if (normalized === 'partial') variant = 'info';
  return <Badge variant={variant}>{status || 'issued'}</Badge>;
};

const compactText = (value, fallback = '—') => (
  <span className="block max-w-[220px] truncate" title={value || fallback}>
    {value || fallback}
  </span>
);

const buildDocumentColumns = ({ counterpartyLabel, documentLabel }) => [
  {
    key: 'counterpartyName',
    label: counterpartyLabel,
    render: (_, value) => compactText(value, 'Sin contraparte'),
  },
  {
    key: 'documentNumber',
    label: documentLabel,
    render: (row, value) => compactText(value || row.description, 'Sin documento'),
  },
  {
    key: 'projectName',
    label: 'Proyecto',
    render: (row, value) => compactText(value || row.projectId, 'Sin proyecto'),
  },
  {
    key: 'dueDate',
    label: 'Vence',
    render: (_, value) => formatDate(value),
    mono: true,
  },
  {
    key: 'openAmount',
    label: 'Abierto',
    align: 'right',
    mono: true,
    render: (_, value) => money(value),
  },
  {
    key: 'status',
    label: 'Estado',
    align: 'center',
    render: (row, value) => <StatusBadge status={value} overdue={row.overdue} />,
  },
];

const qualityVariant = (variant) => {
  if (variant === 'err') return 'err';
  if (variant === 'warn') return 'warn';
  if (variant === 'ok') return 'ok';
  return 'info';
};

const FinancialOrderPanel = ({ snapshot }) => {
  const summary = useMemo(() => {
    if (!snapshot) return null;
    return summarizeCFOOrder(snapshot);
  }, [snapshot]);

  if (!summary) return null;

  const { cash, receivables, payables, bankMovements, dataQuality } = summary;
  const payablesCoveredByCash =
    payables.openTotal > 0 ? Math.round((cash.cashToday / payables.openTotal) * 100) : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Orden financiero"
        meta={`Corte ${formatDate(summary.asOfDate)}`}
        padding
      >
        <div className="space-y-4">
          <KPIGrid cols={3}>
            <KPI
              label="Cash hoy"
              value={money(cash.cashToday)}
              meta={`${cash.bankName || 'Banco'} · ${payablesCoveredByCash ?? '—'}% CXP`}
              tone={cash.cashToday >= payables.overdueTotal ? 'ok' : 'warn'}
              icon={Wallet}
            />
            <KPI
              label="CXP abierta"
              value={money(payables.openTotal)}
              meta={`${payables.count} registros · ${payables.overdueCount} vencidos`}
              tone={payables.openTotal > 0 ? 'warn' : 'ok'}
              icon={CreditCard}
            />
            <KPI
              label="CXP vencida"
              value={money(payables.overdueTotal)}
              meta={payables.overdueTotal > 0 ? 'Riesgo operativo inmediato' : 'Sin vencidos'}
              tone={payables.overdueTotal > 0 ? 'err' : 'ok'}
              icon={AlertTriangle}
            />
            <KPI
              label="CXC abierta"
              value={money(receivables.openTotal)}
              meta={`${receivables.count} registros · ${receivables.overdueCount} vencidos`}
              tone={receivables.openTotal > 0 ? 'info' : 'ok'}
              icon={ReceiptText}
            />
            <KPI
              label="Neto 30d"
              value={money(bankMovements.net30)}
              meta={`In ${money(bankMovements.totalIn30)} · out ${money(bankMovements.totalOut30)}`}
              tone={bankMovements.net30 >= 0 ? 'ok' : 'err'}
              icon={bankMovements.net30 >= 0 ? ArrowUpRight : ArrowDownRight}
            />
            <KPI
              label="Neto 90d"
              value={money(bankMovements.net90)}
              meta={`${bankMovements.count} movimientos en snapshot`}
              tone={bankMovements.net90 >= 0 ? 'ok' : 'err'}
              icon={CircleDollarSign}
            />
          </KPIGrid>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel
              title="Pagos urgentes"
              meta={`${payables.topUrgent.length} principales`}
              padding={false}
            >
              <Table
                columns={buildDocumentColumns({
                  counterpartyLabel: 'Proveedor',
                  documentLabel: 'Concepto/doc.',
                })}
                rows={payables.topUrgent}
              />
            </Panel>

            <Panel
              title="Cobros pendientes"
              meta={`${receivables.topOpen.length} principales`}
              padding={false}
            >
              <Table
                columns={buildDocumentColumns({
                  counterpartyLabel: 'Cliente',
                  documentLabel: 'Factura/doc.',
                })}
                rows={receivables.topOpen}
              />
            </Panel>
          </div>
        </div>
      </Panel>

      <Panel
        title="Problemas de datos"
        meta={`${dataQuality.warnings.length} alertas`}
        padding
      >
        {dataQuality.warnings.length === 0 ? (
          <Alert variant="ok" title="Datos CFO consistentes">
            No se detectaron problemas básicos en el snapshot usado por la vista CFO.
          </Alert>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {dataQuality.warnings.map((warning) => (
              <Alert
                key={warning.id}
                variant={qualityVariant(warning.variant)}
                title={warning.title}
              >
                {warning.message}
              </Alert>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default FinancialOrderPanel;
