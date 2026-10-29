import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runPythonJsonScript } from '../lib/context-loader.js';
import { buildDecisionReportSummary } from '../src/services/report/decision-report-summary.js';

const ROOT = resolve(import.meta.dirname, '..');
const PYTHON_COMMAND = process.env.PYTHON || process.env.PYTHON3 || 'python3';
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-report-pdf-'));

try {
  const matplotlibProbe = spawnSync(PYTHON_COMMAND, ['-c', 'import matplotlib'], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(matplotlibProbe.status, 0, [
    `PDF report checks require matplotlib in the selected Python: ${PYTHON_COMMAND}.`,
    'Install .github/requirements/ci-report.txt in a repo-local virtual environment',
    'and set PYTHON to its Python executable. See docs/testing.md for setup commands.',
    matplotlibProbe.error?.message || matplotlibProbe.stderr,
  ].join('\n'));

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
  }, { pythonCommand: PYTHON_COMMAND });

  assert.equal(result.success, true);
  assert.equal(existsSync(result.path), true);
  assert.equal(result.size_bytes > 0, true);

  const koreanFontProbe = spawnSync(PYTHON_COMMAND, [
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
  }, { pythonCommand: PYTHON_COMMAND });

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

  const templateFontProbe = spawnSync(PYTHON_COMMAND, [
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

  const restrictedFontProbe = spawnSync(PYTHON_COMMAND, [
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

  const missingKoreanFontProbe = spawnSync(PYTHON_COMMAND, [
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

  const headerLayoutProbe = spawnSync(PYTHON_COMMAND, [
    '-c',
    [
      'import json, sys',
      "sys.path.insert(0, 'scripts')",
      'from matplotlib.backends.backend_pdf import PdfPages',
      'from engineering_report import generate_legacy_report',
      'headers = []',
      'contexts = []',
      'dfm_counts = []',
      'savefig = PdfPages.savefig',
      'def inspect_header(pdf, figure, *args, **kwargs):',
      '    figure.canvas.draw()',
      '    renderer = figure.canvas.get_renderer()',
      '    title = figure._suptitle',
      "    subtitles = [text for text in figure.texts if text.get_text().startswith(('Generated:', 'Process:'))]",
      '    assert title is not None and len(subtitles) == 1',
      '    title_box = title.get_window_extent(renderer)',
      '    subtitle_box = subtitles[0].get_window_extent(renderer)',
      '    section_boxes = [axis._left_title.get_window_extent(renderer) for axis in figure.axes if axis._left_title.get_text()]',
      "    headers.append({'language': language, 'title': title.get_text(), 'gap_points': (title_box.y0 - subtitle_box.y1) * 72 / figure.dpi, 'section_gap_points': (subtitle_box.y0 - max(box.y1 for box in section_boxes)) * 72 / figure.dpi})",
      '    for axis in figure.axes:',
      "        if axis.get_title(loc='left') == 'DFM Score':",
      "            counts = next(text for text in axis.texts if text.get_text().startswith('Errors:'))",
      '            box = counts.get_window_extent(renderer)',
      '            bounds = axis.get_window_extent(renderer)',
      "            dfm_counts.append({'language': language, 'inside_panel': bool(bounds.contains(box.x0, box.y0) and bounds.contains(box.x1, box.y1)),",
      "                'section_overlaps': [other.get_title(loc='left') for other in figure.axes if other.get_title(loc='left') and box.overlaps(other._left_title.get_window_extent(renderer))],",
      "                'tick_overlaps': [tick.get_text() for tick in axis.get_xticklabels() if box.overlaps(tick.get_window_extent(renderer))],",
      "                'bar_overlaps': [index for index, bar in enumerate(axis.patches) if box.overlaps(bar.get_window_extent(renderer))]})",
      "        if axis.get_title(loc='left') != 'Run Context': continue",
      '        bounds = axis.get_window_extent(renderer)',
      '        overflow = []',
      '        text_boxes = [(text.get_text(), text.get_window_extent(renderer)) for text in axis.texts]',
      '        for text, box in text_boxes:',
      '            if box.y0 < bounds.y0 or box.y1 > bounds.y1: overflow.append(text)',
      '        overlaps = [(text, other_text) for index, (text, box) in enumerate(text_boxes) for other_text, other_box in text_boxes[index + 1:] if box.overlaps(other_box)]',
      "        contexts.append({'language': language, 'overflow': overflow, 'overlaps': overlaps, 'texts': [text for text, _ in text_boxes]})",
      '    return savefig(pdf, figure, *args, **kwargs)',
      'PdfPages.savefig = inspect_header',
      'reports = []',
      "for language, name in [('en', 'Header layout'), ('ko', '헤더 레이아웃')]:",
      '    reports.append(generate_legacy_report({',
      "        'name': name, 'export': {'directory': sys.argv[1]},",
      "        '_decision_summary': {'config_name': name, 'overall_status': 'incomplete',",
      "            'input_config': '/validation/long-report-output-directory/header-layout-validation-configuration.toml',",
      "            'git_commit': '0123456789abcdef0123456789abcdef01234567',",
      "            'git_branch': 'codex/mega-studio-api-contract-fuzz-audit'},",
      "        'dfm_results': {'checks': [], 'score': 100, 'process': 'milling', 'material': 'aluminum'},",
      '    }))',
      "print(json.dumps({'headers': headers, 'contexts': contexts, 'dfm_counts': dfm_counts, 'reports': reports}))",
    ].join('\n'),
    TMP_DIR,
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(headerLayoutProbe.status, 0, headerLayoutProbe.stderr);
  const headerLayout = JSON.parse(headerLayoutProbe.stdout.trim());
  assert.deepEqual(headerLayout.headers.map(({ language, title }) => [language, title]), [
    ['en', 'Executive Decision Summary'],
    ['en', 'Engineering Report: Header layout'],
    ['en', 'DFM Analysis: Header layout'],
    ['ko', 'Executive Decision Summary'],
    ['ko', 'Engineering Report: 헤더 레이아웃'],
    ['ko', 'DFM Analysis: 헤더 레이아웃'],
  ]);
  for (const header of headerLayout.headers) {
    assert(header.gap_points > 0,
      `${header.language} ${header.title}: title overlaps subtitle by ${-header.gap_points.toFixed(2)} pt`);
    assert(header.section_gap_points > 0,
      `${header.language} ${header.title}: subtitle overlaps section heading by ${-header.section_gap_points.toFixed(2)} pt`);
  }
  assert.deepEqual(headerLayout.contexts.map(({ language }) => language), ['en', 'ko']);
  for (const context of headerLayout.contexts) {
    assert.deepEqual(context.overflow, [], `${context.language} Run Context clips metadata`);
    assert.deepEqual(context.overlaps, [], `${context.language} Run Context has overlapping metadata`);
    assert(context.texts.includes('Optional missing'));
    assert(context.texts.includes('none'));
  }
  assert.deepEqual(headerLayout.dfm_counts.map(({ language }) => language), ['en', 'ko']);
  for (const counts of headerLayout.dfm_counts) {
    assert.deepEqual(counts.section_overlaps, [], `${counts.language} DFM counts overlap section headings`);
    assert.deepEqual(counts.tick_overlaps, [], `${counts.language} DFM counts overlap chart ticks`);
    assert.deepEqual(counts.bar_overlaps, [], `${counts.language} DFM counts overlap score bars`);
    assert.equal(counts.inside_panel, true, `${counts.language} DFM counts leave the score panel`);
  }
  for (const report of headerLayout.reports) {
    assert.equal(report.success, true);
    assert.equal(existsSync(report.path), true);
    assert(report.size_bytes > 0);
  }
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('report-decision-pdf.test.js: ok');
