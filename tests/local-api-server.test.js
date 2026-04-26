import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildImportBootstrapOptions } from '../public/js/studio/import-bootstrap-options.js';
import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-root-'));
const jobsDir = join(tmpRoot, 'jobs');
const PRIVATE_CONFIG_PATH = join(tmpRoot, 'private-source-config.toml');
const PRIVATE_RESULT_PATH = join(tmpRoot, 'nested', 'private-report.json');
const BOOTSTRAP_SESSION_ID = 'bootstrap-session-bridge-test';
const BOOTSTRAP_SESSION_DIR = join(ROOT, 'output', 'imports', BOOTSTRAP_SESSION_ID);
const BOOTSTRAP_SOURCE_MODEL_PATH = join(BOOTSTRAP_SESSION_DIR, 'source', 'simple_bracket.step');
const BOOTSTRAP_ENGINEERING_CONTEXT_PATH = join(BOOTSTRAP_SESSION_DIR, 'artifacts', 'engineering_context.json');
const BOOTSTRAP_DRAFT_CONFIG_PATH = join(BOOTSTRAP_SESSION_DIR, 'artifacts', 'bootstrap_draft_config.toml');
const PREVIEW_DRAFT_CONFIG_TOML = 'name = "bootstrap_preview"\n[import]\nsource_step = "tests/fixtures/imports/simple_bracket.step"\n';
const bootstrapCalls = [];

