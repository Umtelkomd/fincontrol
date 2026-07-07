import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, appId } from '../../services/firebase';
import { logError } from '../../utils/logger';

export const DEFAULT_OVERHEAD_BASIS = 'directCost';
const VALID_BASES = new Set(['directCost', 'revenue']);

/**
 * useOverheadConfig — persisted settings for the project-control view.
 *
 * Path: artifacts/{appId}/public/data/settings/projectControl
 * Shape: { overheadBasis: 'directCost' | 'revenue' }
 *
 * The overhead allocation basis is a company-level accounting decision, not a
 * per-user toggle, so it lives in the shared settings collection (same pattern
 * as settings/bankAccount). Defaults to 'directCost' while the doc is absent.
 */
export const useOverheadConfig = (user) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const configRef = useMemo(
    () => doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'projectControl'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        setConfig(snapshot.exists() ? snapshot.data() : null);
        setLoading(false);
      },
      (err) => {
        logError('Error loading project control config:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [configRef, user]);

  const overheadBasis = VALID_BASES.has(config?.overheadBasis)
    ? config.overheadBasis
    : DEFAULT_OVERHEAD_BASIS;

  const setOverheadBasis = async (basis) => {
    if (!user) return { success: false, error: 'No user' };
    if (!VALID_BASES.has(basis)) return { success: false, error: 'Invalid basis' };

    try {
      await setDoc(
        configRef,
        {
          overheadBasis: basis,
          updatedAt: serverTimestamp(),
          updatedBy: user.email,
        },
        { merge: true },
      );
      return { success: true };
    } catch (err) {
      logError('Error saving project control config:', err);
      return { success: false, error: err };
    }
  };

  return { overheadBasis, setOverheadBasis, loading, error };
};

export default useOverheadConfig;
