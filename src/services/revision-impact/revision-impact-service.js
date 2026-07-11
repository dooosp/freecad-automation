import { randomUUID } from 'node:crypto';
import { constants as fsConstants, readFileSync } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseToml } from 'smol-toml';

import { assertValidCArtifact } from '../../../lib/c-artifact-schema.js';
import { configV1Schema } from '../../../lib/config-canonical-schema.js';
import { validateCreateQualityReport } from '../../../lib/create-quality.js';
import { assertValidDArtifact } from '../../../lib/d-artifact-schema.js';
import { validateFeatureCatalog } from '../../../lib/feature-catalog.js';
import {
  decodeInspectionEvidenceUtf8,
  findNonGenuineStringMarkers,
  isParseableTimestamp,
  parseInspectionEvidenceJsonBytes,
  sha256Bytes,
  validateInspectionEvidenceAttachmentRecordSchema,
  validateInspectionEvidenceControlMaterial,
  validateInspectionEvidenceEnvelopeSchema,
  validateJsonDocumentBounds,
} from '../../../lib/inspection-evidence-onboarding.js';
import {
  REVISION_IMPACT_SCHEMA_VERSION,
  assertValidRevisionImpactReport,
  buildRevisionImpactStableId,
  canonicalizeRevisionImpactJson,
  hashRevisionImpactValue,
  renderRevisionImpactMarkdown,
} from '../../../lib/revision-impact-contract.js';
import { validateExtractedDrawingSemantics } from '../drawing/extracted-drawing-semantics.js';
import { validateEvidenceGraph } from '../evidence-graph/evidence-graph-service.js';

export const REVISION_IMPACT_MAX_JSON_BYTES = 4 * 1024 * 1024;
export const REVISION_IMPACT_MAX_CONFIG_BYTES = 2 * 1024 * 1024;

const DRAWING_INTENT_SCHEMA = JSON.parse(readFileSync(
  new URL('../../../schemas/drawing-intent.schema.json', import.meta.url),
  'utf8'
));
const adapterAjv = new Ajv2020({ allErrors: true, strict: false });
const validateDrawingIntentSchema = adapterAjv.compile(DRAWING_INTENT_SCHEMA);
const validateConfigSchema = adapterAjv.compile(configV1Schema);

const DECLARED_ARTIFACT_TYPES = Object.freeze({
  feature_catalog: 'feature_catalog',
  drawing_intent: 'drawing_intent',
  create_quality: 'create_quality',
  create_quality_report: 'create_quality',
  drawing_quality: 'drawing_quality',
  drawing_quality_report: 'drawing_quality',
  drawing_qa: 'drawing_qa',
  drawing_qa_report: 'drawing_qa',
  dfm: 'dfm',
  dfm_report: 'dfm',
  quality_risk: 'quality_risk',
  extracted_drawing_semantics: 'extracted_drawing_semantics',
  evidence_graph: 'evidence_graph',
});

const NON_ENGINEERING_CHANGE_TYPES = new Set([
  'metadata_change',
  'revision_identity_change',
  'evidence_reference_change',
  'unresolved_identity_change',
]);
const REINSPECTION_CHANGE_TYPES = new Set([
  'geometry_feature_added',
  'geometry_feature_modified',
  'nominal_dimension_change',
  'critical_characteristic_change',
  'inspection_method_requirement_change',
]);
const VOLATILE_KEYS = new Set([
  'generated_at',
  'created_at',
  'updated_at',
  'timestamp',
  'runtime_path',
  'output_path',
  'temporary_path',
  'host_diagnostics',
]);
const UNIT_ALIASES = new Map([
  ['mm', { unit: 'mm', factor: 1 }],
  ['millimeter', { unit: 'mm', factor: 1 }],
  ['millimeters', { unit: 'mm', factor: 1 }],
  ['millimetre', { unit: 'mm', factor: 1 }],
  ['millimetres', { unit: 'mm', factor: 1 }],
  ['in', { unit: 'mm', factor: 25.4 }],
  ['inch', { unit: 'mm', factor: 25.4 }],
  ['inches', { unit: 'mm', factor: 25.4 }],
  ['deg', { unit: 'deg', factor: 1 }],
  ['degree', { unit: 'deg', factor: 1 }],
  ['degrees', { unit: 'deg', factor: 1 }],
]);

let atomicWriteCounter = 0;

export class RevisionImpactServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RevisionImpactServiceError';
    this.code = code;
    this.details = details;
  }
}

function serviceError(code, message, details = {}) {
  return new RevisionImpactServiceError(code, message, details);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))]
    .sort(compareCodePoints);
}

function repoRelative(root, target) {
  return relative(root, target).replaceAll('\\', '/');
}

function isInside(root, target) {
  const rel = repoRelative(root, target);
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}

function assertPathText(pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw serviceError('path_required', `${label} path is required`);
  }
  const raw = pathValue.trim();
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('~')) {
    throw serviceError('unsafe_path', `${label} contains NUL, backslash, or home-expansion syntax`);
  }
  if (raw.replaceAll('\\', '/').split('/').includes('..')) {
    throw serviceError('path_traversal_forbidden', `${label} contains parent traversal`);
  }
  return raw;
}

async function resolveProjectRoot(projectRoot) {
  const rootPath = resolve(assertPathText(projectRoot, 'project root'));
  const info = await lstat(rootPath);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw serviceError('unsafe_project_root', 'Project root must be a real directory');
  }
  const rootReal = await realpath(rootPath);
  if (rootReal !== rootPath) {
    throw serviceError('unsafe_project_root', 'Project root must not resolve through a symlink');
  }
  return rootReal;
}

async function resolveExistingTrustedRoots(pathValues, label) {
  const roots = [];
  for (const pathValue of asArray(pathValues)) {
    const absolute = resolve(assertPathText(pathValue, label));
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw serviceError('unsafe_trusted_root', `${label} must be an existing real directory`);
    }
    const real = await realpath(absolute);
    // macOS commonly exposes /var as an ancestor alias of /private/var. The
    // explicitly trusted leaf must be real; authorization then uses its
    // canonical realpath so an ancestor alias cannot widen the boundary.
    roots.push(real);
  }
  return uniqueSorted(roots);
}

async function readRegularFileNoFollow(projectRoot, pathValue, {
  label,
  maxBytes,
  trustedRoots = [projectRoot],
} = {}) {
  const raw = assertPathText(pathValue, label);
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(projectRoot, raw);
  const before = await lstat(absolute);
  if (before.isSymbolicLink()) throw serviceError('symlink_forbidden', `${label} must not be a symlink`);
  if (!before.isFile()) throw serviceError('regular_file_required', `${label} must be a regular file`);
  if (before.nlink !== 1) throw serviceError('hardlink_forbidden', `${label} must not be a hardlink alias`);
  if (before.size <= 0 || before.size > maxBytes) {
    throw serviceError('input_size_out_of_bounds', `${label} must be between 1 and ${maxBytes} bytes`);
  }
  const real = await realpath(absolute);
  const boundaryRoot = [...trustedRoots]
    .filter((root) => isInside(root, real))
    .sort((left, right) => right.length - left.length)[0];
  if (!boundaryRoot) {
    throw serviceError('input_path_escape', `${label} resolved outside its declared trusted input boundary`);
  }

  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1
      || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw serviceError('input_changed_during_read', `${label} changed before it could be read safely`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1 || bytes.byteLength !== opened.size) {
      throw serviceError('input_changed_during_read', `${label} changed while it was being read`);
    }
    return {
      bytes,
      absolute: real,
      ref: repoRelative(projectRoot, real),
      sha256: sha256Bytes(bytes),
    };
  } finally {
    await handle?.close();
  }
}

function assertFiniteJson(document, label) {
  const stack = [{ value: document, path: '/' }];
  while (stack.length > 0) {
    const { value, path } = stack.pop();
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw serviceError('non_finite_number', `${label} contains a non-finite number at ${path}`);
    }
    if (!value || typeof value !== 'object') continue;
    const entries = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry])
      : Object.entries(value);
    for (const [key, entry] of entries) stack.push({ value: entry, path: `${path}${key}/` });
  }
}

function assertDocumentSafety(document, label) {
  const bounds = validateJsonDocumentBounds(document, { maxDepth: 64, maxNodes: 50_000 });
  if (!bounds.ok) {
    throw serviceError(bounds.errors[0].code, `${label}: ${bounds.errors.map((error) => error.message).join(' | ')}`);
  }
  assertFiniteJson(document, label);
  const material = validateInspectionEvidenceControlMaterial(document);
  if (!material.ok) {
    throw serviceError('unsafe_control_material', `${label}: ${material.errors.map((error) => error.message).join(' | ')}`, {
      errors: material.errors,
    });
  }
}

