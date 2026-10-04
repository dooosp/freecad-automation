import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installModelParameterConfig } from '../public/js/studio/model-parameter-state.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { aiDraftRequiresReview } from '../public/js/studio/ai-guided-flow.js';

const originalConfig = 'name = "bracket"\nlength = 30\n';
const editedConfig = 'name = "bracket"\nlength = 40\n';

function fixture() {
  const state = createStudioShellState({ hash: '#artifacts?job=saved-job' });
  Object.assign(state.data.model, {
    configText: originalConfig,
    sourceType: 'local file', sourceName: 'bracket.toml', sourcePath: 'bracket.toml',
    promptText: 'make a bracket', promptMode: false, recoveredDraft: true,
    preview: { id: 'model-preview', quality: { status: 'pass' } },
    previewConfigText: originalConfig,
    previewBuildSettings: { include_step: true },
    overview: { name: 'bracket', volume: 100 },
    validation: { warnings: ['old warning'], changed_fields: ['old'], deprecated_fields: ['legacy'] },
    buildState: 'success', buildSummary: 'Previous build succeeded.',
    errorMessage: 'old error', buildLog: ['old build'],
    activePreviewRequest: {}, activeTrackedSubmission: {},
    trackedRun: { type: 'create', lastJobId: 'saved-job', status: 'succeeded', submitting: true, error: 'old' },
    guidedFlow: { step: 'result', inputMethod: 'file', resultExpanded: true, error: 'old' },
    assistant: { busy: false, error: 'old', report: { warnings: ['old'] }, phase: 'validated', validatedConfigText: originalConfig },
    buildSettings: { include_step: false, include_stl: true, per_part_stl: false },
    reportOptions: { includeDrawing: false, includeTolerance: true, includeDfm: true, includeCost: true, profileName: 'shop', open: true },
    controls: { wireframe: true, edges: false, opacity: 65 },
  });
  Object.assign(state.data.drawing, {
    status: 'ready', preview: { id: 'drawing-preview', revision: 'edited', svg: '<svg/>' },
    errorMessage: 'old', summary: 'Edited sheet',
    settings: { views: ['front', 'top'], scale: '1:2', section_assist: true, detail_assist: false },
    history: [{ dimId: 'LENGTH', oldValue: 30, newValue: 47 }], historyIndex: 0,
    activeRequest: {}, previewInputSnapshot: 'old input', historyPlanReference: 'old plan',
    dimensionDrafts: { LENGTH: '48' }, dimensionDraftOwner: 'old owner', dimensionFocus: 'LENGTH',
    sourceArtifactRef: { job_id: 'saved-job', artifact_id: 'drawing' },
    trackedRun: { lastJobId: 'draw-job', status: 'succeeded', submitting: true, error: 'old', preservedEditedPreview: true },
  });
  const job = { id: 'saved-job', status: 'succeeded', quality: { status: 'pass' } };
  Object.assign(state.data.activeJob, { status: 'ready', summary: job, artifacts: [{ id: 'drawing', type: 'drawing.svg' }] });
  state.data.recentJobs.items = [job];
  state.data.jobMonitor.items = [{ jobId: 'running-job', status: 'running' }];
  state.data.completionNotice = { jobId: job.id, title: 'Saved output ready' };
  state.data.artifactsWorkspace.selectedArtifactId = 'drawing';
  return state;
}

function install(state, configText = editedConfig, expectedConfigText = originalConfig) {
  return installModelParameterConfig(state, { expectedConfigText, configText });
}

function captureIdentities(state) {
  return { data: { ...state.data }, model: { ...state.data.model }, drawing: { ...state.data.drawing } };
}

function assertUnchanged(state, before, identities) {
  assert.deepEqual(state, before);
  for (const [key, value] of Object.entries(identities.data)) {
    assert.equal(state.data[key], value, `${key} identity must be preserved`);
  }
  for (const key of ['model', 'drawing']) {
    for (const [field, value] of Object.entries(identities[key])) {
      assert.equal(state.data[key][field], value, `${key}.${field} identity must be preserved`);
    }
  }
}

test('a source mismatch cannot overwrite later typing or invalidate its evidence', () => {
  const state = fixture();
  state.data.model.configText += '# later typing\n';
  const before = structuredClone(state);
  const identities = captureIdentities(state);
  assert.equal(install(state), false);
  assertUnchanged(state, before, identities);
});

test('an exact no-op preserves preview, evidence, in-flight work and Drawing identity', () => {
  const state = fixture();
  const before = structuredClone(state);
  const identities = captureIdentities(state);
  assert.equal(install(state, originalConfig), false);
  assertUnchanged(state, before, identities);
});

