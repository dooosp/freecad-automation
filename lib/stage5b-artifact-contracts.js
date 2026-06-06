import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const COMMON_SCHEMA = readSchema('../schemas/stage5b-artifact-common.schema.json');
const CANDIDATE_GATE_REPORT_SCHEMA = readSchema('../schemas/stage5b-candidate-gate-report.schema.json');
const REVIEW_DRY_RUN_MANIFEST_SCHEMA = readSchema('../schemas/stage5b-evidence-review-dry-run-manifest.schema.json');
const ATTACHMENT_CONTROL_MANIFEST_SCHEMA = readSchema('../schemas/stage5b-evidence-attachment-control-manifest.schema.json');
const PIPELINE_DOCTOR_MANIFEST_SCHEMA = readSchema('../schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json');
const INTAKE_SCHEMA = readSchema('../schemas/stage5b-intake-report.schema.json');
const PROMOTION_DRY_RUN_SCHEMA = readSchema('../schemas/stage5b-promotion-dry-run-manifest.schema.json');
const AUDIT_MANIFEST_SCHEMA = readSchema('../schemas/stage5b-audit-manifest.schema.json');
const SURROGATE_INSPECTION_VALIDATION_SCHEMA = readSchema('../schemas/stage5b-surrogate-inspection-validation.schema.json');

const GENERATED_ARTIFACT_PATH_PATTERNS = Object.freeze([
  /(^|\/)[^/]*_create_quality\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_quality\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_qa\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_intent\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_extracted_drawing_semantics\.json$/i,
  /(^|\/)[^/]*_feature_catalog\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_dfm_report\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)(?:review_pack|review-pack)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i,
  /(^|\/)(?:readiness_report|readiness-report)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i,
  /(^|\/)standard_docs_manifest\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i,
  /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i,
  /(^|\/)(?:artifact-manifest|output-manifest)\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)(?:intake_report|inspection-evidence-intake-report)\.json$/i,
  /(^|\/)promotion_dry_run_manifest\.json$/i,
  /(^|\/)stage5b_audit_manifest\.json$/i,
  /(^|\/)stage5b_audit_summary\.md$/i,
  /(^|\/)validation_diagnostics\.json$/i,
  /(^|\/)(?:stage-5b-)?attachment-authorization-record\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)attachment_authorization_record\.(?:json|csv|tsv|md|markdown|txt)$/i,
]);

const REQUIRED_NON_EVIDENCE_TERMS = Object.freeze([
  /generated/i,
  /fixtures?/i,
  /templates?/i,
  /collection guides?/i,
  /release bundles?/i,
  /intake reports?/i,
  /dry-run manifests?/i,
  /audit manifests?/i,
]);

const OUTPUT_ARTIFACT_TYPES = Object.freeze({
  intake_report: 'inspection_evidence_intake_report',
  promotion_dry_run_manifest: 'inspection_evidence_promotion_dry_run_manifest',
  stage5b_audit_manifest: 'stage5b_evidence_audit_manifest',
  stage5b_audit_summary: 'stage5b_evidence_audit_summary_markdown',
});

const HARD_EVIDENCE_BOUNDARY_NOTE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const CANDIDATE_GATE_PASSING_MEANING = 'eligible for later Stage 5B intake review only';

