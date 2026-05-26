import { useMemo, useState } from 'react';
import {
 AlertTriangle,
 ArrowDownLeft,
 BadgeEuro,
 Clock3,
 Edit3,
 Filter,
 History,
 Link2,
 Search,
} from 'lucide-react';
import CanonicalRecordModal from '../../components/finance/CanonicalRecordModal';
import RecordAuditTrailModal from '../../components/finance/RecordAuditTrailModal';
import HelpButton from '../../components/ui/HelpButton';
import LinkBankMovementModal from '../../components/ui/LinkBankMovementModal';
import RecordDetailModal from '../../components/ui/RecordDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { buildFinanceOrderRecord } from '../financeOrders/orderRecordUtils';
import { useAuditLog } from '../../hooks/useAuditLog';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useCategories } from '../../hooks/useCategories';
import { useClassifier } from '../../hooks/useClassifier';
import { useCostCenters } from '../../hooks/useCostCenters';
import { usePayables } from '../../hooks/usePayables';
import { useProjects } from '../../hooks/useProjects';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { daysUntil } from '../../finance/utils';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { KPIGrid, KPI, Badge, Button } from '@/components/ui/nexus';

const statusLabels = {
 issued: 'Emitida',
 partial: 'Parcial',
 overdue: 'Vencida',
 settled: 'Liquidada',
 cancelled: 'Cancelada',
};

const filters = [
 { id: 'all', label: 'Todas' },
 { id: 'issued', label: 'Emitidas' },
 { id: 'partial', label: 'Parciales' },
 { id: 'overdue', label: 'Vencidas' },
 { id: 'settled', label: 'Liquidadas' },
];

const bucketColor = ['var(--color-warn)', 'var(--color-accent)', 'var(--color-accent)', 'var(--color-accent)'];

const AgingBar = ({ buckets }) => {
 const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
 if (total <= 0) return null;

 return (
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="mb-4 flex items-center justify-between">
 <div>
  <p className="label-mono text-[var(--color-fg-4)]">Antigüedad</p>
  <h3 className="font-display mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Deuda vencida por tramos</h3>
 </div>
 <Badge variant="neutral">{formatCurrency(total)}</Badge>
 </div>
  <div className="mb-4 flex h-3 overflow-hidden rounded-md bg-[var(--color-line)]">
 {buckets.map((bucket, index) =>
 bucket.total > 0 ? (
 <div key={bucket.label} style={{ width: `${(bucket.total / total) * 100}%`, backgroundColor: bucketColor[index] }} />
 ) : null,
 )}
 </div>
 <div className="grid gap-3 sm:grid-cols-4">
 {buckets.map((bucket, index) => (
  <div key={bucket.label} className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-3">
 <div className="mb-2 flex items-center gap-2">
 <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: bucketColor[index] }} />
  <span className="label-mono text-[var(--color-fg-4)]">{bucket.label}</span>
 </div>
  <p className="font-mono text-sm tabular-nums text-[var(--color-fg-1)]">{formatCurrency(bucket.total)}</p>
 </div>
 ))}
 </div>
 </div>
 );
};

// Identifies a doc that was settled/partially paid before the
// "always link to bankMovement" rule was introduced.
const isLegacyPayment = (row) => {
 if (!row) return false;
 const status = row.status;
 if (status !== 'settled' && status !== 'partial') return false;
 const payments = Array.isArray(row.payments) ? row.payments : [];
 if (payments.length === 0) return false;
 return !payments.some((p) => p && p.bankMovementId);
};

