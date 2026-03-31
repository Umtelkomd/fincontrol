import { useEffect, useState, useCallback } from 'react';
import { X, Loader2, DollarSign } from 'lucide-react';
import { formatCurrency, safe, MONEY_TOLERANCE } from '../../utils/formatters';

const PartialPaymentModalInner = ({ transaction, onClose, onSubmit }) => {
  const [submitting, setSubmitting] = useState(false);
  const paidAmount = transaction.paidAmount || 0;
  const remaining = transaction.amount - paidAmount;

  const getDefaultFormData = useCallback(() => ({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    method: 'Transferencia',
    note: ''
  }), []);

  const [formData, setFormData] = useState(getDefaultFormData);

  // Reset form when transaction changes — FIX: was direct setState in render
  useEffect(() => {
    setFormData(getDefaultFormData());
  }, [transaction.id, getDefaultFormData]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const setQuickAmount = (pct) => {
    setFormData({ ...formData, amount: (remaining * pct).toFixed(2) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (!amount || amount <= 0) return;
    if (amount > remaining + MONEY_TOLERANCE) {
      // Validation: amount exceeds remaining balance
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(20,27,42,0.34)] p-4 backdrop-blur-sm animate-fadeIn" role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] shadow-[0_36px_110px_rgba(93,117,161,0.22)] animate-scaleIn">
        <div className="flex items-center justify-between border-b border-[rgba(201,214,238,0.78)] px-6 py-5">
          <div>
            <h3 className="text-xl font-bold text-[#101938]">
              {transaction.type === 'income' ? 'Registrar cobro' : 'Registrar pago'}
            </h3>
            <p className="mt-0.5 max-w-[280px] truncate text-sm text-[#6b7a96]">{safe(transaction.description)}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar registro de pago"
            onClick={onClose}
            className="rounded-xl p-2 text-[#6b7a96] transition-all hover:bg-white hover:text-[#101938]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pt-5 pb-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[rgba(201,214,238,0.74)] bg-white/84 p-3 text-center">
            <p className="mb-1 text-[10px] font-semibold uppercase text-[#6980ac]">Total</p>
            <p className="text-sm font-bold text-[#101938]">{formatCurrency(transaction.amount)}</p>
          </div>
          <div className="rounded-xl border border-[rgba(201,214,238,0.74)] bg-white/84 p-3 text-center">
            <p className="mb-1 text-[10px] font-semibold uppercase text-[#6980ac]">Pagado</p>
            <p className="text-sm font-bold text-[#0f8f4b]">{formatCurrency(paidAmount)}</p>
          </div>
          <div className="rounded-xl border border-[rgba(201,214,238,0.74)] bg-white/84 p-3 text-center">
            <p className="mb-1 text-[10px] font-semibold uppercase text-[#6980ac]">Restante</p>
            <p className="text-sm font-bold text-[#c46a19]">{formatCurrency(remaining)}</p>
          </div>
        </div>

        <div className="px-6 pb-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(201,214,238,0.74)]">
            <div
              className="h-full rounded-full bg-[#0f8f4b] transition-all duration-500"
              style={{ width: `${Math.min((paidAmount / transaction.amount) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[10px] text-[#6b7a96]">
            {(transaction.amount > 0 ? (paidAmount / transaction.amount) * 100 : 0).toFixed(0)}% pagado
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#101938]">
              Monto del pago <span className="text-[#ff453a]">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[#6b7a96]">€</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={remaining}
                required
                placeholder="0.00"
                className="w-full rounded-xl border border-[rgba(201,214,238,0.82)] bg-white/88 py-3 pl-8 pr-4 text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
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
                  className="flex-1 rounded-lg border border-[rgba(201,214,238,0.74)] bg-white/84 py-1.5 text-xs font-medium text-[#6b7a96] transition-all hover:bg-white hover:text-[#101938]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#101938]">Fecha</label>
              <input
                type="date"
                required
                className="w-full rounded-xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                value={formData.date}
                onChange={e => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#101938]">Método</label>
              <select
                className="w-full rounded-xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                value={formData.method}
                onChange={e => setFormData({ ...formData, method: e.target.value })}
              >
                <option value="Transferencia">Transferencia</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Tarjeta">Tarjeta</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-[#101938]">Nota (opcional)</label>
            <input
              type="text"
              placeholder="ej. Pago parcial factura #123"
              className="w-full rounded-xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-[#3156d3] py-4 font-bold text-white shadow-lg transition-all duration-200 ${submitting ? 'cursor-not-allowed opacity-50' : 'hover:-translate-y-0.5 hover:bg-[#2748b6] hover:shadow-xl'}`}
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
            {submitting ? 'Registrando...' : transaction.type === 'income' ? 'Registrar cobro' : 'Registrar pago'}
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