const STAGE5B_ARTIFACT_SCHEMA_CATALOG = Object.freeze([
  Object.freeze({
    id: 'stage5b_evidence_request_packet',
    surface: 'Stage 5B evidence request packet',
    producer: 'Maintainer-authored Markdown request and checklist control document.',
    schema_or_contract: 'docs/stage-5b-evidence-request-packet.md plus docs/inspection-evidence-contract.md.',
    schema_path: null,
    location_pattern: 'docs/stage-5b-evidence-request-packet.md',
    preview_boundary: 'Tracked documentation preview only. It must not include raw records, private URLs, PII, or supplier/lab/QA records.',
    control_private_status: 'Tracked public control document. Private candidate records stay outside this file.',
    inspection_evidence_status: 'Not inspection_evidence. It requests genuine records but is not a record.',
    readiness_effect: 'No readiness change. It preserves needs_more_evidence / hold_for_evidence_completion until genuine evidence is later validated, reviewed, and attached.',
  }),
  Object.freeze({
    id: 'stage5b_candidate_gate_report',
    surface: 'Candidate gate report',
    producer: 'node scripts/stage5b-candidate-evidence-gate.js via lib/stage5b-candidate-evidence-gate.js.',
    schema_or_contract: 'schemas/stage5b-candidate-gate-report.schema.json and validateStage5bCandidateGateReport.',
    schema_path: 'schemas/stage5b-candidate-gate-report.schema.json',
    location_pattern: 'local/stage5b-candidate-evidence-inbox/<package-slug>/candidate-gate-report.json or another explicit --out report path.',
    preview_boundary: 'Local review only by default. Do not publish or preview private inbox reports unless a later task explicitly authorizes a redacted control artifact.',
    control_private_status: 'Local/private control report when staged in the ignored inbox. It may describe private candidate metadata.',
    inspection_evidence_status: 'Not inspection_evidence. Accept means eligible for later Stage 5B intake review only.',
    readiness_effect: 'No readiness change. It does not attach evidence, promote evidence, satisfy readiness, or mutate canonical artifacts; accepted reports still require the pre-attachment checklist before any later authorized intake, dry-run, audit, or attachment task.',
  }),
  Object.freeze({
    id: 'stage5b_evidence_review_dry_run_manifest',
    surface: 'stage5b_evidence_review_dry_run_manifest.json',
    producer: 'fcad stage5b-evidence-review-dry-run via src/services/inspection-evidence-intake/stage5b-evidence-review-dry-run-service.js.',
    schema_or_contract: 'schemas/stage5b-evidence-review-dry-run-manifest.schema.json and validateStage5bEvidenceReviewDryRunManifest.',
    schema_path: 'schemas/stage5b-evidence-review-dry-run-manifest.schema.json',
    location_pattern: '<ignored --out-dir>/stage5b_evidence_review_dry_run_manifest.json, with local preflight, review-candidate, candidate-gate, and audit control outputs beside it.',
    preview_boundary: 'CLI/local review only. Output directories must be ignored by git and must not publish raw inbox records, private URLs, PII, supplier/lab/QA originals, or secrets.',
    control_private_status: 'Local/private orchestration control manifest. It may summarize source status and redaction findings, but the raw source stays in the ignored inbox and the review candidate is not canonical evidence.',
    inspection_evidence_status: 'Not inspection_evidence. It chains preflight, redaction planning, candidate gate, intake/dry-run/audit planning, and readiness-held reporting without attachment.',
    readiness_effect: 'No readiness change. It must keep evidence_attached false, canonical readiness unregenerated, packages unmarked-ready, and needs_more_evidence / hold_for_evidence_completion until a later authorized attachment task.',
  }),
  Object.freeze({
    id: 'stage5b_attachment_authorization_record',
    surface: 'Stage 5B attachment authorization record',
    producer: 'Maintainer-authored Markdown authorization checklist/control metadata.',
    schema_or_contract: 'docs/stage-5b-attachment-authorization-record.md plus docs/inspection-evidence-contract.md.',
    schema_path: null,
    location_pattern: 'docs/stage-5b-attachment-authorization-record.md as a template, plus a later safe repo-relative reviewed/redacted authorization JSON when canonical attachment is explicitly authorized.',
    preview_boundary: 'Tracked documentation preview only. It must not include raw records, private URLs, PII, supplier/lab/QA records, or private machine paths.',
    control_private_status: 'Control metadata template. Private authorization details and candidate records stay outside this file unless a later task explicitly authorizes a safe repo-relative reviewed/redacted control record.',
    inspection_evidence_status: 'Not inspection_evidence. It records authorization prerequisites and human approval scope; it does not attach or promote evidence.',
    readiness_effect: 'No readiness change. It preserves needs_more_evidence / hold_for_evidence_completion until a later authorized attachment task validates, reviews, attaches genuine evidence, and refreshes package artifacts.',
  }),
  Object.freeze({
    id: 'stage5b_evidence_attachment_control_manifest',
    surface: 'stage5b_evidence_attachment_control_manifest.json',
    producer: 'fcad stage5b-evidence-attachment-controller via src/services/inspection-evidence-intake/stage5b-evidence-attachment-controller-service.js.',
    schema_or_contract: 'schemas/stage5b-evidence-attachment-control-manifest.schema.json and validateStage5bEvidenceAttachmentControlManifest.',
    schema_path: 'schemas/stage5b-evidence-attachment-control-manifest.schema.json',
    location_pattern: '<ignored --out-dir>/stage5b_evidence_attachment_control_manifest.json.',
    preview_boundary: 'CLI/local control output only. It must not publish raw inbox records, private URLs, PII, supplier/lab/QA originals, or secrets.',
    control_private_status: 'Local/private authorization-control manifest. It verifies prerequisites for a later explicit attachment task without copying raw sources or attaching evidence.',
    inspection_evidence_status: 'Not inspection_evidence. It proves whether a future explicit attachment attempt is blocked or dry-run-ready; it never attaches evidence.',
    readiness_effect: 'No readiness change. It must keep evidence_attached false, canonical readiness unregenerated, packages unmarked-ready, and needs_more_evidence / hold_for_evidence_completion until a later authorized attachment/regeneration task.',
  }),
  Object.freeze({
    id: 'stage5b_evidence_pipeline_doctor_manifest',
    surface: 'stage5b_evidence_pipeline_doctor_manifest.json',
    producer: 'fcad stage5b-evidence-pipeline-doctor via src/services/inspection-evidence-intake/stage5b-evidence-pipeline-doctor-service.js.',
    schema_or_contract: 'schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json and validateStage5bEvidencePipelineDoctorManifest.',
    schema_path: 'schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json',
    location_pattern: '<ignored --out-dir>/stage5b_evidence_pipeline_doctor_manifest.json, with fixture-only source kit, source-preflight, surrogate, review dry-run, attachment-controller, and non-evidence guard outputs under the same ignored directory.',
    preview_boundary: 'CLI/local diagnostic output only. It must use repo-local fixture/surrogate/non-evidence inputs and must not publish raw inbox records, private URLs, PII, supplier/lab/QA originals, or secrets.',
    control_private_status: 'Local fixture-only control manifest. It may summarize command drift, schema/catalog/doc/CI/npm checks, readiness-held truth, and fail-closed blockers, but raw inbox files stay ignored and untracked.',
    inspection_evidence_status: 'Not inspection_evidence. It proves the no-real-evidence Stage 5B pipeline remains wired without attachment, promotion, readiness regeneration, or package readiness changes.',
    readiness_effect: 'No readiness change. It must keep evidence_attached false, canonical readiness unregenerated, packages unmarked-ready, and needs_more_evidence / hold_for_evidence_completion until a later explicit real attachment/regeneration goal.',
  }),
  Object.freeze({
    id: 'stage5b_surrogate_inspection_validation',
    surface: 'surrogate_inspection_validation.json',
    producer: 'fcad stage5b-surrogate-inspection-validation via src/services/inspection-evidence-intake/stage5b-surrogate-inspection-validation-service.js.',
    schema_or_contract: 'schemas/stage5b-surrogate-inspection-validation.schema.json and validateStage5bSurrogateInspectionValidation.',
    schema_path: 'schemas/stage5b-surrogate-inspection-validation.schema.json',
    location_pattern: '<explicit --out-dir>/surrogate_inspection_validation.json, with a nested canonical no-evidence audit bundle under <out-dir>/canonical_evidence_audit/.',
    preview_boundary: 'CLI/local validation output only. It is not a browser-tracked artifact surface and must not publish raw records, private URLs, PII, or supplier/lab/QA records.',
    control_private_status: 'Synthetic/surrogate control artifact generated from repo-local public specs only. It must label every representative value as surrogate non-evidence.',
    inspection_evidence_status: 'Not inspection_evidence. It validates parser, redaction, mapping, gate, audit, and messaging automation only.',
    readiness_effect: 'Non-mutating. It must keep evidence_attached false, product inspection readiness false, and readiness held at needs_more_evidence / hold_for_evidence_completion.',
  }),
  Object.freeze({
    id: 'inspection_evidence_intake_report',
    surface: 'intake_report.json',
    producer: 'fcad inspection-evidence-intake, or fcad stage5b-evidence-audit when it runs the intake step.',
    schema_or_contract: 'schemas/stage5b-intake-report.schema.json and validateStage5bIntakeReport.',
    schema_path: 'schemas/stage5b-intake-report.schema.json',
    location_pattern: '<explicit --out report.json> or <stage5b-audit-out-dir>/intake_report.json.',
    preview_boundary: 'CLI output path for local review. Studio/API preview is limited to registered tracked artifacts such as inspection-evidence.intake-report, never arbitrary browser-supplied local paths.',
    control_private_status: 'Control and discovery artifact with sanitized provenance. It must not contain raw private records or secrets.',
    inspection_evidence_status: 'Not inspection_evidence. It classifies candidates and records rejection or attachment-plan metadata only.',
    readiness_effect: 'Non-mutating. Without genuine attachment-ready evidence, packages remain needs_more_evidence / hold_for_evidence_completion.',
  }),
  Object.freeze({
    id: 'inspection_evidence_promotion_dry_run_manifest',
    surface: 'promotion_dry_run_manifest.json',
    producer: 'fcad inspection-evidence-promotion-dry-run, or fcad stage5b-evidence-audit when it runs the dry-run step.',
    schema_or_contract: 'schemas/stage5b-promotion-dry-run-manifest.schema.json and validateStage5bPromotionDryRunManifest.',
    schema_path: 'schemas/stage5b-promotion-dry-run-manifest.schema.json',
    location_pattern: '<explicit --out promotion_dry_run_manifest.json> or <stage5b-audit-out-dir>/promotion_dry_run_manifest.json.',
    preview_boundary: 'CLI output path for local review. Studio/API preview is limited to registered tracked artifacts such as inspection-evidence.promotion-dry-run-manifest.',
    control_private_status: 'Planning/control artifact. It lists future commands and mutation boundaries without committing candidate records.',
    inspection_evidence_status: 'Not inspection_evidence. It is a plan for a possible later authorized promotion, not an attached record.',
    readiness_effect: 'Non-mutating dry run. If promotion_can_run is false, readiness remains needs_more_evidence / hold_for_evidence_completion.',
  }),
  Object.freeze({
    id: 'stage5b_evidence_audit_manifest',
    surface: 'stage5b_audit_manifest.json',
    producer: 'fcad stage5b-evidence-audit via src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js.',
    schema_or_contract: 'schemas/stage5b-audit-manifest.schema.json and validateStage5bAuditManifest.',
    schema_path: 'schemas/stage5b-audit-manifest.schema.json',
    location_pattern: '<stage5b-audit-out-dir>/stage5b_audit_manifest.json.',
    preview_boundary: 'CLI audit output path for local review. Studio/API preview is limited to the registered stage5b.evidence-audit-manifest artifact.',
    control_private_status: 'Control manifest linking the audit bundle by repo-relative path and hash. It must carry sanitized refs only.',
    inspection_evidence_status: 'Not inspection_evidence. It summarizes the audit and evidence boundary only.',
    readiness_effect: 'Non-mutating. It records the readiness-held truth and must not claim production readiness.',
  }),
  Object.freeze({
    id: 'stage5b_evidence_audit_summary',
    surface: 'stage5b_audit_summary.md',
    producer: 'fcad stage5b-evidence-audit via src/services/inspection-evidence-intake/stage5b-evidence-audit-service.js.',
    schema_or_contract: 'Markdown semantic contract enforced by validateStage5bAuditSummaryMarkdown.',
    schema_path: null,
    location_pattern: '<stage5b-audit-out-dir>/stage5b_audit_summary.md.',
    preview_boundary: 'CLI audit output path for local review. Studio/API preview is limited to the registered stage5b.evidence-audit-summary artifact.',
    control_private_status: 'Markdown control summary. It must summarize only sanitized audit status and boundaries.',
    inspection_evidence_status: 'Not inspection_evidence. It is a human-readable audit summary.',
    readiness_effect: 'No readiness change. It must state whether readiness remains held and preserve the hard evidence boundary.',
  }),
  Object.freeze({
    id: 'stage5b_validation_diagnostics',
    surface: 'validation_diagnostics.json',
    producer: 'Stage5bRuntimeValidationError diagnostics via src/services/inspection-evidence-intake/stage5b-runtime-validation.js.',
    schema_or_contract: 'buildStage5bValidationDiagnosticsPayload shape and sanitized diagnostics contract in stage5b-runtime-validation.js.',
    schema_path: null,
    location_pattern: 'Beside a failed requested output path, or output/jobs/<job-id>/artifacts/validation_diagnostics.json for tracked jobs.',
    preview_boundary: 'Sanitized diagnostics only. Studio/API preview is limited to registered stage5b.validation-diagnostics artifacts and redacts secrets, private URLs, and absolute paths.',
    control_private_status: 'Control/debug metadata. It must not expose raw logs, credentials, private records, or unredacted source paths.',
    inspection_evidence_status: 'Not inspection_evidence. Diagnostics explain malformed control artifacts or unsafe inputs.',
    readiness_effect: 'No readiness change. It blocks or explains validation failure without attaching evidence or mutating canonical package artifacts.',
  }),
]);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

ajv.addSchema(COMMON_SCHEMA, COMMON_SCHEMA.$id);

const validateCandidateGateReportSchema = ajv.compile(CANDIDATE_GATE_REPORT_SCHEMA);
const validateReviewDryRunManifestSchema = ajv.compile(REVIEW_DRY_RUN_MANIFEST_SCHEMA);
const validateAttachmentControlManifestSchema = ajv.compile(ATTACHMENT_CONTROL_MANIFEST_SCHEMA);
const validatePipelineDoctorManifestSchema = ajv.compile(PIPELINE_DOCTOR_MANIFEST_SCHEMA);
const validateIntakeSchema = ajv.compile(INTAKE_SCHEMA);
const validatePromotionDryRunSchema = ajv.compile(PROMOTION_DRY_RUN_SCHEMA);
const validateAuditManifestSchema = ajv.compile(AUDIT_MANIFEST_SCHEMA);
const validateSurrogateInspectionValidationSchema = ajv.compile(SURROGATE_INSPECTION_VALIDATION_SCHEMA);

function readSchema(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

function cloneCatalogEntry(entry) {
  return { ...entry };
}

function markdownTableCell(value) {
  return String(value === null || value === undefined ? 'None' : value)
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

export function getStage5bArtifactSchemaCatalog() {
  return STAGE5B_ARTIFACT_SCHEMA_CATALOG.map(cloneCatalogEntry);
}

export function renderStage5bArtifactSchemaCatalogMarkdown() {
  const header = [
    'Surface',
    'Producer',
    'Schema/contract',
    'Location pattern',
    'Preview boundary',
    'Control/private status',
    'inspection_evidence status',
    'Readiness effect',
  ];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const entry of STAGE5B_ARTIFACT_SCHEMA_CATALOG) {
    lines.push(`| ${[
      entry.surface,
      entry.producer,
      entry.schema_or_contract,
      entry.location_pattern,
      entry.preview_boundary,
      entry.control_private_status,
      entry.inspection_evidence_status,
      entry.readiness_effect,
    ].map(markdownTableCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function validationResult(diagnostics = []) {
  const uniqueDiagnostics = [];
  const seen = new Set();
  for (const diagnostic of diagnostics.filter(Boolean)) {
    const key = [
      diagnostic.validation_stage,
      diagnostic.code,
      diagnostic.json_pointer,
      diagnostic.message,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueDiagnostics.push(diagnostic);
  }
  const uniqueErrors = uniqueDiagnostics.map((diagnostic) => diagnostic.message);
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    diagnostics: uniqueDiagnostics,
  };
}

function schemaErrorPointer(error = {}) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.missingProperty}`;
  }
  if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.additionalProperty}`;
  }
  return basePath;
}

function schemaErrorMessage(error = {}) {
  const pointer = schemaErrorPointer(error);
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${pointer} is required`;
  }
  return `${error.instancePath || '/'} ${error.message || 'failed schema validation'}`.trim();
}

