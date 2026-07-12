import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { createRevisionImpactPythonRaceGate } from './helpers/revision-impact-python-race-gate.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(ROOT, 'tests/fixtures/revision-impact');
const externalRoot = mkdtempSync(join(tmpdir(), 'fcad-revision-impact-jobs-'));

try {
  const jobStore = createJobStore({ jobsDir: join(externalRoot, 'jobs') });
  const executor = createJobExecutor({ projectRoot: ROOT, jobStore });
  const baselineSource = readFileSync(join(FIXTURE_ROOT, 'tightened-tolerance-baseline-review-pack.json'), 'utf8');
  const candidateSource = readFileSync(join(FIXTURE_ROOT, 'tightened-tolerance-candidate-review-pack.json'), 'utf8');

  const baselineJob = await jobStore.createJob({ type: 'review-context' });
  const candidateJob = await jobStore.createJob({ type: 'review-context' });
  const baselinePath = await jobStore.writeJobFile(baselineJob.id, 'artifacts/review_pack.json', baselineSource);
  const candidatePath = await jobStore.writeJobFile(candidateJob.id, 'artifacts/review_pack.json', candidateSource);
  const replacementCandidatePath = join(dirname(candidatePath), 'replacement_review_pack.json');
  writeFileSync(
    replacementCandidatePath,
    readFileSync(join(FIXTURE_ROOT, 'unchanged-review-pack.json'))
  );

  const compareJob = await jobStore.createJob({
    type: 'compare-rev',
    baseline_path: baselinePath,
    candidate_path: candidatePath,
    options: { generated_at: '2026-07-11T00:00:00Z' },
  });
  const raceGate = createRevisionImpactPythonRaceGate(externalRoot, 'python-gate');
  const restoreEnv = raceGate.installProcessEnv();
  const execution = executor.execute(compareJob.id);
  let executionSettled = false;
  try {
    await raceGate.waitUntilReady();
    renameSync(replacementCandidatePath, candidatePath);
    raceGate.release();
    await execution;
    executionSettled = true;
  } finally {
    raceGate.release();
    if (!executionSettled) await execution.catch(() => {});
    restoreEnv();
  }

  const completed = await jobStore.getJob(compareJob.id);
  assert.equal(completed.status, 'succeeded', completed.error?.message);
  const artifacts = await jobStore.listArtifacts(compareJob.id);
  const impactJson = artifacts.find((artifact) => artifact.type === 'revision-impact.report-json');
  const impactMarkdown = artifacts.find((artifact) => artifact.type === 'revision-impact.report-markdown');
  const comparisonJson = artifacts.find((artifact) => artifact.type === 'revision-comparison.json');
  assert.equal(impactJson?.exists, true);
  assert.equal(impactMarkdown?.exists, true);
  assert.equal(comparisonJson?.exists, true);

  const report = JSON.parse(readFileSync(impactJson.path, 'utf8'));
  const comparison = JSON.parse(readFileSync(comparisonJson.path, 'utf8'));
  assert.equal(JSON.parse(readFileSync(candidatePath, 'utf8')).part.revision, 'A');
  assert.equal(comparison.revision.candidate, 'B', 'legacy job output must use the loaded candidate snapshot');
  assert.equal(report.candidate.revision, 'B', 'impact job output must use the same candidate snapshot');
  assert.equal(comparison.revision.candidate, report.candidate.revision);
  assert.equal(
    report.candidate.source_hashes.review_pack,
    createHash('sha256').update(candidateSource).digest('hex'),
    'job impact provenance must hash the candidate bytes used by both outputs'
  );
  const candidateManifestEntry = completed.manifest.artifacts.find(
    (entry) => entry.type === 'input.review-pack.candidate'
  );
  assert.equal(
    candidateManifestEntry?.sha256,
    report.candidate.source_hashes.review_pack,
    'job manifest provenance must remain bound to the shared candidate snapshot'
  );
  assert.equal(candidateManifestEntry?.size_bytes, Buffer.byteLength(candidateSource));
  assert.equal(report.summary.decision, 'reinspection_required');
  assert.equal(report.summary.reinspection_required_count, 1);
  assert.equal(report.changes.some((change) => change.change_type === 'tolerance_change'), true);
  assert.equal(JSON.stringify(report).includes(externalRoot), false, 'public report must sanitize external job-store paths');
  assert.equal(report.baseline.artifact_refs.some((ref) => ref.startsWith('input/')), true);
  assert.equal(report.candidate.artifact_refs.some((ref) => ref.startsWith('input/')), true);
  assert.equal(report.baseline.artifact_refs.some((ref) => ref.startsWith('/') || ref.includes('..')), false);
  assert.equal(report.candidate.artifact_refs.some((ref) => ref.startsWith('/') || ref.includes('..')), false);
} finally {
  rmSync(externalRoot, { recursive: true, force: true });
}

console.log('revision-impact-external-job-store.test.js: ok');
