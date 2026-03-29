import React, { useMemo, useState } from 'react';
import {
  CheckCircle,
  Download,
  Eye,
  Filter,
  Landmark,
  MessageSquare,
  ReceiptText,
  RotateCcw,
  Search,
  Sparkles,
  WalletCards,
  X,
} from 'lucide-react';
import TransactionRow from '../../components/ui/TransactionRow';
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

const FILTER_DEFAULTS = {
  dateFrom: '',
  dateTo: '',
  project: '',
  category: '',
  costCenter: '',
  type: '',
  status: '',
  origin: '',
  family: '',
  minAmount: '',
  maxAmount: '',
  notesMode: 'all',
};

const TYPE_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'income', label: 'Entradas' },
  { value: 'expense', label: 'Salidas' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'partial', label: 'Parcial' },
  { value: 'overdue', label: 'Vencido' },
  { value: 'paid', label: 'Liquidado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'void', label: 'Anulado' },
];

const ORIGIN_OPTIONS = [
  { value: '', label: 'Todos los orígenes' },
  { value: 'legacy', label: 'Histórico' },
  { value: 'canonical', label: 'Operación actual' },
  { value: 'migrated', label: 'Integrado' },
];

const FAMILY_OPTIONS = [
  { value: '', label: 'Todas las familias' },
  { value: 'legacy', label: 'Registro histórico' },
  { value: 'movement', label: 'Movimiento bancario' },
  { value: 'receivable', label: 'Factura CXC' },
  { value: 'payable', label: 'Factura CXP' },
];

const safeString = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const formatCount = (value) => new Intl.NumberFormat('es-ES').format(value || 0);

