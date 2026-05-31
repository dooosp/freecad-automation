import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const INSPECTION_EVIDENCE_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/inspection-evidence.schema.json', import.meta.url), 'utf8')
);

const ATTACHMENT_AUTHORIZATION_SCHEMA = Object.freeze({
  type: 'object',
  required: [
    'schema_version',
    'record_type',
    'authorized_attachment',
    'package_slug',
    'reviewed_redacted_evidence_json_ref',
    'candidate_gate_report_ref',
    'intake_report_ref',
    'promotion_dry_run_ref',
    'audit_output_ref',
    'human_authorizer',
    'authorized_at',
    'later_attachment_task_boundary',
    'approved_commands',
    'readiness_held_acknowledgement',
    'evidence_boundary_acknowledgement',
  ],
  properties: {
    schema_version: { const: '1.0' },
    record_type: { const: 'stage5b_attachment_authorization' },
    authorized_attachment: { const: true },
    package_slug: { type: 'string', minLength: 1 },
    reviewed_redacted_evidence_json_ref: { type: 'string', minLength: 1 },
    candidate_gate_report_ref: { type: 'string', minLength: 1 },
    intake_report_ref: { type: 'string', minLength: 1 },
    promotion_dry_run_ref: { type: 'string', minLength: 1 },
    audit_output_ref: { type: 'string', minLength: 1 },
    human_authorizer: { type: 'string', minLength: 1 },
    authorized_at: { type: 'string', minLength: 1 },
    later_attachment_task_boundary: { type: 'string', minLength: 1 },
    approved_commands: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    readiness_held_acknowledgement: { type: 'string', minLength: 1 },
    evidence_boundary_acknowledgement: { type: 'string', minLength: 1 },
  },
  additionalProperties: true,
});

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
const validateAuthorizationSchema = ajv.compile(ATTACHMENT_AUTHORIZATION_SCHEMA);

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
  if (
    normalized === 'local/stage5b-candidate-evidence-inbox'
    || normalized.startsWith('local/stage5b-candidate-evidence-inbox/')
  ) return false;
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

export class AttachmentAuthorizationValidationError extends Error {
  constructor(errors, options = {}) {
    const pathLabel = options.path ? ` (${options.path})` : '';
    super(`Stage 5B attachment authorization validation failed${pathLabel}: ${errors.join(' | ')}`);
    this.name = 'AttachmentAuthorizationValidationError';
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

function normalizeRef(value) {
  return typeof value === 'string' ? value.trim().replaceAll('\\', '/') : '';
}

function validateAttachmentAuthorizationSemantics(document = {}, options = {}) {
  const errors = [];
  const expectedRef = normalizeRef(options.expectedInspectionEvidenceRef);
  const reviewedRef = normalizeRef(document.reviewed_redacted_evidence_json_ref);

  for (const key of [
    'reviewed_redacted_evidence_json_ref',
    'candidate_gate_report_ref',
    'intake_report_ref',
    'promotion_dry_run_ref',
    'audit_output_ref',
  ]) {
    const refValue = normalizeRef(document[key]);
    if (!refValue) continue;
    if (refValue !== document[key]) {
      errors.push(`/${key} must use normalized forward-slash path text`);
    }
    if (isAbsolute(refValue) || /^[A-Za-z]:/.test(refValue) || refValue.split('/').includes('..')) {
      errors.push(`/${key} must be a safe relative control reference`);
    }
    if (
      refValue === 'local/stage5b-candidate-evidence-inbox'
      || refValue.startsWith('local/stage5b-candidate-evidence-inbox/')
    ) {
      errors.push(`/${key} must not expose ignored local inbox records`);
    }
  }

  if (expectedRef && reviewedRef && reviewedRef !== expectedRef) {
    errors.push(`/reviewed_redacted_evidence_json_ref must match the supplied inspection evidence path (${expectedRef})`);
  }

  if (typeof document.human_authorizer === 'string' && /^unknown|null|n\/a$/i.test(document.human_authorizer.trim())) {
    errors.push('/human_authorizer must name an explicit human authorizer');
  }

  if (typeof document.authorized_at === 'string' && Number.isNaN(Date.parse(document.authorized_at))) {
    errors.push('/authorized_at must be parseable date/time text');
  }

  const approvedCommands = Array.isArray(document.approved_commands) ? document.approved_commands.join('\n') : '';
  if (!/review-context\b[\s\S]*--inspection-evidence\b/i.test(approvedCommands)) {
    errors.push('/approved_commands must explicitly authorize review-context --inspection-evidence');
  }

  const readinessAck = String(document.readiness_held_acknowledgement || '');
  if (!/needs_more_evidence/i.test(readinessAck) || !/hold_for_evidence_completion/i.test(readinessAck)) {
    errors.push('/readiness_held_acknowledgement must preserve needs_more_evidence / hold_for_evidence_completion truth');
  }

  const boundaryAck = String(document.evidence_boundary_acknowledgement || '');
  if (!/Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/i.test(boundaryAck)) {
    errors.push('/evidence_boundary_acknowledgement must restate the hard inspection_evidence rule');
  }

  return errors;
}

export function validateAttachmentAuthorization(document, options = {}) {
  const schemaOk = validateAuthorizationSchema(document);
  const errors = schemaOk ? [] : formatSchemaErrors(validateAuthorizationSchema.errors || []);
  errors.push(...validateAttachmentAuthorizationSemantics(document, options));
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertValidAttachmentAuthorization(document, options = {}) {
  const validation = validateAttachmentAuthorization(document, options);
  if (!validation.ok) {
    throw new AttachmentAuthorizationValidationError(validation.errors, options);
  }
  return document;
}
