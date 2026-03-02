import React, { useState, useMemo } from 'react';
import {
  TrendingUp, Clock, AlertCircle, DollarSign, CheckCircle2,
  Circle, ArrowUpCircle, RefreshCw, Plus, Search, Filter
} from 'lucide-react';
import { formatCurrency, formatDate, getDaysOverdue } from '../../utils/formatters';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import { useToast } from '../../contexts/ToastContext';

const safe = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const StatCard = ({ title, value, color, icon: Icon, subtitle }) => (
  <div className="bg-[#1c1c1e] rounded-xl p-5 border border-[rgba(255,255,255,0.06)]">
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider">{title}</h3>
      <div className={`p-2 rounded-lg ${color === 'green' ? 'bg-[rgba(48,209,88,0.1)]' : color === 'red' ? 'bg-[rgba(255,69,58,0.1)]' : 'bg-[rgba(255,159,10,0.1)]'}`}>
        <Icon size={16} className={color === 'green' ? 'text-[#30d158]' : color === 'red' ? 'text-[#ff453a]' : 'text-[#ff9f0a]'} />
      </div>
    </div>
    <p className={`text-2xl font-bold tracking-tight ${color === 'green' ? 'text-[#30d158]' : color === 'red' ? 'text-[#ff453a]' : 'text-[#ff9f0a]'}`}>
      €{formatCurrency(value)}
    </p>
    {subtitle && <p className="text-[11px] text-[#636366] mt-1.5">{subtitle}</p>}
  </div>
);