const getCreatedDate = (record) => {
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
    canEdit: !entry.legacyTransactionId && entry.status !== 'void',
    canDelete: false,
    canViewNotes: false,
    canRegisterPayment: false,
    canVoid: !entry.legacyTransactionId && entry.status !== 'void',
    voidActionLabel: 'Anular',
    notes: [],
    secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Movimiento confirmado',
    traceMeta: entry.updatedBy || entry.createdBy || '',
    lastEditor: entry.updatedBy || entry.createdBy || '',
    lastEditedAt: entry.updatedAt || entry.createdAt || null,
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
    canEdit: !entry.legacyTransactionId && entry.status !== 'cancelled',
    canDelete: false,
    canViewNotes: false,
    canRegisterPayment: ['pending', 'partial', 'overdue'].includes(normalizeDocumentStatus(entry.status)),
    canVoid: !entry.legacyTransactionId && !entry.paidAmount && entry.status !== 'cancelled' && entry.status !== 'settled',
    voidActionLabel: 'Cancelar',
    paymentActionLabel: 'Cobro',
    notes: [],
    secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Pendiente de cobro',
    traceMeta: entry.updatedBy || entry.createdBy || '',
    lastEditor: entry.updatedBy || entry.createdBy || '',
    lastEditedAt: entry.updatedAt || entry.createdAt || null,
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
    canEdit: !entry.legacyTransactionId && entry.status !== 'cancelled',
    canDelete: false,
    canViewNotes: false,
    canRegisterPayment: ['pending', 'partial', 'overdue'].includes(normalizeDocumentStatus(entry.status)),
    canVoid: !entry.legacyTransactionId && !entry.paidAmount && entry.status !== 'cancelled' && entry.status !== 'settled',
    voidActionLabel: 'Cancelar',
    paymentActionLabel: 'Pago',
    notes: [],
    secondaryMeta: entry.documentNumber || entry.counterpartyName || 'Pendiente de pago',
    traceMeta: entry.updatedBy || entry.createdBy || '',
    lastEditor: entry.updatedBy || entry.createdBy || '',
    lastEditedAt: entry.updatedAt || entry.createdAt || null,
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

const MetricCard = ({ label, value, icon, tone = 'neutral', onClick }) => {
  const Icon = icon;
  const palette =
    tone === 'positive'
      ? {
          value: 'text-[#0f8f4b]',
          icon: 'text-[#0f8f4b]',
          card: 'bg-[linear-gradient(180deg,rgba(240,250,244,0.96),rgba(231,247,236,0.92))]',
        }
      : tone === 'negative'
        ? {
            value: 'text-[#d46a13]',
            icon: 'text-[#d46a13]',
            card: 'bg-[linear-gradient(180deg,rgba(255,248,234,0.96),rgba(255,241,220,0.92))]',
          }
        : {
            value: 'text-[#3156d3]',
            icon: 'text-[#3156d3]',
            card: 'bg-[linear-gradient(180deg,rgba(241,246,255,0.96),rgba(233,240,254,0.92))]',
          };

  return (
    <div
      className={`rounded-[22px] border border-[rgba(201,214,238,0.72)] px-4 py-3 shadow-[0_12px_28px_rgba(124,148,191,0.08)] ${palette.card} ${onClick ? 'cursor-pointer hover:scale-[1.02] transition-transform duration-200' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6980ac]">{label}</p>
          <p className={`mt-2 text-[22px] font-semibold tracking-tight ${palette.value}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[15px] border border-white/70 bg-white/78 ${palette.icon}`}>
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
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

  const {
    createTransaction,
    updateTransaction,
    deleteTransaction,
    addNote,
    markAsRead,
    registerPayment: registerLegacyPayment,
  } = useTransactionActions(user);
  const { logs: auditLogs, loading: auditLogsLoading } = useAuditLog(user);
  const { expenseCategories, incomeCategories } = useCategories(user);
  const { costCenters } = useCostCenters(user);
  const { projects } = useProjects(user);
  const { bankMovements, loading: bankMovementsLoading, updateBankMovement, voidBankMovement } = useBankMovements(user);
  const {
    receivables,
    loading: receivablesLoading,
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
      const createdAt = getCreatedDate(entry);
      if (createdAt && createdAt >= sevenDaysAgo) nuevas += 1;
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
  }, [unifiedRecords, sevenDaysAgo]);

  const metrics = useMemo(() => {
    return {
      total: unifiedRecords.length,
      legacy: unifiedRecords.filter((entry) => entry.recordFamily === 'legacy').length,
      movements: unifiedRecords.filter((entry) => entry.recordFamily === 'movement').length,
      openDocs: unifiedRecords.filter((entry) => ['receivable', 'payable'].includes(entry.recordFamily) && ['pending', 'partial', 'overdue'].includes(entry.status)).length,
    };
  }, [unifiedRecords]);

  // Detect possible duplicates: same amount + same type + date within 3 days + similar description
  // Returns both a Set of IDs and grouped pairs for the duplicate review panel
  const { duplicateIds, duplicateGroups } = useMemo(() => {
    const dupeSet = new Set();
    const groups = [];
    const records = unifiedRecords;
    const paired = new Set();

    for (let i = 0; i < records.length; i++) {
      if (paired.has(records[i].id)) continue;
      const matches = [];
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];
        if (a.type !== b.type || Math.abs(a.amount - b.amount) > 0.01) continue;
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
        const createdAt = getCreatedDate(entry);
        if (!createdAt || createdAt < sevenDaysAgo) return false;
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

      if (minAmount != null && Number(entry.amount) < minAmount) {
        return false;
      }

      if (maxAmount != null && Number(entry.amount) > maxAmount) {
        return false;
      }

      if (advancedFilters.notesMode === 'with-notes' && !entry.notes?.some((note) => note.type === 'comment')) {
        return false;
      }

      if (advancedFilters.notesMode === 'without-notes' && entry.notes?.some((note) => note.type === 'comment')) {
        return false;
      }

      return true;
    });
  }, [advancedFilters, quickFilter, searchTerm, sevenDaysAgo, unifiedRecords]);

  const activeFiltersCount = useMemo(() => {
    return Object.entries(advancedFilters).filter(([, value]) => value !== '' && value !== 'all').length;
  }, [advancedFilters]);

  const resolveProjectName = (projectId) => {
    const match = projects.find((project) => project.id === projectId);
    return match?.name || match?.displayName || match?.code || '';
  };

  const handleDelete = (record) => {
    if (userRole !== 'admin') return;
    if (record.recordFamily !== 'legacy') return;
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
          className={`fixed right-6 top-6 z-[100] flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium shadow-[0_18px_42px_rgba(100,120,160,0.18)] backdrop-blur-xl animate-fadeIn ${
            toast.type === 'success'
              ? 'border-[rgba(32,172,98,0.18)] bg-[rgba(242,251,246,0.92)] text-[#0f8f4b]'
              : 'border-[rgba(220,95,84,0.18)] bg-[rgba(255,244,243,0.94)] text-[#cc4b3f]'
          }`}
        >
          <CheckCircle size={15} />
          {toast.message}
        </div>
      )}

      <section className="rounded-[32px] border border-[rgba(205,219,243,0.82)] bg-[radial-gradient(circle_at_top_right,rgba(185,248,238,0.45),transparent_26%),radial-gradient(circle_at_top_left,rgba(147,196,255,0.38),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.88),rgba(244,248,255,0.84))] p-5 shadow-[0_28px_80px_rgba(126,147,190,0.14)] backdrop-blur-2xl md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#5a8ddd]">Control operativo</p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-[#101938] md:text-[32px]">Mesa central de registros financieros</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#5f7091]">
              Revisa en una sola vista movimientos bancarios, facturas por cobrar, facturas por pagar y registros históricos sin duplicados.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:min-w-[520px]">
            <MetricCard label="Registros" value={formatCount(metrics.total)} icon={Landmark} onClick={() => { setQuickFilter('all'); setAdvancedFilters(FILTER_DEFAULTS); setSearchTerm(''); }} />
            <MetricCard label="Histórico" value={formatCount(metrics.legacy)} icon={ReceiptText} onClick={() => { setQuickFilter('all'); setAdvancedFilters(prev => prev.family === 'legacy' ? FILTER_DEFAULTS : { ...FILTER_DEFAULTS, family: 'legacy' }); }} />
            <MetricCard label="Movimientos" value={formatCount(metrics.movements)} icon={WalletCards} onClick={() => { setQuickFilter('all'); setAdvancedFilters(prev => prev.family === 'movement' ? FILTER_DEFAULTS : { ...FILTER_DEFAULTS, family: 'movement' }); }} />
            <MetricCard label="Documentos abiertos" value={formatCount(metrics.openDocs)} icon={Filter} tone="negative" onClick={() => { setAdvancedFilters(FILTER_DEFAULTS); setQuickFilter(prev => prev === 'pendientes' ? 'all' : 'pendientes'); }} />
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-[rgba(205,219,243,0.78)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,250,255,0.78))] p-4 shadow-[0_22px_60px_rgba(126,147,190,0.12)] backdrop-blur-2xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7390c7]" size={16} />
            <input
              type="text"
              placeholder="Buscar por descripcion, proyecto, documento, contraparte o comentarios..."
              className="w-full rounded-[20px] border border-[rgba(201,214,238,0.86)] bg-white/80 py-2.5 pl-10 pr-10 text-[13px] text-[#16223f] outline-none transition-all placeholder:text-[#7d8dac] focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7d8dac] transition-colors hover:text-[#101938]"
                aria-label="Limpiar busqueda"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-[16px] border px-4 py-2.5 text-[13px] font-medium transition-all ${
                showFilters || activeFiltersCount > 0
                  ? 'border-[rgba(90,141,221,0.34)] bg-[rgba(90,141,221,0.12)] text-[#3156d3] shadow-[0_10px_24px_rgba(90,141,221,0.12)]'
                  : 'border-[rgba(201,214,238,0.82)] bg-white/72 text-[#32415f] hover:bg-white'
              }`}
            >
              <Filter size={15} />
              Filtros avanzados
              {activeFiltersCount > 0 && (
                <span className="rounded-full bg-[rgba(90,141,221,0.12)] px-2 py-0.5 text-[11px] text-[#3156d3]">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {userRole === 'admin' && (
              <button
                type="button"
                onClick={() => exportTransactionsToPDF(exportRows, 'Registros Unificados')}
                className="inline-flex items-center gap-2 rounded-[16px] border border-[rgba(201,214,238,0.82)] bg-white/72 px-4 py-2.5 text-[13px] font-medium text-[#16223f] transition-colors hover:bg-white"
              >
                <Download size={15} />
                Exportar PDF
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {quickFilterButtons.map(({ key, label, count, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setQuickFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
                quickFilter === key
                  ? 'border border-[rgba(90,141,221,0.22)] bg-[rgba(90,141,221,0.12)] text-[#3156d3]'
                  : 'border border-[rgba(201,214,238,0.72)] bg-white/62 text-[#62718f] hover:bg-white hover:text-[#16223f]'
              }`}
            >
              {Icon && <Icon size={13} />}
              {label}
              <span className="rounded-full bg-[rgba(255,255,255,0.72)] px-1.5 py-0.5 text-[10px] text-inherit">
                {count}
              </span>
            </button>
          ))}
        </div>

        {showFilters && (
          <div className="mt-4 rounded-[24px] border border-[rgba(205,219,243,0.72)] bg-[linear-gradient(180deg,rgba(250,252,255,0.94),rgba(244,248,255,0.9))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] animate-fadeIn">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-[14px] font-semibold text-[#101938]">Filtros de revision</h3>
                <p className="mt-1 text-[12px] text-[#6b7a96]">Recorta por origen, tipo de registro, importe, estado y dimensión operativa.</p>
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-2 text-[12px] font-medium text-[#3156d3] transition-colors hover:text-[#101938]"
              >
                <RotateCcw size={13} />
                Limpiar todo
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Desde</span>
                <input
                  type="date"
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.dateFrom}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Hasta</span>
                <input
                  type="date"
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.dateTo}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, dateTo: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Proyecto</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.project}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, project: event.target.value }))}
                >
                  <option value="">Todos los proyectos</option>
                  {filterOptions.projects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Categoría</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.category}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, category: event.target.value }))}
                >
                  <option value="">Todas las categorias</option>
                  {filterOptions.categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Centro de costo</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.costCenter}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, costCenter: event.target.value }))}
                >
                  <option value="">Todos los centros</option>
                  {filterOptions.centers.map((center) => (
                    <option key={center} value={center}>
                      {center}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Tipo</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.type}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, type: event.target.value }))}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Estado</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.status}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, status: event.target.value }))}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Origen</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.origin}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, origin: event.target.value }))}
                >
                  {ORIGIN_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Tipo de registro</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.family}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, family: event.target.value }))}
                >
                  {FAMILY_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Importe mínimo</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.minAmount}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, minAmount: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Importe máximo</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.maxAmount}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, maxAmount: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Comentarios</span>
                <select
                  className="w-full rounded-[14px] border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-[13px] text-[#16223f] outline-none transition-all focus:border-[rgba(90,141,221,0.56)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(90,141,221,0.12)]"
                  value={advancedFilters.notesMode}
                  onChange={(event) => setAdvancedFilters((current) => ({ ...current, notesMode: event.target.value }))}
                >
                  <option value="all">Todos</option>
                  <option value="with-notes">Con comentarios</option>
                  <option value="without-notes">Sin comentarios</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] text-[#6b7a96]">
          Mostrando <span className="font-semibold text-[#16223f]">{formatCount(filteredRecords.length)}</span> registros
          {filteredRecords.length !== unifiedRecords.length && (
            <span className="text-[#8da0c2]"> de {formatCount(unifiedRecords.length)}</span>
          )}
        </p>
        {(activeFiltersCount > 0 || quickFilter !== 'all' || searchTerm) && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-[12px] font-medium text-[#3156d3] transition-colors hover:text-[#101938]"
          >
            Limpiar selección
          </button>
        )}
      </div>

      {/* Duplicate review panel */}
      {quickFilter === 'duplicados' && duplicateGroups.length > 0 && (
        <section className="space-y-4 rounded-[28px] border border-[rgba(208,76,54,0.18)] bg-[rgba(255,248,246,0.94)] p-5 shadow-[0_20px_65px_rgba(134,153,186,0.12)]">
          <div className="flex items-center gap-2">
            <RotateCcw size={18} className="text-[#d04c36]" />
            <h3 className="text-[15px] font-semibold text-[#101938]">
              {duplicateGroups.length} grupo{duplicateGroups.length !== 1 ? 's' : ''} de posibles duplicados
            </h3>
          </div>
          <p className="text-[12px] text-[#6b7a96]">
            Revisa cada grupo. Elige cuál registro conservar y elimina el duplicado.
          </p>
          {duplicateGroups.map((group, gIdx) => (
            <div key={gIdx} className="rounded-2xl border border-[rgba(201,214,238,0.74)] bg-white/90 p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d04c36]">
                Grupo {gIdx + 1} — €{group.original.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} · {group.original.type === 'income' ? 'Ingreso' : 'Gasto'}
              </p>
              <div className="space-y-2">
                {[group.original, ...group.duplicates].map((record) => (
                  <div key={record.id} className="flex items-center gap-3 rounded-xl border border-[rgba(201,214,238,0.6)] bg-[rgba(247,250,255,0.9)] px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#101938]">{safeString(record.description)}</p>
                      <p className="mt-0.5 text-[11px] text-[#6b7a96]">
                        {record.date} · {record.project || 'Sin proyecto'} · {record.recordFamilyLabel || record.recordFamily}
                        {record.lastEditor ? ` · ${record.lastEditor}` : ''}
                      </p>
                    </div>
                    <span className={`flex-shrink-0 text-[13px] font-bold ${record.type === 'income' ? 'text-[#0f8f4b]' : 'text-[#d04c36]'}`}>
                      €{record.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="flex-shrink-0 rounded-full border border-[rgba(201,214,238,0.6)] bg-white px-2 py-0.5 text-[10px] text-[#6b7a96]">
                      {record.statusLabel || record.status}
                    </span>
                    <button
                      onClick={() => handleDelete(record)}
                      className="flex-shrink-0 rounded-xl bg-[#d04c36] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#b8412f]"
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="overflow-hidden rounded-[28px] border border-[rgba(205,219,243,0.78)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,250,255,0.8))] shadow-[0_24px_64px_rgba(126,147,190,0.12)] backdrop-blur-2xl">
        <div className="border-b border-[rgba(201,214,238,0.72)] px-4 py-3 text-[12px] text-[#6b7a96]">
          {loadingLedger
            ? 'Sincronizando registros...'
            : userRole === 'admin'
              ? 'Vista unificada: los registros actuales se mantienen desde aquí y el histórico integrado queda protegido.'
              : 'Mesa unificada de registros financieros.'}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead className="border-b border-[rgba(201,214,238,0.72)] bg-[rgba(244,248,255,0.88)]">
              <tr>
                <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Fecha</th>
                <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Registro</th>
                <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Proyecto</th>
                <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Categoría</th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Monto</th>
                <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Estado</th>
                <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(201,214,238,0.58)]">
              {filteredRecords.map((record) => (
                <TransactionRow
                  key={record.id}
                  t={record}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onViewNotes={handleViewNotes}
                  onViewAuditTrail={handleViewAuditTrail}
                  onRegisterPayment={handleRegisterPayment}
                  onVoid={handleVoid}
                  userRole={userRole}
                  searchTerm={searchTerm}
                />
              ))}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-16 text-center">
                    <div className="mx-auto max-w-md">
                      <p className="text-[14px] font-semibold text-[#101938]">No se encontraron registros</p>
                      <p className="mt-2 text-[13px] leading-6 text-[#6b7a96]">
                        Ajusta la búsqueda o limpia los filtros para volver a la vista completa de registros.
                      </p>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-4 inline-flex items-center gap-2 rounded-[16px] border border-[rgba(201,214,238,0.82)] bg-white/80 px-4 py-2.5 text-[13px] font-medium text-[#3156d3] transition-colors hover:bg-white hover:text-[#101938]"
                      >
                        <RotateCcw size={14} />
                        Limpiar filtros
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
    </div>
  );
};

export default TransactionList;
