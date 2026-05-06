# CFO.OS Financial Order Implementation Plan

> **For Codex:** Implement this plan task-by-task. Keep the work read-only against Firestore. Do not deploy.

**Goal:** Build a practical CFO view for FinControl that helps Jarl order UMTELKOMD's numbers: cash, urgent payables, pending receivables, recent net movement, and data quality issues.

**Architecture:** Add pure CFO metric utilities, test them, then render a new `FinancialOrderPanel` inside `/cfo`. The panel should derive everything from the existing CFO snapshot and must not write to Firestore.

**Tech Stack:** React 19, Vite, Firebase Firestore, Tailwind v4/NEXUS.OS, Recharts, existing `src/components/ui/nexus` components.

---

## Repository Context

Work in:

```bash
/Users/jarl/Dev/fincontrol
```

Current branch:

```bash
feat/cfo-cash-position
```

Important constraints:

- App: React 19 + Vite + Firebase + Tailwind v4 + Recharts.
- Firebase project: `umtelkomd-finance`.
- Firestore path: `artifacts/{APP_ID}/public/data/{collection}`.
- This task is **frontend/read-only only**.
- Do **not** touch production data.
- Do **not** deploy.
- Do **not** remove or simplify `sanitizeValue()` in `src/hooks/useTransactions.js`.
- Do **not** flatten or rewrite `PartialPaymentModal`; it has a hook-safety wrapper pattern.
- Keep NEXUS.OS dark theme.
- If there are unrelated untracked files, leave them alone.

Before coding, run:

```bash
git status --short
npm run build
```

---

## Real Data Observed — Use for Validation, Do Not Hardcode

### Firestore counts

- `transactions`: 0
- `bankMovements`: 1648
- `receivables`: 40
- `payables`: 41
- `projects`: 14
- `costCenters`: 23
- `employees`: 3
- `recurringCosts`: 0
- `budgets`: 1

### Cash

- Bank: Volksbank
- `bankAccount.balance`: `-18600`
- `bankAccount.balanceDate`: `2026-02-05`
- Net since balance date: `+54039.52`
- Estimated cash today: `35439.52`
- Credit line: `-40000`

### Receivables / CXC

- Gross invoiced: `76826.44`
- Real open: `403.32`
- Overdue: `403.32`
- Statuses:
  - `settled`: 34
  - `issued`: 5
  - `cancelled`: 1

Open receivables detected:

- Gerda Böttcher — R-2025-185 — `134.44 €`
- Simone Krapp — R-2025-188 — `67.22 €`
- Monika Czulik — R-2025-190 — `67.22 €`
- R-2025-184 — `67.22 €`
- R-2025-183 — `67.22 €`

### Payables / CXP

- Gross total: `99537.54`
- Real open: `35597.50`
- Overdue: `34521.27`
- Statuses:
  - `settled`: 30
  - `issued`: 9
  - `partial`: 2

Top open payables detected:

1. IVA — `14293.94 €`
2. Barmer — `6651.39 €`
3. Contabilidad 2025 — `4672.42 €`
4. Última cuota Renault Trafic — `3711.61 €`
5. Seguro Trafic — `1757.13 €`
6. Kit Fusionadora Andrés — `1530.00 €`
7. BG ETEM Mutua 2025 — `1076.23 €`
8. Gestoría enero — `837.28 €`
9. MQH Factura Nº07 partial — `560.00 €`
10. MQH Factura Nº14 — `295.00 €`
11. IVA enero Finanzamt — `212.50 €`

### Bank movements

- Total in: `2044148.11`
- Total out: `1982614.09`
- Historical net: `61534.02`

Recent monthly net:

- `2026-01`: `+54359.46`
- `2026-02`: `-49031.74`
- `2026-03`: `-1152.22`
- `2026-04`: `+61536.54`

### Existing runway issue

The current panel uses gross outgoing burn as if it were survival runway. That yields around `0.4 months`, but it is misleading because the 30d and 90d net movements are positive.

Separate these concepts:

- **Cash coverage:** `cashToday / average monthly outflow`.
- **Net runway:** only when monthly net is negative.
- **Stress coverage:** cash today vs urgent overdue/open payables.

Do not show a dramatic projected “quiebre” based only on gross outflow when net flow is positive. Pretty dashboards that lie are just accounting cosplay.

---

## Task 1 — Create Pure CFO Metric Utilities

