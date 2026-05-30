import { useMemo, useRef, useState } from 'react';
import {
 AlertTriangle,
 Check,
 CheckCircle2,
 ChevronDown,
 Landmark,
 Link2,
 Plus,
 Scale,
 Search,
 X,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useAllTransactions } from '../../hooks/useAllTransactions';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { formatCurrency } from '../../utils/formatters';

const currentMonth = () => {
 const now = new Date();
 return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Score a match between a bank movement and a transaction (higher = better)
const scoreMatch = (movement, transaction) => {
 let score = 0;

 // Amount match (most important)
 const amountDiff = Math.abs(movement.amount - transaction.amount);
 if (amountDiff < 0.01) score += 100;
 else if (amountDiff < 1) score += 80;
 else if (amountDiff < 10) score += 40;
 else return 0; // Too far off

 // Direction match
 const txDirection = transaction.type === 'income' ? 'in' : 'out';
 if (movement.direction === txDirection) score += 50;
 else return 0; // Direction mismatch = not a match

 // Date proximity (bank payment can be days/weeks after work date)
 if (movement.postedDate && transaction.date) {
 const mDate = new Date(movement.postedDate);
 const tDate = new Date(transaction.date);
 const daysDiff = Math.abs((mDate - tDate) / (1000 * 60 * 60 * 24));
 if (daysDiff === 0) score += 30;
 else if (daysDiff <= 3) score += 25;
 else if (daysDiff <= 7) score += 20;
 else if (daysDiff <= 14) score += 15;
 else if (daysDiff <= 30) score += 10;
 else if (daysDiff <= 60) score += 5;
 // Beyond 60 days: no date bonus but still matches by amount+direction
 }

 // Description similarity (basic)
 const mDesc = (movement.counterpartyName || movement.description || '').toLowerCase();
 const tDesc = (transaction.description || '').toLowerCase();
 if (mDesc && tDesc) {
 const words = mDesc.split(/\s+/).filter(w => w.length > 3);
 const matchingWords = words.filter(w => tDesc.includes(w));
 if (matchingWords.length > 0) score += 15;
 }

 return score;
};

const Conciliacion = ({ user }) => {
 const { showToast } = useToast();
 const { bankMovements, loading: movLoading, reconcileMovement, unreconcileMovement } = useBankMovements(user);
 const { allTransactions, loading: txLoading } = useAllTransactions(user);
 const { markAsCompleted, createTransaction } = useTransactionActions(user);

 const [month, setMonth] = useState(currentMonth());
 const [searchBank, setSearchBank] = useState('');
 const [searchTx, setSearchTx] = useState('');
 const [selectedMovement, setSelectedMovement] = useState(null);
 const [showMatched, setShowMatched] = useState(false);
 const bankColumnRef = useRef(null);
 const systemColumnRef = useRef(null);

 // Derive matched pairs from Firestore state (persisted reconciliation)
 const matchedPairs = useMemo(() => {
 return bankMovements
 .filter(m => m.reconciledAt && m.linkedTransactionId)
 .map(m => ({ movementId: m.id, transactionId: m.linkedTransactionId }));
 }, [bankMovements]);

 const loading = movLoading || txLoading;

 // Filter bank movements by month
 // Exclude legacy-tx- movements (these are duplicates of transactions created by the ledger)
 // Exclude movements that were manually created (they are self-reconciled)
 const monthMovements = useMemo(() => {
 return bankMovements
 .filter(m => m.status === 'posted' && (m.postedDate || '').slice(0, 7) === month)
 .filter(m => !m.id.startsWith('legacy-tx-')) // Exclude ledger-generated duplicates
 .filter(m => !m.legacyTransactionId) // Exclude movements linked to legacy transactions
 .filter(m => {
 if (!searchBank) return true;
 const q = searchBank.toLowerCase();
 return (m.description || '').toLowerCase().includes(q) ||
 (m.counterpartyName || '').toLowerCase().includes(q) ||
 String(m.amount).includes(q);
 });
 }, [bankMovements, month, searchBank]);

 // Combine transactions + manual bank movements as "system records"
 // Manual bank movements (created by users, not imported from CSV) are operational records
 const allSystemRecords = useMemo(() => {
 const manualMovements = bankMovements
 .filter(m => m.status === 'posted')
 .filter(m => m.id.startsWith('legacy-tx-') || m.legacyTransactionId || m.createdBy) // manually created
 .filter(m => !m.id.startsWith('legacy-tx-')) // but not ledger duplicates — use the transaction instead
 .map(m => ({
 id: m.id,
 description: m.counterpartyName || m.description,
 amount: m.amount,
 type: m.direction === 'in' ? 'income' : 'expense',
 date: m.postedDate,
 project: m.projectName || '',
 category: m.kind || '',
 status: m.reconciledAt ? 'reconciled' : 'posted',
 source: 'manual-bankMovement',
 }));
 return [...allTransactions, ...manualMovements];
 }, [allTransactions, bankMovements]);

 // Filter system records by month
 const monthTransactions = useMemo(() => {
 return allSystemRecords
 .filter(t => (t.date || '').slice(0, 7) === month)
 .filter(t => {
 if (!searchTx) return true;
 const q = searchTx.toLowerCase();
 return (t.description || '').toLowerCase().includes(q) ||
 (t.project || '').toLowerCase().includes(q) ||
 String(t.amount).includes(q);
 });
 }, [allSystemRecords, month, searchTx]);

 // Already matched IDs
 const matchedMovementIds = useMemo(() => new Set(matchedPairs.map(p => p.movementId)), [matchedPairs]);
 const matchedTransactionIds = useMemo(() => new Set(matchedPairs.map(p => p.transactionId)), [matchedPairs]);

 // Unmatched items
 const unmatchedMovements = monthMovements.filter(m => !matchedMovementIds.has(m.id) && !m.reconciledAt);
 const unmatchedTransactions = monthTransactions.filter(t => !matchedTransactionIds.has(t.id));

 // All unmatched system records (for suggestions — wider than just month)
 const allUnmatchedTransactions = useMemo(() => {
 return allSystemRecords.filter(t => !matchedTransactionIds.has(t.id));
 }, [allSystemRecords, matchedTransactionIds]);

 // Auto-suggestions for selected movement (search ALL transactions, not just month)
 const suggestions = useMemo(() => {
 if (!selectedMovement) return [];

 const results = allUnmatchedTransactions
 .map(t => ({ transaction: t, score: scoreMatch(selectedMovement, t) }))
 .filter(s => s.score > 0)
 .sort((a, b) => b.score - a.score)
 .slice(0, 8);

 return results;
 }, [selectedMovement, allUnmatchedTransactions]);

 // Auto-match all: find best 1:1 matches
 const autoMatch = async () => {
 const pairs = [];
 const usedMovements = new Set(matchedMovementIds);
 const usedTransactions = new Set(matchedTransactionIds);

 // Build all possible matches sorted by score
 const allMatches = [];
 unmatchedMovements.forEach(m => {
 allUnmatchedTransactions.forEach(t => {
 const score = scoreMatch(m, t);
 if (score >= 150) { // High confidence only
 allMatches.push({ movementId: m.id, transactionId: t.id, score });
 }
 });
 });
 allMatches.sort((a, b) => b.score - a.score);

 // Greedy 1:1 assignment
 allMatches.forEach(match => {
 if (!usedMovements.has(match.movementId) && !usedTransactions.has(match.transactionId)) {
 pairs.push({ movementId: match.movementId, transactionId: match.transactionId });
 usedMovements.add(match.movementId);
 usedTransactions.add(match.transactionId);
 }
 });

 if (pairs.length === 0) {
 showToast('No se encontraron coincidencias automáticas', 'info');
 return;
 }

 // Persist all matches to Firestore
 for (const pair of pairs) {
 await reconcileMovement(pair.movementId, pair.transactionId);
 const transaction = allTransactions.find(t => t.id === pair.transactionId);
 if (transaction && transaction.source === '2026-firebase') {
 await markAsCompleted(transaction);
 }
 }

 setSelectedMovement(null);
 showToast(`${pairs.length} coincidencias conciliadas`, 'success');
 };

 const manualMatch = async (movementId, transactionId) => {
 const transaction = allTransactions.find(t => t.id === transactionId);

 // Persist reconciliation to Firestore
 await reconcileMovement(movementId, transactionId);

 // Mark transaction as completed/paid (only for Firebase transactions)
 if (transaction && transaction.source === '2026-firebase') {
 await markAsCompleted(transaction);
 }

 setSelectedMovement(null);
 showToast('Movimiento conciliado', 'success');
 };

 const removeMatch = async (movementId) => {
 await unreconcileMovement(movementId);
 showToast('Conciliación deshecha', 'info');
 };

 // Create a new transaction from an unmatched bank movement
 const handleCreateFromMovement = async (movement) => {
 const result = await createTransaction({
 date: movement.postedDate,
 description: movement.counterpartyName || movement.description || 'Movimiento bancario',
 amount: movement.amount,
 type: movement.direction === 'in' ? 'income' : 'expense',
 category: 'Sin categorizar',
 project: '',
 costCenter: 'Sin asignar',
 status: 'paid',
 comment: `Creado desde movimiento bancario del ${movement.postedDate}`,
 });

 if (result?.success && result.id) {
 await reconcileMovement(movement.id, result.id);
 showToast('Transacción creada y conciliada', 'success');
 } else if (result?.success) {
 showToast('Transacción creada. Vincúlala manualmente.', 'success');
 } else {
 showToast('Error al crear la transacción', 'error');
 }
 };

 // Stats
 const totalBankIn = monthMovements.filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0);
 const totalBankOut = monthMovements.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);
 const totalTxIncome = monthTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
 const totalTxExpense = monthTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

 // Available months from bank movements
 const availableMonths = useMemo(() => {
 const months = new Set();
 bankMovements.forEach(m => {
 if (m.postedDate) months.add(m.postedDate.slice(0, 7));
 });
 allTransactions.forEach(t => {
 if (t.date) months.add(t.date.slice(0, 7));
 });
 return [...months].sort().reverse();
 }, [bankMovements, allTransactions]);

 if (loading) {
 return (
 <div className="flex items-center justify-center py-28">
 <div className="flex flex-col items-center gap-3">
 <Scale size={24} className="text-[var(--color-fg-4)]" />
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12">
 {/* Header */}
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-7">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-3)] mb-3">Conciliación bancaria</p>
 <h2 className="font-display text-[28px] font-medium text-[var(--color-fg-1)]">Banco vs. Sistema</h2>
 <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--color-fg-4)]">
 Compara los movimientos importados del banco con las transacciones registradas en NEXUS.OS.
 Vincula registros por monto, fecha y descripción.
 </p>
 </div>
 <div className="flex items-center gap-3">
 <select
 className="rounded-full border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-4 py-2.5 font-mono text-xs text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)]"
 value={month}
 onChange={e => setMonth(e.target.value)}
 >
 {availableMonths.map(m => (
 <option key={m} value={m}>{m}</option>
 ))}
 {!availableMonths.includes(month) && <option value={month}>{month}</option>}
 </select>
 <button
 onClick={autoMatch}
  className="nx-btn nx-btn-primary"
 >
 <Link2 size={16} />
 Auto-conciliar
 </button>
 </div>
 </div>
 </section>

 {/* Stats */}
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <p className="label-mono text-[var(--color-fg-3)]">Mov. banco</p>
 <p className="mt-2 font-display text-[24px] font-medium text-[var(--color-fg-1)]">{monthMovements.length}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <p className="label-mono text-[var(--color-fg-3)]">Transacciones</p>
 <p className="mt-2 font-display text-[24px] font-medium text-[var(--color-fg-1)]">{monthTransactions.length}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <p className="label-mono text-[var(--color-fg-3)]">Conciliados</p>
 <p className="mt-2 font-display text-[24px] font-medium text-[var(--color-ok)]">{matchedPairs.length}</p>
 </div>
 <div
