import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildInspectionEvidencePromotionDryRunManifest,
  writeInspectionEvidencePromotionDryRunManifest,
} from '../src/services/inspection-evidence-intake/promotion-dry-run-service.js';

function writeText(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readiness(slug) {
  return {
    status: 'needs_more_evidence',
    score: 61,
    gate_decision: 'hold_for_evidence_completion',
    missing_inputs: ['inspection_evidence'],
    inspection_evidence_missing: true,
    source_of_truth_path: `docs/examples/${slug}/readiness/readiness_report.json`,
  };
}

function readyCandidate(slug, overrides = {}) {
  const path = overrides.path || `docs/examples/${slug}/inspection/inspection_evidence.json`;
  return {
    path,
    source_kind: overrides.source_kind || 'tracked_repo_file',
    source_format: overrides.source_format || 'json',
    classification: overrides.classification || 'genuine_valid',
    matched_package: overrides.matched_package ?? slug,
    match_confidence: overrides.match_confidence || 'high',
    attachment_ready: overrides.attachment_ready ?? true,
    blockers: overrides.blockers || [],
    normalized_source_ref: overrides.normalized_source_ref || path,
    document_signals: {
      source_ref: path,
      package_id: slug,
      inspected_part: slug,
      measured_feature_ids: ['mount_hole_a_diameter'],
      ...overrides.document_signals,
    },
    attachment_plan: {
      matched_package: overrides.matched_package ?? slug,
      match_confidence: overrides.match_confidence || 'high',
      attachment_ready: overrides.attachment_ready ?? true,
      blockers: overrides.blockers || [],
      canonical_next_command: ['fcad', 'review-context', '--inspection-evidence', path],
      candidate_package_matches: [{ slug, score: 285, match_signals: ['explicit_package_id'] }],
      matched_features: [{ candidate_feature_id: 'mount_hole_a_diameter', canonical_feature_id: 'mount_hole_a_diameter' }],
      unmatched_features: [],
      missing_required_features: [],
      ...overrides.attachment_plan,
    },
    ...overrides,
  };
}

function packageEntry(slug, overrides = {}) {
  const candidate = overrides.candidate || null;
  const holdPlan = {
    matched_package: null,
    match_confidence: 'none',
    attachment_ready: false,
    blockers: ['no_genuine_valid_candidate'],
    canonical_next_command: null,
  };
  const attachmentPlan = overrides.attachment_plan || candidate?.attachment_plan || holdPlan;
  return {
    slug,
    classification: overrides.classification || (candidate ? 'genuine_valid' : 'no_candidate'),
    readiness_before: readiness(slug),
    readiness_after: readiness(slug),
    accepted_candidates: candidate && candidate.attachment_ready ? [candidate] : [],
    rejected_candidates: overrides.rejected_candidates || [],
    candidate_attachment_plans: overrides.candidate_attachment_plans || (candidate ? [candidate.attachment_plan] : []),
    attachment_plan: attachmentPlan,
    intake_action: candidate && candidate.attachment_ready
      ? {
          status: 'ready_for_canonical_attachment',
          mode: 'canonical_review_context_chain_required',
          candidate_path: candidate.path,
          canonical_commands: {
            review_context: candidate.attachment_plan.canonical_next_command,
          },
          attachment_ready: true,
          blockers: [],
        }
      : {
          status: 'hold_for_evidence_completion',
          mode: 'no_human_measurement_entry_requested',
          attachment_ready: false,
          blockers: attachmentPlan.blockers,
        },
    ...overrides.package_overrides,
  };
}

function intakeReport(packages, acceptedCandidates = [], rejectedCandidates = [], overrides = {}) {
  return {
    artifact_type: 'inspection_evidence_intake_report',
    schema_version: '1.0',
    generated_at: '2026-05-23T00:00:00.000Z',
    source_boundary: {
      hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
      rejected_as_final_evidence: [
        'generated CAD/drawing/quality/DFM/readiness/review/standard-doc/release artifacts',
        'fixtures',
      ],
    },
    packages,
    accepted_candidates: acceptedCandidates,
    rejected_candidates: rejectedCandidates,
    summary: {
      package_count: packages.length,
      accepted_candidate_count: acceptedCandidates.length,
      attachment_ready_candidate_count: acceptedCandidates.filter((candidate) => candidate.attachment_ready).length,
      rejected_candidate_count: rejectedCandidates.length,
      genuine_inspection_evidence_found: acceptedCandidates.length > 0,
      readiness_truth: 'readiness remains needs_more_evidence / hold_for_evidence_completion unless a future evidence-gated promotion is run',
      requires_human_measurement_entry: false,
    },
    ...overrides,
  };
}

function preparePackage(root, slug) {
  writeText(join(root, 'docs/examples', slug, 'cad', `${slug}.step`), 'ISO-10303-21;\n');
  writeText(join(root, 'docs/examples', slug, 'config.toml'), `name = "${slug}"\n`);
  writeJson(join(root, 'docs/examples', slug, 'inspection', 'inspection_evidence.json'), {
    evidence_type: 'inspection_evidence',
    test_only: true,
  });
  writeJson(join(root, 'docs/examples', slug, 'review', 'review_pack.json'), { before: true });
  writeJson(join(root, 'docs/examples', slug, 'readiness', 'readiness_report.json'), {
    readiness_summary: readiness(slug),
  });
}

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-stage5b-dry-run-'));

try {
  const readySlug = 'demo-intake-part';
  preparePackage(tempRoot, readySlug);
  const ready = readyCandidate(readySlug);
  const readyReport = intakeReport(
    [packageEntry(readySlug, { candidate: ready })],
    [ready],
    [],
    { test_only: true }
  );
  const reviewPackPath = join(tempRoot, 'docs/examples', readySlug, 'review', 'review_pack.json');
  const reviewPackBefore = readFileSync(reviewPackPath, 'utf8');

  const readyManifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: readyReport,
    intakeReportPath: 'output/intake-report.json',
    generatedAt: '2026-05-23T01:00:00.000Z',
    testOnly: true,
  });

  assert.equal(readyManifest.artifact_type, 'inspection_evidence_promotion_dry_run_manifest');
  assert.equal(readyManifest.dry_run, true);
  assert.equal(readyManifest.summary.promotion_can_run, true);
  assert.equal(readyManifest.summary.canonical_artifacts_mutated, false);
  assert.equal(readyManifest.test_scope.test_only, true);
  assert.equal(readyManifest.packages[0].package_slug, readySlug);
  assert.equal(readyManifest.packages[0].promotion_status, 'ready_for_future_promotion_dry_run');
  assert.equal(readyManifest.packages[0].evidence_source_ref, `docs/examples/${readySlug}/inspection/inspection_evidence.json`);
  assert.equal(readyManifest.packages[0].match_confidence, 'high');
  assert.equal(readyManifest.packages[0].attachment_ready, true);
  assert.deepEqual(
    readyManifest.packages[0].commands_to_run.map((step) => step.command.slice(0, 2).join(' ')),
    ['fcad review-context', 'fcad readiness-pack', 'fcad generate-standard-docs', 'fcad pack']
  );
  assert.deepEqual(
    readyManifest.packages[0].commands_to_run[0].command,
    [
      'fcad',
      'review-context',
      '--model',
      `docs/examples/${readySlug}/cad/${readySlug}.step`,
      '--inspection-evidence',
      `docs/examples/${readySlug}/inspection/inspection_evidence.json`,
      '--out',
      `docs/examples/${readySlug}/review/review_pack.json`,
    ]
  );
  assert.equal(
    readyManifest.packages[0].files_that_would_be_mutated.includes(`docs/examples/${readySlug}/review/review_pack.json`),
    true
  );
  assert.equal(
    readyManifest.packages[0].expected_artifacts.some((artifact) => artifact.path === `docs/examples/${readySlug}/release/release_bundle.zip`),
    true
  );
  assert.equal(
    readyManifest.packages[0].safety_checks.every((check) => check.status === 'pass'),
    true
  );
  assert.equal(
    readyManifest.packages[0].readiness_expectation.dry_run.gate_decision,
    'hold_for_evidence_completion'
  );
  assert.match(
    readyManifest.packages[0].rollback_guidance.join('\n'),
    /review git diff/i
  );

  const outPath = join(tempRoot, 'output', 'promotion_dry_run_manifest.json');
  const writeResult = await writeInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: readyReport,
    intakeReportPath: 'output/intake-report.json',
    outputPath: outPath,
    generatedAt: '2026-05-23T01:00:00.000Z',
    testOnly: true,
  });
  assert.equal(writeResult.output_path, 'output/promotion_dry_run_manifest.json');
  assert.equal(existsSync(outPath), true);
  assert.equal(readFileSync(reviewPackPath, 'utf8'), reviewPackBefore, 'dry-run must not mutate canonical review_pack.json');
  assert.equal(readJson(outPath).summary.promotion_can_run, true);

  const holdSlug = 'hold-part';
  preparePackage(tempRoot, holdSlug);
  const holdManifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: intakeReport([packageEntry(holdSlug)]),
    generatedAt: '2026-05-23T01:00:00.000Z',
  });
  assert.equal(holdManifest.summary.promotion_can_run, false);
  assert.equal(holdManifest.packages[0].promotion_status, 'blocked_no_valid_candidate');
  assert.equal(holdManifest.packages[0].commands_to_run.length, 0);
  assert.equal(holdManifest.packages[0].blockers.includes('no_genuine_valid_candidate'), true);
  assert.equal(holdManifest.packages[0].readiness_expectation.dry_run.status, 'needs_more_evidence');

  const ambiguousSlug = 'ambiguous-alpha-part';
  preparePackage(tempRoot, ambiguousSlug);
  const ambiguousPlan = {
    matched_package: null,
    match_confidence: 'ambiguous',
    attachment_ready: false,
    blockers: ['ambiguous_package_match'],
    canonical_next_command: null,
    candidate_package_matches: [
      { slug: 'ambiguous-alpha-part', score: 45 },
      { slug: 'ambiguous-beta-part', score: 45 },
    ],
  };
  const ambiguous = readyCandidate(ambiguousSlug, {
    matched_package: null,
    match_confidence: 'ambiguous',
    attachment_ready: false,
    blockers: ['ambiguous_package_match'],
    attachment_plan: ambiguousPlan,
  });
  const ambiguousManifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: intakeReport(
      [packageEntry(ambiguousSlug, {
        candidate: null,
        attachment_plan: ambiguousPlan,
        candidate_attachment_plans: [ambiguousPlan],
      })],
      [ambiguous]
    ),
    generatedAt: '2026-05-23T01:00:00.000Z',
  });
  assert.equal(ambiguousManifest.summary.promotion_can_run, false);
  assert.equal(ambiguousManifest.packages[0].promotion_status, 'blocked_ambiguous_candidate');
  assert.equal(ambiguousManifest.packages[0].blockers.includes('ambiguous_package_match'), true);

  const generatedSlug = 'generated-part';
  preparePackage(tempRoot, generatedSlug);
  const generatedReject = {
    path: `docs/examples/${generatedSlug}/quality/${generatedSlug}_create_quality.json`,
    classification: 'invalid_generated',
    attachment_ready: false,
    blockers: ['candidate_not_genuine_valid'],
    reasons: ['generated artifacts are not inspection evidence'],
  };
  const generatedManifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: intakeReport(
      [packageEntry(generatedSlug, {
        classification: 'invalid_generated',
        rejected_candidates: [generatedReject],
      })],
      [],
      [generatedReject]
    ),
    generatedAt: '2026-05-23T01:00:00.000Z',
  });
  assert.equal(generatedManifest.summary.promotion_can_run, false);
  assert.equal(generatedManifest.packages[0].promotion_status, 'blocked_generated_candidate');
  assert.equal(generatedManifest.packages[0].blockers.includes('generated_candidate_rejected'), true);

  const unsafeSlug = 'unsafe-part';
  preparePackage(tempRoot, unsafeSlug);
  const unsafe = readyCandidate(unsafeSlug, {
    path: '../outside/inspection_evidence.json',
    normalized_source_ref: '../outside/inspection_evidence.json',
    document_signals: {
      source_ref: '../outside/inspection_evidence.json',
    },
  });
  const unsafeManifest = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: intakeReport([packageEntry(unsafeSlug, { candidate: unsafe })], [unsafe]),
    generatedAt: '2026-05-23T01:00:00.000Z',
  });
  assert.equal(unsafeManifest.summary.promotion_can_run, false);
  assert.equal(unsafeManifest.packages[0].promotion_status, 'blocked_safety_checks');
  assert.equal(unsafeManifest.packages[0].blockers.includes('unsafe_evidence_path'), true);
  assert.equal(
    JSON.stringify(unsafeManifest.packages[0].commands_to_run).includes('..'),
    false,
    'unsafe paths must not be serialized into runnable commands'
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('inspection-evidence-promotion-dry-run.test.js: ok');
