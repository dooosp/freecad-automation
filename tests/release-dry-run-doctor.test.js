import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { listZipEntries } from '../lib/zip-archive.js';

const ROOT = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const doctorScript = readFileSync(join(ROOT, 'scripts', 'release-dry-run-doctor.js'), 'utf8');
const outDirRel = `output/test-release-dry-run-doctor-${process.pid}`;
const outDir = join(ROOT, outDirRel);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

try {
  assert.equal(
    packageJson.scripts['release:dry-run:doctor'],
    'node scripts/release-dry-run-doctor.js'
  );
  assert.doesNotMatch(doctorScript, /\bnpm\s+publish\b/);
  assert.doesNotMatch(doctorScript, /\bgh\s+release\b/);
  assert.doesNotMatch(doctorScript, /\bgit\s+tag\b/);
  assert.doesNotMatch(doctorScript, /\bgit\s+push\s+--tags\b/);
  assert.doesNotMatch(doctorScript, /\bupload-artifact\b/);

  const result = spawnSync(process.execPath, [
    'scripts/release-dry-run-doctor.js',
    '--package',
    'quality-pass-bracket',
    '--out-dir',
    outDirRel,
    '--generated-at',
    '2026-06-06T00:00:00.000Z',
    '--clean',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /release-dry-run-doctor: ok/);
  assert.match(result.stdout, /no publish, no tag, no upload, no evidence attachment/);

  const reportPath = join(outDir, 'release_dry_run_doctor_report.json');
  const manifestPath = join(outDir, 'release_bundle_manifest.json');
  const artifactManifestPath = join(outDir, 'release_bundle_artifact-manifest.json');
  const checksumsPath = join(outDir, 'release_bundle_checksums.sha256');
  const bundlePath = join(outDir, 'release_bundle.zip');
  [
    reportPath,
    manifestPath,
    artifactManifestPath,
    join(outDir, 'release_bundle_log.json'),
    checksumsPath,
    bundlePath,
  ].forEach((filePath) => {
    assert.equal(existsSync(filePath), true, `Expected release dry-run output: ${filePath}`);
  });

  const report = readJson(reportPath);
  assert.equal(report.artifact_type, 'release_dry_run_doctor_report');
  assert.equal(report.package_slug, 'quality-pass-bracket');
  assert.equal(report.output_dir, outDirRel);
  assert.equal(report.dry_run_boundary.dry_run_only, true);
  assert.equal(report.dry_run_boundary.output_is_git_ignored, true);
  assert.equal(report.dry_run_boundary.canonical_readiness_regenerated, false);
  assert.equal(report.dry_run_boundary.canonical_package_artifacts_mutated, false);
  assert.equal(report.dry_run_boundary.inspection_evidence_attached, false);
  assert.equal(report.dry_run_boundary.stage5b_evidence_attached_or_promoted, false);
  assert.equal(report.dry_run_boundary.git_tag_created, false);
  assert.equal(report.dry_run_boundary.github_release_created, false);
  assert.equal(report.dry_run_boundary.artifacts_uploaded, false);
  assert.equal(report.dry_run_boundary.npm_published, false);
  assert.equal(
    report.outputs.release_bundle_artifact_manifest,
    `${outDirRel}/release_bundle_artifact-manifest.json`
  );
  assert.equal(report.checks.source_hygiene_after_dry_run, 'pass');
  assert.equal(report.checks.git_status_unchanged_outside_ignored_outputs, true);
  assert.deepEqual(
    report.commands.map((entry) => [entry.name, entry.argv[0]]),
    [
      ['pack', 'node'],
      ['source_hygiene', 'node'],
    ]
  );

  const manifest = readJson(manifestPath);
  assert.equal(manifest.artifact_type, 'release_bundle_manifest');
  assert.equal(manifest.contract.command, 'pack');
  assert.equal(
    manifest.readiness_report_ref.path,
    'docs/examples/quality-pass-bracket/readiness/readiness_report.json'
  );
  assert.equal(
    manifest.docs_manifest_ref.path,
    'docs/examples/quality-pass-bracket/standard-docs/standard_docs_manifest.json'
  );
  assert.equal(
    manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_checksums'),
    true
  );
  assert.equal(
    manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_log'),
    true
  );

  const checksumLines = readFileSync(checksumsPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(checksumLines.some((line) => line.endsWith('  release_bundle_log.json')), true);
  assert.equal(checksumLines.every((line) => /^[a-f0-9]{64}  [^\s].+$/.test(line)), true);

  const zipEntries = (await listZipEntries(bundlePath)).map((entry) => entry.name).sort();
  assert(zipEntries.includes('canonical/readiness_report.json'));
  assert(zipEntries.includes('docs/standard_docs_manifest.json'));
  assert(zipEntries.includes('release_bundle_manifest.json'));
  assert(zipEntries.includes('release_bundle_checksums.sha256'));
  assert(zipEntries.includes('release_bundle_log.json'));

  const serializedReport = JSON.stringify(report);
  assert.equal(serializedReport.includes('/Users/'), false);
  assert.equal(serializedReport.includes('local/stage5b-candidate-evidence-inbox'), false);
  assert.equal(serializedReport.includes('github_release_created":true'), false);

  console.log('release-dry-run-doctor.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
