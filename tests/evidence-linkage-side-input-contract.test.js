import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runPythonJsonScript } from '../lib/context-loader.js';
import { assertValidDArtifact } from '../lib/d-artifact-schema.js';
import { runReviewContextPipeline } from '../src/orchestration/review-context-pipeline.js';
import { validateJobRequest } from '../src/services/jobs/job-executor.js';
import { translateStudioJobSubmission } from '../src/server/studio-job-bridge.js';
import { buildReadinessReportFromReviewPack } from '../src/workflows/canonical-readiness-builders.js';

const ROOT = resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-evidence-linkage-'));
const VALID_INSPECTION_EVIDENCE_PATH = resolve(
  ROOT,
  'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
);
const CREATE_QUALITY_REPORT_PATH = resolve(
  ROOT,
  'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json'
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function buildStubRunPythonJsonScript() {
  return async (projectRoot, scriptRelativePath, input, opts = {}) => {
    if (scriptRelativePath.endsWith('analyze_part.py')) {
      return {
        geometry_intelligence: {
          generated_at: '2026-04-27T00:00:00Z',
          analysis_confidence: 'heuristic',
          confidence: {
            level: 'medium',
            score: 0.58,
            rationale: 'Stub geometry confidence.',
          },
          derived_features: [],
          metrics: {
            bounding_box_mm: {
              x: 12,
              y: 8,
              z: 3,
            },
            volume_mm3: 288,
            face_count: 6,
            edge_count: 12,
          },
          features: {
            hole_like_feature_count: 0,
            hole_pattern_count: 0,
            repeated_feature_count: 0,
            complexity_score: 0.2,
          },
          warnings: [],
        },
        manufacturing_hotspots: {
          confidence: {
            level: 'medium',
            score: 0.5,
            rationale: 'Stub hotspot confidence.',
          },
          hotspots: [],
          warnings: [],
        },
      };
    }

    if (scriptRelativePath.endsWith('quality_link.py')) {
      return {
        inspection_linkage: { summary: {}, records: [] },
        inspection_outliers: { records: [] },
        quality_linkage: { summary: {}, records: [] },
        quality_hotspots: { records: [] },
        review_priorities: { records: [], recommended_actions: [] },
      };
    }

    if (scriptRelativePath.endsWith('scripts/reporting/review_pack.py')) {
      return runPythonJsonScript(projectRoot, scriptRelativePath, input, opts);
    }

    throw new Error(`Unexpected script request: ${scriptRelativePath}`);
  };
}

try {
  const contextPath = join(tempRoot, 'context.json');
  const invalidInspectionEvidencePath = join(tempRoot, 'invalid_inspection_evidence.json');
  const unsafeOutsidePath = join(tempRoot, 'outside_dfm_report.json');
  const unsafeOutputDir = resolve(ROOT, 'output', 'evidence-linkage-side-input-contract-test');
  const unsafeTmpCodexDir = resolve(ROOT, 'tmp', 'codex', 'evidence-linkage-side-input-contract-test');
  const unsafeOutputPath = join(unsafeOutputDir, 'create_quality.json');
  const unsafeTmpCodexPath = join(unsafeTmpCodexDir, 'drawing_quality.json');
  mkdirSync(unsafeOutputDir, { recursive: true });
  mkdirSync(unsafeTmpCodexDir, { recursive: true });
  writeFileSync(invalidInspectionEvidencePath, JSON.stringify({
    schema_version: '1.0',
    evidence_type: 'inspection_evidence',
    source_type: 'manual_caliper_check',
    inspected_part: 'side-input-contract-part',
    inspected_at: '2026-04-27T00:00:00Z',
    source_ref: 'tests/fixtures/inspection-evidence/invalid.json',
    overall_result: 'unknown',
  }, null, 2), 'utf8');
  writeFileSync(unsafeOutsidePath, '{"artifact_type":"dfm_report"}\n', 'utf8');
  writeFileSync(unsafeOutputPath, '{"artifact_type":"create_quality_report"}\n', { encoding: 'utf8', flag: 'w' });
  writeFileSync(unsafeTmpCodexPath, '{"artifact_type":"drawing_quality_report"}\n', { encoding: 'utf8', flag: 'w' });
  writeFileSync(contextPath, JSON.stringify({
    metadata: {
      created_at: '2026-04-27T00:00:00Z',
      warnings: [],
      source_files: [resolve(ROOT, 'tests/fixtures/sample_part.step')],
    },
    part: {
      name: 'side-input-contract-part',
      revision: 'A',
    },
    geometry_source: {
      path: resolve(ROOT, 'tests/fixtures/sample_part.step'),
      file_type: 'step',
      model_metadata: {
        bounding_box: {
          size: [12, 8, 3],
        },
      },
    },
  }, null, 2));

  const result = await runReviewContextPipeline({
    projectRoot: ROOT,
    contextPath,
    outputPath: join(tempRoot, 'artifacts', 'review_pack.json'),
    createQualityPath: CREATE_QUALITY_REPORT_PATH,
    drawingQualityPath: resolve(ROOT, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json'),
    drawingQaPath: resolve(ROOT, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json'),
    drawingIntentPath: resolve(ROOT, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json'),
    featureCatalogPath: resolve(ROOT, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json'),
    dfmReportPath: unsafeOutsidePath,
    runPythonJsonScript: buildStubRunPythonJsonScript(),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });

  const reviewPack = readJson(result.artifacts.reviewPackJson);
  assertValidDArtifact('review_pack', reviewPack, { command: 'review-context' });
  const serialized = JSON.stringify(reviewPack);
  assert.equal(serialized.includes(ROOT), false, 'review_pack.json must not include repo-root absolute paths');
  assert.equal(serialized.includes(tempRoot), false, 'review_pack.json must not include temp absolute paths');
  assert.equal(serialized.includes('/Users/'), false, 'review_pack.json must not include user-home absolute paths');
  assert.equal(serialized.includes('tmp/codex'), false, 'review_pack.json must not include tmp/codex paths');
  assert.equal(serialized.includes('output/'), false, 'side input source refs should not use ignored output/ paths');

  const packageRecords = reviewPack.evidence_ledger.records.filter((record) => String(record.evidence_id || '').startsWith('package:'));
  assert.equal(packageRecords.length, 5);
  assert.equal(packageRecords.some((record) => record.classifications.includes('quality_evidence')), true);
  assert.equal(packageRecords.some((record) => record.classifications.includes('drawing_evidence')), true);
  assert.equal(packageRecords.some((record) => record.classifications.includes('design_traceability_evidence')), true);
  assert.equal(packageRecords.every((record) => record.inspection_evidence === false), true);
  assert.equal(packageRecords.every((record) => typeof record.sha256 === 'string' && record.sha256.length === 64), true);
  assert.equal(packageRecords.every((record) => !record.source_ref.startsWith('/')), true);
  assert.equal(
    reviewPack.evidence_ledger.records.some((record) => record.type === 'inspection_evidence'),
    false,
    'review-context should not add inspection evidence records when --inspection-evidence is absent'
  );

  assert.equal(
    reviewPack.source_artifact_refs.some((ref) => ref.path === 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json'),
    true
  );
  assert.equal(
    reviewPack.source_artifact_refs.some((ref) => String(ref.path || '').includes('outside_dfm_report')),
    false
  );
  assert.equal(
    reviewPack.uncertainty_coverage_report.missing_inputs.includes('quality_evidence'),
    false
  );
  assert.equal(
    reviewPack.uncertainty_coverage_report.missing_inputs.includes('inspection_evidence'),
    true
  );
  assert.match(
    reviewPack.data_quality_notes.map((note) => note.message).join('\n'),
    /do not satisfy inspection_evidence|outside the repository/
  );
  const readinessReport = buildReadinessReportFromReviewPack({
    reviewPack,
    reviewPackPath: result.artifacts.reviewPackJson,
    generatedAt: '2026-04-27T00:00:00Z',
  });
  assert.equal(
    readinessReport.review_pack.uncertainty_coverage_report.missing_inputs.includes('quality_evidence'),
    false
  );
  assert.equal(
    readinessReport.review_pack.uncertainty_coverage_report.missing_inputs.includes('inspection_evidence'),
    true
  );
  assert.equal(readinessReport.readiness_summary.status, 'needs_more_evidence');

  const inspectionResult = await runReviewContextPipeline({
    projectRoot: ROOT,
    contextPath,
    outputPath: join(tempRoot, 'inspection-artifacts', 'review_pack.json'),
    inspectionEvidencePath: VALID_INSPECTION_EVIDENCE_PATH,
    runPythonJsonScript: buildStubRunPythonJsonScript(),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });
  const inspectionReviewPack = readJson(inspectionResult.artifacts.reviewPackJson);
  assertValidDArtifact('review_pack', inspectionReviewPack, { command: 'review-context' });
  const inspectionRecords = inspectionReviewPack.evidence_ledger.records.filter(
    (record) => record.type === 'inspection_evidence'
  );
  assert.equal(inspectionRecords.length, 1);
  assert.equal(inspectionRecords[0].inspection_evidence, true);
  assert.equal(
    inspectionRecords[0].source_ref,
    'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
  );
  assert.equal(inspectionRecords[0].source_ref.startsWith('/'), false);
  assert.equal(inspectionRecords[0].source_ref.includes('..'), false);
  assert.equal(typeof inspectionRecords[0].sha256, 'string');
  assert.equal(inspectionRecords[0].sha256.length, 64);
  assert.equal(
    inspectionReviewPack.source_artifact_refs.some((ref) => (
      ref.artifact_type === 'inspection_evidence'
      && ref.path === 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json'
      && ref.role === 'evidence'
    )),
    true
  );
  assert.equal(
    inspectionReviewPack.uncertainty_coverage_report.missing_inputs.includes('inspection_evidence'),
    false,
    'validated inspection evidence should close review-pack inspection_evidence coverage'
  );
  const inspectionReadinessReport = buildReadinessReportFromReviewPack({
    reviewPack: inspectionReviewPack,
    reviewPackPath: inspectionResult.artifacts.reviewPackJson,
    generatedAt: '2026-04-27T00:00:00Z',
  });
  assert.equal(
    inspectionReadinessReport.review_pack.uncertainty_coverage_report.missing_inputs.includes('inspection_evidence'),
    false
  );
  assert.equal(
    inspectionReadinessReport.process_plan.summary.missing_inputs.includes('inspection_evidence'),
    false
  );
  assert.equal(
    inspectionReadinessReport.quality_risk.summary.missing_inputs.includes('inspection_evidence'),
    false
  );

  const generatedOutputPath = join(tempRoot, 'generated-rejected', 'review_pack.json');
  await assert.rejects(
    () => runReviewContextPipeline({
      projectRoot: ROOT,
      contextPath,
      outputPath: generatedOutputPath,
      inspectionEvidencePath: CREATE_QUALITY_REPORT_PATH,
      runPythonJsonScript: buildStubRunPythonJsonScript(),
      inspectModelIfAvailable: async () => null,
      detectStepFeaturesIfAvailable: async () => null,
    }),
    /Inspection evidence validation failed.*(evidence_type|measured_features)/i
  );
  assert.equal(existsSync(generatedOutputPath), false);

  const invalidOutputPath = join(tempRoot, 'invalid-rejected', 'review_pack.json');
  await assert.rejects(
    () => runReviewContextPipeline({
      projectRoot: ROOT,
      contextPath,
      outputPath: invalidOutputPath,
      inspectionEvidencePath: invalidInspectionEvidencePath,
      runPythonJsonScript: buildStubRunPythonJsonScript(),
      inspectModelIfAvailable: async () => null,
      detectStepFeaturesIfAvailable: async () => null,
    }),
    /Inspection evidence validation failed.*measured_features/i
  );
  assert.equal(existsSync(invalidOutputPath), false);

  const unsafeResult = await runReviewContextPipeline({
    projectRoot: ROOT,
    contextPath,
    outputPath: join(tempRoot, 'unsafe-artifacts', 'review_pack.json'),
    createQualityPath: unsafeOutputPath,
    drawingQualityPath: unsafeTmpCodexPath,
    runPythonJsonScript: buildStubRunPythonJsonScript(),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });
  const unsafeReviewPack = readJson(unsafeResult.artifacts.reviewPackJson);
  const unsafeSerialized = JSON.stringify(unsafeReviewPack);
  assert.equal(unsafeReviewPack.evidence_ledger.records.some((record) => String(record.evidence_id || '').startsWith('package:')), false);
  assert.equal(unsafeSerialized.includes('output/evidence-linkage-side-input-contract-test'), false);
  assert.equal(unsafeSerialized.includes('tmp/codex'), false);
  assert.equal(unsafeSerialized.includes('tmp/codex/evidence-linkage-side-input-contract-test'), false);
  assert.match(
    unsafeReviewPack.data_quality_notes.map((note) => note.message).join('\n'),
    /under ignored output\/|task-status scratch area/
  );

  const jobValidation = validateJobRequest({
    type: 'review-context',
    context_path: 'tests/fixtures/sample_part_context.json',
    create_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    drawing_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    drawing_qa_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    drawing_intent_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    feature_catalog_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    dfm_report_path: 'docs/examples/infotainment-display-bracket/quality-risk.json',
  });
  assert.equal(jobValidation.ok, true, jobValidation.errors?.join('\n'));

  const studioSubmission = await translateStudioJobSubmission({
    type: 'review-context',
    context_path: 'tests/fixtures/sample_part_context.json',
    create_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json',
    drawing_quality_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json',
    drawing_qa_path: 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json',
    drawing_intent_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json',
    feature_catalog_path: 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json',
    dfm_report_path: 'docs/examples/infotainment-display-bracket/quality-risk.json',
  });
  assert.equal(studioSubmission.ok, true, studioSubmission.errors?.join('\n'));
  assert.equal(studioSubmission.request.create_quality_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_create_quality.json');
  assert.equal(studioSubmission.request.drawing_quality_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_quality.json');
  assert.equal(studioSubmission.request.drawing_qa_path, 'docs/examples/motor-mount/quality/cnc_motor_mount_bracket_drawing_qa.json');
  assert.equal(studioSubmission.request.drawing_intent_path, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_drawing_intent.json');
  assert.equal(studioSubmission.request.feature_catalog_path, 'docs/examples/motor-mount/drawing/cnc_motor_mount_bracket_feature_catalog.json');
  assert.equal(studioSubmission.request.dfm_report_path, 'docs/examples/infotainment-display-bracket/quality-risk.json');
} finally {
  rmSync(resolve(ROOT, 'output', 'evidence-linkage-side-input-contract-test'), { recursive: true, force: true });
  rmSync(resolve(ROOT, 'tmp', 'codex', 'evidence-linkage-side-input-contract-test'), { recursive: true, force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('evidence-linkage-side-input-contract.test.js: ok');
