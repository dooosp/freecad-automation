import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  FIXED_GATE_A_PROHIBITIONS,
  GATE_A_DEFERRED_DECISIONS,
  GATE_A_SAFE_DEFAULTS,
  OUTREACH_AUTHORIZATION_GATE_MATRIX,
  authorizationSatisfiesGate,
  buildPreliminaryRfqOutreachAuthorization,
  buildPreliminaryRfqOutreachPacket,
  computeAttachmentBundleSha256,
  computeMessageCandidateSha256,
  computeRecipientRegistrySha256,
  normalizeOutreachMessageBody,
  parseOneStepOutreachApproval,
  recordPreliminaryRfqOutreachAuthorization,
  renderOneStepOutreachApprovalRequest,
  sha256CanonicalSortedJson,
  validatePreliminaryRfqOutreachAuthorization,
  validatePreliminaryRfqOutreachAuthorizationAgainstPacket,
  validatePreliminaryRfqOutreachPacket,
  verifyPreliminaryRfqOutreachPacketAttachmentBytes,
} from '../src/services/preliminary-rfq-outreach/preliminary-rfq-outreach-authorization-service.js';
import { serializeCanonicalJson, sha256Bytes } from '../lib/inspection-evidence-onboarding.js';
import { parseRecordOutreachArgs } from '../scripts/record-preliminary-rfq-outreach-authorization.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-07-14T12:00:00Z';
const AUTHORIZED_AT = '2026-07-14T12:30:00Z';
const testRoot = `tmp/codex/preliminary-rfq-outreach-test-${process.pid}`;
const ATTACHMENT_BYTES = Object.freeze({
  'manufacturing_rfq.v2.md': Buffer.alloc(128, 'm'),
  'inspection_rfq.v2.md': Buffer.alloc(128, 'i'),
});
const RECIPIENT_CONFIG = [
  ['mfg-bowon', 'BOWON', 'manufacturing'],
  ['mfg-creallo', 'Creallo', 'manufacturing'],
  ['mfg-taehwa-precision', 'Taehwa Precision', 'manufacturing'],
  ['mfg-ekomos', 'EKOMOS', 'manufacturing'],
  ['insp-ktr', 'KTR', 'inspection'],
  ['insp-para-technology', 'Para Technology', 'inspection'],
  ['insp-yujin-metrology', 'Yujin Metrology', 'inspection'],
  ['insp-admt', 'ADMT', 'inspection'],
];

function bodyFor(category, organization) {
  const categoryWarning = category === 'inspection'
    ? 'NOT RELEASED FOR INSPECTION EXECUTION'
    : 'NOT RELEASED FOR MANUFACTURE';
  return normalizeOutreachMessageBody(`${organization} team,

PRELIMINARY CAPABILITY AND BUDGETARY QUOTATION REQUEST ONLY
NOT RELEASED FOR MANUFACTURE OR INSPECTION
DO NOT BEGIN WORK
NO PURCHASE ORDER HAS BEEN ISSUED
NO SHIPMENT IS AUTHORIZED
${categoryWarning}

This request seeks capability and budgetary information only.
UNRESOLVED: nine numeric tolerances
UNRESOLVED: nine required measurement methods
UNRESOLVED: visual deburr acceptance
UNRESOLVED: sampling
UNRESOLVED: finish
UNRESOLVED: heat treatment
UNRESOLVED: surface roughness

Please identify assumptions and list clarification questions.
Please avoid choosing missing tolerances and avoid beginning work.
`);
}

function makeBundle(bundleId, fileName) {
  const payload = {
    bundle_id: bundleId,
    category: bundleId.includes('inspection') ? 'inspection' : 'manufacturing',
    exact_file_list: [{
      path: `${testRoot}/${fileName}`,
      filename: fileName,
      sha256: sha256Bytes(ATTACHMENT_BYTES[fileName]),
      byte_size: ATTACHMENT_BYTES[fileName].length,
    }],
    prohibited_operations: ['dispatch'],
    canonicalization_contract: 'sha256(recursive-key-sorted JSON UTF-8 without BOM or trailing newline, excluding bundle_sha256)',
  };
  return { ...payload, bundle_sha256: computeAttachmentBundleSha256(payload) };
}

