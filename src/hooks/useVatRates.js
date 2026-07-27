import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { logError } from '../utils/logger';
import { writeAuditLogEntry } from '../utils/auditLog';
import { DEFAULT_CATEGORY_VAT_RATES, isValidVatRate } from '../finance/vatRates';

/**
 * Keeps only entries that are usable VAT rates.
 *
 * This is the sanitizer boundary for this document: the snapshot also carries
 * `updatedAt` (a Firestore Timestamp) and could carry legacy junk, and anything
 * non-serializable reaching React state is React error 301. Rebuilding the map
 * from validated primitives means only plain numbers ever cross.
 */
const sanitizeRates = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  return Object.entries(raw).reduce((acc, [name, value]) => {
    if (typeof name === 'string' && name.trim() && isValidVatRate(value)) acc[name] = value;
    return acc;
  }, {});
};

/**
 * Coerce a form value to a VAT rate, or null when it is not one.
 *
 * `<input type="number">` hands back strings, so numeric strings are accepted —
 * but `Number('')` is 0, and an emptied field must not persist a silent "no VAT",
 * so blanks are refused before coercion.
 */
const parseRate = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const rate = Number(value);
  return isValidVatRate(rate) ? rate : null;
};

/**
 * VAT rates per category (settings/vatRates): the map that turns a gross bank
 * movement into the net figure project cost and budget actuals are measured in.
 * Managed from Configuración → IVA.
 *
 * The document seeds itself from DEFAULT_CATEGORY_VAT_RATES the first time it is
 * read — the same way useCategories seeds from its constants. Once it exists the
 * stored map is the only authority: defaults are NOT merged back in, so a
 * category the owner removed stays unconfigured instead of resurrecting.
 */
export const useVatRates = (user) => {
  const [categoryRates, setCategoryRates] = useState(DEFAULT_CATEGORY_VAT_RATES);
  const [loading, setLoading] = useState(() => !!user);
  const [error, setError] = useState(null);

  const docRef = useMemo(
    () => doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'vatRates'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const seedDefaults = () => {
      // Fire and forget: the seed is a side effect, not a precondition for
      // rendering. Awaiting it here would keep the screen spinning on a write
      // whose result state already equals what is on screen.
      setDoc(docRef, {
        rates: { ...DEFAULT_CATEGORY_VAT_RATES },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((initErr) => logError('Error initializing VAT rates:', initErr));
    };

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setCategoryRates(sanitizeRates(snapshot.data()?.rates));
        } else {
          setCategoryRates(DEFAULT_CATEGORY_VAT_RATES);
          seedDefaults();
        }
        setLoading(false);
      },
      (err) => {
        logError('Error loading VAT rates:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [docRef, user]);

  const persist = async (nextRates, description) => {
    if (!user) return { success: false, error: 'No user' };
    try {
      await setDoc(docRef, {
        rates: nextRates,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
      });
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'settings',
        entityId: 'vatRates',
        description,
        userEmail: user.email,
        after: { rates: nextRates },
      });
      return { success: true };
    } catch (err) {
      logError('Error saving VAT rates:', err);
      return { success: false, error: err };
    }
  };

  /** Store one category's rate. Expects 0.19, not 19. */
  const saveRate = async (category, rate) => {
    const name = typeof category === 'string' ? category.trim() : '';
    if (!name) return { success: false, error: 'invalid-category' };

    const parsed = parseRate(rate);
    if (parsed === null) return { success: false, error: 'invalid-rate' };

    const next = { ...categoryRates, [name]: parsed };
    return persist(next, `IVA de "${name}" fijado en ${(parsed * 100).toFixed(1)}%`);
  };

  /** Drop a category's rate so it reads as "not configured" again. */
  const clearRate = async (category) => {
    const name = typeof category === 'string' ? category.trim() : '';
    if (!name) return { success: false, error: 'invalid-category' };
    if (!(name in categoryRates)) return { success: false, error: 'not-found' };

    const next = { ...categoryRates };
    delete next[name];
    return persist(next, `IVA de "${name}" marcado como sin configurar`);
  };

  return { categoryRates, loading, error, saveRate, clearRate };
};

export default useVatRates;
