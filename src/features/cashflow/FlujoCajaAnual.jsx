import { useMemo, useState } from 'react';
import { TableProperties } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { formatCurrency, formatDate } from '../../utils/formatters';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [2024, 2025, 2026, CURRENT_YEAR + 1].filter((v, i, a) => a.indexOf(v) === i).sort();

const fmtCell = (val) => {
  if (!val || val === 0) return <span style={{ color: 'var(--nd-text-disabled)' }}>—</span>;
  if (val > 0) return <span style={{ color: 'var(--nd-success)' }}>+€{formatCurrency(val)}</span>;
  return <span style={{ color: 'var(--nd-accent)' }}>-€{formatCurrency(Math.abs(val))}</span>;
};

const fmtCellAbs = (val) => {
  if (!val || val === 0) return <span style={{ color: 'var(--nd-text-disabled)' }}>—</span>;
  return <span style={{ color: 'var(--nd-accent)' }}>€{formatCurrency(Math.abs(val))}</span>;
};

const isOverdue = (dueDate) => {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toISOString().slice(0, 10));
};

// ── Style helpers ──
const thStyle = (isFirst = false) => ({
  background: 'var(--nd-surface)',
  padding: '10px 12px',
  textAlign: isFirst ? 'left' : 'right',
  color: 'var(--nd-text-secondary)',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '2px solid var(--nd-border)',
  whiteSpace: 'nowrap',
  ...(isFirst ? { position: 'sticky', left: 0, zIndex: 10, width: 180 } : {}),
});

const tdStyle = (isFirst = false) => ({
  padding: '7px 12px',
  textAlign: isFirst ? 'left' : 'right',
  borderBottom: '1px solid var(--nd-border)',
  whiteSpace: 'nowrap',
  ...(isFirst ? { position: 'sticky', left: 0, zIndex: 5, background: 'inherit' } : {}),
});

const panelThStyle = (isFirst = false) => ({
  background: 'var(--nd-surface)',
  padding: '7px 10px',
  textAlign: isFirst ? 'left' : 'right',
  color: 'var(--nd-text-secondary)',
  fontSize: '9px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--nd-border)',
  whiteSpace: 'nowrap',
});

const panelTdStyle = (isFirst = false) => ({
  padding: '6px 10px',
  textAlign: isFirst ? 'left' : 'right',
  borderBottom: '1px solid var(--nd-border)',
  color: 'var(--nd-text-primary)',
  whiteSpace: 'nowrap',
  maxWidth: isFirst ? '140px' : 'unset',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// ── KPI Card ──
function KpiCard({ label, value, color, prefix = '', negative = false, signed = false, sub }) {
  const displayValue = negative ? Math.abs(value) : value;
  const formattedValue = `${prefix}${formatCurrency(displayValue)}`;
  const signedValue = signed
    ? (value >= 0 ? `+${prefix}${formatCurrency(value)}` : `-${prefix}${formatCurrency(Math.abs(value))}`)
    : formattedValue;

  return (
    <div className="rounded-2xl border border-[var(--nd-border)] p-4" style={{ background: 'var(--nd-surface)' }}>
      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--nd-text-secondary)' }}>{label}</p>
      <p className="text-lg font-bold leading-tight" style={{ color }}>{signed ? signedValue : formattedValue}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: 'var(--nd-text-disabled)' }}>{sub}</p>}
    </div>
  );
}

