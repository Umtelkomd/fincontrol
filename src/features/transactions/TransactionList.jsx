import React, { useMemo, useState } from 'react';
import {
 AlertTriangle,
 CheckCircle,
 Eye,
 Filter,
 Landmark,
 MessageSquare,
 ReceiptText,
 RotateCcw,
 Sparkles,
 WalletCards,
 X,
} from 'lucide-react';
import TransactionFilters, { FILTER_DEFAULTS } from './TransactionFilters';
import TransactionTable from './TransactionTable';
import DuplicateReviewPanel from './DuplicateReviewPanel';
import TransactionFormModal from '../../components/ui/TransactionFormModal';
import NotesModal from '../../components/ui/NotesModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import CanonicalRecordModal from '../../components/finance/CanonicalRecordModal';
import RecordAuditTrailModal from '../../components/finance/RecordAuditTrailModal';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useAuditLog } from '../../hooks/useAuditLog';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { useProjects } from '../../hooks/useProjects';
import { exportTransactionsToPDF } from '../../utils/pdfExport';
import { formatCurrency } from '../../utils/formatters';
import { KPIGrid, KPI, Button, Badge } from '@/components/ui/nexus';

const safeString = (value) => {
 if (value == null) return '';
 if (typeof value === 'object') return JSON.stringify(value);
 return String(value);
};

const formatCount = (value) => new Intl.NumberFormat('es-ES').format(value || 0);

const _getCreatedDate = (record) => {
 const raw = record.createdAt?.toDate ? record.createdAt.toDate() : record.createdAt;
 const date = raw ? new Date(raw) : null;
 return date && !Number.isNaN(date.getTime()) ? date : null;
};

const normalizeDocumentStatus = (status) => {
 const normalized = safeString(status).toLowerCase();
 if (normalized === 'issued') return 'pending';
 if (normalized === 'settled') return 'paid';
 return normalized || 'pending';
};

const buildLegacyRows = (transactions) => {
 return transactions
 .filter((entry) => !entry.canonicalMovementId && !entry.canonicalReceivableId && !entry.canonicalPayableId)
 .map((entry) => ({
 ...entry,
 id: `legacy:${entry.id}`,
 entityId: entry.id,
 rawRecord: entry,
 recordFamily: 'legacy',
 recordFamilyLabel: 'Histórico',
 sourceKey: 'legacy',
 sourceLabel: 'Histórico',
 date: entry.date,
 type: entry.type === 'expense' ? 'expense' : 'income',
 status: normalizeDocumentStatus(entry.status === 'completed' ? 'paid' : entry.status),
 statusLabel: entry.status === 'completed' ? 'Completado' : null,
 amount: Number(entry.amount) || 0,
 paidAmount: Number(entry.paidAmount) || 0,
 project: entry.project || 'Sin proyecto',
 projectId: entry.projectId || '',
 category: entry.category || 'Transaccion',
 categoryLabel: entry.category || 'Registro histórico',
 costCenter: entry.costCenter || '',
 costCenterId: entry.costCenter || '',
 documentNumber: entry.invoiceNumber || '',
 counterpartyName: entry.counterparty || '',
 canEdit: true,
 canDelete: true,
 canViewNotes: true,
 canRegisterPayment: ['pending', 'partial'].includes(normalizeDocumentStatus(entry.status)),
 paymentActionLabel: 'Abono',
 secondaryMeta: entry.invoiceNumber || entry.counterparty || 'Registro histórico editable',
 traceMeta: entry.lastModifiedBy || entry.createdBy || '',
 lastEditor: entry.lastModifiedBy || entry.createdBy || '',
 lastEditedAt: entry.lastModifiedAt || entry.createdAt || null,
 year: entry.date ? new Date(entry.date).getFullYear() : null,
 canChangeStatus: !['void', 'cancelled'].includes(normalizeDocumentStatus(entry.status)),
 }));
};

const buildMovementRows = (movements) => {
 return movements.map((entry) => ({
 ...entry,
 id: `movement:${entry.id}`,
 entityId: entry.id,
 rawRecord: entry,
 recordFamily: 'movement',
 recordFamilyLabel: 'Banco',
 sourceKey: entry.legacyTransactionId ? 'migrated' : 'canonical',
 sourceLabel: entry.legacyTransactionId ? 'Integrado' : 'Operación actual',
 date: entry.postedDate || entry.valueDate,
 type: entry.direction === 'out' ? 'expense' : 'income',
 status: entry.status === 'void' ? 'void' : 'paid',
 statusLabel: entry.status === 'void' ? 'Anulado' : 'Registrado',
 amount: Number(entry.amount) || 0,
 paidAmount: Number(entry.amount) || 0,
 project: entry.projectName || 'Sin proyecto',
 projectId: entry.projectId || '',
 category: entry.kind || 'bank-movement',
 categoryLabel:
 entry.kind === 'adjustment'
 ? 'Ajuste bancario'
 : entry.direction === 'out'
 ? 'Pago bancario'
 : 'Cobro bancario',
 costCenter: entry.costCenterId || '',
 costCenterId: entry.costCenterId || '',
 documentNumber: entry.documentNumber || '',
 counterpartyName: entry.counterpartyName || '',
 canEdit: entry.status !== 'void',
 canDelete: false,
 canViewNotes: false,
 canRegisterPayment: false,
 canVoid: entry.status !== 'void',
 canChangeStatus: true,
 voidActionLabel: 'Anular',
 notes: [],
 secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Movimiento confirmado',
 traceMeta: entry.updatedBy || entry.createdBy || '',
 lastEditor: entry.updatedBy || entry.createdBy || '',
 lastEditedAt: entry.updatedAt || entry.createdAt || null,
 year: (entry.postedDate || entry.valueDate) ? new Date(entry.postedDate || entry.valueDate).getFullYear() : null,
 }));
};

const buildReceivableRows = (receivables) => {
 return receivables.map((entry) => ({
 ...entry,
 id: `receivable:${entry.id}`,
 entityId: entry.id,
 rawRecord: entry,
 recordFamily: 'receivable',
 recordFamilyLabel: 'CXC',
 sourceKey: entry.legacyTransactionId ? 'migrated' : 'canonical',
 sourceLabel: entry.legacyTransactionId ? 'Integrado' : 'Operación actual',
 date: entry.issueDate || entry.dueDate,
 type: 'income',
 status: normalizeDocumentStatus(entry.status),
 statusLabel:
 entry.status === 'issued'
 ? 'Emitida'
 : entry.status === 'settled'
 ? 'Liquidada'
 : entry.status === 'overdue'
 ? 'Vencida'
 : null,
 amount: Number(entry.grossAmount ?? entry.amount) || 0,
 paidAmount: Number(entry.paidAmount) || 0,
 project: entry.projectName || 'Sin proyecto',
 projectId: entry.projectId || '',
 category: 'receivable',
 categoryLabel: 'Factura CXC',
 costCenter: entry.costCenterId || '',
 costCenterId: entry.costCenterId || '',
 documentNumber: entry.documentNumber || '',
 counterpartyName: entry.counterpartyName || '',
 canEdit: entry.status !== 'cancelled',
 canDelete: false,
 canViewNotes: false,
 canRegisterPayment: ['pending', 'partial', 'overdue'].includes(normalizeDocumentStatus(entry.status)),
 canVoid: !entry.paidAmount && entry.status !== 'cancelled' && entry.status !== 'settled',
 canChangeStatus: entry.status !== 'cancelled',
 voidActionLabel: 'Cancelar',
 paymentActionLabel: 'Cobro',
 notes: [],
 secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Pendiente de cobro',
 traceMeta: entry.updatedBy || entry.createdBy || '',
 lastEditor: entry.updatedBy || entry.createdBy || '',
 lastEditedAt: entry.updatedAt || entry.createdAt || null,
 year: (entry.issueDate || entry.dueDate) ? new Date(entry.issueDate || entry.dueDate).getFullYear() : null,
 }));
};