const CXPIndependiente = ({ user, userRole }) => {
 const { showToast } = useToast();
 const metrics = useTreasuryMetrics({ user });
 const { bankMovements } = useBankMovements(user);
 const { linkPayablesToMovement, forceReconcilePayables } = useClassifier(user);
 const { logs: auditLogs, loading: auditLogsLoading } = useAuditLog(user);
 const { expenseCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { projects } = useProjects(user);
 const { updatePayable } = usePayables(user);

 const [searchTerm, setSearchTerm] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');
 const [selectedRow, setSelectedRow] = useState(null);
 const [loadingId, setLoadingId] = useState(null);
 const [detailRecord, setDetailRecord] = useState(null);
 const [editingRecord, setEditingRecord] = useState(null);
 const [auditRecord, setAuditRecord] = useState(null);
 const [submittingEdit, setSubmittingEdit] = useState(false);

 const visiblePayables = useMemo(
 () => metrics.payables.filter((entry) => entry.source === 'payable'),
 [metrics.payables],
 );

 const rows = useMemo(() => {
 return visiblePayables
 .filter((entry) => {
 if (statusFilter === 'partial') {
 if (entry.stage !== 'partial' && !(entry.paidAmount > 0 && entry.openAmount > 0)) return false;
 } else if (statusFilter !== 'all' && entry.status !== statusFilter) {
 return false;
 }
 if (!searchTerm.trim()) return true;
 const query = searchTerm.toLowerCase();
 return (
 (entry.counterpartyName || '').toLowerCase().includes(query) ||
 (entry.description || '').toLowerCase().includes(query) ||
 (entry.documentNumber || '').toLowerCase().includes(query) ||
 (entry.projectName || '').toLowerCase().includes(query)
 );
 })
 .sort((left, right) => (right.dueDate || '').localeCompare(left.dueDate || ''));
 }, [visiblePayables, searchTerm, statusFilter]);

 const openRows = visiblePayables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status));
 const overdueRows = metrics.overduePayables.filter((entry) => entry.source === 'payable');
 const upcomingRows = metrics.upcomingPayables.filter((entry) => entry.source === 'payable');
 const visiblePayablesAging = useMemo(() => {
 const buckets = [
 { label: '0-30d', total: 0 },
 { label: '31-60d', total: 0 },
 { label: '61-90d', total: 0 },
 { label: '>90d', total: 0 },
 ];

 openRows.forEach((entry) => {
 if (!entry.dueDate) return;
 const overdueDays = Math.max(0, -daysUntil(entry.dueDate));
 if (overdueDays === 0) return;
 if (overdueDays <= 30) buckets[0].total += entry.openAmount || 0;
 else if (overdueDays <= 60) buckets[1].total += entry.openAmount || 0;
 else if (overdueDays <= 90) buckets[2].total += entry.openAmount || 0;
 else buckets[3].total += entry.openAmount || 0;
 });

 return buckets;
 }, [openRows]);
 const totalOpen = openRows.reduce((sum, entry) => sum + entry.openAmount, 0);
 const totalOverdue = overdueRows.reduce((sum, entry) => sum + entry.openAmount, 0);
 const totalPartial = visiblePayables
 .filter((entry) => entry.stage === 'partial' || (entry.paidAmount > 0 && entry.openAmount > 0))
 .reduce((sum, entry) => sum + entry.paidAmount, 0);
 const dueSoon = upcomingRows.reduce((sum, entry) => sum + entry.openAmount, 0);
 const reconcileDocuments = useMemo(
 () => rows.filter((entry) =>
 entry.source === 'payable' &&
 entry.status !== 'cancelled' &&
 Number(entry.openAmount || entry.grossAmount || entry.amount || 0) > 0,
 ),
 [rows],
 );

 const canAct = userRole === 'admin' || userRole === 'manager';
 const wrapRecord = (row) => buildFinanceOrderRecord(row, 'payable');
 const toOrderRecord = (row) => (row?.rawRecord && row?.recordFamily === 'payable' ? row : wrapRecord(row));

 const resolveProjectName = (projectId) => {
 const project = projects.find((entry) => entry.id === projectId);
 return project?.name || project?.displayName || project?.code || projectId || '';
 };

 const handleOpenDetail = (row) => {
 setDetailRecord(toOrderRecord(row));
 };

 const handleOpenEdit = (row) => {
 const record = toOrderRecord(row);
 if (!record?.canEdit || record.rawRecord?.source !== 'payable') return;
 setEditingRecord(record);
 };

 const handleOpenAudit = (row) => {
 setAuditRecord(toOrderRecord(row));
 };

 const handleEditSubmit = async (formData) => {
 if (!editingRecord) return false;

 setSubmittingEdit(true);
 try {
 const payload = {
 ...formData,
 amount: Number(formData.amount) || 0,
 projectName: resolveProjectName(formData.projectId),
 };
 const result = await updatePayable(editingRecord.rawRecord, payload);
 if (!result?.success) {
 throw result?.error || new Error('No se pudo actualizar la CXP');
 }
 showToast('CXP actualizada correctamente', 'success');
 setEditingRecord(null);
 return true;
 } catch (error) {
 showToast(error.message || 'No se pudo actualizar la CXP', 'error');
 return false;
 } finally {
 setSubmittingEdit(false);
 }
 };

 // Política UMTELKOMD: cambiar status de una CXP SIEMPRE requiere
 // vincular un bankMovement existente (importado de DATEV).
 const handleLinkMovement = async (movement, selectedDocuments = [selectedRow]) => {
 if (!selectedRow) return { success: false, error: 'Sin CXP seleccionada' };
 if (selectedRow.source !== 'payable') {
 return {
 success: false,
 error: 'Las CXP legacy no se pueden conciliar. Quedan como históricas.',
 };
 }
 const documentsToLink = selectedDocuments.filter((entry) => entry?.source === 'payable');
 if (documentsToLink.length === 0) {
 return { success: false, error: 'Seleccioná al menos una CXP actual' };
 }
 setLoadingId(selectedRow.id);
 const result = await linkPayablesToMovement(movement, documentsToLink);
 setLoadingId(null);
 if (result.success) {
 showToast(
 result.count > 1
 ? `${result.count} CXP conciliadas con una entrada DATEV`
 : result.status === 'settled'
 ? 'CXP liquidada y conciliada con DATEV'
 : 'Pago parcial conciliado con DATEV',
 'success',
 );
 } else {
 showToast(result.error?.message || 'Error al vincular movimiento', 'error');
 }
 return result;
 };

 const handleForceReconcile = async (selectedDocuments, options = {}) => {
 if (userRole !== 'admin') {
 const error = new Error('Solo un administrador puede forzar conciliación sin DATEV');
 showToast(error.message, 'error');
 return { success: false, error };
 }
 const documentsToLink = selectedDocuments.filter((entry) => entry?.source === 'payable');
 if (documentsToLink.length === 0) {
 return { success: false, error: 'Seleccioná al menos una CXP actual' };
 }
 setLoadingId(selectedRow?.id || documentsToLink[0]?.id);
 const result = await forceReconcilePayables(documentsToLink, {
 ...options,
 userRole,
 });
 setLoadingId(null);
 if (result.success) {
 showToast(`${result.count} CXP conciliada(s) sin DATEV por admin`, 'success');
 } else {
 showToast(result.error?.message || 'Error al forzar conciliación', 'error');
 }
 return result;
 };

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-28">
  <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12">
  <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-7">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
 <div>
  <p className="mb-3 label-mono text-[var(--color-fg-3)]">Cuentas por pagar</p>
  <h2 className="font-display text-[32px] font-light tracking-tight text-[var(--color-fg-1)]">
 Control de pagos, deuda y vencimientos.{' '}
 <HelpButton title="Cuentas por pagar">
 <p><strong>Deuda abierta</strong> — Total de facturas por pagar que aun no se han liquidado.</p>
 <p><strong>Pagado parcial</strong> — Abonos ya realizados en facturas que aun no estan 100% pagadas.</p>
 <p><strong>Vencido</strong> — Pagos cuya fecha limite ya paso.</p>
 <p><strong>Ventana 14d</strong> — Pagos que vencen en los proximos 14 dias.</p>
 </HelpButton>
 </h2>
  <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--color-fg-4)]">
 Revisa los compromisos abiertos y conviértelos en salida real solo cuando el pago se registra.
 </p>
 </div>
 </div>
 </section>

 <KPIGrid cols={4}>
 <KPI
 label="Deuda abierta"
 value={formatCurrency(totalOpen)}
 meta={`${openRows.length} documentos activos`}
 tone="warn"
 icon={BadgeEuro}
 onClick={() => setStatusFilter('all')}
 />
 <KPI
 label="Pagado parcial"
 value={formatCurrency(totalPartial)}
 meta={totalPartial > 0 ? 'Abonos realizados en facturas aún no liquidadas' : 'Sin abonos parciales — todas pendientes o liquidadas'}
 icon={ArrowDownLeft}
 onClick={() => setStatusFilter('partial')}
 />
 <KPI
 label="Vencido"
 value={formatCurrency(totalOverdue)}
 meta={`${overdueRows.length} documentos fuera de plazo`}
 tone="err"
 icon={AlertTriangle}
 onClick={() => setStatusFilter('overdue')}
 />
 <KPI
 label="Ventana 14d"
 value={formatCurrency(dueSoon)}
 meta={`${upcomingRows.length} pagos proximos`}
 tone="warn"
 icon={Clock3}
 onClick={() => setStatusFilter('issued')}
 />
 </KPIGrid>

 <AgingBar buckets={visiblePayablesAging} />

  <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
 <div className="relative w-full xl:max-w-sm">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={16} />
 <input
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] py-3 pl-10 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition-all placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 placeholder="Buscar proveedor, documento o proyecto"
 value={searchTerm}
 onChange={(event) => setSearchTerm(event.target.value)}
 />
 </div>
 <div className="flex flex-wrap items-center gap-2">
   <div className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 label-mono text-[var(--color-fg-4)]">
 <Filter size={14} />
 Estado
 </div>
 {filters.map((filter) => (
 <button
 key={filter.id}
 type="button"
 onClick={() => setStatusFilter(filter.id)}
  className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
 statusFilter === filter.id
  ? 'border-[var(--color-accent)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
  : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {filter.label}
 </button>
 ))}
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full min-w-[980px] text-left">
 <thead>
  <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
 <th className="px-4 py-3">Proveedor</th>
 <th className="px-4 py-3">Documento</th>
 <th className="px-4 py-3">Proyecto</th>
 <th className="px-4 py-3 text-right">Importe</th>
 <th className="px-4 py-3 text-right">Abierto</th>
 <th className="px-4 py-3 text-center">Vence</th>
 <th className="px-4 py-3 text-center">Estado</th>
 <th className="px-4 py-3 text-center">Origen</th>
 {canAct && <th className="px-4 py-3 text-right">Acciones</th>}
 </tr>
 </thead>
  <tbody className="divide-y divide-[var(--color-line)]">
 {rows.map((row) => {
 const isLegacy = isLegacyPayment(row);
 const canReconcile =
 row.source === 'payable' &&
 row.status !== 'cancelled' &&
 (row.status !== 'settled' || isLegacy);
 return (
   <tr key={row.id} {...rowButtonProps(() => handleOpenDetail(row), 'hover:bg-[var(--color-bg-2)]')}>
 <td className="px-4 py-4">
  <p className="text-sm font-medium text-[var(--color-fg-1)]">{row.counterpartyName}</p>
  <p className="text-xs text-[var(--color-fg-3)]">{row.description || 'Sin descripción'}</p>
 </td>
  <td className="px-4 py-4 text-sm text-[var(--color-fg-1)]">{row.documentNumber || 'Sin documento'}</td>
  <td className="px-4 py-4 text-sm text-[var(--color-fg-3)]">{row.projectName || 'Sin proyecto'}</td>
  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-[var(--color-fg-1)]">{formatCurrency(row.grossAmount)}</td>
  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-[var(--color-warn)]">{formatCurrency(row.openAmount)}</td>
  <td className="px-4 py-4 text-center text-sm text-[var(--color-fg-3)]">{row.dueDate ? formatDate(row.dueDate) : 'Sin fecha'}</td>
 <td className="px-4 py-4 text-center">
 <div className="flex flex-col items-center gap-1">
 <Badge
 variant={
 row.status === 'settled' ? 'ok'
 : row.status === 'overdue' ? 'err'
 : row.status === 'partial' ? 'warn'
 : 'neutral'
 }
 >
 {statusLabels[row.status]}
 </Badge>
 {isLegacy && <Badge variant="warn">Pago legacy</Badge>}
 </div>
 </td>
  <td className="px-4 py-4 text-center text-xs text-[var(--color-fg-3)]">{row.source}</td>
 {canAct && (
 <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
 <div className="flex justify-end gap-2">
 <Button
 variant="ghost"
 size="sm"
 icon={Edit3}
 disabled={row.source !== 'payable' || row.status === 'cancelled'}
 onClick={() => handleOpenEdit(row)}
 title="Editar orden CXP"
 >
 Editar
 </Button>
 <Button
 variant="secondary"
 size="sm"
 icon={History}
 onClick={() => handleOpenAudit(row)}
 title="Ver log de cambios"
 >
 Log
 </Button>
 <Button
 variant="primary"
 size="sm"
 icon={Link2}
 disabled={!canReconcile || loadingId === row.id}
 loading={loadingId === row.id}
 onClick={() => setSelectedRow(row)}
 title={
 isLegacy
 ? 'Pago legacy — vinculá el movimiento DATEV correspondiente'
 : 'Vincular con movimiento bancario'
 }
 >
 Conciliar
 </Button>
 </div>
 </td>
 )}
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </section>

 <LinkBankMovementModal
 isOpen={Boolean(selectedRow)}
 onClose={() => setSelectedRow(null)}
 doc={selectedRow}
 docKind="payable"
 documents={reconcileDocuments}
 bankMovements={bankMovements}
 onSubmit={handleLinkMovement}
 allowManualForce={userRole === 'admin'}
 onForceSubmit={handleForceReconcile}
 />

 <CanonicalRecordModal
 key={editingRecord?.id || 'cxp-editor'}
 isOpen={Boolean(editingRecord)}
 onClose={() => setEditingRecord(null)}
 record={editingRecord}
 onSubmit={handleEditSubmit}
 projects={projects}
 costCenters={costCenters}
 categories={expenseCategories}
 submitting={submittingEdit}
 />

 <RecordAuditTrailModal
 isOpen={Boolean(auditRecord)}
 onClose={() => setAuditRecord(null)}
 record={auditRecord}
 logs={auditLogs}
 loading={auditLogsLoading}
 />

 <RecordDetailModal
 record={detailRecord}
 onClose={() => setDetailRecord(null)}
 onEdit={handleOpenEdit}
 onViewAuditTrail={handleOpenAudit}
 canEdit={canAct && detailRecord?.rawRecord?.source === 'payable' && detailRecord?.canEdit}
 canViewAuditTrail={canAct}
 userRole={userRole}
 />
 </div>
 );
};

export default CXPIndependiente;
