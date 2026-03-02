import { useState } from 'react';
import { X, Loader2, DollarSign } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const safe = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const PartialPaymentModalInner = ({ transaction, onClose, onSubmit }) => {
  const [submitting, setSubmitting] = useState(false);
  const paidAmount = transaction.paidAmount || 0;
  const remaining = transaction.amount - paidAmount;

  const [formData, setFormData] = useState({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    method: 'Transferencia',
    note: ''
  });

  // Reset form when transaction changes
  const [lastTxId, setLastTxId] = useState(null);
  if (transaction.id !== lastTxId) {
    setLastTxId(transaction.id);
    setFormData({
      amount: '',
      date: new Date().toISOString().split('T')[0],
      method: 'Transferencia',
      note: ''
    });
  }

  const setQuickAmount = (pct) => {
    setFormData({ ...formData, amount: (remaining * pct).toFixed(2) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (!amount || amount <= 0) return;
    if (amount > remaining + 0.01) {
      alert(`El monto no puede exceder el saldo restante (${formatCurrency(remaining)})`);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(transaction, {
        amount,
        date: formData.date,
        method: formData.method,
        note: formData.note
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-[#1c1c1e] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center bg-[#2c2c2e]">
          <div>
            <h3 className="font-bold text-xl text-[#e5e5ea]">Registrar Pago</h3>
            <p className="text-sm text-[#8e8e93] mt-0.5 truncate max-w-[280px]">{safe(transaction.description)}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#636366] hover:text-[#98989d] hover:bg-[rgba(255,255,255,0.05)] rounded-xl transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Summary */}
        <div className="px-6 pt-5 pb-3 grid grid-cols-3 gap-3">
          <div className="bg-[#111111] rounded-xl p-3 text-center">
            <p className="text-[10px] text-[#8e8e93] uppercase font-semibold mb-1">Total</p>
            <p className="text-sm font-bold text-[#e5e5ea]">{formatCurrency(transaction.amount)}</p>
          </div>
          <div className="bg-[#111111] rounded-xl p-3 text-center">
            <p className="text-[10px] text-[#8e8e93] uppercase font-semibold mb-1">Pagado</p>
            <p className="text-sm font-bold text-[#30d158]">{formatCurrency(paidAmount)}</p>
          </div>
          <div className="bg-[#111111] rounded-xl p-3 text-center">
            <p className="text-[10px] text-[#8e8e93] uppercase font-semibold mb-1">Restante</p>
            <p className="text-sm font-bold text-[#ff9f0a]">{formatCurrency(remaining)}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-6 pb-4">
          <div className="w-full h-2 bg-[#2c2c2e] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#30d158] rounded-full transition-all duration-500"
              style={{ width: `${Math.min((paidAmount / transaction.amount) * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-[#636366] text-right mt-1">
            {((paidAmount / transaction.amount) * 100).toFixed(0)}% pagado
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
              Monto del pago <span className="text-[#ff453a]">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#636366] font-medium">€</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={remaining}
                required
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
            {/* Quick buttons */}
            <div className="flex gap-2 mt-2">
              {[
                { label: '25%', pct: 0.25 },
                { label: '50%', pct: 0.5 },
                { label: '100%', pct: 1 }
              ].map(({ label, pct }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setQuickAmount(pct)}
                  className="flex-1 py-1.5 text-xs font-medium bg-[#2c2c2e] text-[#8e8e93] hover:text-[#e5e5ea] hover:bg-[rgba(255,255,255,0.08)] rounded-lg transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Date & Method */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Fecha</label>
              <input
                type="date"
                required
                className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
                value={formData.date}
                onChange={e => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Método</label>
              <select
                className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
                value={formData.method}
                onChange={e => setFormData({ ...formData, method: e.target.value })}
              >
                <option value="Transferencia">Transferencia</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Tarjeta">Tarjeta</option>
              </select>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Nota (opcional)</label>
            <input
              type="text"
              placeholder="ej. Pago parcial factura #123"
              className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white bg-[#30d158] hover:bg-[#28c74e] transition-all duration-200 shadow-lg ${submitting ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl transform hover:-translate-y-0.5'}`}
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
            {submitting ? 'Registrando...' : 'Registrar Pago'}
          </button>
        </form>
      </div>
    </div>
  );
};

const PartialPaymentModal = ({ isOpen, onClose, transaction, onSubmit }) => {
  if (!isOpen || !transaction) return null;
  return <PartialPaymentModalInner transaction={transaction} onClose={onClose} onSubmit={onSubmit} />;
};

export default PartialPaymentModal;
