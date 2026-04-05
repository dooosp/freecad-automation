import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { localizedBootMessage } from '../public/js/studio/studio-shell-dom.js';
import { bootStudioShell } from '../public/js/studio/studio-shell-core.js';
import {
  createStudioShellRuntime,
  createStudioShellState,
} from '../public/js/studio/studio-shell-store.js';

const ROOT = resolve(import.meta.dirname, '..');
const shellSource = readFileSync(resolve(ROOT, 'public/js/studio-shell.js'), 'utf8');
const shellLines = shellSource.trimEnd().split('\n').length;

assert.equal(typeof bootStudioShell, 'function');
assert.equal(typeof createStudioShellRuntime, 'function');
assert.equal(typeof createStudioShellState, 'function');

assert.match(shellSource, /from '\.\/studio\/studio-shell-core\.js'/);
assert.match(shellSource, /bootStudioShell\(\{/);
assert.match(shellSource, /import\('\.\/studio\/model-workspace\.js'\)/);
assert.match(shellSource, /import\('\.\/studio\/drawing-workspace\.js'\)/);
assert.doesNotMatch(shellSource, /document\.getElementById\(/);
assert.doesNotMatch(shellSource, /window\.addEventListener\(/);
assert.ok(shellLines <= 40, `Expected public/js/studio-shell.js to stay thin, but found ${shellLines} lines.`);

const runtime = createStudioShellRuntime();
assert.equal(runtime.activeWorkspaceController, null);
assert.equal(runtime.jobMonitorTimer, null);
assert.equal(runtime.workspaceRenderEpoch, 0);
assert.equal(runtime.modelWorkspaceModulePromise, null);
assert.equal(runtime.drawingWorkspaceModulePromise, null);
assert.equal(runtime.jobMonitorErrors instanceof Map, true);
assert.equal(runtime.jobMonitorErrors.size, 0);

const state = createStudioShellState({
  hash: '#review?job=job-123',
  search: '',
});
assert.equal(state.route, 'review');
assert.equal(state.selectedJobId, 'job-123');
assert.equal(state.data.health.status, 'loading');
assert.equal(state.data.examples.status, 'loading');
assert.equal(state.data.recentJobs.status, 'loading');
assert.deepEqual(state.data.jobMonitor.items, []);
assert.equal(state.data.completionNotice, null);
assert.equal(state.logs.length, 1);
assert.match(state.logs[0].message, /preferred browser review console/i);

assert.match(localizedBootMessage('assets', {
  documentRef: { documentElement: { lang: 'ko' } },
  navigatorRef: { language: 'en-US' },
}), /Studio 자산/);
assert.match(localizedBootMessage('contract', {
  documentRef: { documentElement: { lang: 'en' } },
  navigatorRef: { language: 'ko-KR' },
}), /Studio shell markup did not match/);

console.log('studio-shell-decomposition.test.js: ok');
