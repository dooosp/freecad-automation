import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLocale } from '../public/js/i18n/index.js';
import { collectGeneratedArtifactGroups, mountArtifactsWorkspace, renderArtifactsWorkspace } from '../public/js/studio/artifacts-workspace.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

function artifact(type, overrides = {}) {
  const id = type.replaceAll('.', '-');
  return {
    id, type, file_name: `bracket_${type}`, extension: `.${type.split('.').at(-1)}`,
    scope: 'user-facing', exists: true,
    capabilities: { can_open: true, can_download: true },
    links: { open: `/artifacts/saved/${id}`, download: `/artifacts/saved/${id}/download` },
    ...overrides,
  };
}

async function mountResults(t, { artifacts, type = 'draw', result = {}, locale = 'en' }) {
  const restoreDom = installDrawingTestDom();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '{}' });
  setLocale(locale, { persist: false });
  const state = createStudioShellState();
  state.selectedJobId = 'saved';
  state.data.activeJob = {
    ...state.data.activeJob, status: 'ready', artifacts,
    summary: { id: 'saved', type, status: 'succeeded', result },
  };
  const root = renderArtifactsWorkspace(state);
  document.append(root);
  const controller = mountArtifactsWorkspace({ root, state, addLog() {} });
  t.after(() => {
    controller.destroy(); globalThis.fetch = originalFetch;
    setLocale('en', { persist: false }); restoreDom();
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { root, state, controller };
}

for (const [locale, title, note] of [
  ['en', 'Print drawing PDF', 'Print at Actual size / 100%; turn off Fit to page.'],
  ['ko', '인쇄용 도면 PDF', '실제 크기 / 100%로 인쇄하고, 페이지에 맞춤을 끄세요.'],
]) {
  test(`${locale} saved drawing PDF has a distinct print label and opens the public PDF`, async (t) => {
    const pdf = artifact('drawing.pdf');
    const { root } = await mountResults(t, {
      artifacts: [pdf, artifact('drawing.svg')], locale,
      result: { drawing_pdf_export: { status: 'succeeded', physical_width_mm: 297, physical_height_mm: 210 } },
    });
    const card = root.querySelector('[data-result-artifact-id="drawing-pdf"]');
    assert.equal(card.querySelector('.result-card-title').textContent, title);
    assert.equal(card.querySelector('[data-hook="drawing-pdf-print-note"]').textContent, note);
    const links = card.querySelectorAll('a');
    assert.equal(card.querySelector('[data-action-kind="primary"]').getAttribute('href'), pdf.links.open);
    assert.ok(links.some((link) => link.getAttribute('href') === pdf.links.download));
    assert.equal(card.querySelector('[data-action="resume-drawing-artifact"]'), null);
    assert.equal(root.querySelector('[data-hook="drawing-pdf-export-warning"]'), null);
  });
}

test('a report keeps its review PDF primary and the print drawing PDF separately in readable outputs', async (t) => {
  const { root } = await mountResults(t, {
    type: 'report', artifacts: [artifact('drawing.pdf'), artifact('report.pdf'), artifact('drawing.svg')],
    result: { drawing_result: { drawing_pdf_export: { status: 'succeeded' } } },
  });
  const primary = root.querySelector('[data-primary-result="true"]');
  assert.equal(primary.dataset.resultArtifactId, 'report-pdf');
  assert.equal(primary.querySelector('.result-card-title').textContent, 'Report');
  assert.equal(primary.querySelector('[data-hook="drawing-pdf-print-note"]'), null);
  const printCard = root.querySelector('[data-result-group="immediate"]').querySelector('[data-result-artifact-id="drawing-pdf"]');
  assert.equal(printCard.querySelector('.result-card-title').textContent, 'Print drawing PDF');
  assert.ok(printCard.querySelector('[data-hook="drawing-pdf-print-note"]'));
});

for (const [type, result] of [
  ['draw', { drawing_pdf_export: { status: 'failed', code: 'drawing_pdf_export_failed', message: 'DO NOT SHOW RAW /private/renderer-error' } }],
  ['report', { drawing_result: { drawing_pdf_export: { status: 'failed', code: 'drawing_pdf_export_failed' } } }],
]) {
  for (const [locale, warning] of [
    ['en', 'The SVG drawing is available, but the print PDF could not be exported.'],
    ['ko', 'SVG 도면은 사용할 수 있지만 인쇄용 PDF를 내보내지 못했습니다.'],
  ]) {
    test(`${locale} ${type} print export failure is visible without changing its quality result`, async (t) => {
      const { root } = await mountResults(t, {
        type, locale, artifacts: [artifact('drawing.svg')],
        result: { ...result, report_summary: { overall_status: 'pass' } },
      });
      const summary = root.querySelector('[data-hook="artifacts-result-summary"]');
      assert.equal(summary.querySelector('[data-hook="drawing-pdf-export-warning"]')?.textContent, warning);
      assert.match(summary.textContent, locale === 'en' ? /Passed/ : /통과/);
      assert.doesNotMatch(summary.textContent, /Quality failed|DO NOT SHOW RAW|\/private\/|품질 실패/);
      assert.equal(root.querySelector('[data-result-artifact-id="drawing-pdf"]'), null);
      assert.ok(root.querySelector('[data-result-artifact-id="drawing-svg"]'));
    });
  }
}

for (const [label, artifacts, result] of [
  ['legacy SVG without export metadata', [artifact('drawing.svg')], {}],
  ['ordinary report PDF', [artifact('report.pdf')], {}],
  ['untyped PDF whose filename looks like a drawing', [artifact('', { extension: '.pdf', file_name: 'bracket_drawing.pdf' })], {}],
]) {
  test(`${label} receives no print-scale promise or export failure warning`, async (t) => {
    const { root } = await mountResults(t, { artifacts, result });
    assert.equal(root.querySelector('[data-hook="drawing-pdf-print-note"]'), null);
    assert.equal(root.querySelector('[data-hook="drawing-pdf-export-warning"]'), null);
  });
}

test('drawing PDF actions respect public open and download capabilities', async (t) => {
  const pdf = artifact('drawing.pdf', { capabilities: { can_open: false, can_download: true } });
  const { root } = await mountResults(t, { artifacts: [pdf] });
  const card = root.querySelector('[data-result-artifact-id="drawing-pdf"]');
  assert.equal(card.querySelector('[data-action-kind="primary"]').getAttribute('href'), pdf.links.download);
  assert.ok(!card.querySelectorAll('a').some((link) => link.getAttribute('href') === pdf.links.open));
});

test('advanced generated downloads never mislabel a drawing PDF as the report', () => {
  const groups = collectGeneratedArtifactGroups([artifact('drawing.pdf'), artifact('report.pdf')]);
  assert.equal(groups.find((group) => group.id === 'reports').rows.find((row) => row.id === 'pdf-report')?.artifactId, 'report-pdf');
  const drawingOnlyGroups = collectGeneratedArtifactGroups([artifact('drawing.pdf')]);
  assert.equal(drawingOnlyGroups.find((group) => group.id === 'reports').rows.some((row) => row.id === 'pdf-report'), false);
});

for (const [locale, label, coverage] of [
  ['en', 'Quality blockers', 'Drawing evidence coverage is 80%'],
  ['ko', '품질 통과를 막는 문제', '도면 근거 연결률이 80%'],
]) {
  test(`${locale} results show canonical drawing blockers and clear them with the next result`, async (t) => {
    const { root, state, controller } = await mountResults(t, {
      locale, artifacts: [artifact('drawing.qa-report', { extension: '.json' }), artifact('drawing.svg', { capabilities: { can_open: false, can_download: true } })],
      result: {
        summary: { overall_status: 'pass', blocking_issues: ['stale generic blocker'] },
        drawing_quality: {
          status: 'fail', score: 89,
          traceability: { coverage_percent: 80, unmapped_required_entities: ['WIDTH', '', null] },
          blocking_issues: [
            { code: 'traceability-coverage', message: 'Traceability coverage is below the required threshold.' },
            { code: 'missing-dimension', message: 'Required diameter is missing.' },
            null,
          ],
        },
      },
    });
    const summary = root.querySelector('[data-hook="artifacts-result-summary"]');
    assert.ok(summary.textContent.includes(label), summary.textContent);
    assert.ok(summary.textContent.includes(coverage), summary.textContent);
    assert.match(summary.textContent, /WIDTH/);
    assert.match(summary.textContent, /Required diameter is missing\./);
    assert.doesNotMatch(summary.textContent, /stale generic blocker/);
    assert.match(summary.textContent, locale === 'en' ? /Failed/ : /실패/);
    assert.equal(summary.querySelector('[data-primary-result="true"]').dataset.resultArtifactId, 'drawing-svg');

    state.data.activeJob.summary.result.drawing_quality = {
      status: 'pass', traceability: { coverage_percent: 100, unmapped_required_entities: [] }, blocking_issues: [],
    };
    controller.syncFromShell();
    assert.match(summary.textContent, locale === 'en' ? /Passed/ : /통과/);
    assert.doesNotMatch(summary.textContent, /WIDTH|80%|Required diameter|stale generic blocker/);
    assert.equal(summary.textContent.includes(label), false);
  });
}

test('create results surface canonical string blockers without changing execution success', async (t) => {
  const { root } = await mountResults(t, {
    type: 'create', artifacts: [artifact('model.step')],
    result: { summary: { overall_status: 'pass' }, create_quality: { status: 'fail', blocking_issues: ['STEP round-trip failed.'] } },
  });
  const summary = root.querySelector('[data-hook="artifacts-result-summary"]');
  assert.match(summary.textContent, /Quality blockers/);
  assert.match(summary.textContent, /STEP round-trip failed\./);
  assert.match(summary.textContent, /Completed/);
  assert.match(summary.textContent, /Failed/);
});
