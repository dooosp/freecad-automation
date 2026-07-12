import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  isParseableTimestamp,
  sha256Bytes,
  validateInspectionEvidenceControlMaterial,
  validateJsonDocumentBounds,
} from './inspection-evidence-onboarding.js';

export const REVISION_IMPACT_SCHEMA_VERSION = '1.0';

export const REVISION_IMPACT_CHANGE_TYPES = Object.freeze([
  'metadata_change',
  'revision_identity_change',
  'geometry_feature_added',
  'geometry_feature_removed',
  'geometry_feature_modified',
  'nominal_dimension_change',
  'tolerance_change',
  'datum_or_reference_change',
  'drawing_requirement_change',
  'material_change',
  'manufacturing_process_change',
  'quality_gate_change',
  'critical_characteristic_change',
  'inspection_method_requirement_change',
  'specification_reference_change',
  'evidence_reference_change',
  'unresolved_identity_change',
]);

export const REVISION_IMPACT_DECISIONS = Object.freeze([
  'no_material_change',
  'review_required',
  'reinspection_required',
  'blocked_insufficient_identity_or_inputs',
]);

export const REVISION_IMPACT_DETERMINABILITY_STATES = Object.freeze([
  'determined',
  'unable_to_determine',
]);

export const REVISION_IMPACT_SEVERITIES = Object.freeze([
  'informational',
  'low',
  'medium',
  'high',
  'blocking',
]);

export const REVISION_IMPACT_REQUIRED_ACTIONS = Object.freeze([
  'none',
  'human_review',
  'reinspect',
  'resolve_identity_or_inputs',
]);

export const REVISION_IMPACT_EVIDENCE_STATUSES = Object.freeze([
  'unaffected',
  'review_required',
  'reinspection_required',
  'potentially_stale',
  'unable_to_determine',
  'not_applicable',
]);

export const REVISION_IMPACT_REINSPECTION_STATUSES = Object.freeze([
  'not_required',
  'review_required',
  'planned',
  'blocked',
]);

const SCHEMA_URL = new URL('../schemas/revision_impact_report.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  validateFormats: false,
});
const validateSchema = ajv.compile(schema);

const NON_MATERIAL_CHANGE_TYPES = new Set([
  'metadata_change',
  'revision_identity_change',
]);
const REVIEW_ASSESSMENT_STATUSES = new Set([
  'review_required',
  'potentially_stale',
]);
const NO_HUMAN_DECISION_STATUSES = new Set([
  'unaffected',
  'not_applicable',
]);
const MUTATION_BOUNDARY_KEYS = Object.freeze([
  'inspection_evidence_attached',
  'existing_evidence_mutated',
  'evidence_superseded',
  'readiness_regenerated',
  'canonical_artifacts_mutated',
  'release_published',
  'measured_values_generated',
]);
const AFFIRMATIVE_AUTHORITY_KEYS = /^(?:production_readiness|production_ready|package_ready|part_ready|inspection_passed|inspection_approved|evidence_accepted|evidence_authorized|evidence_attached|evidence_superseded|readiness_approved|release_published)$/i;
const RAW_PRIVATE_CONTENT_KEYS = /^(?:(?:raw_)?(?:supplier|lab)(?:_[a-z0-9]+)*(?:_content|_bytes|_payload|_document|_report)|raw_source|raw_source_content|source_bytes|source_payload)$/i;
const AFFIRMATIVE_AUTHORITY_CLAIMS = Object.freeze([
  /\binspection (?:has )?(?:passed|been approved|been accepted)\b/i,
  /\bevidence (?:is |was |has been )?(?:accepted|authorized|attached|superseded)\b/i,
  /\b(?:package|part|candidate|revision) (?:is |was |has been )?(?:ready|released|approved for (?:production|release))\b/i,
  /\b(?:production[- ]ready|production capable|ready for production)\b/i,
  /\breadiness (?:is |was |has been )?(?:approved|passed|completed)\b/i,
]);
const SECRET_VALUE_PATTERNS = Object.freeze([
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
]);
const VOLATILE_STABLE_ID_KEY = /(?:^|_)(?:generated_at|created_at|updated_at|timestamp|random|nonce|uuid)(?:_|$)/i;
const NON_PUBLIC_REF_PREFIX = /^(?:local|output|tmp)(?:\/|$)/i;

