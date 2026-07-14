import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  isParseableTimestamp,
  parseInspectionEvidenceJsonBytes,
  serializeCanonicalJson,
  sha256Bytes,
  validateJsonDocumentBounds,
} from '../../../lib/inspection-evidence-onboarding.js';

const AUTHORIZATION_SCHEMA_URL = new URL(
  '../../../schemas/preliminary-rfq-outreach-authorization.schema.json',
  import.meta.url,
);
const authorizationSchema = JSON.parse(await readFile(AUTHORIZATION_SCHEMA_URL, 'utf8'));
const authorizationValidator = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(authorizationSchema);

export const PRELIMINARY_RFQ_GATE_ID = 'preliminary_rfq_outreach';
export const OUTREACH_AUTHORIZATION_SCHEMA_VERSION = '1.0';

export const FIXED_GATE_A_PROHIBITIONS = Object.freeze([
  'procurement',
  'purchase_order',
  'commercial_commitment',
  'payment',
  'shipment',
  'manufacturing',
  'inspection_execution',
  'technical_release',
  'evidence_review_approval',
  'evidence_authorization',
  'evidence_attachment',
  'evidence_supersession',
  'readiness_authorization',
  'readiness_regeneration',
  'release_publication',
  'deployment',
]);

export const GATE_A_SAFE_DEFAULTS = Object.freeze({
  confidentiality_classification: 'internal',
  confidentiality_notice_required: true,
  one_reminder_authorized: false,
  factual_clarification_replies_authorized: false,
  budget_disclosure_authorized: false,
});

export const GATE_A_DEFERRED_DECISIONS = Object.freeze({
  internal_budget_ceiling: Object.freeze({ status: 'deferred_to_gate_b', value: null }),
  physical_part_availability: Object.freeze({ status: 'deferred_to_gate_c', value: null }),
  engineering_reviewer: Object.freeze({ status: 'deferred_to_gate_c', value: null }),
  quality_reviewer: Object.freeze({ status: 'deferred_to_gate_c', value: null }),
  vendor_selection: Object.freeze({ status: 'deferred_to_gate_b', value: null }),
  procurement_approval: Object.freeze({ status: 'deferred_to_gate_b', value: null }),
  technical_release_approval: Object.freeze({ status: 'deferred_to_gate_c', value: null }),
});

export const OUTREACH_AUTHORIZATION_GATE_MATRIX = Object.freeze({
  preliminary_rfq_outreach: Object.freeze({
    required_human_decisions: Object.freeze([
      'decision',
      'packet_sha256',
      'approved_recipient_ids',
      'authorized_sender_identity',
      'authorized_sending_account',
      'confidentiality_or_safe_default_acceptance',
    ]),
    optional_with_safe_defaults: Object.freeze([
      'confidentiality_classification',
      'confidentiality_notice_required',
      'one_reminder_authorized',
      'factual_clarification_replies_authorized',
      'budget_disclosure_authorized',
    ]),
    deferred: Object.freeze(Object.keys(GATE_A_DEFERRED_DECISIONS)),
    authorization_artifact_type: 'preliminary_rfq_outreach_authorization',
  }),
  vendor_selection_and_procurement: Object.freeze({
    required_later: Object.freeze([
      'selected_manufacturer',
      'selected_inspection_provider',
      'actual_quotations',
      'budget_ceiling',
      'contingency',
      'tax_shipping_payment_authority',
      'commercial_approval',
    ]),
    rejects_gate_a_authorization: true,
  }),
  technical_release_and_inspection_execution: Object.freeze({
    required_later: Object.freeze([
      'physical_part_route',
      'released_tolerances_and_methods',
      'released_material_finish_deburr_sampling_requirements',
      'engineering_reviewer',
      'quality_reviewer',
      'technical_package_hashes',
      'inspection_plan_release_for_execution',
    ]),
    rejects_gate_a_authorization: true,
  }),
  evidence_and_readiness: Object.freeze({
    required_later: Object.freeze([
      'evidence_review',
      'attachment_authorization',
      'attachment_receipt',
      'readiness_authorization',
      'readiness_regeneration',
    ]),
    rejects_gate_a_authorization: true,
  }),
});

const REQUIRED_COMMON_WARNING_LINES = Object.freeze([
  'PRELIMINARY CAPABILITY AND BUDGETARY QUOTATION REQUEST ONLY',
  'NOT RELEASED FOR MANUFACTURE OR INSPECTION',
  'DO NOT BEGIN WORK',
  'NO PURCHASE ORDER HAS BEEN ISSUED',
  'NO SHIPMENT IS AUTHORIZED',
]);

const REQUIREMENT_EXPLANATION_PATTERNS = Object.freeze([
  /(?:9개 특성의 숫자 공차|nine numeric tolerances)/i,
  /(?:9개 특성의 필수 측정 방법|nine required measurement methods)/i,
  /(?:육안 디버링 합격 기준|visual deburr acceptance)/i,
  /(?:샘플링|sampling)/i,
  /(?:마감|finish)/i,
  /(?:열처리|heat treatment)/i,
  /(?:표면 거칠기|surface roughness)/i,
]);

const RECIPIENT_INSTRUCTION_PATTERNS = Object.freeze([
  /(?:비구속적[^\n]*역량 확인 및 예산 견적|capability and budgetary information only)/i,
  /(?:모든 (?:기술적 )?가정|identify assumptions)/i,
  /(?:명확화 질문|clarification questions)/i,
  /(?:선택하거나 추정하지|avoid choosing missing tolerances)/i,
  /(?:시작하지|avoid beginning work|do not begin work)/i,
]);

const ONE_STEP_FIELDS = Object.freeze([
  'packet_sha256',
  'recipients',
  'sender_identity',
  'sender_account',
  'confidentiality',
  'accept_safe_defaults',
  'decision',
]);

