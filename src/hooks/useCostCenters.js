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
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';

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

  return {
    costCenters,
    loading,
    error,
    createCostCenter,
    updateCostCenter,
    deleteCostCenter
  };
};

export default useCostCenters;
