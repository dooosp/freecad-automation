import assert from 'node:assert/strict';

import { normalizeFemResults } from '../src/services/report/report-service.js';

const normalized = normalizeFemResults({
  analysis_type: 'static',
  material: {
    name: 'Steel',
    youngs_modulus: 210000,
    yield_strength: 235,
  },
  mesh: {
    nodes: 1200,
    elements: 600,
    element_type: 'Tet10',
  },
  results: {
    displacement: { max: 0.0123, min: 0, max_node: 42 },
    von_mises: { max: 118.4, min: 0.2, max_node: 18 },
    safety_factor: 1.98,
    node_count: 600,
  },
});

assert.equal(normalized.displacement.max, 0.0123);
assert.equal(normalized.von_mises.max, 118.4);
assert.equal(normalized.safety_factor, 1.98);
assert.equal(normalized.yield_strength, 235);
assert.equal(normalized.solver, 'CalculiX');
assert.equal(normalized.analysis_type, 'static');

console.log('report-fem-normalization.test.js: ok');