const FORBIDDEN_GATE_A_VALUE_KEYS = new Set([
  'budget_ceiling',
  'internal_budget_ceiling',
  'physical_part_availability',
  'engineering_reviewer',
  'engineering_reviewer_reference',
  'quality_reviewer',
  'quality_reviewer_reference',
  'vendor_selection',
  'procurement_approval',
  'technical_release',
  'technical_release_approval',
]);

function serviceError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeSchemaPath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${basePath === '/' ? '' : basePath}/${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function schemaErrors(validator) {
  return (validator.errors || []).map((error) => ({
    code: `schema_${error.keyword}`,
    path: normalizeSchemaPath(error),
    message: `${normalizeSchemaPath(error)} ${error.message}`.trim(),
  }));
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
}

export function sha256CanonicalSortedJson(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(sortedValue(value)), 'utf8'));
}

function withoutKey(value, key) {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

export function normalizeOutreachMessageBody(value) {
  if (typeof value !== 'string') return '';
  const lines = value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

export function computeRecipientRegistrySha256(registry) {
  return sha256CanonicalSortedJson(withoutKey(registry, 'recipient_registry_sha256'));
}

export function computeAttachmentBundleSha256(bundle) {
  return sha256CanonicalSortedJson(withoutKey(bundle, 'bundle_sha256'));
}

export function computeMessageCandidateSha256(candidate) {
  return sha256CanonicalSortedJson(withoutKey(candidate, 'full_message_candidate_sha256'));
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function packetManifests(packet) {
  return {
    registry: safeObject(packet.recipient_registry),
    messages: safeObject(packet.message_candidates),
    bundles: safeObject(packet.attachment_bundles),
  };
}

function pushError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function visitObjectKeys(value, visitor, path = '') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitObjectKeys(entry, visitor, `${path}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    visitor(key, `${path}/${key}`);
    visitObjectKeys(entry, visitor, `${path}/${key}`);
  }
}

export function validatePreliminaryRfqOutreachPacket(packet) {
  const errors = [];
  const bounds = validateJsonDocumentBounds(packet, { maxDepth: 48, maxNodes: 30_000 });
  if (!bounds.ok) errors.push(...bounds.errors);
  if (packet?.artifact_type !== 'preliminary_rfq_outreach_packet') {
    pushError(errors, 'packet_artifact_type', '/artifact_type', 'Packet artifact_type must be preliminary_rfq_outreach_packet');
  }
  if (packet?.schema_version !== '1.0') {
    pushError(errors, 'packet_schema_version', '/schema_version', 'Packet schema_version must be 1.0');
  }
  if (!/^v[1-9][0-9]*$/.test(packet?.packet_version || '')) {
    pushError(errors, 'packet_version', '/packet_version', 'Packet version must be a stable vN identifier');
  }
  if (packet?.authorization_status !== 'pending_human_decision') {
    pushError(errors, 'packet_not_pending', '/authorization_status', 'Packet must remain pending_human_decision until an authorization is recorded');
  }
  if (packet?.dispatch_state !== 'not_started') {
    pushError(errors, 'packet_dispatch_state', '/dispatch_state', 'Packet must bind dispatch_state not_started');
  }
  if (!sameStringArray(packet?.allowed_operations, [PRELIMINARY_RFQ_GATE_ID])) {
    pushError(errors, 'packet_scope', '/allowed_operations', 'Packet may allow preliminary_rfq_outreach only');
  }
  if (!sameStringArray(packet?.prohibited_operations, FIXED_GATE_A_PROHIBITIONS)) {
    pushError(errors, 'packet_prohibitions', '/prohibited_operations', 'Packet must contain every fixed Gate A prohibition in policy order');
  }
  if (packet?.human_authorization_required !== true) {
    pushError(errors, 'packet_human_authorization', '/human_authorization_required', 'Packet must require a human authorization');
  }
  if (JSON.stringify(packet?.safe_defaults) !== JSON.stringify(GATE_A_SAFE_DEFAULTS)) {
    pushError(errors, 'packet_safe_defaults', '/safe_defaults', 'Packet safe defaults do not match Gate A policy');
  }
  if (!sameStringArray(packet?.deferred_decision_fields, Object.keys(GATE_A_DEFERRED_DECISIONS))) {
    pushError(errors, 'packet_deferred_fields', '/deferred_decision_fields', 'Packet must defer every Gate B/C decision without requiring a value');
  }
  visitObjectKeys(packet, (key, path) => {
    if (FORBIDDEN_GATE_A_VALUE_KEYS.has(key)) {
      pushError(errors, 'later_gate_value_forbidden', path, `${key} is a later-gate value and must not appear in a Gate A packet`);
    }
  });
  const senderDiscovery = safeObject(packet?.sender_account_discovery);
  if (/\bgit(?:hub)?\b/i.test(senderDiscovery.source || '')) {
    pushError(errors, 'sender_discovery_source_forbidden', '/sender_account_discovery/source', 'Git configuration and GitHub identity are not valid sending-account discovery sources');
  }
  if (senderDiscovery.status === 'single_connected_account_proposed') {
    if (!/^email:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(senderDiscovery.proposed_account || '')
        || /@(?:users\.)?noreply\.github\.com$/i.test(String(senderDiscovery.proposed_account || '').slice('email:'.length))
        || senderDiscovery.confirmation_required !== true) {
      pushError(errors, 'sender_discovery_invalid', '/sender_account_discovery', 'A single connected sender account must be proposed as email:<account> and require confirmation');
    }
  } else if (senderDiscovery.status === 'multiple_connected_accounts') {
    const accounts = Array.isArray(senderDiscovery.proposed_accounts) ? senderDiscovery.proposed_accounts : [];
    if (accounts.length < 2 || new Set(accounts).size !== accounts.length
        || accounts.some((entry) => !/^email:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(entry))
        || accounts.some((entry) => /@(?:users\.)?noreply\.github\.com$/i.test(entry.slice('email:'.length)))
        || senderDiscovery.confirmation_required !== true) {
      pushError(errors, 'sender_discovery_invalid', '/sender_account_discovery', 'Multiple connected accounts must be unique email:<account> choices and require confirmation');
    }
  } else if (senderDiscovery.status === 'sender_account_unavailable') {
    if (senderDiscovery.proposed_account != null || senderDiscovery.confirmation_required !== true) {
      pushError(errors, 'sender_discovery_invalid', '/sender_account_discovery', 'Unavailable sender discovery must not propose an account and must keep confirmation required');
    }
  } else {
    pushError(errors, 'sender_discovery_invalid', '/sender_account_discovery/status', 'Sender discovery status is not recognized');
  }
  const authorizationContract = safeObject(packet?.authorization_contract);
  for (const field of ['schema_path', 'schema_sha256', 'service_path', 'service_sha256', 'recorder_path', 'recorder_sha256']) {
    if (typeof authorizationContract[field] !== 'string' || !authorizationContract[field]) {
      pushError(errors, 'authorization_contract_missing', `/authorization_contract/${field}`, `Authorization contract ${field} is required`);
    }
  }
  for (const field of ['schema_sha256', 'service_sha256', 'recorder_sha256']) {
    if (!/^[a-f0-9]{64}$/.test(authorizationContract[field] || '')) {
      pushError(errors, 'authorization_contract_hash_invalid', `/authorization_contract/${field}`, `Authorization contract ${field} must be a SHA-256`);
    }
  }
  if (authorizationContract.no_dispatch_capability !== true) {
    pushError(errors, 'authorization_contract_dispatch_boundary', '/authorization_contract/no_dispatch_capability', 'Authorization recorder must have no dispatch capability');
  }

  const { registry, messages, bundles } = packetManifests(packet);
  const recipients = Array.isArray(registry.recipients) ? registry.recipients : [];
  const candidates = Array.isArray(messages.candidates) ? messages.candidates : [];
  const bundleEntries = Array.isArray(bundles.bundles) ? bundles.bundles : [];
  if (recipients.length === 0) pushError(errors, 'recipient_registry_empty', '/recipient_registry/recipients', 'Recipient registry must not be empty');
  if (recipients.length !== candidates.length) {
    pushError(errors, 'candidate_count_mismatch', '/message_candidates/candidates', 'Every proposed recipient must have exactly one message candidate');
  }
  if (registry.recipient_registry_sha256 !== computeRecipientRegistrySha256(registry)) {
    pushError(errors, 'recipient_registry_hash_mismatch', '/recipient_registry/recipient_registry_sha256', 'Recipient registry hash does not match its exact content');
  }
  if (messages.recipient_registry_sha256 !== registry.recipient_registry_sha256) {
    pushError(errors, 'message_registry_binding_mismatch', '/message_candidates/recipient_registry_sha256', 'Message manifest must bind the exact recipient registry');
  }
  if (packet?.recipient_registry_sha256 !== registry.recipient_registry_sha256) {
    pushError(errors, 'packet_registry_binding_mismatch', '/recipient_registry_sha256', 'Packet registry hash must match the embedded registry');
  }

  const recipientIds = new Set();
  const messageIds = new Set();
  const bundleIds = new Set();
  const recipientById = new Map();
  const bundleById = new Map();
  for (const [index, recipient] of recipients.entries()) {
    const path = `/recipient_registry/recipients/${index}`;
    if (!/^(?:mfg|insp)-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipient?.recipient_id || '')) {
      pushError(errors, 'recipient_id_invalid', `${path}/recipient_id`, 'Recipient ID must be a stable category-prefixed slug');
    } else if (recipientIds.has(recipient.recipient_id)) {
      pushError(errors, 'recipient_id_duplicate', `${path}/recipient_id`, 'Recipient IDs must be unique');
    }
    recipientIds.add(recipient?.recipient_id);
    recipientById.set(recipient?.recipient_id, recipient);
    for (const field of ['organization', 'category', 'official_contact_source', 'channel_type', 'public_contact_endpoint', 'verification_timestamp', 'proposed_message_id', 'proposed_attachment_bundle_id']) {
      if (typeof recipient?.[field] !== 'string' || !recipient[field]) {
        pushError(errors, 'recipient_field_missing', `${path}/${field}`, `Recipient ${field} is required`);
      }
    }
    if (recipient?.initial_outreach_status !== 'proposed_unapproved') {
      pushError(errors, 'recipient_status_invalid', `${path}/initial_outreach_status`, 'Recipient must remain proposed_unapproved');
    }
  }

  for (const [index, bundle] of bundleEntries.entries()) {
    const path = `/attachment_bundles/bundles/${index}`;
    if (!bundle?.bundle_id || bundleIds.has(bundle.bundle_id)) {
      pushError(errors, 'bundle_id_invalid', `${path}/bundle_id`, 'Attachment bundle IDs must be present and unique');
    }
    bundleIds.add(bundle?.bundle_id);
    bundleById.set(bundle?.bundle_id, bundle);
    if (bundle?.bundle_sha256 !== computeAttachmentBundleSha256(bundle)) {
      pushError(errors, 'bundle_hash_mismatch', `${path}/bundle_sha256`, 'Attachment bundle hash does not match exact bundle content');
    }
    const files = Array.isArray(bundle?.exact_file_list) ? bundle.exact_file_list : [];
    if (files.length === 0) pushError(errors, 'bundle_empty', `${path}/exact_file_list`, 'Attachment bundle must bind at least one file');
    for (const [fileIndex, file] of files.entries()) {
      if (!/^[a-f0-9]{64}$/.test(file?.sha256 || '') || !Number.isInteger(file?.byte_size) || file.byte_size < 1) {
        pushError(errors, 'attachment_binding_invalid', `${path}/exact_file_list/${fileIndex}`, 'Attachment must bind path, SHA-256, and positive byte size');
      }
    }
  }

  for (const [index, candidate] of candidates.entries()) {
    const path = `/message_candidates/candidates/${index}`;
    const recipient = recipientById.get(candidate?.recipient_id);
    if (!recipient) pushError(errors, 'candidate_recipient_unknown', `${path}/recipient_id`, 'Candidate recipient ID is not in the packet registry');
    if (!candidate?.message_id || messageIds.has(candidate.message_id)) {
      pushError(errors, 'message_id_invalid', `${path}/message_id`, 'Message IDs must be present and unique');
    }
    messageIds.add(candidate?.message_id);
    if (recipient && candidate.message_id !== recipient.proposed_message_id) {
      pushError(errors, 'candidate_message_binding_mismatch', `${path}/message_id`, 'Candidate message ID must match the recipient registry');
    }
    if (candidate?.approval_status !== 'proposed_unapproved') {
      pushError(errors, 'candidate_status_invalid', `${path}/approval_status`, 'Message candidate must remain proposed_unapproved');
    }
    if (typeof candidate?.subject !== 'string' || candidate.subject.trim() !== candidate.subject || /[\r\n]/.test(candidate.subject)) {
      pushError(errors, 'subject_noncanonical', `${path}/subject`, 'Subject must be one exact trimmed line');
    }
    if (!candidate?.subject?.includes('PRELIMINARY RFQ')) {
      pushError(errors, 'subject_warning_missing', `${path}/subject`, 'Subject must visibly include PRELIMINARY RFQ');
    }
    const requiredSubjectScope = recipient?.category === 'inspection' ? 'NO INSPECTION AUTHORIZATION' : 'NO WORK AUTHORIZATION';
    if (!candidate?.subject?.includes(requiredSubjectScope)) {
      pushError(errors, 'subject_scope_missing', `${path}/subject`, `Subject must visibly include ${requiredSubjectScope}`);
    }
    if (candidate?.subject_sha256 !== sha256Bytes(Buffer.from(candidate?.subject || '', 'utf8'))) {
      pushError(errors, 'subject_hash_mismatch', `${path}/subject_sha256`, 'Subject SHA-256 does not match exact subject bytes');
    }
    if (candidate?.body !== normalizeOutreachMessageBody(candidate?.body)) {
      pushError(errors, 'body_noncanonical', `${path}/body`, 'Body must use UTF-8/LF, no trailing spaces, and exactly one final newline');
    }
    if (candidate?.body_sha256 !== sha256Bytes(Buffer.from(candidate?.body || '', 'utf8'))) {
      pushError(errors, 'body_hash_mismatch', `${path}/body_sha256`, 'Body SHA-256 does not match exact body bytes');
    }
    const firstLines = String(candidate?.body || '').split('\n').slice(0, 14);
    for (const warning of REQUIRED_COMMON_WARNING_LINES) {
      if (!firstLines.includes(warning)) pushError(errors, 'message_warning_missing', `${path}/body`, `Message body is missing required warning: ${warning}`);
    }
    const categoryWarning = recipient?.category === 'inspection'
      ? 'NOT RELEASED FOR INSPECTION EXECUTION'
      : 'NOT RELEASED FOR MANUFACTURE';
    if (!firstLines.includes(categoryWarning)) {
      pushError(errors, 'message_category_warning_missing', `${path}/body`, `Message body is missing required warning: ${categoryWarning}`);
    }
    for (const pattern of REQUIREMENT_EXPLANATION_PATTERNS) {
      if (!pattern.test(candidate?.body || '')) pushError(errors, 'unresolved_requirement_missing', `${path}/body`, `Message does not explain unresolved requirement ${pattern}`);
    }
    for (const pattern of RECIPIENT_INSTRUCTION_PATTERNS) {
      if (!pattern.test(candidate?.body || '')) pushError(errors, 'recipient_instruction_missing', `${path}/body`, `Message does not contain required recipient instruction ${pattern}`);
    }
    const bundle = bundleById.get(candidate?.attachment_bundle_id);
    if (!bundle || candidate.attachment_bundle_id !== recipient?.proposed_attachment_bundle_id) {
      pushError(errors, 'candidate_bundle_unknown', `${path}/attachment_bundle_id`, 'Candidate bundle must match the recipient registry');
    } else if (candidate.attachment_bundle_sha256 !== bundle.bundle_sha256) {
      pushError(errors, 'candidate_bundle_hash_mismatch', `${path}/attachment_bundle_sha256`, 'Candidate bundle hash must match exact bundle bytes');
    }
    if (candidate?.full_message_candidate_sha256 !== computeMessageCandidateSha256(candidate)) {
      pushError(errors, 'message_candidate_hash_mismatch', `${path}/full_message_candidate_sha256`, 'Full candidate hash does not match exact candidate content');
    }
  }

  const expectedMessageHashes = Object.fromEntries(candidates.map((entry) => [entry.recipient_id, entry.full_message_candidate_sha256]));
  const expectedBundleHashes = Object.fromEntries(bundleEntries.map((entry) => [entry.bundle_id, entry.bundle_sha256]));
  if (JSON.stringify(packet?.message_candidate_sha256_by_recipient_id) !== JSON.stringify(expectedMessageHashes)) {
    pushError(errors, 'packet_message_hash_catalog_mismatch', '/message_candidate_sha256_by_recipient_id', 'Packet message hash catalog is stale');
  }
  if (JSON.stringify(packet?.attachment_bundle_sha256_by_id) !== JSON.stringify(expectedBundleHashes)) {
    pushError(errors, 'packet_bundle_hash_catalog_mismatch', '/attachment_bundle_sha256_by_id', 'Packet bundle hash catalog is stale');
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidPreliminaryRfqOutreachPacket(packet) {
  const result = validatePreliminaryRfqOutreachPacket(packet);
  if (!result.ok) throw serviceError('invalid_outreach_packet', 'Preliminary RFQ outreach packet validation failed', result.errors);
  return packet;
}

export function buildPreliminaryRfqOutreachPacket({
  packetVersion,
  generatedAt,
  packageBinding,
  recipientRegistry,
  messageCandidates,
  attachmentBundles,
  senderAccountDiscovery,
  authorizationContract,
  preservedPriorPackets = [],
}) {
  if (!isParseableTimestamp(generatedAt)) throw serviceError('invalid_timestamp', 'Packet generatedAt must be an RFC 3339 timestamp');
  const packet = {
    artifact_type: 'preliminary_rfq_outreach_packet',
    schema_version: '1.0',
    packet_version: packetVersion,
    generated_at: generatedAt,
    package: packageBinding,
    technical_inventory_digest: packageBinding?.technical_inventory_digest,
    recipient_registry_sha256: recipientRegistry?.recipient_registry_sha256,
    recipient_registry: recipientRegistry,
    message_candidates: messageCandidates,
    attachment_bundles: attachmentBundles,
    message_candidate_sha256_by_recipient_id: Object.fromEntries(
      (messageCandidates?.candidates || []).map((entry) => [entry.recipient_id, entry.full_message_candidate_sha256]),
    ),
    attachment_bundle_sha256_by_id: Object.fromEntries(
      (attachmentBundles?.bundles || []).map((entry) => [entry.bundle_id, entry.bundle_sha256]),
    ),
    sender_account_discovery: senderAccountDiscovery,
    authorization_contract: authorizationContract,
    authorization_status: 'pending_human_decision',
    dispatch_state: 'not_started',
    allowed_operations: [PRELIMINARY_RFQ_GATE_ID],
    prohibited_operations: [...FIXED_GATE_A_PROHIBITIONS],
    safe_defaults: { ...GATE_A_SAFE_DEFAULTS },
    deferred_decision_fields: Object.keys(GATE_A_DEFERRED_DECISIONS),
    human_authorization_required: true,
    preserved_prior_packets: preservedPriorPackets,
    no_message_sent: true,
    no_contact_form_submitted: true,
  };
  return assertValidPreliminaryRfqOutreachPacket(packet);
}

export function renderOneStepOutreachApprovalRequest({ packet, packetSha256 }) {
  assertValidPreliminaryRfqOutreachPacket(packet);
  if (!/^[a-f0-9]{64}$/.test(packetSha256 || '')) throw serviceError('packet_hash_invalid', 'Packet SHA-256 is required to render an approval request');
  const recipientIds = packet.recipient_registry.recipients.map((entry) => entry.recipient_id);
  const discovery = safeObject(packet.sender_account_discovery);
  const proposedAccount = discovery.status === 'single_connected_account_proposed'
    ? discovery.proposed_account
    : discovery.status === 'multiple_connected_accounts'
      ? '<select-one-connected-account>'
      : 'sender_account_unavailable';
  const senderGuidance = discovery.status === 'single_connected_account_proposed'
    ? `Proposed connected account: \`${proposedAccount}\`. Repeat it below to confirm it for this packet.`
    : discovery.status === 'multiple_connected_accounts'
      ? `Connected account choices: ${discovery.proposed_accounts.map((entry) => `\`${entry}\``).join(', ')}. Replace the placeholder below with exactly one choice.`
      : 'No connected sender account is available. Connect a mail account and regenerate this request; authorization remains incomplete.';
  return [
    '# Preliminary RFQ outreach — one-response approval',
    '',
    `- Packet short ID: \`${packetSha256.slice(0, 12)}\``,
    `- Packet SHA-256: \`${packetSha256}\``,
    `- Packet version: \`${packet.packet_version}\``,
    `- Proposed recipients: ${recipientIds.length} (${recipientIds.map((entry) => `\`${entry}\``).join(', ')})`,
    '- Confidentiality safe default: `internal`; notice required',
    '- Budget, physical-part status, engineering reviewer, and quality reviewer: deferred to later gates',
    '- Dispatch: separate later operation; not authorized by this response',
    '',
    senderGuidance,
    '',
    '## Fixed prohibitions',
    '',
    ...FIXED_GATE_A_PROHIBITIONS.map((entry) => `- \`${entry}\``),
    '',
    '## Reply once',
    '',
    '```text',
    'APPROVE PRELIMINARY RFQ OUTREACH',
    '',
    'packet_sha256:',
    packetSha256,
    '',
    'recipients:',
    recipientIds.length === 8 ? 'all-8' : recipientIds.join(','),
    '',
    'sender_identity:',
    'user:taeho-jang',
    '',
    'sender_account:',
    proposedAccount,
    '',
    'confidentiality:',
    'internal',
    '',
    'accept_safe_defaults:',
    'yes',
    '',
    'decision:',
    'approve',
    '```',
    '',
    'Recording this response creates only an immutable Gate A authorization record. It does not draft or send email, submit a contact form, or authorize procurement, technical release, inspection execution, evidence, readiness, or dispatch.',
    '',
  ].join('\n');
}

