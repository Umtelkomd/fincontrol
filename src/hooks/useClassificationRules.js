import { logError } from '../utils/logger';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';
import {
  normalizeRuleApplyTo,
  RULE_DIRECTIONS,
  RULE_FIELDS,
  RULE_MATCH_TYPES,
} from '../finance/assetSchemas';
import { buildClassificationPayload, findBestRule, matchRule } from '../finance/ruleEngine';

const RULES_COLLECTION = 'classificationRules';
const MOVEMENTS_COLLECTION = 'bankMovements';

/**
 * useClassificationRules — CRUD for auto-classification rules + apply helpers.
 *
 * Path: artifacts/{appId}/public/data/classificationRules
 *
 * The engine itself lives in finance/ruleEngine.js (pure). This hook is the
 * Firestore-aware layer: list/create/update/delete + applyRuleToMovement +
 * bumpHits + bulk-apply over a list of movements.
 */
export const useClassificationRules = (user) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const ref = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', RULES_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;
    const q = query(ref, orderBy('priority', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          const num = (v, fallback = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
          };
          return {
            id: d.id,
            name: raw.name || '',
            field: RULE_FIELDS.includes(raw.field) ? raw.field : 'counterpartyName',
            matchType: RULE_MATCH_TYPES.includes(raw.matchType) ? raw.matchType : 'contains',
            pattern: raw.pattern || '',
            direction: RULE_DIRECTIONS.includes(raw.direction) ? raw.direction : 'both',
            amountMin: raw.amountMin == null ? null : num(raw.amountMin, null),
            amountMax: raw.amountMax == null ? null : num(raw.amountMax, null),
            applyTo: normalizeRuleApplyTo(raw.applyTo),
            active: raw.active !== false,
            priority: num(raw.priority, 100),
            hits: num(raw.hits, 0),
            lastHitAt: raw.lastHitAt || '',
            notes: raw.notes || '',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
            createdBy: raw.createdBy || '',
          };
        });
        setRules(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading classificationRules:', err);
        setError(err);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [ref, user]);

  const normalizePayload = (data) => {
    const num = (v, fallback = null) => {
      if (v === '' || v == null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      name: (data.name || '').trim(),
      field: RULE_FIELDS.includes(data.field) ? data.field : 'counterpartyName',
      matchType: RULE_MATCH_TYPES.includes(data.matchType) ? data.matchType : 'contains',
      pattern: (data.pattern || '').trim(),
      direction: RULE_DIRECTIONS.includes(data.direction) ? data.direction : 'both',
      amountMin: num(data.amountMin, null),
      amountMax: num(data.amountMax, null),
      // Read and write go through the same normalizer, so a field can never be
      // persisted on one side of the round-trip and dropped on the other.
      applyTo: normalizeRuleApplyTo(data.applyTo),
      active: data.active !== false,
      priority: Math.max(0, Math.floor(num(data.priority, 100) || 100)),
      notes: (data.notes || '').trim(),
    };
  };

  const createRule = useCallback(
    async (data) => {
      if (!user) return { success: false, error: new Error('No user') };
      if (!data.pattern) return { success: false, error: new Error('Patrón requerido') };
      try {
        const payload = {
          ...normalizePayload(data),
          hits: 0,
          lastHitAt: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.email || '',
        };
        const docRef = await addDoc(ref, payload);
        await writeAuditLogEntry({
          action: 'create',
          entityType: 'classificationRule',
          entityId: docRef.id,
          description: `Regla creada: ${payload.name || payload.pattern}`,
          userEmail: user.email,
          after: { ...payload, id: docRef.id },
        });
        return { success: true, id: docRef.id };
      } catch (err) {
        logError('Error creating classificationRule:', err);
        return { success: false, error: err };
      }
    },
    [user, ref],
  );

  const updateRule = useCallback(
    async (id, data) => {
      if (!user) return { success: false, error: new Error('No user') };
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', RULES_COLLECTION, id);
        const payload = { ...normalizePayload(data), updatedAt: serverTimestamp() };
        await updateDoc(docRef, payload);
        await writeAuditLogEntry({
          action: 'update',
          entityType: 'classificationRule',
          entityId: id,
          description: `Regla actualizada: ${payload.name || payload.pattern}`,
          userEmail: user.email,
          after: { ...payload, id },
        });
        return { success: true };
      } catch (err) {
        logError('Error updating classificationRule:', err);
        return { success: false, error: err };
      }
    },
    [user],
  );

  const deleteRule = useCallback(
    async (id) => {
      if (!user) return { success: false, error: new Error('No user') };
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', RULES_COLLECTION, id);
        const before = rules.find((r) => r.id === id);
        await deleteDoc(docRef);
        await writeAuditLogEntry({
          action: 'delete',
          entityType: 'classificationRule',
          entityId: id,
          description: `Regla eliminada: ${before?.name || before?.pattern || id}`,
          userEmail: user.email,
          before,
        });
        return { success: true };
      } catch (err) {
        logError('Error deleting classificationRule:', err);
        return { success: false, error: err };
      }
    },
    [user, rules],
  );

  const toggleActive = useCallback(
    async (rule) => updateRule(rule.id, { ...rule, active: !rule.active }),
    [updateRule],
  );

  /**
   * applyRuleToMovement — write the rule's classification onto a single movement
   * and bump the rule's hits counter. Skips fields that the movement already has.
   */
  const applyRuleToMovement = useCallback(
    async (movement, rule, opts = {}) => {
      if (!user) return { success: false, error: 'No user' };
      const patch = buildClassificationPayload(rule, movement);
      if (Object.keys(patch).length === 0) {
        return { success: true, applied: false, reason: 'no-fields-to-set' };
      }
      try {
        const movementRef = doc(db, 'artifacts', appId, 'public', 'data', MOVEMENTS_COLLECTION, movement.id);
        await updateDoc(movementRef, {
          ...patch,
          updatedBy: user.email,
          updatedAt: serverTimestamp(),
          auditTrail: arrayUnion({
            action: 'auto-classify',
            user: user.email,
            timestamp: new Date().toISOString(),
            detail: `Auto-clasificado por regla "${rule.name || rule.pattern}"`,
          }),
        });
        if (!opts.skipHits) {
          const ruleRef = doc(db, 'artifacts', appId, 'public', 'data', RULES_COLLECTION, rule.id);
          await updateDoc(ruleRef, {
            hits: increment(1),
            lastHitAt: new Date().toISOString(),
          });
        }
        return { success: true, applied: true, fields: Object.keys(patch) };
      } catch (err) {
        logError('applyRuleToMovement error:', err);
        return { success: false, error: err };
      }
    },
    [user],
  );

  /**
   * applyRulesToMovements — bulk-apply over an iterable. Returns counts.
   * The same rule gets one hits++ per movement.
   */
  const applyRulesToMovements = useCallback(
    async (movements, opts = {}) => {
      const list = Array.isArray(movements) ? movements : [];
      let applied = 0;
      let skipped = 0;
      const errors = [];
      for (const m of list) {
        const r = findBestRule(m, rules);
        if (!r) {
          skipped += 1;
          continue;
        }
        const out = await applyRuleToMovement(m, r, opts);
        if (out.success && out.applied) applied += 1;
        else if (!out.success) errors.push({ movementId: m.id, error: out.error });
        else skipped += 1;
      }
      return { applied, skipped, errors };
    },
    [rules, applyRuleToMovement],
  );

  /**
   * countMatchingPending — utility for the alerts dashboard:
   * how many currently-unclassified movements would be hit by this rule?
   */
  const countMatchingPending = useCallback(
    (rule, pendingMovements) =>
      (pendingMovements || []).filter((m) => matchRule(m, rule)).length,
    [],
  );

  return {
    rules,
    loading,
    error,
    createRule,
    updateRule,
    deleteRule,
    toggleActive,
    applyRuleToMovement,
    applyRulesToMovements,
    countMatchingPending,
  };
};

export default useClassificationRules;
