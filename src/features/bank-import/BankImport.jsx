import { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Database, Wand2, Anchor } from 'lucide-react';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useBankImport } from '../../hooks/useBankImport';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useReconciliation } from '../../hooks/useReconciliation';
import { useToast } from '../../contexts/ToastContext';
import {
 classifyBankImportFiles,
 mergeParsedFiles,
 parseBankStatementCSV,
} from '../../finance/bankStatementParser';
import { formatCurrency } from '../../utils/formatters';
import { Button, Badge, KPIGrid, KPI, Panel } from '@/components/ui/nexus';
import PageHeader from '../../components/layout/PageHeader';

/** "Mayo 2026" from an ISO date — capitalized, matching Spanish month-name style elsewhere. */
const monthLabel = (isoDate) => {
 const label = new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('es-ES', {
 month: 'long',
 year: 'numeric',
 timeZone: 'UTC',
 });
 return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Detected month-end balances across every loaded file, via the shared
 * `mergeParsedFiles` (see its doc comment for why a union — not each file's
 * own `.balances` — compares independently verified closing observations).
 * Dates are observed booking dates, never rounded to unobserved month ends.
 * Each balance is tagged with the `fileName` of the row that won it, for
 * the "Registrar anclas" source string.
 */
const mergeDetectedBalances = (files) => {
 const parsedFiles = (files || []).map((entry) => ({
 name: entry.name,
 rows: entry.parsed?.rows || [],
 period: entry.parsed?.period || null,
 }));
 const withheld = (files || []).flatMap((entry) => entry.diff?.unresolvedRows || []);
 const { rows, balances, balanceIssues = [] } = mergeParsedFiles(parsedFiles, withheld);

 return { balanceIssues, balances: balances.map((balance) => {
 const monthKey = balance.date.slice(0, 7);
 // Best-effort provenance: the row mergeParsedFiles/deriveMonthEndBalances
 // actually picked for this month is the one whose month + balance match
 // (both are already uniquely selected upstream).
 const sourceRow = rows.find(
 (row) => row.postedDate.slice(0, 7) === monthKey && row.balanceAfter === balance.balance,
 );
 return { ...balance, fileName: sourceRow?.sourceFileName || '' };
 }) };
};


const createImportRunId = () => (
 typeof crypto !== 'undefined' && crypto.randomUUID
 ? crypto.randomUUID()
 : `bank-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const readFileAsText = (file) =>
 new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = (e) => resolve(e.target.result);
 reader.onerror = reject;
 reader.readAsText(file, 'UTF-8');
 });

const BankImport = ({ user }) => {
 const { bankMovements } = useBankMovements(user);
 const { importRows } = useBankImport(user);
 const { rules } = useClassificationRules(user);
 const { anchors, addAnchors } = useReconciliation(user);
 const { showToast } = useToast();

 // Each entry: { id, file, name, parsed, diff, status, importing, result }
 const [files, setFiles] = useState([]);
 const [isDragging, setIsDragging] = useState(false);
 const [registeringAnchors, setRegisteringAnchors] = useState(false);

 const handleFiles = useCallback(
 async (fileList) => {
 if (!fileList || fileList.length === 0) return;
 const incoming = Array.from(fileList).filter(
 (f) => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv',
 );
 if (incoming.length === 0) {
 showToast('Solo archivos CSV', 'error');
 return;
 }

 const importRunId = createImportRunId();
 const newEntries = await Promise.all(
 incoming.map(async (f, idx) => {
 const text = await readFileAsText(f);
 const parsed = parseBankStatementCSV(text);
 return {
 id: `${Date.now()}-${idx}-${f.name}`,
 importRunId,
 file: f,
 name: f.name,
 parsed,
 diff: { newRows: [], duplicateRows: [] },
 status: 'ready',
 importing: false,
 result: null,
 };
 }),
 );

 setFiles((prev) => classifyBankImportFiles([...prev, ...newEntries], bankMovements, importRunId).files);
 },
 [bankMovements, showToast],
 );

 const onDrop = useCallback(
 (e) => {
 e.preventDefault();
 setIsDragging(false);
 handleFiles(e.dataTransfer.files);
 },
 [handleFiles],
 );

 const onFileSelect = (e) => {
 handleFiles(e.target.files);
 e.target.value = '';
 };

 const removeFile = (id) => {
 setFiles((prev) => {
 const remaining = prev.filter((f) => f.id !== id);
 return classifyBankImportFiles(remaining, bankMovements).files;
 });
 };

 const importOne = async (entry) => {
 if (entry.diff.newRows.length === 0) return;
 setFiles((prev) =>
 prev.map((f) => (f.id === entry.id ? { ...f, importing: true, status: 'importing' } : f)),
 );
 const result = await importRows(entry.diff.newRows, entry.name, null, rules);
 setFiles((prev) =>
 prev.map((f) =>
 f.id === entry.id
 ? { ...f, importing: false, status: 'done', result }
 : f,
 ),
 );
 if (result.success) {
 const auto = result.autoClassified || 0;
 const detail = auto > 0 ? ` (${auto} auto-clasificados)` : '';
 showToast(`${entry.name}: ${result.imported} importados${detail}`, 'success');
 } else {
 showToast(`${entry.name}: ${result.errors.length} errores`, 'error');
 }
 };

 const importAll = async () => {
 for (const f of files) {
 if (f.status === 'done') continue;
 if (f.diff.newRows.length === 0) continue;
 await importOne(f);
 }
 };

 const totals = useMemo(() => {
 let totalRows = 0;
 let totalNew = 0;
 let totalDup = 0;
 let totalErrors = 0;
 let totalImported = 0;
 let totalUnresolved = 0;
 files.forEach((f) => {
 totalRows += f.parsed.rows.length;
 totalNew += f.diff.newRows.length;
 totalDup += f.diff.duplicateRows.length;
 totalUnresolved += f.diff.unresolvedRows?.length || 0;
 totalErrors += f.parsed.errors.length;
 if (f.result) totalImported += f.result.imported;
 });
 return { totalRows, totalNew, totalDup, totalErrors, totalImported, totalUnresolved };
 }, [files]);

 const filesPending = files.some((f) => f.status === 'ready' && f.diff.newRows.length > 0);

 const { balances: detectedBalances, balanceIssues } = useMemo(() => mergeDetectedBalances(files), [files]);
 const anchorByDate = useMemo(() => {
 const map = new Map();
 for (const anchor of anchors || []) map.set(anchor.date, anchor);
 return map;
 }, [anchors]);

 // 'ok' | 'missing' | 'discrepant' — an anchor on a date that isn't one of
 // OUR detected month-end dates (e.g. 2026-07-27) never appears here at
 // all, since we only ever look anchors up by a detected balance's own date.
 const balanceStatus = (entry) => {
 const anchor = anchorByDate.get(entry.date);
 if (!anchor) return 'missing';
 return Math.abs(Number(anchor.balance) - entry.balance) > 0.01 ? 'discrepant' : 'ok';
 };

 const pendingBalances = useMemo(
 () => detectedBalances.filter((b) => balanceStatus(b) !== 'ok'),
 // eslint-disable-next-line react-hooks/exhaustive-deps
 [detectedBalances, anchorByDate],
 );

 const handleRegisterAnchors = async () => {
 if (pendingBalances.length === 0) return;
 setRegisteringAnchors(true);
 let created = 0;
 let corrected = 0;
 let failed = 0;
 try {
 const result = await addAnchors(pendingBalances.map((balance) => {
 const existing = anchorByDate.get(balance.date);
 return {
 date: balance.date,
 balance: balance.balance,
 source: `Extracto Volksbank (import ${balance.fileName})`,
 note: existing
 ? `Corrige ${formatCurrency(balance.balance)} € (antes ${formatCurrency(existing.balance)} €)`
 : '',
 };
 }));
 if (result.success) {
 corrected = pendingBalances.filter((balance) => anchorByDate.has(balance.date)).length;
 created = pendingBalances.length - corrected;
 } else {
 failed = pendingBalances.length;
 }
 } catch {
 failed = pendingBalances.length;
 } finally {
 setRegisteringAnchors(false);
 }
 const parts = [];
 if (created > 0) parts.push(`${created} registrada(s)`);
 if (corrected > 0) parts.push(`${corrected} corregida(s)`);
 if (failed > 0) parts.push(`${failed} con error`);
 showToast(parts.join(', ') || 'Sin cambios', failed === 0 ? 'success' : 'error');
 };

 return (
 <div className="space-y-6 pb-12">
 <PageHeader
 section="Configuración"
 title="Importar"
 accent="Banco"
 subtitle="Extracto de cuenta (kontobewegungen_export)"
 actions={
 filesPending ? (
 <Button variant="primary" icon={Upload} onClick={importAll}>
 Importar todos los pendientes
 </Button>
 ) : null
 }
 >
 <p className="mt-2 max-w-2xl text-sm text-[var(--color-fg-3)]">
 Sube uno o varios CSVs de movimientos de cuenta. El sistema detecta duplicados
 contra los movimientos ya cargados (misma fecha + monto + dirección + contraparte) y
 solo crea los nuevos.
 </p>
 {(rules || []).filter((r) => r.active).length > 0 && (
 <p className="mt-2 inline-flex items-center gap-2 text-[12px] text-[var(--color-fg-3)]">
 <Wand2 size={12} className="text-[var(--color-accent)]" />
 {(rules || []).filter((r) => r.active).length} regla(s) activas — los movimientos coincidentes se clasificarán automáticamente al importar.
 </p>
 )}
 </PageHeader>

 {balanceIssues.length > 0 && <div role="alert" className="text-sm text-[var(--color-warn)]">
 Saldos no verificables: secuencia incompleta, ambigua o inconsistente. No se registrarán sus anclas; la desviación es desconocida.
 </div>}
 {totals.totalUnresolved > 0 && (
 <div role="alert" className="rounded-md border border-[var(--color-warn)] p-4 text-sm text-[var(--color-warn)]">
 {totals.totalUnresolved} movimientos retenidos para revisión: {files.some((file) => file.diff.unresolvedRows?.some((row) => row.matchingIssue?.reason === 'unproven-booking-multiplicity'))
 ? 'hay repeticiones sin prueba de pagos distintos.' : 'el cruce excede el límite seguro.'}
 {' '}No se importarán ni se contarán como duplicados. Las anclas quedan retenidas.
 {' '}Solo puedes importar los movimientos independientes confirmados; reintentar sin nuevos datos no resuelve el grupo.
 </div>
 )}
 <KPIGrid cols={4}>
 <KPI label="Archivos" value={files.length} meta="En esta sesión" icon={FileText} />
 <KPI
 label="Nuevos"
 value={totals.totalNew}
 meta="A crear (no en sistema)"
 tone={totals.totalNew > 0 ? 'warn' : 'default'}
 />
 <KPI
 label="Duplicados"
 value={totals.totalDup}
 meta="Ya existen — se omiten"
 tone="ok"
 />
 <KPI
 label="Importados"
 value={totals.totalImported}
 meta={totals.totalUnresolved ? `${totals.totalUnresolved} retenidos para revisión` : totals.totalErrors ? `${totals.totalErrors} errores parseo` : 'OK'}
 tone={totals.totalImported > 0 ? 'ok' : 'default'}
 icon={Database}
 />
 </KPIGrid>

 <div
 className={`rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors ${
 isDragging
 ? 'border-[var(--color-accent)] bg-[rgba(255,77,46,0.05)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)]'
 }`}
 onDragOver={(e) => {
 e.preventDefault();
 setIsDragging(true);
 }}
 onDragLeave={() => setIsDragging(false)}
 onDrop={onDrop}
 >
 <Upload size={32} className="mx-auto text-[var(--color-fg-4)]" />
 <p className="mt-3 text-sm text-[var(--color-fg-1)]">
 Arrastrá archivos CSV aquí o
 <label className="ml-1 text-[var(--color-accent)] cursor-pointer underline">
 examiná
 <input type="file" multiple accept=".csv" className="hidden" onChange={onFileSelect} />
 </label>
 </p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
 Export "Umsätze" o "Kontobewegungen" de la banca online · UTF-8 · separador ;
 </p>
 </div>

 {files.length > 0 && (
 <Panel title="Archivos cargados" meta={`${files.length} archivo(s)`} padding={false}>
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Archivo</th>
 <th>Período</th>
 <th className="text-right">Total filas</th>
 <th className="text-right">Nuevos</th>
 <th className="text-right">Duplicados</th>
 <th className="text-right">Retenidos</th>
 <th className="text-right">Errores parseo</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {files.map((f) => (
 <tr key={f.id}>
 <td className="font-medium text-[var(--color-fg-1)]">{f.name}</td>
 <td className="font-mono text-[var(--color-fg-3)]">
 {f.parsed.period
 ? `${f.parsed.period.minDate} → ${f.parsed.period.maxDate}`
 : '—'}
 </td>
 <td className="text-right font-mono tabular-nums">{f.parsed.rows.length}</td>
 <td className="text-right font-mono tabular-nums text-[var(--color-warn)]">
 {f.diff.newRows.length}
 </td>
 <td className="text-right font-mono tabular-nums text-[var(--color-fg-4)]">
 {f.diff.duplicateRows.length}
 </td>
 <td className="text-right font-mono tabular-nums text-[var(--color-warn)]">{f.diff.unresolvedRows?.length || 0}</td>
 <td className="text-right font-mono tabular-nums">
 {f.parsed.errors.length > 0 ? (
 <span className="text-[var(--color-err)]">{f.parsed.errors.length}</span>
 ) : (
 '—'
 )}
 </td>
 <td className="text-center">
 {(f.diff.unresolvedRows?.length || 0) > 0 && <Badge variant="warn">Revisión pendiente</Badge>}
 {f.status === 'ready' && f.diff.newRows.length === 0 && !f.diff.unresolvedRows?.length && (
 <Badge variant="neutral">Nada nuevo</Badge>
 )}
 {f.status === 'ready' && f.diff.newRows.length > 0 && (
 <Badge variant="warn" dot>
 Pendiente
 </Badge>
 )}
 {f.status === 'importing' && <Badge variant="info" dot>Importando…</Badge>}
 {f.status === 'done' && (
 <Badge
 variant={f.result?.errors?.length > 0 ? 'err' : 'ok'}
 dot
 >
 {f.result?.errors?.length > 0
 ? `${f.result.imported}/${f.diff.newRows.length} OK`
 : f.diff.unresolvedRows?.length ? 'Importación parcial' : 'Importado'}
 </Badge>
 )}
 </td>
 <td className="text-right">
 <div className="flex items-center justify-end gap-2">
 {f.status === 'ready' && f.diff.newRows.length > 0 && (
 <Button
 variant="primary"
 size="sm"
 icon={Upload}
 onClick={() => importOne(f)}
 >
 Importar {f.diff.newRows.length}
 </Button>
 )}
 {f.status !== 'importing' && (
 <Button variant="ghost" size="sm" icon={X} onClick={() => removeFile(f.id)}>
 Quitar
 </Button>
 )}
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </Panel>
 )}

 {detectedBalances.length > 0 && (
 <Panel
 title="Saldos de cierre detectados"
 meta={`${detectedBalances.length} mes(es)`}
 padding={false}
 actions={
 pendingBalances.length > 0 ? (
 <Button
 variant="secondary"
 size="sm"
 icon={Anchor}
 onClick={handleRegisterAnchors}
 loading={registeringAnchors}
 >
 Registrar / corregir anclas ({pendingBalances.length})
 </Button>
 ) : null
 }
 >
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Mes</th>
 <th className="text-right">Saldo detectado</th>
 <th className="text-center">Ancla</th>
 </tr>
 </thead>
 <tbody>
 {detectedBalances.map((b) => {
 const status = balanceStatus(b);
 const existing = anchorByDate.get(b.date);
 return (
 <tr key={b.date}>
 <td className="font-medium text-[var(--color-fg-1)]">{monthLabel(b.date)}</td>
 <td className="text-right font-mono tabular-nums">{formatCurrency(b.balance)}</td>
 <td className="text-center">
 {status === 'ok' && <Badge variant="ok" dot>Ya registrada</Badge>}
 {status === 'missing' && <Badge variant="warn" dot>Pendiente</Badge>}
 {status === 'discrepant' && (
 <div className="flex flex-col items-center gap-0.5">
 <Badge variant="err" dot>Discrepante</Badge>
 <span className="font-mono text-[10px] text-[var(--color-fg-4)]">
 {formatCurrency(existing?.balance)} → {formatCurrency(b.balance)}
 </span>
 </div>
 )}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </Panel>
 )}

 {files.some((f) => f.parsed.errors.length > 0) && (
 <div className="rounded-md border border-[var(--color-warn)]/40 bg-[rgba(255,176,32,0.05)] px-4 py-3 flex items-start gap-3">
 <AlertCircle size={16} className="text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
 <div>
 <p className="text-sm text-[var(--color-fg-1)]">
 Algunos archivos o filas no pudieron importarse (formato no soportado, fecha o monto inválidos).
 </p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
 Los archivos DATEV classic/headers desconocidos se rechazan completos para evitar importaciones parciales.
 </p>
 </div>
 </div>
 )}

 {files.every((f) => f.status === 'done') && files.length > 0 && totals.totalImported > 0 && (
 <div className="rounded-md border border-[var(--color-ok)]/40 bg-[rgba(74,222,128,0.05)] px-4 py-3 flex items-start gap-3">
 <CheckCircle2 size={16} className="text-[var(--color-ok)] flex-shrink-0 mt-0.5" />
 <div>
 <p className="text-sm text-[var(--color-fg-1)]">
 Importación completa: {totals.totalImported} movimientos creados, {totals.totalDup} duplicados omitidos.
 </p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
 Los movimientos quedan sin categoría ni proyecto. Asignalos desde la vista correspondiente o creá reglas en Costos recurrentes.
 </p>
 </div>
 </div>
 )}
 </div>
 );
};

export default BankImport;
