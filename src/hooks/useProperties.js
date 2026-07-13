import { logError } from '../utils/logger';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';
import { normalizeAssignment } from '../finance/opsControl';

const PROPERTIES_COLLECTION = 'properties';

/**
 * useProperties — CRUD hook for the properties collection.
 *
 * Path: artifacts/{appId}/public/data/properties
 *
 * Property model: see src/finance/assetSchemas.js (propertyDefaults)
 * Recurring costs (rent, utilities, taxes) live in `recurringCosts` with
 * ownerType='property'.
 */
export const useProperties = (user) => {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const propertiesRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', PROPERTIES_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(propertiesRef, orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          const num = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          };
          return {
            id: d.id,
            name: raw.name || '',
            address: raw.address || '',
            city: raw.city || '',
            postalCode: raw.postalCode || '',
            type: raw.type || 'rented',
            use: raw.use || 'housing',
            m2: num(raw.m2),
            bedrooms: num(raw.bedrooms),
            status: raw.status || 'active',
            startDate: raw.startDate || '',
            endDate: raw.endDate || '',
            landlordOrOwner: raw.landlordOrOwner || '',
            defaultCostCenter: raw.defaultCostCenter || '',
            projectIds: Array.isArray(raw.projectIds) ? raw.projectIds : [],
            currentAssignment: normalizeAssignment(raw.currentAssignment || {}),
            notes: raw.notes || '',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
            createdBy: raw.createdBy || '',
          };
        });
        setProperties(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading properties:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [propertiesRef, user]);

  const getActiveProperties = useCallback(
    () => properties.filter((p) => p.status === 'active'),
    [properties],
  );

  const normalizePayload = (data) => {
    const allowedTypes = ['rented', 'owned', 'mixed'];
    const allowedUses = ['housing', 'office', 'storage', 'mixed'];
    const allowedStatuses = ['active', 'inactive'];
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      name: (data.name || '').trim(),
      address: (data.address || '').trim(),
      city: (data.city || '').trim(),
      postalCode: (data.postalCode || '').trim(),
      type: allowedTypes.includes(data.type) ? data.type : 'rented',
      use: allowedUses.includes(data.use) ? data.use : 'housing',
      m2: num(data.m2),
      bedrooms: num(data.bedrooms),
      status: allowedStatuses.includes(data.status) ? data.status : 'active',
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      landlordOrOwner: (data.landlordOrOwner || '').trim(),
      defaultCostCenter: (data.defaultCostCenter || '').trim(),
      currentAssignment: normalizeAssignment(data.currentAssignment || {}),
      projectIds: (() => {
        const ids = Array.isArray(data.projectIds) ? data.projectIds.filter(Boolean) : [];
        const assigned = normalizeAssignment(data.currentAssignment || {}).projectId;
        if (assigned && !ids.includes(assigned)) ids.push(assigned);
        return ids;
      })(),
      notes: (data.notes || '').trim(),
    };
  };

  const createProperty = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const payload = {
        ...normalizePayload(data),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.email || '',
      };
      const docRef = await addDoc(propertiesRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'property',
        entityId: docRef.id,
        description: `Vivienda creada: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: docRef.id },
      });
      return { success: true, id: docRef.id };
    } catch (err) {
      logError('Error creating property:', err);
      return { success: false, error: err };
    }
  };

  const updateProperty = async (propertyId, data) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const ref = doc(db, 'artifacts', appId, 'public', 'data', PROPERTIES_COLLECTION, propertyId);
      const payload = { ...normalizePayload(data), updatedAt: serverTimestamp() };
      await updateDoc(ref, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'property',
        entityId: propertyId,
        description: `Vivienda actualizada: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: propertyId },
      });
      return { success: true };
    } catch (err) {
      logError('Error updating property:', err);
      return { success: false, error: err };
    }
  };

  const deleteProperty = async (propertyId) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const ref = doc(db, 'artifacts', appId, 'public', 'data', PROPERTIES_COLLECTION, propertyId);
      const before = properties.find((p) => p.id === propertyId);
      await deleteDoc(ref);
      await writeAuditLogEntry({
        action: 'delete',
        entityType: 'property',
        entityId: propertyId,
        description: `Vivienda eliminada: ${before?.name || propertyId}`,
        userEmail: user.email,
        before,
      });
      return { success: true };
    } catch (err) {
      logError('Error deleting property:', err);
      return { success: false, error: err };
    }
  };

  return {
    properties,
    loading,
    error,
    getActiveProperties,
    createProperty,
    updateProperty,
    deleteProperty,
  };
};

export default useProperties;
