import { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Database, Wand2 } from 'lucide-react';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useDatevImport } from '../../hooks/useDatevImport';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useToast } from '../../contexts/ToastContext';
import { classifyDatevImportFiles, parseDatevCSV } from '../../finance/datevParser';
import { Button, Badge, KPIGrid, KPI, Panel } from '@/components/ui/nexus';


const createImportRunId = () => (
 typeof crypto !== 'undefined' && crypto.randomUUID
 ? crypto.randomUUID()
 : `datev-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const readFileAsText = (file) =>
 new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = (e) => resolve(e.target.result);
 reader.onerror = reject;
 reader.readAsText(file, 'UTF-8');
 });

const DatevImport = ({ user }) => {
 const { bankMovements } = useBankMovements(user);
 const { importRows } = useDatevImport(user);
 const { rules } = useClassificationRules(user);
 const { showToast } = useToast();

 // Each entry: { id, file, name, parsed, diff, status, importing, result }
 const [files, setFiles] = useState([]);
 const [isDragging, setIsDragging] = useState(false);

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
 const parsed = parseDatevCSV(text);
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

 setFiles((prev) => classifyDatevImportFiles([...prev, ...newEntries], bankMovements, importRunId).files);
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
 return classifyDatevImportFiles(remaining, bankMovements).files;
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
 files.forEach((f) => {
 totalRows += f.parsed.rows.length;
 totalNew += f.diff.newRows.length;
 totalDup += f.diff.duplicateRows.length;
 totalErrors += f.parsed.errors.length;
 if (f.result) totalImported += f.result.imported;
 });
 return { totalRows, totalNew, totalDup, totalErrors, totalImported };
 }, [files]);

 const filesPending = files.some((f) => f.status === 'ready' && f.diff.newRows.length > 0);

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">DATEV · Importación</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Importar movimientos bancarios
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Sube uno o varios CSVs (Sparkasse Kontobewegungen). El sistema detecta duplicados
 contra los movimientos ya cargados (mismo fecha + monto + dirección + contraparte) y
 solo crea los nuevos.
 </p>
 {(rules || []).filter((r) => r.active).length > 0 && (
 <p className="mt-2 inline-flex items-center gap-2 text-[12px] text-[var(--color-fg-3)]">
 <Wand2 size={12} className="text-[var(--color-accent)]" />
 {(rules || []).filter((r) => r.active).length} regla(s) activas — los movimientos coincidentes se clasificarán automáticamente al importar.
 </p>
 )}
 </div>
 {filesPending && (
 <Button variant="primary" icon={Upload} onClick={importAll}>
 Importar todos los pendientes
 </Button>
 )}
 </header>

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
 meta={totals.totalErrors ? `${totals.totalErrors} errores parseo` : 'OK'}
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
 Sparkasse "Kontobewegungen Export" · UTF-8 · separador ;
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
 <td className="text-right font-mono tabular-nums">
 {f.parsed.errors.length > 0 ? (
 <span className="text-[var(--color-err)]">{f.parsed.errors.length}</span>
 ) : (
 '—'
 )}
 </td>
 <td className="text-center">
 {f.status === 'ready' && f.diff.newRows.length === 0 && (
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
 : 'Importado'}
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

export default DatevImport;
