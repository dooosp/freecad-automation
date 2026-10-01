import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStudioJobMonitorController } from '../public/js/studio/studio-shell-job-monitor.js';
import { createStudioShellRouting } from '../public/js/studio/studio-shell-routing.js';
import { createStudioShellRuntime, createStudioShellState } from '../public/js/studio/studio-shell-store.js';

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function jobSummary(id, status, second) {
  return {
    id,
    type: 'report',
    status,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: `2026-10-01T00:00:0${second}.000Z`,
    links: { artifacts: `/jobs/${id}/artifacts` },
  };
}

function orderingFixture(t) {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const summaries = new Map();
  const artifacts = new Map();
  const delayedResponses = new Map();
  const location = { hash: '#model', search: '' };
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
      const delayed = delayedResponses.get(url)?.shift();
      if (delayed) {
        delayed.entered.resolve();
        await delayed.release.promise;
        if (delayed.error) throw delayed.error;
        return structuredClone(delayed.payload);
      }
      if (url.startsWith('/jobs?')) {
        return { jobs: structuredClone([...summaries.values()]) };
      }
      const match = url.match(/^\/jobs\/([^/]+)(\/artifacts|\/cancel)?$/);
      assert.ok(match, `Unexpected transport request: ${url}`);
      return match[2] === '/artifacts'
        ? { artifacts: structuredClone(artifacts.get(decodeURIComponent(match[1])) || []) }
        : { job: structuredClone(summaries.get(decodeURIComponent(match[1])) || null) };
    },
  };
  globalThis.fetch = async (url) => {
    const payload = await app.fetchJson(url);
    return { ok: true, json: async () => payload };
  };
  app.routing = createStudioShellRouting(app);
  app.jobs = createStudioJobMonitorController(app);
  app.navigateTo = app.routing.navigateTo;
  app.openJob = app.jobs.openJob;

  function delayNext(url, payload, error = null) {
    const delayed = {
      payload: structuredClone(payload),
      error,
      entered: deferred(),
      release: deferred(),
    };
    const queue = delayedResponses.get(url) || [];
    queue.push(delayed);
    delayedResponses.set(url, queue);
    return delayed;
  }

  function begin(job, origin = 'submit') {
    summaries.set(job.id, job);
    app.jobs.beginJobMonitoring(job, {
      origin,
      announce: false,
      completionAction: { type: 'open-artifacts-on-success' },
    });
  }

  function chooseHome() {
    app.routing.navigateTo('start', { selectedJobId: '' });
  }

  function assertHome() {
    assert.equal(state.route, 'start');
    assert.equal(state.selectedJobId, '');
    assert.equal(location.hash, '#start');
  }

  function statusCopies(jobId) {
    return {
      recent: state.data.recentJobs.items.find((job) => job.id === jobId)?.status,
      monitored: state.data.jobMonitor.items.find((job) => job.id === jobId)?.status,
      selected: state.data.activeJob.summary?.id === jobId ? state.data.activeJob.summary.status : null,
    };
  }

  return { app, state, summaries, artifacts, delayNext, begin, chooseHome, assertHome, statusCopies };
}

test('a late running history snapshot cannot undo a polled terminal result', async (t) => {
  const fixture = orderingFixture(t);
  const running = jobSummary('history-race', 'running', 1);
  const succeeded = jobSummary('history-race', 'succeeded', 2);
  fixture.begin(running);
  fixture.state.data.activeJob = { ...fixture.state.data.activeJob, status: 'ready', summary: running };
  fixture.chooseHome();

  const history = fixture.delayNext('/jobs?limit=12', { jobs: [running] });
  const staleRefresh = fixture.app.jobs.refreshRecentJobs({ silent: true, preserveRender: true });
  await history.entered.promise;
  fixture.summaries.set(succeeded.id, succeeded);
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.data.completionNotice?.jobId, succeeded.id);

  history.release.resolve();
  await staleRefresh;

  fixture.assertHome();
  assert.deepEqual(fixture.statusCopies(succeeded.id), {
    recent: 'succeeded', monitored: 'succeeded', selected: 'succeeded',
  });
  assert.equal(fixture.state.data.jobMonitor.items[0].completionAction, null);
});

