import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { test, after } from 'node:test';
import { parse } from 'smol-toml';
import { buildRuntimeDiagnostics } from '../lib/runtime-diagnostics.js';
import { buildCreateQualityReport } from '../lib/create-quality.js';
import { buildOutputManifest } from '../lib/output-manifest.js';
import { buildArtifactManifest } from '../lib/artifact-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const quickcheck = await import('../lib/customer-quickcheck.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/lib/customer-quickcheck.js')) return {};
  throw error;
});
assert.equal(typeof quickcheck.runCustomerQuickcheck, 'function', 'customer quickcheck must expose a runnable diagnostic');
assert.equal(typeof quickcheck.customerQuickcheckMain, 'function', 'customer quickcheck must expose its CLI entry point');
const { runCustomerQuickcheck, customerQuickcheckMain } = quickcheck;

await mkdir(join(ROOT, 'tmp', 'codex'), { recursive: true });
const TEMP = await mkdtemp(join(ROOT, 'tmp', 'codex', 'customer-quickcheck-test-'));
after(() => rm(TEMP, { recursive: true, force: true }));

function runtimeOptions({ available = true, probeError = null } = {}) {
  return {
    platform: 'darwin', env: { FREECAD_APP: '/Users/customer/private/FreeCAD.app' },
    runtime: {
      available, mode: 'macos-bundle', source: 'FREECAD_APP',
      executable: '/Users/customer/private/FreeCAD.app/Contents/Resources/bin/freecadcmd',
      pythonExecutable: '/Users/customer/private/FreeCAD.app/Contents/Resources/bin/python',
      checkedCandidates: ['/Users/customer/private/FreeCAD.app'],
    },
    detectDetails: () => ({
      python: { executable: '/Users/customer/private/python', version: '3.11.0', error: null },
      freecad: { executable: '/Users/customer/private/freecadcmd', version: available ? '1.1.4' : null, error: probeError },
    }),
  };
}

async function workspace() {
  const root = await mkdtemp(join(TEMP, 'checkout-'));
  await mkdir(join(root, 'configs', 'examples'), { recursive: true });
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin', 'fcad.js'), '// test CLI boundary\n');
  await writeFile(join(root, 'configs', 'examples', 'quality_pass_bracket.toml'), await readFile(join(ROOT, 'configs', 'examples', 'quality_pass_bracket.toml')));
  return root;
}

// Only the external CAD subprocess is replaced. File writes, schema validation,
// manifest metadata and the quickcheck's evidence decisions stay real.
async function createFixture(command, { mutateQuality, mutateManifest, missingStl = false, emptyStep = false } = {}) {
  assert.equal(command.command, process.execPath);
  assert.equal(command.args[0], join(command.cwd, 'bin', 'fcad.js'));
  assert.equal(command.args[1], 'create');
  assert.equal(command.args[3], '--strict-quality');
  const configPath = command.args[2];
  const config = parse(await readFile(configPath, 'utf8'));
  const source = parse(await readFile(join(command.cwd, 'configs', 'examples', 'quality_pass_bracket.toml'), 'utf8'));
  assert.deepEqual({ ...config, export: source.export }, source, 'demo must preserve canonical geometry and fixture name');
  const out = config.export.directory;
  assert.equal(dirname(configPath), out);
  const paths = {
    step: join(out, 'quality_pass_bracket.step'), stl: join(out, 'quality_pass_bracket.stl'),
    quality: join(out, 'quality_pass_bracket_create_quality.json'),
    manifest: join(out, 'quality_pass_bracket_manifest.json'),
    artifacts: join(out, 'quality_pass_bracket_artifact-manifest.json'),
  };
  await writeFile(paths.step, emptyStep ? '' : 'fixture STEP bytes');
  if (!missingStl) await writeFile(paths.stl, 'fixture STL bytes');
  const model = { valid_shape: true, volume: 100, area: 180, solid_count: 1, face_count: 12, edge_count: 24, bbox: { min: [0, 0, 0], max: [10, 20, 5], size: [10, 20, 5] } };
  const quality = buildCreateQualityReport({
    inputConfigPath: configPath,
    createResult: { model, exports: [{ format: 'step', path: paths.step }, { format: 'stl', path: paths.stl }] },
    runtimeAvailable: true,
    inspections: { step: { success: true, model }, stl: { success: true, model: { triangle_count: 256, watertight_or_closed: true, bbox: model.bbox } } },
  });
  mutateQuality?.(quality);
  await writeFile(paths.quality, JSON.stringify(quality));
  const diagnostics = buildRuntimeDiagnostics(runtimeOptions());
  const outputs = [{ path: paths.step, kind: 'model.step' }, { path: paths.stl, kind: 'model.stl' }];
  const manifest = await buildOutputManifest({
    projectRoot: command.cwd, command: 'create', commandArgs: [configPath, '--strict-quality'], inputPath: configPath,
    outputs, linkedArtifacts: { quality_json: paths.quality }, status: 'pass', runtimeDiagnostics: diagnostics,
  });
  mutateManifest?.(manifest);
  await writeFile(paths.manifest, JSON.stringify(manifest));
  const artifactManifest = await buildArtifactManifest({
    projectRoot: command.cwd, interface: 'cli', command: 'create', status: 'succeeded', configPath,
    artifacts: [...outputs.map(({ kind, path }) => ({ type: kind, path })), { type: 'model.create-quality', path: paths.quality }],
    runtimeDiagnostics: diagnostics,
  });
  await writeFile(paths.artifacts, JSON.stringify(artifactManifest));
  return { status: 0, stdout: 'CAD subprocess chatter /Users/customer/private\n', stderr: 'CAD warning text\n' };
}

