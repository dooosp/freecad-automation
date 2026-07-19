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

async function keyboardActivate(cdp, selector) {
  const targetSnapshot = await cdp.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement) || target.matches(':disabled,[aria-disabled="true"]')) {
      return { focused: false, tagName: '' };
    }
    target.focus();
    return {
      focused: document.activeElement === target,
      tagName: target.tagName,
    };
  })()`);
  assert.equal(targetSnapshot.focused, true, `Expected keyboard target to be focusable: ${selector}`);
  const isLink = targetSnapshot.tagName === 'A';
  const key = isLink ? 'Enter' : ' ';
  const code = isLink ? 'Enter' : 'Space';
  const virtualKeyCode = isLink ? 13 : 32;
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

function summarizeException(details = {}) {
  return details.exception?.description
    || details.exception?.value
    || `${details.text || 'Exception'} @ ${details.url || 'unknown'}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0}`;
}

function summarizeLog(entry = {}) {
  return `${entry.source || 'log'} ${entry.level || ''} ${entry.url || ''} ${entry.text || ''}`.trim();
}

const EXPECTED_HEADLESS_WEBGL_WARNING_TEXT = [
  'Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag to opt in to lower security guarantees for trusted content.',
  'GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
];

function isExpectedHeadlessWebGlWarning(entry = {}) {
  const text = String(entry.text || '');
  return entry.source === 'rendering'
    && entry.level === 'warning'
    && EXPECTED_HEADLESS_WEBGL_WARNING_TEXT.some((expectedText) => text.includes(expectedText));
}

for (const diagnosticCase of [
  {
    expected: true,
    entry: {
      source: 'rendering',
      level: 'warning',
      text: '[]Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag to opt in to lower security guarantees for trusted content.',
    },
  },
  {
    expected: true,
    entry: {
      source: 'rendering',
      level: 'warning',
      text: '[.WebGL-0x1234]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
    },
  },
  {
    expected: false,
    entry: {
      source: 'rendering',
      level: 'error',
      text: '[.WebGL-0x1234]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
    },
  },
  {
    expected: false,
    entry: {
      source: 'javascript',
      level: 'warning',
      text: 'Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag to opt in to lower security guarantees for trusted content.',
    },
  },
  {
    expected: false,
    entry: {
      source: 'rendering',
      level: 'warning',
      text: 'WebGL context lost while rendering the model.',
    },
  },
]) {
  assert.equal(isExpectedHeadlessWebGlWarning(diagnosticCase.entry), diagnosticCase.expected);
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
      coreNavCount: document.querySelectorAll('.nav-link[data-nav-tier="core"]').length,
      advancedNavCount: document.querySelectorAll('.nav-link[data-nav-tier="advanced"]').length,
      homeChoiceCount: document.querySelectorAll('[data-hook="home-start-choices"] [data-start-goal]').length,
      homeChoicePrimaryCount: document.querySelectorAll('[data-hook="home-start-choices"] [data-action-kind="primary"]').length,
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
  return `(() => {
    const activeElement = document.activeElement;
    const activeRect = activeElement?.getBoundingClientRect();
    const activeStyle = activeElement instanceof Element ? getComputedStyle(activeElement) : null;
    const activeElementVisible = Boolean(
      activeElement instanceof HTMLElement
      && activeElement.getClientRects().length > 0
      && activeRect.width > 0
      && activeRect.height > 0
      && activeStyle?.display !== 'none'
      && activeStyle?.visibility !== 'hidden'
    );
    return {
      sidebarOpen: document.getElementById('studio-sidebar')?.classList.contains('is-open') || false,
      mainInert: document.querySelector('.studio-main')?.inert ?? false,
      skipLinkInert: document.querySelector('.skip-link')?.inert ?? false,
      jobsOpen: document.getElementById('jobs-drawer')?.classList.contains('is-open') || false,
      jobsExpanded: document.getElementById('jobs-toggle')?.getAttribute('aria-expanded') || '',
      logOpen: document.getElementById('log-drawer')?.classList.contains('is-open') || false,
      logExpanded: document.getElementById('log-toggle')?.getAttribute('aria-expanded') || '',
      activeElementId: activeElement?.id || '',
      activeElementVisible,
      activeElementInViewport: activeElementVisible
        && activeRect.left >= 0
        && activeRect.top >= 0
        && activeRect.right <= window.innerWidth
        && activeRect.bottom <= window.innerHeight,
    };
  })()`;
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

function canonicalPackageSnapshotExpression() {
  return `(() => {
    const cards = [...document.querySelectorAll('.canonical-package-card')];
    const packageGrid = document.querySelector('[data-hook="canonical-package-cards"]');
    const packageHost = packageGrid?.closest('.studio-card');
    const slugText = (card) => card.querySelector('.eyebrow')?.textContent?.trim() || '';
    const qualityPassCard = cards.find((card) => slugText(card) === 'quality-pass-bracket');
    const releaseBundleRef = [...(qualityPassCard?.querySelectorAll('.canonical-artifact-ref') || [])]
      .find((entry) => entry.textContent.includes('release_bundle.zip'));
    const readinessRef = [...(qualityPassCard?.querySelectorAll('.canonical-artifact-ref') || [])]
      .find((entry) => entry.textContent.includes('readiness_report.json'));
    const actionSnapshot = (root) => [...(root?.querySelectorAll('button[data-action],a') || [])].map((entry) => ({
      tag: entry.tagName.toLowerCase(),
      action: entry.dataset?.action || '',
      text: entry.textContent?.replace(/\\s+/g, ' ').trim() || '',
      href: entry.getAttribute('href') || '',
      download: entry.hasAttribute('download'),
    }));
    return {
      count: cards.length,
      slugs: cards.map(slugText),
      text: document.querySelector('[data-hook="canonical-package-cards"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      releaseBundleActions: actionSnapshot(releaseBundleRef),
      releaseBundleText: releaseBundleRef?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      readinessActions: actionSnapshot(readinessRef),
      layout: {
        viewportWidth: window.innerWidth,
        hostInsideConsoleColumn: Boolean(packageHost?.closest('.console-column')),
        packageGridWidth: packageGrid?.getBoundingClientRect().width || 0,
        packageGridOverflows: (packageGrid?.scrollWidth || 0) > (packageGrid?.clientWidth || 0) + 1,
        cardWidth: qualityPassCard?.getBoundingClientRect().width || 0,
        cardOverflows: (qualityPassCard?.scrollWidth || 0) > (qualityPassCard?.clientWidth || 0) + 1,
        artifactLabelWidth: readinessRef?.querySelector('.canonical-artifact-label')?.getBoundingClientRect().width || 0,
        artifactPathWidth: readinessRef?.querySelector('.canonical-path')?.getBoundingClientRect().width || 0,
      },
    };
  })()`;
}

function canonicalPreviewSnapshotExpression() {
  return `(() => {
    const panel = document.querySelector('[data-hook="canonical-artifact-preview"]');
    const previewCard = panel?.closest('.canonical-package-card');
    const peerCard = [...document.querySelectorAll('.canonical-package-card')]
      .find((card) => card !== previewCard);
    return {
      text: panel?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      title: panel?.querySelector('.canonical-preview-title')?.textContent?.trim() || '',
      content: panel?.querySelector('.canonical-preview-content')?.textContent || '',
      links: [...(panel?.querySelectorAll('a') || [])].map((entry) => ({
        href: entry.getAttribute('href') || '',
        download: entry.hasAttribute('download'),
      })),
      layout: {
        panelWidth: panel?.getBoundingClientRect().width || 0,
        panelOverflows: (panel?.scrollWidth || 0) > (panel?.clientWidth || 0) + 1,
        contentWidth: panel?.querySelector('.canonical-preview-content')?.getBoundingClientRect().width || 0,
        previewCardHeight: previewCard?.getBoundingClientRect().height || 0,
        peerCardHeight: peerCard?.getBoundingClientRect().height || 0,
      },
    };
  })()`;
}

function modelRouteReadinessExpression() {
  return `(() => {
    const root = document.getElementById('workspace-root')?.firstElementChild;
    return {
      text: root?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      hasValidate: Boolean(root?.querySelector('[data-action="model-validate"]')),
      hasBuild: Boolean(root?.querySelector('[data-action="model-build"]')),
      hasTrackedCreate: Boolean(root?.querySelector('[data-action="model-run-tracked-create"]')),
      hasTrackedReport: Boolean(root?.querySelector('[data-action="model-run-tracked-report"]')),
    };
  })()`;
}

function drawingRouteReadinessExpression() {
  return `(() => {
    const root = document.getElementById('workspace-root')?.firstElementChild;
    return {
      text: root?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      hasPreview: Boolean(root?.querySelector('[data-action="drawing-generate"]')),
      hasTrackedDraw: Boolean(root?.querySelector('[data-action="drawing-run-tracked"]')),
      hasStage: Boolean(root?.querySelector('[data-hook="drawing-stage"]')),
    };
  })()`;
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
        semantic_quality: {
          enforceable: false,
          suggested_actions: [],
          extracted_evidence: {
            status: 'available',
            advisory_only: true,
            file: '/tmp/output/quality_pass_bracket_extracted_drawing_semantics.json',
            path: '/tmp/output/quality_pass_bracket_extracted_drawing_semantics.json',
            coverage: {
              required_dimensions: { total: 2, extracted: 2, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
              required_notes: { total: 1, extracted: 1, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
              required_views: { total: 2, extracted: 2, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
              total_required: 5,
              total_extracted: 5,
              total_missing: 0,
              total_unknown: 0,
              total_unsupported: 0,
            },
            required_dimensions: [
              {
                requirement_id: 'HOLE_LEFT_DIA',
                requirement_label: 'Left hole diameter',
                classification: 'extracted',
                matched_raw_text: '6',
                source_artifact: 'svg',
                confidence: 0.93,
                candidate_matches: [],
              },
            ],
            required_notes: [
              {
                requirement_id: 'MATERIAL',
                requirement_label: 'Material callout',
                classification: 'extracted',
                matched_raw_text: 'Material: AL6061',
                source_artifact: 'svg',
                confidence: 0.91,
                candidate_matches: [],
              },
            ],
            required_views: [
              {
                requirement_id: 'top',
                requirement_label: 'Top view',
                classification: 'extracted',
                matched_raw_text: 'Top',
                source_artifact: 'layout_report',
                confidence: 0.9,
                candidate_matches: [],
              },
            ],
            unmatched_dimensions: [],
            unmatched_notes: [],
            matched_required_dimensions: 2,
            matched_required_notes: 1,
            matched_required_views: 2,
            missing_required_items: [],
            unknowns: [],
            limitations: ['Advisory-only foundation.'],
            suggested_actions: [],
            suggested_action_details: [],
          },
        },
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
        missing_required_views: ['section A-A'],
        missing_required_notes: ['material callout'],
        conflict_count: 7,
        overlap_count: 0,
        traceability_coverage_percent: 0,
        recommended_actions: ['Add or map the missing required dimension intent(s): HOLE_DIA.'],
        blocking_issues: ['Dimension conflict count 7 exceeds the allowed maximum 0.'],
        warnings: [],
        semantic_quality: {
          enforceable: false,
          suggested_actions: ['Review low-confidence or incomplete extracted dimension evidence for: HOLE_DIA.'],
          extracted_evidence: {
            status: 'partial',
            advisory_only: true,
            file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
            path: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
            coverage: {
              required_dimensions: { total: 3, extracted: 1, missing: 0, unknown: 2, unsupported: 0, extracted_percent: 33.33 },
              required_notes: { total: 2, extracted: 1, missing: 0, unknown: 1, unsupported: 0, extracted_percent: 50 },
              required_views: { total: 4, extracted: 4, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
              total_required: 9,
              total_extracted: 6,
              total_missing: 0,
              total_unknown: 3,
              total_unsupported: 0,
            },
            required_dimensions: [
              {
                requirement_id: 'WEB_HEIGHT',
                requirement_label: 'Web height',
                classification: 'extracted',
                matched_raw_text: '68',
                source_artifact: 'svg',
                confidence: 0.88,
                candidate_matches: [],
              },
              {
                requirement_id: 'HOLE_DIA',
                requirement_label: 'Hole diameter',
                classification: 'unknown',
                confidence: null,
                candidate_matches: [
                  {
                    matched_raw_text: '16',
                    source_artifact: 'svg',
                    confidence: 0.31,
                  },
                ],
              },
              {
                requirement_id: 'BASE_PLATE_ENVELOPE',
                requirement_label: 'Base plate envelope',
                classification: 'unknown',
                candidate_matches: [],
              },
            ],
            required_notes: [
              {
                requirement_id: 'SURFACE_FINISH',
                requirement_label: 'Surface finish',
                classification: 'extracted',
                matched_raw_text: 'Surface finish: powder coat',
                source_artifact: 'svg',
                confidence: 0.82,
                candidate_matches: [],
              },
              {
                requirement_id: 'MATERIAL',
                requirement_label: 'Material callout',
                classification: 'unknown',
                candidate_matches: [],
              },
            ],
            required_views: [
              {
                requirement_id: 'front',
                requirement_label: 'Front view',
                classification: 'extracted',
                matched_raw_text: 'Front',
                source_artifact: 'layout_report',
                confidence: 0.92,
                candidate_matches: [],
              },
              {
                requirement_id: 'top',
                requirement_label: 'Top view',
                classification: 'extracted',
                matched_raw_text: 'Top',
                source_artifact: 'layout_report',
                confidence: 0.91,
                candidate_matches: [],
              },
              {
                requirement_id: 'right',
                requirement_label: 'Right view',
                classification: 'extracted',
                matched_raw_text: 'Right',
                source_artifact: 'layout_report',
                confidence: 0.9,
                candidate_matches: [],
              },
              {
                requirement_id: 'section A-A',
                requirement_label: 'Section A-A',
                classification: 'extracted',
                matched_raw_text: 'Section A-A',
                source_artifact: 'layout_report',
                confidence: 0.9,
                candidate_matches: [],
              },
            ],
            unmatched_dimensions: [
              {
                raw_text: '60',
                source_artifact: 'svg',
                confidence: 0.84,
                reason: 'Extracted dimension did not match a required drawing-intent dimension.',
              },
            ],
            unmatched_notes: [
              {
                raw_text: 'Tolerance: KS B 0401 m',
                source_artifact: 'svg',
                confidence: 0.87,
                reason: 'Extracted note did not match a required drawing-intent note.',
              },
            ],
            matched_required_dimensions: 1,
            matched_required_notes: 1,
            matched_required_views: 4,
            missing_required_items: [],
            unknowns: [
              'Required dimension not reliably extracted: HOLE_DIA.',
              'Required dimension not reliably extracted: BASE_PLATE_ENVELOPE.',
              'Required note not reliably extracted: MATERIAL.',
            ],
            limitations: ['Advisory-only foundation.'],
            suggested_actions: ['Review low-confidence or incomplete extracted dimension evidence for: HOLE_DIA.'],
            suggested_action_details: [
              {
                id: 'dimension:hole-dia:low-confidence',
                severity: 'review',
                category: 'dimension',
                target_requirement_id: 'HOLE_DIA',
                target_feature_id: 'hole_001',
                classification: 'low_confidence',
                title: 'Review required dimension Hole diameter because extracted evidence is low-confidence.',
                message: 'Only a low-confidence extracted candidate was available for HOLE_DIA.',
                recommended_fix: 'Verify the hole diameter callout is visible and update aliases if extraction should map it to HOLE_DIA.',
                evidence: [
                  {
                    source: 'drawing_quality.semantic_quality.extracted_evidence',
                    path: 'required_dimensions.HOLE_DIA.candidate_matches[0].confidence',
                    value: '0.31',
                  },
                ],
              },
              {
                id: 'note:material:unknown',
                severity: 'review',
                category: 'note',
                target_requirement_id: 'MATERIAL',
                target_feature_id: '',
                classification: 'unknown',
                title: 'Add or verify the required note Material callout.',
                message: 'Extracted drawing semantics explicitly marked the MATERIAL note as uncertain.',
                recommended_fix: 'Verify the required note text is present and readable. Confirm extraction can still match the note to MATERIAL.',
                evidence: [
                  {
                    source: 'drawing_quality.semantic_quality.extracted_evidence',
                    path: 'required_notes.MATERIAL.classification',
                    value: 'unknown',
                  },
                ],
              },
              {
                id: 'mapping:unmatched-dimensions:unmatched',
                severity: 'info',
                category: 'mapping',
                target_requirement_id: 'unmatched_dimensions',
                target_feature_id: '',
                classification: 'unmatched',
                title: 'Improve intent aliases or drawing labels for unmatched extracted dimensions.',
                message: 'Some extracted dimensions did not match any required drawing intent.',
                recommended_fix: 'Review whether the unmatched dimensions should map to an existing required intent.',
                evidence: [
                  {
                    source: 'drawing_quality.semantic_quality.extracted_evidence',
                    path: 'unmatched_dimensions.count',
                    value: '1',
                  },
                ],
              },
            ],
          },
        },
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

function smokeEngineeringMeasurement({
  requirement_id,
  source_requirement_id,
  feature_id,
  measurement_type,
  expected_value_mm = null,
  actual_value_mm = null,
  expected_center_xy_mm = null,
  actual_center_xy_mm = null,
  tolerance_mm,
  delta_mm = null,
  center_delta_mm = null,
  status = 'pass',
  source = 'generated_shape_geometry',
  validation_kind = 'generated_shape_geometry_check',
  message = null,
}) {
  return {
    requirement_id,
    source_requirement_id,
    feature_id,
    measurement_type,
    expected_value_mm,
    actual_value_mm,
    source_value_mm: actual_value_mm,
    expected_center_xy_mm,
    actual_center_xy_mm,
    tolerance_mm,
    delta_mm,
    center_delta_mm,
    source_delta_mm: null,
    source_center_delta_mm: null,
    status,
    required: true,
    source,
    source_field: `${source}.${feature_id}.${measurement_type}`,
    expected_source: 'config_parameter',
    expected_source_field: `config.${source_requirement_id}`,
    validation_kind,
    matched_face_index: 7,
    message,
  };
}

function smokeCreateQualityPayload(reportSummary) {
  const failed = reportSummary.surfaces.create_quality.status === 'fail';
  const failLeftCenter = failed;
  const leftCenterActual = failLeftCenter ? [32, 30] : [30, 30];
  const leftCenterDelta = failLeftCenter ? 2 : 0;
  const leftCenterStatus = failLeftCenter ? 'fail' : 'pass';
  const stepSource = 'reimported_step_geometry';
  const stepKind = 'reimported_step_geometry_check';

  return {
    status: failed ? 'fail' : 'pass',
    geometry: {
      valid_shape: !failed,
      volume: 128000,
      bbox: {
        min: [0, 0, 0],
        max: [160, 100, 8],
        size: [160, 100, 8],
      },
    },
    step_roundtrip: {
      exported: true,
      reimport_attempted: true,
      reimport_valid: true,
      volume_delta_percent: 0,
      bbox_delta: {
        min: [0, 0, 0],
        max: [0, 0, 0],
        size: [0, 0, 0],
        max_abs_mm: 0,
      },
    },
    thresholds: {
      max_step_volume_delta_percent: 0.5,
      max_bbox_delta_mm: 0.2,
      max_engineering_dimension_delta_mm: 0.05,
      max_engineering_center_delta_mm: 0.2,
    },
    engineering_quality: {
      status: failed ? 'fail' : 'pass',
      source: 'generated_shape_geometry',
      validation_kind: 'generated_shape_geometry_check',
      blocking_issues: failLeftCenter ? ['Hole hole_left generated_shape_geometry center differs from expected center by 2 mm.'] : [],
      warnings: [],
      measurements: [
        smokeEngineeringMeasurement({
          requirement_id: 'HOLE_LEFT_DIA',
          source_requirement_id: 'HOLE_LEFT_DIA',
          feature_id: 'hole_left',
          measurement_type: 'hole_diameter',
          expected_value_mm: 6,
          actual_value_mm: 6,
          tolerance_mm: 0.05,
          delta_mm: 0,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'hole_left_CENTER',
          source_requirement_id: 'HOLE_LEFT_DIA',
          feature_id: 'hole_left',
          measurement_type: 'hole_center',
          expected_center_xy_mm: [30, 30],
          actual_center_xy_mm: leftCenterActual,
          tolerance_mm: 0.2,
          delta_mm: leftCenterDelta,
          center_delta_mm: leftCenterDelta,
          status: leftCenterStatus,
          message: failLeftCenter ? 'Hole hole_left generated_shape_geometry center differs from expected center by 2 mm.' : null,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'HOLE_RIGHT_DIA',
          source_requirement_id: 'HOLE_RIGHT_DIA',
          feature_id: 'hole_right',
          measurement_type: 'hole_diameter',
          expected_value_mm: 10,
          actual_value_mm: 10,
          tolerance_mm: 0.05,
          delta_mm: 0,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'hole_right_CENTER',
          source_requirement_id: 'HOLE_RIGHT_DIA',
          feature_id: 'hole_right',
          measurement_type: 'hole_center',
          expected_center_xy_mm: [125, 70],
          actual_center_xy_mm: [125, 70],
          tolerance_mm: 0.2,
          delta_mm: 0,
          center_delta_mm: 0,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'HOLE_LEFT_DIA_STEP_REIMPORT',
          source_requirement_id: 'HOLE_LEFT_DIA',
          feature_id: 'hole_left',
          measurement_type: 'hole_diameter',
          expected_value_mm: 6,
          actual_value_mm: 6,
          tolerance_mm: 0.05,
          delta_mm: 0,
          source: stepSource,
          validation_kind: stepKind,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'hole_left_CENTER_STEP_REIMPORT',
          source_requirement_id: 'HOLE_LEFT_DIA',
          feature_id: 'hole_left',
          measurement_type: 'hole_center',
          expected_center_xy_mm: [30, 30],
          actual_center_xy_mm: leftCenterActual,
          tolerance_mm: 0.2,
          delta_mm: leftCenterDelta,
          center_delta_mm: leftCenterDelta,
          status: leftCenterStatus,
          source: stepSource,
          validation_kind: stepKind,
          message: failLeftCenter ? 'Hole hole_left reimported_step_geometry center differs from expected center by 2 mm.' : null,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'HOLE_RIGHT_DIA_STEP_REIMPORT',
          source_requirement_id: 'HOLE_RIGHT_DIA',
          feature_id: 'hole_right',
          measurement_type: 'hole_diameter',
          expected_value_mm: 10,
          actual_value_mm: 10,
          tolerance_mm: 0.05,
          delta_mm: 0,
          source: stepSource,
          validation_kind: stepKind,
        }),
        smokeEngineeringMeasurement({
          requirement_id: 'hole_right_CENTER_STEP_REIMPORT',
          source_requirement_id: 'HOLE_RIGHT_DIA',
          feature_id: 'hole_right',
          measurement_type: 'hole_center',
          expected_center_xy_mm: [125, 70],
          actual_center_xy_mm: [125, 70],
          tolerance_mm: 0.2,
          delta_mm: 0,
          center_delta_mm: 0,
          source: stepSource,
          validation_kind: stepKind,
        }),
      ],
      measurement_provenance: [],
    },
  };
}

async function completeQualityDecisionJob(jobStore, {
  projectRoot,
  job,
  configName,
  reportSummary,
  source = 'browser-quality-smoke',
}) {
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
  const stepPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}.step`,
    `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('${configName} browser smoke placeholder'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`
  );
  const stlPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}.stl`,
    `solid ${configName}\nendsolid ${configName}\n`
  );
  const manifestPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_manifest.json`,
    `${JSON.stringify({ command: 'report', config_name: configName }, null, 2)}\n`
  );
  const createQualityPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_create_quality.json`,
    `${JSON.stringify(smokeCreateQualityPayload(reportSummary), null, 2)}\n`
  );
  const extractedSemanticsPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_extracted_drawing_semantics.json`,
    `${JSON.stringify({
      artifact_type: 'extracted_drawing_semantics',
      status: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.status || 'unknown',
      decision: 'advisory',
      coverage: {
        required_dimensions_total: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_dimensions?.total || 0,
        required_dimensions_extracted: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_dimensions?.extracted || 0,
        required_notes_total: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_notes?.total || 0,
        required_notes_extracted: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_notes?.extracted || 0,
        required_views_total: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_views?.total || 0,
        required_views_extracted: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.coverage?.required_views?.extracted || 0,
      },
      unknowns: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.unknowns || [],
      limitations: reportSummary.surfaces.drawing_quality.semantic_quality?.extracted_evidence?.limitations || [],
    }, null, 2)}\n`
  );
  const drawingPlannerPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_drawing_planner.json`,
    `${JSON.stringify({
      status: 'advisory',
      summary: {
        config_name: configName,
        note: 'browser smoke planner placeholder',
      },
    }, null, 2)}\n`
  );
  const drawingQualityPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_drawing_quality.json`,
    `${JSON.stringify({
      status: reportSummary.surfaces.drawing_quality.status,
      score: reportSummary.surfaces.drawing_quality.score,
      dimensions: {
        missing_required_intents: reportSummary.surfaces.drawing_quality.missing_required_dimensions || [],
        missing_optional_intents: reportSummary.surfaces.drawing_quality.missing_optional_dimensions || [],
        conflict_count: reportSummary.surfaces.drawing_quality.conflict_count || 0,
      },
      views: {
        required_count: 3,
        generated_count: reportSummary.surfaces.drawing_quality.missing_required_views?.length ? 2 : 3,
        missing_views: reportSummary.surfaces.drawing_quality.missing_required_views || [],
        overlap_count: reportSummary.surfaces.drawing_quality.overlap_count || 0,
      },
      notes: {
        missing_required_notes: reportSummary.surfaces.drawing_quality.missing_required_notes || [],
        missing_optional_notes: reportSummary.surfaces.drawing_quality.missing_optional_notes || [],
      },
      traceability: {
        coverage_percent: reportSummary.surfaces.drawing_quality.traceability_coverage_percent,
      },
      semantic_quality: reportSummary.surfaces.drawing_quality.semantic_quality || null,
      blocking_issues: reportSummary.surfaces.drawing_quality.blocking_issues || [],
      warnings: reportSummary.surfaces.drawing_quality.warnings || [],
      recommended_actions: reportSummary.surfaces.drawing_quality.recommended_actions || [],
    }, null, 2)}\n`
  );
  const drawingSvgPath = await jobStore.writeJobFile(
    job.id,
    `artifacts/${configName}_drawing.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><text x="8" y="32">${configName}</text></svg>\n`
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
        type: 'model.step',
        path: stepPath,
        label: 'step_export',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'model.stl',
        path: stlPath,
        label: 'stl_export',
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
      {
        type: 'model.quality-summary',
        path: createQualityPath,
        label: 'create_quality',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'drawing.quality-summary',
        path: drawingQualityPath,
        label: 'drawing_quality',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'drawing.extracted-semantics',
        path: extractedSemanticsPath,
        label: 'Extracted drawing semantics JSON',
        scope: 'user-facing',
        stability: 'best-effort',
      },
      {
        type: 'drawing.planner',
        path: drawingPlannerPath,
        label: 'Drawing planner advisory JSON',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'drawing.svg',
        path: drawingSvgPath,
        label: 'drawing_svg',
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
      source,
      report_summary: reportSummary,
    },
    {
      report_summary: reportSummaryPath,
      report_pdf: reportPdfPath,
      step: stepPath,
      stl: stlPath,
      create_manifest: manifestPath,
      create_quality: createQualityPath,
      drawing_quality: drawingQualityPath,
      extracted_drawing_semantics: extractedSemanticsPath,
      drawing_planner: drawingPlannerPath,
      drawing_svg: drawingSvgPath,
    },
    {},
    manifest
  );
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
  return completeQualityDecisionJob(jobStore, {
    projectRoot,
    job,
    configName,
    reportSummary,
  });
}

