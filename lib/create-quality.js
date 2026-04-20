import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const CREATE_QUALITY_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/create-quality.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateQualityReport = ajv.compile(CREATE_QUALITY_SCHEMA);

export const CREATE_QUALITY_SCHEMA_VERSION = '1.0';
export const DEFAULT_CREATE_QUALITY_THRESHOLDS = Object.freeze({
  max_step_volume_delta_percent: 0.5,
  max_bbox_delta_mm: 0.2,
});

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function finiteInteger(value) {
  const numericValue = finiteNumber(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function safeFilenameComponent(value, defaultValue = 'create') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function roundNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeVector3(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const normalized = value.map((entry) => finiteNumber(entry));
  return normalized.every((entry) => entry !== null) ? normalized : null;
}

function normalizeBbox(source = null) {
  const bbox = source?.bbox || source?.bounding_box || source?.boundingBox || null;
  if (!bbox) return null;

  const min = normalizeVector3(bbox.min);
  const max = normalizeVector3(bbox.max);
  const size = normalizeVector3(bbox.size);
  if (!min || !max || !size) return null;

  return { min, max, size };
}

function coerceGeometry(source = null) {
  if (!source || typeof source !== 'object') {
    return {
      valid_shape: null,
      volume: null,
      area: null,
      bbox: null,
      solid_count: null,
      face_count: null,
      edge_count: null,
    };
  }

  const bbox = normalizeBbox(source);
  const volume = finiteNumber(source.volume);
  const faceCount = finiteInteger(source.face_count ?? source.faces);
  const edgeCount = finiteInteger(source.edge_count ?? source.edges);
  const inferredValidShape = volume !== null && volume > 0 && faceCount !== null && faceCount > 0
    ? true
    : null;

  return {
    valid_shape: booleanOrNull(source.valid_shape ?? source.validShape) ?? inferredValidShape,
    volume,
    area: finiteNumber(source.area),
    bbox,
    solid_count: finiteInteger(source.solid_count ?? source.solidCount),
    face_count: faceCount,
    edge_count: edgeCount,
  };
}

function coerceMeshMetrics(source = null) {
  if (!source || typeof source !== 'object') {
    return {
      triangle_count: null,
      watertight_or_closed: null,
      non_manifold_count: null,
      has_non_manifolds: null,
      bbox: null,
      corrupted_facets: null,
      invalid_points: null,
      invalid_neighbourhood: null,
    };
  }

  return {
    triangle_count: finiteInteger(source.triangle_count ?? source.facets),
    watertight_or_closed: booleanOrNull(source.watertight_or_closed),
    non_manifold_count: finiteInteger(source.non_manifold_count),
    has_non_manifolds: booleanOrNull(source.has_non_manifolds),
    bbox: normalizeBbox(source),
    corrupted_facets: booleanOrNull(source.corrupted_facets),
    invalid_points: booleanOrNull(source.invalid_points),
    invalid_neighbourhood: booleanOrNull(source.invalid_neighbourhood),
  };
}

function computeBboxDelta(sourceBbox = null, targetBbox = null) {
  if (!sourceBbox || !targetBbox) return null;

  const buildDelta = (left, right) => left.map((value, index) => roundNumber(Math.abs(value - right[index]), 4));
  const min = buildDelta(sourceBbox.min, targetBbox.min);
  const max = buildDelta(sourceBbox.max, targetBbox.max);
  const size = buildDelta(sourceBbox.size, targetBbox.size);
  const maxAbsMm = Math.max(...min, ...max, ...size);

  return {
    min,
    max,
    size,
    max_abs_mm: roundNumber(maxAbsMm, 4),
  };
}

function computeVolumeDeltaPercent(sourceVolume = null, targetVolume = null) {
  if (sourceVolume === null || targetVolume === null || sourceVolume <= 0) return null;
  return roundNumber(Math.abs(targetVolume - sourceVolume) / sourceVolume * 100, 4);
}

function collectPrimaryOutputs(createResult = {}) {
  const exports = Array.isArray(createResult.exports) ? createResult.exports : [];
  const findByFormat = (...formats) => {
    const expected = new Set(formats.map((value) => String(value).toLowerCase()));
    return exports.find((entry) => entry?.path && expected.has(String(entry.format).toLowerCase()))?.path || null;
  };

  return {
    step: findByFormat('step', 'stp'),
    stl: findByFormat('stl'),
    brep: findByFormat('brep', 'brp'),
    fcstd: findByFormat('fcstd'),
    per_part_stl: (createResult?.assembly?.part_files || [])
      .map((entry) => entry?.path)
      .filter((entry) => typeof entry === 'string' && entry.trim()),
  };
}

function collectGeometryIssues(geometry, blockingIssues, warnings) {
  if (geometry.valid_shape === false) {
    blockingIssues.push('Generated model shape is invalid.');
  } else if (geometry.valid_shape === null) {
    warnings.push('Generated model validity could not be determined from create metadata.');
  }

  if (geometry.volume !== null && geometry.volume <= 0) {
    blockingIssues.push('Generated model volume is empty or non-positive.');
  }
  if (geometry.face_count !== null && geometry.face_count <= 0) {
    blockingIssues.push('Generated model face count is empty.');
  }
  if (geometry.edge_count !== null && geometry.edge_count <= 0) {
    blockingIssues.push('Generated model edge count is empty.');
  }
  if (geometry.bbox && geometry.bbox.size.every((value) => value <= 0)) {
    blockingIssues.push('Generated model bounding box is empty.');
  }
}

function evaluateRoundtrip({
  label,
  exportPath,
  inspection = null,
  geometry,
  thresholds,
  runtimeAvailable,
}) {
  const warnings = [];
  const blockingIssues = [];
  const report = {
    exported: Boolean(exportPath),
    reimport_attempted: Boolean(exportPath && runtimeAvailable),
    reimport_valid: null,
    volume_delta_percent: null,
    bbox_delta: null,
    warnings,
  };

  if (!exportPath) return { report, blockingIssues };

  if (!runtimeAvailable) {
    warnings.push(`${label.toUpperCase()} round-trip skipped because FreeCAD runtime is unavailable.`);
    return { report, blockingIssues };
  }

  if (!inspection) {
    blockingIssues.push(`${label.toUpperCase()} round-trip inspection result is missing.`);
    return { report, blockingIssues };
  }

  if (inspection.success === false) {
    blockingIssues.push(`${label.toUpperCase()} round-trip failed: ${inspection.error || inspection.message || 'unknown error'}`);
    return { report, blockingIssues };
  }

  const importedGeometry = coerceGeometry(inspection.model);
  report.reimport_valid = importedGeometry.valid_shape;
  report.volume_delta_percent = computeVolumeDeltaPercent(geometry.volume, importedGeometry.volume);
  report.bbox_delta = computeBboxDelta(geometry.bbox, importedGeometry.bbox);

  if (importedGeometry.valid_shape === false) {
    blockingIssues.push(`${label.toUpperCase()} re-imported shape is invalid.`);
  } else if (importedGeometry.valid_shape === null) {
    warnings.push(`${label.toUpperCase()} re-import validity could not be determined.`);
  }

  if (importedGeometry.volume !== null && importedGeometry.volume <= 0) {
    blockingIssues.push(`${label.toUpperCase()} re-import volume is empty or non-positive.`);
  }

  if (
    report.volume_delta_percent !== null
    && report.volume_delta_percent > thresholds.max_step_volume_delta_percent
  ) {
    blockingIssues.push(
      `${label.toUpperCase()} volume delta ${report.volume_delta_percent}% exceeds `
      + `${thresholds.max_step_volume_delta_percent}%.`
    );
  }

  if (
    report.bbox_delta?.max_abs_mm !== null
    && report.bbox_delta.max_abs_mm > thresholds.max_bbox_delta_mm
  ) {
    blockingIssues.push(
      `${label.toUpperCase()} bounding-box delta ${report.bbox_delta.max_abs_mm} mm exceeds `
      + `${thresholds.max_bbox_delta_mm} mm.`
    );
  }

  return { report, blockingIssues };
}

function evaluateStlQuality({
  exportPath,
  inspection = null,
  geometry,
  thresholds,
  runtimeAvailable,
}) {
  const warnings = [];
  const blockingIssues = [];
  const report = {
    exported: Boolean(exportPath),
    mesh_load_attempted: Boolean(exportPath && runtimeAvailable),
    triangle_count: null,
    watertight_or_closed: null,
    non_manifold_count: null,
    warnings,
  };

  if (!exportPath) return { report, blockingIssues };

  if (!runtimeAvailable) {
    warnings.push('STL mesh quality skipped because FreeCAD runtime is unavailable.');
    return { report, blockingIssues };
  }

  if (!inspection) {
    blockingIssues.push('STL mesh inspection result is missing.');
    return { report, blockingIssues };
  }

  if (inspection.success === false) {
    blockingIssues.push(`STL mesh inspection failed: ${inspection.error || inspection.message || 'unknown error'}`);
    return { report, blockingIssues };
  }

  const mesh = coerceMeshMetrics(inspection.model);
  report.triangle_count = mesh.triangle_count;
  report.watertight_or_closed = mesh.watertight_or_closed;
  report.non_manifold_count = mesh.non_manifold_count;

  if (mesh.triangle_count !== null && mesh.triangle_count <= 0) {
    blockingIssues.push('STL mesh triangle count is empty.');
  } else if (mesh.triangle_count === null) {
    warnings.push('STL mesh triangle count could not be determined.');
  }

  if (mesh.watertight_or_closed === false) {
    blockingIssues.push('STL mesh is not watertight or closed.');
  } else if (mesh.watertight_or_closed === null) {
    warnings.push('STL mesh closure status could not be determined.');
  }

  if (mesh.non_manifold_count !== null && mesh.non_manifold_count > 0) {
    blockingIssues.push(`STL mesh has ${mesh.non_manifold_count} non-manifold elements.`);
  } else if (mesh.has_non_manifolds === true) {
    blockingIssues.push('STL mesh has non-manifold topology.');
  }

  if (mesh.corrupted_facets === true) blockingIssues.push('STL mesh has corrupted facets.');
  if (mesh.invalid_points === true) blockingIssues.push('STL mesh has invalid points.');
  if (mesh.invalid_neighbourhood === true) blockingIssues.push('STL mesh has invalid facet neighbourhoods.');

  const bboxDelta = computeBboxDelta(geometry.bbox, mesh.bbox);
  if (bboxDelta?.max_abs_mm !== null && bboxDelta.max_abs_mm > thresholds.max_bbox_delta_mm) {
    const message = `STL bounding-box delta ${bboxDelta.max_abs_mm} mm exceeds ${thresholds.max_bbox_delta_mm} mm.`;
    warnings.push(message);
    blockingIssues.push(message);
  }

  return { report, blockingIssues };
}

export function createCreateQualityPath({
  primaryOutputPath = null,
  outputDir = null,
  inputPath = null,
  baseName = null,
} = {}) {
  if (primaryOutputPath) {
    const resolvedPath = resolve(primaryOutputPath);
    const parsed = parse(resolvedPath);
    return join(parsed.dir, `${parsed.name}_create_quality.json`);
  }

  const derivedBase = safeFilenameComponent(
    baseName || (inputPath ? parse(resolve(inputPath)).name : 'create'),
    'create'
  );

  if (outputDir) return join(resolve(outputDir), `${derivedBase}_create_quality.json`);
  if (inputPath) {
    const resolvedInput = resolve(inputPath);
    const parsed = parse(resolvedInput);
    return join(parsed.dir, `${parsed.name}_create_quality.json`);
  }
  return resolve(`${derivedBase}_create_quality.json`);
}

export function buildCreateQualityReport({
  inputConfigPath = null,
  createResult = {},
  inspections = {},
  runtimeAvailable = true,
  thresholds = DEFAULT_CREATE_QUALITY_THRESHOLDS,
}) {
  const mergedThresholds = {
    ...DEFAULT_CREATE_QUALITY_THRESHOLDS,
    ...(thresholds || {}),
  };
  const geometry = coerceGeometry(createResult.model);
  const primaryOutputs = collectPrimaryOutputs(createResult);
  const blockingIssues = [];
  const warnings = [];

  collectGeometryIssues(geometry, blockingIssues, warnings);

  const stepRoundtrip = evaluateRoundtrip({
    label: 'step',
    exportPath: primaryOutputs.step,
    inspection: inspections.step,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });
  const brepRoundtrip = evaluateRoundtrip({
    label: 'brep',
    exportPath: primaryOutputs.brep,
    inspection: inspections.brep,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });
  const stlQuality = evaluateStlQuality({
    exportPath: primaryOutputs.stl,
    inspection: inspections.stl,
    geometry,
    thresholds: mergedThresholds,
    runtimeAvailable,
  });

  blockingIssues.push(...stepRoundtrip.blockingIssues);
  blockingIssues.push(...brepRoundtrip.blockingIssues);
  blockingIssues.push(...stlQuality.blockingIssues);
  warnings.push(...stepRoundtrip.report.warnings);
  warnings.push(...brepRoundtrip.report.warnings);
  warnings.push(...stlQuality.report.warnings);

  const hasRuntimeDependentOutputs = Boolean(primaryOutputs.step || primaryOutputs.brep || primaryOutputs.stl);
  if (!runtimeAvailable && hasRuntimeDependentOutputs) {
    warnings.push('FreeCAD runtime unavailable; create export quality checks were skipped.');
  }

  const status = (() => {
    if (blockingIssues.length > 0) return 'fail';
    if (!runtimeAvailable && hasRuntimeDependentOutputs) return 'skipped';
    if (warnings.length > 0) return 'warning';
    return 'pass';
  })();

  const report = {
    schema_version: CREATE_QUALITY_SCHEMA_VERSION,
    command: 'create',
    input_config: inputConfigPath ? resolve(inputConfigPath) : null,
    primary_outputs: primaryOutputs,
    geometry,
    step_roundtrip: stepRoundtrip.report,
    brep_roundtrip: brepRoundtrip.report,
    stl_quality: stlQuality.report,
    thresholds: mergedThresholds,
    status,
    blocking_issues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
  };

  const validation = validateCreateQualityReport(report);
  if (!validation.ok) {
    throw new Error(`Invalid create quality report: ${validation.errors.join(' | ')}`);
  }

  return report;
}

export function shouldFailCreateQuality(report, strictQuality = false) {
  return Boolean(strictQuality && report?.status === 'fail');
}

export function validateCreateQualityReport(report) {
  const valid = validateQualityReport(report);
  return {
    ok: Boolean(valid),
    errors: valid ? [] : formatSchemaErrors(validateQualityReport.errors || []),
  };
}

export async function writeCreateQualityReport(reportPath, report) {
  const absPath = resolve(reportPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return absPath;
}