test('a late failed history request cannot clear a newer successful terminal snapshot', async (t) => {
  const fixture = orderingFixture(t);
  const running = jobSummary('history-error-race', 'running', 1);
  const succeeded = jobSummary('history-error-race', 'succeeded', 2);
  fixture.begin(running);
  fixture.chooseHome();
  const history = fixture.delayNext('/jobs?limit=12', null, new Error('Old history disconnected'));
  const staleRefresh = fixture.app.jobs.refreshRecentJobs({ silent: true, preserveRender: true });
  await history.entered.promise;
  fixture.summaries.set(succeeded.id, succeeded);
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.data.recentJobs.status, 'ready');

  history.release.resolve();
  await staleRefresh;
  fixture.assertHome();
  assert.equal(fixture.state.data.recentJobs.status, 'ready');
  assert.equal(fixture.state.data.recentJobs.items[0]?.status, 'succeeded');
  assert.equal(fixture.state.data.completionNotice?.jobId, succeeded.id);
});

test('the latest failed history request still reports unavailable history', async (t) => {
  const fixture = orderingFixture(t);
  fixture.begin(jobSummary('history-current-error', 'running', 1));
  fixture.chooseHome();
  const history = fixture.delayNext('/jobs?limit=12', null, new Error('Current history disconnected'));
  const refresh = fixture.app.jobs.refreshRecentJobs({ silent: true, preserveRender: true });
  await history.entered.promise;
  history.release.resolve();
  await refresh;
  fixture.assertHome();
  assert.equal(fixture.state.data.recentJobs.status, 'unavailable');
  assert.deepEqual(fixture.state.data.recentJobs.items, []);
});

test('a history failure cannot erase a terminal poll while another poll still blocks the next list refresh', async (t) => {
  const fixture = orderingFixture(t);
  const running = jobSummary('partial-poll', 'running', 1);
  const waiting = jobSummary('waiting-poll', 'running', 2);
  const succeeded = jobSummary('partial-poll', 'succeeded', 3);
  fixture.begin(running, 'resume');
  fixture.begin(waiting, 'resume');
  fixture.chooseHome();
  let historyRequests = 0;
  const fetchJson = fixture.app.fetchJson;
  fixture.app.fetchJson = (url) => {
    if (url.startsWith('/jobs?')) historyRequests += 1;
    return fetchJson(url);
  };
  const terminalObserved = deferred();
  fixture.app.addLog = () => {
    if (fixture.statusCopies(running.id).monitored === 'succeeded') terminalObserved.resolve();
  };
  const history = fixture.delayNext('/jobs?limit=12', null, new Error('Old history disconnected'));
  const oldRefresh = fixture.app.jobs.refreshRecentJobs({ silent: true, preserveRender: true });
  await history.entered.promise;
  fixture.summaries.set(succeeded.id, succeeded);
  const delayedPoll = fixture.delayNext('/jobs/waiting-poll', { job: waiting });
  const poll = fixture.app.jobs.pollActiveJobs();
  await Promise.all([delayedPoll.entered.promise, terminalObserved.promise]);
  try {
    assert.equal(fixture.statusCopies(running.id).recent, 'succeeded');
    assert.equal(historyRequests, 1);
    history.release.resolve();
    await oldRefresh;
    fixture.assertHome();
    assert.equal(historyRequests, 1, 'the next history request is still blocked by the second poll');
    assert.equal(fixture.state.data.recentJobs.status, 'ready');
    assert.equal(fixture.statusCopies(running.id).recent, 'succeeded');
    assert.equal(fixture.statusCopies(waiting.id).recent, 'running');
  } finally {
    delayedPoll.release.resolve();
    await poll;
  }
});

test('a late poll error cannot restore the running snapshot after a newer poll succeeds', async (t) => {
  const fixture = orderingFixture(t);
  const running = jobSummary('poll-race', 'running', 1);
  const succeeded = jobSummary('poll-race', 'succeeded', 2);
  fixture.begin(running);
  fixture.state.data.activeJob = { ...fixture.state.data.activeJob, status: 'ready', summary: running };
  fixture.chooseHome();

  const oldResponse = fixture.delayNext('/jobs/poll-race', null, new Error('Old request disconnected'));
  const stalePoll = fixture.app.jobs.pollActiveJobs();
  await oldResponse.entered.promise;
  fixture.summaries.set(succeeded.id, succeeded);
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.data.completionNotice?.jobId, succeeded.id);

  oldResponse.release.resolve();
  await stalePoll;

  fixture.assertHome();
  assert.deepEqual(fixture.statusCopies(succeeded.id), {
    recent: 'succeeded', monitored: 'succeeded', selected: 'succeeded',
  });
  assert.equal(fixture.state.data.jobMonitor.items[0].completionAction, null);
});

