import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR,
  buildEvidenceReadinessAudit,
  writeEvidenceReadinessAudit,
} from '../src/services/evidence-readiness-audit/evidence-readiness-audit-service.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const outDirRel = `output/test-evidence-readiness-audit-${process.pid}`;
const outDir = join(ROOT, outDirRel);
const fixedNow = '2026-07-05T00:00:00.000Z';

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
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
      throw new Error(payload.job.error?.message || 'evidence-readiness-audit tracked job failed');
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for evidence-readiness-audit job ${jobId}`);
}

try {
  assert.equal(DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR, 'output/evidence-readiness-audit');

  const readinessPath = join(ROOT, 'docs/examples/quality-pass-bracket/readiness/readiness_report.json');
  const reviewPackPath = join(ROOT, 'docs/examples/quality-pass-bracket/review/review_pack.json');
  const readinessBefore = readFileSync(readinessPath, 'utf8');
  const reviewPackBefore = readFileSync(reviewPackPath, 'utf8');

  const audit = await buildEvidenceReadinessAudit({
    projectRoot: ROOT,
    generatedAt: fixedNow,
    runtimeDiagnosticsFactory: () => ({
      runtime_available: true,
      selected: {
        freecadcmd: '/Users/example/FreeCADCmd',
        python: '/Users/example/python',
      },
      versions: {
        freecad: '1.1.1',
        python: '3.12.0',
      },
    }),
  });

  assert.equal(audit.artifact_type, 'evidence_readiness_audit');
  assert.equal(audit.generated_at, fixedNow);
  assert.equal(audit.non_mutating, true);
  assert.equal(audit.boundary.canonical_artifacts_mutated, false);
  assert.equal(audit.boundary.inspection_evidence_attached, false);
  assert.equal(audit.boundary.readiness_regenerated, false);
  assert.equal(audit.boundary.release_published, false);
  assert.equal(audit.boundary.hard_evidence_rule.includes('Only genuine completed'), true);
  assert.equal(audit.boundary.hard_evidence_rule.includes('QIF-lite'), true);
  assert.equal(audit.summary.package_count, 5);
  assert.equal(audit.summary.held_package_count, 5);
  assert.equal(audit.summary.authorized_inspection_evidence_record_count, 0);
  assert.equal(audit.summary.trusted_evidence_record_count, 0);
  assert.equal(audit.summary.generated_review_artifact_count > 0, true);
  assert.equal(audit.summary.evidence_graph_package_count, 5);
  assert.equal(audit.summary.runtime_fingerprint_package_count, 5);
  assert.equal(audit.summary.qif_lite_package_count, 5);
  assert.deepEqual(audit.summary.pr170_artifact_coverage, {
    evidence_graph_package_count: 5,
    runtime_fingerprint_package_count: 5,
    qif_lite_package_count: 5,
    complete_package_count: 5,
    missing_package_count: 0,
  });
  assert.equal(audit.summary.release_overclaim_risk_count, 5);
  assert.equal(audit.summary.decision, 'hold');
  assert.equal(audit.repo_context.repo_root_basename, 'freecad-automation');
  assert.equal(/^[a-f0-9]{40}$/.test(audit.repo_context.head_sha), true);
  assert.equal(audit.runtime_context.available, true);
  assert.equal(JSON.stringify(audit).includes('/Users/example'), false, 'audit must redact runtime private paths');

  const slugs = audit.packages.map((pkg) => pkg.slug).sort();
  assert.deepEqual(slugs, [
    'controller-housing-eol',
    'hinge-block',
    'motor-mount',
    'plate-with-holes',
    'quality-pass-bracket',
  ]);

  const qualityPackage = audit.packages.find((pkg) => pkg.slug === 'quality-pass-bracket');
  assert.equal(qualityPackage.readiness.status, 'needs_more_evidence');
  assert.equal(qualityPackage.readiness.gate_decision, 'hold_for_evidence_completion');
  assert.equal(qualityPackage.readiness.hold_reasons.includes('inspection_evidence'), true);
  assert.equal(qualityPackage.artifacts.review_pack.exists, true);
  assert.equal(qualityPackage.artifacts.readiness_report.exists, true);
  assert.equal(qualityPackage.artifacts.release_manifest.exists, true);
  assert.equal(qualityPackage.artifacts.evidence_graph.exists, true);
  assert.equal(qualityPackage.artifacts.runtime_fingerprint.exists, true);
  assert.equal(qualityPackage.artifacts.qif_lite_inspection.exists, true);
  assert.equal(qualityPackage.evidence_counts.authorized_inspection, 0);
  assert.equal(qualityPackage.evidence_counts.trusted_inspection, 0);
  assert.equal(qualityPackage.evidence_counts.generated_review > 0, true);
  assert.equal(qualityPackage.pr170_artifacts.evidence_graph.status, 'present_generated_control');
  assert.equal(qualityPackage.pr170_artifacts.runtime_fingerprint.status, 'present_generated_control');
  assert.equal(qualityPackage.pr170_artifacts.qif_lite.status, 'present_generated_control');
  assert.equal(qualityPackage.pr170_artifacts.qif_lite.trusted_inspection_evidence, false);
  assert.equal(qualityPackage.evidence_boundary.pr170_artifacts_are_not_authorized_inspection_evidence, true);
  assert.equal(qualityPackage.evidence_boundary.trusted_vs_generated_explained, true);
  assert.equal(qualityPackage.release_decision.overclaim_if_marked_ready, true);
  assert.match(qualityPackage.release_decision.reason, /release bundle presence does not mean production-ready/i);
  assert.match(qualityPackage.next_safe_commands[0].command.join(' '), /fcad inspection-evidence-intake --package quality-pass-bracket/);
  assert.equal(qualityPackage.next_safe_commands.every((command) => command.mutates_canonical_artifacts === false), true);

  const written = await writeEvidenceReadinessAudit({
    projectRoot: ROOT,
    outDir: outDirRel,
    clean: true,
    generatedAt: fixedNow,
    runtimeDiagnosticsFactory: () => ({ runtime_available: false }),
  });
  assert.equal(written.auditPath, join(outDir, 'evidence_readiness_audit.json'));
  assert.equal(written.summaryPath, join(outDir, 'evidence_readiness_audit.md'));
  assert.equal(existsSync(written.auditPath), true);
  assert.equal(existsSync(written.summaryPath), true);
  const persisted = readJson(written.auditPath);
  assert.equal(persisted.artifact_type, 'evidence_readiness_audit');
  assert.equal(persisted.summary.package_count, 5);
  assert.match(readFileSync(written.summaryPath, 'utf8'), /Evidence\/Readiness Maintainer Audit/);
  assert.match(readFileSync(written.summaryPath, 'utf8'), /Readiness held/);

  assert.equal(readFileSync(readinessPath, 'utf8'), readinessBefore, 'audit must not mutate canonical readiness_report.json');
  assert.equal(readFileSync(reviewPackPath, 'utf8'), reviewPackBefore, 'audit must not mutate canonical review_pack.json');

  const cliOutDirRel = `${outDirRel}-cli`;
  const cli = spawnSync(process.execPath, [
    'bin/fcad.js',
    'evidence-readiness-audit',
    '--out-dir',
    cliOutDirRel,
    '--generated-at',
    fixedNow,
    '--clean',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.match(cli.stdout, /Evidence\/readiness audit: output\/test-evidence-readiness-audit-/);
  const cliAudit = readJson(join(ROOT, cliOutDirRel, 'evidence_readiness_audit.json'));
  assert.equal(cliAudit.summary.decision, 'hold');
  assert.equal(cliAudit.summary.held_package_count, 5);

  const { server } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(ROOT, `${outDirRel}-jobs`),
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const auditResponse = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'evidence-readiness-audit',
        options: {},
      }),
    });
    assert.equal(auditResponse.status, 202);
    const auditPayload = await auditResponse.json();
    assert.equal(auditPayload.job.type, 'evidence-readiness-audit');
    assert.equal('out_dir' in auditPayload.job.request, false);

    const trackedJob = await waitForJob(baseUrl, auditPayload.job.id);
    assert.equal(trackedJob.result.artifact_type, 'evidence_readiness_audit');
    assert.equal(trackedJob.result.summary.package_count, 5);
    assert.equal(trackedJob.result.summary.decision, 'hold');
    assert.equal(JSON.stringify(trackedJob).includes(ROOT), false);

    const artifactsResponse = await fetch(`${baseUrl}/jobs/${trackedJob.id}/artifacts`, {
      headers: { accept: 'application/json' },
    });
    assert.equal(artifactsResponse.status, 200);
    const artifactsPayload = await artifactsResponse.json();
    const artifactTypes = artifactsPayload.artifacts.map((artifact) => artifact.type).sort();
    assert.deepEqual(artifactTypes, [
      'evidence-readiness.audit-json',
      'evidence-readiness.audit-summary',
    ].sort());
    const auditJsonArtifact = artifactsPayload.artifacts.find((artifact) =>
      artifact.type === 'evidence-readiness.audit-json'
    );
    assert.equal(auditJsonArtifact.file_name, 'evidence_readiness_audit.json');
    assert.equal(auditJsonArtifact.capabilities.can_open, true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  console.log('evidence-readiness-audit.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(`${outDir}-cli`, { recursive: true, force: true });
  rmSync(`${outDir}-jobs`, { recursive: true, force: true });
}
