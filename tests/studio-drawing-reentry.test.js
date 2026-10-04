import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStudioWorkspaceController } from '../public/js/studio/studio-shell-workspace.js';
import { createStudioShellRouting } from '../public/js/studio/studio-shell-routing.js';
import { createStudioShellState, createStudioShellRuntime } from '../public/js/studio/studio-shell-store.js';
import { isDrawingPreviewStale } from '../public/js/studio/workbench-presentation.js';
import { setLocale } from '../public/js/i18n/index.js';

function response(artifactId = 'saved-svg', previewId = 'fresh-preview') {
  return {
    ok: true,
    editable_config_toml: 'name = "saved-bracket"\n[[shapes]]\nid = "body"\ntype = "box"\nlength = 30\nwidth = 20\nheight = 6\n',
    source: { job_id: 'saved-job', artifact_id: artifactId, drawing_artifact_id: 'saved-svg', config_artifact_id: 'saved-config', plan_artifact_id: 'saved-plan' },
    preview: {
      id: previewId, revision: `${previewId}-revision`, svg: '<svg/>',
      settings: { views: ['front', 'top'], scale: '1:2', section_assist: false, detail_assist: true },
      dimensions: [{ id: 'HOLE_DIA', value_mm: 8 }],
      overview: { name: 'saved-bracket' }, editable_plan_available: true,
    },
  };
}

function fixture(t) {
  setLocale('en', { persist: false });
  t.after(() => setLocale('en', { persist: false }));
  const location = { hash: '#artifacts?job=saved-job' };
  const state = createStudioShellState(location);
  Object.assign(state.data.model, {
    configText: 'name = "current-draft"', promptText: 'unsaved prompt', sourceName: 'current.toml',
    preview: { id: 'old-model-preview' }, previewConfigText: 'obsolete',
    activePreviewRequest: {}, activeTrackedSubmission: {},
    guidedFlow: { step: 'result', inputMethod: 'ai', resultExpanded: true, error: 'old' },
  });
  Object.assign(state.data.drawing, {
    status: 'ready', preview: { id: 'old-sheet', revision: 'old-revision', svg: '<svg/>' },
    history: [{ dimId: 'WIDTH', oldValue: 20, newValue: 25 }], historyIndex: 0,
    dimensionDrafts: { WIDTH: '26' }, dimensionFocus: 'WIDTH', activeRequest: null,
  });
  const job = { id: 'saved-job', type: 'draw', status: 'succeeded' };
  const artifact = { id: 'saved-svg', type: 'drawing.svg', scope: 'user-facing', exists: true, file_name: 'saved_drawing.svg' };
  state.data.activeJob.summary = job;
  state.data.activeJob.artifacts = [artifact];
  state.data.artifactsWorkspace.selectedArtifactId = artifact.id;
  const requests = [];
  const navigations = [];
  const focus = {};
  const app = {
    state, runtime: createStudioShellRuntime(), window: { location }, document: { activeElement: focus },
    elements: { workspaceRoot: { focus() {} } }, commitRender() {}, addLog() {}, persistDraft() {},
    fetchJson(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  };
  app.routing = createStudioShellRouting(app);
  app.navigateTo = (route, options) => {
    navigations.push({ route, model: state.data.model, drawing: state.data.drawing });
    app.routing.navigateTo(route, options);
  };
  app.workspace = createStudioWorkspaceController(app);
  function start(nextArtifact = artifact) {
    const priorCount = requests.length;
    const pending = app.workspace.resumeDrawingArtifact?.(job, nextArtifact);
    assert.equal(requests.length, priorCount + 1, 'reentry must request a fresh server preview');
    return pending;
  }
  return { app, state, job, artifact, requests, navigations, start, focus };
}

test('saved drawing installs canonical input, fresh preview and settings together with empty undo history', async (t) => {
  const f = fixture(t);
  const oldModel = f.state.data.model;
  const oldDrawing = f.state.data.drawing;
  const oldDraft = structuredClone(oldModel);
  const oldSheet = structuredClone(oldDrawing);
  const opening = f.start();
  assert.equal(f.requests[0].url, '/api/studio/drawing-preview/from-artifact');
  assert.equal(f.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { artifact_ref: { job_id: 'saved-job', artifact_id: 'saved-svg' } });
  assert.equal(f.state.data.model, oldModel, 'requesting does not clear the current draft');
  const payload = response();
  f.requests[0].resolve(payload);
  assert.equal(await opening, true);
  assert.equal(f.state.data.model.configText, payload.editable_config_toml);
  assert.equal(f.state.data.model.preview, null);
  assert.equal(f.state.data.model.activePreviewRequest, null);
  assert.equal(f.state.data.model.activeTrackedSubmission, null);
  assert.equal(f.state.data.model.promptText, '');
  assert.equal(f.state.data.model.guidedFlow.step, 'select_input');
  assert.equal(f.state.data.model.trackedRun.lastJobId, '');
  assert.equal(f.state.data.drawing.status, 'ready');
  assert.equal(f.state.data.drawing.preview.revision, 'fresh-preview-revision');
  assert.deepEqual(f.state.data.drawing.settings, { views: ['front', 'top'], scale: '1:2', section_assist: false, detail_assist: true });
  assert.equal(isDrawingPreviewStale(f.state.data.drawing, f.state.data.model), false);
  assert.deepEqual(f.state.data.drawing.history, []);
  assert.equal(f.state.data.drawing.historyIndex, -1);
  assert.deepEqual(f.state.data.drawing.dimensionDrafts, {});
  assert.equal(f.state.data.drawing.activeRequest, null);
  assert.equal(f.state.data.drawing.trackedRun.lastJobId, '');
  assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0].model, f.state.data.model);
  assert.equal(f.navigations[0].drawing, f.state.data.drawing);
  assert.equal(f.state.route, 'drawing');
  assert.deepEqual(oldModel, oldDraft);
  assert.deepEqual(oldDrawing, oldSheet);
  payload.preview.settings.scale = '1:5';
  assert.equal(f.state.data.drawing.settings.scale, '1:2', 'installed state owns its snapshots');
});

