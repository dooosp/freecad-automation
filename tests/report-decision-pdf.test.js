import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runPythonJsonScript } from '../lib/context-loader.js';
import { buildDecisionReportSummary } from '../src/services/report/decision-report-summary.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-report-pdf-'));

try {
  const matplotlibProbe = spawnSync('python3', ['-c', 'import matplotlib'], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  if (matplotlibProbe.status !== 0) {
    console.log('report-decision-pdf.test.js: skipped (python3 matplotlib unavailable)');
    process.exit(0);
  }

  const summary = buildDecisionReportSummary({
    configPath: join(TMP_DIR, 'partial.toml'),
    config: {
      name: 'decision_pdf_partial',
    },
    reportPdfPath: join(TMP_DIR, 'decision_pdf_partial_report.pdf'),
    reportGeneratedAt: '2026-04-20T02:00:00.000Z',
    repoContext: {
      branch: 'feat/decision-report-upgrade',
      headSha: 'abc123def456',
    },
    runtimeInfo: {
      mode: 'unknown',
      available: false,
    },
    createQuality: null,
    drawingQuality: null,
    dfm: null,
    fem: null,
    tolerance: null,
  });

  const result = await runPythonJsonScript(ROOT, 'scripts/engineering_report.py', {
    name: 'decision_pdf_partial',
    export: {
      directory: TMP_DIR,
    },
    _decision_summary: summary,
    _report_artifacts: {
      report_pdf: {
        key: 'report_pdf',
        label: 'Engineering report PDF',
        path: join(TMP_DIR, 'decision_pdf_partial_report.pdf'),
        status: 'generated',
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(existsSync(result.path), true);
  assert.equal(result.size_bytes > 0, true);
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('report-decision-pdf.test.js: ok');
