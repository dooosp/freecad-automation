import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
let fixtureName;
const ownedPaths = [];

// This exercises npm's real precedence rules: a package.json files allowlist can
// override root ignore files and accidentally include private nested content.
const requiredFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'bin/fcad.js',
  'bin/serve-legacy.js',
  'lib/paths.js',
  'lib/runner.js',
  'lib/output-manifest.js',
  'src/shared/i18n-contract.js',
  'src/server/local-api-server.js',
  'scripts/_bootstrap.py',
  'scripts/create_model.py',
  'scripts/inspect_model.py',
  'scripts/generate_drawing.py',
  'scripts/check-runtime.js',
  'scripts/run-test-suite.js',
  'scripts/run-pytest.js',
  'public/studio.html',
  'public/index.html',
  'public/js/studio-shell.js',
  'public/css/studio.css',
  'public/pilot/index.html',
  'public/pilot/offer.json',
  'public/pilot/assets/pilot-proposal.ko.pdf',
  'public/pilot/assets/pilot-demo.ko.md',
  'scripts/assets/pilot-fonts/NanumGothic-Regular.ttf',
  'scripts/assets/pilot-fonts/OFL.txt',
  'configs/examples/quality_pass_bracket.toml',
  'configs/generated/cnc_motor_mount_bracket.toml',
  'data/runtime_examples/display_bracket_runtime.json',
  'schemas/output-manifest.schema.json',
  'prompts/multi-agent/orchestrator.prompt.txt',
  'docs/support-matrix.md',
  'docs/examples/example-library-manifest.json',
  'docs/examples/quality-pass-bracket/release/release_bundle.zip',
  'tests/lane-manifest.js',
  'tests/run-node-lane.js',
  'tests/package-distribution.test.js',
  'tests/fixtures/imports/simple_bracket.step',
  '.github/workflows/automation-ci.yml',
  '.github/requirements/ci-python.txt',
  '.github/requirements/ci-report.txt',
  'pytest.ini',
  'server.js',
];

function createFixtureDirectory(parent) {
  const path = join(ROOT, parent, fixtureName);
  mkdirSync(path);
  ownedPaths.push(path);
  return path;
}

function writeFixture(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'synthetic package boundary fixture; no credentials\n', { flag: 'wx' });
}

try {
  const unlistedDirectory = mkdtempSync(join(ROOT, 'package-distribution-'));
  fixtureName = basename(unlistedDirectory);
  ownedPaths.push(unlistedDirectory);
  writeFixture(join(unlistedDirectory, 'private-record.txt'));
  // Never inspect, replace, or remove a user's existing environment files.
  const rootEnvironment = join(ROOT, `.env.${fixtureName}`);
  writeFileSync(rootEnvironment, 'synthetic package boundary fixture\n', { flag: 'wx' });
  ownedPaths.push(rootEnvironment);
  for (const parent of ['bin', 'lib', 'src', 'scripts', 'public', 'configs', 'data', 'schemas', 'prompts', 'docs', 'tests', '.github']) {
    const directory = createFixtureDirectory(parent);
    for (const relativePath of [
      '.env',
      '.env.local',
      'nested/.env.production',
      '__pycache__/compiled.pyc',
      'nested/compiled.pyc',
      'nested/node_modules/dependency/index.js',
      'nested/output/generated.step',
      'nested/tmp/run.json',
      'nested/.cache/cached.json',
      'nested/.ci/diagnostic.json',
      'nested/logs/run.log',
      'nested/local/stage5b-candidate-evidence-inbox/private-record.json',
    ]) {
      writeFixture(join(directory, relativePath));
    }
    // Keep an ordinary nested asset to catch an overbroad directory exclusion.
    writeFixture(join(directory, 'nested/runtime-asset.txt'));
    requiredFiles.push(`${parent}/${fixtureName}/nested/runtime-asset.txt`);
    if (parent === 'public') writeFixture(join(directory, '.temporary-assets', 'fixture.txt'));
  }
  const publicDotfile = join(ROOT, 'public', `.${fixtureName}`);
  writeFileSync(publicDotfile, 'synthetic browser smoke fixture\n', { flag: 'wx' });
  ownedPaths.push(publicDotfile);

  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [inventory] = JSON.parse(result.stdout);
  const packedPaths = new Set(inventory.files.map(({ path }) => path));
  const forbidden = [...packedPaths].filter((path) => (
    path.split('/').some((segment) => (
      segment.startsWith('.env')
      || ['__pycache__', 'node_modules', 'output', 'tmp', '.cache', '.ci', 'logs', 'local'].includes(segment)
    ))
    || /\.py[co]$/i.test(path)
    || /^public\/(?:.*\/)?\.[^/]+(?:\/|$)/.test(path)
    || path.startsWith(`${fixtureName}/`)
  ));
  assert.deepEqual(forbidden, [], 'npm package must exclude environment files, local state, caches, and temporary public dotfiles');
  for (const path of requiredFiles) {
    assert.ok(packedPaths.has(path), `npm package is missing required runtime/developer asset: ${path}`);
  }
  console.log(`package-distribution.test.js: ok (${packedPaths.size} files; private sentinel files excluded)`);
} finally {
  for (const path of ownedPaths.reverse()) rmSync(path, { recursive: true, force: true });
}
