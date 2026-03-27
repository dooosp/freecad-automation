#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, deepMerge } from '../lib/config-loader.js';
import { runScript } from '../lib/runner.js';
import {
  runAnalyzePipeline,
  runCost,
  runDfm,
  runFem,
  runTolerance,
} from '../src/api/analysis.js';
import { runDesignTask } from '../src/api/design.js';
import { generateDrawing } from '../src/api/drawing.js';
import {
  createModel,
  importStep,
  inspectModel,
} from '../src/api/model.js';
import { generateReport } from '../src/api/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function readStdin() {
  return new Promise((resolveInput, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolveInput(input));
    process.stdin.on('error', reject);
  });
}

function buildContext() {
  return {
    freecadRoot: PROJECT_ROOT,
    runScript,
    loadConfig,
    deepMerge,
  };
}

function withContext(handler) {
  return async (payload = {}) => handler({ ...buildContext(), ...payload });
}

const TOOLS = {
  status: async () => ({
    success: true,
    freecadRoot: PROJECT_ROOT,
    availableTools: [
      'create_model',
      'generate_drawing',
      'run_dfm',
      'run_tolerance',
      'run_cost',
      'run_fem',
      'generate_report',
      'inspect_model',
      'import_step',
      'analyze_pipeline',
      'design_task',
    ],
  }),
  create_model: withContext(createModel),
  generate_drawing: withContext(generateDrawing),
  run_dfm: withContext(runDfm),
  run_tolerance: withContext(runTolerance),
  run_cost: withContext(runCost),
  run_fem: withContext(runFem),
  generate_report: withContext(generateReport),
  inspect_model: async (payload = {}) => inspectModel(payload),
  import_step: withContext(importStep),
  analyze_pipeline: withContext(runAnalyzePipeline),
  design_task: withContext((payload = {}) => runDesignTask({
    mode: 'design',
    ...payload,
  })),
};

async function main() {
  const toolName = process.argv[2];
  if (!toolName || !TOOLS[toolName]) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Unknown tool '${toolName || ''}'`,
      availableTools: Object.keys(TOOLS),
    }));
    process.exit(1);
  }

  try {
    const rawInput = await readStdin();
    const payload = rawInput.trim() ? JSON.parse(rawInput) : {};
    const result = await TOOLS[toolName](payload);
    process.stdout.write(JSON.stringify({ success: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  }
}

main();
