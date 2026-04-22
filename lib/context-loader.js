import { dirname, join, parse, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { assertValidCArtifact } from './c-artifact-schema.js';
import { assertValidDArtifact } from './d-artifact-schema.js';

const DEFAULT_TIMEOUT_MS = 120_000;

function extractJsonObject(text) {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function rejectJsonFailure(scriptRelativePath, parsed, rejectPromise) {
  if (!parsed || !Object.hasOwn(parsed, 'success') || parsed.success !== false) {
    return false;
  }

  rejectPromise(new Error(
    `${scriptRelativePath}: ${parsed.error || 'unknown error'}\n${parsed.details || ''}`.trim()
  ));
  return true;
}

export async function runPythonJsonScript(projectRoot, scriptRelativePath, input, opts = {}) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const scriptPath = resolve(projectRoot, scriptRelativePath);

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(opts.pythonCommand || 'python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let timeoutError = null;
    let hardKillTimer = null;

    const timer = setTimeout(() => {
      timeoutError = new Error(`Script ${scriptRelativePath} timed out after ${timeout}ms`);
      try {
        proc.kill('SIGTERM');
      } catch {
        // Ignore kill race; close/error handlers will finalize.
      }
      hardKillTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process already exited.
          }
        }
      }, 5000);
      hardKillTimer.unref?.();
    }, timeout);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (opts.onStderr) opts.onStderr(text);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (timeoutError) {
        rejectPromise(timeoutError);
        return;
      }

      const parsed = extractJsonObject(stdout);
      if (parsed) {
        if (rejectJsonFailure(scriptRelativePath, parsed, rejectPromise)) {
          return;
        }
        resolvePromise(parsed);
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(
          `Script ${scriptRelativePath} exited with code ${code}\nstderr: ${stderr.slice(-2000)}`
        ));
        return;
      }

      rejectPromise(new Error(
        `No JSON found in stdout of ${scriptRelativePath}\nstdout: ${stdout.slice(-1000)}\nstderr: ${stderr.slice(-1000)}`
      ));
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      rejectPromise(new Error(`Failed to spawn ${scriptRelativePath}: ${error.message}`));
    });

    proc.stdin.on('error', (error) => {
      if (error?.code === 'EPIPE') {
        return;
      }
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      rejectPromise(new Error(`Failed to write input to ${scriptRelativePath}: ${error.message}`));
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

export async function readJsonFile(filePath) {
  const raw = await readFile(resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

export async function writeJsonFile(filePath, data) {
  const absPath = resolve(filePath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return absPath;
}

export async function writeValidatedJsonArtifact(filePath, artifactKind, data, options = {}) {
  const absPath = resolve(filePath);
  assertValidDArtifact(artifactKind, data, {
    ...options,
    path: options.path || absPath,
  });
  return writeJsonFile(absPath, data);
}

export async function writeValidatedCArtifact(filePath, artifactKind, data, options = {}) {
  const absPath = resolve(filePath);
  assertValidCArtifact(artifactKind, data, {
    ...options,
    path: options.path || absPath,
  });
  return writeJsonFile(absPath, data);
}

export function deriveArtifactStem(filePath, fallback = 'artifact') {
  if (!filePath) return fallback;
  const { name } = parse(filePath);
  return name
    .replace(/_context$/i, '')
    .replace(/_geometry_intelligence$/i, '')
    .replace(/_review_priorities$/i, '')
    .replace(/_inspection_linkage$/i, '')
    .replace(/_quality_linkage$/i, '')
    || fallback;
}

export function artifactPathFor(basePathOrDir, stem, suffix) {
  if (!basePathOrDir) return resolve('output', `${stem}${suffix}`);
  const parsed = parse(resolve(basePathOrDir));
  if (parsed.ext) {
    return resolve(parsed.dir, `${parsed.name}${suffix}`);
  }
  return join(resolve(basePathOrDir), `${stem}${suffix}`);
}

export async function readJsonIfExists(filePath) {
  if (!filePath) return null;
  try {
    return await readJsonFile(filePath);
  } catch {
    return null;
  }
}
