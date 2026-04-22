import { spawn } from 'node:child_process';
import {
  convertPathForRuntime,
  formatFreeCADInvocation,
  getFreeCADInvocation,
  isWindowsAbsolutePath,
} from './paths.js';

const TIMEOUT_MS = 120_000;

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

function rejectJsonFailure(scriptName, parsed, reject) {
  if (!parsed || !Object.hasOwn(parsed, 'success') || parsed.success !== false) {
    return false;
  }

  reject(new Error(
    `${scriptName}: ${parsed.error || 'unknown error'}\n` +
    (parsed.details ? parsed.details.slice(-1000) : '')
  ));
  return true;
}

/**
 * Run a FreeCAD Python script with JSON input/output.
 *
 * @param {string} scriptName - e.g. 'create_model.py'
 * @param {object} input - JSON-serializable config object
 * @param {object} [opts]
 * @param {number} [opts.timeout] - ms before kill (default 120s)
 * @param {function} [opts.onStderr] - callback for stderr lines
 * @returns {Promise<object>} parsed JSON response
 */
export async function runScript(scriptName, input, opts = {}) {
  const timeout = opts.timeout ?? TIMEOUT_MS;
  const invocation = getFreeCADInvocation(scriptName);
  const commandPreview = formatFreeCADInvocation(invocation);
  const runtimeInput = convertPaths(input);

  return new Promise((resolve, reject) => {
    const proc = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Force UTF-8 stdin/stdout so non-ASCII JSON payloads survive round-trips.
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (opts.onStderr) opts.onStderr(text);
    });

    let timeoutError = null;
    let hardKillTimer = null;
    const timer = setTimeout(() => {
      timeoutError = new Error(`Script ${scriptName} timed out after ${timeout}ms`);
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

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);

      if (timeoutError) {
        return reject(timeoutError);
      }

      // Some FreeCAD invocations append banners after the JSON payload.
      const parsed = extractJsonObject(stdout);

      if (parsed) {
        if (rejectJsonFailure(scriptName, parsed, reject)) {
          return;
        }
        return resolve(parsed);
      }

      if (code !== 0) {
        return reject(new Error(
          `Script ${scriptName} exited with code ${code}\n` +
          `stderr: ${stderr.slice(-2000)}`
        ));
      }

      reject(new Error(
        `No JSON found in stdout of ${scriptName}\n` +
        `stdout: ${stdout.slice(-1000)}\nstderr: ${stderr.slice(-1000)}`
      ));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      reject(new Error(`Failed to spawn ${scriptName} with ${commandPreview}: ${err.message}`));
    });

    proc.stdin.on('error', (error) => {
      if (error?.code === 'EPIPE') {
        return;
      }
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      reject(new Error(`Failed to write input to ${scriptName}: ${error.message}`));
    });

    // Send input as JSON via stdin
    proc.stdin.write(JSON.stringify(runtimeInput));
    proc.stdin.end();
  });
}

/**
 * Recursively normalize path-like values for the active runtime.
 * Keys containing 'directory', 'path', or 'file' are normalized when absolute or home-relative.
 */
function convertPaths(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertPaths);
  if (typeof obj !== 'object') return obj;

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (
      typeof val === 'string'
      && (/^(\/|~\/)/.test(val) || isWindowsAbsolutePath(val))
      && /dir|path|file/i.test(key)
    ) {
      result[key] = convertPathForRuntime(val);
    } else if (typeof val === 'object') {
      result[key] = convertPaths(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
