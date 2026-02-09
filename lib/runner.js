import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { toWindows, PYTHON_EXE_WSL, SCRIPTS_DIR } from './paths.js';

const TIMEOUT_MS = 120_000;

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
  const scriptWSL = join(SCRIPTS_DIR, scriptName);
  const scriptWin = toWindows(scriptWSL);

  // Convert any WSL paths in input to Windows paths
  const winInput = convertPaths(input);

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_EXE_WSL, [scriptWin], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (opts.onStderr) opts.onStderr(text);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Script ${scriptName} timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Try to parse JSON from stdout regardless of exit code
      const jsonMatch = stdout.match(/\{[\s\S]*\}\s*$/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          // If Python reported an error via respond_error, propagate it
          if (!parsed.success && code !== 0) {
            return reject(new Error(
              `${scriptName}: ${parsed.error || 'unknown error'}\n` +
              (parsed.details ? parsed.details.slice(-1000) : '')
            ));
          }
          return resolve(parsed);
        } catch (e) {
          // JSON parse failed, fall through
        }
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
      reject(new Error(`Failed to spawn ${scriptName}: ${err.message}`));
    });

    // Send input as JSON via stdin
    proc.stdin.write(JSON.stringify(winInput));
    proc.stdin.end();
  });
}

/**
 * Recursively convert path-like values in config to Windows paths.
 * Only converts values for keys containing 'directory' or 'path' that start with / or ~/
 */
function convertPaths(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertPaths);
  if (typeof obj !== 'object') return obj;

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && /^(\/|~\/)/.test(val) && /dir|path|file/i.test(key)) {
      result[key] = toWindows(val);
    } else if (typeof val === 'object') {
      result[key] = convertPaths(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