function makePacket() {
  const manufacturingBundle = makeBundle('bundle-hinge-block-a-manufacturing-rfq-v1', 'manufacturing_rfq.v2.md');
  const inspectionBundle = makeBundle('bundle-hinge-block-a-inspection-rfq-v1', 'inspection_rfq.v2.md');
  const registryPayload = {
    artifact_type: 'preliminary-outreach-recipient-registry',
    schema_version: '2.0',
    generated_at: GENERATED_AT,
    recipients: RECIPIENT_CONFIG.map(([recipientId, organization, category]) => ({
      recipient_id: recipientId,
      organization,
      category,
      official_contact_source: `https://example.test/${recipientId}`,
      channel_type: 'public_organizational_email',
      public_contact_endpoint: `${recipientId}@example.test`,
      verification_timestamp: GENERATED_AT,
      proposed_message_id: `rfq-${recipientId}-v1`,
      proposed_attachment_bundle_id: category === 'inspection' ? inspectionBundle.bundle_id : manufacturingBundle.bundle_id,
      initial_outreach_status: 'proposed_unapproved',
    })),
    registry_hash_contract: 'sha256(recursive-key-sorted JSON UTF-8 without BOM or trailing newline, excluding recipient_registry_sha256)',
  };
  const recipientRegistry = {
    ...registryPayload,
    recipient_registry_sha256: computeRecipientRegistrySha256(registryPayload),
  };
  const candidates = recipientRegistry.recipients.map((recipient) => {
    const bundle = recipient.category === 'inspection' ? inspectionBundle : manufacturingBundle;
    const subjectScope = recipient.category === 'inspection' ? 'NO INSPECTION AUTHORIZATION' : 'NO WORK AUTHORIZATION';
    const subject = `[PRELIMINARY RFQ — ${subjectScope}] Hinge Block A`;
    const body = bodyFor(recipient.category, recipient.organization);
    const payload = {
      message_id: recipient.proposed_message_id,
      recipient_id: recipient.recipient_id,
      version: '1',
      subject,
      body,
      subject_sha256: sha256Bytes(subject),
      body_sha256: sha256Bytes(body),
      attachment_bundle_id: bundle.bundle_id,
      attachment_bundle_sha256: bundle.bundle_sha256,
      approval_status: 'proposed_unapproved',
      hashing_contract: {
        subject: 'exact UTF-8 bytes',
        body: 'exact UTF-8 bytes, LF, one trailing LF',
        full_candidate: 'recursive-key-sorted JSON excluding full_message_candidate_sha256',
      },
    };
    return { ...payload, full_message_candidate_sha256: computeMessageCandidateSha256(payload) };
  });
  return buildPreliminaryRfqOutreachPacket({
    packetVersion: 'v4',
    generatedAt: GENERATED_AT,
    packageBinding: {
      slug: 'hinge-block',
      revision: 'A',
      technical_inventory_digest: sha256CanonicalSortedJson({ fixture: 'technical-package' }),
    },
    recipientRegistry,
    messageCandidates: {
      artifact_type: 'preliminary-outreach-message-candidates',
      schema_version: '2.0',
      generated_at: GENERATED_AT,
      recipient_registry_sha256: recipientRegistry.recipient_registry_sha256,
      message_count: candidates.length,
      candidates,
    },
    attachmentBundles: {
      artifact_type: 'preliminary-outreach-attachment-bundles',
      schema_version: '2.0',
      generated_at: GENERATED_AT,
      bundles: [manufacturingBundle, inspectionBundle],
    },
    senderAccountDiscovery: {
      status: 'single_connected_account_proposed',
      proposed_account: 'email:operator@example.test',
      confirmation_required: true,
      source: 'connected_gmail_profile',
    },
    authorizationContract: {
      schema_path: 'schemas/preliminary-rfq-outreach-authorization.schema.json',
      schema_sha256: '1'.repeat(64),
      service_path: 'src/services/preliminary-rfq-outreach/preliminary-rfq-outreach-authorization-service.js',
      service_sha256: '2'.repeat(64),
      recorder_path: 'scripts/record-preliminary-rfq-outreach-authorization.js',
      recorder_sha256: '3'.repeat(64),
      no_dispatch_capability: true,
    },
    preservedPriorPackets: [{ packet_version: 'v3', sha256: 'a'.repeat(64), preservation_status: 'immutable_history' }],
  });
}

