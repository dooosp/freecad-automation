import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';
import { setLocale } from '../public/js/i18n/index.js';
import { createArtifactModelViewer } from '../public/js/studio/artifact-model-viewer.js';

const file = (id) => ({ id, file_name: `${id}.step`, exists: true, capabilities: { can_preview_model: true }, links: { model_preview: `/artifacts/job/${id}/model-preview` } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('changing artifacts prevents a late old mesh from replacing the selected result and releases graphics', async (t) => {
  const restore = installDrawingTestDom(); t.after(restore); setLocale('en', { persist: false });
  const root = document.createElement('div');
  const oldResponse = deferred(); const requested = deferred();
  const displayed = [];
  let disposed = 0;
  const viewer = createArtifactModelViewer({
    root,
    loadScene: async () => ({ createViewerStore: () => ({ state: {} }), initScene: () => ({ loadStl: (bytes) => displayed.push(new TextDecoder().decode(bytes)), destroy: () => { disposed += 1; }, fitView() {} }) }),
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'POST');
      if (url.includes('/old/')) { requested.resolve(); return oldResponse.promise; }
      return new Response('new mesh');
    },
  });
  const old = viewer.show(file('old'), 'job');
  await requested.promise;
  await viewer.show(file('new'), 'job');
  oldResponse.resolve(new Response('old mesh'));
  await old;
  assert.deepEqual(displayed, ['new mesh']);
  assert.match(root.textContent, /new.step/);
  assert.equal(root.dataset.previewState, 'ready');
  viewer.destroy();
  assert.equal(disposed, 2);
});

test('unauthorized or missing models do not request a mesh, and failures remain visible', async (t) => {
  const restore = installDrawingTestDom(); t.after(restore); setLocale('en', { persist: false });
  const root = document.createElement('div'); let requests = 0;
  const viewer = createArtifactModelViewer({ root,
    loadScene: async () => ({ createViewerStore: () => ({ state: {} }), initScene: () => ({ destroy() {}, fitView() {} }) }),
    fetchImpl: async () => { requests += 1; return new Response(JSON.stringify({ error: { messages: ['Source changed; reopen it.'] } }), { status: 409 }); },
  });
  await viewer.show({ ...file('blocked'), capabilities: { can_preview_model: false } }, 'job');
  await viewer.show({ ...file('missing'), exists: false }, 'job');
  assert.equal(requests, 0);
  await viewer.show(file('changed'), 'job');
  assert.equal(root.dataset.previewState, 'error');
  assert.match(root.textContent, /Source changed/);
  assert.doesNotMatch(root.textContent, /3D preview ready/);
  viewer.destroy();
});
