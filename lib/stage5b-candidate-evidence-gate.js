import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { validateInspectionEvidence } from './inspection-evidence.js';

export const STAGE5B_CANDIDATE_GATE_ARTIFACT_TYPE = 'stage5b_candidate_evidence_acceptance_report';
export const STAGE5B_CANDIDATE_GATE_SCHEMA_VERSION = '1.0';
export const STAGE5B_CANDIDATE_HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
export const STAGE5B_CANDIDATE_GATE_PASSING_MEANING = 'eligible for later Stage 5B intake review only';

const READINESS_UNCHANGED_TRUTH = 'unchanged: no evidence is attached; canonical packages remain needs_more_evidence / hold_for_evidence_completion until a later explicitly authorized attachment task validates, reviews, attaches genuine evidence, and refreshes package artifacts';
const REJECTED_AS_FINAL_EVIDENCE = Object.freeze([
  'generated/control artifacts',
  'candidate gate reports',
  'attachment authorization records',
  'diagnostics',
  'schemas',
  'fixtures',
  'intake reports',
  'promotion dry-run manifests',
  'audit manifests and audit outputs',
  'GitHub/CI metadata',
  'screenshots',
  'templates',
  'collection guides and docs',
  'comments and PR bodies',
  'readiness reports',
  'review packs',
  'release bundles',
  'CAD-generated measurements',
]);

const ACCEPTED_SOURCE_TYPES = new Set([
  'cmm_report',
  'manual_caliper_check',
  'go_no_go_gauge',
  'first_article_inspection',
  'supplier_inspection_report',
  'other_inspection_source',
]);

const COMPLETED_STATUS_VALUES = new Set([
  'complete',
  'completed',
  'closed',
  'final',
  'released',
  'approved',
]);

const ACCEPTED_OVERALL_RESULTS = new Set(['pass', 'fail', 'partial']);

const ORIGIN_CATEGORY_VALUES = new Set([
  'physical',
  'supplier',
  'lab',
  'qa',
  'quality',
  'quality_assurance',
]);

const REVISION_FIELDS = Object.freeze([
  'revision',
  'part_revision',
  'drawing_revision',
  'package_revision',
  'inspected_revision',
]);

const REVIEWER_FIELDS = Object.freeze([
  'reviewed_by',
  'approved_by',
  'qa_reviewer',
  'reviewer',
  'quality_reviewer',
]);

const GENERATED_ARTIFACT_TYPES = new Set([
  'artifact_manifest',
  'audit_manifest',
  'cad_generated_measurement',
  'canonical_package',
  'canonical_package_manifest',
  'ci_metadata',
  'ci_summary',
  'collection_guide',
  'create_quality',
  'create_quality_report',
  'dfm_report',
  'diagnostics',
  'docs_manifest',
  'drawing_intent',
  'drawing_qa',
  'drawing_qa_report',
  'drawing_quality',
  'drawing_quality_report',
  'feature_catalog',
  'github_check_run',
  'github_comment',
  'github_metadata',
  'github_pr_body',
  'github_workflow_metadata',
  'inspection_evidence_intake_report',
  'inspection_evidence_promotion_dry_run_manifest',
  'output_manifest',
  'package_artifact',
  'pr_body',
  'readiness_report',
  'release_bundle',
  'release_bundle_log',
  'release_bundle_manifest',
  'review_comment',
  'review_pack',
  'schema',
  'screenshot',
  'stage5b_attachment_authorization_record',
  'stage5b_evidence_audit_manifest',
  'stage5b_validation_diagnostics',
  'attachment_authorization_record',
  'authorization_record',
  'standard_docs_manifest',
  'template',
]);

const GENERATED_ARTIFACT_TYPE_PATTERNS = Object.freeze([
  /^input\./,
  /^output\./,
  /^readiness[-_.]/,
  /^review[-_.]/,
  /^release[-_.]/,
  /^standard[-_.]docs/,
  /^stage5b[-_.]/,
]);

