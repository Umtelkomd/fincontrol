import { CheckCircle2, Circle, MessageSquare, Edit2, Trash2, Sparkles, ArrowUpCircle, ArrowDownCircle, RefreshCw } from 'lucide-react';
import { formatDate, formatCurrency, getDaysOverdue } from '../../utils/formatters';
import { ALERT_THRESHOLDS } from '../../constants/config';

// Safely convert any value to a renderable string
const safe = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const TransactionRow = ({ t, onToggleStatus, onDelete, onEdit, onViewNotes, onRegisterPayment, userRole, searchTerm }) => {
  const isOverdue = t.status === 'pending' && getDaysOverdue(t.date) > ALERT_THRESHOLDS.overdueDays;
  const isNew = t.hasUnreadUpdates === true;
  const isIncome = t.type === 'income';
  const daysOverdue = getDaysOverdue(t.date);

  const highlightText = (text) => {
    const str = safe(text);
    if (!searchTerm) return str;
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = str.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchTerm.toLowerCase() ?
        <mark key={i} className="bg-[rgba(245,158,11,0.2)] text-[#ff9f0a] rounded px-0.5">{part}</mark> : part
    );
  };

  const commentCount = t.notes?.filter(n => n.type === 'comment').length || 0;

  const hasRecentComments = t.notes?.some(n => {
    if (n.type !== 'comment') return false;
    const noteDate = new Date(n.timestamp);
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
    return noteDate >= oneDayAgo;
  }) || false;

  // Status badge config — dark theme
  const isPartial = t.status === 'partial';
  const paidAmount = t.paidAmount || 0;
  const remaining = t.amount - paidAmount;
  const paidPct = t.amount > 0 ? (paidAmount / t.amount) * 100 : 0;

  const getStatusConfig = () => {
    if (t.status === 'paid') {
      return {
        icon: CheckCircle2,
        text: 'Pagado',
        class: 'bg-[rgba(16,185,129,0.12)] text-[#30d158] border-[rgba(16,185,129,0.25)]'
      };
    }
    if (t.status === 'partial') {
      return {
        icon: Circle,
        text: 'Pago Parcial',
        class: 'bg-[rgba(255,159,10,0.12)] text-[#ff9f0a] border-[rgba(255,159,10,0.25)]'
      };
    }
    if (isOverdue) {
      return {
        icon: Circle,
        text: `Vencido (${daysOverdue}d)`,
        class: 'bg-[rgba(239,68,68,0.12)] text-[#ff453a] border-[rgba(239,68,68,0.25)] ring-1 ring-[rgba(239,68,68,0.2)]'
      };
    }
    return {
      icon: Circle,
      text: 'Pendiente',
      class: 'bg-[rgba(245,158,11,0.12)] text-[#ff9f0a] border-[rgba(245,158,11,0.25)]'
    };
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;

  return (
    <tr className={`
      group transition-all duration-200 border-b border-[rgba(255,255,255,0.08)] last:border-0
      ${isOverdue ? 'bg-[rgba(239,68,68,0.04)]' : 'hover:bg-[rgba(255,255,255,0.03)]'}
      ${isNew ? 'animate-pulse-glow' : ''}
    `}>
      {/* Fecha */}
      <td className="px-4 py-4 whitespace-nowrap">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[#c7c7cc]">{formatDate(t.date)}</span>
          {isOverdue && (
            <span className="text-[10px] text-[#ff453a] font-medium">Vencido</span>
          )}
        </div>
      </td>

      {/* Descripción */}
      <td className="px-4 py-4">
        <div className="flex items-start gap-3">
          <div className={`
            w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
            ${isIncome ? 'bg-[rgba(16,185,129,0.12)]' : 'bg-[rgba(239,68,68,0.12)]'}
          `}>
            {isIncome ? (
              <ArrowUpCircle className="w-5 h-5 text-[#30d158]" />
            ) : (
              <ArrowDownCircle className="w-5 h-5 text-[#ff453a]" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isNew && (
                <span className="w-2 h-2 rounded-full bg-[#00C853] flex-shrink-0" />
              )}

              <span className="text-sm font-semibold text-[#ffffff]">
                {highlightText(t.description)}
              </span>
              
              {isNew && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00C853] text-[#000000] shadow-sm">
                  <Sparkles size={10} />
                  Nueva
                </span>
              )}

              {t.isRecurring && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(255,255,255,0.06)] text-[#98989d] border border-[rgba(255,255,255,0.08)]">
                  <RefreshCw size={10} />
                  Recurrente
                </span>
              )}
              
              {commentCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(245,158,11,0.12)] text-[#ff9f0a]">
                  <MessageSquare size={10} />
                  {commentCount}
                </span>
              )}

              {hasRecentComments && (
                <span className="text-[#636366]" title="Comentario reciente">
                  <MessageSquare size={12} className="fill-[rgba(255,255,255,0.14)]" />
                </span>
              )}
            </div>
            <span className="text-xs text-[#636366] block mt-0.5">{safe(t.project)}</span>
            {isPartial && (
              <div className="mt-1.5">
                <div className="w-full max-w-[160px] h-1.5 bg-[#2c2c2e] rounded-full overflow-hidden">
                  <div className="h-full bg-[#30d158] rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                </div>
                <span className="text-[10px] text-[#8e8e93] mt-0.5 block">
                  Pagado: {formatCurrency(paidAmount)} / {formatCurrency(t.amount)}
                </span>
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Categoría */}
      <td className="px-4 py-4 hidden md:table-cell">
        <span className={`
          inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium
          ${isIncome 
            ? 'bg-[rgba(16,185,129,0.1)] text-[#30d158] border border-[rgba(16,185,129,0.2)]' 
            : 'bg-[rgba(239,68,68,0.1)] text-[#ff453a] border border-[rgba(239,68,68,0.2)]'}
        `}>
          {safe(t.category)}
        </span>
      </td>

      {/* Monto */}
      <td className="px-4 py-4 text-right whitespace-nowrap">
        <span className={`text-sm font-bold ${isIncome ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
          {isIncome ? '+' : '-'}{formatCurrency(t.amount)}
        </span>
      </td>

      {/* Estado */}
      <td className="px-4 py-4 text-center">
        <span
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
            border ${statusConfig.class}
          `}
        >
          <StatusIcon size={14} />
          {statusConfig.text}
        </span>
      </td>

      {/* Acciones */}
      <td className="px-4 py-4 text-center">
        <div className="flex items-center justify-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
          {(t.status === 'pending' || t.status === 'partial') && (userRole === 'admin' || userRole === 'manager') && onRegisterPayment && (
            <button
              onClick={() => onRegisterPayment(t)}
              className="px-2.5 py-1.5 text-xs font-semibold text-[#30d158] bg-[rgba(48,209,88,0.1)] hover:bg-[rgba(48,209,88,0.2)] border border-[rgba(48,209,88,0.2)] rounded-lg transition-all duration-200"
              title="Registrar Pago"
            >
              💰 Pagar
            </button>
          )}
          <button
            onClick={() => onViewNotes(t)}
            className={`
              p-2 rounded-lg transition-all duration-200
              ${isNew 
                ? 'text-[#00C853] hover:bg-[rgba(0,200,83,0.08)]' 
                : 'text-[#636366] hover:text-[#00C853] hover:bg-[rgba(255,255,255,0.04)]'}
            `}
            title="Ver notas"
          >
            <MessageSquare size={16} />
          </button>
          <button
            onClick={() => onEdit(t)}
            className={`
              p-2 rounded-lg transition-all duration-200
              ${isNew 
                ? 'text-[#00C853] hover:bg-[rgba(0,200,83,0.08)]' 
                : 'text-[#636366] hover:text-[#00C853] hover:bg-[rgba(255,255,255,0.04)]'}
            `}
            title="Editar"
          >
            <Edit2 size={16} />
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => onDelete(t)}
              className="p-2 text-[#636366] hover:text-[#ff453a] hover:bg-[rgba(239,68,68,0.08)] rounded-lg transition-all duration-200"
              title="Eliminar"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

export default TransactionRow;
