import React, { Suspense, lazy, useState } from 'react';
import { FileText, TrendingUp, Activity, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

const ExecutiveSummary = lazy(() => import('../reports/ExecutiveSummary'));
const Reports = lazy(() => import('../reports/Reports'));
const FinancialRatios = lazy(() => import('../reports/FinancialRatios'));
const ReportCXCXP = lazy(() => import('../reports/ReportCXCXP'));

const TABS = [
 { key: 'executive', label: 'Resumen Ejecutivo', icon: FileText },
 { key: 'results', label: 'Estado de Resultados', icon: TrendingUp },
 { key: 'ratios', label: 'Ratios Financieros', icon: Activity },
 { key: 'cxc', label: 'Reporte CXC', icon: ArrowUpCircle },
 { key: 'cxp', label: 'Reporte CXP', icon: ArrowDownCircle },
];

const ReportesUnified = ({ user }) => {
 const [activeTab, setActiveTab] = useState('executive');

 const renderTab = () => {
 switch (activeTab) {
 case 'executive':
 return <ExecutiveSummary user={user} />;
 case 'results':
 return <Reports user={user} />;
 case 'ratios':
 return <FinancialRatios user={user} />;
 case 'cxc':
 return <ReportCXCXP user={user} type="cxc" />;
 case 'cxp':
 return <ReportCXCXP user={user} type="cxp" />;
 default:
 return null;
 }
 };

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 ">
 <div className="flex items-center gap-1 overflow-x-auto">
 {TABS.map(tab => {
 const Icon = tab.icon;
 const isActive = activeTab === tab.key;
 return (
 <button
 key={tab.key}
 onClick={() => setActiveTab(tab.key)}
 className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
 isActive
 ? 'border border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)] '
 : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)] hover:bg-[var(--color-bg-1)]'
 }`}
 >
 <Icon size={16} />
 <span className="hidden sm:inline">{tab.label}</span>
 </button>
 );
 })}
 </div>
 </div>

 <Suspense
 fallback={
 <div className="flex items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-16 ">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 }
 >
 {renderTab()}
 </Suspense>
 </div>
 );
};

export default ReportesUnified;
