import { drawingInputSnapshot } from '../public/js/studio/workbench-presentation.js';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createDrawingRenderer } from '../public/js/app/drawing.js';
import { createViewerStore } from '../public/js/app/store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { TestElement, installDrawingTestDom, drawingWorkspaceRoot } from './helpers/drawing-test-dom.js';

// Keep the real workspace and drawing controller. The browser barrel also
// exports unrelated WebGL modules whose import map only exists in the browser.
const barrel = new URL('../public/js/app/index.js', import.meta.url).href;
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url === barrel) return { format: 'module', shortCircuit: true, source: "export { createDrawingRenderer } from './drawing.js'; export { createViewerStore } from './store.js';" };
  return nextLoad(url, context);
} });
const { mountDrawingWorkspace } = await import('../public/js/studio/drawing-workspace.js');
hooks.deregister();

const edit = { dimId: 'WIDTH', oldValue: 142, newValue: 150 };
function key(target, key = 'z', extra = {}) {
  const event = { target, key, ctrlKey: true, preventDefault() { this.defaultPrevented = true; }, ...extra };
  document.dispatch('keydown', event);
  return event;
}
function setupRenderer(t, index = 0) {
  const restoreDom = installDrawingTestDom();
  const state = createViewerStore().state;
  state.dimensions.history = [structuredClone(edit)];
  state.dimensions.index = index;
  state.drawing.lastPlanPath = 'preview-A';
  const overlay = new TestElement();
  overlay.classList.add('open');
  const updates = [];
  const renderer = createDrawingRenderer({ state, drawingOverlayElement: overlay, drawingContainerElement: new TestElement(), drawingBomElement: new TestElement(), sendDimensionUpdate: (update) => updates.push(update) });
  t.after(() => { renderer.destroy(); restoreDom(); });
  return { state, updates, renderer, overlay };
}

for (const kind of ['input', 'textarea', 'contenteditable descendant']) {
  test(`native undo/redo in ${kind} never changes the saved sheet`, (t) => {
    const { state, updates } = setupRenderer(t);
    const target = new TestElement(kind === 'contenteditable descendant' ? 'span' : kind);
    if (kind === 'contenteditable descendant') { const parent = new TestElement(); parent.setAttribute('contenteditable', 'true'); parent.append(target); }
    for (const [pressed, shiftKey] of [['z', false], ['y', false], ['Z', true]]) {
      const event = key(target, pressed, { shiftKey });
      assert.equal(updates.length, 0, 'typing undo must not send an annotation update');
      assert.equal(event.defaultPrevented, undefined, 'native input undo remains available');
      assert.equal(state.dimensions.pending, null);
    }
  });
}

test('canvas undo and uppercase Shift+Z redo use the same plan and values', (t) => {
  const { state, updates, renderer } = setupRenderer(t);
  const canvas = new TestElement();
  assert.equal(key(canvas).defaultPrevented, true);
  assert.equal(updates[0].historyOp, 'undo');
  assert.equal(updates[0].valueMm, 142);
  assert.equal(updates[0].planPath, 'preview-A');
  renderer.handleDimensionUpdated({ history_op: 'undo' });
  assert.equal(state.dimensions.index, -1);
  assert.equal(key(canvas, 'Z', { ctrlKey: false, metaKey: true, shiftKey: true }).defaultPrevented, true);
  assert.equal(updates[1].historyOp, 'redo');
  assert.equal(updates[1].valueMm, 150);
  renderer.handleDimensionUpdated({ history_op: 'redo' });
  assert.equal(state.dimensions.index, 0);
});

