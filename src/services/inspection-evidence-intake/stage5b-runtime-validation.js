import {
  validateStage5bArtifact,
  validateStage5bAuditManifest,
  validateStage5bAuditSummaryMarkdown,
  validateStage5bIntakeReport,
  validateStage5bPromotionDryRunManifest,
} from '../../../lib/stage5b-artifact-contracts.js';

export class Stage5bRuntimeValidationError extends Error {
  constructor(label, errors = []) {
    const uniqueErrors = [...new Set(errors.filter(Boolean))];
    super(`Invalid Stage 5B ${label}: ${uniqueErrors.join('; ') || 'unknown validation failure'}`);
    this.name = 'Stage5bRuntimeValidationError';
    this.validation_errors = uniqueErrors;
  }
}

function assertValidation(label, validation) {
  if (validation.ok) return validation;
  throw new Stage5bRuntimeValidationError(label, validation.errors);
}

export function assertValidStage5bIntakeReport(report, { label = 'intake report' } = {}) {
  return assertValidation(label, validateStage5bIntakeReport(report));
}

export function assertValidStage5bPromotionDryRunManifest(manifest, { label = 'promotion dry-run manifest' } = {}) {
  return assertValidation(label, validateStage5bPromotionDryRunManifest(manifest));
}

export function assertValidStage5bAuditManifest(manifest, { label = 'audit manifest' } = {}) {
  return assertValidation(label, validateStage5bAuditManifest(manifest));
}

export function assertValidStage5bAuditSummaryMarkdown(markdown, { label = 'audit summary markdown' } = {}) {
  return assertValidation(label, validateStage5bAuditSummaryMarkdown(markdown));
}

export function assertValidStage5bArtifact(document, { label = 'artifact' } = {}) {
  return assertValidation(label, validateStage5bArtifact(document));
}