export function parseOneStepOutreachApproval(text) {
  if (typeof text !== 'string' || !text.trim()) throw serviceError('approval_empty', 'Approval response is empty');
  const rawLines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const lines = rawLines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.shift() !== 'APPROVE PRELIMINARY RFQ OUTREACH') {
    throw serviceError('approval_header_invalid', 'Approval response must begin with APPROVE PRELIMINARY RFQ OUTREACH');
  }
  const fields = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([a-z0-9_]+):(?:\s*(.*))?$/);
    if (!match) throw serviceError('approval_format_invalid', `Unexpected approval line: ${lines[index]}`);
    const [, key, inline] = match;
    if (!ONE_STEP_FIELDS.includes(key)) throw serviceError('approval_field_unknown', `Unknown approval field: ${key}`);
    if (Object.hasOwn(fields, key)) throw serviceError('approval_field_duplicate', `Duplicate approval field: ${key}`);
    const value = inline || lines[index + 1];
    if (!value || /^[a-z0-9_]+:$/.test(value)) throw serviceError('approval_field_missing', `Approval field ${key} requires a value`);
    fields[key] = value;
    if (!inline) index += 1;
  }
  for (const field of ONE_STEP_FIELDS) {
    if (!Object.hasOwn(fields, field)) throw serviceError('approval_field_missing', `Approval field ${field} is required`);
  }
  if (!/^[a-f0-9]{64}$/.test(fields.packet_sha256)) throw serviceError('approval_packet_hash_invalid', 'packet_sha256 must be a lowercase SHA-256');
  if (fields.decision !== 'approve') throw serviceError('approval_decision_invalid', 'decision must be approve');
  if (fields.accept_safe_defaults !== 'yes') throw serviceError('approval_defaults_not_accepted', 'accept_safe_defaults must be yes');
  if (fields.confidentiality !== 'internal') throw serviceError('approval_confidentiality_invalid', 'Only the safe internal confidentiality default is supported');
  if (!/^email:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(fields.sender_account)) {
    throw serviceError('approval_sender_account_invalid', 'sender_account must be a confirmed email:<account> value');
  }
  if (/@(?:users\.)?noreply\.github\.com$/i.test(fields.sender_account.slice('email:'.length))) {
    throw serviceError('approval_sender_account_forbidden', 'GitHub noreply addresses cannot be authorized as sending accounts');
  }
  return fields;
}

