import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  isAbsoluteManifestPath,
  toPortableManifestLocator,
} from './manifest-portable-locators.js';
import { buildRuntimeDiagnostics } from './runtime-diagnostics.js';
import { assertRevisionLineage } from './revision-lineage-contract.js';

const OUTPUT_MANIFEST_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/output-manifest.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateManifest = ajv.compile(OUTPUT_MANIFEST_SCHEMA);

export const OUTPUT_MANIFEST_SCHEMA_VERSION = '1.0';
export const DEFAULT_GENERATED_OUTPUT_DIR = 'output';

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
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

function safeFilenameComponent(value, defaultValue = 'output') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function deriveDefaultOutputDir({ inputPath = null, defaultOutputDir = DEFAULT_GENERATED_OUTPUT_DIR } = {}) {
  if (!defaultOutputDir) return null;
  const resolvedDefault = resolve(defaultOutputDir);
  if (!inputPath) return resolvedDefault;

  const resolvedInput = resolve(inputPath);
  const relativeInput = relative(resolvedDefault, resolvedInput);
  if (relativeInput.startsWith('..') || relativeInput === '..' || relative(resolvedInput, resolvedDefault) === '') {
    return resolvedDefault;
  }

  const parts = relativeInput.split(sep).filter(Boolean);
  const namespace = parts[0];
  const runId = parts[1];
  if (
    (namespace === 'jobs' || namespace === 'smoke' || namespace === 'playwright')
    && runId
  ) {
    return join(resolvedDefault, namespace, runId);
  }

  return resolvedDefault;
}

function runGit(projectRoot, args) {
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

async function hashFileSha256(filePath) {
  return new Promise((resolveHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', () => resolveHash(null));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function collectInputRecord(inputPath = null) {
  if (!inputPath) {
    return {
      path: null,
      sha256: null,
      size_bytes: null,
    };
  }

  const resolvedPath = resolve(inputPath);
  try {
    const info = await stat(resolvedPath);
    return {
      path: resolvedPath,
      sha256: await hashFileSha256(resolvedPath),
      size_bytes: info.size,
    };
  } catch {
    return {
      path: resolvedPath,
      sha256: null,
      size_bytes: null,
    };
  }
}

async function collectOutputRecords(entries = []) {
  const records = [];

  for (const entry of entries) {
    if (!entry?.path || !entry?.kind) continue;
    const resolvedPath = resolve(entry.path);
    const record = {
      path: resolvedPath,
      kind: String(entry.kind),
      exists: false,
      size_bytes: null,
      sha256: null,
    };

    try {
      const info = await stat(resolvedPath);
      record.exists = true;
      record.size_bytes = info.size;
      record.sha256 = await hashFileSha256(resolvedPath);
    } catch {
      // Keep missing outputs visible without failing manifest creation.
    }

    records.push(record);
  }

  return records;
}

function normalizeLinkedArtifacts(linkedArtifacts = {}) {
  const resolveMaybe = (value) => (typeof value === 'string' && value.trim() ? resolve(value) : null);

  const normalized = {
    qa_json: resolveMaybe(linkedArtifacts.qa_json),
    run_log_json: resolveMaybe(linkedArtifacts.run_log_json),
    traceability_json: resolveMaybe(linkedArtifacts.traceability_json),
    planner_json: resolveMaybe(linkedArtifacts.planner_json),
    extracted_drawing_semantics_json: resolveMaybe(linkedArtifacts.extracted_drawing_semantics_json),
    report_pdf: resolveMaybe(linkedArtifacts.report_pdf),
    quality_json: resolveMaybe(linkedArtifacts.quality_json),
    feature_catalog_json: resolveMaybe(linkedArtifacts.feature_catalog_json),
    reviewer_feedback_json: resolveMaybe(linkedArtifacts.reviewer_feedback_json),
  };

  const reportSummaryJson = resolveMaybe(linkedArtifacts.report_summary_json);
  if (reportSummaryJson) normalized.report_summary_json = reportSummaryJson;

  const drawingIntentJson = resolveMaybe(linkedArtifacts.drawing_intent_json);
  if (drawingIntentJson) normalized.drawing_intent_json = drawingIntentJson;

  return normalized;
}

function normalizeStatus(status, warnings = [], errors = []) {
  if (status === 'pass' || status === 'warning' || status === 'fail' || status === 'unknown') {
    return status;
  }
  if (errors.length > 0) return 'fail';
  if (warnings.length > 0) return 'warning';
  return 'pass';
}

function assertExactRecordKeys(record, expectedKeys, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) throw new Error(`${label}.${key} is not supported.`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(record, key)) throw new Error(`${label}.${key} is required.`);
  }
}

function normalizePrecomputedPath(value, { allowNull = false, label }) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty filesystem path.`);
  }
  return resolve(value);
}

function normalizePrecomputedSha256(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be null or a lowercase SHA-256 digest.`);
  }
  return value;
}

