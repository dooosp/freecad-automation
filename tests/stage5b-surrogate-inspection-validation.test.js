import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  evaluateStage5bCandidateEvidence,
} from '../lib/stage5b-candidate-evidence-gate.js';
import {
  validateStage5bArtifact,
  validateStage5bAuditManifest,
  validateStage5bSurrogateInspectionValidation,
} from '../lib/stage5b-artifact-contracts.js';
import {
  validateAttachableInspectionEvidence,
  validateInspectionEvidence,
} from '../lib/inspection-evidence.js';
import {
  writeStage5bSurrogateInspectionValidationBundle,
} from '../src/services/inspection-evidence-intake/stage5b-surrogate-inspection-validation-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = `output/stage5b-surrogate-validation-${process.pid}-${Date.now()}`;
const CLI_OUTPUT_DIR = `${OUTPUT_DIR}-cli`;
const MANIFEST_NAME = 'surrogate_inspection_validation.json';

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

function assertPassesValidation(label, validation) {
  assert.equal(validation.ok, true, `${label} should validate:\n${validation.errors.join('\n')}`);
}

function assertFailsValidation(label, validation, pattern) {
  assert.equal(validation.ok, false, `${label} should fail validation`);
  assert.match(validation.errors.join('\n'), pattern, `${label} should explain the failure`);
}

function assertHeldReadiness(readiness, label) {
  assert.equal(readiness?.status, 'needs_more_evidence', `${label} should remain needs_more_evidence`);
  assert.equal(readiness?.gate_decision, 'hold_for_evidence_completion', `${label} should remain held`);
  assert.equal(
    Array.isArray(readiness?.missing_inputs) && readiness.missing_inputs.includes('inspection_evidence'),
    true,
    `${label} should keep inspection_evidence missing`
  );
}

function assertSurrogateRecordBoundary(record, slug) {
  assert.equal(record.evidence_type, 'inspection_evidence');
  assert.equal(record.package_id, slug);
  assert.equal(record.inspected_part, slug);
  assert.match(record.notes, /synthetic/i);
  assert.match(record.notes, /surrogate/i);
  assert.match(record.notes, /non-evidence/i);
  assert.match(record.source_ref, new RegExp(`^docs/examples/${slug}/inspection/surrogate_`));

  assertPassesValidation(
    `${slug} surrogate inspection-shaped parser record`,
    validateInspectionEvidence(record)
  );
  assertFailsValidation(
    `${slug} surrogate record as attachable inspection evidence`,
    validateAttachableInspectionEvidence(record, {
      evidencePath: `docs/examples/${slug}/inspection/surrogate_inspection_validation.json`,
      expectedPackageSlug: slug,
    }),
    /synthetic|generated|non-evidence|CAD|simulated|inferred/i
  );

  assert(record.measured_features.length > 0, `${slug} should include representative measured features`);
  for (const feature of record.measured_features) {
    assert.match(String(feature.nominal_value), /^SURROGATE_NON_EVIDENCE:/);
    assert.match(String(feature.measured_value), /^SURROGATE_NON_EVIDENCE:/);
    assert.match(String(feature.measurement_method), /synthetic_surrogate_non_evidence/i);
    assert.equal(feature.value_origin, 'repo_local_spec_surrogate_non_evidence');
    assert.equal(feature.canonical_evidence_eligible, false);
  }
}

