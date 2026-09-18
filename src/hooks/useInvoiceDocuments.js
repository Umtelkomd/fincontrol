/**
 * `artifacts/{appId}/public/data/invoiceDocuments` — the archived invoice PDF
 * metadata written by `archiveInvoice` (src/features/facturas/lib/intake.js).
 * Doc id is the file's sha256. This hook only subscribes and commits; every
 * accounting invariant already lived through `planInvoiceLink` before the
 * caller reaches `commitInvoiceArchive`.
 *
 * `commitInvoiceArchive` implements the `effects.commit` contract from
 * `archiveInvoice`: one atomic writeBatch that upserts the invoice document
 * and patches every linked payable/receivable with the archive identity and
 * this document's id.
 */
import { logError } from '../utils/logger';
import { useEffect, useMemo, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { sanitizeValue } from '../utils/sanitizeFirestore';
import { CHUNK_BYTES } from '../finance/invoiceChunks';

const COLLECTION_BY_FAMILY = { payable: 'payables', receivable: 'receivables' };

/** The Firestore collection an obligation family lives in, or throws. */
export const collectionForFamily = (family) => {
  const collectionName = COLLECTION_BY_FAMILY[family];
  if (!collectionName) throw new Error(`Unknown obligation family: ${family}`);
  return collectionName;
};

/** Milliseconds since epoch for a Firestore Timestamp, ISO string, or missing value. */
const createdAtMillis = (value) => {
  if (value == null) return -Infinity;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : -Infinity;
  }
  return -Infinity;
};

/**
 * Newest-first by `createdAt` (Firestore Timestamp, ISO string, or missing —
 * treated as oldest). Stable for ties and never mutates its input.
 */
export const sortByCreatedAtDesc = (docs) => {
  if (!Array.isArray(docs)) return [];
  return docs
    .map((document, index) => ({ document, index }))
    .sort((a, b) => {
      const diff = createdAtMillis(b.document.createdAt) - createdAtMillis(a.document.createdAt);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ document }) => document);
};

export const useInvoiceDocuments = (user) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(() => !!user);
  const [error, setError] = useState(null);

  const invoiceDocumentsRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      invoiceDocumentsRef,
      (snapshot) => {
        const data = snapshot.docs.map((entry) => sanitizeValue({ id: entry.id, ...entry.data() }));
        setDocuments(sortByCreatedAtDesc(data));
        setError(null);
        setLoading(false);
      },
      (snapshotError) => {
        logError('Error loading invoice documents:', snapshotError);
        setError(snapshotError);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [invoiceDocumentsRef, user]);

  /**
   * effects.commit({ document, linkUpdates }) — see archiveInvoice in
   * src/features/facturas/lib/intake.js for the exact shapes.
   */
  const commitInvoiceArchive = async ({ document, linkUpdates = [] } = {}) => {
    const batch = writeBatch(db);

    const documentRef = doc(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', document.id);
    const chunkCount = Math.max(1, Math.ceil((document.data.sizeBytes || 0) / CHUNK_BYTES));
    const links = Array.isArray(document.data.links) ? document.data.links : [];
    batch.set(
      documentRef,
      {
        ...document.data,
        // A re-archive of the same PDF (same sha256) must accumulate links,
        // never replace the ones an earlier submission attached.
        ...(links.length > 0 ? { links: arrayUnion(...links) } : {}),
        storage: 'firestore-chunks-v1',
        chunkBytes: CHUNK_BYTES,
        chunkCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    linkUpdates.forEach((link) => {
      const collectionName = collectionForFamily(link.family);
      const recordRef = doc(db, 'artifacts', appId, 'public', 'data', collectionName, link.recordId);
      batch.update(recordRef, {
        archivedInvoiceIdentity: link.patch.archivedInvoiceIdentity,
        invoiceDocumentIds: arrayUnion(...link.patch.invoiceDocumentIds),
        updatedAt: serverTimestamp(),
        updatedBy: link.patch.updatedBy,
      });
    });

    await batch.commit();
  };

  /**
   * updateInvoiceDocument — EDIT/REPLACE: patches the archive metadata
   * doc with the exact fields the caller sends (never a default overwrite,
   * same discipline as updatePayable/updateReceivable). `patch` must never
   * carry `sha256`/`sizeBytes`/`chunkCount`/`storage`/`links` — those keep
   * `validInvoiceMetadata()` satisfied in firestore.rules and `links` has no
   * edit path here (see src/finance/invoiceAmendment.js's planInvoiceReplace
   * for the one place links legitimately change, via a full document swap).
   */
  const updateInvoiceDocument = async (sha256, patch = {}) => {
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', sha256);
    await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  };

  /** deleteInvoiceDocument — DELETE: removes the archive metadata doc itself (chunks are a separate call — see lib/invoiceArchiveStore.js's deleteInvoicePdf). */
  const deleteInvoiceDocument = async (sha256) => {
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', sha256);
    await deleteDoc(ref);
  };

  /**
   * removeInvoiceLink — DELETE: strips this archive doc's sha256 back
   * reference from one linked obligation (`invoiceDocumentIds`). Runs for
   * every link, owned or foreign — it is pure cleanup of a now-dangling
   * pointer, never an accounting change (see src/finance/invoiceAmendment.js's
   * `planInvoiceDelete`, which only ever cancels an OWNED, unlocked obligation
   * separately and explicitly).
   */
  const removeInvoiceLink = async (family, recordId, sha256) => {
    const collectionName = collectionForFamily(family);
    const ref = doc(db, 'artifacts', appId, 'public', 'data', collectionName, recordId);
    await updateDoc(ref, { invoiceDocumentIds: arrayRemove(sha256), updatedAt: serverTimestamp() });
  };

  /**
   * swapInvoiceLink — REPLACE PDF: re-points one obligation's back
   * reference from the OLD sha256 to the NEW one. Two sequential updates
   * (Firestore cannot combine an arrayRemove and an arrayUnion of the SAME
   * field in one write) rather than a batch — REPLACE's own ordering already
   * tolerates a failure here (see lib/amend.js's applyInvoiceReplace): the old
   * PDF is only deleted once every swap has succeeded.
   */
  const swapInvoiceLink = async (family, recordId, { removeInvoiceDocumentId, addInvoiceDocumentId } = {}) => {
    const collectionName = collectionForFamily(family);
    const ref = doc(db, 'artifacts', appId, 'public', 'data', collectionName, recordId);
    await updateDoc(ref, { invoiceDocumentIds: arrayRemove(removeInvoiceDocumentId), updatedAt: serverTimestamp() });
    await updateDoc(ref, { invoiceDocumentIds: arrayUnion(addInvoiceDocumentId), updatedAt: serverTimestamp() });
  };

  return {
    documents,
    loading,
    error,
    commitInvoiceArchive,
    updateInvoiceDocument,
    deleteInvoiceDocument,
    removeInvoiceLink,
    swapInvoiceLink,
  };
};

export default useInvoiceDocuments;
