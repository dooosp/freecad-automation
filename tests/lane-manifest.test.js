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
const runtimeGovernanceDoc = readFileSync(resolve(ROOT, 'docs', 'self-hosted-runtime-governance.md'), 'utf8');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const hostedWorkflow = readFileSync(resolve(ROOT, '.github', 'workflows', 'automation-ci.yml'), 'utf8');
const runtimeWorkflow = readFileSync(resolve(ROOT, '.github', 'workflows', 'freecad-runtime-smoke.yml'), 'utf8');
const workflowFiles = Object.freeze([
  Object.freeze({ path: '.github/workflows/automation-ci.yml', text: hostedWorkflow }),
  Object.freeze({ path: '.github/workflows/freecad-runtime-smoke.yml', text: runtimeWorkflow }),
]);
const approvedWorkflowActions = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/setup-python',
  'actions/upload-artifact',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectWorkflowUses() {
  const uses = [];
  workflowFiles.forEach((workflow) => {
    workflow.text.split(/\r?\n/).forEach((line, index, lines) => {
      const match = line.match(/^\s*uses:\s*['"]?([^'"\s#]+)['"]?/);
      if (!match) return;

      const spec = match[1];
      if (spec.startsWith('./')) return;

      const at = spec.lastIndexOf('@');
      const action = at === -1 ? spec : spec.slice(0, at);
      const ref = at === -1 ? '' : spec.slice(at + 1);
      const precedingContext = lines.slice(Math.max(0, index - 2), index).join('\n');
      uses.push({
        action,
        ref,
        spec,
        path: workflow.path,
        lineNumber: index + 1,
        precedingContext,
      });
    });
  });
  return uses;
}

function formatWorkflowUse(use) {
  return `${use.path}:${use.lineNumber} ${use.spec}`;
}

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
assert(
  contractLane.steps.some((step) => step.args.includes('tests/stage5b-surrogate-inspection-validation.test.js')),
  'contract lane should include the Stage 5B surrogate inspection validation guard'
);
assert(
  contractLane.steps.some((step) => step.args.includes('tests/stage5b-evidence-source-kit.test.js')),
  'contract lane should include the Stage 5B source acquisition/preflight guard'
);
assert(
  contractLane.steps.some((step) => step.args.includes('tests/stage5b-evidence-attachment-controller.test.js')),
  'contract lane should include the Stage 5B evidence attachment controller guard'
);

