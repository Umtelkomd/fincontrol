import React from 'react';
import { RotateCcw } from 'lucide-react';
import TransactionRow from '../../components/ui/TransactionRow';
import { formatCurrency } from '../../utils/formatters';
import { Panel, Button, EmptyState } from '@/components/ui/nexus';

const TransactionTable = ({
 filteredRecords,
 loadingLedger,
 userRole,
 searchTerm,
 resetFilters,
 onDelete,
 onEdit,
 onViewNotes,
 onViewAuditTrail,
 onRegisterPayment,
 onVoid,
 onChangeStatus,
 onViewDetail,
}) => {
 const totalsActions = !loadingLedger && filteredRecords.length > 0 ? (
 <>
 <span className="font-mono text-[11px] tabular-nums text-[var(--color-ok)]">
 +{formatCurrency(filteredRecords.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.amount || 0), 0))}
 </span>
 <span className="font-mono text-[11px] tabular-nums text-[var(--color-err)]">
 -{formatCurrency(filteredRecords.filter(r => r.type !== 'income').reduce((s, r) => s + Number(r.amount || 0), 0))}
 </span>
 </>
 ) : null;

 return (
 <Panel
 meta={loadingLedger ? 'Sincronizando registros...' : `${filteredRecords.length} registros`}
 actions={totalsActions}
 padding={false}
 >
 {/* Desktop table */}
 <div className="hidden lg:block">
 <table className="w-full text-left">
 <thead>
 <tr className="border-b border-[var(--color-line-s)]">
 <th className="px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Fecha</th>
 <th className="px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Registro</th>
 <th className="px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Categoria</th>
 <th className="px-4 py-3 text-right font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Monto</th>
 <th className="px-4 py-3 text-center font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Estado</th>
 <th className="px-4 py-3 text-center font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--color-fg-3)]">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filteredRecords.map((record) => (
 <TransactionRow
 key={record.id}
 t={record}
 onDelete={onDelete}
 onEdit={onEdit}
 onViewNotes={onViewNotes}
 onViewAuditTrail={onViewAuditTrail}
 onRegisterPayment={onRegisterPayment}
 onVoid={onVoid}
 onChangeStatus={onChangeStatus}
 onViewDetail={onViewDetail}
 userRole={userRole}
 searchTerm={searchTerm}
 />
 ))}

 {filteredRecords.length === 0 && (
 <tr>
 <td colSpan="6">
 <EmptyState
 title="Sin transacciones"
 description="Prueba ajustar los filtros o importa nuevos registros."
 action={
 <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetFilters}>
 Limpiar filtros
 </Button>
 }
 />
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>

 {/* Mobile card list */}
 <div className="lg:hidden">
 {filteredRecords.map((record, i) => {
 const isIncome = record.type === 'income';
 const normalizedStatus = (record.status || '').toLowerCase();
 const statusColor =
 normalizedStatus === 'paid' ? 'var(--color-ok)'
 : normalizedStatus === 'partial' ? 'var(--color-warn)'
 : ['overdue'].includes(normalizedStatus) ? 'var(--color-accent)'
 : 'var(--color-fg-3)';
 return (
 <div
 key={record.id}
 className={`px-4 py-3.5 transition-colors hover:bg-[var(--color-bg-2)] ${i > 0 ? 'border-t border-[var(--color-line)]' : ''}`}
 onClick={() => onViewDetail?.(record)}
 >
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <p className="text-[13px] text-[var(--color-fg-1)] leading-snug">{record.description}</p>
 <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-4)]">
 {record.date ? new Date(record.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''} · {record.categoryLabel || record.category}
 </p>
 </div>
 <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
 <span className="font-mono text-[14px] tabular-nums text-[var(--color-fg-1)]">
 {isIncome ? '+' : '-'}{formatCurrency(record.amount)}
 </span>
 <span
 className="font-mono text-[10px] uppercase tracking-[0.06em]"
 style={{ color: statusColor }}
 >
 {record.statusLabel || record.status}
 </span>
 </div>
 </div>
 </div>
 );
 })}
 {filteredRecords.length === 0 && (
 <EmptyState
 title="Sin transacciones"
 description="Prueba ajustar los filtros o importa nuevos registros."
 action={
 <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetFilters}>
 Limpiar filtros
 </Button>
 }
 />
 )}
 </div>
 </Panel>
 );
};

export default TransactionTable;
