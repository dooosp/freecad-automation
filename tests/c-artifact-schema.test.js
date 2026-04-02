import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { getCCommandContract, validateCArtifact } from '../lib/c-artifact-schema.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-c-artifact-'));
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'c-artifacts');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function assertArtifact(kind, document) {
  const validation = validateCArtifact(kind, document);
  assert.equal(validation.ok, true, `${kind} schema errors:\n${validation.errors.join('\n')}`);
}

try {
  const readinessFixture = readJson(join(FIXTURE_DIR, 'sample_readiness_report.canonical.json'));
  const reviewPackFixture = join(ROOT, 'tests', 'fixtures', 'd-artifacts', 'sample_review_pack.canonical.json');
  assertArtifact('readiness_report', readinessFixture);
  assert.equal(readinessFixture.canonical_artifact.json_is_source_of_truth, true);
  assert.equal(readinessFixture.contract.command, 'readiness-report');
  assert.equal(readinessFixture.review_pack.artifact_type, 'review_pack');

  const readinessContract = getCCommandContract('readiness-report');
  assert.equal(readinessContract.canonical_artifact_kind, 'readiness_report');
  assert.equal(readinessContract.primary_output, 'readiness_report.json');
  assert.equal(readinessContract.derived_outputs.includes('release_bundle_manifest'), true);
  assert.equal(
    readinessContract.notes.some((note) => note.includes('legacy compatibility path')),
    true,
    'readiness-report contract notes should distinguish the legacy config route'
  );

  const packContract = getCCommandContract('pack');
  assert.equal(packContract.canonical_artifact_kind, 'release_bundle_manifest');

  const docsContract = getCCommandContract('generate-standard-docs');
  assert.deepEqual(docsContract.required_inputs, ['config', 'readiness_report']);

  const readinessOut = join(TMP_DIR, 'pcb_mount_plate_readiness_report.json');
  const readinessRun = runCli([
    'readiness-report',
    '--review-pack',
    reviewPackFixture,
    '--out',
    readinessOut,
  ]);
  assert.equal(readinessRun.status, 0, readinessRun.stderr || readinessRun.stdout);
  assert.equal(existsSync(readinessOut), true, `Expected readiness output at ${readinessOut}`);
  assert.equal(existsSync(readinessOut.replace(/\.json$/i, '.md')), true, 'Expected readiness markdown output');

  const readinessReport = readJson(readinessOut);
  assertArtifact('readiness_report', readinessReport);
  assert.equal(readinessReport.canonical_artifact.json_is_source_of_truth, true);
  assert.equal(readinessReport.contract.command, 'readiness-report');
  assert.equal(readinessReport.review_pack.artifact_type, 'review_pack');
  assert.equal(readinessReport.process_plan.contract.command, 'process-plan');
  assert.equal(readinessReport.quality_risk.contract.command, 'quality-risk');
  assert.equal(
    readinessReport.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack'),
    true,
    'readiness report should record the input review-pack as a source artifact'
  );

  const docsOutDir = join(TMP_DIR, 'standard-docs');
  const docsRun = runCli([
    'generate-standard-docs',
    'configs/examples/controller_housing_eol.toml',
    '--out-dir',
    docsOutDir,
  ]);
  assert.notEqual(docsRun.status, 0, 'config-only docs generation should fail without canonical readiness input');
  assert.match(
    `${docsRun.stderr}\n${docsRun.stdout}`,
    /requires either --readiness-report <readiness_report\.json> or --review-pack <review_pack\.json>/i
  );

  const docsFromReviewPackDir = join(TMP_DIR, 'standard-docs-from-review-pack');
  const docsFromReviewPackRun = runCli([
    'generate-standard-docs',
    'configs/examples/controller_housing_eol.toml',
    '--review-pack',
    reviewPackFixture,
    '--out-dir',
    docsFromReviewPackDir,
  ]);
  assert.equal(docsFromReviewPackRun.status, 0, docsFromReviewPackRun.stderr || docsFromReviewPackRun.stdout);

  const docsManifestPath = join(docsFromReviewPackDir, 'standard_docs_manifest.json');
  assert.equal(existsSync(docsManifestPath), true, `Expected docs manifest at ${docsManifestPath}`);
  const generatedReadinessPath = join(docsFromReviewPackDir, 'readiness_report.json');
  assert.equal(existsSync(generatedReadinessPath), true, `Expected generated readiness report at ${generatedReadinessPath}`);
  const docsManifest = readJson(docsManifestPath);
  assertArtifact('docs_manifest', docsManifest);
  assert.equal(docsManifest.canonical_artifact.json_is_source_of_truth, true);
  assert.equal(docsManifest.contract.command, 'generate-standard-docs');
  assert.equal(
    docsManifest.source_artifact_refs.some((ref) => ref.artifact_type === 'readiness_report' && ref.path === generatedReadinessPath),
    true,
    'docs manifest should record the canonical readiness report JSON source'
  );
  assert.equal(
    docsManifest.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack' && ref.path === reviewPackFixture),
    true,
    'docs manifest should preserve review-pack provenance when canonical readiness is built from review_pack'
  );

  const docsFromReadinessDir = join(TMP_DIR, 'standard-docs-from-readiness');
  const docsFromReadinessRun = runCli([
    'generate-standard-docs',
    'configs/examples/controller_housing_eol.toml',
    '--readiness-report',
    readinessOut,
    '--out-dir',
    docsFromReadinessDir,
  ]);
  assert.equal(docsFromReadinessRun.status, 0, docsFromReadinessRun.stderr || docsFromReadinessRun.stdout);
  const docsFromReadinessManifest = readJson(join(docsFromReadinessDir, 'standard_docs_manifest.json'));
  assert.equal(
    docsFromReadinessManifest.source_artifact_refs.some((ref) => ref.artifact_type === 'readiness_report' && ref.path === readinessOut),
    true,
    'docs manifest should preserve the supplied canonical readiness report path'
  );

  const helpRun = runCli(['help']);
  assert.equal(helpRun.status, 0, helpRun.stderr || helpRun.stdout);
  assert.match(helpRun.stdout, /readiness-report <config\.toml\|json> .*legacy compatibility/i);
  assert.match(helpRun.stdout, /generate-standard-docs <config\.toml\|json> \(\-\-readiness-report <readiness_report\.json> \| \-\-review-pack <review_pack\.json>\)/i);

  console.log('c-artifact-schema.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
