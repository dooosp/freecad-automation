import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildStage5bEvidenceSourceKit,
  preflightStage5bEvidenceSource,
} from '../src/services/inspection-evidence-intake/stage5b-evidence-source-kit-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-06-05T00:00:00.000Z';
const PACKAGE_SLUG = 'quality-pass-bracket';
const INBOX_ROOT = `local/stage5b-candidate-evidence-inbox/${PACKAGE_SLUG}`;
const INBOX_SUBDIR = `source-kit-test-${process.pid}-${Date.now()}`;
const TEST_RUN_DIR = `${INBOX_ROOT}/${INBOX_SUBDIR}`;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function runFcad(args, label) {
  const result = spawnSync(process.execPath, ['bin/fcad.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
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

function validRawInspectionSource(overrides = {}) {
  return {
    package_id: PACKAGE_SLUG,
    inspected_part: 'quality-pass-bracket',
    part_revision: 'A',
    inspection_date: '2026-06-04',
    source_type: 'cmm_report',
    inspection_status: 'completed',
    inspector: 'Supplier QA Inspector',
    reviewed_by: 'Maintainer QA Reviewer',
    units: 'mm',
    overall_result: 'pass',
    measured_features: [
      {
        feature_id: 'hole_left_diameter',
        measured_value: 8.01,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'supplier_cmm',
      },
      {
        feature_id: 'hole_right_diameter',
        measured_value: 8,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'supplier_cmm',
      },
    ],
    ...overrides,
  };
}

function validRawInspectionCsv() {
  return [
    'package_id,inspected_part,part_revision,inspection_date,source_type,inspection_status,inspector,reviewed_by,units,overall_result,feature_id,measured_value,tolerance_upper,tolerance_lower,result,measurement_method',
    `${PACKAGE_SLUG},quality-pass-bracket,A,2026-06-04,cmm_report,completed,Supplier QA Inspector,Maintainer QA Reviewer,mm,pass,hole_left_diameter,8.01,0.05,-0.05,pass,supplier_cmm`,
    `${PACKAGE_SLUG},quality-pass-bracket,A,2026-06-04,cmm_report,completed,Supplier QA Inspector,Maintainer QA Reviewer,mm,pass,hole_right_diameter,8.00,0.05,-0.05,pass,supplier_cmm`,
  ].join('\n');
}

function findingCodes(report) {
  return [
    ...new Set([
      ...report.safety_findings.map((finding) => finding.code),
      ...report.source_findings.map((finding) => finding.code),
      ...report.required_field_checks
        .filter((check) => check.status !== 'pass')
        .map((check) => check.id),
    ]),
  ];
}

function assertPreflightBoundary(report) {
  assert.equal(report.acquisition_preflight_only, true);
  assert.equal(report.dry_run, true);
  assert.equal(report.summary.evidence_attached, false);
  assert.equal(report.summary.canonical_artifacts_mutated, false);
  assert.equal(report.summary.canonical_readiness_regenerated, false);
  assert.equal(report.readiness_unchanged.unchanged, true);
  assert.equal(report.readiness_unchanged.canonical_artifacts_mutated, false);
  assert.equal(report.evidence_boundary.does_not_attach_evidence, true);
  assert.equal(report.evidence_boundary.does_not_regenerate_readiness, true);
  assert.equal(report.evidence_boundary.later_attachment_flow_required, true);
}

const canonicalFiles = trackedDocsExampleFiles();
const canonicalStatusBefore = docsExamplesStatus();
const canonicalHashBefore = hashTrackedFiles(canonicalFiles);

try {
  const kit = await buildStage5bEvidenceSourceKit({
    projectRoot: ROOT,
    packageSlugs: [PACKAGE_SLUG],
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(kit.artifact_type, 'stage5b_evidence_source_kit');
  assert.equal(kit.acquisition_preflight_only, true);
  assert.equal(kit.summary.evidence_attached, false);
  assert.equal(kit.summary.canonical_artifacts_mutated, false);
  assert.equal(kit.inboxes.length, 1);
  assert.equal(kit.inboxes[0].package_slug, PACKAGE_SLUG);
  assert.equal(kit.inboxes[0].path, TEST_RUN_DIR);
  assert.equal(kit.inboxes[0].ignored_by_git, true);
  assert.equal(kit.inboxes[0].tracked_by_git, false);
  assert.equal(existsSync(join(ROOT, TEST_RUN_DIR, 'README.md')), true);
  assert.equal(existsSync(join(ROOT, TEST_RUN_DIR, 'inspection-evidence-template.json')), true);
  assert.equal(existsSync(join(ROOT, TEST_RUN_DIR, 'inspection-evidence-template.csv')), true);
  assert.match(readFileSync(join(ROOT, TEST_RUN_DIR, 'README.md'), 'utf8'), /acquisition\/preflight only/i);
  assert.match(readFileSync(join(ROOT, TEST_RUN_DIR, 'inspection-evidence-template.json'), 'utf8'), /TEMPLATE_ONLY_NOT_EVIDENCE/);
  assert.match(readFileSync(join(ROOT, TEST_RUN_DIR, 'inspection-evidence-template.csv'), 'utf8'), /TEMPLATE_ONLY_NOT_EVIDENCE/);

  const noSource = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(noSource.summary.source_status, 'READY_FOR_SOURCE');
  assert.equal(noSource.classification, 'needs_more_source_detail');
  assert.match(noSource.summary.message, /place a genuine completed inspection record/i);
  assertPreflightBoundary(noSource);

  const validJsonRel = `${TEST_RUN_DIR}/received-cmm-source.json`;
  writeJson(join(ROOT, validJsonRel), validRawInspectionSource());
  const validJsonReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: validJsonRel,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(validJsonReport.classification, 'ready_for_stage5b_review');
  assert.equal(validJsonReport.summary.source_status, 'SOURCE_PREFLIGHT_READY');
  assert.equal(validJsonReport.source.exists, true);
  assert.equal(validJsonReport.source.ignored_by_git, true);
  assert.equal(validJsonReport.source.tracked_by_git, false);
  assert.equal(validJsonReport.summary.required_fields_pass, true);
  assert.equal(validJsonReport.summary.ready_for_later_attachment_flow, true);
  assertPreflightBoundary(validJsonReport);

  const validCsvRel = `${TEST_RUN_DIR}/received-cmm-source.csv`;
  writeText(join(ROOT, validCsvRel), validRawInspectionCsv());
  const validCsvReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: validCsvRel,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(validCsvReport.classification, 'ready_for_stage5b_review');
  assert.equal(validCsvReport.source.source_format, 'csv');
  assert.equal(validCsvReport.summary.required_fields_pass, true);
  assertPreflightBoundary(validCsvReport);

  const cliOutRel = `${TEST_RUN_DIR}/preflight-report.json`;
  const cliRun = runFcad([
    'stage5b-evidence-source-preflight',
    '--package',
    PACKAGE_SLUG,
    '--inbox-subdir',
    INBOX_SUBDIR,
    '--source',
    validJsonRel,
    '--out',
    cliOutRel,
  ], 'stage5b-evidence-source-preflight valid source');
  assert.match(cliRun.stdout, /Stage 5B evidence source preflight:/);
  assert.match(cliRun.stdout, /Acquisition\/preflight only: yes/);
  assert.match(cliRun.stdout, /Inspection evidence attached: no/);
  assert.match(cliRun.stdout, /Canonical readiness regenerated: no/);
  assert.equal(readJson(join(ROOT, cliOutRel)).classification, 'ready_for_stage5b_review');

  const surrogateRel = `${TEST_RUN_DIR}/surrogate_inspection_validation.json`;
  writeJson(join(ROOT, surrogateRel), {
    artifact_type: 'surrogate_inspection_validation',
    summary: { evidence_attached: false },
    notes: 'Synthetic surrogate non-evidence generated from CAD/spec values.',
  });
  const surrogateReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: surrogateRel,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(surrogateReport.classification, 'unsafe_or_not_evidence');
  assert.match(findingCodes(surrogateReport).join('\n'), /surrogate_artifact_not_evidence|synthetic_or_generated_not_evidence|cad_or_generated_values_not_evidence/);
  assertPreflightBoundary(surrogateReport);

  const unsafeRel = `${TEST_RUN_DIR}/unsafe-private-source.json`;
  writeJson(join(ROOT, unsafeRel), validRawInspectionSource({
    inspector: 'qa.inspector@example.com',
    source_url: 'https://10.0.0.5/supplier/report?token=secret-token',
    notes: 'Supplier-private original. Authorization: Bearer abc123. Local raw path /Users/qa/private/report.xlsx',
  }));
  const unsafeReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: unsafeRel,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(unsafeReport.classification, 'unsafe_or_not_evidence');
  assert.match(findingCodes(unsafeReport).join('\n'), /potential_pii|private_url|absolute_local_path|token_or_secret|supplier_private_original/);
  assert(
    unsafeReport.safety_findings.every((finding) => typeof finding.redaction_guidance === 'string' && finding.redaction_guidance.length > 0),
    'unsafe findings should include redaction guidance'
  );
  assertPreflightBoundary(unsafeReport);

  const trackedFixtureReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json',
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(trackedFixtureReport.classification, 'unsafe_or_not_evidence');
  assert.equal(trackedFixtureReport.source.tracked_by_git, true);
  assert.match(findingCodes(trackedFixtureReport).join('\n'), /tracked_source_file|fixture_not_evidence/);
  assertPreflightBoundary(trackedFixtureReport);

  const readinessReport = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(readinessReport.classification, 'unsafe_or_not_evidence');
  assert.equal(readinessReport.source.tracked_by_git, true);
  assert.match(findingCodes(readinessReport).join('\n'), /readiness_artifact_not_evidence|docs_example_artifact_not_raw_source|tracked_source_file/);
  assertPreflightBoundary(readinessReport);

  const missingSource = await preflightStage5bEvidenceSource({
    projectRoot: ROOT,
    packageSlug: PACKAGE_SLUG,
    sourcePath: `${TEST_RUN_DIR}/missing-source.json`,
    inboxSubdir: INBOX_SUBDIR,
    generatedAt: GENERATED_AT,
  });
  assert.equal(missingSource.classification, 'needs_more_source_detail');
  assert.equal(missingSource.summary.source_status, 'READY_FOR_SOURCE');
  assert.match(findingCodes(missingSource).join('\n'), /source_path_not_found/);
  assertPreflightBoundary(missingSource);

  const canonicalFilesAfter = trackedDocsExampleFiles();
  const canonicalStatusAfter = docsExamplesStatus();
  const canonicalHashAfter = hashTrackedFiles(canonicalFilesAfter);
  assert.deepEqual(canonicalFilesAfter, canonicalFiles, 'source preflight must not add or remove tracked docs/examples files');
  assert.equal(canonicalStatusAfter, canonicalStatusBefore, 'source preflight must not change docs/examples git status');
  assert.equal(canonicalHashAfter, canonicalHashBefore, 'source preflight must not mutate canonical docs/examples package artifacts');
} finally {
  rmSync(join(ROOT, TEST_RUN_DIR), { recursive: true, force: true });
}

console.log('stage5b-evidence-source-kit.test.js: ok');