function resolveApprovedRecipientIds(recipientValue, packetRecipientIds) {
  if (recipientValue === 'all-8') {
    if (packetRecipientIds.length !== 8) throw serviceError('approval_all_8_mismatch', 'all-8 is valid only for a packet containing exactly eight recipients');
    return [...packetRecipientIds];
  }
  const selected = recipientValue.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (selected.length === 0) throw serviceError('approval_recipients_empty', 'At least one recipient must be approved');
  if (new Set(selected).size !== selected.length) throw serviceError('approval_recipients_duplicate', 'Approved recipient IDs must be unique');
  const known = new Set(packetRecipientIds);
  const unknown = selected.filter((entry) => !known.has(entry));
  if (unknown.length > 0) throw serviceError('approval_recipient_unknown', `Unknown recipient IDs: ${unknown.join(', ')}`);
  return packetRecipientIds.filter((entry) => selected.includes(entry));
}

export function validatePreliminaryRfqOutreachAuthorization(authorization) {
  const bounds = validateJsonDocumentBounds(authorization, { maxDepth: 32, maxNodes: 5_000 });
  const errors = bounds.ok ? [] : [...bounds.errors];
  const schemaOk = authorizationValidator(authorization);
  if (!schemaOk) errors.push(...schemaErrors(authorizationValidator));
  if (authorization?.authorized_at && !isParseableTimestamp(authorization.authorized_at)) {
    pushError(errors, 'schema_format', '/authorized_at', 'authorized_at must be a valid RFC 3339 timestamp');
  }
  if (/@(?:users\.)?noreply\.github\.com$/i.test(String(authorization?.authorized_sending_account || '').slice('email:'.length))) {
    pushError(errors, 'sender_account_forbidden', '/authorized_sending_account', 'GitHub noreply addresses cannot be sending accounts');
  }
  const approved = Array.isArray(authorization?.approved_recipient_ids) ? authorization.approved_recipient_ids : [];
  const rejected = new Set(Array.isArray(authorization?.rejected_recipient_ids) ? authorization.rejected_recipient_ids : []);
  if (approved.some((entry) => rejected.has(entry))) {
    pushError(errors, 'recipient_sets_overlap', '/rejected_recipient_ids', 'Approved and rejected recipient sets must be disjoint');
  }
  if (authorization?.derived_bindings?.recipient_count !== approved.length
      || authorization?.derived_bindings?.maximum_number_of_messages !== approved.length) {
    pushError(errors, 'derived_count_mismatch', '/derived_bindings', 'Derived recipient and maximum-message counts must equal the approved recipient count');
  }
  if (Object.keys(authorization?.derived_bindings?.approved_message_candidate_sha256 || {}).length !== approved.length) {
    pushError(errors, 'derived_message_count_mismatch', '/derived_bindings/approved_message_candidate_sha256', 'Approved message hash count must equal recipient count');
  }
  return { ok: errors.length === 0, errors };
}

