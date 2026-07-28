import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  open,
  realpath,
} from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { TextDecoder } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseToml } from 'smol-toml';

import { configV1Schema } from './config-canonical-schema.js';
import {
  parseInspectionEvidenceJsonBytes,
  validateJsonDocumentBounds,
} from './inspection-evidence-onboarding.js';
import { SELECTED_REVISION_LINEAGE_PACKAGE } from './revision-lineage-proof-package.js';

export const REVISION_LINEAGE_FIELD = 'revision_lineage';
export const REVISION_LINEAGE_SCHEMA_VERSION = '1.0';
export const REVISION_LINEAGE_MODE = 'proof';
export const REVISION_LINEAGE_MAX_CONFIG_BYTES = 2 * 1024 * 1024;
export const REVISION_LINEAGE_MAX_PARENT_BYTES = 64 * 1024 * 1024;

export const REVISION_LINEAGE_REASON_CODES = Object.freeze({
  MISSING_IDENTITY: 'missing_identity',
  INFERRED_IDENTITY: 'inferred_identity',
  DEFAULTED_IDENTITY: 'defaulted_identity',
  CONFLICTING_IDENTITY: 'conflicting_identity',
  MALFORMED_IDENTITY: 'malformed_identity',
  STALE_PARENT: 'stale_parent',
  DIGEST_MISMATCH: 'digest_mismatch',
  UNSUPPORTED_LEGACY: 'unsupported_legacy',
  MISSING_PARENT: 'missing_parent',
  MALFORMED_CONFIG: 'malformed_config',
  UNSAFE_PATH: 'unsafe_path',
  PATH_ESCAPE: 'path_escape',
  SYMLINK_FORBIDDEN: 'symlink_forbidden',
  HARDLINK_FORBIDDEN: 'hardlink_forbidden',
  INPUT_SIZE_OUT_OF_BOUNDS: 'input_size_out_of_bounds',
  INPUT_CHANGED_DURING_READ: 'input_changed_during_read',
  UNSUPPORTED_PACKAGE: 'unsupported_package',
});

const CORE_IDENTITY_KEYS = Object.freeze([
  'package_slug',
  'part_id',
  'revision',
  'config_sha256',
]);
const PARENT_REQUIRED_KEYS = Object.freeze([
  'artifact_type',
  'role',
  'path',
  'sha256',
]);
const PARENT_ALLOWED_KEYS = new Set([...PARENT_REQUIRED_KEYS, 'size_bytes']);
const LINEAGE_KEYS = new Set(['schema_version', 'mode', 'identity', 'parents']);
const IDENTITY_KEYS = new Set(CORE_IDENTITY_KEYS);
const SELECTION_KEYS = new Set([
  'package_directory',
  'package_slug',
  'part_id',
  'revision',
  'authoritative_config_path',
  'generated_config_descendants',
]);
const IDENTITY_ORIGINS = new Set(['explicit', 'computed']);
const INFERRED_ORIGINS = new Set(['inferred', 'filename', 'path']);
const DEFAULTED_ORIGINS = new Set(['defaulted', 'fallback']);
const LEGACY_ORIGINS = new Set(['legacy', 'compatibility']);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const snapshotState = new WeakMap();

const configAjv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  strictNumbers: true,
});
const validateConfigSchema = configAjv.compile(configV1Schema);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export const REVISION_LINEAGE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'mode', 'identity', 'parents'],
  properties: {
    schema_version: { const: REVISION_LINEAGE_SCHEMA_VERSION },
    mode: { const: REVISION_LINEAGE_MODE },
    identity: {
      type: 'object',
      additionalProperties: false,
      required: [...CORE_IDENTITY_KEYS],
      properties: {
        package_slug: { type: 'string', minLength: 1, maxLength: 128 },
        part_id: { type: 'string', minLength: 1, maxLength: 128 },
        revision: { type: 'string', minLength: 1, maxLength: 128 },
        config_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    parents: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...PARENT_REQUIRED_KEYS],
        properties: {
          artifact_type: { type: 'string', minLength: 1, maxLength: 128 },
          role: { type: 'string', minLength: 1, maxLength: 128 },
          path: { type: 'string', minLength: 1, maxLength: 1024 },
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          size_bytes: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
});

export const REVISION_LINEAGE_JSON_SCHEMA = REVISION_LINEAGE_SCHEMA;

export class RevisionLineageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RevisionLineageError';
    this.code = code;
    this.reason_code = code;
    this.details = deepFreeze({ ...details });
  }
}

function lineageError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(value, key) {
  return isPlainObject(value) && Object.hasOwn(value, key);
}

function pushError(errors, code, path, message, details = {}) {
  errors.push({ code, path, message, ...details });
}

function throwFirstValidationError(result, fallbackMessage) {
  if (result.ok) return;
  const first = result.errors[0] || {
    code: REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
    path: '/',
    message: fallbackMessage,
  };
  throw lineageError(first.code, first.message || fallbackMessage, {
    path: first.path || '/',
    errors: result.errors,
  });
}

