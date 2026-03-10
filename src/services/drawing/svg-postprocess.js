import { spawn } from 'node:child_process';
import { join, parse, resolve } from 'node:path';

function isWindowsAbsolutePath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function toCanonicalWslPath(path, toWSL) {
  if (path.startsWith('/')) return resolve(path);
  if (isWindowsAbsolutePath(path)) return toWSL(path);
  return resolve(process.cwd(), path.replaceAll('\\', '/'));
}

function getRepairReportPath(svgWslPath) {
  const parsed = parse(svgWslPath);
  return join(parsed.dir, `${parsed.name}_repair_report.json`);
}

export async function postprocessSvg(freecadRoot, svgPath, opts = {}) {
  if (!svgPath || typeof svgPath !== 'string') {
    throw new Error('svgPath is required for postprocess_svg');
  }

  const { toWindows, toWSL, PYTHON_EXE_WSL } = await import(`${freecadRoot}/lib/paths.js`);
  const scriptWin = toWindows(join(freecadRoot, 'scripts', 'postprocess_svg.py'));
  const svgWslPath = toCanonicalWslPath(svgPath, toWSL);
  const svgWin = toWindows(svgWslPath);
  const reportWslPath = opts.reportPath
    ? toCanonicalWslPath(opts.reportPath, toWSL)
    : getRepairReportPath(svgWslPath);
  const reportWin = toWindows(reportWslPath);

  const args = [
    scriptWin,
    svgWin,
    '-o',
    svgWin,
    '--report',
    reportWin,
    '--profile',
    String(opts.profile || 'ks'),
  ];

  if (opts.planPath) {
    const planWsl = toCanonicalWslPath(opts.planPath, toWSL);
    args.push('--plan', toWindows(planWsl));
  }

  const stdout = await new Promise((resolveStdout, reject) => {
    const proc = spawn(PYTHON_EXE_WSL, args, {
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
    reportPath: reportWslPath,
  };
}