function normalizeInstancePath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function schemaErrors() {
  return (validateSchema.errors || []).map((error) => {
    const path = normalizeInstancePath(error);
    return {
      code: `schema_${error.keyword}`,
      path,
      message: `${path} ${error.message}`.trim(),
    };
  });
}

function pushError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function pointerSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function walkJson(value, visitor, path = '/', seen = new WeakSet()) {
  visitor(value, path);
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkJson(entry, visitor, `${path === '/' ? '' : path}/${index}`, seen));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    walkJson(entry, visitor, `${path === '/' ? '' : path}/${pointerSegment(key)}`, seen);
  });
}

function walkJsonEntries(value, visitor, path = '/', seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkJsonEntries(entry, visitor, `${path === '/' ? '' : path}/${index}`, seen));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    const childPath = `${path === '/' ? '' : path}/${pointerSegment(key)}`;
    visitor(key, entry, childPath);
    walkJsonEntries(entry, visitor, childPath, seen);
  });
}

function sortJsonValue(value, active = new WeakSet(), path = '/') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      const error = new TypeError(`Revision-impact canonical JSON requires a finite number at ${path}`);
      error.code = 'non_finite_number';
      throw error;
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    const error = new TypeError(`Revision-impact canonical JSON cannot encode ${typeof value} at ${path}`);
    error.code = 'non_json_value';
    throw error;
  }
  if (active.has(value)) {
    const error = new TypeError(`Revision-impact canonical JSON cannot encode a cycle at ${path}`);
    error.code = 'json_cycle_forbidden';
    throw error;
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      const error = new TypeError(`Revision-impact canonical JSON requires a plain object at ${path}`);
      error.code = 'non_json_object';
      throw error;
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    const error = new TypeError(`Revision-impact canonical JSON cannot encode symbol keys at ${path}`);
    error.code = 'non_json_value';
    throw error;
  }

  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        active.delete(value);
        const error = new TypeError(`Revision-impact canonical JSON cannot encode a sparse array at ${path}/${index}`);
        error.code = 'non_json_value';
        throw error;
      }
      normalized.push(sortJsonValue(value[index], active, `${path}/${index}`));
    }
  } else {
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      const entryPath = `${path === '/' ? '' : path}/${pointerSegment(key)}`;
      normalized[key] = sortJsonValue(value[key], active, entryPath);
    }
  }
  active.delete(value);
  return normalized;
}

/**
 * Return canonical revision-impact JSON with recursively sorted object keys,
 * two-space indentation, and exactly one trailing newline. Array order remains
 * semantic and is checked by validateRevisionImpactReport.
 */
export function canonicalizeRevisionImpactJson(value) {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function hashRevisionImpactValue(value) {
  return sha256Bytes(canonicalizeRevisionImpactJson(value));
}

function assertStableIdBasis(value) {
  let volatilePath = null;
  walkJsonEntries(value, (key, _entry, path) => {
    if (volatilePath === null && VOLATILE_STABLE_ID_KEY.test(key)) volatilePath = path;
  });
  if (volatilePath) {
    const error = new TypeError(`Stable revision-impact ID basis must not contain volatile data at ${volatilePath}`);
    error.code = 'volatile_stable_id_basis';
    throw error;
  }
}

export function buildRevisionImpactStableId(prefix, basis) {
  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(prefix)) {
    const error = new TypeError('Revision-impact stable ID prefix must be a lowercase identifier');
    error.code = 'invalid_stable_id_prefix';
    throw error;
  }
  assertStableIdBasis(basis);
  return `${prefix}_${hashRevisionImpactValue(basis)}`;
}

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateSorted(values, path, errors, key = (value) => value) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodePoints(String(key(values[index - 1])), String(key(values[index]))) > 0) {
      pushError(
        errors,
        'non_deterministic_order',
        path,
        `${path} must use deterministic ascending code-point order`
      );
      return;
    }
  }
}

function validateUnique(values, path, code, errors, key = (value) => value) {
  const seen = new Set();
  values.forEach((value, index) => {
    const identity = key(value);
    if (seen.has(identity)) {
      pushError(errors, code, `${path}/${index}`, `${path} must not contain duplicate identity ${identity}`);
    }
    seen.add(identity);
  });
}