test('invalid replacement text cannot partially clear current work', () => {
  for (const candidate of ['', ' \n\t', null, undefined, 40, { text: editedConfig }]) {
    const state = fixture();
    const before = structuredClone(state);
    const identities = captureIdentities(state);
    assert.equal(installModelParameterConfig(state, { expectedConfigText: originalConfig, configText: candidate }), false);
    assertUnchanged(state, before, identities);
  }
});

test('changed parameters retire preview and saved-quality associations while keeping the mounted Model object', () => {
  const state = fixture();
  const model = state.data.model;
  const source = { sourceType: model.sourceType, sourceName: model.sourceName, sourcePath: model.sourcePath, promptText: model.promptText, promptMode: model.promptMode, recoveredDraft: model.recoveredDraft };
  const preferences = { buildSettings: model.buildSettings, reportOptions: model.reportOptions, controls: model.controls, profileCatalog: model.profileCatalog };
  const defaults = createStudioShellState().data.model;
  assert.equal(install(state), true);
  assert.equal(state.data.model, model);
  assert.equal(model.configText, editedConfig);
  assert.equal(model.editingEnabled, true);
  for (const [key, value] of Object.entries(source)) assert.equal(model[key], value, key);
  for (const [key, value] of Object.entries(preferences)) assert.equal(model[key], value, key);
  assert.equal(model.preview, null);
  assert.equal(model.previewConfigText, '');
  assert.equal(model.previewBuildSettings, null);
  assert.equal(model.overview, null);
  assert.deepEqual(model.validation, defaults.validation);
  assert.equal(model.buildState, 'idle');
  assert.equal(model.buildSummary, '');
  assert.equal(model.errorMessage, '');
  assert.deepEqual(model.buildLog, []);
  assert.equal(model.activePreviewRequest, null);
  assert.equal(model.activeTrackedSubmission, null);
  assert.deepEqual(model.trackedRun, defaults.trackedRun);
  assert.deepEqual(model.assistant, defaults.assistant);
  assert.deepEqual(model.guidedFlow, { step: 'preflight', inputMethod: 'file', resultExpanded: false, error: '' });
});

test('changed parameters replace all Drawing transients and detach old request and settings owners', () => {
  const state = fixture();
  const drawing = state.data.drawing;
  const before = structuredClone(drawing);
  assert.equal(install(state), true);
  assert.notEqual(state.data.drawing, drawing);
  assert.deepEqual(state.data.drawing, { ...createStudioShellState().data.drawing, settings: before.settings });
  assert.notEqual(state.data.drawing.settings, drawing.settings);
  assert.deepEqual(drawing, before, 'retired Drawing remains owned by its pending callbacks');
  drawing.preview = { id: 'late-response' };
  drawing.settings.views.push('right');
  drawing.settings.scale = '1:5';
  assert.equal(state.data.drawing.preview, null);
  assert.deepEqual(state.data.drawing.settings, before.settings);
});

test('installing parameters preserves saved jobs, monitoring, result selection and navigation', () => {
  const state = fixture();
  const before = structuredClone(state);
  const identities = { ...state.data };
  assert.equal(install(state), true);
  for (const key of Object.keys(identities).filter((key) => !['model', 'drawing'].includes(key))) {
    assert.equal(state.data[key], identities[key], key);
    assert.deepEqual(state.data[key], before.data[key], key);
  }
  assert.equal(state.route, before.route);
  assert.equal(state.selectedJobId, 'saved-job');
  assert.equal(state.data.activeJob.summary.quality.status, 'pass', 'saved output retains its own evidence');
  assert.equal(state.data.model.trackedRun.lastJobId, '', 'edited config no longer claims saved output evidence');
});

test('edited AI sources need review again and undo never restores old quality or preview', () => {
  const state = fixture();
  state.data.model.sourceType = 'assistant draft';
  assert.equal(aiDraftRequiresReview(state.data.model), false);
  assert.equal(install(state), true);
  assert.equal(state.data.model.assistant.phase, 'review');
  assert.equal(state.data.model.assistant.validatedConfigText, '');
  assert.equal(aiDraftRequiresReview(state.data.model), true);
  assert.equal(install(state, originalConfig, editedConfig), true);
  assert.equal(state.data.model.configText, originalConfig);
  assert.equal(state.data.model.preview, null);
  assert.equal(state.data.model.trackedRun.lastJobId, '');
  assert.equal(state.data.drawing.preview, null);
  assert.equal(aiDraftRequiresReview(state.data.model), true);
});