**Objective:** Centralize CFO math in pure, testable functions.

**Files:**

- Create: `src/features/cfo/lib/cfoMetrics.js`

Add these exported functions:

```js
export const toNumber = (value) => { /* ... */ };
export const formatIsoDate = (value) => { /* ... */ };
export const isClosedFinanceStatus = (status) => { /* ... */ };
export const getOpenAmount = (record) => { /* ... */ };
export const isOverdue = (record, asOfDate) => { /* ... */ };

export const summarizeReceivables = (receivables, asOfDate) => { /* ... */ };
export const summarizePayables = (payables, asOfDate) => { /* ... */ };
export const summarizeBankMovements = (bankMovements, asOfDate) => { /* ... */ };
export const summarizeDataQuality = (snapshot) => { /* ... */ };
export const summarizeCFOOrder = (snapshot, options = {}) => { /* ... */ };
```

Rules:

- `toNumber(value)` should safely parse numbers and numeric strings.
- `formatIsoDate(value)` should normalize strings/Date-like values to `YYYY-MM-DD`, or return `null`.
- `getOpenAmount(record)` must use this order:
  1. `openAmount`
  2. `pendingAmount`
  3. `amount - paidAmount`
  4. if closed, `0`
  5. fallback `amount`
- Closed statuses:
  - `settled`
  - `paid`
  - `pagado`
  - `closed`
  - `cerrado`
  - `cancelled`
  - `void`
- Open statuses:
  - `issued`
  - `partial`
  - any non-closed record with `openAmount > 0`
- Do not mutate original arrays.
- Round money values to 2 decimals.

Expected shape from `summarizeCFOOrder()`:

```js
{
  asOfDate,
  cash: {
    bankName,
    startingBalance,
    balanceDate,
    netSinceBalanceDate,
    cashToday,
    creditLineLimit,
  },
  receivables: {
    count,
    grossTotal,
    openTotal,
    overdueTotal,
    overdueCount,
    byStatus,
    topOpen,
  },
  payables: {
    count,
    grossTotal,
    openTotal,
    overdueTotal,
    overdueCount,
    byStatus,
    topUrgent,
  },
  bankMovements: {
    count,
    totalIn30,
    totalOut30,
    net30,
    totalIn90,
    totalOut90,
    net90,
    monthlyNet,
  },
  dataQuality: {
    warnings: [],
    stats: {}
  }
}
```

---

## Task 2 — Add Tests for CFO Metrics

**Objective:** Protect financial calculations from quiet nonsense.

**Files:**

- Create: `src/features/cfo/lib/cfoMetrics.test.js`

Cover:

1. `getOpenAmount()`:
   - uses `openAmount`
   - uses `pendingAmount`
   - uses `amount - paidAmount`
   - returns `0` for `settled`
2. `summarizeReceivables()`:
   - gross total
   - open total
   - overdue total/count
   - top open list
3. `summarizePayables()`:
   - open total
   - overdue total/count
   - top urgent sorted by:
     1. overdue first
     2. `dueDate` ascending
     3. `openAmount` descending
4. `summarizeBankMovements()`:
   - net 30d
   - net 90d
   - total in/out
5. `summarizeDataQuality()`:
   - warns if `transactions` is empty
   - warns if `recurringCosts` is empty
   - warns on missing/unknown project refs

Run:

```bash
npm test -- cfoMetrics
```

If no test runner exists, use Node’s built-in test runner if practical. Avoid adding new dependencies unless already present or clearly justified.

---

## Task 3 — Create Financial Order Panel

**Objective:** Render the operational CFO view.

**Files:**

- Create: `src/features/cfo/panels/FinancialOrderPanel.jsx`

Use:

```js
import { summarizeCFOOrder } from '../lib/cfoMetrics';
```

Layout:

### Section 1 — Main KPIs

Show:

- Cash hoy
- CXP abierta
- CXP vencida
- CXC abierta
- Neto 30d
- Neto 90d

Tone rules:

- `CXP vencida > 0` → warning/error
- `CXC abierta` → ok/neutral
- negative net → error
- positive net → ok

### Section 2 — Pagos urgentes

Compact table, top 10:

- Proveedor
- Concepto/documento
- Proyecto
- Vence
- Abierto
- Estado

### Section 3 — Cobros pendientes

Compact table, top 10:

- Cliente
- Factura/documento
- Proyecto
- Vence
- Abierto
- Estado