function validateRelatedChangeIds(values, path, changeIds, errors) {
  validateSorted(values, path, errors);
  values.forEach((changeId, index) => {
    if (!changeIds.has(changeId)) {
      pushError(
        errors,
        'unknown_related_change_id',
        `${path}/${index}`,
        `${path}/${index} must reference a change_id present in /changes`
      );
    }
  });
}

function validatePublicArtifactRef(value, path, errors) {
  if (value !== null && NON_PUBLIC_REF_PREFIX.test(value)) {
    pushError(
      errors,
      'unsafe_public_artifact_ref',
      path,
      `${path} must use a portable sanitized reference and must not expose local, output, or temporary storage`
    );
  }
}

function validateFiniteNumbers(report, errors) {
  walkJson(report, (value, path) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      pushError(errors, 'non_finite_number', path, `${path} must contain a finite JSON number`);
    }
  });
}

function validateAuthorityBoundaries(report, errors) {
  walkJsonEntries(report, (key, value, path) => {
    if (AFFIRMATIVE_AUTHORITY_KEYS.test(key) && value === true) {
      pushError(
        errors,
        'forbidden_authority_claim',
        path,
        `${path} must not make an affirmative evidence, inspection, readiness, release, or production claim`
      );
    }
    if (RAW_PRIVATE_CONTENT_KEYS.test(key) && value !== null && value !== false && value !== '') {
      pushError(
        errors,
        'raw_private_source_content_exposed',
        path,
        `${path} must not expose raw supplier or laboratory source content`
      );
    }
  });
  walkJson(report, (value, path) => {
    if (typeof value !== 'string') return;
    const normalized = value.trim();
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      pushError(
        errors,
        'secret_material_exposed',
        path,
        `${path} must not contain credentials, tokens, authorization material, or private keys`
      );
    }
    if (AFFIRMATIVE_AUTHORITY_CLAIMS.some((pattern) => pattern.test(normalized))) {
      pushError(
        errors,
        'forbidden_authority_claim',
        path,
        `${path} must not claim accepted evidence, passed inspection, production readiness, or release authority`
      );
    }
  });
}

function validateChangeInvariants(report, errors) {
  const changes = report.changes;
  validateSorted(changes, '/changes', errors, (change) => change.change_id);
  validateUnique(changes, '/changes', 'duplicate_change_id', errors, (change) => change.change_id);

  changes.forEach((change, index) => {
    const path = `/changes/${index}`;
    if (change.affected_entity_id === null && change.determinability === 'determined') {
      pushError(
        errors,
        'determined_change_missing_identity',
        `${path}/affected_entity_id`,
        `${path} cannot be determined without a stable affected entity identity`
      );
    }
    if (change.change_type === 'unresolved_identity_change' && change.determinability !== 'unable_to_determine') {
      pushError(
        errors,
        'unresolved_identity_marked_determined',
        `${path}/determinability`,
        `${path} must preserve unable_to_determine for unresolved identity`
      );
    }
    if (change.determinability === 'unable_to_determine'
      && !['human_review', 'resolve_identity_or_inputs'].includes(change.required_action)) {
      pushError(
        errors,
        'unable_change_missing_review_action',
        `${path}/required_action`,
        `${path} must require human review or identity/input resolution`
      );
    }
    if (change.required_action === 'reinspect' && change.determinability !== 'determined') {
      pushError(
        errors,
        'indeterminate_reinspection_forbidden',
        `${path}/required_action`,
        `${path} must not require authoritative reinspection while impact is unable_to_determine`
      );
    }
    if (change.baseline_source_ref === null && change.candidate_source_ref === null) {
      pushError(
        errors,
        'change_source_reference_missing',
        path,
        `${path} must retain at least one portable baseline or candidate source reference`
      );
    }
    if (change.baseline_source_ref !== null && change.source_hashes.baseline === null) {
      pushError(
        errors,
        'change_source_hash_missing',
        `${path}/source_hashes/baseline`,
        `${path} must hash its baseline source reference`
      );
    }
    if (change.candidate_source_ref !== null && change.source_hashes.candidate === null) {
      pushError(
        errors,
        'change_source_hash_missing',
        `${path}/source_hashes/candidate`,
        `${path} must hash its candidate source reference`
      );
    }
    if (canonicalizeRevisionImpactJson(change.before_value) === canonicalizeRevisionImpactJson(change.after_value)) {
      pushError(
        errors,
        'change_without_delta',
        path,
        `${path} must not describe identical normalized before and after values`
      );
    }
  });
}

