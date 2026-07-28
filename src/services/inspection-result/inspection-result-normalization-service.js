import { TextDecoder } from 'node:util';
import { basename, dirname, resolve } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';

import { buildArtifactManifest, createManifestPath } from '../../../lib/artifact-manifest.js';
import { publishAtomicOutputSet } from '../../../lib/atomic-output-publication.js';
import { parseInspectionEvidenceJsonBytes } from '../../../lib/inspection-evidence-onboarding.js';
import { assertValidInspectionPlan } from '../../../lib/inspection-plan-contract.js';
import {
  assertValidInspectionPlanReleaseAuthorization,
  assertValidInspectionPlanReleaseRecord,
  assertValidInspectionResultNormalization,
  assertValidInspectionResultSubmissionMetadata,
  canonicalizeInspectionControlDocument,
} from '../../../lib/inspection-result-contract.js';
import {
  RevisionLineageError,
  verifyRevisionLineageParentReference,
} from '../../../lib/revision-lineage-contract.js';
import { INSPECTION_RESULT_TEMPLATE_COLUMNS } from '../inspection-plan/inspection-plan-service.js';
import { assertInspectionPlanRevisionLineageContinuity } from '../inspection-plan/inspection-plan-release-service.js';
import { prepareSafeOutputDirectory, readSafeSnapshot, sha256 } from './safe-snapshot.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_FIELD_LENGTH = 16_384;
const CONTROL_NOTICE = 'generated blank template - not inspection evidence';
const RESULT_VALUES = new Set(['pass', 'fail', 'not_accepted']);
const PRIVATE_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^\s/]*\.internal)(?:[/:]|$)/i;
const SECRET = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|authorization)\s*[:=]/i;
const NON_GENUINE = /(?:^|[^A-Za-z0-9])(?:synthetic|fixture|surrogate|simulated|test[-_ ]?only|example[-_ ]?only)(?:[^A-Za-z0-9]|$)/i;
const NUMERIC = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const UNIT_DEFINITIONS = Object.freeze(new Map([
  ['mm', { dimension: 'length', base: 'mm', factor: 1 }],
  ['in', { dimension: 'length', base: 'mm', factor: 25.4 }],
  ['inch', { dimension: 'length', base: 'mm', factor: 25.4 }],
  ['deg', { dimension: 'angle', base: 'deg', factor: 1 }],
  ['°', { dimension: 'angle', base: 'deg', factor: 1 }],
  ['N', { dimension: 'force', base: 'N', factor: 1 }],
  ['N·m', { dimension: 'torque', base: 'N·m', factor: 1 }],
  ['Nm', { dimension: 'torque', base: 'N·m', factor: 1 }],
]));

function parseCanonicalJson(snapshot, label) {
  try { return parseInspectionEvidenceJsonBytes(snapshot.bytes, { requireCanonical: true }); }
  catch (error) { throw new Error(`${label} must be canonical bounded JSON: ${error.message}`, { cause: error }); }
}

function assertBinding(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

function lineageError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}

function assertProofPolicy(value) {
  if (value !== true && value !== false) {
    throw lineageError('malformed_identity', 'requireAuthoritativeLineage must be a boolean');
  }
  return value === true;
}

function assertProofBinding(actual, expected, label, code = 'conflicting_identity') {
  if (actual !== expected) {
    throw lineageError(code, `${label} mismatch`, { expected, actual });
  }
}

function canonicalEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertProofReleaseAuthorizationBinding({ authorization, authorizationSnapshot, releaseRecord, planSnapshot }) {
  assertProofBinding(authorizationSnapshot.sha256, releaseRecord.authorization.sha256, 'release-authorization SHA-256', 'digest_mismatch');
  assertProofBinding(authorization.authorization_id, releaseRecord.authorization.id, 'release-authorization ID');
  assertProofBinding(authorization.plan.plan_id, releaseRecord.plan.plan_id, 'release-authorization plan ID');
  assertProofBinding(authorization.plan.sha256, releaseRecord.plan.sha256, 'release-authorization plan SHA-256', 'digest_mismatch');
  assertProofBinding(authorization.plan.sha256, planSnapshot.sha256, 'release-authorization current plan SHA-256', 'digest_mismatch');
  assertProofBinding(authorization.package.slug, releaseRecord.package.slug, 'release-authorization package slug');
  assertProofBinding(authorization.package.revision, releaseRecord.package.revision, 'release-authorization package revision');
  assertProofBinding(authorization.inspection_scope, releaseRecord.inspection_scope, 'release-authorization inspection scope');
  assertProofBinding(authorization.released_at, releaseRecord.released_at, 'release-authorization release timestamp');
  if (!canonicalEqual(authorization.engineering_review, releaseRecord.reviewers.engineering)
    || !canonicalEqual(authorization.quality_review, releaseRecord.reviewers.quality)
    || !canonicalEqual(authorization.released_by, releaseRecord.released_by)) {
    throw lineageError('conflicting_identity', 'Release record human-review custody does not match the exact authorization');
  }
  const recordFiles = new Map(releaseRecord.distributed_files.map((entry) => [entry.artifact_type, entry]));
  const authorizationFiles = [
    ['checksheet', 'inspection_checksheet.csv'],
    ['supplier_request', 'supplier_inspection_request.md'],
    ['result_template', 'inspection_result_template.csv'],
  ];
  for (const [key, artifactType] of authorizationFiles) {
    const expected = authorization.distributed_files[key];
    const actual = recordFiles.get(artifactType);
    if ((expected === null || expected === undefined) !== (actual === undefined)) {
      throw lineageError('missing_parent', `Release record distributed ${artifactType} binding does not match its authorization`);
    }
    if (expected && (expected.path !== actual.path || expected.sha256 !== actual.sha256)) {
      throw lineageError('digest_mismatch', `Release record distributed ${artifactType} binding does not match its authorization`);
    }
  }
}

