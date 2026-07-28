import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMA_URLS = Object.freeze({
  envelope: new URL('../schemas/inspection-evidence-envelope.schema.json', import.meta.url),
  authorization: new URL('../schemas/inspection-evidence-authorization.schema.json', import.meta.url),
  attachment: new URL('../schemas/inspection-evidence-attachment-record.schema.json', import.meta.url),
  readinessAuthorization: new URL('../schemas/inspection-evidence-readiness-authorization.schema.json', import.meta.url),
  onboardingRecord: new URL('../schemas/inspection-evidence-onboarding-record.schema.json', import.meta.url),
});

function loadSchema(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validators = Object.freeze({
  envelope: ajv.compile(loadSchema(SCHEMA_URLS.envelope)),
  authorization: ajv.compile(loadSchema(SCHEMA_URLS.authorization)),
  attachment: ajv.compile(loadSchema(SCHEMA_URLS.attachment)),
  readinessAuthorization: ajv.compile(loadSchema(SCHEMA_URLS.readinessAuthorization)),
  onboardingRecord: ajv.compile(loadSchema(SCHEMA_URLS.onboardingRecord)),
});

export const INSPECTION_EVIDENCE_ONBOARDING_SCHEMA_VERSION = '1.0';

export function decodeInspectionEvidenceUtf8(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    .decode(input)
    .replace(/^\uFEFF/, '');
}

function jsonParseError(code, message) {
  const error = new SyntaxError(message);
  error.code = code;
  return error;
}

function assertNoDuplicateJsonObjectKeys(text) {
  const skipWhitespace = (start) => {
    let index = start;
    while (index < text.length && /\s/.test(text[index])) index += 1;
    return index;
  };
  const scanString = (start) => {
    let index = start + 1;
    while (index < text.length) {
      if (text[index] === '"') return index + 1;
      if (text[index] === '\\') {
        index += text[index + 1] === 'u' ? 6 : 2;
      } else {
        index += 1;
      }
    }
    throw jsonParseError('malformed_json_string', 'JSON string is not terminated');
  };
  const scanValue = (start, depth) => {
    if (depth > 256) throw jsonParseError('json_nesting_limit_exceeded', 'JSON nesting exceeds the control-document limit');
    let index = skipWhitespace(start);
    if (text[index] === '"') return scanString(index);
    if (text[index] === '[') {
      index = skipWhitespace(index + 1);
      if (text[index] === ']') return index + 1;
      while (index < text.length) {
        index = skipWhitespace(scanValue(index, depth + 1));
        if (text[index] === ']') return index + 1;
        index = skipWhitespace(index + 1);
      }
    }
    if (text[index] === '{') {
      const keys = new Set();
      index = skipWhitespace(index + 1);
      if (text[index] === '}') return index + 1;
      while (index < text.length) {
        const keyStart = index;
        const keyEnd = scanString(keyStart);
        const key = JSON.parse(text.slice(keyStart, keyEnd));
        if (keys.has(key)) {
          throw jsonParseError('duplicate_json_key', 'Duplicate JSON object keys are forbidden in inspection-evidence documents');
        }
        keys.add(key);
        index = skipWhitespace(keyEnd);
        index = skipWhitespace(index + 1);
        index = skipWhitespace(scanValue(index, depth + 1));
        if (text[index] === '}') return index + 1;
        index = skipWhitespace(index + 1);
      }
    }
    while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
    return index;
  };
  const end = skipWhitespace(scanValue(skipWhitespace(0), 0));
  if (end !== text.length) throw jsonParseError('malformed_json_trailing_content', 'JSON contains trailing content');
}

export function parseInspectionEvidenceJsonBytes(bytes, { requireCanonical = true } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (
    requireCanonical
    && input.length >= 3
    && input[0] === 0xef
    && input[1] === 0xbb
    && input[2] === 0xbf
  ) {
    throw jsonParseError(
      'noncanonical_inspection_evidence_json',
      'Inspection-evidence control JSON must not contain a UTF-8 byte-order mark'
    );
  }
  const text = decodeInspectionEvidenceUtf8(input);
  const document = JSON.parse(text);
  assertNoDuplicateJsonObjectKeys(text);
  if (requireCanonical && text !== serializeCanonicalJson(document)) {
    throw jsonParseError(
      'noncanonical_inspection_evidence_json',
      'Inspection-evidence control JSON must use the deterministic two-space encoding with one trailing newline'
    );
  }
  return document;
}

export const INSPECTION_EVIDENCE_STATES = Object.freeze([
  'discovered',
  'quarantined',
  'structurally_valid',
  'semantically_valid',
  'awaiting_authorization',
  'authorized',
  'attached',
  'rejected',
  'superseded',
]);

export const INSPECTION_EVIDENCE_TRANSITIONS = Object.freeze({
  discovered: Object.freeze(['quarantined']),
  quarantined: Object.freeze(['structurally_valid', 'rejected']),
  structurally_valid: Object.freeze(['semantically_valid', 'rejected']),
  semantically_valid: Object.freeze(['awaiting_authorization', 'rejected']),
  awaiting_authorization: Object.freeze(['authorized', 'rejected']),
  authorized: Object.freeze(['attached', 'rejected', 'superseded']),
  attached: Object.freeze(['superseded']),
  rejected: Object.freeze(['superseded']),
  superseded: Object.freeze([]),
});

const PLACEHOLDER_PATTERN = /^(?:unknown|null|n\/a|tbd|placeholder|redacted inspection trace)$/i;
const ABSOLUTE_MACHINE_PATH_PATTERN = /(?:^|[\s"'(<[{=:])(?:\/(?!\/)[^\s"'<>]+|[A-Za-z]:[\\/][^\s"'<>]+|\\\\[^\\\s]+\\[^\s"'<>]+)/i;
const FILE_URL_PATTERN = /file:\/\//i;
const SECRET_ASSIGNMENT_PATTERN = /(?:authorization\s*["']?\s*[:=]\s*["']?\s*(?:bearer|basic)\s+[^\s"',}\]]+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|session[_-]?(?:id|token)|cookie|set-cookie|jwt|signature|sig|x-amz-(?:signature|credential|security-token))\s*["']?\s*[:=]\s*["']?\s*[^\s"',}&}\]]+)/i;
const SENSITIVE_VALUE_KEY_PATTERN = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|session[_-]?(?:id|token)|cookie|set-cookie|jwt|signature|sig|x-amz-(?:signature|credential|security-token))$/i;
const SENSITIVE_URL_KEY_PATTERN = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|password|passwd|credential|x-amz-(?:signature|credential|security-token)|signature|sig)$/i;
const PRIVATE_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^\s/]*\.internal)(?:[/:]|$)/i;
const BYPASS_KEY_PATTERN = /(?:^|_)(?:force|override|exception|bypass|waive|skip)(?:_|$)/i;
const NON_GENUINE_PATTERN = /(?:^|[^A-Za-z0-9])(?:synthetic|fixture|surrogate|simulated|generated|inferred|non[-_ /]?evidence|test[-_ ]?only|example[-_ ]?only|template)(?:[^A-Za-z0-9]|$)/i;
const ALLOWED_NEGATIVE_CONTROL_KEYS = new Set(['exception_requested']);

