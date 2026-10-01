import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLocale } from '../public/js/i18n/index.js';
import { createStudioShellDomController } from '../public/js/studio/studio-shell-dom.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

function semanticNotice() {
  const destinationCopy = 'Open Result files to inspect generated files and quality outputs.';
  return {
    jobId: 'report-123456789',
    tone: 'warn',
    title: 'Tracked report completed',
    titleKey: 'studio.completion.succeeded',
    partName: 'quality_pass_bracket',
    destinationKey: 'studio.completion.destination-results',
    destinationCopy,
    messageParts: ['Job succeeded.', 'Quality failed.', destinationCopy],
    actions: [{
      label: 'Open Artifacts',
      labelKey: 'studio.completion.open-results',
      action: 'open-job',
      tone: 'primary',
      jobId: 'report-123456789',
      route: 'artifacts',
    }],
  };
}

function completionFixture(t, notice = semanticNotice()) {
  const restoreDom = installDrawingTestDom();
  t.after(() => { setLocale('en', { persist: false }); restoreDom(); });
  setLocale('en', { persist: false });
  const host = document.createElement('section');
  // The shared lightweight adapter omits these two native DOM behaviors.
  Object.defineProperty(host, 'firstElementChild', { get: () => host.children[0] || null });
  const removeAttribute = host.removeAttribute.bind(host);
  host.removeAttribute = (name) => {
    removeAttribute(name);
    if (name === 'data-i18n-preserve') delete host.dataset.i18nPreserve;
  };
  document.append(host);
  const app = { document, elements: { completionNoticeHost: host }, state: { data: { completionNotice: notice } } };
  const controller = createStudioShellDomController(app);
  return { app, host, render: controller.renderCompletionNotice };
}

test('completion locale changes preserve run identity, result action, and failed quality evidence', (t) => {
  const { host, render } = completionFixture(t);
  for (const expected of [
    {
      locale: 'en', title: 'Run completed', context: 'Run: quality_pass_bracket · report-1',
      destination: 'Open Result files to inspect generated files and quality outputs.',
      action: 'Open Result files', quality: 'Quality failed.', falsePass: 'Quality passed.',
    },
    {
      locale: 'ko', title: '실행 완료', context: '실행: quality_pass_bracket · report-1',
      destination: '생성 파일과 품질 출력을 확인하려면 결과 파일을 여세요.',
      action: '결과 파일 열기', quality: '품질 실패.', falsePass: '품질 통과.',
    },
  ]) {
    setLocale(expected.locale, { persist: false });
    render();
    assert.equal(host.querySelector('.completion-notice-title').textContent, expected.title);
    assert.equal(host.querySelector('.completion-notice-context')?.textContent, expected.context);
    const messages = host.querySelectorAll('.completion-notice-message').map((node) => node.textContent);
    assert.ok(messages.includes(expected.destination));
    assert.ok(messages.includes(expected.quality));
    assert.ok(!messages.includes(expected.falsePass));
    assert.equal(host.firstElementChild.dataset.tone, 'warn');
    const action = host.querySelector('[data-action="open-job"]');
    assert.equal(action.textContent, expected.action);
    assert.equal(action.dataset.jobId, 'report-123456789');
    assert.equal(action.dataset.route, 'artifacts');
  }
});

test('completion without a known part explicitly renders unknown part in the active locale', (t) => {
  const { host, render } = completionFixture(t, { ...semanticNotice(), partName: '' });
  setLocale('ko', { persist: false });
  render();
  assert.equal(host.querySelector('.completion-notice-context')?.textContent, '실행: 부품 정보 없음 · report-1');
  assert.ok(!host.textContent.includes('undefined'));
});

test('semantic completion changes invalidate cached content even when fallback strings stay unchanged', (t) => {
  const notice = semanticNotice();
  notice.actions[0].labelKey = '';
  const { host, render } = completionFixture(t, notice);
  render();
  const unchanged = host.firstElementChild;
  render();
  assert.equal(host.firstElementChild, unchanged);

  notice.partName = 'hinge_block';
  render();
  assert.equal(host.querySelector('.completion-notice-context')?.textContent, 'Run: hinge_block · report-1');

  notice.titleKey = 'studio.completion.failed';
  render();
  assert.equal(host.querySelector('.completion-notice-title').textContent, 'Run failed');

  notice.destinationKey = 'studio.completion.destination-review';
  render();
  assert.ok(host.textContent.includes('Open Review for decision context or Result files for generated files.'));

  notice.actions[0].labelKey = 'studio.completion.open-results';
  render();
  assert.equal(host.querySelector('[data-action="open-job"]').textContent, 'Open Result files');
});

test('legacy notices retain their title, message, and primary result action', (t) => {
  const { host, render } = completionFixture(t, {
    jobId: 'legacy-1234', tone: 'info', title: 'Legacy completion',
    message: 'Saved report is ready.', primaryRoute: 'artifacts', primaryLabel: 'Open saved report',
  });
  render();
  assert.equal(host.querySelector('.completion-notice-title').textContent, 'Legacy completion');
  assert.ok(host.querySelectorAll('.completion-notice-message').some((node) => node.textContent === 'Saved report is ready.'));
  const action = host.querySelector('[data-action="open-job"]');
  assert.equal(action.textContent, 'Open saved report');
  assert.equal(action.dataset.route, 'artifacts');
  assert.equal(action.dataset.jobId, 'legacy-1234');
});
