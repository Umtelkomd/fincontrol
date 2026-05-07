// Notification System for NEXUS.OS
// Gestiona alertas de CXP/CXC y notificaciones push

class NexusNotifications {
  constructor() {
    this.permission = false;
    this.initialized = false;
    this.checkInterval = null;
  }

  // Inicializar notificaciones
  async init() {
    if (this.initialized) return;

    // Pedir permiso para notificaciones
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      this.permission = permission === 'granted';
    }

    this.initialized = true;
    console.log('NEXUS.OS notifications initialized:', this.permission);
  }

  // Verificar pagos próximos y vencidos
  checkUpcomingPayments(transactions) {
    const now = new Date();
    const threeDaysFromNow = new Date(now + 3 * 24 * 60 * 60 * 1000);
    const alerts = [];

    transactions.forEach(t => {
      if (t.status !== 'pending') return;

      const dueDate = new Date(t.date);
      const isCXP = t.type === 'expense';
      const isCXC = t.type === 'income';

      // CXP Vencida
      if (isCXP && dueDate < now) {
        alerts.push({
          type: 'cxp_overdue',
          title: '⚠️ CXP Vencida',
          message: `${t.description} - ${this.formatCurrency(t.amount)}`,
          severity: 'high',
          data: t
        });
      }

      // CXP Próxima (3 días)
      if (isCXP && dueDate >= now && dueDate <= threeDaysFromNow) {
        const daysLeft = Math.ceil((dueDate - now) / (24 * 60 * 60 * 1000));
        alerts.push({
          type: 'cxp_upcoming',
          title: `⏰ CXP en ${daysLeft} días`,
          message: `${t.description} - ${this.formatCurrency(t.amount)}`,
          severity: 'medium',
          data: t
        });
      }

      // CXC Vencida (por cobrar)
      if (isCXC && dueDate < now) {
        alerts.push({
          type: 'cxc_overdue',
          title: '💰 CXC Vencida',
          message: `${t.description} - ${this.formatCurrency(t.amount)}`,
          severity: 'high',
          data: t
        });
      }
    });

    return alerts;
  }

  // Mostrar notificación push
  showNotification(title, options = {}) {
    if (!this.permission) return;

    const notification = new Notification(title, {
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      tag: options.tag || Date.now(),
      requireInteraction: options.requireInteraction || false,
      ...options
    });

    notification.onclick = () => {
      window.focus();
      if (options.onClick) options.onClick();
      notification.close();
    };

    return notification;
  }

  // Enviar alertas del sistema
  sendAlerts(alerts) {
    alerts.forEach(alert => {
      // Notificación push
      this.showNotification(alert.title, {
        body: alert.message,
        tag: alert.type + (alert.data?.id || ''),
        requireInteraction: alert.severity === 'high',
        onClick: () => {
          // Navegar a la sección correspondiente
          if (alert.type.includes('cxp')) {
            window.navigate?.('cxp');
          } else if (alert.type.includes('cxc')) {
            window.navigate?.('cxc');
          }
        }
      });

      // Guardar en localStorage para mostrar en UI
      this.saveAlert(alert);
    });
  }

  // Guardar alerta en localStorage
  saveAlert(alert) {
    let alerts;
    try {
      alerts = JSON.parse(localStorage.getItem('fincontrol_alerts') || '[]');
    } catch {
      alerts = [];
    }
    alerts.push({
      ...alert,
      id: Date.now(),
      createdAt: new Date().toISOString(),
      read: false
    });

    // Mantener solo últimas 50 alertas
    if (alerts.length > 50) alerts.shift();

    localStorage.setItem('fincontrol_alerts', JSON.stringify(alerts));
  }

  // Obtener alertas no leídas
  getUnreadAlerts() {
    let alerts;
    try {
      alerts = JSON.parse(localStorage.getItem('fincontrol_alerts') || '[]');
    } catch {
      alerts = [];
    }
    return alerts.filter(a => !a.read);
  }

  // Marcar alerta como leída
  markAsRead(alertId) {
    let alerts;
    try {
      alerts = JSON.parse(localStorage.getItem('fincontrol_alerts') || '[]');
    } catch {
      return;
    }
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      alert.read = true;
      localStorage.setItem('fincontrol_alerts', JSON.stringify(alerts));
    }
  }

  // Limpiar alertas antiguas
  cleanOldAlerts(days = 7) {
    let alerts;
    try {
      alerts = JSON.parse(localStorage.getItem('fincontrol_alerts') || '[]');
    } catch {
      return;
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const filtered = alerts.filter(a => {
      const alertDate = new Date(a.createdAt);
      return alertDate > cutoff;
    });

    localStorage.setItem('fincontrol_alerts', JSON.stringify(filtered));
  }

  // Formatear moneda
  formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }

  // Iniciar monitoreo automático
  startMonitoring(transactionsGetter, intervalMinutes = 30) {
    // Verificar inmediatamente
    const check = () => {
      const transactions = transactionsGetter();
      const alerts = this.checkUpcomingPayments(transactions);
      if (alerts.length > 0) {
        this.sendAlerts(alerts);
      }
    };

    check();

    // Verificar periódicamente
    this.checkInterval = setInterval(check, intervalMinutes * 60 * 1000);
  }

  // Detener monitoreo
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// Singleton
export const nexusNotifications = new NexusNotifications();

export default NexusNotifications;
