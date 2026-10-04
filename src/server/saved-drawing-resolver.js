import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseTOML } from 'smol-toml';
import { serializeConfig, validateConfigDocument } from '../../lib/config-schema.js';
import { normalizeStudioDrawingSettings } from './studio-drawing-config.js';
import { isPlainObject, trimArtifactRef, validateArtifactRef } from './studio-job-request-helpers.js';

const DRAWING_SOURCE_SUFFIXES = new Map([
  ['drawing.svg', '_drawing.svg'],
  ['draw.plan.toml', '_plan.toml'],
  ['draw.plan.json', '_plan.json'],
]);

export function validateSavedDrawingRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) return ['Request body must be a JSON object.'];
  if (Object.keys(body).some((key) => key !== 'artifact_ref')) errors.push('Saved Drawing resume only accepts artifact_ref.');
  if (!Object.hasOwn(body, 'artifact_ref')) errors.push('artifact_ref is required.');
  validateArtifactRef(body.artifact_ref, 'artifact_ref', errors);
  if (isPlainObject(body.artifact_ref) && Object.keys(body.artifact_ref).some((key) => !['job_id', 'artifact_id'].includes(key))) {
    errors.push('artifact_ref only accepts job_id and artifact_id.');
  }
  return errors;
}

export async function resolveSavedDrawing({ jobStore, artifactRef }) {
  const errors = validateSavedDrawingRequest({ artifact_ref: artifactRef });
  if (errors.length) throw new Error(errors.join(' '));
  const ref = trimArtifactRef(artifactRef);
  const artifacts = await jobStore.listArtifacts(ref.job_id);
  const selected = artifacts.find((artifact) => artifact.id === ref.artifact_id);
  const suffix = DRAWING_SOURCE_SUFFIXES.get(selected?.type);
  if (!selected || selected.scope !== 'user-facing' || !suffix) {
    throw new Error('Saved Drawing resume requires a public drawing SVG or drawing plan artifact.');
  }
  const fileName = basename(selected.path);
  if (!fileName.endsWith(suffix) || fileName.length === suffix.length) {
    throw new Error('Saved Drawing artifact does not identify a supported drawing group.');
  }
  const stem = fileName.slice(0, -suffix.length);
  const directory = dirname(resolve(selected.path));
  function sibling(type, file, { optional = false } = {}) {
    const matches = artifacts.filter((artifact) => artifact.type === type && resolve(artifact.path) === join(directory, file));
    if (matches.length > 1 || (!optional && matches.length !== 1)) {
      throw new Error(`Saved Drawing group has missing or ambiguous ${type} evidence.`);
    }
    return matches[0] || null;
  }
  const group = {
    drawing: sibling('drawing.svg', `${stem}_drawing.svg`),
    config: sibling('config.effective', `${stem}_effective_config.json`),
    plan: sibling('draw.plan.json', `${stem}_plan.json`),
    planToml: sibling('draw.plan.toml', `${stem}_plan.toml`, { optional: true }),
  };
  if (group.drawing.scope !== 'user-facing' || group.plan.scope !== 'user-facing') {
    throw new Error('Saved Drawing group requires public SVG and plan evidence.');
  }
  const snapshots = Object.fromEntries(await Promise.all(Object.entries(group)
    .filter(([, artifact]) => artifact)
    .map(async ([key, artifact]) => [key, await jobStore.readVerifiedArtifactSnapshot(ref.job_id, artifact.id, {
      expectedBinding: {
        schema_version: '1.0', job_id: ref.job_id, artifact_id: artifact.id, path: artifact.path,
        sha256: artifact.registered_sha256, size_bytes: artifact.registered_size_bytes,
      },
    })])));
  let config;
  let plan;
  try {
    config = JSON.parse(snapshots.config.readDetachedBytes().toString('utf8'));
    plan = JSON.parse(snapshots.plan.readDetachedBytes().toString('utf8')).drawing_plan;
    if (!isPlainObject(config) || !isPlainObject(plan) || !isDeepStrictEqual(config.drawing_plan, plan)) {
      throw new Error('mismatched plan');
    }
    if (snapshots.planToml) {
      const tomlPlan = parseTOML(snapshots.planToml.readDetachedBytes().toString('utf8')).drawing_plan;
      if (!isDeepStrictEqual(tomlPlan, plan)) throw new Error('mismatched TOML plan');
    }
  } catch {
    throw new Error('Saved Drawing config and plan evidence is invalid or inconsistent.');
  }
  const authoringConfig = structuredClone(config);
  if (isPlainObject(authoringConfig.export)) delete authoringConfig.export.directory;
  const validation = validateConfigDocument(authoringConfig, { filepath: 'studio:saved-drawing' });
  if (!validation.valid) throw new Error('Saved Drawing authoring config is invalid.');
  const drawingSettings = normalizeStudioDrawingSettings({
    section_assist: isPlainObject(validation.config.drawing?.section),
    detail_assist: isPlainObject(validation.config.drawing?.detail),
  }, validation.config);
  return {
    configToml: serializeConfig(validation.config, 'toml'),
    drawingPlan: structuredClone(plan),
    drawingSettings,
    source: {
      job_id: ref.job_id,
      artifact_id: ref.artifact_id,
      drawing_artifact_id: group.drawing.id,
      config_artifact_id: group.config.id,
      plan_artifact_id: group.plan.id,
    },
  };
}
