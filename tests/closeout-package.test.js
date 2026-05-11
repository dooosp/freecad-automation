import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { generateCloseoutPackage } from '../src/services/closeout-package/closeout-package-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-closeout-package-'));

const REQUIRED_MANIFEST_FIELDS = Object.freeze([
  'artifact_type',
  'package_id',
  'mode',
  'generated_at',
  'source_refs',
  'readiness_status',
  'score',
  'gate_decision',
  'missing_inputs',
  'production_ready',
  'inspection_evidence_created',
  'inspection_evidence_attached',
  'canonical_artifacts_regenerated',
  'generated_artifact_boundary',
  'files',
  'warnings',
]);

const REQUIRED_BOUNDARY_TEXT = Object.freeze([
  'software/demo closeout only',
  'review/demo evidence only',
  'no physical part inspection was completed',
  'no supplier/lab/CMM/manual inspection evidence was attached',
  'production readiness remains held',
  'release bundle presence is not readiness proof',
  'future Stage 5B requires genuine completed inspection evidence attached through the canonical review-context path',
]);

const FORBIDDEN_OVERCLAIMS = Object.freeze([
  /\bis production[- ]ready\b/i,
  /\bproduction_ready["']?\s*:\s*true\b/i,
  /\binspection complete\b/i,
  /\bStage 5B complete\b/i,
  /\brelease bundle proves readiness\b/i,
  /\bCAD-derived values are physical measurements\b/i,
  /\bgenerated (?:docs|documents|reports|screenshots|release bundles?) are inspection evidence\b/i,
]);

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
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

function assertNoAbsoluteLocalPaths(label, value) {
  for (const text of collectStrings(value)) {
    assert.equal(isAbsolute(text), false, `${label} should not contain absolute path string: ${text}`);
    assert.equal(/\/(?:Users|home|tmp|private|var)\//.test(text), false, `${label} should not contain local path segment: ${text}`);
    assert.equal(/[A-Za-z]:\\/.test(text), false, `${label} should not contain Windows absolute path: ${text}`);
  }
}

function assertBoundaryText(label, text) {
  for (const phrase of REQUIRED_BOUNDARY_TEXT) {
    assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${label} should include boundary phrase: ${phrase}`);
  }

  for (const pattern of FORBIDDEN_OVERCLAIMS) {
    assert.doesNotMatch(text, pattern, `${label} should not overclaim with pattern ${pattern}`);
  }
}

function assertManifestShape(manifestPath, expectedArtifactType) {
  const manifest = readJson(manifestPath);
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    assert.equal(Object.hasOwn(manifest, field), true, `${manifestPath} missing ${field}`);
  }

  assert.equal(manifest.artifact_type, expectedArtifactType);
  assert.equal(manifest.package_id, 'quality-pass-bracket');
  assert.equal(manifest.mode, 'software-demo');
  assert.equal(manifest.readiness_status, 'needs_more_evidence');
  assert.equal(manifest.score, 61);
  assert.equal(manifest.gate_decision, 'hold_for_evidence_completion');
  assert.deepEqual(manifest.missing_inputs, ['inspection_evidence']);
  assert.equal(manifest.production_ready, false);
  assert.equal(manifest.inspection_evidence_created, false);
  assert.equal(manifest.inspection_evidence_attached, false);
  assert.equal(manifest.canonical_artifacts_regenerated, false);
  assert.equal(Array.isArray(manifest.source_refs), true);
  assert.equal(Array.isArray(manifest.files), true);
  assert.equal(Array.isArray(manifest.warnings), true);
  assert.equal(
    manifest.source_refs.some((ref) => ref.path === 'docs/examples/quality-pass-bracket/readiness/readiness_report.json'),
    true,
    'manifest should include repo-relative readiness source ref'
  );
  assertNoAbsoluteLocalPaths(manifestPath, manifest);
  assertBoundaryText(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

try {
  const outDir = join(TMP_DIR, 'generated');
  const result = runCli([
    'closeout-package',
    'quality-pass-bracket',
    '--mode',
    'software-demo',
    '--out-dir',
    outDir,
    '--strict-boundary',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /software\/demo closeout/i);

  const closeoutDir = join(outDir, 'quality-pass-bracket-software-demo-closeout');
  const portfolioDir = join(outDir, 'quality-pass-bracket-portfolio-pack');
  const interviewDir = join(outDir, 'quality-pass-bracket-interview-demo-pack');

  const closeoutManifest = assertManifestShape(
    join(closeoutDir, 'closeout_manifest.json'),
    'software_demo_closeout_manifest'
  );
  const portfolioManifest = assertManifestShape(
    join(portfolioDir, 'portfolio_manifest.json'),
    'software_demo_portfolio_manifest'
  );
  const interviewManifest = assertManifestShape(
    join(interviewDir, 'interview_demo_manifest.json'),
    'software_demo_interview_manifest'
  );

  assert.equal(closeoutManifest.files.includes('closeout_summary.md'), true);
  assert.equal(portfolioManifest.files.includes('portfolio_case_draft.md'), true);
  assert.equal(interviewManifest.files.includes('interview_demo_talking_points.md'), true);

  for (const markdownPath of [
    join(closeoutDir, 'closeout_summary.md'),
    join(portfolioDir, 'portfolio_case_draft.md'),
    join(interviewDir, 'interview_demo_talking_points.md'),
  ]) {
    assert.equal(existsSync(markdownPath), true, `Expected markdown at ${markdownPath}`);
    const markdown = readFileSync(markdownPath, 'utf8');
    assertBoundaryText(markdownPath, markdown);
    assertNoAbsoluteLocalPaths(markdownPath, markdown);
  }

  const invalidSlug = runCli([
    'closeout-package',
    'ks-bracket',
    '--mode',
    'software-demo',
    '--out-dir',
    join(TMP_DIR, 'invalid-slug'),
  ]);
  assert.notEqual(invalidSlug.status, 0);
  assert.match(`${invalidSlug.stdout}\n${invalidSlug.stderr}`, /canonical package slug/i);

  const traversalSlug = runCli([
    'closeout-package',
    '../quality-pass-bracket',
    '--mode',
    'software-demo',
    '--out-dir',
    join(TMP_DIR, 'traversal'),
  ]);
  assert.notEqual(traversalSlug.status, 0);
  assert.match(`${traversalSlug.stdout}\n${traversalSlug.stderr}`, /unsafe package slug/i);

  const fixtureRoot = join(TMP_DIR, 'fixture-root');
  const fixtureManifestPath = join(fixtureRoot, 'docs', 'examples', 'example-library-manifest.json');
  mkdirSync(dirname(fixtureManifestPath), { recursive: true });
  writeFileSync(fixtureManifestPath, JSON.stringify({
    schema_version: 1,
    examples: [
      {
        slug: 'missing-readiness',
        status: 'canonical-package',
        current_coverage: {
          readiness_report: true,
        },
      },
    ],
  }, null, 2), 'utf8');
  mkdirSync(join(fixtureRoot, 'docs', 'examples', 'missing-readiness'), { recursive: true });

  await assert.rejects(
    () => generateCloseoutPackage({
      slug: 'missing-readiness',
      mode: 'software-demo',
      outDir: join(TMP_DIR, 'missing-readiness-out'),
      projectRoot: fixtureRoot,
    }),
    /readiness report/i
  );

  console.log('closeout-package.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
