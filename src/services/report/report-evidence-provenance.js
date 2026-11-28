import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, resolve } from 'node:path';

import { migrateConfigDocument, parseConfigText } from '../../../lib/config-schema.js';
import { deepMerge } from '../../../lib/config-loader.js';
import { OUTPUT_MANIFEST_SCHEMA_VERSION, validateOutputManifest } from '../../../lib/output-manifest.js';
import { compileDrawingPlan, ensureDrawSchema, ensureDrawingViews } from '../../orchestration/drawing-prep.js';

const SHA256 = /^[a-f0-9]{64}$/i;
const SUPPORTED_FLAGS = new Set(['--strict-quality', '--bom']);

function byteReceipt(bytes) {
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
}

export async function readReportDrawingSvg(path, readFileFn = readFile) {
  const bytes = await readFileFn(path);
  // The embedded UTF-8 string must round-trip to the exact bytes the producer certified.
  const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return Object.freeze({ path, ...byteReceipt(bytes), value, error: null });
}

async function readSnapshot(path, { json = false } = {}) {
  const snapshot = { path: path || null, sha256: null, size_bytes: null, value: null, error: null };
  if (!path) return { ...snapshot, error: 'missing' };
  try {
    const bytes = await readFile(path);
    Object.assign(snapshot, byteReceipt(bytes));
    snapshot.value = json ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8');
  } catch (error) {
    snapshot.error = error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  return snapshot;
}

function fileRecord(snapshot) {
  return { path: snapshot.path, sha256: snapshot.sha256, size_bytes: snapshot.size_bytes };
}

function comparableConfig(config, filepath) {
  const normalized = migrateConfigDocument(config, { filepath });
  if (normalized.summary.errors.length) throw new Error('Config cannot be normalized.');
  // Report destinations can be relocated without changing the model or drawing input.
  if (normalized.config.export) delete normalized.config.export.directory;
  return normalized.config;
}

function currentConfigChecks(input, config) {
  if (input.error) return [{ code: 'input-unreadable', status: 'unknown' }];
  try {
    const parsed = parseConfigText(input.value, input.path).parsed;
    return isDeepStrictEqual(comparableConfig(parsed, input.path), comparableConfig(config, input.path))
      ? []
      : [{ code: 'report-config-mismatch', status: 'fail' }];
  } catch {
    return [{ code: 'report-config-unverifiable', status: 'unknown' }];
  }
}

function verifyProducer({ command, manifestSnapshot, input, configChecks, artifacts, effective = null }) {
  const manifest = manifestSnapshot.value;
  const issues = [...configChecks];
  if (effective) issues.push(...effective.issues);
  const outputChecks = [];
  const issue = (code, status = 'unknown', artifact = null) => issues.push({ code, status, ...(artifact ? { artifact } : {}) });
  if (manifestSnapshot.error || !manifest || typeof manifest !== 'object') {
    issue(manifestSnapshot.error === 'missing' ? 'manifest-missing' : 'manifest-unreadable');
  } else {
    if (manifest.command !== command) issue('producer-command-mismatch', 'fail');
    if (manifest.schema_version !== OUTPUT_MANIFEST_SCHEMA_VERSION) issue('manifest-schema-unsupported');
    else if (!validateOutputManifest(manifest).ok) issue('manifest-invalid');
    if (manifest.status === 'fail' || (Array.isArray(manifest.errors) && manifest.errors.length > 0)) {
      issue('producer-failed', 'fail');
    } else if (!['pass', 'warning'].includes(manifest.status)) {
      issue('producer-status-unverified');
    }

    const producerInput = manifest.input || {};
    if (!SHA256.test(producerInput.sha256 || '') || !Number.isInteger(producerInput.size_bytes)) {
      issue('input-proof-missing');
    }
    if (!effective && input.sha256 && (
      (SHA256.test(producerInput.sha256 || '') && producerInput.sha256.toLowerCase() !== input.sha256)
      || (Number.isInteger(producerInput.size_bytes) && producerInput.size_bytes !== input.size_bytes)
    )) issue('input-content-mismatch', 'fail');

    // The existing manifest hashes the raw config, not overrides, plans or other side inputs.
    // Only the ordinary config positional argument and these non-geometric flags are supported.
    const args = manifest.command_args;
    if (!Array.isArray(args) || !args.length || typeof args[0] !== 'string' || !args[0].trim() || args[0].trim().startsWith('-')
      || (!effective && args.slice(1).some((arg) => !SUPPORTED_FLAGS.has(arg)))) issue('producer-arguments-unverified');

    for (const { kind, snapshot } of artifacts) {
      const matches = Array.isArray(manifest.outputs) ? manifest.outputs.filter((entry) => entry?.kind === kind) : [];
      const record = matches.length === 1 ? matches[0] : null;
      const check = { kind, consumed: fileRecord(snapshot), producer: record, status: 'pass', reason_codes: [] };
      const outputIssue = (code, status = 'unknown') => {
        issue(code, status, kind);
        check.reason_codes.push(code);
        if (check.status !== 'fail') check.status = status;
      };
      if (snapshot.error) outputIssue('output-unreadable');
      if (!matches.length) outputIssue('output-record-missing');
      else if (matches.length !== 1) outputIssue('output-record-ambiguous');
      if (record) {
        if (record.exists !== true || !SHA256.test(record.sha256 || '') || !Number.isInteger(record.size_bytes)) {
          outputIssue('output-proof-missing');
        }
        if (snapshot.sha256 && (
          (SHA256.test(record.sha256 || '') && record.sha256.toLowerCase() !== snapshot.sha256)
          || (Number.isInteger(record.size_bytes) && record.size_bytes !== snapshot.size_bytes)
        )) outputIssue('output-content-mismatch', 'fail');
      }
      outputChecks.push(check);
    }
  }
  return {
    status: issues.some((entry) => entry.status === 'fail') ? 'fail' : issues.length ? 'unknown' : 'pass',
    reason_codes: [...new Set(issues.map((entry) => entry.code))],
    issues,
    manifest_path: manifestSnapshot.path,
    manifest_sha256: manifestSnapshot.sha256,
    producer_command: manifest?.command || null,
    current_input: fileRecord(input),
    producer_input: manifest?.input || null,
    output_checks: outputChecks,
    ...(effective ? { effective_input: effective.details } : {}),
  };
}

function recipeMatchesArguments(manifest, recipe) {
  const args = manifest.command_args;
  if (!Array.isArray(args) || !args.length) return false;
  if (recipe.kind === 'draw-service-v1') {
    const configSources = manifest.effective_input.sources.filter((entry) => entry.role === 'config');
    // API options live in the typed recipe. Serialized arguments identify only
    // the consumed config, so extra CLI-style modifiers are unaccounted inputs.
    return args.length === 1 && typeof args[0] === 'string' && isAbsolute(args[0])
      && configSources.length === 1 && args[0] === configSources[0].path
      && args[0] === manifest.input?.path;
  }
  const options = {};
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') return false;
    const [key, ...inline] = arg.split('=');
    if (['--strict-quality', '--bom', '--no-plan', '--raw', '--no-score'].includes(key)) {
      if (inline.length) return false;
      options[key] = true;
    } else if (['--override', '--weights-preset', '--fail-under'].includes(key)) {
      const value = inline.length ? inline.join('=') : args[++i];
      if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) return false;
      options[key] = value;
    } else return false;
  }
  if (recipe.kind === 'create-v1') return Object.keys(options).every((key) => key === '--strict-quality');
  if (recipe.kind !== 'draw-pipeline-v1') return false;
  if (Boolean(options['--override']) !== recipe.override
    || Boolean(options['--bom']) !== recipe.bom || Boolean(options['--no-plan']) !== recipe.no_plan
    || Boolean(options['--raw']) !== recipe.raw || Boolean(options['--no-score']) !== recipe.no_score) return false;
  if (options['--weights-preset'] && options['--weights-preset'] !== recipe.weights_preset) return false;
  if (String(options['--fail-under'] || '') !== String(recipe.fail_under || '')) return false;
  if (options['--override']) {
    const override = manifest.effective_input.sources.filter((entry) => entry.role === 'override');
    const workingDirectory = typeof recipe.working_directory === 'string' && recipe.working_directory.trim()
      ? recipe.working_directory : manifest.repo?.root || '.';
    if (override.length !== 1 || resolve(workingDirectory, options['--override']) !== override[0].path) return false;
  }
  return recipe.standard === 'KS' && Array.isArray(recipe.unsupported_flags) && !recipe.unsupported_flags.length;
}