function approvalText(packetSha256, recipients = 'all-8', sender = 'email:operator@example.test') {
  return `APPROVE PRELIMINARY RFQ OUTREACH

packet_sha256:
${packetSha256}

recipients:
${recipients}

sender_identity:
user:test-operator

sender_account:
${sender}

confidentiality:
internal

accept_safe_defaults:
yes

decision:
approve
`;
}

const packet = makePacket();
const packetBytes = Buffer.from(serializeCanonicalJson(packet));
const packetSha256 = sha256Bytes(packetBytes);

assert.equal(validatePreliminaryRfqOutreachPacket(packet).ok, true);
assert.deepEqual(
  OUTREACH_AUTHORIZATION_GATE_MATRIX.preliminary_rfq_outreach.required_human_decisions,
  [
    'decision',
    'packet_sha256',
    'approved_recipient_ids',
    'authorized_sender_identity',
    'authorized_sending_account',
    'confidentiality_or_safe_default_acceptance',
  ],
);
for (const deferred of ['internal_budget_ceiling', 'physical_part_availability', 'engineering_reviewer', 'quality_reviewer']) {
  assert.equal(OUTREACH_AUTHORIZATION_GATE_MATRIX.preliminary_rfq_outreach.required_human_decisions.includes(deferred), false);
  assert.equal(OUTREACH_AUTHORIZATION_GATE_MATRIX.preliminary_rfq_outreach.deferred.includes(deferred), true);
}

const approval = parseOneStepOutreachApproval(approvalText(packetSha256));
const authorization = buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval, authorizedAt: AUTHORIZED_AT });
assert.equal(validatePreliminaryRfqOutreachAuthorization(authorization).ok, true);
assert.deepEqual(authorization.safe_defaults, GATE_A_SAFE_DEFAULTS);
assert.deepEqual(authorization.deferred_decisions, GATE_A_DEFERRED_DECISIONS);
assert.deepEqual(authorization.prohibited_operations, FIXED_GATE_A_PROHIBITIONS);
assert.equal(authorization.derived_bindings.recipient_count, 8);
assert.equal(authorization.derived_bindings.maximum_number_of_messages, 8);
assert.equal(authorization.dispatch_authorized, false);
for (const deferredValue of ['internal_budget_ceiling', 'physical_part_availability', 'engineering_reviewer', 'quality_reviewer']) {
  assert.equal(Object.hasOwn(authorization, deferredValue), false);
  assert.equal(authorization.deferred_decisions[deferredValue].value, null);
}
assert.equal(validatePreliminaryRfqOutreachAuthorizationAgainstPacket({ authorization, packetBytes }).ok, true);
assert.equal(authorizationSatisfiesGate(authorization, 'preliminary_rfq_outreach', { packetBytes }), true);
for (const laterGate of ['vendor_selection_and_procurement', 'technical_release_and_inspection_execution', 'evidence_and_readiness']) {
  assert.equal(authorizationSatisfiesGate(authorization, laterGate, { packetBytes }), false);
}
const changedPacket = structuredClone(packet);
changedPacket.generated_at = '2026-07-14T12:00:01Z';
const changedPacketBytes = Buffer.from(serializeCanonicalJson(changedPacket));
assert.equal(validatePreliminaryRfqOutreachAuthorizationAgainstPacket({ authorization, packetBytes: changedPacketBytes }).ok, false);
assert.equal(authorizationSatisfiesGate(authorization, 'preliminary_rfq_outreach', { packetBytes: changedPacketBytes }), false);

const removedProhibition = structuredClone(authorization);
removedProhibition.prohibited_operations.pop();
assert.equal(validatePreliminaryRfqOutreachAuthorization(removedProhibition).ok, false);

