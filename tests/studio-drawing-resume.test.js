import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'smol-toml';
import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';
import { createStudioDrawingService } from '../src/server/studio-drawing-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const NAME = 'quality_pass_bracket';
const blueprint = parse(await readFile(join(ROOT, 'configs/examples/quality_pass_bracket.toml'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function environment(t) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'fcad-saved-drawing-')));
  let rendererCalls = 0;
  let service;
  const { server, jobStore } = createLocalApiServer({
    projectRoot: ROOT, jobsDir: join(temporary, 'jobs'),
    studioDrawingServiceFactory: (options) => {
      service = createStudioDrawingService({
        ...options,
        compileDrawingPlanFn({ config }) {
          config.drawing_plan.dim_intents.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm = 6;
          return { applied: true, partType: 'generic' };
        },
        generateDrawing: async ({ config }) => {
          rendererCalls += 1;
          const value = config.drawing_plan.dim_intents.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm;
          const path = join(config.export.directory, `${NAME}_drawing.svg`);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297"><text data-dim-id="HOLE_LEFT_DIA" data-value-mm="${value}">${value}</text></svg>`;
          await writeFile(path, svg);
          assert.equal(config.shapes.find((shape) => shape.id === 'hole_left').radius, 3);
          return { success: true, svgContent: svg, drawing_paths: [{ format: 'svg', path }], views: config.drawing.views, scale: config.drawing.scale };
        },
      });
      return service;
    },
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    await service.dispose();
    await rm(temporary, { recursive: true, force: true });
  });
  async function post(body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/studio/drawing-preview/from-artifact`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, payload: text.startsWith('{') ? JSON.parse(text) : text };
  }
  async function fixture({ omit = '', duplicate = '', conflictingPlan = false, scope = 'user-facing' } = {}) {
    const job = await jobStore.createJob({ type: 'draw', config: blueprint });
    const config = structuredClone(blueprint);
    config.drawing.scale = '1:2';
    config.drawing.views = ['front', 'top', 'right'];
    config.drawing.section = { plane: 'XZ', offset: 0 };
    config.drawing.detail = { center: [0, 0], radius: 10, source_view: 'front', scale_factor: 3, label: 'Z' };
    config.drawing_plan.views.enabled = ['front', 'top', 'right'];
    config.drawing_plan.dim_intents.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm = 8;
    config.export.directory = join(jobStore.getJobDir(job.id), 'artifacts');
    const plan = { drawing_plan: structuredClone(config.drawing_plan) };
    if (conflictingPlan) plan.drawing_plan.dim_intents.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm = 9;
    const definitions = [
      ['svg', 'drawing.svg', `artifacts/${NAME}_drawing.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><text>8</text></svg>', scope],
      ['config', 'config.effective', `artifacts/${NAME}_effective_config.json`, JSON.stringify(config), 'internal'],
      ['json', 'draw.plan.json', `artifacts/${NAME}_plan.json`, JSON.stringify(plan), 'user-facing'],
      ['toml', 'draw.plan.toml', `artifacts/${NAME}_plan.toml`, stringify({ drawing_plan: config.drawing_plan }), 'user-facing'],
      ['input', 'config.effective', 'inputs/effective-config.json', JSON.stringify(blueprint), 'internal'],
    ];
    const paths = {};
    const entries = [];
    for (const [key, type, path, contents, entryScope] of definitions) {
      paths[key] = await jobStore.writeJobFile(job.id, path, contents);
      if (key !== omit) entries.push({ type, path: paths[key], scope: entryScope, stability: 'stable' });
    }
    const manifest = await buildArtifactManifest({ projectRoot: ROOT, interface: 'api', command: 'draw', status: 'succeeded', artifacts: entries });
    if (duplicate) {
      const match = manifest.artifacts.find((entry) => entry.path === paths[duplicate]);
      assert.ok(match);
      manifest.artifacts.push({ ...match, id: `${match.id}-duplicate` });
    }
    await jobStore.completeJob(job.id, { success: true }, {}, {}, manifest);
    const artifacts = await jobStore.listArtifacts(job.id);
    const refs = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, {
      job_id: job.id, artifact_id: artifacts.find((entry) => entry.path === path)?.id,
    }]));
    return { job, paths, refs, manifest };
  }
  return { post, fixture, jobStore, service, rendererCalls: () => rendererCalls, temporary };
}

