import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceDefinitions } from '../public/js/studio/workspaces.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

function confirmation(t, { mode, diagnostics, locale = 'en' }) {
  const restore = installDrawingTestDom();
  t.after(restore);
  setLocale(locale, { persist: false });
  const state = createStudioShellState();
  state.data.importBootstrap.preview = {
    bootstrap: {
      import_diagnostics: diagnostics,
      bootstrap_summary: { source: { analysis_mode: mode } },
    },
    tracked_review_seed: { model_path: 'output/imports/model.step', context_path: 'output/imports/context.json' },
  };
  state.data.importBootstrap.guidedFlow = { step: 'confirm' };
  return workspaceDefinitions.console.render(state).querySelector('[data-import-guided-step="confirm"]');
}

test('failed geometry in a metadata-only import is not described as readable or ready', (t) => {
  const node = confirmation(t, { mode: 'metadata_only_fallback', diagnostics: { partial_import: true, body_count: 0, fail_closed: false } });
  assert.doesNotMatch(node.textContent, /Can be read|Ready to begin/);
  assert.match(node.textContent, /geometry.*not.*verified|not.*verify.*geometry/i);
  assert.match(node.textContent, /metadata/i);
});

test('a fail-closed import cannot offer the Start review action', (t) => {
  const node = confirmation(t, { mode: 'runtime_backed', diagnostics: { fail_closed: true, empty_import: true } });
  assert.equal(node.querySelector('[data-action="submit-import-review"]').hasAttribute('disabled'), true);
});

test('verified runtime import retains readable status and Korean fallback copy is truthful', (t) => {
  const node = confirmation(t, { mode: 'runtime_backed', diagnostics: { body_count: 1, fail_closed: false } });
  assert.match(node.textContent, /Can be read/);
  const ko = confirmation(t, { mode: 'metadata_only_fallback', diagnostics: { body_count: 0 }, locale: 'ko' });
  assert.doesNotMatch(ko.textContent, /읽을 수 있음|시작 준비됨/);
  assert.match(ko.textContent, /형상|메타데이터/);
});
