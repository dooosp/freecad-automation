import { createStudioWorkspaceController } from '../public/js/studio/studio-shell-workspace.js';
import { drawingInputSnapshot } from '../public/js/studio/workbench-presentation.js';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { TestElement, installDrawingTestDom, drawingWorkspaceRoot } from './helpers/drawing-test-dom.js';

const barrel = new URL('../public/js/app/index.js', import.meta.url).href;
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url === barrel) return { format: 'module', shortCircuit: true, source: "export { createDrawingRenderer } from './drawing.js'; export { createViewerStore } from './store.js'; export const initScene = () => new Proxy({}, { get: () => () => {} }); export const createAnimationController = () => new Proxy({}, { get: () => () => {} }); export const renderModelInfo = () => {};" };
  return nextLoad(url, context);
} });
const { mountDrawingWorkspace } = await import('../public/js/studio/drawing-workspace.js');
const { mountModelWorkspace } = await import('../public/js/studio/model-workspace.js');
hooks.deregister();
const settle = () => new Promise((resolve) => setImmediate(resolve));
const preview = (id = 'A', value = 142) => ({ id, svg: '<svg/>', drawn_at: String(value), dimensions: [{ id: 'WIDTH', value_mm: value }], editable_plan_available: true });

function setup(t) {
  const restore = installDrawingTestDom();
  setLocale('en', { persist: false });
  const savedCss = globalThis.CSS; globalThis.CSS = { escape: (value) => value };
  t.after(() => { if (savedCss === undefined) delete globalThis.CSS; else globalThis.CSS = savedCss; });
  const savedFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, body: JSON.parse(options.body), resolve: (payload) => resolve({ ok: true, json: async () => payload }), reject }));
  const state = createStudioShellState();
  state.connectionState = 'connected';
  state.data.health.available = true;
  state.data.model.configText = '[model]\nlength = 142';
  state.data.drawing.preview = preview();
  state.data.drawing.status = 'ready';
  state.data.drawing.previewInputSnapshot = drawingInputSnapshot(state.data.model, state.data.drawing.settings);
  const mounts = [];
  function mount(callbacks = {}) {
    const root = drawingWorkspaceRoot();
    for (const [tag, hook] of [['select', 'example-select'], ['input', 'drawing-config-file'], ['button', 'drawing-generate'], ['button', 'drawing-tracked-run']]) {
      const element = new TestElement(tag); element.dataset.hook = hook; root.append(element);
    }
    const scale = new TestElement('select'); scale.dataset.hook = 'drawing-scale'; root.append(scale);
    for (const name of ['job-surface', 'result-surface']) {
      const surface = new TestElement(); surface.dataset.hook = `drawing-${name}`;
      const title = new TestElement(); title.className = 'model-status-title';
      const copy = new TestElement(); copy.className = 'model-status-copy'; surface.append(title, copy); root.append(surface);
    }
    const workspace = mountDrawingWorkspace({ root, state, addLog() {}, ...callbacks });
    mounts.push(workspace);
    function click(action) { const target = new TestElement('button'); target.dataset.action = action; root.dispatch('click', { target }); }
    return { root, workspace, click, scale, input: () => root.querySelector('input[data-dim-id="WIDTH"]') };
  }
  t.after(() => { mounts.forEach((w) => w.destroy()); globalThis.fetch = savedFetch; setLocale('en', { persist: false }); restore(); });
  return { state, requests, mount };
}

test('unsubmitted dimension and focused element survive polling; draft and focus survive remount', (t) => {
  const { state, mount } = setup(t);
  const first = mount();
  const input = first.input(); input.value = '153'; input.focus(); first.root.dispatch('input', { target: input });
  first.workspace.syncFromShell();
  assert.ok(first.input() === input, 'polling keeps the same input DOM');
  assert.equal(first.input().value, '153');
  assert.equal(document.activeElement, input);
  first.workspace.destroy();
  setLocale('ko', { persist: false });
  const second = mount();
  assert.equal(second.input().value, '153');
  assert.equal(document.activeElement, second.input());
  state.data.drawing.preview = preview('B', 155);
  second.workspace.syncFromShell();
  assert.equal(second.input().value, '155', 'different preview resets draft');
});