const NON_EVIDENCE_PATH_RULES = Object.freeze([
  ['generated_control_artifact', /(^|\/)[^/]*_create_quality\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)[^/]*_drawing_quality\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)[^/]*_drawing_qa\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)[^/]*_drawing_intent\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)[^/]*_feature_catalog\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)[^/]*_dfm_report\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_control_artifact', /(^|\/)(?:artifact-manifest|output-manifest)\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['readiness_artifact_not_evidence', /(^|\/)(?:readiness_report|readiness-report)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i],
  ['review_artifact_not_evidence', /(^|\/)(?:review_pack|review-pack)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i],
  ['standard_docs_artifact_not_evidence', /(^|\/)standard_docs_manifest\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['release_bundle_not_evidence', /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i],
  ['release_bundle_not_evidence', /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i],
  ['diagnostics_not_evidence', /(^|\/)validation_diagnostics\.json$/i],
  ['schema_not_evidence', /^schemas\//i],
  ['fixture_not_evidence', /^tests\/fixtures\//i],
  ['intake_output_not_evidence', /(^|\/)(?:intake_report|inspection-evidence-intake-report)\.json$/i],
  ['promotion_dry_run_output_not_evidence', /(^|\/)promotion_dry_run_manifest\.json$/i],
  ['audit_output_not_evidence', /(^|\/)stage5b_audit_manifest\.json$/i],
  ['audit_output_not_evidence', /(^|\/)stage5b_audit_summary\.md$/i],
  ['authorization_record_not_evidence', /(^|\/)(?:stage-5b-)?attachment-authorization-record\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['authorization_record_not_evidence', /(^|\/)attachment_authorization_record\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['github_ci_metadata_not_evidence', /^\.github\/(?:workflows|pull_request_template|ISSUE_TEMPLATE)\//i],
  ['github_ci_metadata_not_evidence', /^\.github\/(?:pull_request_template|PULL_REQUEST_TEMPLATE)\.(?:md|markdown|txt)$/],
  ['github_ci_metadata_not_evidence', /(^|\/)(?:github|ci|check-run|workflow|actions?)[-_]?(?:metadata|summary|run|comment|pr-body|pull-request-body)\.(?:json|md|txt|yml|yaml)$/i],
  ['screenshot_not_evidence', /\.(?:png|jpe?g|gif|webp|heic|tiff?)$/i],
  ['template_not_evidence', /(^|\/)(?:template|templates|sample|example)[^/]*\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['guide_not_evidence', /^docs\/inspection-evidence-collection\//i],
  ['guide_not_evidence', /^docs\/(?!examples\/[^/]+\/inspection\/).+\.(?:md|markdown|txt)$/i],
  ['guide_not_evidence', /(^|\/)(?:guide|runbook|walkthrough|readme)\.(?:md|markdown|txt)$/i],
  ['comment_or_pr_body_not_evidence', /(^|\/)(?:comment|review-comment|pr-body|pull-request-body|issue-body)\.(?:json|md|markdown|txt)$/i],
]);

const NON_GENUINE_TEXT_PATTERN = /synthetic|fixture|template|example only|collection guide|generated|simulated|inferred|cad-generated|non[-/ ]?evidence|not readiness evidence|not package readiness evidence/i;
const CAD_GENERATED_METHOD_PATTERN = /cad|freecad|model|geometry|drawing|techdraw|simulated|synthetic|inferred/i;
const SECRET_PATTERN = /authorization\s*[:=]|bearer\s+[a-z0-9._-]+|gho_[a-z0-9_]+|github_pat_[a-z0-9_]+|access_token=|token=|secret=|api[_-]?key=/i;

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function isSafeRepoPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  const normalized = normalizeRepoPath(raw);
  if (raw.includes('\\')) return false;
  if (normalized.startsWith('/') || isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) return false;
  if (normalized.startsWith('~') || normalized.includes('\0')) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  if (normalized === 'output' || normalized.startsWith('output/')) return false;
  if (normalized === 'tmp/codex' || normalized.startsWith('tmp/codex/')) return false;
  return !normalized.split('/').includes('..');
}

function safeRepoRelativePath(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return null;
  const root = resolve(projectRoot);
  const absolute = resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return isSafeRepoPath(rel) ? rel : null;
}

function summarizeUnsafePath(pathValue) {
  if (!pathValue) return null;
  return basename(String(pathValue).replaceAll('\\', '/'));
}

function sanitizeSourceRef(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (SECRET_PATTERN.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }
  return isSafeRepoPath(raw) ? normalizeRepoPath(raw) : summarizeUnsafePath(raw);
}

function addRejection(rejections, code, message, {
  field = null,
  requirement = null,
} = {}) {
  rejections.push({
    code,
    severity: 'error',
    field,
    requirement,
    message,
  });
}

function normalizeArtifactType(value) {
  return String(value || '').trim().toLowerCase();
}

function isGeneratedArtifactType(value) {
  const normalized = normalizeArtifactType(value);
  return GENERATED_ARTIFACT_TYPES.has(normalized)
    || GENERATED_ARTIFACT_TYPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function nonEvidencePathCodes(pathValue) {
  const normalized = normalizeRepoPath(pathValue).toLowerCase();
  return [...new Set(NON_EVIDENCE_PATH_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([code]) => code))];
}

function firstString(document, fields) {
  for (const field of fields) {
    const value = document[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hasAnyString(document, fields) {
  return Boolean(firstString(document, fields));
}

function originCategory(document) {
  const raw = firstString(document, ['origin_category', 'inspection_origin', 'source_origin']);
  return raw ? raw.toLowerCase().replace(/[^a-z0-9]+/g, '_') : null;
}

function hasCompletedStatus(document) {
  const raw = firstString(document, [
    'inspection_status',
    'status',
    'completion_status',
    'record_status',
  ]);
  if (!raw) return false;
  return COMPLETED_STATUS_VALUES.has(raw.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
}

function hasRevisionMapping(document) {
  return hasAnyString(document, REVISION_FIELDS);
}

function hasReviewerTraceability(document) {
  return hasAnyString(document, REVIEWER_FIELDS)
    || safeList(document.reviewer_traceability).length > 0
    || safeList(document.traceability_refs).length > 0;
}

function isCadGeneratedMeasurement(feature = {}) {
  const method = String(feature.measurement_method || '');
  const source = String(feature.measurement_source || feature.source || '');
  return CAD_GENERATED_METHOD_PATTERN.test(method) || CAD_GENERATED_METHOD_PATTERN.test(source);
}

function candidateSummary(document, candidatePath) {
  const sourceRef = firstString(document, ['source_ref', 'source_file']);
  return {
    path: candidatePath || null,
    source_ref: sanitizeSourceRef(sourceRef),
    source_type: typeof document.source_type === 'string' ? document.source_type : null,
    package_id: typeof document.package_id === 'string' ? document.package_id : null,
    inspected_part: typeof document.inspected_part === 'string' ? document.inspected_part : null,
    revision: firstString(document, REVISION_FIELDS),
    inspected_at: firstString(document, ['inspected_at', 'inspection_date']),
    inspection_status: firstString(document, ['inspection_status', 'status', 'completion_status', 'record_status']),
    overall_result: typeof document.overall_result === 'string' ? document.overall_result : null,
    measured_feature_count: safeList(document.measured_features).length,
  };
}

function sourceRefField(document) {
  if (typeof document.source_ref === 'string' && document.source_ref.trim()) return 'source_ref';
  if (typeof document.source_file === 'string' && document.source_file.trim()) return 'source_file';
  return null;
}

function buildPathSafety(candidate, candidatePath, rejections) {
  const sourceField = sourceRefField(candidate);
  const rawSourceRef = sourceField ? candidate[sourceField].trim() : null;
  const safeSourceRef = sanitizeSourceRef(rawSourceRef);
  const pathRejectionCodes = rejections
    .filter((rejection) => rejection.field === 'candidate_path')
    .map((rejection) => rejection.code);
  const sourceRefRejectionCodes = rejections
    .filter((rejection) => rejection.field === 'source_ref' || rejection.field === 'source_file')
    .map((rejection) => rejection.code);

  return {
    candidate_path: candidatePath || null,
    candidate_path_is_safe_repo_relative: Boolean(candidatePath && isSafeRepoPath(candidatePath) && pathRejectionCodes.length === 0),
    candidate_path_rejection_codes: [...new Set(pathRejectionCodes)],
    source_ref: safeSourceRef,
    source_ref_field: sourceField,
    source_ref_is_redacted_or_summarized: Boolean(rawSourceRef && safeSourceRef && rawSourceRef !== safeSourceRef),
    source_ref_is_safe_or_null: !rawSourceRef || Boolean(safeSourceRef && sourceRefRejectionCodes.length === 0),
    source_ref_rejection_codes: [...new Set(sourceRefRejectionCodes)],
    safe_repo_relative_paths_required: true,
    absolute_paths_rejected: true,
    traversal_rejected: true,
    output_and_tmp_codex_rejected: true,
    private_machine_paths_rejected: true,
    secret_bearing_refs_rejected: true,
    redaction_note: 'Reports must use safe repo-relative paths or sanitized source refs only; absolute paths, traversal, output/, tmp/codex/, private machine details, private URLs, tokens, credentials, and authorization headers must not be committed.',
  };
}

function checklistItem(id, label, rejectionCodes, rejections) {
  const failedCodes = rejectionCodes.filter((code) => rejections.some((rejection) => rejection.code === code));
  return {
    id,
    label,
    status: failedCodes.length === 0 ? 'pass' : 'fail',
    rejection_codes: failedCodes,
  };
}

function buildStage5bCandidateGateReport(candidate, normalizedCandidatePath, rejections, generatedAt) {
  const uniqueRejections = [];
  const seen = new Set();
  for (const rejection of rejections) {
    const key = `${rejection.code}|${rejection.field || ''}|${rejection.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRejections.push(rejection);
  }

  const eligible = uniqueRejections.length === 0;
  const decision = eligible ? 'accept' : 'reject';
  const decisionLabel = eligible
    ? 'eligible_for_later_stage5b_intake_review'
    : 'rejected_before_stage5b_intake_review';
  const checklist = [
    checklistItem('schema_contract', 'Valid inspection evidence JSON contract', ['candidate_not_json_object', 'inspection_evidence_schema_invalid', 'candidate_json_parse_failed', 'candidate_format_not_json_contract'], uniqueRejections),
    checklistItem('origin', 'Completed physical/supplier/lab/QA inspection origin', ['inspection_origin_not_physical_supplier_lab_or_qa', 'other_origin_missing_physical_supplier_lab_or_qa_category', 'inspection_status_not_completed'], uniqueRejections),
    checklistItem('traceability', 'Source/provenance and reviewer traceability', ['unsafe_source_ref', 'unredacted_provenance_secret', 'inspector_traceability_missing', 'reviewer_traceability_missing'], uniqueRejections),
    checklistItem('mapping', 'Package/part/revision mapping', ['package_or_part_mapping_missing', 'revision_mapping_missing'], uniqueRejections),
    checklistItem('date_status_result', 'Inspection date, status, and result fields', ['inspection_date_missing', 'inspection_status_not_completed', 'overall_result_not_actionable'], uniqueRejections),
    checklistItem('boundary', 'Generated/control/non-evidence boundary', [
      'candidate_path_not_repo_safe',
      'generated_control_artifact',
      'readiness_artifact_not_evidence',
      'review_artifact_not_evidence',
      'standard_docs_artifact_not_evidence',
      'release_bundle_not_evidence',
      'diagnostics_not_evidence',
      'schema_not_evidence',
      'fixture_not_evidence',
      'intake_output_not_evidence',
      'promotion_dry_run_output_not_evidence',
      'audit_output_not_evidence',
      'authorization_record_not_evidence',
      'github_ci_metadata_not_evidence',
      'screenshot_not_evidence',
      'template_not_evidence',
      'guide_not_evidence',
      'comment_or_pr_body_not_evidence',
      'generated_control_artifact_type_not_evidence',
      'non_genuine_candidate_wording',
      'cad_generated_measurement_not_evidence',
    ], uniqueRejections),
  ];

  return {
    artifact_type: STAGE5B_CANDIDATE_GATE_ARTIFACT_TYPE,
    schema_version: STAGE5B_CANDIDATE_GATE_SCHEMA_VERSION,
    generated_at: generatedAt || new Date().toISOString(),
    dry_run: true,
    candidate: candidateSummary(candidate, normalizedCandidatePath),
    summary: {
      eligible_for_stage5b_intake_review: eligible,
      decision,
      candidate_status: eligible ? 'eligible_for_intake_review' : 'rejected',
      rejection_count: uniqueRejections.length,
      rejection_codes: [...new Set(uniqueRejections.map((rejection) => rejection.code))],
      canonical_artifacts_mutated: false,
      genuine_evidence_attached: false,
      readiness_truth: READINESS_UNCHANGED_TRUTH,
    },
    decision: {
      result: decision,
      label: decisionLabel,
      eligible_for_stage5b_intake_review: eligible,
      meaning: eligible
        ? STAGE5B_CANDIDATE_GATE_PASSING_MEANING
        : 'not eligible for Stage 5B intake review until the rejection reasons are resolved',
      next_allowed_step: eligible
        ? 'later_authorized_stage5b_intake_review'
        : 'repair_or_replace_candidate_record_before_stage5b_intake_review',
      does_not_attach_evidence: true,
      does_not_promote_evidence: true,
      does_not_satisfy_readiness: true,
      does_not_mutate_canonical_artifacts: true,
      later_attachment_authorization_required: true,
      reviewer_note: 'A passing candidate gate report is only a pre-intake eligibility signal; it is not evidence attachment, evidence promotion, readiness satisfaction, or attachment authorization. Later explicit attachment authorization is still required before review-context --inspection-evidence can run.',
    },
    checklist,
    rejections: uniqueRejections,
    path_safety: buildPathSafety(candidate, normalizedCandidatePath, uniqueRejections),
    readiness_unchanged: {
      unchanged: true,
      canonical_package_status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
      missing_input: 'inspection_evidence',
      canonical_artifacts_mutated: false,
      genuine_evidence_attached: false,
      evidence_promoted: false,
      readiness_satisfied: false,
      promotion_authorized: false,
      attachment_authorization_required: true,
      note: READINESS_UNCHANGED_TRUTH,
    },
    evidence_boundary: {
      hard_evidence_rule: STAGE5B_CANDIDATE_HARD_EVIDENCE_RULE,
      non_production_gate: true,
      does_not_attach_evidence: true,
      does_not_promote_evidence: true,
      does_not_change_readiness: true,
      rejected_as_final_evidence: [...REJECTED_AS_FINAL_EVIDENCE],
    },
    non_evidence_boundary: {
      generated_control_artifacts_do_not_satisfy_inspection_evidence: true,
      candidate_gate_reports_do_not_satisfy_inspection_evidence: true,
      authorization_records_do_not_satisfy_inspection_evidence: true,
      readiness_reports_do_not_satisfy_inspection_evidence: true,
      review_packs_do_not_satisfy_inspection_evidence: true,
      release_bundles_do_not_satisfy_inspection_evidence: true,
      github_ci_metadata_alone_is_not_evidence: true,
      screenshots_do_not_satisfy_inspection_evidence: true,
      cad_generated_measurements_are_not_evidence: true,
      generated_quality_outputs_do_not_satisfy_inspection_evidence: true,
      rejected_as_final_evidence: [...REJECTED_AS_FINAL_EVIDENCE],
    },
    report_contract: {
      contract_name: 'stage5b_candidate_gate_report',
      contract_version: STAGE5B_CANDIDATE_GATE_SCHEMA_VERSION,
      eligibility_field: 'summary.eligible_for_stage5b_intake_review',
      decision_field: 'decision.result',
      checklist_field: 'checklist',
      rejection_reasons_field: 'rejections',
      path_safety_field: 'path_safety',
      readiness_unchanged_field: 'readiness_unchanged',
      non_evidence_boundary_field: 'non_evidence_boundary',
      authorization_boundary_field: 'decision.later_attachment_authorization_required',
      passing_report_means: STAGE5B_CANDIDATE_GATE_PASSING_MEANING,
      passing_report_does_not_mean: [
        'evidence_attached',
        'evidence_promoted',
        'readiness_satisfied',
        'canonical_artifacts_mutated',
        'attachment_authorized',
      ],
      required_sections: [
        'candidate',
        'summary',
        'decision',
        'checklist',
        'rejections',
        'path_safety',
        'readiness_unchanged',
        'evidence_boundary',
        'non_evidence_boundary',
      ],
    },
  };
}

export function evaluateStage5bCandidateEvidence({
  document,
  candidatePath = null,
  generatedAt = null,
} = {}) {
  const rejections = [];
  const normalizedCandidatePath = candidatePath ? normalizeRepoPath(candidatePath) : null;

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    addRejection(
      rejections,
      'candidate_not_json_object',
      'Candidate must be a JSON object using the inspection evidence contract.',
      { requirement: 'record_shape' }
    );
  }

  const candidate = safeObject(document);
  const schemaValidation = validateInspectionEvidence(candidate);
  if (!schemaValidation.ok) {
    for (const error of schemaValidation.errors) {
      addRejection(
        rejections,
        'inspection_evidence_schema_invalid',
        error,
        { requirement: 'inspection_evidence_schema' }
      );
    }
  }

  for (const pathCode of nonEvidencePathCodes(normalizedCandidatePath)) {
    addRejection(
      rejections,
      pathCode,
      'Candidate path is a generated, control, fixture, metadata, guide, screenshot, template, comment, PR, docs, or release artifact and cannot be inspection evidence.',
      { field: 'candidate_path', requirement: 'evidence_boundary' }
    );
  }

  for (const key of ['artifact_type', 'type', 'artifact_kind']) {
    if (isGeneratedArtifactType(candidate[key])) {
      addRejection(
        rejections,
        'generated_control_artifact_type_not_evidence',
        `${key}=${candidate[key]} is a generated/control artifact type, not inspection evidence.`,
        { field: key, requirement: 'evidence_boundary' }
      );
    }
  }

  const sourceRef = firstString(candidate, ['source_ref', 'source_file']);
  if (sourceRef) {
    for (const pathCode of nonEvidencePathCodes(sourceRef)) {
      addRejection(
        rejections,
        pathCode,
        'Candidate provenance points at a generated/control artifact class that cannot be inspection evidence.',
        { field: candidate.source_ref ? 'source_ref' : 'source_file', requirement: 'provenance_boundary' }
      );
    }
    if (!isSafeRepoPath(sourceRef)) {
      addRejection(
        rejections,
        'unsafe_source_ref',
        'Candidate source_ref/source_file must be a safe repo-relative path with no absolute path, traversal, output/, tmp/codex/, credentials, or tokens.',
        { field: candidate.source_ref ? 'source_ref' : 'source_file', requirement: 'attachment_path_safety' }
      );
    }
    if (SECRET_PATTERN.test(sourceRef)) {
      addRejection(
        rejections,
        'unredacted_provenance_secret',
        'Candidate provenance includes a token, secret, header, or credential-bearing reference.',
        { field: candidate.source_ref ? 'source_ref' : 'source_file', requirement: 'redaction' }
      );
    }
  }

  if (!ACCEPTED_SOURCE_TYPES.has(String(candidate.source_type || ''))) {
    addRejection(
      rejections,
      'inspection_origin_not_physical_supplier_lab_or_qa',
      'Candidate source_type must identify a physical, supplier, lab, or QA inspection origin.',
      { field: 'source_type', requirement: 'completed_physical_supplier_lab_qa_origin' }
    );
  }

  if (candidate.source_type === 'other_inspection_source') {
    const category = originCategory(candidate);
    if (!ORIGIN_CATEGORY_VALUES.has(category)) {
      addRejection(
        rejections,
        'other_origin_missing_physical_supplier_lab_or_qa_category',
        'other_inspection_source candidates must state origin_category/inspection_origin as physical, supplier, lab, or QA.',
        { field: 'origin_category', requirement: 'completed_physical_supplier_lab_qa_origin' }
      );
    }
  }

  if (!hasCompletedStatus(candidate)) {
    addRejection(
      rejections,
      'inspection_status_not_completed',
      'Candidate must explicitly state inspection_status/status/completion_status as completed, final, closed, released, or approved.',
      { field: 'inspection_status', requirement: 'inspection_date_status_result' }
    );
  }

  if (!hasAnyString(candidate, ['inspector', 'inspection_author'])) {
    addRejection(
      rejections,
      'inspector_traceability_missing',
      'Candidate must include inspector or inspection_author traceability.',
      { field: 'inspector', requirement: 'source_provenance_reviewer_traceability' }
    );
  }

  if (!hasReviewerTraceability(candidate)) {
    addRejection(
      rejections,
      'reviewer_traceability_missing',
      'Candidate must include reviewed_by/approved_by/qa_reviewer/reviewer or traceability_refs.',
      { field: 'reviewed_by', requirement: 'source_provenance_reviewer_traceability' }
    );
  }

  if (!hasAnyString(candidate, ['package_id', 'inspected_part'])) {
    addRejection(
      rejections,
      'package_or_part_mapping_missing',
      'Candidate must map to a package_id or inspected_part.',
      { field: 'package_id', requirement: 'package_part_revision_mapping' }
    );
  }

  if (!hasRevisionMapping(candidate)) {
    addRejection(
      rejections,
      'revision_mapping_missing',
      'Candidate must include revision, part_revision, drawing_revision, package_revision, or inspected_revision.',
      { field: 'revision', requirement: 'package_part_revision_mapping' }
    );
  }

  if (!hasAnyString(candidate, ['inspected_at', 'inspection_date'])) {
    addRejection(
      rejections,
      'inspection_date_missing',
      'Candidate must include inspected_at or inspection_date.',
      { field: 'inspected_at', requirement: 'inspection_date_status_result' }
    );
  }

  if (!ACCEPTED_OVERALL_RESULTS.has(String(candidate.overall_result || ''))) {
    addRejection(
      rejections,
      'overall_result_not_actionable',
      'Candidate overall_result must be pass, fail, or partial; unknown is not enough for acceptance review.',
      { field: 'overall_result', requirement: 'inspection_date_status_result' }
    );
  }

  if (NON_GENUINE_TEXT_PATTERN.test([
    candidate.notes,
    candidate.description,
    candidate.summary,
    candidate.source_description,
  ].filter(Boolean).join('\n'))) {
    addRejection(
      rejections,
      'non_genuine_candidate_wording',
      'Candidate text labels itself as synthetic, fixture, template, generated, simulated, inferred, or non-readiness evidence.',
      { field: 'notes', requirement: 'evidence_boundary' }
    );
  }

  safeList(candidate.measured_features).forEach((feature, index) => {
    if (isCadGeneratedMeasurement(feature)) {
      addRejection(
        rejections,
        'cad_generated_measurement_not_evidence',
        'Candidate measured_features must come from physical/supplier/lab/QA inspection, not CAD, FreeCAD, drawing, simulated, inferred, or generated measurements.',
        { field: `measured_features/${index}/measurement_method`, requirement: 'hard_evidence_rule' }
      );
    }
  });

  return buildStage5bCandidateGateReport(candidate, normalizedCandidatePath, rejections, generatedAt);
}

export async function evaluateStage5bCandidateEvidenceFile({
  projectRoot = process.cwd(),
  candidatePath,
  generatedAt = null,
} = {}) {
  const safeCandidatePath = safeRepoRelativePath(projectRoot, candidatePath);
  const rawCandidatePath = normalizeRepoPath(candidatePath);
  const precheckRejections = [];
  for (const pathCode of nonEvidencePathCodes(rawCandidatePath)) {
    addRejection(
      precheckRejections,
      pathCode,
      'Candidate path is a generated/control/non-evidence artifact class and cannot be accepted.',
      { field: 'candidate_path', requirement: 'evidence_boundary' }
    );
  }

  if (!safeCandidatePath) {
    addRejection(
      precheckRejections,
      'candidate_path_not_repo_safe',
      'Candidate path must resolve inside the project root as a safe repo-relative path outside output/ and tmp/codex/.',
      { field: 'candidate_path', requirement: 'attachment_path_safety' }
    );
  }

  if (safeCandidatePath && extname(safeCandidatePath).toLowerCase() !== '.json') {
    addRejection(
      precheckRejections,
      'candidate_format_not_json_contract',
      'Candidate gate accepts JSON contract records only; tables can be discovered by intake but cannot be pre-accepted here.',
      { field: 'candidate_path', requirement: 'record_shape' }
    );
  }

  if (precheckRejections.length > 0) {
    const displayPath = safeCandidatePath || (isSafeRepoPath(rawCandidatePath) ? rawCandidatePath : summarizeUnsafePath(candidatePath));
    return buildStage5bCandidateGateReport({}, displayPath, precheckRejections, generatedAt);
  }

  let document;
  try {
    document = JSON.parse(await readFile(resolve(projectRoot, safeCandidatePath), 'utf8'));
  } catch (error) {
    const parseRejection = {
      code: 'candidate_json_parse_failed',
      severity: 'error',
      field: 'candidate_path',
      requirement: 'record_shape',
      message: 'Candidate JSON could not be parsed.',
    };
    return buildStage5bCandidateGateReport({}, safeCandidatePath, [parseRejection], generatedAt);
  }

  return evaluateStage5bCandidateEvidence({
    document,
    candidatePath: safeCandidatePath,
    generatedAt,
  });
}

export async function writeStage5bCandidateEvidenceGateReport(outputPath, report) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}