function exactKeys(
  value,
  allowed,
  required,
  path,
  errors,
  missingCode = REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY
) {
  for (const key of required) {
    if (!own(value, key)) {
      const code = typeof missingCode === 'function' ? missingCode(key) : missingCode;
      pushError(
        errors,
        code,
        `${path}/${key}`,
        `${path}/${key} is required and must be explicit`
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
        `${path}/${key}`,
        `${path}/${key} is not part of the revision-lineage contract`
      );
    }
  }
}

function validateIdentityString(value, field, path, errors) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY,
      path,
      `${path} must be an explicit non-blank string`
    );
    return;
  }
  if (typeof value !== 'string') {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      path,
      `${path} must be a string`
    );
    return;
  }
  if (value !== value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      path,
      `${path} must be bounded text without surrounding whitespace or control characters`
    );
    return;
  }
  if (field === 'package_slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      path,
      `${path} must be a lowercase hyphenated package slug`
    );
  }
}

function validateIdentityOrigins(origins, errors) {
  if (origins === undefined) return;
  if (!isPlainObject(origins)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/identity_origins',
      'identity origins must be an object when supplied'
    );
    return;
  }
  for (const field of CORE_IDENTITY_KEYS) {
    if (!own(origins, field)) continue;
    const origin = origins[field];
    if (INFERRED_ORIGINS.has(origin)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.INFERRED_IDENTITY,
        `/identity_origins/${field}`,
        `${field} inferred from a filename or path cannot satisfy proof lineage`
      );
    } else if (DEFAULTED_ORIGINS.has(origin)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.DEFAULTED_IDENTITY,
        `/identity_origins/${field}`,
        `${field} supplied by a default or fallback cannot satisfy proof lineage`
      );
    } else if (LEGACY_ORIGINS.has(origin)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_LEGACY,
        `/identity_origins/${field}`,
        `${field} supplied only by a legacy compatibility field is proof-ineligible`
      );
    } else if (!IDENTITY_ORIGINS.has(origin)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
        `/identity_origins/${field}`,
        `${field} has an unsupported identity origin`
      );
    }
  }
}

export function isLowercaseSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function validateRevisionLineageIdentity(value, { origins } = {}) {
  const errors = [];
  if (!isPlainObject(value)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/identity',
      'revision-lineage identity must be an object'
    );
    return { ok: false, errors };
  }

  exactKeys(value, IDENTITY_KEYS, CORE_IDENTITY_KEYS, '/identity', errors);
  validateIdentityString(value.package_slug, 'package_slug', '/identity/package_slug', errors);
  validateIdentityString(value.part_id, 'part_id', '/identity/part_id', errors);
  validateIdentityString(value.revision, 'revision', '/identity/revision', errors);
  if (value.config_sha256 === undefined || value.config_sha256 === null || value.config_sha256 === '') {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY,
      '/identity/config_sha256',
      '/identity/config_sha256 must be explicit'
    );
  } else if (!isLowercaseSha256(value.config_sha256)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/identity/config_sha256',
      '/identity/config_sha256 must be exactly 64 lowercase hexadecimal characters'
    );
  }
  validateIdentityOrigins(origins, errors);
  return { ok: errors.length === 0, errors };
}

export function assertRevisionLineageIdentity(value, options = {}) {
  const result = validateRevisionLineageIdentity(value, options);
  throwFirstValidationError(result, 'Invalid revision-lineage identity');
  return deepFreeze({
    package_slug: value.package_slug,
    part_id: value.part_id,
    revision: value.revision,
    config_sha256: value.config_sha256,
  });
}

function validatePortableLocator(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 1024) {
    return 'must be a bounded non-blank string without surrounding whitespace';
  }
  if (isAbsolute(value) || value.startsWith('~') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    return 'must be a portable relative POSIX locator without absolute, home, backslash, NUL, or control syntax';
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /%(?:2e|2f|5c)/i.test(value)) {
    return 'must not contain a URI, drive prefix, or encoded traversal syntax';
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'must not contain empty, current-directory, or parent-directory segments';
  }
  return null;
}