[
  'npm run check:source-hygiene',
  'npm run test:node:contract',
  'npm run test:node:integration',
  'npm run test:snapshots',
  'npm run test:studio-browser-smoke',
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
assert.equal(
  (hostedWorkflow.match(/persist-credentials: false/g) || []).length,
  6,
  'hosted workflow checkout steps should not persist Git credentials'
);
assert.equal(
  hostedWorkflow.includes('python3 -m pip install --upgrade pip pytest'),
  false,
  'hosted Python lane should not install mutable latest pytest or self-upgrade pip'
);
assert(
  hostedWorkflow.includes('.github/requirements/ci-python.txt'),
  'hosted Python lane should install from the pinned CI requirements file'
);
assert(
  hostedWorkflow.includes('npm ci --ignore-scripts --no-audit --prefer-offline'),
  'hosted workflow should install Node dependencies without lifecycle scripts'
);
assert.equal(
  hostedWorkflow.includes('path: .pytest_cache'),
  false,
  'hosted workflow should not upload raw pytest cache metadata as a CI artifact'
);

const workflowUses = collectWorkflowUses();
const unapprovedWorkflowActions = workflowUses
  .filter((use) => !approvedWorkflowActions.has(use.action.toLowerCase()))
  .map(formatWorkflowUse);
assert.deepEqual(
  unapprovedWorkflowActions,
  [],
  'workflow actions should stay on the approved first-party action allowlist unless this guard is intentionally updated'
);

const mutableWorkflowActionRefs = workflowUses
  .filter((use) => !/^[a-f0-9]{40}$/i.test(use.ref))
  .map(formatWorkflowUse);
assert.deepEqual(
  mutableWorkflowActionRefs,
  [],
  'workflow actions should be pinned to full-length commit SHAs instead of tags, branches, or shortened refs'
);

const workflowUsesMissingProvenance = workflowUses
  .filter((use) => {
    const expected = new RegExp(`#\\s*provenance:\\s*${escapeRegExp(use.action)}@v\\d+\\s*->\\s*${use.ref}`, 'i');
    return !expected.test(use.precedingContext);
  })
  .map(formatWorkflowUse);
assert.deepEqual(
  workflowUsesMissingProvenance,
  [],
  'workflow action pins should keep nearby source-tag provenance comments'
);

[
  'node bin/fcad.js check-runtime',
  'node bin/fcad.js check-runtime --json',
  'node bin/fcad.js check-runtime --json --redact-paths',
  'npm run test:runtime-smoke',
  'tests/test_cli_runtime.py tests/test_infotainment_draw_qa_regression.py tests/test_infotainment_hole_dia_regression.py',
  'output/smoke',
].forEach((command) => {
  assert(
    runtimeWorkflow.includes(command),
    `self-hosted runtime workflow should include ${command}`
  );
});
assert.equal(
  /^\s*pull_request:\s*$/m.test(runtimeWorkflow),
  false,
  'self-hosted runtime workflow should not subscribe directly to pull_request events'
);
assert.match(
  runtimeWorkflow,
  /workflow_run:\s*\n\s*workflows:\s*\["Automation CI \(hosted fast lanes\)"\]\s*\n\s*types:\s*\[completed\]/,
  'self-hosted runtime workflow should be triggered by completed hosted fast lanes'
);
assert(
  runtimeWorkflow.includes("github.event.workflow_run.conclusion == 'success'"),
  'self-hosted runtime workflow_run jobs should require successful hosted CI'
);
assert(
  runtimeWorkflow.includes('github.event.workflow_run.head_repository.full_name == github.repository'),
  'self-hosted runtime workflow_run jobs should be limited to same-repository heads'
);
assert(
  runtimeWorkflow.includes("github.event.workflow_run.actor.login == 'dooosp'"),
  'self-hosted runtime workflow_run jobs should be limited to the runtime owner actor'
);
assert(
  runtimeWorkflow.includes("github.actor == 'dooosp'"),
  'self-hosted manual and scheduled jobs should be limited to the runtime owner actor'
);
assert(
  runtimeWorkflow.includes("github.event.workflow_run.event == 'pull_request'"),
  'self-hosted runtime workflow should preserve same-repository PR runtime coverage'
);
assert(
  runtimeWorkflow.includes("github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'master'"),
  'self-hosted runtime workflow should limit workflow_run push smoke to master'
);
assert(
  runtimeWorkflow.includes("github.ref == 'refs/heads/master'"),
  'self-hosted manual and scheduled jobs should be limited to master'
);
assert(
  runtimeWorkflow.includes('ref: ${{ github.event.workflow_run.head_sha || github.sha }}'),
  'self-hosted runtime checkout should use the hosted workflow head SHA for workflow_run events'
);
assert(
  runtimeWorkflow.includes('runs-on: [self-hosted, macOS, freecad, freecad-automation-runtime]'),
  'self-hosted runtime workflow should require the repo-specific FreeCAD runner label'
);
assert(
  runtimeWorkflow.includes('environment: freecad-runtime-smoke'),
  'self-hosted runtime workflow should use the protected runtime environment gate'
);
assert(
  runtimeWorkflow.includes('group: freecad-runtime-smoke-${{ github.event.workflow_run.event || github.event_name }}-${{ github.event.workflow_run.head_branch || github.ref }}'),
  'self-hosted runtime workflow should dedupe by event and head branch/ref'
);
assert(
  runtimeWorkflow.includes('cancel-in-progress: true'),
  'self-hosted runtime workflow should cancel stale runs for the same event/ref'
);
[
  'Clear previous runtime smoke temp outputs',
  'Cleanup runtime smoke temp outputs',
  'rm -rf .ci output/smoke .pytest_cache',
].forEach((text) => {
  assert(runtimeWorkflow.includes(text), `self-hosted runtime workflow should include ${text}`);
});
assert.equal(
  (runtimeWorkflow.match(/^permissions:\n  contents: read$/gm) || []).length,
  1,
  'self-hosted runtime workflow permissions should stay contents: read only'
);
[
  'contents: write',
  'pull-requests: write',
  'id-token: write',
  'secrets:',
].forEach((text) => {
  assert.equal(runtimeWorkflow.includes(text), false, `self-hosted runtime workflow should not include ${text}`);
});
assert.equal(
  (runtimeWorkflow.match(/retention-days: 14/g) || []).length,
  2,
  'self-hosted runtime uploads should keep bounded artifact retention'
);
assert.equal(
  (runtimeWorkflow.match(/persist-credentials: false/g) || []).length,
  1,
  'self-hosted runtime checkout should not persist Git credentials'
);
assert(
  runtimeWorkflow.includes('npm ci --ignore-scripts --no-audit --prefer-offline'),
  'self-hosted runtime workflow should install Node dependencies without lifecycle scripts'
);

[
  'Pull request runtime smoke is triggered by `workflow_run` after `Automation CI (hosted fast lanes)` completes successfully.',
  'The self-hosted job does not subscribe directly to `pull_request` events.',
  'forked PRs are skipped before a self-hosted runner is assigned',
  'Workflow-run execution is also limited to the runtime-owner actor `dooosp`.',
  '`workflow_dispatch` is reserved for maintainer/runtime-owner checks of `master` by `dooosp`.',
  'The workflow deliberately has no path filter.',
  'Runner labels are `self-hosted`, `macOS`, `freecad`, and `freecad-automation-runtime`',
  'The job uses the protected `freecad-runtime-smoke` environment',
  'Workflow permissions are limited to `contents: read`.',
  'Checkout keeps `persist-credentials: false`',
  '14-day retention for debugging only',
  'The uploaded JSON runtime contract is path-redacted',
  'Runtime smoke outputs, CI diagnostics, workflow metadata, screenshots, logs, manifests, CAD-generated measurements, and uploaded artifacts are not `inspection_evidence`',
  'Canonical packages remain `needs_more_evidence` / `hold_for_evidence_completion`',
].forEach((text) => {
  assert(runtimeGovernanceDoc.includes(text), `runtime governance doc should include ${text}`);
});
assert(
  testingDoc.includes('[self-hosted runtime governance](./self-hosted-runtime-governance.md)'),
  'testing docs should link the self-hosted runtime governance guide'
);
assert(
  readme.includes('[docs/self-hosted-runtime-governance.md](./docs/self-hosted-runtime-governance.md)'),
  'README should link the self-hosted runtime governance guide'
);

console.log('lane-manifest.test.js: ok');