function validateAssessmentInvariants(report, changeIds, errors) {
  const assessments = report.evidence_applicability.assessments;
  validateSorted(assessments, '/evidence_applicability/assessments', errors, (assessment) => assessment.assessment_id);
  validateUnique(
    assessments,
    '/evidence_applicability/assessments',
    'duplicate_assessment_id',
    errors,
    (assessment) => assessment.assessment_id
  );
  validateUnique(
    assessments,
    '/evidence_applicability/assessments',
    'duplicate_characteristic_assessment',
    errors,
    (assessment) => assessment.evidence_or_characteristic_id
  );

  assessments.forEach((assessment, index) => {
    const path = `/evidence_applicability/assessments/${index}`;
    validateRelatedChangeIds(assessment.related_change_ids, `${path}/related_change_ids`, changeIds, errors);
    if (assessment.baseline_package_revision !== report.baseline.revision) {
      pushError(
        errors,
        'assessment_baseline_revision_mismatch',
        `${path}/baseline_package_revision`,
        `${path} must bind to the report baseline revision`
      );
    }
    if (assessment.candidate_package_revision !== report.candidate.revision) {
      pushError(
        errors,
        'assessment_candidate_revision_mismatch',
        `${path}/candidate_package_revision`,
        `${path} must bind to the report candidate revision`
      );
    }
    const expectedHumanDecision = !NO_HUMAN_DECISION_STATUSES.has(assessment.applicability_status);
    if (assessment.human_decision_required !== expectedHumanDecision) {
      pushError(
        errors,
        'assessment_human_decision_mismatch',
        `${path}/human_decision_required`,
        `${path} human_decision_required is inconsistent with applicability_status`
      );
    }
    if (expectedHumanDecision && assessment.reinspection_action === null) {
      pushError(
        errors,
        'assessment_action_missing',
        `${path}/reinspection_action`,
        `${path} must state the future review or reinspection action`
      );
    }
    if (!expectedHumanDecision && assessment.reinspection_action !== null) {
      pushError(
        errors,
        'assessment_action_unexpected',
        `${path}/reinspection_action`,
        `${path} must not invent an action for unaffected or not-applicable evidence`
      );
    }
  });
}

function validatePlanInvariants(report, changeIds, errors) {
  const items = report.reinspection_plan.items;
  validateSorted(items, '/reinspection_plan/items', errors, (item) => item.plan_item_id);
  validateUnique(items, '/reinspection_plan/items', 'duplicate_plan_item_id', errors, (item) => item.plan_item_id);

  items.forEach((item, index) => {
    const path = `/reinspection_plan/items/${index}`;
    validateRelatedChangeIds(item.related_change_ids, `${path}/related_change_ids`, changeIds, errors);
    validateSorted(item.required_evidence_fields, `${path}/required_evidence_fields`, errors);
    validateSorted(item.source_artifact_refs, `${path}/source_artifact_refs`, errors);
    if (item.package_slug !== report.candidate.package_slug) {
      pushError(
        errors,
        'plan_package_mismatch',
        `${path}/package_slug`,
        `${path} must bind to the report candidate package`
      );
    }
    if (item.candidate_revision !== report.candidate.revision) {
      pushError(
        errors,
        'plan_revision_mismatch',
        `${path}/candidate_revision`,
        `${path} must bind to the report candidate revision`
      );
    }
  });
}

