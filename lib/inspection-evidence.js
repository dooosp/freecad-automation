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
    'redaction_review',
    'provenance_review',
    'package_mapping_review',
    'intake_review',
    'promotion_dry_run_review',
    'audit_review',
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
    redaction_review: { $ref: '#/$defs/completedReview' },
    provenance_review: { $ref: '#/$defs/completedReview' },
    package_mapping_review: { $ref: '#/$defs/completedReview' },
    intake_review: { $ref: '#/$defs/completedReview' },
    promotion_dry_run_review: { $ref: '#/$defs/completedReview' },
    audit_review: { $ref: '#/$defs/completedReview' },
    later_attachment_task_boundary: { type: 'string', minLength: 1 },
    approved_commands: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    readiness_held_acknowledgement: { type: 'string', minLength: 1 },
    evidence_boundary_acknowledgement: { type: 'string', minLength: 1 },
  },
  $defs: {
    completedReview: {
      type: 'object',
      required: ['status', 'reviewed_by', 'reviewed_at'],
      properties: {
        status: { type: 'string', minLength: 1 },
        reviewed_by: { type: 'string', minLength: 1 },
        reviewed_at: { type: 'string', minLength: 1 },
      },
      additionalProperties: true,
    },
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

const NON_ATTACHABLE_PATH_PATTERNS = [
  /^tests\/fixtures\//i,
  /^schemas\//i,
  /^\.github\//i,
  /^docs\/inspection-evidence-collection\//i,
  /^docs\/(?!examples\/[^/]+\/inspection\/).+\.(?:md|markdown|txt)$/i,
  /(^|\/)(?:comment|review-comment|pr-body|pull-request-body|issue-body)\.(?:json|md|markdown|txt)$/i,
  /(^|\/)(?:candidate-gate-report|stage5b-candidate-gate-report|stage5b_candidate_gate_report)\.json$/i,
  /(^|\/)(?:intake_report|inspection-evidence-intake-report)\.json$/i,
  /(^|\/)promotion_dry_run_manifest\.json$/i,
  /(^|\/)stage5b_audit_manifest\.json$/i,
  /(^|\/)stage5b_audit_summary\.md$/i,
  /(^|\/)validation_diagnostics\.json$/i,
  /(^|\/)(?:stage-5b-)?attachment-authorization-record\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)attachment_authorization_record\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /\.(?:png|jpe?g|gif|webp|heic|tiff?)$/i,
  /(^|\/)(?:template|templates|sample|example)[^/]*\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)(?:github|ci|check-run|workflow|actions?)[-_]?(?:metadata|summary|run|comment|pr-body|pull-request-body|artifact)\.(?:json|md|txt|yml|yaml)$/i,
];

const ACCEPTED_SOURCE_TYPES = new Set([
  'cmm_report',
  'manual_caliper_check',
  'go_no_go_gauge',
  'first_article_inspection',
  'supplier_inspection_report',
  'other_inspection_source',
]);

const ACCEPTED_COMPLETION_STATUSES = new Set([
  'complete',
  'completed',
  'closed',
  'final',
  'released',
  'approved',
]);

const ACCEPTED_OVERALL_RESULTS = new Set(['pass', 'fail', 'partial']);
const ACCEPTED_OTHER_ORIGINS = new Set(['physical', 'supplier', 'lab', 'qa', 'quality', 'quality_assurance']);

const NON_GENUINE_TEXT_PATTERN = /synthetic|fixture|template|example only|collection guide|generated|simulated|inferred|cad-generated|non[-/ ]?evidence|not readiness evidence|not canonical package readiness evidence|not package readiness evidence/i;
const CAD_GENERATED_METHOD_PATTERN = /cad|freecad|model|geometry|drawing|techdraw|simulated|synthetic|inferred/i;

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

