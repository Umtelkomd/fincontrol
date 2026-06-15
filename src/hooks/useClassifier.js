import { useCallback, useMemo } from 'react';
import {
 arrayUnion,
 collection,
 doc,
 serverTimestamp,
 updateDoc,
 writeBatch,
} from 'firebase/firestore';
import {
 DEFAULT_CURRENCY,
 MAIN_ACCOUNT_ID,
 MOVEMENT_KIND,
 MOVEMENT_STATUS,
} from '../finance/constants';
import {
 buildMovementAllocations,
 getDocumentOpenAmount,
 sumDocumentOpenAmount,
 RECONCILIATION_EPSILON,
} from '../finance/reconciliation';
import { clampMoney, toISODate } from '../finance/utils';
import { scorePayrollMatch } from '../features/nominas/lib/payrollMatch';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';
import { logError } from '../utils/logger';
import { useBankMovements } from './useBankMovements';
import { useReceivables } from './useReceivables';
import { usePayables } from './usePayables';

const COLLECTION_BY_KIND = {
 receivable: 'receivables',
 payable: 'payables',
};

const DIRECTION_BY_KIND = {
 receivable: 'in',
 payable: 'out',
};

const MOVEMENT_KIND_BY_KIND = {
 receivable: MOVEMENT_KIND.COLLECTION,
 payable: MOVEMENT_KIND.PAYMENT,
};

const ENTITY_TYPE_BY_KIND = {
 receivable: 'receivable',
 payable: 'payable',
};

const LABEL_BY_KIND = {
 receivable: 'CXC',
 payable: 'CXP',
};

const getCommonValue = (documents, field) => {
 const values = [...new Set(documents.map((document) => document?.[field]).filter(Boolean))];
 return values.length === 1 ? values[0] : '';
};

const getDocumentLabel = (document) =>
 document?.documentNumber || document?.counterpartyName || document?.description || document?.id;

const normalizeDocuments = (documents) =>
 (Array.isArray(documents) ? documents : [documents]).filter(Boolean);

/**
 * useClassifier — operations to handle the weekly DATEV inbox flow.
 *
 * After a Friday DATEV import, every imported bankMovement is "raw":
 *   - direction in/out + amount + postedDate + counterparty + description
 *   - no categoryName / projectId / costCenterId / receivableId / payableId
 *
 * This hook exposes:
 *   linkToReceivable(movement, receivable)
 *     Marks the receivable settled (or partial) and copies its
 *     classification (projectId/projectName/costCenterId) onto the
 *     bankMovement plus a `receivableId` link.
 *
 *   linkToPayable(movement, payable)
 *     Analogous for payables.
 *
 *   categorize(movement, { categoryName, projectId, projectName, costCenterId, employeeIds })
 *     For "spontaneous" movements that are NOT tied to a CXC/CXP. Just
 *     writes classification fields onto the bankMovement.
 *
 *   suggestMatches(movement)
 *     Pure helper: returns CXC (if direction=in) or CXP (if direction=out)
 *     candidates with exact amount match (±0.01) within ±21 days.
 *     Excludes receivables/payables already settled.
 *
 *   inboxMovements
 *     Memoized list of bankMovements that need action:
 *       - direction=in and !receivableId
 *       - direction=out and !payableId and !categoryName
 */
