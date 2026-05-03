import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONDITIONAL_COMMANDS,
  DIAGNOSTIC_COMMANDS,
  FREECAD_BACKED_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
} from '../src/shared/command-manifest.js';
import {
  getExpectedPackageScripts,
  getTestSuite,
} from './lane-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const readText = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const packageJson = JSON.parse(readText('package.json'));
const readme = readText('README.md');
const testingDoc = readText('docs/testing.md');
const supportMatrix = readText('docs/support-matrix.md');

function extractSection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing section ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return nextHeading === -1
    ? markdown.slice(contentStart)
    : markdown.slice(contentStart, nextHeading);
}

function extractSubsection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing subsection ${heading}`);
  const contentStart = start + marker.length;
  const nextSubheading = markdown.indexOf('\n### ', contentStart);
  const nextMainHeading = markdown.indexOf('\n## ', contentStart);
  const stops = [nextSubheading, nextMainHeading].filter((index) => index !== -1);
  const end = stops.length ? Math.min(...stops) : markdown.length;
  return markdown.slice(contentStart, end);
}

function extractBulletedCommandNames(markdown) {
  return [...markdown.matchAll(/^- `([^`]+)`(?::)?/gm)].map((match) => match[1]);
}

function extractReadmeClassificationCommands(className) {
  const commandSurface = extractSection(readme, '## Command Surface');
  const rowPattern = new RegExp(`\\| ${className} \\| ([^|]+) \\|`);
  const match = commandSurface.match(rowPattern);
  assert(match, `README command classification table should include ${className}`);
  return [...match[1].matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
}

function assertSameCommands(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

Object.entries(getExpectedPackageScripts()).forEach(([scriptName, command]) => {
  assert.equal(packageJson.scripts[scriptName], command, `${scriptName} should match tests/lane-manifest.js`);
});

assert.equal(packageJson.scripts['smoke:runtime'], 'npm run test:runtime-smoke');
assert.equal(packageJson.scripts['check:runtime'], 'node scripts/check-runtime.js');

const expectedPlainPythonCommands = PLAIN_PYTHON_COMMANDS;
const expectedConditionalCommands = CONDITIONAL_COMMANDS.map((entry) => entry.name);

assertSameCommands(
  extractReadmeClassificationCommands('Diagnostics'),
  DIAGNOSTIC_COMMANDS,
  'README diagnostics command class should match src/shared/command-manifest.js'
);
assertSameCommands(
  extractReadmeClassificationCommands('FreeCAD-backed'),
  FREECAD_BACKED_COMMANDS,
  'README FreeCAD-backed command class should match src/shared/command-manifest.js'
);
assertSameCommands(
  extractReadmeClassificationCommands('Plain-Python / non-FreeCAD'),
  expectedPlainPythonCommands,
  'README plain-Python command class should match src/shared/command-manifest.js'
);
assertSameCommands(
  extractReadmeClassificationCommands('Mixed / conditional'),
  expectedConditionalCommands,
  'README mixed command class should match src/shared/command-manifest.js'
);

assertSameCommands(
  extractBulletedCommandNames(extractSubsection(supportMatrix, '### Requires FreeCAD')),
  FREECAD_BACKED_COMMANDS,
  'docs/support-matrix.md Requires FreeCAD list should match src/shared/command-manifest.js'
);
assertSameCommands(
  extractBulletedCommandNames(extractSubsection(supportMatrix, '### Runs Without Launching FreeCAD')),
  expectedPlainPythonCommands,
  'docs/support-matrix.md plain-Python list should match src/shared/command-manifest.js'
);
assertSameCommands(
  extractBulletedCommandNames(extractSubsection(supportMatrix, '### Mixed / Conditional')),
  expectedConditionalCommands,
  'docs/support-matrix.md mixed list should match src/shared/command-manifest.js'
);

const hostedSuite = getTestSuite('hosted');
assert(hostedSuite, 'hosted test suite should exist in tests/lane-manifest.js');

const readmeTesting = extractSection(readme, '## Testing');
assert.match(readmeTesting, /node scripts\/run-test-suite\.js default-node/);
hostedSuite.members.forEach((scriptName) => {
  assert(
    readmeTesting.includes(scriptName) || readme.includes(scriptName) || testingDoc.includes(scriptName),
    `hosted lane member ${scriptName} should be documented in README or docs/testing.md`
  );
});
assert.doesNotMatch(
  readmeTesting,
  /npm test.*tests\/test-runner\.js|tests\/test-runner\.js.*npm test/s,
  'README should not describe npm test as the runtime-domain test-runner shim'
);

const runtimeSmokeLane = getTestSuite('hosted') && testingDoc.includes('FreeCAD Runtime Smoke (self-hosted macOS)');
assert.equal(runtimeSmokeLane, true, 'docs/testing.md should name the self-hosted runtime smoke workflow');

const runtimeSmokeClaims = [
  readme,
  testingDoc,
  supportMatrix,
].join('\n');
[
  'check-runtime',
  'create',
  'draw --bom',
  'inspect',
  'fem',
  'tolerance --csv',
  'report',
].forEach((claim) => {
  assert(
    runtimeSmokeClaims.includes(claim),
    `runtime smoke docs should claim ${claim} consistently`
  );
});
assert.match(runtimeSmokeClaims, /hosted CI does not install or launch FreeCAD/i);

console.log('source-of-truth-drift.test.js: ok');
