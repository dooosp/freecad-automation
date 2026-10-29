import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'smol-toml';

import { createManifestPath, validateArtifactManifest } from './artifact-manifest.js';
import { createCreateQualityPath, validateCreateQualityReport } from './create-quality.js';
import { createOutputManifestPath, validateOutputManifest } from './output-manifest.js';
import { buildRuntimeDiagnostics, redactRuntimeDiagnosticsPaths } from './runtime-diagnostics.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const DEMO_CONFIG = 'configs/examples/quality_pass_bracket.toml';
const SUPPORT_NOTE = 'Repository-owned live verification covers macOS + FreeCAD 1.1.x. Other platforms require local verification.';
const USAGE = 'Usage: npm run customer:quickcheck -- [--json] [--create-demo]\nDefault: read-only setup/runtime diagnostics. --create-demo runs strict create in a new output/customer-demo/run-* directory.';

function runCreateCommand({ command, args, cwd }) {
  return spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function localPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function isWithin(root, path) {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function nonemptyFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size === 0) throw new Error('Required evidence file is missing, empty, or not a regular file.');
  return readFile(path);
}

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function matchesRecord(record, path, bytes) {
  return record?.path === path && record.exists === true && record.size_bytes === bytes.length
    && record.sha256 === createHash('sha256').update(bytes).digest('hex');
}

async function verifyDemo({ outputDir, configPath, modelName }) {
  const step = join(outputDir, `${modelName}.step`);
  const stl = join(outputDir, `${modelName}.stl`);
  const qualityPath = createCreateQualityPath({ primaryOutputPath: step });
  const outputManifestPath = createOutputManifestPath({ primaryOutputPath: step });
  const artifactManifestPath = createManifestPath({ primaryOutputPath: step });
  const [stepBytes, stlBytes, qualityBytes, outputBytes, artifactBytes] = await Promise.all([
    step, stl, qualityPath, outputManifestPath, artifactManifestPath,
  ].map(nonemptyFile));
  const quality = JSON.parse(qualityBytes);
  const output = JSON.parse(outputBytes);
  const artifacts = JSON.parse(artifactBytes);

  requireEvidence(validateCreateQualityReport(quality).ok, 'Create quality JSON does not satisfy the existing schema.');
  requireEvidence(validateOutputManifest(output).ok, 'Output manifest does not satisfy the existing schema.');
  requireEvidence(validateArtifactManifest(artifacts).ok, 'Artifact manifest does not satisfy the existing schema.');
  requireEvidence(quality.status === 'pass' && quality.blocking_issues.length === 0, 'Create quality did not pass.');
  requireEvidence(quality.input_config === configPath && quality.primary_outputs.step === step && quality.primary_outputs.stl === stl,
    'Create quality references a different input or output.');
  requireEvidence(quality.geometry.valid_shape === true && quality.step_roundtrip.exported === true
    && quality.step_roundtrip.reimport_attempted === true && quality.step_roundtrip.reimport_valid === true,
  'Valid generated geometry and successful STEP re-import evidence are required.');
  requireEvidence(quality.stl_quality.exported === true && quality.stl_quality.mesh_load_attempted === true
    && quality.stl_quality.triangle_count > 0 && quality.stl_quality.watertight_or_closed === true,
  'Successful STL mesh inspection evidence is required.');
  requireEvidence(output.command === 'create' && ['pass', 'warning'].includes(output.status)
    && output.errors.length === 0 && output.input.path === configPath
    && output.command_args.includes('--strict-quality') && output.linked_artifacts.quality_json === qualityPath
    && output.runtime.freecad_available === true && output.runtime.freecad_probe_status === 'usable',
  'Output manifest does not describe this successful strict runtime-backed create.');
  requireEvidence(artifacts.command === 'create' && artifacts.status === 'succeeded' && artifacts.config_path === configPath,
    'Artifact manifest does not describe this successful create.');
  for (const [kind, path, bytes] of [['model.step', step, stepBytes], ['model.stl', stl, stlBytes]]) {
    requireEvidence(matchesRecord(output.outputs.find((entry) => entry.kind === kind), path, bytes)
      && matchesRecord(artifacts.artifacts.find((entry) => entry.type === kind), path, bytes),
    `Both manifests must match the current ${kind} file, size and SHA-256.`);
  }
  requireEvidence(matchesRecord(artifacts.artifacts.find((entry) => entry.type === 'model.create-quality'), qualityPath, qualityBytes),
    'Artifact manifest must match the current create quality report.');
  return { step, stl, create_quality: qualityPath, output_manifest: outputManifestPath, artifact_manifest: artifactManifestPath };
}

