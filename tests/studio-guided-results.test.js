import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceDefinitions } from '../public/js/studio/workspaces.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';
import { deriveResultFileAction } from '../public/js/studio/result-files.js';

test('generated preview provides a discoverable save continuation', (t) => {
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  const state = createStudioShellState();
  state.data.model.buildState = 'success';
  state.data.model.preview = { id: 'preview' };
  const result = workspaceDefinitions.model.render(state).querySelector('[data-model-guided-step="result"]');
  assert.ok(result.querySelector('[data-action="model-guided-save-result"]'));
  assert.match(result.textContent, /save/i);
});

test('the primary PDF action opens its allowed content rather than generic metadata', (t) => {
  const artifact = { id: 'report-pdf', type: 'review-pack.pdf', file_name: 'review.pdf', extension: '.pdf',
    exists: true, capabilities: { can_open: true, can_download: true },
    links: { open: '/artifacts/job/report-pdf', download: '/artifacts/job/report-pdf/download' } };
  const action = deriveResultFileAction(artifact);
  assert.equal(action.kind, 'open');
  assert.equal(action.href, '/artifacts/job/report-pdf');
  artifact.capabilities = { can_open: false, can_download: false };
  assert.equal(deriveResultFileAction(artifact).kind, 'details');
  assert.equal(deriveResultFileAction(artifact).href, '');
});
