// NEXUS.OS Hub Widget API
// Expone datos para el Nexus Hub

import { collection, getDocs } from 'firebase/firestore';
import { db, appId } from '../services/firebase';

class NexusWidgetAPI {
  constructor() {
    this.cache = {
      lastUpdate: null,
      data: null
    };
    this.listeners = [];
  }

  // Obtener resumen rápido para el Hub
  async getHubSummary() {
    try {
      const transactionsRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
      const snapshot = await getDocs(transactionsRef);
      
      const transactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000);

      // Calcular métricas
      const summary = {
        // Cashflow
        cashflow: {
          income: 0,
          expense: 0,
          balance: 0
        },
        // CXP (Cuentas por Pagar)
        cxp: {
          total: 0,
          pending: 0,
          overdue: 0,
          upcoming: 0
        },
        // CXC (Cuentas por Cobrar)
        cxc: {
          total: 0,
          pending: 0,
          overdue: 0,
          upcoming: 0
        },
        // Alertas
        alerts: [],
        lastUpdate: new Date().toISOString()
      };

      transactions.forEach(t => {
        const amount = t.amount || 0;
        const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        const isPending = t.status === 'pending';

        // Cashflow (últimos 30 días)
        if (date >= thirtyDaysAgo) {
          if (t.type === 'income') {
            summary.cashflow.income += amount;
          } else {
            summary.cashflow.expense += amount;
          }
        }

        // CXP - Gastos pendientes
        if (t.type === 'expense' && isPending) {
          summary.cxp.total += amount;
          summary.cxp.pending++;

          if (date < now) {
            summary.cxp.overdue++;
            summary.alerts.push({
              type: 'cxp_overdue',
              severity: 'high',
              message: `CXP vencida: ${t.description}`,
              amount,
              date: date.toISOString()
            });
          } else if (date <= sevenDaysFromNow) {
            summary.cxp.upcoming++;
            summary.alerts.push({
              type: 'cxp_upcoming',
              severity: 'medium',
              message: `CXP próxima: ${t.description}`,
              amount,
              date: date.toISOString()
            });
          }
        }

        // CXC - Ingresos pendientes
        if (t.type === 'income' && isPending) {
          summary.cxc.total += amount;
          summary.cxc.pending++;

          if (date < now) {
            summary.cxc.overdue++;
          } else if (date <= sevenDaysFromNow) {
            summary.cxc.upcoming++;
          }
        }
      });

      summary.cashflow.balance = summary.cashflow.income - summary.cashflow.expense;

      this.cache = {
        lastUpdate: Date.now(),
        data: summary
      };

      return summary;
    } catch (error) {
      console.error('NexusWidgetAPI Error:', error);
      return this.cache.data || this.getDefaultSummary();
    }
  }

  getDefaultSummary() {
    return {
      cashflow: { income: 0, expense: 0, balance: 0 },
      cxp: { total: 0, pending: 0, overdue: 0, upcoming: 0 },
      cxc: { total: 0, pending: 0, overdue: 0, upcoming: 0 },
      alerts: [],
      lastUpdate: new Date().toISOString()
    };
  }

  // Suscribirse a cambios en tiempo real
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  // Notificar a todos los listeners
  notify(data) {
    this.listeners.forEach(cb => cb(data));
  }

  // Formatear moneda
  formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }
}

// Singleton export
export const nexusWidget = new NexusWidgetAPI();

export default NexusWidgetAPI;