function validateParentReference(value, path = '/parents/0') {
  const errors = [];
  if (!isPlainObject(value)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      path,
      `${path} must be an object`
    );
    return { ok: false, errors };
  }
  exactKeys(
    value,
    PARENT_ALLOWED_KEYS,
    PARENT_REQUIRED_KEYS,
    path,
    errors,
    REVISION_LINEAGE_REASON_CODES.MISSING_PARENT
  );

  for (const key of ['artifact_type', 'role']) {
    const fieldPath = `${path}/${key}`;
    const fieldValue = value[key];
    if (fieldValue === undefined || fieldValue === null || (typeof fieldValue === 'string' && !fieldValue.trim())) {
      pushError(errors, REVISION_LINEAGE_REASON_CODES.MISSING_PARENT, fieldPath, `${fieldPath} is required`);
    } else if (typeof fieldValue !== 'string'
      || fieldValue !== fieldValue.trim()
      || fieldValue.length > 128
      || !/^[a-z][a-z0-9._-]*$/.test(fieldValue)) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
        fieldPath,
        `${fieldPath} must be a bounded lowercase artifact identifier`
      );
    }
  }

  const pathError = validatePortableLocator(value.path);
  if (pathError) {
    pushError(errors, REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH, `${path}/path`, `${path}/path ${pathError}`);
  }
  if (!isLowercaseSha256(value.sha256)) {
    pushError(
      errors,
      value.sha256 === undefined || value.sha256 === null || value.sha256 === ''
        ? REVISION_LINEAGE_REASON_CODES.MISSING_PARENT
        : REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      `${path}/sha256`,
      `${path}/sha256 must be exactly 64 lowercase hexadecimal characters`
    );
  }
  if (own(value, 'size_bytes')
    && (!Number.isSafeInteger(value.size_bytes) || value.size_bytes < 0)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      `${path}/size_bytes`,
      `${path}/size_bytes must be a non-negative safe integer when present`
    );
  }
  return { ok: errors.length === 0, errors };
}

export function validateRevisionLineageParent(value) {
  return validateParentReference(value);
}

export function assertRevisionLineageParent(value) {
  const result = validateParentReference(value);
  throwFirstValidationError(result, 'Invalid revision-lineage parent reference');
  return deepFreeze({
    artifact_type: value.artifact_type,
    role: value.role,
    path: value.path,
    sha256: value.sha256,
    ...(own(value, 'size_bytes') ? { size_bytes: value.size_bytes } : {}),
  });
}

function resolveBuilderAlias(input, snakeKey, camelKey) {
  if (own(input, snakeKey) && own(input, camelKey) && input[snakeKey] !== input[camelKey]) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      `${snakeKey} and ${camelKey} disagree`,
      { snake_key: snakeKey, camel_key: camelKey }
    );
  }
  return own(input, snakeKey) ? input[snakeKey] : input[camelKey];
}

export function buildRevisionLineageParent(input = {}) {
  if (!isPlainObject(input)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      'Revision-lineage parent builder input must be an object'
    );
  }
  const artifactType = resolveBuilderAlias(input, 'artifact_type', 'artifactType');
  const sizeBytes = resolveBuilderAlias(input, 'size_bytes', 'sizeBytes');
  return assertRevisionLineageParent({
    artifact_type: artifactType,
    role: input.role,
    path: input.path,
    sha256: input.sha256,
    ...(sizeBytes === undefined ? {} : { size_bytes: sizeBytes }),
  });
}

function parentSortKey(parent) {
  return `${parent.role}\u0000${parent.artifact_type}\u0000${parent.path}`;
}

