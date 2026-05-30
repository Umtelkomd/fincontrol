// NEXUS.OS finance widget component for Nexus Hub
// Componente React para mostrar en el Hub de Work Manager

import React, { useEffect, useState, useCallback } from 'react';
import { 
 Wallet, 
 AlertTriangle, 
 TrendingUp, 
 TrendingDown,
 ArrowUpRight,
 ArrowDownRight,
 Bell
} from 'lucide-react';

const NexusFinanceHubWidget = () => {
 const [summary, setSummary] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, _setError] = useState(null);

 const fetchSummary = useCallback(async () => {
 try {
 // Intentar cargar desde la API de NEXUS.OS
 // Esto requiere que el usuario esté autenticado en NEXUS.OS
 const response = await fetch('https://umtelkomd-finance.web.app/api/hub-summary', {
 credentials: 'include',
 headers: {
 'Accept': 'application/json'
 }
 });

 if (response.ok) {
 const data = await response.json();
 setSummary(data);
 } else {
 // Fallback: cargar desde localStorage (últimos datos conocidos)
 const cached = localStorage.getItem('fincontrol_hub_cache');
 if (cached) {
 try {
 setSummary(JSON.parse(cached));
 } catch {
 // Corrupted cache, ignore
 }
 }
 }
 } catch (err) {
 console.error('Error fetching NEXUS.OS summary:', err);
 // Usar datos de demo si no hay conexión
 setSummary(getDemoData());
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchSummary();
 // Actualizar cada 5 minutos
 const interval = setInterval(fetchSummary, 5 * 60 * 1000);
 return () => clearInterval(interval);
 }, [fetchSummary]);

 const getDemoData = () => ({
 cashflow: {
 income: 45000,
 expense: 32000,
 balance: 13000
 },
 cxp: {
 total: 8500,
 pending: 3,
 overdue: 1,
 upcoming: 2
 },
 cxc: {
 total: 12000,
 pending: 2,
 overdue: 0,
 upcoming: 1
 },
 alerts: [
 { type: 'cxp_overdue', severity: 'high', message: 'Proveedor ABC - €2,500' }
 ],
 lastUpdate: new Date().toISOString()
 });

 const formatCurrency = (amount) => {
 return new Intl.NumberFormat('de-DE', {
 style: 'currency',
 currency: 'EUR',
 minimumFractionDigits: 0,
 maximumFractionDigits: 0
 }).format(amount);
 };

 if (loading) {
 return (
 <div className="nexus-widget nexus-widget-fincontrol">
 <div className="nexus-widget-header">
 <span>NEXUS.OS</span>
 </div>
 <div className="px-4 py-8 text-center font-mono text-[12px] text-[var(--color-fg-4)]">
 <p>Cargando…</p>
 </div>
 </div>
 );
 }

 if (error || !summary) {
 return (
 <div className="nexus-widget nexus-widget-fincontrol">
 <div className="nexus-widget-header">
 <span>NEXUS.OS</span>
 </div>
 <div className="nexus-widget-error">
 No se pudieron cargar los datos
 <button onClick={fetchSummary}>Reintentar</button>
 </div>
 </div>
 );
 }

 const hasAlerts = summary.alerts?.length > 0 || summary.cxp.overdue > 0;

 return (
 <div className={`nexus-widget nexus-widget-fincontrol ${hasAlerts ? 'has-alerts' : ''}`}>
 <div className="nexus-widget-header">
 <div className="nexus-widget-title">
 <span>NEXUS.OS</span>
 {hasAlerts && (
 <span className="nexus-alert-badge">
 <Bell size={12} />
 {summary.cxp.overdue + summary.cxc.overdue}
 </span>
 )}
 </div>
 <button 
  className="nx-btn nx-btn-ghost nx-btn-sm"
 onClick={() => window.open('https://umtelkomd-finance.web.app', '_blank')}
 >
 Abrir ↗
 </button>
 </div>

 <div className="nexus-widget-content">
 {/* Cashflow */}
 <div className="nexus-fin-row">
 <div className="nexus-fin-stat">
 <div className="nexus-fin-icon nexus-fin-income">
 <ArrowUpRight size={16} />
 </div>
 <div className="nexus-fin-info">
 <div className="nexus-fin-label">Ingresos</div>
 <div className="nexus-fin-value nexus-text-success">
 {formatCurrency(summary.cashflow.income)}
 </div>
 </div>
 </div>

 <div className="nexus-fin-stat">
 <div className="nexus-fin-icon nexus-fin-expense">
 <ArrowDownRight size={16} />
 </div>
 <div className="nexus-fin-info">
 <div className="nexus-fin-label">Gastos</div>
 <div className="nexus-fin-value nexus-text-danger">
 {formatCurrency(summary.cashflow.expense)}
 </div>
 </div>
 </div>
 </div>

 {/* Balance */}
 <div className="nexus-fin-balance">
 <Wallet size={20} />
 <div className="nexus-fin-balance-info">
 <div className="nexus-fin-balance-label">Balance 30 días</div>
 <div className={`nexus-fin-balance-value ${summary.cashflow.balance >= 0 ? 'positive' : 'negative'}`}>
 {formatCurrency(summary.cashflow.balance)}
 </div>
 </div>
 </div>

 {/* CXP / CXC */}
 <div className="nexus-fin-pending">
 <div className="nexus-pending-item">
 <span className="nexus-pending-label">Por Pagar (CXP)</span>
 <div className="nexus-pending-values">
 {summary.cxp.overdue > 0 && (
 <span className="nexus-pending-overdue">{summary.cxp.overdue} venc.</span>
 )}
 <span className="nexus-pending-total">{formatCurrency(summary.cxp.total)}</span>
 </div>
 </div>

 <div className="nexus-pending-item">
 <span className="nexus-pending-label">Por Cobrar (CXC)</span>
 <div className="nexus-pending-values">
 {summary.cxc.overdue > 0 && (
 <span className="nexus-pending-overdue">{summary.cxc.overdue} venc.</span>
 )}
 <span className="nexus-pending-total">{formatCurrency(summary.cxc.total)}</span>
 </div>
 </div>
 </div>

 {/* Alerts */}
 {hasAlerts && (
 <div className="nexus-fin-alerts">
 {summary.alerts.slice(0, 2).map((alert, idx) => (
 <div key={idx} className={`nexus-alert-item nexus-alert-${alert.severity}`}>
 <AlertTriangle size={14} />
 <span>{alert.message}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
};

// CSS para el widget (agregar al CSS del Hub)
const _widgetStyles = `
.nexus-widget-fincontrol {
 min-height: 280px;
}

.nexus-widget-fincontrol.has-alerts {
 border-color: var(--color-err);
}

.nexus-alert-badge {
 display: flex;
 align-items: center;
 gap: 4px;
 background: rgba(255, 77, 46, 0.12);
 color: var(--color-err);
 padding: 2px 8px;
 border-radius: var(--radius-lg);
 font-size: 11px;
 font-weight: 700;
}

.nexus-fin-row {
 display: grid;
 grid-template-columns: 1fr 1fr;
 gap: 12px;
 margin-bottom: 16px;
}

.nexus-fin-stat {
 display: flex;
 align-items: center;
 gap: 10px;
 padding: 12px;
 background: var(--color-bg-1);
 border-radius: var(--radius-md);
}

.nexus-fin-icon {
 width: 32px;
 height: 32px;
 display: flex;
 align-items: center;
 justify-content: center;
 border-radius: var(--radius-md);
}

.nexus-fin-income {
 background: rgba(74, 222, 128, 0.12);
 color: var(--color-ok);
}

.nexus-fin-expense {
 background: rgba(255, 77, 46, 0.12);
 color: var(--color-err);
}

.nexus-fin-label {
 font-size: 11px;
 color: var(--color-fg-4);
 text-transform: uppercase;
 letter-spacing: 0.5px;
}

.nexus-fin-value {
 font-size: 15px;
 font-weight: 700;
}

.nexus-text-success { color: var(--color-ok); }
.nexus-text-danger { color: var(--color-err); }

.nexus-fin-balance {
 display: flex;
 align-items: center;
 gap: 12px;
 padding: 16px;
 background: var(--color-bg-1);
 border-radius: var(--radius-md);
 margin-bottom: 16px;
}

.nexus-fin-balance-info {
 flex: 1;
}

.nexus-fin-balance-label {
 font-size: 12px;
 color: var(--color-fg-4);
}

.nexus-fin-balance-value {
 font-size: 24px;
 font-weight: 700;
}

.nexus-fin-balance-value.positive { color: var(--color-ok); }
.nexus-fin-balance-value.negative { color: var(--color-err); }

.nexus-fin-pending {
 display: flex;
 flex-direction: column;
 gap: 8px;
}

.nexus-pending-item {
 display: flex;
 align-items: center;
 justify-content: space-between;
 padding: 10px 12px;
 background: var(--color-bg-1);
 border-radius: var(--radius-sm);
}

.nexus-pending-label {
 font-size: 12px;
 color: var(--color-fg-3);
}

.nexus-pending-values {
 display: flex;
 align-items: center;
 gap: 8px;
}

.nexus-pending-overdue {
 font-size: 10px;
 font-weight: 600;
 color: var(--color-err);
 background: rgba(255, 77, 46, 0.12);
 padding: 2px 6px;
 border-radius: var(--radius-sm);
}

.nexus-pending-total {
 font-size: 13px;
 font-weight: 600;
 color: var(--color-fg-1);
}

.nexus-fin-alerts {
 margin-top: 12px;
 padding-top: 12px;
 border-top: 1px solid var(--color-line);
}

.nexus-alert-item {
 display: flex;
 align-items: center;
 gap: 8px;
 padding: 8px 10px;
 border-radius: var(--radius-sm);
 font-size: 12px;
}

.nexus-alert-high {
 background: rgba(255, 77, 46, 0.12);
 color: var(--color-err);
}

.nexus-alert-medium {
 background: rgba(255, 176, 32, 0.12);
 color: var(--color-warn);
}
`;

export default NexusFinanceHubWidget;
