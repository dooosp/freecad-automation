import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const RUNTIME_FINGERPRINT_SCHEMA_VERSION = '1.0';
export const RUNTIME_FINGERPRINT_EVIDENCE_BOUNDARY = 'Runtime fingerprint proves local execution context only; it is not physical inspection evidence or production readiness proof.';

function readGitValue(projectRoot, args) {
  try {
    const result = spawnSync('git', args, {
      cwd: resolve(projectRoot),
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0) return null;
    const value = String(result.stdout || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function collectRuntimeFingerprintRepoContext(projectRoot = process.cwd()) {
  const root = readGitValue(projectRoot, ['rev-parse', '--show-toplevel']) || projectRoot;
  const branch = readGitValue(root, ['branch', '--show-current']);
  const headSha = readGitValue(root, ['rev-parse', 'HEAD']);
  const dirty = readGitValue(root, ['status', '--porcelain']);

  return {
    branch: branch || null,
    head_sha: headSha || null,
    dirty_at_start: Boolean(dirty),
  };
}

export function buildRuntimeFingerprint({
  repo = {},
  runtime = {},
  commands = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    schema_version: RUNTIME_FINGERPRINT_SCHEMA_VERSION,
    generated_at: generatedAt,
    repo: {
      branch: repo.branch || null,
      head_sha: repo.head_sha || repo.headSha || null,
      dirty_at_start: repo.dirty_at_start === true || repo.dirtyAtStart === true,
    },
    runtime: {
      platform: runtime.platform || process.platform,
      freecad_status: runtime.freecad_status || runtime.status || null,
      freecad_version: runtime.freecad_version ?? runtime.version_details?.freecad?.version ?? null,
      freecad_executable_detected: runtime.freecad_executable_detected ?? runtime.executable_detected ?? null,
    },
    command_coverage: commands.map((name) => ({
      command: String(name),
      covered: true,
    })),
    production_readiness_claim: false,
    evidence_boundary: RUNTIME_FINGERPRINT_EVIDENCE_BOUNDARY,
  };
}
