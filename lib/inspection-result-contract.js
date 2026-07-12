import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMAS = Object.freeze({
  releaseAuthorization: new URL('../schemas/inspection-plan-release-authorization.schema.json', import.meta.url),
  releaseRecord: new URL('../schemas/inspection-plan-release-record.schema.json', import.meta.url),
  submissionMetadata: new URL('../schemas/inspection-result-submission-metadata.schema.json', import.meta.url),
  normalization: new URL('../schemas/inspection_result_normalization.schema.json', import.meta.url),
});

const ajv = new Ajv2020({ allErrors: true, strict: false, strictNumbers: true, validateFormats: false });
const validators = Object.fromEntries(Object.entries(SCHEMAS).map(([key, url]) => [key, ajv.compile(JSON.parse(readFileSync(url, 'utf8')))]));

function validationResult(validator, document) {
  const ok = validator(document);
  const errors = ok ? [] : (validator.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  return { ok: Boolean(ok), errors };
}

function withDates(result, values) {
  const errors = [...result.errors];
  for (const [value, path] of values) if (!Number.isFinite(Date.parse(value || ''))) errors.push(`${path} must be a parseable ISO-8601 timestamp`);
  return { ok: errors.length === 0, errors };
}

export function validateInspectionPlanReleaseAuthorization(document) {
  return withDates(validationResult(validators.releaseAuthorization, document), [
    [document?.engineering_review?.reviewed_at, '/engineering_review/reviewed_at'],
    [document?.quality_review?.reviewed_at, '/quality_review/reviewed_at'],
    [document?.released_at, '/released_at'],
  ]);
}

export function validateInspectionPlanReleaseRecord(document) {
  return withDates(validationResult(validators.releaseRecord, document), [
    [document?.reviewers?.engineering?.reviewed_at, '/reviewers/engineering/reviewed_at'],
    [document?.reviewers?.quality?.reviewed_at, '/reviewers/quality/reviewed_at'],
    [document?.released_at, '/released_at'],
  ]);
}

export function validateInspectionResultSubmissionMetadata(document) {
  return withDates(validationResult(validators.submissionMetadata, document), [[document?.completed_at, '/completed_at']]);
}

export function validateInspectionResultNormalization(document) {
  return withDates(validationResult(validators.normalization, document), [[document?.generated_at, '/generated_at']]);
}

function assertResult(label, result, document) {
  if (!result.ok) throw new Error(`${label} validation failed: ${result.errors.join(' | ')}`);
  return document;
}

export const assertValidInspectionPlanReleaseAuthorization = (document) => assertResult('Inspection plan release authorization', validateInspectionPlanReleaseAuthorization(document), document);
export const assertValidInspectionPlanReleaseRecord = (document) => assertResult('Inspection plan release record', validateInspectionPlanReleaseRecord(document), document);
export const assertValidInspectionResultSubmissionMetadata = (document) => assertResult('Inspection result submission metadata', validateInspectionResultSubmissionMetadata(document), document);
export const assertValidInspectionResultNormalization = (document) => assertResult('Inspection result normalization', validateInspectionResultNormalization(document), document);

export function canonicalizeInspectionControlDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}
