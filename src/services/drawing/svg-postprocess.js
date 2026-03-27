import { spawn } from 'node:child_process';
import { join, parse, resolve } from 'node:path';

function toLocalPath(path) {
  return resolve(String(path));
}

function getRepairReportPath(svgPath) {
  const parsed = parse(svgPath);
  return join(parsed.dir, `${parsed.name}_repair_report.json`);
}

export async function postprocessSvg(freecadRoot, svgPath, opts = {}) {
  if (!svgPath || typeof svgPath !== 'string') {
    throw new Error('svgPath is required for postprocess_svg');
  }

  const scriptPath = join(freecadRoot, 'scripts', 'postprocess_svg.py');
  const localSvgPath = toLocalPath(svgPath);
  const reportPath = opts.reportPath
    ? toLocalPath(opts.reportPath)
    : getRepairReportPath(localSvgPath);

  const args = [
    scriptPath,
    localSvgPath,
    '-o',
    localSvgPath,
    '--report',
    reportPath,
    '--profile',
    String(opts.profile || 'ks'),
  ];

  if (opts.planPath) {
    args.push('--plan', toLocalPath(opts.planPath));
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
        const tail = `${stderr.slice(-500)} ${stdout.slice(-500)}`.trim();
        return reject(new Error(`postprocess_svg exited ${code}: ${tail}`));
      }
      resolveStdout(stdout);
    });
    proc.on('error', reject);
  });

  return {
    output: stdout.trim(),
    reportPath,
  };
}
