import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  isCleanDetachedStage5bPipelineDoctorCheckout,
} from '../src/services/inspection-evidence-intake/stage5b-evidence-pipeline-doctor-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_SLUG = 'quality-pass-bracket';
const RUN_ID = `${process.pid}-${Date.now()}`;
const OUTPUT_DIR = `output/stage5b-pipeline-doctor-${RUN_ID}`;
const MISSING_OUTPUT_DIR = `${OUTPUT_DIR}-missing-command`;
const INBOX_SUBDIR = `pipeline-doctor-${RUN_ID}`;
const MANIFEST_NAME = 'stage5b_evidence_pipeline_doctor_manifest.json';
const RAW_MARKER = 'RAW_STAGE5B_PIPELINE_DOCTOR_DO_NOT_COPY';
const EXACT_NEXT_STEP = `Later, after a genuine completed physical/supplier/lab/QA inspection record is received for ${PACKAGE_SLUG}, keep the raw record in local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}/, rerun source-preflight, rerun review-dry-run without --fixture, complete the Stage 5B attachment authorization record, rerun the attachment controller with --dry-run, and only then start a separate explicit real evidence attachment/regeneration goal.`;

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

function runFcad(args, label, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, ['bin/fcad.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    expectStatus,
    `${label} unexpected status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result;
}

function trackedDocsExampleFiles() {
  return runGit(['ls-files', 'docs/examples'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function docsExamplesStatus() {
  return runGit(['status', '--short', '--', 'docs/examples']);
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

function assertNoRawMarkerCopied(outDir) {
  const grep = spawnSync('grep', ['-R', RAW_MARKER, outDir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(grep.status, 1, `raw private marker must not be copied into ${outDir}:\n${grep.stdout}`);
}

function assertIgnored(path) {
  const result = spawnSync('git', ['check-ignore', '-q', '--', path], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${path} should be ignored by git`);
}

function assertNoTrackedInboxFiles(inboxSubdir) {
  const tracked = runGit(['ls-files', '--', `local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}/${inboxSubdir}`]);
  assert.equal(tracked.trim(), '', 'doctor raw inbox files must not be tracked');
}

function commandNames(manifest) {
  return manifest.commands_run.map((entry) => entry.name);
}

function guardByKind(manifest, kind) {
  return manifest.non_evidence_guards.find((entry) => entry.kind === kind);
}

