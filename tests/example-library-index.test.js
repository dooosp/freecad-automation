import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX_PATH = resolve(ROOT, 'docs', 'examples', 'README.md');
const MANIFEST_PATH = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const CANONICAL_ARTIFACTS = Object.freeze([
  'review_pack.json',
  'readiness_report.json',
  'standard_docs_manifest.json',
  'release_bundle_manifest.json',
  'release_bundle.zip',
]);

const STALE_AF5_NAMES = Object.freeze([
  'review-pack.json',
  'readiness-report.json',
  'standard-docs-manifest.json',
  'release-bundle-manifest.json',
  'release-bundle.zip',
]);

assert.equal(existsSync(INDEX_PATH), true, 'docs/examples/README.md should exist');

const indexText = readFileSync(INDEX_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const canonicalPackages = manifest.examples.filter((example) => example.status === 'canonical-package');

assert.equal(canonicalPackages.length, 4, 'example-library index assumes the first four canonical packages are complete');
assert.match(indexText, /^# Example Library/m);
assert.match(indexText, /status `canonical-package`/);

for (const example of canonicalPackages) {
  assert.equal(indexText.includes(example.slug), true, `index should reference canonical package ${example.slug}`);
  assert.equal(indexText.includes(example.source_config), true, `index should reference ${example.slug} source config`);
}

for (const artifact of CANONICAL_ARTIFACTS) {
  assert.equal(indexText.includes(artifact), true, `index should document canonical artifact ${artifact}`);
}

for (const staleName of STALE_AF5_NAMES) {
  assert.equal(indexText.includes(staleName), false, `index should not contain stale AF5 artifact name ${staleName}`);
}

assert.match(indexText, /`needs_more_evidence` is not a package failure/);
assert.match(indexText, /lacks separate inspection evidence and quality-linkage side inputs/);
assert.match(indexText, /tracked job\/artifact re-entry/);
assert.match(indexText, /not arbitrary local file import/);
assert.equal(indexText.includes('arbitrary local file import support'), false, 'index should not claim arbitrary local file import support');
assert.match(indexText, /small curated package artifacts/);
assert.match(indexText, /not ignored generated-output directories/);
assert.match(indexText, /No fifth package is complete yet\./);

assert.equal(indexText.includes('tmp/codex'), false, 'index should not reference task notes');
assert.equal(indexText.includes('/Users/'), false, 'index should not contain local user paths');
assert.equal(indexText.includes('/Applications/'), false, 'index should not contain local application paths');
assert.equal(indexText.includes('/private/'), false, 'index should not contain private temp paths');
assert.equal(indexText.includes('/var/folders/'), false, 'index should not contain macOS temp paths');
assert.equal(/job[-_][a-z0-9]{4,}/i.test(indexText), false, 'index should not contain machine-specific job ids');

for (const line of indexText.split(/\r?\n/)) {
  const codeMatches = line.match(/`([^`]+)`/g) || [];
  for (const match of codeMatches) {
    const literal = match.slice(1, -1);
    assert.equal(isAbsolute(literal), false, `index should not contain absolute path literal ${literal}`);
  }
}

console.log('example-library-index.test.js: ok');
