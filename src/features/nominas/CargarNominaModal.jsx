import { useEffect, useMemo, useState } from 'react';
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { computePayrollTotals } from './lib/payroll';
import { buildPayrollFromTexts } from './lib/datevPayrollParser';
import { extractPayrollTexts } from './lib/extractPdfText';
import { formatCurrency } from '../../utils/formatters';

const EMPTY_KK_ROW = () => ({ payee: '', amount: '', dueDate: '' });

/**
 * CargarNominaModal — form to load a new payroll period.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   onSubmit: (formData) => Promise<{success, error?}>
 *   activeEmployees: Array (from useEmployees.getActiveEmployees())
 *   loading: boolean
 */
const CargarNominaModal = ({ isOpen, onClose, onSubmit, activeEmployees = [], loading = false }) => {
  const { showToast } = useToast();

  // Derive distinct Krankenkasse names from employees for suggestions
  const kkSuggestions = useMemo(() => {
    const names = activeEmployees
      .map((e) => e.krankenkasse)
      .filter(Boolean);
    return [...new Set(names)].sort();
  }, [activeEmployees]);

  // ─── Form state ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [period, setPeriod] = useState(today);
  const [kkRows, setKkRows] = useState([EMPTY_KK_ROW()]);
  const [taxPayee, setTaxPayee] = useState('Finanzamt Stralsund');
  const [taxAmount, setTaxAmount] = useState('');
  const [taxDueDate, setTaxDueDate] = useState('');
  const [netWagesAmount, setNetWagesAmount] = useState('');
  const [netWagesDueDate, setNetWagesDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedTypes, setImportedTypes] = useState([]);

  // Per-employee lines — seeded from active employees, editable
  const [employeeLines, setEmployeeLines] = useState([]);

  // Seed employee lines whenever modal opens or activeEmployees changes
  useEffect(() => {
    if (!isOpen) return;
    setEmployeeLines(
      activeEmployees.map((e) => ({
        employeeId: e.id,
        name: e.fullName,
        netto: e.nettoMonthly > 0 ? String(e.nettoMonthly) : '',
        brutto: e.bruttoMonthly > 0 ? String(e.bruttoMonthly) : '',
        gesamtkosten: e.gesamtkostenMonthly > 0 ? String(e.gesamtkostenMonthly) : '',
      })),
    );
    // Reset other fields on open
    setPeriod(new Date().toISOString().slice(0, 7));
    setKkRows([EMPTY_KK_ROW()]);
    setTaxAmount('');
    setTaxDueDate('');
    setNetWagesAmount('');
    setNetWagesDueDate('');
    setImportedTypes([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ─── Live totals preview ───────────────────────────────────────────────────
  const preview = useMemo(() => {
    const krankenkassen = kkRows
      .filter((r) => r.payee && r.amount)
      .map((r) => ({ payee: r.payee, amount: Number(r.amount) || 0 }));
    const tax = { amount: Number(taxAmount) || 0 };
    const netWages = { amount: Number(netWagesAmount) || 0 };
    const lines = employeeLines.map((l) => ({
      employeeId: l.employeeId,
      name: l.name,
      netto: Number(l.netto) || 0,
      brutto: Number(l.brutto) || 0,
      gesamtkosten: Number(l.gesamtkosten) || 0,
    }));
    return computePayrollTotals({ krankenkassen, tax, netWages, lines });
  }, [kkRows, taxAmount, netWagesAmount, employeeLines]);

  // ─── KK row helpers ────────────────────────────────────────────────────────
  const addKkRow = () => setKkRows((prev) => [...prev, EMPTY_KK_ROW()]);
  const removeKkRow = (i) => setKkRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateKkRow = (i, field, value) =>
    setKkRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  // ─── Employee line helpers ─────────────────────────────────────────────────
  const updateLine = (i, field, value) =>
    setEmployeeLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));

  // ─── DATEV PDF import ───────────────────────────────────────────────────────
  const handleImportFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name));
    if (files.length === 0) return;
    setImporting(true);
    try {
      const { texts, recognized, ignored } = await extractPayrollTexts(files);
      if (recognized.length === 0) {
        showToast('No reconocí ningún PDF DATEV (zakf / lojo / lops)', 'error');
        return;
      }
      const form = buildPayrollFromTexts(texts);
      if (form.period) setPeriod(form.period);
      if (form.krankenkassen.length) {
        setKkRows(
          form.krankenkassen.map((k) => ({
            payee: k.payee,
            amount: k.amount ? String(k.amount) : '',
            dueDate: k.dueDate || '',
          })),
        );
      }
      if (form.tax) {
        setTaxPayee(form.tax.payee || 'Finanzamt');
        if (form.tax.amount) setTaxAmount(String(form.tax.amount));
        setTaxDueDate(form.tax.dueDate || '');
      }
      if (form.netWages?.amount) setNetWagesAmount(String(form.netWages.amount));
      if (form.lines.length) {
        setEmployeeLines(
          form.lines.map((l) => ({
            employeeId: l.employeeId || '',
            name: l.name,
            netto: l.netto ? String(l.netto) : '',
            brutto: l.brutto ? String(l.brutto) : '',
            gesamtkosten: l.gesamtkosten ? String(l.gesamtkosten) : '',
          })),
        );
      }
      setImportedTypes(recognized);
      const extra = ignored.length ? ` · ignorados: ${ignored.length}` : '';
      showToast(`Importado: ${recognized.join(', ')}${extra}`, 'success');
    } catch (err) {
      showToast(err.message || 'Error al leer los PDFs', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate required fields
    const validKk = kkRows.filter((r) => r.payee && Number(r.amount) > 0);
    if (validKk.length === 0) {
      showToast('Ingresá al menos una Krankenkasse con importe', 'error');
      return;
    }
    if (!taxAmount || Number(taxAmount) <= 0) {
      showToast('Ingresá el importe de Lohnsteuer', 'error');
      return;
    }
    if (!netWagesAmount || Number(netWagesAmount) <= 0) {
      showToast('Ingresá el importe de Sueldos netos', 'error');
      return;
    }

    const formData = {
      period,
      krankenkassen: validKk.map((r) => ({
        payee: r.payee.trim(),
        amount: Number(r.amount),
        dueDate: r.dueDate || null,
      })),
      tax: {
        payee: taxPayee.trim() || 'Finanzamt',
        amount: Number(taxAmount),
        dueDate: taxDueDate || null,
      },
      netWages: {
        amount: Number(netWagesAmount),
        dueDate: netWagesDueDate || null,
      },
      lines: employeeLines.map((l) => ({
        employeeId: l.employeeId,
        name: l.name,
        netto: Number(l.netto) || 0,
        brutto: Number(l.brutto) || 0,
        gesamtkosten: Number(l.gesamtkosten) || 0,
      })),
    };

    setSubmitting(true);
    try {
      const result = await onSubmit(formData);
      if (result?.success) {
        showToast('Nómina cargada correctamente', 'success');
        onClose();
      } else {
        throw result?.error || new Error('No se pudo cargar la nómina');
      }
    } catch (err) {
      showToast(err.message || 'Error al cargar la nómina', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls =
    'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none transition-all placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]';
  const labelCls = 'label-mono text-[var(--color-fg-3)] mb-1 block';
  const sectionTitleCls =
    'font-display text-[15px] font-medium tracking-tight text-[var(--color-fg-1)] mb-3';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-6 py-5">
          <div>
            <p className="label-mono text-[var(--color-fg-4)]">§ Nóminas</p>
            <h2 className="font-display mt-1 text-[22px] font-medium tracking-tight text-[var(--color-fg-1)]">
              Cargar nómina del mes
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* DATEV PDF import */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleImportFiles(e.dataTransfer.files);
              }}
              className="rounded-md border border-dashed border-[var(--color-line-s)] bg-[var(--color-bg-0)] px-4 py-5 text-center"
            >
              <FileUp size={20} className="mx-auto mb-2 text-[var(--color-fg-3)]" />
              <p className="text-sm text-[var(--color-fg-2)]">
                Arrastrá los PDFs DATEV o{' '}
                <label className="cursor-pointer font-medium text-[var(--color-accent)] hover:underline">
                  elegilos
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImportFiles(e.target.files)}
                  />
                </label>
              </p>
              <p className="mt-1 label-mono text-[var(--color-fg-4)]">
                zakf · lojo · lops — el período, las obligaciones y el desglose se completan solos
              </p>
              {importing && (
                <p className="mt-2 label-mono text-[var(--color-fg-3)]">Leyendo PDFs…</p>
              )}
              {importedTypes.length > 0 && !importing && (
                <p className="mt-2 label-mono text-[var(--color-ok)]">
                  ✓ Importado: {importedTypes.join(' · ')}
                </p>
              )}
            </div>

            {/* Period */}
            <div>
              <label className={labelCls} htmlFor="nom-period">
                Período
              </label>
              <input
                id="nom-period"
                type="month"
                className={inputCls}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                required
              />
            </div>

            {/* Krankenkassen */}
            <div>
              <p className={sectionTitleCls}>Krankenkassen</p>
              <div className="space-y-2">
                {kkRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Nombre de la KK"
                      value={row.payee}
                      onChange={(e) => updateKkRow(i, 'payee', e.target.value)}
                      list="kk-suggestions"
                    />
                    <datalist id="kk-suggestions">
                      {kkSuggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <input
                      className={`${inputCls} w-36`}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Importe"
                      value={row.amount}
                      onChange={(e) => updateKkRow(i, 'amount', e.target.value)}
                    />
                    <input
                      className={`${inputCls} w-40`}
                      type="date"
                      value={row.dueDate}
                      onChange={(e) => updateKkRow(i, 'dueDate', e.target.value)}
                      title="Fecha de vencimiento"
                    />
                    {kkRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeKkRow(i)}
                        className="rounded-md p-2 text-[var(--color-fg-4)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-err)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addKkRow}
                className="mt-2 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]"
              >
                <Plus size={12} />
                Agregar KK
              </button>
            </div>

            {/* Lohnsteuer */}
            <div>
              <p className={sectionTitleCls}>Lohnsteuer / Finanzamt</p>
              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Acreedor (ej. Finanzamt Stralsund)"
                  value={taxPayee}
                  onChange={(e) => setTaxPayee(e.target.value)}
                />
                <input
                  className={`${inputCls} w-36`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Importe"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                />
                <input
                  className={`${inputCls} w-40`}
                  type="date"
                  value={taxDueDate}
                  onChange={(e) => setTaxDueDate(e.target.value)}
                  title="Fecha de vencimiento"
                />
              </div>
            </div>

            {/* Sueldos netos */}
            <div>
              <p className={sectionTitleCls}>Sueldos netos</p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className={labelCls} htmlFor="nom-net-wages">
                    Importe total a empleados
                  </label>
                  <input
                    id="nom-net-wages"
                    className={inputCls}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="21065.46"
                    value={netWagesAmount}
                    onChange={(e) => setNetWagesAmount(e.target.value)}
                  />
                </div>
                <div className="w-40">
                  <label className={labelCls} htmlFor="nom-wages-due">
                    Fecha de pago
                  </label>
                  <input
                    id="nom-wages-due"
                    className={inputCls}
                    type="date"
                    value={netWagesDueDate}
                    onChange={(e) => setNetWagesDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Per-employee lines */}
            {employeeLines.length > 0 && (
              <div>
                <p className={sectionTitleCls}>
                  Desglose por empleado
                  <span className="ml-2 font-mono text-[12px] font-normal text-[var(--color-fg-4)]">
                    ({employeeLines.length} activos)
                  </span>
                </p>
                <div className="overflow-x-auto rounded-md border border-[var(--color-line)]">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
                        <th className="px-3 py-2 label-mono text-[var(--color-fg-4)]">Empleado</th>
                        <th className="px-3 py-2 label-mono text-[var(--color-fg-4)] text-right">Neto</th>
                        <th className="px-3 py-2 label-mono text-[var(--color-fg-4)] text-right">Bruto</th>
                        <th className="px-3 py-2 label-mono text-[var(--color-fg-4)] text-right">Costo empresa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {employeeLines.map((line, i) => (
                        <tr key={line.employeeId} className="bg-[var(--color-bg-1)]">
                          <td className="px-3 py-2 text-sm text-[var(--color-fg-2)]">{line.name}</td>
                          <td className="px-3 py-2">
                            <input
                              className="w-28 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-2 py-1 text-right text-sm font-mono text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.netto}
                              onChange={(e) => updateLine(i, 'netto', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-28 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-2 py-1 text-right text-sm font-mono text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.brutto}
                              onChange={(e) => updateLine(i, 'brutto', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-28 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-2 py-1 text-right text-sm font-mono text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.gesamtkosten}
                              onChange={(e) => updateLine(i, 'gesamtkosten', e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Live totals preview */}
            <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-4">
              <p className="label-mono text-[var(--color-fg-3)] mb-3">Vista previa de totales</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {[
                  { label: 'Seguridad social', value: preview.socialTotal },
                  { label: 'Lohnsteuer', value: preview.taxTotal },
                  { label: 'Sueldos netos', value: preview.netWagesTotal },
                  { label: 'Salida de caja', value: preview.cashTotal },
                  { label: 'Costo empresa', value: preview.employerCostTotal },
                  { label: 'Empleados', value: `${preview.payCount} / ${preview.employeeCount}`, isMono: true },
                ].map(({ label, value, isMono }) => (
                  <div key={label}>
                    <p className="label-mono text-[var(--color-fg-4)]">{label}</p>
                    <p className={`font-mono text-[14px] tabular-nums text-[var(--color-fg-1)] ${isMono ? '' : ''}`}>
                      {isMono ? value : formatCurrency(value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-line)] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="nx-btn nx-btn-secondary"
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="nx-btn nx-btn-primary"
              disabled={submitting || loading}
            >
              {submitting ? 'Guardando…' : 'Cargar nómina'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CargarNominaModal;