function assertNoLeakedPathStrings(payload, blocked = []) {
  const serialized = JSON.stringify(payload);
  blocked.filter(Boolean).forEach((value) => {
    assert.equal(serialized.includes(String(value)), false, `Payload leaked path-like value: ${value}`);
  });
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function waitFor(assertion, { attempts = 10, delayMs = 50 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw lastError;
}

function seedBootstrapTrackedReviewContext() {
  mkdirSync(join(BOOTSTRAP_SESSION_DIR, 'source'), { recursive: true });
  mkdirSync(join(BOOTSTRAP_SESSION_DIR, 'artifacts'), { recursive: true });
  writeFileSync(
    BOOTSTRAP_SOURCE_MODEL_PATH,
    readFileSync(join(ROOT, 'tests', 'fixtures', 'imports', 'simple_bracket.step'))
  );
  writeFileSync(BOOTSTRAP_DRAFT_CONFIG_PATH, PREVIEW_DRAFT_CONFIG_TOML);
  writeFileSync(BOOTSTRAP_ENGINEERING_CONTEXT_PATH, JSON.stringify({
    metadata: {
      created_at: '2026-04-03T00:00:00Z',
      warnings: [],
    },
    part: {
      name: 'bootstrap-preview-part',
    },
    geometry_source: {
      path: `output/imports/${BOOTSTRAP_SESSION_ID}/source/simple_bracket.step`,
      file_type: 'step',
      bootstrap: {
        draft_config_path: `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/bootstrap_draft_config.toml`,
        preview_source: 'import-bootstrap-preview',
      },
      import_diagnostics: {
        import_kind: 'part',
        body_count: 1,
        unit_assumption: {
          unit: 'mm',
          assumed: true,
          rationale: 'Fixture assumption.',
        },
      },
    },
    bootstrap: {
      draft_config_path: `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/bootstrap_draft_config.toml`,
      warnings: ['Fixture warning'],
    },
  }, null, 2));
}

const { server, jobStore } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir,
  bootstrapImportServiceFactory: () => async ({ model, bom, inspection, quality }) => {
    seedBootstrapTrackedReviewContext();
    bootstrapCalls.push({ model, bom, inspection, quality });
    return {
      ok: true,
      session_id: BOOTSTRAP_SESSION_ID,
      source: {
        model_path: `output/imports/${BOOTSTRAP_SESSION_ID}/source/simple_bracket.step`,
        bom_path: bom?.path || null,
        inspection_path: inspection?.path || null,
        quality_path: quality?.path || null,
      },
      bootstrap: {
        import_diagnostics: {
          source_model_path: model?.path || null,
          file_type: 'step',
          import_kind: 'part',
          body_count: 1,
          unit_assumption: {
            unit: 'mm',
            rationale: 'Fixture assumption.',
          },
          confidence: {
            level: 'medium',
            score: 0.61,
            rationale: 'Fixture confidence.',
          },
        },
          bootstrap_summary: {
            review_gate: {
              status: 'review_required',
              reason: 'human_confirmation_required',
              correction_required: true,
            },
            dimensions_mm: {
              x: 40,
              y: 20,
              z: 8,
          },
          feature_summary: {
            cylinder_count: 4,
            bolt_circle_count: 1,
            hotspot_count: 2,
          },
        },
        bootstrap_warnings: {
          warning_count: 1,
          warnings: ['Fixture warning'],
        },
        confidence_map: {
          import_bootstrap: {
            overall: {
              level: 'medium',
              score: 0.61,
              rationale: 'Fixture confidence.',
            },
          },
        },
        draft_config_toml: PREVIEW_DRAFT_CONFIG_TOML,
        geometry_intelligence: {},
      },
      tracked_review_seed: {
        context_path: `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/engineering_context.json`,
        model_path: `output/imports/${BOOTSTRAP_SESSION_ID}/source/simple_bracket.step`,
        quality_path: quality?.path || null,
      },
      artifacts: [
        {
          key: 'import_diagnostics',
          path: `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/import_diagnostics.json`,
          file_name: 'import_diagnostics.json',
        },
      ],
    };
  },
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const htmlResponse = await fetch(baseUrl, {
    headers: {
      accept: 'text/html',
    },
    redirect: 'manual',
  });
  assert.equal(htmlResponse.status, 302);
  assert.equal(htmlResponse.headers.get('location'), '/studio/');

  const apiHtmlResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'text/html',
    },
  });
  assert.equal(apiHtmlResponse.status, 200);
  const html = await apiHtmlResponse.text();
  assert.match(html, /fcad Local API/);
  assert.match(html, /Studio is the preferred browser review console/);
  assert.match(html, /Open <code>\/<\/code> or <code>\/studio<\/code> for Studio/);
  assert.match(html, /GET \/health/);
  assert.match(html, /POST \/api\/studio\/model-preview/);
  assert.match(html, /POST \/api\/studio\/import-bootstrap/);
  assert.match(html, /POST \/api\/studio\/drawing-preview/);
  assert.match(html, /\/studio/);
  assert.match(html, /GET \/api/);
  assert.match(html, /fcad serve --legacy-viewer/);
  assert.match(html, /Need classic compatibility mode instead\?/);
  assert.match(html, /create\/draw\/inspect\/report work, source-path review-context handoff, and compare, readiness, stabilization, docs, and pack follow-up/i);
  assert.match(html, /POST \/jobs/);
  assert.match(html, /review-context/i);
  assert.match(html, /release_bundle\.zip|release bundle/i);
  assert.match(html, /&lt;project-root&gt;/);
  assert.doesNotMatch(html, new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const studioShellResponse = await fetch(`${baseUrl}/studio/`, {
    headers: {
      accept: 'text/html',
    },
  });
  assert.equal(studioShellResponse.status, 200);
  const studioShellHtml = await studioShellResponse.text();
  assert.match(studioShellHtml, /"#i18n-contract": "\/js\/shared\/i18n-contract\.js"/);

  const browserI18nResponse = await fetch(`${baseUrl}/js/i18n/index.js`);
  assert.equal(browserI18nResponse.status, 200);
  const browserI18nSource = await browserI18nResponse.text();
  assert.match(browserI18nSource, /#i18n-contract/);

  const sharedContractResponse = await fetch(`${baseUrl}/js/shared/i18n-contract.js`);
  assert.equal(sharedContractResponse.status, 200);
  const sharedContractSource = await sharedContractResponse.text();
  assert.match(sharedContractSource, /export const LOCALE_COOKIE_NAME = 'ui_locale'/);

  const studioEntrypointResponse = await fetch(`${baseUrl}/js/studio-shell.js`);
  assert.equal(studioEntrypointResponse.status, 200);
  assert.match(studioEntrypointResponse.headers.get('content-type') || '', /javascript/);

  const studioWorkspaceResponse = await fetch(`${baseUrl}/js/studio/workspaces.js`);
  assert.equal(studioWorkspaceResponse.status, 200);
  assert.match(studioWorkspaceResponse.headers.get('content-type') || '', /javascript/);

  const apiKoHtmlResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'text/html',
      cookie: 'ui_locale=ko',
    },
  });
  assert.equal(apiKoHtmlResponse.status, 200);
  const koHtml = await apiKoHtmlResponse.text();
  assert.match(koHtml, /fcad 로컬 API/);
  assert.match(koHtml, /언어/);
  assert.match(koHtml, /Studio가 기본 브라우저 검토 콘솔/);
  assert.match(koHtml, /브라우저에서는 <code>\/<\/code> 또는 <code>\/studio<\/code>로 Studio를 여세요/);

  const jsonResponse = await fetch(baseUrl, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(jsonResponse.status, 200);
  const payload = await jsonResponse.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'local_api');
  assert.equal(payload.project_root, '<project-root>');
  assert.equal(payload.endpoints.health, '/health');
  assert.equal(payload.endpoints.job, '/jobs/:id');
  assert.equal(payload.endpoints.cancel_job, '/jobs/:id/cancel');
  assert.equal(payload.endpoints.retry_job, '/jobs/:id/retry');
  assert.equal(payload.endpoints.artifact_open, '/artifacts/:jobId/:artifactId');
  assert.equal(payload.api_info.path, '/api');
  assert.equal(payload.studio.preferred_path, '/');
  assert.equal(payload.studio.path, '/studio');
  assert.equal(payload.viewer.command, 'fcad serve --legacy-viewer');
  assert.equal(payload.studio.preview_routes.model_preview, '/api/studio/model-preview');
  assert.equal(payload.studio.preview_routes.import_bootstrap, '/api/studio/import-bootstrap');
  assert.equal(payload.studio.preview_routes.drawing_dimensions, '/api/studio/drawing-previews/:id/dimensions');
  assert.equal(payload.studio.tracked_routes.submit, '/api/studio/jobs');
  assert.equal(payload.studio.tracked_routes.cancel, '/jobs/:id/cancel');
  assert.equal(payload.studio.tracked_routes.retry, '/jobs/:id/retry');
  assertNoLeakedPathStrings(payload, [ROOT, jobsDir, tmpRoot]);

  const healthResponse = await fetch(`${baseUrl}/health`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(validateLocalApiResponse('health', healthPayload).ok, true);
  assert.equal(healthPayload.jobs_dir, '<jobs-dir>');
  assert.equal(typeof healthPayload.runtime.available, 'boolean');
  assert.equal(typeof healthPayload.runtime.status, 'string');
  assert.equal(typeof healthPayload.runtime.source, 'string');
  assert.equal(typeof healthPayload.runtime.mode, 'string');
  assert.equal(typeof healthPayload.runtime.description, 'string');
  if (healthPayload.runtime.available) {
    assert.match(healthPayload.runtime.description, /<freecad-runtime>/);
  }
  assertNoLeakedPathStrings(healthPayload, [ROOT, jobsDir, tmpRoot, '/Applications/FreeCAD.app']);

  const bootstrapPreviewResponse = await fetch(`${baseUrl}/api/studio/import-bootstrap`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model_path: 'tests/fixtures/imports/simple_bracket.step',
      quality_path: 'tests/fixtures/sample_quality.csv',
    }),
  });
  assert.equal(bootstrapPreviewResponse.status, 200);
  const bootstrapPreviewPayload = await bootstrapPreviewResponse.json();
  assert.equal(bootstrapPreviewPayload.ok, true);
  assert.equal(bootstrapCalls.length > 0, true);
  assert.equal(bootstrapCalls[0].model.path, join(ROOT, 'tests', 'fixtures', 'imports', 'simple_bracket.step'));
  assert.equal(bootstrapPreviewPayload.source.model_path, `output/imports/${BOOTSTRAP_SESSION_ID}/source/simple_bracket.step`);
  assert.equal(bootstrapPreviewPayload.bootstrap.import_diagnostics.source_model_path, 'tests/fixtures/imports/simple_bracket.step');
  assert.equal(bootstrapPreviewPayload.bootstrap.bootstrap_summary.review_gate.correction_required, true);
  assert.equal(bootstrapPreviewPayload.bootstrap.draft_config_toml, PREVIEW_DRAFT_CONFIG_TOML);
  assert.equal(bootstrapPreviewPayload.tracked_review_seed.context_path, `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/engineering_context.json`);

  const forwardedBootstrapOptions = buildImportBootstrapOptions(bootstrapPreviewPayload, {});
  assert.equal(forwardedBootstrapOptions.bootstrap.draft_config_toml, PREVIEW_DRAFT_CONFIG_TOML);

  const importReviewJobResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'review-context',
      context_path: bootstrapPreviewPayload.tracked_review_seed.context_path,
      model_path: bootstrapPreviewPayload.tracked_review_seed.model_path,
      quality_path: 'tests/fixtures/sample_quality.csv',
      options: forwardedBootstrapOptions,
    }),
  });
  assert.equal(importReviewJobResponse.status, 202);
  const importReviewJobPayload = await importReviewJobResponse.json();
  assert.equal(importReviewJobPayload.ok, true);
  assert.equal(importReviewJobPayload.job.type, 'review-context');
  assert.deepEqual(importReviewJobPayload.job.request.options.bootstrap.import_diagnostics, {
    source_model_path: 'tests/fixtures/imports/simple_bracket.step',
    file_type: 'step',
    import_kind: 'part',
    body_count: 1,
    unit_assumption: {
      unit: 'mm',
      rationale: 'Fixture assumption.',
    },
    confidence: {
      level: 'medium',
      score: 0.61,
      rationale: 'Fixture confidence.',
    },
  });
  assert.equal(importReviewJobPayload.job.request.options.bootstrap.bootstrap_summary.review_gate.status, 'review_required');
  assert.equal(importReviewJobPayload.job.request.options.bootstrap.draft_config_toml, PREVIEW_DRAFT_CONFIG_TOML);

  const completedImportReviewPayload = await waitFor(async () => {
    const statusResponse = await fetch(`${baseUrl}/jobs/${importReviewJobPayload.job.id}`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.job.status, 'succeeded');
    return statusPayload;
  }, { attempts: 80, delayMs: 100 });
  assert.equal(completedImportReviewPayload.job.status, 'succeeded');

  const importReviewArtifactsResponse = await fetch(`${baseUrl}/jobs/${importReviewJobPayload.job.id}/artifacts`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(importReviewArtifactsResponse.status, 200);
  const importReviewArtifactsPayload = await importReviewArtifactsResponse.json();
  const bootstrapDraftArtifact = importReviewArtifactsPayload.artifacts.find((artifact) => artifact.type === 'config.bootstrap-draft');
  assert.ok(bootstrapDraftArtifact);
  const engineeringContextArtifact = importReviewArtifactsPayload.artifacts.find((artifact) => artifact.type === 'engineering_context.json');
  assert.ok(engineeringContextArtifact);

  const bootstrapDraftContentResponse = await fetch(`${baseUrl}${bootstrapDraftArtifact.links.api}`, {
    headers: {
      accept: 'application/toml',
    },
  });
  assert.equal(bootstrapDraftContentResponse.status, 200);
  assert.equal(await bootstrapDraftContentResponse.text(), bootstrapPreviewPayload.bootstrap.draft_config_toml);

  const engineeringContextResponse = await fetch(`${baseUrl}${engineeringContextArtifact.links.api}`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(engineeringContextResponse.status, 200);
  const trackedEngineeringContext = await engineeringContextResponse.json();
  assert.deepEqual(trackedEngineeringContext.geometry_source.bootstrap, {
    draft_config_path: `output/imports/${BOOTSTRAP_SESSION_ID}/artifacts/bootstrap_draft_config.toml`,
    preview_source: 'import-bootstrap-preview',
    draft_config_available: true,
  });

  const apiJsonResponse = await fetch(`${baseUrl}/api`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(apiJsonResponse.status, 200);
  const apiPayload = await apiJsonResponse.json();
  assert.equal(apiPayload.ok, true);
  assert.equal(apiPayload.mode, 'local_api');

  const jobsIndexResponse = await fetch(`${baseUrl}/jobs`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(jobsIndexResponse.status, 200);
  const jobsIndexPayload = await jobsIndexResponse.json();
  assert.equal(jobsIndexPayload.ok, true);
  assert.equal(Array.isArray(jobsIndexPayload.jobs), true);
  assertNoLeakedPathStrings(jobsIndexPayload, [jobsDir, tmpRoot]);

  const redactionSourceJob = await jobStore.createJob({
    type: 'report',
    config_path: PRIVATE_CONFIG_PATH,
    options: {
      studio: {
        source: 'artifact-reference',
        source_job_id: 'job-upstream',
        source_artifact_id: 'effective-config',
        source_artifact_type: 'config.effective',
        source_label: 'Effective config copy',
        source_artifact_path: PRIVATE_RESULT_PATH,
      },
      export_path: PRIVATE_RESULT_PATH,
    },
  });
  const redactionArtifactPath = await jobStore.writeJobFile(redactionSourceJob.id, 'artifacts/private-report.json', '{"ok":true}\n');
  const redactionManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: redactionSourceJob.id,
    configPath: PRIVATE_CONFIG_PATH,
    artifacts: [
      {
        id: 'report-json',
        type: 'report.sample',
        path: redactionArtifactPath,
        label: 'Private report',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: redactionSourceJob.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(
    redactionSourceJob.id,
    {
      report_path: PRIVATE_RESULT_PATH,
      nested: {
        support_file: 'C:\\private\\report\\support.md',
      },
    },
    {
      report_json: PRIVATE_RESULT_PATH,
      report_files: [PRIVATE_RESULT_PATH, 'C:\\private\\report\\support.md'],
    },
    {},
    redactionManifest
  );

  const redactedJobResponse = await fetch(`${baseUrl}/jobs/${redactionSourceJob.id}`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(redactedJobResponse.status, 200);
  const redactedJobPayload = await redactedJobResponse.json();
  assert.equal(redactedJobPayload.ok, true);
  assert.equal('config_path' in redactedJobPayload.job.request, false);
  assert.deepEqual(redactedJobPayload.job.request.artifact_ref, {
    job_id: 'job-upstream',
    artifact_id: 'effective-config',
  });
  assert.equal(redactedJobPayload.job.request.options.export_path, 'private-report.json');
  assert.equal('source_artifact_path' in redactedJobPayload.job.request.options.studio, false);
  assert.equal(redactedJobPayload.job.result.report_path, 'private-report.json');
  assert.equal(redactedJobPayload.job.result.nested.support_file, 'support.md');
  assert.equal(redactedJobPayload.job.artifacts.report_json, 'private-report.json');
  assert.deepEqual(redactedJobPayload.job.artifacts.report_files, ['private-report.json', 'support.md']);
  assert.equal(redactedJobPayload.job.manifest.config_path, 'private-source-config.toml');
  assert.equal(redactedJobPayload.job.manifest.artifacts[0].path, 'private-report.json');
  assert.equal('root' in redactedJobPayload.job.storage, false);
  assert.equal('path' in redactedJobPayload.job.storage.files.job, false);
  assertNoLeakedPathStrings(redactedJobPayload, [PRIVATE_CONFIG_PATH, PRIVATE_RESULT_PATH, redactionArtifactPath, jobsDir, tmpRoot]);
  assert.equal(JSON.stringify(redactedJobPayload).includes('C:\\\\private\\\\report'), false);

  const queuedSmokeJob = await jobStore.createJob({
    type: 'create',
    config: {
      name: 'queued_smoke_job',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const queuedStatusResponse = await fetch(`${baseUrl}/jobs/${queuedSmokeJob.id}`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(queuedStatusResponse.status, 200);
  const queuedStatusPayload = await queuedStatusResponse.json();
  assert.equal(queuedStatusPayload.ok, true);
  assert.equal(queuedStatusPayload.job.id, queuedSmokeJob.id);
  assert.equal(queuedStatusPayload.job.status, 'queued');
  assert.equal(queuedStatusPayload.job.capabilities.cancellation_supported, true);
  assert.equal(queuedStatusPayload.job.capabilities.retry_supported, false);

  const queuedCancelResponse = await fetch(`${baseUrl}/jobs/${queuedSmokeJob.id}/cancel`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(queuedCancelResponse.status, 200);
  const queuedCancelPayload = await queuedCancelResponse.json();
  assert.equal(queuedCancelPayload.ok, true);
  assert.equal(queuedCancelPayload.action.type, 'cancel');
  assert.equal(queuedCancelPayload.job.status, 'cancelled');

  const failedRetrySource = await jobStore.createJob({
    type: 'report',
    config: {
      name: 'retry_smoke_job',
      shapes: [{ id: 'body', type: 'box', length: 12, width: 10, height: 8 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  await jobStore.failJob(failedRetrySource.id, new Error('synthetic retry smoke failure'));

  const failedRetryResponse = await fetch(`${baseUrl}/jobs/${failedRetrySource.id}/retry`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(failedRetryResponse.status, 202);
  const failedRetryPayload = await failedRetryResponse.json();
  assert.equal(failedRetryPayload.ok, true);
  assert.equal(failedRetryPayload.action.type, 'retry');
  assert.equal(failedRetryPayload.action.source_job_id, failedRetrySource.id);
  assert.equal(failedRetryPayload.job.retried_from_job_id, failedRetrySource.id);
  assert.equal(failedRetryPayload.job.status, 'queued');

  const studioResponse = await fetch(`${baseUrl}/studio`);
  assert.equal(studioResponse.status, 200);
  const studioHtml = await studioResponse.text();
  assert.match(studioHtml, /FreeCAD Automation Studio/);
  assert.match(studioHtml, /workspace-nav/);

  const studioCssResponse = await fetch(`${baseUrl}/css/studio.css`);
  assert.equal(studioCssResponse.status, 200);
  const studioCss = await studioCssResponse.text();
  assert.match(studioCss, /--canvas-0/);
  assert.match(studioCss, /\.action-grid/);

  const examplesResponse = await fetch(`${baseUrl}/api/examples`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(examplesResponse.status, 200);
  const examples = await examplesResponse.json();
  assert.equal(Array.isArray(examples), true);
  assert.equal(examples.length > 0, true);
  assert.deepEqual(Object.keys(examples[0]).sort(), ['content', 'id', 'name']);
  assert.equal(typeof examples[0].id, 'string');
  assert.equal(typeof examples[0].name, 'string');
  assert.equal(typeof examples[0].content, 'string');
  assert.equal('path' in examples[0], false);
  assertNoLeakedPathStrings(examples, [join(ROOT, 'configs', 'examples')]);

  const profilesResponse = await fetch(`${baseUrl}/api/config/profiles`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(profilesResponse.status, 200);
  const profilesPayload = await profilesResponse.json();
  assert.equal(profilesPayload.ok, true);
  assert.equal(Array.isArray(profilesPayload.profiles), true);
  assert.equal(profilesPayload.profiles.length > 0, true);
  assert.equal(typeof profilesPayload.profiles[0].name, 'string');

  const validateResponse = await fetch(`${baseUrl}/api/studio/validate-config`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: readFileSync(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'), 'utf8'),
    }),
  });
  assert.equal(validateResponse.status, 200);
  const validationPayload = await validateResponse.json();
  assert.equal(validationPayload.ok, true);
  assert.equal(validationPayload.overview.mode, 'part');
  assert.equal(typeof validationPayload.overview.shape_count, 'number');
  assert.equal(Array.isArray(validationPayload.validation.warnings), true);

  const studioJobResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'draw',
      config_toml: readFileSync(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'), 'utf8'),
      drawing_settings: {
        views: ['front', 'iso'],
        scale: '1:2',
      },
      options: {
        qa: true,
      },
    }),
  });
  assert.equal(studioJobResponse.status, 202);
  const studioJobPayload = await studioJobResponse.json();
  assert.equal(studioJobPayload.ok, true);
  assert.equal(validateLocalApiResponse('job', studioJobPayload).ok, true);
  assert.equal(studioJobPayload.job.type, 'draw');
  assert.equal(studioJobPayload.job.retried_from_job_id, null);
  assert.equal(studioJobPayload.job.capabilities.cancellation_supported, true);
  assert.equal(studioJobPayload.job.capabilities.retry_supported, false);
  assert.match(studioJobPayload.job.links.cancel, new RegExp(`/jobs/${studioJobPayload.job.id}/cancel$`));
  assert.match(studioJobPayload.job.links.retry, new RegExp(`/jobs/${studioJobPayload.job.id}/retry$`));
  assert.deepEqual(studioJobPayload.job.request.config.drawing.views, ['front', 'iso']);
  assert.equal(studioJobPayload.job.request.config.drawing.scale, '1:2');
  assert.equal(studioJobPayload.job.request.options.qa, true);
  assert.equal('root' in studioJobPayload.job.storage, false);
  assert.equal('path' in studioJobPayload.job.storage.files.request, false);
  assertNoLeakedPathStrings(studioJobPayload, [jobsDir, tmpRoot, ROOT]);

  await waitFor(async () => {
    const jobsResponse = await fetch(`${baseUrl}/jobs?limit=5`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(jobsResponse.status, 200);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsPayload.ok, true);
    assert.equal(jobsPayload.jobs.length >= 1, true);
    assert.equal(jobsPayload.jobs[0].id, studioJobPayload.job.id);
    assert.equal('root' in jobsPayload.jobs[0].storage, false);
    assert.equal('path' in jobsPayload.jobs[0].storage.files.job, false);
    const redactedRecentJob = jobsPayload.jobs.find((job) => job.id === redactionSourceJob.id);
    assert.equal(Boolean(redactedRecentJob), true);
    assert.equal('config_path' in redactedRecentJob.request, false);
    assert.equal(redactedRecentJob.request.options.export_path, 'private-report.json');
    assert.equal(redactedRecentJob.result.report_path, 'private-report.json');
    assert.equal(redactedRecentJob.manifest.config_path, 'private-source-config.toml');
    assertNoLeakedPathStrings(jobsPayload, [jobsDir, tmpRoot]);
    assert.equal(JSON.stringify(jobsPayload).includes(PRIVATE_CONFIG_PATH), false);
    assert.equal(JSON.stringify(jobsPayload).includes(PRIVATE_RESULT_PATH), false);
  });

  const job = await jobStore.createJob({
    type: 'report',
    config: {
      name: 'artifact_route_test',
      shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const artifactPath = await jobStore.writeJobFile(job.id, 'artifacts/studio-note.json', '{"ok":true}\n');
  const manifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [
      {
        type: 'report.sample',
        path: artifactPath,
        label: 'Studio note',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: job.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(job.id, { success: true }, { sample: artifactPath }, {}, manifest);

  const artifactListResponse = await fetch(`${baseUrl}/jobs/${job.id}/artifacts`);
  assert.equal(artifactListResponse.status, 200);
  const artifactListPayload = await artifactListResponse.json();
  assert.equal(artifactListPayload.artifacts.length, 1);
  assert.equal(artifactListPayload.artifacts[0].file_name, 'studio-note.json');
  assert.equal(artifactListPayload.artifacts[0].extension, '.json');
  assert.equal(artifactListPayload.artifacts[0].content_type, 'application/json; charset=utf-8');
  assert.equal(artifactListPayload.artifacts[0].capabilities.can_open, true);
  assert.equal(artifactListPayload.artifacts[0].capabilities.can_download, true);
  assert.equal('path' in artifactListPayload.artifacts[0], false);
  assert.equal('root' in artifactListPayload.storage, false);
  assert.equal('path' in artifactListPayload.storage.files.job, false);
  assert.match(artifactListPayload.artifacts[0].links.open, new RegExp(`/artifacts/${job.id}/.+`));
  assert.match(artifactListPayload.artifacts[0].links.download, new RegExp(`/artifacts/${job.id}/.+/download$`));
  assert.match(artifactListPayload.artifacts[0].links.api, new RegExp(`/jobs/${job.id}/artifacts/.+/content$`));
  assertNoLeakedPathStrings(artifactListPayload, [artifactPath, jobsDir, tmpRoot]);

  const redactedArtifactsResponse = await fetch(`${baseUrl}/jobs/${redactionSourceJob.id}/artifacts`);
  assert.equal(redactedArtifactsResponse.status, 200);
  const redactedArtifactsPayload = await redactedArtifactsResponse.json();
  assert.equal(redactedArtifactsPayload.ok, true);
  assert.equal(redactedArtifactsPayload.manifest.config_path, 'private-source-config.toml');
  assert.equal(redactedArtifactsPayload.manifest.artifacts[0].path, 'private-report.json');
  assert.equal(redactedArtifactsPayload.artifacts[0].file_name, 'private-report.json');
  assert.equal('path' in redactedArtifactsPayload.artifacts[0], false);
  assert.equal('root' in redactedArtifactsPayload.storage, false);
  assert.equal('path' in redactedArtifactsPayload.storage.files.manifest, false);
  assertNoLeakedPathStrings(redactedArtifactsPayload, [PRIVATE_CONFIG_PATH, PRIVATE_RESULT_PATH, redactionArtifactPath, jobsDir, tmpRoot]);
  assert.equal(JSON.stringify(redactedArtifactsPayload).includes('C:\\\\private\\\\report'), false);

  const artifactOpenResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.open}`);
  assert.equal(artifactOpenResponse.status, 200);
  assert.match(artifactOpenResponse.headers.get('content-disposition') || '', /^inline;/);
  assert.equal(await artifactOpenResponse.text(), '{"ok":true}\n');

  const artifactDownloadResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.download}`);
  assert.equal(artifactDownloadResponse.status, 200);
  assert.match(artifactDownloadResponse.headers.get('content-disposition') || '', /^attachment;/);

  const artifactApiResponse = await fetch(`${baseUrl}${artifactListPayload.artifacts[0].links.api}`);
  assert.equal(artifactApiResponse.status, 200);
  assert.match(artifactApiResponse.headers.get('content-disposition') || '', /^inline;/);

  const configSourceJob = await jobStore.createJob({
    type: 'create',
    config: {
      name: 'config_source_job',
      shapes: [{ id: 'body', type: 'box', length: 12, width: 8, height: 4 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const configArtifactPath = await jobStore.writeJobFile(configSourceJob.id, 'inputs/effective-config.json', '{"name":"config_source_job"}\n');
  const configManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'create',
    jobType: 'create',
    status: 'succeeded',
    requestId: configSourceJob.id,
    artifacts: [
      {
        id: 'effective-config',
        type: 'config.effective',
        path: configArtifactPath,
        label: 'Effective config copy',
        scope: 'internal',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: configSourceJob.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(configSourceJob.id, { success: true }, { effective_config: configArtifactPath }, {}, configManifest);

  const configArtifactsResponse = await fetch(`${baseUrl}/jobs/${configSourceJob.id}/artifacts`);
  assert.equal(configArtifactsResponse.status, 200);
  const configArtifactsPayload = await configArtifactsResponse.json();
  const configArtifact = configArtifactsPayload.artifacts[0];
  assert.equal('path' in configArtifact, false);
  assert.equal(JSON.stringify(configArtifactsPayload).includes(configArtifactPath), false);

  const rerunReportResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'report',
      artifact_ref: {
        job_id: configSourceJob.id,
        artifact_id: configArtifact.id,
      },
      report_options: {
        style: 'summary',
      },
    }),
  });
  assert.equal(rerunReportResponse.status, 202);
  const rerunReportPayload = await rerunReportResponse.json();
  assert.equal(rerunReportPayload.job.type, 'report');
  assert.equal('config_path' in rerunReportPayload.job.request, false);
  assert.deepEqual(rerunReportPayload.job.request.artifact_ref, {
    job_id: configSourceJob.id,
    artifact_id: configArtifact.id,
  });
  assert.equal(rerunReportPayload.job.request.source_job_id, configSourceJob.id);
  assert.equal(rerunReportPayload.job.request.options.studio.source_artifact_id, configArtifact.id);
  assert.equal(rerunReportPayload.job.request.source_artifact_type, 'config.effective');
  assert.equal(rerunReportPayload.job.request.source_label, 'Effective config copy');
  assert.equal('source_artifact_path' in rerunReportPayload.job.request.options.studio, false);
  assert.deepEqual(rerunReportPayload.job.request.options.report_options, { style: 'summary' });
  assert.equal(JSON.stringify(rerunReportPayload.job.request).includes(configArtifactPath), false);

  const rerunReportStatusResponse = await fetch(`${baseUrl}/jobs/${rerunReportPayload.job.id}`);
  assert.equal(rerunReportStatusResponse.status, 200);
  const rerunReportStatusPayload = await rerunReportStatusResponse.json();
  assert.equal('config_path' in rerunReportStatusPayload.job.request, false);
  assert.equal(JSON.stringify(rerunReportStatusPayload.job.request).includes(configArtifactPath), false);

  const modelSourceJob = await jobStore.createJob({
    type: 'create',
    config: {
      name: 'model_source_job',
      shapes: [{ id: 'body', type: 'box', length: 9, width: 6, height: 3 }],
      export: { formats: ['step'], directory: 'output' },
    },
  });
  const modelArtifactPath = await jobStore.writeJobFile(modelSourceJob.id, 'artifacts/source.step', 'ISO-10303-21;\n');
  const modelManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'create',
    jobType: 'create',
    status: 'succeeded',
    requestId: modelSourceJob.id,
    artifacts: [
      {
        id: 'model-step',
        type: 'model.step',
        path: modelArtifactPath,
        label: 'STEP export',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: modelSourceJob.created_at,
      finished_at: new Date().toISOString(),
    },
  });
  await jobStore.completeJob(modelSourceJob.id, { success: true }, { exports: [modelArtifactPath] }, {}, modelManifest);

  const modelArtifactsResponse = await fetch(`${baseUrl}/jobs/${modelSourceJob.id}/artifacts`);
  assert.equal(modelArtifactsResponse.status, 200);
  const modelArtifactsPayload = await modelArtifactsResponse.json();
  const modelArtifact = modelArtifactsPayload.artifacts[0];
  assert.equal('path' in modelArtifact, false);
  assert.equal(JSON.stringify(modelArtifactsPayload).includes(modelArtifactPath), false);

  const inspectResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'inspect',
      artifact_ref: {
        job_id: modelSourceJob.id,
        artifact_id: modelArtifact.id,
      },
    }),
  });
  assert.equal(inspectResponse.status, 202);
  const inspectPayload = await inspectResponse.json();
  assert.equal(inspectPayload.job.type, 'inspect');
  assert.equal('file_path' in inspectPayload.job.request, false);
  assert.deepEqual(inspectPayload.job.request.artifact_ref, {
    job_id: modelSourceJob.id,
    artifact_id: modelArtifact.id,
  });
  assert.equal(inspectPayload.job.request.options.studio.source_artifact_type, 'model.step');
  assert.equal(inspectPayload.job.request.source_artifact_type, 'model.step');
  assert.equal(inspectPayload.job.request.source_label, 'STEP export');
  assert.equal('source_artifact_path' in inspectPayload.job.request.options.studio, false);
  assert.equal(JSON.stringify(inspectPayload.job.request).includes(modelArtifactPath), false);

  await waitFor(async () => {
    const recentJobsResponse = await fetch(`${baseUrl}/jobs?limit=100`, {
      headers: {
        accept: 'application/json',
      },
    });
    assert.equal(recentJobsResponse.status, 200);
    const recentJobsPayload = await recentJobsResponse.json();
    const recentInspectJob = recentJobsPayload.jobs.find((entry) => entry.id === inspectPayload.job.id);
    assert.equal(Boolean(recentInspectJob), true);
    assert.equal('file_path' in recentInspectJob.request, false);
    assert.equal(JSON.stringify(recentInspectJob.request).includes(modelArtifactPath), false);
  });

  console.log('local-api-server.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(BOOTSTRAP_SESSION_DIR, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
}
