import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { setLocale } from '../public/js/i18n/index.js';
import { workspaceDefinitions } from '../public/js/studio/workspaces.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

test('Model offers editable geometry dimensions outside the advanced TOML disclosure', (t) => {
  t.after(installDrawingTestDom());
  const state = createStudioShellState();
  const root = workspaceDefinitions.model.render(state);
  const editor = root.querySelector('[data-hook="model-parameters"]');
  assert.ok(editor, 'Dimensions should be discoverable in the main Model workflow');
  assert.equal(editor.closest('details'), null);
  assert.ok(editor.querySelector('[data-action="model-parameters-inspect"]'));
});

const hash = (text) => createHash('sha256').update(text).digest('hex');
const source = 'name = "bracket"\nlength = 160\n';
const candidate = 'name = "bracket"\nlength = 180\n';
const fields = [
  ['plate_length_mm', 160], ['plate_width_mm', 100], ['plate_thickness_mm', 8],
  ['left_hole_diameter_mm', 6], ['right_hole_diameter_mm', 10],
].map(([id, value_mm]) => ({ id, value_mm, unit: 'mm', min_exclusive: 0, max_exclusive: null }));
const inspected = (configText = source) => ({ ok: true, supported: true, profile_id: 'bracket', source_sha256: hash(configText), fields });
const applied = (configText = candidate) => ({ ...inspected(), fields: fields.map((field) => field.id === 'plate_length_mm' ? { ...field, value_mm: 180 } : field), config_toml: configText, candidate_sha256: hash(configText), changed: configText !== source });
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t) {
  const { mountModelParameterEditor } = await import('../public/js/studio/model-parameters.js');
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  t.after(() => setLocale('en', { persist: false }));
  const state = createStudioShellState({ hash: '#model' });
  state.connectionState = 'connected';
  state.data.model.configText = source;
  state.data.model.preview = { id: 'old-preview' };
  state.data.drawing.preview = { id: 'old-sheet' };
  state.data.drawing.history = [{ value: 6 }];
  const savedJob = { id: 'saved', status: 'succeeded' };
  state.data.recentJobs.items = [savedJob];
  const requests = [];
  let navigationRevision = 0;
  let installed = 0;
  const root = workspaceDefinitions.model.render(state);
  document.append(root);
  const mounts = [];
  function mount() {
    const controller = mountModelParameterEditor({
      root, state, getNavigationRevision: () => navigationRevision,
      onConfigInstalled() { installed += 1; },
      postJson(url, body) {
        return new Promise((resolve, reject) => requests.push({ url, body, resolve, reject }));
      },
    });
    mounts.push(controller);
    return controller;
  }
  const controller = mount();
  t.after(() => mounts.forEach((entry) => entry.destroy()));
  const click = (action) => root.querySelector(`[data-action="model-parameters-${action}"]`).dispatch('click');
  async function finish() {
    for (let step = 0; step < 1000 && ['inspecting', 'applying'].includes(state.data.model.parameterEditor?.status); step += 1) await settle();
    assert.ok(!['inspecting', 'applying'].includes(state.data.model.parameterEditor?.status), 'The operation should settle after its response and hash validation');
  }
  async function inspect() { click('inspect'); requests.at(-1).resolve(inspected()); await finish(); }
  const input = (id = 'plate_length_mm') => root.querySelector(`[data-model-parameter="${id}"]`);
  function edit(value, id = 'plate_length_mm') { input(id).value = String(value); input(id).dispatch('input'); }
  return { root, state, requests, controller, mount, click, inspect, edit, input, savedJob, finish,
    navigate() { navigationRevision += 1; state.route = 'home'; }, installed: () => installed };
}

test('inspect sends only current source and keeps typed drafts/focus through polling', async (t) => {
  const { requests, controller, inspect, input, edit, state } = await setup(t);
  await inspect();
  assert.deepEqual(requests[0].body, { mode: 'inspect', config_toml: source });
  assert.equal(requests[0].url, '/api/studio/model-parameters');
  assert.equal(input().value, '160');
  input().focus(); edit('180.5');
  const focused = input(); controller.syncFromShell(); controller.syncFromShell();
  assert.equal(requests.length, 1, 'sync and numeric typing must not start inspection requests');
  assert.equal(input(), focused); assert.equal(document.activeElement, focused);
  assert.equal(input().value, '180.5'); assert.equal(state.data.model.configText, source);
});

