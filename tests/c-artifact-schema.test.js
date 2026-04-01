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
  assertArtifact('readiness_report', readinessFixture);
  assert.equal(readinessFixture.canonical_artifact.json_is_source_of_truth, true);
  assert.equal(readinessFixture.contract.command, 'readiness-report');

  const readinessContract = getCCommandContract('readiness-report');
  assert.equal(readinessContract.canonical_artifact_kind, 'readiness_report');
  assert.equal(readinessContract.primary_output, 'readiness_report.json');
  assert.equal(readinessContract.derived_outputs.includes('release_bundle_manifest'), true);

  const packContract = getCCommandContract('pack');
  assert.equal(packContract.canonical_artifact_kind, 'release_bundle_manifest');

  const readinessOut = join(TMP_DIR, 'pcb_mount_plate_readiness_report.json');
  const readinessRun = runCli([
    'readiness-report',
    'configs/examples/pcb_mount_plate.toml',
    '--batch',
    '150',
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
  assert.equal(readinessReport.process_plan.contract.command, 'process-plan');
  assert.equal(readinessReport.quality_risk.contract.command, 'quality-risk');
  assert.equal(
    readinessReport.source_artifact_refs.some((ref) => ref.artifact_type === 'config'),
    true,
    'readiness report should record the input config as a source artifact'
  );

  const docsOutDir = join(TMP_DIR, 'standard-docs');
  const docsRun = runCli([
    'generate-standard-docs',
    'configs/examples/controller_housing_eol.toml',
    '--out-dir',
    docsOutDir,
  ]);
  assert.equal(docsRun.status, 0, docsRun.stderr || docsRun.stdout);

  const docsManifestPath = join(docsOutDir, 'standard_docs_manifest.json');
  assert.equal(existsSync(docsManifestPath), true, `Expected docs manifest at ${docsManifestPath}`);
  const docsManifest = readJson(docsManifestPath);
  assertArtifact('docs_manifest', docsManifest);
  assert.equal(docsManifest.canonical_artifact.json_is_source_of_truth, true);
  assert.equal(docsManifest.contract.command, 'generate-standard-docs');

  console.log('c-artifact-schema.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
