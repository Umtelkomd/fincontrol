import { Suspense, lazy, useState } from 'react';
import { FileText, TrendingUp, Activity, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader';

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
 <PageHeader
 section="Reportes"
 title="Informes"
 subtitle="Lectura ejecutiva, resultados, ratios y cartera"
 />

 <div className="nx-tabs overflow-x-auto" role="tablist">
 {TABS.map(tab => {
 const Icon = tab.icon;
 const isActive = activeTab === tab.key;
 return (
 <button
 key={tab.key}
 type="button"
 role="tab"
 aria-selected={isActive}
 onClick={() => setActiveTab(tab.key)}
 className={`nx-tab ${isActive ? 'active' : ''}`}
 >
 <Icon size={14} />
 <span className="hidden sm:inline">{tab.label}</span>
 </button>
 );
 })}
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
