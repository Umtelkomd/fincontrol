import React from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Badge } from '@/components/ui/nexus';

const safeString = (value) => {
 if (value == null) return '';
 if (typeof value === 'object') return JSON.stringify(value);
 return String(value);
};

const DuplicateReviewPanel = ({ duplicateGroups, onDelete }) => {
 if (duplicateGroups.length === 0) return null;

 return (
 <section className="space-y-4 rounded-md border border-[var(--color-line-s)] bg-transparent p-5">
 <div className="flex items-center gap-2">
 <RotateCcw size={16} className="text-[var(--color-fg-4)]" />
 <h3 className="text-[15px] font-medium text-[var(--color-fg-1)]">
 {duplicateGroups.length} grupo{duplicateGroups.length !== 1 ? 's' : ''} de posibles duplicados
 </h3>
 </div>
 <p className="text-[12px] text-[var(--color-fg-3)]">
 Revisa cada grupo. Elige cuál registro conservar y elimina el duplicado.
 </p>
 {duplicateGroups.map((group, gIdx) => (
 <div key={gIdx} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <p className="mb-3 label-mono text-[var(--color-fg-3)]">
 Grupo {gIdx + 1} — €{group.original.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} · {group.original.type === 'income' ? 'Ingreso' : 'Gasto'}
 </p>
 <div className="space-y-2">
 {[group.original, ...group.duplicates].map((record) => (
 <div key={record.id} className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <div className="flex-1 min-w-0">
 <p className="truncate text-[13px] font-medium text-[var(--color-fg-1)]">{safeString(record.description)}</p>
 <p className="mt-0.5 text-[11px] text-[var(--color-fg-3)]">
 {record.date} · {record.project || 'Sin proyecto'} · {record.recordFamilyLabel || record.recordFamily}
 {record.lastEditor ? ` · ${record.lastEditor}` : ''}
 </p>
 </div>
 <span className={`flex-shrink-0 font-mono text-[13px] tabular-nums ${record.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 €{record.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
 </span>
 <Badge variant="neutral">{record.statusLabel || record.status}</Badge>
 <Button variant="danger" size="sm" onClick={() => onDelete(record)}>
 Eliminar
 </Button>
 </div>
 ))}
 </div>
 </div>
 ))}
 </section>
 );
};

export default DuplicateReviewPanel;
