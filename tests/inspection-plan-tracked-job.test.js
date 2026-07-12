import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';

const ROOT = resolve(import.meta.dirname, '..');
const external = await mkdtemp(join(tmpdir(), 'inspection-plan-jobs-'));
try {
  const store = createJobStore({ jobsDir: external });
  const executor = createJobExecutor({ projectRoot: ROOT, jobStore: store });
  const queued = await store.createJob({ type: 'inspection-plan', review_pack_path: 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json', scope: 'full', options: { generated_at: '2026-07-12T00:00:00Z' } });
  await executor.execute(queued.id);
  const completed = await store.getJob(queued.id);
  assert.equal(completed.status, 'succeeded', completed.error?.message);
  assert.equal(completed.result.plan.status, 'ready_for_human_release');
  assert.equal(completed.result.plan.boundaries.inspection_evidence, false);
  assert.deepEqual(Object.keys(completed.artifacts).sort(), ['checksheet', 'inspection_plan', 'result_template', 'supplier_request']);
  assert.equal(JSON.parse(await readFile(completed.artifacts.inspection_plan, 'utf8')).plan_id, completed.result.plan.plan_id);
  assert.equal(completed.manifest.artifacts.some((entry) => entry.type === 'inspection-result-template.csv'), true);
} finally { await rm(external, { recursive: true, force: true }); }

console.log('inspection-plan-tracked-job.test.js: ok');
