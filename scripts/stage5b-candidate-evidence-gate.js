#!/usr/bin/env node

import { isAbsolute, relative, resolve } from 'node:path';

import {
  evaluateStage5bCandidateEvidenceFile,
  writeStage5bCandidateEvidenceGateReport,
} from '../lib/stage5b-candidate-evidence-gate.js';

const DEFAULT_PROJECT_ROOT = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'json') {
      options.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }
  return { options, positional };
}

function printUsage() {
  console.error('Usage: node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json> [--out <report.json>] [--json]');
}

function resolveRepoScopedOutput(projectRoot, outputPath) {
  const absolute = resolve(projectRoot, outputPath);
  const rel = relative(projectRoot, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('--out must resolve inside the project root');
  }
  return absolute;
}

const { options, positional } = parseArgs(process.argv.slice(2));
const candidatePath = options.candidate || positional[0];

if (!candidatePath) {
  printUsage();
  process.exit(2);
}

const projectRoot = resolve(options['project-root'] || DEFAULT_PROJECT_ROOT);
const report = await evaluateStage5bCandidateEvidenceFile({
  projectRoot,
  candidatePath,
});

if (options.out) {
  try {
    await writeStage5bCandidateEvidenceGateReport(resolveRepoScopedOutput(projectRoot, options.out), report);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const accepted = report.summary.eligible_for_stage5b_intake_review;
  console.log(`Stage 5B candidate evidence gate: ${accepted ? 'eligible_for_intake_review' : 'rejected'}`);
  console.log(`  Candidate: ${report.candidate.path || '<unresolved>'}`);
  console.log(`  Rejections: ${report.summary.rejection_count}`);
  if (report.summary.rejection_codes.length > 0) {
    console.log(`  Rejection codes: ${report.summary.rejection_codes.join(', ')}`);
  }
  console.log(`  Readiness truth: ${report.summary.readiness_truth}`);
  if (options.out) {
    console.log(`  Report: ${options.out}`);
  }
}

process.exit(report.summary.eligible_for_stage5b_intake_review ? 0 : 1);
