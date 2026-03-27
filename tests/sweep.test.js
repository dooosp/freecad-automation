import assert from 'node:assert/strict';

import {
  applySweepOverrides,
  buildSweepCsv,
  buildSweepSummary,
  expandSweepVariants,
  normalizeSweepSpec,
  parseSweepPath,
} from '../lib/sweep.js';

const baseConfig = {
  name: 'sweep_probe',
  shapes: [
    { id: 'body', type: 'box', length: 100, width: 60, height: 8 },
    { id: 'hole', type: 'cylinder', radius: 4.5, height: 12, position: [30, 20, -2] },
  ],
  fem: {
    constraints: [
      { type: 'fixed', faces: ['Face1'] },
      { type: 'force', faces: ['Face2'], magnitude: 1000 },
    ],
  },
};

const normalized = normalizeSweepSpec({
  name: 'geometry_sweep',
  jobs: ['create', 'cost', 'fem'],
  parameters: {
    'shapes[0].height': { values: [6, 8, 10] },
    'fem.constraints[1].magnitude': { range: { start: 800, stop: 1200, step: 200 } },
  },
  objectives: {
    stress_threshold_mpa: 180,
  },
});

assert.equal(normalized.parameters.length, 2);
assert.deepEqual(normalized.parameters[0].values, [6, 8, 10]);
assert.deepEqual(normalized.parameters[1].values, [800, 1000, 1200]);
assert.equal(normalized.objectives.stress_threshold_mpa, 180);

assert.deepEqual(parseSweepPath('shapes[0].height'), ['shapes', 0, 'height']);

const overridden = applySweepOverrides(baseConfig, {
  'shapes[0].height': 10,
  'fem.constraints[1].magnitude': 1200,
});
assert.equal(baseConfig.shapes[0].height, 8, 'base config should not be mutated');
assert.equal(overridden.shapes[0].height, 10);
assert.equal(overridden.fem.constraints[1].magnitude, 1200);

assert.throws(
  () => applySweepOverrides(baseConfig, { 'shapes[0].type': 5 }),
  /must point to an existing numeric value/,
  'non-numeric leaves should be rejected'
);

assert.throws(
  () => normalizeSweepSpec({
    parameters: { 'shapes[0].height': { values: [6, 8] } },
    jobs: ['create', 7],
  }),
  /Sweep spec jobs\[1\] must be a non-empty string/,
  'jobs should reject non-string entries with a useful message'
);

assert.throws(
  () => normalizeSweepSpec({
    parameters: { 'shapes[0].height': { values: [6, 8] } },
    execution: { profile: true },
  }),
  /execution\.profile must be a string/,
  'execution profile should reject invalid nested types'
);

assert.throws(
  () => normalizeSweepSpec({
    parameters: { 'shapes[0].height': { values: [6, 8] } },
    execution: [],
  }),
  /Sweep spec execution must be an object/,
  'execution should reject non-object containers'
);

const variants = expandSweepVariants(baseConfig, normalized);
assert.equal(variants.length, 9);
assert.equal(variants[0].variant_id, 'variant-001');
assert.deepEqual(variants[0].overrides, {
  'shapes[0].height': 6,
  'fem.constraints[1].magnitude': 800,
});
assert.equal(variants.at(-1).config.fem.constraints[1].magnitude, 1200);

const summary = buildSweepSummary({
  name: normalized.name,
  baseConfigPath: '/tmp/base.toml',
  matrixPath: '/tmp/matrix.toml',
  outputDir: '/tmp/output',
  jobs: normalized.jobs,
  parameters: normalized.parameters,
  objectives: normalized.objectives,
  variants: [
    {
      variant_id: 'variant-001',
      success: true,
      overrides: { 'shapes[0].height': 6 },
      runtime_ms: { total: 101 },
      metrics: {
        estimated_mass_kg: 1.8,
        unit_cost: 1200,
        max_von_mises_mpa: 160,
        stress_threshold_pass: true,
      },
      artifacts: { report_pdf: '/tmp/output/variant-001/report.pdf' },
      errors: [],
    },
    {
      variant_id: 'variant-002',
      success: true,
      overrides: { 'shapes[0].height': 10 },
      runtime_ms: { total: 99 },
      metrics: {
        estimated_mass_kg: 2.1,
        unit_cost: 1100,
        max_von_mises_mpa: 220,
        stress_threshold_pass: false,
      },
      artifacts: { report_pdf: '/tmp/output/variant-002/report.pdf' },
      errors: [],
    },
    {
      variant_id: 'variant-003',
      success: false,
      overrides: { 'shapes[0].height': 12 },
      runtime_ms: { total: 40 },
      metrics: {},
      artifacts: {},
      errors: [{ job: 'fem', message: 'boom' }],
    },
  ],
});

assert.equal(summary.summary.successful_variants, 2);
assert.equal(summary.summary.failed_variants, 1);
assert.equal(summary.summary.best_by_min_mass.variant_id, 'variant-001');
assert.equal(summary.summary.best_by_min_cost.variant_id, 'variant-002');
assert.equal(summary.summary.stress_threshold.pass_count, 1);
assert.equal(summary.summary.stress_threshold.fail_count, 1);

const csv = buildSweepCsv(summary);
assert.match(csv, /variant_id,status,error_count,total_runtime_ms/);
assert.match(csv, /variant-001,ok,0,101/);
assert.match(csv, /variant-003,error,1,40/);
assert.match(csv, /report_pdf/);

console.log('sweep.test.js: ok');
