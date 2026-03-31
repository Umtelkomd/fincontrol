import React, { useState, useMemo } from 'react';
import { TrendingDown, Clock, AlertCircle, DollarSign, CheckCircle2, Circle, ArrowDownCircle, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDate, getDaysOverdue, safe } from '../../utils/formatters';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';

const CXP = ({
  transactions,
  userRole,
  user
}) => {
  const { registerPayment, markAsCompleted } = useTransactionActions(user);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentTransaction, setPaymentTransaction] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingId, setLoadingId] = useState(null);

  const payables = useMemo(
    () => transactions.filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'partial')),
    [transactions]
  );

  const totalPayable = payables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
  const overduePayables = payables.filter(t => getDaysOverdue(t.date) > 0);
  const totalOverdue = overduePayables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
  const dueThisWeek = payables.filter(t => {
    const d = -getDaysOverdue(t.date);
    return d >= 0 && d <= 7;
  });
  const totalDueThisWeek = dueThisWeek.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
  const partialPayables = payables.filter(t => t.status === 'partial');
  const totalPartial = partialPayables.reduce((sum, t) => sum + (t.paidAmount || 0), 0);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleMarkPagado = async (t) => {
    if (loadingId) return;
    setLoadingId(t.id);
    const result = await markAsCompleted(t);
    if (result?.success) showToast('Factura marcada como pagada');
    else showToast('Error al marcar como pagada', 'error');
    setLoadingId(null);
  };

  const handlePaymentSubmit = async (transaction, paymentData) => {
    const result = await registerPayment(transaction, paymentData);
    if (result?.success) showToast('Abono registrado correctamente');
    else showToast('Error al registrar abono', 'error');
  };

  const sorted = useMemo(() => {
    return [...payables].sort((a, b) => {
      const aOv = getDaysOverdue(a.date) > 0 ? 1 : 0;
      const bOv = getDaysOverdue(b.date) > 0 ? 1 : 0;
      if (aOv !== bOv) return bOv - aOv;
      return new Date(a.date) - new Date(b.date);
    });
  }, [payables]);

  const canAct = userRole === 'admin' || userRole === 'manager';

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-fadeIn ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#8e8e93] uppercase tracking-wide">Total por Pagar</h3>
            <TrendingDown className="text-[#ff453a]" size={20} />
          </div>
          <p className="text-3xl font-bold text-[#ff453a]">{formatCurrency(totalPayable)}</p>
          <p className="text-xs text-[#636366] mt-1">{payables.length} facturas pendientes</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#8e8e93] uppercase tracking-wide">Pagado Parcialmente</h3>
            <DollarSign className="text-[#ff9f0a]" size={20} />
          </div>
          <p className="text-3xl font-bold text-[#ff9f0a]">{formatCurrency(totalPartial)}</p>
          <p className="text-xs text-[#636366] mt-1">{partialPayables.length} facturas con abono</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#8e8e93] uppercase tracking-wide">Vencido</h3>
            <AlertCircle className="text-[#ff453a]" size={20} />
          </div>
          <p className="text-3xl font-bold text-[#ff453a]">{formatCurrency(totalOverdue)}</p>
          <p className="text-xs text-[#636366] mt-1">{overduePayables.length} facturas vencidas</p>
        </div>
        <div className="bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#8e8e93] uppercase tracking-wide">Vence Esta Semana</h3>
            <Clock className="text-[#ff9f0a]" size={20} />
          </div>
          <p className="text-3xl font-bold text-[#ff9f0a]">{formatCurrency(totalDueThisWeek)}</p>
          <p className="text-xs text-[#636366] mt-1">{dueThisWeek.length} facturas próximas</p>
        </div>
      </div>

      <div className="bg-[#1c1c1e] rounded-2xl shadow-sm border border-[rgba(255,255,255,0.08)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between">
          <h2 className="text-base font-bold text-[#e5e5ea]">Cuentas por Pagar</h2>
          <span className="text-xs text-[#8e8e93]">{sorted.length} facturas pendientes</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[rgba(255,255,255,0.02)] border-b border-[rgba(255,255,255,0.08)]">
              <tr>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider">Descripción</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider hidden md:table-cell">Categoría</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider text-right">Monto</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider text-center">Estado</th>
                {canAct && <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.08)]">
              {sorted.map((t) => {
                const isOverdue = getDaysOverdue(t.date) > 0;
                const isPartial = t.status === 'partial';
                const paidAmount = t.paidAmount || 0;
                const remaining = t.amount - paidAmount;
                const paidPct = t.amount > 0 ? (paidAmount / t.amount) * 100 : 0;
                const isLoading = loadingId === t.id;
                return (
                  <tr key={t.id} className={`group transition-all duration-200 ${isOverdue ? 'bg-[rgba(239,68,68,0.04)]' : 'hover:bg-[rgba(255,255,255,0.03)]'}`}>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[#c7c7cc]">{formatDate(t.date)}</span>
                        {isOverdue && <span className="text-[10px] text-[#ff453a] font-medium">Vencido {getDaysOverdue(t.date)}d</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[rgba(239,68,68,0.12)]">
                          <ArrowDownCircle className="w-5 h-5 text-[#ff453a]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-[#ffffff]">{safe(t.description)}</span>
                            {t.isRecurring && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(255,255,255,0.06)] text-[#98989d] border border-[rgba(255,255,255,0.08)]">
                                <RefreshCw size={10} /> Recurrente
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[#636366] block mt-0.5">{safe(t.project)}</span>
                          {isPartial && (
                            <div className="mt-1.5">
                              <div className="w-full max-w-[160px] h-1.5 bg-[#2c2c2e] rounded-full overflow-hidden">
                                <div className="h-full bg-[#30d158] rounded-full" style={{ width: `${paidPct}%` }} />
                              </div>
                              <span className="text-[10px] text-[#8e8e93] mt-0.5 block">Pagado: {formatCurrency(paidAmount)} / {formatCurrency(t.amount)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-[rgba(239,68,68,0.1)] text-[#ff453a] border border-[rgba(239,68,68,0.2)]">
                        {safe(t.category)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-bold text-[#ff453a]">-{formatCurrency(t.amount)}</span>
                        {isPartial && <span className="text-xs text-[#ff9f0a]">Restante: {formatCurrency(remaining)}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {isPartial ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-[rgba(255,159,10,0.12)] text-[#ff9f0a] border-[rgba(255,159,10,0.25)]"><Circle size={14} /> Pago Parcial</span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-[rgba(239,68,68,0.12)] text-[#ff453a] border-[rgba(239,68,68,0.25)]"><Circle size={14} /> Vencido</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-[rgba(245,158,11,0.12)] text-[#ff9f0a] border-[rgba(245,158,11,0.25)]"><Circle size={14} /> Pendiente</span>
                      )}
                    </td>
                    {canAct && (
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleMarkPagado(t)}
                            disabled={isLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-[#0a84ff] hover:bg-[#0070d8] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
                          >
                            <CheckCircle2 size={14} />
                            {isLoading ? 'Guardando...' : '✅ Pagado'}
                          </button>
                          <button
                            onClick={() => { setPaymentTransaction(t); setIsPaymentModalOpen(true); }}
                            disabled={isLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#ff9f0a] bg-[rgba(255,159,10,0.1)] hover:bg-[rgba(255,159,10,0.2)] border border-[rgba(255,159,10,0.25)] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                          >
                            <DollarSign size={14} />
                            Abono
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={canAct ? 6 : 5} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-[#636366]">
                      <div className="w-16 h-16 bg-[#2c2c2e] rounded-full flex items-center justify-center">
                        <TrendingDown className="w-8 h-8 text-[#636366]" />
                      </div>
                      <p className="text-sm">No hay cuentas por pagar pendientes</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PartialPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => { setIsPaymentModalOpen(false); setPaymentTransaction(null); }}
        transaction={paymentTransaction}
        onSubmit={handlePaymentSubmit}
      />
    </div>
  );
};

export default CXP;
