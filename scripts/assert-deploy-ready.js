#!/usr/bin/env node
/**
 * assert-deploy-ready.js — deploy guard, run as a `firebase.json` predeploy
 * hook for both `hosting` and `firestore`.
 *
 * CI never deploys; `firebase deploy` is run manually from whatever local
 * tree a developer has checked out. This aborts the deploy unless that tree
 * is `main`, clean, and exactly equal to `origin/main`, so a feature branch
 * or a dirty tree can't ship straight to production.
 *
 * Emergency override: set FINCONTROL_ALLOW_UNSAFE_DEPLOY=1 to downgrade
 * failures to warnings and deploy anyway.
 *
 * Usage:
 *   npm run deploy:guard
 *   FINCONTROL_ALLOW_UNSAFE_DEPLOY=1 npm run deploy:guard
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { evaluateDeployReadiness, formatDeployReadinessReport } from './lib/deployReadiness.js';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function gatherGitFacts() {
  let fetchError;
  try {
    git(['fetch', '--quiet', 'origin', 'main']);
  } catch (error) {
    fetchError = error;
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusPorcelain = git(['status', '--porcelain']);
  const head = git(['rev-parse', 'HEAD']);

  let originMain;
  try {
    originMain = git(['rev-parse', '--verify', '--quiet', 'origin/main']);
  } catch {
    originMain = undefined;
  }

  return { branch, statusPorcelain, head, originMain, fetchError };
}

function main() {
  const override = process.env.FINCONTROL_ALLOW_UNSAFE_DEPLOY === '1';
  const facts = gatherGitFacts();
  const result = evaluateDeployReadiness({ ...facts, override });

  if (result.overridden) {
    console.error('WARNING: deploy readiness checks failed but FINCONTROL_ALLOW_UNSAFE_DEPLOY=1 overrode them:');
    console.error(formatDeployReadinessReport(result.problems));
    console.error('WARNING: proceeding with an unsafe deploy.');
    process.exit(0);
  }

  if (!result.ok) {
    console.error('Deploy blocked: production must be deployed from a clean main that matches origin/main.');
    console.error(formatDeployReadinessReport(result.problems));
    console.error(
      '\nEmergency override only (set it on the deploy command itself):\n'
      + '  FINCONTROL_ALLOW_UNSAFE_DEPLOY=1 npx -y firebase-tools deploy --only <targets>',
    );
    process.exit(1);
  }

  console.log(`Deploy guard passed: main @ ${facts.head.slice(0, 7)} matches origin/main.`);
  process.exit(0);
}

main();
