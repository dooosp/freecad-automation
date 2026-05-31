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

function writeText(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function makeFetchResponse(body, options = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name) {
        const normalized = String(name || '').toLowerCase();
        if (normalized === 'content-length') return String(options.contentLength ?? buffer.length);
        if (normalized === 'content-type') return options.contentType || 'text/plain';
        return null;
      },
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    async text() {
      return buffer.toString('utf8');
    },
  };
}

function makeGithubRunner({ issueBody = '', fail = false } = {}) {
  return async function githubRunner(command, args = []) {
    assert.equal(command, 'gh');
    if (fail) throw new Error('gh unavailable for fixture test');
    if (args[0] === '--version') {
      return { stdout: 'gh version 2.50.0\n' };
    }
    if (args[0] === 'search' && args[1] === 'issues') {
      return {
        stdout: JSON.stringify(issueBody ? [{
          number: 911,
          title: 'Supplier inspection evidence candidate',
          state: 'open',
          url: 'https://github.com/dooosp/freecad-automation/issues/911',
          isPullRequest: false,
          body: issueBody,
          updatedAt: '2026-05-23T00:00:00Z',
        }] : []),
      };
    }
    if (args[0] === 'api') {
      return { stdout: '[]' };
    }
    if (args[0] === 'release') {
      return { stdout: '[]' };
    }
    return { stdout: '[]' };
  };
}

function makeStoredZipEntry(name, content) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const contentBuffer = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(contentBuffer.length, 18);
  header.writeUInt32LE(contentBuffer.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer, contentBuffer]);
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

