import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const REQUIRED_CANONICAL_ARTIFACTS = Object.freeze([
  'review_pack.json',
  'readiness_report.json',
  'standard_docs_manifest.json',
  'release_bundle_manifest.json',
  'release_bundle.zip',
]);

const STALE_AF5_NAMES = Object.freeze([
  'readiness-report.json',
  'standard-docs-manifest.json',
  'release-bundle-manifest.json',
  'release-bundle.zip',
]);

const REQUIRED_COVERAGE_KEYS = Object.freeze([
  'config',
  'drawing_intent',
  'generated_cad',
  'quality_report',
  'review_pack',
  'readiness_report',
  'standard_docs_manifest',
  'release_bundle_manifest',
  'release_bundle_zip',
  'studio_reopen_fixture',
]);

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

const rawManifest = readFileSync(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(rawManifest);

assert.equal(manifest.schema_version, 1);
assert.equal(manifest.phase, 'example-library-expansion');
assert.deepEqual(manifest.canonical_artifacts, REQUIRED_CANONICAL_ARTIFACTS);

for (const staleName of STALE_AF5_NAMES) {
  assert.equal(rawManifest.includes(staleName), false, `Manifest should not contain stale AF5 name ${staleName}`);
}

assert.equal(Array.isArray(manifest.examples), true, 'manifest examples should be an array');
assert.equal(manifest.examples.length >= 8, true, 'manifest should include the audited candidate examples');

const slugs = new Set();
for (const example of manifest.examples) {
  assert.equal(typeof example.slug, 'string', 'example slug is required');
  assert.match(example.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${example.slug} should be URL-safe kebab-case`);
  assert.equal(slugs.has(example.slug), false, `Duplicate example slug ${example.slug}`);
  slugs.add(example.slug);

  assert.equal(typeof example.status, 'string', `${example.slug} status is required`);
  assert.equal(Number.isInteger(example.priority), true, `${example.slug} priority should be an integer`);
  assert.equal(example.priority > 0, true, `${example.slug} priority should be positive`);

  assert.equal(example.current_coverage && typeof example.current_coverage === 'object', true, `${example.slug} current_coverage is required`);
  for (const coverageKey of REQUIRED_COVERAGE_KEYS) {
    assert.equal(
      typeof example.current_coverage[coverageKey],
      'boolean',
      `${example.slug} current_coverage.${coverageKey} should be boolean`
    );
  }

  if (typeof example.source_config === 'string') {
    assert.equal(isAbsolute(example.source_config), false, `${example.slug} source_config should be repo-relative`);
    assert.equal(example.source_config.startsWith('configs/'), true, `${example.slug} source_config should point at configs`);
    assert.equal(existsSync(resolve(ROOT, example.source_config)), true, `${example.slug} source_config should exist`);
  } else {
    assert.equal(example.source_config, null, `${example.slug} source_config should be a string or null`);
  }
}

assert.equal(slugs.has('quality-pass-bracket'), true, 'quality-pass-bracket candidate should be present');
assert.equal(slugs.has('ks-bracket'), true, 'ks-bracket blocker-rich candidate should be present');
assert.equal(slugs.has('hinge-block'), true, 'hinge-block absent candidate should be present');
assert.equal(slugs.has('spacer'), true, 'spacer absent candidate should be present');
assert.equal(slugs.has('simple-jig'), true, 'simple-jig absent candidate should be present');

for (const text of collectStrings(manifest)) {
  assert.equal(isAbsolute(text), false, `Manifest should not contain absolute paths: ${text}`);
  assert.equal(text.includes('tmp/codex'), false, `Manifest should not reference task notes: ${text}`);
  assert.equal(text.includes('output/'), false, `Manifest should not use generated outputs as source of truth: ${text}`);
  assert.equal(/job[-_][a-z0-9]/i.test(text), false, `Manifest should not contain machine-specific job ids: ${text}`);
}

console.log('example-library-manifest.test.js: ok');
