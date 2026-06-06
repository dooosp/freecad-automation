import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflowPath = resolve(ROOT, '.github', 'workflows', 'maintainer-doctors.yml');

assert.equal(existsSync(workflowPath), true, 'maintainer doctors workflow should exist');

const workflow = readFileSync(workflowPath, 'utf8');
const ciGovernance = readFileSync(resolve(ROOT, 'docs', 'ci-governance.md'), 'utf8');
const finalHandoff = readFileSync(resolve(ROOT, 'docs', 'final-maintainer-handoff.md'), 'utf8');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertExcludes(text, needle, label) {
  assert.equal(text.includes(needle), false, `${label} should not include ${needle}`);
}

function actionSpecs(text) {
  return [...text.matchAll(/^\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s*$/gmi)].map((match) => ({
    action: match[1],
    ref: match[2],
  }));
}

assert.match(workflow, /^name: Maintainer Doctors \(hosted schedule\)$/m);
assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*\n\s+schedule:\s*\n\s+- cron: "0 8 \* \* 1"/m);
assertExcludes(workflow, 'pull_request:', 'maintainer doctors workflow');
assertExcludes(workflow, 'push:', 'maintainer doctors workflow');
assertExcludes(workflow, 'workflow_run:', 'maintainer doctors workflow');

assert.match(workflow, /^permissions:\s*\n\s+contents: read$/m);
[
  'contents: write',
  'pull-requests: write',
  'id-token: write',
  'secrets:',
  'environment:',
].forEach((needle) => assertExcludes(workflow, needle, 'maintainer doctors workflow'));

assert.match(workflow, /runs-on: ubuntu-24\.04/);
assertExcludes(workflow, 'self-hosted', 'maintainer doctors workflow');
assertExcludes(workflow, 'macOS', 'maintainer doctors workflow');
assert.match(workflow, /group: maintainer-doctors-\$\{\{ github\.ref \}\}/);
assert.match(workflow, /cancel-in-progress: true/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /node-version: "24"/);
assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"/);

[
  'npm ci',
  'npm run check:source-hygiene',
  'node tests/source-of-truth-drift.test.js',
  'npm run bootstrap:doctor -- --clean',
  'npm run maintainer:doctor -- --clean',
  'npm run release:dry-run:doctor -- --clean',
  'npm run test:stage5b:pipeline-doctor',
].forEach((command) => assertIncludes(workflow, command, 'maintainer doctors workflow'));

[
  'actions/upload-artifact',
  'gh release',
  'git tag',
  'git push --tags',
  'npm publish',
  'readiness-pack',
  'review-context --inspection-evidence',
  'gh workflow run',
].forEach((needle) => assertExcludes(workflow, needle, 'maintainer doctors workflow'));

const specs = actionSpecs(workflow);
assert.deepEqual(
  specs.map((entry) => entry.action),
  ['actions/checkout', 'actions/setup-node'],
  'maintainer doctors workflow should only use approved first-party actions'
);
specs.forEach((entry) => {
  assert.match(workflow, new RegExp(`#\\s*provenance: ${entry.action}@v\\d+ -> ${entry.ref}`));
});

[
  'Maintainer Doctors (hosted schedule)',
  'workflow_dispatch',
  'weekly schedule',
  'npm run bootstrap:doctor -- --clean',
  'npm run maintainer:doctor -- --clean',
  'npm run release:dry-run:doctor -- --clean',
  'npm run test:stage5b:pipeline-doctor',
  'governance and maintenance only',
  'not release approval',
  'not production observation',
  'not evidence attachment',
  'not readiness proof',
  'does not upload doctor reports as CI artifacts',
].forEach((needle) => assertIncludes(ciGovernance, needle, 'CI governance docs'));

[
  'Maintainer Doctors (hosted schedule)',
  'manual or weekly hosted governance check',
  'not release approval',
  'not production observation',
  'not evidence attachment',
  'not readiness proof',
].forEach((needle) => assertIncludes(finalHandoff, needle, 'final maintainer handoff'));

[
  'Maintainer Doctors (hosted schedule)',
  'manual/weekly governance check',
].forEach((needle) => assertIncludes(readme, needle, 'README'));

console.log('maintainer-doctors-workflow.test.js: ok');