for (const delayedStage of ['artifacts', 'history']) {
  test(`an older completion delayed by ${delayedStage} cannot replace the newest completion notice`, async (t) => {
    const fixture = orderingFixture(t);
    const older = jobSummary('older', 'running', 1);
    const olderSucceeded = jobSummary('older', 'succeeded', 2);
    const newer = jobSummary('newer', 'running', 3);
    const newerSucceeded = jobSummary('newer', 'succeeded', 4);
    fixture.begin(older);
    fixture.chooseHome();
    fixture.summaries.set(olderSucceeded.id, olderSucceeded);

    const oldResponse = delayedStage === 'artifacts'
      ? fixture.delayNext('/jobs/older/artifacts', { artifacts: [] })
      : fixture.delayNext('/jobs?limit=12', { jobs: [olderSucceeded] });
    const olderCompletion = fixture.app.jobs.pollActiveJobs();
    await oldResponse.entered.promise;

    fixture.begin(newer, 'resume');
    fixture.summaries.set(newerSucceeded.id, newerSucceeded);
    await fixture.app.jobs.pollActiveJobs();
    assert.equal(fixture.state.data.completionNotice?.jobId, 'newer');
    fixture.assertHome();

    oldResponse.release.resolve();
    await olderCompletion;

    fixture.assertHome();
    assert.equal(fixture.state.data.completionNotice?.jobId, 'newer');
    assert.deepEqual(fixture.state.data.jobMonitor.items.map((job) => [job.id, job.status]), [
      ['newer', 'succeeded'], ['older', 'succeeded'],
    ]);
  });
}

test('a selected older completion still refreshes its outputs when a newer job owns the notice', async (t) => {
  const fixture = orderingFixture(t);
  const older = jobSummary('selected-older', 'running', 1);
  const olderSucceeded = jobSummary('selected-older', 'succeeded', 2);
  const newer = jobSummary('background-newer', 'running', 3);
  const newerSucceeded = jobSummary('background-newer', 'succeeded', 4);
  const output = { id: 'selected-report', type: 'report.pdf', file_name: 'report.pdf', exists: true };
  fixture.begin(older, 'resume');
  fixture.state.data.activeJob = {
    ...fixture.state.data.activeJob, status: 'ready', summary: older, artifacts: [],
  };
  fixture.app.routing.navigateTo('review', { selectedJobId: older.id });
  fixture.summaries.set(older.id, olderSucceeded);
  fixture.artifacts.set(older.id, [output]);

  const oldResponse = fixture.delayNext('/jobs/selected-older/artifacts', { artifacts: [output] });
  const olderCompletion = fixture.app.jobs.pollActiveJobs();
  await oldResponse.entered.promise;
  fixture.begin(newer, 'resume');
  fixture.summaries.set(newer.id, newerSucceeded);
  await fixture.app.jobs.pollActiveJobs();
  assert.equal(fixture.state.data.completionNotice?.jobId, newer.id);

  oldResponse.release.resolve();
  await olderCompletion;

  assert.equal(fixture.state.route, 'review');
  assert.equal(fixture.state.selectedJobId, older.id);
  assert.equal(fixture.app.window.location.hash, '#review?job=selected-older');
  assert.equal(fixture.state.data.completionNotice?.jobId, newer.id);
  assert.equal(fixture.state.data.activeJob.summary.status, 'succeeded');
  assert.equal(fixture.state.data.activeJob.status, 'ready');
  assert.deepEqual(fixture.state.data.activeJob.artifacts.map((artifact) => artifact.id), ['selected-report']);
});

for (const artifactOutcome of ['success', 'failure']) {
  test(`a late initial artifact ${artifactOutcome} preserves the confirmed cancellation summary`, async (t) => {
    const fixture = orderingFixture(t);
    const queued = jobSummary('cancelled-during-open', 'queued', 1);
    const cancelled = jobSummary('cancelled-during-open', 'cancelled', 2);
    fixture.begin(queued, 'resume');
    const oldResponse = fixture.delayNext(
      '/jobs/cancelled-during-open/artifacts',
      { artifacts: [] },
      artifactOutcome === 'failure' ? new Error('Old artifacts request disconnected') : null,
    );
    const opening = fixture.app.jobs.openJob(queued.id, { summaryHint: queued });
    await oldResponse.entered.promise;
    fixture.chooseHome();
    fixture.summaries.set(cancelled.id, cancelled);
    await fixture.app.jobs.cancelTrackedJobById(cancelled.id);
    assert.equal(fixture.state.data.activeJob.summary.status, 'cancelled');

    oldResponse.release.resolve();
    await opening;

    fixture.assertHome();
    assert.deepEqual(fixture.statusCopies(cancelled.id), {
      recent: 'cancelled', monitored: 'cancelled', selected: 'cancelled',
    });
    assert.equal(fixture.state.data.activeJob.status, artifactOutcome === 'success' ? 'ready' : 'unavailable');
  });
}
