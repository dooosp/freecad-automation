import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { getFreeCADRuntime } from './paths.js';

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

function probeFreecadVersion(runtime = null) {
  const executable = runtime?.runtimeExecutable || runtime?.executable || '';
  if (!executable) return null;

  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const match = text.match(/FreeCAD[^0-9]*([0-9][0-9A-Za-z.+-]*)/i)
      || text.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.+-]+)?)/);
    return match?.[1] || text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
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
    report_pdf: resolveMaybe(linkedArtifacts.report_pdf),
    quality_json: resolveMaybe(linkedArtifacts.quality_json),
    feature_catalog_json: resolveMaybe(linkedArtifacts.feature_catalog_json),
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

export async function collectRuntimeContext() {
  const runtime = getFreeCADRuntime();
  return {
    node_version: process.version,
    platform: process.platform,
    freecad_available: runtime ? Boolean(runtime.available) : null,
    freecad_version: runtime ? probeFreecadVersion(runtime) : null,
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
  outputs = [],
  linkedArtifacts = {},
  warnings = [],
  errors = [],
  status = 'unknown',
  timings = {},
}) {
  const normalizedWarnings = uniqueStrings(warnings);
  const normalizedErrors = uniqueStrings(errors);
  const manifest = {
    schema_version: OUTPUT_MANIFEST_SCHEMA_VERSION,
    run_id: randomUUID(),
    command,
    command_args: Array.isArray(commandArgs) ? commandArgs.map((value) => String(value)) : [],
    input: await collectInputRecord(inputPath),
    repo: {
      root: repoContext?.root || resolve(projectRoot),
      branch: repoContext?.branch ?? null,
      head_sha: repoContext?.headSha ?? null,
      dirty_at_start: Boolean(repoContext?.dirtyAtStart),
    },
    runtime: await collectRuntimeContext(),
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
    outputs: await collectOutputRecords(outputs),
    linked_artifacts: normalizeLinkedArtifacts(linkedArtifacts),
    warnings: normalizedWarnings,
    errors: normalizedErrors,
    status: normalizeStatus(status, normalizedWarnings, normalizedErrors),
  };

  const validation = validateOutputManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid output manifest: ${validation.errors.join(' | ')}`);
  }

  return manifest;
}

export function validateOutputManifest(manifest) {
  const valid = validateManifest(manifest);
  return {
    ok: valid === true,
    errors: valid ? [] : formatSchemaErrors(validateManifest.errors),
  };
}

export async function writeOutputManifest(manifestPath, manifest) {
  const absPath = resolve(manifestPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return absPath;
}
