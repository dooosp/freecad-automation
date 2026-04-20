import { hasFreeCADRuntime } from '../../../lib/paths.js';
import {
  buildCreateQualityReport,
  createCreateQualityPath,
  shouldFailCreateQuality,
  writeCreateQualityReport,
} from '../../../lib/create-quality.js';
import { inspectModel } from './inspect-service.js';

function collectQualityTargets(createResult = {}) {
  const exports = Array.isArray(createResult.exports) ? createResult.exports : [];
  const targets = {};

  for (const entry of exports) {
    const format = String(entry?.format || '').toLowerCase();
    if (!entry?.path || !format) continue;
    if (format === 'step' || format === 'stp') targets.step = entry.path;
    if (format === 'stl') targets.stl = entry.path;
    if (format === 'brep' || format === 'brp') targets.brep = entry.path;
    if (format === 'fcstd') targets.fcstd = entry.path;
  }

  return targets;
}

async function inspectPath({ runScript, inspectModelFn, filePath }) {
  try {
    return await inspectModelFn({
      runScript,
      filePath,
    });
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function generateCreateQualityArtifact({
  createResult,
  configPath = null,
  config = {},
  runScript,
  inspectModelFn = inspectModel,
  runtimeAvailable = hasFreeCADRuntime(),
  strictQuality = false,
}) {
  const targets = collectQualityTargets(createResult);
  const inspections = {};

  if (runtimeAvailable) {
    if (targets.step) inspections.step = await inspectPath({ runScript, inspectModelFn, filePath: targets.step });
    if (targets.brep) inspections.brep = await inspectPath({ runScript, inspectModelFn, filePath: targets.brep });
    if (targets.stl) inspections.stl = await inspectPath({ runScript, inspectModelFn, filePath: targets.stl });
  }

  const report = buildCreateQualityReport({
    inputConfigPath: configPath,
    createResult,
    inspections,
    runtimeAvailable,
  });

  const path = createCreateQualityPath({
    primaryOutputPath: targets.step || targets.stl || targets.brep || targets.fcstd || null,
    outputDir: config?.export?.directory || null,
    inputPath: configPath,
    baseName: config?.name || null,
  });

  await writeCreateQualityReport(path, report);

  return {
    path,
    report,
    strictFailure: shouldFailCreateQuality(report, strictQuality),
  };
}
