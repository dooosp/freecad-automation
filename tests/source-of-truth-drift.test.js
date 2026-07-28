import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONDITIONAL_COMMANDS,
  DIAGNOSTIC_COMMANDS,
  FREECAD_BACKED_COMMANDS,
  JOB_EXECUTOR_COMMANDS,
  LOCAL_API_CONFIG_JOB_COMMANDS,
  LOCAL_API_JOB_COMMANDS,
  LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS,
  LOCAL_API_SERVER_PROFILE_JOB_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS,
  STUDIO_ARTIFACT_JOB_COMMANDS,
  STUDIO_JOB_COMMANDS,
  STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS,
} from '../src/shared/command-manifest.js';
import { validateLocalApiJobRequest } from '../src/server/local-api-schemas.js';
import { validateStudioJobSubmission } from '../src/server/studio-job-bridge.js';
import { validateJobRequest } from '../src/services/jobs/job-executor.js';
import {
  STUDIO_JOB_CONTEXT_ROUTES,
  STUDIO_SURFACE_ROUTES,
  getStudioSurfaceMetadata,
} from '../public/js/studio/studio-surfaces.js';
import {
  workspaceDefinitions,
  workspaceOrder,
} from '../public/js/studio/workspaces.js';
import enLocale from '../public/js/i18n/en.js';
import koLocale from '../public/js/i18n/ko.js';
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
const inspectionEvidenceContract = readText('docs/inspection-evidence-contract.md');
const studioFirstUserWalkthrough = readText('docs/studio-first-user-walkthrough.md');
const outputManifest = readText('docs/output-manifest.md');
const ciGovernance = readText('docs/ci-governance.md');
const releaseChecklist = readText('docs/releases/v1.1.0-checklist.md');
const studioCanonicalPackageApi = readText('docs/studio-canonical-package-api.md');
const ciDiagnosticsScript = readText('.github/scripts/ci-diagnostics.sh');
const gitignore = readText('.gitignore');
const hostedWorkflow = readText('.github/workflows/automation-ci.yml');
const runtimeWorkflow = readText('.github/workflows/freecad-runtime-smoke.yml');
const maintainerDoctorsWorkflow = readText('.github/workflows/maintainer-doctors.yml');
const studioHtml = readText('public/studio.html');
const QIF_LITE_BOUNDARY_PARAGRAPH = 'QIF-lite import is a narrow discovery adapter for inspection-shaped XML supplied by a real physical, supplier, lab, or QA source. It is not a complete QIF implementation and does not make XML attachment-ready; production onboarding v1 deliberately accepts only the bounded JSON and CSV containers described below.';
const EVIDENCE_GRAPH_BOUNDARY_PARAGRAPH = 'The evidence graph is a read-only review artifact. It links package, review, generated quality, inspection, and readiness artifacts, but it does not attach evidence, regenerate readiness, or mutate canonical package files.';
const RUNTIME_FINGERPRINT_BOUNDARY_PARAGRAPH = 'The runtime fingerprint records local execution context and FreeCAD/runtime capability. It is reproducibility evidence only; it is not physical inspection evidence and does not clear production readiness.';

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

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function artifactRef(jobId = 'job-1', artifactId = 'artifact-1') {
  return {
    job_id: jobId,
    artifact_id: artifactId,
  };
}

function minimalLocalApiJobRequest(command) {
  if (command === 'inspect') {
    return { type: command, file_path: 'tests/fixtures/sample_part.step' };
  }
  if (LOCAL_API_CONFIG_JOB_COMMANDS.includes(command)) {
    return { type: command, config: { name: 'drift_guard_part' } };
  }
  if (LOCAL_API_SERVER_PROFILE_JOB_COMMANDS.includes(command)) {
    return { type: command, demo_profile: 'hinge-block-synthetic-inspection-v1' };
  }
  if (command === 'review-context') {
    return { type: command, model_path: 'tests/fixtures/sample_part.step' };
  }
  if (command === 'compare-rev' || command === 'stabilization-review') {
    return { type: command, baseline_path: 'output/baseline.json', candidate_path: 'output/candidate.json' };
  }
  if (command === 'readiness-pack') {
    return { type: command, review_pack_path: 'output/review_pack.json' };
  }
  if (command === 'evidence-graph') {
    return {
      type: command,
      package_id: 'quality-pass-bracket',
      review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
      readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    };
  }
  if (command === 'generate-standard-docs') {
    return { type: command, config_path: 'configs/examples/quality_pass_bracket.toml', readiness_report_path: 'output/readiness_report.json' };
  }
  if (command === 'inspection-plan') {
    return { type: command, review_pack_path: 'output/review_pack.json', scope: 'full' };
  }
  if (command === 'pack') {
    return { type: command, readiness_report_path: 'output/readiness_report.json' };
  }
  if (command === 'evidence-readiness-audit') {
    return { type: command, options: { package_slugs: ['quality-pass-bracket'] } };
  }
  if (command === 'inspection-evidence-intake') {
    return { type: command, options: { include_github: false, package_slugs: ['quality-pass-bracket'] } };
  }
  if (command === 'inspection-evidence-promotion-dry-run') {
    return { type: command, intake_report_path: 'output/intake_report.json' };
  }
  if (command === 'stage5b-evidence-audit') {
    return { type: command, options: { include_github: false } };
  }
  throw new Error(`No local API drift request fixture for ${command}`);
}

