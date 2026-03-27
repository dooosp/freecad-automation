import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = join(ROOT, 'output', 'runtime-smoke');
const CONFIG_DIR = join(OUTPUT_DIR, 'configs');
const REPORT_DIR = join(ROOT, 'output');

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

rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(CONFIG_DIR, { recursive: true });

const bracketConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'ks_bracket.toml'),
  'ks_bracket.runtime-smoke.toml',
  'ks_bracket_runtime_smoke'
);
const femConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'bracket_fem.toml'),
  'bracket_fem.runtime-smoke.toml',
  'bracket_fem_runtime_smoke'
);

rmSync(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'), { force: true });

runCli(['check-runtime']);
runCli(['create', bracketConfig]);
assert.equal(existsSync(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step')), true);

runCli(['draw', bracketConfig, '--bom']);
assert.equal(existsSync(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing.svg')), true);
assert.equal(existsSync(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_qa.json')), true);

runCli(['inspect', join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step')]);

runCli(['fem', femConfig]);
assert.equal(existsSync(join(OUTPUT_DIR, 'bracket_fem_runtime_smoke.FCStd')), true);

runCli(['report', bracketConfig]);
assert.equal(existsSync(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf')), true);

console.log('runtime-smoke-cli.js: ok');