export function buildPreliminaryRfqOutreachAuthorization({ packet, packetSha256, approval, authorizedAt }) {
  assertValidPreliminaryRfqOutreachPacket(packet);
  if (!isParseableTimestamp(authorizedAt)) throw serviceError('invalid_timestamp', 'Authorization timestamp must be an RFC 3339 timestamp');
  if (approval.packet_sha256 !== packetSha256) {
    throw serviceError('approval_packet_hash_mismatch', 'Approval packet SHA-256 does not match the current packet bytes');
  }
  if (approval.decision !== 'approve' || approval.accept_safe_defaults !== 'yes' || approval.confidentiality !== 'internal') {
    throw serviceError('approval_semantics_invalid', 'Approval must explicitly approve the packet and accept the internal safe defaults');
  }
  if (typeof approval.sender_identity !== 'string' || approval.sender_identity.length < 3) {
    throw serviceError('approval_sender_identity_invalid', 'A human sender identity is required');
  }
  const discovery = safeObject(packet.sender_account_discovery);
  const allowedAccounts = discovery.status === 'single_connected_account_proposed'
    ? [discovery.proposed_account]
    : discovery.status === 'multiple_connected_accounts'
      ? discovery.proposed_accounts
      : [];
  if (!allowedAccounts.includes(approval.sender_account)) {
    throw serviceError('approval_sender_account_unconfirmed', 'sender_account must confirm one account discovered for this exact packet');
  }
  const { registry, messages, bundles } = packetManifests(packet);
  const packetRecipientIds = registry.recipients.map((entry) => entry.recipient_id);
  const approvedRecipientIds = resolveApprovedRecipientIds(approval.recipients, packetRecipientIds);
  const approvedSet = new Set(approvedRecipientIds);
  const rejectedRecipientIds = packetRecipientIds.filter((entry) => !approvedSet.has(entry));
  const candidateByRecipient = new Map(messages.candidates.map((entry) => [entry.recipient_id, entry]));
  const bundleById = new Map(bundles.bundles.map((entry) => [entry.bundle_id, entry]));
  const approvedMessages = Object.fromEntries(approvedRecipientIds.map((recipientId) => [
    recipientId,
    candidateByRecipient.get(recipientId).full_message_candidate_sha256,
  ]));
  const approvedBundleIds = [...new Set(approvedRecipientIds.map((recipientId) => candidateByRecipient.get(recipientId).attachment_bundle_id))];
  const approvedBundles = Object.fromEntries(approvedBundleIds.map((bundleId) => [bundleId, bundleById.get(bundleId).bundle_sha256]));
  const authorization = {
    artifact_type: 'preliminary_rfq_outreach_authorization',
    schema_version: OUTREACH_AUTHORIZATION_SCHEMA_VERSION,
    decision: 'approved',
    packet_sha256: packetSha256,
    approved_recipient_ids: approvedRecipientIds,
    rejected_recipient_ids: rejectedRecipientIds,
    authorized_sender_identity: approval.sender_identity,
    authorized_sending_account: approval.sender_account,
    confidentiality: {
      classification: GATE_A_SAFE_DEFAULTS.confidentiality_classification,
      notice_required: GATE_A_SAFE_DEFAULTS.confidentiality_notice_required,
    },
    authorized_at: authorizedAt,
    operation_scope: [PRELIMINARY_RFQ_GATE_ID],
    prohibited_operations: [...FIXED_GATE_A_PROHIBITIONS],
    safe_defaults: { ...GATE_A_SAFE_DEFAULTS },
    derived_bindings: {
      packet_version: packet.packet_version,
      recipient_count: approvedRecipientIds.length,
      maximum_number_of_messages: approvedRecipientIds.length,
      approved_message_candidate_sha256: approvedMessages,
      approved_attachment_bundle_sha256: approvedBundles,
    },
    deferred_decisions: structuredClone(GATE_A_DEFERRED_DECISIONS),
    dispatch_authorized: false,
    authorization_record_effect: 'records_gate_a_only_no_dispatch',
  };
  const result = validatePreliminaryRfqOutreachAuthorization(authorization);
  if (!result.ok) throw serviceError('invalid_outreach_authorization', 'Derived Gate A authorization failed validation', result.errors);
  return authorization;
}

