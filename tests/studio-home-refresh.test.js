import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';
import { createStudioWorkspaceController } from '../public/js/studio/studio-shell-workspace.js';
import { createStudioShellState, createStudioShellRuntime } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';

function fixture(t, route = 'start') {
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  const state = createStudioShellState({ hash: `#${route}` });
  const job = { id: 'report-one', type: 'report', status: 'queued', request: { config: { name: 'bracket' } },
    capabilities: { cancellation_supported: true }, updated_at: '2026-10-01T00:00:00Z' };
  state.data.recentJobs = { status: 'ready', items: [job] };
  const workspaceRoot = document.createElement('main');
  document.append(workspaceRoot);
  const app = { state, runtime: createStudioShellRuntime(), document, window: { HTMLElement },
    elements: { workspaceRoot }, dom: { applyPendingFocus() {} } };
  app.workspace = createStudioWorkspaceController(app);
  app.workspace.renderWorkspace();
  return { app, job, workspaceRoot };
}

for (const status of ['running', 'succeeded', 'failed']) {
  test(`Home reflects ${status} without replacing the result action or moving focus`, (t) => {
    const { app, job, workspaceRoot } = fixture(t);
    const action = workspaceRoot.querySelector('[data-job-id="report-one"]');
    const heading = workspaceRoot.querySelector('.section-header');
    action.focus();
    app.state.data.recentJobs.items = [{ ...job, status }];
    app.workspace.syncFromShell?.();
    const labels = { running: 'Running', succeeded: 'Completed', failed: 'Failed' };
    assert.match(workspaceRoot.querySelector('[data-hook="home-recent-status"]').textContent,
      new RegExp(`Execution: ${labels[status]}`));
    assert.equal(workspaceRoot.querySelector('[data-job-id="report-one"]'), action);
    assert.equal(workspaceRoot.querySelector('.section-header'), heading);
    assert.equal(document.activeElement, action);
    assert.equal(app.state.route, 'start');
    assert.equal(app.state.selectedJobId, '');
  });
}

test('history updates status and cancellation eligibility without replacing its open-result action', (t) => {
  const { app, job, workspaceRoot } = fixture(t, 'history');
  const action = workspaceRoot.querySelector('[data-action="open-job"]');
  action.focus();
  assert.ok(workspaceRoot.querySelector('[data-action="cancel-job"]'));
  app.state.data.recentJobs.items = [{ ...job, status: 'running', capabilities: { cancellation_supported: false } }];
  app.workspace.syncFromShell?.();
  assert.match(workspaceRoot.querySelector('.result-card-description').textContent, /Execution: Running/);
  assert.equal(workspaceRoot.querySelector('[data-action="cancel-job"]'), null);
  assert.equal(workspaceRoot.querySelector('[data-action="open-job"]'), action);
  assert.equal(document.activeElement, action);
  assert.equal(app.state.route, 'history');
});

test('job refresh does not rebuild other workspace inputs', (t) => {
  const { app, workspaceRoot } = fixture(t);
  app.state.route = 'console';
  const input = document.createElement('input');
  input.value = 'unfinished user input';
  workspaceRoot.replaceChildren(input);
  input.focus();
  app.workspace.syncFromShell?.();
  assert.equal(workspaceRoot.children[0], input);
  assert.equal(input.value, 'unfinished user input');
  assert.equal(document.activeElement, input);
});
