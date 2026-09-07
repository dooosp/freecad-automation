import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { FIXTURES, prepareConfig, revisionSide } from './helpers/engineering-core-fixtures.js';
import { buildRevisionImpactReport, loadRevisionImpactInputSet } from '../src/services/revision-impact/revision-impact-service.js';
import { canonicalizeRevisionImpactJson, renderRevisionImpactMarkdown } from '../lib/revision-impact-contract.js';
import { buildCreateQualityReport } from '../lib/create-quality.js';

const root = resolve(import.meta.dirname, '..');
const generatedAt = '2026-09-06T00:00:00Z';
for (const fixture of FIXTURES) {
  const source = parse(readFileSync(resolve(root, fixture.source), 'utf8'));
  const before = structuredClone(source);
  const a = prepareConfig(root, 'unit-oracles', fixture, source, 'A');
  const b = prepareConfig(root, 'unit-oracles', fixture, source, 'B');
  assert.deepEqual(source, before, 'source config must remain untouched');
  for (const [revision, config, diameter] of [['A', a, fixture.a], ['B', b, fixture.b]]) {
    assert.equal(config.product.revision, revision);
    assert.equal(config.export.directory, `output/engineering-core-refocus/unit-oracles/${fixture.id}/${revision}`);
    for (const id of fixture.holes) assert.equal(config.shapes.find(s => s.id === id).radius * 2, diameter);
    assert.equal(config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement).value_mm, diameter);
    assert(config.drawing_plan.dim_intents.filter(d => d.id === fixture.planIntent).every(d => d.value_mm === diameter));
  }
  if (fixture.id === 'hinge-block') {
    assert.equal(b.quality.critical_dimensions.find(d => d.id === 'cd-02').target_mm, 7);
    for (const id of ['hinge_pin_left', 'hinge_pin_right']) {
      assert.equal(b.shapes.find(s => s.id === id).radius, 4);
      assert.deepEqual(b.shapes.find(s => s.id === id).direction, [0, 1, 0]);
    }
  }
  const baseline = revisionSide(a);
  const candidate = revisionSide(b);
  const report = buildRevisionImpactReport({ baseline, candidate, generatedAt });
  assert.equal(report.summary.unable_to_determine_count, 0, 'A/B fixture identities must agree before negative injection');
  assert(report.changes.some(c => c.change_type === 'nominal_dimension_change' && c.affected_entity_id === fixture.requirement));
  for (const id of fixture.holes) assert(report.changes.some(c => c.change_type === 'geometry_feature_modified' && c.affected_entity_id === id && c.before_value.dimensions.radius === fixture.a / 2 && c.after_value.dimensions.radius === fixture.b / 2));
  const shuffled = structuredClone(candidate);
  shuffled.config.shapes.reverse();
  shuffled.config.drawing_intent.required_dimensions.reverse();
  shuffled.config.drawing_intent.critical_features.reverse();
  const repeated = buildRevisionImpactReport({ baseline, candidate: shuffled, generatedAt });
  // Reordering changes source hashes, but stable-ID decisions must not change.
  const semantic = r => r.changes.map(({ change_type, affected_entity_id, before_value, after_value, required_action, determinability }) => ({ change_type, affected_entity_id, before_value, after_value, required_action, determinability }));
  assert.deepEqual(semantic(report), semantic(repeated));
  const identical = buildRevisionImpactReport({ baseline, candidate, generatedAt });
  assert.equal(canonicalizeRevisionImpactJson(report), canonicalizeRevisionImpactJson(identical));
  assert.equal(renderRevisionImpactMarkdown(report), renderRevisionImpactMarkdown(identical));
  assert.equal(report.boundaries.inspection_evidence_attached, false);
  assert.equal(report.boundaries.canonical_artifacts_mutated, false);
  const missing = structuredClone(candidate);
  delete missing.config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement).id;
  assert(buildRevisionImpactReport({ baseline, candidate: missing, generatedAt }).summary.unable_to_determine_count > 0);
  const conflict = structuredClone(candidate);
  const dimension = conflict.config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement);
  delete dimension.value_mm;
  dimension.value = fixture.b;
  dimension.unit = 'cm';
  assert.equal(buildRevisionImpactReport({ baseline, candidate: conflict, generatedAt }).summary.decision, 'blocked_insufficient_identity_or_inputs');
}
assert.throws(() => prepareConfig(root, '../escape', FIXTURES[0], {}, 'A'));
assert.throws(() => prepareConfig(root, 'safe', FIXTURES[0], {}, '../escape'));

