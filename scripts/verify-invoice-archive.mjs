#!/usr/bin/env node
/**
 * Thin, credential-free runner for the invoice PDF archive smoke probes
 * (src/lib/ops/archiveProbe.js): sends every PROBE_PLAN entry with global
 * fetch, grades the response with evaluateProbe, prints one line per probe,
 * exits 1 on any failure or network error. All logic lives in the pure
 * module; this file only wires it to fetch and argv.
 *
 * Usage: node scripts/verify-invoice-archive.mjs [--base <url>]
 * Default base: https://umtelkomd-finance.web.app (production Hosting site).
 * For the Hosting emulator, pass e.g. --base http://127.0.0.1:5000.
 *
 * No credentials, no tokens, no env files: every probe is unauthenticated
 * by design and this script never reads process.env beyond argv.
 */

import { PROBE_PLAN, evaluateProbe, summarize } from '../src/lib/ops/archiveProbe.js';

const DEFAULT_BASE = 'https://umtelkomd-finance.web.app';

function parseBase(argv) {
  const index = argv.indexOf('--base');
  if (index === -1) return DEFAULT_BASE;
  const value = argv[index + 1];
  if (!value) throw new Error('--base requires a URL argument');
  return value;
}

async function runProbe(base, probe) {
  try {
    const response = await fetch(new URL(probe.path, base), {
      method: probe.method,
      headers: probe.headers,
      body: probe.body,
      redirect: 'manual',
    });
    const bodyText = await response.text();
    return evaluateProbe(probe, { status: response.status, headers: response.headers, bodyText });
  } catch (error) {
    return { id: probe.id, ok: false, problems: [`network error: ${error.message}`] };
  }
}

async function main() {
  const base = parseBase(process.argv.slice(2));
  console.log(`Verifying invoice archive contract against ${base}`);
  // Sequential: a handful of tiny requests against a low-maxInstances function.
  const results = [];
  for (const probe of PROBE_PLAN) {
    results.push(await runProbe(base, probe));
  }
  const summary = summarize(results);
  for (const line of summary.lines) console.log(line);
  process.exit(summary.ok ? 0 : 1);
}

main();