async function readStrictJson(
  projectRoot,
  pathValue,
  label,
  maxBytes = REVISION_IMPACT_MAX_JSON_BYTES,
  trustedRoots = [projectRoot]
) {
  const source = await readRegularFileNoFollow(projectRoot, pathValue, { label, maxBytes, trustedRoots });
  if (source.bytes.length >= 3
    && source.bytes[0] === 0xef && source.bytes[1] === 0xbb && source.bytes[2] === 0xbf) {
    throw serviceError('json_bom_forbidden', `${label} must not contain a UTF-8 BOM`);
  }
  let document;
  try {
    document = parseInspectionEvidenceJsonBytes(source.bytes, { requireCanonical: false });
  } catch (error) {
    throw serviceError(error.code || 'malformed_json', `${label} is not strict UTF-8 JSON: ${error.message}`);
  }
  assertDocumentSafety(document, label);
  return { document, source };
}

async function readStrictConfig(projectRoot, pathValue, label, trustedRoots = [projectRoot]) {
  const extension = extname(pathValue).toLowerCase();
  if (extension === '.json') {
    const loaded = await readStrictJson(
      projectRoot,
      pathValue,
      label,
      REVISION_IMPACT_MAX_CONFIG_BYTES,
      trustedRoots
    );
    if (!validateConfigSchema(loaded.document)) {
      throw serviceError('config_schema_invalid', `${label} failed config schema validation`, {
        errors: validateConfigSchema.errors || [],
      });
    }
    return loaded;
  }
  if (extension !== '.toml') {
    throw serviceError('unsupported_config_format', `${label} must use .json or .toml`);
  }
  const source = await readRegularFileNoFollow(projectRoot, pathValue, {
    label,
    maxBytes: REVISION_IMPACT_MAX_CONFIG_BYTES,
    trustedRoots,
  });
  if (source.bytes.length >= 3
    && source.bytes[0] === 0xef && source.bytes[1] === 0xbb && source.bytes[2] === 0xbf) {
    throw serviceError('config_bom_forbidden', `${label} must not contain a UTF-8 BOM`);
  }
  let document;
  try {
    document = parseToml(decodeInspectionEvidenceUtf8(source.bytes));
  } catch (error) {
    throw serviceError('malformed_config', `${label} is not valid TOML: ${error.message}`);
  }
  assertDocumentSafety(document, label);
  if (!validateConfigSchema(document)) {
    throw serviceError('config_schema_invalid', `${label} failed config schema validation`, {
      errors: validateConfigSchema.errors || [],
    });
  }
  return { document, source };
}

function assertValidation(result, code, label) {
  if (result?.ok) return;
  const errors = asArray(result?.errors);
  throw serviceError(code, `${label} failed validation: ${errors.map((error) => (
    typeof error === 'string' ? error : error.message
  )).join(' | ')}`, { errors });
}

function validateDeclaredArtifact(kind, document, label) {
  if (kind === 'feature_catalog') return assertValidation(validateFeatureCatalog(document), 'feature_catalog_invalid', label);
  if (kind === 'drawing_intent') {
    if (!validateDrawingIntentSchema(document)) {
      throw serviceError('drawing_intent_invalid', `${label} failed drawing-intent schema validation`, {
        errors: validateDrawingIntentSchema.errors || [],
      });
    }
    return;
  }
  if (kind === 'create_quality') return assertValidation(validateCreateQualityReport(document), 'create_quality_invalid', label);
  if (kind === 'quality_risk') {
    assertValidCArtifact('quality_risk', document, { command: 'compare-rev', path: label });
    return;
  }
  if (kind === 'extracted_drawing_semantics') {
    return assertValidation(validateExtractedDrawingSemantics(document), 'extracted_drawing_semantics_invalid', label);
  }
  if (kind === 'evidence_graph') return assertValidation(validateEvidenceGraph(document), 'evidence_graph_invalid', label);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw serviceError('declared_artifact_invalid', `${label} must be a JSON object`);
  }
}

function ledgerHashFor(reviewPack, artifactType, pathValue) {
  const normalizedKind = DECLARED_ARTIFACT_TYPES[artifactType] || artifactType;
  const matches = asArray(reviewPack?.evidence_ledger?.records).filter((record) => {
    const ref = textOrNull(record?.source_ref || record?.path);
    const kind = DECLARED_ARTIFACT_TYPES[record?.artifact_type || record?.type] || record?.artifact_type || record?.type;
    return ref === pathValue && kind === normalizedKind;
  });
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0]?.sha256 || '')) {
    throw serviceError(
      'declared_artifact_ledger_hash_missing',
      `Declared ${artifactType} must have exactly one SHA-256-bound evidence-ledger record`
    );
  }
  return matches[0].sha256;
}

async function loadDeclaredArtifacts(projectRoot, reviewPack) {
  const artifacts = {};
  for (const ref of asArray(reviewPack?.source_artifact_refs)) {
    const declaredType = textOrNull(ref?.artifact_type);
    const kind = DECLARED_ARTIFACT_TYPES[declaredType];
    if (!kind) continue;
    const pathValue = textOrNull(ref?.path);
    if (!pathValue || isAbsolute(pathValue)) {
      throw serviceError('unsafe_declared_artifact_ref', `Declared ${declaredType} must use a repo-relative path`);
    }
    assertPathText(pathValue, `declared ${declaredType}`);
    if (artifacts[kind]) {
      throw serviceError('ambiguous_declared_artifact', `Only one declared ${kind} artifact is supported per revision`);
    }
    const expectedSha256 = ledgerHashFor(reviewPack, declaredType, pathValue);
    const loaded = await readStrictJson(projectRoot, pathValue, `declared ${declaredType}`);
    if (loaded.source.sha256 !== expectedSha256) {
      throw serviceError('declared_artifact_hash_mismatch', `Declared ${declaredType} does not match its evidence-ledger SHA-256`);
    }
    validateDeclaredArtifact(kind, loaded.document, pathValue);
    artifacts[kind] = loaded;
  }
  return artifacts;
}

async function loadRevisionSide(projectRoot, label, {
  reviewPackPath,
  readinessPath = null,
  configPath = null,
  evidenceEnvelopePath = null,
  evidenceReceiptPath = null,
}, trustedRoots = [projectRoot]) {
  const reviewPack = await readStrictJson(
    projectRoot,
    reviewPackPath,
    `${label} review pack`,
    REVISION_IMPACT_MAX_JSON_BYTES,
    trustedRoots
  );
  assertValidDArtifact('review_pack', reviewPack.document, { command: 'compare-rev', path: reviewPack.source.ref });
  const side = {
    reviewPack: reviewPack.document,
    artifacts: await loadDeclaredArtifacts(projectRoot, reviewPack.document),
    sources: { review_pack: reviewPack.source },
    readiness: null,
    config: null,
    evidenceEnvelope: null,
    evidenceReceipt: null,
  };

  if (readinessPath) {
    const loaded = await readStrictJson(
      projectRoot,
      readinessPath,
      `${label} readiness report`,
      REVISION_IMPACT_MAX_JSON_BYTES,
      trustedRoots
    );
    assertValidCArtifact('readiness_report', loaded.document, { command: 'compare-rev', path: loaded.source.ref });
    side.readiness = loaded.document;
    side.sources.readiness_report = loaded.source;
  }
  if (configPath) {
    const loaded = await readStrictConfig(projectRoot, configPath, `${label} config`, trustedRoots);
    side.config = loaded.document;
    side.sources.config = loaded.source;
  }
  if (evidenceEnvelopePath) {
    const loaded = await readStrictJson(
      projectRoot,
      evidenceEnvelopePath,
      `${label} evidence envelope`,
      REVISION_IMPACT_MAX_JSON_BYTES,
      trustedRoots
    );
    assertValidation(
      validateInspectionEvidenceEnvelopeSchema(loaded.document),
      'evidence_envelope_invalid',
      `${label} evidence envelope`
    );
    side.evidenceEnvelope = loaded.document;
    side.sources.inspection_evidence_envelope = loaded.source;
  }
  if (evidenceReceiptPath) {
    const loaded = await readStrictJson(
      projectRoot,
      evidenceReceiptPath,
      `${label} evidence receipt`,
      REVISION_IMPACT_MAX_JSON_BYTES,
      trustedRoots
    );
    assertValidation(
      validateInspectionEvidenceAttachmentRecordSchema(loaded.document),
      'evidence_receipt_invalid',
      `${label} evidence receipt`
    );
    side.evidenceReceipt = loaded.document;
    side.sources.inspection_evidence_attachment_record = loaded.source;
  }
  Object.entries(side.artifacts).forEach(([kind, loaded]) => {
    side.sources[kind] = loaded.source;
  });
  return side;
}

