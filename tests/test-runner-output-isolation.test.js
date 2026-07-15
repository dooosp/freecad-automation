import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  prepareTestRunnerOutputDirectory,
  resolveTestRunnerOutputDirectory,
} from './test-runner/shared.js';

const ROOT = resolve(import.meta.dirname, '..');
const runId = `preservation-${process.pid}`;
const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-test-runner-output-'));
const sharedOutputDir = join(tempRoot, 'output');
const ownedRoot = join(sharedOutputDir, 'test-runner');
const sentinelDir = join(sharedOutputDir, 'software-verification-audit');
const sentinelPath = join(sentinelDir, 'keep.txt');
const ownedOutputDir = resolveTestRunnerOutputDirectory({ root: tempRoot, runId });
const staleOwnedPath = join(ownedOutputDir, 'stale.txt');

assert.throws(
  () => resolveTestRunnerOutputDirectory({ root: ROOT, runId: '../unsafe' }),
  /safe path component/,
  'run identifiers must not escape the test-runner-owned output root',
);
assert.throws(
  () => prepareTestRunnerOutputDirectory(sharedOutputDir, { ownedRoot }),
  /Refusing to clean non-owned test output directory/,
  'cleanup must reject the shared output root',
);

mkdirSync(sentinelDir, { recursive: true });
writeFileSync(sentinelPath, 'must survive test-runner startup\n', 'utf8');
mkdirSync(ownedOutputDir, { recursive: true });
writeFileSync(staleOwnedPath, 'owned stale output\n', 'utf8');

try {
  prepareTestRunnerOutputDirectory(ownedOutputDir, { ownedRoot });

  assert.equal(existsSync(sentinelPath), true, 'test runner cleanup must preserve unrelated existing output');
  assert.equal(existsSync(staleOwnedPath), false, 'test runner cleanup may remove its own stale run output');
  assert.equal(existsSync(ownedOutputDir), true, 'test runner cleanup must recreate its owned run directory');

  const mainSource = readFileSync(join(ROOT, 'tests/test-runner/main.js'), 'utf8');
  assert.match(
    mainSource,
    /prepareTestRunnerOutputDirectory\(\)/,
    'integration runner startup must use the guarded cleanup helper',
  );
  assert.doesNotMatch(
    mainSource,
    /rmSync\(OUTPUT_DIR/,
    'integration runner startup must not delete OUTPUT_DIR directly',
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('test-runner-output-isolation.test.js: ok');