export const useClassifier = (user) => {
 const { bankMovements } = useBankMovements(user);
 const { receivables } = useReceivables(user);
 const { payables } = usePayables(user);

 const movementsCollectionRef = () => collection(db, 'artifacts', appId, 'public', 'data', 'bankMovements');
 const movementsRef = (id) => doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', id);

 const linkDocumentsToMovement = useCallback(
 async (movement, documents, kind) => {
 if (!user) return { success: false, error: 'No user' };
 const docs = normalizeDocuments(documents);
 if (!movement?.id) return { success: false, error: new Error('Movimiento bancario inválido') };
 if (!docs.length) return { success: false, error: new Error('Seleccioná al menos una orden') };
 if (movement.direction !== DIRECTION_BY_KIND[kind]) {
 return { success: false, error: new Error('La dirección del movimiento no coincide con el tipo de orden') };
 }

 const allocationPlan = buildMovementAllocations(movement.amount, docs);
 if (!allocationPlan.allocations.length) {
 return { success: false, error: new Error('Las órdenes seleccionadas no tienen saldo abierto') };
 }
 if (!allocationPlan.isFullyAllocated) {
 return {
 success: false,
 error: new Error(
 `El movimiento todavía tiene ${allocationPlan.remainingMovementAmount.toFixed(2)} ${movement.currency || DEFAULT_CURRENCY} sin explicar. Seleccioná más órdenes o ajustá la selección.`,
 ),
 };
 }

 try {
 const nowIso = new Date().toISOString();
 const ids = allocationPlan.allocations.map((allocation) => allocation.documentId);
 const batch = writeBatch(db);
 const idField = kind === 'receivable' ? 'receivableId' : 'payableId';
 const idsField = kind === 'receivable' ? 'receivableIds' : 'payableIds';
 const allocationField = kind === 'receivable' ? 'receivableAllocations' : 'payableAllocations';
 const label = LABEL_BY_KIND[kind];
 const reconciliationMode = docs.length > 1 ? 'grouped-datev' : 'datev';
 const commonProjectId = getCommonValue(docs, 'projectId');
 const commonProjectName = getCommonValue(docs, 'projectName');
 const commonCostCenterId = getCommonValue(docs, 'costCenterId');
 const commonCategoryName = getCommonValue(docs, 'categoryName');

 batch.update(movementsRef(movement.id), {
 [idField]: ids[0],
 [idsField]: ids,
 [allocationField]: allocationPlan.allocations.map((allocation) => ({
 documentId: allocation.documentId,
 amount: allocation.amount,
 openAmountBefore: allocation.openAmount,
 openAmountAfter: allocation.nextOpenAmount,
 })),
 reconciledAt: serverTimestamp(),
 reconciliationId: movement.reconciliationId || `movement:${movement.id}`,
 reconciliationMode,
 reconciledAmount: allocationPlan.movementAmount,
 categoryName: commonCategoryName || movement.categoryName || '',
 projectId: commonProjectId || movement.projectId || '',
 projectName: commonProjectName || movement.projectName || (docs.length > 1 ? 'Múltiples proyectos' : ''),
 costCenterId: commonCostCenterId || movement.costCenterId || '',
 updatedBy: user.email,
 updatedAt: serverTimestamp(),
 auditTrail: arrayUnion({
 action: `link-${kind}`,
 user: user.email,
 timestamp: nowIso,
 detail: `Conciliado con ${ids.length} ${label} por ${allocationPlan.movementAmount.toFixed(2)} ${movement.currency || DEFAULT_CURRENCY}`,
 }),
 });

 allocationPlan.allocations.forEach((allocation) => {
 const documentRef = doc(
 db,
 'artifacts',
 appId,
 'public',
 'data',
 COLLECTION_BY_KIND[kind],
 allocation.documentId,
 );
 const nextPaid = clampMoney((Number(allocation.document.paidAmount) || 0) + allocation.amount);
 batch.update(documentRef, {
 openAmount: allocation.nextOpenAmount,
 pendingAmount: allocation.nextOpenAmount,
 paidAmount: nextPaid,
 status: allocation.nextStatus,
 payments: arrayUnion({
 date: movement.postedDate || toISODate(new Date()),
 amount: allocation.amount,
 method: 'Transferencia',
 reference: movement.description || '',
 note: docs.length > 1 ? 'Conciliado en pago agrupado desde DATEV' : 'Conciliado desde DATEV',
 bankMovementId: movement.id,
 reconciliationMode,
 registeredBy: user.email,
 timestamp: nowIso,
 }),
 updatedBy: user.email,
 updatedAt: serverTimestamp(),
 auditTrail: arrayUnion({
 action: 'link-bank-movement',
 user: user.email,
 timestamp: nowIso,
 detail: `Conciliado con bankMovement ${movement.id}`,
 }),
 });
 });

 await batch.commit();

 await Promise.all([
 writeAuditLogEntry({
 action: 'reconcile',
 entityType: 'bankMovement',
 entityId: movement.id,
 description: `Movimiento DATEV conciliado con ${ids.length} ${label}: ${movement.description || movement.id}`,
 userEmail: user.email,
 metadata: {
 documentIds: ids,
 reconciliationMode,
 amount: allocationPlan.movementAmount,
 },
 }),
 ...allocationPlan.allocations.map((allocation) =>
 writeAuditLogEntry({
 action: 'reconcile',
 entityType: ENTITY_TYPE_BY_KIND[kind],
 entityId: allocation.documentId,
 description: `${label} conciliada: ${getDocumentLabel(allocation.document)} ↔ bank ${movement.postedDate}`,
 userEmail: user.email,
 metadata: {
 bankMovementId: movement.id,
 amount: allocation.amount,
 nextStatus: allocation.nextStatus,
 reconciliationMode,
 },
 }),
 ),
 ]);

 return {
 success: true,
 status: allocationPlan.allocations.every((allocation) => allocation.nextStatus === 'settled')
 ? 'settled'
 : 'partial',
 count: allocationPlan.allocations.length,
 };
 } catch (err) {
 logError(`linkDocumentsToMovement ${kind} error:`, err);
 return { success: false, error: err };
 }
 },
 [user],
 );

 const linkToReceivable = useCallback(
 async (movement, receivable) => {
 return linkDocumentsToMovement(movement, [receivable], 'receivable');
 },
 [linkDocumentsToMovement],
 );

 const linkToPayable = useCallback(
 async (movement, payable) => {
 return linkDocumentsToMovement(movement, [payable], 'payable');
 },
 [linkDocumentsToMovement],
 );

 const linkReceivablesToMovement = useCallback(
 (movement, selectedReceivables) => linkDocumentsToMovement(movement, selectedReceivables, 'receivable'),
 [linkDocumentsToMovement],
 );

 const linkPayablesToMovement = useCallback(
 (movement, selectedPayables) => linkDocumentsToMovement(movement, selectedPayables, 'payable'),
 [linkDocumentsToMovement],
 );

 const categorize = useCallback(
 async (movement, classification) => {
 if (!user) return { success: false, error: 'No user' };
 try {
 const categoryName = (classification.categoryName || '').trim();
 const payload = {
 categoryName,
 projectId: classification.projectId || '',
 projectName: classification.projectName || '',
 costCenterId: classification.costCenterId || '',
 employeeIds: Array.isArray(classification.employeeIds) ? classification.employeeIds : [],
 updatedBy: user.email,
 updatedAt: serverTimestamp(),
 auditTrail: arrayUnion({
 action: 'classify',
 user: user.email,
 timestamp: new Date().toISOString(),
 detail: `Categorizado como ${categoryName || 'sin categoría'}`,
 }),
 };
 await updateDoc(movementsRef(movement.id), payload);
 return { success: true };
 } catch (err) {
 logError('categorize error:', err);
 return { success: false, error: err };
 }
 },
 [user],
 );

 // Pure suggestion logic — does not touch Firestore
 const suggestMatches = useCallback(
 (movement) => {
 if (!movement) return [];
 const amount = Math.abs(Number(movement.amount) || 0);
 const targetDate = new Date(movement.postedDate || '');
 if (Number.isNaN(targetDate.getTime())) return [];
 const TOLERANCE_DAYS = 21;
 const TOLERANCE_MS = TOLERANCE_DAYS * 24 * 60 * 60 * 1000;

 const pool = movement.direction === 'in' ? receivables : payables;
 const fieldDate = movement.direction === 'in' ? 'dueDate' : 'dueDate';

 return (pool || [])
 .filter((p) => p.status !== 'settled' && p.status !== 'cancelled' && p.status !== 'void')
 .map((p) => {
 const open = Math.abs(Number(p.openAmount || p.grossAmount || p.amount) || 0);
 const itemDate = new Date(p[fieldDate] || p.issueDate || '');
 const daysDiff = Number.isNaN(itemDate.getTime())
 ? Infinity
 : Math.abs((itemDate - targetDate) / (1000 * 60 * 60 * 24));
 const amountDiff = Math.abs(open - amount);
 // Score: amount match worth 100, date proximity worth up to 30
 let score = 0;
 if (amountDiff < 0.01) score += 100;
 else if (amountDiff < 1) score += 80;
 else if (amountDiff < 10) score += 40;
 else return null;
 if (daysDiff <= TOLERANCE_DAYS) score += Math.max(0, 30 - daysDiff);
 // Phase 2, item 2 — payroll boost: the 6 monthly payroll debits become
 // near-automatic one-click confirms (score >= 130) when the out-movement
 // matches a payrollKind payable within the banking-day due window.
 score += scorePayrollMatch({ movement, payable: p });
 return { item: p, amountDiff, daysDiff, score };
 })
 .filter((m) => m && m.score > 0)
 .sort((a, b) => b.score - a.score)
 .slice(0, 5);
 },
 [receivables, payables],
 );

 // Inbox: movements that need action
 const inboxMovements = useMemo(() => {
 return (bankMovements || []).filter((m) => {
 if (m.status === 'void') return false;
 if (m.direction === 'in') {
 // Income needs link to a CXC
 return !m.receivableId;
 }
 // Outflow: needs CXP link OR explicit categorization
 const hasLink = !!m.payableId;
 const hasCategory = !!(m.categoryName || m.costCenterId);
 return !hasLink && !hasCategory;
 });
 }, [bankMovements]);

 return {
 inboxMovements,
 bankMovements,
 receivables,
 payables,
 linkToReceivable,
 linkToPayable,
 linkReceivablesToMovement,
 linkPayablesToMovement,
 categorize,
 suggestMatches,
 };
};

export default useClassifier;
