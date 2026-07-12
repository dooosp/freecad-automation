import { randomUUID } from 'node:crypto';
import { constants as fsConstants, readFileSync } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  rmdir,
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
import { validateEvidenceGraph as validateCanonicalEvidenceGraph } from '../evidence-graph/evidence-graph-service.js';
import {
  collectRevisionImpactSemanticRecords,
  validateRevisionImpactSemanticArtifact,
} from './revision-impact-semantic-adapters.js';

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
const preparedRevisionImpactPlans = new WeakSet();
const APPROVED_INTERNAL_OUTPUT_ROOTS = Object.freeze(['output', 'tmp/codex']);
const MAX_PREPARED_OUTPUT_BYTES = 16 * 1024 * 1024;
const OUTPUT_TRANSACTION_JOURNAL = '.fcad-revision-impact-output.transaction.json';

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
    // macOS commonly exposes the system var hierarchy through an ancestor
    // alias. The explicitly trusted leaf must be real; authorization then uses
    // its canonical realpath so the ancestor alias cannot widen the boundary.
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
  if (kind === 'create_quality') {
    assertValidation(validateCreateQualityReport(document), 'create_quality_invalid', label);
    return assertValidation(
      validateRevisionImpactSemanticArtifact(kind, document),
      'create_quality_semantic_invalid',
      label
    );
  }
  if (kind === 'quality_risk') {
    assertValidCArtifact('quality_risk', document, { command: 'compare-rev', path: label });
    return assertValidation(
      validateRevisionImpactSemanticArtifact(kind, document),
      'quality_risk_semantic_invalid',
      label
    );
  }
  if (kind === 'extracted_drawing_semantics') {
    assertValidation(validateExtractedDrawingSemantics(document), 'extracted_drawing_semantics_invalid', label);
    return assertValidation(
      validateRevisionImpactSemanticArtifact(kind, document),
      'extracted_drawing_semantics_semantic_invalid',
      label
    );
  }
  if (kind === 'evidence_graph') {
    assertValidation(validateCanonicalEvidenceGraph(document), 'evidence_graph_invalid', label);
    return assertValidation(
      validateRevisionImpactSemanticArtifact(kind, document),
      'evidence_graph_semantic_invalid',
      label
    );
  }
  if (['drawing_quality', 'drawing_qa', 'dfm'].includes(kind)) {
    return assertValidation(
      validateRevisionImpactSemanticArtifact(kind, document),
      `${kind}_invalid`,
      label
    );
  }
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
  if (Array.isArray(value)) return value.map(canonicalValue);
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
  const normalizedValue = canonicalValue(value);
  map.set(normalizedId, {
    id: normalizedId,
    value: normalizedValue,
    sourceKey,
    sourceValues: { [sourceKey]: normalizedValue },
  });
}

const MERGED_SOURCE_PRIORITY = ['review_pack', 'drawing_intent', 'feature_catalog', 'config'];

function preferredSourceKey(sourceKeys) {
  const keys = uniqueSorted(sourceKeys.filter(Boolean));
  return MERGED_SOURCE_PRIORITY.find((key) => keys.includes(key)) || keys[0] || null;
}

function mergeCompatibleValues(left, right) {
  if (left === null || left === undefined) return { ok: true, value: canonicalValue(right) };
  if (right === null || right === undefined) return { ok: true, value: canonicalValue(left) };
  if (valuesEqual(left, right)) return { ok: true, value: canonicalValue(right) };
  if (typeof left === 'object' && !Array.isArray(left)
    && typeof right === 'object' && !Array.isArray(right)) {
    const merged = {};
    for (const key of uniqueSorted([...Object.keys(left), ...Object.keys(right)])) {
      const result = mergeCompatibleValues(left[key], right[key]);
      if (!result.ok) return { ok: false, value: null };
      merged[key] = result.value;
    }
    return { ok: true, value: merged };
  }
  return { ok: false, value: null };
}

function mergeStableRecord(map, missing, conflicts, id, value, sourceKey, kind) {
  const normalizedId = textOrNull(id);
  if (!normalizedId) {
    missing.push({ kind, value: canonicalValue(value), sourceKey });
    return;
  }
  const normalizedValue = canonicalValue(value);
  const existing = map.get(normalizedId);
  if (!existing) {
    map.set(normalizedId, {
      id: normalizedId,
      value: normalizedValue,
      sourceKey,
      sourceValues: { [sourceKey]: normalizedValue },
    });
    return;
  }
  if (Object.hasOwn(existing.sourceValues || {}, sourceKey)) {
    throw serviceError('duplicate_stable_id', `Duplicate ${kind} stable ID: ${normalizedId}`);
  }
  const merged = mergeCompatibleValues(existing.value, normalizedValue);
  if (!merged.ok) {
    map.delete(normalizedId);
    conflicts.push({
      kind,
      id: normalizedId,
      source_keys: uniqueSorted([...Object.keys(existing.sourceValues || {}), existing.sourceKey, sourceKey]),
      values: [existing.value, normalizedValue],
    });
    return;
  }
  const sourceValues = { ...(existing.sourceValues || { [existing.sourceKey]: existing.value }), [sourceKey]: normalizedValue };
  map.set(normalizedId, {
    id: normalizedId,
    value: merged.value,
    sourceKey: preferredSourceKey(Object.keys(sourceValues)),
    sourceValues,
  });
}

function recordChangeSourceKeys(before, after, selector = (recordValue) => recordValue) {
  const beforeValues = before?.sourceValues || (before?.sourceKey ? { [before.sourceKey]: before.value } : {});
  const afterValues = after?.sourceValues || (after?.sourceKey ? { [after.sourceKey]: after.value } : {});
  const keys = uniqueSorted([...Object.keys(beforeValues), ...Object.keys(afterValues)]);
  const changedKeys = keys.filter((key) => !valuesEqual(
    Object.hasOwn(beforeValues, key) ? selector(beforeValues[key]) : null,
    Object.hasOwn(afterValues, key) ? selector(afterValues[key]) : null
  ));
  const selected = preferredSourceKey(changedKeys.length > 0 ? changedKeys : keys);
  return {
    baselineSourceKey: selected || before?.sourceKey || null,
    candidateSourceKey: selected || after?.sourceKey || null,
  };
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
  const conflicts = [];
  asArray(side.reviewPack?.geometry_features?.records).forEach((feature) => mergeStableRecord(
    map,
    missing,
    conflicts,
    feature?.feature_id,
    {
      type: feature?.feature_type ?? null,
      critical: feature?.critical === undefined ? null : feature.critical === true,
      region_ref: feature?.region_ref ?? null,
      details: feature?.details ?? null,
    },
    'review_pack',
    'geometry feature'
  ));
  if (side.featureCatalog) {
    asArray(side.featureCatalog.features).forEach((feature) => mergeStableRecord(map, missing, conflicts, feature?.feature_id, {
      type: feature?.type ?? null,
      critical: feature?.critical === undefined ? null : feature.critical === true,
      dimensions: normalizeDimensions(feature?.dimensions),
    }, 'feature_catalog', 'feature'));
  } else {
    asArray(side.config?.shapes).forEach((shape) => mergeStableRecord(map, missing, conflicts, shape?.id, {
      type: shape?.type ?? null,
      dimensions: normalizeDimensions(shape),
    }, 'config', 'feature'));
  }
  return { map, missing, conflicts };
}