test('different TOML resets dimension drafts and clearly marks an existing sheet stale', (t) => {
  const { state, mount } = setup(t);
  const { root, input, workspace } = mount();
  input().value = '153'; root.dispatch('input', { target: input() });
  state.data.model.configText = '[model]\nlength = 155';
  workspace.syncFromShell();
  assert.equal(input().value, '142');
  assert.match(root.querySelector('[data-hook="drawing-summary"]').textContent, /regenerate/i);
  assert.doesNotMatch(root.querySelector('[data-hook="drawing-job-surface"]').textContent, /Drawing ready/);
});

test('newest drawing response wins even when old success arrives last', async (t) => {
  const { state, requests, mount } = setup(t);
  const first = mount(); first.click('drawing-generate');
  state.data.model.configText = '[model]\nlength = 155';
  first.workspace.destroy();
  const second = mount(); second.click('drawing-generate');
  assert.equal(requests.length, 2);
  requests[1].resolve({ preview: preview('new', 155) }); await settle();
  requests[0].resolve({ preview: preview('old', 142) }); await settle();
  second.workspace.syncFromShell();
  assert.equal(state.data.drawing.preview.id, 'new');
  assert.equal(state.data.model.configText, '[model]\nlength = 155');
});

test('changed sheet settings obsolete an in-flight result and do not advertise it as current', async (t) => {
  const { state, requests, mount } = setup(t);
  const { scale, root, click } = mount(); click('drawing-generate');
  scale.value = '1:2'; root.dispatch('change', { target: scale });
  requests[0].resolve({ preview: preview('old') }); await settle();
  assert.equal(requests[0].body.drawing_settings.scale, 'auto');
  assert.equal(state.data.drawing.settings.scale, '1:2');
  assert.equal(state.data.drawing.preview.id, 'A');
  assert.match(root.querySelector('[data-hook="drawing-summary"]').textContent, /regenerate/i);
  assert.notEqual(state.data.drawing.status, 'generating');
});

test('late failure from an older request cannot replace a newer successful sheet', async (t) => {
  const { state, requests, mount } = setup(t);
  const first = mount(); first.click('drawing-generate');
  state.data.model.configText += '\nwidth = 90';
  first.workspace.destroy(); const second = mount(); second.click('drawing-generate');
  requests[1].resolve({ preview: preview('new') }); await settle();
  requests[0].reject(new Error('old connection failed')); await settle();
  assert.equal(state.data.drawing.preview.id, 'new');
  assert.equal(state.data.drawing.errorMessage, '');
  assert.equal(state.data.drawing.status, 'ready');
});

// Exercise the same persistence functions used by shell boot and delegated form events.
const { persistStudioDraft, restoreStudioDraft, STUDIO_DRAFT_KEY } = await import('../public/js/studio/studio-draft-recovery.js');
function memoryStorage() { const data = new Map(); return { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key), removeItem: (key) => data.delete(key) }; }
test('tab recovery restores TOML and form settings with no runtime identity or saved artifact claims', () => {
  const storage = memoryStorage(); const before = createStudioShellState();
  before.data.model.configText = '[model]\nname = "USB 허브 판"\nlength = 155';
  before.data.model.promptText = 'Draft input';
  before.data.model.buildSettings.include_step = false;
  before.data.model.reportOptions.profileName = 'review';
  before.data.model.controls.opacity = 54;
  before.data.drawing.settings = { views: ['front', 'top', 'right'], scale: '1:2', section_assist: true, detail_assist: false };
  before.data.model.preview = { id: 'obsolete-model' }; before.data.drawing.preview = preview('obsolete-drawing');
  before.data.model.trackedRun.lastJobId = 'old-job';
  assert.equal(persistStudioDraft(before, storage), true);
  assert.doesNotMatch(storage.getItem(STUDIO_DRAFT_KEY), /obsolete-model|obsolete-drawing|old-job/);
  const after = createStudioShellState(); assert.equal(restoreStudioDraft(after, storage), true);
  assert.equal(after.data.model.configText, before.data.model.configText);
  assert.deepEqual(after.data.model.buildSettings, before.data.model.buildSettings);
  assert.deepEqual(after.data.drawing.settings, before.data.drawing.settings);
  assert.equal(after.data.model.reportOptions.profileName, 'review'); assert.equal(after.data.model.controls.opacity, 54);
  assert.equal(after.data.model.preview, null); assert.equal(after.data.drawing.preview, null);
  assert.equal(after.data.model.trackedRun.lastJobId, ''); assert.equal(after.data.model.buildState, 'idle');
  assert.equal(after.data.model.sourceName, 'Recovered tab draft'); assert.match(after.data.model.buildSummary, /Regenerate previews/);
  assert.equal(restoreStudioDraft(createStudioShellState(), memoryStorage()), false, 'another tab has no draft');
});

