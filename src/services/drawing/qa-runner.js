import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

function toLocalPath(path) {
  return resolve(String(path));
}

export async function runQaScorer(freecadRoot, svgPath, opts = {}) {
  if (!svgPath || typeof svgPath !== 'string') {
    throw new Error('svgPath is required for qa_scorer');
  }

  const scriptPath = join(freecadRoot, 'scripts', 'qa_scorer.py');
  const localSvgPath = toLocalPath(svgPath);
  const args = [scriptPath, localSvgPath];

  if (opts.planPath) {
    args.push('--plan', toLocalPath(opts.planPath));
  }
  if (opts.configPath) {
    args.push('--config', toLocalPath(opts.configPath));
  }
  if (opts.weightsPreset) {
    args.push('--weights-preset', String(opts.weightsPreset));
  }

  const stdout = await new Promise((resolveStdout, reject) => {
    const proc = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) {
        const tail = `${stderr.slice(-300)} ${stdout.slice(-300)}`.trim();
        return reject(new Error(`qa_scorer exited ${code}: ${tail}`));
      }
      resolveStdout(stdout);
    });
    proc.on('error', reject);
  });

  const scoreMatch = stdout.match(/QA Score:\s*(\d+)\/100/i);
  if (!scoreMatch) {
    throw new Error(`qa_scorer output did not include score: ${stdout.slice(-300)}`);
  }

  const profileMatch = stdout.match(/weight_profile:\s*([a-z0-9_-]+)/i);
  return {
    score: Number(scoreMatch[1]),
    file: basename(localSvgPath),
    weightProfile: profileMatch ? profileMatch[1] : undefined,
  };
}