function minimalStudioSubmission(command) {
  if (command === 'manufacturing-action-dataset') {
    return { type: command, demo_profile: 'hinge-block-synthetic-inspection-v1' };
  }
  if (['create', 'draw'].includes(command)) {
    return { type: command, config_toml: 'name = "drift_guard_part"\n' };
  }
  if (command === 'report') {
    return { type: command, config_toml: 'name = "drift_guard_part"\n' };
  }
  if (command === 'review-context') {
    return { type: command, model_path: 'tests/fixtures/sample_part.step' };
  }
  if (command === 'evidence-readiness-audit') {
    return { type: command, options: { package_slugs: ['quality-pass-bracket'] } };
  }
  if (command === 'inspection-evidence-intake') {
    return { type: command, options: { include_github: false, package_slugs: ['quality-pass-bracket'] } };
  }
  if (command === 'inspection-evidence-promotion-dry-run') {
    return { type: command, intake_report_path: 'output/intake_report.json' };
  }
  if (command === 'stage5b-evidence-audit') {
    return { type: command, options: { include_github: false } };
  }
  if (command === 'evidence-graph') {
    return {
      type: command,
      package_id: 'quality-pass-bracket',
      review_pack_path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
      readiness_report_path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    };
  }
  if (STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS.includes(command)) {
    return {
      type: command,
      baseline_artifact_ref: artifactRef('job-baseline', 'artifact-baseline'),
      candidate_artifact_ref: artifactRef('job-candidate', 'artifact-candidate'),
    };
  }
  if (STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS.includes(command)) {
    return { type: command, artifact_ref: artifactRef() };
  }
  throw new Error(`No Studio drift request fixture for ${command}`);
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
const studioSurfaceMetadata = getStudioSurfaceMetadata();

assert.deepEqual(STUDIO_SURFACE_ROUTES, ['start', 'history', 'artifacts', 'console', 'model', 'drawing', 'review']);
assert.deepEqual(STUDIO_JOB_CONTEXT_ROUTES, ['artifacts', 'review']);
assert.deepEqual(workspaceOrder, STUDIO_SURFACE_ROUTES, 'Studio workspace order should come from shared surface metadata');
assertSameCommands(
  Object.keys(workspaceDefinitions),
  STUDIO_SURFACE_ROUTES,
  'Studio workspace definitions should cover the shared surface metadata'
);
studioSurfaceMetadata.forEach((surface) => {
  assert.equal(workspaceDefinitions[surface.route].label, surface.label, `${surface.route} label should match surface metadata`);
  assert.equal(workspaceDefinitions[surface.route].summary, surface.summary, `${surface.route} summary should match surface metadata`);
  assert.equal(enLocale.messages[surface.labelI18nKey], surface.label, `${surface.route} English label should match surface metadata`);
  assert.equal(enLocale.messages[surface.summaryI18nKey], surface.summary, `${surface.route} English summary should match surface metadata`);
  assert.equal(typeof koLocale.messages[surface.labelI18nKey], 'string', `${surface.route} Korean label key should exist`);
  assert.equal(typeof koLocale.messages[surface.summaryI18nKey], 'string', `${surface.route} Korean summary key should exist`);
});

const studioNavRoutes = [...studioHtml.matchAll(/<a\s+class="[^"]*\bnav-link\b[^"]*"[^>]*href="#([^"]+)"[^>]*data-route="([^"]+)"/g)]
  .map((match) => ({ hrefRoute: match[1], route: match[2] }));
assert.deepEqual(
  studioNavRoutes.map((entry) => entry.route),
  STUDIO_SURFACE_ROUTES,
  'Studio HTML nav routes should match shared surface metadata'
);
studioNavRoutes.forEach((entry) => {
  assert.equal(entry.hrefRoute, entry.route, `Studio nav href should match route ${entry.route}`);
});

assertSameCommands(LOCAL_API_JOB_COMMANDS, JOB_EXECUTOR_COMMANDS, 'local API and job executor command lists should match');
assertSameCommands(
  LOCAL_API_JOB_COMMANDS,
  [
    ...LOCAL_API_CONFIG_JOB_COMMANDS,
    ...LOCAL_API_SERVER_PROFILE_JOB_COMMANDS,
    ...LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS,
    'inspect',
  ],
  'local API schema command partitions should cover every local API job command'
);
LOCAL_API_JOB_COMMANDS.forEach((command) => {
  const request = minimalLocalApiJobRequest(command);
  const schemaResult = validateLocalApiJobRequest(request);
  assert.equal(schemaResult.ok, true, `${command} should be accepted by the local API job schema: ${schemaResult.errors.join(' | ')}`);
  const executorResult = validateJobRequest(request);
  assert.equal(executorResult.ok, true, `${command} should be accepted by the job executor validator: ${executorResult.errors.join(' | ')}`);
});

const studioSubmissionCommands = Object.freeze([...STUDIO_JOB_COMMANDS, 'review-context']);
assertSameCommands(
  studioSubmissionCommands,
  [
    ...STUDIO_ARTIFACT_JOB_COMMANDS,
    ...STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS,
    'create',
    'draw',
    'inspect',
    'report',
    'review-context',
    'evidence-graph',
    'evidence-readiness-audit',
    'inspection-evidence-intake',
    'inspection-evidence-promotion-dry-run',
    'manufacturing-action-dataset',
    'stage5b-evidence-audit',
  ],
  'Studio submission partitions should cover every Studio job command'
);
studioSubmissionCommands.forEach((command) => {
  const result = validateStudioJobSubmission(minimalStudioSubmission(command));
  assert.equal(result.ok, true, `${command} should be accepted by Studio job submission validation: ${result.errors.join(' | ')}`);
});

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

assert.match(
  readme,
  /fcad check-runtime --fingerprint-out <runtime_fingerprint\.json>/,
  'README should document the runtime fingerprint command surface'
);
assert.match(
  supportMatrix,
  /### Runtime fingerprint/,
  'support matrix should name the runtime fingerprint boundary'
);
assert.match(
  supportMatrix,
  /fcad check-runtime --fingerprint-out <runtime_fingerprint\.json>/,
  'support matrix should document the runtime fingerprint command surface'
);

const differentiationRoadmapDocs = [
  readme,
  inspectionEvidenceContract,
  studioFirstUserWalkthrough,
  outputManifest,
  supportMatrix,
].join('\n\n');
const normalizedDifferentiationRoadmapDocs = differentiationRoadmapDocs.replace(/\s+/g, ' ').trim();
[
  [QIF_LITE_BOUNDARY_PARAGRAPH, 'QIF-lite boundary paragraph'],
  [EVIDENCE_GRAPH_BOUNDARY_PARAGRAPH, 'evidence graph boundary paragraph'],
  [RUNTIME_FINGERPRINT_BOUNDARY_PARAGRAPH, 'runtime fingerprint boundary paragraph'],
].forEach(([paragraph, label]) => {
  assert.equal(
    countOccurrences(normalizedDifferentiationRoadmapDocs, paragraph),
    1,
    `${label} should appear exactly once across the roadmap docs`
  );
});

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
assert.match(ciGovernance, /PR #167 merged at `be93a51808080f951fc155f1fab36c10f13e7f52`/);
assert.match(ciGovernance, /27062840652/);
assert.match(ciGovernance, /27062881118/);
assert.match(ciGovernance, /27078229830/);
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

assert.match(maintainerDoctorsWorkflow, /^name: Maintainer Doctors \(hosted schedule\)$/m);
assert.match(maintainerDoctorsWorkflow, /^\s+workflow_dispatch:\s*$/m);
assert.match(maintainerDoctorsWorkflow, /^\s+schedule:\s*\n\s+- cron: "0 8 \* \* 1"/m);
assert.match(maintainerDoctorsWorkflow, /runs-on: ubuntu-24\.04/);
assert.equal(maintainerDoctorsWorkflow.includes('self-hosted'), false);
[
  'npm ci',
  'npm run check:source-hygiene',
  'node tests/source-of-truth-drift.test.js',
  'npm run bootstrap:doctor -- --clean',
  'npm run maintainer:doctor -- --clean',
  'npm run release:dry-run:doctor -- --clean',
  'npm run test:stage5b:pipeline-doctor',
].forEach((command) => {
  assert(maintainerDoctorsWorkflow.includes(command), `maintainer doctors workflow should run ${command}`);
});
[
  'Maintainer Doctors (hosted schedule)',
  'workflow_dispatch',
  'weekly schedule',
  'governance and maintenance only',
  'not release approval',
  'not production observation',
  'not evidence attachment',
  'not readiness proof',
  'does not upload doctor reports as CI artifacts',
].forEach((needle) => {
  assert(ciGovernance.includes(needle), `CI governance should document maintainer doctors boundary: ${needle}`);
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
