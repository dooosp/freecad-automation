const PYTEST_COMMAND = 'node scripts/run-pytest.js -q tests --ignore=tests/test_cli_runtime.py --ignore=tests/test_infotainment_draw_qa_regression.py --ignore=tests/test_infotainment_hole_dia_regression.py';

export const TEST_LANES = Object.freeze([
  Object.freeze({
    id: 'contract',
    label: 'Node contract',
    npmScript: 'test:node:contract',
    packageCommand: 'node tests/run-node-lane.js contract',
    scope: 'config migration/validation, runtime path resolution, invocation assembly, structural validation, canonical package integrity, and Stage 5B no-evidence/audit/surrogate/source-preflight/attachment-controller/pipeline-doctor CLI smoke',
    freecadRequired: false,
    steps: Object.freeze([
      Object.freeze({ label: 'Config normalizer', args: Object.freeze(['tests/config-normalizer.test.js']) }),
      Object.freeze({ label: 'Config schema CLI', args: Object.freeze(['tests/config-schema-cli.test.js']) }),
      Object.freeze({ label: 'Config example parity', args: Object.freeze(['tests/config-example-parity.test.js']) }),
      Object.freeze({ label: 'Pytest runner selection', args: Object.freeze(['tests/run-pytest-selection.test.js']) }),
      Object.freeze({ label: 'CLI foundation modules', args: Object.freeze(['tests/cli-foundation.test.js']) }),
      Object.freeze({ label: 'Command manifest', args: Object.freeze(['tests/command-manifest.test.js']) }),
      Object.freeze({ label: 'Lane manifest', args: Object.freeze(['tests/lane-manifest.test.js']) }),
      Object.freeze({ label: 'Maintainer doctors workflow', args: Object.freeze(['tests/maintainer-doctors-workflow.test.js']) }),
      Object.freeze({ label: 'Maintainer doctor', args: Object.freeze(['tests/maintainer-doctor.test.js']) }),
      Object.freeze({ label: 'Bootstrap doctor', args: Object.freeze(['tests/bootstrap-doctor.test.js']) }),
      Object.freeze({ label: 'Source-of-truth drift', args: Object.freeze(['tests/source-of-truth-drift.test.js']) }),
      Object.freeze({ label: 'Job executor handler registry', args: Object.freeze(['tests/job-executor-handler-registry.test.js']) }),
      Object.freeze({ label: 'Stage 5B source-of-truth guard', args: Object.freeze(['tests/stage5b-source-of-truth-guard.test.js']) }),
      Object.freeze({ label: 'Stage 5B artifact/schema catalog guard', args: Object.freeze(['tests/stage5b-artifact-catalog.test.js']) }),
      Object.freeze({ label: 'Stage 5B artifact schema contracts', args: Object.freeze(['tests/stage5b-artifact-contracts.test.js']) }),
      Object.freeze({ label: 'Stage 5B candidate evidence gate', args: Object.freeze(['tests/stage5b-candidate-evidence-gate.test.js']) }),
      Object.freeze({ label: 'Example library manifest', args: Object.freeze(['tests/example-library-manifest.test.js']) }),
      Object.freeze({ label: 'Closeout package generator', args: Object.freeze(['tests/closeout-package.test.js']) }),
      Object.freeze({ label: 'First-user docs smoke', args: Object.freeze(['tests/first-user-docs-smoke.test.js']) }),
      Object.freeze({ label: 'Example library index', args: Object.freeze(['tests/example-library-index.test.js']) }),
      Object.freeze({ label: 'Example library package', args: Object.freeze(['tests/example-library-package.test.js']) }),
      Object.freeze({ label: 'Canonical package integrity', args: Object.freeze(['tests/canonical-package-integrity.test.js']) }),
      Object.freeze({ label: 'Controller housing EOL standard docs', args: Object.freeze(['tests/controller-housing-eol-standard-docs.test.js']) }),
      Object.freeze({ label: 'Example library Studio reopen', args: Object.freeze(['tests/example-library-studio-reopen.test.js']) }),
      Object.freeze({ label: 'Runtime path contracts', args: Object.freeze(['tests/paths-runtime.test.js']) }),
      Object.freeze({ label: 'FreeCAD invocation contracts', args: Object.freeze(['tests/freecad-invocation.test.js']) }),
      Object.freeze({ label: 'Runtime smoke governance helpers', args: Object.freeze(['tests/runtime-smoke-governance.test.js']) }),
      Object.freeze({ label: 'Serve CLI', args: Object.freeze(['tests/serve-cli.test.js']) }),
      Object.freeze({ label: 'Create quality helper', args: Object.freeze(['tests/create-quality.test.js']) }),
      Object.freeze({ label: 'Quality fixture matrix contracts', args: Object.freeze(['tests/quality-fixture-matrix.test.js']) }),
      Object.freeze({ label: 'Drawing intent foundation', args: Object.freeze(['tests/drawing-intent-foundation.test.js']) }),
      Object.freeze({ label: 'Extracted drawing semantics foundation', args: Object.freeze(['tests/extracted-drawing-semantics.test.js']) }),
      Object.freeze({ label: 'Conservative feature catalog contracts', args: Object.freeze(['tests/feature-catalog.test.js']) }),
      Object.freeze({ label: 'Drawing semantic regression fixtures', args: Object.freeze(['tests/drawing-semantic-regression.test.js']) }),
      Object.freeze({ label: 'Shared artifact surface', args: Object.freeze(['tests/artifact-surface.test.js']) }),
      Object.freeze({ label: 'Report artifact exposure helper', args: Object.freeze(['tests/job-executor-report-artifacts.test.js']) }),
      Object.freeze({ label: 'Report analysis preparation helper', args: Object.freeze(['tests/job-executor-report-analysis.test.js']) }),
      Object.freeze({ label: 'DFM actionable issue contracts', args: Object.freeze(['tests/dfm-actionable.test.js']) }),
      Object.freeze({ label: 'Decision-ready report summary', args: Object.freeze(['tests/report-decision-summary.test.js']) }),
      Object.freeze({ label: 'Studio artifact re-entry', args: Object.freeze(['tests/studio-artifact-actions.test.js']) }),
      Object.freeze({ label: 'Studio quality dashboard', args: Object.freeze(['tests/studio-quality-dashboard.test.js']) }),
      Object.freeze({ label: 'Studio public contract helpers', args: Object.freeze(['tests/studio-public-contract.test.js']) }),
      Object.freeze({ label: 'Studio canonical package cards', args: Object.freeze(['tests/studio-canonical-package-cards.test.js']) }),
      Object.freeze({ label: 'Studio canonical artifact preview UX', args: Object.freeze(['tests/studio-canonical-artifact-preview-ux.test.js']) }),
      Object.freeze({ label: 'Studio responsive CSS', args: Object.freeze(['tests/studio-responsive-css.test.js']) }),
      Object.freeze({ label: 'Studio drawing workspace helpers', args: Object.freeze(['tests/studio-drawing-workspace.test.js']) }),
      Object.freeze({ label: 'Studio jobs client', args: Object.freeze(['tests/studio-jobs-client.test.js']) }),
      Object.freeze({ label: 'Studio inspection evidence intake UX', args: Object.freeze(['tests/studio-inspection-evidence-intake-ux.test.js']) }),
      Object.freeze({ label: 'Studio model tracked state', args: Object.freeze(['tests/model-tracked-runs.test.js']) }),
      Object.freeze({ label: 'Studio shell state', args: Object.freeze(['tests/studio-state.test.js']) }),
      Object.freeze({ label: 'Studio draw tracked state', args: Object.freeze(['tests/drawing-tracked-runs.test.js']) }),
      Object.freeze({ label: 'Studio job monitor', args: Object.freeze(['tests/studio-job-monitor.test.js']) }),
      Object.freeze({ label: 'Studio job bridge', args: Object.freeze(['tests/studio-job-bridge.test.js']) }),
      Object.freeze({ label: 'STEP import bootstrap contracts', args: Object.freeze(['tests/step-import-service.test.js']) }),
      Object.freeze({ label: 'Bootstrap import service contracts', args: Object.freeze(['tests/bootstrap-import-service.test.js']) }),
      Object.freeze({ label: 'Evidence linkage side-input contract', args: Object.freeze(['tests/evidence-linkage-side-input-contract.test.js']) }),
      Object.freeze({ label: 'Evidence graph artifact', args: Object.freeze(['tests/evidence-graph.test.js']) }),
      Object.freeze({ label: 'Evidence graph tracked job', args: Object.freeze(['tests/evidence-graph-tracked-job.test.js']) }),
      Object.freeze({ label: 'Inspection evidence contract', args: Object.freeze(['tests/inspection-evidence-contract.test.js']) }),
      Object.freeze({ label: 'QIF-lite inspection adapter', args: Object.freeze(['tests/qif-lite-inspection-adapter.test.js']) }),
      Object.freeze({ label: 'Inspection evidence intake automation', args: Object.freeze(['tests/inspection-evidence-intake.test.js']) }),
      Object.freeze({ label: 'Inspection evidence promotion dry-run', args: Object.freeze(['tests/inspection-evidence-promotion-dry-run.test.js']) }),
      Object.freeze({ label: 'Stage 5B no-evidence CLI lane', args: Object.freeze(['tests/stage5b-no-evidence-lane.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence review dry-run orchestration', args: Object.freeze(['tests/stage5b-evidence-review-dry-run.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence attachment controller', args: Object.freeze(['tests/stage5b-evidence-attachment-controller.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence audit bundle', args: Object.freeze(['tests/stage5b-evidence-audit.test.js']) }),
      Object.freeze({ label: 'Stage 5B runtime validation', args: Object.freeze(['tests/stage5b-runtime-validation.test.js']) }),
      Object.freeze({ label: 'Stage 5B audit CLI smoke', args: Object.freeze(['tests/stage5b-evidence-audit-cli-smoke.test.js']) }),
      Object.freeze({ label: 'Stage 5B surrogate inspection validation', args: Object.freeze(['tests/stage5b-surrogate-inspection-validation.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence source kit/preflight', args: Object.freeze(['tests/stage5b-evidence-source-kit.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence pipeline doctor', args: Object.freeze(['tests/stage5b-evidence-pipeline-doctor.test.js']) }),
      Object.freeze({ label: 'Readiness inspection evidence contract', args: Object.freeze(['tests/readiness-inspection-evidence-contract.test.js']) }),
      Object.freeze({ label: 'Design reviewer validation', args: Object.freeze(['tests/design-reviewer-validation.test.js']) }),
      Object.freeze({ label: 'D artifact contracts', args: Object.freeze(['tests/d-artifact-schema.test.js']) }),
      Object.freeze({ label: 'C artifact contracts', args: Object.freeze(['tests/c-artifact-schema.test.js']) }),
      Object.freeze({ label: 'Release bundle packaging', args: Object.freeze(['tests/release-bundle.test.js']) }),
      Object.freeze({ label: 'Release dry-run doctor', args: Object.freeze(['tests/release-dry-run-doctor.test.js']) }),
      Object.freeze({ label: 'D model-analysis fallback', args: Object.freeze(['tests/model-analysis-runtime.test.js']) }),
    ]),
  }),
  Object.freeze({
    id: 'stage5b-no-evidence',
    label: 'Stage 5B no-evidence',
    npmScript: 'test:stage5b:no-evidence',
    packageCommand: 'node tests/run-node-lane.js stage5b-no-evidence',
    scope: 'local non-production CLI lane for source acquisition preflight, evidence review dry-run orchestration, evidence attachment-controller gating, inspection-evidence-intake, inspection-evidence-promotion-dry-run, stage5b-evidence-audit, stage5b-surrogate-inspection-validation, and the fixture-only pipeline doctor proving no genuine evidence is promoted',
    freecadRequired: false,
    steps: Object.freeze([
      Object.freeze({ label: 'Stage 5B no-evidence CLI lane', args: Object.freeze(['tests/stage5b-no-evidence-lane.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence review dry-run orchestration', args: Object.freeze(['tests/stage5b-evidence-review-dry-run.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence attachment controller', args: Object.freeze(['tests/stage5b-evidence-attachment-controller.test.js']) }),
      Object.freeze({ label: 'Stage 5B surrogate inspection validation', args: Object.freeze(['tests/stage5b-surrogate-inspection-validation.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence source kit/preflight', args: Object.freeze(['tests/stage5b-evidence-source-kit.test.js']) }),
      Object.freeze({ label: 'Stage 5B evidence pipeline doctor', args: Object.freeze(['tests/stage5b-evidence-pipeline-doctor.test.js']) }),
    ]),
  }),
  Object.freeze({
    id: 'integration',
    label: 'Node integration',
    npmScript: 'test:node:integration',
    packageCommand: 'node tests/run-node-lane.js integration',
    scope: 'local API/job contracts, studio bridge routes, browserless studio and legacy serve smoke, rule profiles, sweep logic, draw/report service integration',
    freecadRequired: false,
    steps: Object.freeze([
      Object.freeze({ label: 'Job API contracts', args: Object.freeze(['tests/job-api.test.js']) }),
      Object.freeze({ label: 'Job queue controls', args: Object.freeze(['tests/job-queue-controls.test.js']) }),
      Object.freeze({ label: 'Public path redaction', args: Object.freeze(['tests/public-path-redaction.test.js']) }),
      Object.freeze({ label: 'Local API landing page', args: Object.freeze(['tests/local-api-server.test.js']) }),
      Object.freeze({ label: 'Local API canonical packages', args: Object.freeze(['tests/local-api-canonical-packages.test.js']) }),
      Object.freeze({ label: 'Local API canonical artifact preview', args: Object.freeze(['tests/local-api-canonical-artifact-preview.test.js']) }),
      Object.freeze({ label: 'Review-context bootstrap handoff', args: Object.freeze(['tests/review-context-bootstrap.test.js']) }),
      Object.freeze({ label: 'Studio model API', args: Object.freeze(['tests/local-api-studio-model.test.js']) }),
      Object.freeze({ label: 'Studio drawing API', args: Object.freeze(['tests/local-api-studio-drawing.test.js']) }),
      Object.freeze({ label: 'Legacy serve HTTP smoke', args: Object.freeze(['tests/legacy-serve-smoke.test.js']) }),
      Object.freeze({ label: 'Studio drawing service', args: Object.freeze(['tests/studio-drawing-service.test.js']) }),
      Object.freeze({ label: 'Rule profile service', args: Object.freeze(['tests/rule-profile-service.test.js']) }),
      Object.freeze({ label: 'Parameter sweep', args: Object.freeze(['tests/sweep.test.js']) }),
      Object.freeze({ label: 'Drawing planner advisory foundation', args: Object.freeze(['tests/drawing-planner.test.js']) }),
      Object.freeze({ label: 'Drawing quality summary', args: Object.freeze(['tests/drawing-quality-summary.test.js']) }),
      Object.freeze({ label: 'Draw pipeline QA bridge', args: Object.freeze(['tests/draw-pipeline-qa-config.test.js']) }),
      Object.freeze({ label: 'Report summary service wiring', args: Object.freeze(['tests/report-service-summary.test.js']) }),
      Object.freeze({ label: 'Decision-ready report PDF', args: Object.freeze(['tests/report-decision-pdf.test.js']) }),
      Object.freeze({ label: 'Report FEM normalization', args: Object.freeze(['tests/report-fem-normalization.test.js']) }),
      Object.freeze({ label: 'Report runtime fallback', args: Object.freeze(['tests/report-runtime-fallback.test.js']) }),
    ]),
  }),
  Object.freeze({
    id: 'snapshots',
    label: 'Snapshots',
    npmScript: 'test:snapshots',
    packageCommand: 'node tests/run-node-lane.js snapshots',
    scope: 'normalized SVG and report preview regression baselines',
    freecadRequired: false,
    steps: Object.freeze([
      Object.freeze({ label: 'SVG snapshots', args: Object.freeze(['tests/svg-snapshot.test.js']) }),
      Object.freeze({ label: 'Report preview snapshots', args: Object.freeze(['tests/report-preview-snapshot.test.js']) }),
    ]),
  }),
  Object.freeze({
    id: 'studio-browser-smoke',
    label: 'Studio browser smoke',
    npmScript: 'test:studio-browser-smoke',
    packageCommand: 'node tests/studio-shell-browser-smoke.test.js',
    scope: 'real Chrome/CDP Studio browser smoke for shell routing, canonical package cards, safe preview, release bundle non-action boundary, and route readiness without FreeCAD runtime execution',
    freecadRequired: false,
    browserRequired: true,
  }),
  Object.freeze({
    id: 'py',
    label: 'Python',
    npmScript: 'test:py',
    packageCommand: PYTEST_COMMAND,
    scope: 'plain-Python and CLI-adjacent regression coverage that does not require a live FreeCAD launch',
    freecadRequired: false,
  }),
  Object.freeze({
    id: 'runtime-smoke',
    label: 'Runtime smoke',
    npmScript: 'test:runtime-smoke',
    packageCommand: 'node tests/run-node-lane.js runtime-smoke',
    scope: 'real `fcad` smoke for `check-runtime`, `create`, `draw --bom`, `inspect`, `fem`, narrow `tolerance --csv`, and `report` using checked-in example configs',
    freecadRequired: true,
    steps: Object.freeze([
      Object.freeze({ label: 'CLI runtime smoke', args: Object.freeze(['tests/runtime-smoke-cli.js']) }),
      Object.freeze({ label: 'Local API runtime smoke', args: Object.freeze(['tests/local-api.integration.test.js']) }),
      Object.freeze({ label: 'Repeat export runtime regression', args: Object.freeze(['tests/export-repeat.test.js']) }),
    ]),
  }),
]);

export const TEST_SUITES = Object.freeze([
  Object.freeze({
    id: 'hosted',
    npmScript: 'test:ci:hosted',
    packageCommand: 'node scripts/run-test-suite.js hosted',
    members: Object.freeze(['test:node:contract', 'test:node:integration', 'test:snapshots', 'test:studio-browser-smoke', 'test:py']),
  }),
  Object.freeze({
    id: 'node-lite',
    npmScript: 'test:node:lite',
    packageCommand: 'node scripts/run-test-suite.js node-lite',
    members: Object.freeze(['test:node:contract', 'test:node:integration', 'test:snapshots']),
  }),
  Object.freeze({
    id: 'default-node',
    npmScript: 'test',
    packageCommand: 'node scripts/run-test-suite.js default-node',
    members: Object.freeze(['test:node:contract', 'test:node:integration', 'test:snapshots']),
  }),
]);

export const RUNTIME_DOMAIN_SCRIPTS = Object.freeze([
  Object.freeze({ npmScript: 'test:runtime:model', packageCommand: 'node tests/test-runner.js --layers=model' }),
  Object.freeze({ npmScript: 'test:runtime:drawing', packageCommand: 'node tests/test-runner.js --layers=drawing' }),
  Object.freeze({ npmScript: 'test:runtime:analysis', packageCommand: 'node tests/test-runner.js --layers=analysis' }),
  Object.freeze({ npmScript: 'test:runtime:report', packageCommand: 'node tests/test-runner.js --layers=report' }),
  Object.freeze({ npmScript: 'test:runtime:integration', packageCommand: 'node tests/test-runner.js --layers=integration' }),
  Object.freeze({ npmScript: 'test:runtime:full', packageCommand: 'node tests/test-runner.js --profile=full' }),
]);

export const WORKFLOW_MAPPINGS = Object.freeze([
  Object.freeze({
    label: 'Automation CI (hosted fast lanes)',
    commands: Object.freeze(['check:source-hygiene', 'test:node:contract', 'test:node:integration', 'test:snapshots', 'test:studio-browser-smoke', 'test:py']),
    scope: 'No hosted FreeCAD install or launch',
  }),
  Object.freeze({
    label: 'FreeCAD Runtime Smoke (self-hosted macOS)',
    commands: Object.freeze(['test:runtime-smoke']),
    scope: 'No Linux or Windows runtime ownership claims, and no broad tolerance or Monte Carlo maturity claim',
    suffix: 'plus runtime-backed Python smoke regressions, the quality fixture matrix, and a narrow tolerance CSV smoke',
  }),
  Object.freeze({
    label: 'Maintainer Doctors (hosted schedule)',
    commands: Object.freeze(['check:source-hygiene', 'bootstrap:doctor', 'maintainer:doctor', 'release:dry-run:doctor', 'test:stage5b:pipeline-doctor']),
    scope: 'Governance and maintenance only; not release approval, production observation, evidence attachment, readiness proof, or doctor artifact upload',
    suffix: 'plus `npm ci` and the source-of-truth drift guard',
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toMarkdownCode(value) {
  return `\`${value}\``;
}

function findById(entries, id) {
  return entries.find((entry) => entry.id === id) || null;
}

function renderCommandBlock(commands = []) {
  return ['```bash', ...commands, '```'].join('\n');
}

function renderWorkflowCommandCell(mapping) {
  const commandLabels = mapping.commands.map((command) => toMarkdownCode(command));
  const head = commandLabels.join(', ');
  return mapping.suffix ? `${head} ${mapping.suffix}` : head;
}

export function getLaneManifest() {
  return clone(TEST_LANES);
}

export function getNodeLaneIds() {
  return TEST_LANES.filter((lane) => Array.isArray(lane.steps)).map((lane) => lane.id);
}

export function getNodeLane(id) {
  const lane = findById(TEST_LANES, id);
  return lane && Array.isArray(lane.steps) ? clone(lane) : null;
}

export function getTestSuite(id) {
  const suite = findById(TEST_SUITES, id);
  return suite ? clone(suite) : null;
}

export function getExpectedPackageScripts() {
  const entries = {};
  TEST_LANES.forEach((lane) => {
    entries[lane.npmScript] = lane.packageCommand;
  });
  TEST_SUITES.forEach((suite) => {
    entries[suite.npmScript] = suite.packageCommand;
  });
  RUNTIME_DOMAIN_SCRIPTS.forEach((script) => {
    entries[script.npmScript] = script.packageCommand;
  });
  return entries;
}

export function renderLaneTableMarkdown() {
  const lines = [
    '| Lane | Command | Scope | FreeCAD required |',
    '| --- | --- | --- | --- |',
  ];
  TEST_LANES.forEach((lane) => {
    lines.push(`| ${lane.label} | ${toMarkdownCode(`npm run ${lane.npmScript}`)} | ${lane.scope} | ${lane.freecadRequired ? 'Yes' : 'No'} |`);
  });
  return lines.join('\n');
}

export function renderWorkflowMappingMarkdown() {
  const lines = [
    '| Workflow | What it runs | What it does not claim |',
    '| --- | --- | --- |',
  ];
  WORKFLOW_MAPPINGS.forEach((mapping) => {
    lines.push(`| ${toMarkdownCode(mapping.label)} | ${renderWorkflowCommandCell(mapping)} | ${mapping.scope} |`);
  });
  return lines.join('\n');
}

export function renderFastLocalCommandsMarkdown() {
  return renderCommandBlock([
    'npm run test:node:contract',
    'npm run test:node:integration',
    'npm run test:snapshots',
  ]);
}

export function renderPythonLaneCommandsMarkdown() {
  return renderCommandBlock([
    'npm run test:py',
  ]);
}

export function renderRuntimeSmokeCommandsMarkdown() {
  return renderCommandBlock([
    'fcad check-runtime',
    'npm run test:runtime-smoke',
  ]);
}

export function renderRuntimeDomainCommandsMarkdown() {
  return renderCommandBlock(
    RUNTIME_DOMAIN_SCRIPTS.map((entry) => `npm run ${entry.npmScript}`)
  );
}
