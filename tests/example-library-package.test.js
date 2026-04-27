import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

import { listZipEntries, readZipEntry } from '../lib/zip-archive.js';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const CANONICAL_PACKAGES = Object.freeze([
  {
    slug: 'quality-pass-bracket',
    stem: 'quality_pass_bracket',
    sourceConfig: 'configs/examples/quality_pass_bracket.toml',
    directConfigCopy: true,
  },
  {
    slug: 'plate-with-holes',
    stem: 'pcb_mount_plate',
    sourceConfig: 'configs/examples/pcb_mount_plate.toml',
    directConfigCopy: false,
  },
  {
    slug: 'motor-mount',
    stem: 'cnc_motor_mount_bracket',
    sourceConfig: 'configs/generated/cnc_motor_mount_bracket.toml',
    directConfigCopy: false,
  },
  {
    slug: 'controller-housing-eol',
    stem: 'controller_housing_eol',
    sourceConfig: 'configs/examples/controller_housing_eol.toml',
    directConfigCopy: false,
  },
]);

const CANONICAL_ARTIFACTS = Object.freeze([
  'review/review_pack.json',
  'readiness/readiness_report.json',
  'standard-docs/standard_docs_manifest.json',
  'release/release_bundle_manifest.json',
  'release/release_bundle.zip',
]);

const STALE_AF5_NAMES = Object.freeze([
  'review-pack.json',
  'readiness-report.json',
  'standard-docs-manifest.json',
  'release-bundle-manifest.json',
  'release-bundle.zip',
]);

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.toml', '.csv', '.sha256', '.svg']);
const BANNED_TEXT_PATTERNS = Object.freeze([
  /\/Users\//,
  /\/Applications\//,
  /\/private\//,
  /\/var\/folders\//,
  /tmp\/codex/,
  /output\//,
]);

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, strings));
    return strings;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, strings));
  }
  return strings;
}

