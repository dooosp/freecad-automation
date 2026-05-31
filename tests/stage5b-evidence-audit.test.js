import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import {
  buildStage5bEvidenceAuditManifest,
  writeStage5bEvidenceAuditBundle,
} from '../src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js';
import { buildInspectionEvidencePromotionDryRunManifest } from '../src/services/inspection-evidence-intake/promotion-dry-run-service.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');

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

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function waitForJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`, {
      headers: { accept: 'application/json' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload.job.status === 'succeeded') return payload.job;
    if (payload.job.status === 'failed') {
      throw new Error(payload.job.error?.message || 'Stage 5B audit tracked job failed');
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for Stage 5B audit job ${jobId}`);
}

function repoRelative(path, root = ROOT) {
  return relative(root, path).replaceAll('\\', '/');
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

function writeMinimalCanonicalPackage(projectRoot, slug) {
  writeText(join(projectRoot, 'docs/examples', slug, 'cad', `${slug}.step`), 'ISO-10303-21;\n');
  writeText(join(projectRoot, 'docs/examples', slug, 'config.toml'), `name = "${slug}"\n`);
  writeJson(join(projectRoot, 'docs/examples', slug, 'review', 'review_pack.json'), {
    evidence_ledger: { records: [] },
    source_artifact_refs: [],
  });
  writeJson(join(projectRoot, 'docs/examples', slug, 'readiness', 'readiness_report.json'), {
    readiness_summary: readiness(slug),
  });
}

function fixtureReadyCandidate(slug) {
  const path = 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json';
  return {
    path,
    source_kind: 'tracked_repo_fixture',
    source_format: 'json',
    classification: 'genuine_valid',
    matched_package: slug,
    match_confidence: 'high',
    attachment_ready: true,
    blockers: [],
    normalized_source_ref: path,
    document_signals: {
      source_ref: path,
      package_id: slug,
      inspected_part: slug,
      measured_feature_ids: ['mount_hole_a_diameter'],
    },
    attachment_plan: {
      matched_package: slug,
      match_confidence: 'high',
      attachment_ready: true,
      blockers: [],
      canonical_next_command: ['fcad', 'review-context', '--inspection-evidence', path],
      candidate_package_matches: [{ slug, score: 285, match_signals: ['explicit_package_id'] }],
      matched_features: [{ candidate_feature_id: 'mount_hole_a_diameter', canonical_feature_id: 'mount_hole_a_diameter' }],
      unmatched_features: [],
      missing_required_features: [],
    },
  };
}

function intakeReportForCandidate(slug, candidate) {
  const ready = readiness(slug);
  return {
    artifact_type: 'inspection_evidence_intake_report',
    schema_version: '1.0',
    generated_at: '2026-05-23T00:00:00.000Z',
    source_boundary: {
      hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
      rejected_as_final_evidence: ['fixtures', 'generated CAD/drawing/quality/DFM/readiness/review/standard-doc/release artifacts'],
    },
    searched_sources: [{ kind: 'tracked_repo_files', status: 'searched', path_count: 1, candidate_path_count: 1 }],
    github_discovery: {
      enabled: false,
      repo: 'dooosp/freecad-automation',
      searched_sources: [],
      skipped_sources: [],
      downloaded_candidates: [],
      accepted_candidate_count: 0,
      rejected_candidate_count: 0,
      rejection_classes: {},
    },
    packages: [{
      slug,
      classification: 'genuine_valid',
      readiness_before: ready,
      readiness_after: ready,
      accepted_candidates: [candidate],
      rejected_candidates: [],
      attachment_plan: candidate.attachment_plan,
      candidate_attachment_plans: [candidate.attachment_plan],
      intake_action: {
        status: 'ready_for_canonical_attachment',
        mode: 'canonical_review_context_chain_required',
        attachment_ready: true,
        blockers: [],
      },
    }],
    accepted_candidates: [candidate],
    rejected_candidates: [],
    summary: {
      package_count: 1,
      candidate_count: 1,
      accepted_candidate_count: 1,
      attachment_ready_candidate_count: 1,
      rejected_candidate_count: 0,
      genuine_inspection_evidence_found: true,
      requires_human_measurement_entry: false,
      readiness_truth: 'valid candidates require canonical review-context attachment/regeneration before readiness may change',
    },
  };
}

mkdirSync(join(ROOT, 'tmp/codex'), { recursive: true });
const repoTempRoot = mkdtempSync(join(ROOT, 'tmp/codex/stage5b-audit-test-'));
const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-stage5b-audit-'));

try {
  const noValidOut = join(repoTempRoot, 'no-valid-audit');
  const noValidResult = await writeStage5bEvidenceAuditBundle({
    projectRoot: ROOT,
    outDir: noValidOut,
    packageSlugs: ['quality-pass-bracket'],
    includeGitHub: false,
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  const noValidManifest = readJson(join(noValidOut, 'stage5b_audit_manifest.json'));
  const noValidDryRun = readJson(join(noValidOut, 'promotion_dry_run_manifest.json'));

  assert.equal(noValidResult.manifest.artifact_type, 'stage5b_evidence_audit_manifest');
  assert.equal(existsSync(join(noValidOut, 'intake_report.json')), true);
  assert.equal(existsSync(join(noValidOut, 'promotion_dry_run_manifest.json')), true);
  assert.equal(existsSync(join(noValidOut, 'stage5b_audit_manifest.json')), true);
  assert.equal(existsSync(join(noValidOut, 'stage5b_audit_summary.md')), true);
  assert.equal(noValidManifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(noValidManifest.summary.promotion_can_run, false);
  assert.equal(noValidManifest.summary.readiness_remains_held, true);
  assert.equal(noValidManifest.readiness_held_truth.no_promotion_can_run, true);
  assert.match(noValidManifest.readiness_held_truth.statement, /No genuine completed inspection evidence/i);
  assert.equal(noValidManifest.canonical_package_readiness_states[0].slug, 'quality-pass-bracket');
  assert.equal(noValidManifest.canonical_package_readiness_states[0].readiness_after.gate_decision, 'hold_for_evidence_completion');
  assert.equal(noValidManifest.outputs.intake_report.path, repoRelative(join(noValidOut, 'intake_report.json')));
  assert.equal(noValidDryRun.source_intake_report.path, noValidManifest.outputs.intake_report.path);
  assert.equal(noValidDryRun.summary.promotion_can_run, false);
  assert.equal(noValidManifest.outputs.intake_report.sha256, noValidDryRun.source_intake_report.sha256);
  assert.equal(
    noValidManifest.next_safe_commands.some((entry) => entry.name === 'promotion_dry_run' && entry.mutates_canonical_artifacts === false),
    true
  );

  const fixtureSlug = 'fixture-only-part';
  writeMinimalCanonicalPackage(tempRoot, fixtureSlug);
  const fixtureCandidate = fixtureReadyCandidate(fixtureSlug);
  const fixtureIntakeReport = intakeReportForCandidate(fixtureSlug, fixtureCandidate);
  const fixtureDryRun = buildInspectionEvidencePromotionDryRunManifest({
    projectRoot: tempRoot,
    intakeReport: fixtureIntakeReport,
    intakeReportPath: 'output/intake_report.json',
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  const fixtureAudit = buildStage5bEvidenceAuditManifest({
    projectRoot: tempRoot,
    outDir: join(tempRoot, 'fixture-audit'),
    intakeReport: fixtureIntakeReport,
    intakeReportPath: join(tempRoot, 'output/intake_report.json'),
    promotionDryRunManifest: fixtureDryRun,
    promotionDryRunManifestPath: join(tempRoot, 'output/promotion_dry_run_manifest.json'),
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  assert.equal(fixtureAudit.summary.attachment_ready_candidate_count, 0);
  assert.equal(fixtureAudit.attachment_ready.count, 0);
  assert.equal(fixtureAudit.summary.promotion_can_run, false);
  assert.equal(fixtureAudit.summary.readiness_remains_held, true);
  assert.equal(
    fixtureAudit.blockers.includes('fixture_candidate_not_canonical_evidence'),
    true,
    'fixture-only attachment-ready candidates must block promotion in the audit'
  );

  const generatedSlug = 'generated-artifact-part';
  writeMinimalCanonicalPackage(tempRoot, generatedSlug);
  writeJson(join(tempRoot, 'docs/examples', generatedSlug, 'quality', `${generatedSlug}_create_quality.json`), {
    artifact_type: 'create_quality_report',
    schema_version: '1.0',
    checks: [],
  });
  const generatedAuditDir = join(tempRoot, 'generated-audit');
  const generatedResult = await writeStage5bEvidenceAuditBundle({
    projectRoot: tempRoot,
    outDir: generatedAuditDir,
    packageSlugs: [generatedSlug],
    trackedPaths: [
      `docs/examples/${generatedSlug}/quality/${generatedSlug}_create_quality.json`,
      `docs/examples/${generatedSlug}/readiness/readiness_report.json`,
      `docs/examples/${generatedSlug}/review/review_pack.json`,
    ],
    includeGitHub: false,
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  assert.equal(generatedResult.manifest.summary.genuine_inspection_evidence_found, false);
  assert.equal(generatedResult.manifest.source_classes.rejected_counts.invalid_generated >= 1, true);
  assert.equal(generatedResult.manifest.summary.promotion_can_run, false);
  assert.equal(generatedResult.manifest.blockers.includes('generated_candidate_rejected'), true);

  const githubSlug = 'github-unavailable-part';
  writeMinimalCanonicalPackage(tempRoot, githubSlug);
  const githubResult = await writeStage5bEvidenceAuditBundle({
    projectRoot: tempRoot,
    outDir: join(tempRoot, 'github-audit'),
    packageSlugs: [githubSlug],
    trackedPaths: [
      `docs/examples/${githubSlug}/readiness/readiness_report.json`,
      `docs/examples/${githubSlug}/review/review_pack.json`,
    ],
    includeGitHub: true,
    githubRunner: async () => {
      throw new Error('gh unavailable in audit test');
    },
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  assert.equal(githubResult.manifest.github_summary.enabled, true);
  assert.equal(
    githubResult.manifest.github_summary.skipped_sources.some((source) => source.reason_code === 'github_cli_unavailable'),
    true
  );
  assert.equal(githubResult.manifest.summary.promotion_can_run, false);

  const mutationSlug = 'no-mutation-part';
  writeMinimalCanonicalPackage(tempRoot, mutationSlug);
  const reviewPath = join(tempRoot, 'docs/examples', mutationSlug, 'review', 'review_pack.json');
  const readinessPath = join(tempRoot, 'docs/examples', mutationSlug, 'readiness', 'readiness_report.json');
  const reviewBefore = readFileSync(reviewPath, 'utf8');
  const readinessBefore = readFileSync(readinessPath, 'utf8');
  await writeStage5bEvidenceAuditBundle({
    projectRoot: tempRoot,
    outDir: join(tempRoot, 'no-mutation-audit'),
    packageSlugs: [mutationSlug],
    trackedPaths: [
      `docs/examples/${mutationSlug}/readiness/readiness_report.json`,
      `docs/examples/${mutationSlug}/review/review_pack.json`,
    ],
    includeGitHub: false,
    generatedAt: '2026-05-24T00:00:00.000Z',
  });
  assert.equal(readFileSync(reviewPath, 'utf8'), reviewBefore, 'audit bundle must not mutate canonical review_pack.json');
  assert.equal(readFileSync(readinessPath, 'utf8'), readinessBefore, 'audit bundle must not mutate canonical readiness_report.json');

  const apiSlug = 'api-audit-part';
  writeMinimalCanonicalPackage(tempRoot, apiSlug);
  const apiReviewPath = join(tempRoot, 'docs/examples', apiSlug, 'review', 'review_pack.json');
  const apiReadinessPath = join(tempRoot, 'docs/examples', apiSlug, 'readiness', 'readiness_report.json');
  const apiReviewBefore = readFileSync(apiReviewPath, 'utf8');
  const apiReadinessBefore = readFileSync(apiReadinessPath, 'utf8');
  const { server } = createLocalApiServer({
    projectRoot: tempRoot,
    jobsDir: join(tempRoot, 'output', 'jobs'),
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const { response: auditResponse, payload: auditPayload } = await postJson(`${baseUrl}/jobs`, {
      type: 'stage5b-evidence-audit',
      options: {
        include_github: false,
      },
    });
    assert.equal(auditResponse.status, 202);
    assert.equal(auditPayload.job.type, 'stage5b-evidence-audit');
    assert.equal('out_dir' in auditPayload.job.request, false);
    assert.equal(JSON.stringify(auditPayload).includes(tempRoot), false);

    const auditJob = await waitForJob(baseUrl, auditPayload.job.id);
    assert.equal(auditJob.result.artifact_type, 'stage5b_evidence_audit_manifest');
    assert.equal(auditJob.result.summary.genuine_inspection_evidence_found, false);
    assert.equal(auditJob.result.summary.promotion_can_run, false);
    assert.equal(auditJob.result.summary.readiness_remains_held, true);
    assert.equal(auditJob.result.summary.canonical_artifacts_mutated, false);
    assert.equal(auditJob.result.readiness_held_truth.no_promotion_can_run, true);
    assert.equal(JSON.stringify(auditJob).includes(tempRoot), false);

    const artifactsResponse = await fetch(`${baseUrl}/jobs/${auditJob.id}/artifacts`, {
      headers: { accept: 'application/json' },
    });
    assert.equal(artifactsResponse.status, 200);
    const artifactsPayload = await artifactsResponse.json();
    const artifactTypes = artifactsPayload.artifacts.map((artifact) => artifact.type).sort();
    assert.deepEqual(artifactTypes, [
      'inspection-evidence.intake-report',
      'inspection-evidence.promotion-dry-run-manifest',
      'stage5b.evidence-audit-manifest',
      'stage5b.evidence-audit-summary',
    ].sort());
    assert.equal(JSON.stringify(artifactsPayload).includes(tempRoot), false);

    const auditManifestArtifact = artifactsPayload.artifacts.find((artifact) =>
      artifact.type === 'stage5b.evidence-audit-manifest'
    );
    assert.equal(Boolean(auditManifestArtifact), true);
    assert.equal(auditManifestArtifact.file_name, 'stage5b_audit_manifest.json');
    assert.equal(auditManifestArtifact.capabilities.can_open, true);

    const auditManifestResponse = await fetch(`${baseUrl}${auditManifestArtifact.links.open}`, {
      headers: { accept: 'application/json' },
    });
    assert.equal(auditManifestResponse.status, 200);
    const trackedAuditManifest = await auditManifestResponse.json();
    assert.equal(trackedAuditManifest.artifact_type, 'stage5b_evidence_audit_manifest');
    assert.equal(trackedAuditManifest.summary.genuine_inspection_evidence_found, false);
    assert.equal(trackedAuditManifest.summary.promotion_can_run, false);

    const arbitraryPreviewResponse = await fetch(
      `${baseUrl}/jobs/${auditJob.id}/artifacts/package-json/content?path=${encodeURIComponent(join(ROOT, 'package.json'))}`,
      { headers: { accept: 'application/json' } }
    );
    assert.equal(arbitraryPreviewResponse.status, 404);
    const arbitraryPreviewText = await arbitraryPreviewResponse.text();
    assert.equal(arbitraryPreviewText.includes('"name"'), false);
    assert.equal(arbitraryPreviewText.includes('freecad-automation'), false);

    assert.equal(readFileSync(apiReviewPath, 'utf8'), apiReviewBefore, 'tracked audit job must not mutate canonical review_pack.json');
    assert.equal(readFileSync(apiReadinessPath, 'utf8'), apiReadinessBefore, 'tracked audit job must not mutate canonical readiness_report.json');
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const unsafeCli = spawnSync(process.execPath, [
    'bin/fcad.js',
    'stage5b-evidence-audit',
    '--out-dir',
    '../stage5b-audit-outside-repo',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(unsafeCli.status, 0, 'CLI should reject output directories outside the repo');
  assert.match(unsafeCli.stderr + unsafeCli.stdout, /out-dir.*inside the repository root|path safety/i);
} finally {
  rmSync(repoTempRoot, { recursive: true, force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('stage5b-evidence-audit.test.js: ok');
