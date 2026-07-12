import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getCommandManifest, renderCliAllUsage, renderCliUsage } from '../src/shared/command-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const readme = read('README.md');
const workflows = read('docs/product-workflows.md');
const lifecycleDoc = read('docs/command-lifecycle.md');
const support = read('docs/support-matrix.md');
const manifest = getCommandManifest();

assert.equal(new Set(manifest.map((entry) => entry.name)).size, manifest.length, 'command names must be unique');
assert(manifest.every((entry) => typeof entry.lifecycle === 'string'), 'every command must have one lifecycle');
assert.deepEqual(manifest.filter((entry) => entry.defaultHelpVisible).map((entry) => entry.name), [
  'check-runtime', 'create', 'draw', 'inspect', 'readiness-pack', 'pack', 'inspection-plan',
  'inspection-plan-release-record', 'inspection-result-normalize', 'review-context', 'compare-rev', 'serve',
]);

const defaultHelp = renderCliUsage();
const allHelp = renderCliAllUsage();
assert.equal((defaultHelp.match(/^    fcad /gm) || []).length, 12, 'default help must show exactly 12 command rows');
for (const command of manifest) {
  assert.match(allHelp, new RegExp(`fcad ${command.name.replaceAll('-', '\\-')}`), `${command.name} must remain discoverable`);
}

for (const phrase of [
  'Create or import and review a design',
  'Compare revisions and plan inspection',
  'Receive and normalize completed inspection results',
]) {
  assert.match(readme, new RegExp(phrase, 'i'));
  assert.match(workflows, new RegExp(phrase.replace(' a design', ''), 'i'));
}

assert.match(readme, /docs\/product-workflows\.md/);
assert.match(readme, /docs\/command-lifecycle\.md/);
assert.match(readme, /Plans, release records, blank templates, normalization reports[\s\S]*are not inspection evidence/i);
assert.match(workflows, /Raw result bytes remain CLI-only/);
assert.match(workflows, /ready_for_quarantine_review/);
assert.match(lifecycleDoc, /readiness-report --review-pack[\s\S]*remains compatible/);
assert.match(lifecycleDoc, /readiness-report <config\.toml\|json>[\s\S]*remains functional/);
assert.match(lifecycleDoc, /serve --legacy-viewer/);
assert.match(lifecycleDoc, /mfg-agent/);
assert.match(support, /Runtime support and command lifecycle are separate dimensions/);
assert.match(support, /Raw completed result files remain CLI-only/);
assert.match(support, /readiness-pack --review-pack/);

console.log('local-first-v1-product-surface.test.js: ok');