function validateSummaryInvariants(report, errors) {
  const materialChangeCount = report.changes
    .filter((change) => !NON_MATERIAL_CHANGE_TYPES.has(change.change_type))
    .length;
  const reviewRequiredCount = report.changes
    .filter((change) => change.required_action === 'human_review')
    .length
    + report.evidence_applicability.assessments
      .filter((assessment) => REVIEW_ASSESSMENT_STATUSES.has(assessment.applicability_status))
      .length;
  const reinspectionRequiredCount = report.reinspection_plan.items.length;
  const unableToDetermineCount = report.changes
    .filter((change) => change.determinability === 'unable_to_determine')
    .length
    + report.evidence_applicability.assessments
      .filter((assessment) => assessment.applicability_status === 'unable_to_determine')
      .length;
  const expectedCounts = [
    ['material_change_count', materialChangeCount],
    ['review_required_count', reviewRequiredCount],
    ['reinspection_required_count', reinspectionRequiredCount],
    ['unable_to_determine_count', unableToDetermineCount],
  ];
  expectedCounts.forEach(([key, expected]) => {
    if (report.summary[key] !== expected) {
      pushError(
        errors,
        'summary_count_mismatch',
        `/summary/${key}`,
        `/summary/${key} must equal ${expected} from the canonical report sections`
      );
    }
  });

  const { decision } = report.summary;
  const expectedReadinessReview = decision !== 'no_material_change';
  if (report.summary.readiness_review_required !== expectedReadinessReview) {
    pushError(
      errors,
      'readiness_review_boundary_mismatch',
      '/summary/readiness_review_required',
      '/summary/readiness_review_required must reflect the report decision without regenerating readiness'
    );
  }

  const identityMissing = [
    report.baseline.package_slug,
    report.baseline.revision,
    report.candidate.package_slug,
    report.candidate.revision,
  ].some((value) => value === null);
  const hasBlockingChange = report.changes.some((change) => change.severity === 'blocking');
  if ((identityMissing || unableToDetermineCount > 0 || hasBlockingChange)
    && decision !== 'blocked_insufficient_identity_or_inputs') {
    pushError(
      errors,
      'blocked_decision_required',
      '/summary/decision',
      'Missing identity, unable-to-determine impact, or blocking change requires the blocked decision'
    );
  }

  if (decision === 'no_material_change') {
    const actionRequired = report.changes.some((change) => change.required_action !== 'none');
    if (materialChangeCount !== 0 || reviewRequiredCount !== 0 || reinspectionRequiredCount !== 0
      || unableToDetermineCount !== 0 || actionRequired || report.reinspection_plan.status !== 'not_required') {
      pushError(
        errors,
        'no_material_change_decision_inconsistent',
        '/summary/decision',
        'no_material_change requires no material, review, reinspection, unresolved, or action-bearing work'
      );
    }
  } else if (decision === 'review_required') {
    const reviewChange = report.changes.some((change) => change.required_action === 'human_review');
    if (reinspectionRequiredCount !== 0 || (!reviewChange && reviewRequiredCount === 0)
      || report.reinspection_plan.status !== 'review_required') {
      pushError(
        errors,
        'review_required_decision_inconsistent',
        '/summary/decision',
        'review_required requires review work, no planned reinspection items, and review_required plan status'
      );
    }
  } else if (decision === 'reinspection_required') {
    if (reinspectionRequiredCount === 0 || report.reinspection_plan.status !== 'planned') {
      pushError(
        errors,
        'reinspection_required_decision_inconsistent',
        '/summary/decision',
        'reinspection_required requires at least one plan item and planned status'
      );
    }
  } else if (decision === 'blocked_insufficient_identity_or_inputs'
    && report.reinspection_plan.status !== 'blocked') {
    pushError(
      errors,
      'blocked_plan_status_required',
      '/reinspection_plan/status',
      'A blocked report must preserve blocked reinspection plan status'
    );
  }
}

