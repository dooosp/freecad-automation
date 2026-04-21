import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const FEATURE_CATALOG_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/feature-catalog.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateCatalog = ajv.compile(FEATURE_CATALOG_SCHEMA);

export const FEATURE_CATALOG_SCHEMA_VERSION = '1.0';

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function safeFilenameComponent(value, defaultValue = 'feature_catalog') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function numericOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function vectorOrNull(value) {
  return Array.isArray(value)
    ? value.map(numericOrNull).filter((entry) => entry !== null)
    : null;
}

function shapeDimensions(shape = {}) {
  const dimensions = {};
  for (const key of ['length', 'width', 'height', 'radius', 'diameter']) {
    const value = numericOrNull(shape[key]);
    if (value !== null) dimensions[`${key}_mm`] = value;
  }
  if (dimensions.radius_mm !== undefined && dimensions.diameter_mm === undefined) {
    dimensions.diameter_mm = dimensions.radius_mm * 2;
  }
  const position = vectorOrNull(shape.position);
  if (position) dimensions.position_mm = position;
  return dimensions;
}

function operationDimensions(operation = {}) {
  const dimensions = {};
  for (const key of ['size', 'radius']) {
    const value = numericOrNull(operation[key]);
    if (value !== null) dimensions[`${key}_mm`] = value;
  }
  return dimensions;
}

function collectCriticalFeatureIds(config = {}) {
  const critical = new Set();
  for (const intent of asArray(config.drawing_plan?.dim_intents)) {
    if (intent?.required === true && typeof intent.feature === 'string' && intent.feature.trim()) {
      critical.add(intent.feature.trim());
    }
  }
  for (const feature of asArray(config.drawing_intent?.critical_features)) {
    for (const value of [feature?.feature, feature?.id]) {
      if (typeof value !== 'string' || !value.trim()) continue;
      for (const part of value.split(',')) {
        const normalized = part.trim();
        if (normalized) critical.add(normalized);
      }
    }
  }
  for (const dimension of asArray(config.drawing_intent?.required_dimensions)) {
    if (dimension?.required === false || typeof dimension.feature !== 'string' || !dimension.feature.trim()) continue;
    for (const part of dimension.feature.split(',')) {
      const normalized = part.trim();
      if (normalized) critical.add(normalized);
    }
  }
  return critical;
}

function createFeature({
  featureId,
  type,
  source,
  recognitionSource,
  confidence,
  critical = false,
  relatedConfigPath = null,
  relatedArtifact = null,
  dimensions = {},
  evidence,
}) {
  return {
    feature_id: featureId,
    type,
    source,
    recognition_source: recognitionSource,
    confidence,
    critical: Boolean(critical),
    related_config_path: relatedConfigPath,
    related_artifact: relatedArtifact,
    dimensions,
    evidence,
  };
}

function collectCutToolIds(operations = []) {
  return new Set(
    operations
      .filter((operation) => operation?.op === 'cut' && typeof operation.tool === 'string' && operation.tool.trim())
      .map((operation) => operation.tool.trim())
  );
}

function collectHoleFeatures({
  shapesById,
  operations,
  criticalFeatureIds,
  relatedConfigPath,
}) {
  const features = [];
  const holeFeatures = [];

  operations.forEach((operation, index) => {
    if (operation?.op !== 'cut' || !operation.tool) return;
    const toolId = String(operation.tool).trim();
    const shape = shapesById.get(toolId);
    if (!shape || shape.type !== 'cylinder') return;

    const feature = createFeature({
      featureId: toolId,
      type: 'hole',
      source: 'config.operations.cut_tool_cylinder',
      recognitionSource: 'explicit_config_cut_cylinder',
      confidence: 0.9,
      critical: criticalFeatureIds.has(toolId),
      relatedConfigPath,
      dimensions: shapeDimensions(shape),
      evidence: {
        kind: 'config_operation',
        operation_index: index,
        operation: 'cut',
        tool_shape_id: toolId,
        tool_shape_type: shape.type,
        base: operation.base || null,
        result: operation.result || null,
      },
    });
    features.push(feature);
    holeFeatures.push({ feature, shape });
  });

  return { features, holeFeatures };
}

