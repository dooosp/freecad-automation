import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { listZipEntries } from '../lib/zip-archive.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK_FIXTURE = resolve(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json');
const READINESS_REPORT_FIXTURE = resolve(ROOT, 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json');
const CONFIG_EXAMPLE = resolve(ROOT, 'configs/examples/controller_housing_eol.toml');
const REVIEW_CONTEXT_FIXTURE = resolve(ROOT, 'tests/fixtures/sample_part_context.json');

function writeAlignedConfig(filePath, {
  templatePath = CONFIG_EXAMPLE,
  name = 'sample_part',
  revision = 'A',
} = {}) {
  const template = readFileSync(templatePath, 'utf8');
  const next = template
    .replace(/^name = ".*"$/m, `name = "${name}"`)
    .replace(/^revision = ".*"$/m, `revision = "${revision}"`);
  writeFileSync(filePath, next, 'utf8');
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitForJob(baseUrl, jobId, expectedStatus = 'succeeded') {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload.job.status === expectedStatus) {
      return payload.job;
    }
    if (payload.job.status === 'failed') {
      throw new Error(`Job ${jobId} failed: ${payload.job.error?.message || 'unknown error'}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function fetchArtifacts(baseUrl, jobId) {
  const response = await fetch(`${baseUrl}/jobs/${jobId}/artifacts`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(response.status, 200);
  return response.json();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function findArtifact(artifacts, predicate, message) {
  const artifact = artifacts.find(predicate);
  assert.equal(Boolean(artifact), true, message);
  return artifact;
}

function assertNoStaleCanonicalNames(artifacts, context) {
  const staleNames = new Set([
    'readiness-report.json',
    'standard-docs-manifest.json',
    'release-bundle-manifest.json',
    'release-bundle.zip',
  ]);
  for (const artifact of artifacts) {
    assert.equal(
      staleNames.has(artifact.file_name),
      false,
      `${context} exposed stale AF artifact name ${artifact.file_name}`
    );
  }
}

async function assertJobFileArtifact(jobStore, jobId, {
  fileName,
  type = null,
  reentryTarget = null,
}) {
  const artifacts = await jobStore.listArtifacts(jobId);
  const artifact = findArtifact(
    artifacts,
    (entry) => entry.file_name === fileName && (!type || entry.type === type),
    `Expected job ${jobId} artifact ${fileName}`
  );
  assert.equal(artifact.exists, true, `${fileName} should exist on disk`);
  assert.equal(existsSync(artifact.path), true, `${fileName} path should exist on disk`);
  assert.equal(basename(artifact.path), fileName);
  if (reentryTarget) {
    assert.equal(artifact.metadata?.af_contract?.reentry_target, reentryTarget);
    assert.equal(artifact.metadata?.af_contract?.canonical_file_name, fileName);
  }
  return artifact;
}

function assertManifestFile(job, fileName, {
  type = null,
  reentryTarget = null,
} = {}) {
  const artifact = findArtifact(
    job.manifest?.artifacts || [],
    (entry) => basename(entry.path) === fileName && (!type || entry.type === type),
    `Expected manifest entry for ${fileName}`
  );
  assert.equal(existsSync(artifact.path), true, `Manifest entry ${fileName} should point to a real file`);
  if (reentryTarget) {
    assert.equal(artifact.metadata?.af_contract?.reentry_target, reentryTarget);
    assert.equal(artifact.metadata?.af_contract?.canonical_file_name, fileName);
  }
  return artifact;
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-af-jobs-'));

try {
  const docsConfigPath = join(tmpRoot, 'sample_part_docs.toml');
  writeAlignedConfig(docsConfigPath);
  const reviewContextPath = join(tmpRoot, 'sample_part_context.runtime-safe.json');
  const reviewContextFixture = JSON.parse(readFileSync(REVIEW_CONTEXT_FIXTURE, 'utf8'));
  if (reviewContextFixture?.geometry_source && typeof reviewContextFixture.geometry_source === 'object') {
    delete reviewContextFixture.geometry_source.path;
  }
  writeFileSync(reviewContextPath, JSON.stringify(reviewContextFixture, null, 2), 'utf8');
  const { server, jobStore } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(tmpRoot, 'jobs'),
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const { response: initialReviewResponse, payload: initialReviewPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'review-context',
    context_path: reviewContextPath,
  });
  assert.equal(initialReviewResponse.status, 202);
  assert.equal(initialReviewPayload.job.execution.command, 'review-context');
  const initialReviewJob = await waitForJob(baseUrl, initialReviewPayload.job.id);
  assert.equal(initialReviewJob.execution.lifecycle_state, 'succeeded');
  const initialReviewArtifactsPayload = await fetchArtifacts(baseUrl, initialReviewJob.id);
  const engineeringContextArtifact = initialReviewArtifactsPayload.artifacts.find((artifact) => artifact.type === 'engineering_context.json');
  assert.equal(Boolean(engineeringContextArtifact), true);
  const directReviewPack = initialReviewArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'review_pack');
  assert.equal(Boolean(directReviewPack), true);
  assert.equal(directReviewPack.contract.canonical_file_name, 'review_pack.json');
  assertNoStaleCanonicalNames(initialReviewArtifactsPayload.artifacts, 'review-context');
  const internalReviewPack = await assertJobFileArtifact(jobStore, initialReviewJob.id, {
    fileName: 'review_pack.json',
    type: 'review-pack.json',
    reentryTarget: 'review_pack',
  });
  assert.equal(readJson(internalReviewPack.path).artifact_type, 'review_pack');

  const { response: readinessResponse, payload: readinessPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'readiness-pack',
    artifact_ref: {
      job_id: initialReviewJob.id,
      artifact_id: directReviewPack.id,
    },
  });
  assert.equal(readinessResponse.status, 202);
  assert.equal(readinessPayload.job.execution.command, 'readiness-pack');
  assert.equal(readinessPayload.job.execution.lifecycle_state, 'queued');
  assert.deepEqual(readinessPayload.job.request.artifact_ref, {
    job_id: initialReviewJob.id,
    artifact_id: directReviewPack.id,
  });

  const readinessJob = await waitForJob(baseUrl, readinessPayload.job.id);
  assert.equal(readinessJob.execution.command, 'readiness-pack');
  assert.equal(readinessJob.execution.lifecycle_state, 'succeeded');

  const readinessArtifactsPayload = await fetchArtifacts(baseUrl, readinessJob.id);
  assertNoStaleCanonicalNames(readinessArtifactsPayload.artifacts, 'readiness-pack');
  const readinessArtifact = readinessArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'readiness_report');
  assert.equal(Boolean(readinessArtifact), true);
  assert.equal(readinessArtifact.contract.canonical_file_name, 'readiness_report.json');
  const internalReadinessReport = await assertJobFileArtifact(jobStore, readinessJob.id, {
    fileName: 'readiness_report.json',
    type: 'readiness-report.json',
    reentryTarget: 'readiness_report',
  });
  const readinessDocument = readJson(internalReadinessReport.path);
  assert.equal(readinessDocument.artifact_type, 'readiness_report');
  assert.equal(
    readinessDocument.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack'),
    true,
    'readiness_report.json should preserve review_pack provenance'
  );

  const { response: compareResponse, payload: comparePayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'compare-rev',
    baseline_path: REVIEW_PACK_FIXTURE,
    candidate_path: REVIEW_PACK_FIXTURE,
  });
  assert.equal(compareResponse.status, 202);
  assert.equal(comparePayload.job.execution.command, 'compare-rev');
  const compareJob = await waitForJob(baseUrl, comparePayload.job.id);
  assert.equal(compareJob.execution.lifecycle_state, 'succeeded');

  const { response: stabilizationResponse, payload: stabilizationPayload } = await postJson(`${baseUrl}/jobs`, {
    type: 'stabilization-review',
    baseline_path: READINESS_REPORT_FIXTURE,
    candidate_path: READINESS_REPORT_FIXTURE,
  });
  assert.equal(stabilizationResponse.status, 202);
  assert.equal(stabilizationPayload.job.execution.command, 'stabilization-review');
  const stabilizationJob = await waitForJob(baseUrl, stabilizationPayload.job.id);
  assert.equal(stabilizationJob.execution.lifecycle_state, 'succeeded');

  const { response: docsResponse, payload: docsPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'generate-standard-docs',
    artifact_ref: {
      job_id: readinessJob.id,
      artifact_id: readinessArtifact.id,
    },
  });
  assert.equal(docsResponse.status, 202);
  assert.equal(docsPayload.job.execution.command, 'generate-standard-docs');
  assert.deepEqual(docsPayload.job.request.artifact_ref, {
    job_id: readinessJob.id,
    artifact_id: readinessArtifact.id,
  });
  const docsJob = await waitForJob(baseUrl, docsPayload.job.id);
  assert.equal(docsJob.execution.lifecycle_state, 'succeeded');

  const docsArtifactsPayload = await fetchArtifacts(baseUrl, docsJob.id);
  assertNoStaleCanonicalNames(docsArtifactsPayload.artifacts, 'generate-standard-docs');
  const docsReadinessArtifact = docsArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'readiness_report');
  assert.equal(Boolean(docsReadinessArtifact), true);
  const docsManifestArtifact = docsArtifactsPayload.artifacts.find((artifact) => artifact.type === 'standard-docs.summary');
  assert.equal(Boolean(docsManifestArtifact), true);
  assert.equal(docsManifestArtifact.file_name, 'standard_docs_manifest.json');
  assert.equal(docsArtifactsPayload.artifacts.some((artifact) => artifact.type === 'config.effective'), true);
  assert.equal(docsArtifactsPayload.artifacts.some((artifact) => artifact.type === 'config.input'), true);
  const docsManifestFile = await assertJobFileArtifact(jobStore, docsJob.id, {
    fileName: 'standard_docs_manifest.json',
    type: 'standard-docs.summary',
  });
  assert.equal(readJson(docsManifestFile.path).artifact_type, 'docs_manifest');

  const { response: packFromArtifactResponse, payload: packFromArtifactPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'pack',
    artifact_ref: {
      job_id: docsJob.id,
      artifact_id: docsReadinessArtifact.id,
    },
  });
  assert.equal(packFromArtifactResponse.status, 202);
  assert.equal(packFromArtifactPayload.job.type, 'pack');
  assert.deepEqual(packFromArtifactPayload.job.request.artifact_ref, {
    job_id: docsJob.id,
    artifact_id: docsReadinessArtifact.id,
  });

  const packJob = await waitForJob(baseUrl, packFromArtifactPayload.job.id);
  assert.equal(packJob.execution.lifecycle_state, 'succeeded');
  const packArtifactsPayload = await fetchArtifacts(baseUrl, packJob.id);
  assertNoStaleCanonicalNames(packArtifactsPayload.artifacts, 'pack');
  const bundleArtifact = packArtifactsPayload.artifacts.find((artifact) => artifact.contract?.reentry_target === 'release_bundle');
  assert.equal(Boolean(bundleArtifact), true);
  assert.equal(bundleArtifact.contract.canonical_file_name, 'release_bundle.zip');
  assert.equal(packArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.docs-manifest'), true);
  const packJobRecord = await jobStore.getJob(packJob.id);
  assertManifestFile(packJobRecord, 'release_bundle.zip', {
    type: 'release-bundle.zip',
    reentryTarget: 'release_bundle',
  });
  assertManifestFile(packJobRecord, 'release_bundle_manifest.json', {
    type: 'release-bundle.manifest.json',
  });
  assertManifestFile(packJobRecord, 'readiness_report.json', {
    type: 'input.readiness-report',
  });
  assertManifestFile(packJobRecord, 'standard_docs_manifest.json', {
    type: 'input.docs-manifest',
  });
  const internalReleaseBundle = await assertJobFileArtifact(jobStore, packJob.id, {
    fileName: 'release_bundle.zip',
    type: 'release-bundle.zip',
    reentryTarget: 'release_bundle',
  });
  const internalReleaseManifest = await assertJobFileArtifact(jobStore, packJob.id, {
    fileName: 'release_bundle_manifest.json',
    type: 'release-bundle.manifest.json',
  });
  const releaseManifest = readJson(internalReleaseManifest.path);
  assert.equal(releaseManifest.artifact_type, 'release_bundle_manifest');
  assert.equal(releaseManifest.bundle_file.filename, 'release_bundle.zip');
  assert.equal(releaseManifest.readiness_report_ref.path.endsWith('readiness_report.json'), true);
  assert.equal(releaseManifest.docs_manifest_ref.path.endsWith('standard_docs_manifest.json'), true);
  assert.equal(
    releaseManifest.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack'),
    true,
    'release bundle manifest should preserve review_pack provenance'
  );
  const bundleArtifactPaths = releaseManifest.bundle_artifacts.map((entry) => entry.path);
  [
    'canonical/readiness_report.json',
    'canonical/review_pack.json',
    'docs/standard_docs_manifest.json',
    'release_bundle_manifest.json',
    'release_bundle.zip',
  ].forEach((name) => {
    if (name === 'release_bundle.zip') {
      assert.equal(basename(internalReleaseBundle.path), name);
    } else {
      assert.equal(bundleArtifactPaths.includes(name), true, `release bundle manifest should include ${name}`);
    }
  });
  const zipEntries = await listZipEntries(internalReleaseBundle.path);
  const zipEntryNames = zipEntries.map((entry) => entry.name);
  for (const entryPath of bundleArtifactPaths) {
    assert.equal(zipEntryNames.includes(entryPath), true, `release_bundle.zip should contain ${entryPath}`);
  }
  [
    'canonical/readiness-report.json',
    'docs/standard-docs-manifest.json',
    'release-bundle-manifest.json',
  ].forEach((staleName) => {
    assert.equal(zipEntryNames.includes(staleName), false, `release_bundle.zip should not contain stale entry ${staleName}`);
  });
  const bundleOpenResponse = await fetch(`${baseUrl}${bundleArtifact.links.open}`);
  assert.equal(bundleOpenResponse.status, 200);
  const bundleOpenBytes = await bundleOpenResponse.arrayBuffer();
  assert(bundleOpenBytes.byteLength > 0);

  const { response: repackResponse, payload: repackPayload } = await postJson(`${baseUrl}/api/studio/jobs`, {
    type: 'pack',
    artifact_ref: {
      job_id: packJob.id,
      artifact_id: bundleArtifact.id,
    },
  });
  assert.equal(repackResponse.status, 202);
  assert.equal(repackPayload.job.type, 'pack');
  assert.deepEqual(repackPayload.job.request.artifact_ref, {
    job_id: packJob.id,
    artifact_id: bundleArtifact.id,
  });

  const repackJob = await waitForJob(baseUrl, repackPayload.job.id);
  assert.equal(repackJob.execution.lifecycle_state, 'succeeded');
  const repackArtifactsPayload = await fetchArtifacts(baseUrl, repackJob.id);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.release-bundle'), true);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.bundle.readiness-report'), true);
  assert.equal(repackArtifactsPayload.artifacts.some((artifact) => artifact.type === 'input.bundle.docs-manifest'), true);
  assertNoStaleCanonicalNames(repackArtifactsPayload.artifacts, 'release-bundle re-entry pack');

  const recentJobsResponse = await fetch(`${baseUrl}/jobs?limit=1`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(recentJobsResponse.status, 200);
  const recentJobsPayload = await recentJobsResponse.json();
  assert.equal(recentJobsPayload.jobs[0].id, repackJob.id);
  assert.equal(recentJobsPayload.jobs[0].request.artifact_ref.job_id, packJob.id);
  assert.equal(recentJobsPayload.jobs[0].request.artifact_ref.artifact_id, bundleArtifact.id);

  await new Promise((resolveClose) => server.close(resolveClose));
  console.log('af-execution-jobs.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
