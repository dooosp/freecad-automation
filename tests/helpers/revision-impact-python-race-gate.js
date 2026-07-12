import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function resolvePython3() {
  const probe = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const executable = probe.status === 0 ? probe.stdout.trim() : '';
  if (!executable) {
    throw new Error(`Unable to resolve python3 for race gate: ${probe.stderr || probe.error?.message || 'unknown error'}`);
  }
  return executable;
}

export function createRevisionImpactPythonRaceGate(root, name) {
  const gateDir = join(root, name);
  const readyPath = join(gateDir, 'ready');
  const continuePath = join(gateDir, 'continue');
  const shimPath = join(gateDir, 'python3');
  mkdirSync(gateDir, { recursive: true });
  writeFileSync(shimPath, `#!/bin/sh
: > "$FCAD_REVISION_IMPACT_RACE_READY"
while [ ! -e "$FCAD_REVISION_IMPACT_RACE_CONTINUE" ]; do
  sleep 0.01
done
exec "$FCAD_REVISION_IMPACT_REAL_PYTHON3" "$@"
`, 'utf8');
  chmodSync(shimPath, 0o755);

  const env = {
    PATH: `${gateDir}${delimiter}${process.env.PATH || ''}`,
    FCAD_REVISION_IMPACT_RACE_READY: readyPath,
    FCAD_REVISION_IMPACT_RACE_CONTINUE: continuePath,
    FCAD_REVISION_IMPACT_REAL_PYTHON3: resolvePython3(),
  };

  return {
    env,
    readyPath,
    continuePath,
    async waitUntilReady(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (!existsSync(readyPath)) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for revision-impact Python race gate ${readyPath}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    },
    release() {
      writeFileSync(continuePath, 'continue\n', 'utf8');
    },
    installProcessEnv() {
      const previous = Object.fromEntries(
        Object.keys(env).map((key) => [key, process.env[key]])
      );
      Object.assign(process.env, env);
      return () => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        });
      };
    },
  };
}
