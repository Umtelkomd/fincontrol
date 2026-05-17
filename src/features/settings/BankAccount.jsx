import React, { useState, useEffect } from 'react';
import { Landmark, Save, AlertTriangle, TrendingDown, TrendingUp, CreditCard, Loader2 } from 'lucide-react';
import { useBankAccount } from '../../hooks/useBankAccount';
import { formatCurrency } from '../../utils/formatters';
import { Button } from '@/components/ui/nexus';

const BankAccount = ({ user, transactions }) => {
 const { bankAccount, loading, saveBankAccount, calculateRealBalance } = useBankAccount(user);
 const [form, setForm] = useState({
 bankName: '',
 balance: '',
 balanceDate: new Date().toISOString().split('T')[0],
 creditLineLimit: '-40000'
 });
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);

 useEffect(() => {
 if (bankAccount) {
 setForm({
 bankName: bankAccount.bankName || '',
 balance: String(bankAccount.balance ?? ''),
 balanceDate: bankAccount.balanceDate || new Date().toISOString().split('T')[0],
 creditLineLimit: String(bankAccount.creditLineLimit ?? '-40000')
 });
 }
 }, [bankAccount]);

 const handleSave = async () => {
 setSaving(true);
 const result = await saveBankAccount(form);
 setSaving(false);
 if (result.success) {
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 }
 };

 const realBalance = calculateRealBalance(transactions || []);

 if (loading) {
 return (
 <div className="flex items-center justify-center py-12">
  <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
  <span className="ml-3 text-[var(--color-fg-3)]">Preparando datos bancarios…</span>
 </div>
 );
 }

 const creditLimit = parseFloat(form.creditLineLimit) || 0;
 const creditUtilizationPct = creditLimit < 0 && realBalance.currentBalance < 0
 ? Math.min((Math.abs(realBalance.currentBalance) / Math.abs(creditLimit)) * 100, 100).toFixed(1)
 : 0;

 return (
 <div className="space-y-6">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
 <div className="flex items-center gap-3">
 <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-transparent">
  <Landmark className="text-[var(--color-fg-1)]" size={22} />
 </div>
 <div>
  <p className="label-mono text-[var(--color-fg-1)]">Tesorería</p>
  <h2 className="font-display text-[24px] font-light tracking-[-0.03em] text-[var(--color-fg-1)]">Cuenta bancaria</h2>
  <p className="text-sm text-[var(--color-fg-3)]">Define el saldo base y el límite operativo para medir la liquidez disponible.</p>
 </div>
 </div>
 </div>

  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6">
  <h3 className="mb-4 text-base font-medium tracking-[-0.02em] text-[var(--color-fg-1)]">Datos de la cuenta</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
  <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Nombre del banco</label>
 <input
 type="text"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={form.bankName}
 onChange={(e) => setForm({ ...form, bankName: e.target.value })}
 placeholder="Ej: CaixaBank, Santander..."
 />
 </div>
 <div>
  <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Fecha del saldo</label>
 <input
 type="date"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-line-s)]"
 value={form.balanceDate}
 onChange={(e) => setForm({ ...form, balanceDate: e.target.value })}
 />
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">Los movimientos posteriores a esta fecha ajustan el saldo base.</p>
 </div>
 <div>
  <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Saldo bancario (EUR)</label>
 <input
 type="number"
 step="0.01"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={form.balance}
 onChange={(e) => setForm({ ...form, balance: e.target.value })}
 placeholder="Ej: 15000.00"
 />
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">Saldo confirmado por el banco en la fecha seleccionada.</p>
 </div>
 <div>
  <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Límite de línea de crédito (EUR)</label>
 <input
 type="number"
 step="0.01"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={form.creditLineLimit}
 onChange={(e) => setForm({ ...form, creditLineLimit: e.target.value })}
 placeholder="-40000"
 />
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">Usa un valor negativo. Ejemplo: `-40000` equivale a 40.000 EUR disponibles.</p>
 </div>
 </div>

 <div className="mt-6 flex items-center gap-3">
 <Button
 variant="primary"
 icon={Save}
 loading={saving}
 disabled={saving}
 onClick={handleSave}
 >
 {saving ? 'Guardando...' : 'Guardar configuración'}
 </Button>
 {saved && (
  <span className="text-sm font-medium text-[var(--color-ok)]">Configuración guardada</span>
 )}
 </div>
 </div>

 {bankAccount && (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="flex items-center justify-between mb-2">
  <h3 className="label-mono text-[var(--color-fg-3)]">Saldo inicial</h3>
  <Landmark className="text-[var(--color-fg-1)]" size={18} />
 </div>
  <p className="font-display text-[28px] font-light tabular-nums tracking-[-0.03em] text-[var(--color-fg-1)]">{formatCurrency(realBalance.startingBalance)}</p>
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">Al {bankAccount.balanceDate}</p>
 </div>

  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="flex items-center justify-between mb-2">
  <h3 className="label-mono text-[var(--color-fg-3)]">Movimiento neto</h3>
 {realBalance.netMovement >= 0
  ? <TrendingUp className="text-[var(--color-ok)]" size={18} />
  : <TrendingDown className="text-[var(--color-accent)]" size={18} />
 }
 </div>
  <p className={`font-display text-[28px] font-light tabular-nums tracking-[-0.03em] ${realBalance.netMovement >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {realBalance.netMovement >= 0 ? '+' : ''}{formatCurrency(realBalance.netMovement)}
 </p>
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">{realBalance.transactionsCount} movimientos contabilizados</p>
 </div>

  <div className={`rounded-md bg-[var(--color-bg-1)] p-5 ${realBalance.currentBalance < 0 ? 'border border-[var(--color-line-s)]' : 'border border-[var(--color-line)]'}`}>
 <div className="flex items-center justify-between mb-2">
  <h3 className="label-mono text-[var(--color-fg-3)]">Saldo actual</h3>
  <Landmark className={realBalance.currentBalance >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'} size={18} />
 </div>
  <p className={`font-display text-[28px] font-light tabular-nums tracking-[-0.03em] ${realBalance.currentBalance >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {formatCurrency(realBalance.currentBalance)}
 </p>
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">Saldo operativo proyectado al día de hoy</p>
 </div>

  <div className={`rounded-md bg-[var(--color-bg-1)] p-5 ${parseFloat(creditUtilizationPct) > 80 ? 'border border-[var(--color-line-s)]' : 'border border-[var(--color-line)]'}`}>
 <div className="flex items-center justify-between mb-2">
  <h3 className="label-mono text-[var(--color-fg-3)]">Crédito disponible</h3>
  <CreditCard className={parseFloat(creditUtilizationPct) > 80 ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'} size={18} />
 </div>
  <p className={`font-display text-[28px] font-light tabular-nums tracking-[-0.03em] ${parseFloat(creditUtilizationPct) > 80 ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'}`}>
 {formatCurrency(realBalance.availableCredit)}
 </p>
  <p className="mt-1 text-xs text-[var(--color-fg-3)]">
 Límite: {formatCurrency(Math.abs(creditLimit))} | Uso: {creditUtilizationPct}%
 </p>
 </div>
 </div>
 )}

 {bankAccount && creditLimit < 0 && (
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6">
  <h3 className="mb-4 text-base font-medium tracking-[-0.02em] text-[var(--color-fg-1)]">Utilización de línea de crédito</h3>

 <div className="mb-4">
 <div className="flex justify-between text-sm mb-2">
  <span className="text-[var(--color-fg-3)]">Límite: {formatCurrency(Math.abs(creditLimit))}</span>
  <span className={`font-medium ${parseFloat(creditUtilizationPct) > 80 ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'}`}>
 {creditUtilizationPct}% utilizado
 </span>
 </div>
  <div className="h-4 w-full overflow-hidden rounded-full bg-[var(--color-bg-2)]">
 <div
 className={`h-full rounded-full transition-all ${
  parseFloat(creditUtilizationPct) > 80 ? 'bg-[var(--color-accent)]' :
  parseFloat(creditUtilizationPct) > 50 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)]'
 }`}
 style={{ width: `${Math.min(parseFloat(creditUtilizationPct), 100)}%` }}
 />
 </div>
 </div>

  <div className="flex justify-between text-xs text-[var(--color-fg-3)]">
 <span>0 EUR</span>
 <span>{formatCurrency(Math.abs(creditLimit) * 0.5)}</span>
 <span>{formatCurrency(Math.abs(creditLimit))}</span>
 </div>

 {realBalance.currentBalance <= creditLimit && (
  <div className="mt-4 flex items-center gap-2 rounded-md border border-[var(--color-line-s)] bg-transparent p-3">
  <AlertTriangle className="text-[var(--color-accent)]" size={18} />
  <span className="text-sm font-medium text-[var(--color-accent)]">
 Has superado el límite de la línea de crédito
 </span>
 </div>
 )}

 {parseFloat(creditUtilizationPct) > 80 && realBalance.currentBalance > creditLimit && (
  <div className="mt-4 flex items-center gap-2 rounded-md border border-[var(--color-line-s)] bg-transparent p-3">
  <AlertTriangle className="text-[var(--color-warn)]" size={18} />
  <span className="text-sm font-medium text-[var(--color-warn)]">
 Estás usando más del 80% de la línea de crédito
 </span>
 </div>
 )}
 </div>
 )}
 </div>
 );
};

export default BankAccount;
