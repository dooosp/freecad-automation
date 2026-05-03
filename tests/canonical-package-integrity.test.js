import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { CANONICAL_PACKAGE_SLUGS as DISCOVERY_CANONICAL_PACKAGE_SLUGS } from '../src/server/canonical-package-discovery.js';

const ROOT = resolve(import.meta.dirname, '..');
const EXAMPLES_ROOT = resolve(ROOT, 'docs', 'examples');
const EXAMPLES_README_PATH = join(EXAMPLES_ROOT, 'README.md');
const MANIFEST_PATH = join(EXAMPLES_ROOT, 'example-library-manifest.json');
const CLOSEOUT_PATH = resolve(ROOT, 'docs', 'project-closeout-status.md');

const CANONICAL_PACKAGES = Object.freeze([
  {
    slug: 'quality-pass-bracket',
    score: 61,
    sourceConfig: 'configs/examples/quality_pass_bracket.toml',
  },
  {
    slug: 'plate-with-holes',
    score: 61,
    sourceConfig: 'configs/examples/pcb_mount_plate.toml',
  },
  {
    slug: 'motor-mount',
    score: 55,
    sourceConfig: 'configs/generated/cnc_motor_mount_bracket.toml',
  },
  {
    slug: 'controller-housing-eol',
    score: 52,
    sourceConfig: 'configs/examples/controller_housing_eol.toml',
  },
  {
    slug: 'hinge-block',
    score: 52,
    sourceConfig: 'configs/examples/hinge_block.toml',
  },
]);

const CANONICAL_SLUGS = CANONICAL_PACKAGES.map((pkg) => pkg.slug);
const REQUIRED_CHAIN_ENTRIES = Object.freeze([
  'README.md',
  'config.toml',
  'cad/',
  'quality/',
  'drawing/',
  'review/review_pack.json',
  'readiness/readiness_report.json',
  'standard-docs/standard_docs_manifest.json',
  'release/release_bundle_manifest.json',
  'release/release_bundle_checksums.sha256',
  'release/release_bundle_log.json',
  'release/release_bundle.zip',
  'reopen-notes.md',
]);

const REVIEW_SIDE_INPUT_TYPES = new Set([
  'create_quality_report',
  'drawing_quality_report',
  'drawing_qa_report',
  'drawing_intent',
  'feature_catalog',
]);

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, strings);
    return strings;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, strings);
  }
  return strings;
}

function parseJsonString(source, startIndex) {
  let index = startIndex + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '"') {
      return {
        value: JSON.parse(source.slice(startIndex, index + 1)),
        endIndex: index + 1,
      };
    }
    index += 1;
  }
  throw new Error('Unterminated JSON string while checking duplicate keys');
}

function lineColumnAt(source, index) {
  const lines = source.slice(0, index).split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function findDuplicateJsonObjectKeys(source) {
  const stack = [];
  const duplicates = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const top = stack[stack.length - 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '{') {
      stack.push({ type: 'object', keys: new Set(), expectingKey: true });
      index += 1;
      continue;
    }

    if (char === '[') {
      stack.push({ type: 'array' });
      index += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      stack.pop();
      index += 1;
      continue;
    }

    if (char === ',') {
      if (top?.type === 'object') top.expectingKey = true;
      index += 1;
      continue;
    }

    if (char === ':') {
      if (top?.type === 'object') top.expectingKey = false;
      index += 1;
      continue;
    }

    if (char === '"') {
      const parsed = parseJsonString(source, index);
      const afterString = source.slice(parsed.endIndex).match(/^\s*/)[0].length + parsed.endIndex;
      if (top?.type === 'object' && top.expectingKey && source[afterString] === ':') {
        if (top.keys.has(parsed.value)) {
          duplicates.push({
            key: parsed.value,
            ...lineColumnAt(source, index),
          });
        }
        top.keys.add(parsed.value);
      }
      index = parsed.endIndex;
      continue;
    }

    index += 1;
  }

  return duplicates;
}

function assertRepoRelativePath(label, pathValue) {
  assert.equal(typeof pathValue, 'string', `${label} should be a string path`);
  assert.equal(pathValue.length > 0, true, `${label} should not be empty`);
  assert.equal(isAbsolute(pathValue), false, `${label} should be repo-relative`);
  assert.equal(pathValue.includes('\\'), false, `${label} should use slash separators`);
  assert.equal(pathValue.split('/').includes('..'), false, `${label} should not traverse`);
  assert.equal(pathValue.startsWith('output/'), false, `${label} should not point at ignored output/`);
  assert.equal(pathValue.startsWith('tmp/codex/'), false, `${label} should not point at task scratch`);
}

function assertNoPositiveProductionReadyClaim(label, text) {
  const patterns = [
    /\b(is|are|as|now|marked|considered)\s+production-ready\b/i,
    /\bproduction readiness (is|has been) (complete|cleared|approved|achieved)\b/i,
    /\bready for production\b/i,
  ];
  for (const pattern of patterns) {
    assert.equal(pattern.test(text), false, `${label} should not claim production readiness`);
  }
}