// Synthetic checksum contract only; this does not attach evidence to real packages.
const base = resolve(root, 'output/engineering-core-refocus');
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, 'stale-contract-'));
const metrics = { bounding_box_mm: { x: 0, y: 0, z: 0 }, volume_mm3: 0, face_count: 0, edge_count: 0 };
const features = { hole_like_feature_count: 0, hole_pattern_count: 0, complexity_score: 0, records: [] };
const review = {
  artifact_type: 'review_pack', schema_version: '1.0', analysis_version: 'synthetic-contract', generated_at: generatedAt,
  part_id: 'test-part', revision: 'B', warnings: ['Synthetic contract fixture; no CAD or inspection observations.'],
  coverage: {}, confidence: { level: 'low' }, source_artifact_refs: [], canonical_artifact: { json_is_source_of_truth: true },
  part: { part_id: 'test-part', name: 'test-part', revision: 'B' }, geometry_summary: metrics, geometry_features: features,
  geometry_hotspots: [], inspection_linkage: { summary: {}, records: [] }, inspection_anomalies: [], quality_linkage: { summary: {}, records: [] },
  quality_hotspots: [], review_priorities: [], recommended_actions: [],
  evidence_appendix: { geometry_metrics: metrics, geometry_feature_summary: features, source_files: [], warnings: [], inspection_record_count: 0, quality_issue_count: 0 },
  metadata: { synthetic: true, analysis_confidence: 'synthetic', artifact_provenance: { workflow: ['synthetic-contract-test'], source_files: [], context_created_at: null, warnings: [] }, available_sections: [] },
  evidence_ledger: { records: [] },
};
for (const type of ['create_quality_report', 'drawing_quality_report']) {
  const sidecarPath = join(dir, `${type}.json`);
  const reviewPath = join(dir, `${type}-review.json`);
  const make = revision => type === 'create_quality_report'
    ? { ...buildCreateQualityReport({ config: { name: `synthetic-${revision}` }, createResult: {}, runtimeAvailable: false }), input_config: `synthetic-${revision}.toml` }
    : { ...JSON.parse(readFileSync(resolve(root, 'tests/fixtures/drawing-semantics/quality_pass_bracket/expected_drawing_quality.json'), 'utf8')), revision, message: 'Synthetic checksum fixture only; no drawing executed.' };
  const bytesA = JSON.stringify(make('A'));
  const bytesB = JSON.stringify(make('B'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.notEqual(sha(bytesA), sha(bytesB));
  const ref = relative(root, sidecarPath).split('\\').join('/');
  const bound = structuredClone(review);
  bound.source_artifact_refs = [{ artifact_type: type, path: ref, role: 'evidence', label: 'Synthetic checksum fixture' }];
  bound.evidence_ledger.records = [{ artifact_type: type, source_ref: ref, sha256: sha(bytesB) }];
  writeFileSync(sidecarPath, bytesB);
  writeFileSync(reviewPath, JSON.stringify(bound));
  const load = () => loadRevisionImpactInputSet({ projectRoot: root, baselineReviewPackPath: reviewPath, candidateReviewPackPath: reviewPath });
  await load(); // Positive control: valid B binding before injecting A bytes.
  writeFileSync(sidecarPath, bytesA);
  await assert.rejects(load, error => error.code === 'declared_artifact_hash_mismatch');
}
console.log('Engineering core workflow: fixed A/B oracles, stable IDs, deterministic impact, missing IDs and unit conflict PASS (synthetic contract only)');
