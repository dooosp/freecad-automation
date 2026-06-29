import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseCliArgs } from '../src/cli/args.js';
import { dispatchCliCommand } from '../src/cli/dispatch.js';
import {
  createCliPathHelpers,
  createRunWithCliStderr,
  nowIso,
} from '../src/cli/helpers.js';
import { createCliOptionValidators } from '../src/cli/options.js';
import {
  buildDrawLinkedArtifactsFromSvg,
  createCliOutputArtifactHelpers,
  createOutputEntry,
  createOutputEntriesFromExports,
  createOutputEntriesFromPartFiles,
} from '../src/cli/output-artifacts.js';

const ROOT = resolve(import.meta.dirname, '..');

function runModuleSnippet(source) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

assert.deepEqual(parseCliArgs([
  'config.toml',
  '--out',
  'output/result.json',
  '--strict-quality',
  '--batch=4',
  '--profile',
  'demo',
  '--literal',
  '--next',
]), {
  positional: ['config.toml'],
  options: {
    out: 'output/result.json',
    'strict-quality': true,
    batch: '4',
    profile: 'demo',
    literal: true,
    next: true,
  },
});

const validators = createCliOptionValidators({ projectRoot: ROOT });
assert.equal(validators.ensureNumericOption('--batch', '3'), 3);
assert.equal(validators.ensureNumericOption('--batch', ''), undefined);
assert.equal(validators.requireOptionValue('--out', 'output/result.json'), 'output/result.json');
validators.rejectUnsupportedOptions('demo', { out: 'x' }, ['out']);
validators.requireExistingInputFile('package', resolve(ROOT, 'package.json'));
validators.requireRepoScopedPath('package', resolve(ROOT, 'package.json'));

const tempRoot = mkdtempSync(join(tmpdir(), 'fcad-cli-foundation-'));
try {
  const pathHelpers = createCliPathHelpers({ projectRoot: tempRoot });
  assert.equal(pathHelpers.resolveMaybe('output/result.json'), resolve(ROOT, 'output/result.json'));
  assert.equal(pathHelpers.buildDefaultOutputDir(), join(tempRoot, 'output'));
  assert.equal(pathHelpers.normalizeJsonOutputPath('output/result'), resolve(ROOT, 'output/result.json'));
  assert.equal(pathHelpers.repoRelativePath(join(tempRoot, 'artifact.json')), 'artifact.json');
  assert.equal(pathHelpers.cliRelativePath(join(tempRoot, 'artifact.json')), 'artifact.json');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T/);

