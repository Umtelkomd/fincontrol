import { logError } from '../utils/logger';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';

const PARTNERS_COLLECTION = 'partners';

export const usePartners = (user) => {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const partnersRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', PARTNERS_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(partnersRef, orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => {
          const raw = doc.data();
          return {
            id: doc.id,
            type: raw.type || 'both',
            name: raw.name || '',
            legalName: raw.legalName || '',
            taxId: raw.taxId || '',
            email: raw.email || '',
            phone: raw.phone || '',
            address: raw.address || '',
            defaultPaymentMethod: raw.defaultPaymentMethod || '',
            defaultTaxRate: raw.defaultTaxRate ?? 0.19,
            notes: raw.notes || '',
            status: raw.status || 'active',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
          };
        });
        setPartners(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading partners:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [partnersRef, user]);

  /**
   * Get partners filtered by type and/or status
   * @param {'vendor'|'client'|'both'|null} typeFilter
   * @param {'active'|'inactive'|null} statusFilter
   */
  const getFilteredPartners = useCallback(
    (typeFilter = null, statusFilter = null) => {
      return partners.filter((p) => {
        const typeOk = !typeFilter || p.type === typeFilter || p.type === 'both';
        const statusOk = !statusFilter || p.status === statusFilter;
        return typeOk && statusOk;
      });
    },
    [partners],
  );

  /**
   * Get active partners for autocomplete (no status filter — active by default)
   * @param {'vendor'|'client'|'both'|null} typeFilter
   */
  const getActivePartners = useCallback(
    (typeFilter = null) => {
      return partners.filter((p) => {
        const typeOk = !typeFilter || p.type === typeFilter || p.type === 'both';
        return p.status === 'active' && typeOk;
      });
    },
    [partners],
  );

  const createPartner = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };

    try {
      const payload = {
        type: data.type || 'both',
        name: data.name.trim(),
        legalName: data.legalName?.trim() || '',
        taxId: data.taxId?.trim() || '',
        email: data.email?.trim() || '',
        phone: data.phone?.trim() || '',
        address: data.address?.trim() || '',
        defaultPaymentMethod: data.defaultPaymentMethod?.trim() || '',
        defaultTaxRate: typeof data.defaultTaxRate === 'number' ? data.defaultTaxRate : 0.19,
        notes: data.notes?.trim() || '',
        status: data.status || 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(partnersRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'partner',
        entityId: docRef.id,
        description: `Geschäftspartner erstellt: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: docRef.id },
      });

      return { success: true, id: docRef.id };
    } catch (err) {
      logError('Error creating partner:', err);
      return { success: false, error: err };
    }
  };

  const updatePartner = async (partnerId, data) => {
    if (!user) return { success: false, error: new Error('No user') };

    try {
      const partnerRef = doc(db, 'artifacts', appId, 'public', 'data', PARTNERS_COLLECTION, partnerId);
      const payload = {
        type: data.type || 'both',
        name: data.name.trim(),
        legalName: data.legalName?.trim() || '',
        taxId: data.taxId?.trim() || '',
        email: data.email?.trim() || '',
        phone: data.phone?.trim() || '',
        address: data.address?.trim() || '',
        defaultPaymentMethod: data.defaultPaymentMethod?.trim() || '',
        defaultTaxRate: typeof data.defaultTaxRate === 'number' ? data.defaultTaxRate : 0.19,
        notes: data.notes?.trim() || '',
        status: data.status || 'active',
        updatedAt: serverTimestamp(),
      };

      await updateDoc(partnerRef, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'partner',
        entityId: partnerId,
        description: `Geschäftspartner aktualisiert: ${payload.name}`,
        userEmail: user.email,
        after: { ...payload, id: partnerId },
      });

      return { success: true };
    } catch (err) {
      logError('Error updating partner:', err);
      return { success: false, error: err };
    }
  };

  const togglePartnerStatus = async (partner) => {
    const newStatus = partner.status === 'active' ? 'inactive' : 'active';
    return updatePartner(partner.id, { ...partner, status: newStatus });
  };

  return {
    partners,
    loading,
    error,
    getFilteredPartners,
    getActivePartners,
    createPartner,
    updatePartner,
    togglePartnerStatus,
  };
};

export default usePartners;
