import { el, createButton } from './renderers.js';
import { t } from '../i18n/index.js';

export function canPreviewSavedModel(artifact) {
  return artifact?.exists !== false
    && artifact?.capabilities?.can_preview_model === true
    && typeof artifact?.links?.model_preview === 'string'
    && artifact.links.model_preview.startsWith('/artifacts/');
}

async function loadSceneModules() {
  const [scene, store] = await Promise.all([import('../app/scene.js'), import('../app/store.js')]);
  return { ...scene, ...store };
}

export function createArtifactModelViewer({ root, fetchImpl = fetch, loadScene = loadSceneModules }) {
  let key = '';
  let generation = 0;
  let scene = null;
  let request = null;
  let destroyed = false;
  root.hidden = true;

  function reset() {
    generation += 1;
    key = '';
    request?.abort();
    request = null;
    scene?.destroy();
    scene = null;
    root.replaceChildren();
    root.hidden = true;
    delete root.dataset.previewState;
  }

  return {
    reset,
    async show(artifact, jobId) {
      if (destroyed) return;
      if (!canPreviewSavedModel(artifact)) { if (key) reset(); return; }
      const nextKey = `${jobId}:${artifact.id}:${artifact.links.model_preview}`;
      if (key === nextKey) return;
      reset();
      key = nextKey;
      const token = generation;
      const activeRequest = new AbortController();
      request = activeRequest;
      root.hidden = false;
      root.dataset.previewState = 'loading';
      const status = el('p', { attrs: { role: 'status' }, text: t('studio.artifacts.model.loading', { name: artifact.file_name }) });
      const viewport = el('div', { className: 'saved-model-viewport', attrs: { role: 'img', 'aria-label': t('studio.artifacts.model.canvas') } });
      const fit = createButton({ label: t('studio.artifacts.model.fit') });
      fit.disabled = true;
      fit.addEventListener('click', () => scene?.fitView());
      root.replaceChildren(status, fit, viewport);
      try {
        const graphics = await loadScene();
        if (destroyed || token !== generation) return;
        scene = graphics.initScene({ viewport, partsListElement: document.createElement('div'), state: graphics.createViewerStore().state });
        const response = await fetchImpl(artifact.links.model_preview, { method: 'POST', signal: activeRequest.signal });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.error?.messages?.join(' ') || `HTTP ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        if (destroyed || token !== generation) return;
        scene.loadStl(bytes, { validate: true });
        fit.disabled = false;
        root.dataset.previewState = 'ready';
        status.textContent = t('studio.artifacts.model.ready', { name: artifact.file_name });
      } catch (error) {
        if (destroyed || token !== generation) return;
        scene?.destroy();
        scene = null;
        root.dataset.previewState = 'error';
        status.textContent = `${t('studio.artifacts.model.failed')} ${error.message}`;
        fit.disabled = true;
      }
    },
    destroy() { destroyed = true; reset(); },
  };
}
