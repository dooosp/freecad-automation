import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateCArtifact } from '../lib/c-artifact-schema.js';
import {
  buildProcessPlanFromReviewPack,
  buildQualityRiskFromReviewPack,
  buildReadinessReportFromReviewPack,
  buildStabilizationReviewFromReadinessReports,
} from '../src/workflows/canonical-readiness-builders.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-readiness-builders-'));
const REVIEW_PACK_FIXTURE_PATH = join(ROOT, 'tests', 'fixtures', 'd-artifacts', 'sample_review_pack.canonical.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertArtifact(kind, document) {
  const validation = validateCArtifact(kind, document);
  assert.equal(validation.ok, true, `${kind} schema errors:\n${validation.errors.join('\n')}`);
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

try {
  const baselineReviewPack = readJson(REVIEW_PACK_FIXTURE_PATH);

  const processPlan = buildProcessPlanFromReviewPack({
    reviewPack: baselineReviewPack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  const qualityRisk = buildQualityRiskFromReviewPack({
    reviewPack: baselineReviewPack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  const readinessReport = buildReadinessReportFromReviewPack({
    reviewPack: baselineReviewPack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
    processPlan,
    qualityRisk,
  });

  assertArtifact('process_plan', processPlan);
  assertArtifact('quality_risk', qualityRisk);
  assertArtifact('readiness_report', readinessReport);
  assert.equal(processPlan.process_flow[0].priority_rank, 1);
  assert.equal(processPlan.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack'), true);
  assert.equal(qualityRisk.quality_risks[0].priority_rank, 1);
  assert.equal(readinessReport.review_pack.artifact_type, 'review_pack');
  assert.equal(readinessReport.process_plan.contract.command, 'process-plan');
  assert.equal(readinessReport.quality_risk.contract.command, 'quality-risk');
  assert.equal(readinessReport.summary.review_pack_headline.includes('sample_part revision A'), true);

  const missingEvidencePack = clone(baselineReviewPack);
  missingEvidencePack.quality_linkage.records = [];
  missingEvidencePack.quality_hotspots = [];
  missingEvidencePack.uncertainty_coverage_report = {
    ...(missingEvidencePack.uncertainty_coverage_report || {}),
    partial_evidence: true,
    missing_inputs: ['quality_evidence'],
  };
  missingEvidencePack.data_quality_notes = [...(missingEvidencePack.data_quality_notes || []), {
    severity: 'warning',
    message: 'Missing or limited quality evidence; review-pack remains usable with partial evidence.',
  }];

  const missingEvidenceReport = buildReadinessReportFromReviewPack({
    reviewPack: missingEvidencePack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  assert.equal(missingEvidenceReport.process_plan.summary.partial_evidence, true);
  assert.equal(missingEvidenceReport.quality_risk.summary.partial_evidence, true);
  assert.equal(missingEvidenceReport.warnings.some((warning) => warning.includes('quality evidence')), true);
  assert.equal(missingEvidenceReport.readiness_summary.status, 'needs_more_evidence');

  const lowConfidencePack = clone(baselineReviewPack);
  lowConfidencePack.confidence = {
    level: 'low',
    score: 0.31,
    rationale: 'Metadata-only fallback reduced upstream confidence.',
  };
  lowConfidencePack.uncertainty_coverage_report = {
    ...(lowConfidencePack.uncertainty_coverage_report || {}),
    numeric_score: 0.34,
  };
  lowConfidencePack.warnings.push('Metadata-only fallback in upstream geometry analysis.');

  const lowConfidenceProcessPlan = buildProcessPlanFromReviewPack({
    reviewPack: lowConfidencePack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  const lowConfidenceReport = buildReadinessReportFromReviewPack({
    reviewPack: lowConfidencePack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
    processPlan: lowConfidenceProcessPlan,
  });
  assert.equal(lowConfidenceProcessPlan.confidence.level, 'low');
  assert.equal(lowConfidenceReport.confidence.level, 'low');
  assert.equal(lowConfidenceReport.warnings.includes('Metadata-only fallback in upstream geometry analysis.'), true);
  assert.equal(lowConfidenceReport.readiness_summary.status, 'needs_more_evidence');

  const candidateReviewPack = clone(baselineReviewPack);
  candidateReviewPack.revision = 'B';
  candidateReviewPack.part.revision = 'B';
  candidateReviewPack.confidence = {
    level: 'medium',
    score: 0.84,
    rationale: 'Candidate revision closes the primary evidence gaps while preserving full linkage provenance.',
  };
  candidateReviewPack.uncertainty_coverage_report = {
    ...(candidateReviewPack.uncertainty_coverage_report || {}),
    numeric_score: 0.97,
  };
  candidateReviewPack.review_priorities = candidateReviewPack.review_priorities.slice(0, 3);
  candidateReviewPack.prioritized_hotspots = (candidateReviewPack.prioritized_hotspots || candidateReviewPack.review_priorities.map((priority) => ({
    title: priority.title,
    category: priority.category,
    priority_rank: priority.priority_rank,
    score: priority.score,
  }))).slice(0, 3);
  candidateReviewPack.executive_summary = {
    ...(candidateReviewPack.executive_summary || {}),
    top_risk_categories: ['complexity', 'patterning'],
  };
  candidateReviewPack.recommended_actions = [
    {
      category: 'complexity',
      priority_rank: 1,
      recommended_action: 'Lock the updated tooling review and issue the revised work instruction package.',
      based_on: 'Review complexity',
    },
    {
      category: 'patterning',
      priority_rank: 2,
      recommended_action: 'Confirm datum strategy and close the remaining hole-pattern verification plan.',
      based_on: 'Review patterning',
    },
  ];
  candidateReviewPack.warnings = [];

  const baselineReport = buildReadinessReportFromReviewPack({
    reviewPack: baselineReviewPack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  const candidateReport = buildReadinessReportFromReviewPack({
    reviewPack: candidateReviewPack,
    reviewPackPath: REVIEW_PACK_FIXTURE_PATH,
  });
  const stabilizationReview = buildStabilizationReviewFromReadinessReports({
    baselineReport,
    candidateReport,
    baselinePath: join(TMP_DIR, 'baseline_readiness_report.json'),
    candidatePath: join(TMP_DIR, 'candidate_readiness_report.json'),
  });

  assertArtifact('stabilization_review', stabilizationReview);
  assert.equal(stabilizationReview.summary.comparison_basis, 'readiness_report_delta');
  assert.equal(stabilizationReview.summary.readiness_score_delta > 0, true);
  assert.equal(stabilizationReview.change_reasons.some((reason) => reason.change_type === 'action_register'), true);
  assert.equal(stabilizationReview.change_reasons.some((reason) => reason.change_type === 'priority_category_shift'), true);

  const baselinePath = join(TMP_DIR, 'baseline_readiness_report.json');
  const candidatePath = join(TMP_DIR, 'candidate_readiness_report.json');
  const compareOutputPath = join(TMP_DIR, 'stabilization_review.json');
  writeFileSync(baselinePath, JSON.stringify(baselineReport, null, 2), 'utf8');
  writeFileSync(candidatePath, JSON.stringify(candidateReport, null, 2), 'utf8');

  const compareRun = runCli([
    'stabilization-review',
    baselinePath,
    candidatePath,
    '--out',
    compareOutputPath,
  ]);
  assert.equal(compareRun.status, 0, compareRun.stderr || compareRun.stdout);
  const compareOutput = readJson(compareOutputPath);
  assertArtifact('stabilization_review', compareOutput);
  assert.equal(compareOutput.summary.readiness_score_delta > 0, true);
  assert.equal(compareOutput.change_reasons.some((reason) => reason.change_type === 'readiness_score'), true);

  console.log('readiness-builders.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
