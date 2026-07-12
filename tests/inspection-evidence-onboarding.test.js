import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  appendInspectionEvidenceTransition,
  buildAttachedInspectionEvidenceEnvelope,
  findNonGenuineStringMarkers,
  isParseableTimestamp,
  parseInspectionEvidenceJsonBytes,
  serializeCanonicalJson,
  sha256Bytes,
  sha256Json,
  summarizeInspectionEvidenceResults,
  validateInspectionEvidenceAttachmentRecordSchema,
  validateInspectionEvidenceAuthorizationBinding,
  validateInspectionEvidenceAuthorizationSchema,
  validateInspectionEvidenceControlMaterial,
  validateInspectionEvidenceEnvelopeSchema,
  validateInspectionEvidenceEnvelopeSemantics,
  validateInspectionEvidenceReadinessAuthorizationSchema,
  validateInspectionEvidenceStateHistory,
  validateAttachedInspectionEvidenceEnvelopeTransformation,
} from '../lib/inspection-evidence-onboarding.js';
import { withCanonicalPackageMutationLock } from '../lib/canonical-package-mutation-lock.js';
import { writeCanonicalReadinessArtifacts } from '../src/workflows/canonical-readiness-builders.js';
import { writeReadinessArtifacts } from '../src/workflows/readiness-report-workflow.js';
import {
  assertInspectionEvidenceAttachmentIdentity,
  assertInspectionEvidenceResultBinding,
  assertInspectionEvidenceReadinessAuthorizationTiming,
  assertRegularReadinessPackHasNoInspectionEvidenceClaim,
  classifyInspectionEvidenceCandidate,
  inspectExistingInspectionEvidenceAttachment,
  quarantineInspectionEvidenceCandidate,
  readAuthoritativeCanonicalPackageRevision,
  validateInspectionEvidenceSourceContainer,
  validateQuarantinedInspectionEvidence,
  verifyCanonicalInspectionEvidenceAttachment,
  verifyInspectionEvidenceReadinessAuthorization,
} from '../src/services/inspection-evidence-intake/inspection-evidence-onboarding-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/inspection-evidence-onboarding');
const FIXTURE_SOURCE = join(FIXTURE_DIR, 'synthetic-source.csv');
const FIXTURE_ENVELOPE = join(FIXTURE_DIR, 'synthetic-envelope.json');
const CANONICAL_SLUGS = [
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
  'hinge-block',
];

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