const buildPayableRows = (payables) => {
 return payables.map((entry) => ({
 ...entry,
 id: `payable:${entry.id}`,
 entityId: entry.id,
 rawRecord: entry,
 recordFamily: 'payable',
 recordFamilyLabel: 'CXP',
 sourceKey: entry.legacyTransactionId ? 'migrated' : 'canonical',
 sourceLabel: entry.legacyTransactionId ? 'Integrado' : 'Operación actual',
 date: entry.issueDate || entry.dueDate,
 type: 'expense',
 status: normalizeDocumentStatus(entry.status),
 statusLabel:
 entry.status === 'issued'
 ? 'Emitida'
 : entry.status === 'settled'
 ? 'Liquidada'
 : entry.status === 'overdue'
 ? 'Vencida'
 : null,
 amount: Number(entry.grossAmount ?? entry.amount) || 0,
 paidAmount: Number(entry.paidAmount) || 0,
 project: entry.projectName || 'Sin proyecto',
 projectId: entry.projectId || '',
 category: 'payable',
 categoryLabel: 'Factura CXP',
 costCenter: entry.costCenterId || '',
 costCenterId: entry.costCenterId || '',
 documentNumber: entry.documentNumber || '',
 counterpartyName: entry.counterpartyName || '',
 canEdit: entry.status !== 'cancelled',
 canDelete: false,
 canViewNotes: false,
 canRegisterPayment: ['pending', 'partial', 'overdue'].includes(normalizeDocumentStatus(entry.status)),
 canVoid: !entry.paidAmount && entry.status !== 'cancelled' && entry.status !== 'settled',
 canChangeStatus: entry.status !== 'cancelled',
 voidActionLabel: 'Cancelar',
 paymentActionLabel: 'Pago',
 notes: [],
 secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Pendiente de pago',
 traceMeta: entry.updatedBy || entry.createdBy || '',
 lastEditor: entry.updatedBy || entry.createdBy || '',
 lastEditedAt: entry.updatedAt || entry.createdAt || null,
 year: (entry.issueDate || entry.dueDate) ? new Date(entry.issueDate || entry.dueDate).getFullYear() : null,
 }));
};

const getSearchIndex = (record) => {
 const notesText = Array.isArray(record.notes)
 ? record.notes.map((note) => safeString(note?.text)).join(' ')
 : '';

 return [
 record.description,
 record.project,
 record.categoryLabel,
 record.costCenter,
 record.counterpartyName,
 record.documentNumber,
 record.recordFamilyLabel,
 record.sourceLabel,
 notesText,
 ]
 .map((entry) => safeString(entry).toLowerCase())
 .join(' ');
};