function assertSurrogateManifest(manifest, { slug }) {
  assert.equal(manifest.artifact_type, 'surrogate_inspection_validation');
  assert.equal(manifest.dry_run, true);
  assert.equal(manifest.non_evidence, true);
  assert.equal(manifest.surrogate_lane_only, true);
  assert.equal(manifest.summary.package_count, 1);
  assert.equal(manifest.summary.surrogate_package_count, 1);
  assert.equal(manifest.summary.surrogate_record_count > 0, true);
  assert.equal(manifest.summary.surrogate_records_accepted_by_surrogate_lane > 0, true);
  assert.equal(manifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(manifest.summary.evidence_attached, false);
  assert.equal(manifest.summary.product_inspection_readiness, false);
  assert.equal(manifest.summary.canonical_artifacts_mutated, false);
  assert.equal(manifest.summary.readiness_remains_held, true);
  assert.match(manifest.summary.readiness_truth, /needs_more_evidence \/ hold_for_evidence_completion/);
  assert.equal(manifest.evidence_boundary.synthetic_surrogate_values_are_not_evidence, true);
  assert.equal(manifest.evidence_boundary.surrogate_records_cannot_unlock_readiness, true);
  assert.equal(manifest.evidence_boundary.canonical_evidence_attached, false);
  assert.equal(manifest.evidence_boundary.product_inspection_readiness, false);
  assert.match(manifest.evidence_boundary.hard_evidence_rule, /Only genuine completed physical\/supplier\/lab\/QA inspection records/);
  assert.deepEqual(manifest.requested_package_slugs, [slug]);

  assertPassesValidation('surrogate inspection validation schema/semantics', validateStage5bSurrogateInspectionValidation(manifest));
  assertPassesValidation('surrogate inspection validation artifact dispatcher', validateStage5bArtifact(manifest));

  const pkg = manifest.packages[0];
  assert.equal(pkg.slug, slug);
  assert.equal(pkg.surrogate_lane.status, 'accepted_surrogate_non_evidence');
  assert.equal(pkg.surrogate_lane.parser_contract_validated, true);
  assert.equal(pkg.surrogate_lane.redaction_contract_validated, true);
  assert.equal(pkg.surrogate_lane.package_mapping_validated, true);
  assert.equal(pkg.surrogate_lane.audit_reporting_validated, true);
  assert.equal(pkg.canonical_evidence_rejection.candidate_gate_decision, 'reject');
  assert.equal(pkg.canonical_evidence_rejection.attachable_evidence_valid, false);
  assert.equal(pkg.canonical_evidence_rejection.canonical_intake_classification, 'invalid_generated');
  assert.equal(pkg.canonical_evidence_rejection.evidence_attached, false);
  assert.equal(pkg.canonical_evidence_rejection.product_inspection_readiness, false);
  assert.match(pkg.canonical_evidence_rejection.rejection_codes.join('\n'), /non_genuine_candidate_wording|cad_generated_measurement_not_evidence/);
  assertHeldReadiness(pkg.readiness_after_surrogate, `${slug} surrogate readiness`);

  assert.equal(pkg.surrogate_records.length > 0, true, `${slug} should have surrogate records`);
  pkg.surrogate_records.forEach((entry) => {
    assert.equal(entry.artifact_type, 'synthetic_stage5b_pipeline_fixture');
    assert.equal(entry.surrogate_lane_only, true);
    assert.equal(entry.synthetic, true);
    assert.equal(entry.non_evidence, true);
    assert.equal(entry.canonical_evidence_eligible, false);
    assertSurrogateRecordBoundary(entry.inspection_shape, slug);
  });
}

const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  const result = await writeStage5bSurrogateInspectionValidationBundle({
    projectRoot: ROOT,
    outDir: OUTPUT_DIR,
    packageSlugs: ['quality-pass-bracket'],
    generatedAt: '2026-06-05T00:00:00.000Z',
  });
  const manifestPath = join(ROOT, OUTPUT_DIR, MANIFEST_NAME);
  assert.equal(result.manifest_path, `${OUTPUT_DIR}/${MANIFEST_NAME}`);
  assert.equal(existsSync(manifestPath), true, 'surrogate validation manifest should be written');

  const manifest = readJson(manifestPath);
  assertSurrogateManifest(manifest, { slug: 'quality-pass-bracket' });

  const auditManifestPath = join(ROOT, manifest.canonical_evidence_audit.outputs.stage5b_audit_manifest.path);
  assert.equal(existsSync(auditManifestPath), true, 'surrogate lane should write the canonical no-evidence audit too');
  const auditManifest = readJson(auditManifestPath);
  assertPassesValidation('surrogate canonical no-evidence audit manifest', validateStage5bAuditManifest(auditManifest));
  assert.equal(auditManifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(auditManifest.summary.promotion_can_run, false);
  assert.equal(auditManifest.summary.readiness_remains_held, true);

  const surrogateAsEvidence = evaluateStage5bCandidateEvidence({
    document: manifest,
    candidatePath: 'docs/examples/quality-pass-bracket/inspection/surrogate_inspection_validation.json',
    generatedAt: '2026-06-05T00:00:00.000Z',
  });
  assert.equal(surrogateAsEvidence.decision.result, 'reject');
  assert.match(
    surrogateAsEvidence.summary.rejection_codes.join('\n'),
    /generated_control_artifact_type_not_evidence|inspection_evidence_schema_invalid|non_genuine_candidate_wording/
  );

  const cliRun = spawnSync(process.execPath, [
    'bin/fcad.js',
    'stage5b-surrogate-inspection-validation',
    '--package',
    'quality-pass-bracket',
    '--out-dir',
    CLI_OUTPUT_DIR,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(cliRun.status, 0, `CLI surrogate validation failed\nstdout:\n${cliRun.stdout}\nstderr:\n${cliRun.stderr}`);
  assert.match(cliRun.stdout, /Stage 5B surrogate inspection validation:/);
  assert.match(cliRun.stdout, /Surrogate records accepted by surrogate lane: [1-9]/);
  assert.match(cliRun.stdout, /Inspection evidence attached: no/);
  assert.match(cliRun.stdout, /Canonical readiness remains held: yes/);

  const cliManifest = readJson(join(ROOT, CLI_OUTPUT_DIR, MANIFEST_NAME));
  assertSurrogateManifest(cliManifest, { slug: 'quality-pass-bracket' });

  const unsupported = spawnSync(process.execPath, [
    'bin/fcad.js',
    'stage5b-surrogate-inspection-validation',
    '--inspection-evidence',
    'docs/examples/quality-pass-bracket/inspection/inspection_evidence.json',
    '--out-dir',
    `${OUTPUT_DIR}/unsupported`,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(unsupported.status, 0, 'surrogate lane must reject real-evidence attachment options');
  assert.match(unsupported.stderr + unsupported.stdout, /does not accept option|Unsupported option/i);

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'surrogate lane must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'surrogate lane must not change docs/examples git status');
  assert.equal(canonicalHashAfter, canonicalHashBefore, 'surrogate lane must not mutate canonical docs/examples package artifacts');
} finally {
  rmSync(join(ROOT, OUTPUT_DIR), { recursive: true, force: true });
  rmSync(join(ROOT, CLI_OUTPUT_DIR), { recursive: true, force: true });
}

console.log('stage5b-surrogate-inspection-validation.test.js: ok');
