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
  INSPECTION_RESULT_TEMPLATE_COLUMNS,
  createInspectionPlanFromPaths,
  writeInspectionPlanOutputs,
} from '../src/services/inspection-plan/inspection-plan-service.js';
import {
  getInspectionResultAdapter,
  listInspectionResultAdapters,
  normalizeInspectionResultFromPaths,
  parsePlanResultCsvV1,
  writeInspectionResultNormalizationOutputs,
} from '../src/services/inspection-result/inspection-result-normalization-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_PACK = resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json');
const GENERATED_AT = '2026-07-12T01:02:03Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(join(resolve(ROOT, 'tmp/codex'), 'inspection-result-test-'));

function csv(rows) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${INSPECTION_RESULT_TEMPLATE_COLUMNS.join(',')}\n${rows.map((row) => INSPECTION_RESULT_TEMPLATE_COLUMNS.map((column) => cell(row[column])).join(',')).join('\n')}\n`;
}

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
    source: join(temp, 'completed_result.csv'), metadata: join(temp, 'submission_metadata.json'),
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
  const releaseSha = sha(await readFile(paths.record));
  const item = plan.items[0];
  const midpoint = (item.lower_limit + item.upper_limit) / 2;
  const baseRow = {
    plan_id: plan.plan_id, plan_sha256: sha(planBytes), plan_release_record_id: releaseRecord.release_record_id, plan_release_record_sha256: releaseSha,
    plan_item_id: item.plan_item_id, package_slug: plan.package.slug, revision: plan.package.revision, characteristic_id: item.characteristic_id,
    control_material_notice: 'generated blank template - not inspection evidence', measured_value: String(midpoint), measured_unit: item.unit, result: 'pass',
    completion_status: 'completed', final_status: 'final', inspector_reference: 'user:external-inspector', reviewer_reference: 'user:external-reviewer', source_file_sha256: 'a'.repeat(64),
    method_used: item.required_method, equipment_reference: item.required_equipment_class || '', measurement_completed_at: GENERATED_AT, remarks: 'completed measurement',
  };
  const metadata = {
    artifact_type: 'inspection_result_submission_metadata', schema_version: '1.0', package: { slug: plan.package.slug, revision: plan.package.revision }, part_identifier: plan.package.part_identifier,
    plan_id: plan.plan_id, plan_sha256: sha(planBytes), plan_release_record_id: releaseRecord.release_record_id, plan_release_record_sha256: releaseSha,
    source_organization: 'External Metrology Organization', source_type: 'lab', source_record_id: 'record:external-001', original_sanitized_filename: 'completed_result.csv',
    inspection_method: item.required_method, completion_status: 'completed', completed_at: GENERATED_AT, inspector_identity_ref: 'user:external-inspector', origin_reference: 'record:external-001',
    confidentiality_classification: 'internal', redaction_status: 'not_applicable', redacted_fields: [], source_overall_result: null, notes: null,
  };
  await writeFile(paths.metadata, canonicalizeInspectionControlDocument(metadata));
  await writeFile(paths.source, csv([baseRow]));

  assert.deepEqual(listInspectionResultAdapters(), [{ id: 'plan-result-csv-v1', version: '1.0' }]);
  assert.equal(getInspectionResultAdapter('plan-result-csv-v1').supportedPlanSchemaVersions[0], '1.0');
  assert.throws(() => getInspectionResultAdapter('unknown'), /Unknown/);
  assert.throws(() => getInspectionResultAdapter('plan-result-csv-v1', '2.0'), /Unsupported adapter version/);

  const run = async (afterSnapshot = null) => normalizeInspectionResultFromPaths({ projectRoot: ROOT, inspectionPlanPath: paths.plan, planReleaseRecordPath: paths.record, sourcePath: paths.source, submissionMetadataPath: paths.metadata, adapterId: 'plan-result-csv-v1', generatedAt: GENERATED_AT, afterSnapshot });
  const complete = await run();
  assert.equal(complete.normalization.status, 'ready_for_quarantine_review');
  assert.equal(complete.normalization.measurements[0].raw_measured_value, String(midpoint));
  assert.equal(complete.normalization.measurements[0].reported_result, 'pass');
  assert.equal(complete.normalization.measurements[0].computed_result, 'pass');
  assert.equal(complete.normalization.boundaries.inspection_evidence, false);
  assert.equal(complete.normalization.boundaries.authorization_created, false);
  assert.equal(complete.normalization.boundaries.evidence_attached, false);
  assert.equal(complete.normalization.boundaries.readiness_regenerated, false);

  const out = join(temp, 'normalized', 'inspection_result_normalization.json');
  const firstPaths = await writeInspectionResultNormalizationOutputs({ projectRoot: ROOT, normalization: complete.normalization, snapshots: complete.snapshots, outputPath: out });
  const firstBytes = await Promise.all(Object.values(firstPaths).map((path) => readFile(path)));
  await writeInspectionResultNormalizationOutputs({ projectRoot: ROOT, normalization: complete.normalization, snapshots: complete.snapshots, outputPath: out });
  const secondBytes = await Promise.all(Object.values(firstPaths).map((path) => readFile(path)));
  assert.deepEqual(secondBytes, firstBytes, 'fixed-time JSON, Markdown, and manifest must be byte-identical');

  await writeFile(paths.source, csv([{ ...baseRow, measured_value: String(midpoint / 25.4), measured_unit: 'in' }]));
  const converted = await run();
  assert.equal(converted.normalization.measurements[0].normalized_unit, 'mm');
  assert(Math.abs(converted.normalization.measurements[0].normalized_measured_value - midpoint) < 1e-12);

  await writeFile(paths.source, csv([{ ...baseRow, measured_value: String(item.upper_limit + 1), result: 'pass' }]));
  const conflict = await run();
  assert.equal(conflict.normalization.status, 'blocked');
  assert.equal(conflict.normalization.measurements[0].reported_result, 'pass');
  assert.equal(conflict.normalization.measurements[0].computed_result, 'fail');
  assert(conflict.normalization.measurements[0].blockers.includes('reported_pass_computed_fail'));

  await writeFile(paths.source, csv([{ ...baseRow, result: 'fail' }]));
  const reverseConflict = await run();
  assert.equal(reverseConflict.normalization.status, 'review_required');
  assert.equal(reverseConflict.normalization.measurements[0].reported_result, 'fail');
  assert.equal(reverseConflict.normalization.measurements[0].computed_result, 'pass');

  await writeFile(paths.metadata, canonicalizeInspectionControlDocument({ ...metadata, source_overall_result: 'pass' }));
  const overallConflict = await run();
  assert.equal(overallConflict.normalization.status, 'blocked');
  assert(overallConflict.normalization.unresolved.some((entry) => entry.code === 'source_overall_pass_conflict'));
  await writeFile(paths.metadata, canonicalizeInspectionControlDocument(metadata));

  await writeFile(paths.source, csv([{ ...baseRow, plan_item_id: 'ipi:unexpected000000000000000' }]));
  const unexpected = await run();
  assert.equal(unexpected.normalization.status, 'blocked');
  assert.equal(unexpected.normalization.summary.missing_item_count, 1);
  assert.equal(unexpected.normalization.summary.unexpected_item_count, 1);

  await assert.rejects(normalizeInspectionResultFromPaths({ projectRoot: ROOT, inspectionPlanPath: paths.plan, planReleaseRecordPath: paths.record, sourcePath: paths.template, submissionMetadataPath: paths.metadata, adapterId: 'plan-result-csv-v1', generatedAt: GENERATED_AT }), /blank result template/);

  await writeFile(paths.source, csv([baseRow, baseRow]));
  const duplicate = await run();
  assert.equal(duplicate.normalization.status, 'blocked');
  assert(duplicate.normalization.unresolved.some((entry) => entry.code === 'duplicate_plan_item'));

  await writeFile(paths.source, csv([baseRow]));
  const raced = await run(async () => { await writeFile(paths.source, 'replaced-after-snapshot'); });
  assert.equal(raced.normalization.measurements[0].raw_measured_value, String(midpoint));
  assert.equal(raced.normalization.source_snapshot.source_sha256, sha(Buffer.from(csv([baseRow]))));

  await writeFile(paths.source, csv([baseRow]));
  const cliOutput = join(temp, 'cli-normalized', 'inspection_result_normalization.json');
  const normalizeCli = spawnSync(process.execPath, [resolve(ROOT, 'bin/fcad.js'), 'inspection-result-normalize', '--inspection-plan', paths.plan, '--plan-release-record', paths.record, '--source', paths.source, '--submission-metadata', paths.metadata, '--adapter', 'plan-result-csv-v1', '--out', cliOutput, '--generated-at', GENERATED_AT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(normalizeCli.status, 0, `${normalizeCli.stdout}\n${normalizeCli.stderr}`);
  assert.match(normalizeCli.stdout, /Inspection evidence: no/);
  assert.equal(JSON.parse(await readFile(cliOutput, 'utf8')).status, 'ready_for_quarantine_review');

  const validCsv = csv([baseRow]);
  assert.throws(() => parsePlanResultCsvV1(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(validCsv)])), /without BOM/);
  assert.throws(() => parsePlanResultCsvV1(Buffer.from([0xff, 0xfe, 0xfd])), /valid UTF-8/);
  assert.throws(() => parsePlanResultCsvV1(Buffer.from(validCsv.replace(INSPECTION_RESULT_TEMPLATE_COLUMNS.join(','), `${INSPECTION_RESULT_TEMPLATE_COLUMNS[0]},${INSPECTION_RESULT_TEMPLATE_COLUMNS[0]},${INSPECTION_RESULT_TEMPLATE_COLUMNS.slice(2).join(',')}`))), /duplicate headers/);
  assert.throws(() => parsePlanResultCsvV1(Buffer.from(validCsv.replace('completed measurement', '=CMD()'))), /formula-triggering/);
  assert.throws(() => parsePlanResultCsvV1(Buffer.from(validCsv.replace(`${midpoint},${item.unit}`, `1,25,${item.unit}`))), /row 2 width mismatch/);
  assert.throws(() => parsePlanResultCsvV1(Buffer.from(`${INSPECTION_RESULT_TEMPLATE_COLUMNS.join(',')}\n"unterminated`)), /unterminated/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('inspection-result-normalization.test.js: ok');