const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  assert.equal(isCleanDetachedStage5bPipelineDoctorCheckout({
    current_branch: null,
    head_sha: 'abc123',
    dirty_tree: false,
    checkout_safety: {
      detached_head: true,
      clean_detached_head_checkout_ok: true,
    },
  }), true, 'clean detached CI checkout should be accepted by the doctor preflight');
  assert.equal(isCleanDetachedStage5bPipelineDoctorCheckout({
    current_branch: null,
    head_sha: 'abc123',
    dirty_tree: true,
    checkout_safety: {
      detached_head: true,
      clean_detached_head_checkout_ok: false,
    },
  }), false, 'dirty detached checkout should still be unsafe');

  const run = runFcad([
    'stage5b-evidence-pipeline-doctor',
    '--package',
    PACKAGE_SLUG,
    '--out-dir',
    OUTPUT_DIR,
    '--inbox-subdir',
    INBOX_SUBDIR,
  ], 'stage5b evidence pipeline doctor fixture run');
  assert.match(run.stdout, /Stage 5B evidence pipeline doctor:/);
  assert.match(run.stdout, /Fixture-only diagnostic: yes/);
  assert.match(run.stdout, /Canonical readiness remains held: yes/);

  const manifestPath = join(ROOT, OUTPUT_DIR, MANIFEST_NAME);
  assert.equal(existsSync(manifestPath), true, 'pipeline doctor manifest should be written');
  const manifest = readJson(manifestPath);

  assert.equal(manifest.artifact_type, 'stage5b_evidence_pipeline_doctor_manifest');
  assert.equal(manifest.schema_version, '1.0');
  assert.equal(manifest.fixture_only, true);
  assert.equal(manifest.non_mutating, true);
  assert.equal(manifest.package_slug, PACKAGE_SLUG);
  assert.equal(manifest.summary.decision, 'pass');
  assert.equal(manifest.summary.pipeline_status, 'pass_fixture_only_readiness_held');
  assert.equal(manifest.summary.evidence_attached, false);
  assert.equal(manifest.summary.canonical_artifacts_mutated, false);
  assert.equal(manifest.summary.canonical_readiness_regenerated, false);
  assert.equal(manifest.summary.packages_marked_ready, false);
  assert.equal(manifest.summary.readiness_status, 'needs_more_evidence');
  assert.equal(manifest.summary.readiness_gate_decision, 'hold_for_evidence_completion');
  assert.equal(manifest.readiness_held_truth.readiness_remains_held, true);
  assert.equal(manifest.readiness_held_truth.status, 'needs_more_evidence');
  assert.equal(manifest.readiness_held_truth.gate_decision, 'hold_for_evidence_completion');
  assert.equal(manifest.next_human_step.instructions, EXACT_NEXT_STEP);
  assert.equal(manifest.evidence_boundary.pipeline_doctor_does_not_attach_evidence, true);
  assert.equal(manifest.evidence_boundary.pipeline_doctor_does_not_promote_evidence, true);
  assert.equal(manifest.evidence_boundary.pipeline_doctor_does_not_regenerate_readiness, true);
  assert.equal(manifest.evidence_boundary.later_explicit_real_attachment_regeneration_goal_required, true);

  assert.deepEqual(commandNames(manifest), [
    'stage5b-evidence-source-kit',
    'stage5b-evidence-source-preflight',
    'stage5b-surrogate-inspection-validation',
    'stage5b-evidence-review-dry-run',
    'stage5b-evidence-attachment-controller',
  ]);
  const attachmentStep = manifest.commands_run.find((entry) => entry.name === 'stage5b-evidence-attachment-controller');
  assert.equal(attachmentStep.expected_status, 2);
  assert.equal(attachmentStep.status, 'expected_hold');
  assert.equal(attachmentStep.accepted_as_fail_closed, true);
  assert.match(attachmentStep.blocker_codes.join('\n'), /authorization_record_missing/);

  for (const kind of ['surrogate', 'generated', 'docs', 'ci', 'readiness', 'cad']) {
    const guard = guardByKind(manifest, kind);
    assert(guard, `missing non-evidence guard for ${kind}`);
    assert.equal(guard.canonical_evidence_eligible, false, `${kind} guard must not be evidence-eligible`);
    assert.equal(guard.evidence_attached, false, `${kind} guard must not attach evidence`);
    assert.equal(guard.classification, 'unsafe_or_not_evidence', `${kind} should be rejected before evidence flow`);
  }

  assert.equal(manifest.raw_private_copy_guard.marker_copied_to_output, false);
  assertNoRawMarkerCopied(OUTPUT_DIR);
  assertIgnored(OUTPUT_DIR);
  assertIgnored(`local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}/${INBOX_SUBDIR}`);
  assertNoTrackedInboxFiles(INBOX_SUBDIR);

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'doctor must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'doctor must not change docs/examples git status');
  assert.equal(canonicalHashAfter, canonicalHashBefore, 'doctor must not mutate canonical docs/examples package artifacts');

  const missingRun = runFcad([
    'stage5b-evidence-pipeline-doctor',
    '--package',
    PACKAGE_SLUG,
    '--out-dir',
    MISSING_OUTPUT_DIR,
    '--inbox-subdir',
    `${INBOX_SUBDIR}-missing`,
    '--require-command',
    'stage5b-missing-subcommand',
  ], 'stage5b evidence pipeline doctor missing command run', { expectStatus: 2 });
  assert.match(missingRun.stdout + missingRun.stderr, /stage5b-missing-subcommand/);
  const missingManifest = readJson(join(ROOT, MISSING_OUTPUT_DIR, MANIFEST_NAME));
  assert.equal(missingManifest.summary.decision, 'hold');
  assert.equal(missingManifest.summary.pipeline_status, 'hold_for_pipeline_doctor_blockers');
  assert.match(missingManifest.blockers.map((entry) => entry.code).join('\n'), /command_missing_from_manifest/);
  assert.match(missingManifest.blockers.map((entry) => entry.message).join('\n'), /stage5b-missing-subcommand/);
  assert.equal(missingManifest.summary.evidence_attached, false);
  assert.equal(missingManifest.summary.readiness_status, 'needs_more_evidence');
  assert.equal(missingManifest.summary.readiness_gate_decision, 'hold_for_evidence_completion');
} finally {
  rmSync(join(ROOT, OUTPUT_DIR), { recursive: true, force: true });
  rmSync(join(ROOT, MISSING_OUTPUT_DIR), { recursive: true, force: true });
  rmSync(join(ROOT, 'local', 'stage5b-candidate-evidence-inbox', PACKAGE_SLUG, INBOX_SUBDIR), { recursive: true, force: true });
  rmSync(join(ROOT, 'local', 'stage5b-candidate-evidence-inbox', PACKAGE_SLUG, `${INBOX_SUBDIR}-missing`), { recursive: true, force: true });
}

console.log('stage5b-evidence-pipeline-doctor.test.js: ok');
