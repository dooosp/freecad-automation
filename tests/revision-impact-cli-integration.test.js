import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, parse, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin/fcad.js');
const REVIEW_PACK = join(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json');
const REVISION_IMPACT_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/revision-impact');
const TMP_ROOT = join(ROOT, 'tmp/codex');
mkdirSync(TMP_ROOT, { recursive: true });
const workDir = mkdtempSync(join(TMP_ROOT, 'revision-impact-cli-'));

function runComparePair(baselinePath, candidatePath, args) {
  return spawnSync('node', [CLI, 'compare-rev', baselinePath, candidatePath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function runCompare(args) {
  return runComparePair(REVIEW_PACK, REVIEW_PACK, args);
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function runFixedFixtureTwice({ name, baseline, candidate, generatedAt }) {
  const outputs = [];
  for (const runName of ['first', 'second']) {
    const outputDir = join(workDir, `${name}-${runName}`);
    mkdirSync(outputDir, { recursive: true });
    const legacyPath = join(outputDir, 'revision_comparison.json');
    const impactPath = join(outputDir, 'revision_impact_report.json');
    const markdownPath = join(outputDir, 'revision_impact_report.md');
    const result = runComparePair(
      join(REVISION_IMPACT_FIXTURE_ROOT, baseline),
      join(REVISION_IMPACT_FIXTURE_ROOT, candidate),
      ['--out', legacyPath, '--impact-out', impactPath, '--generated-at', generatedAt]
    );
    assert.equal(result.status, 0, `${name}/${runName}\n${result.stdout}\n${result.stderr}`);
    outputs.push({
      report: readJson(impactPath),
      jsonBytes: readFileSync(impactPath),
      markdownBytes: readFileSync(markdownPath),
    });
  }
  assert.deepEqual(outputs[0].jsonBytes, outputs[1].jsonBytes, `${name} JSON must be byte-identical`);
  assert.deepEqual(outputs[0].markdownBytes, outputs[1].markdownBytes, `${name} Markdown must be byte-identical`);
  return outputs[0].report;
}

try {
  const legacyOnlyPath = join(workDir, 'legacy_only.json');
  const legacyOnly = runCompare(['--out', legacyOnlyPath]);
  assert.equal(legacyOnly.status, 0, `${legacyOnly.stdout}\n${legacyOnly.stderr}`);
  assert.equal(readJson(legacyOnlyPath).artifact_type, 'revision_comparison');
  assert.equal(existsSync(join(workDir, 'revision_impact_report.json')), false);

  const legacyPath = join(workDir, 'comparison.json');
  const impactPath = join(workDir, 'revision_impact_report.json');
  const impactMarkdownPath = join(workDir, 'revision_impact_report.md');
  const fixedGeneratedAt = '2026-07-11T00:00:00Z';
  const withImpact = runCompare([
    '--out', legacyPath,
    '--impact-out', impactPath,
    '--generated-at', fixedGeneratedAt,
  ]);
  assert.equal(withImpact.status, 0, `${withImpact.stdout}\n${withImpact.stderr}`);
  assert.equal(readJson(legacyPath).artifact_type, 'revision_comparison');
  assert.equal(readJson(impactPath).artifact_type, 'revision_impact_report');
  assert.equal(readJson(impactPath).generated_at, fixedGeneratedAt);
  assert.equal(existsSync(impactMarkdownPath), true);

  const defaultTimeLegacyPath = join(workDir, 'default_time_comparison.json');
  const defaultTimeImpactPath = join(workDir, 'default_time_revision_impact_report.json');
  const withDefaultGeneratedAt = runCompare([
    '--out', defaultTimeLegacyPath,
    '--impact-out', defaultTimeImpactPath,
  ]);
  assert.equal(
    withDefaultGeneratedAt.status,
    0,
    `${withDefaultGeneratedAt.stdout}\n${withDefaultGeneratedAt.stderr}`
  );
  assert.equal(
    readJson(defaultTimeImpactPath).generated_at,
    readJson(defaultTimeLegacyPath).generated_at,
    'optional --generated-at should reuse the comparison invocation timestamp'
  );

  const parsedLegacy = parse(legacyPath);
  const manifestPath = join(parsedLegacy.dir, `${parsedLegacy.name}_artifact-manifest.json`);
  const manifest = readJson(manifestPath);
  assert.equal(manifest.artifacts.some((entry) => entry.type === 'revision-comparison.json'), true);
  assert.equal(manifest.artifacts.some((entry) => entry.type === 'revision-impact.report-json' && basename(entry.path) === 'revision_impact_report.json'), true);
  assert.equal(manifest.artifacts.some((entry) => entry.type === 'revision-impact.report-markdown' && basename(entry.path) === 'revision_impact_report.md'), true);

  const ignoredOutput = join(workDir, 'must_not_exist.json');
  const withoutImpact = runCompare(['--out', ignoredOutput, '--generated-at', fixedGeneratedAt]);
  assert.notEqual(withoutImpact.status, 0);
  assert.match(withoutImpact.stderr, /require --impact-out/i);
  assert.equal(existsSync(ignoredOutput), false);

  const collidingOutput = join(workDir, 'colliding-output.json');
  const collision = runCompare([
    '--out', collidingOutput,
    '--impact-out', collidingOutput,
    '--generated-at', fixedGeneratedAt,
  ]);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /must use distinct paths/i);
  assert.equal(existsSync(collidingOutput), false);

  const malformedReadiness = join(workDir, 'malformed-readiness.json');
  writeFileSync(malformedReadiness, '{"artifact_type":"readiness_report",', 'utf8');
  const validationLegacyOutput = join(workDir, 'validation_must_precede_legacy_write.json');
  const validationImpactOutput = join(workDir, 'validation_must_precede_impact_write.json');
  const invalidInput = runCompare([
    '--out', validationLegacyOutput,
    '--impact-out', validationImpactOutput,
    '--baseline-readiness', malformedReadiness,
  ]);
  assert.notEqual(invalidInput.status, 0);
  assert.equal(existsSync(validationLegacyOutput), false);
  assert.equal(existsSync(validationImpactOutput), false);

  const unchangedReport = runFixedFixtureTwice({
    name: 'unchanged',
    baseline: 'unchanged-review-pack.json',
    candidate: 'unchanged-review-pack.json',
    generatedAt: fixedGeneratedAt,
  });
  assert.equal(unchangedReport.summary.decision, 'no_material_change');
  assert.equal(unchangedReport.summary.reinspection_required_count, 0);
  assert.equal(unchangedReport.reinspection_plan.items.length, 0);
  assert.equal(unchangedReport.boundaries.canonical_artifacts_mutated, false);
  assert.equal(unchangedReport.boundaries.inspection_evidence_attached, false);

  const toleranceReport = runFixedFixtureTwice({
    name: 'tightened-tolerance',
    baseline: 'tightened-tolerance-baseline-review-pack.json',
    candidate: 'tightened-tolerance-candidate-review-pack.json',
    generatedAt: fixedGeneratedAt,
  });
  const toleranceChange = toleranceReport.changes.find((change) => change.change_type === 'tolerance_change');
  assert.equal(toleranceReport.summary.decision, 'reinspection_required');
  assert.equal(toleranceChange?.affected_entity_id, 'CHAR.HOLE_DIAMETER');
  assert.equal(
    toleranceReport.evidence_applicability.assessments.some((assessment) => (
      assessment.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
      && assessment.applicability_status === 'reinspection_required'
      && assessment.authoritative_evidence_state_changed === false
    )),
    true
  );
  assert.equal(toleranceReport.reinspection_plan.items.length, 1);
  assert.equal(toleranceReport.boundaries.readiness_regenerated, false);

  const missingIdentityReport = runFixedFixtureTwice({
    name: 'missing-identity',
    baseline: 'missing-identity-baseline-review-pack.json',
    candidate: 'missing-identity-candidate-review-pack.json',
    generatedAt: fixedGeneratedAt,
  });
  assert.equal(missingIdentityReport.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.ok(missingIdentityReport.summary.unable_to_determine_count > 0);
  assert.equal(
    missingIdentityReport.changes.some((change) => (
      change.change_type === 'unresolved_identity_change'
      && change.determinability === 'unable_to_determine'
      && change.affected_entity_id === null
    )),
    true,
    'missing identity must remain unresolved without a guessed entity mapping'
  );

  console.log('revision-impact-cli-integration.test.js: ok');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