function schemaErrorCode(error = {}) {
  switch (error.keyword) {
    case 'required':
      return 'stage5b.schema.required';
    case 'type':
      return 'stage5b.schema.type';
    case 'enum':
    case 'const':
      return 'stage5b.schema.allowed_value';
    case 'additionalProperties':
      return 'stage5b.schema.additional_property';
    default:
      return 'stage5b.schema.invalid';
  }
}

function remediationForCode(code) {
  switch (code) {
    case 'stage5b.schema.required':
      return 'Add the required field using the documented Stage 5B artifact schema before registering the artifact.';
    case 'stage5b.schema.type':
    case 'stage5b.schema.allowed_value':
    case 'stage5b.schema.additional_property':
    case 'stage5b.schema.invalid':
      return 'Conform the generated control artifact to its Stage 5B JSON schema before writing or registering it.';
    case 'stage5b.unsafe_path':
      return 'Use a safe repo-relative path without absolute roots, traversal, home expansion, backslashes, or control characters.';
    case 'stage5b.unsafe_source_ref':
      return 'Use a safe repo-relative path or sanitized public URL; do not include private URLs, credentials, headers, or tokens.';
    case 'stage5b.generated_control_artifact_not_evidence':
      return 'Use only genuine completed physical/supplier/lab/QA inspection records; generated/control artifacts cannot satisfy inspection_evidence.';
    case 'stage5b.readiness_overclaim':
      return 'Keep readiness held and promotion blocked until genuine completed inspection evidence is attached through the canonical flow.';
    case 'stage5b.human_measurement_boundary':
      return 'Do not request or synthesize human-entered measurements; preserve the no-human-measurement Stage 5B boundary.';
    case 'stage5b.canonical_mutation_boundary':
      return 'Keep Stage 5B validation and audit paths non-mutating; do not write canonical package artifacts during dry-run/audit validation.';
    case 'stage5b.evidence_boundary':
      return 'Declare the hard evidence rule and list generated/control artifacts as non-evidence in the artifact boundary.';
    case 'stage5b.count_mismatch':
      return 'Recompute summary counts from the artifact arrays before validating or registering the control artifact.';
    case 'stage5b.attachment_plan_contract':
      return 'Align the attachment plan with the candidate status: only high-confidence, blocker-free genuine evidence may be attachment_ready.';
    default:
      return 'Fix the Stage 5B control artifact field indicated by json_pointer, then rerun validation.';
  }
}

function makeDiagnostic({
  artifactType = 'unknown',
  validationStage,
  code,
  message,
  jsonPointer = '/',
  safeSourceRef = null,
}) {
  return {
    artifact_type: artifactType,
    artifact_path: null,
    validation_stage: validationStage,
    severity: 'error',
    code,
    message,
    json_pointer: jsonPointer || '/',
    remediation: remediationForCode(code),
    evidence_boundary_note: HARD_EVIDENCE_BOUNDARY_NOTE,
    safe_source_ref: safeSourceRef,
  };
}