function stage5bIntakeReportPayload() {
  return {
    artifact_type: 'inspection_evidence_intake_report',
    source: 'browser-smoke-fixture-not-evidence',
    fixture_notice: 'Test-only browser smoke fixture. Not inspection evidence.',
    searched_sources: [
      { kind: 'canonical_package_artifacts', status: 'searched' },
      { kind: 'inspection_evidence_collection_guides', status: 'searched' },
      { kind: 'release_bundles', status: 'rejected_as_evidence' },
    ],
    accepted_candidates: [],
    rejected_candidates: [
      {
        classification: 'generated_artifact',
        reason: 'Release bundles, generated reports, fixtures, screenshots, and CI summaries are not inspection evidence.',
      },
      {
        classification: 'fixture_only',
        reason: 'Browser smoke fixtures are not evidence.',
      },
    ],
    packages: [
      {
        slug: 'quality-pass-bracket',
        readiness_after: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
        },
      },
      {
        slug: 'hinge-block',
        readiness_after: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
        },
      },
    ],
    summary: {
      genuine_inspection_evidence_found: false,
      accepted_candidate_count: 0,
      rejected_candidate_count: 2,
      attachment_ready_candidate_count: 0,
      requires_human_measurement_entry: false,
      readiness_truth: 'readiness remains needs_more_evidence / hold_for_evidence_completion',
    },
  };
}

function stage5bPromotionDryRunPayload() {
  return {
    artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
    source: 'browser-smoke-fixture-not-evidence',
    fixture_notice: 'Test-only browser smoke fixture. Not inspection evidence.',
    summary: {
      promotion_can_run: false,
      canonical_artifacts_mutated: false,
      ready_package_count: 0,
      readiness_expectation: 'No promotion can run; readiness remains needs_more_evidence / hold_for_evidence_completion.',
    },
    packages: [
      {
        package_slug: 'none',
        attachment_ready: false,
        match_confidence: 'none',
        blockers: [
          'No genuine completed inspection evidence is available.',
          'Browser smoke fixtures are not evidence.',
        ],
        canonical_next_command: [],
        expected_artifacts: [],
        readiness_expectation: {
          dry_run: {
            status: 'needs_more_evidence',
            gate_decision: 'hold_for_evidence_completion',
          },
        },
        mutation_boundaries: {
          dry_run_writes: ['promotion_dry_run_manifest.json'],
          canonical_artifacts_mutated_by_dry_run: false,
          allowed_future_mutation_roots: [],
          files_that_would_be_mutated: [],
        },
        rollback_guidance: [
          'No rollback required because this dry-run did not mutate canonical artifacts.',
        ],
      },
    ],
    evidence_boundary: {
      rejected_as_final_evidence: [
        'dry-run manifests',
        'intake reports',
        'audit manifests',
        'fixtures',
        'generated CAD/drawing/quality/readiness/review reports',
        'release bundles',
        'screenshots',
        'CI summaries',
        'templates',
        'collection guides',
        'GitHub metadata',
      ],
      hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    },
  };
}

function stage5bAuditManifestPayload() {
  return {
    artifact_type: 'stage5b_evidence_audit_manifest',
    command: 'stage5b-evidence-audit',
    source: 'browser-smoke-fixture-not-evidence',
    fixture_notice: 'Test-only browser smoke fixture. Not inspection evidence.',
    include_github: false,
    outputs: {
      intake_report: {
        path: 'browser-smoke-fixture/intake_report.json',
        sha256: 'test-only-not-evidence',
      },
      promotion_dry_run_manifest: {
        path: 'browser-smoke-fixture/promotion_dry_run_manifest.json',
        sha256: 'test-only-not-evidence',
      },
      stage5b_audit_manifest: {
        path: 'browser-smoke-fixture/stage5b_audit_manifest.json',
        sha256: 'test-only-not-evidence',
      },
      stage5b_audit_summary: {
        path: 'browser-smoke-fixture/stage5b_audit_summary.md',
        sha256: 'test-only-not-evidence',
      },
    },
    source_classes: {
      accepted_count: 0,
      rejected_count: 2,
      searched_sources: [
        { kind: 'canonical_package_artifacts', status: 'searched' },
        { kind: 'release_bundles', status: 'rejected_as_evidence' },
      ],
    },
    summary: {
      genuine_inspection_evidence_found: false,
      promotion_can_run: false,
      readiness_remains_held: true,
      canonical_artifacts_mutated: false,
      requires_human_measurement_entry: false,
      accepted_candidate_count: 0,
      attachment_ready_candidate_count: 0,
    },
    attachment_ready: {
      count: 0,
      candidates: [],
    },
    blockers: [
      'No genuine completed inspection evidence is available.',
      'Browser smoke fixtures are not evidence.',
    ],
    readiness_held_truth: {
      no_genuine_completed_inspection_evidence_found: true,
      no_promotion_can_run: true,
      requires_human_measurement_entry: false,
      statement: 'No genuine completed inspection evidence is available for promotion; no promotion can run and readiness remains needs_more_evidence / hold_for_evidence_completion.',
    },
    canonical_package_readiness_states: [
      {
        slug: 'quality-pass-bracket',
        promotion_status: 'blocked_no_evidence',
        readiness_remains_held: true,
        readiness_after: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
        },
      },
      {
        slug: 'hinge-block',
        promotion_status: 'blocked_no_evidence',
        readiness_remains_held: true,
        readiness_after: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
        },
      },
    ],
    github_summary: {
      enabled: false,
      repo: 'dooosp/freecad-automation',
      searched_source_count: 0,
      skipped_source_count: 0,
      downloaded_candidate_count: 0,
    },
    next_safe_commands: [
      {
        name: 'rerun-audit',
        command: ['fcad', 'stage5b-evidence-audit', '--out-dir', '<repo-output-dir>'],
        mutates_canonical_artifacts: false,
      },
    ],
    evidence_boundary: {
      human_measurement_entry_requested: false,
      rejected_as_final_evidence: [
        'intake reports',
        'dry-run manifests',
        'audit manifests',
        'fixtures',
        'generated CAD/drawing/quality/DFM/readiness/review reports',
        'release bundles',
        'screenshots',
        'CI summaries',
        'templates',
        'collection guides',
        'GitHub metadata alone',
      ],
      hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    },
  };
}