function normalizePrecomputedSize(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be null or a non-negative safe integer.`);
  }
  return value;
}

function normalizePrecomputedInputRecord(record, inputPath) {
  assertExactRecordKeys(record, ['path', 'sha256', 'size_bytes'], 'inputRecord');
  const normalized = {
    path: normalizePrecomputedPath(record.path, { allowNull: true, label: 'inputRecord.path' }),
    sha256: normalizePrecomputedSha256(record.sha256, 'inputRecord.sha256'),
    size_bytes: normalizePrecomputedSize(record.size_bytes, 'inputRecord.size_bytes'),
  };
  if (inputPath && normalized.path !== resolve(inputPath)) {
    throw new Error('inputRecord.path must match inputPath when both are provided.');
  }
  if (normalized.path === null && (normalized.sha256 !== null || normalized.size_bytes !== null)) {
    throw new Error('inputRecord hash and size must be null when path is null.');
  }
  return normalized;
}

function normalizePrecomputedOutputRecords(records, outputs) {
  if (!Array.isArray(records)) throw new Error('outputRecords must be an array.');
  const normalized = records.map((record, index) => {
    const label = `outputRecords[${index}]`;
    assertExactRecordKeys(record, ['path', 'kind', 'exists', 'size_bytes', 'sha256'], label);
    if (typeof record.kind !== 'string' || !record.kind.trim()) {
      throw new Error(`${label}.kind must be a non-empty string.`);
    }
    if (typeof record.exists !== 'boolean') {
      throw new Error(`${label}.exists must be a boolean.`);
    }
    const normalizedRecord = {
      path: normalizePrecomputedPath(record.path, { label: `${label}.path` }),
      kind: record.kind.trim(),
      exists: record.exists,
      size_bytes: normalizePrecomputedSize(record.size_bytes, `${label}.size_bytes`),
      sha256: normalizePrecomputedSha256(record.sha256, `${label}.sha256`),
    };
    if (!normalizedRecord.exists && (normalizedRecord.size_bytes !== null || normalizedRecord.sha256 !== null)) {
      throw new Error(`${label} hash and size must be null when exists is false.`);
    }
    if (normalizedRecord.exists && (normalizedRecord.size_bytes === null || normalizedRecord.sha256 === null)) {
      throw new Error(`${label} hash and size are required when exists is true.`);
    }
    return normalizedRecord;
  });

  const declared = Array.isArray(outputs)
    ? outputs.filter((entry) => entry?.path && entry?.kind)
    : [];
  if (declared.length > 0) {
    if (declared.length !== normalized.length) {
      throw new Error('outputRecords must match the declared outputs when both are provided.');
    }
    declared.forEach((entry, index) => {
      if (
        resolve(entry.path) !== normalized[index].path
        || String(entry.kind) !== normalized[index].kind
      ) {
        throw new Error(`outputRecords[${index}] must match the declared output path and kind.`);
      }
    });
  }
  return normalized;
}

export function collectRepoContext(projectRoot) {
  const fallbackRoot = resolve(projectRoot);
  const root = runGit(fallbackRoot, ['rev-parse', '--show-toplevel']) || fallbackRoot;
  const branch = runGit(root, ['branch', '--show-current']);
  const headSha = runGit(root, ['rev-parse', 'HEAD']);
  const dirty = runGit(root, ['status', '--porcelain']);

  return {
    root,
    branch,
    headSha,
    dirtyAtStart: Boolean(dirty),
  };
}

export async function collectRuntimeContext({ runtimeDiagnostics = null } = {}) {
  const runtime = runtimeDiagnostics || buildRuntimeDiagnostics();
  return {
    node_version: process.version,
    platform: process.platform,
    freecad_available: runtime ? Boolean(runtime.available) : null,
    freecad_executable_detected: runtime ? Boolean(runtime.executable_detected) : null,
    freecad_probe_status: runtime?.probe_status || null,
    freecad_status: runtime?.status || null,
    freecad_version: runtime?.version_details?.freecad?.version ?? null,
  };
}

export function createOutputManifestPath({
  primaryOutputPath = null,
  outputDir = null,
  inputPath = null,
  baseName = null,
  command = 'output',
  defaultOutputDir = DEFAULT_GENERATED_OUTPUT_DIR,
} = {}) {
  if (primaryOutputPath) {
    const resolvedPath = resolve(primaryOutputPath);
    const parsed = parse(resolvedPath);
    if (parsed.ext) {
      return join(parsed.dir, `${parsed.name}_manifest.json`);
    }
    const directoryBase = safeFilenameComponent(baseName || parsed.base || command, command);
    return join(resolvedPath, `${directoryBase}_manifest.json`);
  }

  const derivedBase = safeFilenameComponent(
    baseName || (inputPath ? parse(resolve(inputPath)).name : command),
    command
  );

  if (outputDir) {
    return join(resolve(outputDir), `${derivedBase}_manifest.json`);
  }

  const resolvedDefaultOutputDir = deriveDefaultOutputDir({ inputPath, defaultOutputDir });
  if (resolvedDefaultOutputDir) {
    return join(resolvedDefaultOutputDir, `${derivedBase}_manifest.json`);
  }

  return resolve(`${derivedBase}_manifest.json`);
}

export async function buildOutputManifest({
  projectRoot,
  repoContext = null,
  command,
  commandArgs = [],
  inputPath = null,
  inputRecord: suppliedInputRecord,
  outputs = [],
  outputRecords: suppliedOutputRecords,
  linkedArtifacts = {},
  warnings = [],
  errors = [],
  status = 'unknown',
  timings = {},
  runtimeDiagnostics = null,
  effectivePolicy = null,
  revisionLineage = null,
  portablePathRoot = null,
}) {
  const normalizedWarnings = uniqueStrings(warnings);
  const normalizedErrors = uniqueStrings(errors);
  const normalizedEffectivePolicy = normalizeEffectivePolicy(effectivePolicy);
  const proofPortable = normalizedEffectivePolicy?.proof_lineage === true;
  if (proofPortable && portablePathRoot !== null && (typeof portablePathRoot !== 'string' || !portablePathRoot.trim())) {
    throw new Error('portablePathRoot must be a non-empty path string when provided.');
  }
  const locatorOptions = {
    projectRoot,
    portablePathRoot: portablePathRoot ? resolve(portablePathRoot) : null,
  };
  const normalizedRevisionLineage = revisionLineage
    ? assertRevisionLineage(revisionLineage)
    : null;
  const inputRecord = suppliedInputRecord === undefined
    ? await collectInputRecord(inputPath)
    : normalizePrecomputedInputRecord(suppliedInputRecord, inputPath);
  const outputRecords = suppliedOutputRecords === undefined
    ? await collectOutputRecords(outputs)
    : normalizePrecomputedOutputRecords(suppliedOutputRecords, outputs);
  const normalizedLinkedArtifacts = normalizeLinkedArtifacts(linkedArtifacts);
  const normalizedStatus = normalizeStatus(status, normalizedWarnings, normalizedErrors);
  const serializedInput = proofPortable
    ? {
        ...inputRecord,
        path: toPortableManifestLocator(inputRecord.path, {
          ...locatorOptions,
          category: 'input',
        }),
      }
    : inputRecord;
  const serializedOutputs = proofPortable
    ? outputRecords.map((record) => ({
        ...record,
        path: toPortableManifestLocator(record.path, {
          ...locatorOptions,
          category: 'run',
        }),
      }))
    : outputRecords;
  const serializedLinkedArtifacts = proofPortable
    ? Object.fromEntries(Object.entries(normalizedLinkedArtifacts).map(([key, value]) => [
        key,
        value === null ? null : toPortableManifestLocator(value, {
          ...locatorOptions,
          category: 'run',
        }),
      ]))
    : normalizedLinkedArtifacts;
  const serializedCommandArgs = Array.isArray(commandArgs)
    ? commandArgs.map((value) => {
        const text = String(value);
        return proofPortable && isAbsoluteManifestPath(text)
          ? toPortableManifestLocator(text, { ...locatorOptions, category: 'input' })
          : text;
      })
    : [];
  const manifestWithoutRunId = {
    schema_version: OUTPUT_MANIFEST_SCHEMA_VERSION,
    command,
    command_args: serializedCommandArgs,
    input: serializedInput,
    repo: {
      root: proofPortable ? 'repo/root' : repoContext?.root || resolve(projectRoot),
      branch: repoContext?.branch ?? null,
      head_sha: repoContext?.headSha ?? null,
      dirty_at_start: Boolean(repoContext?.dirtyAtStart),
    },
    runtime: await collectRuntimeContext({ runtimeDiagnostics }),
    timings: {
      started_at: timings.startedAt ?? null,
      finished_at: timings.finishedAt ?? null,
      duration_ms: (() => {
        if (!timings.startedAt || !timings.finishedAt) return null;
        const started = Date.parse(timings.startedAt);
        const finished = Date.parse(timings.finishedAt);
        if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
        return finished - started;
      })(),
    },
    outputs: serializedOutputs,
    linked_artifacts: serializedLinkedArtifacts,
    warnings: normalizedWarnings,
    errors: normalizedErrors,
    status: normalizedStatus,
    ...(normalizedEffectivePolicy ? { effective_policy: normalizedEffectivePolicy } : {}),
    ...(normalizedRevisionLineage ? { revision_lineage: normalizedRevisionLineage } : {}),
  };
  const runId = proofPortable
    ? `proof-${createHash('sha256').update(JSON.stringify(manifestWithoutRunId)).digest('hex').slice(0, 32)}`
    : randomUUID();
  const manifest = {
    schema_version: manifestWithoutRunId.schema_version,
    run_id: runId,
    ...Object.fromEntries(Object.entries(manifestWithoutRunId).filter(([key]) => key !== 'schema_version')),
  };

  const validation = validateOutputManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid output manifest: ${validation.errors.join(' | ')}`);
  }

  return manifest;
}

export function validateOutputManifest(manifest) {
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

export async function writeOutputManifest(manifestPath, manifest) {
  const absPath = resolve(manifestPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return absPath;
}