function setupWorkspace(t, index = 0) {
  const restoreDom = installDrawingTestDom();
  setLocale('en', { persist: false });
  const preview = { id: 'A', preview_reference: 'preview-A', svg: '<svg viewBox="0 0 400 300"/>', drawn_at: '2026-01-01', dimensions: [] };
  const state = { connectionState: 'connected', data: { drawing: { status: 'ready', preview, history: [structuredClone(edit)], historyIndex: index }, health: { available: true }, model: { configText: '[model]' }, recentJobs: { items: [] } } };
  state.data.drawing.settings = { views: ['front', 'top', 'right', 'iso'], scale: 'auto', section_assist: false, detail_assist: false };
  state.data.drawing.previewInputSnapshot = drawingInputSnapshot(state.data.model, state.data.drawing.settings);
  const mounts = [];
  function mount() {
    const root = drawingWorkspaceRoot();
    const workspace = mountDrawingWorkspace({ root, state, addLog() {} });
    mounts.push(workspace);
    return { root, workspace };
  }
  t.after(() => { mounts.forEach((workspace) => workspace.destroy()); setLocale('en', { persist: false }); restoreDom(); });
  return { state, mount };
}

test('workspace remount retains active annotation history', (t) => {
  const { state, mount } = setupWorkspace(t);
  const first = mount();
  assert.deepEqual(state.data.drawing.history, [edit]);
  assert.match(first.root.querySelector('[data-hook="drawing-history"]').textContent, /Applied/);
  first.workspace.destroy();
  setLocale('ko', { persist: false });
  const second = mount();
  assert.deepEqual(state.data.drawing.history, [edit]);
  assert.equal(state.data.drawing.historyIndex, 0);
  assert.match(second.root.querySelector('[data-hook="drawing-history"]').textContent, /적용됨/);
});

test('remount retains undone entries and redo sends the saved value', async (t) => {
  const { state, mount } = setupWorkspace(t, -1);
  const requests = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ update: { history_op: 'redo', dim_id: 'WIDTH', old_value: 142, new_value: 150 }, preview: { ...state.data.drawing.preview, drawn_at: '2026-01-02' } }) };
  };
  t.after(() => { globalThis.fetch = savedFetch; });
  const first = mount();
  assert.match(first.root.querySelector('[data-hook="drawing-history"]').textContent, /Undone/);
  first.workspace.destroy();
  const second = mount();
  key(second.root, 'y');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [{ url: '/api/studio/drawing-previews/A/dimensions', body: { dim_id: 'WIDTH', value_mm: 150, history_op: 'redo' } }]);
  assert.equal(state.data.drawing.historyIndex, 0);
  assert.match(second.root.querySelector('[data-hook="drawing-history"]').textContent, /Applied/);
});

test('a new preview clears the prior plan history and redo branch', (t) => {
  const { state, mount } = setupWorkspace(t);
  const first = mount();
  first.workspace.destroy();
  state.data.drawing.preview = { ...state.data.drawing.preview, id: 'B', preview_reference: 'preview-B' };
  mount();
  assert.deepEqual(state.data.drawing.history, []);
  assert.equal(state.data.drawing.historyIndex, -1);
});

test('history marks each side of an intermediate undo cursor in newest-first order', (t) => {
  const { state, mount } = setupWorkspace(t);
  state.data.drawing.history.push({ dimId: 'THK', oldValue: 4, newValue: 5 });
  const { root } = mount();
  const rows = root.querySelector('[data-hook="drawing-history"]').children;
  assert.deepEqual(rows.map((row) => row.textContent), ['THK: 4 -> 5Undone', 'WIDTH: 142 -> 150Applied']);
  assert.equal(state.data.drawing.historyIndex, 0);
});

test('editing after undo discards only the undone redo branch', (t) => {
  const { state, renderer, updates } = setupRenderer(t, -1);
  renderer.handleDimensionUpdated({ history_op: 'edit', dim_id: 'THK', old_value: 4, new_value: 5 });
  assert.deepEqual(state.dimensions.history, [{ dimId: 'THK', oldValue: 4, newValue: 5 }]);
  assert.equal(state.dimensions.index, 0);
  key(new TestElement(), 'y');
  assert.deepEqual(updates, []);
});
