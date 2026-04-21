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

function pageTextExpression() {
  return `(() => document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '')()`;
}

function routeLabelExpression(route) {
  return `(() => document.querySelector('.nav-link[data-route="${route}"] .nav-label')?.textContent?.trim() || '')()`;
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

function passQualityReportSummary() {
  return {
    config_name: 'quality_pass_bracket',
    overall_status: 'pass',
    ready_for_manufacturing_review: true,
    blocking_issues: [],
    top_risks: [],
    recommended_actions: ['Archive the approved release bundle.'],
    artifacts_referenced: [
      {
        key: 'create_manifest',
        label: 'Create Manifest',
        status: 'in_memory',
        required: false,
      },
    ],
    surfaces: {
      create_quality: {
        available: true,
        status: 'pass',
        invalid_shape: false,
        blocking_issues: [],
        warnings: [],
      },
      drawing_quality: {
        available: true,
        status: 'pass',
        score: 100,
        missing_required_dimensions: [],
        conflict_count: 0,
        overlap_count: 0,
        traceability_coverage_percent: 100,
        recommended_actions: [],
        blocking_issues: [],
        warnings: [],
      },
      dfm: {
        available: true,
        status: 'pass',
        score: 100,
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 1,
        },
        top_fixes: ['Optional: add a fillet on the highest stress corner.'],
        blocking_issues: [],
        warnings: [],
      },
    },
  };
}

