import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateCArtifact } from '../lib/c-artifact-schema.js';
import { createZipArchive, listZipEntries } from '../lib/zip-archive.js';
import { runReleaseBundleWorkflow } from '../src/workflows/release-bundle-workflow.js';
import { assertTextSnapshot } from './helpers/text-snapshot.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
mkdirSync(join(ROOT, 'output'), { recursive: true });
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-release-bundle-'));
const REPO_TMP_DIR = mkdtempSync(join(ROOT, 'output', 'fcad-release-bundle-'));
const SNAPSHOT_DIR = join(ROOT, 'tests', 'fixtures', 'snapshots', 'release');
const REVIEW_PACK_FIXTURE = join(ROOT, 'tests', 'fixtures', 'd-artifacts', 'sample_review_pack.canonical.json');
const CONFIG_EXAMPLE = join(ROOT, 'configs', 'examples', 'controller_housing_eol.toml');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function writeAlignedConfig(filePath, {
  templatePath = CONFIG_EXAMPLE,
  name,
  revision,
} = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const template = readFileSync(templatePath, 'utf8');
  const next = template
    .replace(/^name = ".*"$/m, `name = "${name}"`)
    .replace(/^revision = ".*"$/m, `revision = "${revision}"`);
  writeFileSync(filePath, next, 'utf8');
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
  assert.equal(manifest.readiness_report_ref.path, 'sample_readiness_report.json');
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

  const docsDir = join(REPO_TMP_DIR, 'docs-flow');
  const alignedConfigPath = join(docsDir, 'sample_part_docs.toml');
  writeAlignedConfig(alignedConfigPath, {
    name: 'sample_part',
    revision: 'A',
  });
  const docsReadinessOut = join(docsDir, 'controller_readiness_report.json');
  const docsReadinessRun = runCli([
    'readiness-pack',
    '--review-pack',
    REVIEW_PACK_FIXTURE,
    '--out',
    docsReadinessOut,
  ]);
  assert.equal(docsReadinessRun.status, 0, docsReadinessRun.stderr || docsReadinessRun.stdout);

  const standardDocsDir = join(docsDir, 'standard-docs');
  const docsRun = runCli([
    'generate-standard-docs',
    alignedConfigPath,
    '--readiness-report',
    docsReadinessOut,
    '--out-dir',
    standardDocsDir,
  ]);
  assert.equal(docsRun.status, 0, docsRun.stderr || docsRun.stdout);

  const docsBundleZip = join(docsDir, 'release_bundle_with_docs.zip');
  const docsReadinessFromManifest = docsReadinessOut;
  const docsPackRun = runCli([
    'pack',
    '--readiness',
    docsReadinessFromManifest,
    '--docs-manifest',
    join(standardDocsDir, 'standard_docs_manifest.json'),
    '--out',
    docsBundleZip,
  ]);
  assert.equal(docsPackRun.status, 0, docsPackRun.stderr || docsPackRun.stdout);

  const mismatchedReadinessPath = join(docsDir, 'mismatched_readiness_report.json');
  const mismatchedReadiness = {
    ...readJson(docsReadinessOut),
    revision: 'B',
    part: {
      ...readJson(docsReadinessOut).part,
      revision: 'B',
    },
  };
  writeFileSync(mismatchedReadinessPath, JSON.stringify(mismatchedReadiness, null, 2), 'utf8');

  const mismatchedPackRun = runCli([
    'pack',
    '--readiness',
    mismatchedReadinessPath,
    '--docs-manifest',
    join(standardDocsDir, 'standard_docs_manifest.json'),
    '--out',
    join(docsDir, 'release_bundle_mismatched.zip'),
  ]);
  assert.notEqual(mismatchedPackRun.status, 0);
  assert.match(
    `${mismatchedPackRun.stdout}\n${mismatchedPackRun.stderr}`,
    /invalid docs manifest handoff/i
  );

  const docsManifest = readJson(join(docsDir, 'release_bundle_manifest.json'));
  assert.equal(Boolean(docsManifest.docs_manifest_ref?.path), true, 'docs-aware bundle should record docs manifest provenance');
  assert.equal(
    docsManifest.coverage.source_artifact_count,
    docsManifest.source_artifact_refs.length,
    'docs-aware bundle coverage should match the actual source_artifact_refs length'
  );

  const docsZipEntries = await listZipEntries(docsBundleZip);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/standard_docs_manifest.json'), true);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/process_flow.md'), true);
  assert.equal(docsZipEntries.some((entry) => entry.name === 'docs/work_instruction_draft.md'), true);

  const unsafeBundleDir = join(TMP_DIR, 'unsafe-bundle-flow');
  mkdirSync(unsafeBundleDir, { recursive: true });
  const outsideSourcePath = join(TMP_DIR, 'outside-host-file.txt');
  writeFileSync(outsideSourcePath, 'outside host content must not enter release bundles\n', 'utf8');
  const unsafeReadinessPath = join(unsafeBundleDir, 'unsafe_readiness_report.json');
  const unsafeReadinessReport = {
    ...readJson(docsReadinessOut),
    source_artifact_refs: [
      {
        artifact_type: 'source_file',
        path: outsideSourcePath,
        role: 'input',
        label: 'Outside host file',
      },
    ],
  };
  writeFileSync(unsafeReadinessPath, JSON.stringify(unsafeReadinessReport, null, 2), 'utf8');
  const unsafeBundleZip = join(unsafeBundleDir, 'release_bundle.zip');
  const unsafeResult = await runReleaseBundleWorkflow({
    projectRoot: ROOT,
    readinessPath: unsafeReadinessPath,
    readinessReport: unsafeReadinessReport,
    outputPath: unsafeBundleZip,
  });
  const unsafeManifestText = readFileSync(unsafeResult.manifest_path, 'utf8');
  const unsafeLogText = readFileSync(unsafeResult.log_path, 'utf8');
  const unsafeZipEntries = await listZipEntries(unsafeBundleZip);
  assert.equal(unsafeZipEntries.some((entry) => entry.name === 'references/outside-host-file.txt'), false);
  assert.equal(unsafeManifestText.includes(outsideSourcePath), false);
  assert.equal(unsafeLogText.includes(outsideSourcePath), false);
  assert.match(unsafeManifestText, /not allowed in release bundles/i);
  assert.match(unsafeLogText, /outside_allowed_roots/i);

  const unsafeRepoReadinessPath = join(unsafeBundleDir, 'unsafe_repo_readiness_report.json');
  const unsafeRepoReadinessReport = {
    ...readJson(docsReadinessOut),
    source_artifact_refs: [
      {
        artifact_type: 'source_file',
        path: 'package.json',
        role: 'input',
        label: 'Arbitrary repo file',
      },
      {
        artifact_type: 'source_file',
        path: 'local/stage5b-candidate-evidence-inbox/quality-pass-bracket/received-inspection-evidence.json',
        role: 'input',
        label: 'Ignored inbox candidate',
      },
    ],
  };
  writeFileSync(unsafeRepoReadinessPath, JSON.stringify(unsafeRepoReadinessReport, null, 2), 'utf8');
  const unsafeRepoBundleZip = join(unsafeBundleDir, 'release_bundle_unsafe_repo.zip');
  const unsafeRepoResult = await runReleaseBundleWorkflow({
    projectRoot: ROOT,
    readinessPath: unsafeRepoReadinessPath,
    readinessReport: unsafeRepoReadinessReport,
    outputPath: unsafeRepoBundleZip,
    generatedAt: '2026-05-31T00:00:00.000Z',
  });
  const unsafeRepoManifestText = readFileSync(unsafeRepoResult.manifest_path, 'utf8');
  const unsafeRepoLogText = readFileSync(unsafeRepoResult.log_path, 'utf8');
  const unsafeRepoZipEntries = await listZipEntries(unsafeRepoBundleZip);
  assert.equal(unsafeRepoZipEntries.some((entry) => entry.name === 'references/package.json'), false);
  assert.equal(
    unsafeRepoResult.manifest.source_artifact_refs.some((ref) => ref.path === 'package.json'),
    false,
    'release bundles must not keep arbitrary repo files as packageable source refs'
  );
  assert.equal(
    unsafeRepoResult.manifest.bundle_artifacts.some((entry) => entry.source_path === 'package.json'),
    false,
    'release bundle artifacts must not include arbitrary repo file source paths'
  );
  assert.equal(unsafeRepoManifestText.includes('local/stage5b-candidate-evidence-inbox'), false);
  assert.equal(unsafeRepoLogText.includes('local/stage5b-candidate-evidence-inbox'), false);
  assert.match(unsafeRepoManifestText, /disallowed_repo_source_path/);
  assert.match(unsafeRepoLogText, /disallowed_repo_source_path/);

  const baseDocsManifest = readJson(join(standardDocsDir, 'standard_docs_manifest.json'));
  const traversalDocsManifest = {
    ...baseDocsManifest,
    documents: [
      {
        ...baseDocsManifest.documents[0],
        filename: '../escape.txt',
      },
    ],
  };
  await assert.rejects(
    () => runReleaseBundleWorkflow({
      projectRoot: ROOT,
      readinessPath: docsReadinessOut,
      readinessReport: readJson(docsReadinessOut),
      outputPath: join(docsDir, 'release_bundle_traversal.zip'),
      docsManifestPath: join(standardDocsDir, 'standard_docs_manifest.json'),
      docsManifest: traversalDocsManifest,
      generatedAt: '2026-05-31T00:00:00.000Z',
    }),
    /Unsafe docs manifest filename/
  );

  const arbitraryDocsManifest = {
    ...baseDocsManifest,
    documents: [
      {
        ...baseDocsManifest.documents[0],
        path: join(ROOT, 'package.json'),
        filename: 'package.json',
      },
    ],
  };
  const arbitraryDocBundleZip = join(docsDir, 'release_bundle_arbitrary_doc.zip');
  const arbitraryDocResult = await runReleaseBundleWorkflow({
    projectRoot: ROOT,
    readinessPath: docsReadinessOut,
    readinessReport: readJson(docsReadinessOut),
    outputPath: arbitraryDocBundleZip,
    docsManifestPath: join(standardDocsDir, 'standard_docs_manifest.json'),
    docsManifest: arbitraryDocsManifest,
    generatedAt: '2026-05-31T00:00:00.000Z',
  });
  const arbitraryDocZipEntries = await listZipEntries(arbitraryDocBundleZip);
  assert.equal(arbitraryDocZipEntries.some((entry) => entry.name === 'docs/package.json'), false);
  assert.equal(
    arbitraryDocResult.manifest.skipped_artifacts.some((entry) => (
      entry.artifact_type === 'docs_document'
      && entry.reason === 'outside_allowed_roots'
      && entry.source_path === 'package.json'
    )),
    true,
    'docs manifests must not include arbitrary repo files outside the standard-docs output directory'
  );

  const externalDocsDir = join(TMP_DIR, 'external-standard-docs');
  mkdirSync(externalDocsDir, { recursive: true });
  const externalDocsManifestPath = join(externalDocsDir, 'standard_docs_manifest.json');
  writeFileSync(externalDocsManifestPath, JSON.stringify(baseDocsManifest, null, 2), 'utf8');
  await assert.rejects(
    () => runReleaseBundleWorkflow({
      projectRoot: ROOT,
      readinessPath: docsReadinessOut,
      readinessReport: readJson(docsReadinessOut),
      outputPath: join(docsDir, 'release_bundle_external_manifest.zip'),
      docsManifestPath: externalDocsManifestPath,
      docsManifest: baseDocsManifest,
      generatedAt: '2026-05-31T00:00:00.000Z',
    }),
    /Docs manifest.*repository root/
  );

  const deterministicDir = join(REPO_TMP_DIR, 'deterministic-flow');
  const deterministicA = await runReleaseBundleWorkflow({
    projectRoot: ROOT,
    readinessPath: docsReadinessOut,
    readinessReport: readJson(docsReadinessOut),
    outputPath: join(deterministicDir, 'a', 'release_bundle.zip'),
    docsManifestPath: join(standardDocsDir, 'standard_docs_manifest.json'),
    docsManifest: baseDocsManifest,
    generatedAt: '2026-05-31T00:00:00.000Z',
  });
  const deterministicB = await runReleaseBundleWorkflow({
    projectRoot: ROOT,
    readinessPath: docsReadinessOut,
    readinessReport: readJson(docsReadinessOut),
    outputPath: join(deterministicDir, 'b', 'release_bundle.zip'),
    docsManifestPath: join(standardDocsDir, 'standard_docs_manifest.json'),
    docsManifest: baseDocsManifest,
    generatedAt: '2026-05-31T00:00:00.000Z',
  });
  assert.equal(hashFile(deterministicA.bundle_zip_path), hashFile(deterministicB.bundle_zip_path));
  assert.equal(hashFile(deterministicA.manifest_path), hashFile(deterministicB.manifest_path));
  assert.equal(hashFile(deterministicA.log_path), hashFile(deterministicB.log_path));
  assert.equal(hashFile(deterministicA.checksums_path), hashFile(deterministicB.checksums_path));
  const deterministicText = [
    readFileSync(deterministicA.manifest_path, 'utf8'),
    readFileSync(deterministicA.log_path, 'utf8'),
  ].join('\n');
  assert.equal(/\/(?:Users|private|tmp|var)\//.test(deterministicText), false, 'portable release metadata must not expose host absolute paths');
  assert.equal(/[A-Za-z]:[\\/]/.test(deterministicText), false, 'portable release metadata must not expose Windows absolute paths');

  const utf8ZipPath = join(TMP_DIR, 'utf8-filenames.zip');
  await createZipArchive(utf8ZipPath, [
    {
      name: '문서/요약.txt',
      data: 'utf8 filename regression\n',
    },
  ]);
  const utf8Entries = await listZipEntries(utf8ZipPath);
  assert.equal(utf8Entries.length, 1);
  assert.equal(utf8Entries[0].name, '문서/요약.txt');
  assert.equal(utf8Entries[0].utf8, true, 'ZIP entries with UTF-8 filenames should set the UTF-8 flag');

  console.log('release-bundle.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
  rmSync(REPO_TMP_DIR, { recursive: true, force: true });
}