test('verified saved SVG and plans resume accepted annotations and settings into independent editable previews', async (t) => {
  const env = await environment(t);
  const saved = await env.fixture();
  const before = await Promise.all(Object.values(saved.paths).map(async (path) => hash(await readFile(path))));
  const ids = new Set();
  for (const key of ['svg', 'json', 'toml']) {
    const response = await env.post({ artifact_ref: saved.refs[key] });
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    const { preview, editable_config_toml: configToml, source } = response.payload;
    assert.equal(validateLocalApiResponse('studio_drawing_preview', response.payload).ok, true);
    assert.ok(preview.id && preview.revision && !ids.has(preview.id));
    ids.add(preview.id);
    assert.equal(preview.dimensions.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm, 8);
    assert.deepEqual(preview.settings, { views: ['front', 'top', 'right'], scale: '1:2', section_assist: true, detail_assist: true });
    assert.equal(preview.dimension_editing_available, true);
    const authoring = parse(configToml);
    assert.equal(authoring.shapes.find((shape) => shape.id === 'hole_left').radius, 3);
    assert.equal(authoring.drawing_plan.dim_intents.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm, 8);
    assert.ok(!JSON.stringify(response.payload).includes(env.temporary), 'no source job or preview filesystem paths');
    assert.ok(!authoring.export?.directory || authoring.export.directory === 'output');
    assert.deepEqual(source, { job_id: saved.job.id, artifact_id: saved.refs[key].artifact_id, drawing_artifact_id: saved.refs.svg.artifact_id, config_artifact_id: saved.refs.config.artifact_id, plan_artifact_id: saved.refs.json.artifact_id });
    const snapshot = await env.service.getTrackedDrawPlan({ previewId: preview.id, previewRevision: preview.revision, configToml, drawingSettings: preview.settings, strict: true });
    assert.equal(snapshot.reason, 'preserved');
    const edited = await env.service.updateDimension({ previewId: preview.id, previewRevision: preview.revision, dimId: 'HOLE_LEFT_DIA', valueMm: 9 });
    assert.equal(edited.preview.dimensions.find((entry) => entry.id === 'HOLE_LEFT_DIA').value_mm, 9);
  }
  assert.deepEqual(await Promise.all(Object.values(saved.paths).map(async (path) => hash(await readFile(path)))), before);
});

test('resume rejects arbitrary path/config/settings inputs and malformed references before rendering', async (t) => {
  const env = await environment(t);
  const saved = await env.fixture();
  for (const body of [
    {}, null, [], { artifact_ref: {} }, { artifact_ref: { job_id: '..', artifact_id: 'drawing' } },
    { artifact_ref: { ...saved.refs.svg, path: saved.paths.svg } },
    { artifact_ref: saved.refs.svg, config_toml: 'name="injected"' },
    { artifact_ref: saved.refs.svg, drawing_settings: { scale: '9:1' } },
    { artifact_ref: saved.refs.svg, config_path: saved.paths.config },
  ]) assert.equal((await env.post(body)).status, 400, JSON.stringify(body));
  assert.equal(env.rendererCalls(), 0);
});

test('resume rejects missing, ambiguous, mismatched and internal artifact groups', async (t) => {
  const env = await environment(t);
  for (const setup of [{ omit: 'json' }, { omit: 'config' }, { omit: 'svg' }, { duplicate: 'config' }, { duplicate: 'json' }, { conflictingPlan: true }, { scope: 'internal' }]) {
    const saved = await env.fixture(setup);
    const ref = setup.omit === 'svg' ? saved.refs.json : saved.refs.svg;
    const response = await env.post({ artifact_ref: ref });
    assert.equal(response.status, 400, JSON.stringify({ setup, payload: response.payload }));
    assert.ok(!JSON.stringify(response.payload).includes(env.temporary));
  }
  assert.equal(env.rendererCalls(), 0);
});

test('every consumed same-job artifact requires unchanged registered bytes and rejects links', async (t) => {
  const env = await environment(t);
  for (const key of ['svg', 'config', 'json', 'toml']) {
    const saved = await env.fixture();
    await writeFile(saved.paths[key], (await readFile(saved.paths[key], 'utf8')) + ' ');
    const response = await env.post({ artifact_ref: saved.refs.svg });
    assert.equal(response.status, 400, `reject changed ${key}`);
    assert.match(response.payload.error.messages.join(' '), /no longer matches.*registered bytes/);
  }
  for (const kind of ['symlink', 'hardlink']) {
    const saved = await env.fixture();
    const original = saved.paths.json + '.original';
    await writeFile(original, await readFile(saved.paths.json));
    await rm(saved.paths.json);
    if (kind === 'symlink') await symlink(original, saved.paths.json);
    else await link(original, saved.paths.json);
    const response = await env.post({ artifact_ref: saved.refs.svg });
    assert.equal(response.status, 400, `reject ${kind}`);
    assert.match(response.payload.error.messages.join(' '), /symbolic link|hard-linked/);
  }
  const missing = await env.fixture();
  await rm(missing.paths.config);
  assert.equal((await env.post({ artifact_ref: missing.refs.svg })).status, 400);
  assert.equal(env.rendererCalls(), 0);
});

test('resume rejects unverified digests and another job source path even with matching bytes', async (t) => {
  const env = await environment(t);
  const unverified = await env.fixture();
  const jobPath = join(env.jobStore.getJobDir(unverified.job.id), 'job.json');
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  const config = job.manifest.artifacts.find((entry) => entry.path === unverified.paths.config);
  delete config.sha256;
  await writeFile(jobPath, JSON.stringify(job));
  const unverifiedResponse = await env.post({ artifact_ref: unverified.refs.svg });
  assert.equal(unverifiedResponse.status, 400);
  assert.match(unverifiedResponse.payload.error.messages.join(' '), /no registered SHA-256/);
  const original = await env.fixture();
  const other = await env.fixture();
  const otherJobPath = join(env.jobStore.getJobDir(other.job.id), 'job.json');
  const otherJob = JSON.parse(await readFile(otherJobPath, 'utf8'));
  for (const entry of otherJob.manifest.artifacts) {
    const index = Object.values(other.paths).indexOf(entry.path);
    if (index >= 0) entry.path = Object.values(original.paths)[index];
  }
  await writeFile(otherJobPath, JSON.stringify(otherJob));
  const crossJobResponse = await env.post({ artifact_ref: other.refs.svg });
  assert.equal(crossJobResponse.status, 400);
  assert.match(crossJobResponse.payload.error.messages.join(' '), /outside.*tracked job/);
  assert.equal(env.rendererCalls(), 0);
});
