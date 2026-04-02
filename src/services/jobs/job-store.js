import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, join } from 'node:path';

import { writeArtifactManifest } from '../../../lib/artifact-manifest.js';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function flattenArtifacts(artifacts, prefix = '') {
  const entries = [];
  if (typeof artifacts === 'string') {
    entries.push({ key: prefix || 'artifact', path: artifacts });
    return entries;
  }
  if (Array.isArray(artifacts)) {
    artifacts.forEach((item, index) => {
      entries.push(...flattenArtifacts(item, `${prefix}[${index}]`));
    });
    return entries;
  }
  if (!artifacts || typeof artifacts !== 'object') {
    return entries;
  }
  for (const [key, value] of Object.entries(artifacts)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    entries.push(...flattenArtifacts(value, nextPrefix));
  }
  return entries;
}

function flattenManifestArtifacts(artifacts = []) {
  return artifacts
    .filter((artifact) => artifact && typeof artifact === 'object' && typeof artifact.path === 'string')
    .map((artifact, index) => ({
      id: artifact.id || `${artifact.type || 'artifact'}-${index}`,
      key: artifact.label || artifact.type || `artifact[${index}]`,
      path: artifact.path,
      type: artifact.type || 'artifact',
      scope: artifact.scope || 'user-facing',
      stability: artifact.stability || 'stable',
      metadata: artifact.metadata || null,
    }));
}

function slugify(value) {
  return String(value || 'artifact')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'artifact';
}

function normalizeArtifactEntries(job) {
  const rawEntries = job.manifest?.artifacts?.length
    ? flattenManifestArtifacts(job.manifest.artifacts)
    : flattenArtifacts(job.artifacts);

  return rawEntries.map((artifact, index) => {
    const fileName = basename(artifact.path);
    const extension = extname(fileName).toLowerCase();
    const id = artifact.id
      ? slugify(artifact.id)
      : `${slugify(artifact.type || artifact.key || fileName || 'artifact')}-${index}`;

    return {
      id,
      key: artifact.key,
      path: artifact.path,
      type: artifact.type || null,
      scope: artifact.scope || null,
      stability: artifact.stability || null,
      metadata: artifact.metadata || null,
      file_name: fileName,
      extension,
    };
  });
}

