import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDArtifact } from '../lib/d-artifact-schema.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-d-artifact-'));
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'd-artifacts');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runPython(scriptPath, payload) {
  const completed = spawnSync('python3', [join(ROOT, scriptPath)], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  return JSON.parse(completed.stdout);
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function assertArtifact(kind, document) {
  const validation = validateDArtifact(kind, document);
  assert.equal(validation.ok, true, `${kind} schema errors:\n${validation.errors.join('\n')}`);
}

try {
  const generatedAt = '2026-03-31T00:00:00Z';
  const context = readJson(join(ROOT, 'tests', 'fixtures', 'sample_part_context.json'));
  const reviewFixture = readJson(join(FIXTURE_DIR, 'sample_review_pack.canonical.json'));
  const analysisSourceRefs = [
    { artifact_type: 'engineering_context', path: 'tests/fixtures/sample_part_context.json', role: 'input', label: 'Input context JSON' },
    { artifact_type: 'cad_model', path: 'tests/fixtures/sample_part.step', role: 'input', label: 'Input model' },
  ];
  const qualitySourceRefs = [
    { artifact_type: 'engineering_context', path: 'tests/fixtures/sample_part_context.json', role: 'input', label: 'Input context JSON' },
    { artifact_type: 'geometry_intelligence', path: 'tmp/canonical/sample_geometry.json', role: 'input', label: 'Input geometry JSON' },
    { artifact_type: 'manufacturing_hotspots', path: 'tmp/canonical/sample_geometry_manufacturing_hotspots.json', role: 'input', label: 'Input hotspots JSON' },
  ];
  const reviewSourceRefs = [
    ...qualitySourceRefs,
    { artifact_type: 'inspection_linkage', path: 'tmp/canonical/sample_priorities_inspection_linkage.json', role: 'intermediate', label: 'Inspection linkage JSON' },
    { artifact_type: 'inspection_outliers', path: 'tmp/canonical/sample_priorities_inspection_outliers.json', role: 'intermediate', label: 'Inspection outliers JSON' },
    { artifact_type: 'quality_linkage', path: 'tmp/canonical/sample_priorities_quality_linkage.json', role: 'intermediate', label: 'Quality linkage JSON' },
    { artifact_type: 'quality_hotspots', path: 'tmp/canonical/sample_priorities_quality_hotspots.json', role: 'intermediate', label: 'Quality hotspots JSON' },
    { artifact_type: 'review_priorities', path: 'tmp/canonical/sample_priorities.json', role: 'input', label: 'Review priorities JSON' },
  ];

  const analysis = runPython('scripts/analyze_part.py', {
    context,
    generated_at: generatedAt,
    source_artifact_refs: analysisSourceRefs,
  });
  assertArtifact('geometry_intelligence', analysis.geometry_intelligence);
  assertArtifact('manufacturing_hotspots', analysis.manufacturing_hotspots);

  const linkage = runPython('scripts/quality_link.py', {
    context,
    geometry_intelligence: analysis.geometry_intelligence,
    manufacturing_hotspots: analysis.manufacturing_hotspots,
    generated_at: generatedAt,
    source_artifact_refs: qualitySourceRefs,
  });
  assertArtifact('inspection_linkage', linkage.inspection_linkage);
  assertArtifact('quality_linkage', linkage.quality_linkage);
  assertArtifact('review_priorities', linkage.review_priorities);

  const review = runPython('scripts/reporting/review_pack.py', {
    context,
    geometry_intelligence: analysis.geometry_intelligence,
    manufacturing_hotspots: analysis.manufacturing_hotspots,
    inspection_linkage: linkage.inspection_linkage,
    inspection_outliers: linkage.inspection_outliers,
    quality_linkage: linkage.quality_linkage,
    quality_hotspots: linkage.quality_hotspots,
    review_priorities: linkage.review_priorities,
    generated_at: generatedAt,
    source_artifact_refs: reviewSourceRefs,
    output_dir: TMP_DIR,
    output_stem: 'sample_part',
  });
  assertArtifact('review_pack', review.summary);
  assert.deepEqual(review.summary, reviewFixture, 'review_pack contract fixture drifted');

  const comparisonPath = join(TMP_DIR, 'sample_comparison.json');
  const compareRun = runCli([
    'compare-rev',
    review.artifacts.json,
    review.artifacts.json,
    '--out',
    comparisonPath,
  ]);
  assert.equal(compareRun.status, 0, compareRun.stderr || compareRun.stdout);
  const comparison = readJson(comparisonPath);
  assertArtifact('revision_comparison', comparison);

  const invalidGeometryPath = join(TMP_DIR, 'invalid_geometry.json');
  writeFileSync(invalidGeometryPath, JSON.stringify({
    artifact_type: 'geometry_intelligence',
    schema_version: '1.0',
    analysis_version: 'd1',
    generated_at: generatedAt,
    part_id: 'BRKT-100',
    revision: 'A',
    warnings: [],
    coverage: { source_artifact_count: 0, source_file_count: 0 },
    confidence: { level: 'heuristic', score: 0.1, rationale: 'Broken test fixture' },
    source_artifact_refs: [],
    part: { part_id: 'BRKT-100', name: 'sample_part', description: null, revision: 'A', material: null, process: null },
    geometry_source: { path: null, file_type: null },
    metrics: {},
    features: { hole_like_feature_count: 0, hole_pattern_count: 0, complexity_score: 0 },
    analysis_confidence: 'heuristic',
  }, null, 2), 'utf8');

  const invalidReviewRun = runCli([
    'review-pack',
    '--context',
    'tests/fixtures/sample_part_context.json',
    '--geometry',
    invalidGeometryPath,
    '--out',
    join(TMP_DIR, 'invalid_review.json'),
  ]);
  assert.notEqual(invalidReviewRun.status, 0, 'invalid geometry should fail canonical review_pack validation');
  assert.match(invalidReviewRun.stderr || invalidReviewRun.stdout, /Schema validation failed for review_pack/);
  assert.match(invalidReviewRun.stderr || invalidReviewRun.stdout, /geometry_summary/);

  console.log('d-artifact-schema.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}