test('default diagnostics are read-only and do not create a demo', async () => {
  const root = await workspace();
  const before = await readdir(root);
  const result = await runCustomerQuickcheck({ projectRoot: root, runtimeOptions: runtimeOptions(), runCommand: () => assert.fail('diagnostics must not create CAD') });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, 'ready');
  assert.equal(result.report.demo.status, 'not_requested');
  assert.deepEqual(await readdir(root), before);
});

for (const [name, options, status] of [
  ['missing runtime', { available: false }, 'runtime_not_detected'],
  ['failed FreeCAD probe', { probeError: 'Cannot import FreeCAD from /Users/customer/private/python' }, 'runtime_probe_failed'],
]) {
  test(`${name} blocks demo with remediation and no output writes`, async () => {
    const root = await workspace();
    const result = await runCustomerQuickcheck({ projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(options), runCommand: () => assert.fail('unavailable runtime must not launch') });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.runtime.status, status);
    assert.equal(result.report.demo.status, 'blocked');
    assert(result.report.runtime.remediation.some((step) => step.includes('export FREECAD_APP="/Applications/FreeCAD.app"')));
    assert.deepEqual(await readdir(root), ['bin', 'configs']);
  });
}

test('unexpected probe exception returns a failed diagnostic', async () => {
  const root = await workspace();
  const result = await runCustomerQuickcheck({ projectRoot: root, runtimeOptions: { ...runtimeOptions(), detectDetails: () => { throw new Error('probe exploded /Users/customer/private'); } } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'blocked');
  assert(result.report.issues.some((issue) => issue.code === 'runtime_probe_error'));
});

test('nonzero create command cannot claim demo success and retains local logs', async () => {
  const root = await workspace();
  const result = await runCustomerQuickcheck({ projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(), runCommand: () => ({ status: 2, stdout: 'Model created successfully!', stderr: 'strict quality failed' }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.demo.status, 'failed');
  assert(result.report.issues.some((issue) => issue.code === 'create_command_failed'));
  assert.match(await readFile(join(root, result.report.demo.logs.stderr), 'utf8'), /strict quality failed/);
});

test('launch exception is recorded in local stderr for recovery', async () => {
  const root = await workspace();
  const result = await runCustomerQuickcheck({ projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(), runCommand: () => { throw new Error('launch permission denied'); } });
  assert.equal(result.exitCode, 1);
  assert.match(await readFile(join(root, result.report.demo.logs.stderr), 'utf8'), /launch permission denied/);
});

test('an output symlink cannot send the demo outside the source checkout', async () => {
  const root = await workspace();
  const external = await mkdtemp(join(TEMP, 'external-'));
  await symlink(external, join(root, 'output'), 'dir');
  const result = await runCustomerQuickcheck({ projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(), runCommand: () => assert.fail('must stop before CLI launch') });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await readdir(external), []);
});

for (const [name, options] of [
  ['missing STL', { missingStl: true }],
  ['empty STEP', { emptyStep: true }],
  ['failed quality', { mutateQuality: (quality) => { quality.status = 'fail'; quality.blocking_issues = ['Invalid shape']; } }],
  ['skipped quality', { mutateQuality: (quality) => { quality.status = 'skipped'; } }],
  ['invalid quality schema', { mutateQuality: (quality) => { delete quality.geometry; } }],
  ['unattempted STEP reimport', { mutateQuality: (quality) => { quality.step_roundtrip.reimport_attempted = false; } }],
  ['unattempted STL inspection', { mutateQuality: (quality) => { quality.stl_quality.mesh_load_attempted = false; } }],
  ['invalid manifest schema', { mutateManifest: (manifest) => { delete manifest.run_id; } }],
  ['wrong manifest command', { mutateManifest: (manifest) => { manifest.command = 'inspect'; } }],
  ['manifest without runtime evidence', { mutateManifest: (manifest) => { manifest.runtime.freecad_available = false; } }],
  ['wrong manifest output path', { mutateManifest: (manifest) => { manifest.outputs[0].path = '/unrelated/stale.step'; } }],
  ['wrong manifest hash', { mutateManifest: (manifest) => { manifest.outputs[0].sha256 = '0'.repeat(64); } }],
]) {
  test(`${name} rejects zero-exit demo output`, async () => {
    const root = await workspace();
    const result = await runCustomerQuickcheck({ projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(), runCommand: (command) => createFixture(command, options) });
    assert.equal(result.exitCode, 1, JSON.stringify(result.report));
    assert.equal(result.report.demo.status, 'failed');
    assert(result.report.issues.length > 0);
  });
}

test('actual-shaped verified outputs succeed in unique run directories', async () => {
  const root = await workspace();
  const opts = { projectRoot: root, createDemo: true, runtimeOptions: runtimeOptions(), runCommand: createFixture };
  const first = await runCustomerQuickcheck(opts);
  const second = await runCustomerQuickcheck(opts);
  assert.equal(first.exitCode, 0, JSON.stringify(first.report));
  assert.equal(second.exitCode, 0, JSON.stringify(second.report));
  assert.equal(first.report.demo.status, 'passed');
  assert.notEqual(first.report.demo.output_dir, second.report.demo.output_dir);
  assert.match(first.report.demo.output_dir, /^output\/customer-demo\/run-[\w-]+$/);
  for (const path of Object.values(first.report.demo.artifacts)) assert(path.startsWith(`${first.report.demo.output_dir}/`), path);
  assert.equal(first.report.next_command, 'npm run serve', 'the next action must not overwrite unrelated CLI output manifests');
});

test('JSON output is one redacted document without subprocess chatter', async () => {
  const root = await workspace();
  const lines = [];
  const exit = await customerQuickcheckMain(['--json', '--create-demo'], { projectRoot: root, runtimeOptions: runtimeOptions(), runCommand: createFixture, logger: (line) => lines.push(line) });
  assert.equal(exit, 0);
  assert.equal(lines.length, 1);
  const report = JSON.parse(lines[0]);
  assert.equal(report.demo.status, 'passed');
  assert.match(report.demo.artifacts.step, /^output\/customer-demo\/run-/);
  assert(!lines[0].includes('/Users/customer'));
  assert(!lines[0].includes('CAD subprocess chatter'));
});

test('invalid CLI arguments fail without invoking diagnostics or creating output', async () => {
  const root = await workspace();
  const lines = [];
  const exit = await customerQuickcheckMain(['--json', '--out-dir', '/tmp'], { projectRoot: root, runtimeOptions: { detectDetails: () => assert.fail('invalid options must stop first') }, logger: (line) => lines.push(line) });
  assert.equal(exit, 2);
  assert.equal(JSON.parse(lines.join('')).status, 'invalid_arguments');
  assert.deepEqual(await readdir(root), ['bin', 'configs']);
});

test('real subprocess stdout and stderr remain outside JSON output', async () => {
  const root = await workspace();
  await writeFile(join(root, 'bin', 'fcad.js'), 'console.log("unstructured CAD stdout"); console.error("unstructured CAD stderr"); process.exit(1);');
  const lines = [];
  const exit = await customerQuickcheckMain(['--json', '--create-demo'], { projectRoot: root, runtimeOptions: runtimeOptions(), logger: (line) => lines.push(line) });
  const report = JSON.parse(lines.join(''));
  assert.equal(exit, 1);
  assert.equal(report.demo.status, 'failed');
  assert(!lines.join('').includes('unstructured CAD'));
  assert.match(await readFile(join(root, report.demo.logs.stdout), 'utf8'), /unstructured CAD stdout/);
  assert.match(await readFile(join(root, report.demo.logs.stderr), 'utf8'), /unstructured CAD stderr/);
});

test('script help is runnable from a different working directory', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'customer-quickcheck.js'), '--help', '--json'], { cwd: TEMP, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'help');
});