export function validatePreliminaryRfqOutreachAuthorizationAgainstPacket({ authorization, packetBytes }) {
  const errors = [];
  const authorizationResult = validatePreliminaryRfqOutreachAuthorization(authorization);
  if (!authorizationResult.ok) errors.push(...authorizationResult.errors);
  let packet;
  let bytes;
  try {
    bytes = Buffer.isBuffer(packetBytes) ? packetBytes : Buffer.from(packetBytes || []);
    packet = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: true });
  } catch (error) {
    pushError(errors, error?.code || 'packet_json_invalid', '/', `Bound packet JSON is invalid: ${error.message}`);
    return { ok: false, errors };
  }
  const packetResult = validatePreliminaryRfqOutreachPacket(packet);
  if (!packetResult.ok) errors.push(...packetResult.errors);
  const actualPacketSha = sha256Bytes(bytes);
  if (authorization?.packet_sha256 !== actualPacketSha) {
    pushError(errors, 'authorization_packet_hash_mismatch', '/packet_sha256', 'Authorization no longer matches the exact packet bytes');
  }
  const { registry, messages, bundles } = packetManifests(packet);
  const packetRecipientIds = (registry.recipients || []).map((entry) => entry.recipient_id);
  const approved = Array.isArray(authorization?.approved_recipient_ids) ? authorization.approved_recipient_ids : [];
  const approvedSet = new Set(approved);
  const expectedRejected = packetRecipientIds.filter((entry) => !approvedSet.has(entry));
  if (approved.some((entry) => !packetRecipientIds.includes(entry))
      || !sameStringArray(authorization?.rejected_recipient_ids, expectedRejected)) {
    pushError(errors, 'authorization_recipient_binding_mismatch', '/approved_recipient_ids', 'Authorization recipient partition no longer matches the packet');
  }
  const candidateByRecipient = new Map((messages.candidates || []).map((entry) => [entry.recipient_id, entry]));
  const expectedMessages = Object.fromEntries(approved.map((recipientId) => [
    recipientId,
    candidateByRecipient.get(recipientId)?.full_message_candidate_sha256,
  ]));
  if (JSON.stringify(authorization?.derived_bindings?.approved_message_candidate_sha256) !== JSON.stringify(expectedMessages)) {
    pushError(errors, 'authorization_message_binding_mismatch', '/derived_bindings/approved_message_candidate_sha256', 'Authorization message hashes no longer match the packet');
  }
  const selectedBundleIds = [...new Set(approved.map((recipientId) => candidateByRecipient.get(recipientId)?.attachment_bundle_id))];
  const bundleById = new Map((bundles.bundles || []).map((entry) => [entry.bundle_id, entry]));
  const expectedBundles = Object.fromEntries(selectedBundleIds.map((bundleId) => [bundleId, bundleById.get(bundleId)?.bundle_sha256]));
  if (JSON.stringify(authorization?.derived_bindings?.approved_attachment_bundle_sha256) !== JSON.stringify(expectedBundles)) {
    pushError(errors, 'authorization_bundle_binding_mismatch', '/derived_bindings/approved_attachment_bundle_sha256', 'Authorization attachment bundle hashes no longer match the packet');
  }
  if (authorization?.derived_bindings?.packet_version !== packet.packet_version) {
    pushError(errors, 'authorization_packet_version_mismatch', '/derived_bindings/packet_version', 'Authorization packet version no longer matches');
  }
  return { ok: errors.length === 0, errors, packet };
}