function normalizeInstancePath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${basePath === '/' ? '' : basePath}/${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function schemaErrors(validator) {
  return (validator.errors || []).map((error) => ({
    code: `schema_${error.keyword}`,
    path: normalizeInstancePath(error),
    message: `${normalizeInstancePath(error)} ${error.message}`.trim(),
  }));
}

export function validateJsonDocumentBounds(document, { maxDepth = 64, maxNodes = 50_000 } = {}) {
  const stack = [{ value: document, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) {
      return { ok: false, errors: [{ code: 'json_node_limit_exceeded', path: '/', message: `JSON document exceeds ${maxNodes} nodes` }] };
    }
    if (!value || typeof value !== 'object') continue;
    if (depth > maxDepth) {
      return { ok: false, errors: [{ code: 'json_depth_limit_exceeded', path: '/', message: `JSON document exceeds depth ${maxDepth}` }] };
    }
    if (seen.has(value)) {
      return { ok: false, errors: [{ code: 'json_cycle_forbidden', path: '/', message: 'JSON document must not contain object cycles' }] };
    }
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
  return { ok: true, errors: [] };
}

function runSchemaValidator(kind, document) {
  const bounds = validateJsonDocumentBounds(document);
  if (!bounds.ok) return bounds;
  const validator = validators[kind];
  const ok = validator(document);
  return { ok: Boolean(ok), errors: ok ? [] : schemaErrors(validator) };
}

function withTimestampValidation(result, fields) {
  const errors = [...result.errors];
  fields.forEach(([value, path]) => {
    if (value !== undefined && value !== null && !isParseableTimestamp(value)) {
      errors.push({ code: 'schema_format', path, message: `${path} must be a valid RFC 3339-compatible timestamp` });
    }
  });
  return { ok: result.ok && errors.length === 0, errors };
}

export function validateInspectionEvidenceEnvelopeSchema(document) {
  return withTimestampValidation(runSchemaValidator('envelope', document), [
    [document?.inspection?.completed_at, '/inspection/completed_at'],
    [document?.review?.reviewed_at, '/review/reviewed_at'],
    [document?.authorization?.authorized_at, '/authorization/authorized_at'],
    [document?.provenance?.received_at, '/provenance/received_at'],
    ...((Array.isArray(document?.provenance?.custody_events) ? document.provenance.custody_events : [])
      .map((event, index) => [event?.occurred_at, `/provenance/custody_events/${index}/occurred_at`])),
    [document?.attachment?.requested_at, '/attachment/requested_at'],
    [document?.attachment?.attached_at, '/attachment/attached_at'],
  ]);
}

export function validateInspectionEvidenceAuthorizationSchema(document) {
  return withTimestampValidation(runSchemaValidator('authorization', document), [
    [document?.reviewer?.reviewed_at, '/reviewer/reviewed_at'],
    [document?.authorized_at, '/authorized_at'],
    [document?.confidentiality_review?.reviewed_at, '/confidentiality_review/reviewed_at'],
  ]);
}

export function validateInspectionEvidenceAttachmentRecordSchema(document) {
  return withTimestampValidation(runSchemaValidator('attachment', document), [
    [document?.attached_at, '/attached_at'],
    [document?.authorization?.authorized_at, '/authorization/authorized_at'],
  ]);
}

export function validateInspectionEvidenceReadinessAuthorizationSchema(document) {
  return withTimestampValidation(runSchemaValidator('readinessAuthorization', document), [
    [document?.authorized_at, '/authorized_at'],
  ]);
}

export function validateInspectionEvidenceOnboardingRecordSchema(document) {
  return withTimestampValidation(runSchemaValidator('onboardingRecord', document), [
    [document?.created_at, '/created_at'],
    [document?.updated_at, '/updated_at'],
    [document?.attachment?.attached_at, '/attachment/attached_at'],
    ...((Array.isArray(document?.transitions) ? document.transitions : [])
      .map((transition, index) => [transition?.at, `/transitions/${index}/at`])),
  ]);
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Json(value) {
  return sha256Bytes(serializeCanonicalJson(value));
}

export function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isParseableTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
    && !Number.isNaN(Date.parse(value));
}

function visitStrings(value, visitor, path = '') {
  if (typeof value === 'string') {
    visitor(value, path || '/');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStrings(entry, visitor, `${path}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, entry]) => visitStrings(entry, visitor, `${path}/${key}`));
}

function visitKeys(value, visitor, path = '') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitKeys(entry, visitor, `${path}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, entry]) => {
    visitor(key, `${path}/${key}`, entry);
    visitKeys(entry, visitor, `${path}/${key}`);
  });
}

function pushError(errors, code, path, message) {
  errors.push({ code, path, message });
}

const REVISION_LINEAGE_IDENTITY_KEYS = Object.freeze([
  'package_slug',
  'part_id',
  'revision',
  'config_sha256',
]);

function authoritativeIdentityErrors(errors, {
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
  packageSlug = null,
  partIdentifier = null,
  revision = null,
  path = '/',
} = {}) {
  if (requireAuthoritativeLineage !== true && requireAuthoritativeLineage !== false) {
    pushError(errors, 'malformed_identity', path, 'requireAuthoritativeLineage must be a boolean');
    return null;
  }
  if (requireAuthoritativeLineage !== true) return null;
  if (!authoritativeIdentity || typeof authoritativeIdentity !== 'object' || Array.isArray(authoritativeIdentity)) {
    pushError(errors, 'missing_identity', path, 'Proof evidence validation requires an authoritative revision-lineage identity');
    return null;
  }
  const keys = Object.keys(authoritativeIdentity).sort();
  const expectedKeys = [...REVISION_LINEAGE_IDENTITY_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    pushError(errors, 'malformed_identity', path, 'Authoritative revision-lineage identity must contain exactly package_slug, part_id, revision, and config_sha256');
    return null;
  }
  for (const key of ['package_slug', 'part_id', 'revision']) {
    if (typeof authoritativeIdentity[key] !== 'string' || !authoritativeIdentity[key].trim()) {
      pushError(errors, 'missing_identity', `${path}/${key}`.replace(/\/+/g, '/'), `Authoritative revision-lineage ${key} is required`);
    }
  }
  if (!isSha256(authoritativeIdentity.config_sha256)) {
    pushError(errors, 'malformed_identity', `${path}/config_sha256`.replace(/\/+/g, '/'), 'Authoritative revision-lineage config_sha256 must be lowercase SHA-256');
  }
  if (errors.some((error) => error.path === path || error.path.startsWith(`${path}/`.replace(/\/+/g, '/')))) return null;
  for (const [actual, expected, field] of [
    [packageSlug, authoritativeIdentity.package_slug, 'package_slug'],
    [partIdentifier, authoritativeIdentity.part_id, 'part_id'],
    [revision, authoritativeIdentity.revision, 'revision'],
  ]) {
    if (actual !== null && actual !== undefined && actual !== expected) {
      pushError(errors, 'conflicting_identity', path, `${field} does not match the authoritative revision-lineage identity`);
    }
  }
  return authoritativeIdentity;
}

function inspectHttpUrls(value, path, errors) {
  const matches = String(value).match(/https?:\/\/[^\s"'<>]+/ig) || [];
  for (const rawUrl of matches) {
    let parsed;
    try {
      parsed = new URL(rawUrl.replace(/[),.;]+$/, ''));
    } catch {
      continue;
    }
    if (parsed.username || parsed.password) {
      pushError(errors, 'secret_material_exposed', path, `${path} must not contain URL userinfo credentials`);
    }
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_URL_KEY_PATTERN.test(key)) {
        pushError(errors, 'secret_material_exposed', path, `${path} must not contain signed or credential-bearing URL parameters`);
        break;
      }
    }
    const fragment = parsed.hash.replace(/^#/, '');
    if (fragment && SECRET_ASSIGNMENT_PATTERN.test(fragment)) {
      pushError(errors, 'secret_material_exposed', path, `${path} must not contain credentials in a URL fragment`);
    }
  }
}

function validateNoPrivateOrBypassMaterial(document, errors) {
  visitStrings(document, (value, path) => {
    if (ABSOLUTE_MACHINE_PATH_PATTERN.test(value) || FILE_URL_PATTERN.test(value)) {
      pushError(errors, 'private_path_exposed', path, `${path} must not expose a private or absolute machine path`);
    }
    if (SECRET_ASSIGNMENT_PATTERN.test(value)) {
      pushError(errors, 'secret_material_exposed', path, `${path} must not contain credentials, tokens, or authorization headers`);
    }
    if (PRIVATE_URL_PATTERN.test(value)) {
      pushError(errors, 'private_url_exposed', path, `${path} must not contain a private or local URL`);
    }
    inspectHttpUrls(value, path, errors);
  });
  visitKeys(document, (key, path, value) => {
    const isRequiredNegativeControl = ALLOWED_NEGATIVE_CONTROL_KEYS.has(key) && value === false;
    if (BYPASS_KEY_PATTERN.test(key) && !isRequiredNegativeControl) {
      pushError(errors, 'unauthorized_exception_attempt', path, `${path} is an unsupported force/override/exception/bypass field`);
    }
    if (SENSITIVE_VALUE_KEY_PATTERN.test(key) && typeof value === 'string' && value.trim()) {
      pushError(errors, 'secret_material_exposed', path, `${path} must not contain credential-bearing fields`);
    }
  });
}

export function validateInspectionEvidenceControlMaterial(document) {
  const errors = [];
  validateNoPrivateOrBypassMaterial(document, errors);
  return { ok: errors.length === 0, errors };
}

export function isValidInspectionEvidenceIdentityRef(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 256 || PLACEHOLDER_PATTERN.test(normalized)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@+-]+$/.test(normalized)) return false;
  return validateInspectionEvidenceControlMaterial({ identity_ref: normalized }).ok;
}

export function summarizeInspectionEvidenceResults(envelope) {
  const characteristics = Array.isArray(envelope?.measured_characteristics)
    ? envelope.measured_characteristics
    : [];
  const nonconformingCharacteristicCount = characteristics.filter((item) => item?.result !== 'pass').length;
  const overallResult = envelope?.inspection?.overall_result ?? null;
  return {
    inspection_status: envelope?.inspection?.status ?? null,
    overall_result: overallResult,
    characteristic_count: characteristics.length,
    nonconforming_characteristic_count: nonconformingCharacteristicCount,
    readiness_disposition: (
      overallResult === 'pass'
      && characteristics.length > 0
      && nonconformingCharacteristicCount === 0
    ) ? 'conforming' : 'hold_nonconforming',
  };
}

