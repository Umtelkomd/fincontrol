/**
 * Person-name matching — the ONE matcher for "is this text this person?".
 *
 * Extracted verbatim from `src/features/nominas/lib/payrollIdentity.js`, which
 * still owns the payroll import and now imports from here. `useEmployees.findByText`
 * was a second, slightly weaker copy of the same idea (one-way containment only)
 * and now delegates here too, so the codebase has exactly one answer.
 *
 * Deliberately dumb: case-insensitive two-way substring containment over
 * fullName / firstName / lastName / aliases. It is a RECALL-first matcher — it
 * is meant to surface a candidate, not to prove identity. Callers that act on a
 * match (charging a project, excluding a payroll settlement) must weigh it with
 * a confidence, which is what `src/finance/counterpartyIdentity.js` adds on top.
 *
 * Pure: no React, no Firebase, no Date.
 */

/**
 * Lowercased, trimmed. Falsy becomes '' — never the string "null" or "0".
 * Byte-for-byte the `norm` helper the payroll importer shipped with.
 */
export const normalizeName = (value) => String(value || '').trim().toLowerCase();

/** Word tokens of a name: "Lesmes Linares, J." → ['lesmes','linares','j']. */
export const nameTokens = (value) =>
  normalizeName(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Does the employee's name / alias set match the given free-text name?
 *
 * Substring match on fullName / firstName / lastName / aliases, containment
 * both ways so "Wagner" matches "Klaus Wagner" and "Lesmes Linares, J." matches
 * the employee whose lastName is "Lesmes Linares".
 *
 * @param {{fullName?:string, firstName?:string, lastName?:string, aliases?:string[]}} employee
 * @param {string} text free text from a payroll line or a bank counterparty
 * @returns {boolean}
 */
export const nameMatches = (employee, text) => {
  const target = normalizeName(text);
  if (!target) return false;
  const person = employee || {};

  const candidates = [
    normalizeName(person.fullName),
    normalizeName(person.firstName),
    normalizeName(person.lastName),
    ...(Array.isArray(person.aliases) ? person.aliases.map(normalizeName) : []),
  ].filter(Boolean);

  return candidates.some((candidate) => candidate.includes(target) || target.includes(candidate));
};

export default nameMatches;