function validateSemanticInvariants(report, errors) {
  validateSorted(report.baseline.artifact_refs, '/baseline/artifact_refs', errors);
  validateSorted(report.candidate.artifact_refs, '/candidate/artifact_refs', errors);
  report.baseline.artifact_refs.forEach((ref, index) => {
    validatePublicArtifactRef(ref, `/baseline/artifact_refs/${index}`, errors);
  });
  report.candidate.artifact_refs.forEach((ref, index) => {
    validatePublicArtifactRef(ref, `/candidate/artifact_refs/${index}`, errors);
  });
  report.changes.forEach((change, index) => {
    validatePublicArtifactRef(change.baseline_source_ref, `/changes/${index}/baseline_source_ref`, errors);
    validatePublicArtifactRef(change.candidate_source_ref, `/changes/${index}/candidate_source_ref`, errors);
  });
  report.evidence_applicability.assessments.forEach((assessment, index) => {
    validatePublicArtifactRef(
      assessment.source_envelope_or_receipt_ref,
      `/evidence_applicability/assessments/${index}/source_envelope_or_receipt_ref`,
      errors
    );
  });
  report.reinspection_plan.items.forEach((item, itemIndex) => {
    item.source_artifact_refs.forEach((ref, refIndex) => {
      validatePublicArtifactRef(ref, `/reinspection_plan/items/${itemIndex}/source_artifact_refs/${refIndex}`, errors);
    });
  });
  if (report.baseline.package_slug !== null
    && report.candidate.package_slug !== null
    && report.baseline.package_slug !== report.candidate.package_slug) {
    pushError(
      errors,
      'package_mismatch',
      '/candidate/package_slug',
      'Baseline and candidate package slugs must match for revision impact analysis'
    );
  }

  MUTATION_BOUNDARY_KEYS.forEach((key) => {
    if (report.boundaries[key] !== false) {
      pushError(
        errors,
        'mutation_boundary_violation',
        `/boundaries/${key}`,
        `/boundaries/${key} must remain false`
      );
    }
  });
  if (report.evidence_applicability.authoritative_evidence_state_changed !== false) {
    pushError(
      errors,
      'evidence_state_mutation_forbidden',
      '/evidence_applicability/authoritative_evidence_state_changed',
      'Revision impact must not change authoritative evidence state'
    );
  }

  const stableIds = [
    ...report.changes.map((change, index) => [change.change_id, `/changes/${index}/change_id`]),
    ...report.evidence_applicability.assessments
      .map((assessment, index) => [assessment.assessment_id, `/evidence_applicability/assessments/${index}/assessment_id`]),
    ...report.reinspection_plan.items
      .map((item, index) => [item.plan_item_id, `/reinspection_plan/items/${index}/plan_item_id`]),
  ];
  const stableIdPaths = new Map();
  stableIds.forEach(([id, path]) => {
    if (stableIdPaths.has(id)) {
      pushError(
        errors,
        'duplicate_stable_id',
        path,
        `${path} duplicates the stable ID at ${stableIdPaths.get(id)}`
      );
    } else {
      stableIdPaths.set(id, path);
    }
  });

  validateChangeInvariants(report, errors);
  const changeIds = new Set(report.changes.map((change) => change.change_id));
  validateAssessmentInvariants(report, changeIds, errors);
  validatePlanInvariants(report, changeIds, errors);
  validateSummaryInvariants(report, errors);
}

function validateMutationBoundariesWhenPresent(report, errors) {
  if (report?.boundaries && typeof report.boundaries === 'object' && !Array.isArray(report.boundaries)) {
    MUTATION_BOUNDARY_KEYS.forEach((key) => {
      if (Object.hasOwn(report.boundaries, key) && report.boundaries[key] !== false) {
        pushError(
          errors,
          'mutation_boundary_violation',
          `/boundaries/${key}`,
          `/boundaries/${key} must remain false`
        );
      }
    });
  }
  if (report?.evidence_applicability
    && typeof report.evidence_applicability === 'object'
    && Object.hasOwn(report.evidence_applicability, 'authoritative_evidence_state_changed')
    && report.evidence_applicability.authoritative_evidence_state_changed !== false) {
    pushError(
      errors,
      'evidence_state_mutation_forbidden',
      '/evidence_applicability/authoritative_evidence_state_changed',
      'Revision impact must not change authoritative evidence state'
    );
  }
}

function deterministicErrors(errors) {
  const unique = new Map();
  errors.forEach((error) => {
    const key = `${error.code}\u0000${error.path}\u0000${error.message}`;
    if (!unique.has(key)) unique.set(key, error);
  });
  return [...unique.values()].sort((left, right) => (
    compareCodePoints(left.path, right.path)
    || compareCodePoints(left.code, right.code)
    || compareCodePoints(left.message, right.message)
  ));
}