function writeFeatureProfile(projectRoot, slug, {
  featureId = 'mount_hole_a_diameter',
  requirementId = 'MOUNT_HOLE_A_DIA',
  valueMm = 8,
} = {}) {
  writeJson(join(projectRoot, 'docs/examples', slug, 'drawing', `${slug.replaceAll('-', '_')}_feature_catalog.json`), {
    artifact_type: 'feature_catalog',
    features: [
      {
        id: featureId,
        type: 'hole',
        dimensions: {
          diameter_mm: valueMm,
        },
      },
    ],
  });
  writeJson(join(projectRoot, 'docs/examples', slug, 'drawing', `${slug.replaceAll('-', '_')}_drawing_intent.json`), {
    required_dimensions: [
      {
        id: requirementId,
        feature: featureId,
        label: `${featureId} diameter`,
        dimension_type: 'diameter',
        value_mm: valueMm,
        required: true,
      },
    ],
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
  assert.equal(noValidReport.packages[0].attachment_plan.attachment_ready, false);
  assert.equal(noValidReport.packages[0].attachment_plan.match_confidence, 'none');
  assert.equal(
    noValidReport.packages[0].attachment_plan.blockers.includes('no_genuine_valid_candidate'),
    true
  );
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

  writeMinimalCanonicalPackage(tempRoot, 'diagnostics-boundary-part');
  writeJson(
    join(tempRoot, 'docs/examples/diagnostics-boundary-part/inspection/validation_diagnostics.json'),
    {
      artifact_type: 'stage5b_validation_diagnostics',
      validation_status: 'failed',
      diagnostics: [],
      evidence_boundary_note: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    }
  );
  const diagnosticsBoundaryReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['diagnostics-boundary-part'],
    trackedPaths: [
      'docs/examples/diagnostics-boundary-part/inspection/validation_diagnostics.json',
      'docs/examples/diagnostics-boundary-part/readiness/readiness_report.json',
      'docs/examples/diagnostics-boundary-part/review/review_pack.json',
    ],
    includeGitHub: false,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  assert.equal(diagnosticsBoundaryReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(diagnosticsBoundaryReport.packages[0].readiness_after.gate_decision, 'hold_for_evidence_completion');
  assert.equal(
    diagnosticsBoundaryReport.rejected_candidates.some((candidate) => (
      candidate.classification === 'invalid_generated'
      && candidate.path === 'docs/examples/diagnostics-boundary-part/inspection/validation_diagnostics.json'
    )),
    true,
    'validation_diagnostics.json must stay generated/control metadata, never inspection_evidence'
  );

  writeMinimalCanonicalPackage(tempRoot, 'demo-intake-part');
  writeFeatureProfile(tempRoot, 'demo-intake-part');
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
  assert.equal(validReport.packages[0].accepted_candidates[0].matched_package, 'demo-intake-part');
  assert.equal(validReport.packages[0].accepted_candidates[0].match_confidence, 'high');
  assert.deepEqual(
    validReport.packages[0].accepted_candidates[0].matched_features.map((feature) => feature.candidate_feature_id),
    ['mount_hole_a_diameter']
  );
  assert.deepEqual(validReport.packages[0].accepted_candidates[0].missing_required_features, []);
  assert.equal(validReport.packages[0].accepted_candidates[0].attachment_ready, true);
  assert.equal(
    validReport.packages[0].accepted_candidates[0].path,
    'docs/examples/demo-intake-part/inspection/inspection_evidence.json'
  );
  assert.equal(validReport.packages[0].intake_action.status, 'ready_for_canonical_attachment');
  assert.equal(validReport.packages[0].attachment_plan.matched_package, 'demo-intake-part');
  assert.equal(validReport.packages[0].attachment_plan.match_confidence, 'high');
  assert.equal(validReport.packages[0].attachment_plan.attachment_ready, true);
  assert.equal(
    validReport.packages[0].attachment_plan.canonical_next_command.join(' '),
    validReport.packages[0].intake_action.canonical_commands.review_context.join(' ')
  );
  assert.match(
    validReport.packages[0].intake_action.canonical_commands.review_context.join(' '),
    /--inspection-evidence docs\/examples\/demo-intake-part\/inspection\/inspection_evidence\.json/
  );
  assert.match(
    validReport.packages[0].intake_action.canonical_commands.review_context.join(' '),
    /--attachment-authorization docs\/examples\/demo-intake-part\/inspection\/stage5b_attachment_authorization\.json/
  );
  assert.equal(
    validReport.rejected_candidates.some((candidate) => candidate.classification === 'invalid_generated'),
    true,
    'valid path should still reject generated side artifacts as non-inspection evidence'
  );

  writeMinimalCanonicalPackage(tempRoot, 'table-intake-part');
  writeText(
    join(tempRoot, 'docs/examples/table-intake-part/inspection/cmm-report-rows.csv'),
    [
      'schema_version,evidence_type,source_type,inspected_part,inspected_at,units,source_ref,overall_result,feature_id,drawing_ref,requirement_ref,nominal_value,measured_value,tolerance_upper,tolerance_lower,result,measurement_method',
      '1.0,inspection_evidence,cmm_report,table-intake-part,2026-05-20T10:00:00Z,mm,docs/examples/table-intake-part/inspection/cmm-report-rows.csv,pass,hole_a,DWG-1:A,HOLE_A_DIA,8,8.01,0.05,-0.05,pass,cmm_report',
    ].join('\n')
  );
  writeText(
    join(tempRoot, 'docs/examples/table-intake-part/quality/table_create_quality.csv'),
    'artifact_type,check,result\ncreate_quality_report,shape,pass\n'
  );
  writeText(
    join(tempRoot, 'tests/fixtures/inspection-evidence/table-valid-caliper.csv'),
    [
      'schema_version,evidence_type,source_type,inspected_part,inspected_at,units,overall_result,feature_id,measured_value,result,measurement_method',
      '1.0,inspection_evidence,manual_caliper_check,table-intake-part,2026-05-20T10:00:00Z,mm,pass,slot_width,4.99,pass,manual_caliper_check',
    ].join('\n')
  );

  const tableReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['table-intake-part'],
    includeGitHub: false,
    trackedPaths: [
      'docs/examples/table-intake-part/inspection/cmm-report-rows.csv',
      'docs/examples/table-intake-part/quality/table_create_quality.csv',
      'docs/examples/table-intake-part/readiness/readiness_report.json',
      'tests/fixtures/inspection-evidence/table-valid-caliper.csv',
    ],
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(tableReport.summary.genuine_inspection_evidence_found, true);
  assert.equal(tableReport.summary.accepted_candidate_count, 1);
  assert.equal(tableReport.packages[0].accepted_candidates[0].classification, 'genuine_valid');
  assert.equal(tableReport.packages[0].accepted_candidates[0].source_format, 'csv');
  assert.equal(tableReport.packages[0].accepted_candidates[0].adapter, 'machine_readable_table');
  assert.equal(tableReport.packages[0].accepted_candidates[0].measured_feature_count, 1);
  assert.equal(tableReport.packages[0].intake_action.normalization_required, true);
  assert.equal(
    tableReport.packages[0].intake_action.normalized_contract_target,
    'docs/examples/table-intake-part/inspection/inspection_evidence.json'
  );
  assert.equal(tableReport.packages[0].attachment_plan.matched_package, 'table-intake-part');
  assert.equal(tableReport.packages[0].attachment_plan.attachment_ready, true);
  assert.match(
    tableReport.packages[0].intake_action.canonical_commands.review_context.join(' '),
    /--inspection-evidence docs\/examples\/table-intake-part\/inspection\/inspection_evidence\.json/
  );
  assert.match(
    tableReport.packages[0].intake_action.canonical_commands.review_context.join(' '),
    /--attachment-authorization docs\/examples\/table-intake-part\/inspection\/stage5b_attachment_authorization\.json/
  );
  assert.equal(
    tableReport.rejected_candidates.some((candidate) => (
      candidate.classification === 'invalid_generated'
      && candidate.path === 'docs/examples/table-intake-part/quality/table_create_quality.csv'
    )),
    true,
    'generated CSV-like quality reports must stay outside inspection evidence'
  );
  assert.equal(
    tableReport.rejected_candidates.some((candidate) => (
      candidate.classification === 'invalid_provenance'
      && candidate.path === 'tests/fixtures/inspection-evidence/table-valid-caliper.csv'
    )),
    true,
    'valid table fixtures must prove parser behavior without becoming canonical evidence'
  );

  writeMinimalCanonicalPackage(tempRoot, 'markdown-intake-part');
  writeText(
    join(tempRoot, 'docs/examples/markdown-intake-part/inspection/first-article-table.md'),
    [
      '| schema_version | evidence_type | source_type | inspected_part | inspected_at | units | source_ref | overall_result | feature_id | measured_value | result | measurement_method |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 1.0 | inspection_evidence | first_article_inspection | markdown-intake-part | 2026-05-20T10:00:00Z | mm | docs/examples/markdown-intake-part/inspection/first-article-table.md | pass | boss_height | 3.02 | pass | height_gauge |',
    ].join('\n')
  );

  const markdownReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['markdown-intake-part'],
    includeGitHub: false,
    trackedPaths: [
      'docs/examples/markdown-intake-part/inspection/first-article-table.md',
      'docs/examples/markdown-intake-part/readiness/readiness_report.json',
    ],
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(markdownReport.summary.genuine_inspection_evidence_found, true);
  assert.equal(markdownReport.packages[0].accepted_candidates[0].source_format, 'markdown_table');

  writeMinimalCanonicalPackage(tempRoot, 'no-valid-table-part');
  writeText(
    join(tempRoot, 'docs/examples/no-valid-table-part/inspection/incomplete-caliper.tsv'),
    [
      'schema_version\tevidence_type\tsource_type\tinspected_part\tinspected_at\tunits\toverall_result\tfeature_id\tresult\tmeasurement_method',
      '1.0\tinspection_evidence\tmanual_caliper_check\tno-valid-table-part\t2026-05-20T10:00:00Z\tmm\tpass\tmissing_value_feature\tpass\tmanual_caliper_check',
    ].join('\n')
  );

  const noValidTableReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['no-valid-table-part'],
    includeGitHub: false,
    trackedPaths: [
      'docs/examples/no-valid-table-part/inspection/incomplete-caliper.tsv',
      'docs/examples/no-valid-table-part/readiness/readiness_report.json',
    ],
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(noValidTableReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(noValidTableReport.summary.accepted_candidate_count, 0);
  assert.equal(noValidTableReport.packages[0].intake_action.status, 'hold_for_evidence_completion');
  assert.equal(noValidTableReport.packages[0].classification, 'invalid_schema');
  assert.equal(noValidTableReport.packages[0].readiness_after.status, 'needs_more_evidence');

  writeMinimalCanonicalPackage(tempRoot, 'github-table-part');
  const githubTableReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['github-table-part'],
    includeGitHub: true,
    githubRepo: 'dooosp/freecad-automation',
    githubRunner: makeGithubRunner({
      issueBody: 'Completed supplier CMM record: https://example.com/public/cmm/github-table-part-cmm.csv',
    }),
    githubFetch: async (url) => {
      assert.equal(url, 'https://example.com/public/cmm/github-table-part-cmm.csv');
      return makeFetchResponse([
        'schema_version,evidence_type,source_type,package_id,inspected_at,units,overall_result,feature_id,measured_value,result,measurement_method',
        '1.0,inspection_evidence,cmm_report,github-table-part,2026-05-22T12:00:00Z,mm,pass,hole_a,8.01,pass,cmm_report',
      ].join('\n'), { contentType: 'text/csv' });
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(githubTableReport.summary.genuine_inspection_evidence_found, true);
  assert.equal(githubTableReport.summary.accepted_candidate_count, 1);
  assert.equal(githubTableReport.github_discovery.enabled, true);
  assert.equal(githubTableReport.github_discovery.downloaded_candidates.length, 1);
  assert.equal(githubTableReport.github_discovery.downloaded_candidates[0].source_url, 'https://example.com/public/cmm/github-table-part-cmm.csv');
  assert.equal(githubTableReport.github_discovery.rejection_classes.invalid_schema || 0, 0);
  assert.equal(githubTableReport.packages[0].classification, 'genuine_valid');
  assert.equal(githubTableReport.packages[0].accepted_candidates[0].source_kind, 'github_linked_file');
  assert.equal(githubTableReport.packages[0].accepted_candidates[0].source_format, 'csv');
  assert.equal(githubTableReport.packages[0].accepted_candidates[0].matched_package, 'github-table-part');
  assert.equal(githubTableReport.packages[0].accepted_candidates[0].match_confidence, 'high');
  assert.equal(githubTableReport.packages[0].accepted_candidates[0].attachment_ready, true);
  assert.equal(githubTableReport.packages[0].intake_action.status, 'ready_for_canonical_attachment');
  assert.equal(githubTableReport.packages[0].intake_action.normalization_required, true);

  writeMinimalCanonicalPackage(tempRoot, 'ambiguous-alpha-part');
  writeMinimalCanonicalPackage(tempRoot, 'ambiguous-beta-part');
  writeFeatureProfile(tempRoot, 'ambiguous-alpha-part', {
    featureId: 'shared_mount_hole',
    requirementId: 'SHARED_MOUNT_HOLE_DIA',
    valueMm: 8,
  });
  writeFeatureProfile(tempRoot, 'ambiguous-beta-part', {
    featureId: 'shared_mount_hole',
    requirementId: 'SHARED_MOUNT_HOLE_DIA',
    valueMm: 8,
  });
  const ambiguousReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['ambiguous-alpha-part', 'ambiguous-beta-part'],
    includeGitHub: true,
    githubRepo: 'dooosp/freecad-automation',
    githubRunner: makeGithubRunner({
      issueBody: 'Completed supplier CMM record: https://example.com/public/cmm/shared-mount-hole.csv',
    }),
    githubFetch: async () => makeFetchResponse([
      'schema_version,evidence_type,source_type,inspected_part,inspected_at,units,source_ref,overall_result,feature_id,requirement_ref,nominal_value,measured_value,result,measurement_method',
      '1.0,inspection_evidence,cmm_report,supplier shared mounting plate,2026-05-22T12:00:00Z,mm,supplier/cmm/shared-mount-hole.csv,pass,shared_mount_hole,SHARED_MOUNT_HOLE_DIA,8,8.01,pass,cmm_report',
    ].join('\n'), { contentType: 'text/csv' }),
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(ambiguousReport.summary.genuine_inspection_evidence_found, true);
  assert.equal(ambiguousReport.summary.attachment_ready_candidate_count, 0);
  assert.equal(ambiguousReport.accepted_candidates.length, 1);
  assert.equal(ambiguousReport.accepted_candidates[0].matched_package, null);
  assert.equal(ambiguousReport.accepted_candidates[0].match_confidence, 'ambiguous');
  assert.equal(ambiguousReport.accepted_candidates[0].attachment_ready, false);
  assert.equal(
    ambiguousReport.accepted_candidates[0].blockers.includes('ambiguous_package_match'),
    true
  );
  assert.deepEqual(
    ambiguousReport.packages.map((pkg) => pkg.readiness_after.gate_decision),
    ['hold_for_evidence_completion', 'hold_for_evidence_completion']
  );
  assert.deepEqual(
    ambiguousReport.packages.map((pkg) => pkg.attachment_plan.attachment_ready),
    [false, false]
  );

  writeMinimalCanonicalPackage(tempRoot, 'github-generated-part');
  const githubGeneratedReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['github-generated-part'],
    includeGitHub: true,
    githubRunner: makeGithubRunner({
      issueBody: 'Generated review output is not evidence: https://example.com/public/quality/github-generated-part_create_quality.json',
    }),
    githubFetch: async () => makeFetchResponse(JSON.stringify({
      artifact_type: 'create_quality_report',
      schema_version: '1.0',
      checks: [],
    }), { contentType: 'application/json' }),
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(githubGeneratedReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(githubGeneratedReport.github_discovery.downloaded_candidates.length, 1);
  assert.equal(githubGeneratedReport.github_discovery.rejection_classes.invalid_generated, 1);
  assert.equal(githubGeneratedReport.rejected_candidates[0].matched_package, null);
  assert.equal(githubGeneratedReport.rejected_candidates[0].attachment_ready, false);
  assert.equal(
    githubGeneratedReport.rejected_candidates[0].blockers.includes('candidate_not_genuine_valid'),
    true
  );
  assert.equal(
    githubGeneratedReport.rejected_candidates.some((candidate) => (
      candidate.source_kind === 'github_linked_file'
      && candidate.classification === 'invalid_generated'
    )),
    true
  );

  writeMinimalCanonicalPackage(tempRoot, 'github-zip-part');
  const githubZipReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['github-zip-part'],
    includeGitHub: true,
    githubRunner: makeGithubRunner({
      issueBody: 'Unsafe uploaded archive: https://example.com/public/inspection/unsafe.zip',
    }),
    githubFetch: async () => makeFetchResponse(makeStoredZipEntry('../evil.csv', 'not,evidence\n'), {
      contentType: 'application/zip',
    }),
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(githubZipReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(
    githubZipReport.github_discovery.skipped_sources.some((source) => source.reason_code === 'unsafe_zip_path'),
    true,
    'ZIP entries with traversal paths must be rejected before candidate parsing'
  );

  const githubUnavailableReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['github-table-part'],
    includeGitHub: true,
    githubRunner: makeGithubRunner({ fail: true }),
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(githubUnavailableReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(githubUnavailableReport.github_discovery.enabled, true);
  assert.equal(
    githubUnavailableReport.github_discovery.skipped_sources.some((source) => source.reason_code === 'github_cli_unavailable'),
    true
  );
  assert.equal(githubUnavailableReport.packages[0].intake_action.status, 'hold_for_evidence_completion');

  writeMinimalCanonicalPackage(tempRoot, 'github-hold-part');
  const githubHoldReport = await discoverInspectionEvidenceIntake({
    projectRoot: tempRoot,
    packageSlugs: ['github-hold-part'],
    includeGitHub: true,
    githubRunner: makeGithubRunner({
      issueBody: 'Incomplete caliper table: https://example.com/public/caliper/github-hold-part.csv',
    }),
    githubFetch: async () => makeFetchResponse([
      'schema_version,evidence_type,source_type,package_id,inspected_at,units,overall_result,feature_id,result,measurement_method',
      '1.0,inspection_evidence,manual_caliper_check,github-hold-part,2026-05-22T12:00:00Z,mm,pass,slot_width,pass,manual_caliper_check',
    ].join('\n'), { contentType: 'text/csv' }),
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(githubHoldReport.github_discovery.downloaded_candidates.length, 1);
  assert.equal(githubHoldReport.github_discovery.rejection_classes.invalid_schema, 1);
  assert.equal(githubHoldReport.summary.genuine_inspection_evidence_found, false);
  assert.equal(githubHoldReport.packages[0].classification, 'invalid_schema');
  assert.equal(githubHoldReport.packages[0].intake_action.status, 'hold_for_evidence_completion');
  assert.equal(githubHoldReport.packages[0].readiness_after.status, 'needs_more_evidence');
  assert.equal(githubHoldReport.packages[0].attachment_plan.attachment_ready, false);
  assert.equal(
    githubHoldReport.packages[0].attachment_plan.blockers.includes('no_genuine_valid_candidate'),
    true
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
