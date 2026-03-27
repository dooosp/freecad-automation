import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { dirname, extname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describeFreeCADRuntime, getFreeCADRuntime } from './paths.js';

const MANIFEST_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/artifact-manifest.schema.json', import.meta.url), 'utf8')
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateManifest = ajv.compile(MANIFEST_SCHEMA);

export const ARTIFACT_MANIFEST_VERSION = '1.0';

const packageVersionCache = new Map();
const gitCommitCache = new Map();
const freecadVersionCache = new Map();

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function inferConfigFormat(configPath) {
  const ext = extname(configPath || '').toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.toml') return 'toml';
  return null;
}

function normalizePackSummary(pack) {
  if (!pack) return null;
  return {
    id: pack.id ?? null,
    label: pack.label ?? null,
  };
}

function defaultRulePacks(ruleProfile = null) {
  return {
    standards: normalizePackSummary(ruleProfile?.standards_pack || null),
    materials: normalizePackSummary(ruleProfile?.material_pack || null),
    processes: normalizePackSummary(ruleProfile?.process_pack || null),
  };
}

function migrationApplied(summary = null) {
  const effectiveSummary = summary || {};
  return Boolean(
    (effectiveSummary.changed_fields || []).length > 0
    || (effectiveSummary.deprecated_fields || []).length > 0
    || (effectiveSummary.input_version ?? null) !== (effectiveSummary.target_version ?? null)
  );
}

function resolvePackageVersion(projectRoot) {
  const root = resolve(projectRoot);
  if (!packageVersionCache.has(root)) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      packageVersionCache.set(root, pkg.version || '0.0.0');
    } catch {
      packageVersionCache.set(root, '0.0.0');
    }
  }
  return packageVersionCache.get(root);
}

function resolveGitCommit(projectRoot) {
  const root = resolve(projectRoot);
  if (!gitCommitCache.has(root)) {
    try {
      const result = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
      });
      gitCommitCache.set(
        root,
        result.status === 0 ? (result.stdout || '').trim() || null : null
      );
    } catch {
      gitCommitCache.set(root, null);
    }
  }
  return gitCommitCache.get(root);
}

function probeFreecadVersion(runtime = null) {
  const executable = runtime?.runtimeExecutable || runtime?.executable || '';
  if (!executable) return null;
  if (freecadVersionCache.has(executable)) {
    return freecadVersionCache.get(executable);
  }

  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const match = text.match(/FreeCAD[^0-9]*([0-9][0-9A-Za-z.\-+]*)/i)
      || text.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.\-]+)?)/);
    const version = match?.[1] || text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
    freecadVersionCache.set(executable, version);
    return version;
  } catch {
    freecadVersionCache.set(executable, null);
    return null;
  }
}

async function hashFileSha256(filePath) {
  return new Promise((resolveHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', () => resolveHash(null));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

export async function collectArtifactMetadata(entries = []) {
  const artifacts = [];

  for (const entry of entries) {
    if (!entry?.path) continue;
    const artifactPath = resolve(entry.path);
    const record = {
      type: entry.type,
      path: artifactPath,
      label: entry.label ?? null,
      scope: entry.scope || 'user-facing',
      stability: entry.stability || 'stable',
      exists: false,
      size_bytes: null,
      sha256: null,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };

    try {
      const info = await stat(artifactPath);
      record.exists = true;
      record.size_bytes = info.size;
      record.sha256 = await hashFileSha256(artifactPath);
    } catch {
      // Keep missing artifacts visible in the manifest.
    }

    artifacts.push(record);
  }

  return artifacts;
}

export async function collectRuntimeInfo() {
  const runtime = getFreeCADRuntime();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    node_version: process.version,
    node_path: process.execPath,
    python_path: runtime.pythonExecutable || process.env.PYTHON || process.env.PYTHON3 || null,
    freecad: runtime
      ? {
          available: Boolean(runtime.available),
          mode: runtime.mode || '',
          source: runtime.source || '',
          executable: runtime.executable || '',
          python_executable: runtime.pythonExecutable || '',
          runtime_executable: runtime.runtimeExecutable || '',
          gui_executable: runtime.guiExecutable || '',
          description: describeFreeCADRuntime(runtime),
          version: probeFreecadVersion(runtime),
          checked_candidates: runtime.checkedCandidates || [],
        }
      : null,
  };
}

export function createManifestPath({ primaryOutputPath = null, outputDir = null } = {}) {
  if (primaryOutputPath) {
    const resolvedPath = resolve(primaryOutputPath);
    const parsed = parse(resolvedPath);
    if (parsed.ext) {
      return join(parsed.dir, `${parsed.name}_artifact-manifest.json`);
    }
    return join(resolvedPath, 'artifact-manifest.json');
  }

  if (outputDir) {
    return join(resolve(outputDir), 'artifact-manifest.json');
  }

  return resolve('artifact-manifest.json');
}

export async function buildArtifactManifest({
  projectRoot,
  interface: manifestInterface,
  command,
  jobType = null,
  status,
  requestId = null,
  configPath = null,
  configSummary = null,
  selectedProfile = null,
  ruleProfile = null,
  warnings = [],
  deprecations = [],
  artifacts = [],
  timestamps = {},
  details = undefined,
  related = undefined,
}) {
  const runtime = await collectRuntimeInfo();
  const manifest = {
    schema_version: ARTIFACT_MANIFEST_VERSION,
    manifest_version: ARTIFACT_MANIFEST_VERSION,
    manifest_type: 'fcad.artifact-manifest',
    interface: manifestInterface,
    command,
    job_type: jobType ?? command,
    status,
    request_id: requestId,
    config_path: configPath ? resolve(configPath) : null,
    config_format: inferConfigFormat(configPath),
    config_version: Number.isInteger(configSummary?.target_version) ? configSummary.target_version : null,
    migrated_from: Number.isInteger(configSummary?.input_version) ? configSummary.input_version : null,
    migration_applied: migrationApplied(configSummary),
    selected_profile: selectedProfile,
    rule_profile: ruleProfile ?? null,
    rule_packs: defaultRulePacks(ruleProfile),
    runtime,
    warnings: uniqueStrings([...(configSummary?.warnings || []), ...warnings]),
    deprecations: uniqueStrings([...(configSummary?.deprecated_fields || []), ...deprecations]),
    artifacts: await collectArtifactMetadata(artifacts),
    timestamps: {
      created_at: timestamps.created_at ?? timestamps.started_at ?? null,
      started_at: timestamps.started_at ?? timestamps.created_at ?? null,
      finished_at: timestamps.finished_at ?? null,
    },
    app_version: resolvePackageVersion(projectRoot),
    git_commit: resolveGitCommit(projectRoot),
    ...(details ? { details } : {}),
    ...(related ? { related } : {}),
  };

  const validation = validateArtifactManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid artifact manifest: ${validation.errors.join(' | ')}`);
  }

  return manifest;
}

export function validateArtifactManifest(manifest) {
  const valid = validateManifest(manifest);
  return {
    ok: valid === true,
    errors: valid ? [] : formatSchemaErrors(validateManifest.errors),
  };
}

export async function writeArtifactManifest(manifestPath, manifest) {
  const absPath = resolve(manifestPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return absPath;
}
