import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { dirname, extname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { buildRuntimeDiagnostics } from './runtime-diagnostics.js';
import {
  portableRuntimePath,
  portableizeManifestValue,
  toPortableManifestLocator,
} from './manifest-portable-locators.js';
import { assertRevisionLineage } from './revision-lineage-contract.js';

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

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeEffectivePolicy(effectivePolicy) {
  if (effectivePolicy === null || effectivePolicy === undefined) return null;
  if (
    !effectivePolicy
    || typeof effectivePolicy !== 'object'
    || Array.isArray(effectivePolicy)
    || typeof effectivePolicy.proof_lineage !== 'boolean'
  ) {
    throw new Error('effectivePolicy.proof_lineage must be an explicit boolean.');
  }
  return { proof_lineage: effectivePolicy.proof_lineage };
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

    if (entry.precomputed
      && entry.precomputed.exists === true
      && Number.isInteger(entry.precomputed.size_bytes)
      && entry.precomputed.size_bytes >= 0
      && /^[a-f0-9]{64}$/.test(entry.precomputed.sha256 || '')) {
      record.exists = true;
      record.size_bytes = entry.precomputed.size_bytes;
      record.sha256 = entry.precomputed.sha256;
      artifacts.push(record);
      continue;
    }

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

export async function collectRuntimeInfo({ runtimeDiagnostics = null, portable = false } = {}) {
  const runtime = runtimeDiagnostics || buildRuntimeDiagnostics();
  const pythonPath = runtime.python_executable || process.env.PYTHON || process.env.PYTHON3 || null;
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    node_version: process.version,
    node_path: portable ? portableRuntimePath(process.execPath, 'node') : process.execPath,
    python_path: portable ? portableRuntimePath(pythonPath, 'python') : pythonPath,
    freecad: runtime
      ? {
          available: Boolean(runtime.available),
          executable_detected: Boolean(runtime.executable_detected),
          probe_status: runtime.probe_status || null,
          status: runtime.status || null,
          mode: runtime.mode || '',
          source: runtime.source || '',
          executable: portable ? portableRuntimePath(runtime.executable || '', 'freecad') : runtime.executable || '',
          python_executable: portable ? portableRuntimePath(runtime.python_executable || '', 'python') : runtime.python_executable || '',
          runtime_executable: portable ? portableRuntimePath(runtime.runtime_executable || '', 'freecad-runtime') : runtime.runtime_executable || '',
          gui_executable: portable ? portableRuntimePath(runtime.gui_executable || '', 'freecad-gui') : runtime.gui_executable || '',
          description: portable
            ? (runtime.available ? 'FreeCAD runtime path redacted for portable proof manifest.' : 'FreeCAD runtime not detected.')
            : runtime.description || '',
          version: runtime.version_details?.freecad?.version ?? null,
          checked_candidates: portable ? [] : runtime.checked_candidates || [],
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
  runtimeDiagnostics = null,
  effectivePolicy = null,
  revisionLineage = null,
  portablePathRoot = null,
}) {
  const normalizedEffectivePolicy = normalizeEffectivePolicy(effectivePolicy);
  const proofPortable = normalizedEffectivePolicy?.proof_lineage === true;
  if (proofPortable && portablePathRoot !== null && (typeof portablePathRoot !== 'string' || !portablePathRoot.trim())) {
    throw new Error('portablePathRoot must be a non-empty path string when provided.');
  }
  const locatorOptions = {
    projectRoot,
    portablePathRoot: portablePathRoot ? resolve(portablePathRoot) : null,
  };
  const runtime = await collectRuntimeInfo({ runtimeDiagnostics, portable: proofPortable });
  const normalizedRevisionLineage = revisionLineage
    ? assertRevisionLineage(revisionLineage)
    : null;
  const artifactRecords = await collectArtifactMetadata(artifacts);
  const serializedArtifacts = proofPortable
    ? artifactRecords.map((record) => ({
        ...record,
        path: toPortableManifestLocator(record.path, {
          ...locatorOptions,
          category: record.type?.startsWith('input.') ? 'input' : 'run',
        }),
        ...(record.metadata ? {
          metadata: portableizeManifestValue(record.metadata, locatorOptions),
        } : {}),
      }))
    : artifactRecords;
  const manifest = {
    schema_version: ARTIFACT_MANIFEST_VERSION,
    manifest_version: ARTIFACT_MANIFEST_VERSION,
    manifest_type: 'fcad.artifact-manifest',
    interface: manifestInterface,
    command,
    job_type: jobType ?? command,
    status,
    request_id: requestId,
    config_path: configPath
      ? (proofPortable
          ? toPortableManifestLocator(resolve(configPath), {
              ...locatorOptions,
              category: 'input',
              preferRepo: true,
            })
          : resolve(configPath))
      : null,
    config_format: inferConfigFormat(configPath),
    config_version: Number.isInteger(configSummary?.target_version) ? configSummary.target_version : null,
    migrated_from: Number.isInteger(configSummary?.input_version) ? configSummary.input_version : null,
    migration_applied: migrationApplied(configSummary),
    selected_profile: selectedProfile,
    rule_profile: proofPortable
      ? portableizeManifestValue(ruleProfile ?? null, locatorOptions)
      : ruleProfile ?? null,
    rule_packs: defaultRulePacks(ruleProfile),
    runtime,
    warnings: uniqueStrings([...(configSummary?.warnings || []), ...warnings]),
    deprecations: uniqueStrings([...(configSummary?.deprecated_fields || []), ...deprecations]),
    artifacts: serializedArtifacts,
    timestamps: {
      created_at: timestamps.created_at ?? timestamps.started_at ?? null,
      started_at: timestamps.started_at ?? timestamps.created_at ?? null,
      finished_at: timestamps.finished_at ?? null,
    },
    app_version: resolvePackageVersion(projectRoot),
    git_commit: resolveGitCommit(projectRoot),
    ...(normalizedEffectivePolicy ? { effective_policy: normalizedEffectivePolicy } : {}),
    ...(normalizedRevisionLineage ? { revision_lineage: normalizedRevisionLineage } : {}),
    ...(details ? {
      details: proofPortable ? portableizeManifestValue(details, locatorOptions) : details,
    } : {}),
    ...(related ? {
      related: proofPortable ? portableizeManifestValue(related, locatorOptions) : related,
    } : {}),
  };

  const validation = validateArtifactManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid artifact manifest: ${validation.errors.join(' | ')}`);
  }

  return manifest;
}

export function validateArtifactManifest(manifest) {
  const valid = validateManifest(manifest);
  const errors = valid ? [] : formatSchemaErrors(validateManifest.errors);
  if (valid && manifest?.revision_lineage) {
    try {
      assertRevisionLineage(manifest.revision_lineage);
    } catch (error) {
      errors.push(`/revision_lineage ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ok: valid === true && errors.length === 0,
    errors,
  };
}

export async function writeArtifactManifest(manifestPath, manifest) {
  const absPath = resolve(manifestPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return absPath;
}
