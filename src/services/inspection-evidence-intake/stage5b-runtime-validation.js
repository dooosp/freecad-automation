import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, win32 } from 'node:path';

import {
  validateStage5bArtifact,
  validateStage5bAuditManifest,
  validateStage5bAuditSummaryMarkdown,
  validateStage5bIntakeReport,
  validateStage5bPromotionDryRunManifest,
} from '../../../lib/stage5b-artifact-contracts.js';

export const STAGE5B_EVIDENCE_BOUNDARY_NOTE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\(?:[^\\\r\n"'`<>|]+\\?)+|\\\\[^\s"'`<>|]+(?:\\[^\s"'`<>|]+)+)/g;
const POSIX_PATH_PATTERN = /(?:\/(?:[^\/\s"'`<>()]+\/)+[^\/\s"'`<>()]+)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const isIpv6 = host.includes(':');
  return host === 'localhost'
    || host === '::1'
    || host.endsWith('.local')
    || (isIpv6 && (host.startsWith('fd') || host.startsWith('fc') || host.startsWith('fe80:')))
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^169\.254\./.test(host);
}

function sanitizePublicUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function basenameFromAnyPath(value) {
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function redactEmbeddedFilesystemPaths(value) {
  return String(value || '')
    .replace(WINDOWS_PATH_PATTERN, (match) => basenameFromAnyPath(match))
    .replace(POSIX_PATH_PATTERN, (match) => basenameFromAnyPath(match));
}

function redactSecrets(value) {
  return redactEmbeddedFilesystemPaths(String(value || '')
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted-header]')
    .replace(/\b(?:x-api-key|api-key|api_key|apikey|access_token|token|secret)\s*[:=]\s*[^&\s,;]+/gi, '[redacted-secret]')
    .replace(/gho_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(URL_PATTERN, (match) => sanitizePublicUrl(match) || '[redacted-url]')
    .replace(/\b[a-z0-9.-]+\.local\b/gi, '[redacted-host]'));
}

function sanitizePathLike(value, { projectRoot = null, allowUrl = false } = {}) {
  if (value === null || value === undefined) return null;
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return allowUrl ? sanitizePublicUrl(raw) : null;
  }

  if (projectRoot) {
    const root = resolve(projectRoot);
    const absolute = isAbsolute(raw) || isWindowsAbsolutePath(raw)
      ? resolve(raw)
      : resolve(root, raw);
    const rel = relative(root, absolute).replaceAll('\\', '/');
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  }

  const redacted = redactSecrets(raw).trim();
  if (!redacted) return null;
  const normalized = redacted.replaceAll('\\', '/');
  if (isAbsolute(redacted) || isWindowsAbsolutePath(redacted)) {
    return win32.isAbsolute(redacted) ? win32.basename(redacted) : basename(redacted);
  }
  return normalized;
}

