import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

import { bootStudioShell } from '../public/js/studio/studio-shell-core.js';
import { setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom, TestElement } from './helpers/drawing-test-dom.js';

// Exercise the real shell, health mapping, refresh action, and workspace renderer.
// Only the browser DOM and HTTP boundary are replaced in this Node contract test.
const restoreDom = installDrawingTestDom();
const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } });
const shellIds = [
  'workspace-root', 'completion-notice-host', 'workspace-summary', 'runtime-badge',
  'project-badge', 'connection-badge', 'job-badge', 'jobs-toggle', 'jobs-close',
  'jobs-drawer', 'jobs-center-content', 'log-toggle', 'log-close', 'log-drawer',
  'log-feed', 'workspace-nav',
];
const elements = new Map(shellIds.map((id) => [id, new TestElement()]));
document.body = new TestElement('body');
document.body.append(...elements.values());
document.getElementById = (id) => elements.get(id) || null;
Object.assign(window, {
  location: { hash: '#start', search: '' },
  navigator: { language: 'en-US' },
  HTMLElement: TestElement,
  Element: TestElement,
});

const unsafeStep = '<img src=x onerror="alert(1)"> Set FREECAD_APP.';
let healthPayload = {
  runtime: {
    available: false,
    description: 'FreeCAD runtime not detected.',
    selected_runtime: { executable: '' },
    version_details: { python: { version: null }, freecad: { version: null } },
    warnings: ['A configured path is stale.', 7, null, { text: 'not a warning' }],
    errors: ['The runtime probe failed.', false, ['not an error']],
    remediation: ['Set FREECAD_APP to your FreeCAD app bundle.', unsafeStep, null, {}, '  '],
    next_steps: ['Run fcad check-runtime.', 42, false, ''],
  },
};
let healthFailure = null;
const unexpectedRequests = [];
window.fetch = globalThis.fetch = async (url) => {
  let payload;
  if (url === '/health') {
    if (healthFailure) throw healthFailure;
    payload = healthPayload;
  } else if (url === '/') {
    payload = { mode: 'local_api', project_root: '/test/freecad-automation' };
  } else if (url === '/api/examples') {
    payload = { examples: [] };
  } else if (url === '/api/canonical-packages') {
    payload = { packages: [] };
  } else if (String(url).startsWith('/jobs?')) {
    payload = { jobs: [] };
  } else {
    unexpectedRequests.push(url);
    throw new Error(`Unexpected test request: ${url}`);
  }
  return { ok: true, status: 200, json: async () => payload };
};