test('unavailable/corrupt session storage does not break editing or shell defaults', () => {
  const state = createStudioShellState();
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(restoreStudioDraft(state, blocked), false); assert.equal(persistStudioDraft(state, blocked), false);
  const storage = memoryStorage(); storage.setItem(STUDIO_DRAFT_KEY, '{broken');
  assert.equal(restoreStudioDraft(state, storage), false); assert.equal(state.data.model.configText, '');
  storage.setItem(STUDIO_DRAFT_KEY, JSON.stringify({ version: 1, configText: '', buildSettings: { include_step: 'bad' }, drawingSettings: { views: ['bad'], scale: [] }, preview: { id: 'bad' } }));
  assert.equal(restoreStudioDraft(state, storage), true); assert.equal(state.data.model.buildSettings.include_step, true);
  assert.equal(state.data.drawing.settings.scale, 'auto'); assert.equal(state.data.model.preview, null);
});

function mountModel(t, state, callbacks = {}) {
  state.data.model.profileCatalog.status = 'ready';
  const root = new TestElement();
  for (const name of ['source-summary', 'validation-summary', 'validation-warnings', 'tracked-validation-notes', 'tracked-status', 'build-log', 'assistant-report', 'parts-list', 'animation-controls', 'model-info', 'build-summary', 'viewport-caption', 'build-button', 'guided-generate', 'ai-create-draft', 'ai-validate-draft', 'validate-button', 'tracked-create-button', 'tracked-report-button', 'load-example', 'clear-result', 'config-textarea']) {
    const element = new TestElement(name.endsWith('button') ? 'button' : 'div'); element.dataset.hook = name;
    const card = new TestElement(); card.className = 'studio-card'; card.append(element); root.append(card);
  }
  const controller = mountModelWorkspace({ root, state, addLog() {}, ...callbacks });
  t.after(() => controller.destroy());
  return { root, controller, click: (hook) => root.querySelector(`[data-hook="${hook}"]`).dispatch('click', {}) };
}

test('model build retains newer typed input and marks its older result stale', async (t) => {
  const { state, requests } = setup(t); const model = mountModel(t, state);
  model.click('guided-generate'); requests[0].resolve({ overview: {} }); await settle();
  const input = model.root.querySelector('[data-hook="config-textarea"]'); input.value = '[model]\nlength = 155'; input.dispatch('input', {});
  requests[1].resolve({ preview: { id: '142-model' } }); await settle();
  assert.equal(state.data.model.configText, '[model]\nlength = 155');
  assert.equal(state.data.model.preview.id, '142-model');
  assert.match(model.root.querySelector('[data-hook="build-summary"]').textContent, /Input changed/);
});

test('model source replacement and newer build ignore an older success arriving last', async (t) => {
  const { state, requests } = setup(t); const model = mountModel(t, state);
  model.click('guided-generate'); requests[0].resolve({ overview: {} }); await settle();
  state.data.examples.items = [{ id: 'new', name: 'New example', content: '[model]\nlength = 155' }]; state.data.examples.selectedId = 'new';
  model.click('load-example'); model.click('guided-generate'); requests[2].resolve({ overview: {} }); await settle();
  requests[3].resolve({ preview: { id: '155-model' } }); await settle();
  requests[1].resolve({ preview: { id: 'old-model' } }); await settle();
  assert.equal(state.data.model.preview.id, '155-model');
  assert.equal(state.data.model.configText, '[model]\nlength = 155');
});

test('model clear-result invalidates an outstanding build even if it later fails', async (t) => {
  const { state, requests } = setup(t); const model = mountModel(t, state);
  model.click('guided-generate'); requests[0].resolve({ overview: {} }); await settle();
  model.click('clear-result'); requests[1].reject(new Error('old failed')); await settle();
  assert.equal(state.data.model.preview, null); assert.equal(state.data.model.errorMessage, '');
  assert.equal(state.data.model.buildState, 'idle');
});