async function assertSnapshotCurrent({ projectRoot, snapshot, label, maxBytes }) {
  let current;
  try {
    current = await readSafeSnapshot({ projectRoot, path: snapshot.relativePath, label, maxBytes });
  } catch (error) {
    throw lineageError('stale_parent', `${label} is no longer a current safe snapshot`, { cause_code: error?.code || null });
  }
  if (current.sha256 !== snapshot.sha256
    || current.size !== snapshot.size
    || current.dev !== snapshot.dev
    || current.ino !== snapshot.ino) {
    throw lineageError('stale_parent', `${label} changed after proof validation`, {
      expected_sha256: snapshot.sha256,
      actual_sha256: current.sha256,
    });
  }
}

function assertSafeText(value, label) {
  const text = String(value ?? '');
  if (PRIVATE_URL.test(text)) throw new Error(`${label} contains a private URL`);
  if (SECRET.test(text)) throw new Error(`${label} contains a secret/token marker`);
  if (NON_GENUINE.test(text)) throw new Error(`${label} contains a synthetic/test marker`);
}

function scanMetadataSafety(value, path = 'submission metadata') {
  if (typeof value === 'string') return assertSafeText(value, path);
  if (Array.isArray(value)) return value.forEach((entry, index) => scanMetadataSafety(entry, `${path}/${index}`));
  if (value && typeof value === 'object') Object.entries(value).forEach(([key, entry]) => scanMetadataSafety(entry, `${path}/${key}`));
}