function canonicalParents(parents) {
  const normalized = parents
    .map((parent) => assertRevisionLineageParent(parent))
    .sort((left, right) => {
      const a = parentSortKey(left);
      const b = parentSortKey(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const roles = new Set();
  for (const parent of normalized) {
    if (roles.has(parent.role)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
        `Parent role ${parent.role} must be unique`
      );
    }
    roles.add(parent.role);
  }
  return deepFreeze(normalized);
}

export function validateRevisionLineage(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/',
      'revision_lineage must be an object'
    );
    return { ok: false, errors };
  }
  exactKeys(
    value,
    LINEAGE_KEYS,
    ['schema_version', 'mode', 'identity', 'parents'],
    '',
    errors,
    (key) => {
      if (key === 'identity') return REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY;
      if (key === 'parents') return REVISION_LINEAGE_REASON_CODES.MISSING_PARENT;
      return REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY;
    }
  );
  if (value.schema_version !== REVISION_LINEAGE_SCHEMA_VERSION) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/schema_version',
      `/schema_version must equal ${REVISION_LINEAGE_SCHEMA_VERSION}`
    );
  }
  if (value.mode !== REVISION_LINEAGE_MODE) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      '/mode',
      `/mode must equal ${REVISION_LINEAGE_MODE}`
    );
  }
  const identityResult = validateRevisionLineageIdentity(value.identity);
  errors.push(...identityResult.errors);
  if (!Array.isArray(value.parents) || value.parents.length === 0) {
    pushError(
      errors,
      REVISION_LINEAGE_REASON_CODES.MISSING_PARENT,
      '/parents',
      '/parents must contain at least one exact parent reference'
    );
    return { ok: false, errors };
  }

  const roles = new Set();
  value.parents.forEach((parent, index) => {
    const result = validateParentReference(parent, `/parents/${index}`);
    errors.push(...result.errors);
    if (isPlainObject(parent) && typeof parent.role === 'string') {
      if (roles.has(parent.role)) {
        pushError(
          errors,
          REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
          `/parents/${index}/role`,
          `Parent role ${parent.role} must be unique`
        );
      }
      roles.add(parent.role);
    }
  });

  const configParents = value.parents.filter((parent) => parent?.role === 'authoritative_config');
  if (configParents.length !== 1) {
    pushError(
      errors,
      configParents.length === 0
        ? REVISION_LINEAGE_REASON_CODES.MISSING_PARENT
        : REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      '/parents',
      'revision_lineage must contain exactly one authoritative_config parent'
    );
  } else {
    const configParent = configParents[0];
    if (configParent.artifact_type !== 'config') {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
        '/parents',
        'authoritative_config parent must use artifact_type config'
      );
    }
    if (isLowercaseSha256(value.identity?.config_sha256)
      && isLowercaseSha256(configParent.sha256)
      && value.identity.config_sha256 !== configParent.sha256) {
      pushError(
        errors,
        REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH,
        '/parents',
        'authoritative_config parent digest must equal identity.config_sha256'
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

export function isRevisionLineage(value) {
  return validateRevisionLineage(value).ok;
}

export function assertRevisionLineage(value) {
  const result = validateRevisionLineage(value);
  throwFirstValidationError(result, 'Invalid revision_lineage contract');
  return deepFreeze({
    schema_version: REVISION_LINEAGE_SCHEMA_VERSION,
    mode: REVISION_LINEAGE_MODE,
    identity: assertRevisionLineageIdentity(value.identity),
    parents: canonicalParents(value.parents),
  });
}

export function buildRevisionLineage({ identity, parents } = {}) {
  return assertRevisionLineage({
    schema_version: REVISION_LINEAGE_SCHEMA_VERSION,
    mode: REVISION_LINEAGE_MODE,
    identity,
    parents,
  });
}

function exactIdentityCandidate(value) {
  return isPlainObject(value)
    && Object.keys(value).every((key) => IDENTITY_KEYS.has(key))
    && Object.keys(value).some((key) => IDENTITY_KEYS.has(key));
}

export function extractRevisionLineageIdentity(value) {
  if (exactIdentityCandidate(value)) return assertRevisionLineageIdentity(value);
  if (isPlainObject(value)
    && value.schema_version === REVISION_LINEAGE_SCHEMA_VERSION
    && own(value, 'identity')
    && own(value, 'parents')) {
    return assertRevisionLineage(value).identity;
  }
  if (isPlainObject(value) && own(value, REVISION_LINEAGE_FIELD)) {
    return assertRevisionLineage(value[REVISION_LINEAGE_FIELD]).identity;
  }
  throw lineageError(
    REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_LEGACY,
    `Artifact has no explicit ${REVISION_LINEAGE_FIELD} proof contract`
  );
}

function agreementEntryValue(entry) {
  if (!isPlainObject(entry)) return entry;
  if (own(entry, 'value')) return entry.value;
  if (own(entry, 'lineage')) return entry.lineage;
  if (own(entry, 'label') && own(entry, 'identity')) return entry.identity;
  return entry;
}

export function revisionLineageIdentitiesAgree(left, right) {
  try {
    const a = extractRevisionLineageIdentity(left);
    const b = extractRevisionLineageIdentity(right);
    return CORE_IDENTITY_KEYS.every((key) => a[key] === b[key]);
  } catch {
    return false;
  }
}

export function assertRevisionLineageIdentityAgreement(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY,
      'At least one explicit revision-lineage identity is required for agreement'
    );
  }
  const normalized = entries.map((entry, index) => ({
    label: isPlainObject(entry) && typeof entry.label === 'string' && entry.label
      ? entry.label
      : `identity[${index}]`,
    identity: extractRevisionLineageIdentity(agreementEntryValue(entry)),
  }));
  const expected = normalized[0];
  for (const candidate of normalized.slice(1)) {
    const conflicts = CORE_IDENTITY_KEYS.filter(
      (key) => candidate.identity[key] !== expected.identity[key]
    );
    if (conflicts.length > 0) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
        `${candidate.label} conflicts with ${expected.label}: ${conflicts.join(', ')}`,
        {
          expected_label: expected.label,
          actual_label: candidate.label,
          conflicting_fields: conflicts,
        }
      );
    }
  }
  return expected.identity;
}

function parentCollection(value) {
  if (Array.isArray(value)) return canonicalParents(value);
  if (isPlainObject(value) && Array.isArray(value.parents)) {
    return assertRevisionLineage(value).parents;
  }
  if (isPlainObject(value) && own(value, REVISION_LINEAGE_FIELD)) {
    return assertRevisionLineage(value[REVISION_LINEAGE_FIELD]).parents;
  }
  throw lineageError(
    REVISION_LINEAGE_REASON_CODES.MISSING_PARENT,
    'Revision-lineage parent collection is required'
  );
}

