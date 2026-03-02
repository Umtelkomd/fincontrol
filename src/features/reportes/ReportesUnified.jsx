import React, { useState } from 'react';
import { FileText, TrendingUp, Activity, ArrowDownCircle, ArrowUpCircle, BarChart3 } from 'lucide-react';
import ExecutiveSummary from '../reports/ExecutiveSummary';
import Reports from '../reports/Reports';
import FinancialRatios from '../reports/FinancialRatios';
import ReportCXCXP from '../reports/ReportCXCXP';

const TABS = [
  { key: 'executive', label: 'Resumen Ejecutivo', icon: FileText },
  { key: 'results', label: 'Estado de Resultados', icon: TrendingUp },
  { key: 'ratios', label: 'Ratios Financieros', icon: Activity },
  { key: 'cxc', label: 'Reporte CXC', icon: ArrowUpCircle },
  { key: 'cxp', label: 'Reporte CXP', icon: ArrowDownCircle },
];

const ReportesUnified = ({ transactions, allTransactions }) => {
  const [activeTab, setActiveTab] = useState('executive');

  const renderTab = () => {
    switch (activeTab) {
      case 'executive':
        return <ExecutiveSummary transactions={transactions} allTransactions={allTransactions} />;
      case 'results':
        return <Reports transactions={transactions} allTransactions={allTransactions} />;
      case 'ratios':
        return <FinancialRatios transactions={transactions} allTransactions={allTransactions} />;
      case 'cxc':
        return <ReportCXCXP transactions={transactions} type="cxc" />;
      case 'cxp':
        return <ReportCXCXP transactions={transactions} type="cxp" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Tab Navigation */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] p-1.5">
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
                    ? 'bg-[rgba(10,132,255,0.12)] text-[#0a84ff] shadow-sm'
                    : 'text-[#8e8e93] hover:text-white hover:bg-[rgba(255,255,255,0.06)]'
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {renderTab()}
    </div>
  );
};

export default ReportesUnified;