export async function loadRevisionImpactInputSet({
  projectRoot,
  baselineReviewPackPath,
  candidateReviewPackPath,
  baselineReadinessPath = null,
  candidateReadinessPath = null,
  baselineConfigPath = null,
  candidateConfigPath = null,
  baselineEvidenceEnvelopePath = null,
  candidateEvidenceEnvelopePath = null,
  baselineEvidenceReceiptPath = null,
  candidateEvidenceReceiptPath = null,
  trustedInputRoots = [],
} = {}) {
  const root = await resolveProjectRoot(projectRoot);
  const externalRoots = await resolveExistingTrustedRoots(trustedInputRoots, 'trusted input root');
  const inputRoots = [root, ...externalRoots];
  const [baseline, candidate] = await Promise.all([
    loadRevisionSide(root, 'baseline', {
      reviewPackPath: baselineReviewPackPath,
      readinessPath: baselineReadinessPath,
      configPath: baselineConfigPath,
      evidenceEnvelopePath: baselineEvidenceEnvelopePath,
      evidenceReceiptPath: baselineEvidenceReceiptPath,
    }, inputRoots),
    loadRevisionSide(root, 'candidate', {
      reviewPackPath: candidateReviewPackPath,
      readinessPath: candidateReadinessPath,
      configPath: candidateConfigPath,
      evidenceEnvelopePath: candidateEvidenceEnvelopePath,
      evidenceReceiptPath: candidateEvidenceReceiptPath,
    }, inputRoots),
  ]);
  return { baseline, candidate };
}

function canonicalValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) {
    return value.map(canonicalValue).sort((left, right) => (
      compareCodePoints(canonicalizeRevisionImpactJson(left), canonicalizeRevisionImpactJson(right))
    ));
  }
  const result = {};
  Object.keys(value).sort(compareCodePoints).forEach((key) => {
    if (!VOLATILE_KEYS.has(key) && value[key] !== undefined) result[key] = canonicalValue(value[key]);
  });
  return result;
}

function valuesEqual(left, right) {
  return canonicalizeRevisionImpactJson(canonicalValue(left))
    === canonicalizeRevisionImpactJson(canonicalValue(right));
}

function normalizeUnit(unit) {
  const text = textOrNull(unit)?.toLowerCase();
  return text ? UNIT_ALIASES.get(text) || null : null;
}

function convertUnitValue(value, unit) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const normalized = normalizeUnit(unit);
  if (!Number.isFinite(numeric) || !normalized) {
    return { value: canonicalValue(value), unit: textOrNull(unit), determinability: 'unable_to_determine' };
  }
  return {
    value: Object.is(numeric * normalized.factor, -0) ? 0 : numeric * normalized.factor,
    unit: normalized.unit,
    determinability: 'determined',
  };
}

function measurementFromObject(item) {
  if (Number.isFinite(item?.nominal_mm)) return convertUnitValue(item.nominal_mm, 'mm');
  if (Number.isFinite(item?.value_mm)) return convertUnitValue(item.value_mm, 'mm');
  if (item?.nominal_value !== undefined && item?.nominal_value !== null) {
    return convertUnitValue(item.nominal_value, item.unit);
  }
  if (item?.value !== undefined && item?.value !== null) return convertUnitValue(item.value, item.unit);
  return { value: null, unit: null, determinability: 'determined' };
}

function normalizeTolerance(value, inheritedUnit = null) {
  if (value === undefined || value === null || value === '') {
    return { value: null, determinability: 'determined' };
  }
  if (typeof value === 'number') {
    const converted = convertUnitValue(value, inheritedUnit);
    if (converted.determinability !== 'determined') return { value: canonicalValue(value), determinability: 'unable_to_determine' };
    return {
      value: { lower: -Math.abs(converted.value), upper: Math.abs(converted.value), unit: converted.unit },
      determinability: 'determined',
    };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const unit = value.unit || inheritedUnit;
    const lowerRaw = value.lower ?? value.lower_limit ?? value.minus;
    const upperRaw = value.upper ?? value.upper_limit ?? value.plus;
    if (lowerRaw !== undefined || upperRaw !== undefined) {
      const lower = lowerRaw === null || lowerRaw === undefined ? null : convertUnitValue(lowerRaw, unit);
      const upper = upperRaw === null || upperRaw === undefined ? null : convertUnitValue(upperRaw, unit);
      if (lower?.determinability === 'unable_to_determine' || upper?.determinability === 'unable_to_determine') {
        return { value: canonicalValue(value), determinability: 'unable_to_determine' };
      }
      return {
        value: { lower: lower?.value ?? null, upper: upper?.value ?? null, unit: lower?.unit || upper?.unit || normalizeUnit(unit)?.unit || null },
        determinability: 'determined',
      };
    }
    return { value: canonicalValue(value), determinability: 'unable_to_determine' };
  }
  if (typeof value === 'string') {
    const plusMinus = value.trim().match(/^\u00b1\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/);
    const asymmetric = value.trim().match(/^\+\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*-\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/);
    if (plusMinus) {
      const converted = convertUnitValue(Number(plusMinus[1]), plusMinus[2]);
      if (converted.determinability === 'determined') {
        return { value: { lower: -converted.value, upper: converted.value, unit: converted.unit }, determinability: 'determined' };
      }
    }
    if (asymmetric) {
      const upper = convertUnitValue(Number(asymmetric[1]), asymmetric[3]);
      const lower = convertUnitValue(Number(asymmetric[2]), asymmetric[3]);
      if (upper.determinability === 'determined' && lower.determinability === 'determined') {
        return { value: { lower: -lower.value, upper: upper.value, unit: upper.unit }, determinability: 'determined' };
      }
    }
  }
  return { value: canonicalValue(value), determinability: 'unable_to_determine' };
}

function toleranceDirection(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return 'unknown';
  if (before.unit !== after.unit || before.lower === null || before.upper === null
    || after.lower === null || after.upper === null) return 'unknown';
  if (after.lower >= before.lower && after.upper <= before.upper
    && (after.lower > before.lower || after.upper < before.upper)) return 'tightened';
  if (after.lower <= before.lower && after.upper >= before.upper
    && (after.lower < before.lower || after.upper > before.upper)) return 'loosened';
  return 'changed';
}

function sourceDocument(side, key) {
  if (key === 'review_pack') return side.reviewPack || side.review_pack || null;
  if (key === 'readiness_report') return side.readiness || side.readinessReport || side.readiness_report || null;
  if (key === 'config') return side.config || null;
  if (key === 'inspection_evidence_envelope') return side.evidenceEnvelope || side.evidence_envelope || null;
  if (key === 'inspection_evidence_attachment_record') return side.evidenceReceipt || side.evidence_receipt || null;
  const artifact = side.artifacts?.[key];
  return artifact?.document || artifact || side[key] || null;
}

function sourceMeta(side, key, document) {
  const meta = side.sources?.[key] || side.artifacts?.[key]?.source || null;
  const sha256 = textOrNull(meta?.sha256) || hashRevisionImpactValue(canonicalValue(document));
  const rawRef = textOrNull(meta?.ref || meta?.path);
  const safeLeaf = basename(rawRef || `${key}.json`).replace(/[^A-Za-z0-9._-]/g, '_') || `${key}.json`;
  const unsafe = !rawRef || isAbsolute(rawRef) || /^(?:local|output|tmp)\//i.test(rawRef)
    || rawRef.includes('\\') || rawRef.split('/').includes('..');
  return {
    ref: unsafe ? `input/${sha256.slice(0, 16)}/${safeLeaf}` : rawRef,
    sha256,
  };
}

function collectExplicitValues(values) {
  return uniqueSorted(values.map(textOrNull).filter(Boolean));
}