test('older drawing completion does not end a newer pending request', async (t) => {
  const { state, requests, mount } = setup(t);
  const first = mount(); first.click('drawing-generate');
  state.data.model.configText += '\nwidth = 95'; first.workspace.syncFromShell();
  first.click('drawing-generate');
  requests[0].resolve({ preview: preview('obsolete') }); await settle();
  assert.equal(state.data.drawing.status, 'generating');
  assert.equal(state.data.drawing.preview.id, 'A');
  requests[1].resolve({ preview: preview('latest') }); await settle();
  assert.equal(state.data.drawing.status, 'ready'); assert.equal(state.data.drawing.preview.id, 'latest');
});

test('unknown sheet provenance is never assumed to match current input', (t) => {
  const { state, mount } = setup(t); delete state.data.drawing.previewInputSnapshot;
  const { root } = mount();
  assert.match(root.querySelector('[data-hook="drawing-summary"]').textContent, /Regenerate/);
  assert.equal(root.querySelector('[data-action="drawing-apply-dimension"]').disabled, true);
});

test('model settings are submitted as a snapshot and changed settings require another build', async (t) => {
  const { state, requests } = setup(t); const model = mountModel(t, state);
  model.click('guided-generate'); requests[0].resolve({ overview: {} }); await settle();
  state.data.model.buildSettings.include_step = false;
  requests[1].resolve({ preview: { id: 'original-settings' } }); await settle();
  assert.equal(requests[1].body.build_settings.include_step, true);
  assert.equal(state.data.model.buildSettings.include_step, false);
  assert.match(model.root.querySelector('[data-hook="build-summary"]').textContent, /Input changed/);
});

function sharedSourceCallbacks(state) {
  const shared = createStudioWorkspaceController({ state, addLog() {} });
  return { loadSelectedExampleIntoSharedModel: shared.loadSelectedExampleIntoSharedModel, loadConfigFileIntoSharedModel: shared.loadConfigFileIntoSharedModel };
}

for (const source of ['example', 'file']) {
  test(`Drawing ${source} load can generate immediately without a route remount`, async (t) => {
    const { state, requests, mount } = setup(t);
    state.data.drawing.history = [{ dimId: 'WIDTH', oldValue: 142, newValue: 150 }]; state.data.drawing.historyIndex = 0;
    state.data.examples.items = [{ id: 'new', name: 'new.toml', content: '[model]\nlength = 155' }]; state.data.examples.selectedId = 'new';
    const active = mount(sharedSourceCallbacks(state));
    active.input().value = '153'; active.root.dispatch('input', { target: active.input() });
    active.click('drawing-generate'); // This old request remains unresolved during source replacement.
    if (source === 'example') active.click('drawing-load-example');
    else {
      const input = active.root.querySelector('[data-hook="drawing-config-file"]');
      input.files = [{ name: 'new.toml', text: async () => '[model]\nlength = 155' }];
      active.root.dispatch('change', { target: input }); await settle();
    }
    // Loading the source must reset history immediately, before a new preview
    // gets a chance to hide a rebind/callback ordering defect.
    assert.equal(state.data.drawing.preview, null);
    assert.deepEqual(state.data.drawing.history, []);
    assert.equal(state.data.drawing.historyIndex, -1);
    assert.equal(state.data.drawing.historyPlanReference, '');
    assert.doesNotMatch(active.root.querySelector('[data-hook="drawing-history"]').textContent, /142.*150/);
    active.click('drawing-generate');
    assert.equal(requests[1].body.config_toml, '[model]\nlength = 155');
    requests[1].resolve({ preview: preview('new-source', 155) }); await settle();
    assert.equal(state.data.drawing.preview?.id, 'new-source');
    assert.equal(state.data.drawing.status, 'ready');
    assert.equal(active.input().value, '155');
    assert.deepEqual(state.data.drawing.history, []);
    assert.doesNotMatch(active.root.querySelector('[data-hook="drawing-history"]').textContent, /142.*150/);
    requests[0].resolve({ preview: preview('abandoned', 142) }); await settle();
    assert.equal(state.data.drawing.preview.id, 'new-source', 'abandoned owner cannot overwrite the reloaded source');
    assert.equal(state.data.model.sourceName, 'new.toml');
  });
}

