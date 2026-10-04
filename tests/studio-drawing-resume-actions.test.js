import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLocale } from '../public/js/i18n/index.js';
import { mountArtifactsWorkspace, renderArtifactsWorkspace } from '../public/js/studio/artifacts-workspace.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

function savedArtifact(overrides = {}) {
  return {
    id: 'saved-drawing', type: 'drawing.svg', file_name: 'bracket_drawing.svg', extension: '.svg',
    scope: 'user-facing', exists: true,
    capabilities: { can_open: false, can_download: true },
    links: { open: '/artifacts/job-saved/saved-drawing', download: '/artifacts/job-saved/saved-drawing/download' },
    ...overrides,
  };
}

async function renderDetail(t, artifact, locale = 'en', jobId = 'job-saved', otherArtifacts = []) {
  const restoreDom = installDrawingTestDom();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '{}' });
  setLocale(locale, { persist: false });
  const state = createStudioShellState();
  state.selectedJobId = jobId;
  state.data.activeJob = {
    ...state.data.activeJob,
    status: 'ready', summary: jobId ? { id: jobId, type: 'draw', status: 'succeeded' } : null,
    artifacts: [...otherArtifacts, artifact],
  };
  state.data.artifactsWorkspace.selectedArtifactId = artifact.id;
  const root = renderArtifactsWorkspace(state);
  document.append(root);
  const controller = mountArtifactsWorkspace({ root, state, addLog() {} });
  t.after(() => { controller.destroy(); globalThis.fetch = originalFetch; setLocale('en', { persist: false }); restoreDom(); });
  await new Promise((resolve) => setImmediate(resolve));
  return { root, actions: root.querySelector('[data-hook="artifacts-detail-actions"]') };
}

for (const [type, extension] of [['drawing.svg', '.svg'], ['draw.plan.toml', '.toml'], ['draw.plan.json', '.json']]) {
  for (const [locale, label] of [['en', 'Continue editing drawing'], ['ko', '도면 이어서 편집']]) {
    test(`${locale} ${type} details offer drawing continuation with only the registered reference`, async (t) => {
      const artifact = savedArtifact({ type, extension, file_name: `bracket_drawing${extension}` });
      const { actions } = await renderDetail(t, artifact, locale);
      const button = actions.querySelector('[data-action="resume-drawing-artifact"]');
      assert.ok(button, 'A supported saved drawing needs a continuation action');
      assert.equal(button.textContent, label);
      assert.deepEqual({ ...button.dataset }, {
        action: 'resume-drawing-artifact', jobId: 'job-saved', artifactId: 'saved-drawing',
      });
      assert.ok(actions.querySelectorAll('a').some((link) => link.getAttribute('href') === artifact.links.download));
      assert.ok(!actions.querySelectorAll('a').some((link) => link.getAttribute('href') === artifact.links.open));
    });
  }
}

for (const [label, overrides] of [
  ['missing drawing', { exists: false }],
  ['unverified existence', { exists: undefined }],
  ['internal drawing', { scope: 'internal' }],
  ['unspecified scope', { scope: undefined }],
  ['unsupported artifact with an SVG filename', { type: 'report.pdf' }],
]) {
  test(`${label} details do not offer drawing continuation`, async (t) => {
    const { root, actions } = await renderDetail(t, savedArtifact(overrides));
    assert.equal(actions.querySelector('[data-action="resume-drawing-artifact"]'), null);
    assert.equal(root.querySelector('[data-hook="artifacts-result-summary"]').querySelector('[data-action="resume-drawing-artifact"]'), null);
  });
}

test('drawing continuation is absent when no tracked job owns the selected artifact', async (t) => {
  const { actions } = await renderDetail(t, savedArtifact(), 'en', '');
  assert.equal(actions.querySelector('[data-action="resume-drawing-artifact"]'), null);
});

for (const [placement, otherArtifacts] of [
  ['primary result', []],
  ['additional file group', [{
    id: 'report-pdf', type: 'report.pdf', file_name: 'report.pdf', extension: '.pdf',
    scope: 'user-facing', exists: true, capabilities: { can_open: true, can_download: true },
    links: { open: '/artifacts/job-saved/report-pdf', download: '/artifacts/job-saved/report-pdf/download' },
  }]],
]) {
  test(`saved SVG ${placement} offers keyboard-reachable continuation in its More menu`, async (t) => {
    const { root } = await renderDetail(t, savedArtifact(), 'en', 'job-saved', otherArtifacts);
    const region = root.querySelector(`[data-hook="${placement === 'primary result' ? 'artifacts-result-summary' : 'artifacts-result-groups'}"]`);
    const card = region.querySelector('[data-result-artifact-id="saved-drawing"]');
    assert.ok(card);
    const trigger = card.querySelector('.overflow-menu-trigger');
    const resume = card.querySelector('[data-action="resume-drawing-artifact"]');
    assert.ok(resume, 'The saved SVG card must expose continuation without opening advanced details');
    trigger.focus();
    trigger.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(card.querySelector('.overflow-menu-popover').hidden, false);
    assert.equal(document.activeElement, resume);
    assert.equal(resume.textContent, 'Continue editing drawing');
    assert.equal(resume.dataset.jobId, 'job-saved');
    assert.equal(resume.dataset.artifactId, 'saved-drawing');
    assert.equal(resume.getAttribute('href'), null);
    assert.equal(resume.dataset.artifactPath, undefined);
  });
}