export function buildAttachedInspectionEvidenceEnvelope({
  candidateEnvelope,
  authorization,
  authorizationRef,
  authorizationSha256,
  attachedAt,
  sourceSha256,
  quarantineTransition,
} = {}) {
  const envelope = JSON.parse(JSON.stringify(candidateEnvelope));
  envelope.lifecycle_state = 'attached';
  envelope.review.reviewed_at = authorization.reviewer.reviewed_at;
  envelope.authorization = {
    status: 'authorized',
    authorization_id: authorization.authorization_id,
    record_ref: authorizationRef,
    record_sha256: authorizationSha256,
    authorized_by_ref: authorization.authorizer.identity_ref,
    authorized_at: authorization.authorized_at,
    operation_scope: ['attach'],
  };
  if (Date.parse(envelope.attachment.requested_at) < Date.parse(authorization.reviewer.reviewed_at)) {
    envelope.attachment.requested_at = authorization.reviewer.reviewed_at;
  }
  envelope.attachment.attached_at = attachedAt;
  envelope.provenance.custody_events = [
    ...envelope.provenance.custody_events.filter((event) => event.event_type === 'received'),
    {
      event_type: 'quarantined',
      occurred_at: quarantineTransition.at,
      actor_ref: quarantineTransition.actor_ref,
      source_sha256: sourceSha256,
    },
    {
      event_type: 'reviewed',
      occurred_at: authorization.reviewer.reviewed_at,
      actor_ref: envelope.review.reviewer_identity_ref,
      source_sha256: sourceSha256,
    },
    {
      event_type: 'authorized',
      occurred_at: authorization.authorized_at,
      actor_ref: authorization.authorizer.identity_ref,
      source_sha256: sourceSha256,
    },
    {
      event_type: 'attached',
      occurred_at: attachedAt,
      actor_ref: authorization.authorizer.identity_ref,
      source_sha256: sourceSha256,
    },
  ].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
  return envelope;
}

export function validateAttachedInspectionEvidenceEnvelopeTransformation({
  candidateEnvelope,
  attachedEnvelope,
  authorization,
  authorizationRef,
  authorizationSha256,
  attachedAt,
  sourceSha256,
  quarantineTransition,
} = {}) {
  const expected = buildAttachedInspectionEvidenceEnvelope({
    candidateEnvelope,
    authorization,
    authorizationRef,
    authorizationSha256,
    attachedAt,
    sourceSha256,
    quarantineTransition,
  });
  if (serializeCanonicalJson(expected) === serializeCanonicalJson(attachedEnvelope)) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [{
      code: 'attached_envelope_transform_mismatch',
      path: '/envelope',
      message: 'Canonical attached envelope must be the exact allowed transformation of the authorization-bound candidate envelope',
    }],
  };
}

export function findNonGenuineStringMarkers(document) {
  const markers = [];
  visitStrings(document, (value, path) => {
    if (NON_GENUINE_PATTERN.test(value)) markers.push({ path, value });
  });
  return markers;
}

function validateIdentity(value, path, errors) {
  if (!isValidInspectionEvidenceIdentityRef(value)) {
    pushError(errors, 'identity_provenance_missing', path, `${path} must contain an explicit authorized identity reference`);
  }
}

function validateNonPlaceholder(value, path, errors) {
  if (typeof value !== 'string' || !value.trim() || PLACEHOLDER_PATTERN.test(value.trim())) {
    pushError(errors, 'required_value_missing', path, `${path} must contain an explicit non-placeholder value`);
  }
}

function validateTimestamp(value, path, errors) {
  if (!isParseableTimestamp(value)) {
    pushError(errors, 'invalid_timestamp', path, `${path} must be an RFC 3339-compatible timestamp`);
  }
}

