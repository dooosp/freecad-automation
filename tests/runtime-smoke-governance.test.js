import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  buildRuntimeSmokeBoundary,
  normalizeSmokeRunId,
  resolveSmokeOutputDir,
} from '../lib/runtime-smoke-governance.js';

const ROOT = resolve(import.meta.dirname, '..');

assert.equal(normalizeSmokeRunId('pr-130.abc_DEF-123'), 'pr-130.abc_DEF-123');
assert.equal(normalizeSmokeRunId('feature branch/slash'), 'feature-branch-slash');
assert.throws(() => normalizeSmokeRunId('.'), /unsafe smoke run id/i);
assert.throws(() => normalizeSmokeRunId('..'), /unsafe smoke run id/i);
assert.throws(() => normalizeSmokeRunId('../release'), /unsafe smoke run id/i);
assert.throws(() => normalizeSmokeRunId('////'), /unsafe smoke run id/i);

const outputDir = resolveSmokeOutputDir(ROOT, 'runtime-governance-test');
assert.equal(outputDir, resolve(ROOT, 'output', 'smoke', 'runtime-governance-test'));
assert.throws(
  () => resolveSmokeOutputDir(ROOT, '..'),
  /unsafe smoke run id/i
);

const boundary = buildRuntimeSmokeBoundary();
assert.equal(boundary.artifact_class, 'runtime_smoke_ci_metadata');
assert.equal(boundary.inspection_evidence_status, 'not_inspection_evidence');
assert.equal(boundary.readiness_effect, 'no_readiness_change');
assert.equal(boundary.release_artifact_status, 'not_release_artifact');
assert.equal(boundary.package_artifact_status, 'not_package_artifact');
assert.match(boundary.hard_evidence_rule, /Only genuine completed physical\/supplier\/lab\/QA inspection records/);

console.log('runtime-smoke-governance.test.js: ok');