function normalizeSide(side) {
  const reviewPack = sourceDocument(side, 'review_pack') || {};
  const readiness = sourceDocument(side, 'readiness_report');
  const config = sourceDocument(side, 'config');
  const envelope = sourceDocument(side, 'inspection_evidence_envelope');
  const receipt = sourceDocument(side, 'inspection_evidence_attachment_record');
  const drawingIntentArtifact = sourceDocument(side, 'drawing_intent');
  const drawingIntent = drawingIntentArtifact || config?.drawing_intent || null;
  const sourceDocuments = {
    review_pack: reviewPack,
    ...(readiness ? { readiness_report: readiness } : {}),
    ...(config ? { config } : {}),
    ...(envelope ? { inspection_evidence_envelope: envelope } : {}),
    ...(receipt ? { inspection_evidence_attachment_record: receipt } : {}),
  };
  Object.keys(side.artifacts || {}).sort(compareCodePoints).forEach((key) => {
    const document = sourceDocument(side, key);
    if (document) sourceDocuments[key] = document;
  });
  if (drawingIntent && !sourceDocuments.drawing_intent) sourceDocuments.drawing_intent = drawingIntent;
  const sources = {};
  Object.entries(sourceDocuments).forEach(([key, document]) => { sources[key] = sourceMeta(side, key, document); });

  const slugValues = collectExplicitValues([
    side.packageSlug,
    reviewPack.package_slug,
    reviewPack.package?.slug,
    reviewPack.metadata?.package_slug,
    reviewPack.metadata?.package?.slug,
    readiness?.package_slug,
    readiness?.metadata?.package_slug,
    config?.package_slug,
    config?.package?.slug,
    envelope?.package?.slug,
    receipt?.package_slug,
  ]);
  const revisionValues = collectExplicitValues([
    side.revision,
    reviewPack.revision,
    reviewPack.part?.revision,
    readiness?.revision,
    readiness?.part?.revision,
    config?.revision,
    config?.package?.revision,
    envelope?.package?.revision,
    receipt?.package_revision,
  ]);
  const partValues = collectExplicitValues([
    side.partId,
    reviewPack.part_id,
    reviewPack.part?.part_id,
    readiness?.part?.part_id,
    config?.part_id,
    config?.part?.part_id,
  ]);
  const materialValues = collectExplicitValues([
    reviewPack.part?.material,
    readiness?.part?.material,
    config?.material,
    config?.manufacturing?.material,
    drawingIntent?.material,
  ]);
  const processValues = collectExplicitValues([
    reviewPack.part?.process,
    readiness?.part?.process,
    config?.process,
    config?.manufacturing?.process,
    drawingIntent?.manufacturing_process,
  ]);

  return {
    raw: side,
    reviewPack,
    readiness,
    config,
    envelope,
    receipt,
    drawingIntent,
    featureCatalog: sourceDocument(side, 'feature_catalog'),
    sources,
    packageSlug: slugValues.length === 1 ? slugValues[0] : null,
    revision: revisionValues.length === 1 ? revisionValues[0] : null,
    partId: partValues.length === 1 ? partValues[0] : null,
    material: materialValues.length === 1 ? materialValues[0] : null,
    process: processValues.length === 1 ? processValues[0] : null,
    conflicts: {
      package_slug: slugValues.length > 1 ? slugValues : [],
      revision: revisionValues.length > 1 ? revisionValues : [],
      part_id: partValues.length > 1 ? partValues : [],
      material: materialValues.length > 1 ? materialValues : [],
      process: processValues.length > 1 ? processValues : [],
    },
  };
}

function addStableRecord(map, missing, id, value, sourceKey, kind) {
  const normalizedId = textOrNull(id);
  if (!normalizedId) {
    missing.push({ kind, value: canonicalValue(value), sourceKey });
    return;
  }
  if (map.has(normalizedId)) {
    throw serviceError('duplicate_stable_id', `Duplicate ${kind} stable ID: ${normalizedId}`);
  }
  map.set(normalizedId, { id: normalizedId, value: canonicalValue(value), sourceKey });
}

function normalizeDimensions(dimensions) {
  const result = {};
  Object.entries(asObject(dimensions)).sort(([left], [right]) => compareCodePoints(left, right)).forEach(([key, value]) => {
    const match = key.match(/_(mm|in|deg)$/i);
    if (match && typeof value === 'number') {
      const converted = convertUnitValue(value, match[1]);
      result[key.replace(/_(?:mm|in)$/i, '_mm').replace(/_deg$/i, '_deg')] = converted.value;
    } else {
      result[key] = canonicalValue(value);
    }
  });
  return result;
}

function collectFeatures(side) {
  const map = new Map();
  const missing = [];
  if (side.featureCatalog) {
    asArray(side.featureCatalog.features).forEach((feature) => addStableRecord(map, missing, feature?.feature_id, {
      type: feature?.type ?? null,
      critical: feature?.critical === true,
      dimensions: normalizeDimensions(feature?.dimensions),
    }, 'feature_catalog', 'feature'));
  } else {
    asArray(side.config?.shapes).forEach((shape) => addStableRecord(map, missing, shape?.id, {
      type: shape?.type ?? null,
      dimensions: normalizeDimensions(shape),
    }, 'config', 'feature'));
  }
  asArray(side.reviewPack?.geometry_features?.records).forEach((feature) => addStableRecord(map, missing, feature?.feature_id, {
    type: feature?.feature_type ?? null,
    region_ref: feature?.region_ref ?? null,
    details: feature?.details ?? null,
  }, 'review_pack', 'geometry feature'));
  return { map, missing };
}

function collectCharacteristics(side) {
  const map = new Map();
  const missing = [];
  asArray(side.drawingIntent?.required_dimensions).forEach((item) => {
    const nominal = measurementFromObject(item);
    const tolerance = normalizeTolerance(item?.tolerance, nominal.unit);
    addStableRecord(map, missing, item?.id || item?.characteristic_id || item?.requirement_id, {
      feature_id: textOrNull(item?.feature || item?.feature_id),
      nominal: nominal.value,
      unit: nominal.unit,
      nominal_determinability: nominal.determinability,
      tolerance: tolerance.value,
      tolerance_determinability: tolerance.determinability,
      datum: canonicalValue(item?.datum || item?.reference || null),
      specification_ref: textOrNull(item?.specification_ref || item?.spec_ref),
      inspection_method: textOrNull(item?.inspection_method || item?.method),
      required: item?.required !== false,
      process_sensitive: item?.process_sensitive === true,
      label: textOrNull(item?.label),
      view: textOrNull(item?.view),
    }, side.sources.drawing_intent ? 'drawing_intent' : 'config', 'characteristic');
  });
  return { map, missing };
}

function collectQualityGates(side) {
  const map = new Map();
  const missing = [];
  const risk = side.readiness?.quality_risk || sourceDocument(side.raw, 'quality_risk');
  asArray(risk?.quality_gates).forEach((gate) => addStableRecord(
    map,
    missing,
    gate?.gate_id || gate?.id,
    gate,
    side.sources.quality_risk ? 'quality_risk' : 'readiness_report',
    'quality gate'
  ));
  return { map, missing };
}

function sourceFor(side, key) {
  return side.sources[key] || side.sources.review_pack;
}

function createChange(changes, impactById, baseline, candidate, {
  type,
  entityId,
  before,
  after,
  baselineSourceKey = 'review_pack',
  candidateSourceKey = 'review_pack',
  unit = null,
  determinability = 'determined',
  rationale,
  severity = 'medium',
  requiredAction = 'human_review',
  impactStatus = 'review_required',
}) {
  if (valuesEqual(before, after)) return null;
  const baselineSource = baselineSourceKey ? sourceFor(baseline, baselineSourceKey) : null;
  const candidateSource = candidateSourceKey ? sourceFor(candidate, candidateSourceKey) : null;
  const basis = {
    type,
    entity_id: entityId,
    before: canonicalValue(before),
    after: canonicalValue(after),
    unit,
    determinability,
  };
  const change = {
    change_id: buildRevisionImpactStableId('change', basis),
    change_type: type,
    affected_entity_id: entityId,
    baseline_source_ref: baselineSource?.ref || null,
    candidate_source_ref: candidateSource?.ref || null,
    before_value: canonicalValue(before),
    after_value: canonicalValue(after),
    unit,
    determinability,
    rationale,
    severity,
    required_action: requiredAction,
    source_hashes: {
      baseline: baselineSource?.sha256 || null,
      candidate: candidateSource?.sha256 || null,
    },
  };
  changes.push(change);
  impactById.set(change.change_id, { status: impactStatus, type, entityId });
  return change;
}

function addIdentityGap(changes, impactById, baseline, candidate, field, before, after, message) {
  return createChange(changes, impactById, baseline, candidate, {
    type: 'unresolved_identity_change',
    entityId: null,
    before: { [`baseline_${field}`]: before },
    after: { [`candidate_${field}`]: after },
    determinability: 'unable_to_determine',
    rationale: message,
    severity: 'blocking',
    requiredAction: 'resolve_identity_or_inputs',
    impactStatus: 'unable_to_determine',
  });
}

