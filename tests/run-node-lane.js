import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { getNodeLane, getNodeLaneIds } from './lane-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
function printUsage() {
  console.error(`Usage: node tests/run-node-lane.js <${getNodeLaneIds().join('|')}>`);
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
const steps = lane ? getNodeLane(lane)?.steps : undefined;

if (!steps) {
  printUsage();
  process.exit(1);
}

console.log(`Running Node lane: ${lane}`);
for (const step of steps) {
  runLaneStep(step);
}

console.log(`\nNode lane '${lane}' passed.`);