export default function FlujoCajaAnual({ user }) {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const { transactions, loading: txLoading } = useTransactions(user);
  const { receivables, loading: rxLoading } = useReceivables(user);
  const { payables, loading: pyLoading } = usePayables(user);

  const loading = txLoading || rxLoading || pyLoading;

  // ── Filter transactions by selected year ──
  const yearTx = useMemo(() => {
    return (transactions || []).filter((t) => {
      const y = t.date?.slice(0, 4);
      return y === String(selectedYear);
    });
  }, [transactions, selectedYear]);

  // ── Build category→month matrix ──
  const { incomeRows, expenseRows, monthTotalsIncome, monthTotalsExpense } = useMemo(() => {
    const incomeMap = {};
    const expenseMap = {};

    yearTx.forEach((t) => {
      const monthIdx = parseInt(t.date?.slice(5, 7), 10) - 1;
      if (monthIdx < 0 || monthIdx > 11) return;
      const cat = t.category || 'Sin categoría';
      const amount = Number(t.amount) || 0;

      if (t.type === 'income') {
        if (!incomeMap[cat]) incomeMap[cat] = new Array(12).fill(0);
        incomeMap[cat][monthIdx] += amount;
      } else if (t.type === 'expense') {
        if (!expenseMap[cat]) expenseMap[cat] = new Array(12).fill(0);
        expenseMap[cat][monthIdx] += amount;
      }
    });

    const toRows = (map) =>
      Object.entries(map)
        .map(([cat, months]) => ({ cat, months, total: months.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total);

    const sumCols = (rows) => {
      const totals = new Array(12).fill(0);
      rows.forEach((r) => r.months.forEach((v, i) => { totals[i] += v; }));
      return totals;
    };

    const ir = toRows(incomeMap);
    const er = toRows(expenseMap);
    return {
      incomeRows: ir,
      expenseRows: er,
      monthTotalsIncome: sumCols(ir),
      monthTotalsExpense: sumCols(er),
    };
  }, [yearTx]);

  // ── Net & Cumulative rows ──
  const { netRow, acumRow } = useMemo(() => {
    const nr = monthTotalsIncome.map((inc, i) => inc - monthTotalsExpense[i]);
    let running = 0;
    const ar = nr.map((v) => { running += v; return running; });
    return { netRow: nr, acumRow: ar };
  }, [monthTotalsIncome, monthTotalsExpense]);

  // ── YTD KPIs ──
  const ytdIncome = monthTotalsIncome.reduce((a, b) => a + b, 0);
  const ytdExpense = monthTotalsExpense.reduce((a, b) => a + b, 0);
  const ytdNet = ytdIncome - ytdExpense;

  // ── CxC / CxP ──
  const pendingCxC = useMemo(
    () => (receivables || []).filter((r) => r.status === 'issued'),
    [receivables],
  );
  const pendingCxP = useMemo(
    () => (payables || []).filter((p) => p.status === 'issued' || p.status === 'partial'),
    [payables],
  );

  const totalCxC = pendingCxC.reduce((a, r) => a + (r.openAmount || 0), 0);
  const totalCxP = pendingCxP.reduce((a, p) => a + (p.openAmount || 0), 0);
  const balanceNeto = totalCxC - totalCxP;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--nd-text-secondary)] border-t-transparent" />
          <p className="text-sm text-[var(--nd-text-secondary)]">Cargando flujo de caja anual...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── HEADER ── */}
      <div
        className="rounded-2xl border border-[var(--nd-border)] px-6 py-5 flex items-center justify-between"
        style={{ background: 'var(--nd-surface)', borderBottom: '2px solid var(--nd-success)33' }}
      >
        <div className="flex items-center gap-3">
          <TableProperties className="h-5 w-5" style={{ color: 'var(--nd-success)' }} />
          <div>
            <h1 className="text-xl font-bold text-[var(--nd-text-primary)]">Flujo de Caja Anual</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--nd-text-secondary)' }}>Vista consolidada por mes y categoría</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-lg border border-[var(--nd-border)] text-sm px-3 py-1.5 cursor-pointer"
            style={{ background: 'var(--nd-surface)', color: 'var(--nd-text-primary)' }}
          >
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{ background: 'var(--nd-success)22', color: 'var(--nd-success)', border: '1px solid var(--nd-success)44' }}
          >
            {selectedYear} YTD
          </span>
        </div>
      </div>

      {/* ── KPI BAR ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Ingresos YTD" value={ytdIncome} color="var(--nd-success)" prefix="€" />
        <KpiCard label="Gastos YTD" value={ytdExpense} color="var(--nd-accent)" prefix="€" negative />
        <KpiCard label="Resultado Neto" value={ytdNet} color={ytdNet >= 0 ? 'var(--nd-success)' : 'var(--nd-accent)'} prefix="€" signed />
        <KpiCard label="CxC Pendiente" value={totalCxC} color="var(--nd-interactive)" prefix="€" sub="Facturas issued" />
        <KpiCard label="CxP Pendiente" value={totalCxP} color="var(--nd-warning)" prefix="€" negative sub="Por pagar" />
        <KpiCard label="Balance CxC–CxP" value={balanceNeto} color={balanceNeto >= 0 ? 'var(--nd-success)' : 'var(--nd-accent)'} prefix="€" signed sub="Neto pendiente" />
      </div>

      {/* ── MAIN TABLE ── */}
      <section className="rounded-2xl border border-[var(--nd-border)] overflow-hidden" style={{ background: 'var(--nd-surface)' }}>
        <div className="px-5 py-4 border-b border-[var(--nd-border)]">
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--nd-text-primary)' }}>
            Estado de Cuenta por Mes
          </h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={thStyle(true)}>Concepto</th>
                {MONTHS.map((m) => <th key={m} style={thStyle()}>{m}</th>)}
                <th style={thStyle()}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {/* ── INCOME SECTION HEADER ── */}
              <tr style={{ background: 'var(--nd-surface)' }}>
                <td
                  colSpan={14}
                  style={{ padding: '8px 12px', color: 'var(--nd-text-secondary)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  ▲ INGRESOS
                </td>
              </tr>
              {incomeRows.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle(true), color: 'var(--nd-text-disabled)', fontStyle: 'italic' }}>Sin datos</td>
                  {MONTHS.map((_, i) => <td key={i} style={tdStyle()}><span style={{ color: 'var(--nd-text-disabled)' }}>—</span></td>)}
                  <td style={tdStyle()}><span style={{ color: 'var(--nd-text-disabled)' }}>—</span></td>
                </tr>
              )}
              {incomeRows.map((row) => (
                <tr key={row.cat} style={{ background: 'var(--nd-surface)' }}>
                  <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', color: 'var(--nd-success)' }}>{row.cat}</td>
                  {row.months.map((v, i) => <td key={i} style={tdStyle()}>{fmtCell(v)}</td>)}
                  <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCell(row.total)}</td>
                </tr>
              ))}
              {/* Subtotal income */}
              <tr style={{ background: 'var(--nd-surface)', borderTop: '1px solid var(--nd-success)44' }}>
                <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', color: 'var(--nd-success)', fontWeight: 700 }}>✦ TOTAL INGRESOS</td>
                {monthTotalsIncome.map((v, i) => <td key={i} style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCell(v)}</td>)}
                <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCell(ytdIncome)}</td>
              </tr>

              {/* ── EXPENSE SECTION HEADER ── */}
              <tr style={{ background: 'var(--nd-surface)' }}>
                <td
                  colSpan={14}
                  style={{ padding: '8px 12px', color: 'var(--nd-text-secondary)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  ▼ GASTOS
                </td>
              </tr>
              {expenseRows.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle(true), color: 'var(--nd-text-disabled)', fontStyle: 'italic' }}>Sin datos</td>
                  {MONTHS.map((_, i) => <td key={i} style={tdStyle()}><span style={{ color: 'var(--nd-text-disabled)' }}>—</span></td>)}
                  <td style={tdStyle()}><span style={{ color: 'var(--nd-text-disabled)' }}>—</span></td>
                </tr>
              )}
              {expenseRows.map((row) => (
                <tr key={row.cat} style={{ background: 'var(--nd-surface)' }}>
                  <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', color: '#ff7b7b' }}>{row.cat}</td>
                  {row.months.map((v, i) => <td key={i} style={tdStyle()}>{fmtCellAbs(v)}</td>)}
                  <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCellAbs(row.total)}</td>
                </tr>
              ))}
              {/* Subtotal expense */}
              <tr style={{ background: 'var(--nd-surface)', borderTop: '1px solid var(--nd-accent)44' }}>
                <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', color: 'var(--nd-accent)', fontWeight: 700 }}>✦ TOTAL GASTOS</td>
                {monthTotalsExpense.map((v, i) => <td key={i} style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCellAbs(v)}</td>)}
                <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmtCellAbs(ytdExpense)}</td>
              </tr>

              {/* ── FLUJO NETO ── */}
              <tr style={{ background: 'var(--nd-surface)', borderTop: '2px solid #3a3d50' }}>
                <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', fontWeight: 800, fontSize: '13px', color: 'var(--nd-text-primary)' }}>
                  ⚡ FLUJO NETO
                </td>
                {netRow.map((v, i) => (
                  <td key={i} style={{ ...tdStyle(), fontWeight: 800, fontSize: '13px' }}>{fmtCell(v)}</td>
                ))}
                <td style={{ ...tdStyle(), fontWeight: 800, fontSize: '13px' }}>{fmtCell(ytdNet)}</td>
              </tr>

              {/* ── ACUMULADO ── */}
              <tr style={{ background: 'var(--nd-surface)' }}>
                <td style={{ ...tdStyle(true), background: 'var(--nd-surface)', color: 'var(--nd-interactive)', fontWeight: 700 }}>📈 ACUMULADO</td>
                {acumRow.map((v, i) => (
                  <td key={i} style={{ ...tdStyle(), color: v >= 0 ? 'var(--nd-interactive)' : 'var(--nd-accent)', fontWeight: 700 }}>
                    {v === 0
                      ? <span style={{ color: 'var(--nd-text-disabled)' }}>—</span>
                      : `€${formatCurrency(v)}`}
                  </td>
                ))}
                <td style={{ ...tdStyle(), color: (acumRow[11] || 0) >= 0 ? 'var(--nd-interactive)' : 'var(--nd-accent)', fontWeight: 700 }}>
                  {(acumRow[11] || 0) === 0 ? <span style={{ color: 'var(--nd-text-disabled)' }}>—</span> : `€${formatCurrency(acumRow[11] || 0)}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── CxC / CxP PANELS ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* CxC Panel */}
        <div className="rounded-2xl border border-[var(--nd-border)] overflow-hidden" style={{ background: 'var(--nd-surface)' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--nd-border)]">
            <span className="font-bold text-sm" style={{ color: 'var(--nd-interactive)' }}>📥 Cuentas por Cobrar pendientes</span>
            <span className="font-bold text-base" style={{ color: 'var(--nd-success)' }}>€{formatCurrency(totalCxC)}</span>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={panelThStyle(true)}>Cliente</th>
                  <th style={panelThStyle()}>Documento</th>
                  <th style={panelThStyle()}>Vencimiento</th>
                  <th style={panelThStyle()}>Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {pendingCxC.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '12px', color: 'var(--nd-text-disabled)', textAlign: 'center' }}>
                      Sin facturas pendientes
                    </td>
                  </tr>
                )}
                {[...pendingCxC]
                  .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
                  .map((r) => (
                    <tr key={r.id}>
                      <td style={panelTdStyle(true)}>{r.counterpartyName || r.client || '—'}</td>
                      <td style={panelTdStyle()}>{r.documentNumber || r.invoiceNumber || '—'}</td>
                      <td style={{ ...panelTdStyle(), color: isOverdue(r.dueDate) ? 'var(--nd-warning)' : 'var(--nd-text-primary)' }}>
                        {r.dueDate ? formatDate(r.dueDate) : '—'}
                        {isOverdue(r.dueDate) && ' ⚠'}
                      </td>
                      <td style={{ ...panelTdStyle(), color: 'var(--nd-success)', fontWeight: 600 }}>
                        €{formatCurrency(r.openAmount || 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CxP Panel */}
        <div className="rounded-2xl border border-[var(--nd-border)] overflow-hidden" style={{ background: 'var(--nd-surface)' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--nd-border)]">
            <span className="font-bold text-sm" style={{ color: 'var(--nd-warning)' }}>📤 Cuentas por Pagar pendientes</span>
            <span className="font-bold text-base" style={{ color: 'var(--nd-accent)' }}>€{formatCurrency(totalCxP)}</span>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={panelThStyle(true)}>Proveedor</th>
                  <th style={panelThStyle()}>Documento</th>
                  <th style={panelThStyle()}>Vencimiento</th>
                  <th style={panelThStyle()}>Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {pendingCxP.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '12px', color: 'var(--nd-text-disabled)', textAlign: 'center' }}>
                      Sin obligaciones pendientes
                    </td>
                  </tr>
                )}
                {[...pendingCxP]
                  .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
                  .map((p) => (
                    <tr key={p.id}>
                      <td style={panelTdStyle(true)}>{p.counterpartyName || p.vendor || '—'}</td>
                      <td style={panelTdStyle()}>{p.documentNumber || p.invoiceNumber || '—'}</td>
                      <td style={{ ...panelTdStyle(), color: isOverdue(p.dueDate) ? 'var(--nd-warning)' : 'var(--nd-text-primary)' }}>
                        {p.dueDate ? formatDate(p.dueDate) : '—'}
                        {isOverdue(p.dueDate) && ' ⚠'}
                      </td>
                      <td style={{ ...panelTdStyle(), color: 'var(--nd-accent)', fontWeight: 600 }}>
                        €{formatCurrency(p.openAmount || 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