function isNonAttachablePath(pathValue) {
  const normalized = normalizeGeneratedArtifactValue(pathValue).replaceAll('\\', '/');
  if (!normalized) return false;
  return isGeneratedArtifactPath(normalized)
    || NON_ATTACHABLE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function firstString(document, fields = []) {
  for (const field of fields) {
    const value = document?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hasAnyString(document, fields = []) {
  return Boolean(firstString(document, fields));
}

function normalizedToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hasCompletedStatus(document = {}) {
  const raw = firstString(document, ['inspection_status', 'status', 'completion_status', 'record_status']);
  return raw ? ACCEPTED_COMPLETION_STATUSES.has(normalizedToken(raw)) : false;
}

function hasRevisionMapping(document = {}) {
  return hasAnyString(document, [
    'revision',
    'part_revision',
    'drawing_revision',
    'package_revision',
    'inspected_revision',
  ]);
}

function hasReviewerTraceability(document = {}) {
  return hasAnyString(document, [
    'reviewed_by',
    'approved_by',
    'qa_reviewer',
    'reviewer',
    'quality_reviewer',
  ]) || (Array.isArray(document.reviewer_traceability) && document.reviewer_traceability.length > 0);
}

function documentText(document = {}) {
  return [
    document.notes,
    document.description,
    document.summary,
    document.source_description,
    document.inspected_part,
    document.package_id,
    document.source_ref,
    document.source_file,
    document.inspector,
    document.inspection_author,
  ].filter((value) => typeof value === 'string').join('\n');
}

function isCadGeneratedMeasurement(feature = {}) {
  const method = String(feature?.measurement_method || '');
  const source = String(feature?.measurement_source || feature?.source || '');
  return CAD_GENERATED_METHOD_PATTERN.test(method) || CAD_GENERATED_METHOD_PATTERN.test(source);
}

function canonicalPackageSlugFromPath(pathValue) {
  const match = normalizeRef(pathValue).match(/^docs\/examples\/([^/]+)\/inspection\//);
  return match ? match[1] : null;
}

function sourceRefValue(document = {}) {
  return firstString(document, ['source_ref', 'source_file']);
}

function attachableSemanticErrors(document = {}, options = {}) {
  const errors = [];
  const evidencePath = normalizeRef(options.evidencePath || options.path || '');
  const expectedPackageSlug = options.expectedPackageSlug || canonicalPackageSlugFromPath(evidencePath);
  const sourceRef = sourceRefValue(document);

  if (evidencePath && !/^docs\/examples\/[^/]+\/inspection\/[^/]+\.json$/i.test(evidencePath)) {
    errors.push('/path must be under docs/examples/<package>/inspection/ for direct attachment');
  }
  if (evidencePath && isNonAttachablePath(evidencePath)) {
    errors.push('/path points at a fixture, schema, docs/control, generated, screenshot, CI, release, or other non-evidence artifact');
  }
  if (sourceRef && isNonAttachablePath(sourceRef)) {
    errors.push('/source_ref points at a fixture, schema, docs/control, generated, screenshot, CI, release, or other non-evidence artifact');
  }
  if (sourceRef && expectedPackageSlug && !sourceRef.startsWith(`docs/examples/${expectedPackageSlug}/inspection/`)) {
    errors.push('/source_ref must stay under the same canonical package inspection directory');
  }
  if (expectedPackageSlug) {
    const packageToken = normalizedToken(expectedPackageSlug);
    const packageValues = [document.package_id, document.inspected_part].map(normalizedToken);
    if (!packageValues.includes(packageToken)) {
      errors.push('/package_id or /inspected_part must map to the canonical package slug');
    }
  }
  if (!ACCEPTED_SOURCE_TYPES.has(String(document.source_type || ''))) {
    errors.push('/source_type must identify a physical, supplier, lab, or QA inspection origin');
  }
  if (document.source_type === 'other_inspection_source') {
    const origin = normalizedToken(firstString(document, ['origin_category', 'inspection_origin', 'source_origin']));
    if (!ACCEPTED_OTHER_ORIGINS.has(origin)) {
      errors.push('/origin_category must identify physical, supplier, lab, or QA origin for other_inspection_source');
    }
  }
  if (!hasCompletedStatus(document)) {
    errors.push('/inspection_status must be completed, final, closed, released, or approved');
  }
  if (!hasAnyString(document, ['inspector', 'inspection_author'])) {
    errors.push('/inspector or /inspection_author traceability is required');
  }
  if (!hasReviewerTraceability(document)) {
    errors.push('/reviewed_by, /approved_by, /qa_reviewer, /reviewer, or reviewer_traceability is required');
  }
  if (!hasRevisionMapping(document)) {
    errors.push('/revision, /part_revision, /drawing_revision, /package_revision, or /inspected_revision is required');
  }
  if (!ACCEPTED_OVERALL_RESULTS.has(String(document.overall_result || ''))) {
    errors.push('/overall_result must be pass, fail, or partial for attachment');
  }
  if (NON_GENUINE_TEXT_PATTERN.test(documentText(document))) {
    errors.push('/notes or provenance text marks the record as synthetic, fixture, template, generated, simulated, inferred, or non-evidence');
  }
  const generatedFeatures = Array.isArray(document.measured_features)
    ? document.measured_features.filter(isCadGeneratedMeasurement)
    : [];
  if (generatedFeatures.length > 0) {
    errors.push('/measured_features measurement_method must come from physical/supplier/lab/QA inspection, not CAD, FreeCAD, drawing, simulated, inferred, or generated measurements');
  }
  return errors;
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

export function validateAttachableInspectionEvidence(document, options = {}) {
  const validation = validateInspectionEvidence(document);
  const errors = [
    ...validation.errors,
    ...attachableSemanticErrors(document, options),
  ];
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

export function assertAttachableInspectionEvidence(document, options = {}) {
  const validation = validateAttachableInspectionEvidence(document, options);
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

  const expectedPackageSlug = options.expectedPackageSlug || null;
  if (expectedPackageSlug && document.package_slug !== expectedPackageSlug) {
    errors.push(`/package_slug must match the supplied inspection evidence package (${expectedPackageSlug})`);
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

  for (const key of [
    'redaction_review',
    'provenance_review',
    'package_mapping_review',
    'intake_review',
    'promotion_dry_run_review',
    'audit_review',
  ]) {
    const review = document[key];
    if (!review || typeof review !== 'object' || Array.isArray(review)) continue;
    const status = String(review.status || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!ACCEPTED_COMPLETION_STATUSES.has(status)) {
      errors.push(`/${key}/status must be complete, completed, final, closed, released, or approved`);
    }
    if (typeof review.reviewed_by === 'string' && /^unknown|null|n\/a$/i.test(review.reviewed_by.trim())) {
      errors.push(`/${key}/reviewed_by must name an explicit human reviewer`);
    }
    if (typeof review.reviewed_at === 'string' && Number.isNaN(Date.parse(review.reviewed_at))) {
      errors.push(`/${key}/reviewed_at must be parseable date/time text`);
    }
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
