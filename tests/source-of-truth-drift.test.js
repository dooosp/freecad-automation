import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const ciGovernance = readText('docs/ci-governance.md');
const releaseChecklist = readText('docs/releases/v1.1.0-checklist.md');
const studioCanonicalPackageApi = readText('docs/studio-canonical-package-api.md');
const ciDiagnosticsScript = readText('.github/scripts/ci-diagnostics.sh');
const gitignore = readText('.gitignore');
const hostedWorkflow = readText('.github/workflows/automation-ci.yml');
const runtimeWorkflow = readText('.github/workflows/freecad-runtime-smoke.yml');

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
assert.equal(packageJson.scripts['bootstrap:doctor'], 'node scripts/bootstrap-doctor.js');
assert.equal(packageJson.scripts['release:dry-run:doctor'], 'node scripts/release-dry-run-doctor.js');
assert.equal(packageJson.scripts['maintainer:doctor'], 'node scripts/maintainer-doctor.js');
assert.equal(packageJson.scripts['test:snapshots:update'], 'node scripts/run-snapshot-update.js');

[
  'output/',
  '.ci/',
  'tmp/codex/',
  'local/stage5b-candidate-evidence-inbox/',
].forEach((ignoredPath) => {
  assert.match(gitignore, new RegExp(`^${ignoredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `.gitignore should ignore ${ignoredPath}`);
});

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
assert.match(readme, /docs\/ci-governance\.md/);
assert.match(testingDoc, /\[CI governance\]\(\.\/ci-governance\.md\)/);
assert.match(ciGovernance, /^# CI governance and maintainer checklist/m);
assert.match(ciGovernance, /Branch not protected/);
assert.match(ciGovernance, /Stage 5B and CI governance are closed through PR #162/);
assert.match(ciGovernance, /release dry-run\s+governance is closed through PR #163/i);
assert.match(ciGovernance, /maintainer doctor is closed through PR\s+#164/i);
assert.match(ciGovernance, /bootstrap doctor is closed through PR #165/i);
assert.match(ciGovernance, /735e991d40d33b69987a4ddd52db810791e968d3/);
assert.match(ciGovernance, /27058839538/);
assert.match(ciGovernance, /27058885140/);
hostedSuite.members.forEach((scriptName) => {
  assert(
    readmeTesting.includes(scriptName) || readme.includes(scriptName) || testingDoc.includes(scriptName),
    `hosted lane member ${scriptName} should be documented in README or docs/testing.md`
  );
});
assert(
  readme.includes('check:source-hygiene') && testingDoc.includes('check:source-hygiene') && ciGovernance.includes('npm run check:source-hygiene'),
  'source hygiene should be documented as a hosted and local maintainer check'
);
[
  readme,
  testingDoc,
  ciGovernance,
  readText('docs/final-maintainer-handoff.md'),
].forEach((text) => {
  assert(text.includes('npm run maintainer:doctor'), 'top-level maintainer doctor should be documented');
  assert.match(text, /output\/maintainer-doctor|maintainer_doctor_report\.json/);
  assert.match(text, /Stage 5B|release dry-run|source hygiene|node contract|source-of-truth/i);
});
[
  readme,
  testingDoc,
  ciGovernance,
  readText('docs/final-maintainer-handoff.md'),
].forEach((text) => {
  assert(text.includes('npm run bootstrap:doctor'), 'fresh-clone bootstrap doctor should be documented');
  assert.match(text, /output\/bootstrap-doctor|bootstrap_doctor_report\.json/);
  assert.match(text, /npm ci|local CLI help|docs\/local-state|sensitive-data leakage/i);
  assert.match(text, /no publish|does not publish|must not publish|publish, tag, upload|no tag/i);
});
[
  readme,
  ciGovernance,
  releaseChecklist,
].forEach((text) => {
  assert(text.includes('npm run release:dry-run:doctor'), 'release dry-run doctor should be documented');
  assert.match(text, /no publish|no tag|must not create tags|does not create tags|do not create tags|artifact upload|attach evidence|regenerate canonical readiness/i);
});
assert.match(releaseChecklist, /Release Bundle Dry-Run/);
assert.match(releaseChecklist, /Human Publication Steps/);
assert.doesNotMatch(releaseChecklist, /integration\/v1\.1-release-candidate/);
assert.match(releaseChecklist, /release_bundle_manifest\.json/);
assert.match(releaseChecklist, /release_bundle_checksums\.sha256/);
assert.match(releaseChecklist, /release_bundle_log\.json/);
assert.match(releaseChecklist, /release_bundle_artifact-manifest\.json/);
assert.match(releaseChecklist, /must not be committed, uploaded as evidence, or attached to a\s+GitHub release by automation/);
assert.match(studioCanonicalPackageApi, /does not add a preview, download, or open route/);
assert.match(studioCanonicalPackageApi, /release_bundle_log\.json` remains checked-in package provenance but is not a canonical package preview key today/);
assert.doesNotMatch(
  readmeTesting,
  /npm test.*tests\/test-runner\.js|tests\/test-runner\.js.*npm test/s,
  'README should not describe npm test as the runtime-domain test-runner shim'
);

const runtimeSmokeLane = getTestSuite('hosted') && testingDoc.includes('FreeCAD Runtime Smoke (self-hosted macOS)');
assert.equal(runtimeSmokeLane, true, 'docs/testing.md should name the self-hosted runtime smoke workflow');

assert.match(hostedWorkflow, /^name: Automation CI \(hosted fast lanes\)$/m);
assert.match(hostedWorkflow, /^\s+pull_request:\s*$/m);
assert.match(hostedWorkflow, /^\s+workflow_dispatch:\s*$/m);
assert.match(hostedWorkflow, /^\s+push:\s*\n\s+branches: \[master\]/m);
[
  ['Source hygiene guard', 'npm run check:source-hygiene'],
  ['Node contract lane (ubuntu-24.04)', 'npm run test:node:contract'],
  ['Node contract lane (macos-14)', 'npm run test:node:contract'],
  ['Node integration lane', 'npm run test:node:integration'],
  ['Snapshot lane', 'npm run test:snapshots'],
  ['Studio browser smoke lane', 'npm run test:studio-browser-smoke'],
  ['Python lane', 'npm run test:py'],
].forEach(([checkName, command]) => {
  assert(ciGovernance.includes(checkName), `CI governance should document hosted check ${checkName}`);
  assert(ciGovernance.includes(command), `CI governance should document hosted command ${command}`);
});

assert.match(runtimeWorkflow, /^name: FreeCAD Runtime Smoke \(self-hosted macOS\)$/m);
assert.match(runtimeWorkflow, /workflow_run:\s*\n\s*workflows:\s*\["Automation CI \(hosted fast lanes\)"\]\s*\n\s*types:\s*\[completed\]/);
assert.match(runtimeWorkflow, /^\s+workflow_dispatch:\s*$/m);
assert.match(runtimeWorkflow, /^\s+schedule:\s*\n\s+- cron: "0 3 \* \* 1"/m);
assert(runtimeWorkflow.includes('runs-on: [self-hosted, macOS, freecad, freecad-automation-runtime]'));
assert(runtimeWorkflow.includes('environment: freecad-runtime-smoke'));
assert(runtimeWorkflow.includes("github.event.workflow_run.head_repository.full_name == github.repository"));
assert(runtimeWorkflow.includes("github.event.workflow_run.actor.login == 'dooosp'"));
[
  'FreeCAD Runtime Smoke (self-hosted macOS)',
  'Self-hosted macOS FreeCAD smoke',
  '`freecad-automation-runtime`',
  '`freecad-runtime-smoke`',
  'workflow_run',
  'same-repository heads',
  'Forked PR code must not be checked out',
  'Post-merge expectation for `master`',
].forEach((needle) => {
  assert(ciGovernance.includes(needle), `CI governance should document runtime smoke boundary: ${needle}`);
});

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

assert.match(ciDiagnosticsScript, /artifact_class=ci_metadata_only/);
assert.match(ciDiagnosticsScript, /inspection_evidence_status=not_inspection_evidence/);
assert.match(ciDiagnosticsScript, /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/);

const diagnosticsRun = spawnSync('bash', ['.github/scripts/ci-diagnostics.sh'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: {
    ...process.env,
    FREECAD_BIN: '/private/tmp/freecad-secret/FreeCADCmd',
    FREECAD_APP: '/Applications/FreeCAD.app',
    RUNNER_NAME: 'private-mac-freecad-runner',
  },
});
assert.equal(diagnosticsRun.status, 0, diagnosticsRun.stderr || diagnosticsRun.stdout);
assert.match(diagnosticsRun.stdout, /artifact_class=ci_metadata_only/);
assert.match(diagnosticsRun.stdout, /inspection_evidence_status=not_inspection_evidence/);
assert.match(diagnosticsRun.stdout, /FREECAD_BIN=<path>\/FreeCADCmd/);
assert.match(diagnosticsRun.stdout, /FREECAD_APP=<path>\/FreeCAD\.app/);
assert.match(diagnosticsRun.stdout, /runner_name=<runner>/);
assert.equal(diagnosticsRun.stdout.includes('/private/tmp/freecad-secret'), false);
assert.equal(diagnosticsRun.stdout.includes('private-mac-freecad-runner'), false);

const snapshotUpdateNoConfirm = spawnSync(process.execPath, ['scripts/run-snapshot-update.js', '--dry-run'], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(snapshotUpdateNoConfirm.status, 2);
assert.match(snapshotUpdateNoConfirm.stderr, /without --confirm or CONFIRM_UPDATE_SNAPSHOTS=1/);

console.log('source-of-truth-drift.test.js: ok');
