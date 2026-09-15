import { describe, expect, it } from 'vitest';
import { PROBE_PLAN, evaluateProbe, summarize } from './archiveProbe.js';

function fakeResponse({ status, headers = {}, bodyText = '' }) {
  const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    bodyText,
    headers: { get: (name) => (lower.has(name.toLowerCase()) ? lower.get(name.toLowerCase()) : null) },
  };
}

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Authorization',
};

function conformingResponseFor(probe) {
  const headers = { ...SECURITY_HEADERS };
  let bodyText = '';
  if (probe.expectAllow) headers.Allow = probe.expectAllow;
  if (probe.expectJsonError) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify({ error: probe.expectJsonError });
  }
  return fakeResponse({ status: probe.expectStatus, headers, bodyText });
}

describe('PROBE_PLAN', () => {
  it('defines the five unauthenticated probes with no Authorization header', () => {
    expect(PROBE_PLAN).toHaveLength(5);
    for (const probe of PROBE_PLAN) {
      expect(probe.headers?.Authorization ?? probe.headers?.authorization).toBeUndefined();
    }
  });
});

describe('evaluateProbe — conforming responses', () => {
  for (const probe of PROBE_PLAN) {
    it(`passes for probe "${probe.id}" on a conforming response`, () => {
      const result = evaluateProbe(probe, conformingResponseFor(probe));
      expect(result).toEqual({ id: probe.id, ok: true, problems: [] });
    });
  }
});

describe('evaluateProbe — failure detection', () => {
  const jsonProbe = PROBE_PLAN.find((probe) => probe.expectJsonError);
  const allowProbe = PROBE_PLAN.find((probe) => probe.expectAllow);

  it('flags an SPA HTML body served instead of the function (content-type)', () => {
    const response = fakeResponse({
      status: 200,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
      bodyText: '<!doctype html><html><body>App</body></html>',
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'Hosting served the SPA instead of the function: rewrite or function missing',
    );
  });

  it('flags an SPA HTML body via the doctype marker even without an html content-type', () => {
    const response = fakeResponse({
      status: 200,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' },
      bodyText: '<!DOCTYPE html><html></html>',
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems).toContain(
      'Hosting served the SPA instead of the function: rewrite or function missing',
    );
  });

  it('flags a wrong status code', () => {
    const response = conformingResponseFor(jsonProbe);
    response.status = 500;
    const result = evaluateProbe(jsonProbe, response);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(`expected status ${jsonProbe.expectStatus}, got 500`);
  });

  it('flags a wrong JSON error code', () => {
    const response = conformingResponseFor(jsonProbe);
    response.bodyText = JSON.stringify({ error: 'internal-error' });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes('expected error code'))).toBe(true);
  });

  it('flags a non-JSON, non-HTML content-type when JSON is expected', () => {
    const response = fakeResponse({
      status: jsonProbe.expectStatus,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' },
      bodyText: 'access-denied',
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems.some((problem) => problem.includes('expected a JSON error response'))).toBe(true);
  });

  it('flags an unparseable JSON body', () => {
    const response = conformingResponseFor(jsonProbe);
    response.bodyText = 'not json';
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems).toContain('response body is not valid JSON');
  });

  it('flags a missing Allow header when one is expected', () => {
    const response = fakeResponse({ status: allowProbe.expectStatus, headers: { ...SECURITY_HEADERS } });
    const result = evaluateProbe(allowProbe, response);
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes('Allow header'))).toBe(true);
  });

  it('flags a mismatched Allow header value', () => {
    const response = fakeResponse({
      status: allowProbe.expectStatus,
      headers: { ...SECURITY_HEADERS, Allow: 'POST' },
    });
    const result = evaluateProbe(allowProbe, response);
    expect(result.problems.some((problem) => problem.includes('expected Allow header "GET, POST"'))).toBe(
      true,
    );
  });

  it('flags a missing Cache-Control security header', () => {
    const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json' };
    delete headers['Cache-Control'];
    const response = fakeResponse({
      status: jsonProbe.expectStatus,
      headers,
      bodyText: JSON.stringify({ error: jsonProbe.expectJsonError }),
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems.some((problem) => problem.includes('cache-control'))).toBe(true);
  });

  it('flags a missing X-Content-Type-Options security header', () => {
    const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json' };
    delete headers['X-Content-Type-Options'];
    const response = fakeResponse({
      status: jsonProbe.expectStatus,
      headers,
      bodyText: JSON.stringify({ error: jsonProbe.expectJsonError }),
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems.some((problem) => problem.includes('x-content-type-options'))).toBe(true);
  });

  it('flags a missing Vary security header', () => {
    const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json' };
    delete headers.Vary;
    const response = fakeResponse({
      status: jsonProbe.expectStatus,
      headers,
      bodyText: JSON.stringify({ error: jsonProbe.expectJsonError }),
    });
    const result = evaluateProbe(jsonProbe, response);
    expect(result.problems.some((problem) => problem.includes('vary'))).toBe(true);
  });

  it('never requires or surfaces an Authorization value', () => {
    const response = conformingResponseFor(jsonProbe);
    const result = evaluateProbe(jsonProbe, response);
    expect(JSON.stringify(result)).not.toMatch(/authorization/i);
  });
});

describe('summarize', () => {
  it('reports ok true and one PASS line per probe when every result passes', () => {
    const results = PROBE_PLAN.map((probe) => evaluateProbe(probe, conformingResponseFor(probe)));
    const summary = summarize(results);
    expect(summary.ok).toBe(true);
    expect(summary.lines).toHaveLength(PROBE_PLAN.length);
    expect(summary.lines.every((line) => line.startsWith('PASS'))).toBe(true);
  });

  it('reports ok false and includes the failing problems in its line when any result fails', () => {
    const results = PROBE_PLAN.map((probe) => evaluateProbe(probe, conformingResponseFor(probe)));
    results[0] = { id: results[0].id, ok: false, problems: ['boom'] };
    const summary = summarize(results);
    expect(summary.ok).toBe(false);
    expect(summary.lines[0]).toBe(`FAIL ${results[0].id}: boom`);
  });
});