function assertPortableText(label, text) {
  for (const pattern of BANNED_TEXT_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label} should not contain ${pattern}`);
  }
  for (const staleName of STALE_AF5_NAMES) {
    assert.equal(text.includes(staleName), false, `${label} should not contain stale AF5 name ${staleName}`);
  }
}

function assertPortableJson(filePath) {
  const payload = JSON.parse(readFileSync(filePath, 'utf8'));
  for (const text of collectStrings(payload)) {
    assert.equal(isAbsolute(text), false, `${relative(ROOT, filePath)} should not contain absolute path string: ${text}`);
    assert.equal(/job[-_][a-z0-9]{4,}/i.test(text), false, `${relative(ROOT, filePath)} should not contain machine-specific job ids: ${text}`);
  }
  return payload;
}

const libraryManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

for (const packageDef of CANONICAL_PACKAGES) {
  const packageRoot = resolve(ROOT, 'docs', 'examples', packageDef.slug);
  assert.equal(existsSync(packageRoot), true, `${packageDef.slug} package should exist`);
  assert.equal(existsSync(join(packageRoot, 'README.md')), true, `${packageDef.slug} README.md should exist`);
  assert.equal(existsSync(join(packageRoot, 'config.toml')), true, `${packageDef.slug} config.toml should exist`);

  if (packageDef.directConfigCopy) {
    assert.equal(
      readFileSync(join(packageRoot, 'config.toml'), 'utf8'),
      readFileSync(resolve(ROOT, packageDef.sourceConfig), 'utf8'),
      `${packageDef.slug} package config should be a direct copy of the tracked source config`
    );
  } else {
    const configText = readFileSync(join(packageRoot, 'config.toml'), 'utf8');
    assert.match(configText, /\[drawing_intent\]/, `${packageDef.slug} config should include curated drawing intent`);
    assert.match(configText, /\[\[drawing_intent\.required_dimensions\]\]/, `${packageDef.slug} config should include required dimensions`);
  }

  for (const artifact of CANONICAL_ARTIFACTS) {
    assert.equal(existsSync(join(packageRoot, artifact)), true, `${packageDef.slug} canonical artifact should exist: ${artifact}`);
  }

  const packageFiles = walkFiles(packageRoot);
  for (const filePath of packageFiles) {
    assert.equal(STALE_AF5_NAMES.includes(basename(filePath)), false, `stale AF5 filename should be absent: ${filePath}`);
    if (!TEXT_EXTENSIONS.has(extname(filePath))) continue;
    const text = readFileSync(filePath, 'utf8');
    assertPortableText(relative(ROOT, filePath), text);
    if (extname(filePath) === '.json') assertPortableJson(filePath);
  }

  const manifestEntry = libraryManifest.examples.find((example) => example.slug === packageDef.slug);
  assert.equal(Boolean(manifestEntry), true, `${packageDef.slug} should be in the example-library manifest`);
  assert.equal(manifestEntry.status, 'canonical-package');
  for (const key of [
    'generated_cad',
    'quality_report',
    'review_pack',
    'readiness_report',
    'standard_docs_manifest',
    'release_bundle_manifest',
    'release_bundle_zip',
  ]) {
    assert.equal(manifestEntry.current_coverage[key], true, `${packageDef.slug} manifest coverage should mark ${key} true`);
  }
  assert.equal(manifestEntry.current_coverage.studio_reopen_fixture, true, `${packageDef.slug} Studio reopen fixture should be covered`);

  const releaseManifestPath = join(packageRoot, 'release', 'release_bundle_manifest.json');
  const releaseManifest = assertPortableJson(releaseManifestPath);
  assert.equal(releaseManifest.bundle_file.filename, 'release_bundle.zip');
  assert.equal(releaseManifest.bundle_file.path, `docs/examples/${packageDef.slug}/release/release_bundle.zip`);
  assert.equal(releaseManifest.readiness_report_ref.path, `docs/examples/${packageDef.slug}/readiness/readiness_report.json`);
  assert.equal(releaseManifest.docs_manifest_ref.path, `docs/examples/${packageDef.slug}/standard-docs/standard_docs_manifest.json`);

  if (['quality-pass-bracket', 'plate-with-holes'].includes(packageDef.slug)) {
    const reviewPack = assertPortableJson(join(packageRoot, 'review', 'review_pack.json'));
    const packageEvidenceRecords = (reviewPack.evidence_ledger?.records || [])
      .filter((record) => String(record.evidence_id || '').startsWith('package:'));
    assert.equal(packageEvidenceRecords.length, 5, `${packageDef.slug} review pack should link five package side inputs`);
    assert.equal(
      packageEvidenceRecords.some((record) => (record.classifications || []).includes('quality_evidence')),
      true,
      `${packageDef.slug} should link package quality evidence`
    );
    assert.equal(
      packageEvidenceRecords.every((record) => record.inspection_evidence === false),
      true,
      `${packageDef.slug} side inputs should not satisfy inspection evidence`
    );

    const readinessReport = assertPortableJson(join(packageRoot, 'readiness', 'readiness_report.json'));
    const missingInputs = readinessReport.review_pack?.uncertainty_coverage_report?.missing_inputs || [];
    assert.equal(missingInputs.includes('quality_evidence'), false, 'quality evidence should no longer be missing');
    assert.equal(missingInputs.includes('inspection_evidence'), true, 'inspection evidence should remain missing');
  }

  const zipPath = join(packageRoot, 'release', 'release_bundle.zip');
  assert.equal(existsSync(zipPath), true, `${packageDef.slug} release_bundle.zip should exist in release directory`);
  assert.equal(statSync(zipPath).size < 250_000, true, `${packageDef.slug} release_bundle.zip should stay small enough for curated docs review`);

  const zipEntries = await listZipEntries(zipPath);
  const zipEntryNames = zipEntries.map((entry) => entry.name).sort();
  const expectedZipEntries = [
    'canonical/readiness_report.json',
    'canonical/readiness_report.md',
    'canonical/review_pack.json',
    'docs/control_plan_draft.csv',
    'docs/inspection_checksheet_draft.csv',
    'docs/pfmea_seed.csv',
    'docs/process_flow.md',
    'docs/standard_docs_manifest.json',
    'docs/work_instruction_draft.md',
    `references/${packageDef.stem}.step`,
    'release_bundle_checksums.sha256',
    'release_bundle_log.json',
    'release_bundle_manifest.json',
  ].sort();
  assert.deepEqual(zipEntryNames, expectedZipEntries);
  for (const staleName of STALE_AF5_NAMES) {
    assert.equal(zipEntryNames.includes(staleName), false, `${packageDef.slug} release bundle should not include stale entry ${staleName}`);
  }

  for (const entryName of zipEntryNames.filter((name) => TEXT_EXTENSIONS.has(extname(name)))) {
    const entry = await readZipEntry(zipPath, entryName);
    assertPortableText(`${packageDef.slug}:release_bundle.zip:${entryName}`, entry.data.toString('utf8'));
  }

  assert.notEqual(
    releaseManifest.bundle_file.path,
    releaseManifest.canonical_artifact?.artifact_filename,
    `${packageDef.slug} release_bundle_manifest.json should not be confused with release_bundle.zip`
  );
}

console.log('example-library-package.test.js: ok');
