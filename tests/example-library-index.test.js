import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROOT_README_PATH = resolve(ROOT, 'README.md');
const INDEX_PATH = resolve(ROOT, 'docs', 'examples', 'README.md');
const MANIFEST_PATH = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const CANONICAL_ARTIFACTS = Object.freeze([
  'review_pack.json',
  'readiness_report.json',
  'standard_docs_manifest.json',
  'release_bundle_manifest.json',
  'release_bundle_checksums.sha256',
  'release_bundle_log.json',
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

const rootReadmeText = readFileSync(ROOT_README_PATH, 'utf8');
const indexText = readFileSync(INDEX_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const canonicalPackages = manifest.examples.filter((example) => example.status === 'canonical-package');

assert.match(rootReadmeText, /canonical example library/);
assert.match(rootReadmeText, /readiness\/readiness_report\.json`; that JSON is the readiness source of truth/);
assert.match(rootReadmeText, /inspection_evidence` remains missing/);
assert.match(rootReadmeText, /quality\/drawing evidence does not satisfy `inspection_evidence`/);
assert.match(rootReadmeText, /Studio for read-only canonical package cards, allowlisted artifact preview, and tracked job\/artifact reopen/);
assert.match(rootReadmeText, /checked-in canonical packages remain docs-package artifacts/);
assert.match(rootReadmeText, /Do not treat synthetic fixtures or generated CAD\/drawing\/readiness outputs as package inspection evidence/);
assert.match(rootReadmeText, /First-user CLI recipe: inspect a canonical package/);
assert.match(rootReadmeText, /inspect checked-in canonical package artifacts without regenerating anything/);
assert.match(rootReadmeText, /--inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>/);
assert.match(rootReadmeText, /Do not use `tests\/fixtures\/inspection-evidence\/valid-manual-caliper-inspection\.json`/);
assert.match(rootReadmeText, /quality\/drawing evidence does not satisfy `inspection_evidence`/);
assert.match(rootReadmeText, /Studio supports read-only canonical package cards and allowlisted artifact preview/);
assert.match(rootReadmeText, /checked-in canonical package discovery is not arbitrary local file import/);

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
assert.match(indexText, /held at `hold_for_evidence_completion` because `inspection_evidence` remains missing/);
assert.match(indexText, /quality and drawing evidence is review evidence and closes `quality_evidence`, but it does not satisfy `inspection_evidence`/);
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
