import { createButton, createCard, el } from './renderers.js';
import { t } from '../i18n/index.js';
import { installModelParameterConfig } from './model-parameter-state.js';

const PROFILE_FIELDS = {
  bracket: ['plate_length_mm', 'plate_width_mm', 'plate_thickness_mm', 'left_hole_diameter_mm', 'right_hole_diameter_mm'],
  hinge_block: ['hinge_pin_diameter_mm', 'mounting_hole_diameter_mm'],
};

export function renderModelParameterEditor() {
  const card = createCard({
    title: t('studio.model.parameters.title'), copy: t('studio.model.parameters.copy'),
    body: [
      el('p', { className: 'support-note', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { hook: 'model-parameters-status' } }),
      el('div', { className: 'model-parameter-fields', dataset: { hook: 'model-parameters-fields' } }),
      el('div', { className: 'action-row', children: ['inspect', 'apply', 'cancel', 'undo'].map((action) => createButton({
        label: t(`studio.model.parameters.${action}`), action: `model-parameters-${action}`,
        tone: action === 'apply' ? 'primary' : 'ghost',
      })) }),
    ],
  });
  card.dataset.hook = 'model-parameters';
  return card;
}

async function sha256(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function validProfile(payload) {
  const ids = PROFILE_FIELDS[payload?.profile_id];
  return payload?.ok === true && payload.supported === true && ids
    && Array.isArray(payload.fields) && payload.fields.length === ids.length
    && ids.every((id) => payload.fields.filter((field) => field.id === id && field.unit === 'mm' && Number.isFinite(field.value_mm)).length === 1);
}

export function mountModelParameterEditor({ root, state, postJson, onConfigInstalled = () => {}, getNavigationRevision = () => 0 }) {
  const element = root.querySelector('[data-hook="model-parameters"]');
  if (!element) return { syncFromShell() {}, invalidateSource() {}, destroy() {} };
  const model = state.data.model;
  const editor = model.parameterEditor ||= { status: 'empty', fields: [], values: {}, sourceText: '', sourceHash: '', undo: null };
  const fieldsElement = element.querySelector('[data-hook="model-parameters-fields"]');
  const statusElement = element.querySelector('[data-hook="model-parameters-status"]');
  const buttons = Object.fromEntries(['inspect', 'apply', 'cancel', 'undo'].map((action) => [action, element.querySelector(`[data-action="model-parameters-${action}"]`)]));
  let destroyed = false;
  let pending = null;
  let observedSource = model.configText;
  let renderedFields = null;

  function authoringBusy() {
    return ['building', 'validating'].includes(model.buildState) || model.trackedRun?.submitting
      || model.assistant?.busy || model.assistant?.phase === 'validating'
      || state.data.drawing?.activeRequest || state.data.drawing?.trackedRun?.submitting;
  }

  function context() {
    return {
      model: state.data.model, drawing: state.data.drawing, route: state.route,
      navigation: getNavigationRevision(), hash: globalThis.window?.location?.hash || '',
      selectedJobId: state.selectedJobId,
      config: model.configText, source: JSON.stringify([model.sourceType, model.sourceName, model.sourcePath]),
      preview: model.preview, drawingPreview: state.data.drawing?.preview,
      request: model.activePreviewRequest, submission: model.activeTrackedSubmission,
    };
  }

  function owns(request) {
    if (destroyed || pending !== request || state.data.model !== model || authoringBusy()) return false;
    const current = context();
    return Object.keys(request.context).every((key) => request.context[key] === current[key]);
  }

  function sync() {
    if (destroyed) return;
    if (observedSource !== model.configText) {
      observedSource = model.configText;
      pending = null;
      Object.assign(editor, { status: 'stale', fields: [], values: {}, sourceText: '', sourceHash: '', undo: null });
    }
    if (editor.fields.length && editor.sourceText !== model.configText) {
      Object.assign(editor, { status: 'stale', fields: [], values: {}, sourceText: '', sourceHash: '', undo: null });
    }
    if (renderedFields !== editor.fields) {
      renderedFields = editor.fields;
      fieldsElement.replaceChildren(...editor.fields.map((field) => {
        const input = el('input', {
          className: 'studio-input', attrs: { type: 'number', step: 'any', inputmode: 'decimal' },
          dataset: { modelParameter: field.id },
        });
        input.value = editor.values[field.id] ?? String(field.value_mm);
        input.addEventListener('input', () => { if (!pending) editor.values[field.id] = input.value; });
        return el('label', { className: 'studio-field', children: [
          el('span', { text: t(`studio.model.parameters.${field.id}`) }), input,
        ] });
      }));
    }
    const busy = Boolean(authoringBusy() || pending);
    fieldsElement.querySelectorAll('input').forEach((input) => { input.disabled = busy; });
    buttons.inspect.disabled = busy || state.connectionState !== 'connected' || !String(model.configText || '').trim();
    buttons.apply.hidden = editor.fields.length === 0;
    buttons.apply.disabled = busy || state.connectionState !== 'connected' || editor.fields.length === 0;
    buttons.cancel.hidden = editor.fields.length === 0 && !pending;
    buttons.undo.hidden = !editor.undo;
    buttons.undo.disabled = busy || !editor.undo || model.configText !== editor.undo.after;
    statusElement.textContent = t(`studio.model.parameters.${!String(model.configText || '').trim() ? 'empty' : editor.status}`);
  }

  function acceptProfile(payload, sourceText, sourceHash) {
    Object.assign(editor, {
      fields: payload.fields, values: Object.fromEntries(payload.fields.map((field) => [field.id, String(field.value_mm)])),
      sourceText, sourceHash, status: 'ready',
    });
  }

  async function inspect() {
    if (destroyed || pending || authoringBusy() || state.connectionState !== 'connected' || !String(model.configText || '').trim()) return;
    const request = { context: context() };
    pending = request; editor.status = 'inspecting'; sync();
    try {
      const payload = await postJson('/api/studio/model-parameters', { mode: 'inspect', config_toml: request.context.config });
      const sourceHash = await sha256(request.context.config);
      if (!owns(request)) return;
      if (payload?.ok !== true || payload.source_sha256 !== sourceHash) throw new Error('Invalid inspection');
      if (payload.supported === false) {
        Object.assign(editor, { status: 'unsupported', fields: [], values: {}, sourceText: request.context.config, sourceHash });
      } else {
        if (!validProfile(payload)) throw new Error('Unknown parameter profile');
        acceptProfile(payload, request.context.config, sourceHash);
      }
    } catch {
      if (owns(request)) editor.status = 'error';
    } finally {
      if (pending === request) { pending = null; if (editor.status === 'inspecting') editor.status = 'stale'; sync(); }
    }
  }

  async function apply() {
    if (destroyed || pending || authoringBusy() || state.connectionState !== 'connected' || !editor.fields.length) return;
    if (editor.sourceText !== model.configText) { sync(); return; }
    const changes = {};
    for (const field of editor.fields) {
      const raw = String(editor.values[field.id] ?? '').trim();
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) { editor.status = 'invalid'; sync(); return; }
      if (value !== field.value_mm) changes[field.id] = value;
    }
    if (!Object.keys(changes).length) { editor.status = 'unchanged'; sync(); return; }
    const request = { context: context() };
    pending = request; editor.status = 'applying'; sync();
    try {
      const payload = await postJson('/api/studio/model-parameters', {
        mode: 'apply', config_toml: request.context.config, source_sha256: editor.sourceHash, changes,
      });
      if (!owns(request)) return;
      if (!validProfile(payload) || payload.source_sha256 !== editor.sourceHash
        || typeof payload.config_toml !== 'string' || !payload.config_toml.trim()
        || payload.candidate_sha256 !== await sha256(payload.config_toml)
        || payload.changed !== (payload.config_toml !== request.context.config)) throw new Error('Invalid candidate');
      if (!owns(request)) return;
      if (!payload.changed) { editor.status = 'unchanged'; return; }
      if (!installModelParameterConfig(state, { expectedConfigText: request.context.config, configText: payload.config_toml })) return;
      observedSource = payload.config_toml;
      acceptProfile(payload, payload.config_toml, payload.candidate_sha256);
      editor.undo = { before: request.context.config, after: payload.config_toml };
      editor.status = 'applied';
      onConfigInstalled();
    } catch {
      if (owns(request)) editor.status = 'error';
    } finally {
      if (pending === request) { pending = null; if (editor.status === 'applying') editor.status = 'stale'; sync(); }
    }
  }

  function cancel() {
    if (destroyed) return;
    pending = null;
    editor.values = Object.fromEntries(editor.fields.map((field) => [field.id, String(field.value_mm)]));
    editor.status = editor.fields.length ? 'ready' : 'empty';
    renderedFields = null;
    sync();
  }

  function invalidateSource() {
    if (destroyed || state.data.model !== model) return;
    // Explicit loads/edits supersede pending work even when they restore identical bytes.
    pending = null;
    Object.assign(editor, { status: 'stale', fields: [], values: {}, sourceText: '', sourceHash: '', undo: null });
    sync();
  }

  function undo() {
    if (destroyed || pending || authoringBusy() || !editor.undo || state.data.model !== model) return;
    const { before, after } = editor.undo;
    if (!installModelParameterConfig(state, { expectedConfigText: after, configText: before })) { sync(); return; }
    observedSource = before;
    Object.assign(editor, { undo: null, status: 'undone', fields: [], values: {}, sourceText: '', sourceHash: '' });
    onConfigInstalled(); sync();
  }

  const handlers = { inspect, apply, cancel, undo };
  Object.entries(handlers).forEach(([action, handler]) => buttons[action].addEventListener('click', handler));
  if (['inspecting', 'applying'].includes(editor.status)) editor.status = editor.fields.length ? 'ready' : 'empty';
  sync();
  return {
    syncFromShell: sync,
    invalidateSource,
    destroy() {
      destroyed = true; pending = null;
      Object.entries(handlers).forEach(([action, handler]) => buttons[action].removeEventListener('click', handler));
    },
  };
}
