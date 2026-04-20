import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { createDfmService } from '../src/services/analysis/dfm-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const runDfm = createDfmService();

const result = await runDfm({
  freecadRoot: ROOT,
  config: {
    name: 'actionable_bracket',
    manufacturing: {
      process: 'machining',
    },
    shapes: [
      { id: 'disc', type: 'cylinder', radius: 100, height: 20, position: [0, 0, 0] },
      { id: 'hole1', type: 'cylinder', radius: 5, height: 25, position: [94.5, 0, -2] },
    ],
    operations: [
      { op: 'cut', base: 'disc', tool: 'hole1' },
    ],
  },
  process: 'machining',
});

assert.equal(Array.isArray(result.checks), true);
assert.equal(Array.isArray(result.issues), true);

const legacyCheck = result.checks.find((check) => check.code === 'DFM-01');
assert.ok(legacyCheck, 'expected legacy DFM-01 check');
assert.equal(legacyCheck.severity, 'error');
assert.equal(legacyCheck.rule_id, 'DFM-01');
assert.equal(legacyCheck.status, 'fail');
assert.equal(legacyCheck.suggested_fix.includes('Increase wall thickness by at least'), true);
assert.equal(typeof legacyCheck.actual_value, 'number');
assert.equal(typeof legacyCheck.required_value, 'number');
assert.equal(typeof legacyCheck.delta, 'number');

const issue = result.issues.find((entry) => entry.rule_id === 'DFM-01');
assert.ok(issue, 'expected actionable DFM-01 issue');
assert.equal(issue.rule_name, 'Minimum wall thickness');
assert.equal(issue.severity, 'critical');
assert.equal(issue.status, 'fail');
assert.equal(issue.part_name, 'actionable_bracket');
assert.equal(issue.feature_id, 'hole1');
assert.equal(issue.feature_type, 'hole');
assert.equal(issue.actual_unit, 'mm');
assert.equal(issue.required_unit, 'mm');
assert.equal(issue.delta < 0, true);
assert.equal(issue.process, 'machining');
assert.equal(issue.material, 'unknown');
assert.equal(typeof issue.manufacturability_impact, 'string');
assert.equal(issue.suggested_fix.includes('Increase wall thickness by at least'), true);
assert.equal(issue.confidence, 'high');
assert.equal(typeof issue.evidence, 'object');

assert.equal(result.summary.severity_counts.critical >= 1, true);
assert.equal(result.summary.severity_counts.minor >= 1, true);
assert.equal(Array.isArray(result.summary.top_fixes), true);
assert.equal(result.summary.top_fixes.length > 0, true);
assert.equal(result.summary.top_fixes[0].rule_id, 'DFM-01');
assert.equal(result.summary.score_impact.total_penalty >= 20, true);

console.log('dfm-actionable.test.js: ok');