function buildStateRecord() {
  const candidateSha = 'a'.repeat(64);
  const at = '2026-07-01T00:00:00Z';
  return {
    artifact_type: 'inspection_evidence_onboarding_record',
    schema_version: '1.0',
    record_id: 'synthetic-state-machine-record',
    state: 'quarantined',
    package_slug: 'plate-with-holes',
    package_revision: 'A',
    created_at: at,
    updated_at: at,
    candidate: {
      original_filename: 'synthetic-source.csv',
      quarantine_ref: 'local/inspection-evidence-quarantine/plate-with-holes/source.csv',
      media_type: 'text/csv',
      size_bytes: 61,
      sha256: candidateSha,
      classification: 'synthetic_fixture',
      classification_reasons: ['synthetic_fixture_content_marker'],
    },
    envelope: {
      quarantine_ref: 'local/inspection-evidence-quarantine/plate-with-holes/candidate-envelope.json',
      sha256: 'b'.repeat(64),
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
    attachment: {
      record_ref: null,
      record_sha256: null,
      attached_at: null,
    },
    transitions: [
      { from: null, to: 'discovered', at, actor_ref: 'fixture.actor', reason_code: 'candidate_received', candidate_sha256: candidateSha },
      { from: 'discovered', to: 'quarantined', at, actor_ref: 'fixture.actor', reason_code: 'content_addressed_quarantine_created', candidate_sha256: candidateSha },
    ],
  };
}

const readinessBefore = new Map();
for (const slug of CANONICAL_SLUGS) {
  const path = join(ROOT, 'docs/examples', slug, 'readiness/readiness_report.json');
  const bytes = await readFile(path);
  readinessBefore.set(slug, hash(bytes));
  const report = JSON.parse(bytes);
  assert.equal(report.readiness_summary.status, 'needs_more_evidence');
  assert.equal(report.readiness_summary.gate_decision, 'hold_for_evidence_completion');
  const missing = new Set([
    ...(report.process_plan?.summary?.missing_inputs || []),
    ...(report.quality_risk?.summary?.missing_inputs || []),
  ]);
  assert.equal(missing.has('inspection_evidence'), true);
}
assert.equal(await readAuthoritativeCanonicalPackageRevision(ROOT, 'quality-pass-bracket'), null);
assert.equal(await readAuthoritativeCanonicalPackageRevision(ROOT, 'plate-with-holes'), 'A');
assert.equal(await readAuthoritativeCanonicalPackageRevision(ROOT, 'motor-mount'), 'A');
assert.equal(await readAuthoritativeCanonicalPackageRevision(ROOT, 'controller-housing-eol'), 'C');
assert.equal(await readAuthoritativeCanonicalPackageRevision(ROOT, 'hinge-block'), 'A');

// The checked-in test envelope is structurally representative but has a mandatory
// synthetic marker, so it can never pass production semantic validation.
const syntheticEnvelopeBytes = await readFile(FIXTURE_ENVELOPE);
const syntheticEnvelope = JSON.parse(syntheticEnvelopeBytes);
assert.deepEqual(validateInspectionEvidenceEnvelopeSchema(syntheticEnvelope), { ok: true, errors: [] });
const syntheticSemantic = validateInspectionEvidenceEnvelopeSemantics(syntheticEnvelope, {
  candidateSha256: syntheticEnvelope.source.document.sha256,
  candidateSizeBytes: syntheticEnvelope.source.document.size_bytes,
  candidateFilename: syntheticEnvelope.source.document.original_filename,
  candidateMediaType: syntheticEnvelope.source.document.media_type,
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: 'A',
  authoritativeSubjectIdentifier: 'pcb_mount_plate',
});
assert.equal(syntheticSemantic.ok, false);
assert.equal(errorCodes(syntheticSemantic).includes('synthetic_fixture_forbidden'), true);
assert.deepEqual(findNonGenuineStringMarkers({ synthetic: false, exception_requested: false }), []);
assert.equal(isParseableTimestamp('2026-07-01T00:00:00Z'), true);
assert.equal(isParseableTimestamp('2026-07-01'), false);
assert.equal(isParseableTimestamp('2026-02-30T00:00:00Z'), false);
assert.equal(isParseableTimestamp(0), false);
assert.equal(assertInspectionEvidenceReadinessAuthorizationTiming({
  authorizedAt: '2026-07-01T01:00:00Z',
  attachedAt: '2026-07-01T00:00:00Z',
  now: '2026-07-01T01:01:00Z',
}), true);
assert.throws(
  () => assertInspectionEvidenceReadinessAuthorizationTiming({
    authorizedAt: '2027-07-01T01:00:00Z',
    attachedAt: '2026-07-01T00:00:00Z',
    now: '2026-07-01T01:01:00Z',
  }),
  (error) => error.code === 'readiness_authorization_from_future'
);
assert.doesNotThrow(() => validateInspectionEvidenceEnvelopeSchema({ provenance: { custody_events: {} } }));
assert.equal(validateInspectionEvidenceEnvelopeSchema({ provenance: { custody_events: {} } }).ok, false);
assert.doesNotThrow(() => validateInspectionEvidenceStateHistory({ transitions: {} }));

for (const unsafeValue of [
  'Authorization: Bearer abc123',
  '{"api_key":"abc123"}',
  'https://user:password@supplier.example/report?X-Amz-Signature=TOPSECRET',
  'https://supplier.example/report?access_token=TOPSECRET',
  '/etc/inspection/private.json',
  'file:///tmp/private-report.json',
]) {
  const privacy = validateInspectionEvidenceControlMaterial({ note: unsafeValue });
  assert.equal(privacy.ok, false, `unsafe control material must be rejected: ${unsafeValue}`);
}

const missingInspector = clone(syntheticEnvelope);
delete missingInspector.inspection.inspector_identity_ref;
assert.equal(validateInspectionEvidenceEnvelopeSchema(missingInspector).ok, false);
const missingReviewer = clone(syntheticEnvelope);
delete missingReviewer.review.reviewer_identity_ref;
assert.equal(validateInspectionEvidenceEnvelopeSchema(missingReviewer).ok, false);
const incomplete = clone(syntheticEnvelope);
incomplete.inspection.status = 'in_progress';
assert.equal(validateInspectionEvidenceEnvelopeSchema(incomplete).ok, false);
const unsafeConfidentiality = clone(syntheticEnvelope);
unsafeConfidentiality.confidentiality = {
  classification: 'restricted', redaction_status: 'not_required', redacted_fields: [],
};
assert.equal(validateInspectionEvidenceEnvelopeSchema(unsafeConfidentiality).ok, false);
const packageMismatch = validateInspectionEvidenceEnvelopeSemantics(syntheticEnvelope, {
  candidateSha256: syntheticEnvelope.source.document.sha256,
  packageSlug: 'motor-mount',
  packageRevision: 'B',
  authoritativePackageRevision: 'C',
});
assert.equal(errorCodes(packageMismatch).includes('package_mismatch'), true);
assert.equal(errorCodes(packageMismatch).includes('revision_mismatch'), true);
assert.equal(errorCodes(packageMismatch).includes('authoritative_revision_mismatch'), true);
const missingAuthoritativeRevision = validateInspectionEvidenceEnvelopeSemantics(syntheticEnvelope, {
  candidateSha256: syntheticEnvelope.source.document.sha256,
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: null,
});
assert.equal(errorCodes(missingAuthoritativeRevision).includes('authoritative_revision_missing'), true);
const changedChecksum = validateInspectionEvidenceEnvelopeSemantics(syntheticEnvelope, {
  candidateSha256: 'f'.repeat(64),
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: 'A',
});
assert.equal(errorCodes(changedChecksum).includes('source_checksum_mismatch'), true);
const mismatchedSubject = clone(syntheticEnvelope);
mismatchedSubject.subject.identifier = 'totally-different-part';
const subjectMismatch = validateInspectionEvidenceEnvelopeSemantics(mismatchedSubject, {
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: 'A',
  authoritativeSubjectIdentifier: 'pcb_mount_plate',
});
assert.equal(errorCodes(subjectMismatch).includes('subject_identifier_mismatch'), true);
const unmappedDrawingSubject = clone(syntheticEnvelope);
unmappedDrawingSubject.subject.identifier_type = 'drawing';
assert.equal(errorCodes(validateInspectionEvidenceEnvelopeSemantics(unmappedDrawingSubject, {
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: 'A',
  authoritativeSubjectIdentifier: 'pcb_mount_plate',
})).includes('subject_identifier_type_unmapped'), true);
const inconsistentResult = clone(syntheticEnvelope);
inconsistentResult.measured_characteristics[0].result = 'fail';
assert.equal(summarizeInspectionEvidenceResults(inconsistentResult).readiness_disposition, 'hold_nonconforming');
assert.equal(assertInspectionEvidenceResultBinding({
  inspection_result: summarizeInspectionEvidenceResults(inconsistentResult),
}, inconsistentResult), true);
assert.throws(
  () => assertInspectionEvidenceResultBinding({
    inspection_result: {
      ...summarizeInspectionEvidenceResults(inconsistentResult),
      readiness_disposition: 'conforming',
    },
  }, inconsistentResult),
  (error) => error.code === 'review_pack_inspection_result_mismatch'
);
assert.equal(errorCodes(validateInspectionEvidenceEnvelopeSemantics(inconsistentResult, {
  packageSlug: 'plate-with-holes',
  packageRevision: 'A',
  authoritativePackageRevision: 'A',
  authoritativeSubjectIdentifier: 'pcb_mount_plate',
})).includes('inspection_result_inconsistent'), true);

// State transitions cannot skip quarantine, validation, or authorization.
let stateRecord = buildStateRecord();
assert.throws(
  () => appendInspectionEvidenceTransition(stateRecord, {
    to: 'attached',
    at: '2026-07-01T01:00:00Z',
    actorRef: 'fixture.actor',
    reasonCode: 'illegal_skip',
  }),
  /not allowed/
);
stateRecord = appendInspectionEvidenceTransition(stateRecord, {
  to: 'structurally_valid', at: '2026-07-01T01:00:00Z', actorRef: 'fixture.actor', reasonCode: 'envelope_schema_valid',
});
stateRecord.envelope.structurally_valid = true;
stateRecord.envelope.evidence_id = syntheticEnvelope.evidence_id;
stateRecord = appendInspectionEvidenceTransition(stateRecord, {
  to: 'semantically_valid', at: '2026-07-01T01:01:00Z', actorRef: 'fixture.actor', reasonCode: 'synthetic_state_machine_exercise',
});
stateRecord.envelope.semantically_valid = true;
stateRecord = appendInspectionEvidenceTransition(stateRecord, {
  to: 'awaiting_authorization', at: '2026-07-01T01:02:00Z', actorRef: 'fixture.actor', reasonCode: 'explicit_attachment_authorization_required',
});
stateRecord = appendInspectionEvidenceTransition(stateRecord, {
  to: 'authorized', at: '2026-07-01T01:03:00Z', actorRef: 'fixture.authorizer', reasonCode: 'checksum_bound_human_authorization_verified',
});
stateRecord.authorization = {
  record_ref: 'local/inspection-evidence-quarantine/plate-with-holes/attachment-authorization.json',
  record_sha256: 'c'.repeat(64),
  authorization_id: 'synthetic-fixture-authorization',
  validated_record_sha256: 'd'.repeat(64),
};
stateRecord = appendInspectionEvidenceTransition(stateRecord, {
  to: 'attached', at: '2026-07-01T01:04:00Z', actorRef: 'fixture.authorizer', reasonCode: 'immutable_attachment_record_created',
});
stateRecord.attachment = {
  record_ref: 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json',
  record_sha256: 'e'.repeat(64),
  attached_at: '2026-07-01T01:04:00Z',
};
const promotedSyntheticState = validateInspectionEvidenceStateHistory(stateRecord);
assert.equal(promotedSyntheticState.ok, false);
assert.equal(errorCodes(promotedSyntheticState).includes('rejected_candidate_promoted'), true);
stateRecord.transitions[4].from = 'quarantined';
assert.equal(validateInspectionEvidenceStateHistory(stateRecord).ok, false);
assert.throws(
  () => appendInspectionEvidenceTransition(buildStateRecord(), {
    to: 'structurally_valid',
    at: '2026-07-01T01:00:00Z',
    actorRef: '/Users/alice',
    reasonCode: 'envelope_schema_valid',
  }),
  (error) => error.code === 'invalid_transition_actor'
);

// Malformed source containers fail their parser without being normalized or inferred.
assert.deepEqual(
  validateInspectionEvidenceSourceContainer('application/json', Buffer.from('{"synthetic_fixture":true,')),
  { ok: false, errors: ['malformed_source_json'] }
);
const malformedUtf8Json = Buffer.concat([
  Buffer.from('{"supplier":"'),
  Buffer.from([0xff]),
  Buffer.from('"}'),
]);
assert.deepEqual(
  validateInspectionEvidenceSourceContainer('application/json', malformedUtf8Json),
  { ok: false, errors: ['malformed_source_json'] }
);
assert.throws(
  () => parseInspectionEvidenceJsonBytes(Buffer.from('{"decision":"rejected","decision":"authorized"}\n')),
  (error) => error.code === 'duplicate_json_key'
);
assert.throws(
  () => parseInspectionEvidenceJsonBytes(Buffer.from('{"synthetic":true,"synthetic":false}\n')),
  (error) => error.code === 'duplicate_json_key'
);
assert.throws(
  () => parseInspectionEvidenceJsonBytes(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('{"decision":"authorized"}\n'),
  ])),
  (error) => error.code === 'noncanonical_inspection_evidence_json'
);
assert.deepEqual(
  validateInspectionEvidenceSourceContainer('application/json', Buffer.from('{"synthetic":true,"synthetic":false}\n')),
  { ok: false, errors: ['malformed_source_json'] }
);
const deeplyNestedJson = `${'{"nested":'.repeat(70)}true${'}'.repeat(70)}`;
assert.equal(
  validateInspectionEvidenceSourceContainer('application/json', Buffer.from(deeplyNestedJson)).errors.includes('source_json_depth_limit_exceeded'),
  true
);
assert.equal(
  validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('synthetic_fixture,value\n"unterminated,1\n')).errors.includes('csv_unterminated_quote'),
  true
);
assert.equal(
  validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('synthetic_fixture,value\nfixture,1,extra\n')).errors.includes('csv_inconsistent_row_width'),
  true
);
assert.equal(
  validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('a,b\n"x"junk,y\n')).errors.includes('csv_characters_after_closing_quote'),
  true
);
assert.equal(
  validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('a,b\r"x",y\n')).errors.includes('csv_stray_carriage_return'),
  true
);
const malformedUtf8Csv = Buffer.concat([
  Buffer.from('a,b\n'),
  Buffer.from([0xff]),
  Buffer.from(',1\n'),
]);
assert.deepEqual(
  validateInspectionEvidenceSourceContainer('text/csv', malformedUtf8Csv),
  { ok: false, errors: ['malformed_source_csv_encoding'] }
);
assert.deepEqual(
  validateInspectionEvidenceSourceContainer('application/xml', Buffer.from('<synthetic_fixture>')),
  { ok: false, errors: ['unsupported_source_format'] }
);