export function validateInspectionEvidenceEnvelopeSemantics(document, {
  candidateSha256 = null,
  candidateSizeBytes = null,
  candidateFilename = null,
  candidateMediaType = null,
  packageSlug = null,
  packageRevision = null,
  authoritativePackageRevision = null,
  authoritativeSubjectIdentifier = null,
  requireAuthorized = false,
  requireAttached = false,
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
} = {}) {
  const structural = validateInspectionEvidenceEnvelopeSchema(document);
  if (!structural.ok) return structural;

  const errors = [];
  validateNoPrivateOrBypassMaterial(document, errors);
  authoritativeIdentityErrors(errors, {
    requireAuthoritativeLineage,
    authoritativeIdentity,
    packageSlug: document.package.slug,
    partIdentifier: document.subject.identifier,
    revision: document.package.revision,
    path: '/revision-lineage-binding',
  });

  if (document.synthetic !== false) {
    pushError(errors, 'synthetic_fixture_forbidden', '/synthetic', 'Synthetic, fixture, surrogate, or test-only envelopes can never satisfy production inspection_evidence');
  }
  if (findNonGenuineStringMarkers(document).length > 0) {
    pushError(errors, 'non_genuine_content_marker', '/', 'Envelope content marks the record as synthetic, fixture, generated, inferred, surrogate, or non-evidence');
  }
  if (packageSlug && document.package.slug !== packageSlug) {
    pushError(errors, 'package_mismatch', '/package/slug', `Envelope package slug must match ${packageSlug}`);
  }
  if (packageRevision && document.package.revision !== packageRevision) {
    pushError(errors, 'revision_mismatch', '/package/revision', `Envelope package revision must match requested revision ${packageRevision}`);
  }
  if (!authoritativePackageRevision) {
    pushError(errors, 'authoritative_revision_missing', '/package/revision', 'An authoritative configured package revision is required; revision guessing is forbidden');
  } else if (document.package.revision !== authoritativePackageRevision) {
    pushError(errors, 'authoritative_revision_mismatch', '/package/revision', `Envelope revision must match authoritative package revision ${authoritativePackageRevision}`);
  }
  if (document.subject.revision !== document.package.revision) {
    pushError(errors, 'subject_revision_mismatch', '/subject/revision', 'Inspected subject revision must match the package revision');
  }
  if (document.subject.identifier_type !== 'part') {
    pushError(errors, 'subject_identifier_type_unmapped', '/subject/identifier_type', 'Production attachment currently requires a part identifier mapped to the canonical package config; drawing, assembly, and lot mappings are not yet implemented');
  } else if (!authoritativeSubjectIdentifier) {
    pushError(errors, 'authoritative_subject_missing', '/subject/identifier', 'An authoritative subject identifier from the canonical package config is required');
  } else if (document.subject.identifier !== authoritativeSubjectIdentifier) {
    pushError(errors, 'subject_identifier_mismatch', '/subject/identifier', `Envelope subject identifier must match canonical package part ${authoritativeSubjectIdentifier}`);
  }
  if (candidateSha256 && document.source.document.sha256 !== candidateSha256) {
    pushError(errors, 'source_checksum_mismatch', '/source/document/sha256', 'Envelope source checksum does not match the quarantined candidate bytes');
  }
  if (candidateSizeBytes !== null && document.source.document.size_bytes !== candidateSizeBytes) {
    pushError(errors, 'source_size_mismatch', '/source/document/size_bytes', 'Envelope source size does not match the quarantined candidate bytes');
  }
  if (candidateFilename && document.source.document.original_filename !== candidateFilename) {
    pushError(errors, 'source_filename_mismatch', '/source/document/original_filename', 'Envelope source filename does not match the sanitized received filename');
  }
  if (candidateMediaType && document.source.document.media_type !== candidateMediaType) {
    pushError(errors, 'source_media_type_mismatch', '/source/document/media_type', 'Envelope source media type does not match the quarantined source container');
  }

  validateTimestamp(document.inspection.completed_at, '/inspection/completed_at', errors);
  validateTimestamp(document.review.reviewed_at, '/review/reviewed_at', errors);
  validateTimestamp(document.provenance.received_at, '/provenance/received_at', errors);
  validateTimestamp(document.attachment.requested_at, '/attachment/requested_at', errors);
  validateIdentity(document.inspection.inspector_identity_ref, '/inspection/inspector_identity_ref', errors);
  validateIdentity(document.review.reviewer_identity_ref, '/review/reviewer_identity_ref', errors);
  validateNonPlaceholder(document.subject.identifier, '/subject/identifier', errors);
  validateNonPlaceholder(document.source.organization, '/source/organization', errors);
  validateNonPlaceholder(document.source.source_record_id, '/source/source_record_id', errors);
  validateNonPlaceholder(document.inspection.method, '/inspection/method', errors);
  validateNonPlaceholder(document.provenance.origin_reference, '/provenance/origin_reference', errors);

  if (document.inspection.overall_result === 'partial') {
    pushError(errors, 'inspection_incomplete', '/inspection/overall_result', 'A partial inspection result cannot satisfy production inspection_evidence');
  }

  if (Date.parse(document.review.reviewed_at) < Date.parse(document.inspection.completed_at)) {
    pushError(errors, 'review_before_inspection_complete', '/review/reviewed_at', 'Review timestamp must not precede inspection completion');
  }
  if (document.measured_characteristics.some((item) => PLACEHOLDER_PATTERN.test(String(item.unit || '')))) {
    pushError(errors, 'measurement_unit_missing', '/measured_characteristics', 'Every measured characteristic requires an explicit non-placeholder unit');
  }
  const specRefs = new Set(document.specification_references);
  document.specification_references.forEach((value, index) => {
    validateNonPlaceholder(value, `/specification_references/${index}`, errors);
  });
  document.measured_characteristics.forEach((item, index) => {
    validateNonPlaceholder(item.characteristic_id, `/measured_characteristics/${index}/characteristic_id`, errors);
    validateNonPlaceholder(item.specification_ref, `/measured_characteristics/${index}/specification_ref`, errors);
    validateNonPlaceholder(item.unit, `/measured_characteristics/${index}/unit`, errors);
    if (typeof item.measured_value === 'string') {
      validateNonPlaceholder(item.measured_value, `/measured_characteristics/${index}/measured_value`, errors);
    }
    if (!specRefs.has(item.specification_ref)) {
      pushError(errors, 'specification_reference_unbound', `/measured_characteristics/${index}/specification_ref`, 'Characteristic specification_ref must be listed in specification_references');
    }
  });
  if (summarizeInspectionEvidenceResults(document).readiness_disposition === 'hold_nonconforming'
    && document.inspection.overall_result === 'pass') {
    pushError(errors, 'inspection_result_inconsistent', '/inspection/overall_result', 'An overall pass cannot contain failed or not-accepted measured characteristics');
  }
  document.provenance.custody_events.forEach((event, index) => {
    validateTimestamp(event.occurred_at, `/provenance/custody_events/${index}/occurred_at`, errors);
    validateIdentity(event.actor_ref, `/provenance/custody_events/${index}/actor_ref`, errors);
    if (candidateSha256 && event.source_sha256 !== candidateSha256) {
      pushError(errors, 'provenance_checksum_mismatch', `/provenance/custody_events/${index}/source_sha256`, 'Every custody event must bind the quarantined source checksum');
    }
    if (index > 0 && Date.parse(event.occurred_at) < Date.parse(document.provenance.custody_events[index - 1].occurred_at)) {
      pushError(errors, 'custody_time_reversal', `/provenance/custody_events/${index}/occurred_at`, 'Custody events must be ordered monotonically by timestamp');
    }
  });
  const custodyTypes = new Set(document.provenance.custody_events.map((event) => event.event_type));
  const receivedEvents = document.provenance.custody_events.filter((event) => event.event_type === 'received');
  if (receivedEvents.length !== 1) {
    pushError(errors, 'received_custody_event_missing', '/provenance/custody_events', 'Evidence provenance requires a received custody event');
  } else if (receivedEvents[0].occurred_at !== document.provenance.received_at) {
    pushError(errors, 'received_timestamp_binding_mismatch', '/provenance/custody_events', 'The received custody event must match provenance.received_at');
  }

  if (requireAuthorized || requireAttached) {
    if (document.authorization.status !== 'authorized') {
      pushError(errors, 'authorization_missing', '/authorization/status', 'Authoritative attachment requires explicit authorized status');
    }
    validateIdentity(document.authorization.authorized_by_ref, '/authorization/authorized_by_ref', errors);
    validateTimestamp(document.authorization.authorized_at, '/authorization/authorized_at', errors);
  } else if (document.authorization.status !== 'pending') {
    pushError(errors, 'premature_authorization_claim', '/authorization/status', 'Pre-authorization envelope must remain pending');
  }

  if (!requireAuthorized && !requireAttached) {
    if (!['discovered', 'quarantined'].includes(document.lifecycle_state)) {
      pushError(errors, 'premature_lifecycle_claim', '/lifecycle_state', 'Pre-authorization envelope may only claim discovered or quarantined state');
    }
    if (document.provenance.custody_events.some((event) => ['authorized', 'attached'].includes(event.event_type))) {
      pushError(errors, 'premature_custody_claim', '/provenance/custody_events', 'Pre-authorization envelope must not claim authorization or attachment custody events');
    }
  }

  if (Date.parse(document.attachment.requested_at) < Date.parse(document.review.reviewed_at)) {
    pushError(errors, 'attachment_requested_before_review', '/attachment/requested_at', 'Attachment request timestamp must not precede review approval');
  }
  if (Date.parse(document.attachment.requested_at) < Date.parse(document.provenance.received_at)) {
    pushError(errors, 'attachment_requested_before_receipt', '/attachment/requested_at', 'Attachment request timestamp must not precede evidence receipt');
  }
  if ((requireAuthorized || requireAttached) && Date.parse(document.authorization.authorized_at) < Date.parse(document.attachment.requested_at)) {
    pushError(errors, 'authorization_before_attachment_request', '/authorization/authorized_at', 'Attachment authorization must not precede the attachment request');
  }

  if (requireAttached) {
    if (document.lifecycle_state !== 'attached') {
      pushError(errors, 'attachment_state_missing', '/lifecycle_state', 'Attached authoritative envelope must have lifecycle_state attached');
    }
    validateTimestamp(document.attachment.attached_at, '/attachment/attached_at', errors);
    if (!document.provenance.custody_events.some((event) => event.event_type === 'attached')) {
      pushError(errors, 'attachment_custody_event_missing', '/provenance/custody_events', 'Attached envelope requires an attached custody event');
    }
    for (const eventType of ['quarantined', 'reviewed', 'authorized']) {
      if (!custodyTypes.has(eventType)) {
        pushError(errors, `${eventType}_custody_event_missing`, '/provenance/custody_events', `Attached envelope requires a ${eventType} custody event`);
      }
    }
    const exactBindings = [
      ['reviewed', document.review.reviewed_at],
      ['authorized', document.authorization.authorized_at],
      ['attached', document.attachment.attached_at],
    ];
    for (const [eventType, expectedAt] of exactBindings) {
      const matches = document.provenance.custody_events.filter((event) => event.event_type === eventType);
      if (matches.length !== 1 || matches[0].occurred_at !== expectedAt) {
        pushError(errors, `${eventType}_timestamp_binding_mismatch`, '/provenance/custody_events', `Attached envelope requires exactly one ${eventType} custody event bound to its authoritative timestamp`);
      }
    }
    const quarantinedEvents = document.provenance.custody_events.filter((event) => event.event_type === 'quarantined');
    if (quarantinedEvents.length !== 1) {
      pushError(errors, 'quarantined_custody_event_ambiguous', '/provenance/custody_events', 'Attached envelope requires exactly one quarantine custody event');
    }
    if (Date.parse(document.attachment.attached_at) < Date.parse(document.authorization.authorized_at)) {
      pushError(errors, 'attachment_before_authorization', '/attachment/attached_at', 'Attachment timestamp must not precede authorization');
    }
  } else if (document.attachment.attached_at !== null) {
    pushError(errors, 'premature_attachment_claim', '/attachment/attached_at', 'Candidate envelope must not claim an attachment timestamp before attachment');
  }

  return { ok: errors.length === 0, errors };
}

function normalizedRedactionStatus(value) {
  if (value === 'not_applicable') return 'not_required';
  if (value === 'not_redacted') return 'reviewed_no_redaction';
  return value;
}