className="cursor-pointer rounded-md border border-[var(--color-line-s)] bg-transparent p-4 transition-colors duration-200 hover:border-[var(--color-fg-1)] hover:bg-[var(--color-bg-1)]"
 onClick={() => bankColumnRef.current?.scrollIntoView({ behavior: 'smooth' })}
 role="button"
 tabIndex={0}
 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bankColumnRef.current?.scrollIntoView({ behavior: 'smooth' }); } }}
 >
 <p className="label-mono text-[var(--color-fg-3)]">Sin conciliar (banco)</p>
 <p className="mt-2 font-display text-[24px] font-medium text-[var(--color-accent)]">{unmatchedMovements.length}</p>
 </div>
 <div
className="cursor-pointer rounded-md border border-[var(--color-line-s)] bg-transparent p-4 transition-colors duration-200 hover:border-[var(--color-fg-1)] hover:bg-[var(--color-bg-1)]"
 onClick={() => systemColumnRef.current?.scrollIntoView({ behavior: 'smooth' })}
 role="button"
 tabIndex={0}
 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); systemColumnRef.current?.scrollIntoView({ behavior: 'smooth' }); } }}
 >
 <p className="label-mono text-[var(--color-fg-3)]">Sin conciliar (sistema)</p>
 <p className="mt-2 font-display text-[24px] font-medium text-[var(--color-warn)]">{unmatchedTransactions.length}</p>
 </div>
 </div>

 {/* Totals comparison */}
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <p className="label-mono text-[var(--color-fg-3)]">Banco — {month}</p>
 <div className="mt-3 flex gap-6">
 <div>
 <p className="text-[10px] text-[var(--color-ok)]">Entradas</p>
 <p className="text-sm font-medium text-[var(--color-ok)]">+€{formatCurrency(totalBankIn)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-3)]">Salidas</p>
 <p className="text-sm font-medium text-[var(--color-accent)]">-€{formatCurrency(totalBankOut)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-4)]">Neto</p>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">€{formatCurrency(totalBankIn - totalBankOut)}</p>
 </div>
 </div>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <p className="label-mono text-[var(--color-fg-3)]">Sistema — {month}</p>
 <div className="mt-3 flex gap-6">
 <div>
 <p className="text-[10px] text-[var(--color-ok)]">Ingresos</p>
 <p className="text-sm font-medium text-[var(--color-ok)]">+€{formatCurrency(totalTxIncome)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-3)]">Gastos</p>
 <p className="text-sm font-medium text-[var(--color-accent)]">-€{formatCurrency(totalTxExpense)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-4)]">Neto</p>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">€{formatCurrency(totalTxIncome - totalTxExpense)}</p>
 </div>
 </div>
 </div>
 </div>

 {/* Matched pairs */}
 {matchedPairs.length > 0 && (
 <section className="rounded-md border border-[var(--color-line-s)] bg-transparent p-5">
 <button
 onClick={() => setShowMatched(!showMatched)}
 className="flex w-full items-center justify-between"
 >
 <div className="flex items-center gap-2">
 <CheckCircle2 size={18} className="text-[var(--color-ok)]" />
 <h3 className="font-mono text-[15px] font-medium text-[var(--color-fg-1)]">Conciliados ({matchedPairs.length})</h3>
 </div>
 <ChevronDown size={18} className={`text-[var(--color-fg-3)] transition ${showMatched ? 'rotate-180' : ''}`} />
 </button>
 {showMatched && (
 <div className="mt-4 space-y-2">
 {matchedPairs.map(pair => {
 const mov = bankMovements.find(m => m.id === pair.movementId);
 const tx = allTransactions.find(t => t.id === pair.transactionId);
 if (!mov || !tx) return null;
 return (
 <div key={pair.movementId} className="flex items-center gap-3 rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-3">
 <Check size={16} className="flex-shrink-0 text-[var(--color-ok)]" />
 <div className="flex-1 min-w-0">
 <p className="truncate text-[12px] font-medium text-[var(--color-fg-1)]">
 {mov.counterpartyName || mov.description}
 </p>
 <p className="truncate text-[11px] text-[var(--color-fg-3)]">{mov.postedDate}</p>
 </div>
 <Link2 size={14} className="flex-shrink-0 text-[var(--color-fg-3)]" />
 <div className="flex-1 min-w-0">
 <p className="truncate text-[12px] font-medium text-[var(--color-fg-1)]">{tx.description}</p>
 <p className="truncate text-[11px] text-[var(--color-fg-3)]">{tx.date} · {tx.project}</p>
 </div>
 <span className={`flex-shrink-0 text-[13px] font-medium ${mov.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 €{formatCurrency(mov.amount)}
 </span>
 <button onClick={() => removeMatch(pair.movementId)} className="flex-shrink-0 rounded-lg p-1 text-[var(--color-fg-3)] hover:text-[var(--color-accent)]">
 <X size={14} />
 </button>
 </div>
 );
 })}
 </div>
 )}
 </section>
 )}

 {/* Two-column comparison */}
 <div className="grid gap-6 xl:grid-cols-2">
 {/* Bank movements */}
 <section ref={bankColumnRef} className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Landmark size={18} className="text-[var(--color-fg-1)]" />
 <h3 className="font-mono text-[14px] font-medium text-[var(--color-fg-1)]">Movimientos banco</h3>
 <span className="text-[11px] text-[var(--color-fg-3)]">({unmatchedMovements.length})</span>
 </div>
 </div>
 <div className="relative mb-3">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" />
 <input
 type="text"
 placeholder="Buscar movimiento..."
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-2 pl-9 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={searchBank}
 onChange={e => setSearchBank(e.target.value)}
 />
 </div>
 <div className="max-h-[500px] space-y-2 overflow-y-auto">
 {unmatchedMovements.length === 0 && (
 <p className="py-8 text-center text-sm text-[var(--color-fg-3)]">
 {monthMovements.length === 0 ? 'No hay movimientos bancarios para este mes. Importa un CSV en la sección de Importar.' : 'Todos los movimientos están conciliados.'}
 </p>
 )}
 {unmatchedMovements.map(m => {
 const isSelected = selectedMovement?.id === m.id;
 return (
 <div key={m.id} className="flex items-center gap-1">
 <button
 type="button"
 onClick={() => setSelectedMovement(isSelected ? null : m)}
 className={`flex-1 min-w-0 rounded-lg border px-4 py-3 text-left transition-all ${
 isSelected
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] '
: 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:bg-[var(--color-bg-2)]'
 }`}
 >
 <div className="flex items-center justify-between gap-2">
 <span className="truncate text-[12px] font-medium text-[var(--color-fg-1)]">
 {m.counterpartyName || m.description || 'Sin descripción'}
 </span>
 <span className={`flex-shrink-0 text-[13px] font-medium ${m.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {m.direction === 'in' ? '+' : '-'}€{formatCurrency(m.amount)}
 </span>
 </div>
 <p className="mt-1 truncate text-[11px] text-[var(--color-fg-3)]">
 {m.postedDate} · {m.description?.slice(0, 60)}
 </p>
 </button>
 <button
 onClick={() => handleCreateFromMovement(m)}
className="flex-shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 text-[var(--color-fg-3)] transition hover:border-[var(--color-line-s)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]"
 title="Crear transacción desde este movimiento"
 >
 <Plus size={14} />
 </button>
 </div>
 );
 })}
 </div>
 </section>

 {/* Transactions / Suggestions */}
 <section ref={systemColumnRef} className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 {selectedMovement ? (
 <>
 <div className="mb-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Link2 size={18} className="text-[var(--color-warn)]" />
 <h3 className="font-mono text-[14px] font-medium text-[var(--color-fg-1)]">Sugerencias de coincidencia</h3>
 </div>
 <button onClick={() => setSelectedMovement(null)} className="rounded-lg p-1 text-[var(--color-fg-3)] hover:text-[var(--color-accent)]">
 <X size={16} />
 </button>
 </div>
 <div className="mt-2 rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-3 py-2">
 <p className="text-[11px] text-[var(--color-fg-1)]">Buscando coincidencias para:</p>
 <p className="text-[13px] font-medium text-[var(--color-fg-1)]">
 {selectedMovement.counterpartyName || selectedMovement.description} —{' '}
 <span className={selectedMovement.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}>
 {selectedMovement.direction === 'in' ? '+' : '-'}€{formatCurrency(selectedMovement.amount)}
 </span>
 </p>
 </div>
 </div>
 <div className="space-y-2">
 {suggestions.length === 0 && (
 <p className="py-8 text-center text-sm text-[var(--color-fg-3)]">
 No se encontraron coincidencias para este movimiento.
 </p>
 )}
 {suggestions.map(({ transaction: t, score }) => (
 <div
 key={t.id}
className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 transition hover:bg-[var(--color-bg-2)]"
 >
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="truncate text-[12px] font-medium text-[var(--color-fg-1)]">{t.description}</span>
 <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
 score >= 150 ? 'bg-transparent text-[var(--color-ok)]' :
 score >= 100 ? 'bg-transparent text-[var(--color-warn)]' :
 'bg-transparent text-[var(--color-fg-3)]'
 }`}>
 {score >= 150 ? 'Exacto' : score >= 100 ? 'Probable' : 'Posible'}
 </span>
 </div>
 <p className="mt-1 text-[11px] text-[var(--color-fg-3)]">
 {t.date} · {t.project || 'Sin proyecto'} · {t.category}
 </p>
 </div>
 <span className={`flex-shrink-0 text-[13px] font-medium ${t.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 €{formatCurrency(t.amount)}
 </span>
 <button
 onClick={() => manualMatch(selectedMovement.id, t.id)}
 className="flex-shrink-0 rounded-full bg-[var(--color-fg-1)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-bg-0)] transition hover:opacity-85"
 >
 Vincular
 </button>
 </div>
 ))}
 </div>
 </>
 ) : (
 <>
 <div className="mb-4 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Scale size={18} className="text-[var(--color-warn)]" />
 <h3 className="font-mono text-[14px] font-medium text-[var(--color-fg-1)]">Transacciones sistema</h3>
 <span className="text-[11px] text-[var(--color-fg-3)]">({unmatchedTransactions.length})</span>
 </div>
 </div>
 <div className="relative mb-3">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" />
 <input
 type="text"
 placeholder="Buscar transacción..."
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-2 pl-9 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={searchTx}
 onChange={e => setSearchTx(e.target.value)}
 />
 </div>
 <div className="max-h-[500px] space-y-2 overflow-y-auto">
 {unmatchedTransactions.length === 0 && (
 <p className="py-8 text-center text-sm text-[var(--color-fg-3)]">No hay transacciones sin conciliar para este mes.</p>
 )}
 {unmatchedTransactions.map(t => (
 <div
 key={t.id}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3"
 >
 <div className="flex items-center justify-between gap-2">
 <span className="truncate text-[12px] font-medium text-[var(--color-fg-1)]">{t.description}</span>
 <span className={`flex-shrink-0 text-[13px] font-medium ${t.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {t.type === 'income' ? '+' : '-'}€{formatCurrency(t.amount)}
 </span>
 </div>
 <p className="mt-1 text-[11px] text-[var(--color-fg-3)]">
 {t.date} · {t.project || 'Sin proyecto'} · {t.category} · {t.status}
 </p>
 </div>
 ))}
 </div>
 </>
 )}
 </section>
 </div>

 {/* Help text */}
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-5 py-4 text-center">
 <p className="text-[12px] text-[var(--color-fg-3)]">
 <strong>Cómo usar:</strong> Haz clic en un movimiento bancario (izquierda) para ver sugerencias de coincidencia.
 Usa <strong>"Auto-conciliar"</strong> para vincular automáticamente los que coinciden por monto y dirección.
 Los movimientos del banco se importan desde <strong>Importar → Importar movimientos bancarios</strong>.
 </p>
 </div>
 </div>
 );
};

export default Conciliacion;
