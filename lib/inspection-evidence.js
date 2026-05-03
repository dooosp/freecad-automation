import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const INSPECTION_EVIDENCE_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/inspection-evidence.schema.json', import.meta.url), 'utf8')
);

const GENERATED_ARTIFACT_TYPES = new Set([
  'create_quality_report',
  'create_quality',
  'model.quality-summary',
  'drawing_quality_report',
  'drawing_quality',
  'drawing.quality-summary',
  'drawing_qa_report',
  'drawing_qa',
  'drawing.qa-report',
  'drawing.qa-issues',
  'drawing_intent',
  'drawing-intent.json',
  'extracted_drawing_semantics',
  'drawing.extracted-semantics',
  'feature_catalog',
  'feature-catalog.json',
  'dfm_report',
  'tolerance_report',
  'tolerance_analysis',
  'tolerance_stackup',
  'runtime_smoke',
  'runtime_smoke_report',
  'readiness_report',
  'readiness-report.json',
  'review_pack',
  'review-pack.json',
  'docs_manifest',
  'standard_docs_manifest',
  'standard-docs.summary',
  'docs_document',
  'release_bundle',
  'release-bundle.zip',
  'release_bundle_manifest',
  'release-bundle.manifest.json',
  'release_bundle_log',
  'release-bundle.log.json',
  'release_bundle_checksums',
  'release-bundle.checksums',
  'package_artifact',
  'canonical_package',
  'package_manifest',
  'canonical_package_manifest',
  'artifact_manifest',
  'output_manifest',
  'output.manifest.json',
  'drawing.output-manifest.json',
]);

const GENERATED_ARTIFACT_TYPE_PATTERNS = [
  /^standard-docs\./,
  /^release-bundle\./,
  /^review-pack\./,
  /^readiness-report\./,
  /^input\.(?:docs-manifest|readiness-report|release-bundle|review-pack)$/,
];

const GENERATED_ARTIFACT_PATH_PATTERNS = [
  /(^|\/)[^/]*_create_quality\.json$/i,
  /(^|\/)[^/]*_drawing_quality\.json$/i,
  /(^|\/)[^/]*_drawing_qa\.json$/i,
  /(^|\/)[^/]*_drawing_intent\.json$/i,
  /(^|\/)[^/]*_extracted_drawing_semantics\.json$/i,
  /(^|\/)[^/]*_feature_catalog\.json$/i,
  /(^|\/)[^/]*_tolerance(?:_analysis|_stackup|_report)?\.(?:csv|json)$/i,
  /(^|\/)[^/]*runtime_smoke[^/]*\.(?:csv|json|pdf|step|stl|brep)$/i,
  /(^|\/)(?:artifact-manifest|output-manifest)\.json$/i,
  /(^|\/)[^/]*_artifact-manifest\.json$/i,
  /(^|\/)[^/]*(?:runtime_smoke|drawing|tolerance|create|output)_manifest\.json$/i,
  /(^|\/)[^/]*_output_manifest\.json$/i,
  /(^|\/)(?:review_pack|review-pack)\.(?:json|md|pdf)$/i,
  /(^|\/)(?:readiness_report|readiness-report)\.(?:json|md|pdf)$/i,
  /(^|\/)standard_docs_manifest\.json$/i,
  /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i,
  /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i,
  /(^|\/)(?:package_manifest|canonical_package_manifest|canonical-package-manifest)\.json$/i,
];

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const validateSchema = ajv.compile(INSPECTION_EVIDENCE_SCHEMA);

export const INSPECTION_EVIDENCE_SCHEMA_VERSION = '1.0';

function normalizeInstancePath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${normalizeInstancePath(error)} ${error.message}`.trim());
}

function isPathSafe(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return false;
  const normalized = pathValue.trim().replaceAll('\\', '/');
  if (normalized !== pathValue.trim()) return false;
  if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) return false;
  if (normalized === 'output' || normalized.startsWith('output/')) return false;
  if (normalized === 'tmp/codex' || normalized.startsWith('tmp/codex/')) return false;
  return !normalized.split('/').includes('..');
}

function normalizeGeneratedArtifactValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isGeneratedArtifactType(value) {
  const normalized = normalizeGeneratedArtifactValue(value);
  if (!normalized) return false;
  return GENERATED_ARTIFACT_TYPES.has(normalized)
    || GENERATED_ARTIFACT_TYPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isGeneratedArtifactPath(pathValue) {
  const normalized = normalizeGeneratedArtifactValue(pathValue).replaceAll('\\', '/');
  if (!normalized) return false;
  return GENERATED_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function semanticErrors(document = {}) {
  const errors = [];

  for (const key of ['artifact_type', 'type']) {
    const value = document[key];
    if (isGeneratedArtifactType(value)) {
      errors.push(`/${key} generated ${value} artifacts are not inspection evidence`);
    }
  }

  for (const key of ['source_ref', 'source_file']) {
    if (document[key] !== undefined && !isPathSafe(document[key])) {
      errors.push(`/${key} must be a safe repo-relative path outside output/ and tmp/codex/`);
    } else if (isGeneratedArtifactPath(document[key])) {
      errors.push(`/${key} must not point at a generated artifact path`);
    }
  }

  return errors;
}

export function validateInspectionEvidence(document) {
  const schemaOk = validateSchema(document);
  const errors = schemaOk ? [] : formatSchemaErrors(validateSchema.errors || []);
  errors.push(...semanticErrors(document));
  return {
    ok: errors.length === 0,
    errors,
  };
}

export class InspectionEvidenceValidationError extends Error {
  constructor(errors, options = {}) {
    const pathLabel = options.path ? ` (${options.path})` : '';
    super(`Inspection evidence validation failed${pathLabel}: ${errors.join(' | ')}`);
    this.name = 'InspectionEvidenceValidationError';
    this.errors = errors;
    this.path = options.path || null;
  }
}

export function assertValidInspectionEvidence(document, options = {}) {
  const validation = validateInspectionEvidence(document);
  if (!validation.ok) {
    throw new InspectionEvidenceValidationError(validation.errors, options);
  }
  return document;
}
