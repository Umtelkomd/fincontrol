/**
 * Unauthenticated smoke probes for the invoice PDF archive HTTP contract
 * (functions/src/invoiceArchive/http.mjs, functions/README.md). Pure data +
 * pure evaluation only: no fetch, no credentials, no tokens. The runner
 * (scripts/verify-invoice-archive.mjs) owns the network call; this module
 * only describes what to send and what to expect back, and grades an
 * already-received response against that.
 *
 * Every probe intentionally omits Authorization — the goal is to prove the
 * deployed route exists and enforces the documented contract (routing,
 * method table, auth-before-body, security headers), not to exercise an
 * authenticated path.
 */

const ROOT = '/api/invoice-pdfs';
const ZERO_DIGEST = '0'.repeat(64);

/**
 * @typedef {Object} ArchiveProbe
 * @property {string} id - stable machine key
 * @property {string} method
 * @property {string} path
 * @property {Record<string, string>} [headers] - request headers to send
 * @property {string} [body] - request body to send
 * @property {number} expectStatus
 * @property {string} [expectJsonError] - required `{ error }` code when a JSON error is expected
 * @property {string} [expectAllow] - required `Allow` header value
 * @property {string} description
 */

/** @type {ArchiveProbe[]} */
export const PROBE_PLAN = [
  {
    id: 'root-get-not-allowed',
    method: 'GET',
    path: ROOT,
    expectStatus: 405,
    expectAllow: 'GET, POST',
    description: 'GET on the archive root is not a defined route.',
  },
  {
    id: 'post-unauthenticated',
    method: 'POST',
    path: ROOT,
    headers: { 'Content-Type': 'application/pdf' },
    body: '%PDF',
    expectStatus: 403,
    expectJsonError: 'access-denied',
    description: 'Uploading without a bearer token must be rejected before the body is read.',
  },
  {
    id: 'get-digest-unauthenticated',
    method: 'GET',
    path: `${ROOT}/${ZERO_DIGEST}`,
    expectStatus: 403,
    expectJsonError: 'access-denied',
    description: 'Reading a well-formed digest without a bearer token must be rejected.',
  },
  {
    id: 'get-malformed-digest',
    method: 'GET',
    path: `${ROOT}/not-a-digest`,
    expectStatus: 404,
    expectJsonError: 'not-found',
    description: 'A path that is neither the root nor a 64-hex digest is not a route.',
  },
  {
    id: 'root-delete-not-allowed',
    method: 'DELETE',
    path: ROOT,
    expectStatus: 405,
    description: 'DELETE on the archive root is not a defined route.',
  },
];

const REQUIRED_HEADERS = [
  ['cache-control', 'private, no-store'],
  ['x-content-type-options', 'nosniff'],
  ['vary', 'Authorization'],
];

const SPA_MARKER = /^\s*<(!doctype|html)/i;

function checkSecurityHeaders(headers, problems) {
  for (const [name, expected] of REQUIRED_HEADERS) {
    const actual = headers.get(name);
    if (actual !== expected) {
      const got = actual === null || actual === undefined ? 'nothing' : `"${actual}"`;
      problems.push(`missing or incorrect "${name}" header (expected "${expected}", got ${got})`);
    }
  }
}

function checkJsonError(probe, response, problems) {
  const contentType = response.headers.get('content-type') ?? '';
  const bodyText = response.bodyText ?? '';
  if (contentType.toLowerCase().includes('text/html') || SPA_MARKER.test(bodyText)) {
    problems.push('Hosting served the SPA instead of the function: rewrite or function missing');
    return;
  }
  if (!contentType.toLowerCase().includes('application/json')) {
    problems.push(`expected a JSON error response, got content-type "${contentType || '(none)'}"`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    problems.push('response body is not valid JSON');
    return;
  }
  if (parsed?.error !== probe.expectJsonError) {
    problems.push(`expected error code "${probe.expectJsonError}", got ${JSON.stringify(parsed?.error)}`);
  }
}

/**
 * Grade an already-received response against one probe. Never reads,
 * requires, or surfaces an Authorization value.
 *
 * @param {ArchiveProbe} probe
 * @param {{ status: number, headers: { get(name: string): string | null | undefined }, bodyText: string }} response
 * @returns {{ id: string, ok: boolean, problems: string[] }}
 */
export function evaluateProbe(probe, response) {
  const problems = [];

  if (response.status !== probe.expectStatus) {
    problems.push(`expected status ${probe.expectStatus}, got ${response.status}`);
  }

  if (probe.expectJsonError) {
    checkJsonError(probe, response, problems);
  }

  if (probe.expectAllow) {
    const allow = response.headers.get('allow');
    const got = allow === null || allow === undefined ? 'nothing' : `"${allow}"`;
    if (allow !== probe.expectAllow) {
      problems.push(`expected Allow header "${probe.expectAllow}", got ${got}`);
    }
  }

  checkSecurityHeaders(response.headers, problems);

  return { id: probe.id, ok: problems.length === 0, problems };
}

/**
 * Aggregate a full probe run into a pass/fail summary and printable lines,
 * one per probe.
 *
 * @param {{ id: string, ok: boolean, problems: string[] }[]} results
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function summarize(results) {
  const lines = results.map((result) =>
    result.ok ? `PASS ${result.id}` : `FAIL ${result.id}: ${result.problems.join('; ')}`,
  );
  return { ok: results.every((result) => result.ok), lines };
}
