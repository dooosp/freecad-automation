import assert from 'node:assert/strict';

import {
  STUDIO_EXPERIENCE_MODE_STORAGE_KEY,
  deriveStudioChromeState,
  deriveStudioWorkspaceSelection,
  normalizeRoute,
  normalizeStudioExperienceMode,
  parseStudioLocationState,
  readStudioExperienceMode,
  serializeStudioLocationState,
  shouldExpandAdvancedNavigation,
  summarizeProjectPath,
  writeStudioExperienceMode,
} from '../public/js/studio/studio-state.js';

assert.equal(STUDIO_EXPERIENCE_MODE_STORAGE_KEY, 'studio_experience_mode');
assert.equal(normalizeStudioExperienceMode('advanced'), 'advanced');
assert.equal(normalizeStudioExperienceMode('unexpected'), 'default');

const experienceStorage = new Map();
const storage = {
  getItem(key) {
    return experienceStorage.get(key) || null;
  },
  setItem(key, value) {
    experienceStorage.set(key, value);
  },
};
assert.equal(readStudioExperienceMode(storage), 'default');
assert.equal(writeStudioExperienceMode(storage, 'advanced'), 'advanced');
assert.equal(readStudioExperienceMode(storage), 'advanced');
assert.equal(shouldExpandAdvancedNavigation({ route: 'start', experienceMode: 'advanced' }), true);
assert.equal(shouldExpandAdvancedNavigation({ route: 'review', experienceMode: 'default' }), true);
assert.equal(shouldExpandAdvancedNavigation({ route: 'start', experienceMode: 'default' }), false);
assert.equal(experienceStorage.get(STUDIO_EXPERIENCE_MODE_STORAGE_KEY), 'advanced');

assert.equal(normalizeRoute('#drawing'), 'drawing');
assert.equal(normalizeRoute('#history'), 'history');
assert.equal(normalizeRoute('#console'), 'console');
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

assert.deepEqual(
  parseStudioLocationState({
    hash: '#model?job=job-123',
    search: '?job=job-999',
  }),
  {
    route: 'model',
    selectedJobId: '',
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

assert.equal(
  serializeStudioLocationState({
    route: 'history',
    selectedJobId: 'job-123',
  }),
  '#history'
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

assert.deepEqual(
  deriveStudioWorkspaceSelection(
    { route: 'review', selectedJobId: 'job-123' },
    { route: 'review', selectedJobId: '' }
  ),
  {
    route: 'review',
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
assert.equal(connected.runtimeBadgeText, 'FreeCAD ready');
assert.equal(connected.connectionBadgeText, 'Local API connected');
assert.equal(connected.jobBadgeText, 'Recent draw succeeded');
assert.equal(connected.projectBadgeText, 'Project New/freecad-automation');

const failedDecisionChrome = deriveStudioChromeState({
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
      {
        id: 'job-quality-failed-123456',
        type: 'report',
        status: 'succeeded',
        result: {
          report_summary: {
            config_name: 'ks_bracket',
            overall_status: 'fail',
            ready_for_manufacturing_review: false,
          },
        },
      },
    ],
  },
  activeJob: {
    summary: null,
  },
});

assert.equal(failedDecisionChrome.jobBadgeText, 'Recent report needs review');
assert.equal(failedDecisionChrome.jobBadgeTone, 'warn');
assert.match(failedDecisionChrome.jobBadgeTitle, /Ready No/);
assert.equal(failedDecisionChrome.jobBadgeTitle.includes('Latest tracked job report succeeded.'), false);

const heldReadinessChrome = deriveStudioChromeState({
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
      {
        id: 'job-held-readiness-123456',
        type: 'readiness-pack',
        status: 'succeeded',
        result: {
          report_summary: {
            config_name: 'quality_pass_bracket',
            overall_status: 'pass',
            ready_for_manufacturing_review: true,
          },
          readiness_summary: {
            status: 'needs_more_evidence',
            gate_decision: 'hold_for_evidence_completion',
            missing_inputs: ['inspection_evidence'],
          },
        },
      },
    ],
  },
  activeJob: {
    summary: null,
  },
});

assert.equal(heldReadinessChrome.jobBadgeText, 'Recent readiness-pack needs review');
assert.equal(heldReadinessChrome.jobBadgeTone, 'warn');
assert.match(heldReadinessChrome.jobBadgeTitle, /Ready held: missing inspection_evidence/);

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
assert.equal(legacy.runtimeBadgeText, 'FreeCAD unavailable on legacy path');
assert.equal(legacy.connectionBadgeText, 'Legacy shell fallback');
assert.equal(legacy.jobBadgeText, 'No recent job');

console.log('studio-state.test.js: ok');
