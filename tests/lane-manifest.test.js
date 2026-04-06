import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getExpectedPackageScripts,
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

function extractGeneratedBlock(markdown, blockName) {
  const pattern = new RegExp(`<!-- GENERATED:${blockName}:start -->\\n([\\s\\S]*?)\\n<!-- GENERATED:${blockName}:end -->`);
  const match = markdown.match(pattern);
  assert(match, `Missing generated block ${blockName}`);
  return match[1].trim();
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

console.log('lane-manifest.test.js: ok');