export function validateInspectionEvidenceCandidateEnvelopeBinding(normalization, envelope, {
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
} = {}) {
  const structural = validateInspectionEvidenceEnvelopeSchema(envelope);
  if (!structural.ok) return structural;
  const errors = [];
  const mapping = normalization?.envelope_mapping;
  if (!normalization || typeof normalization !== 'object' || !mapping || typeof mapping !== 'object') {
    pushError(errors, 'normalization_candidate_binding_missing', '/normalization', 'Candidate-envelope binding requires one normalized result mapping');
    return { ok: false, errors };
  }
  if (normalization.status !== 'ready_for_quarantine_review') {
    pushError(errors, 'normalization_candidate_not_ready', '/normalization/status', 'Only a normalized result ready_for_quarantine_review can enter candidate-envelope review');
  }
  if (normalization.boundaries?.inspection_evidence !== false
    || normalization.boundaries?.authorization_created !== false
    || normalization.boundaries?.evidence_attached !== false
    || normalization.boundaries?.readiness_regenerated !== false) {
    pushError(errors, 'normalization_trust_boundary_invalid', '/normalization/boundaries', 'Normalization must retain its untrusted, non-authorizing boundary');
  }
  const bindings = [
    [envelope.package.slug, normalization.plan_binding?.package_slug, '/package/slug'],
    [envelope.package.revision, normalization.plan_binding?.revision, '/package/revision'],
    [mapping.package?.slug, normalization.plan_binding?.package_slug, '/normalization/envelope_mapping/package/slug'],
    [mapping.package?.revision, normalization.plan_binding?.revision, '/normalization/envelope_mapping/package/revision'],
    [envelope.package.slug, mapping.package?.slug, '/package/slug'],
    [envelope.package.revision, mapping.package?.revision, '/package/revision'],
    [envelope.subject.identifier, mapping.subject?.identifier, '/subject/identifier'],
    [envelope.subject.identifier_type, mapping.subject?.identifier_type, '/subject/identifier_type'],
    [envelope.subject.revision, mapping.subject?.revision, '/subject/revision'],
    [envelope.source.organization, mapping.source?.organization, '/source/organization'],
    [envelope.source.source_type, mapping.source?.source_type, '/source/source_type'],
    [envelope.source.source_record_id, mapping.source?.source_record_id, '/source/source_record_id'],
    [envelope.source.document.original_filename, mapping.source?.document?.original_filename, '/source/document/original_filename'],
    [envelope.source.document.media_type, mapping.source?.document?.media_type, '/source/document/media_type'],
    [envelope.source.document.size_bytes, mapping.source?.document?.size_bytes, '/source/document/size_bytes'],
    [envelope.source.document.sha256, mapping.source?.document?.sha256, '/source/document/sha256'],
    [envelope.source.document.sha256, normalization.source_snapshot?.source_sha256, '/source/document/sha256'],
    [envelope.source.document.size_bytes, normalization.source_snapshot?.source_size_bytes, '/source/document/size_bytes'],
    [envelope.inspection.method, mapping.inspection?.method, '/inspection/method'],
    [envelope.inspection.status, mapping.inspection?.status, '/inspection/status'],
    [envelope.inspection.completed_at, mapping.inspection?.completed_at, '/inspection/completed_at'],
    [envelope.inspection.inspector_identity_ref, mapping.inspection?.inspector_identity_ref, '/inspection/inspector_identity_ref'],
    [envelope.inspection.overall_result, mapping.inspection?.overall_result, '/inspection/overall_result'],
    [envelope.provenance.origin_reference, mapping.provenance?.origin_reference, '/provenance/origin_reference'],
    [envelope.source.document.sha256, mapping.provenance?.source_sha256, '/provenance/custody_events'],
    [envelope.confidentiality.classification, mapping.confidentiality?.classification, '/confidentiality/classification'],
    [envelope.confidentiality.redaction_status, normalizedRedactionStatus(mapping.confidentiality?.redaction_status), '/confidentiality/redaction_status'],
  ];
  for (const [actual, expected, path] of bindings) {
    if (actual !== expected) {
      pushError(errors, 'normalization_candidate_binding_mismatch', path, `${path} does not match the normalized result mapping`);
    }
  }
  if (JSON.stringify(envelope.confidentiality.redacted_fields) !== JSON.stringify(mapping.confidentiality?.redacted_fields || [])) {
    pushError(errors, 'normalization_candidate_binding_mismatch', '/confidentiality/redacted_fields', 'Candidate redacted fields do not match the normalized result mapping');
  }
  const actualMeasurements = envelope.measured_characteristics.map((item) => ({
    characteristic_id: item.characteristic_id,
    specification_ref: item.specification_ref,
    measured_value: item.measured_value,
    unit: item.unit,
    result: item.result,
  }));
  if (JSON.stringify(actualMeasurements) !== JSON.stringify(mapping.measured_characteristics)) {
    pushError(errors, 'normalization_candidate_binding_mismatch', '/measured_characteristics', 'Candidate measurements do not match the normalized result mapping');
  }
  if (JSON.stringify(envelope.specification_references) !== JSON.stringify(mapping.specification_references)) {
    pushError(errors, 'normalization_candidate_binding_mismatch', '/specification_references', 'Candidate specification references do not match the normalized result mapping');
  }
  if (envelope.provenance.custody_events.some((event) => event.source_sha256 !== normalization.source_snapshot?.source_sha256)) {
    pushError(errors, 'normalization_candidate_binding_mismatch', '/provenance/custody_events', 'Every candidate custody event must retain the normalized source digest');
  }
  authoritativeIdentityErrors(errors, {
    requireAuthoritativeLineage,
    authoritativeIdentity,
    packageSlug: envelope.package.slug,
    partIdentifier: envelope.subject.identifier,
    revision: envelope.package.revision,
    path: '/revision-lineage-binding',
  });
  return { ok: errors.length === 0, errors };
}

export function validateInspectionEvidenceReadinessAuthorizationBinding(authorization, {
  attachmentRecord,
  attachmentRecordRef,
  attachmentRecordSha256,
  reviewPackSha256,
  currentReadinessSha256,
  currentReadinessMarkdownSha256,
  readinessOutputRef,
  reviewPackIdentity = null,
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
} = {}) {
  const structural = validateInspectionEvidenceReadinessAuthorizationSchema(authorization);
  if (!structural.ok) return structural;
  const attachmentStructural = validateInspectionEvidenceAttachmentRecordSchema(attachmentRecord);
  if (!attachmentStructural.ok) {
    return {
      ok: false,
      errors: attachmentStructural.errors.map((error) => ({
        ...error,
        code: `attachment_${error.code}`,
        path: `/attachment${error.path === '/' ? '' : error.path}`,
      })),
    };
  }
  const errors = [];
  validateNoPrivateOrBypassMaterial(authorization, errors);
  if (findNonGenuineStringMarkers(authorization).length > 0) {
    pushError(errors, 'synthetic_readiness_authorization_forbidden', '/authorization', 'Synthetic, fixture, generated, or test-only authorization cannot regenerate production readiness');
  }
  const expected = {
    package_slug: attachmentRecord.package_slug,
    package_revision: attachmentRecord.package_revision,
    attachment_record_ref: attachmentRecordRef,
    attachment_record_sha256: attachmentRecordSha256,
    review_pack_sha256: reviewPackSha256,
    current_readiness_sha256: currentReadinessSha256,
    current_readiness_markdown_sha256: currentReadinessMarkdownSha256,
    readiness_output_ref: readinessOutputRef,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (authorization[key] !== value) {
      pushError(errors, 'readiness_authorization_binding_mismatch', `/${key}`, `/${key} does not match the exact attachment/review/readiness input`);
    }
  }
  validateIdentity(authorization.authorized_by_ref, '/authorized_by_ref', errors);
  validateTimestamp(authorization.authorized_at, '/authorized_at', errors);
  if (Date.parse(authorization.authorized_at) < Date.parse(attachmentRecord.attached_at)) {
    pushError(errors, 'readiness_authorized_before_attachment', '/authorized_at', 'Readiness authorization must not precede evidence attachment');
  }
  authoritativeIdentityErrors(errors, {
    requireAuthoritativeLineage,
    authoritativeIdentity,
    packageSlug: authorization.package_slug,
    partIdentifier: reviewPackIdentity?.part_id ?? null,
    revision: authorization.package_revision,
    path: '/revision-lineage-binding',
  });
  if (requireAuthoritativeLineage === true && reviewPackIdentity?.package_slug !== authoritativeIdentity?.package_slug) {
    pushError(errors, 'conflicting_identity', '/review-pack/package_slug', 'Review-pack package slug does not match authoritative revision-lineage identity');
  }
  if (requireAuthoritativeLineage === true && reviewPackIdentity?.revision !== authoritativeIdentity?.revision) {
    pushError(errors, 'conflicting_identity', '/review-pack/revision', 'Review-pack revision does not match authoritative revision-lineage identity');
  }
  return { ok: errors.length === 0, errors };
}

export function assertAllowedInspectionEvidenceTransition(from, to) {
  const allowed = INSPECTION_EVIDENCE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new InspectionEvidenceOnboardingError(
      'illegal_state_transition',
      `Inspection evidence state transition ${from} -> ${to} is not allowed`,
      { from, to }
    );
  }
}

export function appendInspectionEvidenceTransition(record, {
  to,
  at,
  actorRef,
  reasonCode,
}) {
  const from = record.state;
  assertAllowedInspectionEvidenceTransition(from, to);
  if (!isParseableTimestamp(at)) {
    throw new InspectionEvidenceOnboardingError('invalid_transition_timestamp', 'State transition requires a parseable timestamp');
  }
  if (!isValidInspectionEvidenceIdentityRef(actorRef)) {
    throw new InspectionEvidenceOnboardingError('invalid_transition_actor', 'State transition requires an explicit non-placeholder actor reference');
  }
  if (typeof reasonCode !== 'string' || !/^[a-z0-9_]+$/.test(reasonCode)) {
    throw new InspectionEvidenceOnboardingError('invalid_transition_reason', 'State transition requires a stable snake_case reason code');
  }
  const next = JSON.parse(JSON.stringify(record));
  next.state = to;
  next.updated_at = at;
  next.transitions.push({
    from,
    to,
    at,
    actor_ref: actorRef,
    reason_code: reasonCode,
    candidate_sha256: record.candidate.sha256,
  });
  return next;
}

