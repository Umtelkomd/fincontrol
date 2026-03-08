# FinControl — Plan de Mejora v2.0
**Empresa:** UMTELKOMD GmbH
**App actual:** React 19 + Firebase (Firestore) + Tailwind + Recharts
**Deploy:** Firebase Hosting → umtelkomd-finance.web.app
**Autor:** HMR Nexus Engineering
**Fecha:** Marzo 2026

---

## Estado Actual

### Lo que funciona ✅
- Dashboard con KPIs (ingresos, gastos, balance, tendencia)
- CRUD de transacciones (ingreso/gasto) con categorías y proyectos
- CXC (Cuentas por Cobrar) con pagos parciales y tracking de vencimiento
- CXP (Cuentas por Pagar)
- Flujo de caja (CashFlow) con gráficos y proyección básica
- Reportes: Resumen Ejecutivo, Estado de Resultados, Ratios Financieros, CXC/CXP
- Configuración: categorías, centros de costo, proyectos, cuenta bancaria
- Roles: admin (Jarl), manager (Beatriz)
- Export: PDF + Excel
- UI dark mode estilo Apple (bien lograda)
- PeriodSelector para filtrar por mes/rango

### Lo que falta o está incompleto ❌
1. **No hay conciliación bancaria** — no se sabe si el saldo real del banco coincide con FinControl
2. **No hay presupuesto vs real** — no se pueden crear presupuestos por proyecto/mes y comparar
3. **No hay multi-moneda** — todo en EUR pero hay pagos en USD/COP
4. **No hay documentos adjuntos** — no se suben facturas/recibos a las transacciones
5. **No hay recurrencia inteligente** — las transacciones recurrentes se crean manualmente
6. **No hay alertas automáticas** — no avisa cuando CXC vence, flujo de caja bajo, etc.
7. **No hay auditoría** — no se sabe quién cambió qué y cuándo
8. **CXC/CXP no están separados como entidades** — son transacciones filtradas por status, no cuentas por cobrar/pagar reales
9. **No hay balance general** — solo estado de resultados
10. **No hay centro de costos real** — existe la estructura pero no se usa para análisis profundo
11. **No hay proyección inteligente** — la proyección de cashflow es lineal, no considera estacionalidad ni contratos
12. **Datos 2025 hardcodeados** — `balances2025.js` y `transactions2025.js` como archivos estáticos
13. **No hay backup/export de datos** — si Firebase se borra, se pierde todo
14. **No hay import masivo** — no se pueden importar transacciones desde CSV/Excel/banco

---

## Plan de Mejora (por prioridad)

### 🔴 PRIORIDAD ALTA (hacer primero)

#### 1. Presupuesto vs Real (Budget)
**Problema:** No hay forma de saber si un proyecto va bien o mal financieramente hasta que es tarde.

**Requerimientos:**
- Crear presupuesto por proyecto con líneas de ingreso y gasto esperado por mes
- Vista comparativa: presupuesto vs ejecutado (tabla + gráfico barras agrupadas)
- Indicador de desviación: verde (<10%), amarillo (10-25%), rojo (>25%)
- Alertas cuando un proyecto supera el 80% del presupuesto
- Presupuesto general de la empresa (suma de todos los proyectos + overhead)

**Modelo de datos:**
```javascript
budgets/{id}: {
  projectId: string,
  year: number,
  month: number,        // null = anual
  incomeTarget: number,
  expenseLimit: number,
  lines: [
    { category: string, amount: number, description: string }
  ],
  createdBy: string,
  createdAt: timestamp
}
```

**Componentes:**
- `BudgetManager.jsx` — CRUD de presupuestos
- `BudgetVsActual.jsx` — comparativa visual
- `BudgetAlert.jsx` — alertas de desviación
- Agregar tab "Presupuesto" al sidebar

---

#### 2. CXC/CXP como entidades independientes
**Problema:** Actualmente CXC/CXP son transacciones con status "pending". No tienen fecha de vencimiento real, condiciones de pago, ni historial de gestión.

**Requerimientos:**
- Colección separada `receivables` y `payables` en Firestore
- Campos: monto original, monto pendiente, fecha emisión, fecha vencimiento, condiciones de pago (neto 20/30/60 días), estado (emitida/vencida/parcial/pagada), historial de pagos parciales, notas de gestión
- Dashboard de antigüedad: 0-30d, 30-60d, 60-90d, >90d
- Enlazar con transacciones existentes (migrar las actuales)
- Botón "Registrar cobro" que crea la transacción de ingreso automáticamente
- Reporte de antigüedad de cartera (aging report)

