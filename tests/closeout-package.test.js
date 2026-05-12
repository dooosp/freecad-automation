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

function readReadinessTruth(packageId) {
  const readiness = readJson(join(ROOT, 'docs', 'examples', packageId, 'readiness', 'readiness_report.json'));
  const summary = readiness.readiness_summary ?? readiness;
  const missingInputs =
    readiness.review_pack?.uncertainty_coverage_report?.missing_inputs
    ?? readiness.process_plan?.summary?.missing_inputs
    ?? readiness.quality_risk?.summary?.missing_inputs
    ?? readiness.missing_inputs
    ?? [];

  return {
    status: summary.status,
    score: summary.score,
    gateDecision: summary.gate_decision,
    missingInputs,
  };
}

function assertManifestShape(manifestPath, expectedArtifactType, packageId) {
  const truth = readReadinessTruth(packageId);
  const manifest = readJson(manifestPath);
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    assert.equal(Object.hasOwn(manifest, field), true, `${manifestPath} missing ${field}`);
  }

  assert.equal(manifest.artifact_type, expectedArtifactType);
  assert.equal(manifest.package_id, packageId);
  assert.equal(manifest.mode, 'software-demo');
  assert.equal(manifest.readiness_status, truth.status);
  assert.equal(manifest.score, truth.score);
  assert.equal(manifest.gate_decision, truth.gateDecision);
  assert.deepEqual(manifest.missing_inputs, truth.missingInputs);
  assert.equal(manifest.production_ready, false);
  assert.equal(manifest.inspection_evidence_created, false);
  assert.equal(manifest.inspection_evidence_attached, false);
  assert.equal(manifest.canonical_artifacts_regenerated, false);
  assert.equal(Array.isArray(manifest.source_refs), true);
  assert.equal(Array.isArray(manifest.files), true);
  assert.equal(Array.isArray(manifest.warnings), true);
  assert.equal(
    manifest.source_refs.some((ref) => ref.path === `docs/examples/${packageId}/readiness/readiness_report.json`),
    true,
    'manifest should include repo-relative readiness source ref'
  );
  assertNoAbsoluteLocalPaths(manifestPath, manifest);
  assertBoundaryText(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

try {
  for (const packageId of ['quality-pass-bracket', 'plate-with-holes']) {
    const outDir = join(TMP_DIR, packageId);
    const result = runCli([
      'closeout-package',
      packageId,
      '--mode',
      'software-demo',
      '--out-dir',
      outDir,
      '--strict-boundary',
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /software\/demo closeout/i);

    const closeoutDir = join(outDir, `${packageId}-software-demo-closeout`);
    const portfolioDir = join(outDir, `${packageId}-portfolio-pack`);
    const interviewDir = join(outDir, `${packageId}-interview-demo-pack`);

    const closeoutManifest = assertManifestShape(
      join(closeoutDir, 'closeout_manifest.json'),
      'software_demo_closeout_manifest',
      packageId
    );
    const portfolioManifest = assertManifestShape(
      join(portfolioDir, 'portfolio_manifest.json'),
      'software_demo_portfolio_manifest',
      packageId
    );
    const interviewManifest = assertManifestShape(
      join(interviewDir, 'interview_demo_manifest.json'),
      'software_demo_interview_manifest',
      packageId
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
      const truth = readReadinessTruth(packageId);
      assert.match(markdown, new RegExp(`Readiness status: \`${truth.status}\``));
      assert.match(markdown, new RegExp(`Score: \`${truth.score}\``));
      assert.match(markdown, new RegExp(`Gate decision: \`${truth.gateDecision}\``));
      for (const missingInput of truth.missingInputs) {
        assert.match(markdown, new RegExp(`Missing inputs: \`${missingInput}\``));
      }
      assert.match(markdown, /Production ready: `false`/);
      assert.match(markdown, /Inspection evidence created: `false`/);
      assert.match(markdown, /Inspection evidence attached: `false`/);
      assert.match(markdown, /Canonical artifacts regenerated: `false`/);
      assertBoundaryText(markdownPath, markdown);
      assertNoAbsoluteLocalPaths(markdownPath, markdown);
    }
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
