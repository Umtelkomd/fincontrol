import { logError } from '../utils/logger';
import { useEffect, useMemo, useState } from 'react';
import {
  collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, limit
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';

export const useAuditLog = (user) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));

  const colRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'auditLog'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(colRef, orderBy('timestamp', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id,
          ...raw,
          timestamp: raw.timestamp?.toDate?.() ? raw.timestamp.toDate().toISOString() : raw.timestamp,
        };
      });
      setLogs(data);
      setLoading(false);
    }, (err) => {
      logError('Error loading audit log:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [colRef, user]);

  const logAction = async (data) => {
    if (!user) return;
    try {
      await addDoc(colRef, {
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId || null,
        description: data.description,
        before: data.before || null,
        after: data.after || null,
        user: user.email,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      logError('Error logging action:', error);
    }
  };

  return { logs, loading, logAction };
};
