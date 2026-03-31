import { X } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const Field = ({ label, value }) => value ? (
  <div>
    <p className="text-[10px] uppercase tracking-[0.14em] text-[#636366]">{label}</p>
    <p className="mt-0.5 text-sm text-[#e5e5ea]">{String(value)}</p>
  </div>
) : null;

const FAMILY_LABELS = { legacy: 'Registro histórico', movement: 'Movimiento bancario', receivable: 'Factura CXC', payable: 'Factura CXP' };
const STATUS_LABELS = { paid: 'Liquidado', pending: 'Pendiente', partial: 'Parcial', overdue: 'Vencido', void: 'Anulado', cancelled: 'Anulado', issued: 'Emitida', settled: 'Liquidada' };

const RecordDetailModal = ({ record, onClose, onEdit, onChangeStatus, userRole }) => {
  if (!record) return null;

  const r = record;
  const raw = r.rawRecord || r.raw || r;
  const isIncome = r.type === 'income' || r.kind === 'receivable' || r.direction === 'in';
  const amount = r.amount || r.grossAmount || raw.grossAmount || raw.amount || 0;
  const status = r.status || raw.status || 'pending';
  const family = r.recordFamily || r.kind || r.source || '';
  const description = r.description || raw.description || '';
  const date = r.date || r.issueDate || raw.issueDate || raw.postedDate || raw.date || '';
  const project = r.project || r.projectName || raw.projectName || '';
  const costCenter = r.costCenter || r.costCenterId || raw.costCenterId || '';
  const category = r.categoryLabel || r.category || raw.category || '';
  const counterparty = r.counterpartyName || raw.counterpartyName || raw.client || raw.vendor || '';
  const docNumber = r.documentNumber || raw.documentNumber || raw.invoiceNumber || '';
  const dueDate = raw.dueDate || r.dueDate || '';
  const createdBy = raw.createdBy || r.createdBy || '';
  const lastEditor = r.lastEditor || raw.updatedBy || raw.lastModifiedBy || '';
  const paidAmount = Number(r.paidAmount || raw.paidAmount || 0);
  const openAmount = Number(r.openAmount || raw.openAmount || 0);
  const payments = raw.payments || r.payments || [];
  const rawNotes = raw.notes || r.notes || [];
  const notes = (Array.isArray(rawNotes) ? rawNotes : []).filter((n) => typeof n === 'object');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-[#1c1c1e] rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-hidden animate-scaleIn flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-start shrink-0">
          <div className="min-w-0 flex-1">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${isIncome ? 'bg-[rgba(48,209,88,0.15)] text-[#30d158]' : 'bg-[rgba(255,69,58,0.15)] text-[#ff453a]'}`}>
              {isIncome ? 'Ingreso' : 'Egreso'} · {FAMILY_LABELS[family] || family}
            </span>
            <h3 className="mt-2 text-lg font-bold text-[#e5e5ea] break-words">{description}</h3>
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 text-[#636366] hover:text-[#98989d] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-baseline justify-between">
            <span className={`text-[32px] font-bold tracking-tight ${isIncome ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
              {isIncome ? '+' : '-'}{formatCurrency(amount)}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === 'paid' || status === 'settled' ? 'bg-[rgba(48,209,88,0.15)] text-[#30d158]' :
              status === 'void' || status === 'cancelled' ? 'bg-[rgba(142,142,147,0.15)] text-[#8e8e93]' :
              status === 'overdue' ? 'bg-[rgba(255,69,58,0.15)] text-[#ff453a]' :
              'bg-[rgba(255,159,10,0.15)] text-[#ff9f0a]'
            }`}>
              {STATUS_LABELS[status] || status}
            </span>
          </div>

          {paidAmount > 0 && openAmount > 0 && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#2c2c2e]">
                <div className="h-full rounded-full bg-[#30d158]" style={{ width: `${amount > 0 ? (paidAmount / amount) * 100 : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-[#8e8e93]">Pagado: {formatCurrency(paidAmount)} / {formatCurrency(amount)} · Abierto: {formatCurrency(openAmount)}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#15161a] p-4">
            <Field label="Fecha" value={date} />
            <Field label="Origen" value={r.sourceLabel || r.source} />
            <Field label="Proyecto" value={project} />
            <Field label="Centro de costo" value={costCenter} />
            <Field label="Categoría" value={category} />
            <Field label="Contraparte" value={counterparty} />
            <Field label="No. documento" value={docNumber} />
            <Field label="Familia" value={FAMILY_LABELS[family] || family} />
            {dueDate && <Field label="Vencimiento" value={dueDate} />}
            {createdBy && <Field label="Creado por" value={createdBy} />}
            {lastEditor && <Field label="Última edición" value={lastEditor} />}
          </div>

          {payments.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#636366]">Pagos registrados ({payments.length})</p>
              <div className="space-y-1.5">
                {payments.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#15161a] px-3 py-2">
                    <div>
                      <p className="text-sm text-[#e5e5ea]">{p.method || 'Pago'}</p>
                      <p className="text-[11px] text-[#636366]">{p.date} {p.user ? `· ${p.user}` : ''}</p>
                    </div>
                    <span className="text-sm font-semibold text-[#30d158]">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#636366]">Notas ({notes.length})</p>
              <div className="space-y-1.5">
                {notes.map((n, idx) => (
                  <div key={idx} className={`rounded-lg border px-3 py-2 text-sm ${n.type === 'system' ? 'border-[rgba(255,255,255,0.04)] bg-[#15161a] text-[#636366]' : 'border-[rgba(255,159,10,0.12)] bg-[rgba(255,159,10,0.06)] text-[#c7c7cc]'}`}>
                    <p>{n.text}</p>
                    <p className="mt-1 text-[10px] text-[#48484a]">{n.timestamp ? new Date(n.timestamp).toLocaleString('es-ES') : ''} {n.user ? `· ${n.user}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[rgba(255,255,255,0.08)] px-6 py-3 flex gap-2">
          {onEdit && userRole === 'admin' && (
            <button type="button" onClick={() => { onClose(); onEdit(record); }} className="flex-1 rounded-lg bg-[#2c2c2e] px-4 py-2.5 text-sm font-medium text-[#64d2ff] hover:bg-[#3a3a3c]">Editar</button>
          )}
          {onChangeStatus && userRole === 'admin' && (
            <button type="button" onClick={() => { onClose(); onChangeStatus(record); }} className="flex-1 rounded-lg bg-[#2c2c2e] px-4 py-2.5 text-sm font-medium text-[#ff9f0a] hover:bg-[#3a3a3c]">Cambiar estado</button>
          )}
          <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-[#2c2c2e] px-4 py-2.5 text-sm font-medium text-[#c7c7cc] hover:bg-[#3a3a3c]">Cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default RecordDetailModal;