async function verifyEffectiveInput({ manifest, command, config, artifactPaths }) {
  const proof = manifest?.effective_input;
  if (!proof) return null;
  const issues = [];
  const issue = (code, status = 'unknown') => issues.push({ code, status });
  const expectedAuthoredKind = command === 'create' ? 'model.effective-config-json' : 'drawing.authored-config-json';
  const expectedRuntimeKind = command === 'create' ? 'model.effective-config-json' : 'drawing.effective-config-json';
  const authoredPath = command === 'create' ? artifactPaths.create_effective_config : artifactPaths.drawing_authored_config;
  const runtimePath = command === 'create' ? artifactPaths.create_effective_config : artifactPaths.drawing_effective_config;
  const authored = await readSnapshot(authoredPath, { json: true });
  const runtime = runtimePath === authoredPath ? authored : await readSnapshot(runtimePath, { json: true });
  const artifacts = [{ kind: expectedAuthoredKind, snapshot: authored }];
  if (expectedRuntimeKind !== expectedAuthoredKind) artifacts.push({ kind: expectedRuntimeKind, snapshot: runtime });
  const details = { recipe: proof.recipe || null, source_checks: [], authored_config: fileRecord(authored), runtime_config: fileRecord(runtime) };
  if (!validateOutputManifest(manifest).ok) {
    issue('effective-proof-unsupported');
    return { issues, artifacts, details };
  }
  const recipe = proof.recipe || {};
  if (command === 'draw' && (
    (recipe.kind === 'draw-service-v1' && recipe.qa === false)
    || (recipe.kind === 'draw-pipeline-v1' && recipe.no_score === true)
  )) issue('producer-qa-not-run');
  if (proof.schema_version !== '1.0' || proof.authored_config_kind !== expectedAuthoredKind || proof.runtime_config_kind !== expectedRuntimeKind) issue('effective-proof-unsupported');
  if (!Array.isArray(proof.sources) || !proof.sources.length) issue('effective-source-proof-missing');
  const sourceChecks = [];
  const sourceSnapshots = new Map();
  for (const record of Array.isArray(proof.sources) ? proof.sources : []) {
    const consumed = await readSnapshot(record.path);
    if (!sourceSnapshots.has(record.role)) sourceSnapshots.set(record.role, []);
    sourceSnapshots.get(record.role).push(consumed);
    sourceChecks.push({ role: record.role, producer: record, current: fileRecord(consumed) });
    if (!SHA256.test(record.sha256 || '') || !Number.isInteger(record.size_bytes)) issue('side-input-proof-missing');
    if (consumed.error) issue('side-input-unreadable');
    else if (consumed.sha256 !== record.sha256 || consumed.size_bytes !== record.size_bytes) issue('side-input-content-mismatch', 'fail');
  }
  const configSources = (proof.sources || []).filter((entry) => entry.role === 'config');
  if (configSources.length !== 1) issue('effective-source-proof-missing');
  else if (configSources[0].sha256 !== manifest.input?.sha256 || configSources[0].size_bytes !== manifest.input?.size_bytes) issue('effective-source-input-mismatch', 'fail');
  if (!recipeMatchesArguments(manifest, recipe)) issue('producer-arguments-unverified');
  if (recipe.override && !(proof.sources || []).some((entry) => entry.role === 'override')) issue('effective-source-proof-missing');
  if (recipe.preset && !(proof.sources || []).some((entry) => entry.role === 'preset')) issue('effective-source-proof-missing');
  const requiredRoles = ['config', ...(recipe.override ? ['override'] : []), ...(recipe.preset ? ['preset'] : [])];
  if (recipe.kind === 'draw-pipeline-v1' && recipe.plan_status === 'applied') requiredRoles.push('compiler');
  if ((recipe.kind === 'draw-pipeline-v1' && !recipe.no_score) || (recipe.kind === 'draw-service-v1' && recipe.qa)) requiredRoles.push('qa-scorer');
  if ((recipe.kind === 'draw-pipeline-v1' && !recipe.raw) || (recipe.kind === 'draw-service-v1' && recipe.postprocess)) requiredRoles.push('postprocess');
  for (const role of requiredRoles) if (sourceSnapshots.get(role)?.length !== 1) issue('effective-source-proof-missing');
  try {
    const parseSourceConfig = (role) => {
      const snapshots = sourceSnapshots.get(role);
      if (snapshots?.length !== 1 || snapshots[0].error) throw new Error('Source unavailable.');
      const document = migrateConfigDocument(parseConfigText(snapshots[0].value, snapshots[0].path).parsed, { filepath: snapshots[0].path });
      if (document.summary.errors.length) throw new Error('Source config invalid.');
      return document.config;
    };
    const sourceConfig = parseSourceConfig('config');
    if (recipe.override) deepMerge(sourceConfig, parseSourceConfig('override'));
    if (recipe.preset) deepMerge(sourceConfig, parseSourceConfig('preset'));
    if (!authored.error && !isDeepStrictEqual(comparableConfig(sourceConfig), comparableConfig(authored.value))) issue('source-effective-config-mismatch', 'fail');
  } catch {
    issue('source-effective-config-unverifiable');
  }
  try {
    if (!authored.error && !isDeepStrictEqual(comparableConfig(config), comparableConfig(authored.value))) issue('effective-config-mismatch', 'fail');
    if (!authored.error && !runtime.error) {
      const expected = structuredClone(authored.value);
      if (command === 'draw') {
        if (recipe.kind === 'draw-pipeline-v1') {
          ensureDrawSchema(expected);
          if (recipe.bom) expected.drawing.bom_csv = true;
          ensureDrawingViews(expected);
          if (recipe.plan_status === 'applied' && recipe.no_plan === false) {
            compileDrawingPlan({ projectRoot: resolve(import.meta.dirname, '../../..'), config: expected });
          } else if (!(recipe.plan_status === 'skipped' && recipe.no_plan === true)) issue('effective-derivation-unverifiable');
        } else if (recipe.kind !== 'draw-service-v1') issue('effective-proof-unsupported');
        expected.standard = recipe.standard;
        expected.drawing ||= {};
        if (recipe.dxf_export) expected.drawing.dxf = true;
      } else if (recipe.kind !== 'create-v1') issue('effective-proof-unsupported');
      if (!isDeepStrictEqual(comparableConfig(expected), comparableConfig(runtime.value))) issue('effective-derivation-mismatch', 'fail');
    }
  } catch {
    issue('effective-derivation-unverifiable');
  }
  return { issues, artifacts, details: { ...details, source_checks: sourceChecks } };
}