function withDiagnosticContext(diagnostic = {}, {
  artifactType = null,
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return {
    artifact_type: diagnostic.artifact_type || artifactType || 'unknown',
    artifact_path: sanitizePathLike(diagnostic.artifact_path || artifactPath, { projectRoot }) || null,
    validation_stage: diagnostic.validation_stage || 'runtime',
    severity: diagnostic.severity || 'error',
    code: diagnostic.code || 'stage5b.validation_failed',
    message: redactSecrets(diagnostic.message || 'Stage 5B validation failed.'),
    json_pointer: diagnostic.json_pointer || '/',
    remediation: redactSecrets(diagnostic.remediation || 'Fix the Stage 5B control artifact field indicated by json_pointer, then rerun validation.'),
    evidence_boundary_note: diagnostic.evidence_boundary_note || STAGE5B_EVIDENCE_BOUNDARY_NOTE,
    safe_source_ref: sanitizePathLike(diagnostic.safe_source_ref, { projectRoot, allowUrl: true }),
  };
}

function diagnosticsFromValidation(validation = {}, context = {}) {
  const structured = safeList(validation.diagnostics);
  if (structured.length > 0) {
    return structured.map((diagnostic) => withDiagnosticContext(diagnostic, context));
  }
  return safeList(validation.errors).map((message) => withDiagnosticContext({
    validation_stage: context.validationStage || 'runtime',
    code: 'stage5b.validation_failed',
    message,
  }, context));
}

export class Stage5bRuntimeValidationError extends Error {
  constructor(label, validation = {}, context = {}) {
    const errors = Array.isArray(validation)
      ? validation
      : safeList(validation.errors);
    const uniqueErrors = [...new Set(errors.filter(Boolean).map((error) => redactSecrets(error)))];
    super(`Invalid Stage 5B ${label}: ${uniqueErrors.join('; ') || 'unknown validation failure'}`);
    this.name = 'Stage5bRuntimeValidationError';
    this.validation_errors = uniqueErrors;
    this.diagnostics = diagnosticsFromValidation(validation, context);
    this.validation_diagnostics = buildStage5bValidationDiagnosticsPayload(this, context);
  }
}

function assertValidation(label, validation, context = {}) {
  if (validation.ok) return validation;
  throw new Stage5bRuntimeValidationError(label, validation, context);
}

export function buildStage5bValidationDiagnosticsPayload(error, {
  artifactType = null,
  artifactPath = null,
  projectRoot = null,
  command = null,
  generatedAt = null,
} = {}) {
  const sourceDiagnostics = safeList(error?.diagnostics).length > 0
    ? error.diagnostics
    : diagnosticsFromValidation({ errors: error?.validation_errors || [error?.message || 'Stage 5B validation failed.'] }, {
      artifactType,
      artifactPath,
      projectRoot,
    });
  const diagnostics = sourceDiagnostics.map((diagnostic) => withDiagnosticContext(diagnostic, {
    artifactType,
    artifactPath,
    projectRoot,
  }));
  const first = diagnostics[0] || {};
  return {
    artifact_type: artifactType || first.artifact_type || 'unknown',
    artifact_path: sanitizePathLike(artifactPath || first.artifact_path, { projectRoot }) || null,
    validation_status: 'failed',
    generated_at: generatedAt || new Date().toISOString(),
    command: command || null,
    diagnostic_count: diagnostics.length,
    diagnostics,
    evidence_boundary_note: STAGE5B_EVIDENCE_BOUNDARY_NOTE,
  };
}

export async function writeStage5bValidationDiagnosticsFile(pathValue, error, context = {}) {
  if (!pathValue) return null;
  const payload = buildStage5bValidationDiagnosticsPayload(error, context);
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return {
    path: sanitizePathLike(pathValue, { projectRoot: context.projectRoot }) || pathValue,
    payload,
  };
}

export function isStage5bRuntimeValidationError(error) {
  return error?.name === 'Stage5bRuntimeValidationError'
    || error instanceof Stage5bRuntimeValidationError;
}

export function assertValidStage5bIntakeReport(report, {
  label = 'intake report',
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return assertValidation(label, validateStage5bIntakeReport(report), {
    artifactType: 'inspection_evidence_intake_report',
    artifactPath,
    projectRoot,
  });
}

export function assertValidStage5bPromotionDryRunManifest(manifest, {
  label = 'promotion dry-run manifest',
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return assertValidation(label, validateStage5bPromotionDryRunManifest(manifest), {
    artifactType: 'inspection_evidence_promotion_dry_run_manifest',
    artifactPath,
    projectRoot,
  });
}

export function assertValidStage5bAuditManifest(manifest, {
  label = 'audit manifest',
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return assertValidation(label, validateStage5bAuditManifest(manifest), {
    artifactType: 'stage5b_evidence_audit_manifest',
    artifactPath,
    projectRoot,
  });
}

export function assertValidStage5bAuditSummaryMarkdown(markdown, {
  label = 'audit summary markdown',
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return assertValidation(label, validateStage5bAuditSummaryMarkdown(markdown), {
    artifactType: 'stage5b_evidence_audit_summary_markdown',
    artifactPath,
    projectRoot,
  });
}

export function assertValidStage5bArtifact(document, {
  label = 'artifact',
  artifactPath = null,
  projectRoot = null,
} = {}) {
  return assertValidation(label, validateStage5bArtifact(document), {
    artifactType: document?.artifact_type || 'unknown',
    artifactPath,
    projectRoot,
  });
}