const reorderedProhibitions = structuredClone(authorization);
reorderedProhibitions.prohibited_operations.reverse();
assert.equal(validatePreliminaryRfqOutreachAuthorization(reorderedProhibitions).ok, false);

const substitutedProhibition = structuredClone(authorization);
substitutedProhibition.prohibited_operations[0] = 'preliminary_rfq_outreach';
assert.equal(validatePreliminaryRfqOutreachAuthorization(substitutedProhibition).ok, false);

const extraAuthorizationProperty = structuredClone(authorization);
extraAuthorizationProperty.procurement_authorized = true;
assert.equal(validatePreliminaryRfqOutreachAuthorization(extraAuthorizationProperty).ok, false);

const overlappingRecipients = structuredClone(authorization);
overlappingRecipients.rejected_recipient_ids = [authorization.approved_recipient_ids[0]];
assert.equal(validatePreliminaryRfqOutreachAuthorization(overlappingRecipients).ok, false);
assert(validatePreliminaryRfqOutreachAuthorization(overlappingRecipients).errors.some((error) => error.code === 'recipient_sets_overlap'));

const invalidAuthorizationScope = structuredClone(authorization);
invalidAuthorizationScope.operation_scope = ['vendor_selection_and_procurement'];
assert.equal(validatePreliminaryRfqOutreachAuthorization(invalidAuthorizationScope).ok, false);

const subsetApproval = parseOneStepOutreachApproval(approvalText(packetSha256, 'mfg-bowon,insp-ktr'));
const subsetAuthorization = buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval: subsetApproval, authorizedAt: AUTHORIZED_AT });
assert.deepEqual(subsetAuthorization.approved_recipient_ids, ['mfg-bowon', 'insp-ktr']);
assert.equal(subsetAuthorization.rejected_recipient_ids.length, 6);
assert.equal(subsetAuthorization.derived_bindings.maximum_number_of_messages, 2);
assert.equal(Object.keys(subsetAuthorization.derived_bindings.approved_attachment_bundle_sha256).length, 2);

assert.throws(
  () => parseOneStepOutreachApproval(approvalText(packetSha256, 'all-8', 'email:123@users.noreply.github.com')),
  (error) => error.code === 'approval_sender_account_forbidden',
);
assert.throws(
  () => buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval: { ...approval, packet_sha256: 'b'.repeat(64) }, authorizedAt: AUTHORIZED_AT }),
  (error) => error.code === 'approval_packet_hash_mismatch',
);
assert.throws(
  () => buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval: { ...approval, sender_account: 'email:other@example.test' }, authorizedAt: AUTHORIZED_AT }),
  (error) => error.code === 'approval_sender_account_unconfirmed',
);
assert.throws(
  () => buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval: parseOneStepOutreachApproval(approvalText(packetSha256, 'mfg-unknown')), authorizedAt: AUTHORIZED_AT }),
  (error) => error.code === 'approval_recipient_unknown',
);
assert.throws(
  () => parseOneStepOutreachApproval(approvalText(packetSha256).replace(/\nsender_identity:\n[^\n]+\n/, '\n')),
  (error) => error.code === 'approval_field_missing',
);
assert.throws(
  () => parseOneStepOutreachApproval(approvalText(packetSha256).replace(/\nsender_account:\n[^\n]+\n/, '\n')),
  (error) => error.code === 'approval_field_missing',
);
assert.throws(
  () => parseOneStepOutreachApproval(`${approvalText(packetSha256)}\nrecipients:\nall-8\n`),
  (error) => error.code === 'approval_field_duplicate',
);

const duplicateRecipient = structuredClone(packet);
duplicateRecipient.recipient_registry.recipients[1].recipient_id = duplicateRecipient.recipient_registry.recipients[0].recipient_id;
assert(validatePreliminaryRfqOutreachPacket(duplicateRecipient).errors.some((error) => error.code === 'recipient_id_duplicate'));