function failQualityReportSummary() {
  return {
    config_name: 'ks_bracket',
    overall_status: 'fail',
    ready_for_manufacturing_review: false,
    blocking_issues: [
      'Generated model shape is invalid.',
      'Dimension conflict count 7 exceeds the allowed maximum 0.',
    ],
    top_risks: [
      'Missing required drawing dimensions: HOLE_DIA.',
      'DFM critical findings: 2.',
    ],
    recommended_actions: [
      'Repair the generated model geometry before proceeding to manufacturing review.',
      'Increase edge distance around hole1 and hole3.',
    ],
    artifacts_referenced: [
      {
        key: 'fem',
        label: 'FEM analysis',
        status: 'not_run',
        required: false,
      },
      {
        key: 'tolerance',
        label: 'Tolerance analysis',
        status: 'not_available',
        required: false,
      },
    ],
    surfaces: {
      create_quality: {
        available: true,
        status: 'fail',
        invalid_shape: true,
        blocking_issues: ['Generated model shape is invalid.'],
        warnings: [],
      },
      drawing_quality: {
        available: true,
        status: 'fail',
        score: 71,
        missing_required_dimensions: ['HOLE_DIA'],
        conflict_count: 7,
        overlap_count: 0,
        traceability_coverage_percent: 0,
        recommended_actions: ['Add or map the missing required dimension intent(s): HOLE_DIA.'],
        blocking_issues: ['Dimension conflict count 7 exceeds the allowed maximum 0.'],
        warnings: [],
      },
      dfm: {
        available: true,
        status: 'fail',
        score: 70,
        severity_counts: {
          critical: 2,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: ['Increase edge distance around hole1 and hole3.'],
        blocking_issues: ['hole1 edge distance 3.5 mm < 9.0 mm'],
        warnings: [],
      },
    },
  };
}

function optionalQualityReportSummary() {
  return {
    config_name: 'optional_quality_bracket',
    overall_status: 'incomplete',
    ready_for_manufacturing_review: null,
    blocking_issues: [],
    top_risks: [],
    recommended_actions: ['Optional: rerun tolerance for a wider production sample.'],
    artifacts_referenced: [
      {
        key: 'create_manifest',
        label: 'Create Manifest',
        status: 'in_memory',
        required: false,
      },
      {
        key: 'fem',
        label: 'FEM analysis',
        status: 'not_run',
        required: false,
      },
      {
        key: 'tolerance',
        label: 'Tolerance analysis',
        status: 'not_available',
        required: false,
      },
    ],
    surfaces: {
      create_quality: {
        available: true,
        status: 'pass',
        invalid_shape: false,
        blocking_issues: [],
        warnings: [],
      },
      drawing_quality: {
        available: true,
        status: 'pass',
        score: 100,
        missing_required_dimensions: [],
        conflict_count: 0,
        overlap_count: 0,
        traceability_coverage_percent: 100,
        blocking_issues: [],
        warnings: [],
      },
      dfm: {
        available: true,
        status: 'pass',
        score: 100,
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: [],
        blocking_issues: [],
        warnings: [],
      },
    },
  };
}

async function seedQualityDecisionJob(jobStore, {
  projectRoot,
  configName,
  reportSummary,
}) {
  const job = await jobStore.createJob({
    type: 'report',
    config: {
      name: configName,
      shapes: [{ id: 'body', type: 'box', length: 12, width: 10, height: 8 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const reportSummaryPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_report_summary.json`,
    `${JSON.stringify(reportSummary, null, 2)}\n`
  );
  const reportPdfPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_report.pdf`,
    `%PDF-1.4\n% ${configName} browser smoke placeholder\n`
  );
  const manifestPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_manifest.json`,
    `${JSON.stringify({ command: 'report', config_name: configName }, null, 2)}\n`
  );
  const manifest = await buildArtifactManifest({
    projectRoot,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'report.summary-json',
        path: reportSummaryPath,
        label: 'report_summary_json',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'report.pdf',
        path: reportPdfPath,
        label: 'report_pdf',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'output.manifest.json',
        path: manifestPath,
        label: 'create_manifest',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  return jobStore.completeJob(
    job.id,
    {
      success: true,
      source: 'browser-quality-smoke',
      report_summary: reportSummary,
    },
    {
      report_summary: reportSummaryPath,
      report_pdf: reportPdfPath,
      create_manifest: manifestPath,
    },
    {},
    manifest
  );
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
  const passQualityJob = await seedQualityDecisionJob(jobStore, {
    projectRoot: ROOT,
    configName: 'quality_pass_bracket',
    reportSummary: passQualityReportSummary(),
  });
  const failQualityJob = await seedQualityDecisionJob(jobStore, {
    projectRoot: ROOT,
    configName: 'ks_bracket',
    reportSummary: failQualityReportSummary(),
  });
  const optionalQualityJob = await seedQualityDecisionJob(jobStore, {
    projectRoot: ROOT,
    configName: 'optional_quality_bracket',
    reportSummary: optionalQualityReportSummary(),
  });
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
  const seededReadinessPath = await jobStore.writeJobFile(
    seededJob.id,
    'artifacts/browser-smoke-readiness.json',
    `${JSON.stringify({
      readiness_summary: {
        score: 82,
        status: 'hold',
        gate_decision: 'hold_before_line_commitment',
      },
      summary: {
        overall_risk_level: 'hold',
        recommended_actions: [
          'Inspect assembly fit before line commitment.',
          'Review tolerance stack with QA.',
        ],
      },
      decision_summary: {
        hold_points: ['Assembly fit risk'],
        next_actions: ['Update tolerance assumptions'],
      },
      product_review: {
        summary: {
          dfm_score: 74,
          overall_risk_level: 'medium',
          part_type: 'bracket',
          top_issues: ['Wall thickness variance'],
          recommended_actions: ['Normalize wall thickness'],
        },
      },
      quality_risk: {
        summary: {
          overall_risk_level: 'medium',
          top_issues: ['QA sampling needs review'],
          traceability_focus: ['Lot tracking'],
        },
        critical_dimensions: [{ id: 'WIDTH' }],
        quality_gates: [{ id: 'gate-1' }],
      },
      investment_review: {
        summary: {
          investment_pressure: 'medium',
          top_cost_drivers: ['Fixture update'],
        },
        cost_breakdown: {
          unit_cost: 18.4,
          total_cost: 184,
        },
      },
    }, null, 2)}\n`
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
      {
        type: 'review.readiness',
        path: seededReadinessPath,
        label: 'Browser smoke readiness artifact',
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

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    if (!localeSelect) return false;
    localeSelect.value = 'en';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, 'en');
    assert.equal(nextSnapshot.selectedLocale, 'en');
    assert.equal(nextSnapshot.activeRoute, 'start');
    return nextSnapshot;
  });

  await cdp.evaluate(`document.querySelector('.nav-link[data-route="artifacts"]')?.click()`);
  await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
  });

  async function openQualityJobFromTimeline(jobId) {
    await waitFor(async () => {
      const clicked = await cdp.evaluate(`(() => {
        const button = document.querySelector('[data-action="artifacts-open-job"][data-job-id="${jobId}"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      assert.equal(clicked, true);
      return clicked;
    }, {
      attempts: 50,
      delayMs: 150,
    });
    await waitForRoute(cdp, 'artifacts', {
      attempts: 50,
      delayMs: 200,
      expectedHash: `#artifacts?job=${jobId}`,
    });
  }

  async function waitForDashboardText(expectedText) {
    return waitFor(async () => {
      const dashboard = await cdp.evaluate(jobContextExpression('artifacts-quality-dashboard'));
      assert.equal(dashboard.text.includes(expectedText), true);
      return dashboard.text;
    }, {
      attempts: 60,
      delayMs: 150,
    });
  }

  function assertIncludesAll(text, expectedValues) {
    for (const expected of expectedValues) {
      assert.equal(text.includes(expected), true, `Expected browser text to include ${expected}`);
    }
  }

  function assertExcludesAll(text, forbiddenValues) {
    for (const forbidden of forbiddenValues) {
      assert.equal(text.includes(forbidden), false, `Expected browser text not to include ${forbidden}`);
    }
  }

  await openQualityJobFromTimeline(passQualityJob.id);
  const passDashboardText = await waitForDashboardText('Quality Dashboard - quality_pass_bracket');
  const passPageText = await cdp.evaluate(pageTextExpression());
  assertIncludesAll(passPageText, [
    'quality_pass_bracket',
    'Job succeeded',
    'Quality passed',
    'Ready Yes',
  ]);
  assertIncludesAll(passDashboardText, [
    'Quality Dashboard - quality_pass_bracket',
    'All required quality gates passed',
    'No manufacturing blockers',
    'Ready for manufacturing review: Yes',
  ]);
  assertExcludesAll(passDashboardText, ['in_memory', 'not_available']);

  await openQualityJobFromTimeline(failQualityJob.id);
  const failDashboardText = await waitForDashboardText('Quality Dashboard - ks_bracket');
  const failPageText = await cdp.evaluate(pageTextExpression());
  assertIncludesAll(failPageText, [
    'ks_bracket',
    'Job succeeded',
    'Quality failed',
    'Ready No',
  ]);
  assertIncludesAll(failDashboardText, [
    'Quality Dashboard - ks_bracket',
    'Manufacturing review blocked by',
    'Ready for manufacturing review: No',
  ]);
  assertExcludesAll(failDashboardText, ['in_memory', 'not_available']);

  await openQualityJobFromTimeline(optionalQualityJob.id);
  const optionalDashboardText = await waitForDashboardText('Quality Dashboard - optional_quality_bracket');
  assertIncludesAll(optionalDashboardText, [
    'Optional missing',
    'Optional not run',
    'Computed in report',
  ]);
  assertExcludesAll(optionalDashboardText, ['in_memory', 'not_available']);

  await cdp.evaluate(`document.querySelector('.nav-link[data-route="start"]')?.click()`);
  await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
  });

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
  const forcedLocale = 'ko';
  const forcedLocaleLabels = {
    start: '콘솔',
    review: '검토',
    artifacts: '패키지',
    model: '모델',
    drawing: '도면',
  };

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

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    if (!localeSelect) return false;
    localeSelect.value = '${forcedLocale}';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  localeSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, forcedLocale);
    assert.equal(nextSnapshot.selectedLocale, forcedLocale);
    assert.equal(nextSnapshot.activeRoute, 'start');
    assert.equal(nextSnapshot.cookie.includes(`ui_locale=${forcedLocale}`), true);
    assert.equal(nextSnapshot.storedLocale, forcedLocale);
    return nextSnapshot;
  });
  assert.equal(localeSnapshot.startLabel, forcedLocaleLabels.start);
  assert.match(localeSnapshot.summary, /[가-힣]/);

  const forcedLocaleRoutes = ['review', 'artifacts', 'model', 'drawing', 'start'];
  for (const route of forcedLocaleRoutes) {
    await cdp.evaluate(`document.querySelector('.nav-link[data-route="${route}"]')?.click()`);
    const snapshot = await waitForRoute(cdp, route, {
      attempts: route === 'model' || route === 'drawing' ? 50 : 30,
      delayMs: route === 'model' || route === 'drawing' ? 200 : 120,
    });
    const nextLocaleSnapshot = await waitFor(async () => {
      const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
      assert.equal(nextSnapshot.lang, forcedLocale);
      assert.equal(nextSnapshot.selectedLocale, forcedLocale);
      assert.equal(nextSnapshot.cookie.includes(`ui_locale=${forcedLocale}`), true);
      assert.equal(nextSnapshot.storedLocale, forcedLocale);
      assert.equal(nextSnapshot.activeRoute, route);
      return nextSnapshot;
    }, {
      attempts: 40,
      delayMs: 150,
    });
    assert.equal(await cdp.evaluate(routeLabelExpression(route)), forcedLocaleLabels[route]);
    assert.match(snapshot.summary, /[가-힣]/);
    assert.match(nextLocaleSnapshot.summary, /[가-힣]/);
  }

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#review` });
  let deepLinkSnapshot = await waitForRoute(cdp, 'review', {
    attempts: 50,
    delayMs: 200,
  });
  assert.notEqual(deepLinkSnapshot.summary, initial.summary);

  let reloadedLocaleSnapshot = await waitFor(async () => {
    const nextSnapshot = await cdp.evaluate(localeSnapshotExpression());
    assert.equal(nextSnapshot.lang, forcedLocale);
    assert.equal(nextSnapshot.selectedLocale, forcedLocale);
    assert.equal(nextSnapshot.activeRoute, 'review');
    assert.equal(nextSnapshot.cookie.includes(`ui_locale=${forcedLocale}`), true);
    assert.equal(nextSnapshot.storedLocale, forcedLocale);
    return nextSnapshot;
  }, {
    attempts: 40,
    delayMs: 150,
  });
  assert.equal(reloadedLocaleSnapshot.startLabel, forcedLocaleLabels.start);
  assert.match(reloadedLocaleSnapshot.summary, /[가-힣]/);

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
  const reviewCards = await waitFor(async () => {
    const nextCards = await cdp.evaluate(jobContextExpression('review-cards'));
    assert.equal(nextCards.text.length > 0, true);
    return nextCards;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(reviewCards.text.includes('medium'), false);
  assert.equal(reviewCards.text.includes('hold'), false);
  assert.equal(reviewCards.text.includes('보통'), true);
  assert.equal(reviewCards.text.includes('보류'), true);
  let reviewSummary = await waitFor(async () => {
    const nextSummary = await cdp.evaluate(jobContextExpression('review-detail-summary'));
    assert.equal(nextSummary.text.length > 0, true);
    return nextSummary;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(reviewSummary.text.includes('Part type'), false);
  assert.equal(reviewSummary.text.includes('Overall risk'), false);
  assert.equal(reviewSummary.text.includes('부품 유형'), true);
  assert.equal(reviewSummary.text.includes('전체 위험도'), true);
  await cdp.evaluate(`document.querySelector('[data-action="review-select-card"][data-card-id="readiness"]')?.click()`);
  reviewSummary = await waitFor(async () => {
    const nextSummary = await cdp.evaluate(jobContextExpression('review-detail-summary'));
    assert.equal(nextSummary.text.includes('라인 커밋 전 보류'), true);
    return nextSummary;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(reviewSummary.text.includes('hold_before_line_commitment'), false);
  assert.equal(reviewSummary.text.includes('보류'), true);
  const reviewActions = await waitFor(async () => {
    const nextActions = await cdp.evaluate(jobContextExpression('review-detail-actions'));
    assert.equal(nextActions.text.length > 0, true);
    assert.equal(nextActions.text.includes('Download'), false);
    return nextActions;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(/원본 산출물 열기|패키지 열기|모델에서 다시 열기/.test(reviewActions.text), true);

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
  const artifactActions = await waitFor(async () => {
    const nextActions = await cdp.evaluate(jobContextExpression('artifacts-detail-actions'));
    assert.equal(nextActions.text.includes('다운로드'), true);
    assert.equal(nextActions.text.includes('Download'), false);
    return nextActions;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(artifactActions.text.includes('검토 열기'), true);

  const blockingLogs = cdp.logs.filter((entry) => (
    entry.source === 'network'
      && entry.level === 'error'
      && /\/js\/(?:studio-shell\.js|studio\/workspaces\.js|i18n\/index\.js)/.test(`${entry.url || ''} ${entry.text || ''}`)
  ));
  assert.deepEqual(blockingLogs, [], blockingLogs.map(summarizeLog).join('\n'));

  const consoleDiagnostics = cdp.logs.filter((entry) => (
    ['warning', 'error'].includes(entry.level)
      && entry.source !== 'network'
      && (
        String(entry.url || '').includes(baseUrl)
        || /\/js\/(?:studio|i18n)\//.test(`${entry.url || ''} ${entry.text || ''}`)
      )
  ));
  assert.deepEqual(consoleDiagnostics, [], consoleDiagnostics.map(summarizeLog).join('\n'));

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
