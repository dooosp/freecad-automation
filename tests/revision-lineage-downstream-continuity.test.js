import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  appendInspectionEvidenceTransition,
  buildAttachedInspectionEvidenceEnvelope,
  findNonGenuineStringMarkers,
  sha256Json,
  validateCanonicalInspectionEvidenceChain,
  validateInspectionEvidenceAuthorizationBinding,
  validateInspectionEvidenceCandidateEnvelopeBinding,
  validateInspectionEvidenceEnvelopeSemantics,
  validateInspectionEvidenceReadinessAuthorizationBinding,
} from '../lib/inspection-evidence-onboarding.js';
import { canonicalizeInspectionControlDocument } from '../lib/inspection-result-contract.js';
import {
  buildRevisionLineage,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
} from '../lib/revision-lineage-contract.js';
import { writeStage5bEvidenceAttachmentControlManifest } from '../src/services/inspection-evidence-intake/stage5b-evidence-attachment-controller-service.js';
import {
  createInspectionPlanReleaseRecordFromPaths,
  writeInspectionPlanReleaseRecord,
} from '../src/services/inspection-plan/inspection-plan-release-service.js';
import {
  INSPECTION_RESULT_TEMPLATE_COLUMNS,
  createInspectionPlanFromPaths,
  writeInspectionPlanOutputs,
} from '../src/services/inspection-plan/inspection-plan-service.js';
import { normalizeInspectionResultFromPaths } from '../src/services/inspection-result/inspection-result-normalization-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-07-27T00:00:00Z';
const REVIEWED_AT = '2026-07-27T01:00:00Z';
const AWAITING_AT = '2026-07-27T01:05:00Z';
const CONFIDENTIALITY_AT = '2026-07-27T01:10:00Z';
const AUTHORIZED_AT = '2026-07-27T01:15:00Z';
const ATTACHED_AT = '2026-07-27T01:20:00Z';
const READINESS_AUTHORIZED_AT = '2026-07-27T01:25:00Z';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const portable = (path) => relative(ROOT, path).replaceAll('\\', '/');
const errorCodes = (result) => result.errors.map((error) => error.code);