export function parsePlanResultCsvV1(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (input.length < 1 || input.length > MAX_CSV_BYTES) throw new Error('CSV source exceeds the plan-result-csv-v1 size contract');
  if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) throw new Error('CSV source must be UTF-8 without BOM');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); }
  catch (error) { throw new Error('CSV source is not valid UTF-8', { cause: error }); }
  const table = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  const pushField = () => {
    if (field.length > MAX_FIELD_LENGTH) throw new Error('CSV field exceeds the bounded field length');
    row.push(field); field = ''; fieldStarted = false;
  };
  const pushRow = () => {
    pushField(); table.push(row); row = [];
    if (table.length > MAX_ROWS + 1) throw new Error('CSV source exceeds the row limit');
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (fieldStarted || field.length) throw new Error('CSV contains a quote in an unquoted field');
      quoted = true; fieldStarted = true; continue;
    }
    if (char === ',') { pushField(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow(); continue;
    }
    field += char; fieldStarted = true;
    if (field.length > MAX_FIELD_LENGTH) throw new Error('CSV field exceeds the bounded field length');
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (field.length || row.length) pushRow();
  if (table.length < 2) throw new Error('CSV must contain a header and at least one result row');
  const headers = table[0];
  if (headers.some((header) => !header)) throw new Error('CSV blank headers are forbidden');
  if (new Set(headers).size !== headers.length) throw new Error('CSV duplicate headers are forbidden');
  if (JSON.stringify(headers) !== JSON.stringify(INSPECTION_RESULT_TEMPLATE_COLUMNS)) throw new Error('CSV headers do not match the exact plan-result-csv-v1 contract');
  return table.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} width mismatch`);
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'measured_value' && /^[=+@-]/.test(value)) throw new Error(`CSV row ${index + 2} field ${key} contains formula-triggering text`);
      if (key !== 'control_material_notice') assertSafeText(value, `CSV row ${index + 2} field ${key}`);
    }
    return Object.freeze({ ...record, source_row_number: index + 2 });
  });
}

function normalizeMeasurementValue(rawValue, rawUnit, planUnit) {
  if (rawValue.includes(',')) throw new Error('Locale decimal commas and thousands separators are forbidden');
  if (!NUMERIC.test(rawValue)) throw new Error('Measured value must be a finite non-negative base-10 decimal without exponent notation');
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) throw new Error('Measured value is non-finite or exceeds deterministic numeric bounds');
  const inputUnit = UNIT_DEFINITIONS.get(rawUnit);
  if (!inputUnit) throw new Error(`Unsupported or ambiguous measured unit: ${rawUnit}`);
  if (!planUnit) return { value: value * inputUnit.factor, unit: inputUnit.base, compatible: true };
  const targetUnit = UNIT_DEFINITIONS.get(planUnit);
  if (!targetUnit) throw new Error(`Unsupported authoritative plan unit: ${planUnit}`);
  if (targetUnit.dimension !== inputUnit.dimension) throw new Error(`Incompatible measured unit ${rawUnit} for plan unit ${planUnit}`);
  const converted = (value * inputUnit.factor) / targetUnit.factor;
  if (!Number.isFinite(converted)) throw new Error('Unit conversion overflow');
  return { value: converted, unit: planUnit, compatible: true };
}

function conformance(required, reported) {
  if (!required) return 'not_required';
  if (!reported) return 'missing';
  return required.trim().toLowerCase() === reported.trim().toLowerCase() ? 'conformant' : 'mismatch';
}

function computeResult(item, normalizedValue) {
  const numericRule = item.acceptance_rule === 'measured_value >= lower_limit and measured_value <= upper_limit';
  if (!numericRule || !Number.isFinite(item.lower_limit) || !Number.isFinite(item.upper_limit) || !item.unit) return 'unable_to_determine';
  return normalizedValue >= item.lower_limit && normalizedValue <= item.upper_limit ? 'pass' : 'fail';
}

function resultConsistency(reported, computed) {
  if (!reported) return 'missing_reported_result';
  if (computed === 'unable_to_determine') return 'not_computable';
  return reported === computed ? 'consistent' : 'inconsistent';
}

function count(values, expected) { return values.filter((value) => value === expected).length; }

function reconcile({ plan, releaseRecord, releaseRecordSha256, sourceSnapshot, metadata, metadataSnapshot, rows, templateSnapshot, generatedAt }) {
  const planById = new Map(plan.items.map((item) => [item.plan_item_id, item]));
  const rowGroups = new Map();
  for (const row of rows) {
    const key = row.plan_item_id;
    if (!rowGroups.has(key)) rowGroups.set(key, []);
    rowGroups.get(key).push(row);
  }
  const duplicateRows = [...rowGroups.entries()].filter(([, entries]) => entries.length > 1);
  const characteristicGroups = new Map();
  for (const row of rows) {
    if (!characteristicGroups.has(row.characteristic_id)) characteristicGroups.set(row.characteristic_id, []);
    characteristicGroups.get(row.characteristic_id).push(row);
  }
  const duplicateCharacteristics = [...characteristicGroups.entries()].filter(([, entries]) => entries.length > 1);
  const missingItems = plan.items.filter((item) => !rowGroups.has(item.plan_item_id)).map((item) => ({ plan_item_id: item.plan_item_id, characteristic_id: item.characteristic_id, blocker: 'missing_required_row' }));
  const unexpectedItems = rows.filter((row) => !planById.has(row.plan_item_id)).map((row) => ({ plan_item_id: row.plan_item_id || null, characteristic_id: row.characteristic_id || null, source_row_number: row.source_row_number, blocker: 'unexpected_plan_item' }));
  const measurements = [];
  const unresolved = [];
  for (const row of rows.filter((entry) => planById.has(entry.plan_item_id))) {
    const item = planById.get(row.plan_item_id);
    const blockers = [];
    const reviewRequirements = [];
    const required = ['plan_id', 'plan_sha256', 'plan_release_record_id', 'plan_release_record_sha256', 'plan_item_id', 'package_slug', 'revision', 'characteristic_id', 'measured_value', 'measured_unit', 'result', 'method_used', 'measurement_completed_at', 'completion_status', 'final_status', 'inspector_reference', 'reviewer_reference', 'source_file_sha256'];
    for (const key of required) if (!row[key]?.trim()) blockers.push(`missing_${key}`);
    if (row.control_material_notice !== CONTROL_NOTICE) blockers.push('template_lineage_notice_mismatch');
    if (row.plan_id !== plan.plan_id) blockers.push('plan_id_mismatch');
    if (row.plan_sha256 !== releaseRecord.plan.sha256) blockers.push('plan_sha256_mismatch');
    if (row.plan_release_record_id !== releaseRecord.release_record_id) blockers.push('release_record_id_mismatch');
    if (row.plan_release_record_sha256 !== releaseRecordSha256) blockers.push('release_record_sha256_mismatch');
    if (row.package_slug !== plan.package.slug) blockers.push('package_mismatch');
    if (row.revision !== plan.package.revision) blockers.push('revision_mismatch');
    if (row.characteristic_id !== item.characteristic_id) blockers.push('characteristic_id_mismatch');
    if (row.method_used.trim().toLowerCase() !== metadata.inspection_method.trim().toLowerCase()) blockers.push('source_metadata_method_mismatch');
    if (row.measurement_completed_at !== metadata.completed_at) blockers.push('source_metadata_completion_time_mismatch');
    if (row.inspector_reference !== metadata.inspector_identity_ref) blockers.push('source_metadata_inspector_mismatch');
    if (row.completion_status !== metadata.completion_status) blockers.push('source_metadata_completion_status_mismatch');
    if (!['final', 'complete', 'completed'].includes(row.final_status)) blockers.push('unsupported_final_status');
    if (!/^[a-f0-9]{64}$/.test(row.source_file_sha256)) blockers.push('reported_source_file_sha256_invalid');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@+-]{2,255}$/.test(row.inspector_reference)) blockers.push('inspector_reference_invalid');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@+-]{2,255}$/.test(row.reviewer_reference)) blockers.push('reviewer_reference_invalid');
    const reportedResult = row.result.trim().toLowerCase();
    if (!RESULT_VALUES.has(reportedResult)) blockers.push('unsupported_reported_result');
    let normalized = { value: null, unit: null };
    try { normalized = normalizeMeasurementValue(row.measured_value, row.measured_unit, item.unit); }
    catch (error) { blockers.push('measurement_or_unit_invalid'); unresolved.push({ code: 'measurement_or_unit_invalid', plan_item_id: item.plan_item_id, source_row_number: row.source_row_number, message: error.message }); }
    const computedResult = blockers.includes('measurement_or_unit_invalid') ? 'unable_to_determine' : computeResult(item, normalized.value);
    const consistency = resultConsistency(RESULT_VALUES.has(reportedResult) ? reportedResult : null, computedResult);
    if (reportedResult === 'pass' && computedResult === 'fail') blockers.push('reported_pass_computed_fail');
    if (reportedResult === 'fail' && computedResult === 'pass') reviewRequirements.push('reported_fail_computed_pass');
    if (computedResult === 'unable_to_determine') reviewRequirements.push('acceptance_not_computable');
    const methodConformance = conformance(item.required_method, row.method_used);
    const equipmentConformance = conformance(item.required_equipment_class, row.equipment_reference);
    if (['missing', 'mismatch'].includes(methodConformance)) blockers.push('inspection_method_mismatch');
    if (['missing', 'mismatch'].includes(equipmentConformance)) blockers.push('equipment_reference_mismatch');
    if (item.human_review_required) reviewRequirements.push('plan_item_requires_human_review');
    measurements.push({
      plan_item_id: item.plan_item_id, characteristic_id: item.characteristic_id, feature_id: item.feature_id,
      package_slug: item.package_slug, revision: item.revision,
      plan_release_record_id: releaseRecord.release_record_id,
      specification_reference: item.specification_reference,
      plan_nominal: item.nominal_value, plan_lower_limit: item.lower_limit, plan_upper_limit: item.upper_limit, plan_unit: item.unit,
      raw_measured_value: row.measured_value, raw_unit: row.measured_unit,
      normalized_measured_value: normalized.value, normalized_unit: normalized.unit,
      reported_result: RESULT_VALUES.has(reportedResult) ? reportedResult : row.result,
      computed_result: computedResult, result_consistency: consistency,
      method_required: item.required_method, method_reported: row.method_used, method_conformance: methodConformance,
      equipment_required: item.required_equipment_class, equipment_reported: row.equipment_reference || null, equipment_conformance: equipmentConformance,
      reported_completion_status: row.completion_status, reported_final_status: row.final_status,
      inspector_identity_ref: row.inspector_reference, reviewer_identity_ref: row.reviewer_reference,
      measurement_completed_at: row.measurement_completed_at, reported_source_file_sha256: row.source_file_sha256,
      remarks: row.remarks || null,
      revision_impact_change_ids: item.revision_impact_change_ids,
      source_row_number: row.source_row_number, source_artifact_sha256: sourceSnapshot.sha256,
      authority_references: item.source_artifact_refs,
      blockers: [...new Set(blockers)].sort(), review_requirements: [...new Set(reviewRequirements)].sort(),
    });
  }
  for (const [id, entries] of duplicateRows) unresolved.push({ code: 'duplicate_plan_item', plan_item_id: id, source_rows: entries.map((entry) => entry.source_row_number), message: 'Version 1 permits one final row per plan item.' });
  for (const [id, entries] of duplicateCharacteristics) unresolved.push({ code: 'duplicate_characteristic', characteristic_id: id, source_rows: entries.map((entry) => entry.source_row_number), message: 'Version 1 permits one final row per characteristic.' });
  const allBlockers = measurements.flatMap((item) => item.blockers);
  const allReviews = measurements.flatMap((item) => item.review_requirements);
  const reportedResults = measurements.map((item) => item.reported_result);
  const computedResults = measurements.map((item) => item.computed_result);
  const overallPassConflict = metadata.source_overall_result === 'pass'
    && (reportedResults.some((value) => value === 'fail' || value === 'not_accepted') || computedResults.includes('fail'));
  const overallFailReview = metadata.source_overall_result === 'fail'
    && reportedResults.length > 0 && reportedResults.every((value) => value === 'pass') && computedResults.every((value) => value === 'pass');
  if (overallPassConflict) unresolved.push({ code: 'source_overall_pass_conflict', plan_item_id: null, message: 'Source overall PASS conflicts with a reported or computed non-pass result.' });
  if (overallFailReview) unresolved.push({ code: 'source_overall_fail_requires_review', plan_item_id: null, message: 'Source overall FAIL conflicts with all-pass row results and requires human review.' });
  const blocked = missingItems.length > 0 || unexpectedItems.length > 0 || duplicateRows.length > 0 || duplicateCharacteristics.length > 0 || allBlockers.length > 0 || overallPassConflict;
  const reviewRequired = metadata.completion_status === 'partial' || allReviews.length > 0 || overallFailReview;
  const status = blocked ? 'blocked' : reviewRequired ? 'review_required' : 'ready_for_quarantine_review';
  const reconciliationResult = blocked
    ? (missingItems.length ? 'incomplete' : 'inconsistent')
    : computedResults.every((value) => value === 'unable_to_determine') ? 'unable_to_determine'
      : 'internally_consistent';
  const summary = {
    expected_item_count: plan.items.length, matched_item_count: measurements.length,
    missing_item_count: missingItems.length, unexpected_item_count: unexpectedItems.length,
    duplicate_item_count: duplicateRows.length + duplicateCharacteristics.length,
    reported_pass_count: count(reportedResults, 'pass'), reported_fail_count: count(reportedResults, 'fail'), reported_not_accepted_count: count(reportedResults, 'not_accepted'),
    computed_pass_count: count(computedResults, 'pass'), computed_fail_count: count(computedResults, 'fail'),
    result_mismatch_count: measurements.filter((item) => item.result_consistency === 'inconsistent').length,
    unresolved_count: unresolved.length + missingItems.length + unexpectedItems.length,
  };
  const normalizationId = `inspection-result-normalization:${sha256(Buffer.from([releaseRecordSha256, sourceSnapshot.sha256, metadataSnapshot.sha256, generatedAt].join('\0'))).slice(0, 32)}`;
  return assertValidInspectionResultNormalization({
    artifact_type: 'inspection_result_normalization', schema_version: '1.0', generated_at: generatedAt,
    normalization_id: normalizationId, status, adapter: { id: 'plan-result-csv-v1', version: '1.0' },
    plan_binding: { plan_id: plan.plan_id, plan_sha256: releaseRecord.plan.sha256, release_record_id: releaseRecord.release_record_id, release_record_sha256: releaseRecordSha256, package_slug: plan.package.slug, revision: plan.package.revision },
    source_snapshot: { source_path: metadata.original_sanitized_filename, source_sha256: sourceSnapshot.sha256, source_size_bytes: sourceSnapshot.size, submission_metadata_sha256: metadataSnapshot.sha256, released_template_sha256: templateSnapshot.sha256, template_lineage: 'derivative_of_released_native_template' },
    source_overall_result: metadata.source_overall_result, reconciliation_result: reconciliationResult, summary,
    measurements, missing_items: missingItems, unexpected_items: unexpectedItems, unresolved,
    envelope_mapping: {
      package: { slug: plan.package.slug, revision: plan.package.revision },
      subject: { identifier: metadata.part_identifier, identifier_type: 'part', revision: plan.package.revision },
      source: { organization: metadata.source_organization, source_type: metadata.source_type, source_record_id: metadata.source_record_id, document: { original_filename: metadata.original_sanitized_filename, media_type: 'text/csv', size_bytes: sourceSnapshot.size, sha256: sourceSnapshot.sha256 } },
      inspection: { method: metadata.inspection_method, status: metadata.completion_status, completed_at: metadata.completed_at, inspector_identity_ref: metadata.inspector_identity_ref, overall_result: metadata.source_overall_result },
      measured_characteristics: measurements.map((item) => ({ characteristic_id: item.characteristic_id, specification_ref: item.specification_reference, measured_value: item.normalized_measured_value, unit: item.normalized_unit, result: item.reported_result })),
      specification_references: [...new Set(measurements.map((item) => item.specification_reference).filter(Boolean))].sort(),
      provenance: { origin_reference: metadata.origin_reference, source_sha256: sourceSnapshot.sha256 },
      confidentiality: { classification: metadata.confidentiality_classification, redaction_status: metadata.redaction_status, redacted_fields: metadata.redacted_fields },
      additional_human_controlled_fields_required: ['review.reviewer_identity_ref', 'review.reviewed_at', 'review.decision', 'authorization', 'provenance.received_at', 'provenance.custody_events', 'attachment'],
    },
    next_step: { allowed_status: 'ready_for_quarantine_review', actual_status: status, operation: 'human_review_and_candidate_envelope_preparation_before_inspection_evidence_quarantine', quarantine_automatic: false },
    boundaries: { untrusted_candidate: true, inspection_evidence: false, authorization_created: false, evidence_attached: false, evidence_superseded: false, readiness_regenerated: false, canonical_artifacts_mutated: false, human_review_required: true },
  });
}

export const PLAN_RESULT_CSV_V1_ADAPTER = Object.freeze({
  id: 'plan-result-csv-v1', version: '1.0', displayName: 'FreeCAD Automation native plan result CSV v1',
  supportedMediaTypes: Object.freeze(['text/csv']), supportedExtensions: Object.freeze(['.csv']),
  supportedPlanSchemaVersions: Object.freeze(['1.0']), maxSourceBytes: MAX_CSV_BYTES,
  detect: (input) => Buffer.isBuffer(input) && input.length > 0 && input.length <= MAX_CSV_BYTES,
  parse: parsePlanResultCsvV1,
  normalize: reconcile,
  validate: (document) => assertValidInspectionResultNormalization(document),
  summarize: (document) => document.summary,
});

const ADAPTER_REGISTRY = Object.freeze(new Map([[PLAN_RESULT_CSV_V1_ADAPTER.id, PLAN_RESULT_CSV_V1_ADAPTER]]));
export function listInspectionResultAdapters() { return [...ADAPTER_REGISTRY.values()].map(({ id, version }) => ({ id, version })); }
export function getInspectionResultAdapter(id, version = '1.0') {
  const adapter = ADAPTER_REGISTRY.get(id);
  if (!adapter) throw new Error(`Unknown inspection result adapter: ${id}`);
  if (adapter.version !== version) throw new Error(`Unsupported adapter version for ${id}: ${version}`);
  return adapter;
}

export async function normalizeInspectionResultFromPaths({
  projectRoot,
  inspectionPlanPath,
  planReleaseRecordPath,
  sourcePath,
  submissionMetadataPath,
  adapterId,
  adapterVersion = '1.0',
  generatedAt,
  afterSnapshot = null,
  requireAuthoritativeLineage = false,
}) {
  const proof = assertProofPolicy(requireAuthoritativeLineage);
  if (!Number.isFinite(Date.parse(generatedAt || ''))) throw new Error('generatedAt must be parseable ISO-8601 text');
  const adapter = getInspectionResultAdapter(adapterId, adapterVersion);
  const [planSnapshot, releaseSnapshot, sourceSnapshot, metadataSnapshot] = await Promise.all([
    readSafeSnapshot({ projectRoot, path: inspectionPlanPath, label: 'inspection plan', maxBytes: MAX_JSON_BYTES }),
    readSafeSnapshot({ projectRoot, path: planReleaseRecordPath, label: 'plan release record', maxBytes: MAX_JSON_BYTES }),
    readSafeSnapshot({ projectRoot, path: sourcePath, label: 'completed result source', maxBytes: adapter.maxSourceBytes }),
    readSafeSnapshot({ projectRoot, path: submissionMetadataPath, label: 'submission metadata', maxBytes: MAX_JSON_BYTES }),
  ]);
  const plan = assertValidInspectionPlan(parseCanonicalJson(planSnapshot, 'inspection plan'));
  const releaseRecord = assertValidInspectionPlanReleaseRecord(parseCanonicalJson(releaseSnapshot, 'plan release record'));
  const metadata = assertValidInspectionResultSubmissionMetadata(parseCanonicalJson(metadataSnapshot, 'submission metadata'));
  const lineage = proof ? assertInspectionPlanRevisionLineageContinuity(plan) : null;
  scanMetadataSafety(metadata);
  if (proof) {
    assertProofBinding(releaseRecord.plan.plan_id, plan.plan_id, 'release-record plan ID');
    assertProofBinding(releaseRecord.plan.sha256, planSnapshot.sha256, 'release-record plan SHA-256', 'digest_mismatch');
    assertProofBinding(releaseRecord.package.slug, lineage.identity.package_slug, 'release-record package slug');
    assertProofBinding(releaseRecord.package.revision, lineage.identity.revision, 'release-record package revision');
    assertProofBinding(metadata.plan_id, plan.plan_id, 'submission-metadata plan ID');
    assertProofBinding(metadata.plan_sha256, planSnapshot.sha256, 'submission-metadata plan SHA-256', 'digest_mismatch');
    assertProofBinding(metadata.plan_release_record_id, releaseRecord.release_record_id, 'submission-metadata release-record ID');
    assertProofBinding(metadata.plan_release_record_sha256, releaseSnapshot.sha256, 'submission-metadata release-record SHA-256', 'digest_mismatch');
    assertProofBinding(metadata.package.slug, lineage.identity.package_slug, 'submission-metadata package slug');
    assertProofBinding(metadata.package.revision, lineage.identity.revision, 'submission-metadata package revision');
    assertProofBinding(metadata.part_identifier, lineage.identity.part_id, 'submission-metadata part identifier');
  }
  assertBinding(plan.schema_version, '1.0', 'inspection plan schema version');
  assertBinding(releaseRecord.plan.plan_id, plan.plan_id, 'release-record plan ID');
  assertBinding(releaseRecord.plan.sha256, planSnapshot.sha256, 'release-record plan SHA-256');
  assertBinding(releaseRecord.package.slug, plan.package.slug, 'release-record package slug');
  assertBinding(releaseRecord.package.revision, plan.package.revision, 'release-record package revision');
  assertBinding(metadata.plan_id, plan.plan_id, 'metadata plan ID');
  assertBinding(metadata.plan_sha256, planSnapshot.sha256, 'metadata plan SHA-256');
  assertBinding(metadata.plan_release_record_id, releaseRecord.release_record_id, 'metadata release-record ID');
  assertBinding(metadata.plan_release_record_sha256, releaseSnapshot.sha256, 'metadata release-record SHA-256');
  assertBinding(metadata.package.slug, plan.package.slug, 'metadata package slug');
  assertBinding(metadata.package.revision, plan.package.revision, 'metadata package revision');
  assertBinding(metadata.part_identifier, plan.package.part_identifier, 'metadata part identifier');
  let releaseAuthorizationSnapshot = null;
  if (proof) {
    releaseAuthorizationSnapshot = await readSafeSnapshot({
      projectRoot,
      path: releaseRecord.authorization.path,
      label: 'release authorization',
      maxBytes: MAX_JSON_BYTES,
    });
    const releaseAuthorization = assertValidInspectionPlanReleaseAuthorization(
      parseCanonicalJson(releaseAuthorizationSnapshot, 'release authorization')
    );
    assertProofReleaseAuthorizationBinding({
      authorization: releaseAuthorization,
      authorizationSnapshot: releaseAuthorizationSnapshot,
      releaseRecord,
      planSnapshot,
    });
  }
  const templateBinding = releaseRecord.distributed_files.find((entry) => entry.artifact_type === 'inspection_result_template.csv');
  if (!templateBinding) throw new Error('Release record does not bind a native result template');
  const templateSnapshot = await readSafeSnapshot({ projectRoot, path: templateBinding.path, label: 'released result template', maxBytes: adapter.maxSourceBytes });
  if (proof) {
    assertProofBinding(templateSnapshot.sha256, templateBinding.sha256, 'released template SHA-256', 'digest_mismatch');
    assertProofBinding(metadata.original_sanitized_filename, basename(sourceSnapshot.path), 'submission source filename');
  }
  assertBinding(templateSnapshot.sha256, templateBinding.sha256, 'released template SHA-256');
  if (sourceSnapshot.sha256 === templateSnapshot.sha256) throw new Error('Exact released blank result template cannot be normalized');
  assertBinding(metadata.original_sanitized_filename, basename(sourceSnapshot.path), 'metadata original sanitized filename');
  await afterSnapshot?.({ planSnapshot, releaseSnapshot, sourceSnapshot, metadataSnapshot, templateSnapshot });
  if (proof) {
    await Promise.all([
      assertSnapshotCurrent({ projectRoot, snapshot: planSnapshot, label: 'inspection plan', maxBytes: MAX_JSON_BYTES }),
      assertSnapshotCurrent({ projectRoot, snapshot: releaseSnapshot, label: 'plan release record', maxBytes: MAX_JSON_BYTES }),
      assertSnapshotCurrent({ projectRoot, snapshot: sourceSnapshot, label: 'completed result source', maxBytes: adapter.maxSourceBytes }),
      assertSnapshotCurrent({ projectRoot, snapshot: metadataSnapshot, label: 'submission metadata', maxBytes: MAX_JSON_BYTES }),
      assertSnapshotCurrent({ projectRoot, snapshot: templateSnapshot, label: 'released result template', maxBytes: adapter.maxSourceBytes }),
      assertSnapshotCurrent({ projectRoot, snapshot: releaseAuthorizationSnapshot, label: 'release authorization', maxBytes: MAX_JSON_BYTES }),
      ...lineage.parents.map((parent) => verifyRevisionLineageParentReference(parent, {
        projectRoot,
        portablePathRoot: dirname(planSnapshot.path),
      })),
    ]);
  }
  const rows = adapter.parse(sourceSnapshot.bytes);
  const normalization = adapter.normalize({ plan, releaseRecord, releaseRecordSha256: releaseSnapshot.sha256, sourceSnapshot, metadata, metadataSnapshot, rows, templateSnapshot, generatedAt });
  return { normalization, snapshots: { plan: planSnapshot, releaseRecord: releaseSnapshot, source: sourceSnapshot, metadata: metadataSnapshot, template: templateSnapshot } };
}

export function renderInspectionResultNormalizationMarkdown(normalization) {
  assertValidInspectionResultNormalization(normalization);
  const s = normalization.summary;
  const lines = [
    '# Inspection Result Normalization', '',
    `- Status: ${normalization.status}`, `- Plan: ${normalization.plan_binding.plan_id}`, `- Revision: ${normalization.plan_binding.revision}`,
    `- Adapter: ${normalization.adapter.id}@${normalization.adapter.version}`, `- Source SHA-256: ${normalization.source_snapshot.source_sha256}`,
    `- Expected / matched / missing / unexpected: ${s.expected_item_count} / ${s.matched_item_count} / ${s.missing_item_count} / ${s.unexpected_item_count}`,
    `- Reported pass / fail / not accepted: ${s.reported_pass_count} / ${s.reported_fail_count} / ${s.reported_not_accepted_count}`,
    `- Computed pass / fail / mismatches: ${s.computed_pass_count} / ${s.computed_fail_count} / ${s.result_mismatch_count}`, '',
    '## Trust boundary', '',
    '- Normalized result is not inspection evidence.',
    '- No evidence was authorized or attached.',
    '- A reported PASS was not converted into trusted evidence.',
    '- Human review and quarantine are still required.',
    '- Readiness was not regenerated.', '',
    '## Reconciliation findings', '',
  ];
  if (!normalization.missing_items.length && !normalization.unexpected_items.length && !normalization.unresolved.length && !normalization.measurements.some((item) => item.blockers.length || item.review_requirements.length)) lines.push('- No structural reconciliation finding.');
  for (const item of normalization.missing_items) lines.push(`- Missing: ${item.plan_item_id} (${item.characteristic_id})`);
  for (const item of normalization.unexpected_items) lines.push(`- Unexpected row ${item.source_row_number}: ${item.plan_item_id || 'missing ID'}`);
  for (const item of normalization.measurements) for (const code of [...item.blockers, ...item.review_requirements]) lines.push(`- ${item.plan_item_id}: ${code}`);
  return `${lines.join('\n')}\n`;
}

async function assertNoConflictingTarget(path, content) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Unsafe output target: ${path}`);
    const prior = await readFile(path);
    if (sha256(prior) !== sha256(Buffer.isBuffer(content) ? content : Buffer.from(content))) throw new Error(`Pre-existing conflicting output is forbidden: ${basename(path)}`);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