test('apply sends finite field changes with source hash and installs the complete validated candidate', async (t) => {
  const { requests, state, inspect, edit, click, installed, savedJob, finish } = await setup(t);
  await inspect(); edit(180); click('apply');
  assert.deepEqual(requests[1].body, {
    mode: 'apply', config_toml: source, source_sha256: hash(source), changes: { plate_length_mm: 180 },
  });
  requests[1].resolve(applied()); await finish();
  assert.equal(state.data.model.configText, candidate);
  assert.equal(state.data.model.preview, null); assert.equal(state.data.drawing.preview, null);
  assert.deepEqual(state.data.drawing.history, []); assert.equal(installed(), 1);
  assert.equal(state.data.recentJobs.items[0], savedJob);
  assert.equal(state.data.model.guidedFlow.step, 'preflight');
});

test('undo restores exact source bytes while clearing newer preview evidence', async (t) => {
  const { requests, state, inspect, edit, click, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].resolve(applied()); await finish();
  state.data.model.preview = { id: 'candidate-preview' };
  click('undo');
  assert.equal(state.data.model.configText, source); assert.equal(state.data.model.preview, null);
  assert.equal(requests.length, 2, 'undo uses the exact before text, not a second rewrite');
});

test('undo cannot overwrite an intervening TOML edit', async (t) => {
  const { requests, state, controller, inspect, edit, click, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].resolve(applied()); await finish();
  state.data.model.configText = '# my edit\n' + candidate; controller.syncFromShell(); click('undo');
  assert.equal(state.data.model.configText, '# my edit\n' + candidate);
});

for (const value of ['', 'NaN', 'Infinity', '1e400']) {
  test(`invalid numeric draft ${JSON.stringify(value)} never sends apply or changes the model`, async (t) => {
    const { requests, state, inspect, edit, click } = await setup(t);
    await inspect(); edit(value); click('apply');
    assert.equal(requests.length, 1); assert.equal(state.data.model.configText, source);
    assert.equal(state.data.model.preview.id, 'old-preview');
  });
}

test('unchanged values preserve existing model and Drawing previews', async (t) => {
  const { requests, state, inspect, click } = await setup(t);
  await inspect(); const modelPreview = state.data.model.preview; const drawing = state.data.drawing;
  click('apply');
  assert.equal(requests.length, 1); assert.equal(state.data.model.preview, modelPreview); assert.equal(state.data.drawing, drawing);
});

test('cancel discards numeric drafts and ignores an outstanding apply without mutating config', async (t) => {
  const { requests, state, inspect, edit, click, input } = await setup(t);
  await inspect(); edit(180); click('apply'); click('cancel');
  requests[1].resolve(applied()); await settle(); await settle();
  assert.equal(state.data.model.configText, source); assert.equal(input().value, '160');
  assert.equal(state.data.model.preview.id, 'old-preview');
});

for (const drift of ['source', 'navigation', 'remount', 'model-replacement']) {
  test(`${drift} change discards a delayed apply response`, async (t) => {
    const fixture = await setup(t);
    const { requests, state, controller, mount, inspect, edit, click, navigate } = fixture;
    await inspect(); edit(180); click('apply');
    if (drift === 'source') state.data.model.configText = 'name = "new-input"';
    if (drift === 'navigation') navigate();
    if (drift === 'remount') { controller.destroy(); mount(); }
    if (drift === 'model-replacement') state.data.model = { ...state.data.model, configText: 'new model' };
    const current = state.data.model.configText;
    requests[1].resolve(applied()); await settle(); await settle();
    assert.equal(state.data.model.configText, current); assert.equal(fixture.installed(), 0);
  });
}

test('a delayed inspection cannot replace fields for a changed source', async (t) => {
  const { requests, state, controller, click, input } = await setup(t);
  click('inspect'); state.data.model.configText = 'new source'; controller.syncFromShell();
  requests[0].resolve(inspected()); await settle(); await settle();
  assert.equal(input(), null); assert.equal(state.data.model.configText, 'new source');
});

test('unsupported configurations keep their TOML and expose no guessed numeric form', async (t) => {
  const { requests, state, click, input, root } = await setup(t);
  click('inspect'); requests[0].resolve({ ok: true, supported: false, source_sha256: hash(source), profile_id: null, fields: [], reason: 'unsupported_configuration' });
  await settle(); await settle();
  assert.equal(input(), null); assert.equal(state.data.model.configText, source);
  assert.match(root.querySelector('[data-hook="model-parameters-status"]').textContent, /TOML/);
});

test('failed apply retains source, existing preview and editable field values', async (t) => {
  const { requests, state, inspect, edit, click, input } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].reject(new Error('invalid candidate')); await settle();
  assert.equal(state.data.model.configText, source); assert.equal(state.data.model.preview.id, 'old-preview');
  assert.equal(input().value, '180');
});

test('Korean remount retains numeric drafts and exact undo while using localized field names', async (t) => {
  const { requests, state, controller, mount, inspect, edit, click, root, input, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].resolve(applied()); await finish();
  edit(190); controller.destroy(); setLocale('ko', { persist: false }); mount();
  assert.equal(input().value, '190');
  assert.match(input().parentElement.textContent, /길이.*mm/);
  click('undo'); assert.equal(state.data.model.configText, source);
  assert.match(root.querySelector('[data-hook="model-parameters-status"]').textContent, /되돌/);
});

