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

const VEHICLES_COLLECTION = 'vehicles';

/**
 * useVehicles — CRUD hook for the vehicles collection.
 *
 * Path: artifacts/{appId}/public/data/vehicles
 *
 * Vehicle model: see src/finance/assetSchemas.js (vehicleDefaults)
 * Recurring costs (leasing, insurance, fuel budget) live in `recurringCosts`
 * with ownerType='vehicle'.
 */
export const useVehicles = (user) => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const vehiclesRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', VEHICLES_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(vehiclesRef, orderBy('name', 'asc'));
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
            model: raw.model || '',
            plate: raw.plate || '',
            type: raw.type || 'owned',
            status: raw.status || 'active',
            initialKm: num(raw.initialKm),
            currentKm: num(raw.currentKm),
            leaseStart: raw.leaseStart || '',
            leaseEnd: raw.leaseEnd || '',
            assignedDriver: raw.assignedDriver || '',
            fuelBudgetMonthly: num(raw.fuelBudgetMonthly),
            defaultCostCenter: raw.defaultCostCenter || '',
            projectIds: Array.isArray(raw.projectIds) ? raw.projectIds : [],
            currentAssignment: normalizeAssignment(raw.currentAssignment || {}),
            notes: raw.notes || '',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
            createdBy: raw.createdBy || '',
          };
        });
        setVehicles(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading vehicles:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [vehiclesRef, user]);

  const getActiveVehicles = useCallback(
    () => vehicles.filter((v) => v.status === 'active'),
    [vehicles],
  );

  const normalizePayload = (data) => {
    const allowedTypes = ['owned', 'leased', 'rented'];
    const allowedStatuses = ['active', 'maintenance', 'inactive'];
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      name: (data.name || '').trim(),
      model: (data.model || '').trim(),
      plate: (data.plate || '').trim().toUpperCase(),
      type: allowedTypes.includes(data.type) ? data.type : 'owned',
      status: allowedStatuses.includes(data.status) ? data.status : 'active',
      initialKm: num(data.initialKm),
      currentKm: num(data.currentKm),
      leaseStart: data.leaseStart || '',
      leaseEnd: data.leaseEnd || '',
      assignedDriver: (data.assignedDriver || '').trim(),
      fuelBudgetMonthly: num(data.fuelBudgetMonthly),
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

  const createVehicle = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const payload = {
        ...normalizePayload(data),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.email || '',
      };
      const docRef = await addDoc(vehiclesRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'vehicle',
        entityId: docRef.id,
        description: `Vehículo creado: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: docRef.id },
      });
      return { success: true, id: docRef.id };
    } catch (err) {
      logError('Error creating vehicle:', err);
      return { success: false, error: err };
    }
  };

  const updateVehicle = async (vehicleId, data) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const ref = doc(db, 'artifacts', appId, 'public', 'data', VEHICLES_COLLECTION, vehicleId);
      const payload = { ...normalizePayload(data), updatedAt: serverTimestamp() };
      await updateDoc(ref, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'vehicle',
        entityId: vehicleId,
        description: `Vehículo actualizado: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: vehicleId },
      });
      return { success: true };
    } catch (err) {
      logError('Error updating vehicle:', err);
      return { success: false, error: err };
    }
  };

  const deleteVehicle = async (vehicleId) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const ref = doc(db, 'artifacts', appId, 'public', 'data', VEHICLES_COLLECTION, vehicleId);
      const before = vehicles.find((v) => v.id === vehicleId);
      await deleteDoc(ref);
      await writeAuditLogEntry({
        action: 'delete',
        entityType: 'vehicle',
        entityId: vehicleId,
        description: `Vehículo eliminado: ${before?.name || vehicleId}`,
        userEmail: user.email,
        before,
      });
      return { success: true };
    } catch (err) {
      logError('Error deleting vehicle:', err);
      return { success: false, error: err };
    }
  };

  return {
    vehicles,
    loading,
    error,
    getActiveVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
  };
};

export default useVehicles;
