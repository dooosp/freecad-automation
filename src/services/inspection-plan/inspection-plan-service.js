import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import { parseInspectionEvidenceJsonBytes, validateInspectionEvidenceControlMaterial } from '../../../lib/inspection-evidence-onboarding.js';
import { assertValidInspectionPlan, canonicalizeInspectionPlan } from '../../../lib/inspection-plan-contract.js';
import { publishAtomicOutputSet } from '../../../lib/atomic-output-publication.js';
import {
  RevisionLineageError,
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineageSnapshotCurrent,
  buildRevisionLineage,
  buildRevisionLineageParent,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
} from '../../../lib/revision-lineage-contract.js';

const SUPPORTED_UNITS = new Set(['mm', 'in', 'inch', 'deg', '°', 'N', 'N·m', 'Nm']);
const RESULT_FIELDS = Object.freeze(['measured_value', 'measured_unit', 'result', 'completion_status', 'final_status']);
const PROVENANCE_FIELDS = Object.freeze(['inspector_reference', 'reviewer_reference', 'source_file_sha256']);
export const INSPECTION_CHECKSHEET_COLUMNS = Object.freeze(['plan_id', 'plan_item_id', 'package_slug', 'revision', 'characteristic_id', 'characteristic_name', 'inspection_purpose', 'nominal_value', 'lower_limit', 'upper_limit', 'unit', 'datum_reference', 'specification_reference', 'required_method', 'suggested_method', 'required_equipment_class', 'suggested_equipment_class', 'required_sampling', 'suggested_sampling', 'revision_impact_change_ids', 'actual_value', 'actual_unit', 'result']);
export const INSPECTION_RESULT_TEMPLATE_COLUMNS = Object.freeze(['plan_id', 'plan_sha256', 'plan_release_record_id', 'plan_release_record_sha256', 'plan_item_id', 'package_slug', 'revision', 'characteristic_id', 'control_material_notice', 'measured_value', 'measured_unit', 'result', 'completion_status', 'final_status', 'inspector_reference', 'reviewer_reference', 'source_file_sha256', 'method_used', 'equipment_reference', 'measurement_completed_at', 'remarks']);

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function engineeringNumber(value) { return Number.isFinite(value) ? Number(value.toFixed(12)) : value; }
function stableId(prefix, parts) { return `${prefix}:${sha(parts.map((value) => value ?? '').join('\0')).slice(0, 24)}`; }
function portablePath(projectRoot, path) {
  const rel = relative(projectRoot, path).replaceAll('\\', '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Input path must be repo-relative');
  return rel;
}
function packageIdentity(reviewPack) {
  return {
    slug: reviewPack.package_slug || reviewPack.part?.package_slug || reviewPack.metadata?.package_slug || null,
    revision: reviewPack.revision || reviewPack.part?.revision || null,
    part_identifier: reviewPack.part_id || reviewPack.part?.part_id || null,
  };
}
function explicitTextValues(values) {
  return [...new Set(values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}
function documentIdentity(document, kind) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const lineageIdentity = document.revision_lineage?.identity || {};
  const subject = (kind.startsWith('revision-impact') || kind.includes('revision_impact'))
    ? document.candidate || {}
    : document;
  const packageSlugs = explicitTextValues([
    lineageIdentity.package_slug,
    subject.package_slug,
    subject.package?.slug,
    subject.metadata?.package_slug,
    subject.product?.package_slug,
  ]);
  const partIds = explicitTextValues([
    lineageIdentity.part_id,
    subject.part_id,
    subject.part?.part_id,
    subject.part_identifier,
    subject.product?.part_id,
  ]);
  const revisions = explicitTextValues([
    lineageIdentity.revision,
    subject.revision,
    subject.part?.revision,
    subject.package?.revision,
    subject.product?.revision,
  ]);
  for (const [field, values] of [['package slug', packageSlugs], ['part ID', partIds], ['revision', revisions]]) {
    if (values.length > 1) throw new Error(`${kind} ${field} aliases conflict`);
  }
  return {
    slug: packageSlugs[0] || null,
    part_identifier: partIds[0] || null,
    revision: revisions[0] || null,
  };
}
function assertAvailableIdentityAgreement(expected, document, kind) {
  const actual = documentIdentity(document, kind);
  if (!actual) return;
  for (const [field, label] of [['slug', 'package slug'], ['part_identifier', 'part ID'], ['revision', 'revision']]) {
    if (actual[field] !== null && actual[field] !== expected[field]) {
      throw new Error(`${kind} ${label} mismatch`);
    }
  }
}
function proofError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}
function proofRunLocator(pathValue, portablePathRoot) {
  if (typeof pathValue !== 'string' || typeof portablePathRoot !== 'string') {
    throw proofError('unsafe_path', 'Proof run locators require explicit input paths and a portable root');
  }
  const rel = relative(portablePathRoot, pathValue).replaceAll('\\', '/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw proofError('path_escape', 'Proof input is outside the explicit portable run root', {
      path: pathValue,
    });
  }
  return `run/${rel}`;
}
function requireProofIdentity(identity, kind) {
  for (const [field, label] of [['slug', 'package slug'], ['part_identifier', 'part ID'], ['revision', 'revision']]) {
    if (!identity?.[field]) throw proofError('missing_identity', `${kind} ${label} is required in proof mode`, { artifact_type: kind, field });
  }
  return identity;
}
function assertExactLineageParent(lineage, expected, kind) {
  const matches = lineage.parents.filter((parent) => parent.role === expected.role);
  if (matches.length === 0) {
    throw proofError('missing_parent', `${kind} lacks required ${expected.role} parent`, { artifact_type: kind, role: expected.role });
  }
  const actual = matches[0];
  if (matches.length !== 1
    || actual.artifact_type !== expected.artifact_type
    || actual.role !== expected.role
    || actual.path !== expected.path
    || actual.sha256 !== expected.sha256
    || (actual.size_bytes ?? null) !== (expected.size_bytes ?? null)) {
    throw proofError('digest_mismatch', `${kind} ${expected.role} parent does not match the exact snapshot`, { artifact_type: kind, role: expected.role });
  }
}
function assertProofDocument({
  document,
  snapshot,
  kind,
  identity,
  configParent,
  requiredParent = null,
  portablePathRoot,
}) {
  if (!document?.revision_lineage) {
    throw proofError('unsupported_legacy', `${kind} is proof-ineligible because revision_lineage is missing`, { artifact_type: kind });
  }
  const lineage = assertRevisionLineage(document.revision_lineage);
  assertRevisionLineageIdentityAgreement([identity, lineage]);
  assertExactLineageParent(lineage, configParent, kind);
  if (requiredParent) assertExactLineageParent(lineage, requiredParent, kind);
  const documentIdentityValue = requireProofIdentity(documentIdentity(document, kind), kind);
  if (documentIdentityValue.slug !== identity.package_slug
    || documentIdentityValue.part_identifier !== identity.part_id
    || documentIdentityValue.revision !== identity.revision) {
    throw proofError('conflicting_identity', `${kind} identity fields disagree with revision_lineage`, { artifact_type: kind });
  }
  return buildRevisionLineageParent({
    artifactType: kind,
    role: kind,
    path: proofRunLocator(snapshot.path, portablePathRoot),
    sha256: snapshot.sha256,
    sizeBytes: snapshot.size_bytes,
  });
}
async function loadProofJson(projectRoot, path, artifactType) {
  const snapshot = await readRevisionLineageFileSnapshot({ projectRoot, path });
  const document = parseInspectionEvidenceJsonBytes(snapshot.bytes, { requireCanonical: false });
  const safety = validateInspectionEvidenceControlMaterial(document);
  if (!safety.ok) throw proofError('malformed_identity', `${artifactType} input contains unsafe control material`, { artifact_type: artifactType });
  if (document.artifact_type !== artifactType) throw proofError('unsupported_legacy', `Expected ${artifactType} input`, { artifact_type: document.artifact_type || null });
  return {
    document,
    trustedSnapshot: snapshot,
    snapshot: {
      artifact_type: artifactType,
      path: snapshot.path,
      sha256: snapshot.sha256,
      size_bytes: snapshot.size_bytes,
    },
  };
}
function authority(value, level = 'explicit_review_requirement') { return value === null || value === undefined ? 'unresolved' : level; }
function sourceRefs(snapshot) { return Object.values(snapshot).map((entry) => `${entry.artifact_type}:${entry.sha256}`).sort(); }
function toleranceLimits(record) {
  const rawUnit = record.unit || record.tolerance?.unit || null;
  const factor = rawUnit === 'in' || rawUnit === 'inch' ? 25.4 : 1;
  const nominal = Number.isFinite(record.nominal_value) ? engineeringNumber(record.nominal_value * factor) : null;
  const tolerance = record.tolerance && typeof record.tolerance === 'object' ? record.tolerance : null;
  return {
    nominal,
    lower: nominal !== null && Number.isFinite(tolerance?.lower) ? engineeringNumber(nominal + tolerance.lower * factor) : null,
    upper: nominal !== null && Number.isFinite(tolerance?.upper) ? engineeringNumber(nominal + tolerance.upper * factor) : null,
  };
}
function csvCell(value, type = 'text') {
  if (value === null || value === undefined) return '';
  let text = Array.isArray(value) ? value.join('|') : String(value);
  if (type === 'text' && /^[=+@-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csv(columns, rows, numeric = new Set()) {
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column], numeric.has(column) ? 'number' : 'text')).join(',')).join('\n')}\n`;
}

export function buildInspectionPlan({
  reviewPack,
  revisionImpact = null,
  readiness = null,
  config = null,
  requirements = null,
  sourceSnapshot,
  scope = 'full',
  generatedAt,
  requireAuthoritativeLineage = false,
  revisionLineage = null,
}) {
  if (!['full', 'delta'].includes(scope)) throw new Error('scope must be full or delta');
  if (scope === 'delta' && revisionImpact?.artifact_type !== 'revision_impact_report') throw new Error('delta scope requires a revision_impact_report');
  const pkg = packageIdentity(reviewPack);
  assertAvailableIdentityAgreement(pkg, reviewPack, 'review-pack');
  assertAvailableIdentityAgreement(pkg, config, 'config');
  assertAvailableIdentityAgreement(pkg, readiness, 'readiness');
  assertAvailableIdentityAgreement(pkg, revisionImpact, 'revision-impact candidate');
  assertAvailableIdentityAgreement(pkg, requirements, 'inspection requirements');
  if (requireAuthoritativeLineage === true) {
    requireProofIdentity(pkg, 'review_pack');
    if (!revisionLineage) throw proofError('missing_parent', 'Proof inspection plan requires reconciled revision_lineage');
    const lineage = assertRevisionLineage(revisionLineage);
    if (pkg.slug !== lineage.identity.package_slug
      || pkg.part_identifier !== lineage.identity.part_id
      || pkg.revision !== lineage.identity.revision) {
      throw proofError('conflicting_identity', 'Inspection-plan package identity disagrees with revision_lineage');
    }
  } else if (revisionLineage) {
    throw proofError('unsupported_legacy', 'revision_lineage cannot be emitted without explicit proof activation');
  }
  const impactItems = new Map((revisionImpact?.reinspection_plan?.items || []).map((item) => [item.affected_entity_id, item]));
  const impactAssessments = new Map((revisionImpact?.evidence_applicability?.assessments || []).map((item) => [item.evidence_or_characteristic_id, item]));
  const reviewRecords = (reviewPack.inspection_linkage?.records || []).filter((record) => record.record_role === 'inspection_requirement').map((record) => ({ ...record, _authority: 'explicit_review_requirement' }));
  const releasedRecords = (requirements?.items || []).map((record) => ({ ...record, record_role: 'inspection_requirement', dimension_name: record.characteristic_name || record.dimension_name, _authority: 'authoritative_released_requirement' }));
  const records = [...reviewRecords, ...releasedRecords];
  const conflicts = new Map();
  for (const record of records) {
    if (!record.characteristic_id) continue;
    const prior = conflicts.get(record.characteristic_id);
    const comparable = JSON.stringify([record.nominal_value ?? null, record.tolerance ?? null, record.unit ?? null, record.datum_reference ?? null, record.specification_reference ?? null, record.inspection_method ?? null]);
    if (prior && prior.comparable !== comparable) prior.conflict = true;
    else if (!prior) conflicts.set(record.characteristic_id, { comparable, conflict: false });
  }
  const deduped = [...new Map(records.map((record) => [record.characteristic_id || stableId('missing', [JSON.stringify(record)]), record])).values()];
  const selected = scope === 'full' ? deduped : deduped.filter((record) => impactItems.has(record.characteristic_id) || ['review_required', 'unable_to_determine', 'reinspection_required'].includes(impactAssessments.get(record.characteristic_id)?.applicability_status));
  const unresolved = [];
  const items = selected.map((record) => {
    const id = record.characteristic_id;
    if (!id) return null;
    const limits = toleranceLimits(record);
    const changeIds = [...new Set([...(impactItems.get(id)?.related_change_ids || []), ...(impactAssessments.get(id)?.related_change_ids || [])])].sort();
    const rawUnit = record.unit || record.tolerance?.unit || null;
    const unit = rawUnit === 'in' || rawUnit === 'inch' ? 'mm' : rawUnit;
    const missing = [];
    if (conflicts.get(id)?.conflict) missing.push('conflicting_authoritative_requirements');
    if (limits.lower === null || limits.upper === null) missing.push('tolerance_unresolved');
    if (!record.specification_reference) missing.push('specification_reference_unresolved');
    if (!record.inspection_method) missing.push('inspection_method_unresolved');
    if (!unit || !SUPPORTED_UNITS.has(unit)) missing.push(unit ? 'unsupported_unit' : 'unit_unresolved');
    const planItemId = stableId('ipi', [pkg.slug, pkg.revision, id, record.feature_id, record.specification_reference]);
    for (const code of missing) unresolved.push({ code, plan_item_id: planItemId, message: `${id}: ${code.replaceAll('_', ' ')}`, source_refs: sourceRefs(sourceSnapshot) });
    return {
      plan_item_id: planItemId, characteristic_id: id, feature_id: record.feature_id || null, package_slug: pkg.slug, revision: pkg.revision,
      characteristic_name: record.dimension_name || id, inspection_purpose: changeIds.length ? 'Verify the revision-affected requirement.' : 'Verify the explicit inspection requirement.', revision_impact_change_ids: changeIds,
      nominal_value: limits.nominal, lower_limit: limits.lower, upper_limit: limits.upper, unit, datum_reference: record.datum_reference || null, specification_reference: record.specification_reference || null,
      required_method: record.inspection_method || null, suggested_method: null, required_equipment_class: record.equipment_class || null, suggested_equipment_class: null, required_sampling: record.sampling || null, suggested_sampling: null,
      acceptance_rule: limits.lower !== null && limits.upper !== null ? 'measured_value >= lower_limit and measured_value <= upper_limit' : null,
      required_result_fields: [...RESULT_FIELDS], required_provenance_fields: [...PROVENANCE_FIELDS], source_artifact_refs: sourceRefs(sourceSnapshot),
      field_authority: { nominal_value: authority(limits.nominal, record._authority), lower_limit: authority(limits.lower, record._authority), upper_limit: authority(limits.upper, record._authority), unit: authority(unit, record._authority), datum_reference: authority(record.datum_reference, record._authority), specification_reference: authority(record.specification_reference, record._authority), required_method: authority(record.inspection_method, record._authority), required_equipment_class: authority(record.equipment_class, record._authority), required_sampling: authority(record.sampling, record._authority), revision_impact_change_ids: changeIds.length ? 'revision_impact_requirement' : 'unresolved' },
      human_review_required: missing.length > 0 || scope === 'delta', human_release_required: true, current_status: 'not_started', evidence_state_changed: false,
    };
  }).filter(Boolean).sort((a, b) => a.plan_item_id.localeCompare(b.plan_item_id));
  if (scope === 'delta') {
    const known = new Set(items.map((item) => item.characteristic_id));
    const missingImpacts = [
      ...impactItems.values(),
      ...[...impactAssessments.values()].filter((entry) => ['review_required', 'unable_to_determine', 'reinspection_required'].includes(entry.applicability_status)).map((entry) => ({ affected_entity_id: entry.evidence_or_characteristic_id, related_change_ids: entry.related_change_ids, applicability_status: entry.applicability_status })),
    ].filter((entry) => entry.affected_entity_id && !known.has(entry.affected_entity_id));
    for (const impact of new Map(missingImpacts.map((entry) => [entry.affected_entity_id, entry])).values()) {
      const planItemId = stableId('ipi', [pkg.slug, pkg.revision, impact.affected_entity_id, 'revision-impact-only']);
      items.push({ plan_item_id: planItemId, characteristic_id: impact.affected_entity_id, feature_id: null, package_slug: pkg.slug, revision: pkg.revision, characteristic_name: impact.affected_entity_id, inspection_purpose: 'Resolve revision-affected or removed characteristic requirements.', revision_impact_change_ids: [...new Set(impact.related_change_ids || [])].sort(), nominal_value: null, lower_limit: null, upper_limit: null, unit: null, datum_reference: null, specification_reference: null, required_method: null, suggested_method: impact.suggested_method || null, required_equipment_class: null, suggested_equipment_class: null, required_sampling: null, suggested_sampling: null, acceptance_rule: null, required_result_fields: [...RESULT_FIELDS], required_provenance_fields: [...PROVENANCE_FIELDS], source_artifact_refs: sourceRefs(sourceSnapshot), field_authority: { nominal_value: 'unresolved', lower_limit: 'unresolved', upper_limit: 'unresolved', unit: 'unresolved', datum_reference: 'unresolved', specification_reference: 'unresolved', required_method: 'unresolved', required_equipment_class: 'unresolved', required_sampling: 'unresolved', revision_impact_change_ids: 'revision_impact_requirement' }, human_review_required: true, human_release_required: true, current_status: 'not_started', evidence_state_changed: false });
      const code = impact.applicability_status === 'unable_to_determine' ? 'revision_impact_unable_to_determine' : 'revision_impact_characteristic_unresolved';
      unresolved.push({ code, plan_item_id: planItemId, message: `${impact.affected_entity_id}: revision impact has no matching candidate requirement; removal or identity must be reviewed.`, source_refs: sourceRefs(sourceSnapshot) });
    }
    items.sort((a, b) => a.plan_item_id.localeCompare(b.plan_item_id));
  }
  for (const record of records.filter((entry) => !entry.characteristic_id)) unresolved.push({ code: 'stable_characteristic_id_missing', plan_item_id: null, message: 'An explicit inspection requirement lacks stable characteristic identity.', source_refs: sourceRefs(sourceSnapshot) });
  if (!pkg.revision) unresolved.push({ code: 'package_revision_missing', plan_item_id: null, message: 'Package revision is required for human release.', source_refs: sourceRefs(sourceSnapshot) });
  const blocked = unresolved.filter((entry) => ['stable_characteristic_id_missing', 'package_revision_missing', 'unsupported_unit', 'conflicting_authoritative_requirements', 'revision_impact_unable_to_determine'].includes(entry.code)).length;
  const status = blocked ? 'blocked' : unresolved.length ? 'review_required' : 'ready_for_human_release';
  const planId = stableId('inspection-plan', [pkg.slug, pkg.revision, scope, ...items.map((item) => item.plan_item_id)]);
  return assertValidInspectionPlan({
    artifact_type: 'inspection_plan', schema_version: '1.0', generated_at: generatedAt, plan_id: planId, status, scope, package: pkg, source_snapshot: sourceSnapshot,
    ...(requireAuthoritativeLineage ? { revision_lineage: revisionLineage } : {}),
    authority_summary: { authoritative_item_count: items.filter((item) => !item.human_review_required).length, advisory_item_count: items.filter((item) => item.human_review_required).length, blocked_item_count: blocked, human_release_required: true },
    items, unresolved_requirements: unresolved.sort((a, b) => `${a.plan_item_id}:${a.code}`.localeCompare(`${b.plan_item_id}:${b.code}`)),
    derived_outputs: { checksheet: { artifact_type: 'inspection_checksheet.csv', generated_control_artifact: true }, supplier_request: { artifact_type: 'supplier_inspection_request.md', generated_control_artifact: true }, result_template: { artifact_type: 'inspection_result_template.csv', generated_control_artifact: true } },
    boundaries: { generated_control_artifact: true, released_document: false, inspection_evidence: false, measured_results_present: false, evidence_attached: false, readiness_regenerated: false, canonical_artifacts_mutated: false, human_release_required: true },
  });
}

export function renderInspectionChecksheet(plan) { return csv(INSPECTION_CHECKSHEET_COLUMNS, plan.items.map((item) => ({ ...item, plan_id: plan.plan_id, actual_value: '', actual_unit: '', result: '' })), new Set(['nominal_value', 'lower_limit', 'upper_limit', 'actual_value'])); }
export function renderInspectionResultTemplate(plan) {
  const planSha256 = sha(canonicalizeInspectionPlan(plan));
  return csv(INSPECTION_RESULT_TEMPLATE_COLUMNS, plan.items.map((item) => ({
    plan_id: plan.plan_id,
    plan_sha256: planSha256,
    plan_item_id: item.plan_item_id,
    package_slug: item.package_slug,
    revision: item.revision,
    characteristic_id: item.characteristic_id,
    control_material_notice: 'generated blank template - not inspection evidence',
  })), new Set(['measured_value']));
}
export function renderSupplierInspectionRequest(plan, planChecksum) {
  const lines = ['# Supplier / Lab Inspection Request', '', `- Package: ${plan.package.slug || 'UNRESOLVED'}`, `- Revision: ${plan.package.revision || 'UNRESOLVED'}`, `- Inspection scope: ${plan.scope}`, `- Source plan ID: ${plan.plan_id}`, `- Source plan SHA-256: ${planChecksum}`, '', '## Characteristics', ''];
  for (const item of plan.items) lines.push(`- ${item.characteristic_id}: ${item.characteristic_name}; nominal=${item.nominal_value ?? 'UNRESOLVED'}; limits=${item.lower_limit ?? 'UNRESOLVED'}..${item.upper_limit ?? 'UNRESOLVED'} ${item.unit || ''}; required method=${item.required_method || 'UNRESOLVED'}; specification=${item.specification_reference || 'UNRESOLVED'}; change IDs=${item.revision_impact_change_ids.join('|') || 'none'}`);
  lines.push('', '## Clarifications required', '', ...(plan.unresolved_requirements.length ? plan.unresolved_requirements.map((item) => `- ${item.message}`) : ['- None recorded by the generated plan.']), '', '## Return contract', '', '- Expected source file type: externally completed native UTF-8 result CSV.', '- Preserve the plan and release-record checksum fields plus stable plan-item and characteristic IDs.', '- Provide inspector reference, reviewer reference, completion status, final status, measured value, measured unit, result, method, completion time, and source record SHA-256.', '- Do not include credentials, private URLs, or unnecessary personal information; redact confidential data not required by the plan.', '- Normalize the returned file against this exact released plan and release record before any quarantine review.', '- Returned files and normalization reports remain untrusted candidates until human review, quarantine, structural validation, semantic validation, separate authorization, and attachment.', '', '> Generated control material. Engineering/quality review and human release are required before supplier or lab use. This request and its blank template are not inspection evidence.', '');
  return `${lines.join('\n')}\n`;
}

async function loadJson(projectRoot, path, artifactType, trustedInputRoots = []) {
  const absolute = resolve(projectRoot, path);
  let rel;
  try { rel = portablePath(projectRoot, absolute); } catch {
    const root = trustedInputRoots.find((entry) => { const value = relative(resolve(entry), absolute); return value === '' || (!value.startsWith('..') && !isAbsolute(value)); });
    if (!root) throw new Error('Input path must be repo-relative or a registered tracked-job artifact');
    rel = `tracked-job/${relative(resolve(root), absolute).replaceAll('\\', '/')}`;
  }
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error(`${artifactType} input is not a safe bounded regular file`);
  const bytes = await readFile(absolute);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error(`${artifactType} input must not contain a BOM`);
  const document = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
  const safety = validateInspectionEvidenceControlMaterial(document);
  if (!safety.ok) throw new Error(`${artifactType} input contains unsafe control material`);
  if (document.artifact_type !== artifactType) throw new Error(`Expected ${artifactType} input`);
  return { document, snapshot: { artifact_type: artifactType, path: rel, sha256: sha(bytes) } };
}

async function loadConfigSnapshot(projectRoot, path, trustedInputRoots) {
  const absolute = resolve(projectRoot, path); const bytes = await readFile(absolute); if (bytes.length > 2 * 1024 * 1024) throw new Error('config input is oversized');
  const ext = absolute.toLowerCase().endsWith('.toml') ? 'toml' : 'json';
  const document = ext === 'toml' ? parseToml(bytes.toString('utf8')) : parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
  const safety = validateInspectionEvidenceControlMaterial(document); if (!safety.ok) throw new Error('config input contains unsafe control material');
  let pathRef; try { pathRef = portablePath(projectRoot, absolute); } catch { const root = trustedInputRoots.find((entry) => !relative(resolve(entry), absolute).startsWith('..')); if (!root) throw new Error('Config path is outside trusted roots'); pathRef = `tracked-job/${relative(resolve(root), absolute).replaceAll('\\', '/')}`; }
  return { document, snapshot: { artifact_type: 'config', path: pathRef, sha256: sha(bytes) } };
}

export async function createInspectionPlanFromPaths({
  projectRoot,
  reviewPackPath,
  revisionImpactPath = null,
  readinessPath = null,
  configPath = null,
  authoritativeConfigSnapshot = null,
  requirementsPath = null,
  trustedInputRoots = [],
  scope,
  generatedAt,
  afterSnapshot = null,
  requireAuthoritativeLineage = false,
  lineageSelection = undefined,
}) {
  const proof = requireAuthoritativeLineage === true;
  if (requireAuthoritativeLineage !== false && !proof) {
    throw proofError('malformed_identity', 'requireAuthoritativeLineage must be a boolean');
  }
  if (proof && !configPath) throw proofError('missing_identity', 'Proof inspection plan requires configPath');
  const proofPath = (value) => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw proofError('unsafe_path', 'Proof inspection-plan inputs require explicit repo-relative paths');
    }
    return value;
  };
  const review = proof
    ? await loadProofJson(projectRoot, proofPath(reviewPackPath), 'review_pack')
    : await loadJson(projectRoot, reviewPackPath, 'review_pack', trustedInputRoots);
  const impact = revisionImpactPath
    ? (proof
        ? await loadProofJson(projectRoot, proofPath(revisionImpactPath), 'revision_impact_report')
        : await loadJson(projectRoot, revisionImpactPath, 'revision_impact_report', trustedInputRoots))
    : null;
  const readiness = readinessPath
    ? (proof
        ? await loadProofJson(projectRoot, proofPath(readinessPath), 'readiness_report')
        : await loadJson(projectRoot, readinessPath, 'readiness_report', trustedInputRoots))
    : null;
  let config;
  if (proof) {
    const proofConfigPath = proofPath(configPath);
    const trustedSnapshot = authoritativeConfigSnapshot || await readAuthoritativeConfigSnapshot({
      projectRoot,
      configPath: proofConfigPath,
      ...(lineageSelection === undefined ? {} : { selection: lineageSelection }),
    });
    if (trustedSnapshot.path !== proofConfigPath) {
      throw proofError('conflicting_identity', 'Proof config snapshot path does not match configPath', {
        expected_path: proofConfigPath,
        snapshot_path: trustedSnapshot.path,
      });
    }
    config = {
      document: trustedSnapshot.config,
      trustedSnapshot,
      snapshot: {
        artifact_type: 'config',
        path: trustedSnapshot.path,
        sha256: trustedSnapshot.sha256,
        size_bytes: trustedSnapshot.size_bytes,
      },
    };
  } else {
    config = configPath ? await loadConfigSnapshot(projectRoot, configPath, trustedInputRoots) : null;
  }
  const requirements = requirementsPath
    ? (proof
        ? await loadProofJson(projectRoot, proofPath(requirementsPath), 'inspection_requirements')
        : await loadJson(projectRoot, requirementsPath, 'inspection_requirements', trustedInputRoots))
    : null;
  const actualSourceSnapshot = { review_pack: review.snapshot, ...(impact ? { revision_impact: impact.snapshot } : {}), ...(readiness ? { readiness: readiness.snapshot } : {}), ...(config ? { config: config.snapshot } : {}), ...(requirements ? { requirements: requirements.snapshot } : {}) };
  const portablePathRoot = proof ? dirname(review.trustedSnapshot.path) : null;
  const sourceSnapshot = proof
    ? Object.fromEntries(Object.entries(actualSourceSnapshot).map(([key, entry]) => [key, {
        ...entry,
        path: entry.artifact_type === 'config'
          ? entry.path
          : proofRunLocator(entry.path, portablePathRoot),
      }]))
    : actualSourceSnapshot;
  const expectedReviewHash = impact?.document?.candidate?.source_hashes?.review_pack;
  if (expectedReviewHash && expectedReviewHash !== review.snapshot.sha256) throw new Error('revision-impact source-hash mismatch for review pack');
  await afterSnapshot?.({ sourceSnapshot: structuredClone(actualSourceSnapshot) });
  let revisionLineage = null;
  if (proof) {
    const identity = config.trustedSnapshot.identity;
    const configParent = buildRevisionLineageParentFromSnapshot({
      artifactType: 'config',
      role: 'authoritative_config',
      snapshot: config.trustedSnapshot,
    });
    const reviewParent = assertProofDocument({
      document: review.document,
      snapshot: review.trustedSnapshot,
      kind: 'review_pack',
      identity,
      configParent,
      portablePathRoot,
    });
    const parents = [configParent, reviewParent];
    if (readiness) {
      parents.push(assertProofDocument({
        document: readiness.document,
        snapshot: readiness.trustedSnapshot,
        kind: 'readiness_report',
        identity,
        configParent,
        requiredParent: reviewParent,
        portablePathRoot,
      }));
    }
    if (impact) {
      parents.push(assertProofDocument({
        document: impact.document,
        snapshot: impact.trustedSnapshot,
        kind: 'revision_impact_report',
        identity,
        configParent,
        requiredParent: { ...reviewParent, role: 'candidate_review_pack' },
        portablePathRoot,
      }));
    }
    if (requirements) {
      parents.push(assertProofDocument({
        document: requirements.document,
        snapshot: requirements.trustedSnapshot,
        kind: 'inspection_requirements',
        identity,
        configParent,
        portablePathRoot,
      }));
    }
    for (const entry of [config, review, impact, readiness, requirements].filter((item) => item?.trustedSnapshot)) {
      await assertRevisionLineageSnapshotCurrent(entry.trustedSnapshot, { projectRoot });
    }
    revisionLineage = buildRevisionLineage({ identity, parents });
  }
  return buildInspectionPlan({
    reviewPack: review.document,
    revisionImpact: impact?.document || null,
    readiness: readiness?.document || null,
    config: config?.document || null,
    requirements: requirements?.document || null,
    sourceSnapshot,
    scope,
    generatedAt,
    requireAuthoritativeLineage: proof,
    revisionLineage,
  });
}

export async function writeInspectionPlanOutputs({ projectRoot, plan, outputPath, checksheetPath = null, requestPath = null, resultTemplatePath = null, trustedOutputRoots = [], additionalOutputs = [], publicationHooks = {} }) {
  const rawPaths = [outputPath, checksheetPath, requestPath, resultTemplatePath, ...additionalOutputs.map((entry) => entry.path)].filter(Boolean);
  for (const value of rawPaths) {
    const text = String(value);
    if (!text || text.includes('\0') || text.includes('\\') || text.replaceAll('\\', '/').split('/').includes('..')) throw new Error('Inspection-plan output path contains traversal, NUL, or backslash syntax');
  }
  let paths = rawPaths.map((entry) => resolve(projectRoot, entry));
  if (new Set(paths).size !== paths.length) throw new Error('Inspection-plan output paths must be unique');
  const root = resolve(projectRoot);
  for (const path of paths) {
    const rel = relative(root, path).replaceAll('\\', '/');
    const trusted = trustedOutputRoots.some((entry) => {
      const trustedRel = relative(resolve(entry), path).replaceAll('\\', '/');
      return trustedRel === '' || (!trustedRel.startsWith('../') && !isAbsolute(trustedRel));
    });
    if (!trusted && !(rel.startsWith('output/') || rel.startsWith('tmp/codex/'))) throw new Error('Inspection-plan outputs must stay under output/, tmp/codex/, or a trusted job artifact root');
    if (dirname(path) !== dirname(paths[0])) throw new Error('All inspection-plan outputs must share one directory');
  }
  await mkdir(dirname(paths[0]), { recursive: true });
  const realDirectory = await realpath(dirname(paths[0]));
  if (realDirectory !== dirname(paths[0])) {
    const trusted = trustedOutputRoots.some((entry) => {
      const rel = relative(resolve(entry), paths[0]);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
    if (!trusted) throw new Error('Inspection-plan output directory must not resolve through a symlink');
    paths = paths.map((entry) => resolve(realDirectory, basename(entry)));
  }
  const json = canonicalizeInspectionPlan(plan);
  const payloads = new Map([[paths[0], json]]);
  const actualPath = (value) => resolve(dirname(paths[0]), basename(resolve(root, value)));
  if (checksheetPath) payloads.set(actualPath(checksheetPath), renderInspectionChecksheet(plan));
  if (requestPath) payloads.set(actualPath(requestPath), renderSupplierInspectionRequest(plan, sha(json)));
  if (resultTemplatePath) payloads.set(actualPath(resultTemplatePath), renderInspectionResultTemplate(plan));
  for (const entry of additionalOutputs) payloads.set(actualPath(entry.path), entry.content);
  await publishAtomicOutputSet({
    directory: dirname(paths[0]),
    outputs: [...payloads].map(([path, content]) => ({ path, content })),
    hooks: publicationHooks,
  });
  return { inspection_plan: paths[0], ...(checksheetPath ? { checksheet: actualPath(checksheetPath) } : {}), ...(requestPath ? { supplier_request: actualPath(requestPath) } : {}), ...(resultTemplatePath ? { result_template: actualPath(resultTemplatePath) } : {}) };
}
