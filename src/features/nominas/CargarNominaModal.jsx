import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, FileUp, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import {
  computePayrollTotals,
  computeLineVariances,
  reconcileNetWages,
} from './lib/payroll';
import { validatePayrollRoster } from './lib/payrollCalendarValidation';
import { buildPayrollFromTexts } from './lib/datevPayrollParser';
import { extractPayrollTexts } from './lib/extractPdfText';
import { formatCurrency } from '../../utils/formatters';

const EMPTY_KK_ROW = () => ({ payee: '', amount: '', dueDate: '' });

// Item 7 — Sonderzahlungen tags so spike months stay readable downstream.
const SONDERZAHLUNG_OPTIONS = [
  { value: '', label: '—' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'Urlaubsgeld', label: 'Urlaubsgeld' },
  { value: 'Weihnachtsgeld', label: 'Weihnachtsgeld' },
  { value: 'einmalig', label: 'Einmalig' },
];

/**
 * CargarNominaModal — form to load a new payroll period.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   onSubmit: (formData) => Promise<{success, error?}>
 *   activeEmployees: Array (from useEmployees.getActiveEmployees())
 *   editingPeriod: object|null (seed the form to edit an existing period)
 *   loading: boolean
 */
const CargarNominaModal = ({
  isOpen,
  onClose,
  onSubmit,
  activeEmployees = [],
  allEmployees = null,
  editingPeriod = null,
  loading = false,
}) => {
  const { showToast } = useToast();

  // Map active employees by id for reference-value variance checks.
  const employeesById = useMemo(() => {
    const map = {};
    activeEmployees.forEach((e) => { map[e.id] = e; });
    return map;
  }, [activeEmployees]);

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
  // Item 6 — operator override to load a partial-month roster despite warnings.
  const [allowPartialOverride, setAllowPartialOverride] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedTypes, setImportedTypes] = useState([]);
  // Document fingerprint descriptors collected from the DATEV import.
  const [documents, setDocuments] = useState([]);

  // Per-employee lines — seeded from active employees, editable
  const [employeeLines, setEmployeeLines] = useState([]);

  // Seed the form whenever the modal opens. In edit mode, hydrate from the
  // existing period; otherwise seed lines from active employees.
  useEffect(() => {
    if (!isOpen) return;

    if (editingPeriod) {
      setPeriod(editingPeriod.period || new Date().toISOString().slice(0, 7));
      setKkRows(
        (editingPeriod.obligations || [])
          .filter((o) => o.kind === 'krankenkasse')
          .map((o) => ({
            payee: o.payee || '',
            amount: o.amount ? String(o.amount) : '',
            dueDate: o.dueDate || '',
          })),
      );
      const taxOb = (editingPeriod.obligations || []).find((o) => o.kind === 'tax');
      setTaxPayee(taxOb?.payee || 'Finanzamt Stralsund');
      setTaxAmount(taxOb?.amount ? String(taxOb.amount) : '');
      setTaxDueDate(taxOb?.dueDate || '');
      const wagesOb = (editingPeriod.obligations || []).find((o) => o.kind === 'wages');
      setNetWagesAmount(editingPeriod.netWagesTotal ? String(editingPeriod.netWagesTotal) : '');
      setNetWagesDueDate(wagesOb?.dueDate || '');
      setEmployeeLines(
        (editingPeriod.lines || []).map((l) => ({
          employeeId: l.employeeId || '',
          persNr: l.persNr || '',
          name: l.name || '',
          netto: l.netto ? String(l.netto) : '',
          brutto: l.brutto ? String(l.brutto) : '',
          gesamtkosten: l.gesamtkosten ? String(l.gesamtkosten) : '',
          sonderzahlung: l.sonderzahlung || '',
        })),
      );
      setDocuments(Array.isArray(editingPeriod.documents) ? editingPeriod.documents : []);
      setImportedTypes([]);
      return;
    }

    setEmployeeLines(
      activeEmployees.map((e) => ({
        employeeId: e.id,
        persNr: e.persNr || '',
        name: e.fullName,
        netto: e.nettoMonthly > 0 ? String(e.nettoMonthly) : '',
        brutto: e.bruttoMonthly > 0 ? String(e.bruttoMonthly) : '',
        gesamtkosten: e.gesamtkostenMonthly > 0 ? String(e.gesamtkostenMonthly) : '',
        sonderzahlung: '',
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
    setDocuments([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingPeriod]);

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

  // ─── Variance + net-wages reconciliation ───────────────────────────────────
  const numericLines = useMemo(
    () =>
      employeeLines.map((l) => ({
        employeeId: l.employeeId,
        persNr: l.persNr || '',
        name: l.name,
        netto: Number(l.netto) || 0,
        brutto: Number(l.brutto) || 0,
        gesamtkosten: Number(l.gesamtkosten) || 0,
      })),
    [employeeLines],
  );

  const variances = useMemo(
    () => computeLineVariances({ lines: numericLines, employeesById }),
    [numericLines, employeesById],
  );

  // Map employeeId → flagged-fields for inline display.
  const flaggedByLine = useMemo(() => {
    const map = {};
    variances.forEach((v, i) => {
      const flags = Object.entries(v.deltas)
        .filter(([, d]) => d.flagged)
        .map(([field]) => field);
      if (flags.length) map[i] = flags;
    });
    return map;
  }, [variances]);

  const reconciliation = useMemo(
    () => reconcileNetWages({ lines: numericLines, netWages: Number(netWagesAmount) || 0 }),
    [numericLines, netWagesAmount],
  );

  // ─── Item 6 — joiner/leaver mid-month roster validation ────────────────────
  // Validates against the full roster (incl. leavers) so ghost lines surface.
  const rosterEmployees = useMemo(
    () => (Array.isArray(allEmployees) ? allEmployees : activeEmployees),
    [allEmployees, activeEmployees],
  );
  const roster = useMemo(
    () =>
      validatePayrollRoster({
        period,
        lines: numericLines,
        employees: rosterEmployees,
        allowPartialOverride,
      }),
    [period, numericLines, rosterEmployees, allowPartialOverride],
  );
  // Only block when there are lines AND an aggregate entered (avoid false alarm
  // on an empty/just-opened form).
  const reconciliationBlocks =
    numericLines.length > 0 && Number(netWagesAmount) > 0 && !reconciliation.ok;

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
      const { texts, documents: descriptors, recognized, ignored, failed } =
        await extractPayrollTexts(files);
      if (recognized.length === 0) {
        if (failed.length > 0) {
          showToast(`No pude leer los PDF: ${failed[0].error}`, 'error');
        } else {
          showToast('No reconocí ningún PDF DATEV. ¿Los archivos empiezan con zakf / lojo / lops?', 'error');
        }
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
      if (form.netWages?.dueDate) setNetWagesDueDate(form.netWages.dueDate);
      if (form.lines.length) {
        setEmployeeLines(
          form.lines.map((l) => ({
            employeeId: l.employeeId || '',
            persNr: l.persNr || '',
            name: l.name,
            netto: l.netto ? String(l.netto) : '',
            brutto: l.brutto ? String(l.brutto) : '',
            gesamtkosten: l.gesamtkosten ? String(l.gesamtkosten) : '',
            sonderzahlung: l.sonderzahlung || '',
          })),
        );
      }
      setDocuments(Array.isArray(descriptors) ? descriptors : []);
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

    // Blocking warning: per-employee net pay must reconcile with the aggregate.
    if (reconciliationBlocks) {
      showToast(
        `La suma de netos (${formatCurrency(reconciliation.sumLines)}) no coincide con ` +
          `Sueldos netos (${formatCurrency(reconciliation.aggregate)}). ` +
          `Diferencia: ${formatCurrency(reconciliation.diff)}.`,
        'error',
      );
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
        persNr: l.persNr || '',
        name: l.name,
        netto: Number(l.netto) || 0,
        brutto: Number(l.brutto) || 0,
        gesamtkosten: Number(l.gesamtkosten) || 0,
        sonderzahlung: l.sonderzahlung || '',
      })),
      documents,
    };

    setSubmitting(true);
    try {
      const result = await onSubmit(formData);
      if (result?.success) {
        showToast(editingPeriod ? 'Nómina actualizada correctamente' : 'Nómina cargada correctamente', 'success');
        onClose();
      } else if (result?.code === 'duplicate') {
        // The parent handles the replace confirmation flow; close silently.
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-6 py-5">
          <div>
            <p className="label-mono text-[var(--color-fg-4)]">§ Nóminas</p>
            <h2 className="font-display mt-1 text-[22px] font-medium tracking-tight text-[var(--color-fg-1)]">
              {editingPeriod ? 'Editar nómina del mes' : 'Cargar nómina del mes'}
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

            {/* Origen — document fingerprint chips */}
            {documents.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-mono text-[var(--color-fg-4)]">Origen:</span>
                {documents.map((d, i) => (
                  <span
                    key={`${d.kind}-${d.fileName}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2.5 py-1 text-[12px] text-[var(--color-fg-2)]"
                    title={d.hash ? `SHA-256: ${d.hash}` : undefined}
                  >
                    <FileText size={12} className="text-[var(--color-fg-4)]" />
                    {d.fileName}
                  </span>
                ))}
              </div>
            )}

            {/* Period */}
            <div>
              <label className={labelCls} htmlFor="nom-period">
                Período
              </label>
              <input
                id="nom-period"
                type="month"
                className={`${inputCls} ${editingPeriod ? 'cursor-not-allowed opacity-60' : ''}`}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={!!editingPeriod}
                required
              />
              {editingPeriod && (
                <p className="mt-1 label-mono text-[var(--color-fg-4)]">
                  El mes del período no se puede cambiar al editar
                </p>
              )}
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
                        <th className="px-3 py-2 label-mono text-[var(--color-fg-4)]">Tipo pago</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {employeeLines.map((line, i) => (
                        <tr key={line.employeeId || line.persNr || `line-${i}`} className="bg-[var(--color-bg-1)]">
                          <td className="px-3 py-2 text-sm text-[var(--color-fg-2)]">
                            <span className="flex items-center gap-1.5">
                              {line.name}
                              {flaggedByLine[i] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-md border border-[var(--color-warn)] px-1.5 py-0.5 text-[10px] text-[var(--color-warn)]"
                                  title={`Desvío >5% vs referencia: ${flaggedByLine[i].join(', ')}`}
                                >
                                  <AlertTriangle size={10} />
                                  {flaggedByLine[i].join('/')}
                                </span>
                              )}
                            </span>
                          </td>
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
                          <td className="px-3 py-2">
                            <select
                              className="w-36 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-2 py-1 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                              value={line.sonderzahlung || ''}
                              onChange={(e) => updateLine(i, 'sonderzahlung', e.target.value)}
                              title="Tipo de pago (Sonderzahlung)"
                            >
                              {SONDERZAHLUNG_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Item 6 — joiner/leaver roster validation */}
            {(roster.ghosts.length > 0 || roster.missingActives.length > 0 || allowPartialOverride) && (
              <div
                className={`rounded-md border px-4 py-3 text-[13px] ${
                  roster.ok
                    ? 'border-[var(--color-line)] text-[var(--color-fg-3)]'
                    : 'border-[var(--color-warn)] text-[var(--color-warn)]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={16}
                    className={`mt-0.5 flex-shrink-0 ${roster.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}
                  />
                  <div className="space-y-1">
                    {roster.ghosts.length > 0 && (
                      <p>
                        Líneas fantasma ({roster.ghosts.length}):{' '}
                        {roster.ghosts.map((g) => g.name || g.persNr).join(', ')} — el empleado ya no
                        estaba activo en el período.
                      </p>
                    )}
                    {roster.missingActives.length > 0 && (
                      <p>
                        Activos sin línea ({roster.missingActives.length}):{' '}
                        {roster.missingActives.map((m) => m.name || m.persNr).join(', ')}.
                      </p>
                    )}
                    {roster.ok && allowPartialOverride && (
                      <p>Validación de mes parcial omitida por override.</p>
                    )}
                    <label className="mt-1 flex items-center gap-2 text-[12px] text-[var(--color-fg-3)]">
                      <input
                        type="checkbox"
                        checked={allowPartialOverride}
                        onChange={(e) => setAllowPartialOverride(e.target.checked)}
                      />
                      Cargar igual (mes parcial — joiner/leaver)
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Net-wages reconciliation banner */}
            {numericLines.length > 0 && Number(netWagesAmount) > 0 && (
              <div
                className={`flex items-start gap-2 rounded-md border px-4 py-3 text-[13px] ${
                  reconciliation.ok
                    ? 'border-[var(--color-line)] text-[var(--color-fg-3)]'
                    : 'border-[var(--color-warn)] text-[var(--color-warn)]'
                }`}
              >
                <AlertTriangle
                  size={16}
                  className={`mt-0.5 flex-shrink-0 ${reconciliation.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}
                />
                <div>
                  {reconciliation.ok ? (
                    <span>
                      Conciliación OK — la suma de netos coincide con Sueldos netos
                      ({formatCurrency(reconciliation.aggregate)}).
                    </span>
                  ) : (
                    <span>
                      La suma de netos por empleado ({formatCurrency(reconciliation.sumLines)}) no
                      coincide con Sueldos netos ({formatCurrency(reconciliation.aggregate)}).
                      Diferencia: {formatCurrency(reconciliation.diff)}. No se puede cargar hasta
                      conciliar.
                    </span>
                  )}
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
              disabled={submitting || loading || reconciliationBlocks}
              title={reconciliationBlocks ? 'La suma de netos no concilia con Sueldos netos' : undefined}
            >
              {submitting
                ? 'Guardando…'
                : editingPeriod
                  ? 'Guardar cambios'
                  : 'Cargar nómina'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CargarNominaModal;