function collectHolePatternFeatures({ holeFeatures, relatedConfigPath }) {
  const groups = new Map();
  for (const entry of holeFeatures) {
    const radius = numericOrNull(entry.shape.radius);
    if (radius === null) continue;
    const key = `radius:${radius}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const patterns = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length < 3) continue;
    const radius = Number(key.replace('radius:', ''));
    const positions = entries
      .map((entry) => vectorOrNull(entry.shape.position))
      .filter(Boolean);
    const xs = [...new Set(positions.map((position) => position[0]).filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
    const ys = [...new Set(positions.map((position) => position[1]).filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
    const spacingX = xs.length === 2 ? Math.abs(xs[1] - xs[0]) : null;
    const spacingY = ys.length === 2 ? Math.abs(ys[1] - ys[0]) : null;
    const patternId = `hole_pattern_${patterns.length + 1}`;

    patterns.push(createFeature({
      featureId: patternId,
      type: 'hole_pattern',
      source: 'config.operations.cut_tool_cylinder_group',
      recognitionSource: 'explicit_config_equal_radius_hole_group',
      confidence: xs.length === 2 && ys.length === 2 && positions.length === entries.length ? 0.78 : 0.68,
      critical: entries.some((entry) => entry.feature.critical),
      relatedConfigPath,
      dimensions: {
        count: entries.length,
        diameter_mm: radius * 2,
        member_feature_ids: entries.map((entry) => entry.feature.feature_id),
        center_positions_mm: positions,
        ...(spacingX !== null ? { spacing_x_mm: spacingX } : {}),
        ...(spacingY !== null ? { spacing_y_mm: spacingY } : {}),
      },
      evidence: {
        kind: 'config_feature_group',
        rule: 'same_radius_cut_cylinders',
        member_shape_ids: entries.map((entry) => entry.shape.id).filter(Boolean),
      },
    }));
  }

  return patterns;
}

function collectPrimaryAndUnknownShapes({
  shapes,
  operations,
  recognizedShapeIds,
  cutToolIds,
  criticalFeatureIds,
  relatedConfigPath,
}) {
  const features = [];
  const fusedToolIds = new Set(
    operations
      .filter((operation) => operation?.op === 'fuse' && typeof operation.tool === 'string' && operation.tool.trim())
      .map((operation) => operation.tool.trim())
  );

  const primaryBox = shapes.find((shape) => (
    shape?.type === 'box'
    && !cutToolIds.has(shape.id)
    && /(^|_)(base|plate|body)(_|$)/i.test(String(shape.id || ''))
  )) || shapes.find((shape) => shape?.type === 'box' && !cutToolIds.has(shape.id));

  if (primaryBox?.id && !recognizedShapeIds.has(primaryBox.id)) {
    features.push(createFeature({
      featureId: primaryBox.id,
      type: 'primary_body',
      source: 'config.shapes.box',
      recognitionSource: 'explicit_config_box_primary_candidate',
      confidence: /(^|_)(base|plate|body)(_|$)/i.test(primaryBox.id) ? 0.82 : 0.62,
      critical: criticalFeatureIds.has(primaryBox.id),
      relatedConfigPath,
      dimensions: shapeDimensions(primaryBox),
      evidence: {
        kind: 'config_shape',
        shape_id: primaryBox.id,
        shape_type: primaryBox.type,
        primary_selection: 'first_non_cut_box_or_named_base',
      },
    }));
    recognizedShapeIds.add(primaryBox.id);
  }

  for (const shape of shapes) {
    if (!shape?.id || recognizedShapeIds.has(shape.id)) continue;
    if (cutToolIds.has(shape.id)) continue;
    if (fusedToolIds.has(shape.id) || shape.type === 'box') {
      features.push(createFeature({
        featureId: shape.id,
        type: 'unknown',
        source: 'config.shapes.unclassified_solid',
        recognitionSource: 'explicit_config_shape_unclassified',
        confidence: 0.35,
        critical: criticalFeatureIds.has(shape.id),
        relatedConfigPath,
        dimensions: shapeDimensions(shape),
        evidence: {
          kind: 'config_shape',
          shape_id: shape.id,
          shape_type: shape.type || null,
          reason: 'Shape is explicit in config but not safely classifiable as a manufacturing feature yet.',
        },
      }));
      recognizedShapeIds.add(shape.id);
    }
  }

  return features;
}

function collectExplicitOperationFeatures({
  operations,
  criticalFeatureIds,
  relatedConfigPath,
}) {
  const features = [];
  operations.forEach((operation, index) => {
    if (operation?.op !== 'fillet' && operation?.op !== 'chamfer') return;
    const type = operation.op;
    const target = typeof operation.target === 'string' && operation.target.trim() ? operation.target.trim() : 'body';
    features.push(createFeature({
      featureId: `${type}_${index + 1}`,
      type,
      source: `config.operations.${type}`,
      recognitionSource: `explicit_config_${type}_operation`,
      confidence: 0.95,
      critical: criticalFeatureIds.has(target),
      relatedConfigPath,
      dimensions: operationDimensions(operation),
      evidence: {
        kind: 'config_operation',
        operation_index: index,
        operation: type,
        target,
        result: operation.result || null,
      },
    }));
  });
  return features;
}

function collectUnknownCutFeatures({
  shapesById,
  operations,
  recognizedShapeIds,
  criticalFeatureIds,
  relatedConfigPath,
}) {
  const features = [];
  operations.forEach((operation, index) => {
    if (operation?.op !== 'cut' || !operation.tool) return;
    const toolId = String(operation.tool).trim();
    if (recognizedShapeIds.has(toolId)) return;
    const shape = shapesById.get(toolId);
    if (!shape) return;
    features.push(createFeature({
      featureId: toolId,
      type: 'unknown_cut_feature',
      source: 'config.operations.cut_tool_unclassified',
      recognitionSource: 'explicit_config_cut_tool_unclassified',
      confidence: 0.45,
      critical: criticalFeatureIds.has(toolId),
      relatedConfigPath,
      dimensions: shapeDimensions(shape),
      evidence: {
        kind: 'config_operation',
        operation_index: index,
        operation: 'cut',
        tool_shape_id: toolId,
        tool_shape_type: shape.type || null,
        reason: 'Cut tool is explicit but not safely identifiable as a hole or slot.',
      },
    }));
    recognizedShapeIds.add(toolId);
  });
  return features;
}

export function createFeatureCatalogPath({ primaryOutputPath = null, outputDir = null, configName = null } = {}) {
  const stem = safeFilenameComponent(configName || (primaryOutputPath ? parse(resolve(primaryOutputPath)).name.replace(/_report$/i, '') : null), 'feature_catalog');
  if (primaryOutputPath) {
    return join(dirname(resolve(primaryOutputPath)), `${stem}_feature_catalog.json`);
  }
  return join(resolve(outputDir || 'output'), `${stem}_feature_catalog.json`);
}

export function buildFeatureCatalog({
  config = {},
  configPath = null,
  relatedArtifact = null,
  generatedAt = null,
} = {}) {
  const shapes = asArray(config.shapes).filter(isPlainObject);
  const operations = asArray(config.operations).filter(isPlainObject);
  const shapesById = new Map(
    shapes
      .filter((shape) => typeof shape.id === 'string' && shape.id.trim())
      .map((shape) => [shape.id.trim(), shape])
  );
  const criticalFeatureIds = collectCriticalFeatureIds(config);
  const relatedConfigPath = configPath ? resolve(configPath) : null;
  const features = [];
  const recognizedShapeIds = new Set();
  const cutToolIds = collectCutToolIds(operations);

  const { features: holeFeatures, holeFeatures: holeEntries } = collectHoleFeatures({
    shapesById,
    operations,
    criticalFeatureIds,
    relatedConfigPath,
  });
  features.push(...holeFeatures);
  for (const hole of holeEntries) recognizedShapeIds.add(hole.shape.id);

  features.push(...collectHolePatternFeatures({
    holeFeatures: holeEntries,
    relatedConfigPath,
  }));
  features.push(...collectPrimaryAndUnknownShapes({
    shapes,
    operations,
    recognizedShapeIds,
    cutToolIds,
    criticalFeatureIds,
    relatedConfigPath,
  }));
  features.push(...collectExplicitOperationFeatures({
    operations,
    criticalFeatureIds,
    relatedConfigPath,
  }));
  features.push(...collectUnknownCutFeatures({
    shapesById,
    operations,
    recognizedShapeIds,
    criticalFeatureIds,
    relatedConfigPath,
  }));

  const normalizedFeatures = features.map((feature) => ({
    ...feature,
    related_artifact: relatedArtifact || feature.related_artifact || null,
  }));
  const unknownFeatures = normalizedFeatures.filter((feature) => feature.type.startsWith('unknown')).length;
  const recognitionSources = [...new Set(normalizedFeatures.map((feature) => feature.recognition_source))].sort();
  const warnings = [];
  if (normalizedFeatures.length === 0) {
    warnings.push('No conservative manufacturing features were recognized from explicit config evidence.');
  }
  if (unknownFeatures > 0) {
    warnings.push('Some explicit config shapes or cut tools were left unknown because they are not safely classifiable yet.');
  }

  return {
    schema_version: FEATURE_CATALOG_SCHEMA_VERSION,
    artifact_type: 'feature_catalog',
    generated_at: generatedAt || new Date().toISOString(),
    recognition_policy: 'conservative_config_evidence_only',
    config_name: safeFilenameComponent(config.name, 'unnamed'),
    source_refs: [
      {
        kind: 'config',
        path: relatedConfigPath,
        label: 'Input config',
      },
      ...(relatedArtifact ? [{
        kind: 'report',
        path: relatedArtifact,
        label: 'Engineering report PDF',
      }] : []),
    ],
    summary: {
      total_features: normalizedFeatures.length,
      recognized_features: normalizedFeatures.length - unknownFeatures,
      unknown_features: unknownFeatures,
      recognition_sources: recognitionSources,
    },
    features: normalizedFeatures,
    warnings,
  };
}

export function validateFeatureCatalog(catalog) {
  const valid = validateCatalog(catalog);
  return {
    ok: Boolean(valid),
    errors: valid ? [] : formatSchemaErrors(validateCatalog.errors || []),
  };
}

export async function writeFeatureCatalog(catalogPath, catalog) {
  const validation = validateFeatureCatalog(catalog);
  if (!validation.ok) {
    throw new Error(`Invalid feature catalog: ${validation.errors.join(' | ')}`);
  }
  const absPath = resolve(catalogPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  return absPath;
}