function schemaDiagnostics(validator, document, artifactType) {
  const ok = validator(document);
  return ok ? [] : (validator.errors || []).map((error) => makeDiagnostic({
    artifactType,
    validationStage: 'schema',
    code: schemaErrorCode(error),
    message: schemaErrorMessage(error),
    jsonPointer: schemaErrorPointer(error),
  }));
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function isSafeRepoPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (/^https?:\/\//i.test(value)) return false;
  const raw = value.trim();
  const normalized = normalizeRepoPath(raw);
  if (raw !== normalized && raw.includes('\\')) return false;
  if (normalized.includes('\0')) return false;
  if (normalized.startsWith('/') || isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) return false;
  if (normalized.startsWith('~')) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  return !normalized.split('/').includes('..');
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '::1'
    || host.endsWith('.local')
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^169\.254\./.test(host);
}

function isSafePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && !isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isSafeSourceRef(value) {
  if (value === null || value === undefined) return true;
  return isSafeRepoPath(value) || isSafePublicUrl(value);
}

function pushRepoPathError(errors, label, value, { nullable = false } = {}) {
  if ((value === null || value === undefined) && nullable) return;
  if (!isSafeRepoPath(value)) {
    errors.push(`${label} must be a safe repo-relative path`);
  }
}

function pushSourceRefError(errors, label, value, { nullable = false } = {}) {
  if ((value === null || value === undefined) && nullable) return;
  if (!isSafeSourceRef(value)) {
    errors.push(`${label} must be a safe repo-relative path or sanitized public URL`);
  }
}

function isGeneratedArtifactPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = normalizeRepoPath(value).toLowerCase();
  return GENERATED_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isFixtureOrControlSource(value) {
  const normalized = normalizeRepoPath(value).toLowerCase();
  return normalized.startsWith('tests/fixtures/')
    || normalized.startsWith('schemas/')
    || isGeneratedArtifactPath(normalized);
}

function hardEvidenceRulePresent(value) {
  return /Only\s+(?:real|genuine)\s+completed\s+physical\/supplier\/lab\/QA\s+inspection\s+records/i.test(String(value || ''));
}

function evidenceBoundaryText(value) {
  return safeList(value).join('\n');
}

function pushEvidenceBoundaryErrors(errors, label, value) {
  const text = evidenceBoundaryText(value);
  for (const pattern of REQUIRED_NON_EVIDENCE_TERMS) {
    if (!pattern.test(text)) {
      errors.push(`${label} must declare ${pattern.source.replace(/\\?/g, '')} as non-evidence`);
    }
  }
}

function isHeldReadiness(readiness = {}) {
  const status = String(readiness.status || '');
  const gateDecision = String(readiness.gate_decision || '');
  const missingInputs = safeList(readiness.missing_inputs);
  return status === 'needs_more_evidence'
    || gateDecision === 'hold_for_evidence_completion'
    || missingInputs.includes('inspection_evidence')
    || readiness.inspection_evidence_missing === true;
}

function pushReadinessHeldError(errors, label, readiness = {}) {
  if (!isHeldReadiness(readiness)) {
    errors.push(`${label} must remain needs_more_evidence / hold_for_evidence_completion while inspection evidence is missing`);
  }
  pushRepoPathError(errors, `${label}.source_of_truth_path`, readiness.source_of_truth_path, { nullable: true });
}

function commandPathValues(command = []) {
  const values = [];
  for (const value of safeList(command)) {
    if (typeof value !== 'string' || !value.includes('/')) continue;
    if (/^https?:\/\//i.test(value)) continue;
    values.push(value);
  }
  return values;
}

function pushCommandPathErrors(errors, label, command = []) {
  if (!Array.isArray(command)) return;
  commandPathValues(command).forEach((pathValue, index) => {
    pushRepoPathError(errors, `${label}[path:${index}]`, pathValue);
  });
}

function pushAttachmentPlanErrors(errors, label, plan = {}) {
  if (!plan || typeof plan !== 'object') {
    errors.push(`${label} must be an attachment plan object`);
    return;
  }
  if (plan.attachment_ready === true) {
    if (plan.match_confidence !== 'high') {
      errors.push(`${label}.attachment_ready requires match_confidence high`);
    }
    if (safeList(plan.blockers).length > 0) {
      errors.push(`${label}.attachment_ready requires an empty blockers array`);
    }
    if (!plan.matched_package) {
      errors.push(`${label}.attachment_ready requires matched_package`);
    }
    if (!Array.isArray(plan.canonical_next_command)) {
      errors.push(`${label}.attachment_ready requires canonical_next_command`);
    }
  } else if (plan.canonical_next_command !== null && plan.canonical_next_command !== undefined) {
    errors.push(`${label}.canonical_next_command must be null when attachment_ready is false`);
  }
  if (Array.isArray(plan.canonical_next_command)) {
    pushCommandPathErrors(errors, `${label}.canonical_next_command`, plan.canonical_next_command);
  }
}

function pushCandidateErrors(errors, label, candidate = {}, { accepted = false } = {}) {
  pushRepoPathError(errors, `${label}.path`, candidate.path);
  pushSourceRefError(errors, `${label}.normalized_source_ref`, candidate.normalized_source_ref, { nullable: true });
  pushAttachmentPlanErrors(errors, `${label}.attachment_plan`, candidate.attachment_plan);
  if (accepted) {
    if (candidate.classification !== 'genuine_valid') {
      errors.push(`${label}.classification must be genuine_valid for accepted candidates`);
    }
    if (isFixtureOrControlSource(candidate.path) || isFixtureOrControlSource(candidate.normalized_source_ref)) {
      errors.push(`${label} points at a fixture, control file, or generated artifact; that is not inspection evidence`);
    }
  }
}

function validateIntakeSemantics(report = {}) {
  const errors = [];
  if (!hardEvidenceRulePresent(report.source_boundary?.hard_evidence_rule)) {
    errors.push('source_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  pushEvidenceBoundaryErrors(errors, 'source_boundary.rejected_as_final_evidence', report.source_boundary?.rejected_as_final_evidence);

  const acceptedCandidates = safeList(report.accepted_candidates);
  const rejectedCandidates = safeList(report.rejected_candidates);
  const attachmentReadyCandidates = acceptedCandidates.filter((candidate) => candidate.attachment_ready === true);
  if (report.summary?.accepted_candidate_count !== acceptedCandidates.length) {
    errors.push('summary.accepted_candidate_count must match accepted_candidates.length');
  }
  if (report.summary?.attachment_ready_candidate_count !== attachmentReadyCandidates.length) {
    errors.push('summary.attachment_ready_candidate_count must match accepted attachment_ready candidate count');
  }
  if (report.summary?.rejected_candidate_count !== rejectedCandidates.length) {
    errors.push('summary.rejected_candidate_count must match rejected_candidates.length');
  }
  if (report.summary?.requires_human_measurement_entry !== false) {
    errors.push('summary.requires_human_measurement_entry must be false');
  }
  if (report.summary?.genuine_inspection_evidence_found !== (acceptedCandidates.length > 0)) {
    errors.push('summary.genuine_inspection_evidence_found must reflect accepted_candidates');
  }

  acceptedCandidates.forEach((candidate, index) => {
    pushCandidateErrors(errors, `accepted_candidates[${index}]`, candidate, { accepted: true });
  });
  rejectedCandidates.forEach((candidate, index) => {
    pushCandidateErrors(errors, `rejected_candidates[${index}]`, candidate, { accepted: false });
  });

  safeList(report.packages).forEach((pkg, index) => {
    pushAttachmentPlanErrors(errors, `packages[${index}].attachment_plan`, pkg.attachment_plan);
    safeList(pkg.accepted_candidates).forEach((candidate, candidateIndex) => {
      pushCandidateErrors(errors, `packages[${index}].accepted_candidates[${candidateIndex}]`, candidate, { accepted: true });
    });
    if (pkg.classification !== 'genuine_valid') {
      pushReadinessHeldError(errors, `packages[${index}].readiness_after`, pkg.readiness_after);
    }
    if (pkg.intake_action?.attachment_ready === true && safeList(pkg.intake_action.blockers).length > 0) {
      errors.push(`packages[${index}].intake_action attachment_ready requires no blockers`);
    }
    if (Array.isArray(pkg.intake_action?.canonical_next_command)) {
      pushCommandPathErrors(errors, `packages[${index}].intake_action.canonical_next_command`, pkg.intake_action.canonical_next_command);
    }
  });

  return errors;
}

function pointerFromSemanticLabel(label = '') {
  const clean = String(label || '')
    .trim()
    .replace(/\[([0-9]+)\]/g, '.$1')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ');
  const match = clean.match(/^([A-Za-z0-9_.-]+(?:\.[0-9]+)?(?:\.[A-Za-z0-9_-]+|\.[0-9]+)*)/);
  if (!match) return '/';
  return `/${match[1].split('.').filter(Boolean).join('/')}`;
}

function semanticErrorCode(message = '') {
  const text = String(message || '');
  if (/sanitized public URL/i.test(text)) return 'stage5b.unsafe_source_ref';
  if (/safe repo-relative path/i.test(text)) return 'stage5b.unsafe_path';
  if (/fixture|control file|generated artifact|not inspection evidence/i.test(text)) {
    return 'stage5b.generated_control_artifact_not_evidence';
  }
  if (/promotion_can_run|ready_package_count|readiness_remains_held|no genuine inspection evidence|needs_more_evidence|hold_for_evidence_completion/i.test(text)) {
    return 'stage5b.readiness_overclaim';
  }
  if (/human_measurement|human measurement/i.test(text)) return 'stage5b.human_measurement_boundary';
  if (/canonical_artifacts_mutated|mutates_canonical_artifacts|mutated_by_dry_run/i.test(text)) {
    return 'stage5b.canonical_mutation_boundary';
  }
  if (/hard_evidence_rule|rejected_as_final_evidence|non-evidence/i.test(text)) return 'stage5b.evidence_boundary';
  if (/count must match|must reflect|must match/i.test(text)) return 'stage5b.count_mismatch';
  if (/attachment_ready|canonical_next_command|match_confidence|blockers|attachment plan/i.test(text)) {
    return 'stage5b.attachment_plan_contract';
  }
  return 'stage5b.semantic_contract';
}

function semanticDiagnostics(errors = [], artifactType) {
  return errors.filter(Boolean).map((message) => {
    const code = semanticErrorCode(message);
    return makeDiagnostic({
      artifactType,
      validationStage: 'semantic',
      code,
      message,
      jsonPointer: pointerFromSemanticLabel(message),
    });
  });
}

function validatePromotionDryRunSemantics(manifest = {}) {
  const errors = [];
  if (!hardEvidenceRulePresent(manifest.hard_evidence_rule)) {
    errors.push('hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_final_evidence', manifest.evidence_boundary?.rejected_as_final_evidence);
  pushRepoPathError(errors, 'source_intake_report.path', manifest.source_intake_report?.path, { nullable: true });
  if (manifest.summary?.canonical_artifacts_mutated !== false) {
    errors.push('summary.canonical_artifacts_mutated must be false');
  }
  if (manifest.summary?.genuine_inspection_evidence_found === false && manifest.summary?.promotion_can_run === true) {
    errors.push('summary.promotion_can_run cannot be true without genuine inspection evidence');
  }

  const packages = safeList(manifest.packages);
  const readyPackages = packages.filter((pkg) => pkg.promotion_status === 'ready_for_future_promotion_dry_run');
  if (manifest.summary?.ready_package_count !== readyPackages.length) {
    errors.push('summary.ready_package_count must match ready package count');
  }
  if (manifest.summary?.blocked_package_count !== packages.length - readyPackages.length) {
    errors.push('summary.blocked_package_count must match blocked package count');
  }
  if (manifest.summary?.promotion_can_run !== (readyPackages.length > 0)) {
    errors.push('summary.promotion_can_run must reflect ready package count');
  }
  if (manifest.summary?.attachment_ready_candidate_count !== readyPackages.length) {
    errors.push('summary.attachment_ready_candidate_count must match promotion-ready package count');
  }

  packages.forEach((pkg, index) => {
    const label = `packages[${index}]`;
    pushSourceRefError(errors, `${label}.evidence_source_ref`, pkg.evidence_source_ref, { nullable: true });
    pushRepoPathError(errors, `${label}.candidate_path`, pkg.candidate_path, { nullable: true });
    safeList(pkg.files_that_would_be_mutated).forEach((pathValue, pathIndex) => {
      pushRepoPathError(errors, `${label}.files_that_would_be_mutated[${pathIndex}]`, pathValue);
    });
    safeList(pkg.expected_artifacts).forEach((artifact, artifactIndex) => {
      pushRepoPathError(errors, `${label}.expected_artifacts[${artifactIndex}].path`, artifact.path);
    });
    safeList(pkg.commands_to_run).forEach((step, stepIndex) => {
      pushCommandPathErrors(errors, `${label}.commands_to_run[${stepIndex}].command`, step.command);
      safeList(step.expected_outputs).forEach((artifact, artifactIndex) => {
        pushRepoPathError(errors, `${label}.commands_to_run[${stepIndex}].expected_outputs[${artifactIndex}].path`, artifact.path);
      });
      safeList(step.files_that_would_be_mutated).forEach((pathValue, pathIndex) => {
        pushRepoPathError(errors, `${label}.commands_to_run[${stepIndex}].files_that_would_be_mutated[${pathIndex}]`, pathValue);
      });
    });

    const ready = pkg.promotion_status === 'ready_for_future_promotion_dry_run';
    if (ready && safeList(pkg.blockers).length > 0) {
      errors.push(`${label}.promotion_status ready_for_future_promotion_dry_run requires no blockers`);
    }
    if (ready && safeList(pkg.commands_to_run).length === 0) {
      errors.push(`${label}.promotion_status ready_for_future_promotion_dry_run requires commands_to_run`);
    }
    if (!ready && pkg.canonical_next_command !== null) {
      errors.push(`${label}.canonical_next_command must be null for blocked packages`);
    }
    if (pkg.attachment_ready === true && safeList(pkg.blockers).length > 0) {
      errors.push(`${label}.attachment_ready requires no blockers`);
    }
    if (!ready) {
      pushReadinessHeldError(errors, `${label}.readiness_expectation.dry_run`, pkg.readiness_expectation?.dry_run);
    }
    if (pkg.mutation_boundaries?.canonical_artifacts_mutated_by_dry_run !== false) {
      errors.push(`${label}.mutation_boundaries.canonical_artifacts_mutated_by_dry_run must be false`);
    }
  });

  safeList(manifest.mutation_boundaries?.future_mutation_roots).forEach((pathValue, index) => {
    pushRepoPathError(errors, `mutation_boundaries.future_mutation_roots[${index}]`, pathValue);
  });

  return errors;
}

function validateAuditManifestSemantics(manifest = {}) {
  const errors = [];
  Object.entries(OUTPUT_ARTIFACT_TYPES).forEach(([key, artifactType]) => {
    const ref = manifest.outputs?.[key];
    pushRepoPathError(errors, `outputs.${key}.path`, ref?.path);
    if (ref?.artifact_type !== artifactType) {
      errors.push(`outputs.${key}.artifact_type must be ${artifactType}`);
    }
  });
  if (!hardEvidenceRulePresent(manifest.evidence_boundary?.hard_evidence_rule)) {
    errors.push('evidence_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_final_evidence', manifest.evidence_boundary?.rejected_as_final_evidence);
  if (manifest.evidence_boundary?.human_measurement_entry_requested !== false) {
    errors.push('evidence_boundary.human_measurement_entry_requested must be false');
  }

  safeList(manifest.next_safe_commands).forEach((entry, index) => {
    if (entry.mutates_canonical_artifacts !== false) {
      errors.push(`next_safe_commands[${index}].mutates_canonical_artifacts must be false`);
    }
    pushCommandPathErrors(errors, `next_safe_commands[${index}].command`, entry.command);
  });

  const summary = safeObject(manifest.summary);
  const truth = safeObject(manifest.readiness_held_truth);
  if (summary.canonical_artifacts_mutated !== false) {
    errors.push('summary.canonical_artifacts_mutated must be false');
  }
  if (summary.requires_human_measurement_entry !== false) {
    errors.push('summary.requires_human_measurement_entry must be false');
  }
  if (summary.genuine_inspection_evidence_found === false) {
    if (summary.promotion_can_run !== false) {
      errors.push('summary.promotion_can_run must be false when no genuine inspection evidence was found');
    }
    if (summary.readiness_remains_held !== true) {
      errors.push('summary.readiness_remains_held must be true when no genuine inspection evidence was found');
    }
    if (truth.no_genuine_completed_inspection_evidence_found !== true) {
      errors.push('readiness_held_truth.no_genuine_completed_inspection_evidence_found must be true');
    }
    if (truth.no_promotion_can_run !== true) {
      errors.push('readiness_held_truth.no_promotion_can_run must be true');
    }
    if (!safeList(manifest.blockers).includes('no_genuine_completed_inspection_evidence')) {
      errors.push('blockers must include no_genuine_completed_inspection_evidence');
    }
  }
  if (truth.canonical_package_artifacts_mutated !== false) {
    errors.push('readiness_held_truth.canonical_package_artifacts_mutated must be false');
  }
  if (truth.requires_human_measurement_entry !== false) {
    errors.push('readiness_held_truth.requires_human_measurement_entry must be false');
  }
  if (manifest.attachment_ready?.count !== safeList(manifest.attachment_ready?.candidates).length) {
    errors.push('attachment_ready.count must match candidates.length');
  }
  if (summary.attachment_ready_candidate_count !== manifest.attachment_ready?.count) {
    errors.push('summary.attachment_ready_candidate_count must match attachment_ready.count');
  }
  safeList(manifest.attachment_ready?.candidates).forEach((candidate, index) => {
    pushSourceRefError(errors, `attachment_ready.candidates[${index}].path`, candidate.path, { nullable: true });
    if (candidate.fixture_or_test_source === true) {
      errors.push(`attachment_ready.candidates[${index}] fixture_or_test_source cannot satisfy inspection evidence`);
    }
    if (isFixtureOrControlSource(candidate.path)) {
      errors.push(`attachment_ready.candidates[${index}].path points at a fixture, control file, or generated artifact`);
    }
  });
  safeList(manifest.canonical_package_readiness_states).forEach((pkg, index) => {
    if (summary.genuine_inspection_evidence_found === false || pkg.promotion_status !== 'ready_for_future_promotion_dry_run') {
      if (pkg.readiness_remains_held !== true) {
        errors.push(`canonical_package_readiness_states[${index}].readiness_remains_held must be true`);
      }
      pushReadinessHeldError(errors, `canonical_package_readiness_states[${index}].readiness_after`, pkg.readiness_after);
    }
  });
  if (summary.accepted_candidate_count !== manifest.source_classes?.accepted_count) {
    errors.push('summary.accepted_candidate_count must match source_classes.accepted_count');
  }

  return errors;
}

function validateCandidateGateReportSemantics(report = {}) {
  const errors = [];
  const summary = safeObject(report.summary);
  const decision = safeObject(report.decision);
  const pathSafety = safeObject(report.path_safety);
  const readiness = safeObject(report.readiness_unchanged);
  const evidenceBoundary = safeObject(report.evidence_boundary);
  const nonEvidenceBoundary = safeObject(report.non_evidence_boundary);
  const reportContract = safeObject(report.report_contract);
  const eligible = summary.eligible_for_stage5b_intake_review === true;
  const rejections = safeList(report.rejections);
  const rejectionCodes = safeList(summary.rejection_codes);

  if (summary.decision !== decision.result) {
    errors.push('summary.decision must match decision.result');
  }
  if (summary.eligible_for_stage5b_intake_review !== decision.eligible_for_stage5b_intake_review) {
    errors.push('summary.eligible_for_stage5b_intake_review must match decision.eligible_for_stage5b_intake_review');
  }
  if (eligible) {
    if (decision.result !== 'accept') {
      errors.push('decision.result must be accept when eligible_for_stage5b_intake_review is true');
    }
    if (decision.label !== 'eligible_for_later_stage5b_intake_review') {
      errors.push('decision.label must be eligible_for_later_stage5b_intake_review for accepted candidate reports');
    }
    if (summary.candidate_status !== 'eligible_for_intake_review') {
      errors.push('summary.candidate_status must be eligible_for_intake_review for accepted candidate reports');
    }
    if (summary.rejection_count !== 0 || rejections.length !== 0 || rejectionCodes.length !== 0) {
      errors.push('accepted candidate reports must have zero rejections and zero rejection_codes');
    }
  } else {
    if (decision.result !== 'reject') {
      errors.push('decision.result must be reject when eligible_for_stage5b_intake_review is false');
    }
    if (decision.label !== 'rejected_before_stage5b_intake_review') {
      errors.push('decision.label must be rejected_before_stage5b_intake_review for rejected candidate reports');
    }
    if (summary.candidate_status !== 'rejected') {
      errors.push('summary.candidate_status must be rejected for rejected candidate reports');
    }
    if (summary.rejection_count < 1 || rejections.length < 1 || rejectionCodes.length < 1) {
      errors.push('rejected candidate reports must include rejection_count, rejection_codes, and rejections');
    }
  }
  if (summary.rejection_count !== rejections.length) {
    errors.push('summary.rejection_count must match rejections.length');
  }
  const uniqueRejectionCodes = [...new Set(rejections.map((rejection) => rejection.code))];
  if (JSON.stringify([...rejectionCodes].sort()) !== JSON.stringify(uniqueRejectionCodes.sort())) {
    errors.push('summary.rejection_codes must match unique rejections[].code values');
  }
  safeList(report.checklist).forEach((item, index) => {
    const itemCodes = safeList(item.rejection_codes);
    if (item.status === 'pass' && itemCodes.length > 0) {
      errors.push(`checklist[${index}].status pass requires no rejection_codes`);
    }
    if (item.status === 'fail' && itemCodes.length === 0) {
      errors.push(`checklist[${index}].status fail requires rejection_codes`);
    }
  });
  if (!eligible && !safeList(report.checklist).some((item) => item.status === 'fail')) {
    errors.push('rejected candidate reports must have at least one failed checklist item');
  }

  [
    ['decision.does_not_attach_evidence', decision.does_not_attach_evidence],
    ['decision.does_not_promote_evidence', decision.does_not_promote_evidence],
    ['decision.does_not_satisfy_readiness', decision.does_not_satisfy_readiness],
    ['decision.does_not_mutate_canonical_artifacts', decision.does_not_mutate_canonical_artifacts],
    ['decision.later_attachment_authorization_required', decision.later_attachment_authorization_required],
    ['summary.canonical_artifacts_mutated', summary.canonical_artifacts_mutated === false],
    ['summary.genuine_evidence_attached', summary.genuine_evidence_attached === false],
    ['readiness_unchanged.unchanged', readiness.unchanged],
    ['readiness_unchanged.canonical_artifacts_mutated', readiness.canonical_artifacts_mutated === false],
    ['readiness_unchanged.genuine_evidence_attached', readiness.genuine_evidence_attached === false],
    ['readiness_unchanged.evidence_promoted', readiness.evidence_promoted === false],
    ['readiness_unchanged.readiness_satisfied', readiness.readiness_satisfied === false],
    ['readiness_unchanged.promotion_authorized', readiness.promotion_authorized === false],
    ['readiness_unchanged.attachment_authorization_required', readiness.attachment_authorization_required],
  ].forEach(([label, value]) => {
    if (value !== true) errors.push(`${label} must preserve the non-mutating candidate gate boundary`);
  });
  if (readiness.canonical_package_status !== 'needs_more_evidence') {
    errors.push('readiness_unchanged.canonical_package_status must remain needs_more_evidence');
  }
  if (readiness.gate_decision !== 'hold_for_evidence_completion') {
    errors.push('readiness_unchanged.gate_decision must remain hold_for_evidence_completion');
  }
  if (readiness.missing_input !== 'inspection_evidence') {
    errors.push('readiness_unchanged.missing_input must remain inspection_evidence');
  }
  if (!/needs_more_evidence\s*\/\s*hold_for_evidence_completion/i.test(String(summary.readiness_truth || ''))) {
    errors.push('summary.readiness_truth must preserve needs_more_evidence / hold_for_evidence_completion');
  }
  if (!/later explicitly authorized attachment task/i.test(String(summary.readiness_truth || ''))) {
    errors.push('summary.readiness_truth must preserve the later explicit attachment authorization boundary');
  }
  if (!/later explicit attachment authorization/i.test(String(decision.reviewer_note || ''))) {
    errors.push('decision.reviewer_note must preserve the later explicit attachment authorization boundary');
  }

  if (pathSafety.candidate_path !== null && pathSafety.candidate_path !== undefined) {
    pushRepoPathError(errors, 'path_safety.candidate_path', pathSafety.candidate_path);
  }
  pushSourceRefError(errors, 'path_safety.source_ref', pathSafety.source_ref, { nullable: true });
  [
    'safe_repo_relative_paths_required',
    'absolute_paths_rejected',
    'traversal_rejected',
    'output_and_tmp_codex_rejected',
    'private_machine_paths_rejected',
    'secret_bearing_refs_rejected',
  ].forEach((field) => {
    if (pathSafety[field] !== true) {
      errors.push(`path_safety.${field} must be true`);
    }
  });
  if (!/absolute paths|private machine|tokens|credentials|authorization headers/i.test(String(pathSafety.redaction_note || ''))) {
    errors.push('path_safety.redaction_note must name path safety and redaction boundaries');
  }

  if (!hardEvidenceRulePresent(evidenceBoundary.hard_evidence_rule)) {
    errors.push('evidence_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  [
    'non_production_gate',
    'does_not_attach_evidence',
    'does_not_promote_evidence',
    'does_not_change_readiness',
  ].forEach((field) => {
    if (evidenceBoundary[field] !== true) {
      errors.push(`evidence_boundary.${field} must be true`);
    }
  });
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_final_evidence', evidenceBoundary.rejected_as_final_evidence);
  [
    'generated_control_artifacts_do_not_satisfy_inspection_evidence',
    'candidate_gate_reports_do_not_satisfy_inspection_evidence',
    'authorization_records_do_not_satisfy_inspection_evidence',
    'readiness_reports_do_not_satisfy_inspection_evidence',
    'review_packs_do_not_satisfy_inspection_evidence',
    'release_bundles_do_not_satisfy_inspection_evidence',
    'github_ci_metadata_alone_is_not_evidence',
    'screenshots_do_not_satisfy_inspection_evidence',
    'cad_generated_measurements_are_not_evidence',
    'generated_quality_outputs_do_not_satisfy_inspection_evidence',
  ].forEach((field) => {
    if (nonEvidenceBoundary[field] !== true) {
      errors.push(`non_evidence_boundary.${field} must be true`);
    }
  });
  pushEvidenceBoundaryErrors(errors, 'non_evidence_boundary.rejected_as_final_evidence', nonEvidenceBoundary.rejected_as_final_evidence);

  if (reportContract.passing_report_means !== CANDIDATE_GATE_PASSING_MEANING) {
    errors.push('report_contract.passing_report_means must say eligible for later Stage 5B intake review only');
  }
  if (reportContract.authorization_boundary_field !== 'decision.later_attachment_authorization_required') {
    errors.push('report_contract.authorization_boundary_field must point to decision.later_attachment_authorization_required');
  }
  for (const field of ['evidence_attached', 'evidence_promoted', 'readiness_satisfied', 'canonical_artifacts_mutated', 'attachment_authorized']) {
    if (!safeList(reportContract.passing_report_does_not_mean).includes(field)) {
      errors.push(`report_contract.passing_report_does_not_mean must include ${field}`);
    }
  }
  for (const section of ['candidate', 'summary', 'decision', 'checklist', 'rejections', 'path_safety', 'readiness_unchanged', 'evidence_boundary', 'non_evidence_boundary']) {
    if (!safeList(reportContract.required_sections).includes(section)) {
      errors.push(`report_contract.required_sections must include ${section}`);
    }
  }

  return errors;
}

function validateEvidenceReviewDryRunSemantics(manifest = {}) {
  const errors = [];
  const summary = safeObject(manifest.summary);
  const truth = safeObject(manifest.readiness_held_truth);
  const preflight = safeObject(manifest.source_preflight);
  const redaction = safeObject(manifest.redaction_findings);
  const candidate = safeObject(manifest.generated_candidate);
  const steps = safeObject(manifest.downstream_steps);

  if (summary.evidence_attached !== false) {
    errors.push('summary.evidence_attached must be false');
  }
  if (summary.canonical_artifacts_mutated !== false) {
    errors.push('summary.canonical_artifacts_mutated must be false');
  }
  if (summary.canonical_readiness_regenerated !== false) {
    errors.push('summary.canonical_readiness_regenerated must be false');
  }
  if (summary.packages_marked_ready !== false) {
    errors.push('summary.packages_marked_ready must be false');
  }
  if (summary.readiness_remains_held !== true) {
    errors.push('summary.readiness_remains_held must be true');
  }
  if (truth.readiness_remains_held !== true) {
    errors.push('readiness_held_truth.readiness_remains_held must be true');
  }
  if (truth.canonical_readiness_regenerated !== false) {
    errors.push('readiness_held_truth.canonical_readiness_regenerated must be false');
  }
  if (truth.canonical_artifacts_mutated !== false) {
    errors.push('readiness_held_truth.canonical_artifacts_mutated must be false');
  }
  if (truth.packages_marked_ready !== false) {
    errors.push('readiness_held_truth.packages_marked_ready must be false');
  }
  if (!/needs_more_evidence\s*\/\s*hold_for_evidence_completion/i.test(String(truth.statement || ''))) {
    errors.push('readiness_held_truth.statement must preserve needs_more_evidence / hold_for_evidence_completion');
  }
  if (preflight.summary?.evidence_attached !== false) {
    errors.push('source_preflight.summary.evidence_attached must be false');
  }
  if (preflight.summary?.canonical_artifacts_mutated !== false) {
    errors.push('source_preflight.summary.canonical_artifacts_mutated must be false');
  }
  if (preflight.summary?.canonical_readiness_regenerated !== false) {
    errors.push('source_preflight.summary.canonical_readiness_regenerated must be false');
  }
  if (redaction.raw_source_copied !== false) {
    errors.push('redaction_findings.raw_source_copied must be false');
  }
  if (candidate.raw_source_copied !== false) {
    errors.push('generated_candidate.raw_source_copied must be false');
  }
  if (candidate.path) {
    pushRepoPathError(errors, 'generated_candidate.path', candidate.path);
    if (candidate.review_scoped_only !== true) {
      errors.push('generated_candidate.review_scoped_only must be true when a review candidate is written');
    }
    if (candidate.canonical_evidence_eligible !== false) {
      errors.push('generated_candidate.canonical_evidence_eligible must be false');
    }
  }
  const gate = safeObject(steps.candidate_gate);
  if (gate.report) {
    if (gate.report.summary?.genuine_evidence_attached !== false) {
      errors.push('downstream_steps.candidate_gate.report.summary.genuine_evidence_attached must be false');
    }
    if (gate.report.summary?.canonical_artifacts_mutated !== false) {
      errors.push('downstream_steps.candidate_gate.report.summary.canonical_artifacts_mutated must be false');
    }
    if (gate.report.decision?.result !== 'reject') {
      errors.push('downstream_steps.candidate_gate.report.decision.result must be reject for review-scoped non-evidence material');
    }
  }
  const audit = safeObject(steps.audit);
  if (audit.manifest) {
    if (audit.manifest.summary?.canonical_artifacts_mutated !== false) {
      errors.push('downstream_steps.audit.manifest.summary.canonical_artifacts_mutated must be false');
    }
    if (audit.manifest.summary?.readiness_remains_held !== true) {
      errors.push('downstream_steps.audit.manifest.summary.readiness_remains_held must be true');
    }
    if (audit.manifest.summary?.promotion_can_run !== false) {
      errors.push('downstream_steps.audit.manifest.summary.promotion_can_run must be false for review dry-run orchestration');
    }
  }
  safeList(manifest.commands_run).forEach((entry, index) => {
    if (entry.mutates_canonical_artifacts !== false) {
      errors.push(`commands_run[${index}].mutates_canonical_artifacts must be false`);
    }
    pushCommandPathErrors(errors, `commands_run[${index}].command`, entry.command);
  });
  Object.entries(safeObject(manifest.outputs)).forEach(([key, ref]) => {
    if (ref && typeof ref === 'object') {
      pushRepoPathError(errors, `outputs.${key}.path`, ref.path);
    }
  });
  if (manifest.next_required_authorization_step?.required !== true) {
    errors.push('next_required_authorization_step.required must be true');
  }
  if (manifest.next_required_authorization_step?.canonical_attachment_command_allowed_now !== false) {
    errors.push('next_required_authorization_step.canonical_attachment_command_allowed_now must be false');
  }

  return errors;
}

function validateAttachmentControlSemantics(manifest = {}) {
  const errors = [];
  const summary = safeObject(manifest.summary);
  const truth = safeObject(manifest.readiness_held_truth);
  const evidenceBoundary = safeObject(manifest.evidence_boundary);
  const blockers = safeList(manifest.blockers);
  const gates = safeList(manifest.gates);

  if (summary.evidence_attached !== false) {
    errors.push('summary.evidence_attached must be false');
  }
  if (summary.canonical_artifacts_mutated !== false) {
    errors.push('summary.canonical_artifacts_mutated must be false');
  }
  if (summary.canonical_readiness_regenerated !== false) {
    errors.push('summary.canonical_readiness_regenerated must be false');
  }
  if (summary.packages_marked_ready !== false) {
    errors.push('summary.packages_marked_ready must be false');
  }
  if (summary.readiness_status !== 'needs_more_evidence') {
    errors.push('summary.readiness_status must remain needs_more_evidence');
  }
  if (summary.readiness_gate_decision !== 'hold_for_evidence_completion') {
    errors.push('summary.readiness_gate_decision must remain hold_for_evidence_completion');
  }
  if (summary.decision === 'pass' && blockers.length > 0) {
    errors.push('summary.decision pass requires zero blockers');
  }
  if (summary.decision === 'hold' && blockers.length === 0) {
    errors.push('summary.decision hold requires at least one blocker');
  }
  if (summary.decision === 'pass' && summary.future_explicit_attachment_prerequisites_met !== true) {
    errors.push('summary.future_explicit_attachment_prerequisites_met must be true when decision is pass');
  }
  if (summary.decision === 'hold' && summary.future_explicit_attachment_prerequisites_met !== false) {
    errors.push('summary.future_explicit_attachment_prerequisites_met must be false when decision is hold');
  }

  if (truth.readiness_remains_held !== true) {
    errors.push('readiness_held_truth.readiness_remains_held must be true');
  }
  if (truth.status !== 'needs_more_evidence') {
    errors.push('readiness_held_truth.status must remain needs_more_evidence');
  }
  if (truth.gate_decision !== 'hold_for_evidence_completion') {
    errors.push('readiness_held_truth.gate_decision must remain hold_for_evidence_completion');
  }
  if (truth.canonical_readiness_regenerated !== false) {
    errors.push('readiness_held_truth.canonical_readiness_regenerated must be false');
  }
  if (truth.canonical_artifacts_mutated !== false) {
    errors.push('readiness_held_truth.canonical_artifacts_mutated must be false');
  }
  if (truth.packages_marked_ready !== false) {
    errors.push('readiness_held_truth.packages_marked_ready must be false');
  }

  if (!hardEvidenceRulePresent(evidenceBoundary.hard_evidence_rule)) {
    errors.push('evidence_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  [
    'controller_does_not_attach_evidence',
    'controller_does_not_promote_evidence',
    'controller_does_not_regenerate_readiness',
    'later_explicit_attachment_task_required',
  ].forEach((field) => {
    if (evidenceBoundary[field] !== true) {
      errors.push(`evidence_boundary.${field} must be true`);
    }
  });
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_real_evidence', evidenceBoundary.rejected_as_real_evidence);

  gates.forEach((entry, index) => {
    if (!['pass', 'blocked'].includes(entry.status)) {
      errors.push(`gates[${index}].status must be pass or blocked`);
    }
    if (entry.status === 'blocked' && safeList(entry.reasons).length === 0) {
      errors.push(`gates[${index}].blocked status requires reasons`);
    }
  });
  if (summary.decision === 'pass' && gates.some((entry) => entry.status !== 'pass')) {
    errors.push('summary.decision pass requires every gate to pass');
  }
  safeList(manifest.next_commands).forEach((entry, index) => {
    if (Array.isArray(entry.command)) {
      pushCommandPathErrors(errors, `next_commands[${index}].command`, entry.command);
    }
  });

  return errors;
}

function surrogateLabelText(value) {
  return String(value === null || value === undefined ? '' : value);
}

function hasSurrogateNonEvidenceLabel(value) {
  const text = surrogateLabelText(value);
  return /synthetic|surrogate|non[-_ ]?evidence/i.test(text)
    || /^SURROGATE_NON_EVIDENCE:/i.test(text);
}

function validateSurrogateInspectionValidationSemantics(manifest = {}) {
  const errors = [];
  const summary = safeObject(manifest.summary);
  const evidenceBoundary = safeObject(manifest.evidence_boundary);
  const canonicalAudit = safeObject(manifest.canonical_evidence_audit);
  const packages = safeList(manifest.packages);

  if (!hardEvidenceRulePresent(evidenceBoundary.hard_evidence_rule)) {
    errors.push('evidence_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_final_evidence', evidenceBoundary.rejected_as_final_evidence);
  [
    ['dry_run', manifest.dry_run === true],
    ['non_evidence', manifest.non_evidence === true],
    ['surrogate_lane_only', manifest.surrogate_lane_only === true],
    ['evidence_boundary.synthetic_surrogate_values_are_not_evidence', evidenceBoundary.synthetic_surrogate_values_are_not_evidence === true],
    ['evidence_boundary.surrogate_records_cannot_unlock_readiness', evidenceBoundary.surrogate_records_cannot_unlock_readiness === true],
    ['evidence_boundary.canonical_evidence_attached', evidenceBoundary.canonical_evidence_attached === false],
    ['evidence_boundary.product_inspection_readiness', evidenceBoundary.product_inspection_readiness === false],
    ['evidence_boundary.canonical_artifacts_mutated', evidenceBoundary.canonical_artifacts_mutated === false],
    ['summary.genuine_inspection_evidence_found', summary.genuine_inspection_evidence_found === false],
    ['summary.evidence_attached', summary.evidence_attached === false],
    ['summary.product_inspection_readiness', summary.product_inspection_readiness === false],
    ['summary.canonical_artifacts_mutated', summary.canonical_artifacts_mutated === false],
    ['summary.readiness_remains_held', summary.readiness_remains_held === true],
    ['canonical_evidence_audit.summary.genuine_inspection_evidence_found', canonicalAudit.summary?.genuine_inspection_evidence_found === false],
    ['canonical_evidence_audit.summary.promotion_can_run', canonicalAudit.summary?.promotion_can_run === false],
    ['canonical_evidence_audit.summary.readiness_remains_held', canonicalAudit.summary?.readiness_remains_held === true],
    ['canonical_evidence_audit.summary.canonical_artifacts_mutated', canonicalAudit.summary?.canonical_artifacts_mutated === false],
  ].forEach(([label, ok]) => {
    if (!ok) errors.push(`${label} must preserve the surrogate/non-evidence readiness hold`);
  });

  if (!/needs_more_evidence\s*\/\s*hold_for_evidence_completion/i.test(String(summary.readiness_truth || ''))) {
    errors.push('summary.readiness_truth must preserve needs_more_evidence / hold_for_evidence_completion');
  }
  if (summary.package_count !== packages.length) {
    errors.push('summary.package_count must match packages.length');
  }
  const surrogatePackages = packages.filter((pkg) => pkg.surrogate_lane?.status === 'accepted_surrogate_non_evidence');
  if (summary.surrogate_package_count !== surrogatePackages.length) {
    errors.push('summary.surrogate_package_count must match surrogate package count');
  }
  const surrogateRecords = packages.flatMap((pkg) => safeList(pkg.surrogate_records));
  if (summary.surrogate_record_count !== surrogateRecords.length) {
    errors.push('summary.surrogate_record_count must match surrogate_records length');
  }
  const acceptedSurrogateRecords = surrogateRecords.filter((record) => (
    record.synthetic === true
    && record.non_evidence === true
    && record.surrogate_lane_only === true
    && record.canonical_evidence_eligible === false
  ));
  if (summary.surrogate_records_accepted_by_surrogate_lane !== acceptedSurrogateRecords.length) {
    errors.push('summary.surrogate_records_accepted_by_surrogate_lane must match accepted surrogate records');
  }

  const auditRef = canonicalAudit.outputs?.stage5b_audit_manifest;
  pushRepoPathError(errors, 'canonical_evidence_audit.outputs.stage5b_audit_manifest.path', auditRef?.path);
  if (auditRef?.artifact_type !== 'stage5b_evidence_audit_manifest') {
    errors.push('canonical_evidence_audit.outputs.stage5b_audit_manifest.artifact_type must be stage5b_evidence_audit_manifest');
  }

  packages.forEach((pkg, index) => {
    const label = `packages[${index}]`;
    if (pkg.surrogate_lane?.status !== 'accepted_surrogate_non_evidence') {
      errors.push(`${label}.surrogate_lane.status must be accepted_surrogate_non_evidence`);
    }
    [
      'parser_contract_validated',
      'redaction_contract_validated',
      'package_mapping_validated',
      'audit_reporting_validated',
    ].forEach((field) => {
      if (pkg.surrogate_lane?.[field] !== true) {
        errors.push(`${label}.surrogate_lane.${field} must be true`);
      }
    });
    if (pkg.canonical_evidence_rejection?.candidate_gate_decision !== 'reject') {
      errors.push(`${label}.canonical_evidence_rejection.candidate_gate_decision must be reject`);
    }
    if (pkg.canonical_evidence_rejection?.attachable_evidence_valid !== false) {
      errors.push(`${label}.canonical_evidence_rejection.attachable_evidence_valid must be false`);
    }
    if (pkg.canonical_evidence_rejection?.canonical_intake_classification !== 'invalid_generated') {
      errors.push(`${label}.canonical_evidence_rejection.canonical_intake_classification must be invalid_generated`);
    }
    if (pkg.canonical_evidence_rejection?.evidence_attached !== false) {
      errors.push(`${label}.canonical_evidence_rejection.evidence_attached must be false`);
    }
    if (pkg.canonical_evidence_rejection?.product_inspection_readiness !== false) {
      errors.push(`${label}.canonical_evidence_rejection.product_inspection_readiness must be false`);
    }
    if (safeList(pkg.canonical_evidence_rejection?.rejection_codes).length < 1) {
      errors.push(`${label}.canonical_evidence_rejection.rejection_codes must include at least one canonical rejection reason`);
    }
    pushReadinessHeldError(errors, `${label}.readiness_after_surrogate`, pkg.readiness_after_surrogate);

    safeList(pkg.surrogate_records).forEach((record, recordIndex) => {
      const recordLabel = `${label}.surrogate_records[${recordIndex}]`;
      [
        ['artifact_type', record.artifact_type === 'synthetic_stage5b_pipeline_fixture'],
        ['surrogate_lane_only', record.surrogate_lane_only === true],
        ['synthetic', record.synthetic === true],
        ['non_evidence', record.non_evidence === true],
        ['canonical_evidence_eligible', record.canonical_evidence_eligible === false],
      ].forEach(([field, ok]) => {
        if (!ok) errors.push(`${recordLabel}.${field} must label the record as synthetic surrogate non-evidence`);
      });
      const inspection = safeObject(record.inspection_shape);
      if (inspection.evidence_type !== 'inspection_evidence') {
        errors.push(`${recordLabel}.inspection_shape.evidence_type must keep the parser shape inspection_evidence`);
      }
      if (inspection.package_id !== pkg.slug || inspection.inspected_part !== pkg.slug) {
        errors.push(`${recordLabel}.inspection_shape package_id/inspected_part must map to the package slug`);
      }
      if (!hasSurrogateNonEvidenceLabel(inspection.notes)) {
        errors.push(`${recordLabel}.inspection_shape.notes must explicitly label synthetic surrogate non-evidence`);
      }
      safeList(inspection.measured_features).forEach((feature, featureIndex) => {
        const featureLabel = `${recordLabel}.inspection_shape.measured_features[${featureIndex}]`;
        if (!/^SURROGATE_NON_EVIDENCE:/i.test(String(feature.nominal_value || ''))) {
          errors.push(`${featureLabel}.nominal_value must be prefixed SURROGATE_NON_EVIDENCE`);
        }
        if (!/^SURROGATE_NON_EVIDENCE:/i.test(String(feature.measured_value || ''))) {
          errors.push(`${featureLabel}.measured_value must be prefixed SURROGATE_NON_EVIDENCE`);
        }
        if (!hasSurrogateNonEvidenceLabel(feature.measurement_method)) {
          errors.push(`${featureLabel}.measurement_method must label synthetic surrogate non-evidence`);
        }
        if (feature.value_origin !== 'repo_local_spec_surrogate_non_evidence') {
          errors.push(`${featureLabel}.value_origin must be repo_local_spec_surrogate_non_evidence`);
        }
        if (feature.canonical_evidence_eligible !== false) {
          errors.push(`${featureLabel}.canonical_evidence_eligible must be false`);
        }
      });
    });
  });

  return errors;
}

function validatePipelineDoctorSemantics(manifest = {}) {
  const errors = [];
  if (!hardEvidenceRulePresent(manifest.evidence_boundary?.hard_evidence_rule)) {
    errors.push('evidence_boundary.hard_evidence_rule must state the genuine completed physical/supplier/lab/QA evidence rule');
  }
  pushEvidenceBoundaryErrors(errors, 'evidence_boundary.rejected_as_real_evidence', manifest.evidence_boundary?.rejected_as_real_evidence);
  if (manifest.summary?.evidence_attached !== false) {
    errors.push('summary.evidence_attached must be false');
  }
  if (manifest.summary?.canonical_artifacts_mutated !== false) {
    errors.push('summary.canonical_artifacts_mutated must be false');
  }
  if (manifest.summary?.canonical_readiness_regenerated !== false) {
    errors.push('summary.canonical_readiness_regenerated must be false');
  }
  if (manifest.summary?.packages_marked_ready !== false) {
    errors.push('summary.packages_marked_ready must be false');
  }
  if (manifest.summary?.readiness_status !== 'needs_more_evidence') {
    errors.push('summary.readiness_status must remain needs_more_evidence');
  }
  if (manifest.summary?.readiness_gate_decision !== 'hold_for_evidence_completion') {
    errors.push('summary.readiness_gate_decision must remain hold_for_evidence_completion');
  }
  if (manifest.readiness_held_truth?.readiness_remains_held !== true) {
    errors.push('readiness_held_truth.readiness_remains_held must be true');
  }
  if (manifest.readiness_held_truth?.canonical_readiness_regenerated !== false) {
    errors.push('readiness_held_truth.canonical_readiness_regenerated must be false');
  }
  if (manifest.raw_private_copy_guard?.marker_copied_to_output !== false) {
    errors.push('raw_private_copy_guard.marker_copied_to_output must be false');
  }
  if (manifest.next_human_step?.canonical_attachment_allowed_now !== false) {
    errors.push('next_human_step.canonical_attachment_allowed_now must be false');
  }
  if (manifest.next_human_step?.canonical_readiness_regeneration_allowed_now !== false) {
    errors.push('next_human_step.canonical_readiness_regeneration_allowed_now must be false');
  }
  if (!/later.*explicit.*real.*attachment\/regeneration goal/i.test(String(manifest.next_human_step?.instructions || ''))) {
    errors.push('next_human_step.instructions must give the later explicit real attachment/regeneration goal boundary');
  }
  if (manifest.summary?.blocker_count !== safeList(manifest.blockers).length) {
    errors.push('summary.blocker_count must match blockers.length');
  }
  if (manifest.summary?.decision === 'pass' && safeList(manifest.blockers).length > 0) {
    errors.push('summary.decision pass requires no blockers');
  }
  if (manifest.summary?.decision === 'pass' && manifest.summary?.attachment_controller_fail_closed_proven !== true) {
    errors.push('summary.attachment_controller_fail_closed_proven must be true when the doctor passes');
  }

  safeList(manifest.commands_run).forEach((entry, index) => {
    if (entry.mutates_canonical_artifacts !== false) {
      errors.push(`commands_run[${index}].mutates_canonical_artifacts must be false`);
    }
    pushCommandPathErrors(errors, `commands_run[${index}].command`, entry.command);
  });
  safeList(manifest.artifacts).forEach((entry, index) => {
    pushRepoPathError(errors, `artifacts[${index}].path`, entry.path, { nullable: true });
  });
  safeList(manifest.schemas).forEach((entry, index) => {
    pushRepoPathError(errors, `schemas[${index}].path`, entry.path);
  });
  safeList(manifest.readiness_packages).forEach((pkg, index) => {
    if (pkg.readiness_remains_held !== true) {
      errors.push(`readiness_packages[${index}] must remain needs_more_evidence / hold_for_evidence_completion`);
    }
    pushRepoPathError(errors, `readiness_packages[${index}].path`, pkg.path);
  });
  safeList(manifest.non_evidence_guards).forEach((guard, index) => {
    if (guard.classification !== 'unsafe_or_not_evidence') {
      errors.push(`non_evidence_guards[${index}].classification must be unsafe_or_not_evidence`);
    }
    if (guard.canonical_evidence_eligible !== false) {
      errors.push(`non_evidence_guards[${index}].canonical_evidence_eligible must be false`);
    }
    if (guard.evidence_attached !== false) {
      errors.push(`non_evidence_guards[${index}].evidence_attached must be false`);
    }
    pushSourceRefError(errors, `non_evidence_guards[${index}].source`, guard.source);
    pushRepoPathError(errors, `non_evidence_guards[${index}].report_path`, guard.report_path, { nullable: true });
  });
  pushRepoPathError(errors, 'outputs.manifest.path', manifest.outputs?.manifest?.path);

  return errors;
}

export function validateStage5bCandidateGateReport(report) {
  return validationResult([
    ...schemaDiagnostics(validateCandidateGateReportSchema, report, 'stage5b_candidate_evidence_acceptance_report'),
    ...semanticDiagnostics(validateCandidateGateReportSemantics(report), 'stage5b_candidate_evidence_acceptance_report'),
  ]);
}

export function validateStage5bEvidenceReviewDryRunManifest(manifest) {
  return validationResult([
    ...schemaDiagnostics(validateReviewDryRunManifestSchema, manifest, 'stage5b_evidence_review_dry_run_manifest'),
    ...semanticDiagnostics(validateEvidenceReviewDryRunSemantics(manifest), 'stage5b_evidence_review_dry_run_manifest'),
  ]);
}

export function validateStage5bEvidenceAttachmentControlManifest(manifest) {
  return validationResult([
    ...schemaDiagnostics(validateAttachmentControlManifestSchema, manifest, 'stage5b_evidence_attachment_control_manifest'),
    ...semanticDiagnostics(validateAttachmentControlSemantics(manifest), 'stage5b_evidence_attachment_control_manifest'),
  ]);
}

export function validateStage5bEvidencePipelineDoctorManifest(manifest) {
  return validationResult([
    ...schemaDiagnostics(validatePipelineDoctorManifestSchema, manifest, 'stage5b_evidence_pipeline_doctor_manifest'),
    ...semanticDiagnostics(validatePipelineDoctorSemantics(manifest), 'stage5b_evidence_pipeline_doctor_manifest'),
  ]);
}

export function validateStage5bIntakeReport(report) {
  return validationResult([
    ...schemaDiagnostics(validateIntakeSchema, report, 'inspection_evidence_intake_report'),
    ...semanticDiagnostics(validateIntakeSemantics(report), 'inspection_evidence_intake_report'),
  ]);
}

export function validateStage5bPromotionDryRunManifest(manifest) {
  return validationResult([
    ...schemaDiagnostics(validatePromotionDryRunSchema, manifest, 'inspection_evidence_promotion_dry_run_manifest'),
    ...semanticDiagnostics(validatePromotionDryRunSemantics(manifest), 'inspection_evidence_promotion_dry_run_manifest'),
  ]);
}

export function validateStage5bAuditManifest(manifest) {
  return validationResult([
    ...schemaDiagnostics(validateAuditManifestSchema, manifest, 'stage5b_evidence_audit_manifest'),
    ...semanticDiagnostics(validateAuditManifestSemantics(manifest), 'stage5b_evidence_audit_manifest'),
  ]);
}

export function validateStage5bSurrogateInspectionValidation(manifest) {
  return validationResult([
    ...schemaDiagnostics(validateSurrogateInspectionValidationSchema, manifest, 'surrogate_inspection_validation'),
    ...semanticDiagnostics(validateSurrogateInspectionValidationSemantics(manifest), 'surrogate_inspection_validation'),
  ]);
}

export function validateStage5bArtifact(document) {
  const artifactType = document?.artifact_type;
  if (artifactType === 'stage5b_candidate_evidence_acceptance_report') {
    return validateStage5bCandidateGateReport(document);
  }
  if (artifactType === 'stage5b_evidence_review_dry_run_manifest') {
    return validateStage5bEvidenceReviewDryRunManifest(document);
  }
  if (artifactType === 'stage5b_evidence_attachment_control_manifest') {
    return validateStage5bEvidenceAttachmentControlManifest(document);
  }
  if (artifactType === 'stage5b_evidence_pipeline_doctor_manifest') {
    return validateStage5bEvidencePipelineDoctorManifest(document);
  }
  if (artifactType === 'inspection_evidence_intake_report') {
    return validateStage5bIntakeReport(document);
  }
  if (artifactType === 'inspection_evidence_promotion_dry_run_manifest') {
    return validateStage5bPromotionDryRunManifest(document);
  }
  if (artifactType === 'stage5b_evidence_audit_manifest') {
    return validateStage5bAuditManifest(document);
  }
  if (artifactType === 'surrogate_inspection_validation') {
    return validateStage5bSurrogateInspectionValidation(document);
  }
  return validationResult([makeDiagnostic({
    artifactType: artifactType || 'unknown',
    validationStage: 'schema',
    code: 'stage5b.schema.unsupported_artifact',
    message: `unsupported Stage 5B artifact_type: ${artifactType || 'missing'}`,
    jsonPointer: '/artifact_type',
  })]);
}

export function validateStage5bAuditSummaryMarkdown(markdown) {
  const text = String(markdown || '');
  const errors = [];
  [
    /# Stage 5B Evidence Audit Summary/,
    /Genuine candidate found:\s+(?:yes|no)/i,
    /Inspection evidence attached:\s+no/i,
    /Promotion can run:\s+(?:yes|no)/i,
    /Readiness remains held:\s+(?:yes|no)/i,
    /## Evidence Boundary/,
    /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/i,
  ].forEach((pattern) => {
    if (!pattern.test(text)) errors.push(`stage5b_audit_summary.md missing required wording: ${pattern}`);
  });
  return validationResult(semanticDiagnostics(errors, 'stage5b_evidence_audit_summary_markdown'));
}
