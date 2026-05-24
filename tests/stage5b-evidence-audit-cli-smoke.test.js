import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = `output/stage5b-audit-cli-smoke-${process.pid}-${Date.now()}`;
const ABSOLUTE_OUTPUT_DIR = join(ROOT, OUTPUT_DIR);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function trackedDocsExampleFiles() {
  return runGit(['ls-files', 'docs/examples'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function hashTrackedFiles(paths) {
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(ROOT, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function docsExamplesStatus() {
  return runGit(['status', '--short', '--', 'docs/examples']);
}

const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  const result = spawnSync(process.execPath, [
    'bin/fcad.js',
    'stage5b-evidence-audit',
    '--out-dir',
    OUTPUT_DIR,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `stage5b-evidence-audit CLI smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(result.stdout, /Stage 5B evidence audit bundle:/);
  assert.match(result.stdout, /Genuine evidence found: no/);
  assert.match(result.stdout, /Promotion can run: no/);
  assert.match(result.stdout, /Readiness remains held: yes/);

  const intakePath = join(ABSOLUTE_OUTPUT_DIR, 'intake_report.json');
  const dryRunPath = join(ABSOLUTE_OUTPUT_DIR, 'promotion_dry_run_manifest.json');
  const auditManifestPath = join(ABSOLUTE_OUTPUT_DIR, 'stage5b_audit_manifest.json');
  const auditSummaryPath = join(ABSOLUTE_OUTPUT_DIR, 'stage5b_audit_summary.md');

  [
    intakePath,
    dryRunPath,
    auditManifestPath,
    auditSummaryPath,
  ].forEach((path) => {
    assert.equal(existsSync(path), true, `${path} should exist`);
  });

  const intake = readJson(intakePath);
  const dryRun = readJson(dryRunPath);
  const audit = readJson(auditManifestPath);
  const summaryMarkdown = readFileSync(auditSummaryPath, 'utf8');

  assert.equal(audit.include_github, false, 'CLI smoke must leave GitHub discovery disabled by default');
  assert.equal(intake.github_discovery?.enabled, false, 'intake must not enable GitHub discovery by default');
  assert.equal(audit.summary.genuine_inspection_evidence_found, false);
  assert.equal(audit.summary.promotion_can_run, false);
  assert.equal(audit.summary.readiness_remains_held, true);
  assert.equal(audit.summary.canonical_artifacts_mutated, false);
  assert.equal(audit.summary.requires_human_measurement_entry, false);
  assert.equal(audit.readiness_held_truth.no_genuine_completed_inspection_evidence_found, true);
  assert.equal(audit.readiness_held_truth.no_promotion_can_run, true);
  assert.equal(audit.readiness_held_truth.requires_human_measurement_entry, false);
  assert.equal(audit.evidence_boundary.human_measurement_entry_requested, false);
  assert.match(audit.evidence_boundary.hard_evidence_rule, /Only genuine completed physical\/supplier\/lab\/QA inspection records/);

  assert.equal(intake.summary?.genuine_inspection_evidence_found, false);
  assert.equal(intake.summary?.accepted_candidate_count, 0);
  assert.equal(intake.summary?.attachment_ready_candidate_count, 0);
  assert.equal(intake.summary?.requires_human_measurement_entry, false);
  assert.equal(Array.isArray(intake.accepted_candidates) ? intake.accepted_candidates.length : -1, 0);
  assert.equal(audit.source_classes.accepted_count, 0);
  assert.equal(audit.summary.accepted_candidate_count, 0);
  assert.equal(audit.attachment_ready.count, 0);

  assert.equal(dryRun.summary?.promotion_can_run, false);
  assert.equal(dryRun.summary?.canonical_artifacts_mutated, false);
  assert.equal(dryRun.summary?.ready_package_count, 0);

  assert.equal(audit.outputs.intake_report.path, `${OUTPUT_DIR}/intake_report.json`);
  assert.equal(audit.outputs.promotion_dry_run_manifest.path, `${OUTPUT_DIR}/promotion_dry_run_manifest.json`);
  assert.equal(audit.outputs.stage5b_audit_manifest.path, `${OUTPUT_DIR}/stage5b_audit_manifest.json`);
  assert.equal(audit.outputs.stage5b_audit_summary.path, `${OUTPUT_DIR}/stage5b_audit_summary.md`);
  assert.equal(dryRun.source_intake_report.path, audit.outputs.intake_report.path);

  assert(
    audit.canonical_package_readiness_states.length > 0,
    'audit should report canonical package readiness states'
  );
  audit.canonical_package_readiness_states.forEach((pkg) => {
    assert.equal(pkg.readiness_remains_held, true, `${pkg.slug} should remain held`);
    assert.equal(pkg.readiness_after?.status, 'needs_more_evidence', `${pkg.slug} should stay needs_more_evidence`);
    assert.equal(pkg.readiness_after?.gate_decision, 'hold_for_evidence_completion', `${pkg.slug} should stay held for evidence completion`);
  });

  assert.match(summaryMarkdown, /Genuine completed evidence found: no/);
  assert.match(summaryMarkdown, /Promotion can run: no/);
  assert.match(summaryMarkdown, /Readiness remains held: yes/);
} finally {
  rmSync(ABSOLUTE_OUTPUT_DIR, { recursive: true, force: true });
}

const canonicalFilesAfter = trackedDocsExampleFiles();
const canonicalStatusAfter = docsExamplesStatus();
const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);

assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'CLI smoke must not add or remove tracked docs/examples files');
assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'CLI smoke must not change docs/examples git status');
assert.equal(canonicalHashAfter, canonicalHashBefore, 'CLI smoke must not mutate canonical docs/examples package artifacts');

console.log('stage5b-evidence-audit-cli-smoke.test.js: ok');