function normalizedCharacteristic(item) {
  const nominal = measurementFromObject(item);
  const tolerance = normalizeTolerance(item?.tolerance, nominal.unit);
  return {
    feature_id: textOrNull(item?.feature || item?.feature_id),
    nominal: nominal.value,
    unit: nominal.unit,
    nominal_determinability: nominal.determinability,
    tolerance: tolerance.value,
    tolerance_determinability: tolerance.determinability,
    datum: canonicalValue(item?.datum || item?.datum_reference || item?.reference || null),
    specification_ref: textOrNull(item?.specification_ref || item?.specification_reference || item?.spec_ref),
    inspection_method: textOrNull(item?.inspection_method || item?.method),
    required: item?.required === undefined ? null : item.required !== false,
    process_sensitive: item?.process_sensitive === undefined ? null : item.process_sensitive === true,
    critical: item?.critical === undefined ? null : item.critical === true,
    label: textOrNull(item?.label || item?.dimension_name),
    view: textOrNull(item?.view),
  };
}

function collectCharacteristics(side) {
  const map = new Map();
  const missing = [];
  const conflicts = [];
  asArray(side.reviewPack?.inspection_linkage?.records)
    .filter((item) => item?.record_role === 'inspection_requirement')
    .forEach((item) => mergeStableRecord(
      map,
      missing,
      conflicts,
      item?.characteristic_id,
      normalizedCharacteristic(item),
      'review_pack',
      'inspection requirement'
    ));
  asArray(side.drawingIntent?.required_dimensions).forEach((item) => {
    mergeStableRecord(
      map,
      missing,
      conflicts,
      item?.id || item?.characteristic_id || item?.requirement_id,
      normalizedCharacteristic(item),
      side.sources.drawing_intent ? 'drawing_intent' : 'config',
      'characteristic'
    );
  });
  return { map, missing, conflicts };
}

function collectSemanticSurface(side, kind, document = sourceDocument(side.raw, kind)) {
  const map = new Map();
  if (!document) return { available: false, map, unmapped: [], sourceKey: kind };
  const collected = collectRevisionImpactSemanticRecords(kind, document);
  for (const record of collected.records) {
    if (map.has(record.id)) {
      throw serviceError('duplicate_stable_id', `Duplicate ${kind} stable ID: ${record.id}`);
    }
    map.set(record.id, {
      id: record.id,
      value: canonicalValue(record.value),
      sourceKey: side.sources[kind] ? kind : 'readiness_report',
      featureId: textOrNull(record.featureId),
      characteristicId: textOrNull(record.characteristicId),
    });
  }
  return {
    available: true,
    map,
    unmapped: canonicalValue(collected.unmapped),
    sourceKey: side.sources[kind] ? kind : 'readiness_report',
  };
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
  stableIdentityKey = null,
  force = false,
}) {
  if (!force && valuesEqual(before, after)) return null;
  const baselineSource = baselineSourceKey ? sourceFor(baseline, baselineSourceKey) : null;
  const candidateSource = candidateSourceKey ? sourceFor(candidate, candidateSourceKey) : null;
  const basis = {
    type,
    entity_id: entityId,
    before: canonicalValue(before),
    after: canonicalValue(after),
    unit,
    determinability,
    ...(stableIdentityKey ? { stable_identity_key: stableIdentityKey } : {}),
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
      const sourceKeys = recordChangeSourceKeys(before, after);
      createChange(changes, impactById, baseline, candidate, {
        type: modifiedType,
        entityId: id,
        before: before.value,
        after: after.value,
        ...sourceKeys,
        rationale: `${label} ${id} changed under the same explicit stable identity.`,
        severity: 'high',
        requiredAction: REINSPECTION_CHANGE_TYPES.has(modifiedType) ? 'reinspect' : 'human_review',
        impactStatus: REINSPECTION_CHANGE_TYPES.has(modifiedType) ? 'reinspection_required' : 'review_required',
      });
    }
  });
}

function semanticRecordEntityId(before, after, fallback) {
  return after?.characteristicId
    || before?.characteristicId
    || after?.featureId
    || before?.featureId
    || fallback;
}

