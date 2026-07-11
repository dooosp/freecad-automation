import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';

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

  const compareJob = await jobStore.createJob({
    type: 'compare-rev',
    baseline_path: baselinePath,
    candidate_path: candidatePath,
    options: { generated_at: '2026-07-11T00:00:00Z' },
  });
  await executor.execute(compareJob.id);

  const completed = await jobStore.getJob(compareJob.id);
  assert.equal(completed.status, 'succeeded', completed.error?.message);
  const artifacts = await jobStore.listArtifacts(compareJob.id);
  const impactJson = artifacts.find((artifact) => artifact.type === 'revision-impact.report-json');
  const impactMarkdown = artifacts.find((artifact) => artifact.type === 'revision-impact.report-markdown');
  assert.equal(impactJson?.exists, true);
  assert.equal(impactMarkdown?.exists, true);

  const report = JSON.parse(readFileSync(impactJson.path, 'utf8'));
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