export function assertRevisionLineageParentAgreement(left, right) {
  const expected = parentCollection(left);
  const actual = parentCollection(right);
  const expectedByRole = new Map(expected.map((parent) => [parent.role, parent]));
  const actualByRole = new Map(actual.map((parent) => [parent.role, parent]));
  const roles = [...new Set([...expectedByRole.keys(), ...actualByRole.keys()])].sort();
  const differingRoles = roles.filter((role) => {
    const a = expectedByRole.get(role);
    const b = actualByRole.get(role);
    return !a || !b || JSON.stringify(a) !== JSON.stringify(b);
  });
  if (differingRoles.length > 0) {
    const digestOnly = differingRoles.every((role) => {
      const a = expectedByRole.get(role);
      const b = actualByRole.get(role);
      return a && b
        && a.artifact_type === b.artifact_type
        && a.path === b.path
        && (a.sha256 !== b.sha256 || a.size_bytes !== b.size_bytes);
    });
    throw lineageError(
      digestOnly
        ? REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH
        : REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      `Revision-lineage parent sets disagree for role(s): ${differingRoles.join(', ')}`,
      { differing_roles: differingRoles }
    );
  }
  return expected;
}

function assertSelectionText(value, field) {
  const errors = [];
  validateIdentityString(value, field, `/selection/${field}`, errors);
  throwFirstValidationError({ ok: errors.length === 0, errors }, `Invalid selected package ${field}`);
  return value;
}

function assertSafeLocator(value, label) {
  const message = validatePortableLocator(value);
  if (message) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH,
      `${label} ${message}`,
      { path: typeof value === 'string' ? value : null }
    );
  }
  return value;
}

export function assertRevisionLineagePackageSelection(
  selection = SELECTED_REVISION_LINEAGE_PACKAGE
) {
  if (!isPlainObject(selection)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
      'Selected revision-lineage package descriptor must be an object'
    );
  }
  for (const key of SELECTION_KEYS) {
    if (!own(selection, key)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
        `Selected revision-lineage package descriptor is missing ${key}`
      );
    }
  }
  for (const key of Object.keys(selection)) {
    if (!SELECTION_KEYS.has(key)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
        `Selected revision-lineage package descriptor contains unsupported field ${key}`
      );
    }
  }

  const packageDirectory = assertSafeLocator(selection.package_directory, 'package_directory');
  const packageSlug = assertSelectionText(selection.package_slug, 'package_slug');
  const partId = assertSelectionText(selection.part_id, 'part_id');
  const revision = assertSelectionText(selection.revision, 'revision');
  const sourcePath = assertSafeLocator(
    selection.authoritative_config_path,
    'authoritative_config_path'
  );
  if (basename(packageDirectory) !== packageSlug) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      'Selected package directory slug and explicit package_slug disagree'
    );
  }
  if (!Array.isArray(selection.generated_config_descendants)
    || selection.generated_config_descendants.length === 0) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
      'Selected package must declare at least one generated config descendant'
    );
  }
  const generated = selection.generated_config_descendants.map((pathValue) => (
    assertSafeLocator(pathValue, 'generated_config_descendant')
  ));
  if (new Set(generated).size !== generated.length) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
      'Generated config descendant allowlist must not contain duplicates'
    );
  }
  for (const pathValue of generated) {
    if (!pathValue.startsWith(`${packageDirectory}/`)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE,
        'Generated config descendant must remain inside the selected package directory'
      );
    }
  }
  if (generated.includes(sourcePath)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      'Authoritative source config and generated descendants must be separate allowlist entries'
    );
  }
  return deepFreeze({
    package_directory: packageDirectory,
    package_slug: packageSlug,
    part_id: partId,
    revision,
    authoritative_config_path: sourcePath,
    generated_config_descendants: [...generated],
  });
}

export function assertSelectedRevisionLineagePath(pathValue, {
  selection = SELECTED_REVISION_LINEAGE_PACKAGE,
  role = 'authoritative_config',
} = {}) {
  const selected = assertRevisionLineagePackageSelection(selection);
  const locator = assertSafeLocator(pathValue, 'selected package path');
  let allowed = [];
  if (role === 'authoritative_config') {
    allowed = [selected.authoritative_config_path];
  } else if (role === 'generated_config_descendant') {
    allowed = [...selected.generated_config_descendants];
  } else if (role === 'package_directory') {
    allowed = [selected.package_directory];
  } else {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
      `Unsupported selected-package path role: ${role}`
    );
  }
  if (!allowed.includes(locator)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE,
      `${locator} is not allowlisted as ${role}`,
      { role }
    );
  }
  return locator;
}

function compareDeclaredIdentity(actual, expected, field, label = 'config') {
  if (actual !== expected) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      `${label} ${field} conflicts with the selected package authority`,
      { field, expected, actual }
    );
  }
}

