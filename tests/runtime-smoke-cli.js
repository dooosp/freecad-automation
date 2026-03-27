import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = join(ROOT, 'output', 'runtime-smoke');
const CONFIG_DIR = join(ROOT, 'output', 'runtime-smoke-configs');
const REPORT_DIR = join(ROOT, 'output');
const MANIFEST_PATH = join(OUTPUT_DIR, 'smoke-manifest.json');

const smokeManifest = {
  generated_at: new Date().toISOString(),
  source_configs: [],
  commands: [],
  artifacts: [],
};

function runCli(args) {
  const completed = spawnSync('node', [join(ROOT, 'bin', 'fcad.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (completed.stdout) process.stdout.write(completed.stdout);
  if (completed.stderr) process.stderr.write(completed.stderr);

  assert.equal(
    completed.status,
    0,
    `Command failed: fcad ${args.join(' ')}`
  );

  smokeManifest.commands.push({
    command: `fcad ${args.join(' ')}`,
    status: completed.status,
  });

  return completed;
}

function cloneConfigWithOutput(sourcePath, targetName, rewrittenName) {
  const source = readFileSync(sourcePath, 'utf8');
  const escapedOutputDir = OUTPUT_DIR.replace(/\\/g, '\\\\');
  const withOutputDir = source.replace(
    /directory\s*=\s*"[^"]*"/,
    `directory = "${escapedOutputDir}"`
  );
  const rewritten = withOutputDir.replace(
    /^name\s*=\s*"[^"]*"/m,
    `name = "${rewrittenName}"`
  );

  const targetPath = join(CONFIG_DIR, targetName);
  writeFileSync(targetPath, rewritten, 'utf8');
  return targetPath;
}

function assertArtifact(path) {
  assert.equal(existsSync(path), true, `Expected artifact to exist: ${path}`);
  smokeManifest.artifacts.push(path);
}

rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(CONFIG_DIR, { recursive: true });

const bracketConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'ks_bracket.toml'),
  'ks_bracket.runtime-smoke.toml',
  'ks_bracket_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'));

rmSync(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'), { force: true });

runCli(['check-runtime']);
runCli(['create', bracketConfig]);
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step'));

runCli(['draw', bracketConfig, '--bom']);
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing.svg'));
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_qa.json'));
const bomArtifact = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_bom.csv');
if (existsSync(bomArtifact)) {
  smokeManifest.artifacts.push(bomArtifact);
}

runCli(['inspect', join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step')]);
runCli(['report', bracketConfig]);
assertArtifact(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'));

writeFileSync(MANIFEST_PATH, JSON.stringify(smokeManifest, null, 2) + '\n', 'utf8');

console.log('runtime-smoke-cli.js: ok');
