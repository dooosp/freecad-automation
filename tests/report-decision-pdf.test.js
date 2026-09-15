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

  const koreanFontProbe = spawnSync('python3', [
    '-c',
    "import sys; sys.path.insert(0, 'scripts'); from _report_styles import get_font; print(get_font('ko'))",
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(koreanFontProbe.status, 0);
  const expectedKoreanFont = koreanFontProbe.stdout.trim() || 'sans-serif';
  const koreanName = 'USB 허브 판 150';
  const koreanSummary = {
    ...summary,
    config_name: koreanName,
    input_config: join(TMP_DIR, `${koreanName}.toml`),
  };
  const koreanResult = await runPythonJsonScript(ROOT, 'scripts/engineering_report.py', {
    name: koreanName,
    export: {
      directory: TMP_DIR,
    },
    _decision_summary: koreanSummary,
    _report_artifacts: [],
  });

  assert.equal(koreanResult.success, true);
  assert.equal(koreanResult.report_language, 'ko');
  assert.equal(koreanResult.font_family, expectedKoreanFont);
  assert.equal(
    koreanResult.font_support,
    expectedKoreanFont === 'sans-serif' ? 'fallback' : 'native'
  );
  assert.equal(existsSync(koreanResult.path), true);

  if (expectedKoreanFont !== 'sans-serif') {
    const pdfFonts = spawnSync('pdffonts', [koreanResult.path], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
    });
    if (pdfFonts.status === 0) {
      const normalizedFontOutput = pdfFonts.stdout.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedExpectedFont = expectedKoreanFont.toLowerCase().replace(/[^a-z0-9]/g, '');
      assert.equal(normalizedFontOutput.includes(normalizedExpectedFont), true);
      assert.equal(pdfFonts.stdout.includes('Type 3'), false);
    }

    const pdfText = spawnSync('pdftotext', [koreanResult.path, '-'], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
    });
    if (pdfText.status === 0) {
      assert.equal(pdfText.stdout.includes(koreanName), true);
    }
  }

  assert.equal(result.report_language, 'en');
  assert.equal(result.font_family, 'sans-serif');
  assert.equal(result.font_support, 'default');

  const templateFontProbe = spawnSync('python3', [
    '-c',
    [
      'import json, sys',
      "sys.path.insert(0, 'scripts')",
      'from matplotlib import font_manager',
      'from matplotlib.ft2font import FT2Font',
      'from _report_styles import apply_style',
      "sample = 'USB 허브 판 150'",
      "available = sorted({entry.name for entry in font_manager.fontManager.ttflist})",
      'def supports(name):',
      '    try:',
      "        path = font_manager.findfont(font_manager.FontProperties(family=[name]), fallback_to_default=False)",
      '        face = FT2Font(path)',
      '        return all(face.get_char_index(ord(char)) for char in sample if ord(char) > 127)',
      '    except Exception:',
      '        return False',
      "capable = next((name for name in available if supports(name)), None)",
      "capable_style = apply_style({'language': 'ko', 'style': {'font': capable}}, {'name': sample}) if capable else None",
      "print(json.dumps({'capable': capable, 'capable_style': capable_style}))",
    ].join('\n'),
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(templateFontProbe.status, 0, templateFontProbe.stderr);
  const templateFonts = JSON.parse(templateFontProbe.stdout.trim());
  if (templateFonts.capable) {
    assert.equal(templateFonts.capable_style.font_family, templateFonts.capable);
  }

  const restrictedFontProbe = spawnSync('python3', [
    '-c',
    [
      'import json, sys',
      "sys.path.insert(0, 'scripts')",
      'from matplotlib import font_manager, rcParams, rcParamsDefault',
      'from _report_styles import apply_style',
      "sample = 'USB 허브 판 150'",
      "font_manager.fontManager.ttflist = [entry for entry in font_manager.fontManager.ttflist if entry.name == 'DejaVu Sans']",
      "if not font_manager.fontManager.ttflist: raise RuntimeError('bundled DejaVu Sans unavailable')",
      "incapable_style = apply_style({'language': 'ko', 'style': {'font': 'DejaVu Sans'}}, {'name': sample})",
      "missing_style = apply_style({'language': 'ko', 'style': {'font': '__missing_font__'}}, {'name': sample})",
      "korean_pdf_fonttype = rcParams['pdf.fonttype']",
      "english_style = apply_style({'language': 'en', 'style': {'font': 'DejaVu Sans'}}, {'name': 'USB hub plate 150'})",
      "print(json.dumps({'incapable_style': incapable_style, 'missing_style': missing_style, 'korean_pdf_fonttype': korean_pdf_fonttype, 'english_pdf_fonttype': rcParams['pdf.fonttype'], 'default_pdf_fonttype': rcParamsDefault['pdf.fonttype'], 'english_style': english_style}))",
    ].join('\n'),
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(restrictedFontProbe.status, 0, restrictedFontProbe.stderr);
  const restrictedFonts = JSON.parse(restrictedFontProbe.stdout.trim());
  assert.equal(restrictedFonts.incapable_style.font_family, 'sans-serif');
  assert.equal(restrictedFonts.incapable_style.font_support, 'fallback');
  assert.equal(restrictedFonts.missing_style.font_family, 'sans-serif');
  assert.equal(restrictedFonts.missing_style.font_support, 'fallback');
  assert.equal(restrictedFonts.korean_pdf_fonttype, 42);
  assert.equal(restrictedFonts.english_pdf_fonttype, restrictedFonts.default_pdf_fonttype);
  assert.equal(restrictedFonts.english_style.font_family, 'DejaVu Sans');

  const missingKoreanFontProbe = spawnSync('python3', [
    '-c',
    [
      'import json, sys',
      "sys.path.insert(0, 'scripts')",
      'from _report_styles import apply_style, font_manager',
      'font_manager.fontManager.ttflist = []',
      "print(json.dumps(apply_style(content={'name': 'USB 허브 판 150'})))",
    ].join('; '),
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(missingKoreanFontProbe.status, 0);
  const fallbackStyle = JSON.parse(missingKoreanFontProbe.stdout.trim());
  assert.equal(fallbackStyle.font_language, 'ko');
  assert.equal(fallbackStyle.font_family, 'sans-serif');
  assert.equal(fallbackStyle.font_support, 'fallback');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('report-decision-pdf.test.js: ok');