for (const failure of ['request failure', 'empty config', 'missing revision', 'invalid settings', 'mismatched source']) {
  test(`${failure} preserves the current draft, sheet, selection and focus`, async (t) => {
    const f = fixture(t);
    const before = structuredClone(f.state);
    const opening = f.start();
    const rejected = assert.rejects(opening);
    const payload = response();
    if (failure === 'request failure') f.requests[0].reject(new Error('Verified saved input is missing.'));
    else {
      if (failure === 'empty config') payload.editable_config_toml = '';
      if (failure === 'missing revision') delete payload.preview.revision;
      if (failure === 'invalid settings') payload.preview.settings.views = null;
      if (failure === 'mismatched source') payload.source.artifact_id = 'other-artifact';
      f.requests[0].resolve(payload);
    }
    await rejected;
    assert.deepEqual(f.state, before);
    assert.equal(f.navigations.length, 0);
    assert.equal(f.app.document.activeElement, f.focus);
  });
}

const drifts = {
  'Home navigation': (f) => f.app.routing.navigateTo('start'),
  'leave and return navigation': (f) => { f.app.routing.navigateTo('start'); f.app.routing.navigateTo('artifacts', { selectedJobId: 'saved-job' }); },
  'selected artifact': (f) => { f.state.data.artifactsWorkspace.selectedArtifactId = 'other-plan'; },
  'replacement source object': (f) => { f.state.data.model = structuredClone(f.state.data.model); },
  'typed config': (f) => { f.state.data.model.configText += '\n# new typing'; },
  'typed prompt': (f) => { f.state.data.model.promptText = 'new prompt'; },
  'build preferences': (f) => { f.state.data.model.buildSettings.include_step = false; },
  'sheet settings': (f) => { f.state.data.drawing.settings.scale = '1:5'; },
  'unsubmitted dimension draft': (f) => { f.state.data.drawing.dimensionDrafts.WIDTH = '30'; },
  'annotation request started': (f) => { f.state.data.drawing.activeRequest = {}; },
  'accepted annotation revision': (f) => { f.state.data.drawing.preview = { ...f.state.data.drawing.preview, revision: 'newer-edit' }; },
  'new model operation': (f) => { f.state.data.model.activePreviewRequest = {}; },
};
for (const [label, change] of Object.entries(drifts)) {
  test(`a delayed reentry cannot overwrite ${label}`, async (t) => {
    const f = fixture(t);
    const opening = f.start();
    change(f);
    const afterChange = structuredClone(f.state);
    f.requests[0].resolve(response());
    assert.equal(await opening, false);
    assert.deepEqual(f.state, afterChange);
    assert.equal(f.navigations.length, 0);
  });
}

test('a newer saved drawing request wins while a duplicate pending click creates no extra preview', async (t) => {
  const f = fixture(t);
  const first = f.start();
  assert.equal(await f.app.workspace.resumeDrawingArtifact(f.job, f.artifact), false);
  assert.equal(f.requests.length, 1);
  const nextArtifact = { ...f.artifact, id: 'saved-plan', type: 'draw.plan.toml' };
  const second = f.start(nextArtifact);
  f.requests[1].resolve(response('saved-plan', 'newest-preview'));
  assert.equal(await second, true);
  f.requests[0].resolve(response());
  assert.equal(await first, false);
  assert.equal(f.state.data.drawing.preview.id, 'newest-preview');
  assert.equal(f.navigations.length, 1);
});

test('pending annotation work cannot be replaced before it finishes', async (t) => {
  const f = fixture(t);
  f.state.data.drawing.activeRequest = { pending: true };
  const before = structuredClone(f.state);
  const opening = f.app.workspace.resumeDrawingArtifact?.(f.job, f.artifact);
  assert.ok(opening, 'reentry must enforce its operation guard');
  await assert.rejects(opening);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.state, before);
});