test('Drawing example selector propagates the selected example to the actual shared loader', (t) => {
  const { state, mount } = setup(t);
  state.data.examples.items = [{ id: 'belt', name: 'belt_drive.toml', content: '[model]\nlength = 142' }, { id: 'pcb', name: 'pcb_mount_plate.toml', content: '[model]\nlength = 155' }];
  state.data.examples.selectedId = 'belt';
  const active = mount(sharedSourceCallbacks(state));
  const select = active.root.querySelector('[data-hook="example-select"]');
  select.value = 'pcb'; active.root.dispatch('change', { target: select });
  active.click('drawing-load-example');
  assert.equal(state.data.model.sourceName, 'pcb_mount_plate.toml');
  assert.equal(state.data.model.configText, '[model]\nlength = 155');
  assert.equal(state.data.examples.selectedId, 'pcb');
});

function applyDimension(active, value) {
  const input = active.input(); input.value = value;
  active.root.dispatch('input', { target: input });
  active.root.dispatch('click', { target: active.root.querySelector('[data-action="drawing-apply-dimension"]') });
}

test('failed annotation releases controls, preserves last sheet and draft, and permits retry', async (t) => {
  const { state, requests, mount } = setup(t); const active = mount();
  applyDimension(active, '150');
  assert.equal(state.data.drawing.status, 'generating');
  requests[0].reject(new Error('Failed to fetch')); await settle();
  assert.equal(state.data.drawing.status, 'error');
  assert.equal(state.data.drawing.activeRequest, null);
  assert.equal(state.data.drawing.preview.id, 'A');
  assert.equal(active.input().value, '150');
  assert.equal(active.root.querySelector('[data-hook="drawing-generate"]').disabled, false);
  assert.equal(active.root.querySelector('[data-hook="drawing-tracked-run"]').disabled, false);
  applyDimension(active, '150'); assert.equal(requests.length, 2);
  requests[1].resolve({ update: { dim_id: 'WIDTH', old_value: 142, new_value: 150, history_op: 'edit' }, preview: preview('A', 150) }); await settle();
  assert.equal(state.data.drawing.status, 'ready'); assert.equal(state.data.drawing.errorMessage, '');
});

for (const value of ['', '-1', '0', 'Infinity', '1e999', '150oops']) {
  test(`invalid annotation ${JSON.stringify(value)} is rejected before API and can be corrected`, async (t) => {
    const { state, requests, mount } = setup(t); const active = mount();
    applyDimension(active, value);
    assert.equal(requests.length, 0);
    assert.equal(active.input().value, value, 'invalid draft stays exactly as typed');
    active.workspace.syncFromShell();
    assert.equal(active.input().value, value, 'polling preserves even an empty draft');
    assert.equal(state.data.drawing.preview.id, 'A');
    assert.notEqual(state.data.drawing.status, 'generating');
    assert.match(state.data.drawing.errorMessage, /positive dimension/);
    applyDimension(active, '150'); assert.equal(requests.length, 1);
    requests[0].reject(new Error('Controlled failure')); await settle();
  });
}

test('annotation and drawing preview ignore same-input in-flight repeats but allow completed repeats', async (t) => {
  const { requests, mount } = setup(t); const active = mount();
  applyDimension(active, '150');
  assert.equal(active.root.querySelector('[data-action="drawing-apply-dimension"]').disabled, true);
  applyDimension(active, '150'); active.click('drawing-generate');
  assert.equal(requests.length, 1);
  requests[0].resolve({ update: { dim_id: 'WIDTH', history_op: 'edit' }, preview: preview('A', 150) }); await settle();
  assert.equal(active.root.querySelector('[data-action="drawing-apply-dimension"]').disabled, false);
  active.click('drawing-generate'); active.click('drawing-generate'); assert.equal(requests.length, 2);
  requests[1].resolve({ preview: preview('B') }); await settle();
  active.click('drawing-generate'); assert.equal(requests.length, 3);
  requests[2].resolve({ preview: preview('C') }); await settle();
});

