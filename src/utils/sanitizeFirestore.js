/**
 * Firestore render-safety sanitizers (React error 301 guard).
 *
 * Extracted verbatim from the legacy useTransactions hook so this behavior
 * survives the removal of the legacy transactions layer:
 * - Firestore Timestamp-like values (anything exposing toDate()) become ISO strings.
 * - Arrays are deep-sanitized item by item.
 * - At document level, top-level plain objects (e.g. viewedBy) are skipped
 *   because rendering them crashes React.
 */

// Deep-sanitize a value: convert Timestamps to ISO strings, drop plain objects
export const sanitizeValue = (v) => {
  if (v == null) return v;
  if (v && typeof v === 'object' && typeof v.toDate === 'function') {
    return v.toDate().toISOString();
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  if (Array.isArray(v)) {
    return v.map(item => sanitizeValue(item));
  }
  if (typeof v === 'object') {
    // Deep-sanitize object properties (for notes/payments array items)
    const out = {};
    for (const [key, val] of Object.entries(v)) {
      const s = sanitizeValue(val);
      // Only keep primitives, strings, numbers, arrays — skip nested plain objects
      // BUT allow sanitized objects (like note/payment items in arrays)
      if (s != null) out[key] = s;
    }
    return out;
  }
  return v;
};

/**
 * Sanitize a Firestore document for safe React rendering.
 *
 * Behavior is identical to the legacy transactions snapshot mapping:
 * - Top-level Timestamp-like fields become ISO strings.
 * - Top-level arrays are deep-sanitized.
 * - Top-level plain objects (like viewedBy) are skipped — they crash React if rendered.
 * - Everything else (primitives, null, Date instances) is kept as-is.
 * - Each field in arrayFields is coerced to a deep-sanitized array.
 */
export const sanitizeSnapshotDoc = (docId, raw, { arrayFields = ['notes', 'payments'] } = {}) => {
  // Sanitize: convert Timestamps, deep-clean arrays, skip top-level plain objects (viewedBy)
  const sanitized = { id: docId };
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      sanitized[k] = v.toDate().toISOString();
    } else if (Array.isArray(v)) {
      sanitized[k] = v.map(item => sanitizeValue(item));
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      // Skip top-level plain objects like viewedBy — they crash React if rendered
      continue;
    } else {
      sanitized[k] = v;
    }
  }
  // Ensure the configured fields are always arrays (deep-sanitized)
  for (const field of arrayFields) {
    if (!Array.isArray(sanitized[field])) {
      sanitized[field] = Array.isArray(raw[field]) ? raw[field].map(item => sanitizeValue(item)) : [];
    }
  }
  return sanitized;
};