const outputHelpers = createCliOutputArtifactHelpers({
  projectRoot: ROOT,
  buildDefaultOutputDir: (preferredPath) => (preferredPath ? resolve(ROOT, preferredPath) : join(ROOT, 'output')),
});
assert.deepEqual(createOutputEntry('model.step', '/tmp/demo.step'), {
  kind: 'model.step',
  path: '/tmp/demo.step',
});
assert.equal(createOutputEntry('', '/tmp/demo.step'), null);
assert.deepEqual(createOutputEntriesFromExports([
  { format: 'STEP', path: '/tmp/demo.step' },
  { format: 'stl' },
], 'model'), [
  { kind: 'model.step', path: '/tmp/demo.step' },
]);
assert.deepEqual(createOutputEntriesFromPartFiles([
  { path: '/tmp/part-a.stl' },
  { ref: 'missing-path' },
]), [
  { kind: 'model.part-stl', path: '/tmp/part-a.stl' },
]);
assert.deepEqual(outputHelpers.buildExpectedModelOutputs({
  name: '../demo',
  export: { directory: 'out', formats: ['STEP', 'stl'] },
}), [
  { kind: 'model.step', path: join(ROOT, 'out', 'demo.STEP') },
  { kind: 'model.stl', path: join(ROOT, 'out', 'demo.stl') },
]);
assert.deepEqual(outputHelpers.buildExpectedFemOutputs({
  name: 'demo',
  export: { directory: 'out', formats: ['step'] },
}), [
  { kind: 'analysis.fem.fcstd', path: join(ROOT, 'out', 'demo.FCStd') },
  { kind: 'analysis.fem.step', path: join(ROOT, 'out', 'demo.step') },
]);
assert.deepEqual(outputHelpers.buildExpectedToleranceOutputs({
  name: 'demo',
  export: { directory: 'out' },
  tolerance: { csv: true },
}), [
  { kind: 'analysis.tolerance.csv', path: join(ROOT, 'out', 'demo_tolerance.csv') },
]);
assert.deepEqual(outputHelpers.buildExpectedReportOutputs({
  name: 'demo',
  _report_output_dir: 'reports',
}), [
  { kind: 'report.pdf', path: join(ROOT, 'reports', 'demo_report.pdf') },
  { kind: 'report.summary-json', path: join(ROOT, 'reports', 'demo_report_summary.json') },
]);
const expectedDraw = outputHelpers.buildExpectedDrawArtifacts({
  name: 'demo',
  export: { directory: 'out' },
  drawing: { dxf: true, bom_csv: true },
});
assert.equal(expectedDraw.primaryOutputPath, join(ROOT, 'out', 'demo_drawing.svg'));
assert.deepEqual(expectedDraw.outputs.map((entry) => entry.kind), [
  'drawing.svg',
  'drawing.quality-json',
  'drawing.extracted-semantics-json',
  'drawing.intent-json',
  'drawing.feature-catalog-json',
  'drawing.dxf',
  'drawing.csv',
]);
assert.deepEqual(buildDrawLinkedArtifactsFromSvg(join(ROOT, 'out', 'demo_drawing.svg')), {
  qa_json: join(ROOT, 'out', 'demo_drawing_qa.json'),
  run_log_json: join(ROOT, 'out', 'demo_run_log.json'),
  traceability_json: join(ROOT, 'out', 'demo_traceability.json'),
  planner_json: join(ROOT, 'out', 'demo_drawing_planner.json'),
  extracted_drawing_semantics_json: join(ROOT, 'out', 'demo_extracted_drawing_semantics.json'),
  drawing_intent_json: join(ROOT, 'out', 'demo_drawing_intent.json'),
  feature_catalog_json: join(ROOT, 'out', 'demo_feature_catalog.json'),
  quality_json: join(ROOT, 'out', 'demo_drawing_quality.json'),
});

let forwardedStderr = '';
const runWithCliStderr = createRunWithCliStderr(async (script, input, opts = {}) => {
  opts.onStderr('runtime warning\n');
  return { script, input };
}, {
  destroyed: false,
  writable: true,
  write(text, callback) {
    forwardedStderr += text;
    if (callback) callback();
  },
});
const scriptResult = await runWithCliStderr('demo.py', { ok: true });
assert.deepEqual(scriptResult, { script: 'demo.py', input: { ok: true } });
assert.equal(forwardedStderr, 'runtime warning\n');

assert.equal(typeof dispatchCliCommand, 'function');

const knownRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['known', '--flag', 'value'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {
      known: async (args) => console.log(JSON.stringify(args)),
    },
  });
`);
assert.equal(knownRun.status, 0, knownRun.stderr || knownRun.stdout);
assert.equal(knownRun.stdout.trim(), '["--flag","value"]');

const helpRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['known', '--help'],
    usage: 'USAGE',
    renderCommandUsage: (command) => 'HELP ' + command,
    printRuntimeDiagnostics: () => 0,
    commands: {
      known: async () => console.log('handler should not run'),
    },
  });
`);
assert.equal(helpRun.status, 0, helpRun.stderr || helpRun.stdout);
assert.equal(helpRun.stdout.trim(), 'HELP known');

const unknownRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['missing'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {},
  });
`);
assert.equal(unknownRun.status, 1);
assert.match(unknownRun.stderr, /Unknown command: missing/);
assert.match(unknownRun.stdout, /USAGE/);

const checkRuntimeRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['check-runtime', '--json'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: ({ format }) => {
      console.log(format);
      return 7;
    },
    commands: {},
  });
`);
assert.equal(checkRuntimeRun.status, 7);
assert.equal(checkRuntimeRun.stdout.trim(), 'json');

const checkRuntimePositionalRun = runModuleSnippet(`
  import { dispatchCliCommand } from './src/cli/dispatch.js';
  await dispatchCliCommand({
    argv: ['check-runtime', 'extra'],
    usage: 'USAGE',
    renderCommandUsage: () => null,
    printRuntimeDiagnostics: () => 0,
    commands: {},
  });
`);
assert.equal(checkRuntimePositionalRun.status, 1);
assert.match(checkRuntimePositionalRun.stderr, /check-runtime does not accept positional arguments/);

assert.equal(existsSync(resolve(ROOT, 'bin', 'fcad.js')), true);

console.log('cli-foundation.test.js: ok');