function csv(rows) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${INSPECTION_RESULT_TEMPLATE_COLUMNS.join(',')}\n${rows
    .map((row) => INSPECTION_RESULT_TEMPLATE_COLUMNS.map((column) => cell(row[column])).join(','))
    .join('\n')}\n`;
}

function canonicalBytes(value) {
  return Buffer.from(canonicalizeInspectionControlDocument(value));
}

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(resolve(ROOT, 'tmp/codex/revision-lineage-downstream-'));

try {
  const packageDirectory = join(temp, 'plate-with-holes');
  const configPath = join(packageDirectory, 'source-config.toml');
  const reviewPath = join(packageDirectory, 'review_pack.json');
  await mkdir(packageDirectory, { recursive: true });

  const selection = {
    package_directory: portable(packageDirectory),
    package_slug: 'plate-with-holes',
    part_id: 'PLATE-100',
    revision: 'B',
    authoritative_config_path: portable(configPath),
    generated_config_descendants: [portable(join(packageDirectory, 'config.toml'))],
  };
  const configTemplate = await readFile(resolve(ROOT, 'configs/examples/hinge_block.toml'), 'utf8');
  const configBytes = Buffer.from(configTemplate
    .replace(/^name = "hinge_block"$/m, 'name = "PLATE-100"')
    .replace(/^package_slug = "hinge-block"$/m, 'package_slug = "plate-with-holes"')
    .replace(/^part_id = "hinge_block"$/m, 'part_id = "PLATE-100"')
    .replace(/^revision = "A"$/m, 'revision = "B"'));
  await writeFile(configPath, configBytes);
  const configSnapshot = await readAuthoritativeConfigSnapshot({
    projectRoot: ROOT,
    configPath: portable(configPath),
    selection,
  });
  const configParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot: configSnapshot,
  });

  const sourceReview = await readFile(
    resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json'),
    'utf8'
  );
  const review = JSON.parse(sourceReview
    .replaceAll('fixture-bracket', 'plate-with-holes')
    .replaceAll('FIXTURE-BRACKET-100', 'PLATE-100')
    .replaceAll('fixture_bracket', 'PLATE-100')
    .replaceAll('Synthetic', 'Controlled')
    .replaceAll('synthetic', 'controlled')
    .replaceAll('FIXTURE', 'PLATE')
    .replaceAll('fixture', 'received'));
  review.revision_lineage = buildRevisionLineage({
    identity: configSnapshot.identity,
    parents: [configParent],
  });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  const plan = await createInspectionPlanFromPaths({
    projectRoot: ROOT,
    reviewPackPath: portable(reviewPath),
    configPath: portable(configPath),
    scope: 'full',
    generatedAt: GENERATED_AT,
    requireAuthoritativeLineage: true,
    lineageSelection: selection,
  });
  assert.deepEqual(plan.revision_lineage.identity, configSnapshot.identity);
  assert.equal(plan.package.part_identifier, configSnapshot.identity.part_id);

  const paths = {
    plan: join(packageDirectory, 'inspection_plan.json'),
    checksheet: join(packageDirectory, 'inspection_checksheet.csv'),
    request: join(packageDirectory, 'supplier_inspection_request.md'),
    template: join(packageDirectory, 'inspection_result_template.csv'),
    authorization: join(packageDirectory, 'inspection_plan_release_authorization.json'),
    releaseRecord: join(packageDirectory, 'inspection_plan_release_record.json'),
    source: join(packageDirectory, 'completed_result.csv'),
    metadata: join(packageDirectory, 'submission_metadata.json'),
  };
  await writeInspectionPlanOutputs({
    projectRoot: ROOT,
    plan,
    outputPath: portable(paths.plan),
    checksheetPath: portable(paths.checksheet),
    requestPath: portable(paths.request),
    resultTemplatePath: portable(paths.template),
  });
  const planBytes = await readFile(paths.plan);
  const releaseAuthorization = {
    artifact_type: 'inspection_plan_release_authorization',
    schema_version: '1.0',
    authorization_id: 'release-auth:received-001',
    decision: 'release_for_inspection_execution',
    package: { slug: plan.package.slug, revision: plan.package.revision },
    plan: { plan_id: plan.plan_id, sha256: sha256(planBytes) },
    distributed_files: {
      checksheet: { path: portable(paths.checksheet), sha256: sha256(await readFile(paths.checksheet)) },
      supplier_request: { path: portable(paths.request), sha256: sha256(await readFile(paths.request)) },
      result_template: { path: portable(paths.template), sha256: sha256(await readFile(paths.template)) },
    },
    inspection_scope: plan.scope,
    engineering_review: { identity_ref: 'user:engineering-reviewer', role_ref: 'role:engineering', reviewed_at: GENERATED_AT },
    quality_review: { identity_ref: 'user:quality-reviewer', role_ref: 'role:quality', reviewed_at: GENERATED_AT },
    released_by: { identity_ref: 'user:release-controller', role_ref: 'role:quality-release' },
    released_at: GENERATED_AT,
    external_controlled_document_ref: null,
    confidentiality_classification: 'internal',
    notes: null,
    boundaries: {
      inspection_evidence: false,
      product_release: false,
      readiness_approval: false,
      evidence_attached: false,
      readiness_regeneration_authorized: false,
      scope: 'exact_bound_files_for_inspection_execution_only',
    },
  };
  await writeFile(paths.authorization, canonicalBytes(releaseAuthorization));

  const releaseRecord = await createInspectionPlanReleaseRecordFromPaths({
    projectRoot: ROOT,
    inspectionPlanPath: paths.plan,
    authorizationPath: paths.authorization,
    generatorVersion: 'proof-test-version',
    requireAuthoritativeLineage: true,
  });
  assert.equal(releaseRecord.boundaries.inspection_evidence, false);
  assert.deepEqual(
    await createInspectionPlanReleaseRecordFromPaths({
      projectRoot: ROOT,
      inspectionPlanPath: paths.plan,
      authorizationPath: paths.authorization,
      generatorVersion: 'proof-test-version',
    }),
    releaseRecord,
    'lineage-looking fields alone must not alter legacy release behavior'
  );
  await assert.rejects(
    () => createInspectionPlanReleaseRecordFromPaths({
      projectRoot: ROOT,
      inspectionPlanPath: paths.plan,
      authorizationPath: paths.authorization,
      requireAuthoritativeLineage: 'true',
    }),
    (error) => error?.code === 'malformed_identity'
  );

  const staleAuthorizationPath = join(packageDirectory, 'stale-release-authorization.json');
  await writeFile(staleAuthorizationPath, canonicalBytes({
    ...releaseAuthorization,
    authorization_id: 'release-auth:received-stale',
    plan: { ...releaseAuthorization.plan, sha256: '0'.repeat(64) },
  }));
  await assert.rejects(
    () => createInspectionPlanReleaseRecordFromPaths({
      projectRoot: ROOT,
      inspectionPlanPath: paths.plan,
      authorizationPath: staleAuthorizationPath,
      requireAuthoritativeLineage: true,
    }),
    (error) => error?.code === 'digest_mismatch'
  );
  await assert.rejects(
    () => createInspectionPlanReleaseRecordFromPaths({
      projectRoot: ROOT,
      inspectionPlanPath: paths.plan,
      authorizationPath: paths.authorization,
      requireAuthoritativeLineage: true,
      afterSnapshot: async () => writeFile(configPath, Buffer.concat([configBytes, Buffer.from('\n# changed\n')])),
    }),
    (error) => error?.code === 'digest_mismatch' || error?.code === 'stale_parent'
  );
  await writeFile(configPath, configBytes);
  await writeInspectionPlanReleaseRecord({
    projectRoot: ROOT,
    record: releaseRecord,
    outputPath: paths.releaseRecord,
  });

  const releaseRecordBytes = await readFile(paths.releaseRecord);
  const item = plan.items[0];
  const measuredValue = (item.lower_limit + item.upper_limit) / 2;
  const sourceRow = {
    plan_id: plan.plan_id,
    plan_sha256: sha256(planBytes),
    plan_release_record_id: releaseRecord.release_record_id,
    plan_release_record_sha256: sha256(releaseRecordBytes),
    plan_item_id: item.plan_item_id,
    package_slug: plan.package.slug,
    revision: plan.package.revision,
    characteristic_id: item.characteristic_id,
    control_material_notice: 'generated blank template - not inspection evidence',
    measured_value: String(measuredValue),
    measured_unit: item.unit,
    result: 'pass',
    completion_status: 'completed',
    final_status: 'final',
    inspector_reference: 'user:external-inspector',
    reviewer_reference: 'user:external-reviewer',
    source_file_sha256: 'a'.repeat(64),
    method_used: item.required_method,
    equipment_reference: item.required_equipment_class || '',
    measurement_completed_at: GENERATED_AT,
    remarks: 'completed measurement',
  };
  const submissionMetadata = {
    artifact_type: 'inspection_result_submission_metadata',
    schema_version: '1.0',
    package: { slug: plan.package.slug, revision: plan.package.revision },
    part_identifier: plan.package.part_identifier,
    plan_id: plan.plan_id,
    plan_sha256: sha256(planBytes),
    plan_release_record_id: releaseRecord.release_record_id,
    plan_release_record_sha256: sha256(releaseRecordBytes),
    source_organization: 'External Metrology Organization',
    source_type: 'lab',
    source_record_id: 'record:external-001',
    original_sanitized_filename: 'completed_result.csv',
    inspection_method: item.required_method,
    completion_status: 'completed',
    completed_at: GENERATED_AT,
    inspector_identity_ref: 'user:external-inspector',
    origin_reference: 'record:external-001',
    confidentiality_classification: 'internal',
    redaction_status: 'not_applicable',
    redacted_fields: [],
    source_overall_result: 'pass',
    notes: null,
  };
  const sourceBytes = Buffer.from(csv([sourceRow]));
  await writeFile(paths.source, sourceBytes);
  await writeFile(paths.metadata, canonicalBytes(submissionMetadata));

  const normalize = (overrides = {}) => normalizeInspectionResultFromPaths({
    projectRoot: ROOT,
    inspectionPlanPath: paths.plan,
    planReleaseRecordPath: paths.releaseRecord,
    sourcePath: paths.source,
    submissionMetadataPath: paths.metadata,
    adapterId: 'plan-result-csv-v1',
    generatedAt: GENERATED_AT,
    requireAuthoritativeLineage: true,
    ...overrides,
  });
  const normalized = await normalize();
  assert.equal(normalized.normalization.status, 'ready_for_quarantine_review');
  assert.equal(normalized.normalization.boundaries.inspection_evidence, false);
  assert.equal((await normalizeInspectionResultFromPaths({
    projectRoot: ROOT,
    inspectionPlanPath: paths.plan,
    planReleaseRecordPath: paths.releaseRecord,
    sourcePath: paths.source,
    submissionMetadataPath: paths.metadata,
    adapterId: 'plan-result-csv-v1',
    generatedAt: GENERATED_AT,
  })).normalization.status, 'ready_for_quarantine_review');

  await writeFile(paths.metadata, canonicalBytes({ ...submissionMetadata, part_identifier: 'PLATE-OTHER' }));
  await assert.rejects(normalize(), (error) => error?.code === 'conflicting_identity');
  await writeFile(paths.metadata, canonicalBytes({
    ...submissionMetadata,
    plan_release_record_sha256: '0'.repeat(64),
  }));
  await assert.rejects(normalize(), (error) => error?.code === 'digest_mismatch');
  await writeFile(paths.metadata, canonicalBytes(submissionMetadata));
  await assert.rejects(
    normalize({ afterSnapshot: async () => writeFile(paths.source, Buffer.from('changed-after-snapshot\n')) }),
    (error) => error?.code === 'stale_parent'
  );
  await writeFile(paths.source, sourceBytes);

  const mapping = normalized.normalization.envelope_mapping;
  const candidateEnvelope = {
    artifact_type: 'inspection_evidence_envelope',
    schema_version: '1.0',
    evidence_id: 'received-inspection-001',
    synthetic: false,
    lifecycle_state: 'quarantined',
    package: structuredClone(mapping.package),
    subject: structuredClone(mapping.subject),
    source: structuredClone(mapping.source),
    inspection: structuredClone(mapping.inspection),
    review: {
      reviewer_identity_ref: 'user:evidence-reviewer',
      reviewed_at: REVIEWED_AT,
      decision: 'approved_for_authorization',
      notes: null,
    },
    authorization: {
      status: 'pending',
      authorization_id: null,
      record_ref: null,
      record_sha256: null,
      authorized_by_ref: null,
      authorized_at: null,
      operation_scope: [],
    },
    measured_characteristics: structuredClone(mapping.measured_characteristics),
    specification_references: structuredClone(mapping.specification_references),
    provenance: {
      immutable: true,
      origin_reference: mapping.provenance.origin_reference,
      received_at: GENERATED_AT,
      custody_events: [{
        event_type: 'received',
        occurred_at: GENERATED_AT,
        actor_ref: 'user:evidence-receiver',
        source_sha256: mapping.provenance.source_sha256,
      }],
    },
    attachment: { requested_at: REVIEWED_AT, attached_at: null },
    confidentiality: {
      classification: mapping.confidentiality.classification,
      redaction_status: 'not_required',
      redacted_fields: structuredClone(mapping.confidentiality.redacted_fields),
    },
  };
  const lineageOptions = {
    requireAuthoritativeLineage: true,
    authoritativeIdentity: configSnapshot.identity,
  };
  assert.equal(validateInspectionEvidenceCandidateEnvelopeBinding(
    normalized.normalization,
    candidateEnvelope,
    lineageOptions
  ).ok, true);
  const candidateSemanticValidation = validateInspectionEvidenceEnvelopeSemantics(candidateEnvelope, {
    candidateSha256: normalized.normalization.source_snapshot.source_sha256,
    candidateSizeBytes: normalized.normalization.source_snapshot.source_size_bytes,
    candidateFilename: mapping.source.document.original_filename,
    candidateMediaType: mapping.source.document.media_type,
    packageSlug: configSnapshot.identity.package_slug,
    packageRevision: configSnapshot.identity.revision,
    authoritativePackageRevision: configSnapshot.identity.revision,
    authoritativeSubjectIdentifier: configSnapshot.identity.part_id,
    ...lineageOptions,
  });
  assert.equal(candidateSemanticValidation.ok, true, JSON.stringify({
    errors: candidateSemanticValidation.errors,
    markers: findNonGenuineStringMarkers(candidateEnvelope),
  }, null, 2));
  assert.equal(validateInspectionEvidenceCandidateEnvelopeBinding(
    normalized.normalization,
    candidateEnvelope,
    {
      requireAuthoritativeLineage: false,
      authoritativeIdentity: { ...configSnapshot.identity, part_id: 'IGNORED-WITHOUT-POLICY' },
    }
  ).ok, true, 'authoritative-looking input must not activate proof without the explicit boolean');
  const staleCandidate = structuredClone(candidateEnvelope);
  staleCandidate.source.document.sha256 = '0'.repeat(64);
  assert(errorCodes(validateInspectionEvidenceCandidateEnvelopeBinding(
    normalized.normalization,
    staleCandidate,
    lineageOptions
  )).includes('normalization_candidate_binding_mismatch'));
  const wrongRevisionCandidate = structuredClone(candidateEnvelope);
  wrongRevisionCandidate.package.revision = 'C';
  assert(errorCodes(validateInspectionEvidenceCandidateEnvelopeBinding(
    normalized.normalization,
    wrongRevisionCandidate,
    lineageOptions
  )).includes('conflicting_identity'));

  const candidateEnvelopeSha256 = sha256Json(candidateEnvelope);
  let awaitingRecord = {
    artifact_type: 'inspection_evidence_onboarding_record',
    schema_version: '1.0',
    record_id: 'received-onboarding-record-001',
    state: 'quarantined',
    package_slug: configSnapshot.identity.package_slug,
    package_revision: configSnapshot.identity.revision,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
    candidate: {
      original_filename: candidateEnvelope.source.document.original_filename,
      quarantine_ref: 'local/inspection-evidence-quarantine/plate-with-holes/source.csv',
      media_type: candidateEnvelope.source.document.media_type,
      size_bytes: candidateEnvelope.source.document.size_bytes,
      sha256: candidateEnvelope.source.document.sha256,
      classification: 'candidate',
      classification_reasons: ['received_external_record'],
    },
    envelope: {
      quarantine_ref: 'local/inspection-evidence-quarantine/plate-with-holes/candidate-envelope.json',
      sha256: candidateEnvelopeSha256,
      structurally_valid: false,
      semantically_valid: false,
      evidence_id: null,
    },
    authorization: {
      record_ref: null,
      record_sha256: null,
      authorization_id: null,
      validated_record_sha256: null,
    },
    attachment: { record_ref: null, record_sha256: null, attached_at: null },
    transitions: [
      { from: null, to: 'discovered', at: GENERATED_AT, actor_ref: 'user:evidence-receiver', reason_code: 'candidate_received', candidate_sha256: candidateEnvelope.source.document.sha256 },
      { from: 'discovered', to: 'quarantined', at: GENERATED_AT, actor_ref: 'user:evidence-receiver', reason_code: 'content_addressed_quarantine_created', candidate_sha256: candidateEnvelope.source.document.sha256 },
    ],
  };
  awaitingRecord = appendInspectionEvidenceTransition(awaitingRecord, {
    to: 'structurally_valid', at: REVIEWED_AT, actorRef: 'user:evidence-reviewer', reasonCode: 'envelope_schema_valid',
  });
  awaitingRecord.envelope.structurally_valid = true;
  awaitingRecord.envelope.evidence_id = candidateEnvelope.evidence_id;
  awaitingRecord = appendInspectionEvidenceTransition(awaitingRecord, {
    to: 'semantically_valid', at: REVIEWED_AT, actorRef: 'user:evidence-reviewer', reasonCode: 'envelope_semantics_valid',
  });
  awaitingRecord.envelope.semantically_valid = true;
  awaitingRecord = appendInspectionEvidenceTransition(awaitingRecord, {
    to: 'awaiting_authorization', at: AWAITING_AT, actorRef: 'user:evidence-reviewer', reasonCode: 'explicit_attachment_authorization_required',
  });
  const validatedRecordSha256 = sha256Json(awaitingRecord);
  const attachmentAuthorization = {
    artifact_type: 'inspection_evidence_attachment_authorization',
    schema_version: '1.0',
    authorization_id: 'attachment-auth:received-001',
    decision: 'authorized',
    authorized_operation: 'attach',
    exception_requested: false,
    package_slug: configSnapshot.identity.package_slug,
    package_revision: configSnapshot.identity.revision,
    evidence_id: candidateEnvelope.evidence_id,
    source_document_sha256: candidateEnvelope.source.document.sha256,
    candidate_envelope_sha256: candidateEnvelopeSha256,
    validated_record_sha256: validatedRecordSha256,
    reviewer: { identity_ref: candidateEnvelope.review.reviewer_identity_ref, decision: 'approved', reviewed_at: REVIEWED_AT },
    authorizer: { identity_ref: 'user:evidence-authorizer' },
    authorized_at: AUTHORIZED_AT,
    confidentiality_review: {
      decision: 'approved',
      reviewed_by_ref: 'user:privacy-reviewer',
      reviewed_at: CONFIDENTIALITY_AT,
      private_paths_removed: true,
      secrets_removed: true,
      redaction_approved: true,
    },
  };
  assert.equal(validateInspectionEvidenceAuthorizationBinding(
    attachmentAuthorization,
    awaitingRecord,
    candidateEnvelope,
    { validatedRecordSha256, ...lineageOptions }
  ).ok, true);
  const staleAttachmentAuthorization = {
    ...attachmentAuthorization,
    candidate_envelope_sha256: '0'.repeat(64),
  };
  assert(errorCodes(validateInspectionEvidenceAuthorizationBinding(
    staleAttachmentAuthorization,
    awaitingRecord,
    candidateEnvelope,
    { validatedRecordSha256, ...lineageOptions }
  )).includes('authorization_binding_mismatch'));

  const attachmentAuthorizationSha256 = sha256Json(attachmentAuthorization);
  let authorizedRecord = appendInspectionEvidenceTransition(awaitingRecord, {
    to: 'authorized', at: AUTHORIZED_AT, actorRef: attachmentAuthorization.authorizer.identity_ref, reasonCode: 'checksum_bound_human_authorization_verified',
  });
  authorizedRecord.authorization = {
    record_ref: 'local/inspection-evidence-quarantine/plate-with-holes/attachment-authorization.json',
    record_sha256: attachmentAuthorizationSha256,
    authorization_id: attachmentAuthorization.authorization_id,
    validated_record_sha256: validatedRecordSha256,
  };
  const authorizedOnboardingRecordSha256 = sha256Json(authorizedRecord);
  const authorizationRef = 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json';
  const attachedEnvelope = buildAttachedInspectionEvidenceEnvelope({
    candidateEnvelope,
    authorization: attachmentAuthorization,
    authorizationRef,
    authorizationSha256: attachmentAuthorizationSha256,
    attachedAt: ATTACHED_AT,
    sourceSha256: candidateEnvelope.source.document.sha256,
    quarantineTransition: authorizedRecord.transitions.find((transition) => transition.to === 'quarantined'),
  });
  const attachedEnvelopeSha256 = sha256Json(attachedEnvelope);
  const readinessSha256 = '1'.repeat(64);
  const readinessMarkdownSha256 = '2'.repeat(64);
  const receipt = {
    artifact_type: 'inspection_evidence_attachment_record',
    schema_version: '1.0',
    immutable: true,
    attachment_id: 'attachment:received-001',
    evidence_id: candidateEnvelope.evidence_id,
    attached_at: ATTACHED_AT,
    package_slug: configSnapshot.identity.package_slug,
    package_revision: configSnapshot.identity.revision,
    source_document_sha256: candidateEnvelope.source.document.sha256,
    candidate_envelope_sha256: candidateEnvelopeSha256,
    authorized_onboarding_record_sha256: authorizedOnboardingRecordSha256,
    authorization: {
      authorization_id: attachmentAuthorization.authorization_id,
      record_ref: authorizationRef,
      record_sha256: attachmentAuthorizationSha256,
      source_record_sha256: attachmentAuthorizationSha256,
      validated_record_sha256: validatedRecordSha256,
      authorized_by_ref: attachmentAuthorization.authorizer.identity_ref,
      authorized_at: AUTHORIZED_AT,
    },
    resulting_canonical_artifacts: [
      { role: 'authorized_candidate_envelope', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence_candidate_authorized.json', sha256: candidateEnvelopeSha256 },
      { role: 'evidence_envelope', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence.json', sha256: attachedEnvelopeSha256 },
      { role: 'attachment_authorization', path: authorizationRef, sha256: attachmentAuthorizationSha256 },
      { role: 'authorized_onboarding_record', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence_onboarding.json', sha256: authorizedOnboardingRecordSha256 },
    ],
    readiness: {
      regenerated: false,
      before_sha256: readinessSha256,
      after_sha256: readinessSha256,
      before_markdown_sha256: readinessMarkdownSha256,
      after_markdown_sha256: readinessMarkdownSha256,
    },
    supersedes_attachment_id: null,
  };
  const chainOptions = {
    candidateEnvelope,
    envelope: attachedEnvelope,
    authorization: attachmentAuthorization,
    receipt,
    authorizedOnboardingRecord: authorizedRecord,
    authoritativePackageRevision: configSnapshot.identity.revision,
    authoritativeSubjectIdentifier: configSnapshot.identity.part_id,
    candidateEnvelopeSha256,
    envelopeSha256: attachedEnvelopeSha256,
    authorizationSha256: attachmentAuthorizationSha256,
    authorizedOnboardingRecordSha256,
    ...lineageOptions,
  };
  const chainValidation = validateCanonicalInspectionEvidenceChain(chainOptions);
  assert.equal(chainValidation.ok, true, JSON.stringify(chainValidation.errors, null, 2));
  const changedReadinessReceipt = structuredClone(receipt);
  changedReadinessReceipt.readiness.after_sha256 = '3'.repeat(64);
  assert(errorCodes(validateCanonicalInspectionEvidenceChain({
    ...chainOptions,
    receipt: changedReadinessReceipt,
  })).includes('readiness_changed_during_attachment'));

  const attachmentRecordRef = 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json';
  const attachmentRecordSha256 = sha256Json(receipt);
  const reviewPackSha256 = sha256(await readFile(reviewPath));
  const readinessOutputRef = 'docs/examples/plate-with-holes/readiness/readiness_report.json';
  const readinessAuthorization = {
    artifact_type: 'inspection_evidence_readiness_authorization',
    schema_version: '1.0',
    authorization_id: 'readiness-auth:received-001',
    decision: 'authorized',
    authorized_operation: 'regenerate_readiness',
    exception_requested: false,
    package_slug: configSnapshot.identity.package_slug,
    package_revision: configSnapshot.identity.revision,
    attachment_record_ref: attachmentRecordRef,
    attachment_record_sha256: attachmentRecordSha256,
    review_pack_sha256: reviewPackSha256,
    current_readiness_sha256: readinessSha256,
    current_readiness_markdown_sha256: readinessMarkdownSha256,
    readiness_output_ref: readinessOutputRef,
    authorized_by_ref: 'user:readiness-authorizer',
    authorized_at: READINESS_AUTHORIZED_AT,
  };
  const readinessBindingOptions = {
    attachmentRecord: receipt,
    attachmentRecordRef,
    attachmentRecordSha256,
    reviewPackSha256,
    currentReadinessSha256: readinessSha256,
    currentReadinessMarkdownSha256: readinessMarkdownSha256,
    readinessOutputRef,
    reviewPackIdentity: {
      package_slug: configSnapshot.identity.package_slug,
      part_id: configSnapshot.identity.part_id,
      revision: configSnapshot.identity.revision,
    },
    ...lineageOptions,
  };
  assert.equal(validateInspectionEvidenceReadinessAuthorizationBinding(
    readinessAuthorization,
    readinessBindingOptions
  ).ok, true);
  const staleReadinessAuthorization = {
    ...readinessAuthorization,
    attachment_record_sha256: '0'.repeat(64),
  };
  assert(errorCodes(validateInspectionEvidenceReadinessAuthorizationBinding(
    staleReadinessAuthorization,
    readinessBindingOptions
  )).includes('readiness_authorization_binding_mismatch'));

  const stage5bProofOut = join(temp, 'stage5b-proof-must-not-exist');
  await assert.rejects(
    () => writeStage5bEvidenceAttachmentControlManifest({
      projectRoot: ROOT,
      reviewManifestPath: reviewPath,
      authorizationRecord: attachmentAuthorization,
      outDir: portable(stage5bProofOut),
      requireAuthoritativeLineage: true,
    }),
    (error) => error?.code === 'unsupported_legacy'
  );
  await assert.rejects(() => access(stage5bProofOut), (error) => error?.code === 'ENOENT');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('revision-lineage-downstream-continuity.test.js: ok');
