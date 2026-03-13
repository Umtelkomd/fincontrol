# TASK: Saldo Bancario como KPI Central del Dashboard

## Contexto
Ya existe `useBankAccount.js` que calcula el saldo real (saldo inicial + transacciones pagadas después de la fecha de referencia). También existe `BankAccount.jsx` en settings que muestra 4 cards (saldo inicial, movimiento neto, saldo actual, crédito disponible).

**El problema:** Esta información está enterrada en Configuración. El usuario necesita ver el saldo bancario actual como **la primera cosa** al abrir el Dashboard.

## Qué hacer

### 1. Dashboard — Agregar KPI de Saldo Bancario como card principal

En `src/features/dashboard/Dashboard.jsx`:

- Importar `useBankAccount` hook
- Llamar `calculateRealBalance(allTransactions)` para obtener el saldo actual
- Agregar como **primera card** (antes de Ingresos/Gastos/Utilidad) un KPI grande tipo "hero":
  - Título: "Saldo Bancario"
  - Valor: saldo actual calculado (€XX,XXX.XX)
  - Subtítulo: nombre del banco + "actualizado al [fecha]"
  - Color: verde si positivo, rojo si negativo
  - Debajo: barra de línea de crédito si el saldo es negativo (usar la lógica de creditUtilizationPct de BankAccount.jsx)
  - Si no hay cuenta bancaria configurada: mostrar card con botón "Configurar Cuenta" que lleva a `/configuracion`

### 2. Dashboard — Mini timeline de saldo

Debajo de los KPIs, agregar un gráfico de línea (AreaChart de recharts) que muestre la evolución del saldo día a día:

- Eje X: últimos 30 días
- Eje Y: saldo bancario acumulado
- Línea verde cuando positivo, roja cuando negativo
- Línea punteada horizontal en 0 (breakeven)
- Línea punteada roja en el límite de crédito

Cálculo:
```javascript
// Para cada día de los últimos 30 días:
// saldo_dia = saldo_inicial + sum(transacciones_pagadas hasta ese día)
const dailyBalance = [];
for (let i = 29; i >= 0; i--) {
  const date = new Date();
  date.setDate(date.getDate() - i);
  const dateStr = date.toISOString().split('T')[0];
  
  const txUntilDate = allTransactions.filter(t => 
    t.date <= dateStr && t.date > bankAccount.balanceDate && t.status === 'paid'
  );
  
  let net = 0;
  txUntilDate.forEach(t => {
    net += t.type === 'income' ? t.amount : -t.amount;
  });
  
  dailyBalance.push({
    date: dateStr,
    label: date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    saldo: bankAccount.balance + net
  });
}
```

### 3. Header — Saldo siempre visible

En `App.jsx`, en el top header bar (donde dice "XX transacciones"), agregar el saldo bancario actual al lado:
```
💰 €15,230.00 | 175 transacciones
```

Esto requiere:
- Pasar `useBankAccount` al nivel de AppContent
- Calcular el saldo una vez y pasarlo como prop o context

### 4. Sidebar — Badge de liquidez

En `src/components/layout/Sidebar.jsx`, debajo del user pill, agregar un mini-widget:
```
Saldo: €15,230.00
[====------] 38% crédito
```

Solo si hay cuenta bancaria configurada.

## Archivos a modificar
1. `src/features/dashboard/Dashboard.jsx` — agregar hero KPI + timeline chart
2. `src/App.jsx` — agregar saldo en header (AppContent level)
3. `src/components/layout/Sidebar.jsx` — agregar mini badge de saldo

## Archivos que NO hay que tocar
- `src/hooks/useBankAccount.js` — ya funciona correctamente
- `src/features/settings/BankAccount.jsx` — ya funciona correctamente

## Estilo
- Mantener dark Apple-style consistente
- El hero KPI del saldo debe ser más grande que los otros KPIs (usar `text-4xl` vs `text-2xl`)
- El gráfico de timeline usar gradiente verde→transparente cuando positivo, rojo→transparente cuando negativo
- Animaciones suaves en las transiciones

## Datos de prueba
El saldo bancario actual está en Firestore:
- Path: `artifacts/{appId}/public/data/settings/bankAccount`
- Campos: `bankName`, `balance` (number), `balanceDate` (string YYYY-MM-DD), `creditLineLimit` (negative number)

## Prioridad
ALTA — esto es lo primero que el usuario quiere ver al abrir la app.