function readinessMissingInputs(report) {
  return [
    ...(report.readiness_summary?.missing_inputs || []),
    ...(report.review_pack?.uncertainty_coverage_report?.missing_inputs || []),
    ...(report.process_plan?.summary?.missing_inputs || []),
    ...(report.quality_risk?.summary?.missing_inputs || []),
  ];
}

assert.deepEqual(
  findDuplicateJsonObjectKeys('{"a":1,"nested":{"a":2,"a":3}}').map((entry) => entry.key),
  ['a'],
  'duplicate-key scanner should catch duplicate object keys'
);

const examplesReadme = readText(EXAMPLES_README_PATH);
const closeoutText = readText(CLOSEOUT_PATH);
const rawManifest = readText(MANIFEST_PATH);
const manifestDuplicates = findDuplicateJsonObjectKeys(rawManifest);
assert.deepEqual(
  manifestDuplicates,
  [],
  `example-library-manifest.json should not contain duplicate object keys: ${manifestDuplicates.map((entry) => `${entry.key}@${entry.line}:${entry.column}`).join(', ')}`
);

const manifest = JSON.parse(rawManifest);
const canonicalEntries = manifest.examples.filter((example) => example.status === 'canonical-package');
assert.deepEqual(
  DISCOVERY_CANONICAL_PACKAGE_SLUGS,
  canonicalEntries.map((entry) => entry.slug),
  'Studio/API canonical package discovery should match the manifest canonical package inventory'
);
assert.deepEqual(
  canonicalEntries.map((entry) => entry.slug),
  CANONICAL_SLUGS,
  'manifest canonical package inventory should stay fixed at the five-package closeout set'
);
assert.deepEqual(
  manifest.canonical_artifacts,
  [
    'review_pack.json',
    'readiness_report.json',
    'standard_docs_manifest.json',
    'release_bundle_manifest.json',
    'release_bundle_checksums.sha256',
    'release_bundle_log.json',
    'release_bundle.zip',
  ],
  'manifest should declare the complete canonical package artifact chain'
);
assert.deepEqual(
  manifest.recommended_directory_shape,
  REQUIRED_CHAIN_ENTRIES,
  'manifest recommended directory shape should include the release checksum and log sidecars'
);

for (const entry of manifest.examples.filter((example) => example.status !== 'canonical-package')) {
  const coverage = entry.current_coverage || {};
  const completeCoverage = [
    'generated_cad',
    'quality_report',
    'review_pack',
    'readiness_report',
    'standard_docs_manifest',
    'release_bundle_manifest',
    'release_bundle_zip',
    'studio_reopen_fixture',
  ].every((key) => coverage[key] === true);
  assert.equal(completeCoverage, false, `${entry.slug} should not look like an accidental complete canonical package`);
}

assert.match(examplesReadme, /release_bundle_checksums\.sha256/);
assert.match(examplesReadme, /release_bundle_log\.json/);
assert.match(closeoutText, /non-inspection software milestone/);
assert.match(closeoutText, /Production readiness remains held/);
assert.match(closeoutText, /Stage 5B inspection evidence remains parked/);
assert.match(closeoutText, /Generated quality, drawing, readiness, review, standard-doc, release, template, fixture, and collection-guide artifacts are not inspection evidence/);
assertNoPositiveProductionReadyClaim('docs/examples/README.md', examplesReadme);
assertNoPositiveProductionReadyClaim('docs/project-closeout-status.md', closeoutText);