const qifBytes = await readFile(join(ROOT, 'docs/examples/plate-with-holes/inspection/qif_lite_focused_checks.xml'));
const renamedQif = classifyInspectionEvidenceCandidate({
  filename: 'supplier-report.xml',
  sourcePathText: '/safe/inbox/supplier-report.xml',
  bytes: qifBytes,
});
assert.equal(renamedQif.classification, 'generated_or_control');
assert.equal(renamedQif.reasons.includes('generated_qif_lite_control_xml'), true);

const fixtureSourceBytes = await readFile(FIXTURE_SOURCE);
const renamedFixture = classifyInspectionEvidenceCandidate({
  filename: 'supplier-final.csv',
  sourcePathText: '/safe/inbox/supplier-final.csv',
  bytes: fixtureSourceBytes,
});
assert.equal(renamedFixture.classification, 'synthetic_fixture');
for (const bytes of [
  Buffer.from('{"synthetic_fixture":true}'),
  Buffer.from(`${' '.repeat(600 * 1024)}{"synthetic_fixture":true}`),
]) {
  assert.equal(classifyInspectionEvidenceCandidate({
    filename: 'supplier-final.json',
    sourcePathText: '/safe/inbox/supplier-final.json',
    bytes,
  }).classification, 'synthetic_fixture');
}
assert.equal(classifyInspectionEvidenceCandidate({
  filename: 'supplier-final.json',
  sourcePathText: '/safe/inbox/supplier-final.json',
  bytes: Buffer.from('{"generated":true}'),
}).classification, 'generated_or_control');
assert.equal(classifyInspectionEvidenceCandidate({
  filename: 'ci-result.json',
  sourcePathText: '/safe/inbox/ci-result.json',
  bytes: Buffer.from('{"workflow_run":{"conclusion":"success"}}'),
}).classification, 'generated_or_control');
for (const filename of ['part.step', 'part.stl', 'part.brep', 'part.fcstd', 'drawing.svg']) {
  assert.equal(classifyInspectionEvidenceCandidate({
    filename,
    sourcePathText: `/safe/inbox/${filename}`,
    bytes: Buffer.from('renamed repository artifact'),
  }).classification, 'generated_or_control');
}
const copiedEvidenceGraph = await readFile(join(ROOT, 'docs/examples/plate-with-holes/evidence/evidence_graph.json'));
assert.equal(classifyInspectionEvidenceCandidate({
  filename: 'supplier-final.json',
  sourcePathText: '/safe/inbox/supplier-final.json',
  bytes: copiedEvidenceGraph,
}).classification, 'generated_or_control');
const demoInspectionRecordsPath = join(ROOT, 'configs/examples/manufacturing/bracket_inspection_records.json');
assert.equal(classifyInspectionEvidenceCandidate({
  filename: 'bracket_inspection_records.json',
  sourcePathText: demoInspectionRecordsPath,
  bytes: await readFile(demoInspectionRecordsPath),
}).classification, 'generated_or_control');
for (const relativePath of [
  'docs/examples/plate-with-holes/drawing/pcb_mount_plate_feature_catalog.json',
  'docs/examples/plate-with-holes/quality/pcb_mount_plate_drawing_qa.json',
  'docs/examples/plate-with-holes/standard-docs/control_plan_draft.csv',
  'docs/examples/plate-with-holes/standard-docs/pfmea_seed.csv',
  'docs/examples/plate-with-holes/standard-docs/inspection_checksheet_draft.csv',
  'docs/examples/infotainment-display-bracket/review.json',
  'docs/examples/infotainment-display-bracket/stabilization-comparison.json',
  'docs/examples/controller-housing-eol/standard-docs-korea/standard_docs_manifest.json',
]) {
  const bytes = await readFile(join(ROOT, relativePath));
  const extension = relativePath.endsWith('.csv') ? '.csv' : '.json';
  assert.equal(classifyInspectionEvidenceCandidate({
    filename: `renamed-supplier-record${extension}`,
    sourcePathText: `/safe/inbox/renamed-supplier-record${extension}`,
    bytes,
  }).classification, 'generated_or_control', `${relativePath} must remain generated/control after rename`);
}
assert.equal(classifyInspectionEvidenceCandidate({
  filename: 'supplier-final.pdf',
  sourcePathText: '/safe/inbox/supplier-final.pdf',
  bytes: Buffer.from('%PDF-1.7\n%%EOF\n'),
}).classification, 'unsupported_format');