export function createJobStore({ jobsDir }) {
  const rootDir = resolve(jobsDir);
  const jobLocks = new Map();

  function getJobDir(id) {
    return join(rootDir, id);
  }

  function getJobPaths(id) {
    const jobDir = getJobDir(id);
    return {
      root: jobDir,
      job: join(jobDir, 'job.json'),
      request: join(jobDir, 'request.json'),
      log: join(jobDir, 'job.log'),
      manifest: join(jobDir, 'artifact-manifest.json'),
    };
  }

  async function ensureRoot() {
    await mkdir(rootDir, { recursive: true });
  }

  async function writeJson(filePath, data) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  async function saveJob(job) {
    const nextJob = clone(job);
    nextJob.updated_at = nowIso();
    await mkdir(getJobDir(nextJob.id), { recursive: true });
    await writeFile(getJobPaths(nextJob.id).job, `${JSON.stringify(nextJob, null, 2)}\n`, 'utf8');
    return nextJob;
  }

  async function withJobLock(id, task) {
    const previous = jobLocks.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    jobLocks.set(id, current);
    return current.finally(() => {
      if (jobLocks.get(id) === current) {
        jobLocks.delete(id);
      }
    });
  }

  return {
    jobsDir: rootDir,
    getJobDir,
    getJobPaths,
    async describeStorage(id) {
      const paths = getJobPaths(id);
      const files = {};

      for (const [key, filePath] of Object.entries({
        job: paths.job,
        request: paths.request,
        log: paths.log,
        manifest: paths.manifest,
      })) {
        const record = {
          path: filePath,
          exists: false,
          size_bytes: null,
        };
        try {
          const info = await stat(filePath);
          record.exists = true;
          record.size_bytes = info.size;
        } catch {
          // Keep missing storage files visible to callers.
        }
        files[key] = record;
      }

      return {
        root: paths.root,
        files,
      };
    },
    async createJob(request, { retriedFromJobId = null } = {}) {
      await ensureRoot();
      const id = randomUUID();
      const createdAt = nowIso();
      const paths = getJobPaths(id);
      const job = {
        schema_version: '1',
        id,
        type: request.type,
        status: 'queued',
        created_at: createdAt,
        updated_at: createdAt,
        started_at: null,
        finished_at: null,
        error: null,
        retried_from_job_id: retriedFromJobId || null,
        request,
        artifacts: {},
        diagnostics: {},
        result: null,
        manifest: null,
        paths,
        status_history: [
          {
            status: 'queued',
            at: createdAt,
            detail: 'accepted',
          },
        ],
      };

      await mkdir(paths.root, { recursive: true });
      await writeFile(paths.request, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
      await writeFile(paths.log, '', 'utf8');
      await saveJob(job);
      return job;
    },
    async getJob(id) {
      const raw = await readFile(getJobPaths(id).job, 'utf8');
      return JSON.parse(raw);
    },
    async listJobs({ limit = 10 } = {}) {
      await ensureRoot();
      const entries = await readdir(rootDir, { withFileTypes: true });
      const jobs = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const job = await this.getJob(entry.name);
          jobs.push(job);
        } catch {
          // Ignore incomplete or non-job directories.
        }
      }

      jobs.sort((left, right) => {
        const rightTime = Date.parse(right.updated_at || right.created_at || 0);
        const leftTime = Date.parse(left.updated_at || left.created_at || 0);
        return rightTime - leftTime;
      });

      return jobs.slice(0, Math.max(0, Number(limit) || 0));
    },
    async updateJob(id, mutate) {
      return withJobLock(id, async () => {
        const current = await this.getJob(id);
        const next = clone(current);
        await mutate(next);
        return saveJob(next);
      });
    },
    async setStatus(id, status, detail = null) {
      return this.updateJob(id, (job) => {
        const at = nowIso();
        job.status = status;
        if (status === 'running' && !job.started_at) job.started_at = at;
        if (status === 'succeeded' || status === 'failed' || status === 'cancelled') job.finished_at = at;
        job.status_history.push({ status, at, detail });
      });
    },
    async claimJobForExecution(id, detail = 'executor_started') {
      return withJobLock(id, async () => {
        const current = await this.getJob(id);
        if (current.status !== 'queued') {
          return {
            ok: false,
            job: current,
            reason: current.status === 'cancelled' ? 'cancelled_before_start' : 'not_queued',
          };
        }

        const next = clone(current);
        const at = nowIso();
        next.status = 'running';
        next.started_at = next.started_at || at;
        next.status_history.push({ status: 'running', at, detail });
        return {
          ok: true,
          job: await saveJob(next),
          reason: 'claimed',
        };
      });
    },
    async cancelJob(id, {
      allowRunning = false,
      detail = 'cancelled_by_request',
      message = 'Cancelled before execution started.',
    } = {}) {
      return withJobLock(id, async () => {
        const current = await this.getJob(id);
        const canCancel = current.status === 'queued' || (allowRunning && current.status === 'running');
        if (!canCancel) {
          return {
            ok: false,
            job: current,
            reason: current.status === 'running' ? 'running_not_supported' : 'not_cancellable',
          };
        }

        const next = clone(current);
        const at = nowIso();
        next.status = 'cancelled';
        next.finished_at = at;
        next.error = null;
        next.result = null;
        next.status_history.push({ status: 'cancelled', at, detail: message || detail });
        return {
          ok: true,
          job: await saveJob(next),
          reason: current.status === 'running' ? 'cancelled_running' : 'cancelled_queued',
        };
      });
    },
    async completeJob(id, result, artifacts = {}, diagnostics = {}, manifest = null) {
      return withJobLock(id, async () => {
        const current = await this.getJob(id);
        const nextJob = clone(current);
        const at = nowIso();
        nextJob.status = 'succeeded';
        nextJob.finished_at = at;
        nextJob.error = null;
        nextJob.result = result;
        nextJob.artifacts = artifacts;
        nextJob.diagnostics = diagnostics;
        nextJob.manifest = manifest;
        nextJob.status_history.push({ status: 'succeeded', at, detail: 'completed' });
        if (nextJob.manifest) {
          await writeArtifactManifest(nextJob.paths.manifest, nextJob.manifest);
        }
        return saveJob(nextJob);
      });
    },
    async failJob(id, error, artifacts = {}, diagnostics = {}, manifest = null) {
      return withJobLock(id, async () => {
        const current = await this.getJob(id);
        const nextJob = clone(current);
        const at = nowIso();
        nextJob.status = 'failed';
        nextJob.finished_at = at;
        nextJob.error = {
          message: error instanceof Error ? error.message : String(error),
        };
        nextJob.artifacts = artifacts;
        nextJob.diagnostics = diagnostics;
        nextJob.manifest = manifest;
        nextJob.status_history.push({ status: 'failed', at, detail: nextJob.error.message });
        if (nextJob.manifest) {
          await writeArtifactManifest(nextJob.paths.manifest, nextJob.manifest);
        }
        return saveJob(nextJob);
      });
    },
    async appendLog(id, message) {
      const line = `[${nowIso()}] ${message}\n`;
      await appendFile(getJobPaths(id).log, line, 'utf8');
    },
    async writeJobFile(id, relativePath, content) {
      const absPath = join(getJobDir(id), relativePath);
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, 'utf8');
      return absPath;
    },
    async listArtifacts(id) {
      const job = await this.getJob(id);
      const artifactEntries = normalizeArtifactEntries(job);
      const results = [];
      for (const artifact of artifactEntries) {
        const record = {
          id: artifact.id,
          key: artifact.key,
          path: artifact.path,
          type: artifact.type || null,
          scope: artifact.scope || null,
          stability: artifact.stability || null,
          metadata: artifact.metadata || null,
          file_name: artifact.file_name,
          extension: artifact.extension,
          exists: false,
          size_bytes: null,
        };
        try {
          const info = await stat(artifact.path);
          record.exists = true;
          record.size_bytes = info.size;
        } catch {
          // Keep missing artifact entries visible.
        }
        results.push(record);
      }
      return results;
    },
    async getArtifact(id, artifactId) {
      const artifacts = await this.listArtifacts(id);
      return artifacts.find((artifact) => artifact.id === artifactId) || null;
    },
  };
}
