# FinControl — Manual de Usuario

**Versión:** 1.0
**Fecha:** Marzo 2026
**Empresa:** UMTELKOMD GmbH (subsidiaria de HMR Nexus Engineering)
**URL:** [https://umtelkomd-finance.web.app](https://umtelkomd-finance.web.app)

---

## Tabla de Contenidos

1. [Introducción](#1-introducción)
2. [Acceso y Autenticación](#2-acceso-y-autenticación)
3. [Dashboard](#3-dashboard)
4. [Ingresos y Gastos](#4-ingresos-y-gastos)
5. [Cuentas por Cobrar (CXC)](#5-cuentas-por-cobrar-cxc)
6. [Cuentas por Pagar (CXP)](#6-cuentas-por-pagar-cxp)
7. [Presupuesto vs Real](#7-presupuesto-vs-real)
8. [Flujo de Caja](#8-flujo-de-caja)
9. [Balance General](#9-balance-general)
10. [Dashboard por Proyecto](#10-dashboard-por-proyecto)
11. [Conciliación Bancaria](#11-conciliación-bancaria)
12. [Centro de Alertas](#12-centro-de-alertas)
13. [Transacciones Recurrentes](#13-transacciones-recurrentes)
14. [Import/Export](#14-importexport)
15. [Reportes](#15-reportes)
16. [Configuración](#16-configuración)
17. [Multi-Moneda](#17-multi-moneda)
18. [Roles y Permisos](#18-roles-y-permisos)
19. [Auditoría](#19-auditoría)
20. [Backup](#20-backup)
21. [Documentos Adjuntos (Próximamente)](#21-documentos-adjuntos-próximamente)
22. [Atajos y Tips](#22-atajos-y-tips)
23. [Soporte](#23-soporte)

---

## 1. Introducción

### Qué es FinControl

FinControl es la plataforma de gestión financiera operativa de UMTELKOMD GmbH, diseñada para centralizar el control de transacciones, cuentas por cobrar y pagar, presupuestos, flujo de caja y reportes financieros. La aplicación permite a los equipos de finanzas y dirección tomar decisiones informadas con datos en tiempo real.

### Para quién es

FinControl está dirigido al equipo administrativo y directivo de UMTELKOMD GmbH:

- **Administradores** — Control total del sistema, configuración y gestión de usuarios.
- **Gerentes de Finanzas** — Registro de transacciones, gestión de CXC/CXP, reportes.
- **Gerentes de Proyecto** — Consulta de presupuestos y estados financieros por proyecto.
- **Visualizadores** — Acceso de solo lectura a dashboards y reportes.

### Requisitos

- Navegador web moderno (Chrome, Firefox, Safari o Edge en su versión más reciente).
- Conexión a internet estable.
- Cuenta de usuario autorizada con email y contraseña.

### URL de Acceso

```
https://umtelkomd-finance.web.app
```

---

## 2. Acceso y Autenticación

### Iniciar Sesión

1. Abrir la URL de FinControl en el navegador.
2. Ingresar el **correo electrónico** corporativo asociado a la cuenta.
3. Ingresar la **contraseña** asignada.
4. Hacer clic en **Iniciar Sesión**.

Si las credenciales son correctas, el sistema redirige al Dashboard principal. En caso de error, se muestra un mensaje indicando credenciales inválidas.

### Roles de Usuario

El sistema maneja cuatro roles con distintos niveles de acceso:

| Permiso | Admin | Finance Manager | Project Manager | Viewer |
|---|:---:|:---:|:---:|:---:|
| Ver Dashboard | Si | Si | Si | Si |
| Ver Reportes | Si | Si | Si | Si |
| Crear Transacciones | Si | Si | No | No |
| Editar Transacciones | Si | Si | No | No |
| Eliminar Transacciones | Si | Si | No | No |
| Gestionar CXC/CXP | Si | Si | No | No |
| Registrar Pagos/Cobros | Si | Si | No | No |
| Crear Presupuestos | Si | Si | No | No |
| Conciliación Bancaria | Si | Si | No | No |
| Configuración General | Si | No | No | No |
| Gestión de Usuarios | Si | No | No | No |
| Backup/Restauración | Si | No | No | No |
| Auditoría | Si | Si | No | No |
| Import/Export Datos | Si | Si | No | No |

---

## 3. Dashboard

El Dashboard es la vista principal de FinControl. Proporciona un resumen ejecutivo del estado financiero actual de la empresa.

### KPIs Principales

- **Saldo Actual** — Saldo disponible en caja/bancos calculado a partir de ingresos cobrados menos egresos pagados.
- **Ingresos Cobrados** — Total de ingresos efectivamente cobrados en el período seleccionado.
- **Egresos Pagados** — Total de gastos efectivamente pagados en el período seleccionado.

### KPIs Secundarios

- **CXC (Cuentas por Cobrar)** — Monto total pendiente de cobro a clientes.
- **CXP (Cuentas por Pagar)** — Monto total pendiente de pago a proveedores.
- **Liquidez Proyectada** — Estimación de liquidez basada en saldo actual, CXC esperadas y CXP pendientes.

### Alertas Activas

El Dashboard muestra un resumen de alertas vigentes:

- Facturas vencidas (CXC y CXP).
- Presupuestos que superan el 80% de ejecución.
- Proyección de cashflow negativo.

### Acciones Rápidas

Desde el Dashboard se puede acceder directamente a:

- Registrar nuevo ingreso.
- Registrar nuevo gasto.
- Crear cuenta por cobrar.
- Crear cuenta por pagar.

### Gráficos

- **Tendencia Mensual** — Gráfico de líneas que muestra la evolución de ingresos y gastos a lo largo del tiempo.
- **Distribución de Gastos** — Gráfico de dona/torta que muestra la distribución porcentual de gastos por categoría.

### Tabla de Proyectos

Listado resumido de todos los proyectos activos con sus ingresos, gastos y margen.

### Actividad Reciente

Registro de las últimas acciones realizadas en el sistema: transacciones creadas, pagos registrados, presupuestos modificados.

---

## 4. Ingresos y Gastos

### Vista de Ingresos

La sección de ingresos muestra todas las transacciones de tipo ingreso. Se puede filtrar por:

- **Período** — Rango de fechas.
- **Estado** — Pendiente, Parcial, Cobrado.
- **Categoría** — Según las categorías configuradas.
- **Proyecto** — Filtrar por proyecto específico.
- **Centro de Costo** — Filtrar por centro de costo.

### Vista de Gastos

Funciona de la misma manera que ingresos, pero para transacciones de tipo gasto. Los filtros disponibles son los mismos.

### Crear Nueva Transacción

Para registrar una nueva transacción:

1. Hacer clic en **Nueva Transacción** (o usar las acciones rápidas del Dashboard).
2. Se abre un modal con los siguientes campos:

| Campo | Descripción | Obligatorio |
|---|---|:---:|
| Fecha | Fecha de la transacción | Si |
| Descripción | Detalle de la transacción | Si |
| Monto | Importe en la moneda seleccionada | Si |
| Tipo | Ingreso o Gasto | Si |
| Categoría | Categoría del ingreso o gasto | Si |
| Proyecto | Proyecto asociado | No |
| Centro de Costo | Centro de costo asociado | No |
| Estado | Pendiente, Parcial, Cobrado/Pagado | Si |
| Recurrencia | Única, Semanal, Mensual, Trimestral, Anual | Si |

3. Completar los campos y hacer clic en **Guardar**.

### Registrar Pagos Parciales (Abonos)

Para transacciones que se cobran o pagan en cuotas:

1. Abrir la transacción desde la lista.
2. Hacer clic en **Registrar Abono**.
3. Ingresar el monto del abono y la fecha.
4. El sistema calcula automáticamente el saldo pendiente.
5. Cuando el saldo llega a cero, la transacción se marca como cobrada/pagada.

### Marcar como Cobrado/Pagado

Para marcar una transacción completa como cobrada o pagada:

1. Ubicar la transacción en la lista.
2. Hacer clic en el botón de acción correspondiente o abrir el detalle.
3. Confirmar el cobro/pago total.

---

## 5. Cuentas por Cobrar (CXC)

El módulo de Cuentas por Cobrar gestiona todas las facturas emitidas a clientes pendientes de cobro.

### KPIs de CXC

- **Total CXC** — Monto total de todas las cuentas por cobrar activas.
- **Parcialmente Cobradas** — Cuentas con abonos registrados pero saldo pendiente.
- **Vencidas** — Cuentas cuya fecha de vencimiento ya pasó.
- **Vencen esta semana** — Cuentas próximas a vencer en los siguientes 7 días.

### Antigüedad de Cartera (Aging Report)

El reporte de antigüedad clasifica las cuentas por cobrar según su tiempo de vencimiento:

| Rango | Descripción | Indicador |
|---|---|---|
| 0–30 días | Cartera corriente | Verde |
| 30–60 días | Cartera en mora temprana | Amarillo |
| 60–90 días | Cartera en mora | Naranja |
| > 90 días | Cartera de difícil cobro | Rojo |

### Crear Nueva Cuenta por Cobrar

1. Ir a la sección **CXC** en el menú lateral.
2. Hacer clic en **Nueva Cuenta por Cobrar**.
3. Completar los campos:

| Campo | Descripción | Obligatorio |
|---|---|:---:|
| Número de Factura | Identificador de la factura emitida | Si |
| Cliente | Nombre o razón social del cliente | Si |
| Proyecto | Proyecto asociado a la factura | No |
| Monto | Importe total de la factura | Si |
| Fecha de Emisión | Fecha en que se emitió la factura | Si |
| Condiciones de Pago | Días de plazo (ej. 30, 60, 90 días) | Si |
| Fecha de Vencimiento | Calculada automáticamente o ingresada manualmente | Si |

4. Hacer clic en **Guardar**.

### Registrar Cobros

1. Seleccionar la cuenta por cobrar de la lista.
2. Hacer clic en **Registrar Cobro**.
3. Ingresar el monto cobrado y la fecha.
4. El sistema actualiza el saldo pendiente automáticamente.
5. Si el monto es parcial, el estado cambia a **Parcial**.
6. Si cubre el total, el estado cambia a **Cobrada**.

### Filtros de CXC

- **Todas** — Muestra todas las cuentas por cobrar.
- **Emitidas** — Facturas emitidas sin ningún cobro registrado.
- **Parciales** — Facturas con cobros parciales.
- **Vencidas** — Facturas que superaron su fecha de vencimiento.
- **Cobradas** — Facturas completamente cobradas.

---

## 6. Cuentas por Pagar (CXP)

El módulo de Cuentas por Pagar gestiona todas las obligaciones de pago con proveedores y acreedores.

### KPIs de CXP

- **Total CXP** — Monto total de todas las cuentas por pagar activas.
- **Parcialmente Pagadas** — Cuentas con abonos registrados pero saldo pendiente.
- **Vencidas** — Cuentas cuya fecha de vencimiento ya pasó.
- **Vencen esta semana** — Cuentas próximas a vencer en los siguientes 7 días.

### Crear Nueva Cuenta por Pagar

1. Ir a la sección **CXP** en el menú lateral.
2. Hacer clic en **Nueva Cuenta por Pagar**.
3. Completar los campos:

| Campo | Descripción | Obligatorio |
|---|---|:---:|
| Número de Factura | Identificador de la factura recibida | Si |
| Proveedor | Nombre o razón social del proveedor | Si |
| Proyecto | Proyecto asociado | No |
| Monto | Importe total de la factura | Si |
| Fecha de Emisión | Fecha de la factura del proveedor | Si |
| Condiciones de Pago | Días de plazo acordados | Si |
| Fecha de Vencimiento | Fecha límite de pago | Si |

4. Hacer clic en **Guardar**.

### Registrar Pagos

1. Seleccionar la cuenta por pagar de la lista.
2. Hacer clic en **Registrar Pago**.
3. Ingresar el monto pagado y la fecha.
4. El sistema actualiza el saldo pendiente automáticamente.
5. Si el monto es parcial, el estado cambia a **Parcial**.
6. Si cubre el total, el estado cambia a **Pagada**.

### Filtros de CXP

- **Todas** — Muestra todas las cuentas por pagar.
- **Recibidas** — Facturas recibidas sin ningún pago registrado.
- **Parciales** — Facturas con pagos parciales.
- **Vencidas** — Facturas que superaron su fecha de vencimiento.
- **Pagadas** — Facturas completamente pagadas.

---

## 7. Presupuesto vs Real

El módulo de presupuesto permite planificar ingresos y gastos por proyecto y período, y comparar la ejecución real contra lo presupuestado.

### Crear un Presupuesto

1. Ir a **Presupuesto vs Real** en el menú lateral.
2. Hacer clic en **Nuevo Presupuesto**.
3. Configurar los parámetros generales:
   - **Proyecto** — Seleccionar el proyecto.
   - **Período** — Mes y año del presupuesto.
   - **Ingreso Objetivo** — Meta de ingreso para el período.
   - **Límite de Gasto** — Tope máximo de gasto permitido.
4. Agregar **líneas de presupuesto** por categoría:
   - Seleccionar la categoría de gasto.
   - Asignar el monto presupuestado.
   - Repetir para cada categoría relevante.
5. Hacer clic en **Guardar**.

### Vista Comparativa

La vista comparativa muestra lado a lado:

- **Presupuestado** — Monto planificado por categoría.
- **Real** — Monto ejecutado (transacciones registradas).
- **Desviación** — Diferencia absoluta y porcentual.

### Indicadores de Desviación

| Desviación | Color | Significado |
|---|---|---|
| < 10% | Verde | Ejecución dentro del rango aceptable |
| 10% – 25% | Amarillo | Precaución, desviación moderada |
| > 25% | Rojo | Alerta, desviación significativa |

### Gráfico de Barras Agrupadas

Muestra visualmente la comparación entre presupuestado y real por categoría, facilitando la identificación rápida de desviaciones.

### Alertas de Presupuesto

El sistema genera alertas automáticas cuando la ejecución de un presupuesto supera el **80%** del monto asignado, permitiendo tomar medidas correctivas antes de exceder el límite.

---

## 8. Flujo de Caja

El módulo de Flujo de Caja permite visualizar la situación de liquidez actual y proyectar el comportamiento futuro.

### Vista Actual de Cashflow

Muestra el flujo de caja real del período seleccionado:

- **Entradas** — Ingresos efectivamente cobrados.
- **Salidas** — Gastos efectivamente pagados.
- **Flujo Neto** — Diferencia entre entradas y salidas.
- **Saldo Acumulado** — Saldo progresivo mes a mes.

### Proyección Inteligente

FinControl proyecta el flujo de caja a **6 meses** utilizando tres escenarios:

| Escenario | Descripción |
|---|---|
| **Optimista** | Considera cobro del 90% de CXC y pago del 70% de CXP |
| **Base** | Considera cobro del 75% de CXC y pago del 85% de CXP |
| **Pesimista** | Considera cobro del 50% de CXC y pago del 100% de CXP |

### Factores de Proyección

La proyección se construye con base en:

- **Promedios históricos** — Tendencias de ingresos y gastos de los últimos meses.
- **CXC pendientes** — Cuentas por cobrar con sus fechas de vencimiento.
- **CXP pendientes** — Cuentas por pagar con sus fechas de vencimiento.
- **Transacciones recurrentes** — Ingresos y gastos programados de forma periódica.

---

## 9. Balance General

El Balance General presenta una vista resumida de la situación patrimonial de la empresa.

### Estructura del Balance

**Activos:**
- **Caja/Bancos** — Efectivo disponible en cuentas bancarias.
- **Cuentas por Cobrar (CXC)** — Montos pendientes de cobro a clientes.

**Pasivos:**
- **Cuentas por Pagar (CXP)** — Obligaciones pendientes de pago a proveedores.

**Patrimonio:**
- **Capital Social** — Capital aportado por los socios.
- **Utilidades Acumuladas** — Resultado neto acumulado (ingresos menos gastos).

### Ecuación Contable

El balance respeta la ecuación fundamental:

```
Activos = Pasivos + Patrimonio
```

El sistema muestra esta ecuación y verifica su cumplimiento. Cualquier discrepancia indica que es necesario revisar las transacciones registradas.

---

## 10. Dashboard por Proyecto

Permite analizar el desempeño financiero de cada proyecto de forma independiente.

### Seleccionar Proyecto

1. Ir a **Dashboard por Proyecto** en el menú lateral.
2. Seleccionar el proyecto del listado desplegable.

### P&L por Proyecto

Muestra el Estado de Resultados (Profit & Loss) del proyecto seleccionado:

- Ingresos totales del proyecto.
- Gastos totales del proyecto.
- Resultado neto (utilidad o pérdida).

### KPIs del Proyecto

| KPI | Descripción |
|---|---|
| **Ingresos** | Total facturado/cobrado del proyecto |
| **Gastos** | Total de costos y gastos asignados |
| **Margen** | Porcentaje de utilidad sobre ingresos |
| **ROI** | Retorno sobre la inversión del proyecto |

### Gráfico Mensual

Gráfico de barras o líneas que muestra la evolución mensual de ingresos y gastos del proyecto.

### Comparativa con Presupuesto

Si el proyecto tiene un presupuesto asignado, se muestra la comparación entre lo planificado y lo ejecutado, con los mismos indicadores de desviación del módulo de presupuesto.

---

## 11. Conciliación Bancaria

La conciliación bancaria permite verificar que los registros de FinControl coinciden con los estados de cuenta bancarios.

### Proceso de Conciliación

1. Ir a **Conciliación Bancaria** en el menú lateral.
2. Seleccionar el **mes** a conciliar.
3. Ingresar el **saldo real del banco** según el estado de cuenta.
4. El sistema muestra:
   - **Saldo del sistema** — Calculado a partir de las transacciones registradas.
   - **Saldo del banco** — El valor ingresado manualmente.
   - **Diferencia** — Discrepancia entre ambos valores.

### Identificar Discrepancias

Si existe diferencia entre el saldo del sistema y el saldo bancario, se debe revisar:

- Transacciones no registradas en FinControl.
- Transacciones registradas que no aparecen en el banco.
- Montos incorrectos.
- Comisiones o cargos bancarios no contabilizados.

### Marcar como Conciliado

Una vez verificados los saldos y resueltas las discrepancias:

1. Hacer clic en **Marcar como Conciliado**.
2. El mes queda registrado como conciliado con fecha y usuario.
3. Los meses conciliados se distinguen visualmente en el listado.

---

## 12. Centro de Alertas

El Centro de Alertas centraliza todas las notificaciones generadas automáticamente por el sistema.

### Tipos de Alertas

| Tipo | Descripción | Severidad |
|---|---|---|
| CXC Vencida | Factura de cliente venció sin cobro | Critica |
| CXP Vencida | Factura de proveedor venció sin pago | Critica |
| Presupuesto Excedido | Ejecución superó el límite presupuestado | Advertencia |
| Presupuesto > 80% | Ejecución cercana al límite | Advertencia |
| Cashflow Negativo | Proyección indica saldo negativo | Critica |
| CXC Próxima a Vencer | Factura vence en los próximos 7 días | Informativa |
| CXP Próxima a Vencer | Pago vence en los próximos 7 días | Informativa |

### Severidades

- **Critica** (rojo) — Requiere atención inmediata.
- **Advertencia** (amarillo) — Requiere seguimiento.
- **Informativa** (azul) — Para conocimiento, no requiere acción urgente.

### Gestión de Alertas

- Filtrar por severidad, tipo o estado (leída/no leída).
- Hacer clic en una alerta para ver el detalle y navegar al elemento relacionado.
- Marcar alertas como leídas individual o masivamente.

---

## 13. Transacciones Recurrentes

El módulo de transacciones recurrentes permite gestionar ingresos y gastos que se repiten con una frecuencia definida.

### Lista de Recurrencias

Muestra todas las transacciones configuradas como recurrentes con:

- Descripción de la transacción.
- Monto.
- Frecuencia.
- Próxima fecha de generación.
- Estado (activa/inactiva).

### Frecuencias Disponibles

| Frecuencia | Ciclo |
|---|---|
| Semanal | Cada 7 días |
| Mensual | Cada mes, mismo día |
| Trimestral | Cada 3 meses |
| Anual | Cada 12 meses |

### Generar Transacciones Pendientes

Para generar las transacciones recurrentes que corresponden al período actual:

1. Ir a **Transacciones Recurrentes**.
2. Revisar las transacciones pendientes de generación.
3. Hacer clic en **Generar Pendientes**.
4. El sistema crea las transacciones correspondientes con estado **Pendiente**.
5. Luego se pueden gestionar como cualquier transacción normal (cobrar, pagar, etc.).

---

## 14. Import/Export

### Exportar Datos

FinControl permite exportar datos en dos formatos:

- **CSV** — Archivo de texto separado por comas, compatible con cualquier hoja de cálculo.
- **Excel (.xlsx)** — Archivo nativo de Microsoft Excel con formato.

Para exportar:

1. Navegar a la sección cuyos datos se desean exportar (Ingresos, Gastos, CXC, CXP, etc.).
2. Hacer clic en el botón **Exportar**.
3. Seleccionar el formato deseado.
4. El archivo se descarga automáticamente.

### Importar Datos desde CSV

Para importar transacciones masivamente:

1. Ir a **Import/Export** en el menú lateral.
2. Hacer clic en **Importar CSV**.
3. Seleccionar el archivo CSV del equipo.
4. **Mapeo de columnas** — El sistema presenta las columnas del CSV y permite asignar cada una al campo correspondiente de FinControl (fecha, descripción, monto, categoría, etc.).
5. **Detección de duplicados** — El sistema identifica registros que podrían ya existir en la base de datos y los marca para revisión.
6. **Preview** — Se muestra una vista previa de los datos a importar con indicadores de estado (nuevo, posible duplicado, error).
7. Confirmar la importación haciendo clic en **Importar**.

---

## 15. Reportes

El módulo de Reportes genera informes financieros estandarizados.

### Reportes Disponibles

**Resumen Ejecutivo:**
- Vista consolidada del estado financiero para el período seleccionado.
- Incluye KPIs principales, tendencias y alertas relevantes.

**Estado de Resultados:**
- Ingresos totales por categoría.
- Gastos totales por categoría.
- Utilidad bruta y neta.
- Comparación con período anterior.

**Ratios Financieros:**
- Ratio de liquidez (Activos corrientes / Pasivos corrientes).
- Margen de utilidad.
- Rotación de cartera.
- Días promedio de cobro y pago.

**Reporte de CXC:**
- Listado detallado de cuentas por cobrar.
- Aging report (antigüedad de cartera).
- Resumen por cliente.

**Reporte de CXP:**
- Listado detallado de cuentas por pagar.
- Aging report.
- Resumen por proveedor.

### Exportar Reportes

Todos los reportes se pueden exportar en:

- **PDF** — Formato profesional listo para presentar o compartir.
- **Excel** — Formato editable para análisis adicional.

---

## 16. Configuración

El módulo de Configuración permite personalizar los catálogos y parámetros del sistema.

### Categorías de Ingreso/Gasto

- Ver, crear, editar y desactivar categorías.
- Cada categoría tiene un nombre y un tipo (Ingreso o Gasto).
- Las categorías desactivadas no aparecen al crear nuevas transacciones, pero las transacciones existentes conservan su referencia.

### Centros de Costo

- Gestionar los centros de costo de la empresa.
- Permiten clasificar las transacciones por área operativa o departamento.
- Ejemplos: Administración, Operaciones, Proyectos, TI.

### Proyectos

- Crear y gestionar proyectos.
- Cada proyecto tiene un nombre, descripción y estado (activo/inactivo).
- Los proyectos se utilizan para asignar transacciones, presupuestos y generar reportes por proyecto.

### Cuenta Bancaria

- Configurar los datos de la cuenta bancaria principal.
- Se utiliza como referencia para la conciliación bancaria.

---

## 17. Multi-Moneda

FinControl soporta operaciones en múltiples monedas, fundamental para una empresa con operaciones internacionales.

### Monedas Soportadas

| Moneda | Código | Símbolo |
|---|---|---|
| Euro | EUR | EUR |
| Dólar Estadounidense | USD | $ |
| Peso Colombiano | COP | $ |

### Gestión de Tasas de Cambio

- Registrar tasas de cambio manualmente para cada par de monedas.
- Las tasas se asocian a una fecha específica.
- El sistema utiliza la tasa más reciente disponible para las conversiones.

### Calculadora de Conversión

Herramienta integrada que permite:

1. Seleccionar moneda de origen.
2. Ingresar monto.
3. Seleccionar moneda de destino.
4. Ver el monto convertido según la tasa vigente.

---

## 18. Roles y Permisos

### Usuarios Actuales

| Usuario | Email | Rol |
|---|---|---|
| Jarl Romero | jromero@umtelkomd.com | Admin |
| Beatriz Sandoval | bsandoval@umtelkomd.com | Finance Manager |

### Roles Disponibles

| Rol | Código | Descripción |
|---|---|---|
| Administrador | `admin` | Control total del sistema |
| Gerente de Finanzas | `finance_manager` | Gestión financiera completa, sin acceso a configuración de sistema |
| Gerente de Proyecto | `project_manager` | Consulta de dashboards y reportes de sus proyectos |
| Visualizador | `viewer` | Solo lectura en todas las secciones |

### Matriz de Permisos

| Módulo | Admin | Finance Manager | Project Manager | Viewer |
|---|:---:|:---:|:---:|:---:|
| Dashboard | Completo | Completo | Lectura | Lectura |
| Ingresos/Gastos | CRUD | CRUD | Lectura | Lectura |
| CXC/CXP | CRUD | CRUD | Lectura | Lectura |
| Presupuestos | CRUD | CRUD | Lectura | Lectura |
| Flujo de Caja | Completo | Lectura | Lectura | Lectura |
| Balance General | Completo | Lectura | Lectura | Lectura |
| Dashboard Proyecto | Completo | Completo | Lectura | Lectura |
| Conciliación | Completo | Completo | No | No |
| Alertas | Completo | Completo | Lectura | Lectura |
| Reportes | Completo | Completo | Lectura | Lectura |
| Configuración | Completo | No | No | No |
| Usuarios | Completo | No | No | No |
| Auditoría | Completo | Lectura | No | No |
| Backup | Completo | No | No | No |

> **CRUD** = Crear, Leer, Actualizar, Eliminar

---

## 19. Auditoría

El módulo de Auditoría registra de forma inmutable todas las acciones realizadas en el sistema.

### Registro de Acciones

Cada entrada del log de auditoría incluye:

- **Fecha y hora** — Timestamp exacto de la acción.
- **Usuario** — Quién realizó la acción.
- **Acción** — Tipo de operación realizada.
- **Módulo** — Sección del sistema donde se ejecutó.
- **Detalle** — Descripción específica del cambio (valores anteriores y nuevos cuando aplica).

### Tipos de Acción

| Tipo | Descripción |
|---|---|
| Creación | Se creó un nuevo registro |
| Edición | Se modificó un registro existente |
| Eliminación | Se eliminó un registro |
| Pago | Se registró un pago o cobro |

### Filtros de Auditoría

- **Por usuario** — Ver acciones de un usuario específico.
- **Por acción** — Filtrar por tipo (creación, edición, eliminación, pago).
- **Por fecha** — Rango de fechas.
- **Por módulo** — Transacciones, CXC, CXP, Presupuestos, etc.

> El registro de auditoría es inmutable: no se puede editar ni eliminar. Esto garantiza la trazabilidad completa de todas las operaciones.

---

## 20. Backup

El módulo de Backup permite respaldar y restaurar los datos del sistema.

### Exportar Backup

1. Ir a **Backup** en el menú lateral (solo disponible para Admin).
2. Hacer clic en **Exportar Backup**.
3. El sistema genera un archivo JSON con todos los datos.
4. El archivo se descarga automáticamente con nombre en formato `fincontrol-backup-YYYY-MM-DD.json`.

### Colecciones Incluidas

El backup incluye todas las colecciones de datos:

- Transacciones (ingresos y gastos).
- Cuentas por Cobrar.
- Cuentas por Pagar.
- Presupuestos.
- Categorías.
- Centros de Costo.
- Proyectos.
- Tasas de cambio.
- Configuración.

### Restaurar desde Backup

1. Ir a **Backup**.
2. Hacer clic en **Restaurar Backup**.
3. Seleccionar el archivo JSON de backup.
4. Confirmar la restauración.
5. El sistema restaura los datos y muestra un resumen de los registros procesados.

> **Precaución:** La restauración sobreescribe los datos existentes. Se recomienda realizar un backup previo antes de restaurar.

---

## 21. Documentos Adjuntos (Próximamente)

Esta funcionalidad está planificada para una próxima versión y permitirá:

- Subir facturas, recibos y comprobantes de pago en formato PDF o imagen.
- Asociar documentos a transacciones, CXC o CXP.
- Visualizar documentos adjuntos directamente desde la aplicación.

> **Requisito técnico:** Esta funcionalidad requiere la activación de Firebase Storage en el proyecto.

---

## 22. Atajos y Tips

### Navegación por Sidebar

El menú lateral (sidebar) es el punto central de navegación. Está organizado por módulos y se puede colapsar para maximizar el área de trabajo.

### Acciones Rápidas desde el Dashboard

El Dashboard ofrece botones de acceso directo para las operaciones más frecuentes. Utilícelos para registrar transacciones sin necesidad de navegar al módulo correspondiente.

### Selector de Período

En la mayoría de las vistas, el selector de período ubicado en la parte superior permite cambiar rápidamente el rango de fechas de los datos mostrados. Las opciones típicas incluyen:

- Mes actual.
- Mes anterior.
- Trimestre actual.
- Año actual.
- Rango personalizado.

### Consejos Generales

- Registrar transacciones diariamente para mantener los datos actualizados.
- Realizar la conciliación bancaria al cierre de cada mes.
- Revisar las alertas periódicamente para anticipar problemas de liquidez.
- Exportar reportes antes de reuniones de revisión financiera.
- Crear presupuestos al inicio de cada período para facilitar el seguimiento.

---

## 23. Soporte

### Contacto

FinControl es desarrollado y mantenido por **HMR Nexus Engineering GmbH**.

- **Responsable técnico:** Jarl Romero — jromero@umtelkomd.com
- **Finanzas:** Beatriz Sandoval — bsandoval@umtelkomd.com

### Repositorio

- **GitHub:** [github.com/jarl9801/fincontrol](https://github.com/jarl9801/fincontrol)

### Reportar Problemas

Para reportar errores o solicitar nuevas funcionalidades, contactar al responsable técnico por correo electrónico o crear un issue en el repositorio de GitHub.

---

*FinControl v1.0 — UMTELKOMD GmbH / HMR Nexus Engineering GmbH*
