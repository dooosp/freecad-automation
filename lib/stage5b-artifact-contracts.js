import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const COMMON_SCHEMA = readSchema('../schemas/stage5b-artifact-common.schema.json');
const INTAKE_SCHEMA = readSchema('../schemas/stage5b-intake-report.schema.json');
const PROMOTION_DRY_RUN_SCHEMA = readSchema('../schemas/stage5b-promotion-dry-run-manifest.schema.json');
const AUDIT_MANIFEST_SCHEMA = readSchema('../schemas/stage5b-audit-manifest.schema.json');

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

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

ajv.addSchema(COMMON_SCHEMA, COMMON_SCHEMA.$id);

const validateIntakeSchema = ajv.compile(INTAKE_SCHEMA);
const validatePromotionDryRunSchema = ajv.compile(PROMOTION_DRY_RUN_SCHEMA);
const validateAuditManifestSchema = ajv.compile(AUDIT_MANIFEST_SCHEMA);

function readSchema(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
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
  if (report.summary?.accepted_candidate_count !== acceptedCandidates.length) {
    errors.push('summary.accepted_candidate_count must match accepted_candidates.length');
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

export function validateStage5bArtifact(document) {
  const artifactType = document?.artifact_type;
  if (artifactType === 'inspection_evidence_intake_report') {
    return validateStage5bIntakeReport(document);
  }
  if (artifactType === 'inspection_evidence_promotion_dry_run_manifest') {
    return validateStage5bPromotionDryRunManifest(document);
  }
  if (artifactType === 'stage5b_evidence_audit_manifest') {
    return validateStage5bAuditManifest(document);
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
    /Genuine completed evidence found:\s+(?:yes|no)/i,
    /Promotion can run:\s+(?:yes|no)/i,
    /Readiness remains held:\s+(?:yes|no)/i,
    /## Evidence Boundary/,
    /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/i,
  ].forEach((pattern) => {
    if (!pattern.test(text)) errors.push(`stage5b_audit_summary.md missing required wording: ${pattern}`);
  });
  return validationResult(semanticDiagnostics(errors, 'stage5b_evidence_audit_summary_markdown'));
}
