import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { discoverInspectionEvidenceIntake } from '../src/services/inspection-evidence-intake/inspection-evidence-intake-service.js';

const ROOT = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeValidInspectionEvidence(overrides = {}) {
  return {
    schema_version: '1.0',
    evidence_type: 'inspection_evidence',
    source_type: 'cmm_report',
    inspected_part: 'demo-intake-part',
    inspected_at: '2026-05-18T15:30:00Z',
    measurement_system: 'metric',
    units: 'mm',
    source_ref: 'docs/examples/demo-intake-part/inspection/cmm-report-001.json',
    measured_features: [
      {
        feature_id: 'mount_hole_a_diameter',
        drawing_ref: 'DEMO-DWG-001:A',
        requirement_ref: 'MOUNT_HOLE_A_DIA',
        nominal_value: 8,
        measured_value: 8.01,
        tolerance_upper: 0.05,
        tolerance_lower: -0.05,
        units: 'mm',
        result: 'pass',
        measurement_method: 'cmm_report',
      },
    ],
    overall_result: 'pass',
    ...overrides,
  };
}

function writeMinimalCanonicalPackage(projectRoot, slug, readiness = {}) {
  writeJson(join(projectRoot, 'docs/examples', slug, 'readiness/readiness_report.json'), {
    readiness_summary: {
      status: readiness.status || 'needs_more_evidence',
      score: readiness.score ?? 61,
      gate_decision: readiness.gate_decision || 'hold_for_evidence_completion',
      missing_inputs: readiness.missing_inputs || ['inspection_evidence'],
    },
  });
  writeJson(join(projectRoot, 'docs/examples', slug, 'review/review_pack.json'), {
    evidence_ledger: { records: [] },
    source_artifact_refs: [],
  });
}

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-inspection-intake-'));

try {
  const noValidReport = await discoverInspectionEvidenceIntake({
    projectRoot: ROOT,
    packageSlugs: ['quality-pass-bracket'],
    includeGitHub: false,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(noValidReport.artifact_type, 'inspection_evidence_intake_report');
  assert.equal(noValidReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(noValidReport.summary.requires_human_measurement_entry, false);
  assert.equal(noValidReport.packages.length, 1);
  assert.equal(noValidReport.packages[0].slug, 'quality-pass-bracket');
  assert.equal(noValidReport.packages[0].accepted_candidates.length, 0);
  assert.equal(noValidReport.packages[0].readiness_after.status, 'needs_more_evidence');
  assert.equal(noValidReport.packages[0].readiness_after.gate_decision, 'hold_for_evidence_completion');
  assert.equal(noValidReport.packages[0].classification, 'no_candidate');
  assert.equal(
    noValidReport.rejected_candidates.some((candidate) => (
      candidate.classification === 'invalid_generated'
      && /readiness_report\.json$/.test(candidate.path)
    )),
    true,
    'checked-in readiness reports must be rejected as generated/non-inspection artifacts'
  );
  assert.equal(
    noValidReport.rejected_candidates.some((candidate) => (
      candidate.classification === 'invalid_provenance'
      && candidate.path === 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
    )),
    true,
    'schema-valid fixtures must be rejected as non-genuine provenance'
  );

  writeMinimalCanonicalPackage(tempRoot, 'demo-intake-part');
  writeJson(
    join(tempRoot, 'docs/examples/demo-intake-part/inspection/cmm-report-001.json'),
    { source: 'completed external CMM report placeholder for provenance path existence' }
  );
  writeJson(
    join(tempRoot, 'docs/examples/demo-intake-part/inspection/inspection_evidence.json'),
    makeValidInspectionEvidence()
  );
  writeJson(
    join(tempRoot, 'docs/examples/demo-intake-part/quality/demo_create_quality.json'),
    { artifact_type: 'create_quality_report', schema_version: '1.0', checks: [] }
  );

  const validReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['demo-intake-part'],
    includeGitHub: false,
    trackedPaths: [
      'docs/examples/demo-intake-part/inspection/cmm-report-001.json',
      'docs/examples/demo-intake-part/inspection/inspection_evidence.json',
      'docs/examples/demo-intake-part/quality/demo_create_quality.json',
      'docs/examples/demo-intake-part/readiness/readiness_report.json',
      'docs/examples/demo-intake-part/review/review_pack.json',
    ],
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(validReport.summary.genuine_inspection_evidence_found, true);
  assert.equal(validReport.summary.accepted_candidate_count, 1);
  assert.equal(validReport.packages[0].classification, 'genuine_valid');
  assert.equal(validReport.packages[0].accepted_candidates[0].classification, 'genuine_valid');
  assert.equal(
    validReport.packages[0].accepted_candidates[0].path,
    'docs/examples/demo-intake-part/inspection/inspection_evidence.json'
  );
  assert.equal(validReport.packages[0].intake_action.status, 'ready_for_canonical_attachment');
  assert.match(
    validReport.packages[0].intake_action.canonical_commands.review_context.join(' '),
    /--inspection-evidence docs\/examples\/demo-intake-part\/inspection\/inspection_evidence\.json/
  );
  assert.equal(
    validReport.rejected_candidates.some((candidate) => candidate.classification === 'invalid_generated'),
    true,
    'valid path should still reject generated side artifacts as non-inspection evidence'
  );

  const cliOutPath = join(tempRoot, 'quality-pass-bracket-intake-report.json');
  const cli = spawnSync(process.execPath, [
    'bin/fcad.js',
    'inspection-evidence-intake',
    '--package',
    'quality-pass-bracket',
    '--out',
    cliOutPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.equal(existsSync(cliOutPath), true, 'CLI should write a machine-readable report');
  const cliReport = readJson(cliOutPath);
  assert.equal(cliReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(cliReport.summary.requires_human_measurement_entry, false);
  assert.match(cli.stdout, /Inspection evidence intake report:/);
  assert.doesNotMatch(cli.stdout + cli.stderr, /enter|type|provide measurement/i);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('inspection-evidence-intake.test.js: ok');