function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

export async function loadReportEvidenceSnapshot({ configPath, config, artifactPaths, drawingSvgSnapshot = null }) {
  const [input, create, drawing, createManifest, drawingManifest, semantics, svg] = await Promise.all([
    readSnapshot(configPath),
    readSnapshot(artifactPaths.create_quality, { json: true }),
    readSnapshot(artifactPaths.drawing_quality, { json: true }),
    readSnapshot(artifactPaths.create_manifest, { json: true }),
    readSnapshot(artifactPaths.drawing_manifest, { json: true }),
    readSnapshot(artifactPaths.extracted_drawing_semantics, { json: true }),
    drawingSvgSnapshot ?? readSnapshot(artifactPaths.drawing_svg),
  ]);
  const configChecks = currentConfigChecks(input, config);
  const [createEffective, drawingEffective] = await Promise.all([
    verifyEffectiveInput({ manifest: createManifest.value, command: 'create', config, artifactPaths }),
    verifyEffectiveInput({ manifest: drawingManifest.value, command: 'draw', config, artifactPaths }),
  ]);
  const drawingArtifacts = [
    { kind: 'drawing.quality-json', snapshot: drawing },
    { kind: 'drawing.svg', snapshot: svg },
  ];
  if (semantics.value || drawing.value?.extracted_drawing_semantics_file
    || drawing.value?.semantic_quality?.extracted_evidence?.path) {
    drawingArtifacts.push({ kind: 'drawing.extracted-semantics-json', snapshot: semantics });
  }
  return freezeSnapshot({
    createQuality: create.value,
    drawingQuality: drawing.value,
    createManifest: createManifest.value,
    drawingManifest: drawingManifest.value,
    extractedDrawingSemantics: semantics.value,
    qualityProvenance: {
      create_quality: verifyProducer({ command: 'create', manifestSnapshot: createManifest, input, configChecks, effective: createEffective, artifacts: [{ kind: 'model.create-quality-json', snapshot: create }, ...(createEffective?.artifacts || [])] }),
      drawing_quality: verifyProducer({ command: 'draw', manifestSnapshot: drawingManifest, input, configChecks, effective: drawingEffective, artifacts: [...drawingArtifacts, ...(drawingEffective?.artifacts || [])] }),
    },
  });
}