function compareSemanticSurface(changes, impactById, baseline, candidate, baselineSurface, candidateSurface, {
  kind,
  changeType,
  label,
}) {
  if (baselineSurface.available !== candidateSurface.available) {
    createChange(changes, impactById, baseline, candidate, {
      type: 'unresolved_identity_change',
      entityId: null,
      before: { artifact_kind: kind, available: baselineSurface.available },
      after: { artifact_kind: kind, available: candidateSurface.available },
      baselineSourceKey: baselineSurface.available ? baselineSurface.sourceKey : null,
      candidateSourceKey: candidateSurface.available ? candidateSurface.sourceKey : null,
      determinability: 'unable_to_determine',
      rationale: `${label} availability differs between revisions, so semantic addition or removal cannot be inferred safely.`,
      severity: 'blocking',
      requiredAction: 'resolve_identity_or_inputs',
      impactStatus: 'unable_to_determine',
    });
    return;
  }
  if (!baselineSurface.available) return;

  const hasUnmapped = baselineSurface.unmapped.length > 0 || candidateSurface.unmapped.length > 0;
  if (hasUnmapped) {
    createChange(changes, impactById, baseline, candidate, {
      type: 'unresolved_identity_change',
      entityId: null,
      before: { artifact_kind: kind, baseline_unmapped_records: baselineSurface.unmapped },
      after: { artifact_kind: kind, candidate_unmapped_records: candidateSurface.unmapped },
      baselineSourceKey: baselineSurface.sourceKey,
      candidateSourceKey: candidateSurface.sourceKey,
      determinability: 'unable_to_determine',
      rationale: `${label} contains records without trustworthy stable identity; no positional mapping or add/remove conclusion was guessed.`,
      severity: 'blocking',
      requiredAction: 'resolve_identity_or_inputs',
      impactStatus: 'unable_to_determine',
      stableIdentityKey: `${kind}:unmapped`,
    });
  }

  const ids = uniqueSorted([...baselineSurface.map.keys(), ...candidateSurface.map.keys()]);
  ids.forEach((id) => {
    const before = baselineSurface.map.get(id);
    const after = candidateSurface.map.get(id);
    if ((!before || !after) && hasUnmapped) return;
    const beforeValue = before ? {
      value: before.value,
      feature_id: before.featureId,
      characteristic_id: before.characteristicId,
    } : null;
    const afterValue = after ? {
      value: after.value,
      feature_id: after.featureId,
      characteristic_id: after.characteristicId,
    } : null;
    if (before && after && valuesEqual(beforeValue, afterValue)) return;
    const entityId = semanticRecordEntityId(before, after, id);
    createChange(changes, impactById, baseline, candidate, {
      type: changeType,
      entityId,
      before: beforeValue,
      after: afterValue,
      baselineSourceKey: before?.sourceKey || null,
      candidateSourceKey: after?.sourceKey || null,
      rationale: before && after
        ? `${label} ${entityId} changed under explicit stable semantic identity.`
        : `${label} ${entityId} was ${before ? 'removed' : 'added'} under explicit stable semantic identity.`,
      severity: 'high',
      requiredAction: 'human_review',
      impactStatus: 'review_required',
      stableIdentityKey: `${kind}:${id}`,
    });
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
      const sourceKeys = recordChangeSourceKeys(before, after, (value) => ({
        nominal: value?.nominal ?? null,
        unit: value?.unit ?? null,
        nominal_determinability: value?.nominal_determinability ?? null,
      }));
      const determined = left.nominal_determinability === 'determined'
        && right.nominal_determinability === 'determined' && left.unit === right.unit;
      createChange(changes, impactById, baseline, candidate, {
        type: 'nominal_dimension_change',
        entityId: id,
        before: left.nominal,
        after: right.nominal,
        ...sourceKeys,
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
      const sourceKeys = recordChangeSourceKeys(before, after, (value) => ({
        tolerance: value?.tolerance ?? null,
        tolerance_determinability: value?.tolerance_determinability ?? null,
      }));
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
        ...sourceKeys,
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
        const sourceKeys = recordChangeSourceKeys(before, after, (value) => value?.[field] ?? null);
        createChange(changes, impactById, baseline, candidate, {
          type,
          entityId: id,
          before: left[field],
          after: right[field],
          ...sourceKeys,
          rationale: `Characteristic ${id} ${field.replaceAll('_', ' ')} changed explicitly.`,
          severity: 'high',
          requiredAction,
          impactStatus,
        });
      }
    });
    if (!valuesEqual(left.critical, right.critical)) {
      const sourceKeys = recordChangeSourceKeys(before, after, (value) => value?.critical ?? null);
      const becameCritical = right.critical === true;
      createChange(changes, impactById, baseline, candidate, {
        type: 'critical_characteristic_change',
        entityId: id,
        before: left.critical,
        after: right.critical,
        ...sourceKeys,
        rationale: becameCritical
          ? `Characteristic ${id} became explicitly critical and requires future inspection.`
          : `Characteristic ${id} criticality changed and prior evidence requires human review.`,
        severity: 'high',
        requiredAction: becameCritical ? 'reinspect' : 'human_review',
        impactStatus: becameCritical ? 'reinspection_required' : 'review_required',
      });
    }
    const drawingBefore = { feature_id: left.feature_id, required: left.required, label: left.label, view: left.view };
    const drawingAfter = { feature_id: right.feature_id, required: right.required, label: right.label, view: right.view };
    if (!valuesEqual(drawingBefore, drawingAfter)) {
      const sourceKeys = recordChangeSourceKeys(before, after, (value) => ({
        feature_id: value?.feature_id ?? null,
        required: value?.required ?? null,
        label: value?.label ?? null,
        view: value?.view ?? null,
      }));
      createChange(changes, impactById, baseline, candidate, {
        type: 'drawing_requirement_change',
        entityId: id,
        before: drawingBefore,
        after: drawingAfter,
        ...sourceKeys,
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

function buildAssessments(
  baseline,
  candidate,
  changes,
  impactById,
  baselineCharacteristics,
  candidateCharacteristics,
  bindingIssues
) {
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
    const candidateCharacteristic = candidateCharacteristics.map.get(id)?.value || null;
    const baselineCharacteristic = baselineCharacteristics.map.get(id)?.value || null;
    const characteristicDefinition = candidateCharacteristic || baselineCharacteristic;
    const featureId = candidateCharacteristic?.feature_id || null;
    const related = changes.filter((change) => (
      change.affected_entity_id === id
      || change.affected_entity_id === characteristic?.specification_ref
      || (featureId && change.affected_entity_id === featureId
        && change.change_type.startsWith('geometry_feature_'))
      || (['material_change', 'manufacturing_process_change'].includes(change.change_type)
        && candidateCharacteristic?.process_sensitive !== false)
      || (change.change_type === 'unresolved_identity_change' && change.severity === 'blocking')
    )).map((change) => change.change_id);
    const status = untrustedEnvelope
      ? 'not_applicable'
      : bindingIssues.length > 0
        ? 'unable_to_determine'
        : assessmentStatusForChanges(related, impactById);
    assessments.set(id, makeAssessment(baseline, candidate, id, related, status, envelopeRef));
  });

  for (const [id, characteristic] of candidateCharacteristics.map) {
    if (assessments.has(id)) continue;
    const related = changes.filter((change) => (
      change.affected_entity_id === id
      || (characteristic.value.feature_id
        && change.affected_entity_id === characteristic.value.feature_id
        && change.change_type.startsWith('geometry_feature_'))
      || (['material_change', 'manufacturing_process_change'].includes(change.change_type)
        && characteristic.value.process_sensitive !== false)
      || (change.change_type === 'unresolved_identity_change' && change.severity === 'blocking')
    )).map((change) => change.change_id);
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
  identityChanges
    .filter((change) => change.affected_entity_id)
    .forEach((change) => {
      const id = change.affected_entity_id;
      if (assessments.has(id)) return;
      assessments.set(id, makeAssessment(
        baseline,
        candidate,
        id,
        [change.change_id],
        'unable_to_determine',
        null
      ));
    });
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
  assessments.filter((assessment) => (
    assessment.applicability_status === 'reinspection_required'
    && candidateCharacteristics.map.has(assessment.evidence_or_characteristic_id)
  )).forEach((assessment) => {
    targets.set(assessment.evidence_or_characteristic_id, assessment.related_change_ids);
  });
  const characteristicLinkedChangeIds = new Set(
    assessments
      .filter((assessment) => assessment.applicability_status === 'reinspection_required')
      .filter((assessment) => candidateCharacteristics.map.has(assessment.evidence_or_characteristic_id))
      .flatMap((assessment) => assessment.related_change_ids)
  );
  changes.forEach((change) => {
    if (impactById.get(change.change_id)?.status !== 'reinspection_required') return;
    if (change.change_type.startsWith('geometry_feature_')
      && characteristicLinkedChangeIds.has(change.change_id)) return;
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
  const featureSurfaceKind = (side) => side.featureCatalog
    ? 'feature_catalog'
    : Array.isArray(side.config?.shapes)
      ? 'config_shapes'
      : 'review_pack';
  const leftFeatureSurface = featureSurfaceKind(left);
  const rightFeatureSurface = featureSurfaceKind(right);
  if (leftFeatureSurface !== rightFeatureSurface) {
    addIdentityGap(
      changes,
      impactById,
      left,
      right,
      'feature_surface_availability',
      { source: leftFeatureSurface },
      { source: rightFeatureSurface },
      'Feature-source availability differs between revisions, so feature addition or removal cannot be inferred safely.'
    );
  } else {
    compareRecordMaps(changes, impactById, left, right, leftFeatures, rightFeatures, {
      addedType: 'geometry_feature_added',
      removedType: 'geometry_feature_removed',
      modifiedType: 'geometry_feature_modified',
      label: 'Geometry feature',
    });
  }
  const leftChars = collectCharacteristics(left);
  const rightChars = collectCharacteristics(right);
  const drawingIntentAvailabilityMismatch = Boolean(left.drawingIntent) !== Boolean(right.drawingIntent);
  const characteristicSurfaceAvailable = (side) => Boolean(side.drawingIntent)
    || Array.isArray(side.reviewPack?.inspection_linkage?.records);
  const characteristicAvailabilityMismatch = characteristicSurfaceAvailable(left) !== characteristicSurfaceAvailable(right);
  if (characteristicAvailabilityMismatch || drawingIntentAvailabilityMismatch) {
    addIdentityGap(
      changes,
      impactById,
      left,
      right,
      'inspection_requirement_availability',
      {
        drawing_intent: Boolean(left.drawingIntent),
        characteristic_surface: characteristicSurfaceAvailable(left),
      },
      {
        drawing_intent: Boolean(right.drawingIntent),
        characteristic_surface: characteristicSurfaceAvailable(right),
      },
      'Drawing-intent or inspection-requirement availability differs between revisions, so characteristic addition or removal cannot be inferred safely.'
    );
  } else {
    compareCharacteristics(changes, impactById, left, right, leftChars, rightChars);
  }
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
  const leftGates = collectSemanticSurface(
    left,
    'quality_risk',
    left.readiness?.quality_risk || sourceDocument(left.raw, 'quality_risk')
  );
  const rightGates = collectSemanticSurface(
    right,
    'quality_risk',
    right.readiness?.quality_risk || sourceDocument(right.raw, 'quality_risk')
  );
  compareSemanticSurface(changes, impactById, left, right, leftGates, rightGates, {
    kind: 'quality_risk',
    changeType: 'quality_gate_change',
    label: 'Quality-risk record',
  });

  const semanticSurfacePolicies = [
    ['extracted_drawing_semantics', 'drawing_requirement_change', 'Extracted drawing semantic'],
    ['create_quality', 'quality_gate_change', 'Create-quality record'],
    ['drawing_quality', 'quality_gate_change', 'Drawing-quality record'],
    ['drawing_qa', 'quality_gate_change', 'Drawing-QA record'],
    ['dfm', 'quality_gate_change', 'DFM record'],
    ['evidence_graph', 'evidence_reference_change', 'Evidence-graph reference'],
  ];
  semanticSurfacePolicies.forEach(([kind, changeType, label]) => {
    compareSemanticSurface(
      changes,
      impactById,
      left,
      right,
      collectSemanticSurface(left, kind),
      collectSemanticSurface(right, kind),
      { kind, changeType, label }
    );
  });

  const missingStable = [
    ...leftFeatures.missing, ...rightFeatures.missing,
    ...leftChars.missing, ...rightChars.missing,
  ];
  const sourceConflicts = [
    ...leftFeatures.conflicts.map((conflict) => ({ side: 'baseline', conflict })),
    ...rightFeatures.conflicts.map((conflict) => ({ side: 'candidate', conflict })),
    ...leftChars.conflicts.map((conflict) => ({ side: 'baseline', conflict })),
    ...rightChars.conflicts.map((conflict) => ({ side: 'candidate', conflict })),
  ];
  sourceConflicts.forEach(({ side, conflict }) => createChange(changes, impactById, left, right, {
    type: 'unresolved_identity_change',
    entityId: conflict.id,
    before: side === 'baseline' ? { entity_id: conflict.id, ...conflict } : null,
    after: side === 'candidate' ? { entity_id: conflict.id, ...conflict } : null,
    determinability: 'unable_to_determine',
    rationale: `Stable ${conflict.kind} ${conflict.id} conflicts across normalized source artifacts.`,
    severity: 'blocking',
    requiredAction: 'resolve_identity_or_inputs',
    impactStatus: 'unable_to_determine',
  }));
  if (missingStable.length > 0) {
    addIdentityGap(changes, impactById, left, right, 'stable_entity_identity',
      {
        baseline_missing_count: leftFeatures.missing.length + leftChars.missing.length,
      },
      {
        candidate_missing_count: rightFeatures.missing.length + rightChars.missing.length,
      },
      'One or more compared engineering entities lack stable identity; array position is never used as identity.');
  }

  const drawingFields = [
    ['datum_strategy', 'datum_or_reference_change'],
    ['required_notes', 'drawing_requirement_change'],
    ['required_views', 'drawing_requirement_change'],
    ['drawing_standard', 'specification_reference_change'],
    ['tolerance_policy', 'drawing_requirement_change'],
  ];
  if (!drawingIntentAvailabilityMismatch) drawingFields.forEach(([field, type]) => {
    const before = canonicalValue(left.drawingIntent?.[field] ?? null);
    const after = canonicalValue(right.drawingIntent?.[field] ?? null);
    if (!valuesEqual(before, after)) {
      const unableToLinkGlobalDatum = field === 'datum_strategy';
      createChange(changes, impactById, left, right, {
        type,
        entityId: `drawing:${field}`,
        before,
        after,
        baselineSourceKey: left.sources.drawing_intent ? 'drawing_intent' : 'config',
        candidateSourceKey: right.sources.drawing_intent ? 'drawing_intent' : 'config',
        determinability: unableToLinkGlobalDatum ? 'unable_to_determine' : 'determined',
        rationale: unableToLinkGlobalDatum
          ? 'The global drawing datum strategy changed without an explicit stable characteristic linkage.'
          : `Explicit drawing ${field.replaceAll('_', ' ')} changed.`,
        severity: unableToLinkGlobalDatum ? 'blocking' : 'high',
        requiredAction: unableToLinkGlobalDatum ? 'resolve_identity_or_inputs' : 'human_review',
        impactStatus: unableToLinkGlobalDatum ? 'unable_to_determine' : 'review_required',
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
  const assessments = buildAssessments(
    left,
    right,
    changes,
    impactById,
    leftChars,
    rightChars,
    bindingIssues
  );
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
  const created = [];
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
      created.push(current);
    }
    if (await realpath(current) !== current) throw serviceError('output_symlink_escape', 'Output parent resolved through a symlink');
  }
  return created;
}

async function inspectOutputTarget(target, label) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw serviceError('symlink_output_forbidden', `${label} must not be a symlink`);
    if (!info.isFile()) throw serviceError('regular_output_required', `${label} must be a regular file`);
    if (info.nlink !== 1) throw serviceError('hardlink_output_forbidden', `${label} must not be a hardlink alias`);
    return { exists: true, device: info.dev, inode: info.ino };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, device: null, inode: null };
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
  if (isInside(projectRoot, target) && isCanonicalOutputPath(projectRoot, target)) {
    throw serviceError('canonical_output_forbidden', `${label} must not write under docs/examples`);
  }
  const matchingRoots = [...allowedRoots].filter((root) => isInside(root, target));
  if (matchingRoots.length === 0) {
    throw serviceError('output_path_escape', `${label} must remain inside an approved output boundary`);
  }
  if (extname(target).toLowerCase() !== extension) {
    throw serviceError('output_extension_invalid', `${label} must end in ${extension}`);
  }
  const directoryBoundary = isInside(projectRoot, target)
    ? projectRoot
    : matchingRoots.sort((left, right) => left.length - right.length)[0];
  const state = await inspectOutputTarget(target, label);
  return { target, directoryBoundary, label, ...state };
}

async function materializePreparedOutputTarget(entry) {
  const current = await inspectOutputTarget(entry.target, entry.label);
  if (current.exists !== entry.exists
    || (current.exists && (current.device !== entry.device || current.inode !== entry.inode))) {
    throw serviceError('output_target_changed', `${entry.label} changed after preflight`);
  }
  const directory = dirname(entry.target);
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || await realpath(directory) !== directory) {
    throw serviceError('output_symlink_escape', `${entry.label} parent changed after preflight`);
  }
  return {
    ...entry,
    ...current,
    directory,
    directoryDevice: directoryInfo.dev,
    directoryInode: directoryInfo.ino,
  };
}

async function assertPreparedOutputState(entry, { targetExpected = entry.exists } = {}) {
  const directoryInfo = await lstat(entry.directory);
  if (directoryInfo.isSymbolicLink()
    || !directoryInfo.isDirectory()
    || directoryInfo.dev !== entry.directoryDevice
    || directoryInfo.ino !== entry.directoryInode
    || await realpath(entry.directory) !== entry.directory) {
    throw serviceError('output_directory_changed', `${entry.label} parent changed during publication`);
  }
  const current = await inspectOutputTarget(entry.target, entry.label);
  if (current.exists !== targetExpected
    || (targetExpected && (current.device !== entry.device || current.inode !== entry.inode))) {
    throw serviceError('output_target_changed', `${entry.label} changed during publication`);
  }
}

async function removeCreatedOutputDirectories(createdDirectories) {
  for (const directory of [...createdDirectories].reverse()) {
    await rmdir(directory).catch(() => {});
  }
}

async function materializePreparedOutputTargets(entries) {
  const createdDirectories = [];
  try {
    const directories = uniqueSorted(entries.map((entry) => dirname(entry.target)));
    for (const directory of directories) {
      const representative = entries.find((entry) => dirname(entry.target) === directory);
      createdDirectories.push(...await ensureSafeOutputDirectory(representative.directoryBoundary, directory));
    }
    const materialized = [];
    for (const entry of entries) materialized.push(await materializePreparedOutputTarget(entry));
    return { entries: materialized, createdDirectories: uniqueSorted(createdDirectories) };
  } catch (error) {
    await removeCreatedOutputDirectories(createdDirectories);
    throw error;
  }
}

async function writeExclusiveStagedFile(pathValue, content) {
  let handle;
  try {
    handle = await open(
      pathValue,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0),
      0o600
    );
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function outputLockOwnerPath(directory, pid, token) {
  return resolve(directory, `.fcad-revision-impact-output.lock.${pid}.${token}.owner`);
}

async function recoverStaleOutputLock(lockPath) {
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink < 1 || info.nlink > 2) return false;
    let owner;
    try {
      owner = JSON.parse(await handle.readFile('utf8'));
    } catch {
      return false;
    }
    if (isProcessAlive(owner?.pid)) return false;
    const stalePath = `${lockPath}.${process.pid}.${randomUUID()}.stale`;
    await handle.close();
    handle = null;
    await rename(lockPath, stalePath);
    const staleInfo = await lstat(stalePath);
    if (staleInfo.dev !== info.dev || staleInfo.ino !== info.ino) {
      throw serviceError('output_lock_changed', 'Revision-impact output lock changed during stale-lock recovery');
    }
    await rm(stalePath, { force: true });
    if (Number.isInteger(owner?.pid)
      && /^[A-Za-z0-9.-]{1,200}$/.test(owner?.token || '')) {
      const ownerPath = outputLockOwnerPath(dirname(lockPath), owner.pid, owner.token);
      try {
        const ownerInfo = await lstat(ownerPath);
        if (ownerInfo.dev === info.dev && ownerInfo.ino === info.ino) await rm(ownerPath, { force: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    if (/^[A-Za-z0-9.-]{1,200}$/.test(owner?.token || '')) {
      await rm(journalUpdatePath(dirname(lockPath), owner.token), { force: true });
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    if (error instanceof RevisionImpactServiceError) throw error;
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function acquireOutputDirectoryLock(directory, ownerToken = null) {
  const lockPath = resolve(directory, '.fcad-revision-impact-output.lock');
  const token = /^[A-Za-z0-9.-]{1,200}$/.test(ownerToken || '')
    ? ownerToken
    : `recovery.${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ownerPath = outputLockOwnerPath(directory, process.pid, token);
    try {
      await writeExclusiveStagedFile(ownerPath, `${JSON.stringify({
        pid: process.pid,
        token,
        created_at: new Date().toISOString(),
      })}\n`);
      await link(ownerPath, lockPath);
      const info = await lstat(lockPath);
      return async () => {
        try {
          const current = await lstat(lockPath);
          if (current.dev === info.dev && current.ino === info.ino) await rm(lockPath, { force: true });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        await rm(ownerPath, { force: true });
      };
    } catch (error) {
      await rm(ownerPath, { force: true }).catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === 0 && await recoverStaleOutputLock(lockPath)) continue;
      throw serviceError('output_directory_locked', 'Another revision-impact publication owns the output directory');
    }
  }
  throw serviceError('output_directory_locked', 'Another revision-impact publication owns the output directory');
}

async function syncOutputDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    // Some platforms do not permit fsync on directories. File fsync and atomic
    // rename still provide the strongest portable boundary available here.
    if (!['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error?.code)) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function hashRecoveryFile(pathValue, label) {
  let handle;
  try {
    handle = await open(pathValue, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) {
      throw serviceError('output_recovery_failed', `${label} must be a single-link regular file`);
    }
    return { sha256: sha256Bytes(await handle.readFile()), info };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function outputJournalPath(directory) {
  return resolve(directory, OUTPUT_TRANSACTION_JOURNAL);
}

function journalUpdatePath(directory, token) {
  return resolve(directory, `.fcad-revision-impact-output.transaction.${token}.tmp`);
}

async function writeInitialOutputJournal(journalPath, journal, { testHardExitBeforeRename = false } = {}) {
  const initialPath = journalUpdatePath(dirname(journalPath), journal.token);
  await writeExclusiveStagedFile(initialPath, `${JSON.stringify(journal, null, 2)}\n`);
  if (testHardExitBeforeRename) process.kill(process.pid, 'SIGKILL');
  await rename(initialPath, journalPath);
  await syncOutputDirectory(dirname(journalPath));
}

async function updateOutputJournal(journalPath, journal) {
  const updatePath = journalUpdatePath(dirname(journalPath), journal.token);
  await writeExclusiveStagedFile(updatePath, `${JSON.stringify(journal, null, 2)}\n`);
  await rename(updatePath, journalPath);
  await syncOutputDirectory(dirname(journalPath));
}

function assertRecoveryJournal(directory, journal) {
  if (!journal || journal.schema_version !== '1.0'
    || !['staging', 'prepared', 'committed'].includes(journal.phase)
    || !/^[A-Za-z0-9.-]{1,200}$/.test(journal.token || '')
    || !Array.isArray(journal.entries)
    || journal.entries.length === 0) {
    throw serviceError('output_recovery_failed', 'Interrupted output journal is malformed');
  }
  for (const entry of journal.entries) {
    for (const field of ['target', 'temp', 'backup']) {
      if (typeof entry?.[field] !== 'string'
        || resolve(entry[field]) !== entry[field]
        || dirname(entry[field]) !== directory) {
        throw serviceError('output_recovery_failed', `Interrupted output journal has an unsafe ${field}`);
      }
    }
    if (!/^[a-f0-9]{64}$/.test(entry.new_sha256 || '')
      || (entry.original_exists && !/^[a-f0-9]{64}$/.test(entry.original_sha256 || ''))) {
      throw serviceError('output_recovery_failed', 'Interrupted output journal has invalid content hashes');
    }
  }
}

async function readOutputJournal(journalPath) {
  const loaded = await hashRecoveryFile(journalPath, 'output transaction journal');
  if (!loaded) return null;
  let journal;
  try {
    const handle = await open(journalPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      journal = JSON.parse(await handle.readFile('utf8'));
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw serviceError('output_recovery_failed', `Interrupted output journal cannot be parsed: ${error.message}`);
  }
  assertRecoveryJournal(dirname(journalPath), journal);
  return journal;
}

async function recoverOutputJournalLocked(directory) {
  const journalPath = outputJournalPath(directory);
  const journal = await readOutputJournal(journalPath);
  if (!journal) return false;

  if (journal.phase === 'committed') {
    for (const entry of journal.entries) {
      const target = await hashRecoveryFile(entry.target, 'committed recovery target');
      if (!target || target.sha256 !== entry.new_sha256) {
        throw serviceError('output_recovery_failed', 'Committed output transaction is incomplete or changed');
      }
      await rm(entry.temp, { force: true });
      await rm(entry.backup, { force: true });
    }
  } else {
    for (const entry of [...journal.entries].reverse()) {
      const backup = await hashRecoveryFile(entry.backup, 'recovery backup');
      const target = await hashRecoveryFile(entry.target, 'recovery target');
      if (backup) {
        if (!entry.original_exists || backup.sha256 !== entry.original_sha256) {
          throw serviceError('output_recovery_failed', 'Recovery backup does not match the recorded original');
        }
        if (target && target.sha256 !== entry.new_sha256) {
          throw serviceError('output_recovery_failed', 'Recovery target was changed by another writer');
        }
        if (target) await rm(entry.target, { force: true });
        await rename(entry.backup, entry.target);
      } else if (entry.original_exists) {
        if (!target || target.sha256 !== entry.original_sha256) {
          throw serviceError('output_recovery_failed', 'Original output cannot be restored safely');
        }
      } else if (target) {
        if (target.sha256 !== entry.new_sha256) {
          throw serviceError('output_recovery_failed', 'Unexpected output occupies an interrupted transaction target');
        }
        await rm(entry.target, { force: true });
      }
      await rm(entry.temp, { force: true });
    }
  }
  await rm(journalUpdatePath(directory, journal.token), { force: true });
  await rm(journalPath, { force: true });
  await syncOutputDirectory(directory);
  return true;
}

async function maybeRecoverInterruptedOutput(directory) {
  try {
    await lstat(outputJournalPath(directory));
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const releaseLock = await acquireOutputDirectoryLock(directory);
  try {
    return await recoverOutputJournalLocked(directory);
  } finally {
    await releaseLock();
  }
}

async function replacePreparedOutputs(entries, {
  testFailAfterCommitCount = null,
  testHardExitAfterCommitCount = null,
  testHardExitBeforeInitialJournalRename = false,
} = {}) {
  const directories = uniqueSorted(entries.map((entry) => entry.directory));
  if (directories.length !== 1) {
    throw serviceError('output_directory_mismatch', 'Prepared outputs must share one publication directory');
  }
  const directory = directories[0];
  const token = `${process.pid}.${atomicWriteCounter += 1}.${randomUUID()}`;
  const releaseLock = await acquireOutputDirectoryLock(directory, token);
  const journalPath = outputJournalPath(directory);
  const staged = [];
  const backups = [];
  const committed = [];
  let journalWritten = false;
  let rollbackComplete = false;
  let published = false;
  let journal = null;
  try {
    const journalEntries = [];
    for (const entry of entries) {
      await assertPreparedOutputState(entry);
      const original = entry.exists ? await hashRecoveryFile(entry.target, entry.label) : null;
      if (entry.exists && (!original
        || original.info.dev !== entry.device
        || original.info.ino !== entry.inode)) {
        throw serviceError('output_target_changed', `${entry.label} changed before journal preparation`);
      }
      const temp = resolve(dirname(entry.target), `.${basename(entry.target)}.${token}.tmp`);
      const backup = resolve(dirname(entry.target), `.${basename(entry.target)}.${token}.bak`);
      journalEntries.push({
        target: entry.target,
        temp,
        backup,
        original_exists: entry.exists,
        original_sha256: original?.sha256 || null,
        original_device: entry.device,
        original_inode: entry.inode,
        new_sha256: sha256Bytes(entry.content),
      });
    }
    journal = {
      schema_version: '1.0',
      token,
      owner_pid: process.pid,
      phase: 'staging',
      entries: journalEntries,
    };
    await writeInitialOutputJournal(journalPath, journal, {
      testHardExitBeforeRename: testHardExitBeforeInitialJournalRename,
    });
    journalWritten = true;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const journalEntry = journalEntries[index];
      await writeExclusiveStagedFile(journalEntry.temp, entry.content);
      staged.push({ ...entry, temp: journalEntry.temp, backup: journalEntry.backup });
    }
    journal = { ...journal, phase: 'prepared' };
    await updateOutputJournal(journalPath, journal);
    for (const entry of staged) await assertPreparedOutputState(entry);
    for (const entry of staged.filter((item) => item.exists)) {
      await assertPreparedOutputState(entry);
      await rename(entry.target, entry.backup);
      backups.push({ target: entry.target, backup: entry.backup });
    }
    for (const entry of staged) {
      await assertPreparedOutputState(entry, { targetExpected: false });
      await rename(entry.temp, entry.target);
      const committedInfo = await lstat(entry.target);
      committed.push({ target: entry.target, device: committedInfo.dev, inode: committedInfo.ino });
      if (Number.isInteger(testFailAfterCommitCount) && committed.length === testFailAfterCommitCount) {
        throw serviceError('simulated_output_interruption', 'Simulated revision-impact publication interruption');
      }
      if (Number.isInteger(testHardExitAfterCommitCount) && committed.length === testHardExitAfterCommitCount) {
        process.kill(process.pid, 'SIGKILL');
      }
    }
    await syncOutputDirectory(directory);
    journal = { ...journal, phase: 'committed' };
    await updateOutputJournal(journalPath, journal);
    published = true;
  } catch (error) {
    const restoreFailures = [];
    for (const entry of committed.reverse()) {
      try {
        const current = await lstat(entry.target);
        if (current.dev !== entry.device || current.ino !== entry.inode) {
          restoreFailures.push({ target: entry.target, cause: 'committed output ownership changed before rollback' });
          continue;
        }
        await rm(entry.target, { force: true });
      } catch (removeError) {
        if (removeError?.code !== 'ENOENT') {
          restoreFailures.push({ target: entry.target, cause: removeError.message });
        }
      }
    }
    for (const entry of backups.reverse()) {
      try {
        const current = await inspectOutputTarget(entry.target, 'rollback target');
        if (current.exists) {
          restoreFailures.push({ target: entry.target, backup: entry.backup, cause: 'rollback target is occupied' });
          continue;
        }
        await rename(entry.backup, entry.target);
        entry.restored = true;
      } catch (restoreError) {
        restoreFailures.push({ target: entry.target, backup: entry.backup, cause: restoreError.message });
      }
    }
    if (restoreFailures.length > 0 && error && typeof error === 'object') {
      error.revisionImpactRollbackFailures = restoreFailures;
    }
    rollbackComplete = restoreFailures.length === 0;
    if (rollbackComplete && journalWritten) {
      await rm(journalUpdatePath(directory, token), { force: true }).catch(() => {});
      await rm(journalPath, { force: true }).catch(() => {});
      await syncOutputDirectory(directory);
    }
    throw error;
  } finally {
    if (published || rollbackComplete) {
      for (const entry of staged) await rm(entry.temp, { force: true }).catch(() => {});
    }
    if (published) {
      // Publication is complete. Backup cleanup is deliberately best-effort:
      // a cleanup failure must never roll back valid finals or destroy originals.
      for (const entry of backups) await rm(entry.backup, { force: true }).catch(() => {});
      await rm(journalUpdatePath(directory, token), { force: true }).catch(() => {});
      await rm(journalPath, { force: true }).catch(() => {});
      await syncOutputDirectory(directory);
    }
    await releaseLock();
  }
}

async function resolveApprovedOutputRoots({
  projectRoot,
  allowedOutputRoots = null,
  trustedOutputRoots = [],
} = {}) {
  const root = await resolveProjectRoot(projectRoot);
  const externalRoots = await resolveExistingTrustedRoots(trustedOutputRoots, 'trusted output root');
  const approvedInternalRoots = [];
  for (const pathValue of APPROVED_INTERNAL_OUTPUT_ROOTS) {
    approvedInternalRoots.push(await canonicalizeProspectiveDirectory(resolve(root, pathValue), 'approved output root'));
  }
  const selectedRoots = [];
  const requestedRoots = allowedOutputRoots?.length ? allowedOutputRoots : approvedInternalRoots;
  for (const pathValue of requestedRoots) {
    const raw = assertPathText(pathValue, 'allowed output root');
    const requested = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const absolute = await canonicalizeProspectiveDirectory(requested, 'allowed output root');
    const insideProject = isInside(root, absolute);
    const insideTrustedExternalRoot = externalRoots.some((trustedRoot) => isInside(trustedRoot, absolute));
    const insideApprovedInternalRoot = approvedInternalRoots.some((approvedRoot) => isInside(approvedRoot, absolute));
    if ((!insideProject && !insideTrustedExternalRoot) || (insideProject && !insideApprovedInternalRoot)) {
      throw serviceError(
        'unsafe_allowed_output_root',
        'Allowed output roots must stay under output, tmp/codex, or an explicit trusted tracked-job root'
      );
    }
    selectedRoots.push(absolute);
  }
  return { root, roots: uniqueSorted([...selectedRoots, ...externalRoots]) };
}

async function resolveRevisionImpactOutputTargets(options = {}) {
  const { root, roots } = await resolveApprovedOutputRoots(options);
  const { jsonPath, markdownPath = null } = options;
  let json = await prepareOutputTarget(root, jsonPath, roots, 'revision impact JSON', '.json');
  if (await maybeRecoverInterruptedOutput(dirname(json.target))) {
    json = await prepareOutputTarget(root, jsonPath, roots, 'revision impact JSON', '.json');
  }
  const markdown = markdownPath
    ? await prepareOutputTarget(root, markdownPath, roots, 'revision impact Markdown', '.md')
    : null;
  if (markdown && markdown.target === json.target) {
    throw serviceError('output_path_collision', 'JSON and Markdown outputs must use distinct paths');
  }
  if (markdown && dirname(markdown.target) !== dirname(json.target)) {
    throw serviceError('output_directory_mismatch', 'Revision impact JSON and Markdown must use the same safe output directory');
  }
  return { root, roots, json, markdown };
}

function boundedPreparedContent(content, label) {
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    throw serviceError('output_content_invalid', `${label} content must be a string or Buffer`);
  }
  if (Buffer.byteLength(content) > MAX_PREPARED_OUTPUT_BYTES) {
    throw serviceError('output_content_oversized', `${label} exceeds the prepared output byte limit`);
  }
  return content;
}

async function prepareCompanionOutputTarget(root, roots, companion, outputDirectory) {
  if (!companion || typeof companion !== 'object' || Array.isArray(companion)) {
    throw serviceError('companion_output_invalid', 'Companion output must be an object');
  }
  const label = textOrNull(companion.label) || 'revision impact companion artifact';
  const pathValue = assertPathText(companion.path, `${label} path`);
  const extension = textOrNull(companion.extension)?.toLowerCase() || extname(pathValue).toLowerCase();
  if (!['.json', '.md'].includes(extension)) {
    throw serviceError('output_extension_invalid', `${label} must use a JSON or Markdown extension`);
  }
  const prepared = await prepareOutputTarget(root, pathValue, roots, label, extension);
  if (dirname(prepared.target) !== outputDirectory) {
    throw serviceError('output_directory_mismatch', 'All revision-impact command outputs must use the same safe directory');
  }
  return {
    ...prepared,
    content: boundedPreparedContent(companion.content, label),
  };
}

export async function preflightRevisionImpactArtifactTargets(options = {}) {
  assertValidRevisionImpactReport(options.report, { context: 'revision-impact writer preflight' });
  const { root, roots, json, markdown } = await resolveRevisionImpactOutputTargets(options);
  const jsonContent = canonicalizeRevisionImpactJson(options.report);
  const markdownContent = markdown ? renderRevisionImpactMarkdown(options.report) : null;
  const preparedEntries = [
    Object.freeze({ ...json, content: jsonContent }),
    ...(markdown ? [Object.freeze({ ...markdown, content: markdownContent })] : []),
  ];
  for (const companion of asArray(options.companionArtifacts)) {
    preparedEntries.push(Object.freeze(await prepareCompanionOutputTarget(
      root,
      roots,
      companion,
      dirname(json.target)
    )));
  }
  const targets = preparedEntries.map((entry) => entry.target);
  if (new Set(targets).size !== targets.length) {
    throw serviceError('output_path_collision', 'Revision-impact command outputs must use distinct paths');
  }
  const entries = Object.freeze(preparedEntries);
  const plan = Object.freeze({
    entries,
    jsonPath: json.target,
    markdownPath: markdown?.target || null,
    jsonSha256: sha256Bytes(jsonContent),
    markdownSha256: markdownContent === null ? null : sha256Bytes(markdownContent),
  });
  preparedRevisionImpactPlans.add(plan);
  return plan;
}

export async function writeRevisionImpactArtifacts(options = {}) {
  const plan = options.preparedPlan || await preflightRevisionImpactArtifactTargets(options);
  if (!preparedRevisionImpactPlans.has(plan)) {
    throw serviceError('invalid_prepared_output_plan', 'Revision-impact output plan must come from the trusted preflight');
  }
  const materialized = await materializePreparedOutputTargets(plan.entries);
  try {
    await replacePreparedOutputs(materialized.entries, {
      testFailAfterCommitCount: options.__testFailAfterCommitCount,
      testHardExitAfterCommitCount: options.__testHardExitAfterCommitCount,
      testHardExitBeforeInitialJournalRename: options.__testHardExitBeforeInitialJournalRename,
    });
  } catch (error) {
    await removeCreatedOutputDirectories(materialized.createdDirectories);
    throw error;
  }
  return {
    jsonPath: plan.jsonPath,
    markdownPath: plan.markdownPath,
    jsonSha256: plan.jsonSha256,
    markdownSha256: plan.markdownSha256,
  };
}

export async function createRevisionImpactReportFromPaths(options = {}) {
  const { baseline, candidate } = await loadRevisionImpactInputSet(options);
  const report = buildRevisionImpactReport({ baseline, candidate, generatedAt: options.generatedAt });
  return { report, baseline, candidate };
}
