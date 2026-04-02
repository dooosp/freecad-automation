import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateCArtifact } from '../lib/c-artifact-schema.js';
import { listZipEntries } from '../lib/zip-archive.js';
import { assertTextSnapshot } from './helpers/text-snapshot.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-release-bundle-'));
const SNAPSHOT_DIR = join(ROOT, 'tests', 'fixtures', 'snapshots', 'release');
const REVIEW_PACK_FIXTURE = join(ROOT, 'tests', 'fixtures', 'd-artifacts', 'sample_review_pack.canonical.json');
const CONFIG_EXAMPLE = join(ROOT, 'configs', 'examples', 'controller_housing_eol.toml');

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
  const e2eDir = join(TMP_DIR, 'review-pack-flow');
  const readinessOut = join(e2eDir, 'sample_readiness_report.json');
  const readinessRun = runCli([
    'readiness-pack',
    '--review-pack',
    REVIEW_PACK_FIXTURE,
    '--out',
    readinessOut,
  ]);
  assert.equal(readinessRun.status, 0, readinessRun.stderr || readinessRun.stdout);
  assert.equal(existsSync(readinessOut), true, `Expected readiness output at ${readinessOut}`);
  assert.equal(existsSync(readinessOut.replace(/\.json$/i, '.md')), true, 'Expected readiness markdown output');

  const bundleZip = join(e2eDir, 'release_bundle.zip');
  const packRun = runCli([
    'pack',
    '--readiness',
    readinessOut,
    '--out',
    bundleZip,
  ]);
  assert.equal(packRun.status, 0, packRun.stderr || packRun.stdout);
  assert.equal(existsSync(bundleZip), true, `Expected release bundle at ${bundleZip}`);

  const manifestPath = join(e2eDir, 'release_bundle_manifest.json');
  const logPath = join(e2eDir, 'release_bundle_log.json');
  const checksumsPath = join(e2eDir, 'release_bundle_checksums.sha256');
  assert.equal(existsSync(manifestPath), true, `Expected release bundle manifest at ${manifestPath}`);
  assert.equal(existsSync(logPath), true, `Expected release bundle log at ${logPath}`);
  assert.equal(existsSync(checksumsPath), true, `Expected release bundle checksums at ${checksumsPath}`);

  const manifest = readJson(manifestPath);
  assertArtifact('release_bundle_manifest', manifest);
  assert.equal(manifest.contract.command, 'pack');
  assert.equal(manifest.readiness_report_ref.path, readinessOut);
  assert.equal(
    manifest.source_artifact_refs.some((ref) => ref.artifact_type === 'review_pack'),
    true,
    'release bundle manifest should preserve review_pack provenance'
  );
  assert.equal(
    manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'review_pack'),
    true,
    'bundle should include the canonical review_pack when it is available from readiness provenance'
  );
  assert.equal(
    manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_checksums'),
    true,
    'bundle manifest should inventory the checksums file'
  );
  assert.equal(
    manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_log'),
    true,
    'bundle manifest should inventory the bundle log'
  );

  const zipEntries = await listZipEntries(bundleZip);
  const zipListing = zipEntries.map((entry) => entry.name).sort().join('\n');
  assertTextSnapshot('release_bundle_listing', zipListing, { snapshotDir: SNAPSHOT_DIR });
  assert.equal(zipEntries.some((entry) => entry.name === 'canonical/readiness_report.json'), true);
  assert.equal(zipEntries.some((entry) => entry.name === 'canonical/review_pack.json'), true);
  assert.equal(zipEntries.some((entry) => entry.name === 'release_bundle_manifest.json'), true);

  const docsDir = join(TMP_DIR, 'docs-flow');
  const docsReadinessOut = join(docsDir, 'controller_readiness_report.json');
  const docsReadinessRun = runCli([
    'readiness-report',
    CONFIG_EXAMPLE,
    '--out',
    docsReadinessOut,
  ]);
  assert.equal(docsReadinessRun.status, 0, docsReadinessRun.stderr || docsReadinessRun.stdout);

  const standardDocsDir = join(docsDir, 'standard-docs');
  const docsRun = runCli([
    'generate-standard-docs',
    CONFIG_EXAMPLE,
    '--readiness-report',
    docsReadinessOut,
    '--out-dir',
    standardDocsDir,
  ]);
  assert.equal(docsRun.status, 0, docsRun.stderr || docsRun.stdout);

  const docsBundleZip = join(docsDir, 'release_bundle_with_docs.zip');
  const docsPackRun = runCli([
    'pack',
    '--readiness',
    docsReadinessOut,
    '--docs-manifest',
    join(standardDocsDir, 'standard_docs_manifest.json'),
    '--out',
    docsBundleZip,
  ]);
  assert.equal(docsPackRun.status, 0, docsPackRun.stderr || docsPackRun.stdout);

  const docsManifest = readJson(join(docsDir, 'release_bundle_manifest.json'));
  assert.equal(Boolean(docsManifest.docs_manifest_ref?.path), true, 'docs-aware bundle should record docs manifest provenance');

  const docsZipEntries = await listZipEntries(docsBundleZip);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/standard_docs_manifest.json'), true);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/process_flow.md'), true);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/work_instruction_draft.md'), true);

  console.log('release-bundle.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