function compareRecordMaps(changes, impactById, baseline, candidate, baselineRecords, candidateRecords, {
  addedType,
  removedType,
  modifiedType,
  label,
}) {
  const ids = uniqueSorted([...baselineRecords.map.keys(), ...candidateRecords.map.keys()]);
  ids.forEach((id) => {
    const before = baselineRecords.map.get(id);
    const after = candidateRecords.map.get(id);
    if (!before) {
      createChange(changes, impactById, baseline, candidate, {
        type: addedType,
        entityId: id,
        before: null,
        after: after.value,
        baselineSourceKey: null,
        candidateSourceKey: after.sourceKey,
        rationale: `${label} ${id} was added with explicit stable identity.`,
        severity: 'high',
        requiredAction: REINSPECTION_CHANGE_TYPES.has(addedType) ? 'reinspect' : 'human_review',
        impactStatus: REINSPECTION_CHANGE_TYPES.has(addedType) ? 'reinspection_required' : 'review_required',
      });
    } else if (!after) {
      createChange(changes, impactById, baseline, candidate, {
        type: removedType,
        entityId: id,
        before: before.value,
        after: null,
        baselineSourceKey: before.sourceKey,
        candidateSourceKey: null,
        rationale: `${label} ${id} was removed; existing records remain immutable and require review.`,
        severity: 'high',
        requiredAction: 'human_review',
        impactStatus: 'review_required',
      });
    } else if (!valuesEqual(before.value, after.value)) {
      createChange(changes, impactById, baseline, candidate, {
        type: modifiedType,
        entityId: id,
        before: before.value,
        after: after.value,
        baselineSourceKey: before.sourceKey,
        candidateSourceKey: after.sourceKey,
        rationale: `${label} ${id} changed under the same explicit stable identity.`,
        severity: 'high',
        requiredAction: REINSPECTION_CHANGE_TYPES.has(modifiedType) ? 'reinspect' : 'human_review',
        impactStatus: REINSPECTION_CHANGE_TYPES.has(modifiedType) ? 'reinspection_required' : 'review_required',
      });
    }
  });
}

function compareCharacteristics(changes, impactById, baseline, candidate, baselineChars, candidateChars) {
  const ids = uniqueSorted([...baselineChars.map.keys(), ...candidateChars.map.keys()]);
  ids.forEach((id) => {
    const before = baselineChars.map.get(id);
    const after = candidateChars.map.get(id);
    if (!before || !after) {
      createChange(changes, impactById, baseline, candidate, {
        type: 'critical_characteristic_change',
        entityId: id,
        before: before?.value || null,
        after: after?.value || null,
        baselineSourceKey: before?.sourceKey || null,
        candidateSourceKey: after?.sourceKey || null,
        rationale: before
          ? `Required characteristic ${id} was removed and its prior evidence must not be deleted or superseded.`
          : `Required characteristic ${id} was added and requires future inspection evidence.`,
        severity: 'high',
        requiredAction: before ? 'human_review' : 'reinspect',
        impactStatus: before ? 'review_required' : 'reinspection_required',
      });
      return;
    }
    const left = before.value;
    const right = after.value;
    if (!valuesEqual(left.nominal, right.nominal) || left.unit !== right.unit) {
      const determined = left.nominal_determinability === 'determined'
        && right.nominal_determinability === 'determined' && left.unit === right.unit;
      createChange(changes, impactById, baseline, candidate, {
        type: 'nominal_dimension_change',
        entityId: id,
        before: left.nominal,
        after: right.nominal,
        baselineSourceKey: before.sourceKey,
        candidateSourceKey: after.sourceKey,
        unit: determined ? right.unit : null,
        determinability: determined ? 'determined' : 'unable_to_determine',
        rationale: determined
          ? `Characteristic ${id} has an exact normalized nominal change.`
          : `Characteristic ${id} uses an unsupported or ambiguous unit and cannot be compared safely.`,
        severity: determined ? 'high' : 'blocking',
        requiredAction: determined ? 'reinspect' : 'resolve_identity_or_inputs',
        impactStatus: determined ? 'reinspection_required' : 'unable_to_determine',
      });
    }
    if (!valuesEqual(left.tolerance, right.tolerance)) {
      const determined = left.tolerance_determinability === 'determined'
        && right.tolerance_determinability === 'determined';
      const direction = determined ? toleranceDirection(left.tolerance, right.tolerance) : 'unknown';
      const tightened = direction === 'tightened';
      const loosened = direction === 'loosened';
      createChange(changes, impactById, baseline, candidate, {
        type: 'tolerance_change',
        entityId: id,
        before: left.tolerance,
        after: right.tolerance,
        baselineSourceKey: before.sourceKey,
        candidateSourceKey: after.sourceKey,
        unit: determined ? (right.tolerance?.unit || left.tolerance?.unit || null) : null,
        determinability: determined ? 'determined' : 'unable_to_determine',
        rationale: tightened
          ? `Characteristic ${id} tolerance was tightened; previous results are not automatically applicable.`
          : loosened
            ? `Characteristic ${id} tolerance was loosened; prior evidence still requires human review.`
            : determined
              ? `Characteristic ${id} tolerance changed and requires future inspection.`
              : `Characteristic ${id} tolerance uses unsupported or ambiguous units.`,
        severity: determined ? 'high' : 'blocking',
        requiredAction: !determined ? 'resolve_identity_or_inputs' : loosened ? 'human_review' : 'reinspect',
        impactStatus: !determined ? 'unable_to_determine' : loosened ? 'review_required' : 'reinspection_required',
      });
    }
    const fieldRules = [
      ['datum', 'datum_or_reference_change', 'reinspect', 'reinspection_required'],
      ['specification_ref', 'specification_reference_change', 'human_review', 'potentially_stale'],
      ['inspection_method', 'inspection_method_requirement_change', 'reinspect', 'reinspection_required'],
    ];
    fieldRules.forEach(([field, type, requiredAction, impactStatus]) => {
      if (!valuesEqual(left[field], right[field])) {
        createChange(changes, impactById, baseline, candidate, {
          type,
          entityId: id,
          before: left[field],
          after: right[field],
          baselineSourceKey: before.sourceKey,
          candidateSourceKey: after.sourceKey,
          rationale: `Characteristic ${id} ${field.replaceAll('_', ' ')} changed explicitly.`,
          severity: 'high',
          requiredAction,
          impactStatus,
        });
      }
    });
    const drawingBefore = { feature_id: left.feature_id, required: left.required, label: left.label, view: left.view };
    const drawingAfter = { feature_id: right.feature_id, required: right.required, label: right.label, view: right.view };
    if (!valuesEqual(drawingBefore, drawingAfter)) {
      createChange(changes, impactById, baseline, candidate, {
        type: 'drawing_requirement_change',
        entityId: id,
        before: drawingBefore,
        after: drawingAfter,
        baselineSourceKey: before.sourceKey,
        candidateSourceKey: after.sourceKey,
        rationale: `Drawing requirement ${id} changed under explicit identity.`,
        severity: 'medium',
        requiredAction: 'human_review',
        impactStatus: 'review_required',
      });
    }
  });
}

function receiptBindingProblems(side) {
  if (!side.receipt) return [];
  const problems = [];
  const envelope = side.envelope;
  const receipt = side.receipt;
  if (side.packageSlug && receipt.package_slug !== side.packageSlug) problems.push('receipt package slug');
  if (side.revision && receipt.package_revision !== side.revision) problems.push('receipt package revision');
  if (envelope) {
    if (receipt.evidence_id !== envelope.evidence_id) problems.push('receipt evidence ID');
    if (receipt.source_document_sha256 !== envelope.source?.document?.sha256) problems.push('source document checksum');
    if (receipt.package_slug !== envelope.package?.slug) problems.push('envelope package slug');
    if (receipt.package_revision !== envelope.package?.revision) problems.push('envelope package revision');
    const canonicalEnvelope = asArray(receipt.resulting_canonical_artifacts)
      .find((entry) => entry?.role === 'evidence_envelope');
    if (canonicalEnvelope && canonicalEnvelope.sha256 !== side.sources.inspection_evidence_envelope?.sha256) {
      problems.push('canonical envelope checksum');
    }
  }
  return uniqueSorted(problems);
}

function evidenceSignature(side) {
  if (!side.envelope && !side.receipt) return null;
  return {
    evidence_id: side.envelope?.evidence_id || side.receipt?.evidence_id || null,
    source_sha256: side.envelope?.source?.document?.sha256 || side.receipt?.source_document_sha256 || null,
    envelope_sha256: side.sources.inspection_evidence_envelope?.sha256 || null,
    receipt_sha256: side.sources.inspection_evidence_attachment_record?.sha256 || null,
  };
}

function assessmentStatusForChanges(changeIds, impactById) {
  const statuses = changeIds.map((id) => impactById.get(id)?.status).filter(Boolean);
  if (statuses.includes('unable_to_determine')) return 'unable_to_determine';
  if (statuses.includes('reinspection_required')) return 'reinspection_required';
  if (statuses.includes('potentially_stale')) return 'potentially_stale';
  if (statuses.includes('review_required')) return 'review_required';
  return 'unaffected';
}