export function authorizationSatisfiesGate(authorization, gateId, { packetBytes } = {}) {
  if (gateId !== PRELIMINARY_RFQ_GATE_ID) return false;
  return validatePreliminaryRfqOutreachAuthorizationAgainstPacket({ authorization, packetBytes }).ok
    && sameStringArray(authorization.operation_scope, [PRELIMINARY_RFQ_GATE_ID])
    && authorization.dispatch_authorized === false;
}

function assertLexicallySafePath(pathValue, label) {
  const raw = String(pathValue || '');
  if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('~') || raw.split('/').includes('..')) {
    throw serviceError('unsafe_path', `${label} contains traversal, NUL, backslash, or home-expansion syntax`);
  }
  return raw;
}

function resolveInsideProject(projectRoot, pathValue, label) {
  const root = resolve(projectRoot);
  const raw = assertLexicallySafePath(pathValue, label);
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw serviceError('unsafe_path', `${label} must stay inside the repository root`);
  return { root, absolute, relative: rel };
}

async function readStableFile({ projectRoot, path, label, maxBytes }) {
  const resolved = resolveInsideProject(projectRoot, path, label);
  if (await realpath(dirname(resolved.absolute)) !== dirname(resolved.absolute)) {
    throw serviceError('unsafe_input', `${label} parent directory must not resolve through a symlink`);
  }
  const info = await lstat(resolved.absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maxBytes) {
    throw serviceError('unsafe_input', `${label} must be a bounded regular non-symlink file`);
  }
  const handle = await open(resolved.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw serviceError('input_changed', `${label} changed while it was read`);
    }
    return { ...resolved, bytes, sha256: sha256Bytes(bytes) };
  } finally {
    await handle.close();
  }
}