function explicitConfigIdentityValue(config, container, field) {
  if (!isPlainObject(container)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      'Config product must be an object in proof mode',
      { field }
    );
  }
  if (!own(container, field)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY,
      `Config product.${field} must be explicitly declared for proof lineage`,
      { field }
    );
  }
  const errors = [];
  validateIdentityString(container[field], field, `/product/${field}`, errors);
  throwFirstValidationError({ ok: errors.length === 0, errors }, `Invalid product.${field}`);
  return container[field];
}

export function extractRevisionLineageIdentityFromConfig(config, {
  configSha256,
  selection = SELECTED_REVISION_LINEAGE_PACKAGE,
  packageDirectory,
  identityOrigins,
} = {}) {
  if (!isPlainObject(config)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      'Authoritative config must be an object'
    );
  }
  const selected = assertRevisionLineagePackageSelection(selection);
  const declaredDirectory = packageDirectory ?? selected.package_directory;
  compareDeclaredIdentity(declaredDirectory, selected.package_directory, 'package_directory');

  const product = config.product;
  const packageSlug = explicitConfigIdentityValue(config, product, 'package_slug');
  const partId = explicitConfigIdentityValue(config, product, 'part_id');
  const revision = explicitConfigIdentityValue(config, product, 'revision');
  if (!own(config, 'name')) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY,
      'Config name legacy alias must be explicitly declared in proof mode'
    );
  }
  const nameErrors = [];
  validateIdentityString(config.name, 'part_id', '/name', nameErrors);
  throwFirstValidationError({ ok: nameErrors.length === 0, errors: nameErrors }, 'Invalid config.name');

  const identity = assertRevisionLineageIdentity({
    package_slug: packageSlug,
    part_id: partId,
    revision,
    config_sha256: configSha256,
  }, {
    origins: identityOrigins ?? {
      package_slug: 'explicit',
      part_id: 'explicit',
      revision: 'explicit',
      config_sha256: 'computed',
    },
  });

  compareDeclaredIdentity(basename(selected.package_directory), packageSlug, 'directory package slug');
  compareDeclaredIdentity(packageSlug, selected.package_slug, 'package_slug');
  compareDeclaredIdentity(partId, selected.part_id, 'part_id');
  compareDeclaredIdentity(revision, selected.revision, 'revision');
  compareDeclaredIdentity(config.name, partId, 'config.name alias');
  return identity;
}

function repoRelative(root, target) {
  return relative(root, target).replaceAll('\\', '/');
}

function isInside(root, target) {
  const pathValue = repoRelative(root, target);
  return pathValue === ''
    || (!pathValue.startsWith('../') && pathValue !== '..' && !isAbsolute(pathValue));
}

async function resolveTrustedProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim() || projectRoot.includes('\0')) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH,
      'projectRoot must be an explicit directory path'
    );
  }
  const requested = resolve(projectRoot);
  let info;
  try {
    info = await lstat(requested);
  } catch (error) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE,
      'projectRoot does not exist or cannot be inspected',
      { cause_code: error?.code || null }
    );
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.SYMLINK_FORBIDDEN,
      'projectRoot must be a real directory, not a symbolic link'
    );
  }
  return realpath(requested);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function readSafeFileState({ projectRoot, path: pathValue, maxBytes, minBytes = 0 }) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MISSING_PARENT,
      'Revision-lineage input path is required'
    );
  }
  const locator = assertSafeLocator(pathValue, 'revision-lineage input path');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.INPUT_SIZE_OUT_OF_BOUNDS,
      'maxBytes must be a positive safe integer'
    );
  }
  const root = await resolveTrustedProjectRoot(projectRoot);
  const absolute = resolve(root, locator);
  if (!isInside(root, absolute)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE,
      'Revision-lineage input path escapes projectRoot'
    );
  }

  let before;
  try {
    before = await lstat(absolute);
  } catch (error) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MISSING_PARENT,
      `Revision-lineage input does not exist: ${locator}`,
      { cause_code: error?.code || null, path: locator }
    );
  }
  if (before.isSymbolicLink()) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.SYMLINK_FORBIDDEN,
      `Revision-lineage input must not be a symbolic link: ${locator}`
    );
  }
  if (!before.isFile()) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      `Revision-lineage input must be a regular file: ${locator}`
    );
  }
  if (before.nlink !== 1) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.HARDLINK_FORBIDDEN,
      `Revision-lineage input must not be a hardlink alias: ${locator}`
    );
  }
  if (before.size < minBytes || before.size > maxBytes) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.INPUT_SIZE_OUT_OF_BOUNDS,
      `Revision-lineage input must be between ${minBytes} and ${maxBytes} bytes`,
      { size_bytes: before.size, min_bytes: minBytes, max_bytes: maxBytes }
    );
  }

  const canonical = await realpath(absolute);
  if (!isInside(root, canonical)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE,
      `Revision-lineage input resolves outside projectRoot: ${locator}`
    );
  }
  if (canonical !== absolute) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.SYMLINK_FORBIDDEN,
      `Revision-lineage input path must not traverse a symbolic-link ancestor: ${locator}`
    );
  }

  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameFileIdentity(before, opened)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.INPUT_CHANGED_DURING_READ,
        `Revision-lineage input changed before it could be read safely: ${locator}`
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(opened, after) || bytes.byteLength !== opened.size) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.INPUT_CHANGED_DURING_READ,
        `Revision-lineage input changed while it was being read: ${locator}`
      );
    }
    return {
      root,
      absolute,
      path: locator,
      bytes: Buffer.from(bytes),
      sha256: sha256Bytes(bytes),
      size_bytes: bytes.byteLength,
      file_identity: Object.freeze({
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
        nlink: after.nlink,
      }),
    };
  } catch (error) {
    if (error instanceof RevisionLineageError) throw error;
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.INPUT_CHANGED_DURING_READ,
      `Revision-lineage input could not be read safely: ${locator}`,
      { cause_code: error?.code || null }
    );
  } finally {
    await handle?.close();
  }
}