test('hinge profile displays only its two geometry parameters', async (t) => {
  const { requests, click, root, finish } = await setup(t);
  click('inspect'); requests[0].resolve({ ...inspected(), profile_id: 'hinge_block', fields: [
    { id: 'hinge_pin_diameter_mm', value_mm: 8, unit: 'mm', min_exclusive: 0, max_exclusive: null },
    { id: 'mounting_hole_diameter_mm', value_mm: 6, unit: 'mm', min_exclusive: 0, max_exclusive: null },
  ] }); await finish();
  assert.deepEqual(root.querySelectorAll('[data-model-parameter]').map((input) => input.dataset.modelParameter), ['hinge_pin_diameter_mm', 'mounting_hole_diameter_mm']);
});

for (const [label, payload] of [
  ['unknown profile', { ...inspected(), profile_id: 'generic' }],
  ['unexpected field', { ...inspected(), fields: [...fields.slice(0, -1), { id: 'arbitrary_path', value_mm: 10, unit: 'mm' }] }],
  ['mismatched source hash', { ...inspected(), source_sha256: '0'.repeat(64) }],
]) {
  test(`${label} does not enable numeric authoring`, async (t) => {
    const { requests, state, click, input, finish } = await setup(t);
    click('inspect'); requests[0].resolve(payload); await finish();
    assert.equal(input(), null); assert.equal(state.data.model.configText, source);
  });
}

test('an apply response with an inconsistent candidate hash cannot invalidate current evidence', async (t) => {
  const { requests, state, inspect, edit, click, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].resolve({ ...applied(), candidate_sha256: '0'.repeat(64) }); await finish();
  assert.equal(state.data.model.configText, source); assert.equal(state.data.model.preview.id, 'old-preview');
});

test('a server-confirmed no-op preserves current evidence', async (t) => {
  const { requests, state, inspect, edit, click, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); requests[1].resolve({ ...applied(source), fields }); await finish();
  assert.equal(state.data.model.configText, source); assert.equal(state.data.model.preview.id, 'old-preview');
  assert.equal(state.data.drawing.preview.id, 'old-sheet');
});

test('leaving and returning to the same Model route still retires a delayed apply', async (t) => {
  const { requests, state, inspect, edit, click, navigate, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); navigate(); state.route = 'model';
  requests[1].resolve(applied()); await finish();
  assert.equal(state.data.model.configText, source);
});

test('a newer preview completed during apply is not cleared by the delayed candidate', async (t) => {
  const { requests, state, inspect, edit, click, finish } = await setup(t);
  await inspect(); edit(180); click('apply'); state.data.model.preview = { id: 'newer-preview' };
  requests[1].resolve(applied()); await finish();
  assert.equal(state.data.model.configText, source); assert.equal(state.data.model.preview.id, 'newer-preview');
});

for (const busy of ['building', 'validating', 'tracked', 'assistant']) {
  test(`apply is unavailable while ${busy} owns the authoring state`, async (t) => {
    const { requests, state, controller, inspect, edit, click, root } = await setup(t);
    await inspect(); edit(180);
    if (busy === 'tracked') state.data.model.trackedRun.submitting = true;
    else if (busy === 'assistant') state.data.model.assistant.busy = true;
    else state.data.model.buildState = busy;
    controller.syncFromShell();
    assert.equal(root.querySelector('[data-action="model-parameters-apply"]').disabled, true);
    click('apply'); assert.equal(requests.length, 1);
  });
}

