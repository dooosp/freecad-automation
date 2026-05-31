import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-job-queue-controls-'));
const jobsDir = join(tmpRoot, 'jobs');

function buildConfig() {
  return {
    name: 'queue_controls_job',
    shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
    export: { formats: ['step'], directory: 'output' },
  };
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitFor(assertion, { attempts = 12, delayMs = 40 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw lastError;
}

const { server, jobStore } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir,
  executorFactory: ({ baseExecutor }) => ({
    async execute(jobId) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
      return baseExecutor.execute(jobId);
    },
  }),
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const queuedResponse = await fetch(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'report',
      config: buildConfig(),
    }),
  });
  assert.equal(queuedResponse.status, 202);
  const queuedPayload = await queuedResponse.json();
  assert.equal(queuedPayload.job.status, 'queued');

  const cancelResponse = await fetch(`${baseUrl}/jobs/${queuedPayload.job.id}/cancel`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(cancelResponse.status, 200);
  const cancelPayload = await cancelResponse.json();
  assert.equal(validateLocalApiResponse('job_action', cancelPayload).ok, true);
  assert.equal(cancelPayload.action.type, 'cancel');
  assert.equal(cancelPayload.action.status, 'cancelled');
  assert.equal(cancelPayload.job.status, 'cancelled');
  assert.equal(cancelPayload.job.started_at, null);
  assert.equal(cancelPayload.job.capabilities.cancellation_supported, false);
  assert.equal(cancelPayload.job.capabilities.retry_supported, true);

  await waitFor(async () => {
    const statusResponse = await fetch(`${baseUrl}/jobs/${queuedPayload.job.id}`);
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.job.status, 'cancelled');
    assert.equal(statusPayload.job.started_at, null);
  }, { attempts: 8, delayMs: 60 });

  const cancelledLog = readFileSync(jobStore.getJobPaths(queuedPayload.job.id).log, 'utf8');
  assert.match(cancelledLog, /cancelled before execution started/i);

  const staleArtifactRefJob = await jobStore.createJob({
    type: 'inspect',
    artifact_ref: {
      job_id: 'missing-source-job',
      artifact_id: 'missing-model',
    },
  });
  await jobStore.failJob(staleArtifactRefJob.id, new Error('synthetic stale artifact source'));

  const staleArtifactRetryResponse = await fetch(`${baseUrl}/jobs/${staleArtifactRefJob.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(staleArtifactRetryResponse.status, 409);
  const staleArtifactRetryPayload = await staleArtifactRetryResponse.json();
  assert.equal(staleArtifactRetryPayload.ok, false);
  assert.equal(staleArtifactRetryPayload.error.code, 'stale_retry_reference');
  assert.match(staleArtifactRetryPayload.error.messages.join('\n'), /missing tracked job or artifact/i);

  const missingPathJob = await jobStore.createJob({
    type: 'inspect',
    file_path: 'tmp/codex/missing-retry-source.step',
  });
  await jobStore.failJob(missingPathJob.id, new Error('synthetic missing input source'));

  const missingPathRetryResponse = await fetch(`${baseUrl}/jobs/${missingPathJob.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(missingPathRetryResponse.status, 409);
  const missingPathRetryPayload = await missingPathRetryResponse.json();
  assert.equal(missingPathRetryPayload.ok, false);
  assert.equal(missingPathRetryPayload.error.code, 'stale_retry_reference');
  assert.match(missingPathRetryPayload.error.messages.join('\n'), /input missing-retry-source\.step is no longer available/i);

  const failedSourceJob = await jobStore.createJob({
    type: 'report',
    config: buildConfig(),
    options: {
      include_drawing: true,
    },
  });
  await jobStore.failJob(failedSourceJob.id, new Error('synthetic failure for retry'));

  const retryResponse = await fetch(`${baseUrl}/jobs/${failedSourceJob.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(retryResponse.status, 202);
  const retryPayload = await retryResponse.json();
  assert.equal(validateLocalApiResponse('job_action', retryPayload).ok, true);
  assert.equal(retryPayload.action.type, 'retry');
  assert.equal(retryPayload.action.source_job_id, failedSourceJob.id);
  assert.equal(retryPayload.job.id, retryPayload.action.retry_job_id);
  assert.equal(retryPayload.job.retried_from_job_id, failedSourceJob.id);
  assert.equal(retryPayload.job.status, 'queued');
  assert.equal(retryPayload.job.capabilities.cancellation_supported, true);

  const retriedJob = await waitFor(async () => jobStore.getJob(retryPayload.job.id));
  assert.deepEqual(retriedJob.request, (await jobStore.getJob(failedSourceJob.id)).request);

  const activeRetrySource = await jobStore.createJob({
    type: 'create',
    config: buildConfig(),
  });
  await jobStore.setStatus(activeRetrySource.id, 'running', 'test_running');

  const activeRetryResponse = await fetch(`${baseUrl}/jobs/${activeRetrySource.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(activeRetryResponse.status, 409);
  const activeRetryPayload = await activeRetryResponse.json();
  assert.equal(activeRetryPayload.ok, false);
  assert.equal(activeRetryPayload.error.code, 'job_retry_not_supported');
  assert.match(activeRetryPayload.error.messages.join('\n'), /only failed or cancelled jobs can be retried/i);

  const runningCancelJob = await jobStore.createJob({
    type: 'draw',
    config: buildConfig(),
  });
  await jobStore.setStatus(runningCancelJob.id, 'running', 'test_running');

  const runningCancelResponse = await fetch(`${baseUrl}/jobs/${runningCancelJob.id}/cancel`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(runningCancelResponse.status, 409);
  const runningCancelPayload = await runningCancelResponse.json();
  assert.equal(runningCancelPayload.ok, false);
  assert.equal(runningCancelPayload.error.code, 'job_cancel_not_supported');
  assert.match(runningCancelPayload.error.messages.join('\n'), /does not support safe mid-command cancellation/i);

  const cancelledRunningCompleteRace = await jobStore.createJob({
    type: 'create',
    config: buildConfig(),
  });
  await jobStore.setStatus(cancelledRunningCompleteRace.id, 'running', 'test_running');
  const cancelledRunning = await jobStore.cancelJob(cancelledRunningCompleteRace.id, {
    allowRunning: true,
    message: 'Running job cancelled through test executor.',
  });
  assert.equal(cancelledRunning.ok, true);
  await jobStore.completeJob(cancelledRunningCompleteRace.id, { success: true });
  const completeRaceResult = await jobStore.getJob(cancelledRunningCompleteRace.id);
  assert.equal(completeRaceResult.status, 'cancelled');
  assert.equal(completeRaceResult.result, null);
  assert.equal(
    completeRaceResult.status_history.some((entry) => entry.status === 'succeeded'),
    false
  );

  const cancelledRunningFailRace = await jobStore.createJob({
    type: 'draw',
    config: buildConfig(),
  });
  await jobStore.setStatus(cancelledRunningFailRace.id, 'running', 'test_running');
  const cancelledFailing = await jobStore.cancelJob(cancelledRunningFailRace.id, {
    allowRunning: true,
    message: 'Running job cancelled before stale failure callback.',
  });
  assert.equal(cancelledFailing.ok, true);
  await jobStore.failJob(cancelledRunningFailRace.id, new Error('stale executor failure'));
  const failRaceResult = await jobStore.getJob(cancelledRunningFailRace.id);
  assert.equal(failRaceResult.status, 'cancelled');
  assert.equal(failRaceResult.error, null);
  assert.equal(
    failRaceResult.status_history.some((entry) => entry.status === 'failed'),
    false
  );

  const succeededCancelJob = await jobStore.createJob({
    type: 'create',
    config: buildConfig(),
  });
  await jobStore.completeJob(succeededCancelJob.id, { success: true });

  const succeededCancelResponse = await fetch(`${baseUrl}/jobs/${succeededCancelJob.id}/cancel`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(succeededCancelResponse.status, 409);
  const succeededCancelPayload = await succeededCancelResponse.json();
  assert.equal(succeededCancelPayload.ok, false);
  assert.equal(succeededCancelPayload.error.code, 'job_cancel_not_supported');
  assert.match(succeededCancelPayload.error.messages.join('\n'), /already succeeded/i);

  const cancelledSourceJob = await jobStore.createJob({
    type: 'inspect',
    file_path: 'tests/fixtures/sample_part.step',
  });
  await jobStore.cancelJob(cancelledSourceJob.id, {
    message: 'Cancelled before execution started.',
  });

  const cancelledRetryResponse = await fetch(`${baseUrl}/jobs/${cancelledSourceJob.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(cancelledRetryResponse.status, 202);
  const cancelledRetryPayload = await cancelledRetryResponse.json();
  assert.equal(validateLocalApiResponse('job_action', cancelledRetryPayload).ok, true);
  assert.equal(cancelledRetryPayload.action.type, 'retry');
  assert.equal(cancelledRetryPayload.action.source_job_id, cancelledSourceJob.id);
  assert.equal(cancelledRetryPayload.job.retried_from_job_id, cancelledSourceJob.id);
  assert.equal(cancelledRetryPayload.job.status, 'queued');

  console.log('job-queue-controls.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
