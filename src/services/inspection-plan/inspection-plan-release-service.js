import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parseInspectionEvidenceJsonBytes } from '../../../lib/inspection-evidence-onboarding.js';
import { assertValidInspectionPlan } from '../../../lib/inspection-plan-contract.js';
import {
  assertValidInspectionPlanReleaseAuthorization,
  assertValidInspectionPlanReleaseRecord,
  canonicalizeInspectionControlDocument,
} from '../../../lib/inspection-result-contract.js';
import { publishAtomicOutputSet } from '../../../lib/atomic-output-publication.js';
import { prepareSafeOutputDirectory, readSafeSnapshot, sha256 } from '../inspection-result/safe-snapshot.js';
import { renderInspectionChecksheet, renderInspectionResultTemplate, renderSupplierInspectionRequest } from './inspection-plan-service.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_DISTRIBUTED_BYTES = 8 * 1024 * 1024;
const FILE_TYPES = Object.freeze([
  ['checksheet', 'inspection_checksheet.csv'],
  ['supplier_request', 'supplier_inspection_request.md'],
  ['result_template', 'inspection_result_template.csv'],
]);

function parseCanonicalJson(snapshot, label) {
  try { return parseInspectionEvidenceJsonBytes(snapshot.bytes, { requireCanonical: true }); }
  catch (error) { throw new Error(`${label} must be canonical bounded JSON: ${error.message}`, { cause: error }); }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

export async function createInspectionPlanReleaseRecordFromPaths({ projectRoot, inspectionPlanPath, authorizationPath, generatorVersion = '1.0.0', afterSnapshot = null }) {
  const planSnapshot = await readSafeSnapshot({ projectRoot, path: inspectionPlanPath, label: 'inspection plan', maxBytes: MAX_JSON_BYTES });
  const authorizationSnapshot = await readSafeSnapshot({ projectRoot, path: authorizationPath, label: 'release authorization', maxBytes: MAX_JSON_BYTES });
  const plan = assertValidInspectionPlan(parseCanonicalJson(planSnapshot, 'inspection plan'));
  const authorization = assertValidInspectionPlanReleaseAuthorization(parseCanonicalJson(authorizationSnapshot, 'release authorization'));
  if (plan.status !== 'ready_for_human_release') throw new Error('Inspection plan must be ready_for_human_release before execution release');
  assertEqual(authorization.plan.plan_id, plan.plan_id, 'plan ID');
  assertEqual(authorization.plan.sha256, planSnapshot.sha256, 'inspection plan SHA-256');
  assertEqual(authorization.package.slug, plan.package.slug, 'package slug');
  assertEqual(authorization.package.revision, plan.package.revision, 'package revision');
  assertEqual(authorization.inspection_scope, plan.scope, 'inspection scope');

  const distributed = [];
  const expectedContent = {
    checksheet: renderInspectionChecksheet(plan),
    supplier_request: renderSupplierInspectionRequest(plan, planSnapshot.sha256),
    result_template: renderInspectionResultTemplate(plan),
  };
  for (const [key, artifactType] of FILE_TYPES) {
    const binding = authorization.distributed_files[key];
    if (!binding) continue;
    const snapshot = await readSafeSnapshot({ projectRoot, path: binding.path, label: key.replaceAll('_', ' '), maxBytes: MAX_DISTRIBUTED_BYTES });
    assertEqual(binding.sha256, snapshot.sha256, `${key} SHA-256`);
    assertEqual(snapshot.sha256, sha256(Buffer.from(expectedContent[key], 'utf8')), `${key} deterministic plan derivative`);
    distributed.push({ artifact_type: artifactType, path: snapshot.relativePath, sha256: snapshot.sha256 });
  }
  if (!distributed.some((entry) => entry.artifact_type === 'inspection_result_template.csv')) throw new Error('Released result template is required');
  if (Date.parse(authorization.released_at) < Date.parse(authorization.engineering_review.reviewed_at)
      || Date.parse(authorization.released_at) < Date.parse(authorization.quality_review.reviewed_at)) {
    throw new Error('Release timestamp must not precede engineering or quality review');
  }
  await afterSnapshot?.({ plan: structuredClone(plan), authorization: structuredClone(authorization), distributed: structuredClone(distributed) });
  const releaseRecordId = `inspection-plan-release:${sha256(Buffer.from([authorizationSnapshot.sha256, planSnapshot.sha256, ...distributed.map((entry) => entry.sha256)].join('\0'))).slice(0, 32)}`;
  return assertValidInspectionPlanReleaseRecord({
    artifact_type: 'inspection_plan_release_record',
    schema_version: '1.0',
    release_record_id: releaseRecordId,
    state: 'released_for_inspection_execution',
    package: { slug: plan.package.slug, revision: plan.package.revision },
    inspection_scope: plan.scope,
    authorization: { id: authorization.authorization_id, path: authorizationSnapshot.relativePath, sha256: authorizationSnapshot.sha256 },
    plan: { plan_id: plan.plan_id, path: planSnapshot.relativePath, sha256: planSnapshot.sha256, status: plan.status },
    distributed_files: distributed,
    released_at: authorization.released_at,
    reviewers: { engineering: authorization.engineering_review, quality: authorization.quality_review },
    released_by: authorization.released_by,
    generator_context: { generator: 'fcad', version: generatorVersion },
    boundaries: {
      inspection_evidence: false, product_release: false, readiness_approved: false,
      evidence_attached: false, readiness_regenerated: false, cryptographic_signature: false,
      authorization_scope: 'inspection_execution_only',
    },
  });
}

export async function writeInspectionPlanReleaseRecord({ projectRoot, record, outputPath, publicationHooks = {} }) {
  const target = await prepareSafeOutputDirectory({ projectRoot, outputPath, label: 'release-record output' });
  const content = canonicalizeInspectionControlDocument(assertValidInspectionPlanReleaseRecord(record));
  try {
    const info = await lstat(target.absolute);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error('release-record output target is unsafe');
    const prior = await readFile(target.absolute);
    if (sha256(prior) !== sha256(Buffer.from(content))) throw new Error('Pre-existing conflicting release-record output is forbidden');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await publishAtomicOutputSet({ directory: dirname(target.absolute), outputs: [{ path: target.absolute, content }], hooks: publicationHooks });
  return target.absolute;
}
