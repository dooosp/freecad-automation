import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';

function createDeferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

const require = createRequire(import.meta.url);
const fsPromises = require('node:fs/promises');
const originalWriteFile = fsPromises.writeFile;

let targetJobPath = null;
let interceptWrites = false;
let writeReady = null;
let allowWriteToFinish = null;

fsPromises.writeFile = async (filePath, data, encoding) => {
  const normalizedPath = String(filePath);
  const shouldIntercept = interceptWrites
    && targetJobPath
    && (
      normalizedPath === targetJobPath
      || (normalizedPath.startsWith(`${targetJobPath}.`) && normalizedPath.endsWith('.tmp'))
    );

  if (!shouldIntercept) {
    return originalWriteFile(filePath, data, encoding);
  }

  if (normalizedPath === targetJobPath) {
    const truncated = String(data).slice(0, 24) || '{"status":"running"';
    await originalWriteFile(filePath, truncated, encoding);
  } else {
    await originalWriteFile(filePath, data, encoding);
  }

  writeReady?.resolve();
  await allowWriteToFinish?.promise;

  if (normalizedPath === targetJobPath) {
    return originalWriteFile(filePath, data, encoding);
  }

  return undefined;
};
syncBuiltinESMExports();

const { createJobStore } = await import('../src/services/jobs/job-store.js');

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-job-store-atomic-'));

try {
  const store = createJobStore({ jobsDir: join(tmpRoot, 'jobs') });
  const job = await store.createJob({
    type: 'report',
    config: {
      name: 'atomic_write_job',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });

  targetJobPath = job.paths.job;
  writeReady = createDeferred();
  allowWriteToFinish = createDeferred();
  interceptWrites = true;

  const updatePromise = store.setStatus(job.id, 'running', 'test_running');
  await writeReady.promise;

  const jobsDuringWrite = await store.listJobs({ limit: 10 });
  assert.equal(jobsDuringWrite.some((entry) => entry.id === job.id), true);

  allowWriteToFinish.resolve();
  await updatePromise;

  const persistedJob = await store.getJob(job.id);
  assert.equal(persistedJob.status, 'running');

  console.log('job-store-atomic-write.test.js: ok');
} finally {
  interceptWrites = false;
  targetJobPath = null;
  writeReady = null;
  allowWriteToFinish = null;
  fsPromises.writeFile = originalWriteFile;
  syncBuiltinESMExports();
  rmSync(tmpRoot, { recursive: true, force: true });
}
