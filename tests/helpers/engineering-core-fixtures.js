import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';

// Literal oracles taken from source requirements, never from measured outputs.
export const FIXTURES = [
  { id: 'quality-pass-bracket', source: 'configs/examples/quality_pass_bracket.toml', holes: ['hole_left'], a: 6, b: 7, centers: [[30, 30]], requirement: 'HOLE_LEFT_DIA', planIntent: 'HOLE_LEFT_DIA' },
  { id: 'plate-with-holes', source: 'docs/examples/plate-with-holes/config.toml', holes: ['hole1', 'hole2', 'hole3', 'hole4'], a: 4, b: 5, centers: [[22, 22], [123, 22], [22, 76], [123, 76]], requirement: 'MOUNTING_HOLE_DIA', planIntent: 'HOLE_DIA' },
  { id: 'hinge-block', source: 'docs/examples/hinge-block/config.toml', holes: ['mount_hole_left', 'mount_hole_right'], a: 6, b: 7, centers: [[24, 14], [66, 14]], requirement: 'MOUNTING_HOLE_DIA', planIntent: 'MOUNTING_HOLE_DIA' },
];

export function prepareConfig(root, runId, fixture, source, revision) {
  assert(/^[a-zA-Z0-9_-]+$/.test(runId), 'safe isolated run ID required');
  assert(FIXTURES.includes(fixture), 'known literal fixture required');
  assert(['A', 'B'].includes(revision), 'A/B revision required');
  const config = structuredClone(source);
  const output = `output/engineering-core-refocus/${runId}/${fixture.id}/${revision}`;
  assert(resolve(root, output).startsWith(resolve(root, 'output/engineering-core-refocus') + sep));
  config.export = { ...config.export, directory: output };
  // Test identity is explicit; no synthetic revision is written back to packages.
  config.product = { ...config.product, package_slug: source.product?.package_slug || `test-${fixture.id}`, part_id: source.product?.part_id || source.name, revision };
  for (const [index, id] of fixture.holes.entries()) {
    const shape = config.shapes.find(s => s.id === id);
    assert.equal(shape?.radius * 2, fixture.a, `${id}: source oracle changed`);
    assert.deepEqual(shape.position.slice(0, 2), fixture.centers[index]);
    if (revision === 'B') shape.radius = fixture.b / 2;
  }
  const requirement = config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement);
  assert.equal(requirement?.value_mm, fixture.a);
  const intents = config.drawing_plan.dim_intents.filter(d => d.id === fixture.planIntent);
  assert(intents.length > 0);
  for (const intent of intents) assert.equal(intent.value_mm, fixture.a);
  if (revision === 'B') {
    requirement.value_mm = fixture.b;
    for (const intent of intents) {
      intent.value_mm = fixture.b;
      if (intent.reason) intent.reason = intent.reason.replace(`${fixture.a} mm diameter`, `${fixture.b} mm diameter`);
    }
    if (fixture.id === 'hinge-block') config.quality.critical_dimensions.find(d => d.id === 'cd-02').target_mm = 7;
    if (config.drawing.meta.drawing_no) config.drawing.meta.drawing_no = config.drawing.meta.drawing_no.replace(/-A$/, '-B');
  }
  return config;
}

export function revisionSide(config) {
  const { part_id, revision, package_slug } = config.product;
  return {
    config,
    reviewPack: {
      artifact_type: 'review_pack', revision, part_id,
      part: { part_id, revision, material: 'AL6061', process: 'machining', description: null },
      metadata: { package_slug }, geometry_features: { records: [] },
    },
  };
}