test('the mounted Model controller installs parameter changes into its existing TOML and preflight UI', async (t) => {
  const barrel = new URL('../public/js/app/index.js', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, nextLoad) {
    if (url === barrel) return { format: 'module', shortCircuit: true, source: "export { createViewerStore } from './store.js'; export const initScene = () => null; export const createAnimationController = () => null; export const renderModelInfo = () => {};" };
    return nextLoad(url, context);
  } });
  const { mountModelWorkspace } = await import('../public/js/studio/model-workspace.js');
  hooks.deregister();
  t.after(installDrawingTestDom());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = (url, options) => new Promise((resolve) => requests.push({
    url, body: JSON.parse(options.body), resolve(payload) { resolve({ ok: true, json: async () => payload }); },
  }));
  const state = createStudioShellState({ hash: '#model' });
  state.connectionState = 'connected'; state.data.health.available = true;
  state.data.model.configText = source; state.data.model.profileCatalog.status = 'ready';
  const root = workspaceDefinitions.model.render(state); document.append(root);
  let draftWrites = 0;
  const controller = mountModelWorkspace({ root, state, addLog() {}, onDraftChange() { draftWrites += 1; } });
  t.after(() => controller.destroy());
  root.querySelector('[data-action="model-parameters-inspect"]').dispatch('click'); requests[0].resolve(inspected());
  for (let step = 0; step < 1000 && state.data.model.parameterEditor.status === 'inspecting'; step += 1) await settle();
  const input = root.querySelector('[data-model-parameter="plate_length_mm"]');
  assert.ok(input); input.value = '180'; input.dispatch('input');
  const beforeApply = draftWrites;
  root.querySelector('[data-action="model-parameters-apply"]').dispatch('click'); requests[1].resolve(applied());
  for (let step = 0; step < 1000 && state.data.model.parameterEditor.status === 'applying'; step += 1) await settle();
  assert.equal(root.querySelector('[data-hook="config-textarea"]').value, candidate);
  assert.equal(root.querySelector('[data-model-guided-step="preflight"]').hidden, false);
  assert.ok(draftWrites > beforeApply, 'the shared draft is persisted through the existing Model callback');
});

async function setupMountedSourceReload(t, { fileSource = false } = {}) {
  const barrel = new URL('../public/js/app/index.js', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, nextLoad) {
    if (url === barrel) return { format: 'module', shortCircuit: true, source: "export { createViewerStore } from './store.js'; export const initScene = () => null; export const createAnimationController = () => null; export const renderModelInfo = () => {};" };
    return nextLoad(url, context);
  } });
  const { mountModelWorkspace } = await import('../public/js/studio/model-workspace.js');
  hooks.deregister();
  t.after(installDrawingTestDom());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = (url, options) => new Promise((resolve) => requests.push({
    url, body: JSON.parse(options.body), resolve(payload) { resolve({ ok: true, json: async () => payload }); },
  }));
  const state = createStudioShellState({ hash: '#model' });
  state.connectionState = 'connected'; state.data.health.available = true;
  Object.assign(state.data.model, {
    configText: source, sourceType: fileSource ? 'local file' : 'example', sourceName: 'bracket.toml',
    sourcePath: fileSource ? 'bracket.toml' : 'bracket', activePreviewRequest: null, activeTrackedSubmission: null,
  });
  state.data.model.profileCatalog.status = 'ready';
  state.data.examples.items = [{ id: 'bracket', name: 'bracket.toml', content: source }];
  state.data.examples.selectedId = 'bracket';
  const root = workspaceDefinitions.model.render(state); document.append(root);
  const controller = mountModelWorkspace({ root, state, addLog() {} });
  t.after(() => controller.destroy());
  const click = (action) => root.querySelector(`[data-action="model-parameters-${action}"]`).dispatch('click');
  async function finish() {
    for (let step = 0; step < 1000 && ['inspecting', 'applying'].includes(state.data.model.parameterEditor.status); step += 1) await settle();
    assert.ok(!['inspecting', 'applying'].includes(state.data.model.parameterEditor.status));
  }
  click('inspect'); requests[0].resolve(inspected()); await finish();
  const input = root.querySelector('[data-model-parameter="plate_length_mm"]');
  input.value = '180'; input.dispatch('input'); click('apply');
  assert.equal(state.data.model.parameterEditor.status, 'applying');
  return { state, root, requests, finish };
}

for (const action of ['same-example', 'same-file', 'file-read-pending', 'same-text-edit', 'text-A-B-A']) {
  test(`explicit ${action} intent retires delayed Apply even when final source values match`, async (t) => {
    const { state, root, requests } = await setupMountedSourceReload(t, { fileSource: action.includes('file') });
    let releaseFile;
    if (action === 'same-example') root.querySelector('[data-hook="load-example"]').dispatch('click');
    else if (action.includes('file')) {
      const input = root.querySelector('[data-hook="config-file"]');
      input.files = [{ name: 'bracket.toml', text: () => action === 'file-read-pending'
        ? new Promise((resolve) => { releaseFile = resolve; }) : Promise.resolve(source) }];
      input.dispatch('change');
    } else {
      const input = root.querySelector('[data-hook="config-textarea"]');
      if (action === 'text-A-B-A') { input.value = 'name = "B"'; input.dispatch('input'); }
      input.value = source; input.dispatch('input');
    }
    await settle();
    assert.equal(state.data.model.configText, source, 'new intent restores or retains the original source');
    requests[1].resolve(applied()); await settle(); await settle();
    assert.equal(state.data.model.configText, source, 'the retired Apply must not reinstall discarded edits');
    assert.equal(root.querySelector('[data-model-parameter="plate_length_mm"]'), null, 'source replacement retires the old numeric profile');
    if (releaseFile) { releaseFile(source); await settle(); }
  });
}
