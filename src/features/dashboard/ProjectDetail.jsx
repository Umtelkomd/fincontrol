import React, { useState, useMemo } from 'react';
import {
 ArrowLeft, ArrowUpCircle, ArrowDownCircle,
 Edit2, CheckCircle2, Circle
} from 'lucide-react';
import {
 LineChart, Line, PieChart, Pie, BarChart, Bar,
 XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import TransactionFormModal from '../../components/ui/TransactionFormModal';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { COLORS } from '../../constants/config';

const CHART_COLORS = ['var(--color-fg-4)', 'var(--color-fg-3)', 'var(--color-line-s)', 'var(--color-fg-1)', 'var(--color-fg-4)', 'var(--color-line)', 'var(--color-ok)', 'var(--color-accent)'];

const ProjectChartTooltip = ({ active, payload, label }) => {
 if (active && payload && payload.length) {
 return (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-3 text-sm ">
 <p className="mb-1 font-medium text-[var(--color-fg-1)]">{label}</p>
 {payload.map((entry, index) => (
 <p key={index} style={{ color: entry.color }}>
 {entry.name}: {formatCurrency(entry.value)} €
 </p>
 ))}
 </div>
 );
 }
 return null;
};

const ProjectDetail = ({ projectName, transactions, user, onClose }) => {
 const [activeTab, setActiveTab] = useState('income');
 const [editingTransaction, setEditingTransaction] = useState(null);
 const [isFormModalOpen, setIsFormModalOpen] = useState(false);

 const { updateTransaction } = useTransactionActions(user);
 const { expenseCategories, incomeCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);

 // Filter transactions for this project
 const projectTransactions = useMemo(() => {
 return transactions.filter(t => (t.project || '').split(' ')[0] === projectName);
 }, [transactions, projectName]);

 const incomeTransactions = projectTransactions.filter(t => t.type === 'income');
 const expenseTransactions = projectTransactions.filter(t => t.type === 'expense');

 const totalIncome = incomeTransactions.reduce((s, t) => s + t.amount, 0);
 const totalExpenses = expenseTransactions.reduce((s, t) => s + t.amount, 0);
 const margin = totalIncome - totalExpenses;
 const roi = totalIncome > 0 ? ((margin / totalIncome) * 100) : 0;

 // Monthly trend for this project
 const monthlyTrend = useMemo(() => {
 const data = {};
 projectTransactions.forEach(t => {
 const month = t.date.substring(0, 7);
 if (!data[month]) data[month] = { month, ingresos: 0, gastos: 0 };
 if (t.type === 'income') data[month].ingresos += t.amount;
 else data[month].gastos += t.amount;
 });
 return Object.values(data).sort((a, b) => a.month.localeCompare(b.month));
 }, [projectTransactions]);

 // Expense category distribution
 const categoryDistribution = useMemo(() => {
 const data = {};
 projectTransactions.forEach(t => {
 if (t.type !== 'expense') return;
 if (!data[t.category]) data[t.category] = 0;
 data[t.category] += t.amount;
 });
 return Object.entries(data).map(([name, value]) => ({ name, value }));
 }, [projectTransactions]);

 // Monthly margin evolution
 const marginEvolution = useMemo(() => {
 const data = {};
 projectTransactions.forEach(t => {
 const month = t.date.substring(0, 7);
 if (!data[month]) data[month] = { month, ingresos: 0, gastos: 0 };
 if (t.type === 'income') data[month].ingresos += t.amount;
 else data[month].gastos += t.amount;
 });
 return Object.values(data)
 .sort((a, b) => a.month.localeCompare(b.month))
 .map(d => ({ ...d, margen: d.ingresos - d.gastos }));
 }, [projectTransactions]);

 const handleEdit = (transaction) => {
 setEditingTransaction(transaction);
 setIsFormModalOpen(true);
 };

 const handleFormSubmit = async (formData) => {
 if (editingTransaction) {
 await updateTransaction(editingTransaction.id, formData, editingTransaction.notes);
 }
 setIsFormModalOpen(false);
 setEditingTransaction(null);
 };

 const currentTransactions = activeTab === 'income' ? incomeTransactions : expenseTransactions;

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center gap-4 mb-5">
 <button
 onClick={onClose}
 className="rounded-lg p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-4)]"
 >
 <ArrowLeft size={20} />
 </button>
 <div className="flex-1">
 <h2 className="text-xl font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">{projectName}</h2>
 <p className="text-sm text-[var(--color-fg-3)]">{projectTransactions.length} transacciones</p>
 </div>
 </div>

 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent p-3">
 <p className="text-xs font-medium text-[var(--color-ok)]">Ingresos</p>
 <p className="text-lg font-medium text-[var(--color-ok)]">{formatCurrency(totalIncome)} €</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent p-3">
 <p className="text-xs font-medium text-[var(--color-accent)]">Gastos</p>
 <p className="text-lg font-medium text-[var(--color-accent)]">{formatCurrency(totalExpenses)} €</p>
 </div>
 <div className={`rounded-lg border p-3 ${margin >= 0 ? 'border-[var(--color-line-s)] bg-transparent' : 'border-[var(--color-line-s)] bg-transparent'}`}>
 <p className={`text-xs font-medium ${margin >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>Margen</p>
 <p className={`text-lg font-medium ${margin >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {margin >= 0 ? '+' : ''}{formatCurrency(margin)} €
 </p>
 </div>
 <div className={`rounded-lg border p-3 ${roi >= 0 ? 'border-[var(--color-line)] bg-[var(--color-bg-1)]' : 'border-[var(--color-line-s)] bg-transparent'}`}>
 <p className={`text-xs font-medium ${roi >= 0 ? 'text-[var(--color-fg-3)]' : 'text-[var(--color-accent)]'}`}>ROI</p>
 <p className={`text-lg font-medium ${roi >= 0 ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-accent)]'}`}>
 {roi.toFixed(1)}%
 </p>
 </div>
 </div>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <h4 className="mb-4 text-sm font-medium text-[var(--color-fg-1)]">Tendencia mensual</h4>
 <div className="h-56">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={monthlyTrend}>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.22)" />
 <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} />
 <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
 <Tooltip content={<ProjectChartTooltip />} />
 <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
 <Line type="monotone" dataKey="ingresos" stroke="var(--color-ok)" strokeWidth={2} dot={{ fill: 'var(--color-ok)', r: 3 }} name="Ingresos" />
 <Line type="monotone" dataKey="gastos" stroke="var(--color-accent)" strokeWidth={2} dot={{ fill: 'var(--color-accent)', r: 3 }} name="Gastos" />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <h4 className="mb-4 text-sm font-medium text-[var(--color-fg-1)]">Distribución de gastos</h4>
 <div className="h-56">
 {categoryDistribution.length > 0 ? (
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={categoryDistribution}
 cx="50%"
 cy="50%"
 innerRadius={45}
 outerRadius={75}
 paddingAngle={2}
 dataKey="value"
 >
 {categoryDistribution.map((_, i) => (
 <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />
 ))}
 </Pie>
 <Tooltip formatter={v => `${formatCurrency(v)} €`} contentStyle={{ borderRadius: '16px', border: '1px solid var(--color-line)', backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)' }} />
 <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '11px' }} />
 </PieChart>
 </ResponsiveContainer>
 ) : (
 <div className="flex h-full items-center justify-center text-sm text-[var(--color-fg-3)]">Sin gastos registrados</div>
 )}
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 lg:col-span-2">
 <h4 className="mb-4 text-sm font-medium text-[var(--color-fg-1)]">Evolución del margen mensual</h4>
 <div className="h-56">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={marginEvolution}>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.22)" />
 <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} />
 <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-3)', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
 <Tooltip content={<ProjectChartTooltip />} />
 <Bar dataKey="margen" name="Margen" radius={0} maxBarSize={40}>
 {marginEvolution.map((entry, i) => (
 <Cell key={i} fill={entry.margen >= 0 ? 'var(--color-ok)' : 'var(--color-accent)'} fillOpacity={0.85} />
 ))}
 </Bar>
 </BarChart>
 </ResponsiveContainer>
 </div>
 </div>
 </div>

 <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="flex border-b border-[var(--color-line)]">
 <button
 onClick={() => setActiveTab('income')}
 className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all ${
 activeTab === 'income'
 ? 'border-b-2 border-[var(--color-ok)] bg-transparent text-[var(--color-ok)]'
 : 'text-[var(--color-fg-3)] hover:bg-transparent hover:text-[var(--color-fg-4)]'
 }`}
 >
 <ArrowUpCircle size={16} />
 Ingresos ({incomeTransactions.length})
 </button>
 <button
 onClick={() => setActiveTab('expense')}
 className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all ${
 activeTab === 'expense'
 ? 'border-b-2 border-[var(--color-accent)] bg-transparent text-[var(--color-accent)]'
 : 'text-[var(--color-fg-3)] hover:bg-transparent hover:text-[var(--color-fg-4)]'
 }`}
 >
 <ArrowDownCircle size={16} />
 Gastos ({expenseTransactions.length})
 </button>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-fg-3)]">Fecha</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-fg-3)]">Descripción</th>
 <th className="hidden px-4 py-3 text-left text-xs font-medium text-[var(--color-fg-3)] md:table-cell">Categoría</th>
 <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-fg-3)]">Monto</th>
 <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-fg-3)]">Estado</th>
 <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-fg-3)]">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {currentTransactions
 .sort((a, b) => b.date.localeCompare(a.date))
 .map(t => (
 <tr key={t.id} className="group border-b border-[var(--color-bg-1)] last:border-0 transition-colors hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 text-[var(--color-fg-3)]">{formatDate(t.date)}</td>
 <td className="px-4 py-3">
 <span className="font-medium text-[var(--color-fg-1)]">{String(t.description || '')}</span>
 </td>
 <td className="px-4 py-3 hidden md:table-cell">
 <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
 t.type === 'income'
 ? 'border border-[var(--color-line-s)] bg-transparent text-[var(--color-ok)]'
 : 'border border-[var(--color-line-s)] bg-transparent text-[var(--color-accent)]'
 }`}>
 {String(t.category || '')}
 </span>
 </td>
 <td className={`px-4 py-3 text-right font-medium ${
 t.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'
 }`}>
 {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)} €
 </td>
 <td className="px-4 py-3 text-center">
 <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
 t.status === 'paid'
 ? 'border-[var(--color-line-s)] bg-transparent text-[var(--color-ok)]'
 : 'border-[var(--color-line-s)] bg-transparent text-[var(--color-warn)]'
 }`}>
 {t.status === 'paid' ? <CheckCircle2 size={12} /> : <Circle size={12} />}
 {t.status === 'paid' ? 'Pagado' : 'Pendiente'}
 </span>
 </td>
 <td className="px-4 py-3 text-center">
 <button
 onClick={() => handleEdit(t)}
 className="rounded-lg p-1.5 text-[var(--color-fg-3)] opacity-60 transition-all hover:bg-transparent hover:text-[var(--color-fg-1)] group-hover:opacity-100"
 title="Editar"
 >
 <Edit2 size={15} />
 </button>
 </td>
 </tr>
 ))}
 {currentTransactions.length === 0 && (
 <tr>
 <td colSpan="6" className="py-10 text-center text-sm text-[var(--color-fg-3)]">
 No hay {activeTab === 'income' ? 'ingresos' : 'gastos'} en este proyecto
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Edit Modal */}
 <TransactionFormModal
 isOpen={isFormModalOpen}
 onClose={() => { setIsFormModalOpen(false); setEditingTransaction(null); }}
 onSubmit={handleFormSubmit}
 editingTransaction={editingTransaction}
 user={user}
 expenseCategories={expenseCategories}
 incomeCategories={incomeCategories}
 costCenters={costCenters}
 />
 </div>
 );
};

export default ProjectDetail;