test('tracked draw guards pending submission and permits retry after rejection', async (t) => {
  const { state, mount } = setup(t); const submissions = [];
  const active = mount({ submitTrackedJob: (body) => new Promise((resolve, reject) => submissions.push({ body, resolve, reject })) });
  active.click('drawing-run-tracked'); active.click('drawing-run-tracked');
  assert.equal(submissions.length, 1);
  submissions[0].reject(new Error('Connection lost')); await settle();
  assert.equal(state.data.drawing.trackedRun.submitting, false);
  active.click('drawing-run-tracked'); assert.equal(submissions.length, 2);
  submissions[1].resolve({ id: 'draw-retry', status: 'queued' }); await settle();
  active.click('drawing-run-tracked'); assert.equal(submissions.length, 3, 'completed POST is allowed again');
  submissions[2].resolve({ id: 'draw-repeat', status: 'queued' }); await settle();
});

test('invalid TOML fails cleanly; corrected model build ignores duplicates and preserves last result on failure', async (t) => {
  const { state, requests } = setup(t); const active = mountModel(t, state);
  state.data.model.preview = { id: 'last-valid' };
  active.click('guided-generate'); active.click('guided-generate'); assert.equal(requests.length, 1);
  assert.equal(active.root.querySelector('[data-hook="build-button"]').disabled, true);
  requests[0].reject(new Error('Invalid TOML')); await settle();
  assert.equal(state.data.model.buildState, 'error'); assert.equal(state.data.model.preview.id, 'last-valid');
  assert.equal(active.root.querySelector('[data-hook="build-button"]').disabled, false);
  state.data.model.configText = '[model]\nlength = 155';
  active.click('guided-generate'); requests[1].resolve({ overview: {} }); await settle();
  active.click('guided-generate'); assert.equal(requests.length, 3);
  requests[2].reject(new Error('Runtime disconnected')); await settle();
  assert.equal(state.data.model.preview.id, 'last-valid');
  active.click('guided-generate'); requests[3].resolve({ overview: {} }); await settle();
  requests[4].resolve({ preview: { id: 'recovered' } }); await settle();
  assert.equal(state.data.model.buildState, 'success'); assert.equal(state.data.model.preview.id, 'recovered');
});

for (const type of ['create', 'report']) {
  test(`tracked ${type} guards validation and submit, then permits retry and completed repeat`, async (t) => {
    const { state, requests } = setup(t); const submissions = [];
    const active = mountModel(t, state, { submitTrackedJob: (body) => new Promise((resolve, reject) => submissions.push({ body, resolve, reject })) });
    const click = () => active.click(`tracked-${type}-button`);
    click(); click(); assert.equal(requests.length, 1);
    requests[0].resolve({ overview: {} }); await settle(); click();
    assert.equal(requests.length, 1); assert.equal(submissions.length, 1);
    submissions[0].reject(new Error('Connection lost')); await settle();
    assert.equal(state.data.model.trackedRun.submitting, false);
    click(); requests[1].resolve({ overview: {} }); await settle();
    submissions[1].resolve({ id: `${type}-retry`, status: 'queued' }); await settle();
    click(); assert.equal(requests.length, 3);
    requests[2].reject(new Error('Invalid TOML')); await settle();
    assert.equal(state.data.model.trackedRun.submitting, false);
  });
}


test('obsolete tracked validation cannot unlock a newer source submission', async (t) => {
  const { state, requests } = setup(t); const submissions = [];
  const active = mountModel(t, state, { submitTrackedJob: (body) => new Promise((resolve) => submissions.push({ body, resolve })) });
  active.click('tracked-create-button');
  state.data.examples.items = [{ id: 'new', name: 'new.toml', content: '[model]\nlength = 155' }]; state.data.examples.selectedId = 'new';
  active.click('load-example'); active.click('tracked-create-button');
  requests[1].resolve({ overview: {} }); await settle(); assert.equal(submissions.length, 1);
  requests[0].reject(new Error('Old validation failed')); await settle();
  assert.equal(state.data.model.trackedRun.submitting, true);
  active.click('tracked-create-button'); assert.equal(requests.length, 2);
  submissions[0].resolve({ id: 'new-job', status: 'queued' }); await settle();
  assert.equal(state.data.model.trackedRun.lastJobId, 'new-job');
});

