import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_ROOT = resolve(ROOT, 'docs', 'examples', 'controller-housing-eol');
const MANIFEST_PATH = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const STANDARD_DOC_SETS = Object.freeze([
  {
    dir: 'standard-docs',
    siteProfile: null,
    label: 'default profile preset',
    canonical: true,
  },
  {
    dir: 'standard-docs-korea',
    siteProfile: {
      name: 'site_korea_ulsan',
      label: 'Korea-Ulsan launch profile',
    },
    label: 'Korea-Ulsan launch profile',
    canonical: false,
  },
  {
    dir: 'standard-docs-mexico',
    siteProfile: {
      name: 'site_mexico_mty',
      label: 'Mexico-MTY launch profile',
    },
    label: 'Mexico-MTY launch profile',
    canonical: false,
  },
]);

const REQUIRED_DOCS = Object.freeze([
  'process_flow.md',
  'control_plan_draft.csv',
  'inspection_checksheet_draft.csv',
  'work_instruction_draft.md',
  'pfmea_seed.csv',
]);

const TEXT_EXTENSIONS = new Set(['.csv', '.json', '.md', '.txt']);

const STALE_AF5_NAMES = Object.freeze([
  'review-pack.json',
  'readiness-report.json',
  'standard-docs-manifest.json',
  'release-bundle-manifest.json',
  'release-bundle.zip',
]);

const BANNED_TEXT_PATTERNS = Object.freeze([
  /\/Users\//,
  /\/home\//,
  /[A-Za-z]:\\/,
  /tmp\/codex/,
  /\boutput\//,
  /\/(?:private\/)?tmp\//,
  /\/var\/folders\//,
  /job[-_][a-z0-9]{4,}/i,
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

assert.equal(existsSync(PACKAGE_ROOT), true, 'controller-housing-eol docs example should exist');

for (const filePath of walkFiles(PACKAGE_ROOT)) {
  assert.equal(basename(filePath), basename(filePath).replace('standard-docs-manifest', 'standard_docs_manifest'));
  assert.equal(STALE_AF5_NAMES.includes(basename(filePath)), false, `stale AF5 filename should be absent: ${filePath}`);
  if (!TEXT_EXTENSIONS.has(extname(filePath))) continue;
  assertPortableText(relative(ROOT, filePath), readFileSync(filePath, 'utf8'));
}

for (const standardDocSet of STANDARD_DOC_SETS) {
  const docsRoot = join(PACKAGE_ROOT, standardDocSet.dir);
  assert.equal(existsSync(docsRoot), true, `${standardDocSet.dir} should remain discoverable`);
  for (const filename of REQUIRED_DOCS) {
    assert.equal(existsSync(join(docsRoot, filename)), true, `${standardDocSet.dir}/${filename} should exist`);
  }

  const manifestPath = join(docsRoot, 'standard_docs_manifest.json');
  assert.equal(existsSync(manifestPath), true, `${standardDocSet.dir} should use standard_docs_manifest.json`);
  const manifest = readJson(manifestPath);
  assert.equal(manifest.workflow, 'standard_docs_generation');
  assert.equal(manifest.part?.name, 'controller_housing_eol');
  if (standardDocSet.canonical) {
    assert.equal(manifest.schema_version, '1.0', `${standardDocSet.dir} should be regenerated canonical docs evidence`);
    assert.equal(manifest.artifact_type, 'docs_manifest');
    assert.equal(manifest.canonical_artifact?.artifact_filename, 'standard_docs_manifest.json');
    assert.equal(manifest.sanitization_note, undefined, `${standardDocSet.dir} should no longer be the legacy sanitized manifest`);
  } else {
    assert.equal(manifest.schema_version, '0.1', `${standardDocSet.dir} should remain a legacy site-doc example`);
    assert.equal(manifest.sanitization_note?.includes('repo-relative'), true, `${standardDocSet.dir} should document path sanitization`);
    assert.equal(
      manifest.sanitization_note?.includes('full canonical package promotion still requires'),
      true,
      `${standardDocSet.dir} should document that the site docs are legacy sanitized examples`
    );
  }
  assert.deepEqual(manifest.site_profile, standardDocSet.siteProfile);

  const documentNames = manifest.documents.map((document) => document.filename).sort();
  assert.deepEqual(documentNames, [...REQUIRED_DOCS].sort(), `${standardDocSet.dir} manifest should list the standard-doc set`);
  for (const document of manifest.documents) {
    assert.equal(isAbsolute(document.path), false, `${standardDocSet.dir} document path should be repo-relative: ${document.path}`);
    assert.equal(
      document.path,
      `docs/examples/controller-housing-eol/${standardDocSet.dir}/${document.filename}`,
      `${standardDocSet.dir} document path should be a portable package path`
    );
    assert.equal(existsSync(resolve(ROOT, document.path)), true, `${standardDocSet.dir} listed document should exist: ${document.path}`);
  }

  const processFlow = readFileSync(join(docsRoot, 'process_flow.md'), 'utf8');
  assert.equal(processFlow.includes(`Profile preset: ${standardDocSet.label}`), true);

  for (const text of collectStrings(manifest)) {
    assert.equal(isAbsolute(text), false, `${standardDocSet.dir} manifest should not contain absolute path string: ${text}`);
  }
}

const libraryManifest = readJson(MANIFEST_PATH);
const eolEntry = libraryManifest.examples.find((example) => example.slug === 'controller-housing-eol');
assert.equal(Boolean(eolEntry), true, 'controller-housing-eol should stay listed in the example library manifest');
assert.equal(eolEntry.status, 'canonical-package');
for (const key of [
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
]) {
  assert.equal(eolEntry.current_coverage[key], true, `controller-housing-eol should claim canonical package coverage for ${key}`);
}
assert.equal(
  eolEntry.notes.some((note) => note.includes('Korea and Mexico standard-doc directories remain legacy site examples')),
  true,
  'manifest should document retained legacy site docs'
);

console.log('controller-housing-eol-standard-docs.test.js: ok');