async function seedStage5bAuditJob(jobStore, { projectRoot }) {
  const job = await jobStore.createJob({
    type: 'stage5b-evidence-audit',
    options: {
      include_github: false,
    },
  });
  const intakePath = await jobStore.writeJobFile(
    job.id,
    'artifacts/intake_report.json',
    `${JSON.stringify(stage5bIntakeReportPayload(), null, 2)}\n`
  );
  const dryRunPath = await jobStore.writeJobFile(
    job.id,
    'artifacts/promotion_dry_run_manifest.json',
    `${JSON.stringify(stage5bPromotionDryRunPayload(), null, 2)}\n`
  );
  const auditManifestPath = await jobStore.writeJobFile(
    job.id,
    'artifacts/stage5b_audit_manifest.json',
    `${JSON.stringify(stage5bAuditManifestPayload(), null, 2)}\n`
  );
  const auditSummaryPath = await jobStore.writeJobFile(
    job.id,
    'artifacts/stage5b_audit_summary.md',
    [
      '# Stage 5B browser smoke audit summary',
      '',
      'Test-only fixture: not inspection evidence.',
      '',
      '- Genuine candidate found: no',
      '- Inspection evidence attached: no',
      '- Promotion can run: no',
      '- Readiness remains held: yes',
      '- Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
      '',
    ].join('\n')
  );
  const manifest = await buildArtifactManifest({
    projectRoot,
    interface: 'api',
    command: 'stage5b-evidence-audit',
    jobType: 'stage5b-evidence-audit',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'inspection-evidence.intake-report',
        path: intakePath,
        label: 'Stage 5B intake report',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'inspection-evidence.promotion-dry-run-manifest',
        path: dryRunPath,
        label: 'Stage 5B promotion dry-run manifest',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'stage5b.evidence-audit-manifest',
        path: auditManifestPath,
        label: 'Stage 5B audit manifest',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'stage5b.evidence-audit-summary',
        path: auditSummaryPath,
        label: 'Stage 5B audit summary',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      finished_at: new Date().toISOString(),
    },
    details: {
      fixture_notice: 'Browser smoke fixture only. Not inspection evidence.',
      hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    },
  });

  return jobStore.completeJob(
    job.id,
    {
      success: true,
      source: 'browser-smoke-fixture-not-evidence',
      fixture_notice: 'Browser smoke fixture only. Not inspection evidence.',
    },
    {
      intake_report: intakePath,
      promotion_dry_run_manifest: dryRunPath,
      stage5b_audit_manifest: auditManifestPath,
      stage5b_audit_summary: auditSummaryPath,
    },
    {},
    manifest
  );
}

function configNameFromTrackedRequest(request = {}) {
  const explicitName = request.config?.name || request.options?.studio?.config_name;
  if (explicitName) return String(explicitName);
  const configToml = String(request.config_toml || '');
  return configToml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || 'quality_pass_bracket';
}

function createBrowserSmokeExecutor({ projectRoot, jobStore }) {
  return {
    async execute(jobId) {
      const claim = await jobStore.claimJobForExecution(jobId, 'browser_smoke_executor_started');
      if (!claim.ok) return;

      const job = claim.job;
      const configName = configNameFromTrackedRequest(job.request);
      await jobStore.appendLog(job.id, `Browser smoke fake executor completed ${job.type} for ${configName}.`);
      await completeQualityDecisionJob(jobStore, {
        projectRoot,
        job,
        configName,
        reportSummary: passQualityReportSummary(),
        source: 'browser-smoke-fake-executor',
      });
    },
  };
}

function browserSmokeRuntimeDiagnostics() {
  return {
    diagnostics_version: 'browser-smoke',
    artifact_class: 'runtime_diagnostics',
    inspection_evidence_status: 'not_inspection_evidence',
    readiness_effect: 'no_readiness_change',
    hard_evidence_rule: 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.',
    status: 'ready',
    available: true,
    executable_detected: true,
    probe_status: 'usable',
    platform: process.platform,
    description: 'Browser smoke deterministic runtime stub.',
    source: 'browser-smoke',
    mode: 'stubbed',
    path_style: 'posix',
    executable: '/browser-smoke/freecad',
    python_executable: process.execPath,
    runtime_executable: '/browser-smoke/freecad',
    gui_executable: '',
    checked_candidates: [],
    selected_runtime: {
      summary: 'Browser smoke deterministic runtime stub.',
      source: 'browser-smoke',
      mode: 'stubbed',
      path_style: 'posix',
      executable: '/browser-smoke/freecad',
      bundle_root: '',
      install_root: '',
      runtime_executable: '/browser-smoke/freecad',
      python_executable: process.execPath,
      gui_executable: '',
    },
    detected_runtime_paths: {
      checked_candidates: [],
      selected_candidates: [],
    },
    env_overrides: {
      resolution_order: [],
      values: [],
    },
    version_details: {
      python: {
        executable: process.execPath,
        version: process.version,
        platform: process.platform,
        source: 'browser-smoke',
        error: null,
      },
      freecad: {
        executable: '/browser-smoke/freecad',
        version: 'browser-smoke',
        home_path: null,
        module_path: null,
        source: 'browser-smoke',
        error: null,
      },
    },
    command_classes: {
      diagnostics: [],
      freecad_backed: [],
      plain_python_or_node: [],
      mixed_or_conditional: [],
    },
    capability_map: {},
    warnings: [],
    errors: [],
    support_boundary_note: '',
    next_steps: [],
    remediation: [],
  };
}

const browserSmokeDesignRequests = [];

function browserSmokeStudioModelServiceFactory() {
  const previewId = 'browser-smoke-guided-model';
  const modelPath = join(
    ROOT,
    'docs',
    'examples',
    'quality-pass-bracket',
    'cad',
    'quality_pass_bracket.stl',
  );
  const overview = {
    name: 'quality-pass-bracket',
    mode: 'part',
    part_count: 0,
    shape_count: 1,
    operation_count: 0,
    export_formats: ['step', 'stl'],
    has_drawing: true,
    has_motion: false,
    has_fem: false,
  };
  const validation = {
    warnings: [],
    changed_fields: [],
    deprecated_fields: [],
  };

  return {
    async validateConfigToml() {
      return { config: {}, summary: validation, overview };
    },
    async buildPreview({ buildSettings = {} } = {}) {
      return {
        preview: {
          id: previewId,
          built_at: '2026-07-17T00:00:00.000Z',
          settings: {
            include_step: buildSettings.include_step !== false,
            include_stl: buildSettings.include_stl !== false,
            per_part_stl: buildSettings.per_part_stl !== false,
          },
          overview,
          validation,
          logs: ['Browser smoke guided preview completed.'],
          model: null,
          assembly: null,
          motion_data: null,
          model_asset_url: `/api/studio/model-previews/${previewId}/model`,
        },
      };
    },
    getPreviewModelPath(id) {
      return id === previewId ? modelPath : null;
    },
    getPreviewPartPath() {
      return null;
    },
    async designFromPrompt(description) {
      browserSmokeDesignRequests.push(description);
      return {
        toml: [
          'name = "browser-smoke-ai-draft"',
          '',
          '[[shapes]]',
          'id = "body"',
          'type = "box"',
          'length = 24',
          'width = 18',
          'height = 6',
          '',
        ].join('\n'),
        report: { mechanism_type: 'browser smoke fixture' },
        validation: { summary: validation, overview },
      };
    },
    async dispose() {},
  };
}

const browserSmokeImportRequests = [];

function browserSmokeBootstrapImportServiceFactory() {
  return async ({ model, bom, inspection, quality }) => {
    browserSmokeImportRequests.push({ model, bom, inspection, quality });
    return {
      ok: true,
      session_id: 'browser-smoke-import',
      source: {
        model_path: 'output/imports/browser-smoke-import/source/simple_bracket.step',
        bom_path: null,
        inspection_path: null,
        quality_path: null,
      },
      bootstrap: {
        import_diagnostics: {
          source_model_path: 'output/imports/browser-smoke-import/source/simple_bracket.step',
          file_type: 'step',
          import_kind: 'part',
          body_count: 1,
          unit_assumption: {
            unit: 'mm',
            assumed: true,
            rationale: 'Browser smoke fixture assumption.',
          },
          confidence: {
            level: 'medium',
            score: 0.62,
            rationale: 'Browser smoke fixture confidence.',
          },
        },
        bootstrap_summary: {
          import_kind: 'part',
          body_count: 1,
          unit_system: 'mm',
          review_gate: {
            status: 'review_required',
            correction_required: true,
          },
          dimensions_mm: { x: 40, y: 20, z: 8 },
          feature_summary: { cylinder_count: 2, bolt_circle_count: 0, hotspot_count: 1 },
        },
        bootstrap_warnings: {
          warning_count: 1,
          warnings: ['Browser smoke fixture assumption requires confirmation.'],
        },
        confidence_map: {
          import_bootstrap: {
            overall: {
              level: 'medium',
              score: 0.62,
              rationale: 'Browser smoke fixture confidence.',
            },
          },
        },
        draft_config_toml: 'name = "browser_smoke_import"\n',
        geometry_intelligence: {},
      },
      tracked_review_seed: {
        context_path: 'output/imports/browser-smoke-import/artifacts/engineering_context.json',
        model_path: 'output/imports/browser-smoke-import/source/simple_bracket.step',
        bom_path: null,
        inspection_path: null,
        quality_path: null,
      },
      artifacts: [
        {
          key: 'import_diagnostics',
          path: 'output/imports/browser-smoke-import/artifacts/import_diagnostics.json',
          file_name: 'import_diagnostics.json',
        },
      ],
    };
  };
}

const chromeBinary = findChromeBinary();
if (!chromeBinary) {
  console.log('studio-shell-browser-smoke.test.js: skipped (Chrome not available)');
  process.exit(0);
}

