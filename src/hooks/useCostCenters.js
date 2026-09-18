import { logError } from '../utils/logger';
import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { COST_CENTER_CATALOG, COST_CENTER_CATALOG_VERSION } from '../finance/costCenterCatalog';

export const useCostCenters = (user) => {
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(() => !!user);
  const [error, setError] = useState(null);

  const costCentersRef = useMemo(() => collection(db, 'artifacts', appId, 'public', 'data', 'costCenters'), []);

  useEffect(() => {
    if (!user) return;

    const q = query(costCentersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCostCenters(data);
        setLoading(false);
      },
      (err) => {
        logError("Error loading cost centers:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, costCentersRef]);

  const createCostCenter = async (centerData) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      await addDoc(costCentersRef, {
        ...centerData,
        spent: 0,
        createdAt: serverTimestamp(),
        createdBy: user.email,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (err) {
      logError("Error creating cost center:", err);
      return { success: false, error: err };
    }
  };

  const updateCostCenter = async (centerId, updates) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const centerDoc = doc(db, 'artifacts', appId, 'public', 'data', 'costCenters', centerId);
      await updateDoc(centerDoc, {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy: user.email
      });
      return { success: true };
    } catch (err) {
      logError("Error updating cost center:", err);
      return { success: false, error: err };
    }
  };

  const deleteCostCenter = async (centerId) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const centerDoc = doc(db, 'artifacts', appId, 'public', 'data', 'costCenters', centerId);
      await deleteDoc(centerDoc);
      return { success: true };
    } catch (err) {
      logError("Error deleting cost center:", err);
      return { success: false, error: err };
    }
  };

  /**
   * seedCatalog — T7: "Cargar predefinidos" for the cost center catalogue v2.
   * Idempotent by construction: the catalogue doc id EQUALS its code
   * (setDoc(doc(ref, code), …, { merge: true })), unlike createCostCenter's
   * addDoc, which always mints a new random id. A pre-existing doc's
   * budget/responsible are simply never included in the payload, so merge
   * leaves them untouched; only a brand-new doc gets them defaulted.
   */
  const seedCatalog = async () => {
    if (!user) return { success: false, error: 'No user' };

    try {
      let created = 0;
      let updated = 0;
      for (const entry of COST_CENTER_CATALOG) {
        const centerDoc = doc(db, 'artifacts', appId, 'public', 'data', 'costCenters', entry.code);
        const existing = costCenters.some((c) => c.id === entry.code);
        await setDoc(
          centerDoc,
          {
            code: entry.code,
            name: entry.name,
            kind: entry.kind,
            line: entry.line || '',
            type: 'Costos',
            catalogVersion: COST_CENTER_CATALOG_VERSION,
            updatedAt: serverTimestamp(),
            updatedBy: user.email,
            ...(existing
              ? {}
              : {
                  budget: 0,
                  spent: 0,
                  responsible: '',
                  createdAt: serverTimestamp(),
                  createdBy: user.email,
                }),
          },
          { merge: true },
        );
        if (existing) updated += 1;
        else created += 1;
      }
      return { success: true, created, updated };
    } catch (err) {
      logError('Error seeding cost center catalogue:', err);
      return { success: false, error: err };
    }
  };

  return {
    costCenters,
    loading,
    error,
    createCostCenter,
    updateCostCenter,
    deleteCostCenter,
    seedCatalog,
  };
};

export default useCostCenters;
