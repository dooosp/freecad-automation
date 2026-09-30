import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStudioShellRouting } from '../public/js/studio/studio-shell-routing.js';
import { createStudioJobMonitorController } from '../public/js/studio/studio-shell-job-monitor.js';
import { createStudioShellRuntime, createStudioShellState } from '../public/js/studio/studio-shell-store.js';

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function navigationFixture(t, hash = '#start') {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const summaries = new Map();
  const artifacts = new Map();
  const retries = new Map();
  const deferredResponses = new Map();
  const requests = [];
  const location = { hash, search: '' };
  const state = createStudioShellState(location);
  const app = {
    state,
    runtime: createStudioShellRuntime(),
    window: { location, setTimeout: () => 1, clearTimeout() {} },
    document: { activeElement: null },
    elements: { workspaceRoot: { focus() {}, querySelector: () => null } },
    dom: { renderCompletionNotice() {} },
    commitRender() {},
    refreshShellChrome() {},
    addLog() {},
    async fetchJson(url) {
      requests.push(url);
      const blocked = deferredResponses.get(url);
      if (blocked) {
        blocked.entered.resolve();
        await blocked.release.promise;
      }
      if (url === '/api/studio/jobs') return { job: summaries.values().next().value };
      if (url.endsWith('/retry')) return { job: retries.get(url.split('/')[2]) };
      if (url.startsWith('/jobs?')) return { jobs: [...summaries.values()] };
      const match = url.match(/^\/jobs\/([^/]+)(\/artifacts)?$/);
      assert.ok(match, `Unexpected transport request: ${url}`);
      const id = decodeURIComponent(match[1]);
      return match[2]
        ? { artifacts: artifacts.get(id) || [] }
        : { job: summaries.get(id) || null };
    },
  };
  globalThis.fetch = async (url) => ({ ok: true, json: () => app.fetchJson(url) });
  app.routing = createStudioShellRouting(app);
  app.jobs = createStudioJobMonitorController(app);
  app.navigateTo = app.routing.navigateTo;
  app.openJob = app.jobs.openJob;

  function job(id, status = 'running') {
    const summary = { id, type: 'create', status, updated_at: '2026-09-30T00:00:00Z', links: {} };
    summaries.set(id, summary);
    return summary;
  }
  function block(url) {
    const response = { entered: deferred(), release: deferred() };
    deferredResponses.set(url, response);
    return response;
  }
  function chooseRoute(nextHash) {
    location.hash = nextHash;
    app.routing.handleHashChange();
  }
  function selectReadyJob(summary, route = 'artifacts') {
    state.data.activeJob = { ...state.data.activeJob, status: 'ready', summary };
    app.routing.setRoute(route, { selectedJobId: summary.id, hash: true });
  }
  return { app, state, summaries, artifacts, retries, requests, job, block, chooseRoute, selectReadyJob };
}

test('slow restored artifact selection respects a later explicit Home choice', async (t) => {
  const fixture = navigationFixture(t, '#artifacts?job=restored');
  fixture.job('restored', 'succeeded');
  const blocked = fixture.block('/jobs/restored/artifacts');
  const restore = fixture.app.routing.syncSelectedJobFromLocation();
  await blocked.entered.promise;
  fixture.chooseRoute('#start');
  blocked.release.resolve();
  await restore;
  assert.equal(fixture.state.route, 'start');
  assert.equal(fixture.state.selectedJobId, '');
  assert.equal(fixture.app.window.location.hash, '#start');
  assert.equal(fixture.state.data.activeJob.status, 'ready');
});

test('restoration requested after Home was chosen does not reopen the old job', async (t) => {
  const fixture = navigationFixture(t, '#artifacts?job=restored');
  fixture.job('restored', 'succeeded');
  fixture.chooseRoute('#start');
  await fixture.app.routing.syncSelectedJobFromLocation();
  assert.equal(fixture.state.route, 'start');
  assert.deepEqual(fixture.requests, []);
});

test('a resumed background job completion preserves another selected job and route', async (t) => {
  const fixture = navigationFixture(t);
  const selected = fixture.job('selected', 'succeeded');
  const background = fixture.job('background');
  fixture.selectReadyJob(selected, 'review');
  fixture.state.data.recentJobs.items = [background, selected];
  fixture.app.jobs.resumeJobMonitoring();
  fixture.job('background', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'review');
  assert.equal(fixture.state.selectedJobId, 'selected');
  assert.equal(fixture.state.data.activeJob.summary.id, 'selected');
  assert.equal(fixture.state.data.completionNotice.jobId, 'background');
});

