import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MIN_MAJOR = 3;
const MIN_MINOR = 11;

function parseVersion(stdout) {
  const match = String(stdout).trim().match(/^(?:Python\s+)?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isSupported(version) {
  if (!version) return false;
  if (version.major !== MIN_MAJOR) return version.major > MIN_MAJOR;
  return version.minor >= MIN_MINOR;
}

function hasPytest(command) {
  const completed = spawnSync(command, ['-c', 'import pytest'], {
    encoding: 'utf8',
  });
  return completed.status === 0;
}

function probePython(command) {
  const completed = spawnSync(command, ['--version'], {
    encoding: 'utf8',
  });

  if (completed.status !== 0) return null;
  const version = parseVersion(completed.stdout || completed.stderr);
  if (!isSupported(version)) return null;
  return { command, version, hasPytest: hasPytest(command) };
}

function candidateCommands(env = process.env) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  add(env.PYTHON);
  add(env.PYTHON3);

  if (env.pythonLocation) {
    add(join(env.pythonLocation, 'bin', 'python'));
    add(join(env.pythonLocation, 'bin', 'python3'));
  }

  add('python3');
  add('python');
  add('python3.13');
  add('python3.12');
  add('python3.11');

  return candidates;
}

const candidates = candidateCommands();
const supportedPythons = candidates
  .map((command) => probePython(command))
  .filter(Boolean);

const python = supportedPythons.find((entry) => entry.hasPytest);

if (!python) {
  if (supportedPythons.length > 0) {
    console.error(
      `Pytest is not available in the supported Python interpreters that were found: ${supportedPythons.map((entry) => entry.command).join(', ')}.`
    );
    console.error('Install pytest into the interpreter selected by your environment, or set PYTHON/PYTHON3 to one that already has pytest.');
  } else {
    console.error('Python 3.11+ is required for this pytest lane. Set PYTHON or install python3.11+.');
  }
  process.exit(1);
}

const pytestArgs = ['-m', 'pytest', ...process.argv.slice(2)];
const completed = spawnSync(python.command, pytestArgs, {
  stdio: 'inherit',
  env: process.env,
});

process.exit(completed.status ?? 1);