for (const packageDef of CANONICAL_PACKAGES) {
  const packageRoot = join(EXAMPLES_ROOT, packageDef.slug);
  const packageReadme = readText(join(packageRoot, 'README.md'));
  const readinessPath = join(packageRoot, 'readiness', 'readiness_report.json');
  const reviewPath = join(packageRoot, 'review', 'review_pack.json');
  const releaseManifestPath = join(packageRoot, 'release', 'release_bundle_manifest.json');
  const releaseZipPath = join(packageRoot, 'release', 'release_bundle.zip');
  const inspectionEvidencePath = join(packageRoot, 'inspection', 'inspection_evidence.json');

  assert.equal(examplesReadme.includes(`./${packageDef.slug}/README.md`), true, `${packageDef.slug} should appear in docs/examples/README.md`);
  assert.equal(closeoutText.includes(`\`${packageDef.slug}\``), true, `${packageDef.slug} should appear in project closeout status`);
  assert.equal(existsSync(inspectionEvidencePath), false, `${packageDef.slug} must not have attached inspection evidence yet`);

  for (const chainEntry of REQUIRED_CHAIN_ENTRIES) {
    const entryPath = join(packageRoot, chainEntry);
    assert.equal(existsSync(entryPath), true, `${packageDef.slug} should include ${chainEntry}`);
    if (chainEntry.endsWith('/')) {
      assert.equal(lstatSync(entryPath).isDirectory(), true, `${packageDef.slug} ${chainEntry} should be a directory`);
    }
  }

  const manifestEntry = canonicalEntries.find((entry) => entry.slug === packageDef.slug);
  assert.equal(manifestEntry.source_config, packageDef.sourceConfig);
  assert.equal(
    manifestEntry.notes.some((note) => /quality.*drawing.*linked in the review pack as review evidence/i.test(note)),
    true,
    `${packageDef.slug} manifest notes should preserve quality/drawing review-evidence wording`
  );
  assert.equal(
    manifestEntry.notes.some((note) => /inspection_evidence remains missing/i.test(note)),
    true,
    `${packageDef.slug} manifest notes should preserve missing inspection evidence wording`
  );
  assert.equal(
    manifestEntry.notes.some((note) => /production readiness is not claimed/i.test(note)),
    true,
    `${packageDef.slug} manifest notes should preserve no-production-readiness wording`
  );

  const readinessReport = readJson(readinessPath);
  assert.equal(readinessReport.readiness_summary.status, 'needs_more_evidence', `${packageDef.slug} status should remain held for evidence`);
  assert.equal(readinessReport.readiness_summary.score, packageDef.score, `${packageDef.slug} readiness score should remain unchanged`);
  assert.equal(readinessReport.readiness_summary.gate_decision, 'hold_for_evidence_completion', `${packageDef.slug} gate should remain held`);
  assert.equal(new Set(readinessMissingInputs(readinessReport)).has('inspection_evidence'), true, `${packageDef.slug} should still miss inspection_evidence`);
  assert.equal(new Set(readinessMissingInputs(readinessReport)).has('quality_evidence'), false, `${packageDef.slug} should keep generated quality evidence separate from inspection evidence`);
  assert.match(packageReadme, /readiness\/readiness_report\.json` is the readiness source of truth/);
  assert.match(
    packageReadme,
    new RegExp(`current readiness status remains \`${readinessReport.readiness_summary.status}\`, score ${readinessReport.readiness_summary.score}`),
    `${packageDef.slug} README score should match readiness_report.json`
  );
  assert.match(packageReadme, /no real inspection evidence is attached yet/i);
  assertNoPositiveProductionReadyClaim(`${packageDef.slug} README`, packageReadme);
  assertNoPositiveProductionReadyClaim(`${packageDef.slug} readiness_report.json`, JSON.stringify(readinessReport));

  const reviewPack = readJson(reviewPath);
  const packageRecords = (reviewPack.evidence_ledger?.records || [])
    .filter((record) => String(record.evidence_id || '').startsWith('package:'));
  assert.equal(packageRecords.length, 5, `${packageDef.slug} should have the five generated package side-input records`);
  assert.equal(
    packageRecords.every((record) => REVIEW_SIDE_INPUT_TYPES.has(record.type)),
    true,
    `${packageDef.slug} side inputs should stay limited to generated package evidence types`
  );
  assert.equal(
    packageRecords.every((record) => record.inspection_evidence === false),
    true,
    `${packageDef.slug} generated side inputs must not satisfy inspection evidence`
  );
  for (const record of packageRecords) {
    assertRepoRelativePath(`${packageDef.slug} package evidence source_ref`, record.source_ref);
    assert.equal(
      record.source_ref.startsWith(`docs/examples/${packageDef.slug}/quality/`)
        || record.source_ref.startsWith(`docs/examples/${packageDef.slug}/drawing/`),
      true,
      `${packageDef.slug} generated side input should come from quality/ or drawing/`
    );
    assert.equal(
      (record.classifications || []).includes('inspection_evidence'),
      false,
      `${packageDef.slug} generated side input should not be classified as inspection evidence`
    );
  }
  assert.equal(
    (reviewPack.evidence_ledger?.records || []).some((record) => record.type === 'inspection_evidence' || record.inspection_evidence === true),
    false,
    `${packageDef.slug} review pack should not contain genuine inspection evidence records`
  );

  const releaseManifest = readJson(releaseManifestPath);
  assert.equal(releaseManifest.bundle_file.filename, 'release_bundle.zip');
  assert.equal(releaseManifest.bundle_file.path, relative(ROOT, releaseZipPath));
  assert.notEqual(relative(ROOT, releaseManifestPath), releaseManifest.bundle_file.path, `${packageDef.slug} release manifest should be distinct from ZIP`);
  assert.equal(existsSync(releaseZipPath), true, `${packageDef.slug} release bundle ZIP should exist`);
  assert.equal(releaseZipPath.endsWith('release_bundle.zip'), true);
  assertNoPositiveProductionReadyClaim(`${packageDef.slug} release_bundle_manifest.json`, JSON.stringify(releaseManifest));

  for (const text of collectStrings({
    packageReadme,
    readinessReport,
    reviewPack,
    releaseManifest,
  })) {
    assert.equal(/attached inspection evidence|inspection evidence attached/i.test(text), false, `${packageDef.slug} should not claim inspection evidence is attached`);
  }
}

console.log('canonical-package-integrity.test.js: ok');