export async function writeInspectionResultNormalizationOutputs({ projectRoot, normalization, snapshots, outputPath, summaryPath = null, manifestPath = null, publicationHooks = {} }) {
  const jsonTarget = await prepareSafeOutputDirectory({ projectRoot, outputPath, label: 'normalization JSON output' });
  const markdownTarget = await prepareSafeOutputDirectory({ projectRoot, outputPath: summaryPath || resolve(jsonTarget.directory, 'inspection_result_normalization.md'), label: 'normalization Markdown output' });
  const manifestTarget = await prepareSafeOutputDirectory({ projectRoot, outputPath: manifestPath || createManifestPath({ primaryOutputPath: jsonTarget.absolute }), label: 'normalization manifest output' });
  if (new Set([jsonTarget.absolute, markdownTarget.absolute, manifestTarget.absolute]).size !== 3) throw new Error('Normalization output paths must be unique');
  if ([markdownTarget.directory, manifestTarget.directory].some((directory) => directory !== jsonTarget.directory)) throw new Error('Normalization outputs must share one safe real directory');
  const sourcePaths = new Set(Object.values(snapshots).map((snapshot) => snapshot.path));
  for (const path of [jsonTarget.absolute, markdownTarget.absolute, manifestTarget.absolute]) if (sourcePaths.has(path)) throw new Error('Normalization output must not collide with any input source');
  const json = canonicalizeInspectionControlDocument(assertValidInspectionResultNormalization(normalization));
  const markdown = renderInspectionResultNormalizationMarkdown(normalization);
  const artifactEntries = [
    { type: 'inspection-result-normalization.json', path: jsonTarget.absolute, label: 'Canonical inspection result normalization JSON', precomputed: { exists: true, size_bytes: Buffer.byteLength(json), sha256: sha256(Buffer.from(json)) } },
    { type: 'inspection-result-normalization.md', path: markdownTarget.absolute, label: 'Derived inspection result normalization Markdown', precomputed: { exists: true, size_bytes: Buffer.byteLength(markdown), sha256: sha256(Buffer.from(markdown)) } },
    ...Object.entries(snapshots).map(([key, snapshot]) => ({ type: `input.${key}`, path: snapshot.path, label: `Snapshotted ${key} input`, scope: 'internal', precomputed: { exists: true, size_bytes: snapshot.size, sha256: snapshot.sha256 } })),
  ];
  const manifest = await buildArtifactManifest({
    projectRoot, interface: 'cli', command: 'inspection-result-normalize', jobType: 'inspection-result-normalize',
    status: normalization.status === 'blocked' ? 'failed' : normalization.status === 'review_required' ? 'partial' : 'succeeded',
    artifacts: artifactEntries,
    timestamps: { created_at: normalization.generated_at, started_at: normalization.generated_at, finished_at: normalization.generated_at },
    details: { normalization_id: normalization.normalization_id, adapter: normalization.adapter, untrusted_candidate: true, inspection_evidence: false, readiness_regenerated: false },
  });
  const manifestJson = canonicalizeInspectionControlDocument(manifest);
  await Promise.all([[jsonTarget.absolute, json], [markdownTarget.absolute, markdown], [manifestTarget.absolute, manifestJson]].map(([path, content]) => assertNoConflictingTarget(path, content)));
  await publishAtomicOutputSet({ directory: jsonTarget.directory, outputs: [{ path: jsonTarget.absolute, content: json }, { path: markdownTarget.absolute, content: markdown }, { path: manifestTarget.absolute, content: manifestJson }], hooks: publicationHooks });
  return { json: jsonTarget.absolute, markdown: markdownTarget.absolute, manifest: manifestTarget.absolute };
}
