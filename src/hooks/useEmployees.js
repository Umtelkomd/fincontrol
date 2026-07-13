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

const EMPLOYEES_COLLECTION = 'employees';

/**
 * useEmployees — CRUD hook for the employees collection.
 *
 * Path: artifacts/{appId}/public/data/employees
 *
 * Employee model (extended with payroll fields):
 *   Identity: fullName, firstName, lastName, aliases[],
 *             type, status ('active'|'on-leave'|'inactive'), projectIds,
 *             role, defaultCostCenter, email, phone, startDate, endDate, notes
 *   Payroll: iban, bic, taxClass, krankenkasse,
 *            bruttoMonthly, nettoMonthly, lstKistMonthly,
 *            svAnMonthly, svAgMonthly, gesamtkostenMonthly
 *   Meta:    createdAt, updatedAt, createdBy
 *
 * The payroll fields are reference values used to seed recurringCosts.
 * Actual monthly payments are recurringCosts entries with ownerType='employee'.
 */
export const useEmployees = (user) => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const employeesRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', EMPLOYEES_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(employeesRef, orderBy('fullName', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            fullName: raw.fullName || '',
            firstName: raw.firstName || '',
            lastName: raw.lastName || '',
            persNr: raw.persNr || '',
            aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
            type: raw.type || 'internal',
            status: raw.status || 'active',
            projectIds: Array.isArray(raw.projectIds) ? raw.projectIds : [],
            role: raw.role || '',
            defaultCostCenter: raw.defaultCostCenter || '',
            crewId: raw.crewId || '',
            crewName: raw.crewName || '',
            email: raw.email || '',
            phone: raw.phone || '',
            startDate: raw.startDate || '',
            endDate: raw.endDate || '',
            // Payroll
            iban: raw.iban || '',
            bic: raw.bic || '',
            taxClass: raw.taxClass || '',
            krankenkasse: raw.krankenkasse || '',
            bruttoMonthly: Number(raw.bruttoMonthly) || 0,
            nettoMonthly: Number(raw.nettoMonthly) || 0,
            lstKistMonthly: Number(raw.lstKistMonthly) || 0,
            svAnMonthly: Number(raw.svAnMonthly) || 0,
            svAgMonthly: Number(raw.svAgMonthly) || 0,
            gesamtkostenMonthly: Number(raw.gesamtkostenMonthly) || 0,
            notes: raw.notes || '',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
            createdBy: raw.createdBy || '',
          };
        });
        setEmployees(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading employees:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [employeesRef, user]);

  /**
   * Filter employees by type and/or status.
   * @param {'internal'|'external'|null} typeFilter
   * @param {'active'|'inactive'|null} statusFilter
   */
  const getFilteredEmployees = useCallback(
    (typeFilter = null, statusFilter = null) => {
      return employees.filter((e) => {
        const typeOk = !typeFilter || e.type === typeFilter;
        const statusOk = !statusFilter || e.status === statusFilter;
        return typeOk && statusOk;
      });
    },
    [employees],
  );

  /**
   * Active employees only — for autocomplete and pickers.
   */
  const getActiveEmployees = useCallback(
    (typeFilter = null) => {
      return employees.filter((e) => {
        const typeOk = !typeFilter || e.type === typeFilter;
        return e.status === 'active' && typeOk;
      });
    },
    [employees],
  );

  /**
   * Find an employee whose fullName, firstName, lastName, or any alias
   * matches the given text (case-insensitive). Used for matching transaction
   * descriptions to employees during the future backfill phase.
   */
  const findByText = useCallback(
    (text) => {
      if (!text) return [];
      const t = text.toLowerCase();
      return employees.filter((e) => {
        if (e.fullName?.toLowerCase().includes(t)) return true;
        if (e.firstName?.toLowerCase().includes(t)) return true;
        if (e.lastName?.toLowerCase().includes(t)) return true;
        return e.aliases.some((a) => a.toLowerCase().includes(t));
      });
    },
    [employees],
  );

  const normalizePayload = (data) => {
    const fullName = (data.fullName || '').trim();
    const firstName = (data.firstName || '').trim();
    const lastName = (data.lastName || '').trim();
    const computedFullName = fullName || `${firstName} ${lastName}`.trim();
    const allowedTypes = ['internal', 'external', 'contractor'];
    const allowedStatuses = ['active', 'on-leave', 'inactive'];
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      fullName: computedFullName,
      firstName,
      lastName,
      persNr: (data.persNr || '').trim(),
      aliases: Array.isArray(data.aliases)
        ? data.aliases.map((a) => String(a).trim()).filter(Boolean)
        : [],
      type: allowedTypes.includes(data.type) ? data.type : 'internal',
      status: allowedStatuses.includes(data.status) ? data.status : 'active',
      projectIds: Array.isArray(data.projectIds) ? data.projectIds.filter(Boolean) : [],
      role: (data.role || '').trim(),
      defaultCostCenter: (data.defaultCostCenter || '').trim(),
      crewId: (data.crewId || '').trim(),
      crewName: (data.crewName || '').trim(),
      email: (data.email || '').trim(),
      phone: (data.phone || '').trim(),
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      // Payroll
      iban: (data.iban || '').replace(/\s+/g, '').toUpperCase(),
      bic: (data.bic || '').trim().toUpperCase(),
      taxClass: (data.taxClass || '').trim(),
      krankenkasse: (data.krankenkasse || '').trim(),
      bruttoMonthly: num(data.bruttoMonthly),
      nettoMonthly: num(data.nettoMonthly),
      lstKistMonthly: num(data.lstKistMonthly),
      svAnMonthly: num(data.svAnMonthly),
      svAgMonthly: num(data.svAgMonthly),
      gesamtkostenMonthly: num(data.gesamtkostenMonthly),
      notes: (data.notes || '').trim(),
    };
  };

  const createEmployee = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };

    try {
      const payload = {
        ...normalizePayload(data),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.email || '',
      };

      const docRef = await addDoc(employeesRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'employee',
        entityId: docRef.id,
        description: `Mitarbeiter erstellt: ${payload.fullName}`,
        userEmail: user.email,
        after: { ...payload, id: docRef.id },
      });

      return { success: true, id: docRef.id };
    } catch (err) {
      logError('Error creating employee:', err);
      return { success: false, error: err };
    }
  };

  const updateEmployee = async (employeeId, data) => {
    if (!user) return { success: false, error: new Error('No user') };

    try {
      const employeeRef = doc(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        EMPLOYEES_COLLECTION,
        employeeId,
      );
      const payload = {
        ...normalizePayload(data),
        updatedAt: serverTimestamp(),
      };

      await updateDoc(employeeRef, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'employee',
        entityId: employeeId,
        description: `Mitarbeiter aktualisiert: ${payload.fullName}`,
        userEmail: user.email,
        after: { ...payload, id: employeeId },
      });

      return { success: true };
    } catch (err) {
      logError('Error updating employee:', err);
      return { success: false, error: err };
    }
  };

  const toggleEmployeeStatus = async (employee) => {
    const newStatus = employee.status === 'active' ? 'inactive' : 'active';
    return updateEmployee(employee.id, { ...employee, status: newStatus });
  };

  const deleteEmployee = async (employeeId) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const employeeRef = doc(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        EMPLOYEES_COLLECTION,
        employeeId,
      );
      const before = employees.find((e) => e.id === employeeId);
      await deleteDoc(employeeRef);
      await writeAuditLogEntry({
        action: 'delete',
        entityType: 'employee',
        entityId: employeeId,
        description: `Mitarbeiter eliminado: ${before?.fullName || employeeId}`,
        userEmail: user.email,
        before,
      });
      return { success: true };
    } catch (err) {
      logError('Error deleting employee:', err);
      return { success: false, error: err };
    }
  };

  return {
    employees,
    loading,
    error,
    getFilteredEmployees,
    getActiveEmployees,
    findByText,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    toggleEmployeeStatus,
  };
};

export default useEmployees;
