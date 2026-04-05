import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'fcad-studio-browser-smoke-'));
const JOBS_DIR = join(TMP_ROOT, 'jobs');
const CHROME_PROFILE_DIR = join(TMP_ROOT, 'chrome-profile');

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || '';
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitFor(assertion, { attempts = 40, delayMs = 150 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await delay(delayMs);
      }
    }
  }
  throw lastError;
}

function summarizeException(details = {}) {
  return details.exception?.description
    || details.exception?.value
    || `${details.text || 'Exception'} @ ${details.url || 'unknown'}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0}`;
}

function summarizeLog(entry = {}) {
  return `${entry.source || 'log'} ${entry.level || ''} ${entry.url || ''} ${entry.text || ''}`.trim();
}

function studioSnapshotExpression() {
  return `(() => {
    const current = document.querySelector('.nav-link[aria-current="page"]');
    const root = document.getElementById('workspace-root');
    const summary = document.getElementById('workspace-summary')?.textContent?.trim() || '';
    return {
      activeRoute: current?.dataset?.route || '',
      hash: window.location.hash,
      pathname: window.location.pathname,
      navCount: document.querySelectorAll('.nav-link').length,
      hasWorkspace: Boolean(root?.firstElementChild),
      workspaceClass: root?.firstElementChild?.className || '',
      summary,
      summaryResolved: summary.length > 0 && summary !== 'Workspace shell loading...',
      loadError: document.querySelector('[data-hook="workspace-load-error"]')?.textContent?.trim() || '',
      bootWarningVisible: !document.getElementById('studio-boot-warning')?.hidden,
    };
  })()`;
}

function drawerSnapshotExpression() {
  return `(() => ({
    jobsOpen: document.getElementById('jobs-drawer')?.classList.contains('is-open') || false,
    jobsExpanded: document.getElementById('jobs-toggle')?.getAttribute('aria-expanded') || '',
    logOpen: document.getElementById('log-drawer')?.classList.contains('is-open') || false,
    logExpanded: document.getElementById('log-toggle')?.getAttribute('aria-expanded') || '',
    activeElementId: document.activeElement?.id || '',
  }))()`;
}

function localeSnapshotExpression() {
  return `(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    return {
      lang: document.documentElement.lang || '',
      selectedLocale: localeSelect?.value || '',
      cookie: document.cookie || '',
      storedLocale: (() => {
        try {
          return localStorage.getItem('ui_locale') || '';
        } catch {
          return '';
        }
      })(),
      title: document.title,
      summary: document.getElementById('workspace-summary')?.textContent?.trim() || '',
      startLabel: document.querySelector('.nav-link[data-route="start"] .nav-label')?.textContent?.trim() || '',
      activeRoute: document.querySelector('.nav-link[aria-current="page"]')?.dataset?.route || '',
    };
  })()`;
}

function jobContextExpression(hook) {
  return `(() => ({
    text: document.querySelector('[data-hook="${hook}"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
  }))()`;
}

async function waitForRoute(
  cdp,
  route,
  {
    attempts = 40,
    delayMs = 150,
    expectedHash = `#${route}`,
    expectedPathname = '/studio/',
  } = {}
) {
  return waitFor(async () => {
    const snapshot = await cdp.evaluate(studioSnapshotExpression());
    assert.equal(snapshot.activeRoute, route);
    assert.equal(snapshot.hasWorkspace, true);
    assert.equal(snapshot.summaryResolved, true);
    assert.equal(snapshot.loadError, '');
    assert.equal(snapshot.hash, expectedHash);
    assert.equal(snapshot.pathname, expectedPathname);
    assert.equal(snapshot.bootWarningVisible, false);
    return snapshot;
  }, {
    attempts,
    delayMs,
  });
}

class CdpSession {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.logs = [];
    this.exceptions = [];
  }

  async connect() {
    await new Promise((resolveConnect, rejectConnect) => {
      const ws = new WebSocket(this.webSocketUrl);
      this.ws = ws;

      ws.once('open', resolveConnect);
      ws.once('error', rejectConnect);

      ws.on('message', (buffer) => {
        const message = JSON.parse(buffer.toString());
        if (message.id) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message || 'CDP request failed'));
          } else {
            pending.resolve(message.result);
          }
          return;
        }

        if (message.method === 'Log.entryAdded') {
          this.logs.push(message.params.entry);
          return;
        }

        if (message.method === 'Runtime.exceptionThrown') {
          this.exceptions.push(message.params.exceptionDetails);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolveSend, rejectSend) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.value;
  }

  async close() {
    if (!this.ws) return;
    await new Promise((resolveClose) => {
      this.ws.once('close', resolveClose);
      this.ws.close();
    });
  }
}