test('tracked drawing completion from a replaced source cannot unlock or overwrite newer submission', async (t) => {
  const { state, mount } = setup(t); const submissions = [];
  const active = mount({ ...sharedSourceCallbacks(state), submitTrackedJob: (body) => new Promise((resolve) => submissions.push({ body, resolve })) });
  active.click('drawing-run-tracked');
  state.data.examples.items = [{ id: 'new', name: 'new.toml', content: '[model]\nlength = 155' }]; state.data.examples.selectedId = 'new';
  active.click('drawing-load-example'); active.click('drawing-run-tracked');
  submissions[0].resolve({ id: 'old-job', status: 'queued' }); await settle();
  assert.equal(state.data.drawing.trackedRun.submitting, true);
  assert.notEqual(state.data.drawing.trackedRun.lastJobId, 'old-job');
  submissions[1].resolve({ id: 'new-job', status: 'queued' }); await settle();
  assert.equal(state.data.drawing.trackedRun.lastJobId, 'new-job');
});


test('clearing a displayed model during tracked submission does not strand the submission lock', async (t) => {
  const { state, requests } = setup(t); const submissions = [];
  const active = mountModel(t, state, { submitTrackedJob: (body) => new Promise((resolve) => submissions.push({ body, resolve })) });
  state.data.model.preview = { id: 'old-preview' };
  active.click('tracked-create-button'); requests[0].resolve({ overview: {} }); await settle();
  active.click('clear-result');
  submissions[0].resolve({ id: 'submitted-job', status: 'queued' }); await settle();
  assert.equal(state.data.model.preview, null);
  assert.equal(state.data.model.trackedRun.submitting, false);
  assert.equal(state.data.model.trackedRun.lastJobId, 'submitted-job');
});


const { createStudioJobMonitorController } = await import('../public/js/studio/studio-shell-job-monitor.js');
const { createStudioShellRuntime } = await import('../public/js/studio/studio-shell-store.js');
for (const type of ['create', 'report']) {
  for (const phase of ['validation', 'POST']) {
    for (const outcome of ['success', 'failure']) {
      test(`prompt replacement during ${type} ${phase}: old ${outcome} never strands or unlocks newer submission`, async (t) => {
        const { state, requests } = setup(t);
        const monitor = createStudioJobMonitorController({ state, runtime: createStudioShellRuntime(), window: { clearTimeout() {}, setTimeout() { return 1; } }, addLog() {}, refreshShellChrome() {} });
        const active = mountModel(t, state, { submitTrackedJob: monitor.submitTrackedStudioRun });
        state.data.model.promptText = 'Make a 155 mm plate';
        active.click(`tracked-${type}-button`);
        if (phase === 'POST') { requests[0].resolve({ overview: {} }); await settle(); }
        const obsolete = requests.at(-1);
        active.click('ai-create-draft');
        assert.equal(requests.at(-1).url, '/api/studio/design');
        requests.at(-1).resolve({ toml: '[model]\nlength = 155' }); await settle();
        assert.equal(state.data.model.configText, '[model]\nlength = 155');
        assert.equal(state.data.model.trackedRun.submitting, false, 'replacing source releases old source lock');
        assert.equal(state.data.model.buildState, 'idle');
        const beforeReview = requests.length;
        active.click(`tracked-${type}-button`);
        assert.equal(requests.length, beforeReview, 'AI draft still requires explicit review and validation');
        active.click('ai-validate-draft');
        requests.at(-1).resolve({ overview: {} }); await settle();
        assert.equal(state.data.model.assistant.phase, 'validated');
        active.click(`tracked-${type}-button`);
        const currentValidation = requests.at(-1);
        assert.equal(currentValidation.url, '/api/studio/validate-config');
        currentValidation.resolve({ overview: {} }); await settle();
        const currentPost = requests.at(-1); assert.equal(currentPost.url, '/api/studio/jobs');
        if (outcome === 'failure') obsolete.reject(new Error('Old request disconnected'));
        else obsolete.resolve(phase === 'POST' ? { job: { id: 'old-accepted', type, status: 'queued' } } : { overview: {} });
        await settle();
        assert.equal(state.data.model.trackedRun.submitting, true, 'old response cannot release newer lock');
        assert.notEqual(state.data.model.trackedRun.lastJobId, 'old-accepted');
        assert.equal(state.data.jobMonitor.items.some((job) => job.id === 'old-accepted'), phase === 'POST' && outcome === 'success', 'central monitor retains any already accepted job');
        currentPost.resolve({ job: { id: 'current-accepted', type, status: 'queued' } }); await settle();
        assert.equal(state.data.model.trackedRun.submitting, false);
        assert.equal(state.data.model.trackedRun.lastJobId, 'current-accepted');
        assert.equal(state.data.model.configText, '[model]\nlength = 155');
      });
    }
  }
}


