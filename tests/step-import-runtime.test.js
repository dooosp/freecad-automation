import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runScript } from '../lib/runner.js';
import { createBootstrapImportService } from '../src/services/import/bootstrap-import-service.js';

const projectRoot = resolve(import.meta.dirname, '..');
const modelPath = resolve(projectRoot, 'docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step');
const result = await createBootstrapImportService()({ projectRoot, runScript, model: { path: modelPath } });
assert.equal(result.bootstrap.import_diagnostics.body_count, 1);
assert.ok(result.bootstrap.bootstrap_summary.feature_summary.cylinder_count >= 2);
assert.deepEqual(result.bootstrap.bootstrap_summary.dimensions_mm, { x: 160, y: 100, z: 8 });
assert.ok(result.bootstrap.geometry_intelligence.metrics.volume_mm3 > 0);
assert.doesNotMatch(JSON.stringify(result.bootstrap.bootstrap_warnings), /Feature detector failed|metadata-only fallback/);
console.log('step-import-runtime.test.js: ok (real FreeCAD STEP features and geometry handoff)');
