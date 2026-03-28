import assert from 'node:assert/strict';

import {
  deriveStudioChromeState,
  deriveStudioWorkspaceSelection,
  normalizeRoute,
  parseStudioLocationState,
  serializeStudioLocationState,
  summarizeProjectPath,
} from '../public/js/studio/studio-state.js';

assert.equal(normalizeRoute('#drawing'), 'drawing');
assert.equal(normalizeRoute(' review '), 'review');
assert.equal(normalizeRoute('#unknown-route'), 'start');
assert.equal(normalizeRoute('#review?job=job-123'), 'review');

assert.deepEqual(
  parseStudioLocationState({
    hash: '#artifacts?job=job-123',
    search: '',
  }),
  {
    route: 'artifacts',
    selectedJobId: 'job-123',
  }
);

assert.deepEqual(
  parseStudioLocationState({
    hash: '#review',
    search: '?job=job-999',
  }),
  {
    route: 'review',
    selectedJobId: 'job-999',
  }
);

assert.equal(
  serializeStudioLocationState({
    route: 'review',
    selectedJobId: 'job-123',
  }),
  '#review?job=job-123'
);

assert.equal(
  serializeStudioLocationState({
    route: 'model',
    selectedJobId: 'job-123',
  }),
  '#model'
);

assert.deepEqual(
  deriveStudioWorkspaceSelection(
    { route: 'artifacts', selectedJobId: 'job-123' },
    { route: 'review' }
  ),
  {
    route: 'review',
    selectedJobId: 'job-123',
  }
);

assert.deepEqual(
  deriveStudioWorkspaceSelection(
    { route: 'review', selectedJobId: 'job-123' },
    { route: 'artifacts', selectedJobId: 'job-456' }
  ),
  {
    route: 'artifacts',
    selectedJobId: 'job-456',
  }
);

assert.deepEqual(
  deriveStudioWorkspaceSelection(
    { route: 'review', selectedJobId: 'job-123' },
    { route: 'model' }
  ),
  {
    route: 'model',
    selectedJobId: '',
  }
);

assert.equal(summarizeProjectPath('/Users/jangtaeho/Documents/New/freecad-automation'), 'Project New/freecad-automation');
assert.equal(summarizeProjectPath(''), 'Project root unavailable');

const connected = deriveStudioChromeState({
  landing: {
    mode: 'local_api',
    project_root: '/Users/jangtaeho/Documents/New/freecad-automation',
  },
  health: {
    status: 'ready',
    reachable: true,
    available: true,
    projectRoot: '/Users/jangtaeho/Documents/New/freecad-automation',
  },
  examples: {
    status: 'ready',
  },
  recentJobs: {
    status: 'ready',
    items: [
      { type: 'draw', status: 'succeeded' },
    ],
  },
  activeJob: {
    summary: null,
  },
});

assert.equal(connected.connectionState, 'connected');
assert.equal(connected.runtimeTone, 'ok');
assert.equal(connected.runtimeBadgeText, 'Runtime ready');
assert.equal(connected.connectionBadgeText, 'Local API connected');
assert.equal(connected.jobBadgeText, 'Recent draw succeeded');
assert.equal(connected.projectBadgeText, 'Project New/freecad-automation');

const monitored = deriveStudioChromeState({
  landing: {
    mode: 'local_api',
    project_root: '/Users/jangtaeho/Documents/New/freecad-automation',
  },
  health: {
    status: 'ready',
    reachable: true,
    available: true,
    projectRoot: '/Users/jangtaeho/Documents/New/freecad-automation',
  },
  examples: {
    status: 'ready',
  },
  recentJobs: {
    status: 'ready',
    items: [
      { id: 'job-running-123456', type: 'draw', status: 'running' },
      { id: 'job-queued-654321', type: 'report', status: 'queued' },
      { id: 'job-old-abcdef', type: 'create', status: 'succeeded' },
    ],
  },
  jobMonitor: {
    items: [
      { id: 'job-running-123456', type: 'draw', status: 'running', updated_at: '2026-03-28T04:05:06.000Z', enabled: true },
      { id: 'job-queued-654321', type: 'report', status: 'queued', updated_at: '2026-03-28T04:04:06.000Z', enabled: true },
    ],
    lastPollTime: '2026-03-28T04:05:06.000Z',
  },
  activeJob: {
    summary: null,
  },
});

assert.equal(monitored.jobBadgeText, '2 active jobs');
assert.equal(monitored.jobBadgeTone, 'warn');
assert.match(monitored.jobBadgeTitle, /1 running/);
assert.match(monitored.jobBadgeTitle, /1 queued/);

const legacy = deriveStudioChromeState({
  landing: null,
  health: {
    status: 'unavailable',
    reachable: false,
    available: false,
    projectRoot: '',
  },
  examples: {
    status: 'ready',
  },
  recentJobs: {
    status: 'unavailable',
    items: [],
  },
  activeJob: {
    summary: null,
  },
});

assert.equal(legacy.connectionState, 'legacy');
assert.equal(legacy.connectionLabel, 'legacy shell');
assert.equal(legacy.runtimeTone, 'warn');
assert.equal(legacy.runtimeBadgeText, 'Runtime unavailable on legacy path');
assert.equal(legacy.connectionBadgeText, 'Legacy shell fallback');
assert.equal(legacy.jobBadgeText, 'No recent job');

console.log('studio-state.test.js: ok');
