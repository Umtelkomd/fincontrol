/**
 * Fetches an archived invoice PDF by sha256 and exposes it as an object URL
 * for the viewer's <iframe>/<a download>. Revokes the previous URL whenever
 * `sha256` changes and on unmount — object URLs otherwise leak for the life
 * of the tab.
 */
import { useEffect, useState, useCallback } from 'react';
import { fetchInvoicePdf } from '../lib/invoiceArchiveStore';
import { db, appId } from '../../../services/firebase';

// `user` is accepted for call-site symmetry with the archive/upload side and
// potential future access-scoping, but the Firestore-chunk fetch itself only
// needs `db`/`appId` — auth is enforced by firestore.rules, not this call.
export const useInvoicePdfBlob = (user, sha256) => {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    if (!sha256) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;
    setLoading(true);
    setError(null);
    setUrl(null);

    fetchInvoicePdf({ db, appId, sha256 })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((thrown) => {
        if (!cancelled) setError(thrown);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, sha256, attempt]);

  return { url, loading, error, retry };
};

export default useInvoicePdfBlob;