async function launchChrome(chromeBinary) {
  return await new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(chromeBinary, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      'about:blank',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let settled = false;
    let stderr = '';

    const settle = (callback) => (value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const resolveOnce = settle(resolveLaunch);
    const rejectOnce = settle(rejectLaunch);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        resolveOnce({
          child,
          browserWebSocketUrl: match[1],
        });
      }
    });

    child.once('error', rejectOnce);
    child.once('exit', (code, signal) => {
      rejectOnce(new Error(`Chrome exited before DevTools became available (${code ?? signal ?? 'unknown'}).`));
    });
  });
}

async function openPageTarget(browserWebSocketUrl) {
  const browserUrl = new URL(browserWebSocketUrl);
  const response = await fetch(`http://${browserUrl.host}/json/new?about:blank`, {
    method: 'PUT',
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(typeof payload.webSocketDebuggerUrl, 'string');
  return payload.webSocketDebuggerUrl;
}

const chromeBinary = findChromeBinary();
if (!chromeBinary) {
  console.log('studio-shell-browser-smoke.test.js: skipped (Chrome not available)');
  process.exit(0);
}

const { server, jobStore } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: JOBS_DIR,
});

let chrome = null;
let cdp = null;

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const seededJob = await jobStore.createJob({
    type: 'report',
    config: {
      name: 'browser_smoke_seed',
      shapes: [{ id: 'body', type: 'box', length: 12, width: 10, height: 8 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const seededArtifactPath = await jobStore.writeJobFile(
    seededJob.id,
    'artifacts/browser-smoke-seed.json',
    '{"ok":true,"source":"browser-smoke"}\n'
  );
  const seededManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: seededJob.id,
    artifacts: [
      {
        type: 'report.sample',
        path: seededArtifactPath,
        label: 'Browser smoke artifact',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: seededJob.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(
    seededJob.id,
    { success: true, source: 'browser-smoke' },
    { sample: seededArtifactPath },
    {},
    seededManifest
  );
  const seededShortJobId = seededJob.id.slice(0, 8);

  chrome = await launchChrome(chromeBinary);
  cdp = new CdpSession(await openPageTarget(chrome.browserWebSocketUrl));
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });

  const initial = await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
    expectedHash: '',
  });
  const initialShellShape = await cdp.evaluate(studioSnapshotExpression());
  assert.equal(initialShellShape.navCount, 5);
  assert.equal(initialShellShape.pathname, '/studio/');

  const visitedRoutes = ['review', 'artifacts', 'model', 'drawing', 'start'];
  for (const route of visitedRoutes) {
    await cdp.evaluate(`document.querySelector('.nav-link[data-route="${route}"]')?.click()`);
    const snapshot = await waitForRoute(cdp, route, {
      attempts: route === 'model' || route === 'drawing' ? 50 : 30,
      delayMs: route === 'model' || route === 'drawing' ? 200 : 120,
    });

    if (route === 'start') {
      assert.equal(snapshot.summary, initial.summary);
    } else {
      assert.equal(snapshot.hash, `#${route}`);
    }
  }

  await cdp.evaluate(`document.getElementById('jobs-toggle')?.click()`);
  let drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.jobsOpen, true);
    assert.equal(nextSnapshot.jobsExpanded, 'true');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.getElementById('jobs-close')?.click()`);
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.jobsOpen, false);
    assert.equal(nextSnapshot.jobsExpanded, 'false');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.getElementById('log-toggle')?.click()`);
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.logOpen, true);
    assert.equal(nextSnapshot.logExpanded, 'true');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.getElementById('log-close')?.click()`);
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.logOpen, false);
    assert.equal(nextSnapshot.logExpanded, 'false');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.getElementById('jobs-toggle')?.click()`);
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.jobsOpen, true);
    assert.equal(nextSnapshot.jobsExpanded, 'true');
    return nextSnapshot;
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.jobsOpen, false);
    assert.equal(nextSnapshot.jobsExpanded, 'false');
    assert.equal(nextSnapshot.activeElementId, 'jobs-toggle');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.getElementById('log-toggle')?.click()`);
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.logOpen, true);
    assert.equal(nextSnapshot.logExpanded, 'true');
    return nextSnapshot;
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  drawerSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(nextSnapshot.logOpen, false);
    assert.equal(nextSnapshot.logExpanded, 'false');
    assert.equal(nextSnapshot.activeElementId, 'log-toggle');
    return nextSnapshot;
  });

  const initialLocale = await cdp.evaluate(localeSnapshotExpression());
  assert.equal(['en', 'ko'].includes(initialLocale.lang), true);
  assert.equal(initialLocale.selectedLocale, initialLocale.lang);
  assert.equal(initialLocale.activeRoute, 'start');
  const alternateLocale = initialLocale.lang === 'ko' ? 'en' : 'ko';

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    if (!localeSelect) return false;
    localeSelect.value = '${alternateLocale}';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  let localeSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, alternateLocale);
    assert.equal(nextSnapshot.selectedLocale, alternateLocale);
    assert.equal(nextSnapshot.activeRoute, 'start');
    assert.equal(nextSnapshot.cookie.includes('ui_locale=' + alternateLocale), true);
    assert.equal(nextSnapshot.storedLocale, alternateLocale);
    return nextSnapshot;
  });
  assert.notEqual(localeSnapshot.startLabel, initialLocale.startLabel);
  assert.notEqual(localeSnapshot.summary, initialLocale.summary);

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    if (!localeSelect) return false;
    localeSelect.value = '${initialLocale.lang}';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  localeSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, initialLocale.lang);
    assert.equal(nextSnapshot.selectedLocale, initialLocale.lang);
    assert.equal(nextSnapshot.activeRoute, 'start');
    assert.equal(nextSnapshot.cookie.includes('ui_locale=' + initialLocale.lang), true);
    assert.equal(nextSnapshot.storedLocale, initialLocale.lang);
    return nextSnapshot;
  });
  assert.equal(localeSnapshot.startLabel, initialLocale.startLabel);
  assert.equal(localeSnapshot.summary, initialLocale.summary);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#review` });
  let deepLinkSnapshot = await waitForRoute(cdp, 'review', {
    attempts: 50,
    delayMs: 200,
  });
  assert.notEqual(deepLinkSnapshot.summary, initial.summary);

  let reloadedLocaleSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, initialLocale.lang);
    assert.equal(nextSnapshot.selectedLocale, initialLocale.lang);
    assert.equal(nextSnapshot.activeRoute, 'review');
    return nextSnapshot;
  }, {
    attempts: 40,
    delayMs: 150,
  });
  assert.match(reloadedLocaleSnapshot.startLabel, /Console|콘솔/);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#review?job=${seededJob.id}` });
  deepLinkSnapshot = await waitForRoute(cdp, 'review', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#review?job=${seededJob.id}`,
  });
  let jobContext = await waitFor(async () => {
    const nextContext = await cdp.evaluate(jobContextExpression('review-job-summary'));
    assert.equal(nextContext.text.includes(seededShortJobId), true);
    return nextContext;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(jobContext.text.includes('No tracked job selected'), false);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#artifacts` });
  deepLinkSnapshot = await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
  });
  assert.notEqual(deepLinkSnapshot.summary, reloadedLocaleSnapshot.summary);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#artifacts?job=${seededJob.id}` });
  deepLinkSnapshot = await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#artifacts?job=${seededJob.id}`,
  });
  jobContext = await waitFor(async () => {
    const nextContext = await cdp.evaluate(jobContextExpression('artifacts-job-summary'));
    assert.equal(nextContext.text.includes(seededShortJobId), true);
    return nextContext;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(jobContext.text.includes('No active job'), false);

  const blockingLogs = cdp.logs.filter((entry) => (
    entry.source === 'network'
      && entry.level === 'error'
      && /\/js\/(?:studio-shell\.js|studio\/workspaces\.js|i18n\/index\.js)/.test(`${entry.url || ''} ${entry.text || ''}`)
  ));
  assert.deepEqual(blockingLogs, [], blockingLogs.map(summarizeLog).join('\n'));

  const localExceptions = cdp.exceptions.filter((details) => (
    String(details.url || '').includes(baseUrl)
      || String(details.exception?.description || '').includes('/js/studio')
      || String(details.exception?.description || '').includes('/js/i18n')
  ));
  assert.deepEqual(localExceptions, [], localExceptions.map(summarizeException).join('\n'));

  console.log('studio-shell-browser-smoke.test.js: ok');
} finally {
  await cdp?.close().catch(() => {});
  chrome?.child.kill('SIGKILL');
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(TMP_ROOT, { recursive: true, force: true });
}