### Section 4 — Problemas de datos

Badges/alerts for:

- `transactions` empty
- `recurringCosts` empty
- bank movements without useful category
- project refs not found in canonical projects
- insufficient budgets

No modal yet. YAGNI.

---

## Task 4 — Integrate Into CFO Dashboard

**Objective:** Make `/cfo` show the financial order view first.

**Files:**

- Modify: `src/features/cfo/CFODashboard.jsx`

Current order:

1. Header
2. `CashPositionPanel`
3. KPIGrid diagnostics/hints
4. placeholder cards
5. Snapshot diagnostics

New order:

1. Header
2. `FinancialOrderPanel`
3. `CashPositionPanel`
4. remaining placeholders
5. diagnostics only in dev mode

Update copy.

Current idea:

> Cash position, forecast 13 semanas, margen...

New copy:

> Caja real, pagos urgentes, cobros pendientes y calidad de datos. Primero control operativo; después forecast bonito.

Keep refresh button.

Move “Snapshot diagnostics” behind:

```js
import.meta.env.DEV
```

or remove it from production rendering.

---

## Task 5 — Correct Visible Runway Semantics

**Objective:** Stop the UI from implying bankruptcy based only on gross outflow when net flow is positive.

**Files:**

- Modify: `src/features/cfo/lib/runway.js`
- Modify: `src/features/cfo/panels/CashPositionPanel.jsx`
- Update tests if existing tests cover runway labels/calculations.

Add to `summarizeCashPosition()`:

```js
net30PerMonth
net90PerMonth
cashCoverageMonths
netRunwayMonths
```

Rules:

- `cashCoverageMonths = cashToday / burn30.perMonth`
- `netRunwayMonths`:
  - if 30d net is positive or zero: `Infinity`
  - if 30d net is negative: `cashToday / abs(net30PerMonth)`
- Do not show “quiebre” if 30d net is positive.

UI label changes:

- `Runway` → `Coverage`
- Meta:
  - if net positive: `Neto 30d positivo`
  - if net negative: `Quiebre neto ~fecha`

The panel may still show gross burn, but must not treat gross outflow as the only survival signal.

---

## Task 6 — Extend CFO Snapshot Carefully

**Objective:** Give CFO panels enough metadata to flag data quality issues without adding multiple queries per panel.

**Files:**

- Modify: `src/features/cfo/hooks/useCFOSnapshot.js`

Currently fetches:

- `bankMovements`
- `receivables`
- `payables`
- `projects`
- `recurringCosts`
- `employees`
- `categories`
- `bankAccount`

Add:

- `budgets`
- `costCenters`

Rules:

- Keep single-fetch snapshot.
- Keep localStorage cache TTL 1h.
- Do not use `onSnapshot`.
- Do not add per-panel Firestore reads.

---

## Task 7 — Build and Verify

**Objective:** Confirm implementation is safe and buildable.

Run:

```bash
npm run build
```

Expected:

- Build passes.
- No import error for `@/components/ui/nexus`.
- No Firestore write code added.
- No deployment performed.

Review:

```bash
git diff -- src/features/cfo
```

Confirm:

- `src/hooks/useTransactions.js` unchanged.
- `src/components/ui/PartialPaymentModal.jsx` unchanged.
- No production data writes.

---

## Expected User-Facing Result

When Jarl opens `/cfo`, the top section should make this obvious in 10 seconds:

- Cash hoy: about `35,439.52 €`
- CXP abierta: about `35,597.50 €`
- CXP vencida: about `34,521.27 €`
- CXC abierta: about `403.32 €`
- Neto 30d: about `+17,839.76 €`
- Neto 90d: about `+54,039.52 €`

Interpretation:

- CXC is not the main problem.
- CXP vencida is the main operational risk.
- Cash almost covers open payables, but leaves little cushion.
- `recurringCosts` needs to be populated.
- `bankMovements` need classification.
- project references need normalization.

---

## Suggested Commit

```bash
git add src/features/cfo
git commit -m "feat(cfo): add financial order panel"
```

Do not deploy.

---

## Scope Guard

Do this first:

1. `cfoMetrics.js`
2. tests
3. `FinancialOrderPanel.jsx`
4. `/cfo` integration
5. build

Do **not** build the 13-week forecast yet. Without recurring costs and clean categories, forecast is financial astrology with SVG charts. First order, then prediction.