// Quarantine is the first and only mutation for generated/control/synthetic input.
const temp = await mkdtemp(join(tmpdir(), 'fcad-inspection-evidence-onboarding-'));
const cleanupDirs = new Set();
try {
  const copiedQif = join(temp, 'renamed-supplier-report.xml');
  const copiedFixture = join(temp, 'renamed-supplier-final.csv');
  await copyFile(join(ROOT, 'docs/examples/plate-with-holes/inspection/qif_lite_focused_checks.xml'), copiedQif);
  await copyFile(FIXTURE_SOURCE, copiedFixture);
  const copiedLegacyFixture = join(temp, 'renamed-legacy-supplier-record.csv');
  await copyFile(join(ROOT, 'tests/fixtures/inspection_mixed_units.csv'), copiedLegacyFixture);
  assert.equal(classifyInspectionEvidenceCandidate({
    filename: 'renamed-legacy-supplier-record.csv',
    sourcePathText: copiedLegacyFixture,
    bytes: await readFile(copiedLegacyFixture),
  }).classification, 'candidate', 'legacy fixture must be rejected by repository fingerprint, not trusted by rename');
  const copiedDemoInspectionRecords = join(temp, 'renamed-demo-supplier-record.json');
  await copyFile(demoInspectionRecordsPath, copiedDemoInspectionRecords);
  const candidates = [
    copiedQif,
    join(ROOT, 'docs/examples/plate-with-holes/cad/pcb_mount_plate.step'),
    join(ROOT, 'docs/examples/plate-with-holes/drawing/pcb_mount_plate_drawing.svg'),
    join(ROOT, 'docs/examples/plate-with-holes/evidence/evidence_graph.json'),
    join(ROOT, '.github/workflows/automation-ci.yml'),
    FIXTURE_SOURCE,
    copiedFixture,
    copiedLegacyFixture,
    copiedDemoInspectionRecords,
  ];
  let fingerprintRejectedRecordPath = null;
  for (const candidatePath of candidates) {
    const result = await quarantineInspectionEvidenceCandidate({
      projectRoot: ROOT,
      candidatePath,
      envelopePath: FIXTURE_ENVELOPE,
      packageSlug: 'plate-with-holes',
      packageRevision: 'A',
      actorRef: 'test.fixture.receiver',
      timestamp: '2026-07-01T03:00:00Z',
    });
    cleanupDirs.add(dirname(result.recordPath));
    assert.equal(result.record.state, 'rejected');
    assert.notEqual(result.record.candidate.classification, 'candidate');
    if (candidatePath === copiedLegacyFixture) fingerprintRejectedRecordPath = result.recordPath;
  }
  await assert.rejects(
    () => validateQuarantinedInspectionEvidence({
      projectRoot: ROOT,
      recordPath: fingerprintRejectedRecordPath,
      actorRef: 'test.fixture.reviewer',
    }),
    (error) => error.code === 'candidate_already_rejected'
  );

  const localInbox = join(ROOT, 'local/stage5b-candidate-evidence-inbox/plate-with-holes');
  await mkdir(localInbox, { recursive: true });
  const opaqueInboxCandidate = join(localInbox, 'opaque-untrusted-container.json');
  await writeFile(opaqueInboxCandidate, '{"opaque_container_probe":"untrusted"}\n');
  const opaqueInboxResult = await quarantineInspectionEvidenceCandidate({
    projectRoot: ROOT,
    candidatePath: opaqueInboxCandidate,
    envelopePath: FIXTURE_ENVELOPE,
    packageSlug: 'plate-with-holes',
    packageRevision: 'A',
    actorRef: 'test.fixture.receiver',
    timestamp: '2026-07-01T03:00:00Z',
  });
  cleanupDirs.add(dirname(opaqueInboxResult.recordPath));
  assert.equal(opaqueInboxResult.record.state, 'quarantined');
  assert.equal(opaqueInboxResult.record.candidate.classification, 'candidate');
  await rm(opaqueInboxCandidate);

  const malformedEnvelopeSource = join(temp, 'received-characteristics.csv');
  const malformedEnvelopePath = join(temp, 'received-envelope.json');
  await writeFile(malformedEnvelopeSource, 'characteristic,value\nprobe,1\n');
  await writeFile(malformedEnvelopePath, Buffer.concat([
    Buffer.from('{"artifact_type":"inspection_evidence_envelope","source":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]));
  const malformedEnvelopeResult = await quarantineInspectionEvidenceCandidate({
    projectRoot: ROOT,
    candidatePath: malformedEnvelopeSource,
    envelopePath: malformedEnvelopePath,
    packageSlug: 'plate-with-holes',
    packageRevision: 'A',
    actorRef: 'test.receiver',
    timestamp: '2026-07-01T03:00:00Z',
  });
  cleanupDirs.add(dirname(malformedEnvelopeResult.recordPath));
  assert.equal(malformedEnvelopeResult.record.state, 'quarantined');
  await assert.rejects(
    () => validateQuarantinedInspectionEvidence({
      projectRoot: ROOT,
      recordPath: malformedEnvelopeResult.recordPath,
      actorRef: 'test.reviewer',
      timestamp: '2026-07-01T03:01:00Z',
    }),
    (error) => error.code === 'malformed_envelope_json'
  );

  const fixtureResult = await quarantineInspectionEvidenceCandidate({
    projectRoot: ROOT,
    candidatePath: FIXTURE_SOURCE,
    envelopePath: FIXTURE_ENVELOPE,
    packageSlug: 'plate-with-holes',
    packageRevision: 'A',
    actorRef: 'test.fixture.receiver',
    timestamp: '2026-07-01T03:00:00Z',
  });
  assert.equal(fixtureResult.record.package_revision, 'A');
  const differentRevisionResult = await quarantineInspectionEvidenceCandidate({
    projectRoot: ROOT,
    candidatePath: FIXTURE_SOURCE,
    envelopePath: FIXTURE_ENVELOPE,
    packageSlug: 'plate-with-holes',
    packageRevision: 'B',
    actorRef: 'test.fixture.receiver',
    timestamp: '2026-07-01T03:00:00Z',
  });
  cleanupDirs.add(dirname(differentRevisionResult.recordPath));
  assert.equal(differentRevisionResult.idempotent, false);
  assert.equal(differentRevisionResult.record.package_revision, 'B');
  assert.notEqual(differentRevisionResult.recordPath, fixtureResult.recordPath);
  const quarantinedSource = resolve(ROOT, fixtureResult.record.candidate.quarantine_ref);
  await writeFile(quarantinedSource, Buffer.concat([fixtureSourceBytes, Buffer.from('changed-after-quarantine\n')]));
  await assert.rejects(
    () => validateQuarantinedInspectionEvidence({
      projectRoot: ROOT,
      recordPath: fixtureResult.recordPath,
      actorRef: 'test.fixture.reviewer',
    }),
    (error) => error.code === 'quarantine_checksum_changed'
  );

  const sourceSymlink = join(temp, 'source-symlink.csv');
  await symlink(FIXTURE_SOURCE, sourceSymlink);
  await assert.rejects(
    () => quarantineInspectionEvidenceCandidate({
      projectRoot: ROOT,
      candidatePath: sourceSymlink,
      envelopePath: FIXTURE_ENVELOPE,
      packageSlug: 'plate-with-holes',
      packageRevision: 'A',
      actorRef: 'test.fixture.receiver',
    }),
    (error) => error.code === 'symlink_forbidden'
  );
  await assert.rejects(
    () => quarantineInspectionEvidenceCandidate({
      projectRoot: ROOT,
      candidatePath: FIXTURE_SOURCE,
      envelopePath: FIXTURE_ENVELOPE,
      packageSlug: 'plate-with-holes',
      packageRevision: '../../../../escaped',
      actorRef: 'test.fixture.receiver',
    }),
    (error) => error.code === 'package_revision_invalid'
  );
  await assert.rejects(
    () => quarantineInspectionEvidenceCandidate({
      projectRoot: ROOT,
      candidatePath: FIXTURE_SOURCE,
      envelopePath: FIXTURE_ENVELOPE,
      packageSlug: 'plate-with-holes',
      packageRevision: 'A',
      actorRef: '/Users/alice',
    }),
    (error) => error.code === 'actor_ref_required'
  );
  const symlinkProject = join(temp, 'symlink-quarantine-project');
  const escapedQuarantine = join(temp, 'escaped-quarantine');
  await mkdir(symlinkProject);
  await mkdir(escapedQuarantine);
  await symlink(escapedQuarantine, join(symlinkProject, 'local'));
  await assert.rejects(
    () => quarantineInspectionEvidenceCandidate({
      projectRoot: symlinkProject,
      candidatePath: FIXTURE_SOURCE,
      envelopePath: FIXTURE_ENVELOPE,
      packageSlug: 'plate-with-holes',
      packageRevision: 'A',
      actorRef: 'test.fixture.receiver',
    }),
    (error) => error.code === 'unsafe_directory_boundary'
  );
  await assert.rejects(
    () => validateQuarantinedInspectionEvidence({
      projectRoot: ROOT,
      recordPath: '../outside/onboarding-record.json',
      actorRef: 'test.fixture.reviewer',
    }),
    (error) => error.code === 'unsafe_path'
  );
  await assert.rejects(
    () => validateQuarantinedInspectionEvidence({
      projectRoot: ROOT,
      recordPath: join(dirname(fixtureResult.recordPath), 'authorized-onboarding-record.json'),
      actorRef: 'test.fixture.reviewer',
    }),
    (error) => error.code === 'live_onboarding_record_required'
  );

  // Authorization is structurally representable but fixture/bypass/checksum claims fail closed.
  const authRecord = buildStateRecord();
  authRecord.state = 'awaiting_authorization';
  authRecord.envelope.structurally_valid = true;
  authRecord.envelope.semantically_valid = true;
  authRecord.envelope.evidence_id = syntheticEnvelope.evidence_id;
  authRecord.envelope.sha256 = sha256Bytes(syntheticEnvelopeBytes);
  authRecord.transitions.push(
    { from: 'quarantined', to: 'structurally_valid', at: '2026-07-01T04:00:00Z', actor_ref: 'fixture.reviewer', reason_code: 'envelope_schema_valid', candidate_sha256: authRecord.candidate.sha256 },
    { from: 'structurally_valid', to: 'semantically_valid', at: '2026-07-01T04:01:00Z', actor_ref: 'fixture.reviewer', reason_code: 'synthetic_state_machine_exercise', candidate_sha256: authRecord.candidate.sha256 },
    { from: 'semantically_valid', to: 'awaiting_authorization', at: '2026-07-01T04:02:00Z', actor_ref: 'fixture.reviewer', reason_code: 'explicit_attachment_authorization_required', candidate_sha256: authRecord.candidate.sha256 }
  );
  const authorization = {
    artifact_type: 'inspection_evidence_attachment_authorization',
    schema_version: '1.0',
    authorization_id: 'synthetic-fixture-authorization',
    decision: 'authorized',
    authorized_operation: 'attach',
    exception_requested: false,
    package_slug: authRecord.package_slug,
    package_revision: authRecord.package_revision,
    evidence_id: syntheticEnvelope.evidence_id,
    source_document_sha256: authRecord.candidate.sha256,
    candidate_envelope_sha256: authRecord.envelope.sha256,
    validated_record_sha256: sha256Json(authRecord),
    reviewer: { identity_ref: syntheticEnvelope.review.reviewer_identity_ref, decision: 'approved', reviewed_at: '2026-07-01T04:01:00Z' },
    authorizer: { identity_ref: 'fixture.authorizer' },
    authorized_at: '2026-07-01T05:01:00Z',
    confidentiality_review: {
      decision: 'approved', reviewed_by_ref: 'fixture.privacy', reviewed_at: '2026-07-01T05:00:30Z',
      private_paths_removed: true, secrets_removed: true, redaction_approved: true,
    },
  };
  const transformedFixtureEnvelope = buildAttachedInspectionEvidenceEnvelope({
    candidateEnvelope: syntheticEnvelope,
    authorization,
    authorizationRef: 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json',
    authorizationSha256: '8'.repeat(64),
    attachedAt: '2026-07-01T06:00:00Z',
    sourceSha256: syntheticEnvelope.source.document.sha256,
    quarantineTransition: authRecord.transitions.find((transition) => transition.to === 'quarantined'),
  });
  assert.equal(validateAttachedInspectionEvidenceEnvelopeTransformation({
    candidateEnvelope: syntheticEnvelope,
    attachedEnvelope: transformedFixtureEnvelope,
    authorization,
    authorizationRef: 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json',
    authorizationSha256: '8'.repeat(64),
    attachedAt: '2026-07-01T06:00:00Z',
    sourceSha256: syntheticEnvelope.source.document.sha256,
    quarantineTransition: authRecord.transitions.find((transition) => transition.to === 'quarantined'),
  }).ok, true);
  const tamperedTransformedEnvelope = clone(transformedFixtureEnvelope);
  tamperedTransformedEnvelope.measured_characteristics[0].measured_value = 999;
  assert.equal(validateAttachedInspectionEvidenceEnvelopeTransformation({
    candidateEnvelope: syntheticEnvelope,
    attachedEnvelope: tamperedTransformedEnvelope,
    authorization,
    authorizationRef: 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json',
    authorizationSha256: '8'.repeat(64),
    attachedAt: '2026-07-01T06:00:00Z',
    sourceSha256: syntheticEnvelope.source.document.sha256,
    quarantineTransition: authRecord.transitions.find((transition) => transition.to === 'quarantined'),
  }).ok, false);
  assert.equal(validateInspectionEvidenceAuthorizationSchema(authorization).ok, true);
  const fixtureAuthorization = validateInspectionEvidenceAuthorizationBinding(
    authorization, authRecord, syntheticEnvelope, { validatedRecordSha256: sha256Json(authRecord) }
  );
  assert.equal(fixtureAuthorization.ok, false);
  assert.equal(errorCodes(fixtureAuthorization).includes('synthetic_authorization_forbidden'), true);
  assert.equal(errorCodes(fixtureAuthorization).includes('unauthorized_exception_attempt'), false);
  const invalidAuthorizationDate = clone(authorization);
  invalidAuthorizationDate.authorized_at = 'not-a-date';
  assert.equal(validateInspectionEvidenceAuthorizationSchema(invalidAuthorizationDate).ok, false);
  invalidAuthorizationDate.authorized_at = '2026-02-30T05:01:00Z';
  assert.equal(validateInspectionEvidenceAuthorizationSchema(invalidAuthorizationDate).ok, false);
  const staleAuthorization = clone(authorization);
  staleAuthorization.source_document_sha256 = '0'.repeat(64);
  assert.equal(
    errorCodes(validateInspectionEvidenceAuthorizationBinding(
      staleAuthorization, authRecord, syntheticEnvelope, { validatedRecordSha256: sha256Json(authRecord) }
    )).includes('authorization_binding_mismatch'),
    true
  );
  const unboundReviewAuthorization = clone(authorization);
  unboundReviewAuthorization.reviewer.reviewed_at = '2026-07-01T04:00:30Z';
  assert.equal(errorCodes(validateInspectionEvidenceAuthorizationBinding(
    unboundReviewAuthorization, authRecord, syntheticEnvelope, { validatedRecordSha256: sha256Json(authRecord) }
  )).includes('review_transition_binding_mismatch'), true);
  const overrideAuthorization = { ...authorization, override: true };
  assert.equal(validateInspectionEvidenceAuthorizationSchema(overrideAuthorization).ok, false);

  const invalidReadinessAuthorization = {
    artifact_type: 'inspection_evidence_readiness_authorization',
    schema_version: '1.0',
    authorization_id: 'synthetic-readiness-authorization',
    decision: 'authorized',
    authorized_operation: 'regenerate_readiness',
    exception_requested: false,
    package_slug: 'plate-with-holes',
    package_revision: 'A',
    attachment_record_ref: 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json',
    attachment_record_sha256: '1'.repeat(64),
    review_pack_sha256: '2'.repeat(64),
    current_readiness_sha256: '3'.repeat(64),
    current_readiness_markdown_sha256: '4'.repeat(64),
    readiness_output_ref: 'docs/examples/plate-with-holes/readiness/readiness_report.json',
    authorized_by_ref: 'fixture.authorizer',
    authorized_at: 'not-a-date',
  };
  assert.equal(validateInspectionEvidenceReadinessAuthorizationSchema(invalidReadinessAuthorization).ok, false);
  invalidReadinessAuthorization.authorized_at = '2026-07-01T06:30:00Z';
  invalidReadinessAuthorization.authorized_by_ref = 'unknown';
  assert.equal(validateInspectionEvidenceReadinessAuthorizationSchema(invalidReadinessAuthorization).ok, false);

  // Receipt hashing/idempotency can be exercised with explicitly synthetic bytes,
  // while full production verification still rejects the synthetic envelope.
  const receiptRoot = join(temp, 'synthetic-receipt-project');
  const inspectionDir = join(receiptRoot, 'docs/examples/plate-with-holes/inspection');
  const readinessDir = join(receiptRoot, 'docs/examples/plate-with-holes/readiness');
  await mkdir(inspectionDir, { recursive: true });
  await mkdir(readinessDir, { recursive: true });
  const canonicalConfigPath = join(receiptRoot, 'docs/examples/plate-with-holes/config.toml');
  await copyFile(
    join(ROOT, 'docs/examples/plate-with-holes/config.toml'),
    canonicalConfigPath
  );
  const envelopePath = join(inspectionDir, 'inspection_evidence.json');
  const candidateEnvelopePath = join(inspectionDir, 'inspection_evidence_candidate_authorized.json');
  const authorizationPath = join(inspectionDir, 'inspection_evidence_authorization.json');
  const onboardingPath = join(inspectionDir, 'inspection_evidence_onboarding.json');
  const receiptPath = join(inspectionDir, 'inspection_evidence_attachment.json');
  const receiptRef = 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json';
  const readinessPath = join(readinessDir, 'readiness_report.json');
  const readinessMarkdownPath = join(readinessDir, 'readiness_report.md');
  const syntheticCanonicalEnvelope = Buffer.from(serializeCanonicalJson({ synthetic: true, fixture: true }));
  const syntheticCanonicalAuthorization = Buffer.from(serializeCanonicalJson({ synthetic: true, fixture: true }));
  const syntheticCanonicalOnboarding = Buffer.from(serializeCanonicalJson(buildStateRecord()));
  await writeFile(envelopePath, syntheticCanonicalEnvelope);
  await writeFile(candidateEnvelopePath, syntheticEnvelopeBytes);
  await writeFile(authorizationPath, syntheticCanonicalAuthorization);
  await writeFile(onboardingPath, syntheticCanonicalOnboarding);
  await writeFile(readinessPath, '{}\n');
  await writeFile(readinessMarkdownPath, '# held\n');
  const partialAttachment = await inspectExistingInspectionEvidenceAttachment(receiptRoot, 'plate-with-holes');
  assert.equal(partialAttachment.exists, false, 'byte-identical partial canonical files must remain recoverable before receipt creation');
  const receipt = {
    artifact_type: 'inspection_evidence_attachment_record', schema_version: '1.0', immutable: true,
    attachment_id: 'synthetic-fixture-attachment', evidence_id: 'synthetic-fixture-evidence',
    attached_at: '2026-07-01T06:00:00Z', package_slug: 'plate-with-holes', package_revision: 'A',
    source_document_sha256: '1'.repeat(64), candidate_envelope_sha256: '2'.repeat(64), authorized_onboarding_record_sha256: hash(syntheticCanonicalOnboarding),
    authorization: {
      authorization_id: 'synthetic-fixture-authorization',
      record_ref: 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json',
      record_sha256: hash(syntheticCanonicalAuthorization), source_record_sha256: '6'.repeat(64), validated_record_sha256: '5'.repeat(64),
      authorized_by_ref: 'fixture.authorizer', authorized_at: '2026-07-01T05:01:00Z',
    },
    resulting_canonical_artifacts: [
      { role: 'authorized_candidate_envelope', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence_candidate_authorized.json', sha256: hash(syntheticEnvelopeBytes) },
      { role: 'evidence_envelope', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence.json', sha256: hash(syntheticCanonicalEnvelope) },
      { role: 'attachment_authorization', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence_authorization.json', sha256: hash(syntheticCanonicalAuthorization) },
      { role: 'authorized_onboarding_record', path: 'docs/examples/plate-with-holes/inspection/inspection_evidence_onboarding.json', sha256: hash(syntheticCanonicalOnboarding) },
    ],
    readiness: {
      regenerated: false,
      before_sha256: '4'.repeat(64),
      after_sha256: '4'.repeat(64),
      before_markdown_sha256: '7'.repeat(64),
      after_markdown_sha256: '7'.repeat(64),
    },
    supersedes_attachment_id: null,
  };
  assert.equal(validateInspectionEvidenceAttachmentRecordSchema(receipt).ok, true);
  await writeFile(receiptPath, serializeCanonicalJson(receipt));
  assert.equal(assertInspectionEvidenceAttachmentIdentity(receipt, {
    expectedSourceSha256: receipt.source_document_sha256,
    expectedEvidenceId: receipt.evidence_id,
    expectedPackageRevision: receipt.package_revision,
    expectedCandidateEnvelopeSha256: receipt.candidate_envelope_sha256,
    expectedAuthorizationId: receipt.authorization.authorization_id,
  }), true);
  assert.throws(
    () => assertInspectionEvidenceAttachmentIdentity(receipt, {
      expectedSourceSha256: '9'.repeat(64), expectedEvidenceId: receipt.evidence_id,
    }),
    (error) => error.code === 'duplicate_attachment_conflict'
  );
  await assert.rejects(
    () => verifyCanonicalInspectionEvidenceAttachment(receiptRoot, receiptRef),
    /onboarding|envelope|schema/i
  );
  const outsideCanonicalEnvelope = join(temp, 'outside-canonical-envelope.json');
  await writeFile(outsideCanonicalEnvelope, syntheticCanonicalEnvelope);
  await rm(envelopePath);
  await symlink(outsideCanonicalEnvelope, envelopePath);
  await assert.rejects(
    () => verifyCanonicalInspectionEvidenceAttachment(receiptRoot, receiptRef),
    (error) => error.code === 'symlink_forbidden'
  );
  await rm(envelopePath);
  await writeFile(envelopePath, syntheticCanonicalEnvelope);
  const outsideConfig = join(temp, 'outside-config.toml');
  await copyFile(join(ROOT, 'docs/examples/plate-with-holes/config.toml'), outsideConfig);
  await rm(canonicalConfigPath);
  await symlink(outsideConfig, canonicalConfigPath);
  await assert.rejects(
    () => verifyCanonicalInspectionEvidenceAttachment(receiptRoot, receiptRef),
    (error) => error.code === 'symlink_forbidden'
  );
  await rm(canonicalConfigPath);
  await copyFile(join(ROOT, 'docs/examples/plate-with-holes/config.toml'), canonicalConfigPath);
  const outsideReadiness = join(temp, 'outside-readiness.json');
  await writeFile(outsideReadiness, '{}\n');
  await rm(readinessPath);
  await symlink(outsideReadiness, readinessPath);
  await assert.rejects(
    () => verifyCanonicalInspectionEvidenceAttachment(receiptRoot, receiptRef),
    (error) => error.code === 'unsafe_readiness_target'
  );

  const readinessGuardRoot = join(temp, 'canonical-readiness-guard');
  const readinessGuardPackage = join(readinessGuardRoot, 'docs/examples/plate-with-holes');
  const readinessGuardInspection = join(readinessGuardPackage, 'inspection');
  const readinessGuardDirectory = join(readinessGuardPackage, 'readiness');
  const readinessGuardJson = join(readinessGuardDirectory, 'readiness_report.json');
  const readinessGuardMarkdown = join(readinessGuardDirectory, 'readiness_report.md');
  await mkdir(readinessGuardInspection, { recursive: true });
  await mkdir(readinessGuardDirectory, { recursive: true });
  const readinessGuardReport = JSON.parse(await readFile(join(ROOT, 'docs/examples/plate-with-holes/readiness/readiness_report.json')));
  await writeFile(readinessGuardJson, '{"sentinel":"before"}\n');
  await writeFile(readinessGuardMarkdown, 'sentinel-before\n');

  let releaseMutationLock;
  let announceMutationLock;
  const mutationLockReleased = new Promise((resolveLock) => { releaseMutationLock = resolveLock; });
  const mutationLockAcquired = new Promise((resolveLock) => { announceMutationLock = resolveLock; });
  const heldMutation = withCanonicalPackageMutationLock(readinessGuardInspection, async () => {
    announceMutationLock();
    await mutationLockReleased;
  });
  await mutationLockAcquired;
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(readinessGuardJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'inspection_evidence_mutation_locked'
  );
  releaseMutationLock();
  await heldMutation;

  await writeCanonicalReadinessArtifacts(readinessGuardJson, readinessGuardReport, { projectRoot: readinessGuardRoot });
  const guardedJsonBeforeAttachment = await readFile(readinessGuardJson);
  const guardedMarkdownBeforeAttachment = await readFile(readinessGuardMarkdown);
  await writeFile(join(readinessGuardInspection, 'inspection_evidence_attachment.json'), '{}\n');
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(readinessGuardJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'inspection_evidence_readiness_authorization_required'
  );
  await assert.rejects(
    () => writeReadinessArtifacts(readinessGuardJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'inspection_evidence_readiness_authorization_required'
  );
  assert.deepEqual(await readFile(readinessGuardJson), guardedJsonBeforeAttachment);
  assert.deepEqual(await readFile(readinessGuardMarkdown), guardedMarkdownBeforeAttachment);
  await rm(join(readinessGuardInspection, 'inspection_evidence_attachment.json'));
  const outsideGuardedReadiness = join(temp, 'outside-guarded-readiness.json');
  await writeFile(outsideGuardedReadiness, 'outside-sentinel\n');
  await rm(readinessGuardJson);
  await symlink(outsideGuardedReadiness, readinessGuardJson);
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(readinessGuardJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'unsafe_canonical_readiness_target'
  );
  assert.equal((await readFile(outsideGuardedReadiness, 'utf8')), 'outside-sentinel\n');
  await rm(readinessGuardJson);
  await writeFile(readinessGuardJson, guardedJsonBeforeAttachment);
  const readinessAliasDirectory = join(readinessGuardRoot, 'output');
  const readinessAliasPath = join(readinessAliasDirectory, 'alias-readiness.json');
  await mkdir(readinessAliasDirectory);
  await symlink(readinessGuardJson, readinessAliasPath);
  await writeFile(join(readinessGuardInspection, 'inspection_evidence_attachment.json'), '{}\n');
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(readinessAliasPath, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'unsafe_canonical_readiness_alias'
  );
  assert.deepEqual(await readFile(readinessGuardJson), guardedJsonBeforeAttachment);
  await rm(readinessAliasPath);

  const markdownAliasJson = join(readinessAliasDirectory, 'markdown-alias.json');
  const markdownAliasPath = join(readinessAliasDirectory, 'markdown-alias.md');
  await symlink(readinessGuardMarkdown, markdownAliasPath);
  await assert.rejects(
    () => writeReadinessArtifacts(markdownAliasJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'unsafe_canonical_readiness_alias'
  );
  assert.deepEqual(await readFile(readinessGuardMarkdown), guardedMarkdownBeforeAttachment);
  await rm(markdownAliasPath);

  const hardlinkJson = join(readinessAliasDirectory, 'hardlink-alias.json');
  await link(readinessGuardJson, hardlinkJson);
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(hardlinkJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'unsafe_canonical_readiness_hardlink'
  );
  assert.deepEqual(await readFile(readinessGuardJson), guardedJsonBeforeAttachment);
  await rm(hardlinkJson);

  const hardlinkMarkdownJson = join(readinessAliasDirectory, 'hardlink-markdown.json');
  const hardlinkMarkdown = join(readinessAliasDirectory, 'hardlink-markdown.md');
  await link(readinessGuardMarkdown, hardlinkMarkdown);
  await assert.rejects(
    () => writeCanonicalReadinessArtifacts(hardlinkMarkdownJson, readinessGuardReport, { projectRoot: readinessGuardRoot }),
    (error) => error.code === 'unsafe_canonical_readiness_hardlink'
  );
  assert.deepEqual(await readFile(readinessGuardMarkdown), guardedMarkdownBeforeAttachment);
  await rm(hardlinkMarkdown);

  const forgedReviewPack = {
    evidence_ledger: { records: [{ inspection_evidence: true, type: 'inspection_evidence', artifact_type: 'inspection_evidence' }] },
  };
  assert.throws(
    () => assertRegularReadinessPackHasNoInspectionEvidenceClaim(forgedReviewPack),
    (error) => error.code === 'separate_readiness_regeneration_required'
  );
  await assert.rejects(
    () => verifyInspectionEvidenceReadinessAuthorization({
      projectRoot: ROOT,
      attachmentRecordPath: 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json',
      readinessAuthorizationPath: FIXTURE_ENVELOPE,
      reviewPackPath: join(ROOT, 'docs/examples/plate-with-holes/review/review_pack.json'),
    }),
    /attachment|read|file/i
  );
} finally {
  for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true });
  await rm(temp, { recursive: true, force: true });
}

for (const slug of CANONICAL_SLUGS) {
  const packageRoot = join(ROOT, 'docs/examples', slug);
  const readinessPath = join(packageRoot, 'readiness/readiness_report.json');
  assert.equal(hash(await readFile(readinessPath)), readinessBefore.get(slug), `${slug} readiness must remain byte-identical`);
  for (const filename of [
    'inspection_evidence.json',
    'inspection_evidence_candidate_authorized.json',
    'inspection_evidence_authorization.json',
    'inspection_evidence_onboarding.json',
    'inspection_evidence_attachment.json',
  ]) {
    await assert.rejects(() => lstat(join(packageRoot, 'inspection', filename)), (error) => error.code === 'ENOENT');
  }
}

console.log('inspection-evidence-onboarding.test.js: ok');
