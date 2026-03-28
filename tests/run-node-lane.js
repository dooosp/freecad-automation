import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const LANE_STEPS = {
  contract: [
    { label: 'Config normalizer', args: ['tests/config-normalizer.test.js'] },
    { label: 'Config schema CLI', args: ['tests/config-schema-cli.test.js'] },
    { label: 'Config example parity', args: ['tests/config-example-parity.test.js'] },
    { label: 'Runtime path contracts', args: ['tests/paths-runtime.test.js'] },
    { label: 'FreeCAD invocation contracts', args: ['tests/freecad-invocation.test.js'] },
    { label: 'Serve CLI', args: ['tests/serve-cli.test.js'] },
    { label: 'Studio shell state', args: ['tests/studio-state.test.js'] },
    { label: 'Studio draw tracked state', args: ['tests/drawing-tracked-runs.test.js'] },
    { label: 'Studio job bridge', args: ['tests/studio-job-bridge.test.js'] },
    { label: 'Design reviewer validation', args: ['tests/design-reviewer-validation.test.js'] },
  ],
  integration: [
    { label: 'Job API contracts', args: ['tests/job-api.test.js'] },
    { label: 'Local API landing page', args: ['tests/local-api-server.test.js'] },
    { label: 'Studio drawing API', args: ['tests/local-api-studio-drawing.test.js'] },
    { label: 'Studio drawing service', args: ['tests/studio-drawing-service.test.js'] },
    { label: 'Rule profile service', args: ['tests/rule-profile-service.test.js'] },
    { label: 'Parameter sweep', args: ['tests/sweep.test.js'] },
    { label: 'Draw pipeline QA bridge', args: ['tests/draw-pipeline-qa-config.test.js'] },
    { label: 'Report FEM normalization', args: ['tests/report-fem-normalization.test.js'] },
    { label: 'Report runtime fallback', args: ['tests/report-runtime-fallback.test.js'] },
  ],
  snapshots: [
    { label: 'SVG snapshots', args: ['tests/svg-snapshot.test.js'] },
    { label: 'Report preview snapshots', args: ['tests/report-preview-snapshot.test.js'] },
  ],
  'runtime-smoke': [
    { label: 'CLI runtime smoke', args: ['tests/runtime-smoke-cli.js'] },
    { label: 'Local API runtime smoke', args: ['tests/local-api.integration.test.js'] },
    { label: 'Repeat export runtime regression', args: ['tests/export-repeat.test.js'] },
  ],
};

function printUsage() {
  console.error(`Usage: node tests/run-node-lane.js <${Object.keys(LANE_STEPS).join('|')}>`);
}

function runLaneStep(step) {
  console.log(`\n== ${step.label} ==`);
  const completed = spawnSync(process.execPath, step.args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  if (completed.status !== 0) {
    process.exit(completed.status ?? 1);
  }
}

const lane = process.argv[2];
const steps = lane ? LANE_STEPS[lane] : undefined;

if (!steps) {
  printUsage();
  process.exit(1);
}

console.log(`Running Node lane: ${lane}`);
for (const step of steps) {
  runLaneStep(step);
}

console.log(`\nNode lane '${lane}' passed.`);