const { server, jobStore } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: JOBS_DIR,
  runtimeDiagnosticsFactory: browserSmokeRuntimeDiagnostics,
  executorFactory: createBrowserSmokeExecutor,
  studioModelServiceFactory: browserSmokeStudioModelServiceFactory,
  bootstrapImportServiceFactory: browserSmokeBootstrapImportServiceFactory,
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
  const seededSystemRecordPath = await jobStore.writeJobFile(
    seededJob.id,
    'artifacts/browser-smoke-runtime-fingerprint.json',
    '{"runtime":"browser-smoke","provenance":"synthetic"}\n'
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
      {
        type: 'runtime.fingerprint',
        path: seededSystemRecordPath,
        label: 'Browser smoke runtime fingerprint',
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
  const stage5bAuditJob = await seedStage5bAuditJob(jobStore, {
    projectRoot: ROOT,
  });
  const seededShortJobId = seededJob.id.slice(0, 8);

  chrome = await launchChrome(chromeBinary);
  cdp = new CdpSession(await openPageTarget(chrome.browserWebSocketUrl));
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });

  const initial = await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
    expectedHash: '',
  });
  const initialShellShape = await cdp.evaluate(studioSnapshotExpression());
  assert.equal(initialShellShape.navCount, 7);
  assert.equal(initialShellShape.coreNavCount, 3);
  assert.equal(initialShellShape.advancedNavCount, 4);
  assert.equal(initialShellShape.homeChoiceCount, 3);
  assert.equal(initialShellShape.homeChoicePrimaryCount, 3);
  assert.equal(initialShellShape.pathname, '/studio/');

  const collapsedNavigationFocus = await cdp.evaluate(`(() => {
    const disclosure = document.getElementById('advanced-work-navigation');
    disclosure.open = false;
    const artifactsLink = document.querySelector('.nav-link[data-route="artifacts"]');
    artifactsLink.focus();
    artifactsLink.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    return {
      focusedRoute: document.activeElement?.dataset?.route || '',
      disclosureOpen: disclosure.open,
    };
  })()`);
  assert.equal(collapsedNavigationFocus.focusedRoute, 'start');
  assert.equal(collapsedNavigationFocus.disclosureOpen, false);

  const primitiveSnapshot = await cdp.evaluate(`(async () => {
    const renderers = await import('/js/studio/renderers.js');
    const host = document.createElement('div');
    host.id = 'beginner-ux-primitive-smoke';
    const stepper = renderers.createTaskStepper({
      steps: [
        { id: 'input', label: 'Choose input', state: 'complete' },
        { id: 'review', label: 'Review action', state: 'current' },
      ],
    });
    const summary = renderers.createActionSummary({
      actionId: 'generate-model',
      title: 'Generate model',
      requiredInputs: ['example.toml'],
      expectedOutputs: ['3D model'],
      launchesFreeCAD: 'yes',
      fileEffects: 'create',
      networkAccess: 'no',
      cost: 'none',
    });
    const result = renderers.createResultCard({
      title: '3D model',
      primaryAction: { label: 'Download', href: '/download/example' },
      menuItems: [
        { label: 'File information', action: 'show-info' },
        { label: 'Download another copy', action: 'download-copy' },
      ],
    });
    host.addEventListener('click', (event) => {
      const item = event.target.closest('[data-menu-item="true"]');
      if (item) host.dataset.activatedAction = item.dataset.action || '';
    });
    host.append(stepper, summary, result);
    document.body.append(host);
    const trigger = result.querySelector('.overflow-menu-trigger');
    trigger.focus();
    return {
      currentStep: stepper.querySelector('[aria-current="step"]')?.dataset?.stepId || '',
      summaryRows: summary.querySelectorAll('.info-row').length,
      resultPrimaryCount: result.querySelectorAll('[data-action-kind="primary"]').length,
      resultPrimaryTag: result.querySelector('[data-action-kind="primary"]')?.tagName || '',
      resultPrimaryHref: result.querySelector('[data-action-kind="primary"]')?.getAttribute('href') || '',
      menuLabel: trigger.getAttribute('aria-label'),
    };
  })()`);
  assert.equal(primitiveSnapshot.currentStep, 'review');
  assert.equal(primitiveSnapshot.summaryRows, 8);
  assert.equal(primitiveSnapshot.resultPrimaryCount, 1);
  assert.equal(primitiveSnapshot.resultPrimaryTag, 'A');
  assert.equal(primitiveSnapshot.resultPrimaryHref, '/download/example');
  assert.equal(primitiveSnapshot.menuLabel, 'More actions for 3D model');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
  });
  assert.equal(await cdp.evaluate(`document.activeElement?.dataset?.action || ''`), 'show-info');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
  });
  assert.equal(await cdp.evaluate(`document.activeElement?.dataset?.action || ''`), 'download-copy');
  await keyboardActivate(cdp, '#beginner-ux-primitive-smoke [data-action="download-copy"]');
  let primitiveMenuKeyboardSnapshot = await cdp.evaluate(`(() => ({
    activatedAction: document.getElementById('beginner-ux-primitive-smoke')?.dataset?.activatedAction || '',
    expanded: document.querySelector('#beginner-ux-primitive-smoke .overflow-menu-trigger')?.getAttribute('aria-expanded') || '',
  }))()`);
  assert.equal(primitiveMenuKeyboardSnapshot.activatedAction, 'download-copy');
  assert.equal(primitiveMenuKeyboardSnapshot.expanded, 'false');
  await cdp.evaluate(`document.querySelector('#beginner-ux-primitive-smoke .overflow-menu-trigger')?.focus()`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38,
  });
  assert.equal(await cdp.evaluate(`document.activeElement?.dataset?.action || ''`), 'download-copy');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  primitiveMenuKeyboardSnapshot = await cdp.evaluate(`(() => {
    const host = document.getElementById('beginner-ux-primitive-smoke');
    const trigger = host?.querySelector('.overflow-menu-trigger');
    const snapshot = {
      expanded: trigger?.getAttribute('aria-expanded') || '',
      focusReturned: document.activeElement === trigger,
    };
    host?.remove();
    return snapshot;
  })()`);
  assert.equal(primitiveMenuKeyboardSnapshot.expanded, 'false');
  assert.equal(primitiveMenuKeyboardSnapshot.focusReturned, true);

  for (const width of [320, 768, 1024, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const responsiveSnapshot = await waitFor(async () => {
      const snapshot = await cdp.evaluate(`(() => {
        const sidebarStyle = getComputedStyle(document.getElementById('studio-sidebar'));
        const toggleStyle = getComputedStyle(document.getElementById('studio-nav-toggle'));
        return {
          innerWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          sidebarPosition: sidebarStyle.position,
          navToggleDisplay: toggleStyle.display,
        };
      })()`);
      assert.equal(snapshot.innerWidth, width);
      assert.equal(snapshot.bodyScrollWidth <= width, true);
      assert.equal(snapshot.documentScrollWidth <= width, true);
      return snapshot;
    });
    if (width <= 768) {
      assert.equal(responsiveSnapshot.sidebarPosition, 'fixed');
      assert.notEqual(responsiveSnapshot.navToggleDisplay, 'none');
    } else {
      assert.notEqual(responsiveSnapshot.sidebarPosition, 'fixed');
      assert.equal(responsiveSnapshot.navToggleDisplay, 'none');
    }
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.evaluate(`document.getElementById('studio-nav-toggle')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('studio-sidebar')?.classList.contains('is-open') || false,
      expanded: document.getElementById('studio-nav-toggle')?.getAttribute('aria-expanded') || '',
      focusedRoute: document.activeElement?.dataset?.route || '',
    }))()`);
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.expanded, 'true');
    assert.equal(snapshot.focusedRoute, 'start');
    return snapshot;
  });
  const mobileFocusContract = await cdp.evaluate(`(() => {
    const sidebar = document.getElementById('studio-sidebar');
    const visibleFocusable = [...sidebar.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter((element) => {
        const closedDisclosure = element.closest('details:not([open])');
        if (closedDisclosure && element.tagName !== 'SUMMARY') return false;
        return element.getClientRects().length > 0;
      });
    visibleFocusable.at(-1)?.focus();
    return {
      firstId: visibleFocusable[0]?.id || '',
      firstRoute: visibleFocusable[0]?.dataset?.route || '',
      lastId: visibleFocusable.at(-1)?.id || '',
      lastRoute: visibleFocusable.at(-1)?.dataset?.route || '',
      focusedId: document.activeElement?.id || '',
      focusedRoute: document.activeElement?.dataset?.route || '',
      mainInert: document.querySelector('.studio-main')?.inert ?? false,
      skipLinkInert: document.querySelector('.skip-link')?.inert ?? false,
    };
  })()`);
  assert.equal(mobileFocusContract.mainInert, true);
  assert.equal(mobileFocusContract.skipLinkInert, true);
  assert.equal(mobileFocusContract.focusedId, mobileFocusContract.lastId);
  assert.equal(mobileFocusContract.focusedRoute, mobileFocusContract.lastRoute);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  const wrappedForwardFocus = await cdp.evaluate(`(() => ({
    id: document.activeElement?.id || '',
    route: document.activeElement?.dataset?.route || '',
  }))()`);
  assert.deepEqual(wrappedForwardFocus, {
    id: mobileFocusContract.firstId,
    route: mobileFocusContract.firstRoute,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    modifiers: 8,
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    modifiers: 8,
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  const wrappedBackwardFocus = await cdp.evaluate(`(() => ({
    id: document.activeElement?.id || '',
    route: document.activeElement?.dataset?.route || '',
  }))()`);
  assert.deepEqual(wrappedBackwardFocus, {
    id: mobileFocusContract.lastId,
    route: mobileFocusContract.lastRoute,
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('studio-sidebar')?.classList.contains('is-open') || false,
      expanded: document.getElementById('studio-nav-toggle')?.getAttribute('aria-expanded') || '',
      activeElementId: document.activeElement?.id || '',
      mainInert: document.querySelector('.studio-main')?.inert ?? true,
      skipLinkInert: document.querySelector('.skip-link')?.inert ?? true,
    }))()`);
    assert.equal(snapshot.open, false);
    assert.equal(snapshot.expanded, 'false');
    assert.equal(snapshot.activeElementId, 'studio-nav-toggle');
    assert.equal(snapshot.mainInert, false);
    assert.equal(snapshot.skipLinkInert, false);
    return snapshot;
  });

  const mobileTargetSnapshot = await cdp.evaluate(`(() => {
    const selectors = [
      '#studio-nav-toggle',
      '#studio-locale-select',
      '[data-start-goal="create-model"] [data-action-kind="primary"]',
      '[data-start-goal="review-cad"] [data-action-kind="primary"]',
      '[data-start-goal="previous-work"] [data-action-kind="primary"]',
    ];
    return selectors.map((selector) => {
      const target = document.querySelector(selector);
      const rect = target?.getBoundingClientRect();
      return { selector, width: rect?.width || 0, height: rect?.height || 0 };
    });
  })()`);
  mobileTargetSnapshot.forEach(({ selector, width, height }) => {
    assert.equal(width >= 44, true, `${selector} width ${width}px is below 44px.`);
    assert.equal(height >= 44, true, `${selector} height ${height}px is below 44px.`);
  });

  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedMotionSnapshot = await cdp.evaluate(`(() => {
    const target = document.querySelector('[data-start-goal="create-model"] [data-action-kind="primary"]');
    const style = getComputedStyle(target);
    return {
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
    };
  })()`);
  assert.equal(reducedMotionSnapshot.matches, true);
  assert.equal(Number.parseFloat(reducedMotionSnapshot.transitionDuration) <= 0.00001, true);
  assert.equal(Number.parseFloat(reducedMotionSnapshot.animationDuration) <= 0.00001, true);
  assert.equal(reducedMotionSnapshot.animationIterationCount, '1');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  for (const drawer of [
    {
      toggleId: 'jobs-toggle',
      closeId: 'jobs-close',
      openKey: 'jobsOpen',
      expandedKey: 'jobsExpanded',
    },
    {
      toggleId: 'log-toggle',
      closeId: 'log-close',
      openKey: 'logOpen',
      expandedKey: 'logExpanded',
    },
  ]) {
    for (const closeMethod of ['button', 'escape']) {
      await cdp.evaluate(`(() => {
        document.getElementById('studio-nav-toggle')?.click();
        const advanced = document.getElementById('advanced-work-navigation');
        if (advanced) advanced.open = true;
      })()`);
      await waitFor(async () => {
        const snapshot = await cdp.evaluate(drawerSnapshotExpression());
        assert.equal(snapshot.sidebarOpen, true);
        assert.equal(snapshot.mainInert, true);
        assert.equal(snapshot.skipLinkInert, true);
        return snapshot;
      });

      await cdp.evaluate(`document.getElementById('${drawer.toggleId}')?.click()`);
      await waitFor(async () => {
        const snapshot = await cdp.evaluate(drawerSnapshotExpression());
        assert.equal(snapshot[drawer.openKey], true);
        assert.equal(snapshot[drawer.expandedKey], 'true');
        assert.equal(snapshot.sidebarOpen, false);
        assert.equal(snapshot.mainInert, false);
        assert.equal(snapshot.skipLinkInert, false);
        assert.equal(snapshot.activeElementId, drawer.closeId);
        return snapshot;
      });

      if (closeMethod === 'button') {
        await cdp.evaluate(`document.getElementById('${drawer.closeId}')?.click()`);
      } else {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
        });
      }
      await waitFor(async () => {
        const snapshot = await cdp.evaluate(drawerSnapshotExpression());
        assert.equal(snapshot[drawer.openKey], false);
        assert.equal(snapshot[drawer.expandedKey], 'false');
        assert.equal(snapshot.activeElementId, 'studio-nav-toggle');
        assert.equal(snapshot.activeElementVisible, true);
        assert.equal(snapshot.activeElementInViewport, true);
        return snapshot;
      });
    }
  }

  await cdp.evaluate(`document.getElementById('studio-nav-toggle')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(snapshot.sidebarOpen, true);
    return snapshot;
  });
  await cdp.evaluate(`document.querySelector('.nav-link[aria-current="page"]')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(snapshot.sidebarOpen, false);
    assert.equal(snapshot.mainInert, false);
    assert.equal(snapshot.skipLinkInert, false);
    assert.equal(snapshot.activeElementId, 'studio-nav-toggle');
    return snapshot;
  });

  await cdp.evaluate(`document.getElementById('studio-nav-toggle')?.click()`);
  await waitFor(async () => {
    const open = await cdp.evaluate(`document.getElementById('studio-sidebar')?.classList.contains('is-open') || false`);
    assert.equal(open, true);
    return open;
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('studio-sidebar')?.classList.contains('is-open') || false,
      mainInert: document.querySelector('.studio-main')?.inert ?? true,
      scrimHidden: document.getElementById('studio-sidebar-scrim')?.hidden ?? false,
      toggleDisplay: getComputedStyle(document.getElementById('studio-nav-toggle')).display,
    }))()`);
    assert.equal(snapshot.open, false);
    assert.equal(snapshot.mainInert, false);
    assert.equal(snapshot.scrimHidden, true);
    assert.equal(snapshot.toggleDisplay, 'none');
    return snapshot;
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 500,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const twoHundredPercentReflowSnapshot = await cdp.evaluate(`(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    homeChoiceCount: document.querySelectorAll('[data-hook="home-start-choices"] [data-start-goal]').length,
  }))()`);
  assert.equal(twoHundredPercentReflowSnapshot.innerWidth, 720);
  assert.equal(twoHundredPercentReflowSnapshot.bodyScrollWidth <= 720, true);
  assert.equal(twoHundredPercentReflowSnapshot.documentScrollWidth <= 720, true);
  assert.equal(twoHundredPercentReflowSnapshot.homeChoiceCount, 3);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

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

  const beginnerHome = await cdp.evaluate(`(() => {
    const root = document.querySelector('.home-workspace');
    const choices = [...document.querySelectorAll('[data-hook="home-start-choices"] [data-start-goal]')];
    return {
      labels: choices.map((choice) => choice.querySelector('h3')?.textContent?.trim() || ''),
      actions: choices.map((choice) => choice.querySelector('[data-action-kind="primary"]')?.dataset?.action || ''),
      text: root?.innerText || '',
    };
  })()`);
  assert.deepEqual(beginnerHome.labels, [
    'Create a new model',
    'Review existing CAD',
    'Open previous work',
  ]);
  assert.deepEqual(beginnerHome.actions, ['go-model', 'go-console', 'go-history']);
  assertExcludesAll(beginnerHome.text, ['tracked', 'artifact', 'manifest', 'Stage 5B']);

  let guidedModelPrimaryActions = 0;
  await keyboardActivate(cdp, '[data-start-goal="create-model"] [data-action="go-model"]');
  await waitForRoute(cdp, 'model', {
    attempts: 50,
    delayMs: 200,
  });
  const guidedSelectInput = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-model-guided-step]:not([hidden])');
      return {
        step: activeStep?.dataset?.modelGuidedStep || '',
        primaryCount: [...(activeStep?.querySelectorAll('[data-action-kind="primary"]') || [])]
          .filter((button) => !button.closest('[hidden]')).length,
        continueDisabled: document.querySelector('[data-hook="guided-continue"]')?.disabled ?? true,
        focusedStep: document.activeElement?.dataset?.modelGuidedStep || '',
        advancedOpen: document.querySelector('[data-hook="model-advanced-tools"]')?.open || false,
        advancedHidden: document.querySelector('[data-hook="model-advanced-content"]')?.hidden ?? false,
        mounted: document.getElementById('workspace-root')?.dataset?.modelWorkspaceMounted === 'true',
        loadError: document.querySelector('[data-hook="workspace-load-error"]')?.textContent?.trim() || '',
        text: activeStep?.innerText || '',
      };
    })()`);
    assert.equal(snapshot.step, 'select_input', JSON.stringify(snapshot));
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.continueDisabled, false);
    assert.equal(snapshot.focusedStep, 'select_input', JSON.stringify(snapshot));
    assert.equal(snapshot.mounted, true, snapshot.loadError || 'Model workspace controller did not mount.');
    return snapshot;
  });
  assert.equal(guidedSelectInput.advancedOpen, false);
  assert.equal(guidedSelectInput.advancedHidden, true);
  assertExcludesAll(guidedSelectInput.text, ['tracked', 'artifact', 'manifest', 'build_settings']);

  await cdp.evaluate(`document.querySelector('[data-hook="model-advanced-tools"] > summary')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.querySelector('[data-hook="model-advanced-tools"]')?.open || false,
      hidden: document.querySelector('[data-hook="model-advanced-content"]')?.hidden ?? true,
      trackedSummaryRows: document.querySelector('[data-action-summary="run-tracked-model-work"]')?.querySelectorAll('.info-row')?.length || 0,
      hasTrackedCreate: Boolean(document.querySelector('[data-action="model-run-tracked-create"]')),
      hasTrackedReport: Boolean(document.querySelector('[data-action="model-run-tracked-report"]')),
      hasLegacyAssistantButton: Boolean(document.querySelector('[data-hook="draft-prompt"]')),
      hasAiStartingMethod: Boolean(document.querySelector('[data-hook="guided-input-method"][value="ai"]')),
    }))()`);
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.hidden, false);
    assert.equal(snapshot.trackedSummaryRows, 8);
    assert.equal(snapshot.hasTrackedCreate, true);
    assert.equal(snapshot.hasTrackedReport, true);
    assert.equal(snapshot.hasLegacyAssistantButton, false);
    assert.equal(snapshot.hasAiStartingMethod, true);
    return snapshot;
  });
  await cdp.evaluate(`document.querySelector('[data-hook="model-advanced-tools"] > summary')?.click()`);
  await waitFor(async () => {
    const hidden = await cdp.evaluate(`document.querySelector('[data-hook="model-advanced-content"]')?.hidden ?? false`);
    assert.equal(hidden, true);
    return hidden;
  });

  await keyboardActivate(cdp, '[data-hook="guided-continue"]');
  guidedModelPrimaryActions += 1;
  const guidedPreflight = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-model-guided-step]:not([hidden])');
      const actionSummary = activeStep?.querySelector('[data-action-summary="generate-model"]');
      return {
        step: activeStep?.dataset?.modelGuidedStep || '',
        primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
        summaryRows: actionSummary?.querySelectorAll('.info-row')?.length || 0,
        generateDisabled: document.querySelector('[data-hook="guided-generate"]')?.disabled ?? true,
        text: actionSummary?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      };
    })()`);
    assert.equal(snapshot.step, 'preflight');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.summaryRows, 8);
    assert.equal(snapshot.generateDisabled, false);
    return snapshot;
  });
  assertIncludesAll(guidedPreflight.text, [
    'Required input',
    'Expected output',
    'Launches FreeCAD',
    'File changes',
    'Network access',
    'External provider',
    'Possible cost',
    'Confirmation required',
  ]);

  await keyboardActivate(cdp, '[data-hook="guided-generate"]');
  guidedModelPrimaryActions += 1;
  const guidedResult = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-model-guided-step]:not([hidden])');
      return {
        step: activeStep?.dataset?.modelGuidedStep || '',
        primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
        summary: document.querySelector('[data-hook="guided-result-summary"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        viewDisabled: document.querySelector('[data-hook="guided-view-result"]')?.disabled ?? false,
      };
    })()`);
    assert.equal(snapshot.step, 'result');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.viewDisabled, false);
    assertIncludesAll(snapshot.summary, [
      'Execution',
      'Completed',
      'Quality',
      'Not available for preview',
      'Primary result',
      '3D model',
    ]);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 200,
  });
  assert.equal(guidedModelPrimaryActions, 2);
  assert.equal(guidedResult.step, 'result');

  await keyboardActivate(cdp, '[data-hook="guided-view-result"]');
  guidedModelPrimaryActions += 1;
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      hidden: document.querySelector('[data-hook="guided-result-inspection"]')?.hidden ?? true,
      focused: document.activeElement?.dataset?.hook || '',
      hasCanvas: Boolean(document.querySelector('[data-hook="guided-result-inspection"] canvas')),
      hasFallback: Boolean(document.querySelector('[data-hook="guided-viewport-unavailable"]')),
    }))()`);
    assert.equal(snapshot.hidden, false);
    assert.equal(snapshot.focused, 'guided-result-inspection');
    assert.equal(snapshot.hasCanvas || snapshot.hasFallback, true);
    return snapshot;
  });
  assert.equal(guidedModelPrimaryActions, 3);

  await cdp.evaluate(`document.querySelector('.nav-link[data-route="start"]')?.click()`);
  await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
  });
  await cdp.evaluate(`document.querySelector('[data-start-goal="create-model"] [data-action="go-model"]')?.click()`);
  await waitForRoute(cdp, 'model', {
    attempts: 50,
    delayMs: 200,
  });
  await waitFor(async () => {
    const step = await cdp.evaluate(`document.querySelector('[data-model-guided-step]:not([hidden])')?.dataset?.modelGuidedStep || ''`);
    assert.equal(step, 'select_input');
    return step;
  });

  assert.equal(browserSmokeDesignRequests.length, 0);
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[data-hook="guided-input-method"][value="ai"]');
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const aiPreflight = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-model-guided-step]:not([hidden])');
      const summary = document.querySelector('[data-action-summary="create-ai-draft"]');
      const visiblePrimary = [...(activeStep?.querySelectorAll('[data-action-kind="primary"]') || [])]
        .filter((button) => !button.closest('[hidden]'));
      return {
        methodCount: document.querySelectorAll('[data-hook="guided-input-method"]').length,
        requestStageHidden: document.querySelector('[data-hook="guided-ai-request-stage"]')?.hidden ?? true,
        reviewStageHidden: document.querySelector('[data-hook="guided-ai-review-stage"]')?.hidden ?? false,
        summaryRows: summary?.querySelectorAll('.info-row')?.length || 0,
        specificRows: document.querySelector('[data-hook="guided-ai-request-stage"] > .info-grid')?.querySelectorAll('.info-row')?.length || 0,
        createDisabled: document.querySelector('[data-hook="ai-create-draft"]')?.disabled ?? false,
        visiblePrimaryCount: visiblePrimary.length,
        text: document.querySelector('[data-hook="guided-ai-panel"]')?.innerText || '',
      };
    })()`);
    assert.equal(snapshot.methodCount, 3);
    assert.equal(snapshot.requestStageHidden, false);
    assert.equal(snapshot.reviewStageHidden, true);
    assert.equal(snapshot.summaryRows, 8);
    assert.equal(snapshot.specificRows, 3);
    assert.equal(snapshot.createDisabled, true);
    assert.equal(snapshot.visiblePrimaryCount, 1);
    return snapshot;
  });
  assertIncludesAll(aiPreflight.text, [
    'OpenAI API',
    'The design description entered here',
    'No — local files are not sent or changed',
    'API KEY REQUIRED',
    'Possible, based on API usage',
    'A TOML draft that requires human review',
    'Create AI draft',
  ]);
  assert.equal(browserSmokeDesignRequests.length, 0, 'selecting AI must not send the external request');

  for (const width of [320, 768, 1024, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: width <= 768 ? 900 : 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(async () => {
      const snapshot = await cdp.evaluate(`(() => ({
        width: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        panelWidth: document.querySelector('[data-hook="guided-ai-panel"]')?.getBoundingClientRect().width || 0,
      }))()`);
      assert.equal(snapshot.width, width);
      assert.equal(snapshot.bodyScrollWidth <= width, true);
      assert.equal(snapshot.documentScrollWidth <= width, true);
      assert.equal(snapshot.panelWidth <= width, true);
      return snapshot;
    });
  }

  await cdp.evaluate(`(() => {
    const prompt = document.querySelector('[data-hook="assistant-textarea"]');
    if (!prompt) return false;
    prompt.value = 'Create a small fixture bracket with one box body.';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(async () => {
    const disabled = await cdp.evaluate(`document.querySelector('[data-hook="ai-create-draft"]')?.disabled ?? true`);
    assert.equal(disabled, false);
    return disabled;
  });
  assert.equal(browserSmokeDesignRequests.length, 0, 'typing the description must not send the request');

  await cdp.evaluate(`(() => {
    const button = document.querySelector('[data-hook="ai-create-draft"]');
    button?.click();
    button?.click();
  })()`);
  const aiReview = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      step: document.querySelector('[data-model-guided-step]:not([hidden])')?.dataset?.modelGuidedStep || '',
      requestStageHidden: document.querySelector('[data-hook="guided-ai-request-stage"]')?.hidden ?? false,
      reviewStageHidden: document.querySelector('[data-hook="guided-ai-review-stage"]')?.hidden ?? true,
      draft: document.querySelector('[data-hook="ai-draft-textarea"]')?.value || '',
      generateDisabled: document.querySelector('[data-hook="guided-generate"]')?.disabled ?? false,
      advancedBuildDisabled: document.querySelector('[data-hook="build-button"]')?.disabled ?? false,
      text: document.querySelector('[data-hook="guided-ai-review-stage"]')?.innerText || '',
    }))()`);
    assert.equal(snapshot.step, 'select_input');
    assert.equal(snapshot.requestStageHidden, true);
    assert.equal(snapshot.reviewStageHidden, false);
    assert.match(snapshot.draft, /browser-smoke-ai-draft/);
    assert.equal(snapshot.generateDisabled, true);
    assert.equal(snapshot.advancedBuildDisabled, true);
    return snapshot;
  }, { attempts: 50, delayMs: 100 });
  assertIncludesAll(aiReview.text, [
    'Review the AI draft before generation',
    'AI output can be incomplete or incorrect',
    'Validate reviewed draft',
  ]);
  assert.deepEqual(browserSmokeDesignRequests, [
    'Create a small fixture bracket with one box body.',
  ], 'explicit confirmation must send exactly one current request');

  await cdp.evaluate(`document.querySelector('[data-hook="ai-validate-draft"]')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      step: document.querySelector('[data-model-guided-step]:not([hidden])')?.dataset?.modelGuidedStep || '',
      generateDisabled: document.querySelector('[data-hook="guided-generate"]')?.disabled ?? true,
      input: document.querySelector('[data-action-summary="generate-model"] .info-value')?.textContent?.trim() || '',
    }))()`);
    assert.equal(snapshot.step, 'preflight');
    assert.equal(snapshot.generateDisabled, false);
    assert.equal(snapshot.input, 'Prompt-generated TOML');
    return snapshot;
  }, { attempts: 50, delayMs: 100 });
  assert.equal(browserSmokeDesignRequests.length, 1, 'local validation must not repeat the external request');

  await cdp.evaluate(`document.querySelector('[data-hook="guided-back"]')?.click()`);
  await waitFor(async () => {
    const step = await cdp.evaluate(`document.querySelector('[data-model-guided-step]:not([hidden])')?.dataset?.modelGuidedStep || ''`);
    assert.equal(step, 'select_input');
    return step;
  });
  await cdp.evaluate(`(() => {
    const draft = document.querySelector('[data-hook="ai-draft-textarea"]');
    if (!draft) return false;
    draft.value += '\\n# reviewed edit';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      validateLabel: document.querySelector('[data-hook="ai-validate-draft"]')?.textContent?.trim() || '',
      phase: document.querySelector('[data-hook="guided-ai-panel"]')?.dataset?.phase || '',
      reviewRequired: document.querySelector('[data-hook="guided-ai-panel"]')?.dataset?.reviewRequired || '',
      generateDisabled: document.querySelector('[data-hook="guided-generate"]')?.disabled ?? false,
      advancedBuildDisabled: document.querySelector('[data-hook="build-button"]')?.disabled ?? false,
    }))()`);
    assert.equal(snapshot.phase, 'review');
    assert.equal(snapshot.reviewRequired, 'true');
    assert.equal(snapshot.validateLabel, 'Validate reviewed draft');
    assert.equal(snapshot.generateDisabled, true);
    assert.equal(snapshot.advancedBuildDisabled, true);
    return snapshot;
  });
  assert.equal(browserSmokeDesignRequests.length, 1, 'editing the draft must not send or repeat an external request');

  await cdp.evaluate(`document.querySelector('.nav-link[data-route="start"]')?.click()`);
  await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
  });

  await cdp.evaluate(`document.querySelector('[data-start-goal="review-cad"] [data-action="go-console"]')?.click()`);
  await waitForRoute(cdp, 'console', {
    attempts: 50,
    delayMs: 200,
  });
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      focusedStep: document.activeElement?.dataset?.importGuidedStep || '',
      advancedOpen: document.querySelector('[data-hook="import-advanced-tools"]')?.open || false,
      primaryCount: document.querySelector('[data-import-guided-step]:not([hidden])')?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
    }))()`);
    assert.equal(snapshot.focusedStep, 'select_file');
    assert.equal(snapshot.advancedOpen, false);
    assert.equal(snapshot.primaryCount, 1);
    return snapshot;
  });

  const guardedImportStepFocus = await cdp.evaluate(`(() => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const callbacks = [];
    window.requestAnimationFrame = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    try {
      document.querySelector('[data-action="preview-import-bootstrap"]')?.click();
      const immediateStep = document.activeElement?.dataset?.importGuidedStep || '';
      document.getElementById('studio-locale-select')?.focus();
      let flushedCallbacks = 0;
      while (callbacks.length > 0 && flushedCallbacks < 10) {
        callbacks.shift()(performance.now());
        flushedCallbacks += 1;
      }
      return {
        immediateStep,
        activeElementId: document.activeElement?.id || '',
        flushedCallbacks,
      };
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  })()`);
  assert.equal(guardedImportStepFocus.immediateStep, 'select_file');
  assert.equal(guardedImportStepFocus.activeElementId, 'studio-locale-select');
  assert.equal(guardedImportStepFocus.flushedCallbacks, 2);

  await cdp.evaluate(`document.querySelector('[data-hook="import-advanced-tools"] > summary')?.click()`);
  await waitFor(async () => {
    const open = await cdp.evaluate(`document.querySelector('[data-hook="import-advanced-tools"]')?.open || false`);
    assert.equal(open, true);
    return open;
  });

  const canonicalPackageSnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(canonicalPackageSnapshotExpression());
    assert.equal(snapshot.count, 5);
    assert.deepEqual(snapshot.slugs, [
      'quality-pass-bracket',
      'plate-with-holes',
      'motor-mount',
      'controller-housing-eol',
      'hinge-block',
    ]);
    assertIncludesAll(snapshot.text, [
      'quality-pass-bracket',
      'hinge-block',
      'needs_more_evidence',
      'hold_for_evidence_completion',
      'missing inspection_evidence',
      'Release bundle presence does not mean production-ready',
      'Quality and drawing outputs are generated control metadata and do not satisfy inspection_evidence',
    ]);
    assert.deepEqual(snapshot.readinessActions.map((entry) => entry.action), [
      'preview-canonical-artifact',
      'copy-canonical-artifact-path',
    ]);
    assert.deepEqual(snapshot.releaseBundleActions.map((entry) => entry.action), [
      'copy-canonical-artifact-path',
    ]);
    assert.equal(snapshot.releaseBundleActions.some((entry) => entry.tag === 'a'), false);
    assert.equal(snapshot.releaseBundleActions.some((entry) => entry.download), false);
    assert.equal(snapshot.releaseBundleActions.some((entry) => /preview|download|open/i.test(entry.action)), false);
    assert.equal(snapshot.releaseBundleText.includes('release_bundle.zip'), true);
    assert.equal(snapshot.releaseBundleText.includes('Preview'), false);
    assert.equal(snapshot.releaseBundleText.includes('Download'), false);
    assert.equal(snapshot.releaseBundleText.includes('Open'), false);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(canonicalPackageSnapshot.slugs.includes('hinge-block'), true);
  assert.equal(canonicalPackageSnapshot.layout.viewportWidth, 1440);
  assert.equal(canonicalPackageSnapshot.layout.hostInsideConsoleColumn, false);
  assert.equal(canonicalPackageSnapshot.layout.packageGridWidth >= 950, true);
  assert.equal(canonicalPackageSnapshot.layout.cardWidth >= 460, true);
  assert.equal(canonicalPackageSnapshot.layout.artifactLabelWidth >= 120, true);
  assert.equal(canonicalPackageSnapshot.layout.artifactPathWidth >= 260, true);
  assert.equal(canonicalPackageSnapshot.layout.packageGridOverflows, false);
  assert.equal(canonicalPackageSnapshot.layout.cardOverflows, false);

  await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.canonical-package-card')]
      .find((entry) => entry.querySelector('.eyebrow')?.textContent?.trim() === 'quality-pass-bracket');
    const ref = [...(card?.querySelectorAll('.canonical-artifact-ref') || [])]
      .find((entry) => entry.textContent.includes('readiness_report.json'));
    ref?.querySelector('[data-action="preview-canonical-artifact"]')?.click();
  })()`);
  const canonicalPreviewSnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(canonicalPreviewSnapshotExpression());
    assert.equal(snapshot.title, 'Readiness report');
    assertIncludesAll(snapshot.text, [
      'Canonical artifact preview',
      'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      'Content kind',
      'json',
    ]);
    assertIncludesAll(snapshot.content, [
      '"readiness_summary"',
      '"needs_more_evidence"',
      '"inspection_evidence"',
    ]);
    assert.equal(snapshot.links.length, 0);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(canonicalPreviewSnapshot.content.includes('release_bundle.zip'), false);
  assert.equal(canonicalPreviewSnapshot.layout.panelWidth >= 430, true);
  assert.equal(canonicalPreviewSnapshot.layout.contentWidth >= 380, true);
  assert.equal(canonicalPreviewSnapshot.layout.panelOverflows, false);
  assert.equal(
    canonicalPreviewSnapshot.layout.previewCardHeight >= canonicalPreviewSnapshot.layout.peerCardHeight + 250,
    true
  );
  await cdp.evaluate(`document.querySelector('[data-action="close-canonical-artifact-preview"]')?.click()`);

  const firstRunCard = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const card = document.querySelector('[data-hook="verified-bracket-card"]');
      const button = document.querySelector('[data-action="load-verified-bracket"]');
      const modelButton = document.querySelector('[data-action="go-model"]');
      const trackedPath = document.querySelector('[data-hook="start-tracked-primary-path"]');
      return {
        text: card?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        trackedText: trackedPath?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        loadButtonDisabled: button?.disabled ?? true,
        hasModelButton: Boolean(modelButton),
      };
    })()`);
    assert.equal(snapshot.text.includes('Start with a verified bracket'), true);
    assert.equal(snapshot.text.includes('quality_pass_bracket'), true);
    assert.equal(snapshot.trackedText.includes('Run tracked create first'), true);
    assert.equal(snapshot.trackedText.includes('Run tracked report'), true);
    assert.equal(snapshot.loadButtonDisabled, false);
    assert.equal(snapshot.hasModelButton, true);
    return snapshot;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(firstRunCard.text.includes('Stage 3 quality target'), true);

  const localFirstWorkflows = await cdp.evaluate(`(() => {
    const root = document.querySelector('[data-hook="local-first-workflows"]');
    const cards = [...(root?.querySelectorAll('[data-workflow]') || [])];
    const resultCard = root?.querySelector('[data-workflow="receive-results"]');
    return {
      count: cards.length,
      titles: cards.map((card) => card.querySelector('.action-title')?.textContent || ''),
      resultText: resultCard?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      resultFileInputs: resultCard?.querySelectorAll('input[type="file"]').length || 0,
      resultActions: [...(resultCard?.querySelectorAll('[data-action]') || [])].map((node) => node.dataset.action),
    };
  })()`);
  assert.equal(localFirstWorkflows.count, 3);
  assert.deepEqual(localFirstWorkflows.titles, [
    'Create or Import & Review',
    'Compare Revisions & Plan Inspection',
    'Receive Results & Continue Onboarding',
  ]);
  assert.equal(localFirstWorkflows.resultText.includes('fcad inspection-result-normalize'), true);
  assert.equal(localFirstWorkflows.resultText.includes('CLI-only raw bytes'), true);
  assert.equal(localFirstWorkflows.resultFileInputs, 0);
  assert.deepEqual(localFirstWorkflows.resultActions, []);

  await cdp.evaluate(`document.querySelector('[data-action="load-verified-bracket"]')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      activeRoute: document.querySelector('.nav-link[aria-current="page"]')?.dataset?.route || '',
      selectedExample: document.querySelector('[data-action="select-example"]')?.value || '',
      hasModelButton: Boolean(document.querySelector('[data-action="go-model"]')),
      trackedText: document.querySelector('[data-hook="start-tracked-primary-path"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      hasTrackedCreate: Boolean(document.querySelector('[data-action="start-run-tracked-create"]')),
      hasTrackedReport: Boolean(document.querySelector('[data-action="start-run-tracked-report"]')),
      trackedCreateDisabled: document.querySelector('[data-action="start-run-tracked-create"]')?.disabled ?? true,
      trackedReportDisabled: document.querySelector('[data-action="start-run-tracked-report"]')?.disabled ?? true,
    }))()`);
    assert.equal(snapshot.activeRoute, 'console');
    assert.equal(snapshot.selectedExample, 'quality_pass_bracket');
    assert.equal(snapshot.hasModelButton, true);
    assert.equal(snapshot.trackedText.includes('tracked create'), true);
    assert.equal(snapshot.hasTrackedCreate, true);
    assert.equal(snapshot.hasTrackedReport, true);
    assert.equal(snapshot.trackedCreateDisabled, false);
    assert.equal(snapshot.trackedReportDisabled, false);
    return snapshot;
  }, {
    attempts: 50,
    delayMs: 150,
  });

  await cdp.evaluate(`document.querySelector('[data-action="start-run-tracked-report"]')?.click()`);
  const completionNotice = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const host = document.getElementById('completion-notice-host');
      const actionSnapshot = (label) => {
        const button = [...(host?.querySelectorAll('button[data-action]') || [])]
          .find((entry) => entry.textContent.trim() === label);
        return {
          action: button?.dataset?.action || '',
          jobId: button?.dataset?.jobId || '',
          route: button?.dataset?.route || '',
        };
      };
      return {
        hidden: host?.hidden ?? true,
        text: host?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        tone: host?.querySelector('.completion-notice')?.dataset?.tone || '',
        openArtifacts: actionSnapshot('Open Artifacts'),
        dismiss: actionSnapshot('Dismiss'),
      };
    })()`);
    assert.equal(snapshot.hidden, false);
    assert.equal(snapshot.tone, 'ok');
    assert.equal(snapshot.text.includes('Tracked report completed'), true);
    assert.equal(snapshot.text.includes('Job succeeded'), true);
    assert.equal(snapshot.text.includes('Quality passed'), true);
    assert.equal(snapshot.text.includes('Ready Yes'), true);
    assert.equal(snapshot.text.includes('Open Artifacts to inspect generated files and quality outputs.'), true);
    assert.equal(snapshot.openArtifacts.action, 'open-job');
    assert.equal(snapshot.openArtifacts.route, 'artifacts');
    assert.equal(snapshot.openArtifacts.jobId.length > 0, true);
    assert.equal(snapshot.dismiss.action, 'dismiss-completion-notice');
    assert.equal(snapshot.dismiss.jobId, snapshot.openArtifacts.jobId);
    return snapshot;
  }, {
    attempts: 80,
    delayMs: 150,
  });

  const completionNoticeIdempotence = await cdp.evaluate(`(async () => {
    const host = document.getElementById('completion-notice-host');
    const initialNotice = host?.firstElementChild || null;
    let mutationCount = 0;
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
    });
    observer.observe(host, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const localeSelect = document.getElementById('studio-locale-select');
    localeSelect.value = document.documentElement.lang;
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    return {
      mutationCount,
      sameNoticeNode: host?.firstElementChild === initialNotice,
    };
  })()`);
  assert.equal(completionNoticeIdempotence.sameNoticeNode, true);
  assert.equal(completionNoticeIdempotence.mutationCount, 0);

  await cdp.evaluate(`(() => {
    const host = document.getElementById('completion-notice-host');
    const button = [...(host?.querySelectorAll('button[data-action="open-job"]') || [])]
      .find((entry) => entry.textContent.trim() === 'Open Artifacts');
    button?.click();
  })()`);
  await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#artifacts?job=${completionNotice.openArtifacts.jobId}`,
  });

  await cdp.evaluate(`document.querySelector('.nav-link[data-route="artifacts"]')?.click()`);
  await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#artifacts?job=${completionNotice.openArtifacts.jobId}`,
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

  async function selectArtifactCardByText(expectedText) {
    await waitFor(async () => {
      const clicked = await cdp.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.artifact-card')];
        const card = cards.find((entry) => entry.textContent.includes(${JSON.stringify(expectedText)}));
        const button = card?.querySelector('[data-action="artifacts-select-artifact"]');
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
  }

  async function waitForArtifactPreview(expectedText) {
    return waitFor(async () => {
      const preview = await cdp.evaluate(`(() => ({
        hidden: document.querySelector('[data-hook="artifacts-detail-preview"]')?.hidden ?? true,
        text: document.querySelector('[data-hook="artifacts-detail-preview"]')?.textContent || '',
      }))()`);
      assert.equal(preview.hidden, false);
      assert.equal(preview.text.includes(expectedText), true);
      return preview.text;
    }, {
      attempts: 60,
      delayMs: 150,
    });
  }

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#review` });
  await waitForRoute(cdp, 'review', {
    attempts: 50,
    delayMs: 200,
  });
  const defaultReviewSummary = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const summary = document.querySelector('[data-hook="review-beginner-summary"]');
      const advanced = document.querySelector('[data-hook="review-advanced-tools"]');
      const advancedNavigation = document.getElementById('advanced-work-navigation');
      return {
        text: summary?.innerText?.replace(/\\s+/g, ' ').trim() || '',
        primaryCount: summary?.querySelectorAll('[data-action-kind="primary"]').length || 0,
        advancedOpen: advanced?.open ?? true,
        advancedNavigationOpen: advancedNavigation?.open ?? false,
        storedMode: localStorage.getItem('studio_experience_mode'),
        preferenceChecked: document.getElementById('advanced-mode-toggle')?.checked ?? true,
        expertActionCount: advanced?.querySelectorAll('[data-action]').length || 0,
      };
    })()`);
    assertIncludesAll(snapshot.text.toLowerCase(), [
      'current decision',
      'issues that need attention',
      'recommended next step',
      'supporting files',
    ]);
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.advancedOpen, false);
    assert.equal(snapshot.advancedNavigationOpen, true);
    assert.equal(snapshot.preferenceChecked, false);
    assert.equal(snapshot.expertActionCount > 0, true);
    return snapshot;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(defaultReviewSummary.storedMode, null);
  assertExcludesAll(defaultReviewSummary.text.toLowerCase(), [
    'tracked',
    'artifact',
    'manifest',
    'stage 5b',
    'readiness',
    'evidence',
    'gate',
  ]);
  for (const width of [320, 768, 1024, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: width <= 768 ? 900 : 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const reviewLayout = await waitFor(async () => {
      const snapshot = await cdp.evaluate(`(() => ({
        width: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        summaryWidth: document.querySelector('[data-hook="review-beginner-summary"]')?.getBoundingClientRect().width || 0,
        advancedOpen: document.querySelector('[data-hook="review-advanced-tools"]')?.open ?? true,
      }))()`);
      assert.equal(snapshot.width, width);
      assert.equal(snapshot.bodyScrollWidth <= width, true);
      assert.equal(snapshot.documentScrollWidth <= width, true);
      assert.equal(snapshot.summaryWidth <= width, true);
      assert.equal(snapshot.advancedOpen, false);
      return snapshot;
    });
    assert.equal(reviewLayout.summaryWidth > 0, true);
  }
  await cdp.evaluate(`document.querySelector('[data-hook="review-advanced-tools"]').open = true`);
  const stage5bLauncher = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const launcher = document.querySelector('[data-hook="review-intake-launcher"]');
      const runAudit = launcher?.querySelector('[data-action="run-stage5b-audit"]');
      const latestAudit = launcher?.querySelector('[data-action="open-latest-stage5b-audit"]');
      return {
        text: launcher?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        runAuditVisible: Boolean(runAudit),
        latestAuditText: latestAudit?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        latestAuditJobId: latestAudit?.dataset?.jobId || '',
        latestAuditDisabled: latestAudit?.disabled ?? true,
      };
    })()`);
    assert.equal(snapshot.runAuditVisible, true);
    assert.equal(snapshot.latestAuditDisabled, false);
    assert.equal(snapshot.latestAuditJobId, stage5bAuditJob.id);
    assertIncludesAll(snapshot.text, [
      'Run the Stage 5B audit bundle without human-entered measurements',
      'Run audit',
      'Open latest audit',
      'Run intake',
      'Run dry-run',
    ]);
    assert.equal(snapshot.text.includes('/Users/'), false);
    assert.equal(snapshot.text.includes('/tmp/'), false);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(stage5bLauncher.latestAuditText, 'Open latest audit');

  await cdp.evaluate(`document.querySelector('[data-action="open-latest-stage5b-audit"]')?.click()`);
  await waitForRoute(cdp, 'review', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#review?job=${stage5bAuditJob.id}`,
  });
  const stage5bReviewSummary = await waitFor(async () => {
    const snapshot = await cdp.evaluate(jobContextExpression('review-job-summary'));
    assert.equal(snapshot.text.includes(stage5bAuditJob.id.slice(0, 8)), true);
    assert.equal(snapshot.text.includes('/Users/'), false);
    assert.equal(snapshot.text.includes('/tmp/'), false);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(stage5bReviewSummary.text.includes('stage5b-evidence-audit'), true);

  const stage5bCards = await waitFor(async () => {
    const snapshot = await cdp.evaluate(jobContextExpression('review-cards'));
    assertIncludesAll(snapshot.text, [
      'Stage 5B evidence audit',
      'Readiness held',
      'No promotion can run',
      'Stage 5B promotion dry-run',
      'Promotion held',
      'Stage 5B inspection evidence intake',
      'No accepted genuine candidate',
    ]);
    assert.equal(snapshot.text.includes('Future promotion plan ready'), false);
    assert.equal(snapshot.text.includes('Genuine inspection evidence found'), false);
    return snapshot;
  }, {
    attempts: 80,
    delayMs: 150,
  });
  assert.equal(stage5bCards.text.includes('needs_more_evidence / hold_for_evidence_completion'), true);
  const stage5bBeginnerSummary = await waitFor(async () => {
    const text = await cdp.evaluate(`document.querySelector('[data-hook="review-beginner-summary"]')?.innerText?.replace(/\\s+/g, ' ').trim() || ''`);
    assertIncludesAll(text.toLowerCase(), [
      'needs attention',
      'additional checks need attention',
      'recommended next step',
    ]);
    return text;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assertExcludesAll(stage5bBeginnerSummary.toLowerCase(), [
    'tracked',
    'artifact',
    'manifest',
    'stage 5b',
    'readiness',
    'evidence',
    'gate',
  ]);

  await cdp.evaluate(`document.querySelector('[data-action="review-select-card"][data-card-id="stage5b-evidence-audit"]')?.click()`);
  const stage5bAuditDetail = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const summary = document.querySelector('[data-hook="review-detail-summary"]');
      const rows = Object.fromEntries([...summary.querySelectorAll('.info-row')].map((row) => [
        row.querySelector('.info-label')?.textContent?.trim() || '',
        row.querySelector('.info-value')?.textContent?.trim() || '',
      ]));
      return {
        text: summary?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        rows,
      };
    })()`);
    assert.equal(snapshot.rows['Genuine candidate found'], 'No');
    assert.equal(snapshot.rows['Inspection evidence attached'], 'No');
    assert.equal(snapshot.rows['Promotion can run'], 'No');
    assert.equal(snapshot.rows['Attachment-ready candidates'], '0');
    assert.equal(snapshot.rows['Canonical artifacts mutated'], 'No');
    assertIncludesAll(snapshot.rows['Package readiness states'], [
      'quality-pass-bracket: needs_more_evidence / hold_for_evidence_completion',
      'hinge-block: needs_more_evidence / hold_for_evidence_completion',
    ]);
    assertIncludesAll(snapshot.rows['Readiness-held truth'], [
      'No genuine completed inspection evidence is available',
      'needs_more_evidence / hold_for_evidence_completion',
    ]);
    assertIncludesAll(snapshot.rows['Evidence boundary'], [
      'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence',
    ]);
    assert.equal(snapshot.text.includes('Yes'), false);
    return snapshot;
  }, {
    attempts: 80,
    delayMs: 150,
  });
  assert.equal(stage5bAuditDetail.text.includes('release bundles'), true);
  assert.equal(stage5bAuditDetail.text.includes('screenshots'), true);
  assert.equal(stage5bAuditDetail.text.includes('fixtures'), true);

  const stage5bAuditActions = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const actions = document.querySelector('[data-hook="review-detail-actions"]');
      return {
        text: actions?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        links: [...(actions?.querySelectorAll('a') || [])].map((entry) => ({
          text: entry.textContent?.replace(/\\s+/g, ' ').trim() || '',
          href: entry.getAttribute('href') || '',
          download: entry.hasAttribute('download'),
        })),
      };
    })()`);
    assert.equal(snapshot.links.length >= 2, true);
    assert.equal(snapshot.links.some((entry) => entry.text.includes('Open source artifact')), true);
    assert.equal(snapshot.links.some((entry) => entry.text.includes('Download')), true);
    assert.equal(snapshot.links.every((entry) => entry.href.includes(`/artifacts/${stage5bAuditJob.id}/`)), true);
    assert.equal(snapshot.links.some((entry) => entry.href.includes('/Users/')), false);
    assert.equal(snapshot.links.some((entry) => entry.href.includes('/tmp/')), false);
    assert.equal(snapshot.links.some((entry) => entry.href.includes('release_bundle.zip')), false);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(stage5bAuditActions.text.includes('Download'), true);

  await cdp.evaluate(`document.querySelector('[data-hook="review-tab-provenance"]')?.click()`);
  const stage5bAuditProvenance = await waitFor(async () => {
    const snapshot = await cdp.evaluate(jobContextExpression('review-detail-provenance'));
    assertIncludesAll(snapshot.text, [
      'Stage 5B audit bundles are review/control artifacts only, not package inspection evidence.',
      'Preview is limited to registered tracked job artifact routes; no arbitrary local file path is opened.',
    ]);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(stage5bAuditProvenance.text.includes('/Users/'), false);
  assert.equal(stage5bAuditProvenance.text.includes('/tmp/'), false);

  const stage5bArtifactBoundary = await cdp.evaluate(`(async () => {
    const artifactsResponse = await fetch('/jobs/${stage5bAuditJob.id}/artifacts');
    const artifactsPayload = await artifactsResponse.json();
    const auditArtifact = artifactsPayload.artifacts.find((artifact) => artifact.type === 'stage5b.evidence-audit-manifest');
    const releaseLike = artifactsPayload.artifacts.filter((artifact) => /release_bundle\\.zip/i.test(artifact.file_name || ''));
    const openResponse = await fetch(auditArtifact.links.open);
    const openText = await openResponse.text();
    const arbitraryResponse = await fetch('/artifacts/${stage5bAuditJob.id}/%2Ftmp%2Ffake-readiness-report.json');
    const releaseResponse = await fetch('/artifacts/${stage5bAuditJob.id}/release_bundle.zip');
    return {
      artifactCount: artifactsPayload.artifacts.length,
      auditOpen: auditArtifact.links.open,
      auditApi: auditArtifact.links.api,
      auditDownload: auditArtifact.links.download,
      auditCanOpen: auditArtifact.capabilities.can_open,
      openStatus: openResponse.status,
      openHasBoundary: openText.includes('Only genuine completed physical/supplier/lab/QA inspection records'),
      openHasNoEvidenceTruth: openText.includes('"genuine_inspection_evidence_found": false'),
      arbitraryStatus: arbitraryResponse.status,
      releaseStatus: releaseResponse.status,
      releaseLikeCount: releaseLike.length,
      serialized: JSON.stringify(artifactsPayload),
    };
  })()`);
  assert.equal(stage5bArtifactBoundary.artifactCount >= 4, true);
  assert.equal(stage5bArtifactBoundary.auditCanOpen, true);
  assert.equal(stage5bArtifactBoundary.auditOpen.startsWith(`/artifacts/${stage5bAuditJob.id}/`), true);
  assert.equal(stage5bArtifactBoundary.auditApi.startsWith(`/jobs/${stage5bAuditJob.id}/artifacts/`), true);
  assert.equal(stage5bArtifactBoundary.auditDownload.startsWith(`/artifacts/${stage5bAuditJob.id}/`), true);
  assert.equal(stage5bArtifactBoundary.openStatus, 200);
  assert.equal(stage5bArtifactBoundary.openHasBoundary, true);
  assert.equal(stage5bArtifactBoundary.openHasNoEvidenceTruth, true);
  assert.equal(stage5bArtifactBoundary.arbitraryStatus, 404);
  assert.equal(stage5bArtifactBoundary.releaseStatus, 404);
  assert.equal(stage5bArtifactBoundary.releaseLikeCount, 0);
  assert.equal(stage5bArtifactBoundary.serialized.includes('/Users/'), false);
  assert.equal(stage5bArtifactBoundary.serialized.includes('/tmp/'), false);

  await cdp.evaluate(`document.querySelector('[data-action="review-select-card"][data-card-id="inspection-promotion-dry-run"]')?.click()`);
  const stage5bDryRunDetail = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const summary = document.querySelector('[data-hook="review-detail-summary"]');
      const rows = Object.fromEntries([...summary.querySelectorAll('.info-row')].map((row) => [
        row.querySelector('.info-label')?.textContent?.trim() || '',
        row.querySelector('.info-value')?.textContent?.trim() || '',
      ]));
      return {
        text: summary?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        rows,
      };
    })()`);
    assert.equal(snapshot.rows['Attachment ready'], 'No');
    assert.equal(snapshot.rows['Match confidence'], 'none');
    assert.equal(snapshot.rows['Canonical artifacts mutated'], 'No');
    assertIncludesAll(snapshot.rows['Readiness expectation'], [
      'needs_more_evidence / hold_for_evidence_completion',
    ]);
    assertIncludesAll(snapshot.rows['Evidence boundary'], [
      'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence',
    ]);
    assert.equal(snapshot.text.includes('Promotion can runYes'), false);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(stage5bDryRunDetail.text.includes('No promotion can run'), true);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#artifacts` });
  await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
  });

  await openQualityJobFromTimeline(passQualityJob.id);
  const passDashboardText = await waitForDashboardText('Quality Dashboard - quality_pass_bracket');
  const passPageText = await cdp.evaluate(pageTextExpression());
  assertIncludesAll(passPageText, [
    'quality_pass_bracket',
    'Job succeeded',
    'Quality passed',
    'Ready Yes',
  ]);
  const generatedFilesSnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-hook="artifacts-generated-files"]');
      const card = panel?.closest('.studio-card');
      const rowSnapshot = (kind) => {
        const row = panel?.querySelector(\`[data-artifact-kind="\${kind}"]\`);
        return {
          text: row?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          actions: [...(row?.querySelectorAll('a.action-button') || [])].map((entry) => entry.textContent.trim()),
          hrefs: [...(row?.querySelectorAll('a.action-button') || [])].map((entry) => entry.getAttribute('href') || ''),
        };
      };
      return {
        text: card?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        step: rowSnapshot('step'),
        stl: rowSnapshot('stl'),
        pdf: rowSnapshot('pdf-report'),
        reportSummary: rowSnapshot('report-summary'),
        createQuality: rowSnapshot('create-quality'),
        drawingQuality: rowSnapshot('drawing-quality'),
        manifest: rowSnapshot('manifest'),
      };
    })()`);
    assertIncludesAll(snapshot.text, [
      'Your generated files',
      'Download or inspect the main outputs from this run.',
      'CAD exports',
      'STEP model',
      'quality_pass_bracket.step',
      'STL mesh',
      'quality_pass_bracket.stl',
      'Reports',
      'PDF report',
      'quality_pass_bracket_report.pdf',
      'Report summary',
      'quality_pass_bracket_report_summary.json',
      'Quality outputs',
      'Create quality JSON',
      'quality_pass_bracket_create_quality.json',
      'Drawing quality JSON',
      'quality_pass_bracket_drawing_quality.json',
      'Manifest',
      'quality_pass_bracket_manifest.json',
    ]);
    assert.deepEqual(snapshot.step.actions, ['Open', 'Download']);
    assert.deepEqual(snapshot.stl.actions, ['Download']);
    assert.deepEqual(snapshot.pdf.actions, ['Open', 'Download']);
    assert.deepEqual(snapshot.reportSummary.actions, ['Open', 'Download']);
    assert.deepEqual(snapshot.createQuality.actions, ['Open', 'Download']);
    assert.deepEqual(snapshot.drawingQuality.actions, ['Open', 'Download']);
    assert.deepEqual(snapshot.manifest.actions, ['Open', 'Download']);
    assert.equal(snapshot.step.hrefs.every((href) => href.includes('/artifacts/')), true);
    assert.equal(snapshot.stl.hrefs.every((href) => href.includes('/download')), true);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assert.equal(generatedFilesSnapshot.text.includes('All artifacts'), false);
  assertIncludesAll(passDashboardText, [
    'Quality Dashboard - quality_pass_bracket',
    'Engineering Quality',
    'PASS',
    'Generated geometry',
    'Shape validity',
    'Bounding box',
    'Volume',
    'Left hole diameter',
    'Left hole center',
    'Right hole diameter',
    'Right hole center',
    'STEP reimport',
    'STEP shape validity',
    'STEP volume delta',
    'STEP bounding box',
    'Expected',
    'Actual',
    'Tolerance',
    'Source',
    'generated_shape_geometry',
    'reimported_step_geometry',
    'Drawing semantic QA',
    'Overall drawing quality',
    'Pass',
    'Critical feature coverage',
    '100% traceability coverage',
    'Missing required dimensions',
    'None',
    'Manufacturing review impact',
    'Does not block manufacturing review',
    'Control output',
    'Drawing quality JSON',
    'Extracted drawing semantics',
    'Available',
    'Advisory',
    'Required drawing semantics were confirmed from extracted output.',
    'Status',
    'Impact',
    'Dimensions',
    '2 / 2 extracted',
    'Notes',
    '1 / 1 extracted',
    'Views',
    '2 / 2 extracted',
    'Evidence',
    'extracted_drawing_semantics_json',
    'Manufacturing readiness',
    'Manufacturing readiness is still determined by required Geometry / Drawing / DFM gates.',
    'Suggested drawing actions (0)',
    'No additional drawing actions were suggested from extracted output.',
    'Open output - Extracted drawing semantics JSON',
    'All required quality gates passed',
    'No manufacturing blockers',
    'Ready for manufacturing review: Yes',
  ]);
  assertExcludesAll(passDashboardText, ['in_memory', 'not_available', 'What to do next', 'Run tracked create again after the fix']);
  await selectArtifactCardByText('quality_pass_bracket_extracted_drawing_semantics.json');
  const passExtractedPreviewText = await waitForArtifactPreview('"artifact_type": "extracted_drawing_semantics"');
  assertIncludesAll(passExtractedPreviewText, ['"status": "available"', '"required_dimensions_extracted": 2']);

  await openQualityJobFromTimeline(failQualityJob.id);
  const failDashboardText = await waitForDashboardText('Quality Dashboard - ks_bracket');
  const failPageText = await cdp.evaluate(pageTextExpression());
  assertIncludesAll(failPageText, [
    'ks_bracket',
    'Execution',
    'Completed',
    'Quality',
    'Failed',
  ]);
  assertIncludesAll(failDashboardText, [
    'Quality Dashboard - ks_bracket',
    'Engineering Quality',
    'FAIL',
    'Problems found',
    'Left hole center',
    '[30, 30] mm',
    '[32, 30] mm',
    '2 mm',
    '0.2 mm',
    'generated_shape_geometry',
    'reimported_step_geometry',
    'What to do next',
    'Left hole center is outside tolerance.',
    'A hole position that misses the target center',
    'Inspect the create-quality JSON',
    'Check hole center, placement',
    'Run tracked create again after the fix.',
    'Run tracked report again when report artifacts need to reflect the new result.',
    'Open Artifacts and confirm Engineering Quality becomes PASS.',
    'Inspect quality output',
    'Open generated files',
    'Open Model workspace',
    'Drawing semantic QA',
    'Overall drawing quality',
    'Fail',
    'Missing required dimensions',
    'HOLE_DIA',
    'Missing notes/views',
    'View: section A-A, Note: material callout',
    'Manufacturing review impact',
    'Blocks manufacturing review',
    'Extracted drawing semantics',
    'Partial',
    'Some drawing requirements could not be confirmed from extracted output.',
    'Status',
    'Impact',
    'Hole diameter',
    'Unknown',
    'Low-confidence candidate: 16',
    'Dimensions',
    '1 extracted, 2 unknown',
    'Notes',
    '1 extracted, 1 unknown',
    'Views',
    '4 / 4 extracted',
    'Evidence',
    'extracted_drawing_semantics_json',
    'Some extracted drawing text could not be matched to required intent.',
    'Suggested drawing actions (3)',
    'Showing 3 deduped suggested actions.',
    'These suggestions are advisory unless an explicit enforceable drawing policy applies.',
    'Dimensions (1)',
    'Review required dimension Hole diameter because extracted evidence is low-confidence.',
    'Requirement: HOLE_DIA',
    'Feature: hole_001',
    'Evidence source: Extracted drawing semantics',
    'Evidence path: required_dimensions.HOLE_DIA.candidate_matches[0].confidence',
    'Review',
    'Low confidence',
    'Notes (1)',
    'Add or verify the required note Material callout.',
    'Mapping & labels (1)',
    'Improve intent aliases or drawing labels for unmatched extracted dimensions.',
    'Info',
    'Unmatched',
    'Unmatched extracted dimensions',
    '60',
    'Unmatched extracted notes',
    'Tolerance: KS B 0401 m',
    'Manufacturing readiness',
    'Still blocked by required Geometry / Drawing / DFM gates.',
    'Open output - Extracted drawing semantics JSON',
    'Open output - Drawing quality JSON',
    'Manufacturing review blocked by',
    'Ready for manufacturing review: No',
  ]);
  assertExcludesAll(failDashboardText, ['in_memory', 'not_available']);
  const failPageTextAfterSwitch = await cdp.evaluate(pageTextExpression());
  assertExcludesAll(failPageTextAfterSwitch, [
    'quality_pass_bracket_extracted_drawing_semantics.json',
    'quality_pass_bracket_drawing_planner.json',
    'quality_pass_bracket_drawing_quality.json',
    'quality_pass_bracket_create_quality.json',
    'quality_pass_bracket_drawing.svg',
    'quality_pass_bracket_report.pdf',
    'quality_pass_bracket.step',
    'quality_pass_bracket.stl',
  ]);
  const previewAfterSwitch = await cdp.evaluate(`(() => ({
    hidden: document.querySelector('[data-hook="artifacts-detail-preview"]')?.hidden ?? true,
    text: document.querySelector('[data-hook="artifacts-detail-preview"]')?.textContent || '',
  }))()`);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket_drawing.svg'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket_report.pdf'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket.step'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket.stl'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket_create_quality'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket_extracted_drawing_semantics'), false);
  assert.equal(previewAfterSwitch.text.includes('quality_pass_bracket_drawing_planner'), false);

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

  const defaultAdvancedPreference = await cdp.evaluate(`(() => ({
    open: document.getElementById('advanced-work-navigation')?.open ?? true,
    checked: document.getElementById('advanced-mode-toggle')?.checked ?? true,
    stored: localStorage.getItem('studio_experience_mode'),
  }))()`);
  assert.equal(defaultAdvancedPreference.open, false);
  assert.equal(defaultAdvancedPreference.checked, false);
  assert.equal(defaultAdvancedPreference.stored, null);

  await cdp.evaluate(`(() => {
    const navigation = document.getElementById('advanced-work-navigation');
    if (navigation) navigation.open = true;
    document.getElementById('advanced-mode-toggle')?.click();
  })()`);
  const savedAdvancedPreference = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('advanced-work-navigation')?.open ?? false,
      checked: document.getElementById('advanced-mode-toggle')?.checked ?? false,
      stored: localStorage.getItem('studio_experience_mode'),
    }))()`);
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.checked, true);
    assert.equal(snapshot.stored, 'advanced');
    return snapshot;
  });
  assert.equal(savedAdvancedPreference.stored, 'advanced');

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitForRoute(cdp, 'start', {
    attempts: 60,
    delayMs: 150,
  });
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('advanced-work-navigation')?.open ?? false,
      checked: document.getElementById('advanced-mode-toggle')?.checked ?? false,
      stored: localStorage.getItem('studio_experience_mode'),
    }))()`);
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.checked, true);
    assert.equal(snapshot.stored, 'advanced');
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });

  await cdp.evaluate(`document.getElementById('advanced-mode-toggle')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('advanced-work-navigation')?.open ?? true,
      checked: document.getElementById('advanced-mode-toggle')?.checked ?? true,
      stored: localStorage.getItem('studio_experience_mode'),
    }))()`);
    assert.equal(snapshot.open, false);
    assert.equal(snapshot.checked, false);
    assert.equal(snapshot.stored, 'default');
    return snapshot;
  });

  await cdp.evaluate(`document.getElementById('advanced-mode-toggle')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('advanced-work-navigation')?.open ?? false,
      checked: document.getElementById('advanced-mode-toggle')?.checked ?? false,
      stored: localStorage.getItem('studio_experience_mode'),
    }))()`);
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.checked, true);
    assert.equal(snapshot.stored, 'advanced');
    return snapshot;
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

  await cdp.evaluate(`document.getElementById('advanced-mode-toggle')?.click()`);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => ({
      open: document.getElementById('advanced-work-navigation')?.open ?? true,
      checked: document.getElementById('advanced-mode-toggle')?.checked ?? true,
      stored: localStorage.getItem('studio_experience_mode'),
    }))()`);
    assert.equal(snapshot.open, false);
    assert.equal(snapshot.checked, false);
    assert.equal(snapshot.stored, 'default');
    return snapshot;
  });

  const initialLocale = await cdp.evaluate(localeSnapshotExpression());
  assert.equal(['en', 'ko'].includes(initialLocale.lang), true);
  assert.equal(initialLocale.selectedLocale, initialLocale.lang);
  assert.equal(initialLocale.activeRoute, 'start');
  const alternateLocale = initialLocale.lang === 'ko' ? 'en' : 'ko';
  const forcedLocale = 'ko';
  const forcedLocaleLabels = {
    start: '홈',
    history: '실행 내역',
    artifacts: '결과 파일',
    console: '검토 입력 도구',
    review: '검토 및 준비 상태',
    model: '모델 설정 편집',
    drawing: '도면 편집',
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

  const forcedLocaleRoutes = ['history', 'artifacts', 'console', 'review', 'model', 'drawing', 'start'];
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
    if (route === 'model') {
      const modelReadiness = await cdp.evaluate(modelRouteReadinessExpression());
      assert.equal(/Model|모델/.test(modelReadiness.text), true);
      assert.equal(/Runtime (?:pending|ready)|런타임/.test(modelReadiness.text), true);
      assert.equal(/API (?:pending|connected)|API (?:대기|연결됨)/.test(modelReadiness.text), true);
      assert.equal(modelReadiness.hasValidate, true);
      assert.equal(modelReadiness.hasBuild, true);
      assert.equal(modelReadiness.hasTrackedCreate, true);
      assert.equal(modelReadiness.hasTrackedReport, true);
    }
    if (route === 'drawing') {
      const drawingReadiness = await cdp.evaluate(drawingRouteReadinessExpression());
      assert.equal(/Drawing|도면/.test(drawingReadiness.text), true);
      assert.equal(/Runtime pending|런타임 대기|Runtime detected|런타임 감지됨|Runtime ready|런타임 준비됨/.test(drawingReadiness.text), true);
      assert.equal(/No drawing yet|아직 도면/.test(drawingReadiness.text), true);
      assert.equal(/Sheet pending|시트 준비/.test(drawingReadiness.text), true);
      assert.equal(drawingReadiness.hasPreview, true);
      assert.equal(drawingReadiness.hasTrackedDraw, true);
      assert.equal(drawingReadiness.hasStage, true);
    }
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
  const koreanReviewOverview = await waitFor(async () => {
    const text = await cdp.evaluate(`document.querySelector('[data-hook="review-beginner-summary"]')?.innerText?.replace(/\\s+/g, ' ').trim() || ''`);
    assertIncludesAll(text, ['현재 결정', '확인이 필요한 문제', '권장 다음 단계', '보조 파일']);
    return text;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(koreanReviewOverview.includes('Current decision'), false);
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
  const koreanResultFilesSnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const root = document.querySelector('.result-files-workspace');
      const cards = [...root?.querySelectorAll('.result-card') || []];
      return {
        header: root?.querySelector('.section-header')?.innerText || '',
        summary: root?.querySelector('[data-hook="artifacts-result-summary"]')?.innerText || '',
        groupText: root?.querySelector('[data-hook="artifacts-result-groups"]')?.innerText || '',
        cardActionCounts: cards.map((card) => ({
          primary: card.querySelectorAll('[data-action-kind="primary"]').length,
          overflow: card.querySelectorAll('.overflow-menu-trigger').length,
        })),
        advancedOpen: root?.querySelector('[data-hook="artifacts-advanced-tools"]')?.open || false,
        systemOpen: root?.querySelector('[data-result-group="system"]')?.open || false,
      };
    })()`);
    assert.equal(snapshot.summary.includes('browser_smoke_seed'), true);
    assert.equal(snapshot.cardActionCounts.length > 0, true);
    return snapshot;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.equal(koreanResultFilesSnapshot.header.includes('결과 파일'), true);
  assertIncludesAll(koreanResultFilesSnapshot.summary, ['실행', '완료', '품질', '결과 없음']);
  assert.equal(koreanResultFilesSnapshot.cardActionCounts.every((card) => card.primary === 1 && card.overflow === 1), true);
  assert.equal(koreanResultFilesSnapshot.advancedOpen, false);
  assert.equal(koreanResultFilesSnapshot.systemOpen, false);
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

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    if (!localeSelect) return false;
    localeSelect.value = 'en';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const englishArtifactsSnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const root = document.querySelector('.artifacts-dashboard');
      const header = root?.querySelector('.section-header');
      const generated = document.querySelector('[data-hook="artifacts-generated-files"]')?.closest('.studio-card');
      const quality = document.querySelector('[data-hook="artifacts-quality-dashboard"]');
      const actions = document.querySelector('[data-hook="artifacts-detail-actions"]');
      const resultSummary = document.querySelector('[data-hook="artifacts-result-summary"]');
      const advanced = document.querySelector('[data-hook="artifacts-advanced-tools"]');
      return {
        lang: document.documentElement.lang || '',
        text: root?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        headerText: header?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        generatedText: generated?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        actionText: actions?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        resultSummaryText: resultSummary?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        advancedOpen: advanced?.open || false,
      };
    })()`);
    assert.equal(snapshot.lang, 'en');
    assert.equal(snapshot.headerText.includes('Result files'), true);
    assertIncludesAll(snapshot.resultSummaryText, ['Main result from this run', 'Execution', 'Completed', 'Quality']);
    assert.equal(snapshot.generatedText.includes('Your generated files'), true);
    assert.equal(snapshot.actionText.includes('Download'), true);
    assert.equal(snapshot.advancedOpen, false);
    return snapshot;
  }, {
    attempts: 50,
    delayMs: 150,
  });
  assert.doesNotMatch(englishArtifactsSnapshot.headerText, /[가-힣]/);
  assert.doesNotMatch(englishArtifactsSnapshot.generatedText, /[가-힣]/);
  assert.doesNotMatch(englishArtifactsSnapshot.actionText, /[가-힣]/);

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#start` });
  await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
  });

  await keyboardActivate(cdp, '[data-start-goal="previous-work"] [data-action="go-history"]');
  await waitForRoute(cdp, 'history', {
    attempts: 50,
    delayMs: 200,
  });
  const historySnapshot = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const root = document.querySelector('.run-history-workspace');
      const cards = [...root?.querySelectorAll('[data-history-job-id]') || []];
      const seeded = root?.querySelector('[data-history-job-id="${seededJob.id}"]');
      return {
        text: root?.innerText || '',
        count: cards.length,
        contracts: cards.map((card) => ({
          primary: card.querySelectorAll('[data-action-kind="primary"]').length,
          overflow: card.querySelectorAll('.overflow-menu-trigger').length,
        })),
        seededText: seeded?.innerText || '',
      };
    })()`);
    assert.equal(snapshot.count > 0, true);
    assert.equal(snapshot.seededText.length > 0, true);
    return snapshot;
  });
  assertIncludesAll(historySnapshot.seededText, ['Execution: Completed', 'Quality: Not available', 'Open results']);
  assert.match(historySnapshot.seededText, /(ago|now)/);
  assert.equal(historySnapshot.contracts.every((card) => card.primary === 1 && card.overflow === 1), true);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const historyCardSelector = `[data-history-job-id="${seededJob.id}"]`;
  const historyOverflowTriggerSelector = `${historyCardSelector} .overflow-menu-trigger`;
  const historyRunInformationSelector = `${historyCardSelector} [data-action="open-jobs-center"]`;
  await cdp.evaluate(`document.querySelector(${JSON.stringify(historyOverflowTriggerSelector)})
    ?.scrollIntoView({ block: 'center' })`);
  await keyboardActivate(cdp, historyOverflowTriggerSelector);
  assert.equal(
    await cdp.evaluate(`document.querySelector(${JSON.stringify(historyRunInformationSelector)})?.textContent?.trim()`),
    'Run information'
  );
  await keyboardActivate(cdp, historyRunInformationSelector);
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(drawerSnapshotExpression());
    assert.equal(snapshot.jobsOpen, true);
    assert.equal(snapshot.jobsExpanded, 'true');
    assert.equal(snapshot.activeElementId, 'jobs-close');
    return snapshot;
  });
  await keyboardActivate(cdp, '#jobs-close');
  await waitFor(async () => {
    const snapshot = await cdp.evaluate(drawerSnapshotExpression());
    const focusReturned = await cdp.evaluate(`document.activeElement
      === document.querySelector(${JSON.stringify(historyOverflowTriggerSelector)})`);
    assert.equal(snapshot.jobsOpen, false);
    assert.equal(focusReturned, true);
    assert.equal(snapshot.activeElementVisible, true);
    assert.equal(snapshot.activeElementInViewport, true);
    return snapshot;
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  let previousWorkPrimaryActions = 0;
  await keyboardActivate(cdp, `[data-history-job-id="${seededJob.id}"] [data-action-kind="primary"]`);
  previousWorkPrimaryActions += 1;
  await waitForRoute(cdp, 'artifacts', {
    attempts: 50,
    delayMs: 200,
    expectedHash: `#artifacts?job=${seededJob.id}`,
  });
  const previousWorkResult = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const summary = document.querySelector('[data-hook="artifacts-result-summary"]');
      const groups = document.querySelector('[data-hook="artifacts-result-groups"]');
      const advanced = document.querySelector('[data-hook="artifacts-advanced-tools"]');
      const system = document.querySelector('[data-result-group="system"]');
      const card = summary?.querySelector('[data-primary-result="true"]');
      const root = document.querySelector('.result-files-workspace');
      return {
        visibleText: root?.innerText || '',
        summaryText: summary?.textContent || '',
        groupText: groups?.textContent || '',
        primaryCount: card?.querySelectorAll('[data-action-kind="primary"]').length || 0,
        overflowCount: card?.querySelectorAll('.overflow-menu-trigger').length || 0,
        advancedOpen: advanced?.open || false,
        systemExists: Boolean(system),
        systemOpen: system?.open || false,
      };
    })()`);
    assert.equal(snapshot.summaryText.includes('browser_smoke_seed'), true);
    assert.equal(snapshot.primaryCount, 1);
    return snapshot;
  });
  assertIncludesAll(previousWorkResult.summaryText, ['Execution', 'Completed', 'Quality', 'Not available', 'Other result files']);
  assertIncludesAll(previousWorkResult.groupText, ['Quality and review', 'System records']);
  assert.equal(previousWorkResult.overflowCount, 1);
  assert.equal(previousWorkResult.advancedOpen, false);
  assert.equal(previousWorkResult.systemExists, true);
  assert.equal(previousWorkResult.systemOpen, false);
  assertExcludesAll(previousWorkResult.visibleText, ['artifact', 'Artifact', 'manifest', 'Manifest', 'tracked', 'Tracked', seededShortJobId]);

  await keyboardActivate(cdp, '[data-primary-result="true"] [data-action-kind="primary"]');
  previousWorkPrimaryActions += 1;
  const primaryResultView = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const title = document.querySelector('[data-hook="artifacts-selected-title"]');
      const viewer = document.querySelector('[data-hook="artifacts-detail-viewer"]');
      return {
        title: title?.textContent || '',
        viewerText: viewer?.innerText || '',
        focused: document.activeElement === title,
      };
    })()`);
    assert.equal(snapshot.focused, true);
    assert.equal(snapshot.viewerText.length > 0, true);
    return snapshot;
  });
  assert.equal(primaryResultView.title, 'Report');
  assert.equal(previousWorkPrimaryActions, 2);

  for (const width of [320, 768, 1024, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(async () => {
      const snapshot = await cdp.evaluate(`(() => ({
        innerWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        resultCardCount: document.querySelectorAll('.result-files-workspace .result-card').length,
      }))()`);
      assert.equal(snapshot.innerWidth, width);
      assert.equal(snapshot.bodyScrollWidth <= width, true);
      assert.equal(snapshot.documentScrollWidth <= width, true);
      assert.equal(snapshot.resultCardCount > 0, true);
      return snapshot;
    });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send('Page.navigate', { url: `${baseUrl}/studio/#start` });
  await waitForRoute(cdp, 'start', {
    attempts: 50,
    delayMs: 200,
  });

  let guidedImportPrimaryActions = 0;
  await keyboardActivate(cdp, '[data-start-goal="review-cad"] [data-action="go-console"]');
  await waitForRoute(cdp, 'console', {
    attempts: 50,
    delayMs: 200,
  });
  const guidedImportSelect = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-import-guided-step]:not([hidden])');
      const actionSummary = activeStep?.querySelector('[data-action-summary="check-imported-cad"]');
      return {
        step: activeStep?.dataset?.importGuidedStep || '',
        primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
        summaryRows: actionSummary?.querySelectorAll('.info-row')?.length || 0,
        advancedOpen: document.querySelector('[data-hook="import-advanced-tools"]')?.open || false,
        text: activeStep?.innerText || '',
      };
    })()`);
    assert.equal(snapshot.step, 'select_file');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.summaryRows, 8);
    assert.equal(snapshot.advancedOpen, false);
    return snapshot;
  });
  assertIncludesAll(guidedImportSelect.text, ['32 MiB']);
  assertExcludesAll(guidedImportSelect.text, ['tracked', 'artifact', 'manifest', 'Stage 5B', 'bootstrap']);

  const oversizedImportDispatch = await cdp.evaluate(`(() => {
    const input = document.getElementById('guided-import-model-file');
    if (!(input instanceof HTMLInputElement)) return { dispatched: false, size: 0 };
    const file = new File(['x'], 'oversized.step', { type: 'application/step' });
    Object.defineProperty(file, 'size', { configurable: true, value: (32 * 1024 * 1024) + 1 });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    delete input.files;
    return { dispatched: true, size: file.size };
  })()`);
  assert.deepEqual(oversizedImportDispatch, {
    dispatched: true,
    size: (32 * 1024 * 1024) + 1,
  });

  const importErrorSnapshot = () => `(() => {
    const activeStep = document.querySelector('[data-import-guided-step]:not([hidden])');
    return {
      lang: document.documentElement.lang || '',
      step: activeStep?.dataset?.importGuidedStep || '',
      primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
      message: activeStep?.querySelector('.inline-status-message')?.textContent?.trim() || '',
    };
  })()`;
  let oversizedImportError = await waitFor(async () => {
    const snapshot = await cdp.evaluate(importErrorSnapshot());
    assert.equal(snapshot.lang, 'en');
    assert.equal(snapshot.step, 'select_file');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(
      snapshot.message,
      'This file is 32.1 MiB, which exceeds the 32 MiB local upload limit. Use a project-relative path for larger files.'
    );
    return snapshot;
  });

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    localeSelect.value = 'ko';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  oversizedImportError = await waitFor(async () => {
    const snapshot = await cdp.evaluate(importErrorSnapshot());
    assert.equal(snapshot.lang, 'ko');
    assert.equal(snapshot.step, 'select_file');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(
      snapshot.message,
      '이 파일은 32.1 MiB로, 로컬 업로드 한도인 32 MiB보다 큽니다. 더 큰 파일은 프로젝트 상대경로를 사용하세요.'
    );
    return snapshot;
  });

  await cdp.evaluate(`(() => {
    const localeSelect = document.getElementById('studio-locale-select');
    localeSelect.value = 'en';
    localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  oversizedImportError = await waitFor(async () => {
    const snapshot = await cdp.evaluate(importErrorSnapshot());
    assert.equal(snapshot.lang, 'en');
    assert.equal(snapshot.step, 'select_file');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(
      snapshot.message,
      'This file is 32.1 MiB, which exceeds the 32 MiB local upload limit. Use a project-relative path for larger files.'
    );
    return snapshot;
  });
  assert.equal(oversizedImportError.message.includes('이 파일은'), false);

  await keyboardActivate(cdp, '[data-hook="guided-import-choose"]');
  guidedImportPrimaryActions += 1;
  const documentNode = await cdp.send('DOM.getDocument');
  const fileInputNode = await cdp.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#guided-import-model-file',
  });
  assert.equal(fileInputNode.nodeId > 0, true);
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: fileInputNode.nodeId,
    files: [join(ROOT, 'tests', 'fixtures', 'imports', 'simple_bracket.step')],
  });

  const guidedImportConfirm = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-import-guided-step]:not([hidden])');
      const actionSummary = activeStep?.querySelector('[data-action-summary="start-imported-cad-review"]');
      const technicalDetails = [...(activeStep?.querySelectorAll('details') || [])]
        .find((details) => details.textContent.includes('Technical import details'));
      return {
        step: activeStep?.dataset?.importGuidedStep || '',
        primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
        summaryRows: actionSummary?.querySelectorAll('.info-row')?.length || 0,
        startDisabled: document.querySelector('[data-hook="guided-import-start-review"]')?.disabled ?? true,
        detailsOpen: technicalDetails?.open || false,
        focusedStep: document.activeElement?.dataset?.importGuidedStep || '',
        text: activeStep?.innerText?.replace(/\\s+/g, ' ').trim() || '',
      };
    })()`);
    assert.equal(snapshot.step, 'confirm');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.summaryRows, 8);
    assert.equal(snapshot.startDisabled, false);
    assert.equal(snapshot.detailsOpen, false);
    assert.equal(snapshot.focusedStep, 'confirm');
    assertIncludesAll(snapshot.text, ['FILE', 'Can be read', 'ASSUMPTIONS', '3 need confirmation', 'REVIEW', 'Ready to begin']);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 150,
  });
  assertExcludesAll(guidedImportConfirm.text, ['tracked', 'artifact', 'manifest', 'Stage 5B', 'bootstrap']);
  assert.equal(browserSmokeImportRequests.length > 0, true);
  assert.equal(browserSmokeImportRequests.at(-1).model.name, 'simple_bracket.step');
  assert.equal(typeof browserSmokeImportRequests.at(-1).model.content_base64, 'string');
  assert.equal(browserSmokeImportRequests.at(-1).model.content_base64.length > 0, true);

  await keyboardActivate(cdp, '[data-hook="guided-import-start-review"]');
  guidedImportPrimaryActions += 1;
  const guidedImportResult = await waitFor(async () => {
    const snapshot = await cdp.evaluate(`(() => {
      const activeStep = document.querySelector('[data-import-guided-step]:not([hidden])');
      return {
        step: activeStep?.dataset?.importGuidedStep || '',
        primaryCount: activeStep?.querySelectorAll('[data-action-kind="primary"]')?.length || 0,
        viewDisabled: document.querySelector('[data-hook="guided-import-view-result"]')?.disabled ?? true,
        focusedStep: document.activeElement?.dataset?.importGuidedStep || '',
        text: activeStep?.innerText?.replace(/\\s+/g, ' ').trim() || '',
      };
    })()`);
    assert.equal(snapshot.step, 'result');
    assert.equal(snapshot.primaryCount, 1);
    assert.equal(snapshot.viewDisabled, false);
    assert.equal(snapshot.focusedStep, 'result');
    assertIncludesAll(snapshot.text, [
      'EXECUTION',
      'QUALITY',
      'PRIMARY RESULT',
      'CURRENT DECISION',
      'ISSUES THAT NEED ATTENTION',
      'RECOMMENDED NEXT STEP',
      'View review result',
    ]);
    return snapshot;
  }, {
    attempts: 60,
    delayMs: 200,
  });
  assert.equal(guidedImportResult.step, 'result');
  assert.equal(guidedImportPrimaryActions, 2);

  const guidedImportJobId = await cdp.evaluate(`document.querySelector('[data-hook="guided-import-view-result"]')?.dataset?.jobId || ''`);
  assert.equal(guidedImportJobId.length > 0, true);
  await keyboardActivate(cdp, '[data-hook="guided-import-view-result"]');
  guidedImportPrimaryActions += 1;
  await waitForRoute(cdp, 'review', {
    attempts: 60,
    delayMs: 200,
    expectedHash: `#review?job=${guidedImportJobId}`,
  });
  assert.equal(guidedImportPrimaryActions, 3);

  const blockingLogs = cdp.logs.filter((entry) => (
    entry.source === 'network'
      && entry.level === 'error'
      && /\/js\/(?:studio-shell\.js|studio\/workspaces\.js|i18n\/index\.js)/.test(`${entry.url || ''} ${entry.text || ''}`)
  ));
  assert.deepEqual(blockingLogs, [], blockingLogs.map(summarizeLog).join('\n'));

  const consoleDiagnostics = cdp.logs.filter((entry) => (
    ['warning', 'error'].includes(entry.level)
      && entry.source !== 'network'
      && !isExpectedHeadlessWebGlWarning(entry)
      && (
        String(entry.url || '').includes(baseUrl)
        || /\/js\/(?:studio|i18n|app)\//.test(`${entry.url || ''} ${entry.text || ''}`)
      )
  ));
  assert.deepEqual(consoleDiagnostics, [], consoleDiagnostics.map(summarizeLog).join('\n'));

  const localExceptions = cdp.exceptions.filter((details) => (
    String(details.url || '').includes(baseUrl)
      || String(details.exception?.description || '').includes('/js/studio')
      || String(details.exception?.description || '').includes('/js/i18n')
      || String(details.exception?.description || '').includes('/js/app')
  ));
  assert.deepEqual(localExceptions, [], localExceptions.map(summarizeException).join('\n'));

  console.log('studio-shell-browser-smoke.test.js: ok');
} finally {
  await cdp?.close().catch(() => {});
  chrome?.child.kill('SIGKILL');
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(TMP_ROOT, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