**Modelo de datos:**
```javascript
receivables/{id}: {
  invoiceNumber: string,
  client: string,
  projectId: string,
  amount: number,
  pendingAmount: number,
  issueDate: date,
  dueDate: date,
  paymentTerms: string,    // "net20", "net30", "net60"
  status: string,          // "issued", "overdue", "partial", "paid"
  payments: [
    { date: date, amount: number, method: string, reference: string }
  ],
  notes: string,
  linkedTransactionId: string,
  createdBy: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

---

#### 3. Conciliación Bancaria
**Problema:** No se sabe si el saldo en FinControl coincide con la cuenta del banco.

**Requerimientos:**
- Registrar saldo bancario real (manual o futuro: import CSV del banco)
- Comparar saldo FinControl vs saldo banco
- Marcar transacciones como "conciliadas"
- Identificar discrepancias (transacciones no registradas)
- Vista mensual de conciliación
- Saldo bancario inicial configurable por mes

**Modelo de datos:**
```javascript
bankReconciliation/{id}: {
  accountId: string,
  month: string,           // "2026-03"
  bankBalance: number,     // saldo real del banco
  systemBalance: number,   // saldo calculado por FinControl
  discrepancy: number,     // diferencia
  reconciledTransactions: [string],  // IDs
  unreconciledItems: [
    { description: string, amount: number, type: string }
  ],
  status: string,          // "pending", "reconciled"
  reconciledBy: string,
  reconciledAt: timestamp
}
```

---

#### 4. Alertas y Notificaciones
**Problema:** Nadie avisa cuando algo está mal. Te enteras tarde.

**Requerimientos:**
- Centro de notificaciones (icono campana en header con badge)
- Alertas automáticas:
  - CXC vencida (>30 días)
  - CXC por vencer (próximos 7 días)
  - Flujo de caja negativo proyectado
  - Gasto mensual supera presupuesto
  - Proyecto con desviación >25%
  - Transacciones recurrentes por generar
- Push notifications (vía Firebase Cloud Messaging)
- Resumen diario por email (opcional, vía Cloud Functions)
- Historial de alertas

**Modelo de datos:**
```javascript
notifications/{id}: {
  type: string,            // "cxc_overdue", "budget_exceeded", "cashflow_warning"
  severity: string,        // "info", "warning", "critical"
  title: string,
  message: string,
  relatedEntity: string,   // ID de la transacción/proyecto
  read: boolean,
  userId: string,
  createdAt: timestamp
}
```

---

### 🟡 PRIORIDAD MEDIA (segundo sprint)

#### 5. Documentos adjuntos (Facturas/Recibos)
**Requerimientos:**
- Subir PDF/imagen al crear o editar transacción
- Almacenar en Firebase Storage
- Preview inline (PDF viewer / image viewer)
- Máximo 5 archivos por transacción, 10MB cada uno
- Campo `attachments: [{name, url, type, size, uploadedAt}]` en la transacción

---

#### 6. Recurrencia automática
**Requerimientos:**
- Al crear transacción recurrente, definir: frecuencia (semanal/mensual/trimestral/anual), fecha inicio, fecha fin (opcional), monto fijo o variable
- Cloud Function que genera transacciones automáticamente al inicio de cada período
- Vista "Próximas recurrentes" con las que se van a generar este mes
- Botón para generar manualmente si la función no corrió
- Poder pausar/cancelar recurrencia sin borrar historial

---

#### 7. Import/Export masivo
**Requerimientos:**
- Import CSV: mapear columnas (fecha, monto, descripción, categoría, proyecto)
- Import Excel (xlsx)
- Import extracto bancario (CSV del banco — formato configurable)
- Preview antes de importar (tabla editable)
- Detectar duplicados (por fecha+monto+descripción)
- Export completo de toda la base a Excel con múltiples hojas

---

#### 8. Balance General
**Requerimientos:**
- Vista de Balance General (Activos, Pasivos, Patrimonio)
- Activos: Caja/Bancos (saldo actual), CXC, Inventario (equipos), Vehículos
- Pasivos: CXP, Préstamos, Impuestos por pagar
- Patrimonio: Capital social, Utilidades acumuladas
- Cálculo automático desde transacciones + CXC/CXP
- Exportable a PDF

---

#### 9. Auditoría (Audit Log)
**Requerimientos:**
- Log de todos los cambios: creación, edición, eliminación de transacciones
- Campos: quién, cuándo, qué cambió (before/after)
- Vista filtrable por usuario, tipo de acción, fecha
- Inmutable (no se puede borrar el log)
- Colección `auditLog/{id}` en Firestore

---

### 🟢 PRIORIDAD BAJA (tercer sprint / nice-to-have)

#### 10. Multi-moneda
- Soporte para EUR, USD, COP
- Tipo de cambio configurable (manual o API)
- Conversión automática para reportes consolidados en EUR
- Campo `currency` y `exchangeRate` en transacciones

#### 11. Proyección inteligente de cashflow
- Proyección basada en: contratos firmados, CXC esperada, gastos fijos, estacionalidad
- Escenarios: optimista / base / pesimista
- Monte Carlo para rangos de probabilidad
- Gráfico de proyección a 6-12 meses con bandas de confianza

#### 12. Dashboard por proyecto
- P&L por proyecto individual
- Rentabilidad por proyecto (ingreso - costo directo - overhead prorrateado)
- Comparativa entre proyectos
- Timeline de proyecto con hitos financieros

#### 13. Roles y permisos granulares
- Roles: admin, finance_manager, project_manager, viewer
- Permisos por módulo y por acción (ver/crear/editar/borrar)
- Invitar usuarios por email
- Gestión de usuarios desde la app

#### 14. Backup automático
- Cloud Function que exporta toda la DB a JSON/Excel semanalmente
- Guardar en Google Drive automáticamente
- Retención: 12 backups (3 meses de semanales)
- Botón manual de backup desde Configuración

#### 15. API externa
- REST API para integrar con otros sistemas (NE4 Work Manager, dashboards)
- Endpoints: GET transacciones, GET KPIs, POST transacción
- Auth via API key
- Rate limiting

---

## Arquitectura Recomendada

### Mantener (no cambiar)
- ✅ React 19 + Vite
- ✅ Firebase (Firestore + Auth + Hosting)
- ✅ Tailwind CSS
- ✅ Recharts para gráficos
- ✅ Dark mode Apple-style

### Agregar
- **Firebase Cloud Functions** — para recurrencia automática, alertas, backups
- **Firebase Storage** — para adjuntos (facturas/recibos)
- **Firebase Cloud Messaging** — para push notifications
- **Zustand o Context mejorado** — el state management actual con hooks está bien pero se complicará con más módulos
- **React Router** — actualmente usa state para navegación (`view`). Con más vistas, necesita router real
- **Firestore Security Rules** — actualmente sin RLS; necesita reglas por usuario/rol

### Migración de datos
- Mover `balances2025.js` y `transactions2025.js` a Firestore (colección `historicalData`)
- Migrar transacciones con status pending a la nueva colección `receivables`/`payables`
- Crear presupuestos iniciales basados en datos históricos

---

## Estimación de Esfuerzo

| Prioridad | Feature | Complejidad | Estimación |
|---|---|---|---|
| 🔴 Alta | Presupuesto vs Real | Media | 2-3 días |
| 🔴 Alta | CXC/CXP independientes | Alta | 3-4 días |
| 🔴 Alta | Conciliación bancaria | Media | 2-3 días |
| 🔴 Alta | Alertas/Notificaciones | Media | 2-3 días |
| 🟡 Media | Documentos adjuntos | Baja | 1-2 días |
| 🟡 Media | Recurrencia automática | Media | 2-3 días |
| 🟡 Media | Import/Export masivo | Media | 2-3 días |
| 🟡 Media | Balance General | Media | 2-3 días |
| 🟡 Media | Audit Log | Baja | 1-2 días |
| 🟢 Baja | Multi-moneda | Media | 2-3 días |
| 🟢 Baja | Proyección inteligente | Alta | 3-4 días |
| 🟢 Baja | Dashboard por proyecto | Media | 2-3 días |
| 🟢 Baja | Roles granulares | Media | 2-3 días |
| 🟢 Baja | Backup automático | Baja | 1 día |
| 🟢 Baja | API externa | Alta | 3-4 días |
| | **TOTAL** | | **~30-40 días** |

---

## Orden de Implementación Sugerido

### Sprint 1 (semana 1-2): Fundamentos financieros
1. CXC/CXP como entidades independientes (migrar datos existentes)
2. Presupuesto vs Real
3. React Router (reemplazar `view` state por rutas reales)

### Sprint 2 (semana 3-4): Control y visibilidad
4. Conciliación bancaria
5. Alertas y notificaciones
6. Audit Log

### Sprint 3 (semana 5-6): Productividad
7. Documentos adjuntos
8. Recurrencia automática
9. Import/Export masivo

### Sprint 4 (semana 7-8): Reportes avanzados
10. Balance General
11. Dashboard por proyecto
12. Proyección inteligente de cashflow

### Sprint 5 (semana 9-10): Escalabilidad
13. Multi-moneda
14. Roles granulares
15. Backup automático + API

---

## Notas técnicas para Claude Code

### Firestore path
Todas las colecciones están bajo:
```
artifacts/{APP_ID}/public/data/
```
Donde `APP_ID = 1:597712756560:web:ad12cd9794f11992641655`

### Colecciones existentes
- `transactions` — 175 docs (income/expense, status: paid/pending/partial)
- `costCenters` — 14 docs
- `categories` — 27 docs
- `projects` — 7 docs (QFF-001, WEST-001, FBX, etc.)

### Colecciones nuevas a crear
- `budgets`
- `receivables`
- `payables`
- `bankReconciliation`
- `notifications`
- `auditLog`

### Auth
- Firebase Auth (email/password)
- Roles en `constants/config.js` (USER_ROLES)
- Admin: jromero@umtelkomd.com
- Manager: bsandoval@umtelkomd.com

### Deploy
```bash
cd /Users/jarl/Dev/fincontrol
npm run build
npx firebase deploy --only hosting
```

### Estilo
- Dark mode Apple-style (ya implementado)
- Colores: fondo `#1c1c1e`, bordes `rgba(255,255,255,0.06)`, verde `#30d158`, rojo `#ff453a`, azul `#0a84ff`
- Font: system fonts (San Francisco en Apple)
- Mantener consistencia con componentes existentes (Card, Toast, Modal patterns)
- Responsive: sidebar en desktop, bottom menu en mobile

### Testing
- No hay tests actualmente. Considerar agregar tests para hooks financieros críticos (useMetrics, useCashFlow)
- Vitest + Testing Library recomendado