const Ingresos = ({ transactions, allTransactions, userRole, user, onNewTransaction }) => {
  const { registerPayment, markAsCompleted } = useTransactionActions(user);
  const { showToast } = useToast();
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentTransaction, setPaymentTransaction] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const source = allTransactions && allTransactions.length > 0 ? allTransactions : transactions;

  // All income transactions
  const allIncome = useMemo(() => source.filter(t => t.type === 'income'), [source]);
  
  // Pending receivables (CXC)
  const receivables = useMemo(
    () => allIncome.filter(t => t.status === 'pending' || t.status === 'partial'),
    [allIncome]
  );

  // Completed/paid income
  const completedIncome = useMemo(
    () => allIncome.filter(t => t.status === 'paid' || t.status === 'completed'),
    [allIncome]
  );

  // Stats
  const totalReceivable = receivables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
  const totalCollected = completedIncome.reduce((sum, t) => sum + t.amount, 0);
  const overdueReceivables = receivables.filter(t => getDaysOverdue(t.date) > 15);
  const totalOverdue = overdueReceivables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
  const partialReceivables = receivables.filter(t => t.status === 'partial');
  const totalPartialCollected = partialReceivables.reduce((sum, t) => sum + (t.paidAmount || 0), 0);

  // Filter transactions for the table
  const filteredTransactions = useMemo(() => {
    let items;
    if (statusFilter === 'pending') items = receivables;
    else if (statusFilter === 'completed') items = completedIncome;
    else if (statusFilter === 'overdue') items = overdueReceivables;
    else items = allIncome;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      items = items.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.project || '').toLowerCase().includes(q) ||
        (t.counterparty || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
      );
    }

    return [...items].sort((a, b) => {
      // Overdue first, then by date descending
      const aOv = (a.status === 'pending' || a.status === 'partial') && getDaysOverdue(a.date) > 15 ? 1 : 0;
      const bOv = (b.status === 'pending' || b.status === 'partial') && getDaysOverdue(b.date) > 15 ? 1 : 0;
      if (aOv !== bOv) return bOv - aOv;
      return (b.date || '').localeCompare(a.date || '');
    });
  }, [allIncome, receivables, completedIncome, overdueReceivables, statusFilter, searchTerm]);

  const handleMarkCobrado = async (t) => {
    if (loadingId) return;
    setLoadingId(t.id);
    const result = await markAsCompleted(t);
    if (result?.success) showToast('Ingreso marcado como cobrado ✅');
    else showToast('Error al marcar como cobrado', 'error');
    setLoadingId(null);
  };

  const handlePaymentSubmit = async (transaction, paymentData) => {
    const result = await registerPayment(transaction, paymentData);
    if (result?.success) showToast('Abono registrado correctamente ✅');
    else showToast('Error al registrar abono', 'error');
  };

  const canAct = userRole === 'admin' || userRole === 'manager';

  const statusTabs = [
    { key: 'all', label: 'Todos', count: allIncome.length },
    { key: 'pending', label: 'Por Cobrar', count: receivables.length },
    { key: 'completed', label: 'Cobrados', count: completedIncome.length },
    { key: 'overdue', label: 'Vencidos', count: overdueReceivables.length },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Cobrado" value={totalCollected} color="green" icon={TrendingUp} subtitle={`${completedIncome.length} facturas cobradas`} />
        <StatCard title="Por Cobrar" value={totalReceivable} color="orange" icon={Clock} subtitle={`${receivables.length} facturas pendientes`} />
        <StatCard title="Vencido" value={totalOverdue} color="red" icon={AlertCircle} subtitle={`${overdueReceivables.length} facturas vencidas (+15 días)`} />
        <StatCard title="Cobros Parciales" value={totalPartialCollected} color="orange" icon={DollarSign} subtitle={`${partialReceivables.length} con abono parcial`} />
      </div>

      {/* Toolbar */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] p-4">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
          {/* Search */}
          <div className="relative flex-1 w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" size={16} />
            <input
              type="text"
              placeholder="Buscar ingresos..."
              className="w-full pl-9 pr-4 py-2 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm focus:ring-2 focus:ring-[#30d158] focus:border-transparent outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] rounded-lg p-0.5">
            {statusTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  statusFilter === tab.key
                    ? 'bg-[rgba(48,209,88,0.15)] text-[#30d158] shadow-sm'
                    : 'text-[#8e8e93] hover:text-white hover:bg-[rgba(255,255,255,0.06)]'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-[10px] opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* New Income Button */}
          {canAct && onNewTransaction && (
            <button
              onClick={() => onNewTransaction('income')}
              className="flex items-center gap-2 px-4 py-2 bg-[#30d158] hover:bg-[#28c74e] text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
            >
              <Plus size={16} /> Nuevo Ingreso
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[#111111] border-b border-[rgba(255,255,255,0.08)]">
              <tr>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Descripción</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider hidden lg:table-cell">Proyecto</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider hidden md:table-cell">Categoría</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider text-right">Monto</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider text-center">Estado</th>
                {canAct && <th className="px-4 py-3 text-[11px] font-semibold text-[#636366] uppercase tracking-wider text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
              {filteredTransactions.map((t) => {
                const isOverdue = (t.status === 'pending' || t.status === 'partial') && getDaysOverdue(t.date) > 15;
                const isPartial = t.status === 'partial';
                const isPaid = t.status === 'paid' || t.status === 'completed';
                const paidAmount = t.paidAmount || 0;
                const remaining = t.amount - paidAmount;
                const paidPct = t.amount > 0 ? (paidAmount / t.amount) * 100 : 0;
                const isLoading = loadingId === t.id;

                return (
                  <tr key={t.id} className={`transition-colors ${isOverdue ? 'bg-[rgba(255,69,58,0.04)]' : 'hover:bg-[rgba(255,255,255,0.02)]'}`}>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-sm text-[#c7c7cc]">{formatDate(t.date)}</span>
                      {isOverdue && <span className="block text-[10px] text-[#ff453a] font-medium mt-0.5">Vencido {getDaysOverdue(t.date)}d</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[rgba(48,209,88,0.1)]">
                          <ArrowUpCircle className="w-4 h-4 text-[#30d158]" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-white block truncate">{safe(t.description)}</span>
                          {t.counterparty && <span className="text-[11px] text-[#636366]">{safe(t.counterparty)}</span>}
                          {isPartial && (
                            <div className="mt-1">
                              <div className="w-24 h-1 bg-[#2c2c2e] rounded-full overflow-hidden">
                                <div className="h-full bg-[#30d158] rounded-full" style={{ width: `${paidPct}%` }} />
                              </div>
                              <span className="text-[10px] text-[#8e8e93]">€{formatCurrency(paidAmount)} / €{formatCurrency(t.amount)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <span className="text-xs text-[#8e8e93]">{safe(t.project)}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-[rgba(48,209,88,0.08)] text-[#30d158] border border-[rgba(48,209,88,0.15)]">
                        {safe(t.category)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <span className="text-sm font-semibold text-[#30d158]">+€{formatCurrency(t.amount)}</span>
                      {isPartial && <span className="block text-[11px] text-[#ff9f0a]">Resta: €{formatCurrency(remaining)}</span>}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[rgba(48,209,88,0.1)] text-[#30d158] border border-[rgba(48,209,88,0.2)]">
                          <CheckCircle2 size={12} /> Cobrado
                        </span>
                      ) : isPartial ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[rgba(255,159,10,0.1)] text-[#ff9f0a] border border-[rgba(255,159,10,0.2)]">
                          <Circle size={12} /> Parcial
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[rgba(255,69,58,0.1)] text-[#ff453a] border border-[rgba(255,69,58,0.2)]">
                          <AlertCircle size={12} /> Vencido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[rgba(255,159,10,0.08)] text-[#ff9f0a] border border-[rgba(255,159,10,0.15)]">
                          <Clock size={12} /> Pendiente
                        </span>
                      )}
                    </td>
                    {canAct && (
                      <td className="px-4 py-3.5 text-center">
                        {!isPaid && (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleMarkCobrado(t)}
                              disabled={isLoading}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#30d158] hover:bg-[#28c74e] disabled:opacity-50 transition-all"
                            >
                              {isLoading ? '...' : 'Cobrado'}
                            </button>
                            <button
                              onClick={() => { setPaymentTransaction(t); setIsPaymentModalOpen(true); }}
                              disabled={isLoading}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#ff9f0a] bg-[rgba(255,159,10,0.1)] hover:bg-[rgba(255,159,10,0.2)] border border-[rgba(255,159,10,0.2)] disabled:opacity-50 transition-all"
                            >
                              Abono
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={canAct ? 7 : 6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-[#636366]">
                      <div className="w-14 h-14 bg-[#2c2c2e] rounded-full flex items-center justify-center">
                        <ArrowUpCircle className="w-7 h-7 text-[#636366]" />
                      </div>
                      <p className="text-sm">No hay ingresos que mostrar</p>
                      <p className="text-xs text-[#48484a]">Crea tu primer ingreso con el botón de arriba</p>
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

export default Ingresos;