export function validateRevisionImpactReport(report) {
  const errors = [];
  const bounds = validateJsonDocumentBounds(report, { maxDepth: 64, maxNodes: 50_000 });
  if (!bounds.ok) errors.push(...bounds.errors);

  validateFiniteNumbers(report, errors);
  validateAuthorityBoundaries(report, errors);
  validateMutationBoundariesWhenPresent(report, errors);

  let structurallyValid = false;
  if (bounds.ok) {
    const controlMaterial = validateInspectionEvidenceControlMaterial(report);
    if (!controlMaterial.ok) errors.push(...controlMaterial.errors);
    structurallyValid = validateSchema(report) === true;
    if (!structurallyValid) errors.push(...schemaErrors());
  }
  if (typeof report?.generated_at === 'string' && !isParseableTimestamp(report.generated_at)) {
    pushError(
      errors,
      'invalid_generated_at',
      '/generated_at',
      '/generated_at must be an RFC 3339-compatible timestamp'
    );
  }
  if (structurallyValid) validateSemanticInvariants(report, errors);

  const normalizedErrors = deterministicErrors(errors);
  return { ok: normalizedErrors.length === 0, errors: normalizedErrors };
}

export class RevisionImpactValidationError extends Error {
  constructor(errors, options = {}) {
    const normalizedErrors = Array.isArray(errors) ? errors : [];
    const context = options.context ? ` for ${options.context}` : '';
    const detail = normalizedErrors.map((error) => `${error.path} ${error.message}`).join(' | ');
    super(`Revision impact report validation failed${context}${detail ? `: ${detail}` : ''}`);
    this.name = 'RevisionImpactValidationError';
    this.code = 'revision_impact_report_validation_failed';
    this.errors = normalizedErrors;
    this.context = options.context || null;
  }
}

export function assertValidRevisionImpactReport(report, options = {}) {
  const validation = validateRevisionImpactReport(report);
  if (!validation.ok) throw new RevisionImpactValidationError(validation.errors, options);
  return report;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineJson(value) {
  const canonical = sortJsonValue(value);
  return `<code>${escapeHtml(JSON.stringify(canonical))}</code>`;
}

function renderFields(lines, entries) {
  [...entries]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .forEach(([label, value]) => lines.push(`- ${label}: ${inlineJson(value)}`));
}

/**
 * Render a deterministic view whose values come exclusively from a validated
 * canonical report. The renderer performs no filesystem reads, lookups, or
 * readiness/evidence inference.
 */
export function renderRevisionImpactMarkdown(report) {
  assertValidRevisionImpactReport(report, { context: 'Markdown rendering' });

  const lines = ['# Revision Impact Report', ''];
  renderFields(lines, [
    ['artifact_type', report.artifact_type],
    ['schema_version', report.schema_version],
    ['generated_at', report.generated_at],
  ]);

  lines.push('', '## Revisions', '', '### Baseline', '');
  renderFields(lines, Object.entries(report.baseline));
  lines.push('', '### Candidate', '');
  renderFields(lines, Object.entries(report.candidate));

  lines.push('', '## Summary', '');
  renderFields(lines, Object.entries(report.summary));

  lines.push('', '## Changes', '');
  if (report.changes.length === 0) lines.push('- change_count: <code>0</code>');
  report.changes.forEach((change) => {
    lines.push(`### ${escapeHtml(change.change_id)}`, '');
    renderFields(lines, Object.entries(change));
    lines.push('');
  });

  lines.push('## Evidence Applicability', '');
  renderFields(lines, [[
    'authoritative_evidence_state_changed',
    report.evidence_applicability.authoritative_evidence_state_changed,
  ]]);
  if (report.evidence_applicability.assessments.length === 0) {
    lines.push('- assessment_count: <code>0</code>');
  }
  report.evidence_applicability.assessments.forEach((assessment) => {
    lines.push(`### ${escapeHtml(assessment.assessment_id)}`, '');
    renderFields(lines, Object.entries(assessment));
    lines.push('');
  });

  lines.push('## Reinspection Plan', '');
  renderFields(lines, [
    ['status', report.reinspection_plan.status],
    ['human_authorization_required', report.reinspection_plan.human_authorization_required],
  ]);
  if (report.reinspection_plan.items.length === 0) lines.push('- plan_item_count: <code>0</code>');
  report.reinspection_plan.items.forEach((item) => {
    lines.push(`### ${escapeHtml(item.plan_item_id)}`, '');
    renderFields(lines, Object.entries(item));
    lines.push('');
  });

  lines.push('## Boundaries', '');
  renderFields(lines, Object.entries(report.boundaries));

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