export function validateInspectionEvidenceStateHistory(record) {
  const structural = validateInspectionEvidenceOnboardingRecordSchema(record);
  if (!structural.ok) return structural;
  const errors = [];
  validateNoPrivateOrBypassMaterial(record, errors);
  validateTimestamp(record.created_at, '/created_at', errors);
  validateTimestamp(record.updated_at, '/updated_at', errors);
  if (Date.parse(record.updated_at) < Date.parse(record.created_at)) {
    pushError(errors, 'state_history_time_reversal', '/updated_at', 'Onboarding updated_at must not precede created_at');
  }
  let previous = null;
  let previousAt = null;
  record.transitions.forEach((transition, index) => {
    validateTimestamp(transition.at, `/transitions/${index}/at`, errors);
    validateIdentity(transition.actor_ref, `/transitions/${index}/actor_ref`, errors);
    if (previousAt !== null && Date.parse(transition.at) < previousAt) {
      pushError(errors, 'state_history_time_reversal', `/transitions/${index}/at`, 'State transition timestamps must be monotonic');
    }
    if (index === 0) {
      if (transition.from !== null || transition.to !== 'discovered') {
        pushError(errors, 'invalid_initial_transition', `/transitions/${index}`, 'First transition must be null -> discovered');
      }
    } else {
      if (transition.from !== previous) {
        pushError(errors, 'state_history_discontinuity', `/transitions/${index}/from`, 'Transition from-state does not match prior to-state');
      } else if (!(INSPECTION_EVIDENCE_TRANSITIONS[transition.from] || []).includes(transition.to)) {
        pushError(errors, 'illegal_state_transition', `/transitions/${index}/to`, `Transition ${transition.from} -> ${transition.to} is not allowed`);
      }
    }
    if (transition.candidate_sha256 !== record.candidate.sha256) {
      pushError(errors, 'state_history_checksum_mismatch', `/transitions/${index}/candidate_sha256`, 'Every transition must bind the candidate checksum');
    }
    previous = transition.to;
    previousAt = Date.parse(transition.at);
  });
  if (previous !== record.state) {
    pushError(errors, 'state_history_terminal_mismatch', '/state', 'Record state must equal the final transition state');
  }
  if (record.transitions.length > 0 && record.created_at !== record.transitions[0].at) {
    pushError(errors, 'state_history_created_at_mismatch', '/created_at', 'Record created_at must match the initial discovered transition timestamp');
  }
  if (record.transitions.length > 0 && record.updated_at !== record.transitions.at(-1).at) {
    pushError(errors, 'state_history_updated_at_mismatch', '/updated_at', 'Record updated_at must match the final transition timestamp');
  }
  const reached = new Set(record.transitions.map((transition) => transition.to));
  if (
    record.candidate.classification !== 'candidate'
    && [...reached].some((state) => ['structurally_valid', 'semantically_valid', 'awaiting_authorization', 'authorized', 'attached'].includes(state))
  ) {
    pushError(errors, 'rejected_candidate_promoted', '/candidate/classification', 'Generated, synthetic, or unsupported candidates cannot progress beyond quarantine/rejection');
  }
  if (reached.has('structurally_valid') && record.envelope.structurally_valid !== true) {
    pushError(errors, 'structural_validation_flag_missing', '/envelope/structurally_valid', 'State history reached structurally_valid without its validation flag');
  }
  if (
    (reached.has('semantically_valid') || reached.has('awaiting_authorization') || reached.has('authorized') || reached.has('attached'))
    && (record.envelope.semantically_valid !== true || typeof record.envelope.evidence_id !== 'string')
  ) {
    pushError(errors, 'semantic_validation_flag_missing', '/envelope/semantically_valid', 'Post-semantic states require semantic validation and an evidence id');
  }
  if (reached.has('authorized') || reached.has('attached')) {
    if (
      !isSha256(record.authorization.record_sha256)
      || !isSha256(record.authorization.validated_record_sha256)
      || typeof record.authorization.record_ref !== 'string'
      || typeof record.authorization.authorization_id !== 'string'
    ) {
      pushError(errors, 'authorization_binding_missing', '/authorization', 'Authorized states require checksum-bound authorization metadata');
    }
  }
  if (reached.has('attached')) {
    if (
      !isSha256(record.attachment.record_sha256)
      || typeof record.attachment.record_ref !== 'string'
      || !isParseableTimestamp(record.attachment.attached_at)
    ) {
      pushError(errors, 'attachment_binding_missing', '/attachment', 'Attached state requires an immutable attachment receipt binding');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateInspectionEvidenceAuthorizationBinding(authorization, record, envelope, {
  validatedRecordSha256,
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
} = {}) {
  const structural = validateInspectionEvidenceAuthorizationSchema(authorization);
  if (!structural.ok) return structural;
  const errors = [];
  validateNoPrivateOrBypassMaterial(authorization, errors);
  authoritativeIdentityErrors(errors, {
    requireAuthoritativeLineage,
    authoritativeIdentity,
    packageSlug: record.package_slug,
    partIdentifier: envelope.subject.identifier,
    revision: record.package_revision,
    path: '/revision-lineage-binding',
  });
  if (findNonGenuineStringMarkers(authorization).length > 0) {
    pushError(errors, 'synthetic_authorization_forbidden', '/', 'Synthetic, fixture, surrogate, or test-only authorization can never authorize production attachment');
  }
  const expectedRecordHash = validatedRecordSha256 || sha256Json(record);
  const bindings = [
    ['package_slug', record.package_slug, '/package_slug'],
    ['package_revision', record.package_revision, '/package_revision'],
    ['evidence_id', envelope.evidence_id, '/evidence_id'],
    ['source_document_sha256', record.candidate.sha256, '/source_document_sha256'],
    ['candidate_envelope_sha256', record.envelope.sha256, '/candidate_envelope_sha256'],
    ['validated_record_sha256', expectedRecordHash, '/validated_record_sha256'],
  ];
  bindings.forEach(([key, expected, path]) => {
    if (authorization[key] !== expected) {
      pushError(errors, 'authorization_binding_mismatch', path, `${path} does not match the validated quarantined record`);
    }
  });
  validateIdentity(authorization.reviewer.identity_ref, '/reviewer/identity_ref', errors);
  validateIdentity(authorization.authorizer.identity_ref, '/authorizer/identity_ref', errors);
  if (authorization.reviewer.identity_ref === authorization.authorizer.identity_ref) {
    pushError(errors, 'authorization_separation_missing', '/authorizer/identity_ref', 'Attachment authorizer must be distinct from the evidence reviewer');
  }
  validateTimestamp(authorization.reviewer.reviewed_at, '/reviewer/reviewed_at', errors);
  validateTimestamp(authorization.authorized_at, '/authorized_at', errors);
  validateIdentity(authorization.confidentiality_review.reviewed_by_ref, '/confidentiality_review/reviewed_by_ref', errors);
  validateTimestamp(authorization.confidentiality_review.reviewed_at, '/confidentiality_review/reviewed_at', errors);
  if (Date.parse(authorization.authorized_at) < Date.parse(authorization.reviewer.reviewed_at)) {
    pushError(errors, 'authorization_before_review', '/authorized_at', 'Authorization timestamp must not precede reviewer approval');
  }
  if (authorization.reviewer.identity_ref !== envelope.review.reviewer_identity_ref) {
    pushError(errors, 'reviewer_binding_mismatch', '/reviewer/identity_ref', 'Authorization reviewer must match the envelope reviewer identity reference');
  }
  const semanticReviewTransition = record.transitions.find((transition) => transition.to === 'semantically_valid');
  if (!semanticReviewTransition || authorization.reviewer.reviewed_at !== semanticReviewTransition.at) {
    pushError(errors, 'review_transition_binding_mismatch', '/reviewer/reviewed_at', 'Authorization reviewer timestamp must match the quarantine ledger semantic-review transition');
  }
  if (Date.parse(authorization.reviewer.reviewed_at) < Date.parse(envelope.review.reviewed_at)) {
    pushError(errors, 'onboarding_review_before_source_review', '/reviewer/reviewed_at', 'Onboarding review must not precede the source envelope review');
  }
  if (Date.parse(authorization.confidentiality_review.reviewed_at) < Date.parse(authorization.reviewer.reviewed_at)) {
    pushError(errors, 'confidentiality_review_before_evidence_review', '/confidentiality_review/reviewed_at', 'Confidentiality review must not precede evidence review');
  }
  if (Date.parse(authorization.confidentiality_review.reviewed_at) > Date.parse(authorization.authorized_at)) {
    pushError(errors, 'authorization_before_confidentiality_review', '/authorized_at', 'Authorization must not precede confidentiality review');
  }
  return { ok: errors.length === 0, errors };
}

export function validateCanonicalInspectionEvidenceChain({
  candidateEnvelope,
  envelope,
  authorization,
  receipt,
  authorizedOnboardingRecord,
  authoritativePackageRevision,
  authoritativeSubjectIdentifier,
  candidateEnvelopeSha256,
  envelopeSha256,
  authorizationSha256,
  authorizedOnboardingRecordSha256,
  requireAuthoritativeLineage = false,
  authoritativeIdentity = null,
} = {}) {
  const errors = [];
  for (const [label, validation] of [
    ['candidateEnvelope', validateInspectionEvidenceEnvelopeSchema(candidateEnvelope)],
    ['envelope', validateInspectionEvidenceEnvelopeSchema(envelope)],
    ['authorization', validateInspectionEvidenceAuthorizationSchema(authorization)],
    ['attachment', validateInspectionEvidenceAttachmentRecordSchema(receipt)],
    ['onboarding', validateInspectionEvidenceOnboardingRecordSchema(authorizedOnboardingRecord)],
  ]) {
    validation.errors.forEach((error) => pushError(
      errors,
      `${label}_${error.code}`,
      `/${label}${error.path === '/' ? '' : error.path}`,
      `${label}: ${error.message}`
    ));
  }
  if (errors.length > 0) return { ok: false, errors };
  authoritativeIdentityErrors(errors, {
    requireAuthoritativeLineage,
    authoritativeIdentity,
    packageSlug: receipt.package_slug,
    partIdentifier: candidateEnvelope.subject.identifier,
    revision: receipt.package_revision,
    path: '/revision-lineage-binding',
  });
  const stateHistory = validateInspectionEvidenceStateHistory(authorizedOnboardingRecord);
  stateHistory.errors.forEach((error) => pushError(errors, `onboarding_${error.code}`, `/onboarding${error.path === '/' ? '' : error.path}`, `onboarding: ${error.message}`));
  if (findNonGenuineStringMarkers(authorizedOnboardingRecord).length > 0) {
    pushError(errors, 'onboarding_non_genuine_content_marker', '/onboarding', 'Canonical authorized onboarding snapshot must not contain synthetic, fixture, generated, or test-only markers');
  }

  const candidateSemantic = validateInspectionEvidenceEnvelopeSemantics(candidateEnvelope, {
    candidateSha256: receipt.source_document_sha256,
    candidateSizeBytes: authorizedOnboardingRecord.candidate.size_bytes,
    candidateFilename: authorizedOnboardingRecord.candidate.original_filename,
    candidateMediaType: authorizedOnboardingRecord.candidate.media_type,
    packageSlug: receipt.package_slug,
    packageRevision: receipt.package_revision,
    authoritativePackageRevision,
    authoritativeSubjectIdentifier,
    requireAuthoritativeLineage,
    authoritativeIdentity,
  });
  candidateSemantic.errors.forEach((error) => pushError(errors, `candidate_${error.code}`, `/candidate-envelope${error.path === '/' ? '' : error.path}`, `candidate envelope: ${error.message}`));

  const semantic = validateInspectionEvidenceEnvelopeSemantics(envelope, {
    candidateSha256: receipt.source_document_sha256,
    candidateSizeBytes: authorizedOnboardingRecord.candidate.size_bytes,
    candidateFilename: authorizedOnboardingRecord.candidate.original_filename,
    candidateMediaType: authorizedOnboardingRecord.candidate.media_type,
    packageSlug: receipt.package_slug,
    packageRevision: receipt.package_revision,
    authoritativePackageRevision,
    authoritativeSubjectIdentifier,
    requireAuthorized: true,
    requireAttached: true,
    requireAuthoritativeLineage,
    authoritativeIdentity,
  });
  semantic.errors.forEach((error) => pushError(errors, error.code, error.path, error.message));
  validateNoPrivateOrBypassMaterial(authorization, errors);
  if (findNonGenuineStringMarkers(authorization).length > 0) {
    pushError(errors, 'synthetic_authorization_forbidden', '/authorization', 'Synthetic, fixture, generated, or test-only authorization cannot authorize production attachment');
  }

  const expectedEnvelopeRef = `docs/examples/${receipt.package_slug}/inspection/inspection_evidence.json`;
  const expectedCandidateEnvelopeRef = `docs/examples/${receipt.package_slug}/inspection/inspection_evidence_candidate_authorized.json`;
  const expectedAuthorizationRef = `docs/examples/${receipt.package_slug}/inspection/inspection_evidence_authorization.json`;
  const expectedOnboardingRef = `docs/examples/${receipt.package_slug}/inspection/inspection_evidence_onboarding.json`;
  const artifacts = receipt.resulting_canonical_artifacts;
  const byRole = new Map(artifacts.map((artifact) => [artifact.role, artifact]));
  if (artifacts.length !== 4 || byRole.size !== 4) {
    pushError(errors, 'canonical_artifact_set_invalid', '/attachment/resulting_canonical_artifacts', 'Attachment receipt must contain exactly one authorized candidate envelope, attached evidence envelope, attachment authorization, and authorized onboarding snapshot');
  }
  const candidateEnvelopeArtifact = byRole.get('authorized_candidate_envelope');
  const envelopeArtifact = byRole.get('evidence_envelope');
  const authorizationArtifact = byRole.get('attachment_authorization');
  const onboardingArtifact = byRole.get('authorized_onboarding_record');
  if (
    !candidateEnvelopeArtifact
    || candidateEnvelopeArtifact.path !== expectedCandidateEnvelopeRef
    || candidateEnvelopeArtifact.sha256 !== candidateEnvelopeSha256
    || candidateEnvelopeSha256 !== receipt.candidate_envelope_sha256
  ) {
    pushError(errors, 'canonical_candidate_envelope_binding_mismatch', '/attachment/resulting_canonical_artifacts', 'Authorization-bound candidate envelope path/hash does not match the immutable attachment receipt');
  }
  if (
    !envelopeArtifact
    || envelopeArtifact.path !== expectedEnvelopeRef
    || envelopeArtifact.sha256 !== envelopeSha256
  ) {
    pushError(errors, 'canonical_envelope_binding_mismatch', '/attachment/resulting_canonical_artifacts', 'Canonical evidence envelope path/hash does not match the attachment receipt');
  }
  if (
    !onboardingArtifact
    || onboardingArtifact.path !== expectedOnboardingRef
    || onboardingArtifact.sha256 !== authorizedOnboardingRecordSha256
    || receipt.authorized_onboarding_record_sha256 !== authorizedOnboardingRecordSha256
  ) {
    pushError(errors, 'canonical_onboarding_binding_mismatch', '/attachment/resulting_canonical_artifacts', 'Authorized onboarding snapshot path/hash does not match the attachment receipt');
  }
  if (
    !authorizationArtifact
    || authorizationArtifact.path !== expectedAuthorizationRef
    || authorizationArtifact.sha256 !== authorizationSha256
  ) {
    pushError(errors, 'canonical_authorization_binding_mismatch', '/attachment/resulting_canonical_artifacts', 'Canonical attachment authorization path/hash does not match the attachment receipt');
  }

  const equalBindings = [
    [authorization.package_slug, receipt.package_slug, '/authorization/package_slug'],
    [authorization.package_revision, receipt.package_revision, '/authorization/package_revision'],
    [authorization.evidence_id, receipt.evidence_id, '/authorization/evidence_id'],
    [authorization.source_document_sha256, receipt.source_document_sha256, '/authorization/source_document_sha256'],
    [authorization.candidate_envelope_sha256, receipt.candidate_envelope_sha256, '/authorization/candidate_envelope_sha256'],
    [authorization.validated_record_sha256, receipt.authorization.validated_record_sha256, '/authorization/validated_record_sha256'],
    [authorization.authorization_id, receipt.authorization.authorization_id, '/authorization/authorization_id'],
    [authorization.authorizer.identity_ref, receipt.authorization.authorized_by_ref, '/authorization/authorizer/identity_ref'],
    [authorization.authorized_at, receipt.authorization.authorized_at, '/authorization/authorized_at'],
    [authorization.reviewer.identity_ref, envelope.review.reviewer_identity_ref, '/authorization/reviewer/identity_ref'],
    [authorization.reviewer.reviewed_at, envelope.review.reviewed_at, '/authorization/reviewer/reviewed_at'],
    [receipt.evidence_id, envelope.evidence_id, '/attachment/evidence_id'],
    [receipt.source_document_sha256, envelope.source.document.sha256, '/attachment/source_document_sha256'],
    [receipt.attached_at, envelope.attachment.attached_at, '/attachment/attached_at'],
    [receipt.authorization.authorization_id, envelope.authorization.authorization_id, '/attachment/authorization/authorization_id'],
    [receipt.authorization.record_sha256, envelope.authorization.record_sha256, '/attachment/authorization/record_sha256'],
    [receipt.authorization.authorized_by_ref, envelope.authorization.authorized_by_ref, '/attachment/authorization/authorized_by_ref'],
    [receipt.authorization.authorized_at, envelope.authorization.authorized_at, '/attachment/authorization/authorized_at'],
    [expectedAuthorizationRef, envelope.authorization.record_ref, '/envelope/authorization/record_ref'],
    [authorizationSha256, receipt.authorization.record_sha256, '/attachment/authorization/record_sha256'],
    [authorizedOnboardingRecord.package_slug, receipt.package_slug, '/onboarding/package_slug'],
    [authorizedOnboardingRecord.package_revision, receipt.package_revision, '/onboarding/package_revision'],
    [authorizedOnboardingRecord.candidate.sha256, receipt.source_document_sha256, '/onboarding/candidate/sha256'],
    [authorizedOnboardingRecord.envelope.sha256, receipt.candidate_envelope_sha256, '/onboarding/envelope/sha256'],
    [authorizedOnboardingRecord.envelope.evidence_id, receipt.evidence_id, '/onboarding/envelope/evidence_id'],
    [authorizedOnboardingRecord.authorization.authorization_id, receipt.authorization.authorization_id, '/onboarding/authorization/authorization_id'],
    [authorizedOnboardingRecord.authorization.record_sha256, receipt.authorization.source_record_sha256, '/onboarding/authorization/record_sha256'],
    [authorizedOnboardingRecord.authorization.validated_record_sha256, receipt.authorization.validated_record_sha256, '/onboarding/authorization/validated_record_sha256'],
  ];
  equalBindings.forEach(([actual, expected, path]) => {
    if (actual !== expected) pushError(errors, 'canonical_chain_binding_mismatch', path, `${path} does not match the immutable canonical evidence chain`);
  });

  for (const [value, path] of [
    [receipt.attached_at, '/attachment/attached_at'],
    [receipt.authorization.authorized_at, '/attachment/authorization/authorized_at'],
    [authorization.reviewer.reviewed_at, '/authorization/reviewer/reviewed_at'],
    [authorization.confidentiality_review.reviewed_at, '/authorization/confidentiality_review/reviewed_at'],
    [authorization.authorized_at, '/authorization/authorized_at'],
  ]) validateTimestamp(value, path, errors);
  validateIdentity(authorization.reviewer.identity_ref, '/authorization/reviewer/identity_ref', errors);
  validateIdentity(authorization.authorizer.identity_ref, '/authorization/authorizer/identity_ref', errors);
  validateIdentity(authorization.confidentiality_review.reviewed_by_ref, '/authorization/confidentiality_review/reviewed_by_ref', errors);
  if (
    authorizedOnboardingRecord.state !== 'authorized'
    || authorizedOnboardingRecord.candidate.classification !== 'candidate'
    || authorizedOnboardingRecord.envelope.structurally_valid !== true
    || authorizedOnboardingRecord.envelope.semantically_valid !== true
  ) {
    pushError(errors, 'authorized_onboarding_snapshot_invalid', '/onboarding', 'Canonical onboarding snapshot must prove a candidate reached authorized state through structural and semantic validation');
  }
  const authorizedTransitionIndexes = authorizedOnboardingRecord.transitions
    .map((transition, index) => transition.to === 'authorized' ? index : -1)
    .filter((index) => index >= 0);
  if (authorizedTransitionIndexes.length !== 1 || authorizedTransitionIndexes[0] !== authorizedOnboardingRecord.transitions.length - 1) {
    pushError(errors, 'validated_record_reconstruction_failed', '/onboarding/transitions', 'Authorized snapshot must end with exactly one authorized transition');
  } else {
    const validatedSnapshot = JSON.parse(JSON.stringify(authorizedOnboardingRecord));
    validatedSnapshot.transitions.pop();
    validatedSnapshot.state = 'awaiting_authorization';
    validatedSnapshot.updated_at = validatedSnapshot.transitions.at(-1).at;
    validatedSnapshot.authorization = {
      record_ref: null,
      record_sha256: null,
      authorization_id: null,
      validated_record_sha256: null,
    };
    if (sha256Json(validatedSnapshot) !== authorization.validated_record_sha256) {
      pushError(errors, 'validated_record_hash_mismatch', '/authorization/validated_record_sha256', 'Authorization validated-record checksum must reconstruct from the immutable authorized onboarding snapshot');
    }
  }
  if (authorization.reviewer.identity_ref === authorization.authorizer.identity_ref) {
    pushError(errors, 'authorization_separation_missing', '/authorization/authorizer/identity_ref', 'Attachment authorizer must be distinct from the evidence reviewer');
  }
  if (Date.parse(authorization.authorized_at) < Date.parse(authorization.reviewer.reviewed_at)) {
    pushError(errors, 'authorization_before_review', '/authorization/authorized_at', 'Authorization timestamp must not precede evidence review');
  }
  if (Date.parse(authorization.confidentiality_review.reviewed_at) < Date.parse(authorization.reviewer.reviewed_at)) {
    pushError(errors, 'confidentiality_review_before_evidence_review', '/authorization/confidentiality_review/reviewed_at', 'Confidentiality review must not precede evidence review');
  }
  if (Date.parse(authorization.confidentiality_review.reviewed_at) > Date.parse(authorization.authorized_at)) {
    pushError(errors, 'authorization_before_confidentiality_review', '/authorization/authorized_at', 'Authorization must not precede confidentiality review');
  }
  if (Date.parse(receipt.attached_at) < Date.parse(authorization.authorized_at)) {
    pushError(errors, 'attachment_before_authorization', '/attachment/attached_at', 'Attachment timestamp must not precede authorization');
  }
  const attachedTransformation = validateAttachedInspectionEvidenceEnvelopeTransformation({
    candidateEnvelope,
    attachedEnvelope: envelope,
    authorization,
    authorizationRef: expectedAuthorizationRef,
    authorizationSha256,
    attachedAt: receipt.attached_at,
    sourceSha256: receipt.source_document_sha256,
    quarantineTransition: authorizedOnboardingRecord.transitions.find((transition) => transition.to === 'quarantined'),
  });
  attachedTransformation.errors.forEach((error) => pushError(errors, error.code, error.path, error.message));
  const authorizationTransition = authorizedOnboardingRecord.transitions.find((transition) => transition.to === 'authorized');
  const quarantineTransition = authorizedOnboardingRecord.transitions.find((transition) => transition.to === 'quarantined');
  const semanticReviewTransition = authorizedOnboardingRecord.transitions.find((transition) => transition.to === 'semantically_valid');
  if (
    !quarantineTransition
    || !semanticReviewTransition
    || semanticReviewTransition.at !== authorization.reviewer.reviewed_at
    || Date.parse(semanticReviewTransition.at) < Date.parse(quarantineTransition.at)
  ) {
    pushError(errors, 'review_transition_binding_mismatch', '/onboarding/transitions', 'Canonical review must be ledger-bound and occur after quarantine');
  }
  if (
    !authorizationTransition
    || authorizationTransition.actor_ref !== authorization.authorizer.identity_ref
    || Date.parse(authorizationTransition.at) < Date.parse(authorization.authorized_at)
  ) {
    pushError(errors, 'authorization_transition_binding_mismatch', '/onboarding/transitions', 'Authorized onboarding transition must bind the authorizer identity and occur no earlier than signed authorization');
  }
  if (authorizationTransition && Date.parse(receipt.attached_at) < Date.parse(authorizationTransition.at)) {
    pushError(errors, 'attachment_before_authorization_transition', '/attachment/attached_at', 'Attachment must occur after the authorized onboarding transition');
  }
  if (receipt.readiness.before_sha256 !== receipt.readiness.after_sha256) {
    pushError(errors, 'readiness_changed_during_attachment', '/attachment/readiness', 'Attachment receipt must prove readiness remained byte-identical');
  }
  if (receipt.readiness.before_markdown_sha256 !== receipt.readiness.after_markdown_sha256) {
    pushError(errors, 'readiness_markdown_changed_during_attachment', '/attachment/readiness', 'Attachment receipt must prove readiness Markdown remained byte-identical');
  }
  return { ok: errors.length === 0, errors };
}

export class InspectionEvidenceOnboardingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InspectionEvidenceOnboardingError';
    this.code = code;
    this.details = details;
  }
}

export function assertInspectionEvidenceValidation(result, code = 'inspection_evidence_validation_failed') {
  if (result.ok) return result;
  throw new InspectionEvidenceOnboardingError(
    code,
    result.errors.map((error) => error.message).join(' | '),
    { errors: result.errors }
  );
}