export async function runCustomerQuickcheck({
  projectRoot = PROJECT_ROOT,
  createDemo = false,
  runtimeOptions = {},
  runCommand = runCreateCommand,
} = {}) {
  const root = resolve(projectRoot);
  const report = {
    status: 'blocked',
    setup: { node_version: process.version, source_config: DEMO_CONFIG },
    support_note: SUPPORT_NOTE,
    runtime: null,
    demo: { status: createDemo ? 'blocked' : 'not_requested', output_dir: null, artifacts: {}, logs: {} },
    issues: [],
    next_command: 'npm run customer:quickcheck',
  };
  for (const path of ['bin/fcad.js', DEMO_CONFIG]) {
    try { await nonemptyFile(join(root, path)); }
    catch { report.issues.push({ code: 'setup_file_missing', message: `Required source-checkout file is missing or empty: ${path}. Restore the source checkout, then run npm ci.` }); }
  }
  try {
    report.runtime = buildRuntimeDiagnostics(runtimeOptions);
  } catch (error) {
    report.issues.push({ code: 'runtime_probe_error', message: 'Runtime diagnostics could not complete. Recheck the FreeCAD installation and FREECAD_* overrides.' });
    report.runtime = buildRuntimeDiagnostics({
      ...runtimeOptions,
      detectDetails: () => ({ python: {}, freecad: { error: error.message || 'runtime probe failed' } }),
    });
  }
  if (!report.runtime.available || report.issues.length) return { exitCode: 1, report };
  report.status = 'ready';
  report.next_command = 'npm run customer:quickcheck -- --create-demo';
  if (!createDemo) return { exitCode: 0, report };

  report.status = 'demo_failed';
  report.demo.status = 'failed';
  try {
    const canonicalRoot = await realpath(root);
    let parent = root;
    for (const segment of ['output', 'customer-demo']) {
      parent = join(parent, segment);
      await mkdir(parent, { recursive: true });
      requireEvidence(isWithin(canonicalRoot, await realpath(parent)), 'Demo output directory must remain inside the source checkout.');
    }
    const outputDir = await mkdtemp(join(parent, 'run-'));
    report.demo.output_dir = localPath(root, outputDir);
    const config = parse(await readFile(join(root, DEMO_CONFIG), 'utf8'));
    requireEvidence(config.name === 'quality_pass_bracket', 'Canonical demo config name has changed; review the first-run fixture.');
    config.export = { ...config.export, directory: outputDir };
    const configPath = join(outputDir, 'quality_pass_bracket.toml');
    await writeFile(configPath, stringify(config), 'utf8');
    let completed;
    try {
      completed = await runCommand({ command: process.execPath, args: [join(root, 'bin', 'fcad.js'), 'create', configPath, '--strict-quality'], cwd: root });
    } catch (error) {
      completed = { status: null, error, stdout: '', stderr: '' };
    }
    for (const stream of ['stdout', 'stderr']) {
      const logPath = join(outputDir, `create.${stream}.log`);
      const launchError = stream === 'stderr' && completed?.error
        ? `\n${completed.error.message || String(completed.error)}\n` : '';
      await writeFile(logPath, `${completed?.[stream] || ''}${launchError}`, 'utf8');
      report.demo.logs[stream] = localPath(root, logPath);
    }
    report.demo.command_exit_code = completed?.status ?? null;
    report.next_command = `node bin/fcad.js create ${localPath(root, configPath)} --strict-quality`;
    if (completed?.error || completed?.status !== 0) {
      report.issues.push({ code: 'create_command_failed', message: 'Strict create did not finish successfully. Review the local subprocess logs and runtime diagnostics before retrying.' });
      return { exitCode: 1, report };
    }
    const artifacts = await verifyDemo({ outputDir, configPath, modelName: config.name });
    report.demo.artifacts = Object.fromEntries(Object.entries(artifacts).map(([kind, path]) => [kind, localPath(root, path)]));
    report.demo.status = 'passed';
    report.status = 'demo_passed';
    report.next_command = 'npm run serve';
    return { exitCode: 0, report };
  } catch (error) {
    report.issues.push({ code: 'demo_verification_failed', message: redactRuntimeDiagnosticsPaths(error.message || 'Demo verification failed.') });
    return { exitCode: 1, report };
  }
}

export async function customerQuickcheckMain(argv = process.argv.slice(2), { logger = console.log, ...options } = {}) {
  const json = argv.includes('--json');
  if (argv.some((arg) => !['--json', '--create-demo', '--help'].includes(arg))) {
    logger(json ? JSON.stringify({ status: 'invalid_arguments', message: 'Supported options: --json, --create-demo, --help.' }) : USAGE);
    return 2;
  }
  if (argv.includes('--help')) {
    logger(json ? JSON.stringify({ status: 'help', usage: USAGE }) : USAGE);
    return 0;
  }
  const { exitCode, report } = await runCustomerQuickcheck({ ...options, createDemo: argv.includes('--create-demo') });
  if (json) {
    logger(JSON.stringify({ ...report, runtime: redactRuntimeDiagnosticsPaths(report.runtime) }, null, 2));
    return exitCode;
  }
  logger(`Customer quickcheck: ${report.status}`);
  logger(`Node ${report.setup.node_version} | ${report.runtime.platform} | FreeCAD ${report.runtime.version_details.freecad.version || 'unavailable'} (${report.runtime.status})`);
  logger(report.support_note);
  for (const message of [...report.runtime.errors, ...report.runtime.remediation, ...report.issues.map((issue) => issue.message)]) logger(`  - ${message}`);
  if (report.demo.status === 'passed') logger('Demo verified: nonempty STEP/STL, successful STEP re-import and STL inspection, passing quality, validated manifests and matching file hashes.');
  if (report.demo.output_dir) logger(`Output: ${report.demo.output_dir}`);
  for (const [kind, path] of Object.entries(report.demo.artifacts)) logger(`  ${kind}: ${path}`);
  if (report.demo.status === 'failed') for (const [stream, path] of Object.entries(report.demo.logs)) logger(`  ${stream} log: ${path}`);
  logger(`Next: ${report.next_command}`);
  return exitCode;
}
