import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve, join, relative } from 'node:path';

import { writeArtifactManifest } from '../../../lib/artifact-manifest.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class TrackedArtifactProofError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TrackedArtifactProofError';
    this.code = code;
    this.reason_code = code;
  }
}

function proofError(code, message) {
  return new TrackedArtifactProofError(code, message);
}

function pathIsWithin(rootPath, targetPath) {
  const rel = relative(resolve(rootPath), resolve(targetPath)).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.nlink === right.nlink;
}

function assertExpectedBinding(expectedBinding, actualBinding) {
  if (!expectedBinding || typeof expectedBinding !== 'object' || Array.isArray(expectedBinding)) {
    throw proofError(
      'artifact_proof_binding_invalid',
      'Proof re-entry requires an immutable registered artifact binding.'
    );
  }

  const expectedPath = typeof expectedBinding.path === 'string' ? resolve(expectedBinding.path) : null;
  const comparisons = [
    ['job_id', expectedBinding.job_id, actualBinding.job_id],
    ['artifact_id', expectedBinding.artifact_id, actualBinding.artifact_id],
    ['path', expectedPath, resolve(actualBinding.path)],
    ['sha256', expectedBinding.sha256, actualBinding.sha256],
    ['size_bytes', expectedBinding.size_bytes, actualBinding.size_bytes],
  ];
  const mismatch = comparisons.find(([, expected, actual]) => expected !== actual);
  if (mismatch) {
    throw proofError(
      'artifact_proof_binding_mismatch',
      `Tracked artifact proof binding no longer matches its registered ${mismatch[0]}.`
    );
  }
}