function createPublicSnapshot(state, extra = {}) {
  const snapshot = {
    path: state.path,
    sha256: state.sha256,
    size_bytes: state.size_bytes,
    ...extra,
  };
  Object.defineProperty(snapshot, 'bytes', {
    enumerable: false,
    configurable: false,
    get: () => Buffer.from(state.bytes),
  });
  Object.defineProperty(snapshot, 'file_identity', {
    enumerable: false,
    configurable: false,
    get: () => state.file_identity,
  });
  Object.freeze(snapshot);
  snapshotState.set(snapshot, state);
  return snapshot;
}

export async function readRevisionLineageFileSnapshot({
  projectRoot,
  path,
  maxBytes = REVISION_LINEAGE_MAX_PARENT_BYTES,
} = {}) {
  const state = await readSafeFileState({ projectRoot, path, maxBytes });
  return createPublicSnapshot(state);
}

function decodeStrictUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      'Authoritative config must contain valid UTF-8',
      { cause_code: 'invalid_utf8', cause_message: error.message }
    );
  }
}

function assertNoBom(bytes) {
  if (bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      'Authoritative config must not contain a UTF-8 BOM',
      { cause_code: 'bom_forbidden' }
    );
  }
}

function assertSafeConfigDocument(document) {
  const bounds = validateJsonDocumentBounds(document, { maxDepth: 64, maxNodes: 50_000 });
  if (!bounds.ok) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      bounds.errors[0].message,
      { cause_code: bounds.errors[0].code }
    );
  }
  const stack = [{ value: document, path: '/' }];
  while (stack.length > 0) {
    const { value, path } = stack.pop();
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
        `Authoritative config contains a non-finite number at ${path}`,
        { cause_code: 'non_finite_number', path }
      );
    }
    if (!value || typeof value !== 'object') continue;
    const entries = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry])
      : Object.entries(value);
    for (const [key, entry] of entries) {
      if (UNSAFE_OBJECT_KEYS.has(key)) {
        throw lineageError(
          REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
          `Authoritative config contains unsafe key ${key}`,
          { cause_code: 'unsafe_config_key', path: `${path}${key}` }
        );
      }
      stack.push({ value: entry, path: `${path}${key}/` });
    }
  }
}

function parseConfigSnapshot(state) {
  assertNoBom(state.bytes);
  const text = decodeStrictUtf8(state.bytes);
  const format = extname(state.path).toLowerCase().slice(1);
  let config;
  try {
    if (format === 'json') {
      config = parseInspectionEvidenceJsonBytes(state.bytes, { requireCanonical: false });
    } else if (format === 'toml') {
      config = parseToml(text);
    } else {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
        'Authoritative config must use .toml or .json',
        { cause_code: 'unsupported_config_format' }
      );
    }
  } catch (error) {
    if (error instanceof RevisionLineageError) throw error;
    const duplicate = error?.code === 'duplicate_json_key'
      || /redefine an already defined table or value/i.test(error?.message || '');
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      `Authoritative config is not valid ${format.toUpperCase()}: ${error.message}`,
      { cause_code: duplicate ? 'duplicate_config_key' : (error?.code || 'parse_error') }
    );
  }
  if (!isPlainObject(config)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      'Authoritative config root must be an object',
      { cause_code: 'config_root_not_object' }
    );
  }
  assertSafeConfigDocument(config);
  return { format, text, config };
}