const missingPacketProhibition = structuredClone(packet);
missingPacketProhibition.prohibited_operations.pop();
assert(validatePreliminaryRfqOutreachPacket(missingPacketProhibition).errors.some((error) => error.code === 'packet_prohibitions'));

const invalidPacketScope = structuredClone(packet);
invalidPacketScope.allowed_operations = ['vendor_selection_and_procurement'];
assert(validatePreliminaryRfqOutreachPacket(invalidPacketScope).errors.some((error) => error.code === 'packet_scope'));

const missingWarning = structuredClone(packet);
missingWarning.message_candidates.candidates[0].body = missingWarning.message_candidates.candidates[0].body.replace('DO NOT BEGIN WORK\n', '');
missingWarning.message_candidates.candidates[0].body_sha256 = sha256Bytes(missingWarning.message_candidates.candidates[0].body);
missingWarning.message_candidates.candidates[0].full_message_candidate_sha256 = computeMessageCandidateSha256(missingWarning.message_candidates.candidates[0]);
missingWarning.message_candidate_sha256_by_recipient_id['mfg-bowon'] = missingWarning.message_candidates.candidates[0].full_message_candidate_sha256;
assert.equal(validatePreliminaryRfqOutreachPacket(missingWarning).ok, false);
assert(validatePreliminaryRfqOutreachPacket(missingWarning).errors.some((error) => error.code === 'message_warning_missing'));

const staleMessage = structuredClone(packet);
staleMessage.message_candidates.candidates[0].subject += ' changed';
assert(validatePreliminaryRfqOutreachPacket(staleMessage).errors.some((error) => error.code === 'subject_hash_mismatch'));

const staleBundle = structuredClone(packet);
staleBundle.attachment_bundles.bundles[0].bundle_sha256 = 'b'.repeat(64);
assert(validatePreliminaryRfqOutreachPacket(staleBundle).errors.some((error) => error.code === 'bundle_hash_mismatch'));

const laterGateValue = structuredClone(packet);
laterGateValue.internal_budget_ceiling = { currency: 'KRW', amount: 1 };
assert(validatePreliminaryRfqOutreachPacket(laterGateValue).errors.some((error) => error.code === 'later_gate_value_forbidden'));

const requestMarkdown = renderOneStepOutreachApprovalRequest({ packet, packetSha256 });
assert.match(requestMarkdown, /Packet short ID/);
assert.match(requestMarkdown, /email:operator@example\.test/);
assert.match(requestMarkdown, /Budget, physical-part status, engineering reviewer, and quality reviewer: deferred/);
assert.match(requestMarkdown, /does not draft or send email/);
for (const prohibition of FIXED_GATE_A_PROHIBITIONS) assert(requestMarkdown.includes(`\`${prohibition}\``));

assert.deepEqual(parseRecordOutreachArgs(['--packet', 'output/p.json', '--decision', 'local/d.txt', '--out', 'local/a.json']), {
  projectRoot: ROOT,
  packetPath: 'output/p.json',
  decisionPath: 'local/d.txt',
  outputPath: 'local/a.json',
});

