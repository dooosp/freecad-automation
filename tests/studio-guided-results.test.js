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

const catalogExamples = ['quality_fail_wrong_hole_center', 'hinge_block', 'reviewer_feedback_runtime_probe', 'pcb_mount_plate', 'quality_pass_bracket']
  .map((id) => ({ id, name: `${id}.toml`, content: `name = "${id}"` }));

test('guided examples start with the verified bracket while advanced editing retains the complete catalog', (t) => {
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  const state = createStudioShellState();
  state.data.examples = { status: 'ready', items: catalogExamples, selectedId: 'quality_fail_wrong_hole_center' };
  const root = workspaceDefinitions.model.render(state);
  const guided = root.querySelector('[data-hook="guided-example-select"]');
  assert.deepEqual(guided.children.map((option) => option.getAttribute('value')), ['quality_pass_bracket', 'hinge_block']);
  assert.equal(guided.children.find((option) => option.hasAttribute('selected')).getAttribute('value'), 'quality_pass_bracket');
  assert.doesNotMatch(guided.textContent, /\.toml|quality_fail|runtime_probe/);
  assert.deepEqual(root.querySelector('[data-hook="example-select"]').children.map((option) => option.getAttribute('value')), catalogExamples.map((example) => example.id));
  assert.equal(state.data.examples.selectedId, 'quality_fail_wrong_hole_center', 'rendering must not overwrite an advanced selection');
  assert.match(root.querySelector('[data-hook="guided-example-outputs"]').textContent, /3D.*CAD.*drawing.*PDF/);
  assert.match(root.querySelector('[data-hook="guided-example-config"]').textContent, /quality_pass_bracket\.toml/);
  assert.ok(root.querySelector('[data-hook="guided-browse-examples"]'));
});

test('guided examples preserve a recommended choice and give Korean descriptions', (t) => {
  t.after(installDrawingTestDom());
  t.after(() => setLocale('en', { persist: false }));
  setLocale('ko', { persist: false });
  const state = createStudioShellState();
  state.data.examples = { status: 'ready', items: catalogExamples, selectedId: 'hinge_block' };
  const root = workspaceDefinitions.model.render(state);
  const guided = root.querySelector('[data-hook="guided-example-select"]');
  assert.equal(guided.children.find((option) => option.hasAttribute('selected')).getAttribute('value'), 'hinge_block');
  assert.match(guided.textContent, /힌지/);
  assert.match(root.querySelector('[data-hook="guided-example-description"]').textContent, /힌지/);
  assert.match(root.querySelector('[data-hook="guided-example-outputs"]').textContent, /도면/);
});

test('missing recommended examples never silently selects a failure or probe config', (t) => {
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  const state = createStudioShellState();
  state.data.examples = { status: 'ready', items: [catalogExamples[0], catalogExamples[2]], selectedId: catalogExamples[0].id };
  const root = workspaceDefinitions.model.render(state);
  const guided = root.querySelector('[data-hook="guided-example-select"]');
  assert.equal(guided.getAttribute('disabled'), 'true');
  assert.deepEqual(guided.children.map((option) => option.getAttribute('value')), ['']);
  assert.match(root.querySelector('[data-hook="guided-example-description"]').textContent, /recommended examples.*unavailable/i);
  assert.equal(root.querySelector('[data-hook="example-select"]').children.length, 2);
});
