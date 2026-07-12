import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { canonicalizeInspectionControlDocument } from '../lib/inspection-result-contract.js';
import {
  createInspectionPlanReleaseRecordFromPaths,
  writeInspectionPlanReleaseRecord,
} from '../src/services/inspection-plan/inspection-plan-release-service.js';
import {
  createInspectionPlanFromPaths,
  writeInspectionPlanOutputs,
} from '../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK = resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json');
const GENERATED_AT = '2026-07-12T01:02:03Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(join(resolve(ROOT, 'tmp/codex'), 'inspection-result-test-'));

try {
  const reviewPackPath = join(temp, 'review_pack.json');
  await writeFile(reviewPackPath, (await readFile(REVIEW_PACK, 'utf8'))
    .replaceAll('fixture', 'inspection')
    .replaceAll('FIXTURE', 'INSPECTION')
    .replaceAll('Synthetic', 'Validation')
    .replaceAll('synthetic', 'validation'));
  const plan = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath, scope: 'full', generatedAt: GENERATED_AT });
  assert.equal(plan.status, 'ready_for_human_release');
  const paths = {
    plan: join(temp, 'inspection_plan.json'), checksheet: join(temp, 'inspection_checksheet.csv'),
    request: join(temp, 'supplier_inspection_request.md'), template: join(temp, 'inspection_result_template.csv'),
    authorization: join(temp, 'inspection_plan_release_authorization.json'), record: join(temp, 'inspection_plan_release_record.json'),
  };
  await writeInspectionPlanOutputs({ projectRoot: ROOT, plan, outputPath: rel(paths.plan), checksheetPath: rel(paths.checksheet), requestPath: rel(paths.request), resultTemplatePath: rel(paths.template) });
  const planBytes = await readFile(paths.plan);
  const authorization = {
    artifact_type: 'inspection_plan_release_authorization', schema_version: '1.0', authorization_id: 'release-auth:fixture-001', decision: 'release_for_inspection_execution',
    package: { slug: plan.package.slug, revision: plan.package.revision }, plan: { plan_id: plan.plan_id, sha256: sha(planBytes) },
    distributed_files: {
      checksheet: { path: rel(paths.checksheet), sha256: sha(await readFile(paths.checksheet)) },
      supplier_request: { path: rel(paths.request), sha256: sha(await readFile(paths.request)) },
      result_template: { path: rel(paths.template), sha256: sha(await readFile(paths.template)) },
    },
    inspection_scope: plan.scope,
    engineering_review: { identity_ref: 'user:engineering-reviewer', role_ref: 'role:engineering', reviewed_at: GENERATED_AT },
    quality_review: { identity_ref: 'user:quality-reviewer', role_ref: 'role:quality', reviewed_at: GENERATED_AT },
    released_by: { identity_ref: 'user:release-controller', role_ref: 'role:quality-release' }, released_at: GENERATED_AT,
    external_controlled_document_ref: null, confidentiality_classification: 'internal', notes: null,
    boundaries: { inspection_evidence: false, product_release: false, readiness_approval: false, evidence_attached: false, readiness_regeneration_authorized: false, scope: 'exact_bound_files_for_inspection_execution_only' },
  };
  await writeFile(paths.authorization, canonicalizeInspectionControlDocument(authorization));
  const releaseRecord = await createInspectionPlanReleaseRecordFromPaths({ projectRoot: ROOT, inspectionPlanPath: paths.plan, authorizationPath: paths.authorization, generatorVersion: 'fixture-version' });
  assert.equal(releaseRecord.state, 'released_for_inspection_execution');
  assert.equal(releaseRecord.boundaries.inspection_evidence, false);
  await writeInspectionPlanReleaseRecord({ projectRoot: ROOT, record: releaseRecord, outputPath: paths.record });
  const tamperedChecksheet = join(temp, 'tampered_checksheet.csv');
  const tamperedAuthorizationPath = join(temp, 'tampered_authorization.json');
  await writeFile(tamperedChecksheet, 'not the plan derivative\n');
  const tamperedAuthorization = structuredClone(authorization);
  tamperedAuthorization.authorization_id = 'release-auth:tampered-001';
  tamperedAuthorization.distributed_files.checksheet = { path: rel(tamperedChecksheet), sha256: sha(await readFile(tamperedChecksheet)) };
  await writeFile(tamperedAuthorizationPath, canonicalizeInspectionControlDocument(tamperedAuthorization));
  await assert.rejects(createInspectionPlanReleaseRecordFromPaths({ projectRoot: ROOT, inspectionPlanPath: paths.plan, authorizationPath: tamperedAuthorizationPath }), /deterministic plan derivative/);
  const releaseCli = spawnSync(process.execPath, [resolve(ROOT, 'bin/fcad.js'), 'inspection-plan-release-record', '--inspection-plan', paths.plan, '--authorization', paths.authorization, '--out', join(temp, 'cli_release_record.json')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(releaseCli.status, 0, `${releaseCli.stdout}\n${releaseCli.stderr}`);
  assert.match(releaseCli.stdout, /inspection execution only/i);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('inspection-result-normalization.test.js: ok');