try {
  const app = bootStudioShell({ documentRef: document, windowRef: window });
  await setImmediate();
  const workspace = elements.get('workspace-root');
  const guidance = () => workspace.querySelector('[data-hook="runtime-setup-guidance"]');
  const refresh = async () => {
    const button = workspace.querySelector('[data-action="refresh-health"]');
    assert.ok(button, 'Runtime setup retains the existing Refresh status action.');
    await Promise.all([...workspace.listeners.get('click')].map((handler) => handler({ target: button })));
  };

  // Dropping API guidance or coercing arbitrary values into user-facing text is a regression.
  assert.deepEqual(app.state.data.health.remediation, [
    'Set FREECAD_APP to your FreeCAD app bundle.', unsafeStep,
  ]);
  assert.deepEqual(app.state.data.health.nextSteps, ['Run fcad check-runtime.']);
  assert.deepEqual(app.state.data.health.warnings, ['A configured path is stale.']);
  assert.deepEqual(app.state.data.health.errors, ['The runtime probe failed.']);
  assert.equal(app.state.data.health.reachable, true);
  assert.equal(app.state.data.health.available, false);
  assert.equal(app.state.connectionState, 'connected');
  assert.ok(guidance(), 'Missing runtime with reachable API needs setup guidance.');
  assert.match(guidance().textContent, /Set up FreeCAD/);
  assert.match(guidance().textContent, /Set FREECAD_APP to your FreeCAD app bundle/);
  assert.match(guidance().textContent, /Run fcad check-runtime/);
  assert.ok(guidance().textContent.includes(unsafeStep));
  assert.equal(guidance().querySelector('img'), null, 'Diagnostics are text, never HTML.');
  assert.doesNotMatch(guidance().textContent, /\[object Object\]/);
  assert.match(guidance().textContent, /restart `fcad serve`/);

  setLocale('ko', { persist: false });
  assert.match(guidance().textContent, /FreeCAD 설정/);
  assert.match(guidance().textContent, /권장 해결 방법/);
  assert.match(guidance().textContent, /다음 단계/);
  assert.match(guidance().textContent, /상태를 다시 확인/);
  assert.match(guidance().textContent, /Set FREECAD_APP to your FreeCAD app bundle/,
    'Unknown API diagnostic text safely falls back to its English source.');
  setLocale('en', { persist: false });
  assert.match(guidance().textContent, /Set up FreeCAD/);

  // A later malformed response must not retain stale installation advice.
  healthPayload = { runtime: {
    available: false, description: 'No runtime diagnostics.',
    remediation: 'not an array', next_steps: { step: 'not an array' },
    warnings: null, errors: {},
  } };
  await refresh();
  assert.deepEqual(app.state.data.health.remediation, []);
  assert.deepEqual(app.state.data.health.nextSteps, []);
  assert.deepEqual(app.state.data.health.warnings, []);
  assert.deepEqual(app.state.data.health.errors, []);
  assert.match(guidance().textContent, /fcad check-runtime/,
    'When the API has no usable guidance, the runtime diagnostic command remains actionable.');
  assert.doesNotMatch(guidance().textContent, /Set FREECAD_APP to your FreeCAD app bundle/);

  // API loss is a connection problem, not evidence that FreeCAD needs installation.
  healthPayload = { runtime: { available: false, remediation: ['Fresh setup advice.'], next_steps: ['Retry probe.'] } };
  await refresh();
  assert.match(guidance().textContent, /Fresh setup advice/);
  healthFailure = new Error('Network unavailable');
  await refresh();
  assert.equal(app.state.data.health.status, 'unavailable');
  assert.equal(app.state.data.health.reachable, false);
  assert.equal(app.state.connectionState, 'degraded');
  assert.deepEqual(app.state.data.health.remediation, []);
  assert.deepEqual(app.state.data.health.nextSteps, []);
  assert.equal(guidance(), null);
  assert.match(workspace.textContent, /No \/health endpoint responded/);
  assert.doesNotMatch(workspace.textContent, /Fresh setup advice/);

  // Recovery uses fresh diagnostics; detected runtimes do not retain setup warnings.
  healthFailure = null;
  healthPayload = { runtime: {
    available: true, description: 'FreeCAD runtime detected.',
    selected_runtime: { executable: '/Applications/FreeCAD.app/Contents/Resources/bin/python' },
    version_details: { python: { version: '3.11.13' }, freecad: { version: '1.1.0' } },
    warnings: [], errors: [], remediation: [], next_steps: ['Run a real workflow to verify the runtime.'],
  } };
  await refresh();
  assert.equal(app.state.data.health.status, 'ready');
  assert.equal(app.state.data.health.available, true);
  assert.equal(app.state.data.health.reachable, true);
  assert.equal(app.state.connectionState, 'connected');
  assert.equal(app.state.data.health.fallbackMessage, '');
  assert.deepEqual(app.state.data.health.remediation, []);
  assert.deepEqual(app.state.data.health.nextSteps, ['Run a real workflow to verify the runtime.']);
  assert.equal(guidance(), null);
  assert.match(workspace.textContent, /Runtime detected/);
  assert.doesNotMatch(workspace.textContent, /No \/health endpoint responded/);
  assert.deepEqual(unexpectedRequests, []);
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete globalThis.localStorage;
  restoreDom();
}

console.log('studio-runtime-setup.test.js: ok');