function makeAssessment(baseline, candidate, id, relatedChangeIds, status, sourceRef = null) {
  const human = !['unaffected', 'not_applicable'].includes(status);
  const actionByStatus = {
    review_required: 'Review prior inspection applicability before any later readiness action.',
    reinspection_required: 'Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow.',
    potentially_stale: 'Review source, specification, and receipt bindings before relying on prior evidence.',
    unable_to_determine: 'Resolve stable identity or source-binding gaps before deciding evidence applicability.',
  };
  const assessment = {
    assessment_id: buildRevisionImpactStableId('assessment', {
      evidence_or_characteristic_id: id,
      baseline_revision: baseline.revision,
      candidate_revision: candidate.revision,
      related_change_ids: relatedChangeIds,
      status,
    }),
    evidence_or_characteristic_id: id,
    source_envelope_or_receipt_ref: sourceRef,
    baseline_package_revision: baseline.revision,
    candidate_package_revision: candidate.revision,
    related_change_ids: uniqueSorted(relatedChangeIds),
    applicability_status: status,
    rationale: status === 'unaffected'
      ? 'No normalized engineering change is linked to this stable characteristic.'
      : status === 'not_applicable'
        ? 'Synthetic, generated, fixture, or control material is never trusted inspection evidence.'
        : 'Applicability follows the explicit normalized changes linked to this stable characteristic.',
    reinspection_action: human ? actionByStatus[status] : null,
    human_decision_required: human,
    authoritative_evidence_state_changed: false,
  };
  return assessment;
}

function buildAssessments(baseline, candidate, changes, impactById, candidateCharacteristics, bindingIssues) {
  const assessments = new Map();
  const envelopeRef = baseline.sources.inspection_evidence_attachment_record?.ref
    || baseline.sources.inspection_evidence_envelope?.ref || null;
  const untrustedEnvelope = baseline.envelope && (
    baseline.envelope.synthetic !== false
    || findNonGenuineStringMarkers(baseline.envelope).length > 0
  );
  asArray(baseline.envelope?.measured_characteristics).forEach((characteristic) => {
    const id = textOrNull(characteristic?.characteristic_id);
    if (!id) throw serviceError('missing_characteristic_id', 'Evidence characteristic requires a stable characteristic_id');
    if (assessments.has(id)) throw serviceError('duplicate_characteristic_id', `Duplicate evidence characteristic ID: ${id}`);
    const related = changes.filter((change) => (
      change.affected_entity_id === id
      || change.affected_entity_id === characteristic?.specification_ref
      || (['material_change', 'manufacturing_process_change'].includes(change.change_type)
        && candidateCharacteristics.map.get(id)?.value?.process_sensitive === true)
      || (change.change_type === 'unresolved_identity_change' && change.severity === 'blocking')
    )).map((change) => change.change_id);
    const status = untrustedEnvelope
      ? 'not_applicable'
      : bindingIssues.length > 0
        ? 'unable_to_determine'
        : assessmentStatusForChanges(related, impactById);
    assessments.set(id, makeAssessment(baseline, candidate, id, related, status, envelopeRef));
  });

  for (const [id] of candidateCharacteristics.map) {
    if (assessments.has(id)) continue;
    const related = changes.filter((change) => change.affected_entity_id === id).map((change) => change.change_id);
    if (related.length === 0) continue;
    assessments.set(id, makeAssessment(
      baseline,
      candidate,
      id,
      related,
      assessmentStatusForChanges(related, impactById),
      null
    ));
  }

  const revisionOnly = changes.filter((change) => change.change_type === 'revision_identity_change');
  const engineeringChanges = changes.filter((change) => !NON_ENGINEERING_CHANGE_TYPES.has(change.change_type));
  if (revisionOnly.length > 0 && engineeringChanges.length === 0) {
    const id = 'revision_provenance';
    assessments.set(id, makeAssessment(
      baseline,
      candidate,
      id,
      revisionOnly.map((change) => change.change_id),
      'review_required',
      null
    ));
  }
  const identityChanges = changes.filter((change) => change.change_type === 'unresolved_identity_change');
  if (identityChanges.length > 0 && !assessments.has('identity_resolution')) {
    assessments.set('identity_resolution', makeAssessment(
      baseline,
      candidate,
      'identity_resolution',
      identityChanges.map((change) => change.change_id),
      'unable_to_determine',
      null
    ));
  }
  return [...assessments.values()].sort((left, right) => compareCodePoints(left.assessment_id, right.assessment_id));
}

function buildPlan(baseline, candidate, changes, assessments, impactById, candidateCharacteristics, blocked) {
  const targets = new Map();
  assessments.filter((assessment) => assessment.applicability_status === 'reinspection_required').forEach((assessment) => {
    targets.set(assessment.evidence_or_characteristic_id, assessment.related_change_ids);
  });
  changes.forEach((change) => {
    if (impactById.get(change.change_id)?.status !== 'reinspection_required') return;
    const id = change.affected_entity_id;
    if (!id) return;
    targets.set(id, uniqueSorted([...(targets.get(id) || []), change.change_id]));
  });
  const items = [];
  for (const [id, relatedChangeIds] of targets) {
    const characteristic = candidateCharacteristics.map.get(id)?.value || null;
    const relatedChanges = changes.filter((change) => relatedChangeIds.includes(change.change_id));
    const refs = uniqueSorted(relatedChanges.flatMap((change) => (
      [change.baseline_source_ref, change.candidate_source_ref].filter(Boolean)
    )));
    const item = {
      plan_item_id: buildRevisionImpactStableId('plan', {
        package_slug: candidate.packageSlug,
        candidate_revision: candidate.revision,
        affected_entity_id: id,
        related_change_ids: uniqueSorted(relatedChangeIds),
        specification_ref: characteristic?.specification_ref || null,
        suggested_method: characteristic?.inspection_method || null,
      }),
      package_slug: candidate.packageSlug,
      candidate_revision: candidate.revision,
      affected_entity_id: id,
      related_change_ids: uniqueSorted(relatedChangeIds),
      nominal_value: characteristic?.nominal ?? null,
      tolerance: characteristic?.tolerance && characteristic.tolerance_determinability === 'determined'
        ? characteristic.tolerance
        : null,
      specification_ref: characteristic?.specification_ref || null,
      recommended_inspection_scope: `Reinspect stable characteristic or feature ${id} for the candidate revision.`,
      suggested_method: characteristic?.inspection_method || null,
      required_evidence_fields: ['characteristic_id', 'measured_value', 'result', 'source_document_sha256', 'unit'],
      reason: 'One or more determined engineering changes require future reinspection; this item is not completed evidence.',
      source_artifact_refs: refs,
      human_reviewer_required: true,
      attachment_authorization_required: true,
      readiness_regeneration_required_later: true,
      execution_status: 'not_started',
    };
    items.push(item);
  }
  items.sort((left, right) => compareCodePoints(left.plan_item_id, right.plan_item_id));
  const hasReview = assessments.some((entry) => !['unaffected', 'not_applicable'].includes(entry.applicability_status))
    || changes.some((change) => change.required_action === 'human_review');
  return {
    status: blocked ? 'blocked' : items.length > 0 ? 'planned' : hasReview ? 'review_required' : 'not_required',
    items,
    human_authorization_required: true,
  };
}

function reportSide(side) {
  const sourceKeys = Object.keys(side.sources).sort(compareCodePoints);
  return {
    package_slug: side.packageSlug,
    revision: side.revision,
    artifact_refs: uniqueSorted(sourceKeys.map((key) => side.sources[key].ref)),
    source_hashes: Object.fromEntries(sourceKeys.map((key) => [key, side.sources[key].sha256])),
  };
}