const packetPath = `${testRoot}/packet.json`;
const decisionPath = `${testRoot}/approval.txt`;
const outputPath = `${testRoot}/authorization.json`;
const duplicatePacketPath = `${testRoot}/packet-duplicate.json`;
const noncanonicalPacketPath = `${testRoot}/packet-noncanonical.json`;
await mkdir(resolve(ROOT, testRoot), { recursive: true });
try {
  for (const [fileName, bytes] of Object.entries(ATTACHMENT_BYTES)) {
    await writeFile(resolve(ROOT, testRoot, fileName), bytes);
  }
  assert.equal((await verifyPreliminaryRfqOutreachPacketAttachmentBytes({ projectRoot: ROOT, packet })).ok, true);
  await writeFile(resolve(ROOT, packetPath), packetBytes);
  await writeFile(resolve(ROOT, decisionPath), approvalText(packetSha256));
  const recorded = await recordPreliminaryRfqOutreachAuthorization({
    projectRoot: ROOT,
    packetPath,
    decisionPath,
    outputPath,
    authorizedAt: AUTHORIZED_AT,
  });
  assert.equal(recorded.dispatch_authorized, false);
  assert.equal(recorded.authorization_sha256, sha256Bytes(await readFile(resolve(ROOT, outputPath))));
  await assert.rejects(
    recordPreliminaryRfqOutreachAuthorization({ projectRoot: ROOT, packetPath, decisionPath, outputPath, authorizedAt: AUTHORIZED_AT }),
    (error) => error.code === 'authorization_record_exists',
  );
  await assert.rejects(
    recordPreliminaryRfqOutreachAuthorization({
      projectRoot: ROOT,
      packetPath,
      decisionPath,
      outputPath: 'docs/preliminary-rfq-outreach-authorization.record.json',
      authorizedAt: AUTHORIZED_AT,
    }),
    (error) => error.code === 'unsafe_output_path',
  );
  await assert.rejects(
    readFile(resolve(ROOT, 'docs/preliminary-rfq-outreach-authorization.record.json')),
    (error) => error.code === 'ENOENT',
  );

  const cliOutputPath = `${testRoot}/authorization-cli.json`;
  const cli = spawnSync(process.execPath, [
    'scripts/record-preliminary-rfq-outreach-authorization.js',
    '--packet', packetPath,
    '--decision', decisionPath,
    '--out', cliOutputPath,
    '--timestamp', AUTHORIZED_AT,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"dispatch_authorized": false/);
  assert.equal(JSON.parse(await readFile(resolve(ROOT, cliOutputPath))).dispatch_authorized, false);

  const canonical = serializeCanonicalJson(packet);
  await writeFile(resolve(ROOT, duplicatePacketPath), canonical.replace('  "packet_version": "v4",', '  "packet_version": "v4",\n  "packet_version": "v4",'));
  await assert.rejects(
    recordPreliminaryRfqOutreachAuthorization({
      projectRoot: ROOT,
      packetPath: duplicatePacketPath,
      decisionPath,
      outputPath: `${testRoot}/duplicate-result.json`,
      authorizedAt: AUTHORIZED_AT,
    }),
    (error) => error.code === 'duplicate_json_key',
  );

  await writeFile(resolve(ROOT, noncanonicalPacketPath), JSON.stringify(packet));
  await assert.rejects(
    recordPreliminaryRfqOutreachAuthorization({
      projectRoot: ROOT,
      packetPath: noncanonicalPacketPath,
      decisionPath,
      outputPath: `${testRoot}/noncanonical-result.json`,
      authorizedAt: AUTHORIZED_AT,
    }),
    (error) => error.code === 'noncanonical_inspection_evidence_json',
  );

  await writeFile(resolve(ROOT, testRoot, 'manufacturing_rfq.v2.md'), Buffer.alloc(128, 'x'));
  assert.equal((await verifyPreliminaryRfqOutreachPacketAttachmentBytes({ projectRoot: ROOT, packet })).ok, false);
  await assert.rejects(
    recordPreliminaryRfqOutreachAuthorization({
      projectRoot: ROOT,
      packetPath,
      decisionPath,
      outputPath: `${testRoot}/changed-attachment-result.json`,
      authorizedAt: AUTHORIZED_AT,
    }),
    (error) => error.code === 'attachment_integrity_failed',
  );
} finally {
  await rm(resolve(ROOT, testRoot), { recursive: true, force: true });
}

const serviceSource = await readFile(resolve(ROOT, 'src/services/preliminary-rfq-outreach/preliminary-rfq-outreach-authorization-service.js'), 'utf8');
const recorderSource = await readFile(resolve(ROOT, 'scripts/record-preliminary-rfq-outreach-authorization.js'), 'utf8');
assert.doesNotMatch(
  `${serviceSource}\n${recorderSource}`,
  /(?:from\s+['"](?:node:(?:http|https|net|tls)|nodemailer|smtp-client|gmail)|\b(?:sendMail|createTransport)\s*\()/,
);
assert.match(serviceSource, /spawnSync\('git', \['check-ignore'/);

console.log('preliminary-rfq-outreach-authorization.test.js: ok');
