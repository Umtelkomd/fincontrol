import React, { useState } from 'react';
import { Tag, Building2, FolderOpen, Landmark, Anchor } from 'lucide-react';
import Categories from '../settings/Categories';
import CostCenters from '../settings/CostCenters';
import Projects from '../settings/Projects';
import BankAccount from '../settings/BankAccount';
import Treasury from '../settings/Treasury';

const TABS = [
 { key: 'treasury', label: 'Tesorería', icon: Anchor },
 { key: 'projects', label: 'Proyectos', icon: FolderOpen },
 { key: 'categories', label: 'Categorías', icon: Tag },
 { key: 'cost-centers', label: 'Centros de Costo', icon: Building2 },
 { key: 'bank-account', label: 'Cuenta Bancaria', icon: Landmark },
];

const ConfiguracionUnified = ({ user }) => {
 const [activeTab, setActiveTab] = useState('treasury');

 const renderTab = () => {
 switch (activeTab) {
 case 'treasury':
 return <Treasury user={user} />;
 case 'projects':
 return <Projects user={user} />;
 case 'categories':
 return <Categories user={user} />;
 case 'cost-centers':
 return <CostCenters user={user} />;
 case 'bank-account':
 return <BankAccount user={user} />;
 default:
 return null;
 }
 };

 return (
 <div className="space-y-6 animate-fadeIn">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2">
 <div className="flex items-center gap-1 overflow-x-auto">
 {TABS.map(tab => {
 const Icon = tab.icon;
 const isActive = activeTab === tab.key;
 return (
 <button
 key={tab.key}
 onClick={() => setActiveTab(tab.key)}
  className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
  isActive
  ? 'border border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-fg-1)]'
  : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)] hover:bg-[var(--color-bg-2)]'
  }`}
 >
 <Icon size={16} />
 {tab.label}
 </button>
 );
 })}
 </div>
 </div>

 {renderTab()}
 </div>
 );
};

export default ConfiguracionUnified;
