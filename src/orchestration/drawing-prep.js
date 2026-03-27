import { execSync } from 'node:child_process';
import { resolve, join, sep } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseTOML, stringify as tomlStringify } from 'smol-toml';
import { normalizeConfig } from '../../lib/config-normalizer.js';

export function isSafePlanPath(absPath, outputDir) {
  if (typeof absPath !== 'string' || !absPath) return false;
  const normalized = resolve(absPath);
  const outputRoot = resolve(outputDir);
  const outputPrefix = `${outputRoot}${sep}`;
  if (!(normalized === outputRoot || normalized.startsWith(outputPrefix))) {
    return false;
  }
  return normalized.endsWith('_plan.toml');
}

export function ensureDrawSchema(config) {
  config.drawing = config.drawing || {};
  config.drawing.units = config.drawing.units || 'mm';
  config.drawing.meta = config.drawing.meta || {};
  const meta = config.drawing.meta;
  meta.part_name = meta.part_name || config.name || 'unnamed';
  meta.material = meta.material || config.material || 'UNKNOWN';
  meta.units = meta.units || config.drawing.units;
  meta.tolerance_grade = meta.tolerance_grade || meta.tolerance || '';
  meta.surface_roughness_default = meta.surface_roughness_default
    || config.drawing.surface_finish?.default
    || '';
  config.drawing.datums = config.drawing.datums || [];
  config.drawing.key_dims = config.drawing.key_dims || [];
  config.drawing.thread_specs = config.drawing.thread_specs || config.drawing.threads || [];
  if (!config.exceptions || typeof config.exceptions !== 'object') {
    config.exceptions = { rules: [] };
  } else if (!Array.isArray(config.exceptions.rules)) {
    config.exceptions.rules = [];
  }
}

export function ensureDrawingViews(config, defaultViews = ['front', 'top', 'right', 'iso']) {
  config.drawing = config.drawing || {};
  if (!Array.isArray(config.drawing.views) || config.drawing.views.length === 0) {
    config.drawing.views = [...defaultViews];
  }
}

export function syncDrawingViewsFromPlan(config) {
  const planViews = config.drawing_plan?.views?.enabled;
  if (Array.isArray(planViews) && planViews.length > 0) {
    config.drawing.views = planViews;
  }
}

export async function applyOverrideConfig({
  config,
  overridePath,
  loadConfig,
  deepMerge,
}) {
  if (!overridePath) return null;
  const absOverridePath = resolve(overridePath);
  const overrideConfig = await loadConfig(absOverridePath);
  deepMerge(config, overrideConfig);
  return absOverridePath;
}

export function compileDrawingPlan({
  projectRoot,
  config,
  execSyncFn = execSync,
}) {
  const compilerScript = join(projectRoot, 'scripts', 'intent_compiler.py');
  const enriched = execSyncFn(
    `python3 "${compilerScript}"`,
    { input: JSON.stringify(config), encoding: 'utf-8', timeout: 15_000 }
  );
  const enrichedConfig = JSON.parse(enriched);
  Object.assign(config, enrichedConfig);
  syncDrawingViewsFromPlan(config);
  return {
    applied: true,
    partType: config.drawing_plan?.part_type || 'unknown',
  };
}

export async function loadDrawingPlan({
  config,
  planPath,
  readFileFn = readFile,
  parseTomlFn = parseTOML,
  normalizeConfigFn = normalizeConfig,
}) {
  const planRaw = await readFileFn(resolve(planPath), 'utf8');
  const planData = normalizeConfigFn(parseTomlFn(planRaw));
  if (!planData.drawing_plan) {
    throw new Error('Edited plan is missing drawing_plan section');
  }
  config.drawing_plan = planData.drawing_plan;
  syncDrawingViewsFromPlan(config);
  return resolve(planPath);
}

export async function saveDrawingPlan({
  drawingPlan,
  planPath,
  outputDir,
  modelName = 'unnamed',
  writeFileFn = writeFile,
  tomlStringifyFn = tomlStringify,
}) {
  if (!drawingPlan) return null;
  const targetPath = resolve(planPath || join(outputDir, `${modelName}_plan.toml`));
  if (!isSafePlanPath(targetPath, outputDir)) {
    throw new Error('Plan path rejected');
  }
  await writeFileFn(targetPath, tomlStringifyFn({ drawing_plan: drawingPlan }), 'utf8');
  return targetPath;
}