export async function readAuthoritativeConfigSnapshot({
  projectRoot,
  configPath,
  selection = SELECTED_REVISION_LINEAGE_PACKAGE,
  maxBytes = REVISION_LINEAGE_MAX_CONFIG_BYTES,
} = {}) {
  const selected = assertRevisionLineagePackageSelection(selection);
  const path = assertSelectedRevisionLineagePath(configPath, {
    selection: selected,
    role: 'authoritative_config',
  });
  const state = await readSafeFileState({
    projectRoot,
    path,
    maxBytes,
    minBytes: 1,
  });
  const parsed = parseConfigSnapshot(state);
  const identity = extractRevisionLineageIdentityFromConfig(parsed.config, {
    configSha256: state.sha256,
    selection: selected,
    packageDirectory: selected.package_directory,
  });
  if (!validateConfigSchema(parsed.config)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG,
      'Authoritative config failed the canonical config schema',
      { cause_code: 'config_schema_invalid', errors: validateConfigSchema.errors || [] }
    );
  }
  deepFreeze(parsed.config);
  const origin = deepFreeze({
    kind: 'authoritative_config',
    path: state.path,
    format: parsed.format,
    sha256: state.sha256,
    size_bytes: state.size_bytes,
  });
  return createPublicSnapshot(state, {
    format: parsed.format,
    text: parsed.text,
    config: parsed.config,
    identity,
    origin,
  });
}

export function buildRevisionLineageParentFromSnapshot({
  artifactType,
  artifact_type,
  role,
  snapshot,
} = {}) {
  if (!snapshotState.has(snapshot)) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      'Parent reference requires a trusted read-once revision-lineage snapshot'
    );
  }
  if (artifactType !== undefined
    && artifact_type !== undefined
    && artifactType !== artifact_type) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY,
      'artifactType and artifact_type disagree'
    );
  }
  return buildRevisionLineageParent({
    artifactType: artifactType ?? artifact_type,
    role,
    path: snapshot.path,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.size_bytes,
  });
}

export async function assertRevisionLineageSnapshotCurrent(snapshot, {
  projectRoot,
  maxBytes = REVISION_LINEAGE_MAX_PARENT_BYTES,
} = {}) {
  const state = snapshotState.get(snapshot);
  if (!state) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY,
      'Snapshot was not produced by the revision-lineage read-once reader'
    );
  }
  let current;
  try {
    current = await readSafeFileState({
      projectRoot: projectRoot ?? state.root,
      path: state.path,
      maxBytes,
    });
  } catch (error) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.STALE_PARENT,
      `Revision-lineage snapshot is no longer current: ${state.path}`,
      { cause_code: error?.code || null }
    );
  }
  if (current.sha256 !== state.sha256
    || current.size_bytes !== state.size_bytes
    || (state.file_identity && !sameFileIdentity(current.file_identity, state.file_identity))) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.STALE_PARENT,
      `Revision-lineage snapshot changed after validation: ${state.path}`,
      {
        expected_sha256: state.sha256,
        actual_sha256: current.sha256,
        expected_size_bytes: state.size_bytes,
        actual_size_bytes: current.size_bytes,
      }
    );
  }
  return true;
}

export async function verifyRevisionLineageParentReference(parent, {
  projectRoot,
  portablePathRoot = null,
  maxBytes = REVISION_LINEAGE_MAX_PARENT_BYTES,
} = {}) {
  const expected = assertRevisionLineageParent(parent);
  let actualPath = expected.path;
  if (expected.path.startsWith('run/')) {
    if (typeof portablePathRoot !== 'string' || !portablePathRoot.trim() || portablePathRoot.includes('\0')) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH,
        'run/ revision-lineage parents require an explicit portablePathRoot'
      );
    }
    const project = resolve(projectRoot);
    const runRoot = isAbsolute(portablePathRoot)
      ? resolve(portablePathRoot)
      : resolve(project, portablePathRoot);
    const runRelative = expected.path.slice('run/'.length);
    const actual = resolve(runRoot, runRelative);
    if (!runRelative || !isInside(runRoot, actual) || !isInside(project, runRoot)) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE,
        'run/ revision-lineage parent escapes its explicit portablePathRoot',
        { path: expected.path }
      );
    }
    actualPath = repoRelative(project, actual);
  } else if (expected.path.startsWith('input/') || expected.path.startsWith('runtime/')) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH,
      'input/ and runtime/ locators are not proof-parent resolution namespaces',
      { path: expected.path }
    );
  }
  let current;
  try {
    current = await readRevisionLineageFileSnapshot({
      projectRoot,
      path: actualPath,
      maxBytes,
    });
  } catch (error) {
    if (error?.code === REVISION_LINEAGE_REASON_CODES.MISSING_PARENT) {
      throw lineageError(
        REVISION_LINEAGE_REASON_CODES.STALE_PARENT,
        `Revision-lineage parent is missing: ${expected.path}`,
        { cause_code: error.code }
      );
    }
    throw error;
  }
  const sizeMismatch = own(expected, 'size_bytes') && expected.size_bytes !== current.size_bytes;
  if (expected.sha256 !== current.sha256 || sizeMismatch) {
    throw lineageError(
      REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH,
      `Revision-lineage parent bytes do not match the bound digest: ${expected.path}`,
      {
        expected_sha256: expected.sha256,
        actual_sha256: current.sha256,
        expected_size_bytes: own(expected, 'size_bytes') ? expected.size_bytes : null,
        actual_size_bytes: current.size_bytes,
      }
    );
  }
  return current;
}