export function buildRevisionImpactReport({ baseline, candidate, generatedAt } = {}) {
  if (!baseline || !candidate) throw serviceError('revision_inputs_required', 'Baseline and candidate inputs are required');
  if (!isParseableTimestamp(generatedAt)) {
    throw serviceError('generated_at_required', 'generatedAt must be an injected RFC 3339 timestamp');
  }
  const left = normalizeSide(baseline);
  const right = normalizeSide(candidate);
  if (left.packageSlug && right.packageSlug && left.packageSlug !== right.packageSlug) {
    throw serviceError('package_mismatch', 'Baseline and candidate package slugs must match');
  }
  const changes = [];
  const impactById = new Map();

  if (!left.packageSlug || !right.packageSlug) {
    addIdentityGap(changes, impactById, left, right, 'package_slug', left.packageSlug, right.packageSlug,
      'Explicit package slug metadata is required; package identity is never inferred from part_id or name.');
  }
  if (!left.revision || !right.revision) {
    addIdentityGap(changes, impactById, left, right, 'revision', left.revision, right.revision,
      'Explicit baseline and candidate revision identifiers are required and are never invented.');
  }
  if (!left.partId || !right.partId || left.partId !== right.partId) {
    addIdentityGap(changes, impactById, left, right, 'part_id', left.partId, right.partId,
      'Matching explicit part identity is required for authoritative impact analysis.');
  }
  for (const [field, values] of Object.entries(left.conflicts)) {
    if (values.length > 0) addIdentityGap(changes, impactById, left, right, field, values, null,
      `Baseline ${field} metadata is internally inconsistent.`);
  }
  for (const [field, values] of Object.entries(right.conflicts)) {
    if (values.length > 0) addIdentityGap(changes, impactById, left, right, field, null, values,
      `Candidate ${field} metadata is internally inconsistent.`);
  }

  if (left.revision && right.revision && left.revision !== right.revision) {
    createChange(changes, impactById, left, right, {
      type: 'revision_identity_change',
      entityId: 'package:revision',
      before: left.revision,
      after: right.revision,
      rationale: 'The explicit package revision identifier changed.',
      severity: 'informational',
      requiredAction: 'human_review',
      impactStatus: 'review_required',
    });
  }
  if (!valuesEqual(left.reviewPack?.part?.description, right.reviewPack?.part?.description)) {
    createChange(changes, impactById, left, right, {
      type: 'metadata_change',
      entityId: 'part:description',
      before: left.reviewPack?.part?.description ?? null,
      after: right.reviewPack?.part?.description ?? null,
      rationale: 'Part description metadata changed without itself requiring reinspection.',
      severity: 'informational',
      requiredAction: 'none',
      impactStatus: 'unaffected',
    });
  }
  if (!valuesEqual(left.material, right.material)) {
    createChange(changes, impactById, left, right, {
      type: 'material_change',
      entityId: 'package:material',
      before: left.material,
      after: right.material,
      determinability: left.material && right.material ? 'determined' : 'unable_to_determine',
      rationale: 'Explicit material metadata changed and process-sensitive inspection requirements require review.',
      severity: left.material && right.material ? 'high' : 'blocking',
      requiredAction: left.material && right.material ? 'human_review' : 'resolve_identity_or_inputs',
      impactStatus: left.material && right.material ? 'review_required' : 'unable_to_determine',
    });
  }
  if (!valuesEqual(left.process, right.process)) {
    createChange(changes, impactById, left, right, {
      type: 'manufacturing_process_change',
      entityId: 'package:manufacturing_process',
      before: left.process,
      after: right.process,
      determinability: left.process && right.process ? 'determined' : 'unable_to_determine',
      rationale: 'Explicit manufacturing process metadata changed and process-sensitive characteristics require review.',
      severity: left.process && right.process ? 'high' : 'blocking',
      requiredAction: left.process && right.process ? 'human_review' : 'resolve_identity_or_inputs',
      impactStatus: left.process && right.process ? 'review_required' : 'unable_to_determine',
    });
  }

  const leftFeatures = collectFeatures(left);
  const rightFeatures = collectFeatures(right);
  compareRecordMaps(changes, impactById, left, right, leftFeatures, rightFeatures, {
    addedType: 'geometry_feature_added',
    removedType: 'geometry_feature_removed',
    modifiedType: 'geometry_feature_modified',
    label: 'Geometry feature',
  });
  const leftChars = collectCharacteristics(left);
  const rightChars = collectCharacteristics(right);
  compareCharacteristics(changes, impactById, left, right, leftChars, rightChars);
  const unsupportedBaselineCharacteristics = [...leftChars.map.values()]
    .filter((entry) => entry.value.nominal_determinability === 'unable_to_determine'
      || entry.value.tolerance_determinability === 'unable_to_determine')
    .map((entry) => entry.id)
    .sort(compareCodePoints);
  const unsupportedCandidateCharacteristics = [...rightChars.map.values()]
    .filter((entry) => entry.value.nominal_determinability === 'unable_to_determine'
      || entry.value.tolerance_determinability === 'unable_to_determine')
    .map((entry) => entry.id)
    .sort(compareCodePoints);
  if (unsupportedBaselineCharacteristics.length > 0 || unsupportedCandidateCharacteristics.length > 0) {
    addIdentityGap(
      changes,
      impactById,
      left,
      right,
      'supported_characteristic_units',
      { baseline_characteristic_ids: unsupportedBaselineCharacteristics },
      { candidate_characteristic_ids: unsupportedCandidateCharacteristics },
      'Unsupported or ambiguous characteristic units prevent an exact deterministic comparison.'
    );
  }
  const leftGates = collectQualityGates(left);
  const rightGates = collectQualityGates(right);
  compareRecordMaps(changes, impactById, left, right, leftGates, rightGates, {
    addedType: 'quality_gate_change',
    removedType: 'quality_gate_change',
    modifiedType: 'quality_gate_change',
    label: 'Quality gate',
  });

  const missingStable = [
    ...leftFeatures.missing, ...rightFeatures.missing,
    ...leftChars.missing, ...rightChars.missing,
    ...leftGates.missing, ...rightGates.missing,
  ];
  if (missingStable.length > 0) {
    addIdentityGap(changes, impactById, left, right, 'stable_entity_identity',
      { baseline_missing_count: leftFeatures.missing.length + leftChars.missing.length + leftGates.missing.length },
      { candidate_missing_count: rightFeatures.missing.length + rightChars.missing.length + rightGates.missing.length },
      'One or more compared engineering entities lack stable identity; array position is never used as identity.');
  }

  const drawingFields = [
    ['datum_strategy', 'datum_or_reference_change'],
    ['required_notes', 'drawing_requirement_change'],
    ['required_views', 'drawing_requirement_change'],
    ['drawing_standard', 'specification_reference_change'],
    ['tolerance_policy', 'drawing_requirement_change'],
  ];
  drawingFields.forEach(([field, type]) => {
    const before = canonicalValue(left.drawingIntent?.[field] ?? null);
    const after = canonicalValue(right.drawingIntent?.[field] ?? null);
    if (!valuesEqual(before, after)) {
      createChange(changes, impactById, left, right, {
        type,
        entityId: `drawing:${field}`,
        before,
        after,
        baselineSourceKey: left.sources.drawing_intent ? 'drawing_intent' : 'config',
        candidateSourceKey: right.sources.drawing_intent ? 'drawing_intent' : 'config',
        rationale: `Explicit drawing ${field.replaceAll('_', ' ')} changed.`,
        severity: 'high',
        requiredAction: type === 'datum_or_reference_change' ? 'reinspect' : 'human_review',
        impactStatus: type === 'datum_or_reference_change' ? 'reinspection_required' : 'review_required',
      });
    }
  });

  const leftEvidence = evidenceSignature(left);
  const rightEvidence = evidenceSignature(right);
  if (!valuesEqual(leftEvidence, rightEvidence)) {
    createChange(changes, impactById, left, right, {
      type: 'evidence_reference_change',
      entityId: leftEvidence?.evidence_id || rightEvidence?.evidence_id || 'inspection:evidence_reference',
      before: leftEvidence,
      after: rightEvidence,
      baselineSourceKey: leftEvidence ? (left.sources.inspection_evidence_attachment_record ? 'inspection_evidence_attachment_record' : 'inspection_evidence_envelope') : null,
      candidateSourceKey: rightEvidence ? (right.sources.inspection_evidence_attachment_record ? 'inspection_evidence_attachment_record' : 'inspection_evidence_envelope') : null,
      rationale: 'Inspection evidence references or immutable source hashes changed and require applicability review.',
      severity: 'high',
      requiredAction: 'human_review',
      impactStatus: 'potentially_stale',
    });
  }
  const bindingIssues = [...receiptBindingProblems(left), ...receiptBindingProblems(right)];
  if (bindingIssues.length > 0) {
    createChange(changes, impactById, left, right, {
      type: 'evidence_reference_change',
      entityId: 'inspection:receipt_binding',
      before: { binding_state: 'declared' },
      after: { binding_state: 'mismatch', fields: bindingIssues },
      determinability: 'unable_to_determine',
      rationale: 'Envelope or receipt identity/checksum binding does not match declared revision evidence.',
      severity: 'blocking',
      requiredAction: 'resolve_identity_or_inputs',
      impactStatus: 'unable_to_determine',
    });
  }

  const governedChanges = changes.filter((change) => !NON_ENGINEERING_CHANGE_TYPES.has(change.change_type));
  if (left.revision && right.revision && left.revision === right.revision && governedChanges.length > 0) {
    createChange(changes, impactById, left, right, {
      type: 'unresolved_identity_change',
      entityId: 'package:revision_governance',
      before: { revision: left.revision, normalized_engineering_change: false },
      after: { revision: right.revision, normalized_engineering_change: true },
      rationale: 'Normalized engineering content changed without an explicit revision increment.',
      severity: 'blocking',
      requiredAction: 'resolve_identity_or_inputs',
      determinability: 'unable_to_determine',
      impactStatus: 'unable_to_determine',
    });
  }
  changes.sort((first, second) => compareCodePoints(first.change_id, second.change_id));
  const blocked = changes.some((change) => change.severity === 'blocking' || change.determinability === 'unable_to_determine');
  const assessments = buildAssessments(left, right, changes, impactById, rightChars, bindingIssues);
  const plan = buildPlan(left, right, changes, assessments, impactById, rightChars, blocked);
  const reviewRequiredCount = changes.filter((change) => change.required_action === 'human_review').length
    + assessments.filter((assessment) => ['review_required', 'potentially_stale'].includes(assessment.applicability_status)).length;
  const unableCount = changes.filter((change) => change.determinability === 'unable_to_determine').length
    + assessments.filter((assessment) => assessment.applicability_status === 'unable_to_determine').length;
  const materialCount = changes.filter((change) => !['metadata_change', 'revision_identity_change'].includes(change.change_type)).length;
  const decision = blocked
    ? 'blocked_insufficient_identity_or_inputs'
    : plan.items.length > 0
      ? 'reinspection_required'
      : reviewRequiredCount > 0
        ? 'review_required'
        : 'no_material_change';
  if (blocked) plan.status = 'blocked';

  const report = {
    artifact_type: 'revision_impact_report',
    schema_version: REVISION_IMPACT_SCHEMA_VERSION,
    generated_at: generatedAt,
    baseline: reportSide(left),
    candidate: reportSide(right),
    summary: {
      decision,
      material_change_count: materialCount,
      review_required_count: reviewRequiredCount,
      reinspection_required_count: plan.items.length,
      unable_to_determine_count: unableCount,
      readiness_review_required: decision !== 'no_material_change',
    },
    changes,
    evidence_applicability: {
      assessments,
      authoritative_evidence_state_changed: false,
    },
    reinspection_plan: plan,
    boundaries: {
      generated_review_artifact: true,
      inspection_evidence_attached: false,
      existing_evidence_mutated: false,
      evidence_superseded: false,
      readiness_regenerated: false,
      canonical_artifacts_mutated: false,
      release_published: false,
      measured_values_generated: false,
    },
  };
  return assertValidRevisionImpactReport(report, { context: 'revision-impact service' });
}

