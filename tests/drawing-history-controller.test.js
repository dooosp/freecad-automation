import { drawingInputSnapshot } from '../public/js/studio/workbench-presentation.js';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createDrawingRenderer } from '../public/js/app/drawing.js';
import { createViewerStore } from '../public/js/app/store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { TestElement, installDrawingTestDom, drawingWorkspaceRoot } from './helpers/drawing-test-dom.js';
import { workspaceDefinitions } from '../public/js/studio/workspaces.js';

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
function setupRenderer(t, index = 0, options = {}) {
  const restoreDom = installDrawingTestDom(options);
  const state = createViewerStore().state;
  state.dimensions.history = [structuredClone(edit)];
  state.dimensions.index = index;
  state.drawing.lastPlanPath = 'preview-A';
  const overlay = new TestElement();
  overlay.classList.add('open');
  const container = new TestElement();
  document.append(overlay);
  overlay.append(container);
  const updates = [];
  const renderer = createDrawingRenderer({ state, drawingOverlayElement: overlay, drawingContainerElement: container, drawingBomElement: new TestElement(), sendDimensionUpdate: (update) => updates.push(update), ...options.renderer });
  t.after(() => { renderer.destroy(); restoreDom(); });
  return { state, updates, renderer, overlay, container };
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

function setupWorkspace(t, index = 0, options = {}) {
  const restoreDom = installDrawingTestDom(options);
  setLocale('en', { persist: false });
  const preview = { id: 'A', preview_reference: 'preview-A', svg: '<svg viewBox="0 0 400 300"/>', drawn_at: '2026-01-01', dimensions: [] };
  const state = { connectionState: 'connected', data: { drawing: { status: 'ready', preview, history: [structuredClone(edit)], historyIndex: index }, health: { available: true }, model: { configText: '[model]' }, recentJobs: { items: [] } } };
  state.data.drawing.settings = { views: ['front', 'top', 'right', 'iso'], scale: 'auto', section_assist: false, detail_assist: false };
  state.data.drawing.previewInputSnapshot = drawingInputSnapshot(state.data.model, state.data.drawing.settings);
  const mounts = [];
  function mount(render = drawingWorkspaceRoot) {
    const root = render();
    const caption = new TestElement('p');
    caption.dataset.hook = 'drawing-canvas-caption';
    root.append(caption);
    document.append(root);
    const workspace = mountDrawingWorkspace({ root, state, addLog() {} });
    mounts.push(workspace);
    return { root, workspace };
  }
  t.after(() => { mounts.forEach((workspace) => workspace.destroy()); setLocale('en', { persist: false }); restoreDom(); });
  return { state, mount };
}

test('annotation state distinguishes pending, known empty, unavailable, and supplied notes', (t) => {
  const { state, mount } = setupWorkspace(t);
  const { root, workspace } = mount();
  const currentPreview = state.data.drawing.preview;
  const notes = root.querySelector('[data-hook="drawing-annotations"]');
  assert.match(notes.textContent, /not provided/);
  state.data.drawing.preview = { ...currentPreview, annotations: [] };
  workspace.syncFromShell();
  assert.match(notes.textContent, /No separate notes or callouts were returned/);
  assert.match(notes.textContent, /Check the sheet for any embedded annotations/);
  state.data.drawing.preview = { ...currentPreview, annotations: ['Deburr edges'] };
  workspace.syncFromShell();
  assert.equal(notes.textContent, 'Deburr edges');
  state.data.drawing.preview = { ...currentPreview, annotations: 'not an annotation list' };
  workspace.syncFromShell();
  assert.match(notes.textContent, /not provided/);
  state.data.drawing.preview = null;
  workspace.syncFromShell();
  assert.match(notes.textContent, /Generate a drawing/);
});

test('drawing arrival reorders stable sections and polling preserves the focused action', (t) => {
  const { state, mount } = setupWorkspace(t);
  state.data.examples = { items: [], selectedId: '' };
  const preview = state.data.drawing.preview;
  state.data.drawing.preview = null;
  state.data.drawing.status = 'idle';
  const { root, workspace } = mount(() => workspaceDefinitions.drawing.render(state));
  const sheet = root.querySelector('[data-hook="drawing-sheet-section"]');
  const actions = root.querySelector('[data-hook="drawing-action-section"]');
  const parent = sheet.parentElement;
  const button = root.querySelector('[data-hook="drawing-generate"]');
  assert.ok(parent.children.indexOf(actions) < parent.children.indexOf(sheet));
  state.data.drawing.preview = preview;
  state.data.drawing.status = 'ready';
  workspace.syncFromShell();
  assert.ok(parent.children.indexOf(sheet) < parent.children.indexOf(actions));
  assert.equal(root.querySelector('[data-hook="drawing-generate"]'), button);
  button.focus();
  const originalInsert = parent.insertBefore;
  let repeatedMoves = 0;
  parent.insertBefore = function (...args) { repeatedMoves += 1; return originalInsert.apply(this, args); };
  workspace.syncFromShell();
  assert.equal(repeatedMoves, 0, 'a poll must not detach and reattach focused controls');
  assert.equal(document.activeElement, button);
  state.data.drawing.preview = null;
  workspace.syncFromShell();
  assert.ok(parent.children.indexOf(actions) < parent.children.indexOf(sheet));
  assert.equal(root.querySelector('[data-hook="drawing-generate"]'), button);
});

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

function dimensionKey(target, pressed) {
  const event = { target, key: pressed, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  target.dispatch('keydown', event);
  return event;
}

for (const pressed of ['Enter', ' ']) {
  test(`sheet dimension ${JSON.stringify(pressed)} opens a named editor and Escape returns focus without updating`, (t) => {
    const { renderer, container, updates } = setupRenderer(t, 0, { dimensions: [{ id: 'WIDTH', value: 142 }] });
    setLocale('en', { persist: false });
    renderer.showDrawing('<svg/>', [], 'auto', 'preview-A');
    const dimension = container.querySelector('text[data-dim-id]');
    assert.equal(dimension.getAttribute('role'), 'button');
    assert.equal(dimension.getAttribute('tabindex'), '0');
    assert.match(dimension.getAttribute('aria-label'), /WIDTH.*142.*mm/);
    dimension.focus();
    assert.equal(dimensionKey(dimension, pressed).defaultPrevented, true);
    const input = container.querySelector('input');
    assert.ok(input);
    assert.equal(document.activeElement, input);
    assert.match(input.getAttribute('aria-label'), /WIDTH.*mm/);
    input.value = '160';
    const escape = dimensionKey(input, 'Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(escape.propagationStopped, true);
    assert.equal(container.querySelector('input'), null);
    assert.equal(document.activeElement, dimension);
    assert.deepEqual(updates, []);
  });
}

test('keyboard dimension submission keeps the original annotation payload', (t) => {
  const { renderer, container, updates } = setupRenderer(t, 0, { dimensions: [{ id: 'WIDTH', value: 142 }] });
  renderer.showDrawing('<svg/>', [], 'auto', 'preview-A');
  const dimension = container.querySelector('text[data-dim-id]');
  dimensionKey(dimension, 'Enter');
  const input = container.querySelector('input');
  assert.ok(input);
  input.value = '150';
  dimensionKey(input, 'Enter');
  assert.deepEqual(updates, [{ dimId: 'WIDTH', valueMm: 150, planPath: 'preview-A', configToml: '', historyOp: 'edit' }]);
});

test('canceling and immediately reopening does not let the old blur dismiss the new editor', async (t) => {
  const { renderer, container } = setupRenderer(t, 0, { dimensions: [{ id: 'WIDTH', value: 142 }] });
  renderer.showDrawing('<svg/>', [], 'auto', 'preview-A');
  const dimension = container.querySelector('text[data-dim-id]');
  dimensionKey(dimension, 'Enter');
  const firstInput = container.querySelector('input');
  firstInput.dispatch('blur', {});
  dimensionKey(firstInput, 'Escape');
  dimensionKey(dimension, ' ');
  const nextInput = container.querySelector('input');
  assert.notEqual(nextInput, firstInput);
  await new Promise((resolve) => setTimeout(resolve, 175));
  assert.equal(container.querySelector('input'), nextInput);
  assert.equal(document.activeElement, nextInput);
});

test('an unavailable preview removes keyboard edit actions from the retained sheet', (t) => {
  let available = true;
  const { renderer, container } = setupRenderer(t, 0, {
    dimensions: [{ id: 'WIDTH', value: 142 }],
    renderer: { isDimensionEditingAvailable: () => available },
  });
  renderer.showDrawing('<svg/>', [], 'auto', 'preview-A');
  const dimension = container.querySelector('text[data-dim-id]');
  assert.equal(dimension.getAttribute('role'), 'button');
  available = false;
  renderer.syncDimensionEditingAvailability();
  assert.equal(dimension.getAttribute('role'), null);
  assert.equal(dimension.getAttribute('tabindex'), null);
  dimensionKey(dimension, 'Enter');
  assert.equal(container.querySelector('input'), null);
});

test('preview-only sheets do not advertise interactive dimension buttons', (t) => {
  const { state, mount } = setupWorkspace(t, 0, { dimensions: [{ id: 'WIDTH', value: 142 }] });
  state.data.drawing.preview.editable_plan_available = false;
  const { root } = mount();
  const dimension = root.querySelector('text[data-dim-id]');
  assert.ok(dimension);
  assert.equal(dimension.getAttribute('role'), null);
  assert.equal(dimension.getAttribute('tabindex'), null);
  dimensionKey(dimension, 'Enter');
  assert.equal(root.querySelector('.dim-edit-input'), null);
});

test('dimension panel controls identify their dimension and millimeter units in both locales', (t) => {
  const { state, mount } = setupWorkspace(t);
  state.data.drawing.preview.editable_plan_available = true;
  state.data.drawing.preview.dimensions = [{ id: 'WIDTH', value_mm: 142, feature: 'body_width' }];
  for (const locale of ['en', 'ko']) {
    setLocale(locale, { persist: false });
    const { root, workspace } = mount();
    const input = root.querySelector('input[data-dim-id]');
    const button = root.querySelector('[data-action="drawing-apply-dimension"]');
    assert.match(input.getAttribute('aria-label'), /WIDTH.*mm/);
    assert.match(button.getAttribute('aria-label'), /WIDTH/);
    if (locale === 'ko') assert.match(input.getAttribute('aria-label'), /[가-힣]/);
    workspace.destroy();
  }
});

test('Korean drawing guidance explains keyboard editing and required dimensions without translating feature IDs', (t) => {
  const { state, mount } = setupWorkspace(t);
  setLocale('ko', { persist: false });
  state.data.drawing.preview.editable_plan_available = true;
  state.data.drawing.preview.dimensions = [{ id: 'WIDTH', value_mm: 142, feature: 'body_width', required: true }];
  const { root } = mount();
  const caption = root.querySelector('[data-hook="drawing-canvas-caption"]').textContent;
  assert.match(caption, /Enter/);
  assert.match(caption, /Space/);
  assert.match(caption, /Escape/);
  assert.match(caption, /취소/);
  const dimensions = root.querySelector('[data-hook="drawing-dimensions"]').textContent;
  assert.match(dimensions, /body_width/);
  assert.match(dimensions, /필수/);
  assert.doesNotMatch(dimensions, /required/);
});