async function readProofArtifactSnapshot(filePath, allowedRoot) {
  const absoluteFilePath = resolve(filePath);
  const absoluteAllowedRoot = resolve(allowedRoot);
  let rootPath;
  let resolvedPath;
  let initial;
  try {
    [rootPath, resolvedPath, initial] = await Promise.all([
      realpath(absoluteAllowedRoot),
      realpath(absoluteFilePath),
      lstat(absoluteFilePath, { bigint: true }),
    ]);
  } catch {
    throw proofError(
      'artifact_proof_path_unavailable',
      'Registered artifact proof path is unavailable.'
    );
  }

  if (!pathIsWithin(rootPath, resolvedPath)) {
    throw proofError(
      'artifact_proof_path_outside_job',
      'Registered artifact proof path resolves outside its tracked job directory.'
    );
  }
  if (resolvedPath !== absoluteFilePath || !initial.isFile() || initial.isSymbolicLink()) {
    throw proofError(
      'artifact_proof_unsafe_file_type',
      'Registered artifact proof path must be a regular file and may not be a symbolic link.'
    );
  }
  if (initial.nlink !== 1n) {
    throw proofError(
      'artifact_proof_hardlink_rejected',
      'Registered artifact proof path may not be a hard-linked file.'
    );
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw proofError(
      'artifact_proof_nofollow_unavailable',
      'This runtime cannot enforce no-follow reads for proof re-entry.'
    );
  }

  let handle;
  try {
    handle = await open(absoluteFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(initial, opened)) {
      throw proofError(
        'artifact_proof_file_replaced',
        'Registered artifact changed between proof path validation and read.'
      );
    }
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    const [finalPathInfo, finalResolvedPath, finalRootPath] = await Promise.all([
      lstat(absoluteFilePath, { bigint: true }),
      realpath(absoluteFilePath),
      realpath(absoluteAllowedRoot),
    ]);
    if (finalRootPath !== rootPath || !pathIsWithin(finalRootPath, finalResolvedPath)) {
      throw proofError(
        'artifact_proof_path_outside_job',
        'Registered artifact proof path resolves outside its tracked job directory.'
      );
    }
    if (finalResolvedPath !== absoluteFilePath || finalPathInfo.isSymbolicLink()) {
      throw proofError(
        'artifact_proof_unsafe_file_type',
        'Registered artifact proof path must be a regular file and may not be a symbolic link.'
      );
    }
    if (
      !sameFileIdentity(opened, afterRead)
      || !sameFileIdentity(opened, finalPathInfo)
      || !finalPathInfo.isFile()
    ) {
      throw proofError(
        'artifact_proof_file_replaced',
        'Registered artifact changed while proof bytes were being read.'
      );
    }
    return {
      bytes: Buffer.from(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length,
    };
  } catch (error) {
    if (error instanceof TrackedArtifactProofError) throw error;
    throw proofError(
      'artifact_proof_nofollow_read_failed',
      'Registered artifact could not be read through a no-follow proof handle.'
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}

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
      scope: artifact.scope === 'user-facing' || artifact.scope === 'internal'
        ? artifact.scope
        : 'internal',
      stability: artifact.stability || 'stable',
      metadata: artifact.metadata || null,
      registered_exists: artifact.exists === true,
      size_bytes: Number.isInteger(artifact.size_bytes) ? artifact.size_bytes : null,
      sha256: SHA256_PATTERN.test(artifact.sha256 || '') ? artifact.sha256 : null,
      registered_size_bytes: Number.isInteger(artifact.size_bytes) ? artifact.size_bytes : null,
      registered_sha256: SHA256_PATTERN.test(artifact.sha256 || '') ? artifact.sha256 : null,
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
  const seenIds = new Map();

  return rawEntries.map((artifact, index) => {
    const serializedPath = artifact.path;
    const artifactPath = job.manifest?.effective_policy?.proof_lineage === true
      && serializedPath.startsWith('run/')
      ? resolve(job.paths.root, serializedPath.slice('run/'.length))
      : job.manifest?.effective_policy?.proof_lineage === true
        && serializedPath.startsWith('repo/')
        ? resolve(process.cwd(), serializedPath.slice('repo/'.length))
        : serializedPath;
    const fileName = basename(artifactPath);
    const extension = extname(fileName).toLowerCase();
    const baseId = artifact.id
      ? slugify(artifact.id)
      : `${slugify(artifact.type || artifact.key || fileName || 'artifact')}-${index}`;
    const seenCount = seenIds.get(baseId) || 0;
    seenIds.set(baseId, seenCount + 1);
    const id = seenCount === 0 ? baseId : `${baseId}-${seenCount}`;

    return {
      id,
      key: artifact.key,
      path: artifactPath,
      type: artifact.type || null,
      scope: artifact.scope || null,
      stability: artifact.stability || null,
      metadata: artifact.metadata || null,
      registered_exists: artifact.registered_exists === true,
      size_bytes: Number.isInteger(artifact.size_bytes) ? artifact.size_bytes : null,
      sha256: SHA256_PATTERN.test(artifact.sha256 || '') ? artifact.sha256 : null,
      registered_size_bytes: Number.isInteger(artifact.registered_size_bytes)
        ? artifact.registered_size_bytes
        : null,
      registered_sha256: SHA256_PATTERN.test(artifact.registered_sha256 || '')
        ? artifact.registered_sha256
        : null,
      file_name: fileName,
      extension,
    };
  });
}

export function createJobStore({ jobsDir }) {
  const rootDir = resolve(jobsDir);
  const jobLocks = new Map();

  function assertSafeJobId(id) {
    const value = String(id || '').trim();
    if (
      !value
      || value === '.'
      || value === '..'
      || value.includes('/')
      || value.includes('\\')
      || value.includes('\0')
      || value.startsWith('~')
    ) {
      throw new Error('Invalid job id.');
    }
    return value;
  }

  function assertPathWithinJobDir(jobDir, targetPath, label) {
    const resolvedJobDir = resolve(jobDir);
    const resolvedTarget = resolve(targetPath);
    const rel = relative(resolvedJobDir, resolvedTarget).replaceAll('\\', '/');
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`${label} must stay inside the tracked job directory.`);
    }
    return resolvedTarget;
  }

  function resolveJobRelativePath(id, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('Job file path must be a non-empty relative path.');
    }
    const raw = relativePath.trim();
    const normalized = raw.replaceAll('\\', '/').replace(/^\.\//, '');
    if (
      raw.includes('\\')
      || normalized.includes('\0')
      || normalized.startsWith('/')
      || normalized.startsWith('~')
      || /^[A-Za-z]:[\\/]/.test(raw)
      || normalized.split('/').includes('..')
    ) {
      throw new Error('Job file path failed tracked storage safety checks.');
    }
    const jobDir = getJobDir(id);
    return assertPathWithinJobDir(jobDir, resolve(jobDir, normalized), 'Job file path');
  }

  function getJobDir(id) {
    return join(rootDir, assertSafeJobId(id));
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

  async function writeTextAtomically(filePath, text) {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, filePath);
  }

  async function writeJson(filePath, data) {
    await writeTextAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  async function saveJob(job) {
    const nextJob = clone(job);
    nextJob.updated_at = nowIso();
    await mkdir(getJobDir(nextJob.id), { recursive: true });
    await writeTextAtomically(getJobPaths(nextJob.id).job, `${JSON.stringify(nextJob, null, 2)}\n`);
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

  async function readVerifiedArtifactSnapshot(id, artifactId, { expectedBinding = null } = {}) {
    const safeJobId = assertSafeJobId(id);
    const artifact = await store.getArtifact(safeJobId, artifactId);
    if (!artifact) {
      throw proofError(
        'artifact_proof_not_registered',
        `No registered artifact ${artifactId} was found for tracked job ${safeJobId}.`
      );
    }
    if (
      !SHA256_PATTERN.test(artifact.registered_sha256 || '')
      || !Number.isInteger(artifact.registered_size_bytes)
    ) {
      throw proofError(
        'artifact_proof_digest_missing',
        `Tracked artifact ${artifact.file_name || artifact.id} has no registered SHA-256 and size binding.`
      );
    }

    const jobDir = getJobDir(safeJobId);
    let storeRootPath;
    let jobRootPath;
    let jobRootInfo;
    try {
      [storeRootPath, jobRootPath, jobRootInfo] = await Promise.all([
        realpath(rootDir),
        realpath(jobDir),
        lstat(jobDir),
      ]);
    } catch {
      throw proofError(
        'artifact_proof_job_path_unavailable',
        `Tracked job ${safeJobId} is unavailable for proof re-entry.`
      );
    }
    if (jobRootInfo.isSymbolicLink() || !jobRootInfo.isDirectory() || !pathIsWithin(storeRootPath, jobRootPath)) {
      throw proofError(
        'artifact_proof_job_path_unsafe',
        `Tracked job ${safeJobId} failed proof directory confinement checks.`
      );
    }

    const snapshot = await readProofArtifactSnapshot(artifact.path, jobRootPath);
    if (
      snapshot.size_bytes !== artifact.registered_size_bytes
      || snapshot.sha256 !== artifact.registered_sha256
    ) {
      throw proofError(
        'artifact_proof_bytes_changed',
        `Tracked artifact ${artifact.file_name || artifact.id} no longer matches its registered bytes.`
      );
    }

    const binding = Object.freeze({
      schema_version: '1.0',
      job_id: safeJobId,
      artifact_id: artifact.id,
      path: artifact.path,
      sha256: artifact.registered_sha256,
      size_bytes: artifact.registered_size_bytes,
    });
    if (expectedBinding !== null) assertExpectedBinding(expectedBinding, binding);

    const immutableBytes = Buffer.from(snapshot.bytes);
    return Object.freeze({
      binding,
      path: artifact.path,
      sha256: snapshot.sha256,
      size_bytes: snapshot.size_bytes,
      readDetachedBytes() {
        return Buffer.from(immutableBytes);
      },
    });
  }

  const store = {
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
        if (current.status === 'cancelled') {
          return current;
        }
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
        if (current.status === 'cancelled') {
          return current;
        }
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
      const absPath = resolveJobRelativePath(id, relativePath);
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
          registered_exists: artifact.registered_exists,
          size_bytes: artifact.size_bytes,
          sha256: artifact.sha256,
          registered_size_bytes: artifact.registered_size_bytes,
          registered_sha256: artifact.registered_sha256,
          current_size_bytes: null,
        };
        try {
          const info = await stat(artifact.path);
          record.exists = true;
          record.current_size_bytes = info.size;
          if (!Number.isInteger(record.size_bytes)) record.size_bytes = info.size;
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
    async readVerifiedArtifactSnapshot(id, artifactId, { expectedBinding = null } = {}) {
      return readVerifiedArtifactSnapshot(id, artifactId, { expectedBinding });
    },
    async verifyArtifactBinding(id, artifactId, { expectedBinding = null } = {}) {
      const snapshot = await readVerifiedArtifactSnapshot(id, artifactId, { expectedBinding });
      return snapshot.binding;
    },
  };

  return store;
}