for (const locale of ['en', 'ko']) {
  for (const failure of ['Failed to fetch', 'No drawing preview found for id expired-preview.']) {
    test(`${locale} annotation failure gives recoverable guidance and retains raw ${failure} in logs`, async (t) => {
      const { state, requests, mount } = setup(t); setLocale(locale, { persist: false });
      const logs = []; const active = mount({ addLog: (entry) => logs.push(entry) });
      applyDimension(active, '150'); requests[0].reject(new Error(failure)); await settle();
      const summary = active.root.querySelector('[data-hook="drawing-summary"]').textContent;
      if (locale === 'ko') assert.match(summary, failure === 'Failed to fetch' ? /연결.*다시/ : /미리보기.*다시/);
      else assert.match(summary, failure === 'Failed to fetch' ? /connection.*retry/i : /Preview Drawing.*reapply/i);
      assert.ok(logs.some((entry) => entry.message === failure));
      assert.equal(state.data.drawing.status, 'error');
      assert.equal(state.data.drawing.preview.id, 'A');
      assert.equal(active.input().value, '150');
      assert.equal(active.root.querySelector('[data-hook="drawing-generate"]').disabled, false);
    });
  }
}

// Current master adds a report action to Drawing; it shares the source boundary.
test('Drawing report rejects a stale sheet before submitting', async (t) => {
  const { state, mount } = setup(t); const submissions = [];
  const active = mount({ submitTrackedJob: async (body) => { submissions.push(body); return { id: 'report', status: 'queued' }; } });
  state.data.model.configText += '\nwidth = 90';
  active.workspace.syncFromShell();
  active.click('drawing-run-report'); await settle();
  assert.equal(submissions.length, 0);
});

for (const outcome of ['success', 'failure']) {
  test(`Drawing report ${outcome} from a replaced source cannot alter the newer submission`, async (t) => {
    const { state, requests, mount } = setup(t); const submissions = [];
    const active = mount({ ...sharedSourceCallbacks(state), submitTrackedJob: (body) => new Promise((resolve, reject) => submissions.push({ body, resolve, reject })) });
    active.click('drawing-run-report'); assert.equal(submissions.length, 1);
    state.data.examples.items = [{ id: 'new', name: 'new.toml', content: '[model]\nlength = 155' }]; state.data.examples.selectedId = 'new';
    active.click('drawing-load-example');
    active.click('drawing-generate'); requests[0].resolve({ preview: preview('new-source', 155) }); await settle();
    active.click('drawing-run-report'); assert.equal(submissions.length, 2, 'a new source has its own report lock');
    if (outcome === 'success') submissions[0].resolve({ id: 'old-report', status: 'queued' });
    else submissions[0].reject(new Error('old report failed'));
    await settle();
    assert.equal(state.data.model.trackedRun.submitting, true);
    assert.equal(state.data.model.trackedRun.error, '');
    assert.notEqual(state.data.model.trackedRun.lastJobId, 'old-report');
    submissions[1].resolve({ id: 'new-report', status: 'queued' }); await settle();
    assert.equal(state.data.model.trackedRun.submitting, false);
    assert.equal(state.data.model.trackedRun.lastJobId, 'new-report');
  });
}

test('Drawing report preserves a pending model create submission on the shared model', async (t) => {
  const { state, mount } = setup(t); const submissions = [];
  const owner = {};
  state.data.model.activeTrackedSubmission = owner;
  state.data.model.trackedRun = { type: 'create', status: 'submitting', submitting: true };
  const active = mount({ submitTrackedJob: async (body) => { submissions.push(body); return { id: 'report', status: 'queued' }; } });
  active.click('drawing-run-report'); await settle();
  assert.equal(submissions.length, 0);
  assert.equal(state.data.model.activeTrackedSubmission, owner);
});