export async function verifyPreliminaryRfqOutreachPacketAttachmentBytes({ projectRoot, packet }) {
  assertValidPreliminaryRfqOutreachPacket(packet);
  const errors = [];
  const observed = new Map();
  for (const bundle of packet.attachment_bundles.bundles) {
    for (const file of bundle.exact_file_list) {
      const prior = observed.get(file.path);
      if (prior && (prior.sha256 !== file.sha256 || prior.byte_size !== file.byte_size)) {
        pushError(errors, 'attachment_binding_conflict', file.path, 'The same attachment path has conflicting packet bindings');
        continue;
      }
      observed.set(file.path, file);
    }
  }
  for (const file of observed.values()) {
    try {
      const snapshot = await readStableFile({
        projectRoot,
        path: file.path,
        label: `attachment ${file.path}`,
        maxBytes: 256 * 1024 * 1024,
      });
      if (snapshot.bytes.length !== file.byte_size || snapshot.sha256 !== file.sha256) {
        pushError(errors, 'attachment_bytes_mismatch', file.path, 'Attachment bytes no longer match the packet binding');
      }
    } catch (error) {
      pushError(errors, error?.code || 'attachment_unreadable', file.path, error.message);
    }
  }
  return { ok: errors.length === 0, errors, unique_attachment_count: observed.size };
}

function pathIsIgnored(projectRoot, relativePath) {
  const result = spawnSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: projectRoot, stdio: 'ignore' });
  return result.status === 0;
}

async function prepareImmutablePrivateOutput({ projectRoot, path, label }) {
  const resolved = resolveInsideProject(projectRoot, path, label);
  if (!['local/', 'output/', 'tmp/codex/'].some((prefix) => resolved.relative.startsWith(prefix))) {
    throw serviceError('unsafe_output_path', `${label} must stay under ignored local/, output/, or tmp/codex/`);
  }
  if (!pathIsIgnored(resolved.root, resolved.relative)) {
    throw serviceError('tracked_output_forbidden', `${label} must be ignored by git: ${resolved.relative}`);
  }
  let existingAncestor = dirname(resolved.absolute);
  while (true) {
    try {
      const info = await lstat(existingAncestor);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(existingAncestor) !== existingAncestor) {
        throw serviceError('unsafe_output_path', `${label} ancestor is not a real non-symlink directory`);
      }
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw serviceError('unsafe_output_path', `${label} has no safe existing ancestor`);
      existingAncestor = parent;
    }
  }
  await mkdir(dirname(resolved.absolute), { recursive: true, mode: 0o700 });
  if (await realpath(dirname(resolved.absolute)) !== dirname(resolved.absolute)) {
    throw serviceError('unsafe_output_path', `${label} output directory resolves through a symlink`);
  }
  return resolved;
}

export async function recordPreliminaryRfqOutreachAuthorization({
  projectRoot,
  packetPath,
  decisionPath,
  outputPath,
  authorizedAt = new Date().toISOString(),
}) {
  const packetSnapshot = await readStableFile({
    projectRoot,
    path: packetPath,
    label: 'outreach packet',
    maxBytes: 8 * 1024 * 1024,
  });
  let packet;
  try {
    packet = parseInspectionEvidenceJsonBytes(packetSnapshot.bytes, { requireCanonical: true });
  } catch (error) {
    throw serviceError(error?.code || 'packet_json_invalid', `Outreach packet JSON is invalid: ${error.message}`);
  }
  assertValidPreliminaryRfqOutreachPacket(packet);
  const attachmentResult = await verifyPreliminaryRfqOutreachPacketAttachmentBytes({ projectRoot, packet });
  if (!attachmentResult.ok) {
    throw serviceError('attachment_integrity_failed', 'Outreach packet attachment byte verification failed', attachmentResult.errors);
  }
  const decisionSnapshot = await readStableFile({
    projectRoot,
    path: decisionPath,
    label: 'outreach approval response',
    maxBytes: 64 * 1024,
  });
  const approval = parseOneStepOutreachApproval(decisionSnapshot.bytes.toString('utf8'));
  const authorization = buildPreliminaryRfqOutreachAuthorization({
    packet,
    packetSha256: packetSnapshot.sha256,
    approval,
    authorizedAt,
  });
  const output = await prepareImmutablePrivateOutput({ projectRoot, path: outputPath, label: 'outreach authorization output' });
  const bytes = Buffer.from(serializeCanonicalJson(authorization), 'utf8');
  try {
    await writeFile(output.absolute, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw serviceError('authorization_record_exists', 'Authorization record already exists and cannot be overwritten');
    throw error;
  }
  return {
    authorization,
    output_path: output.relative,
    authorization_sha256: sha256Bytes(bytes),
    packet_sha256: packetSnapshot.sha256,
    decision_sha256: decisionSnapshot.sha256,
    dispatch_authorized: false,
  };
}