const TransactionList = ({ transactions, userRole, searchTerm, setSearchTerm, user }) => {
 const [showFilters, setShowFilters] = useState(false);
 const [advancedFilters, setAdvancedFilters] = useState(FILTER_DEFAULTS);
 const [isFormModalOpen, setIsFormModalOpen] = useState(false);
 const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
 const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
 const [editingTransaction, setEditingTransaction] = useState(null);
 const [editingCanonicalRecord, setEditingCanonicalRecord] = useState(null);
 const [submittingCanonicalEdit, setSubmittingCanonicalEdit] = useState(false);
 const [selectedTransaction, setSelectedTransaction] = useState(null);
 const [auditRecord, setAuditRecord] = useState(null);
 const [transactionToDelete, setTransactionToDelete] = useState(null);
 const [recordToVoid, setRecordToVoid] = useState(null);
 const [pendingEditConfirmation, setPendingEditConfirmation] = useState(null);
 const [toast, setToast] = useState(null);
 const [quickFilter, setQuickFilter] = useState('all');
 const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
 const [paymentRecord, setPaymentRecord] = useState(null);
 const [bulkCatOpen, setBulkCatOpen] = useState(false);
 const [bulkSelected, setBulkSelected] = useState(new Set());
 const [bulkCategory, setBulkCategory] = useState('');
 const [bulkCostCenter, setBulkCostCenter] = useState('');
 const [bulkSubmitting, setBulkSubmitting] = useState(false);

 const {
 createTransaction,
 updateTransaction,
 deleteTransaction,
 addNote,
 markAsRead,
 toggleStatus,
 registerPayment: registerLegacyPayment,
 } = useTransactionActions(user);
 const { logs: auditLogs, loading: auditLogsLoading } = useAuditLog(user);
 const { expenseCategories, incomeCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { projects } = useProjects(user);
 const { bankMovements, loading: bankMovementsLoading, updateBankMovement, bulkUpdateCategory, voidBankMovement } = useBankMovements(user);
 const {
 receivables,
 loading: receivablesLoading,
 createReceivable,
 registerPayment: registerReceivablePayment,
 updateReceivable,
 cancelReceivable,
 } = useReceivables(user);
 const {
 payables,
 loading: payablesLoading,
 registerPayment: registerPayablePayment,
 updatePayable,
 cancelPayable,
 } = usePayables(user);

 const showToast = (message, type = 'success') => {
 setToast({ message, type });
 setTimeout(() => setToast(null), 3000);
 };

 const sevenDaysAgo = useMemo(() => {
 const date = new Date();
 date.setDate(date.getDate() - 7);
 return date;
 }, []);

 const sevenDaysAgoISO = useMemo(() => sevenDaysAgo.toISOString().slice(0, 10), [sevenDaysAgo]);

 const unifiedRecords = useMemo(() => {
 return [
 ...buildLegacyRows(transactions),
 ...buildMovementRows(bankMovements),
 ...buildReceivableRows(receivables),
 ...buildPayableRows(payables),
 ].sort((left, right) => new Date(right.date) - new Date(left.date));
 }, [transactions, bankMovements, receivables, payables]);

 const filterOptions = useMemo(() => {
 const projects = [...new Set(unifiedRecords.map((entry) => safeString(entry.project)).filter(Boolean))].sort();
 const categories = [...new Set(unifiedRecords.map((entry) => safeString(entry.categoryLabel)).filter(Boolean))].sort();
 const centers = [...new Set(unifiedRecords.map((entry) => safeString(entry.costCenter)).filter(Boolean))].sort();
 return { projects, categories, centers };
 }, [unifiedRecords]);

 const quickFilterCounts = useMemo(() => {
 let nuevas = 0;
 let sinLeer = 0;
 let conComentarios = 0;
 let pendientes = 0;

 for (const entry of unifiedRecords) {
 if (entry.date && entry.date >= sevenDaysAgoISO) nuevas += 1;
 if (entry.hasUnreadUpdates) sinLeer += 1;
 if (entry.notes?.some((note) => note.type === 'comment')) conComentarios += 1;
 if (['pending', 'partial', 'overdue'].includes(entry.status)) pendientes += 1;
 }

 return {
 all: unifiedRecords.length,
 nuevas,
 sinLeer,
 conComentarios,
 pendientes,
 duplicados: 0, // placeholder, computed separately
 };
 }, [unifiedRecords, sevenDaysAgoISO]);

 const metrics = useMemo(() => {
 return {
 total: unifiedRecords.length,
 legacy: unifiedRecords.filter((entry) => entry.recordFamily === 'legacy').length,
 movements: unifiedRecords.filter((entry) => entry.recordFamily === 'movement').length,
 openDocs: unifiedRecords.filter((entry) => ['receivable', 'payable'].includes(entry.recordFamily) && ['pending', 'partial', 'overdue'].includes(entry.status)).length,
 noCC: unifiedRecords.filter((entry) => !entry.costCenter && (entry.type === 'expense' || entry.type === 'income')).length,
 };
 }, [unifiedRecords]);

 // Bank movements without a category (for bulk categorization)
 const uncategorizedMovements = useMemo(() => {
 return bankMovements.filter((m) => !m.categoryName && m.status !== 'VOID');
 }, [bankMovements]);

 const handleBulkApply = async () => {
 if (!bulkCategory || bulkSelected.size === 0) return;
 setBulkSubmitting(true);
 const result = await bulkUpdateCategory([...bulkSelected], bulkCategory, bulkCostCenter);
 setBulkSubmitting(false);
 if (result.success) {
 showToast(`${result.count} movimientos categorizados como "${bulkCategory}"`);
 setBulkSelected(new Set());
 setBulkCategory('');
 setBulkCostCenter('');
 } else {
 showToast('Error al categorizar', 'error');
 }
 };

 // Detect possible duplicates: same amount + same type + date within 3 days + similar description
 // EXCLUDES cross-family pairs (e.g., a receivable + its collection movement = NOT a duplicate)
 const { duplicateIds, duplicateGroups } = useMemo(() => {
 const dupeSet = new Set();
 const groups = [];
 const records = unifiedRecords;
 const paired = new Set();

 // A receivable/payable and its corresponding movement are NOT duplicates
 const isNaturalPair = (a, b) => {
 const families = [a.recordFamily, b.recordFamily];
 // movement + receivable/payable = invoice + its payment (not a duplicate)
 if (families.includes('movement') && (families.includes('receivable') || families.includes('payable'))) return true;
 // legacy + movement with same legacyTransactionId = same record in two forms
 if (families.includes('legacy') && families.includes('movement')) {
 const mov = a.recordFamily === 'movement' ? a : b;
 const leg = a.recordFamily === 'legacy' ? a : b;
 if (mov.rawRecord?.legacyTransactionId === leg.rawRecord?.id) return true;
 }
 return false;
 };

 for (let i = 0; i < records.length; i++) {
 if (paired.has(records[i].id)) continue;
 const matches = [];
 for (let j = i + 1; j < records.length; j++) {
 const a = records[i];
 const b = records[j];
 if (a.type !== b.type || Math.abs(a.amount - b.amount) > 0.01) continue;
 // Skip natural pairs (invoice + payment, legacy + its movement)
 if (isNaturalPair(a, b)) continue;
 if (a.date && b.date) {
 const daysDiff = Math.abs((new Date(a.date) - new Date(b.date)) / (1000 * 60 * 60 * 24));
 if (daysDiff > 3) continue;
 }
 const aWords = safeString(a.description).toLowerCase().split(/\s+/).filter(w => w.length > 3);
 const bDesc = safeString(b.description).toLowerCase();
 const hasCommon = aWords.some(w => bDesc.includes(w));
 if (hasCommon || safeString(a.description).toLowerCase() === bDesc) {
 matches.push(b);
 dupeSet.add(a.id);
 dupeSet.add(b.id);
 paired.add(b.id);
 }
 }
 if (matches.length > 0) {
 groups.push({ original: records[i], duplicates: matches });
 paired.add(records[i].id);
 }
 }
 return { duplicateIds: dupeSet, duplicateGroups: groups };
 }, [unifiedRecords]);

 const filteredRecords = useMemo(() => {
 const normalizedSearch = searchTerm.trim().toLowerCase();
 const minAmount = advancedFilters.minAmount === '' ? null : Number(advancedFilters.minAmount);
 const maxAmount = advancedFilters.maxAmount === '' ? null : Number(advancedFilters.maxAmount);

 return unifiedRecords.filter((entry) => {
 if (normalizedSearch && !getSearchIndex(entry).includes(normalizedSearch)) {
 return false;
 }

 if (quickFilter === 'nuevas') {
 if (!entry.date || entry.date < sevenDaysAgoISO) return false;
 }

 if (quickFilter === 'sinLeer' && !entry.hasUnreadUpdates) {
 return false;
 }

 if (quickFilter === 'conComentarios' && !entry.notes?.some((note) => note.type === 'comment')) {
 return false;
 }

 if (quickFilter === 'pendientes' && !['pending', 'partial', 'overdue'].includes(entry.status)) {
 return false;
 }

 if (quickFilter === 'duplicados' && !duplicateIds.has(entry.id)) {
 return false;
 }

 if (advancedFilters.dateFrom && entry.date < advancedFilters.dateFrom) {
 return false;
 }

 if (advancedFilters.dateTo && entry.date > advancedFilters.dateTo) {
 return false;
 }

 if (advancedFilters.project && safeString(entry.project) !== advancedFilters.project) {
 return false;
 }

 if (advancedFilters.category && safeString(entry.categoryLabel) !== advancedFilters.category) {
 return false;
 }

 if (advancedFilters.costCenter && safeString(entry.costCenter) !== advancedFilters.costCenter) {
 return false;
 }

 if (advancedFilters.type && entry.type !== advancedFilters.type) {
 return false;
 }

 if (advancedFilters.status && entry.status !== advancedFilters.status) {
 return false;
 }

 if (advancedFilters.origin && entry.sourceKey !== advancedFilters.origin) {
 return false;
 }

 if (advancedFilters.family && entry.recordFamily !== advancedFilters.family) {
 return false;
 }

 if (advancedFilters.year && String(entry.year) !== advancedFilters.year) {
 return false;
 }

 if (minAmount != null && Number(entry.amount) < minAmount) {
 return false;
 }

 if (maxAmount != null && Number(entry.amount) > maxAmount) {
 return false;
 }

 if (advancedFilters.noCostCenter && (entry.costCenter || '').trim() !== '') return false;
 if (advancedFilters.notesMode === 'with-notes' && !entry.notes?.some((note) => note.type === 'comment')) {
 return false;
 }

 if (advancedFilters.notesMode === 'without-notes' && entry.notes?.some((note) => note.type === 'comment')) {
 return false;
 }

 return true;
 });
 }, [advancedFilters, quickFilter, searchTerm, sevenDaysAgoISO, unifiedRecords, duplicateIds]);

 const activeFiltersCount = useMemo(() => {
 return Object.entries(advancedFilters).filter(([, value]) => value !== '' && value !== 'all').length;
 }, [advancedFilters]);

 const resolveProjectName = (projectId) => {
 const match = projects.find((project) => project.id === projectId);
 return match?.name || match?.displayName || match?.code || '';
 };

 const handleDelete = (record) => {
 if (userRole !== 'admin') {
 showToast('Solo administradores pueden eliminar registros', 'error');
 return;
 }
 if (record.recordFamily !== 'legacy') {
 const familyLabels = { movement: 'movimiento bancario', receivable: 'factura CXC', payable: 'factura CXP' };
 showToast(`No se puede eliminar un ${familyLabels[record.recordFamily] || 'registro'} — usa "Estado → Anular" en su lugar`, 'error');
 return;
 }
 setTransactionToDelete(record.rawRecord);
 setIsConfirmModalOpen(true);
 };

 const confirmDelete = async () => {
 if (!transactionToDelete) return false;

 const result = await deleteTransaction(transactionToDelete.id, transactionToDelete);
 if (!result?.success) {
 showToast(result?.error?.message || 'No se pudo eliminar el registro', 'error');
 return false;
 }

 setTransactionToDelete(null);
 showToast('Registro eliminado');
 return true;
 };

 const handleEdit = (record) => {
 if (userRole !== 'admin') return;
 if (record.recordFamily === 'legacy') {
 setEditingTransaction(record.rawRecord);
 setIsFormModalOpen(true);
 if (record.hasUnreadUpdates) {
 markAsRead(record.entityId);
 }
 return;
 }

 setEditingCanonicalRecord(record);
 };

 const handleViewNotes = (record) => {
 if (record.recordFamily !== 'legacy') return;
 setSelectedTransaction(record.rawRecord);
 setIsNotesModalOpen(true);
 if (record.hasUnreadUpdates) {
 markAsRead(record.entityId);
 }
 };

 const handleRegisterPayment = (record) => {
 if (!record.canRegisterPayment) return;
 setPaymentRecord(record);
 setIsPaymentModalOpen(true);
 };

 const handleViewAuditTrail = (record) => {
 if (userRole !== 'admin') return;
 setAuditRecord(record);
 };

 const handleVoid = (record) => {
 if (userRole !== 'admin') return;
 if (!record.canVoid) return;
 setRecordToVoid(record);
 };

 const [statusChangeRecord, setStatusChangeRecord] = useState(null);
 const [detailRecord, setDetailRecord] = useState(null);

 const handleChangeStatus = (record) => {
 if (userRole !== 'admin') return;
 if (!record.canChangeStatus) return;
 setStatusChangeRecord(record);
 };

 const confirmStatusChange = async (targetStatus) => {
 if (!statusChangeRecord) return;
 const raw = statusChangeRecord.rawRecord;
 const family = statusChangeRecord.recordFamily;

 try {
 if (family === 'legacy') {
 const result = await toggleStatus(raw, targetStatus);
 if (!result?.success) {
 showToast(result?.error || 'No se pudo cambiar el estado', 'error');
 setStatusChangeRecord(null);
 return;
 }
 } else if (family === 'movement') {
 const isVirtual = raw.source === 'legacy-transaction';
 const legacyTx = raw.legacyTransactionId
 ? transactions.find((t) => t.id === raw.legacyTransactionId)
 : null;

 if (isVirtual && legacyTx) {
 // Virtual movement (adapted from legacy tx) — change the underlying transaction
 const newStatus = targetStatus === 'void' ? 'cancelled' : targetStatus;
 await toggleStatus(legacyTx, newStatus);
 } else if (!isVirtual) {
 // Canonical bank movement (stored in Firestore bankMovements collection)
 const alreadyVoided = raw.status === 'void';
 if (!alreadyVoided) {
 await voidBankMovement(raw.id);
 }
 if (legacyTx && targetStatus === 'pending') {
 await toggleStatus(legacyTx, 'pending');
 }
 // If reverting to CXC, create a receivable
 if (targetStatus === 'pending') {
 const movementName = raw.counterpartyName || raw.description || statusChangeRecord.description || 'Revertido de movimiento';
 const movementAmount = raw.amount || statusChangeRecord.amount || 0;
 const movementDate = raw.postedDate || raw.valueDate || statusChangeRecord.date;
 try {
 const cxcResult = await createReceivable({
 client: movementName,
 description: `${movementName} (revertido de mov. bancario)`,
 amount: movementAmount,
 issueDate: movementDate,
 dueDate: movementDate,
 projectName: raw.projectName || statusChangeRecord.project || '',
 projectId: raw.projectId || '',
 costCenterId: raw.costCenterId || statusChangeRecord.costCenter || '',
 documentNumber: raw.documentNumber || '',
 });
 if (!cxcResult?.success) {
 showToast('No se pudo crear la CXC: ' + JSON.stringify(cxcResult?.error || 'error desconocido'), 'error');
 setStatusChangeRecord(null);
 return;
 }
 showToast(`CXC creada por ${formatCurrency(movementAmount)} — revisa en Cuentas por Cobrar`);
 } catch (cxcErr) {
 showToast('Error al crear CXC: ' + (cxcErr?.message || 'desconocido'), 'error');
 setStatusChangeRecord(null);
 return;
 }
 }
 } else {
 showToast('No se puede modificar este registro — no tiene transacción editable vinculada', 'error');
 setStatusChangeRecord(null);
 return;
 }
 } else if (family === 'receivable') {
 if (targetStatus === 'paid') {
 await registerReceivablePayment(raw.id, {
 amount: raw.openAmount || raw.grossAmount,
 date: new Date().toISOString().slice(0, 10),
 method: 'Ajuste manual',
 note: 'Liquidado manualmente desde cambio de estado',
 });
 } else if (targetStatus === 'cancelled') {
 await cancelReceivable(raw.id);
 }
 } else if (family === 'payable') {
 if (targetStatus === 'paid') {
 await registerPayablePayment(raw.id, {
 amount: raw.openAmount || raw.grossAmount,
 date: new Date().toISOString().slice(0, 10),
 method: 'Ajuste manual',
 note: 'Liquidado manualmente desde cambio de estado',
 });
 } else if (targetStatus === 'cancelled') {
 await cancelPayable(raw.id);
 }
 }

 const labels = { pending: 'Pendiente (CXC)', paid: 'Liquidado', cancelled: 'Anulado', void: 'Anulado' };
 const extra = targetStatus === 'pending' && family === 'movement' ? ' — movimiento anulado y CXC creada' : '';
 showToast(`${labels[targetStatus] || targetStatus}${extra}`);
 } catch (err) {
 showToast('Error al cambiar estado: ' + (err?.message || 'desconocido'), 'error');
 }
 setStatusChangeRecord(null);
 };

 const handleFormSubmit = async (formData) => {
 if (editingTransaction) {
 await updateTransaction(editingTransaction.id, formData, editingTransaction.notes, editingTransaction);
 showToast('Registro actualizado');
 } else {
 await createTransaction(formData);
 showToast('Registro creado');
 }

 setIsFormModalOpen(false);
 setEditingTransaction(null);
 };

 const handleAddNote = async (transaction, noteText) => {
 const result = await addNote(transaction, noteText);
 if (!result?.success) return;

 showToast('Comentario agregado correctamente');
 const updatedTransaction = {
 ...transaction,
 notes: [
 ...(transaction.notes || []),
 {
 text: noteText.trim(),
 timestamp: new Date().toISOString(),
 user: user.email,
 type: 'comment',
 },
 ],
 };
 setSelectedTransaction(updatedTransaction);
 };

 const handlePaymentSubmit = async (record, paymentData) => {
 let result = null;

 if (record.recordFamily === 'legacy') {
 result = await registerLegacyPayment(record.rawRecord, paymentData);
 } else if (record.recordFamily === 'receivable') {
 result = await registerReceivablePayment(record.rawRecord, paymentData);
 } else if (record.recordFamily === 'payable') {
 result = await registerPayablePayment(record.rawRecord, paymentData);
 }

 if (result?.success) {
 showToast(record.recordFamily === 'receivable' ? 'Cobro registrado correctamente' : 'Pago registrado correctamente');
 }
 };

 const executeCanonicalEdit = async (formData) => {
 if (!editingCanonicalRecord) return;

 setSubmittingCanonicalEdit(true);
 try {
 const payload = {
 ...formData,
 amount: Number(formData.amount) || 0,
 projectName: resolveProjectName(formData.projectId),
 };

 let result = { success: false };
 if (editingCanonicalRecord.recordFamily === 'movement') {
 result = await updateBankMovement(editingCanonicalRecord.entityId, payload);
 }
 if (editingCanonicalRecord.recordFamily === 'receivable') {
 result = await updateReceivable(editingCanonicalRecord.rawRecord, payload);
 }
 if (editingCanonicalRecord.recordFamily === 'payable') {
 result = await updatePayable(editingCanonicalRecord.rawRecord, payload);
 }

 if (!result?.success) {
 throw result?.error || new Error('No se pudo actualizar el registro');
 }

 showToast('Registro actualizado');
 setEditingCanonicalRecord(null);
 return true;
 } catch (error) {
 showToast(error.message || 'No se pudo actualizar el registro', 'error');
 return false;
 } finally {
 setSubmittingCanonicalEdit(false);
 }
 };

 const handleCanonicalEditSubmit = async (formData) => {
 if (!editingCanonicalRecord) return;

 const currentAmount = Number(editingCanonicalRecord.amount) || 0;
 const nextAmount = Number(formData.amount) || 0;
 if (Math.abs(currentAmount - nextAmount) >= 0.01) {
 setPendingEditConfirmation({
 formData,
 currentAmount,
 nextAmount,
 delta: nextAmount - currentAmount,
 record: editingCanonicalRecord,
 });
 return;
 }

 await executeCanonicalEdit(formData);
 };

 const confirmVoid = async () => {
 if (!recordToVoid) return false;

 let result = { success: false };
 if (recordToVoid.recordFamily === 'movement') {
 result = await voidBankMovement(recordToVoid.entityId, 'Anulado desde mesa de registros');
 }
 if (recordToVoid.recordFamily === 'receivable') {
 result = await cancelReceivable(recordToVoid.rawRecord);
 }
 if (recordToVoid.recordFamily === 'payable') {
 result = await cancelPayable(recordToVoid.rawRecord);
 }

 if (result?.success) {
 showToast(recordToVoid.recordFamily === 'movement' ? 'Movimiento anulado' : 'Documento cancelado');
 setRecordToVoid(null);
 return true;
 } else {
 showToast(result?.error?.message || 'No se pudo completar la accion', 'error');
 return false;
 }
 };

 const confirmCanonicalAmountEdit = async () => {
 if (!pendingEditConfirmation) return false;
 const success = await executeCanonicalEdit(pendingEditConfirmation.formData);
 if (success) {
 setPendingEditConfirmation(null);
 }
 return success;
 };

 const exportRows = filteredRecords.map((entry) => ({
 ...entry,
 description: `${entry.recordFamilyLabel} · ${entry.description}`,
 project: entry.project,
 category: entry.categoryLabel,
 status: entry.status === 'paid' ? 'paid' : entry.status === 'partial' ? 'partial' : 'pending',
 }));

 const resetFilters = () => {
 setAdvancedFilters(FILTER_DEFAULTS);
 setQuickFilter('all');
 setSearchTerm('');
 };

 const quickFilterButtons = [
 { key: 'all', label: 'Todo', count: quickFilterCounts.all, icon: null },
 { key: 'pendientes', label: 'Pendientes', count: quickFilterCounts.pendientes, icon: Eye },
 { key: 'nuevas', label: 'Nuevas', count: quickFilterCounts.nuevas, icon: Sparkles },
 { key: 'sinLeer', label: 'Sin leer', count: quickFilterCounts.sinLeer, icon: Eye },
 { key: 'conComentarios', label: 'Con comentarios', count: quickFilterCounts.conComentarios, icon: MessageSquare },
 { key: 'duplicados', label: 'Posibles duplicados', count: duplicateIds.size, icon: RotateCcw },
 ];

 const loadingLedger = bankMovementsLoading || receivablesLoading || payablesLoading;

 return (
 <div className="space-y-4 animate-fadeIn">
 {toast && (
 <div
 className={`fixed right-6 top-6 z-[100] flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium animate-fadeIn ${
 toast.type === 'success'
 ? 'border-[var(--color-line-s)] bg-transparent text-[var(--color-ok)]'
 : 'border-[var(--color-line-s)] bg-transparent text-[var(--color-accent)]'
 }`}
 >
 <CheckCircle size={15} />
 {toast.message}
 </div>
 )}

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 md:p-6">
 <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
 <div className="max-w-3xl">
 <p className="label-mono text-[var(--color-fg-3)]">Control operativo</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)] md:text-[32px]">Mesa central de registros financieros</h2>
 <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--color-fg-4)]">
 Revisa en una sola vista movimientos bancarios, facturas por cobrar, facturas por pagar y registros históricos sin duplicados.
 </p>
 </div>

 <div className="xl:min-w-[520px]">
 <KPIGrid cols={4}>
 <KPI label="Registros" value={formatCount(metrics.total)} icon={Landmark} onClick={() => { setQuickFilter('all'); setAdvancedFilters(FILTER_DEFAULTS); setSearchTerm(''); }} />
 <KPI label="Histórico" value={formatCount(metrics.legacy)} icon={ReceiptText} onClick={() => { setQuickFilter('all'); setAdvancedFilters(prev => prev.family === 'legacy' ? FILTER_DEFAULTS : { ...FILTER_DEFAULTS, family: 'legacy' }); }} />
 <KPI label="Movimientos" value={formatCount(metrics.movements)} icon={WalletCards} onClick={() => { setQuickFilter('all'); setAdvancedFilters(prev => prev.family === 'movement' ? FILTER_DEFAULTS : { ...FILTER_DEFAULTS, family: 'movement' }); }} />
 <KPI label="Documentos abiertos" value={formatCount(metrics.openDocs)} tone="warn" icon={Filter} onClick={() => { setAdvancedFilters(FILTER_DEFAULTS); setQuickFilter(prev => prev === 'pendientes' ? 'all' : 'pendientes'); }} />
 {uncategorizedMovements.length > 0 && <KPI label="Sin categoría" value={formatCount(uncategorizedMovements.length)} tone="warn" icon={AlertTriangle} onClick={() => setBulkCatOpen((v) => !v)} />}
 {metrics.noCC > 0 && <KPI label="Sin CC" value={formatCount(metrics.noCC)} tone="warn" icon={AlertTriangle} onClick={() => { setQuickFilter('all'); setAdvancedFilters(prev => ({ ...FILTER_DEFAULTS, noCostCenter: !prev.noCostCenter })); }} />}
 </KPIGrid>
 </div>
 </div>
 </section>

 <TransactionFilters
 searchTerm={searchTerm}
 setSearchTerm={setSearchTerm}
 showFilters={showFilters}
 setShowFilters={setShowFilters}
 advancedFilters={advancedFilters}
 setAdvancedFilters={setAdvancedFilters}
 quickFilter={quickFilter}
 setQuickFilter={setQuickFilter}
 quickFilterButtons={quickFilterButtons}
 activeFiltersCount={activeFiltersCount}
 filterOptions={filterOptions}
 userRole={userRole}
 onExportPDF={() => exportTransactionsToPDF(exportRows, 'Registros Unificados')}
 onResetFilters={resetFilters}
 />

 <div className="flex items-center justify-between px-1">
 <p className="text-[13px] text-[var(--color-fg-3)]">
 Mostrando <span className="font-medium text-[var(--color-fg-1)]">{formatCount(filteredRecords.length)}</span> registros
 {filteredRecords.length !== unifiedRecords.length && (
 <span className="text-[var(--color-fg-3)]"> de {formatCount(unifiedRecords.length)}</span>
 )}
 </p>
 {(activeFiltersCount > 0 || quickFilter !== 'all' || searchTerm) && (
 <button
 type="button"
 onClick={resetFilters}
 className="text-[12px] font-medium text-[var(--color-fg-1)] transition-colors hover:text-[var(--color-fg-1)]"
 >
 Limpiar selección
 </button>
 )}
 </div>

 {quickFilter === 'duplicados' && (
 <DuplicateReviewPanel duplicateGroups={duplicateGroups} onDelete={handleDelete} />
 )}

 {/* Bulk categorize panel */}
 {bulkCatOpen && uncategorizedMovements.length > 0 && (
 <section className="rounded-md border border-[var(--color-line-s)] bg-transparent p-5 space-y-4">
 <div className="flex items-center justify-between">
 <div>
 <h3 className="text-[15px] font-medium text-[var(--color-fg-1)]">Categorización en lote</h3>
 <p className="mt-0.5 text-xs text-[var(--color-fg-3)]">{uncategorizedMovements.length} movimientos bancarios sin categoría. Selecciona y asigna.</p>
 </div>
 <button onClick={() => setBulkCatOpen(false)} className="rounded-lg p-1.5 text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]">
 <X size={16} />
 </button>
 </div>

 {/* Controls */}
 <div className="flex flex-wrap items-end gap-3">
 <label className="block flex-1 min-w-[180px]">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">Categoría</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-sm outline-none focus:border-[var(--color-fg-3)]"
 value={bulkCategory}
 onChange={(e) => setBulkCategory(e.target.value)}
 >
 <option value="">Seleccionar...</option>
 <optgroup label="Gastos">
 {expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
 </optgroup>
 <optgroup label="Ingresos">
 {incomeCategories.map((c) => <option key={c} value={c}>{c}</option>)}
 </optgroup>
 </select>
 </label>
 <label className="block min-w-[160px]">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">Centro de costo</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-sm outline-none focus:border-[var(--color-fg-3)]"
 value={bulkCostCenter}
 onChange={(e) => setBulkCostCenter(e.target.value)}
 >
 <option value="">Sin centro</option>
 {costCenters.map((cc) => <option key={cc.id} value={cc.name}>{cc.name}</option>)}
 </select>
 </label>
 <Button
 variant="primary"
 disabled={!bulkCategory || bulkSelected.size === 0 || bulkSubmitting}
 loading={bulkSubmitting}
 onClick={handleBulkApply}
 >
 {bulkSubmitting ? 'Aplicando...' : `Aplicar a ${bulkSelected.size} seleccionados`}
 </Button>
 </div>

 {/* Select all / none */}
 <div className="flex items-center gap-3 text-xs">
 <button
 className="font-medium text-[var(--color-fg-1)] hover:underline"
 onClick={() => setBulkSelected(new Set(uncategorizedMovements.map((m) => m.id)))}
 >
 Seleccionar todos
 </button>
 <span className="text-[var(--color-fg-3)]">|</span>
 <button
 className="font-medium text-[var(--color-fg-1)] hover:underline"
 onClick={() => setBulkSelected(new Set())}
 >
 Ninguno
 </button>
 <span className="text-[var(--color-fg-3)]">{bulkSelected.size} de {uncategorizedMovements.length} seleccionados</span>
 </div>

 {/* Movement list */}
 <div className="max-h-[340px] overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
 <table className="w-full text-left text-sm">
 <thead className="sticky top-0 bg-[var(--color-bg-1)] ">
 <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
 <th className="w-10 px-3 py-2 text-center">
 <input
 type="checkbox"
 checked={uncategorizedMovements.length > 0 && bulkSelected.size === uncategorizedMovements.length}
 onChange={(e) => {
 if (e.target.checked) setBulkSelected(new Set(uncategorizedMovements.map((m) => m.id)));
 else setBulkSelected(new Set());
 }}
 className="rounded"
 />
 </th>
 <th className="px-3 py-2">Fecha</th>
 <th className="px-3 py-2">Descripción</th>
 <th className="px-3 py-2">Contraparte</th>
 <th className="px-3 py-2 text-right">Monto</th>
 <th className="px-3 py-2">Dir</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {uncategorizedMovements.slice(0, 100).map((m) => (
 <tr
 key={m.id}
 className={`cursor-pointer hover:bg-[var(--color-bg-1)] ${bulkSelected.has(m.id) ? 'bg-[var(--color-bg-1)]' : ''}`}
 onClick={() => setBulkSelected((prev) => {
 const next = new Set(prev);
 if (next.has(m.id)) next.delete(m.id);
 else next.add(m.id);
 return next;
 })}
 >
 <td className="px-3 py-2 text-center">
 <input
 type="checkbox"
 checked={bulkSelected.has(m.id)}
 onChange={() => {}}
 className="rounded pointer-events-none"
 />
 </td>
 <td className="px-3 py-2 whitespace-nowrap text-[var(--color-fg-3)]">{m.postedDate?.slice(0, 10) || '—'}</td>
 <td className="px-3 py-2 max-w-[280px] truncate text-[var(--color-fg-1)]">{m.description || '—'}</td>
 <td className="px-3 py-2 text-[var(--color-fg-3)]">{m.counterpartyName || '—'}</td>
 <td className={`px-3 py-2 text-right font-mono tabular-nums ${m.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}>
 {m.direction === 'in' ? '+' : '-'}{formatCurrency(Math.abs(m.netAmount ?? m.amount))}
 </td>
 <td className="px-3 py-2 text-xs text-[var(--color-fg-3)]">{m.direction === 'in' ? 'Entrada' : 'Salida'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 {uncategorizedMovements.length > 100 && (
 <p className="px-3 py-2 text-xs italic text-[var(--color-fg-3)]">Mostrando los primeros 100 de {uncategorizedMovements.length}</p>
 )}
 </div>
 </section>
 )}

 <TransactionTable
 filteredRecords={filteredRecords}
 loadingLedger={loadingLedger}
 userRole={userRole}
 searchTerm={searchTerm}
 resetFilters={resetFilters}
 onDelete={handleDelete}
 onEdit={handleEdit}
 onViewNotes={handleViewNotes}
 onViewAuditTrail={handleViewAuditTrail}
 onRegisterPayment={handleRegisterPayment}
 onVoid={handleVoid}
 onChangeStatus={handleChangeStatus}
 onViewDetail={setDetailRecord}
 />

 <TransactionFormModal
 isOpen={isFormModalOpen}
 onClose={() => {
 setIsFormModalOpen(false);
 setEditingTransaction(null);
 }}
 onSubmit={handleFormSubmit}
 editingTransaction={editingTransaction}
 user={user}
 expenseCategories={expenseCategories}
 incomeCategories={incomeCategories}
 costCenters={costCenters}
 transactions={transactions}
 />

 <CanonicalRecordModal
 key={editingCanonicalRecord?.id || 'canonical-editor'}
 isOpen={Boolean(editingCanonicalRecord)}
 onClose={() => setEditingCanonicalRecord(null)}
 record={editingCanonicalRecord}
 onSubmit={handleCanonicalEditSubmit}
 projects={projects}
 costCenters={costCenters}
 categories={[...expenseCategories, ...incomeCategories]}
 submitting={submittingCanonicalEdit}
 />

 <NotesModal
 isOpen={isNotesModalOpen}
 onClose={() => {
 setIsNotesModalOpen(false);
 setSelectedTransaction(null);
 }}
 transaction={selectedTransaction}
 onAddNote={handleAddNote}
 />

 <ConfirmModal
 isOpen={isConfirmModalOpen}
 onClose={() => {
 setIsConfirmModalOpen(false);
 setTransactionToDelete(null);
 }}
 onConfirm={confirmDelete}
 title="Eliminar transacción"
 message={`¿Eliminar "${transactionToDelete?.description}"? Esta accion no se puede deshacer.`}
 confirmText="Eliminar"
 cancelText="Cancelar"
 variant="danger"
 details={[
 { label: 'Registro', value: transactionToDelete?.description || 'Sin descripcion', emphasis: true },
 { label: 'Importe', value: transactionToDelete ? `€${Number(transactionToDelete.amount || 0).toFixed(2)}` : '—', emphasis: true },
 { label: 'Fecha', value: transactionToDelete?.date || '—' },
 ]}
 warning="Se eliminará el registro histórico completo y desaparecerá de la mesa de trabajo."
 confirmKeyword="ELIMINAR"
 confirmKeywordLabel="Confirmación de borrado"
 confirmKeywordPlaceholder="ELIMINAR"
 />

 <ConfirmModal
 isOpen={Boolean(recordToVoid)}
 onClose={() => setRecordToVoid(null)}
 onConfirm={confirmVoid}
 title={recordToVoid?.recordFamily === 'movement' ? 'Anular movimiento bancario' : 'Cancelar documento'}
 message={
 recordToVoid?.recordFamily === 'movement'
 ? `¿Anular "${recordToVoid?.description}"? El movimiento quedará en estado void.`
 : `¿Cancelar "${recordToVoid?.description}"? El documento quedará cerrado sin saldo abierto.`
 }
 confirmText={recordToVoid?.recordFamily === 'movement' ? 'Anular' : 'Cancelar'}
 cancelText="Volver"
 variant="danger"
 details={[
 { label: 'Registro', value: recordToVoid?.description || 'Sin descripcion', emphasis: true },
 { label: 'Tipo', value: recordToVoid?.recordFamilyLabel || '—' },
 { label: 'Importe', value: recordToVoid ? `€${Number(recordToVoid.amount || 0).toFixed(2)}` : '—', emphasis: true },
 { label: 'Estado actual', value: recordToVoid?.statusLabel || recordToVoid?.status || '—' },
 { label: 'Documento', value: recordToVoid?.documentNumber || '—' },
 ]}
 warning={
 recordToVoid?.recordFamily === 'movement'
 ? 'La anulación mantiene trazabilidad, pero el movimiento dejará de contar como caja válida.'
 : 'La cancelación cerrará el documento sin saldo abierto. No se permite si ya tiene cobros o pagos.'
 }
 confirmKeyword={recordToVoid?.recordFamily === 'movement' ? 'ANULAR' : 'CANCELAR'}
 confirmKeywordLabel={recordToVoid?.recordFamily === 'movement' ? 'Confirmación de anulación' : 'Confirmación de cancelación'}
 confirmKeywordPlaceholder={recordToVoid?.recordFamily === 'movement' ? 'ANULAR' : 'CANCELAR'}
 />

 <ConfirmModal
 isOpen={Boolean(pendingEditConfirmation)}
 onClose={() => setPendingEditConfirmation(null)}
 onConfirm={confirmCanonicalAmountEdit}
 title="Confirmar cambio de importe"
 message={`Vas a modificar el importe de "${pendingEditConfirmation?.record?.description || 'este registro'}". Revisa el cambio antes de guardarlo.`}
 confirmText="Guardar importe"
 cancelText="Revisar"
 variant="warning"
 details={[
 { label: 'Registro', value: pendingEditConfirmation?.record?.description || '—', emphasis: true },
 { label: 'Importe actual', value: pendingEditConfirmation ? `€${pendingEditConfirmation.currentAmount.toFixed(2)}` : '—' },
 { label: 'Importe nuevo', value: pendingEditConfirmation ? `€${pendingEditConfirmation.nextAmount.toFixed(2)}` : '—', emphasis: true },
 {
 label: 'Variación',
 value: pendingEditConfirmation
 ? `${pendingEditConfirmation.delta >= 0 ? '+' : '-'}€${Math.abs(pendingEditConfirmation.delta).toFixed(2)}`
 : '—',
 },
 ]}
 warning="Este cambio afectará saldos abiertos, vencimientos o caja según el tipo de registro."
 confirmKeyword="IMPORTE"
 confirmKeywordLabel="Confirmación de importe"
 confirmKeywordPlaceholder="IMPORTE"
 />

 <PartialPaymentModal
 isOpen={isPaymentModalOpen}
 onClose={() => {
 setIsPaymentModalOpen(false);
 setPaymentRecord(null);
 }}
 transaction={paymentRecord}
 onSubmit={handlePaymentSubmit}
 />

 <RecordAuditTrailModal
 isOpen={Boolean(auditRecord)}
 onClose={() => setAuditRecord(null)}
 record={auditRecord}
 logs={auditLogs}
 loading={auditLogsLoading}
 />

 {detailRecord && (() => {
 const r = detailRecord;
 const raw = r.rawRecord || {};
 const familyLabels = { legacy: 'Registro histórico', movement: 'Movimiento bancario', receivable: 'Factura CXC', payable: 'Factura CXP' };
 const statusLabels = { paid: 'Liquidado', pending: 'Pendiente', partial: 'Parcial', overdue: 'Vencido', void: 'Anulado', cancelled: 'Anulado', issued: 'Emitida', settled: 'Liquidada' };
 const payments = raw.payments || r.payments || [];
 const rawNotes = raw.notes || r.notes || [];
 const notes = (Array.isArray(rawNotes) ? rawNotes : []).filter((n) => typeof n === 'object');

 const Field = ({ label, value }) => value ? (
 <div>
 <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">{label}</p>
 <p className="mt-0.5 text-sm text-[var(--color-fg-1)]">{value}</p>
 </div>
 ) : null;

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={() => setDetailRecord(null)}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-xl max-h-[85vh] overflow-hidden animate-scaleIn flex flex-col" onClick={(e) => e.stopPropagation()}>
 <div className="px-6 py-4 border-b border-[var(--color-line)] flex justify-between items-start shrink-0">
 <div className="min-w-0 flex-1">
 <Badge variant={r.type === 'income' ? 'ok' : 'err'}>
 {r.type === 'income' ? 'Ingreso' : 'Egreso'} · {familyLabels[r.recordFamily] || r.recordFamily}
 </Badge>
 <h3 className="mt-2 text-lg font-medium text-[var(--color-fg-1)] break-words">{r.description}</h3>
 </div>
 <button onClick={() => setDetailRecord(null)} className="ml-3 shrink-0 text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors">
 <X size={20} />
 </button>
 </div>

 <div className="overflow-y-auto px-6 py-5 space-y-5">
 <div className="flex items-baseline justify-between">
 <span className={`font-display text-[32px] font-light tabular-nums tracking-tight ${r.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {r.type === 'income' ? '+' : '-'}{formatCurrency(r.amount)}
 </span>
 <Badge variant={
 r.status === 'paid' ? 'ok' :
 r.status === 'void' || r.status === 'cancelled' ? 'neutral' :
 r.status === 'overdue' ? 'err' :
 'warn'
 }>
 {statusLabels[r.status] || r.status}
 </Badge>
 </div>

 {r.status === 'partial' && (
 <div>
 <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-2)]">
 <div className="h-full rounded-full bg-[var(--color-ok)]" style={{ width: `${Number(r.amount) > 0 ? ((Number(r.paidAmount) || 0) / Number(r.amount)) * 100 : 0}%` }} />
 </div>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">Pagado: {formatCurrency(r.paidAmount || 0)} / {formatCurrency(r.amount)}</p>
 </div>
 )}

 <div className="grid grid-cols-2 gap-4 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] p-4">
 <Field label="Fecha" value={r.date} />
 <Field label="Origen" value={r.sourceLabel} />
 <Field label="Proyecto" value={r.project || raw.projectName} />
 <Field label="Centro de costo" value={r.costCenter || raw.costCenterId} />
 <Field label="Categoría" value={r.categoryLabel || r.category} />
 <Field label="Contraparte" value={r.counterpartyName || raw.counterpartyName} />
 <Field label="No. documento" value={r.documentNumber || raw.documentNumber} />
 <Field label="Familia" value={familyLabels[r.recordFamily]} />
 {raw.dueDate && <Field label="Vencimiento" value={raw.dueDate} />}
 {raw.createdBy && <Field label="Creado por" value={raw.createdBy} />}
 {r.lastEditor && <Field label="Última edición" value={r.lastEditor} />}
 {r.year && <Field label="Año fiscal" value={String(r.year)} />}
 </div>

 {payments.length > 0 && (
 <div>
 <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">Pagos registrados ({payments.length})</p>
 <div className="space-y-1.5">
 {payments.map((p, idx) => (
 <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2">
 <div>
 <p className="text-sm text-[var(--color-fg-1)]">{p.method || 'Pago'}</p>
 <p className="text-[11px] text-[var(--color-fg-4)]">{p.date} {p.user ? `· ${p.user}` : ''}</p>
 </div>
 <span className="font-mono text-sm tabular-nums text-[var(--color-ok)]">{formatCurrency(p.amount)}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {notes.length > 0 && (
 <div>
 <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">Notas ({notes.length})</p>
 <div className="space-y-1.5">
 {notes.map((n, idx) => (
 <div key={idx} className={`rounded-lg border px-3 py-2 text-sm ${n.type === 'system' ? 'border-[var(--color-line)] bg-[var(--color-bg-0)] text-[var(--color-fg-4)]' : 'border-[var(--color-line-s)] bg-transparent text-[var(--color-fg-3)]'}`}>
 <p>{n.text}</p>
 <p className="mt-1 text-[10px] text-[var(--color-fg-4)]">{n.timestamp ? new Date(n.timestamp).toLocaleString('es-ES') : ''} {n.user ? `· ${n.user}` : ''}</p>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 <div className="shrink-0 border-t border-[var(--color-line)] px-6 py-3 flex gap-2">
 {r.canEdit && userRole === 'admin' && (
 <button type="button" onClick={() => { setDetailRecord(null); handleEdit(r); }} className="flex-1 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] hover:bg-[var(--color-line)]">Editar</button>
 )}
 {r.canChangeStatus && userRole === 'admin' && (
 <button type="button" onClick={() => { setDetailRecord(null); handleChangeStatus(r); }} className="flex-1 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-warn)] hover:bg-[var(--color-line)]">Cambiar estado</button>
 )}
 <button type="button" onClick={() => setDetailRecord(null)} className="flex-1 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] hover:bg-[var(--color-line)]">Cerrar</button>
 </div>
 </div>
 </div>
 );
 })()}

 {statusChangeRecord && (() => {
 const family = statusChangeRecord.recordFamily;
 const status = statusChangeRecord.status;
 const isMovement = family === 'movement';
 const isReceivable = family === 'receivable';
 const isPayable = family === 'payable';
 const isLegacy = family === 'legacy';
 const _hasLegacyLink = Boolean(statusChangeRecord.rawRecord?.legacyTransactionId);
 const familyLabels = { legacy: 'Registro', movement: 'Mov. bancario', receivable: 'Factura CXC', payable: 'Factura CXP' };
 const statusLabels = { paid: 'Liquidado', pending: 'Pendiente', partial: 'Parcial', overdue: 'Vencido', void: 'Anulado', cancelled: 'Anulado' };

 const showPending = status !== 'pending' && (isLegacy || isMovement);
 const showPaid = status !== 'paid' && (isLegacy || isReceivable || isPayable);
 const showCancel = status !== 'cancelled' && status !== 'void';

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" role="dialog" aria-modal="true" onClick={() => setStatusChangeRecord(null)}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-md overflow-hidden animate-scaleIn" onClick={(e) => e.stopPropagation()}>
 <div className="px-6 py-4 border-b border-[var(--color-line)] flex justify-between items-center">
 <h3 className="font-medium text-lg text-[var(--color-fg-1)]">Cambiar estado</h3>
 <button onClick={() => setStatusChangeRecord(null)} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors">
 <X size={20} />
 </button>
 </div>

 <div className="p-6">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3 mb-5">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{statusChangeRecord.description}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">
 {familyLabels[family]} · {statusLabels[status] || status} · {formatCurrency(statusChangeRecord.amount)}
 </p>
 </div>

 <div className="space-y-2">
 {showPending && (
 <button
 type="button"
 onClick={() => confirmStatusChange('pending')}
 className="flex w-full items-center gap-3 rounded-md border border-[var(--color-line-s)] bg-transparent px-4 py-3 text-left transition-all hover:bg-transparent"
 >
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-transparent">
 <span className="font-mono text-[var(--color-warn)] text-sm">CXC</span>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Revertir a Pendiente</p>
 <p className="text-xs text-[var(--color-fg-3)]">
 {isMovement ? 'Revierte el cobro — vuelve a cuenta por cobrar' : 'Pasa a CXC abierta'}
 </p>
 </div>
 </button>
 )}
 {showPaid && (
 <button
 type="button"
 onClick={() => confirmStatusChange('paid')}
 className="flex w-full items-center gap-3 rounded-md border border-[var(--color-line-s)] bg-transparent px-4 py-3 text-left transition-all hover:bg-transparent"
 >
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-transparent">
 <span className="text-[var(--color-ok)] text-lg">&#10003;</span>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Marcar como Liquidado</p>
 <p className="text-xs text-[var(--color-fg-3)]">Confirma cobro/pago completo</p>
 </div>
 </button>
 )}
 {showCancel && (
 <button
 type="button"
 onClick={() => confirmStatusChange(isMovement ? 'void' : 'cancelled')}
 className="flex w-full items-center gap-3 rounded-md border border-[var(--color-line-s)] bg-transparent px-4 py-3 text-left transition-all hover:bg-transparent"
 >
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-transparent">
 <span className="text-[var(--color-accent)] text-lg">&#10005;</span>
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Anular</p>
 <p className="text-xs text-[var(--color-fg-3)]">Cancela — no afecta caja ni compromisos</p>
 </div>
 </button>
 )}
 </div>

 <button
 type="button"
 onClick={() => setStatusChangeRecord(null)}
 className="mt-5 w-full rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-line)]"
 >
 Cerrar
 </button>
 </div>
 </div>
 </div>
 );
 })()}
 </div>
 );
};

export default TransactionList;
