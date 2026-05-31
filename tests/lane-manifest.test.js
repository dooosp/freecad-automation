import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getExpectedPackageScripts,
  getLaneManifest,
  renderFastLocalCommandsMarkdown,
  renderLaneTableMarkdown,
  renderPythonLaneCommandsMarkdown,
  renderRuntimeDomainCommandsMarkdown,
  renderRuntimeSmokeCommandsMarkdown,
  renderWorkflowMappingMarkdown,
} from './lane-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const testingDoc = readFileSync(resolve(ROOT, 'docs', 'testing.md'), 'utf8');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const hostedWorkflow = readFileSync(resolve(ROOT, '.github', 'workflows', 'automation-ci.yml'), 'utf8');
const runtimeWorkflow = readFileSync(resolve(ROOT, '.github', 'workflows', 'freecad-runtime-smoke.yml'), 'utf8');

function extractGeneratedBlock(markdown, blockName) {
  const pattern = new RegExp(`<!-- GENERATED:${blockName}:start -->\\n([\\s\\S]*?)\\n<!-- GENERATED:${blockName}:end -->`);
  const match = markdown.match(pattern);
  assert(match, `Missing generated block ${blockName}`);
  return match[1].trim();
}

function extractMarkdownSection(markdown, heading) {
  const marker = `## ${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing README section ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return nextHeading === -1
    ? markdown.slice(contentStart)
    : markdown.slice(contentStart, nextHeading);
}

const expectedScripts = getExpectedPackageScripts();
Object.entries(expectedScripts).forEach(([scriptName, command]) => {
  assert.equal(packageJson.scripts[scriptName], command, `${scriptName} should stay aligned with the lane manifest`);
});

assert.equal(extractGeneratedBlock(testingDoc, 'lane-table'), renderLaneTableMarkdown());
assert.equal(extractGeneratedBlock(testingDoc, 'workflow-mapping'), renderWorkflowMappingMarkdown());
assert.equal(extractGeneratedBlock(testingDoc, 'fast-local'), renderFastLocalCommandsMarkdown());
assert.equal(extractGeneratedBlock(testingDoc, 'python-local'), renderPythonLaneCommandsMarkdown());
assert.equal(extractGeneratedBlock(testingDoc, 'runtime-smoke-local'), renderRuntimeSmokeCommandsMarkdown());
assert.equal(extractGeneratedBlock(testingDoc, 'runtime-domain-local'), renderRuntimeDomainCommandsMarkdown());

const readmeTestLanes = extractMarkdownSection(readme, 'Test Lanes');
getLaneManifest().forEach((lane) => {
  const command = `npm run ${lane.npmScript}`;
  assert(
    readmeTestLanes.includes(command),
    `README Test Lanes should mention ${command}`
  );
});

const contractLane = getLaneManifest().find((lane) => lane.id === 'contract');
assert(contractLane, 'contract lane should exist');
assert(
  contractLane.steps.some((step) => step.args.includes('tests/stage5b-evidence-audit-cli-smoke.test.js')),
  'contract lane should include the Stage 5B audit CLI smoke'
);
assert(
  contractLane.steps.some((step) => step.args.includes('tests/stage5b-artifact-catalog.test.js')),
  'contract lane should include the Stage 5B artifact/schema catalog guard'
);

[
  'npm run test:node:contract',
  'npm run test:node:integration',
  'npm run test:snapshots',
  'npm run test:py',
].forEach((command) => {
  assert(
    hostedWorkflow.includes(command),
    `hosted workflow should run ${command}`
  );
});
assert.equal(
  hostedWorkflow.includes('npm run test:runtime-smoke'),
  false,
  'hosted workflow should not claim or run the FreeCAD runtime smoke lane'
);

[
  'node bin/fcad.js check-runtime',
  'node bin/fcad.js check-runtime --json',
  'npm run test:runtime-smoke',
  'tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py',
  'output/smoke',
].forEach((command) => {
  assert(
    runtimeWorkflow.includes(command),
    `self-hosted runtime workflow should include ${command}`
  );
});

console.log('lane-manifest.test.js: ok');