test('a resumed selected job completion refreshes its outputs without changing its route', async (t) => {
  const fixture = navigationFixture(t);
  const selected = fixture.job('selected');
  fixture.selectReadyJob(selected, 'review');
  fixture.state.data.recentJobs.items = [selected];
  fixture.app.jobs.resumeJobMonitoring();
  fixture.artifacts.set('selected', [{ id: 'finished-step', type: 'model.step', file_name: 'part.step', exists: true }]);
  fixture.job('selected', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'review');
  assert.equal(fixture.state.selectedJobId, 'selected');
  assert.equal(fixture.state.data.activeJob.summary.status, 'succeeded');
  assert.equal(fixture.state.data.activeJob.artifacts[0]?.id, 'finished-step');
  assert.equal(fixture.state.data.completionNotice.jobId, 'selected');
});

test('a submitted job keeps the existing automatic handoff when the user stays on its route', async (t) => {
  const fixture = navigationFixture(t, '#model');
  const submitted = fixture.job('submitted');
  fixture.app.jobs.beginJobMonitoring(submitted);
  fixture.job('submitted', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'artifacts');
  assert.equal(fixture.state.selectedJobId, 'submitted');
  assert.equal(fixture.state.data.activeJob.status, 'ready');
});

test('an explicit Home choice supersedes a submitted job completion handoff', async (t) => {
  const fixture = navigationFixture(t, '#model');
  const submitted = fixture.job('submitted');
  fixture.app.jobs.beginJobMonitoring(submitted);
  fixture.chooseRoute('#start');
  fixture.job('submitted', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'start');
  assert.equal(fixture.state.selectedJobId, '');
  assert.equal(fixture.app.window.location.hash, '#start');
  assert.equal(fixture.state.data.completionNotice.jobId, 'submitted');
});

test('Home selected while completion outputs load is not overwritten by late completion', async (t) => {
  const fixture = navigationFixture(t, '#model');
  const submitted = fixture.job('submitted');
  fixture.app.jobs.beginJobMonitoring(submitted);
  fixture.job('submitted', 'succeeded');
  const blocked = fixture.block('/jobs/submitted/artifacts');
  const completion = fixture.app.jobs.pollActiveJobs();
  await blocked.entered.promise;
  fixture.chooseRoute('#start');
  blocked.release.resolve();
  await completion;
  assert.equal(fixture.state.route, 'start');
  assert.equal(fixture.state.selectedJobId, '');
  assert.equal(fixture.app.window.location.hash, '#start');
});

test('leaving and returning to a submission route still supersedes automatic completion navigation', async (t) => {
  const fixture = navigationFixture(t, '#model');
  fixture.app.jobs.beginJobMonitoring(fixture.job('submitted'));
  fixture.chooseRoute('#start');
  fixture.chooseRoute('#model');
  fixture.job('submitted', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'model');
  assert.equal(fixture.state.selectedJobId, '');
});

test('Home selected while submission is pending also supersedes its eventual completion', async (t) => {
  const fixture = navigationFixture(t, '#model');
  fixture.job('submitted');
  const blocked = fixture.block('/api/studio/jobs');
  const submission = fixture.app.jobs.submitTrackedStudioRun({ type: 'create', configToml: 'name = "part"' });
  await blocked.entered.promise;
  fixture.chooseRoute('#start');
  blocked.release.resolve();
  await submission;
  fixture.job('submitted', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'start');
  assert.equal(fixture.state.selectedJobId, '');
});

test('refreshing recent job history preserves the current route and selected result', async (t) => {
  const fixture = navigationFixture(t);
  const selected = fixture.job('selected', 'succeeded');
  fixture.selectReadyJob(selected, 'review');
  fixture.job('newer', 'succeeded');
  await fixture.app.jobs.refreshRecentJobs();
  assert.equal(fixture.state.route, 'review');
  assert.equal(fixture.state.selectedJobId, 'selected');
  assert.equal(fixture.state.data.activeJob.summary.id, 'selected');
  assert.equal(fixture.state.data.recentJobs.items.length, 2);
});

test('Home selected during a delayed retry supersedes the retried job completion', async (t) => {
  const fixture = navigationFixture(t, '#history');
  fixture.job('failed', 'failed');
  fixture.retries.set('failed', fixture.job('retried', 'queued'));
  const blocked = fixture.block('/jobs/failed/retry');
  const retry = fixture.app.jobs.retryTrackedJobById('failed');
  await blocked.entered.promise;
  fixture.chooseRoute('#start');
  blocked.release.resolve();
  await retry;
  fixture.job('retried', 'succeeded');
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.route, 'start');
  assert.equal(fixture.state.selectedJobId, '');
});
