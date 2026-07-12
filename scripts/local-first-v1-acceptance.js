import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeInspectionControlDocument } from '../lib/inspection-result-contract.js';
import { INSPECTION_RESULT_TEMPLATE_COLUMNS } from '../src/services/inspection-plan/inspection-plan-service.js';
import {
  buildReadinessReportFromReviewPack,
  writeCanonicalReadinessArtifacts,
} from '../src/workflows/canonical-readiness-builders.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI = resolve(ROOT, 'bin/fcad.js');
const GENERATED_AT = '2026-07-12T02:00:00Z';
const REVIEW_FIXTURE = 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json';
const BASELINE_FIXTURE = 'tests/fixtures/revision-impact/tightened-tolerance-baseline-review-pack.json';
const CANDIDATE_FIXTURE = 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function repoPath(projectRoot, path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Local-first v1 acceptance failed: ${message}`);
}

function runCli(projectRoot, args) {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: projectRoot,
    env: { ...process.env, TZ: 'UTC' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (run.status !== 0) {
    throw new Error(`Command failed (${run.status}): fcad ${args.join(' ')}\n${run.stdout}\n${run.stderr}`);
  }
  return { stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

async function listFiles(root) {
  const output = [];
  async function walk(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) output.push(child);
    }
  }
  await walk(root);
  return output;
}

async function hashEntries(projectRoot, paths) {
  return Promise.all([...paths].sort().map(async (path) => ({
    path: repoPath(projectRoot, path),
    sha256: await sha256File(path),
  })));
}

function treeHash(entries) {
  return sha256(Buffer.from(entries.map((entry) => `${entry.path}\0${entry.sha256}`).join('\n')));
}

async function canonicalSnapshot(projectRoot) {
  const docsExamples = resolve(projectRoot, 'docs/examples');
  const files = await listFiles(docsExamples);
  const normalized = files.map((path) => repoPath(projectRoot, path));
  const readinessJson = files.filter((path) => /\/readiness\/readiness_report\.json$/.test(path));
  const readinessMarkdown = files.filter((path) => /\/readiness\/readiness_report\.md$/.test(path));
  const standardDocs = files.filter((path) => /\/standard-docs\//.test(path));
  const releases = files.filter((path) => /\/release\//.test(path));
  const allEntries = await hashEntries(projectRoot, files);
  const standardDocEntries = await hashEntries(projectRoot, standardDocs);
  const releaseEntries = await hashEntries(projectRoot, releases);
  return {
    readiness_json: await hashEntries(projectRoot, readinessJson),
    readiness_markdown: await hashEntries(projectRoot, readinessMarkdown),
    inspection_evidence_count: normalized.filter((path) => /\/inspection\/inspection_evidence\.json$/.test(path)).length,
    evidence_authorization_count: normalized.filter((path) => /\/inspection\/inspection_evidence_authorization\.json$/.test(path)).length,
    attachment_receipt_count: normalized.filter((path) => /\/inspection\/inspection_evidence_attachment\.json$/.test(path)).length,
    standard_document_tree_sha256: treeHash(standardDocEntries),
    release_tree_sha256: treeHash(releaseEntries),
    docs_examples_tree_sha256: treeHash(allEntries),
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildNativeResultCsv(plan, releaseRecord, releaseRecordSha256) {
  const rows = plan.items.map((item) => {
    const measuredValue = Number.isFinite(item.lower_limit) && Number.isFinite(item.upper_limit)
      ? (item.lower_limit + item.upper_limit) / 2
      : Number.isFinite(item.nominal_value) ? item.nominal_value : 0;
    return {
      plan_id: plan.plan_id,
      plan_sha256: releaseRecord.plan.sha256,
      plan_release_record_id: releaseRecord.release_record_id,
      plan_release_record_sha256: releaseRecordSha256,
      plan_item_id: item.plan_item_id,
      package_slug: plan.package.slug,
      revision: plan.package.revision,
      characteristic_id: item.characteristic_id,
      control_material_notice: 'generated blank template - not inspection evidence',
      measured_value: String(measuredValue),
      measured_unit: item.unit,
      result: 'pass',
      completion_status: 'completed',
      final_status: 'final',
      inspector_reference: 'user:acceptance-inspector',
      reviewer_reference: 'user:acceptance-reviewer',
      source_file_sha256: 'a'.repeat(64),
      method_used: item.required_method,
      equipment_reference: item.required_equipment_class || '',
      measurement_completed_at: GENERATED_AT,
      remarks: 'NON-PRODUCTION ACCEPTANCE DATA - SOFTWARE WIRING ONLY',
    };
  });
  return `${INSPECTION_RESULT_TEMPLATE_COLUMNS.join(',')}\n${rows.map((row) => INSPECTION_RESULT_TEMPLATE_COLUMNS.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeSyntheticDeclaration(projectRoot, outputRoot, inputs) {
  const entries = await Promise.all(inputs.map(async ({ path, role }) => ({
    path: repoPath(projectRoot, path),
    sha256: await sha256File(path),
    role,
    synthetic: true,
    non_production: true,
  })));
  const declaration = {
    artifact_type: 'local_first_v1_acceptance_fixture_declaration',
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    test_only: true,
    synthetic: true,
    non_production: true,
    production_evidence: false,
    statement: 'Every bound input is synthetic, non-production, and suitable only for deterministic software-wiring acceptance.',
    inputs: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
  const path = resolve(outputRoot, 'SYNTHETIC_NON_PRODUCTION_FIXTURE_DECLARATION.json');
  await writeFile(path, canonicalJson(declaration));
  return path;
}

export async function runLocalFirstV1Acceptance({
  projectRoot = ROOT,
  outputDir = 'output/v1-acceptance',
} = {}) {
  const root = resolve(projectRoot);
  const outputRoot = resolve(root, outputDir);
  const reportPath = resolve(outputRoot, 'local_first_v1_acceptance_report.json');
  const before = await canonicalSnapshot(root);
  assert(before.readiness_json.length === 5, 'expected five canonical readiness JSON files');
  assert(before.readiness_markdown.length === 5, 'expected five canonical readiness Markdown files');

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const flowARoot = resolve(outputRoot, 'flow-a-review');
  await mkdir(flowARoot, { recursive: true });
  const reviewPackPath = resolve(root, REVIEW_FIXTURE);
  const reviewPack = await readJson(reviewPackPath);
  const readiness = buildReadinessReportFromReviewPack({
    reviewPack,
    reviewPackPath: REVIEW_FIXTURE,
    generatedAt: GENERATED_AT,
  });
  const readinessPath = resolve(flowARoot, 'readiness_report.json');
  const readinessArtifacts = await writeCanonicalReadinessArtifacts(readinessPath, readiness, { projectRoot: root });
  assert(readiness.artifact_type === 'readiness_report', 'flow A readiness artifact type');
  assert(readiness.readiness_summary.status === 'needs_more_evidence', 'flow A must preserve the evidence hold');

  const flowBRoot = resolve(outputRoot, 'flow-b-revision-plan');
  await mkdir(flowBRoot, { recursive: true });
  const baselinePath = resolve(root, BASELINE_FIXTURE);
  const candidatePath = resolve(root, CANDIDATE_FIXTURE);
  const comparisonPath = resolve(flowBRoot, 'revision_comparison.json');
  const impactPath = resolve(flowBRoot, 'revision_impact_report.json');
  runCli(root, [
    'compare-rev', repoPath(root, baselinePath), repoPath(root, candidatePath),
    '--out', repoPath(root, comparisonPath), '--impact-out', repoPath(root, impactPath),
    '--generated-at', GENERATED_AT,
  ]);
  const deltaPlanPath = resolve(flowBRoot, 'inspection_plan.json');
  const deltaChecksheetPath = resolve(flowBRoot, 'inspection_checksheet.csv');
  const deltaRequestPath = resolve(flowBRoot, 'supplier_inspection_request.md');
  const deltaTemplatePath = resolve(flowBRoot, 'inspection_result_template.csv');
  runCli(root, [
    'inspection-plan', '--review-pack', repoPath(root, candidatePath), '--revision-impact', repoPath(root, impactPath),
    '--scope', 'delta', '--out', repoPath(root, deltaPlanPath), '--checksheet-out', repoPath(root, deltaChecksheetPath),
    '--request-out', repoPath(root, deltaRequestPath), '--result-template-out', repoPath(root, deltaTemplatePath),
    '--generated-at', GENERATED_AT,
  ]);
  const impact = await readJson(impactPath);
  const deltaPlan = await readJson(deltaPlanPath);
  const impactChangeIds = [...new Set(impact.reinspection_plan.items.flatMap((item) => item.related_change_ids || []))].sort();
  const planChangeIds = [...new Set(deltaPlan.items.flatMap((item) => item.revision_impact_change_ids || []))].sort();
  assert(JSON.stringify(impactChangeIds) === JSON.stringify(planChangeIds), 'flow B change IDs must be preserved');
  assert(deltaPlan.boundaries.inspection_evidence === false, 'flow B plan must not be evidence');
  assert(deltaPlan.boundaries.human_release_required === true, 'flow B plan must require human release');
  const deltaTemplate = await readFile(deltaTemplatePath, 'utf8');
  assert(!/\b(?:PASS|FAIL)\b/.test(deltaTemplate), 'flow B measured result fields must remain blank');

  const flowCRoot = resolve(outputRoot, 'flow-c-synthetic-non-production-result-handoff');
  await mkdir(flowCRoot, { recursive: true });
  const sanitizedReviewPath = resolve(flowCRoot, 'acceptance_review_pack.json');
  const sanitizedReview = (await readFile(candidatePath, 'utf8'))
    .replaceAll('fixture', 'acceptance')
    .replaceAll('FIXTURE', 'ACCEPTANCE')
    .replaceAll('Synthetic', 'Validation')
    .replaceAll('synthetic', 'validation');
  await writeFile(sanitizedReviewPath, sanitizedReview);
  const planPath = resolve(flowCRoot, 'inspection_plan.json');
  const checksheetPath = resolve(flowCRoot, 'inspection_checksheet.csv');
  const requestPath = resolve(flowCRoot, 'supplier_inspection_request.md');
  const templatePath = resolve(flowCRoot, 'inspection_result_template.csv');
  runCli(root, [
    'inspection-plan', '--review-pack', repoPath(root, sanitizedReviewPath), '--scope', 'full',
    '--out', repoPath(root, planPath), '--checksheet-out', repoPath(root, checksheetPath),
    '--request-out', repoPath(root, requestPath), '--result-template-out', repoPath(root, templatePath),
    '--generated-at', GENERATED_AT,
  ]);
  const plan = await readJson(planPath);
  assert(plan.status === 'ready_for_human_release', 'flow C fixture plan must reach the human-release boundary');
  const planSha = await sha256File(planPath);
  const authorizationPath = resolve(flowCRoot, 'inspection_plan_release_authorization.json');
  const authorization = {
    artifact_type: 'inspection_plan_release_authorization', schema_version: '1.0',
    authorization_id: 'release-auth:acceptance-001', decision: 'release_for_inspection_execution',
    package: { slug: plan.package.slug, revision: plan.package.revision },
    plan: { plan_id: plan.plan_id, sha256: planSha },
    distributed_files: {
      checksheet: { path: repoPath(root, checksheetPath), sha256: await sha256File(checksheetPath) },
      supplier_request: { path: repoPath(root, requestPath), sha256: await sha256File(requestPath) },
      result_template: { path: repoPath(root, templatePath), sha256: await sha256File(templatePath) },
    },
    inspection_scope: plan.scope,
    engineering_review: { identity_ref: 'user:acceptance-engineering', role_ref: 'role:engineering', reviewed_at: GENERATED_AT },
    quality_review: { identity_ref: 'user:acceptance-quality', role_ref: 'role:quality', reviewed_at: GENERATED_AT },
    released_by: { identity_ref: 'user:acceptance-release-controller', role_ref: 'role:quality-release' },
    released_at: GENERATED_AT,
    external_controlled_document_ref: null,
    confidentiality_classification: 'internal',
    notes: null,
    boundaries: {
      inspection_evidence: false, product_release: false, readiness_approval: false,
      evidence_attached: false, readiness_regeneration_authorized: false,
      scope: 'exact_bound_files_for_inspection_execution_only',
    },
  };
  await writeFile(authorizationPath, canonicalizeInspectionControlDocument(authorization));
  const releaseRecordPath = resolve(flowCRoot, 'inspection_plan_release_record.json');
  runCli(root, [
    'inspection-plan-release-record', '--inspection-plan', repoPath(root, planPath),
    '--authorization', repoPath(root, authorizationPath), '--out', repoPath(root, releaseRecordPath),
  ]);
  const releaseRecord = await readJson(releaseRecordPath);
  const releaseRecordSha = await sha256File(releaseRecordPath);
  assert(releaseRecord.plan.sha256 === planSha, 'flow C release record must bind the exact plan hash');
  const sourcePath = resolve(flowCRoot, 'completed_result.csv');
  await writeFile(sourcePath, buildNativeResultCsv(plan, releaseRecord, releaseRecordSha));
  const metadataPath = resolve(flowCRoot, 'submission_metadata.json');
  const metadata = {
    artifact_type: 'inspection_result_submission_metadata', schema_version: '1.0',
    package: { slug: plan.package.slug, revision: plan.package.revision },
    part_identifier: plan.package.part_identifier,
    plan_id: plan.plan_id, plan_sha256: planSha,
    plan_release_record_id: releaseRecord.release_record_id,
    plan_release_record_sha256: releaseRecordSha,
    source_organization: 'Acceptance Metrology Organization', source_type: 'lab',
    source_record_id: 'record:acceptance-001', original_sanitized_filename: basename(sourcePath),
    inspection_method: plan.items[0].required_method,
    completion_status: 'completed', completed_at: GENERATED_AT,
    inspector_identity_ref: 'user:acceptance-inspector', origin_reference: 'record:acceptance-001',
    confidentiality_classification: 'internal', redaction_status: 'not_applicable', redacted_fields: [],
    source_overall_result: null, notes: null,
  };
  await writeFile(metadataPath, canonicalizeInspectionControlDocument(metadata));
  const fixtureDeclarationPath = await writeSyntheticDeclaration(root, outputRoot, [
    { path: reviewPackPath, role: 'flow_a_review_pack' },
    { path: baselinePath, role: 'flow_b_baseline_review_pack' },
    { path: candidatePath, role: 'flow_b_candidate_review_pack' },
    { path: sanitizedReviewPath, role: 'flow_c_review_pack' },
    { path: planPath, role: 'flow_c_inspection_plan' },
    { path: authorizationPath, role: 'flow_c_human_release_authorization' },
    { path: releaseRecordPath, role: 'flow_c_release_record' },
    { path: sourcePath, role: 'flow_c_completed_native_csv' },
    { path: metadataPath, role: 'flow_c_submission_metadata' },
  ]);
  const normalizationPath = resolve(flowCRoot, 'inspection_result_normalization.json');
  runCli(root, [
    'inspection-result-normalize', '--inspection-plan', repoPath(root, planPath),
    '--plan-release-record', repoPath(root, releaseRecordPath), '--source', repoPath(root, sourcePath),
    '--submission-metadata', repoPath(root, metadataPath), '--adapter', 'plan-result-csv-v1',
    '--out', repoPath(root, normalizationPath), '--generated-at', GENERATED_AT,
  ]);
  const normalization = await readJson(normalizationPath);
  assert(normalization.status === 'ready_for_quarantine_review', 'flow C must stop at ready_for_quarantine_review');
  assert(normalization.plan_binding.plan_sha256 === planSha, 'flow C plan hash must match');
  assert(normalization.plan_binding.release_record_sha256 === releaseRecordSha, 'flow C release hash must match');
  assert(normalization.measurements.every((item) => Object.hasOwn(item, 'reported_result') && Object.hasOwn(item, 'computed_result')), 'flow C reported and computed results must remain separate');
  assert(normalization.boundaries.inspection_evidence === false, 'flow C must not create evidence');
  assert(normalization.boundaries.authorization_created === false, 'flow C must not create evidence authorization');
  assert(normalization.boundaries.evidence_attached === false, 'flow C must not attach evidence');
  assert(normalization.boundaries.readiness_regenerated === false, 'flow C must not regenerate readiness');

  const after = await canonicalSnapshot(root);
  assert(JSON.stringify(after) === JSON.stringify(before), 'canonical package hashes and counts changed');
  const docsDiff = spawnSync('git', ['diff', '--name-only', '--', 'docs/examples'], { cwd: root, encoding: 'utf8' });
  assert(docsDiff.status === 0 && docsDiff.stdout.trim() === '', 'docs/examples has a working-tree diff');

  const outputFiles = (await listFiles(outputRoot)).filter((path) => path !== reportPath);
  const evidenceLikeOutputs = outputFiles
    .map((path) => repoPath(root, path))
    .filter((path) => /inspection_evidence|attachment_receipt|readiness_authorization/.test(path));
  assert(evidenceLikeOutputs.length === 0, 'acceptance emitted evidence, attachment, or readiness-authorization output');
  const artifacts = await hashEntries(root, outputFiles);
  const gitShaRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert(gitShaRun.status === 0, 'git SHA unavailable');
  const report = {
    artifact_type: 'local_first_v1_acceptance_report',
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    git_sha: gitShaRun.stdout.trim(),
    status: 'pass',
    software_path_only: true,
    runtime: { artifact_driven_acceptance: 'pass', live_freecad_smoke: 'not_run_optional' },
    fixture_declaration: {
      path: repoPath(root, fixtureDeclarationPath),
      sha256: await sha256File(fixtureDeclarationPath),
      synthetic: true,
      non_production: true,
      production_evidence: false,
    },
    workflows: {
      review: {
        status: 'pass', runtime_backed: false,
        review_pack_sha256: await sha256File(reviewPackPath),
        readiness_status: readiness.readiness_summary.status,
        gate_decision: readiness.readiness_summary.gate_decision,
        readiness_json: repoPath(root, readinessArtifacts.json),
        readiness_markdown: repoPath(root, readinessArtifacts.markdown),
      },
      revision_and_inspection_planning: {
        status: 'pass', runtime_backed: false,
        revision_decision: impact.summary.decision,
        change_ids: impactChangeIds,
        plan_change_ids: planChangeIds,
        plan_status: deltaPlan.status,
        plan_is_evidence: false,
        human_release_required: true,
        measured_fields_blank: true,
        readiness_operation_ran: false,
      },
      result_handoff: {
        status: 'pass', runtime_backed: false,
        plan_sha256: planSha,
        release_record_sha256: releaseRecordSha,
        exact_hashes_match: true,
        reported_and_computed_results_separate: true,
        normalization_status: normalization.status,
        evidence_envelope_emitted: false,
        evidence_authorization_created: false,
        evidence_attachment_created: false,
        readiness_operation_ran: false,
        deterministic_fixed_time: GENERATED_AT,
      },
    },
    canonical_immutability: { before, after, equal: true, docs_examples_diff: [] },
    boundaries: {
      inspection_evidence_created: false,
      evidence_authorized: false,
      evidence_attached: false,
      readiness_regenerated: false,
      canonical_standard_documents_regenerated: false,
      canonical_release_bundles_regenerated: false,
      release_published: false,
      tag_created: false,
    },
    artifacts,
  };
  await writeFile(reportPath, canonicalJson(report));
  return { report, reportPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLocalFirstV1Acceptance();
  console.log(`Local-first v1 acceptance: ${result.report.status}`);
  console.log(`Report: ${result.reportPath}`);
  console.log('Synthetic non-production fixtures only: yes');
  console.log('Inspection evidence created: no');
}