function isCanonicalOutputPath(projectRoot, absolute) {
  const rel = repoRelative(projectRoot, absolute).toLowerCase();
  return rel === 'docs/examples' || rel.startsWith('docs/examples/');
}

async function ensureSafeOutputDirectory(projectRoot, targetDirectory) {
  if (!isInside(projectRoot, targetDirectory)) throw serviceError('output_path_escape', 'Output must remain inside the project root');
  const rel = repoRelative(projectRoot, targetDirectory);
  let current = projectRoot;
  for (const part of rel.split('/').filter(Boolean)) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw serviceError('unsafe_output_directory', 'Output parents must be real directories');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
    if (await realpath(current) !== current) throw serviceError('output_symlink_escape', 'Output parent resolved through a symlink');
  }
}

async function inspectOutputTarget(target, label) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw serviceError('symlink_output_forbidden', `${label} must not be a symlink`);
    if (!info.isFile()) throw serviceError('regular_output_required', `${label} must be a regular file`);
    if (info.nlink !== 1) throw serviceError('hardlink_output_forbidden', `${label} must not be a hardlink alias`);
    return { exists: true };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function canonicalizeProspectiveDirectory(pathValue, label) {
  let cursor = resolve(pathValue);
  const missingSegments = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw serviceError('unsafe_output_directory', `${label} must not contain a symlink or non-directory parent`);
      }
      const canonicalParent = await realpath(cursor);
      return resolve(canonicalParent, ...missingSegments);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw serviceError('unsafe_output_directory', `${label} has no real directory boundary`);
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function prepareOutputTarget(projectRoot, pathValue, allowedRoots, label, extension) {
  const raw = assertPathText(pathValue, label);
  const requested = isAbsolute(raw) ? resolve(raw) : resolve(projectRoot, raw);
  const canonicalParent = await canonicalizeProspectiveDirectory(dirname(requested), label);
  const target = resolve(canonicalParent, basename(requested));
  const matchingRoots = [...allowedRoots].filter((root) => isInside(root, target));
  if (matchingRoots.length === 0) {
    throw serviceError('output_path_escape', `${label} must remain inside an approved output boundary`);
  }
  if (isInside(projectRoot, target) && isCanonicalOutputPath(projectRoot, target)) {
    throw serviceError('canonical_output_forbidden', `${label} must not write under docs/examples`);
  }
  if (extname(target).toLowerCase() !== extension) {
    throw serviceError('output_extension_invalid', `${label} must end in ${extension}`);
  }
  const directoryBoundary = isInside(projectRoot, target)
    ? projectRoot
    : matchingRoots.sort((left, right) => left.length - right.length)[0];
  await ensureSafeOutputDirectory(directoryBoundary, dirname(target));
  const state = await inspectOutputTarget(target, label);
  return { target, ...state };
}

async function replaceOutputPair(entries) {
  const token = `${process.pid}.${atomicWriteCounter += 1}.${randomUUID()}`;
  const staged = [];
  const backups = [];
  const committed = [];
  let published = false;
  try {
    for (const entry of entries) {
      const temp = resolve(dirname(entry.target), `.${basename(entry.target)}.${token}.tmp`);
      await writeFile(temp, entry.content, { flag: 'wx', mode: 0o600 });
      staged.push({ ...entry, temp });
    }
    for (const entry of staged.filter((item) => item.exists)) {
      const backup = resolve(dirname(entry.target), `.${basename(entry.target)}.${token}.bak`);
      await rename(entry.target, backup);
      backups.push({ target: entry.target, backup });
    }
    for (const entry of staged) {
      await rename(entry.temp, entry.target);
      committed.push(entry.target);
    }
    published = true;
  } catch (error) {
    for (const target of committed.reverse()) await rm(target, { force: true }).catch(() => {});
    const restoreFailures = [];
    for (const entry of backups.reverse()) {
      try {
        await rename(entry.backup, entry.target);
        entry.restored = true;
      } catch (restoreError) {
        restoreFailures.push({ target: entry.target, backup: entry.backup, cause: restoreError.message });
      }
    }
    if (restoreFailures.length > 0 && error && typeof error === 'object') {
      error.revisionImpactRollbackFailures = restoreFailures;
    }
    throw error;
  } finally {
    for (const entry of staged) await rm(entry.temp, { force: true }).catch(() => {});
    if (published) {
      // Publication is complete. Backup cleanup is deliberately best-effort:
      // a cleanup failure must never roll back valid finals or destroy originals.
      for (const entry of backups) await rm(entry.backup, { force: true }).catch(() => {});
    }
  }
}

export async function writeRevisionImpactArtifacts({
  projectRoot,
  report,
  jsonPath,
  markdownPath = null,
  allowedOutputRoots = null,
  trustedOutputRoots = [],
} = {}) {
  const root = await resolveProjectRoot(projectRoot);
  assertValidRevisionImpactReport(report, { context: 'revision-impact writer' });
  const externalRoots = await resolveExistingTrustedRoots(trustedOutputRoots, 'trusted output root');
  const internalRoots = [];
  for (const pathValue of (allowedOutputRoots?.length ? allowedOutputRoots : ['output', 'tmp', 'local'])) {
    const raw = assertPathText(pathValue, 'allowed output root');
    const requested = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const absolute = await canonicalizeProspectiveDirectory(requested, 'allowed output root');
    const insideProject = isInside(root, absolute);
    const insideTrustedExternalRoot = externalRoots.some((trustedRoot) => isInside(trustedRoot, absolute));
    if ((!insideProject && !insideTrustedExternalRoot)
      || (insideProject && isCanonicalOutputPath(root, absolute))) {
      throw serviceError(
        'unsafe_allowed_output_root',
        'Allowed output roots must be non-canonical project paths or children of an explicit trusted output root'
      );
    }
    internalRoots.push(absolute);
  }
  const roots = uniqueSorted([...internalRoots, ...externalRoots]);
  const json = await prepareOutputTarget(root, jsonPath, roots, 'revision impact JSON', '.json');
  const markdown = markdownPath
    ? await prepareOutputTarget(root, markdownPath, roots, 'revision impact Markdown', '.md')
    : null;
  if (markdown && markdown.target === json.target) {
    throw serviceError('output_path_collision', 'JSON and Markdown outputs must use distinct paths');
  }
  const jsonContent = canonicalizeRevisionImpactJson(report);
  const markdownContent = markdown ? renderRevisionImpactMarkdown(report) : null;
  await replaceOutputPair([
    { ...json, content: jsonContent },
    ...(markdown ? [{ ...markdown, content: markdownContent }] : []),
  ]);
  return {
    jsonPath: json.target,
    markdownPath: markdown?.target || null,
    jsonSha256: sha256Bytes(jsonContent),
    markdownSha256: markdownContent === null ? null : sha256Bytes(markdownContent),
  };
}

export async function createRevisionImpactReportFromPaths(options = {}) {
  const { baseline, candidate } = await loadRevisionImpactInputSet(options);
  const report = buildRevisionImpactReport({ baseline, candidate, generatedAt: options.generatedAt });
  return { report, baseline, candidate };
}
