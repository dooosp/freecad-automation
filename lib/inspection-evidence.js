import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const INSPECTION_EVIDENCE_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/inspection-evidence.schema.json', import.meta.url), 'utf8')
);

const GENERATED_ARTIFACT_TYPES = new Set([
  'create_quality_report',
  'drawing_quality_report',
  'drawing_qa_report',
  'drawing_intent',
  'feature_catalog',
  'dfm_report',
  'readiness_report',
  'review_pack',
]);

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

function semanticErrors(document = {}) {
  const errors = [];
  const artifactType = document?.artifact_type || null;
  const evidenceType = document?.type || null;

  if (GENERATED_ARTIFACT_TYPES.has(artifactType) || GENERATED_ARTIFACT_TYPES.has(evidenceType)) {
    errors.push(`/${artifactType ? 'artifact_type' : 'type'} generated ${artifactType || evidenceType} artifacts are not inspection evidence`);
  }

  for (const key of ['source_ref', 'source_file']) {
    if (document[key] !== undefined && !isPathSafe(document[key])) {
      errors.push(`/${key} must be a safe repo-relative path outside output/ and tmp/codex/`);
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
