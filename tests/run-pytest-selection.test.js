import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'run-pytest.js');

function makeFakePython(filePath, { version, hasPytest, label }) {
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python ${version}"
  exit 0
fi
if [ "$1" = "-c" ]; then
  if echo "$2" | grep -q "import pytest"; then
    ${hasPytest ? 'exit 0' : 'echo "No module named pytest" >&2; exit 1'}
  fi
fi
if [ "$1" = "-m" ] && [ "$2" = "pytest" ]; then
  echo "${label}"
  exit 0
fi
echo "unexpected args: $@" >&2
exit 1
`;
  writeFileSync(filePath, script, 'utf8');
  chmodSync(filePath, 0o755);
}

{
  const sandbox = mkdtempSync(join(tmpdir(), 'fcad-run-pytest-'));
  const activeDir = join(sandbox, 'active', 'bin');
  const pathDir = join(sandbox, 'path-bin');

  // Build the directories with shell so the test stays lightweight.
  const setup = spawnSync('mkdir', ['-p', activeDir, pathDir], { encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);

  makeFakePython(join(activeDir, 'python'), {
    version: '3.11.15',
    hasPytest: true,
    label: 'selected-active-python',
  });
  makeFakePython(join(pathDir, 'python3.12'), {
    version: '3.12.9',
    hasPytest: false,
    label: 'wrong-python3.12',
  });
  makeFakePython(join(pathDir, 'python3'), {
    version: '3.11.9',
    hasPytest: false,
    label: 'wrong-python3',
  });

  const completed = spawnSync(process.execPath, [SCRIPT, '-q', 'tests'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      pythonLocation: join(sandbox, 'active'),
      PATH: `${pathDir}:${process.env.PATH || ''}`,
    },
  });

  assert.equal(completed.status, 0, completed.stderr);
  assert.match(completed.stdout, /selected-active-python/);
  assert.doesNotMatch(completed.stdout, /wrong-python3/);
}

{
  const sandbox = mkdtempSync(join(tmpdir(), 'fcad-run-pytest-missing-'));
  const pathDir = join(sandbox, 'path-bin');
  const setup = spawnSync('mkdir', ['-p', pathDir], { encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);

  makeFakePython(join(pathDir, 'python3.12'), {
    version: '3.12.9',
    hasPytest: false,
    label: 'missing-pytest-python3.12',
  });

  const completed = spawnSync(process.execPath, [SCRIPT, '-q', 'tests'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${pathDir}:${process.env.PATH || ''}`,
    },
  });

  assert.equal(completed.status, 1);
  assert.match(completed.stderr, /Pytest is not available/);
  assert.match(completed.stderr, /python3\.12/);
}

console.log('run-pytest-selection.test.js: ok');
