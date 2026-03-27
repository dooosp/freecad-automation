import { spawnSync } from 'node:child_process';

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

function probePython(command) {
  const completed = spawnSync(command, ['--version'], {
    encoding: 'utf8',
  });

  if (completed.status !== 0) return null;
  const version = parseVersion(completed.stdout || completed.stderr);
  if (!isSupported(version)) return null;
  return { command, version };
}

const candidates = [
  process.env.PYTHON,
  'python3.13',
  'python3.12',
  'python3.11',
  'python3',
].filter(Boolean);

const python = candidates
  .map((command) => probePython(command))
  .find(Boolean);

if (!python) {
  console.error('Python 3.11+ is required for this pytest lane. Set PYTHON or install python3.11+.');
  process.exit(1);
}

const pytestArgs = ['-m', 'pytest', ...process.argv.slice(2)];
const completed = spawnSync(python.command, pytestArgs, {
  stdio: 'inherit',
  env: process.env,
});

process.exit(completed.status ?? 1);
