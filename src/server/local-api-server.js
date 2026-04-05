import express from 'express';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { runScript } from '../../lib/runner.js';
import {
  buildAfExecutionStateDescriptor,
  getAfExecutionJobContract,
} from '../../lib/af-execution-contract.js';
import { listShopProfiles } from '../api/config.js';
import { createJobStore } from '../services/jobs/job-store.js';
import { createJobExecutor, validateJobRequest } from '../services/jobs/job-executor.js';
import { createBootstrapImportService } from '../services/import/bootstrap-import-service.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import { validateLocalApiResponse } from './local-api-schemas.js';
import { createStudioModelService } from './studio-model-service.js';
import { createStudioDrawingService } from './studio-drawing-service.js';
import { translateStudioJobSubmission } from './studio-job-bridge.js';
import { toPublicDrawingPreviewPayload } from './public-drawing-preview.js';
import { toPublicJobRequest } from './public-job-request.js';
import { LOCALE_COOKIE_NAME, resolveInitialLocale } from '../../public/js/i18n/index.js';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const EXAMPLES_DIR = join(import.meta.dirname, '..', '..', 'configs', 'examples');
const STUDIO_HTML = join(PUBLIC_DIR, 'studio.html');
const STUDIO_CSS = join(PUBLIC_DIR, 'css', 'studio.css');
const STUDIO_SHELL_JS = join(PUBLIC_DIR, 'js', 'studio-shell.js');
const APP_JS_DIR = join(PUBLIC_DIR, 'js', 'app');
const I18N_JS_DIR = join(PUBLIC_DIR, 'js', 'i18n');
const STUDIO_JS_DIR = join(PUBLIC_DIR, 'js', 'studio');
const STATIC_FILE_OPTIONS = Object.freeze({
  dotfiles: 'allow',
});
const INLINE_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.dxf',
  '.html',
  '.json',
  '.log',
  '.md',
  '.markdown',
  '.pdf',
  '.svg',
  '.text',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.step',
]);

function inferArtifactContentType(filePath = '') {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.dxf':
      return 'image/vnd.dxf';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.log':
    case '.txt':
    case '.text':
    case '.step':
      return 'text/plain; charset=utf-8';
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8';
    case '.pdf':
      return 'application/pdf';
    case '.svg':
      return 'image/svg+xml';
    case '.toml':
      return 'application/toml; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function buildArtifactCapabilities(filePath = '', exists = false) {
  const extension = extname(filePath).toLowerCase();
  const browserSafe = INLINE_ARTIFACT_EXTENSIONS.has(extension);
  return {
    can_open: exists && browserSafe,
    can_download: exists,
    browser_safe: browserSafe,
  };
}

function buildArtifactLinks(jobId, artifactId) {
  const encodedJobId = encodeURIComponent(jobId);
  const encodedId = encodeURIComponent(artifactId);
  const base = `/artifacts/${encodedJobId}/${encodedId}`;
  return {
    open: base,
    download: `${base}/download`,
    api: `/jobs/${encodedJobId}/artifacts/${encodedId}/content`,
  };
}

function isAbsoluteFilesystemPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (posix.isAbsolute(value) || win32.isAbsolute(value));
}

function isPathInside(baseDir, targetPath) {
  const base = resolve(baseDir);
  const target = resolve(targetPath);
  return target === base || target.startsWith(`${base}${sep}`);
}

function basenameFromAnyPath(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function trimOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function toProjectDisplayPath(projectRoot, value) {
  const trimmed = trimOptionalString(value);
  if (!trimmed) return '';
  const resolvedPath = resolve(trimmed);
  if (isPathInside(projectRoot, resolvedPath)) {
    const next = relative(projectRoot, resolvedPath);
    return next || '.';
  }
  return basenameFromAnyPath(trimmed);
}

function toProjectAbsolutePath(projectRoot, value) {
  const trimmed = trimOptionalString(value);
  if (!trimmed) return '';
  return resolve(projectRoot, trimmed);
}

function toBootstrapFileInput(body = {}, prefix, projectRoot) {
  const upload = body?.[`${prefix}_upload`];
  if (upload && typeof upload === 'object') {
    return upload;
  }

  const filePath = trimOptionalString(body?.[`${prefix}_path`]);
  if (!filePath) return null;
  return {
    path: toProjectAbsolutePath(projectRoot, filePath),
  };
}

function redactBootstrapPreviewPaths(projectRoot, value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactBootstrapPreviewPaths(projectRoot, entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactBootstrapPreviewPaths(projectRoot, entry)])
    );
  }

  if (isAbsoluteFilesystemPath(value)) {
    return toProjectDisplayPath(projectRoot, value);
  }

  return value;
}

function redactPublicPathValues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPublicPathValues(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactPublicPathValues(entry)])
    );
  }

  if (isAbsoluteFilesystemPath(value)) {
    return basenameFromAnyPath(value);
  }

  return value;
}

function toPublicStorage(storage = null) {
  if (!storage?.files || typeof storage.files !== 'object') {
    return {
      files: {},
    };
  }

  return {
    files: Object.fromEntries(
      Object.entries(storage.files).map(([key, entry]) => [
        key,
        {
          exists: Boolean(entry?.exists),
          size_bytes: Number.isInteger(entry?.size_bytes) ? entry.size_bytes : null,
        },
      ])
    ),
  };
}

function toArtifactResponse(jobId, artifact) {
  const contentType = inferArtifactContentType(artifact.path);
  return {
    id: artifact.id,
    key: artifact.key,
    type: artifact.type || null,
    scope: artifact.scope || null,
    stability: artifact.stability || null,
    file_name: artifact.file_name,
    extension: artifact.extension,
    content_type: contentType,
    exists: Boolean(artifact.exists),
    size_bytes: Number.isInteger(artifact.size_bytes) ? artifact.size_bytes : null,
    capabilities: buildArtifactCapabilities(artifact.path, artifact.exists),
    links: buildArtifactLinks(jobId, artifact.id),
    contract: artifact.metadata?.af_contract
      ? redactPublicPathValues(artifact.metadata.af_contract)
      : null,
  };
}

async function loadExampleConfigs() {
  const files = await readdir(EXAMPLES_DIR);
  const examples = [];

  for (const fileName of files.filter((entry) => entry.endsWith('.toml')).sort()) {
    const fullPath = join(EXAMPLES_DIR, fileName);
    const content = await readFile(fullPath, 'utf8');
    examples.push({
      id: fileName.replace(/\.toml$/i, ''),
      name: fileName,
      content,
    });
  }

  return examples;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createErrorResponse(code, messages, status = 400) {
  return {
    status,
    body: {
      api_version: LOCAL_API_VERSION,
      ok: false,
      error: {
        code,
        messages,
      },
    },
  };
}

function buildLandingPayload({
  projectRoot,
  jobsDir,
}) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    mode: 'local_api',
    project_root: projectRoot,
    jobs_dir: jobsDir,
    endpoints: {
      health: '/health',
      jobs: '/jobs',
      job: '/jobs/:id',
      cancel_job: '/jobs/:id/cancel',
      retry_job: '/jobs/:id/retry',
      artifacts: '/jobs/:id/artifacts',
      artifact_open: '/artifacts/:jobId/:artifactId',
      artifact_download: '/artifacts/:jobId/:artifactId/download',
      artifact_content: '/jobs/:id/artifacts/:artifactId/content',
    },
    studio: {
      available: true,
      preferred_path: '/',
      path: '/studio',
      tracked_jobs_path: '/api/studio/jobs',
      preview_routes: {
        validate_config: '/api/studio/validate-config',
        design: '/api/studio/design',
        model_preview: '/api/studio/model-preview',
        import_bootstrap: '/api/studio/import-bootstrap',
        model_asset: '/api/studio/model-previews/:id/model',
        model_part: '/api/studio/model-previews/:id/parts/:index',
        drawing_preview: '/api/studio/drawing-preview',
        drawing_dimensions: '/api/studio/drawing-previews/:id/dimensions',
      },
      tracked_routes: {
        submit: '/api/studio/jobs',
        status: '/jobs/:id',
        cancel: '/jobs/:id/cancel',
        retry: '/jobs/:id/retry',
        artifacts: '/jobs/:id/artifacts',
        artifact_open: '/artifacts/:jobId/:artifactId',
      },
      note: 'Preview routes stay scratch-safe and request/response. Studio tracked routes cover create/draw/inspect/report plus compare, readiness, stabilization, docs, and pack follow-up, while direct POST /jobs also accepts review-context and the same AF continuation job types.',
    },
    api_info: {
      available: true,
      path: '/api',
    },
    viewer: {
      available: true,
      command: 'fcad serve --legacy-viewer',
      npm_script: 'npm run serve:legacy',
    },
    examples: {
      health_curl: 'curl http://127.0.0.1:3000/health',
    },
    notes: [
      'Browser requests to / open the Studio review console by default.',
      'Open /api for the local API info page and /studio for the direct Studio review-console route.',
      'Open /health for the runtime diagnostics payload; POST /jobs accepts direct tracked JSON requests including review-context, compare, readiness, docs, and pack work.',
      'If localhost resolves to another listener on your machine, use 127.0.0.1 explicitly.',
    ],
  };
}

function resolveRequestLocale(req) {
  return resolveInitialLocale({
    cookieHeader: req?.headers?.cookie || '',
    browserLanguage: req?.headers?.['accept-language'] || '',
  });
}

function buildLandingCopy(locale = 'en') {
  if (locale === 'ko') {
    return {
      title: 'fcad 로컬 API',
      language: '언어',
      intro: 'Studio가 기본 브라우저 검토 콘솔이며, 이 페이지는 그에 연결된 로컬 API와 보조 경로를 설명합니다.',
      browserLanding: '브라우저에서는 <code>/</code> 또는 <code>/studio</code>로 Studio를 여세요. 이 페이지는 API와 호환 경로를 확인할 때 사용합니다.',
      projectRoot: '프로젝트 루트',
      apiEndpoints: '브라우저 경로 및 API 엔드포인트',
      browserRedirect: '기본 Studio 작업 영역을 엽니다',
      directStudio: '직접 Studio 작업 영역을 엽니다',
      apiInfo: '이 Studio/API 안내 페이지를 반환합니다',
      runtimeDiagnostics: '런타임 진단용',
      modelPreview: '검토에 필요한 형상 확인용 빠른 모델 미리보기 빌드를 실행합니다',
      importBootstrap: '기존 STEP 또는 FCStd를 검토 루프로 안전하게 가져오기 위한 부트스트랩 진단과 초안 산출물을 생성합니다',
      drawingPreview: '검토에 필요한 시트 확인용 빠른 도면 미리보기 빌드를 실행합니다',
      trackedJobs: 'Studio TOML 또는 산출물 참조에서 생성/도면/검사/리포트와 비교, 준비 상태, 안정화 검토, 문서, 팩 후속 작업을 대기열에 넣고, readiness 기반 문서 작업은 필요 시 config 유사 입력을 자동 복구합니다',
      directJobs: '직접 JSON 요청으로 review-context와 AF 추적 작업을 대기열에 넣습니다',
      jobsDiscovery: '최근 작업 기록과 생성 대상 경로를 확인합니다',
      jobShape: '작업 상태 응답 형식을 확인합니다',
      cancelQueued: '실행 전에 대기 중인 추적 작업을 취소합니다',
      retryTracked: '실패하거나 취소된 추적 작업을 새 대기 실행으로 다시 시도합니다',
      artifactShape: '산출물 응답 형식을 확인합니다',
      executionModel: 'Studio의 검토 우선 미리보기와 추적 실행',
      previewLabel: '미리보기',
      previewCopy: '빠르고 임시 작업에 안전한 지원용 모델/도면 반복에는',
      previewCopySuffix: '를 사용합니다.',
      trackedLabel: '추적 실행',
      trackedCopy: '지속되는 검토/패키지 작업은',
      trackedCopySuffix: '로 대기열에 넣고 상태와 산출물을 추적합니다.',
      reentryLabel: '산출물 재진입',
      reentryDetailsHtml: '추적 <code>report</code>는 설정 형태의 <code>artifact_ref</code>를 받고, 추적 <code>inspect</code>는 모델 형태의 <code>artifact_ref</code>를 받습니다. 추적 <code>readiness-pack</code>, <code>generate-standard-docs</code>, <code>pack</code>은 정식 review/readiness 산출물 또는 <code>release_bundle.zip</code>에서 이어갈 수 있고, <code>compare-rev</code>와 <code>stabilization-review</code>는 기준선/후보 정식 산출물 쌍이 모두 있을 때만 준비됩니다.',
      parallelShell: 'Studio 우선 검토 경로',
      parallelShellCopyStart: '',
      parallelShellCopyMiddle: '는 직접 Studio 작업 영역입니다. <code>/</code>는 이 경로를 기본 진입점으로 유지하고, 클래식 뷰어는 호환 전용 대체 경로로만 남겨둡니다.',
      quickCheck: '빠른 확인',
      browserDemo: '클래식 호환 모드가 필요하신가요?',
      tip: '팁',
      tipCopy: '<code>http://localhost</code>가 다른 프로세스를 가리키면, 같은 포트의 <code>http://127.0.0.1</code>를 명시적으로 여세요.',
      plainHeader: 'fcad 로컬 API',
      plainBrowserLanding: 'Studio가 기본 브라우저 검토 콘솔입니다. / 또는 /studio를 사용하세요.',
      plainProjectRoot: '프로젝트 루트',
      plainStudioShell: '기본 Studio 작업 영역',
      plainDirectStudio: '직접 Studio 경로',
      plainApiInfo: 'API 정보',
      plainHealth: '상태 확인',
      plainModelPreview: '모델 미리보기',
      plainImportBootstrap: '가져온 CAD 부트스트랩',
      plainDrawingPreview: '도면 미리보기',
      plainDimensionEdits: '도면 치수 편집',
      plainTrackedJobs: '스튜디오 추적 작업',
      plainDirectJobs: '직접 JSON 작업 제출',
      plainJobs: '작업 기록',
      plainJobStatus: '작업 상태 형식',
      plainQueueCancel: '대기열 취소',
      plainQueueRetry: '대기열 재시도',
      plainArtifactShape: '산출물 형식',
      plainArtifactOpen: '산출물 열기 경로',
      plainArtifactDownload: '산출물 다운로드 경로',
      plainQuickCheck: '빠른 확인',
      plainBrowserDemo: '클래식 호환 경로',
      plainBrowserFallback: '클래식 npm 경로',
    };
  }

  return {
    title: 'fcad Local API',
    language: 'Language',
    intro: 'Studio is the preferred browser review console, and this page documents the supporting local API plus compatibility routes.',
    browserLanding: 'Open <code>/</code> or <code>/studio</code> for Studio. Use this page for API and route discovery.',
    projectRoot: 'Project root',
    apiEndpoints: 'Browser routes and API endpoints',
    browserRedirect: 'opens the preferred Studio workspace',
    directStudio: 'opens the direct Studio workspace',
    apiInfo: 'returns this Studio/API info page',
    runtimeDiagnostics: 'for runtime diagnostics',
    modelPreview: 'to run fast model preview builds for review support',
    importBootstrap: 'to bootstrap imported STEP or FCStd into the review loop with diagnostics, warnings, and draft artifacts',
    drawingPreview: 'to run fast drawing preview builds for review support',
    trackedJobs: 'to enqueue tracked create/draw/inspect/report work plus compare, readiness, stabilization, docs, and pack follow-up from studio-native TOML or artifact references; readiness-backed standard-doc continuations can rehydrate a config-like input automatically when tracked lineage no longer carries a config copy',
    directJobs: 'to enqueue direct JSON jobs for review-context plus the AF continuation job types',
    jobsDiscovery: 'for recent tracked history and route discovery',
    jobShape: 'to inspect a job status response shape',
    cancelQueued: 'to cancel a queued tracked job before execution starts',
    retryTracked: 'to retry a failed or cancelled tracked job into a new queued run',
    artifactShape: 'to inspect artifact response shape',
    executionModel: 'How Studio handles review-first preview and tracked work',
    previewLabel: 'Preview',
    previewCopy: 'use',
    previewCopySuffix: 'for fast scratch-safe supporting model and drawing iteration',
    trackedLabel: 'Tracked run',
    trackedCopy: 'use',
    trackedCopySuffix: 'to enqueue review and packaging work that persists under',
    reentryLabel: 'Artifact re-entry',
    reentryDetailsHtml: 'tracked <code>report</code> accepts config-like <code>artifact_ref</code>, and tracked <code>inspect</code> accepts model-like <code>artifact_ref</code>. Tracked <code>readiness-pack</code>, <code>generate-standard-docs</code>, and <code>pack</code> continue from canonical review/readiness artifacts or <code>release_bundle.zip</code>, while <code>compare-rev</code> and <code>stabilization-review</code> require baseline/candidate canonical artifact pairs.',
    parallelShell: 'Studio-first review routing',
    parallelShellCopyStart: 'Open',
    parallelShellCopyMiddle: 'for the direct Studio workspace. Root <code>/</code> stays the preferred browser entrypoint, while the classic viewer remains a compatibility-only fallback.',
    quickCheck: 'Quick check',
    browserDemo: 'Need classic compatibility mode instead?',
    tip: 'Tip',
    tipCopy: 'If <code>http://localhost</code> shows a different process on your machine, open <code>http://127.0.0.1</code> with the same port explicitly.',
    plainHeader: 'fcad local API',
    plainBrowserLanding: 'Studio is the preferred browser review console: use / or /studio.',
    plainProjectRoot: 'Project root',
    plainStudioShell: 'Preferred Studio workspace',
    plainDirectStudio: 'Direct Studio route',
    plainApiInfo: 'API info',
    plainHealth: 'Health',
    plainModelPreview: 'Model preview',
    plainImportBootstrap: 'Imported CAD bootstrap',
    plainDrawingPreview: 'Drawing preview',
    plainDimensionEdits: 'Drawing dimension edits',
    plainTrackedJobs: 'Studio tracked jobs',
    plainDirectJobs: 'Direct JSON job submit',
    plainJobs: 'Job history',
    plainJobStatus: 'Job status shape',
    plainQueueCancel: 'Queue cancel',
    plainQueueRetry: 'Queue retry',
    plainArtifactShape: 'Artifact shape',
    plainArtifactOpen: 'Artifact open route',
    plainArtifactDownload: 'Artifact download route',
    plainQuickCheck: 'Quick check',
    plainBrowserDemo: 'Classic compatibility route',
    plainBrowserFallback: 'Classic npm route',
  };
}

function renderLandingPage(payload, locale = 'en') {
  const copy = buildLandingCopy(locale);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7fb;
      color: #18212f;
    }
    body {
      margin: 0;
      padding: 32px 20px;
      background:
        radial-gradient(circle at top right, rgba(82, 153, 255, 0.18), transparent 32%),
        linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%);
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(24, 33, 47, 0.08);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 20px 60px rgba(24, 33, 47, 0.08);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.9rem;
    }
    p, li {
      line-height: 1.6;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.95rem;
    }
    .card {
      margin-top: 18px;
      padding: 16px;
      background: #f4f7fb;
      border-radius: 14px;
      border: 1px solid rgba(24, 33, 47, 0.08);
    }
    pre {
      margin: 12px 0 0;
      padding: 14px;
      overflow-x: auto;
      background: #18212f;
      color: #f4f7fb;
      border-radius: 12px;
    }
    ul {
      padding-left: 20px;
    }
    a {
      color: #0b57d0;
    }
    .locale-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }
    .locale-bar label {
      display: grid;
      gap: 6px;
      font-size: 0.8rem;
      color: #516173;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .locale-bar select {
      min-width: 120px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(24, 33, 47, 0.12);
      background: white;
      color: #18212f;
    }
  </style>
</head>
<body>
  <main>
    <div class="locale-bar">
      <label>
        <span>${escapeHtml(copy.language)}</span>
        <select id="locale-select">
          <option value="en"${locale === 'en' ? ' selected' : ''}>English</option>
          <option value="ko"${locale === 'ko' ? ' selected' : ''}>${locale === 'ko' ? '한국어' : 'Korean'}</option>
        </select>
      </label>
    </div>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${escapeHtml(copy.intro)} ${copy.browserLanding}</p>
    <div class="card">
      <strong>${escapeHtml(copy.projectRoot)}</strong>
      <div><code>${escapeHtml(payload.project_root)}</code></div>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.apiEndpoints)}</strong>
      <ul>
        <li><a href="/"><code>GET /</code></a> ${escapeHtml(copy.browserRedirect)}</li>
        <li><a href="/studio"><code>GET /studio</code></a> ${escapeHtml(copy.directStudio)}</li>
        <li><a href="/api"><code>GET /api</code></a> ${escapeHtml(copy.apiInfo)}</li>
        <li><a href="/health"><code>GET /health</code></a> ${escapeHtml(copy.runtimeDiagnostics)}</li>
        <li><a href="/api"><code>POST /api/studio/model-preview</code></a> ${escapeHtml(copy.modelPreview)}</li>
        <li><a href="/api"><code>POST /api/studio/import-bootstrap</code></a> ${escapeHtml(copy.importBootstrap)}</li>
        <li><a href="/api"><code>POST /api/studio/drawing-preview</code></a> ${escapeHtml(copy.drawingPreview)}</li>
        <li><a href="/api"><code>POST /api/studio/jobs</code></a> ${escapeHtml(copy.trackedJobs)}</li>
        <li><a href="/api"><code>POST /jobs</code></a> ${escapeHtml(copy.directJobs)}</li>
        <li><a href="/jobs"><code>/jobs</code></a> ${escapeHtml(copy.jobsDiscovery)}</li>
        <li><a href="/jobs/example-job"><code>/jobs/:id</code></a> ${escapeHtml(copy.jobShape)}</li>
        <li><a href="/api"><code>POST /jobs/:id/cancel</code></a> ${escapeHtml(copy.cancelQueued)}</li>
        <li><a href="/api"><code>POST /jobs/:id/retry</code></a> ${escapeHtml(copy.retryTracked)}</li>
        <li><a href="/jobs/example-job/artifacts"><code>/jobs/:id/artifacts</code></a> ${escapeHtml(copy.artifactShape)}</li>
      </ul>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.executionModel)}</strong>
      <ul>
        <li><code>${escapeHtml(copy.previewLabel)}</code>: ${escapeHtml(copy.previewCopy)} <code>${escapeHtml(payload.studio.preview_routes.model_preview)}</code> and <code>${escapeHtml(payload.studio.preview_routes.drawing_preview)}</code> ${escapeHtml(copy.previewCopySuffix)}</li>
        <li><code>${escapeHtml(copy.trackedLabel)}</code>: ${escapeHtml(copy.trackedCopy)} <code>${escapeHtml(payload.studio.tracked_jobs_path)}</code> ${escapeHtml(copy.trackedCopySuffix)} <code>${escapeHtml(payload.endpoints.jobs)}</code> and <code>${escapeHtml(payload.endpoints.artifacts)}</code></li>
        <li><code>${escapeHtml(copy.reentryLabel)}</code>: ${copy.reentryDetailsHtml}</li>
      </ul>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.parallelShell)}</strong>
      <p>${copy.parallelShellCopyStart} <a href="${escapeHtml(payload.studio.path)}"><code>${escapeHtml(payload.studio.path)}</code></a> ${escapeHtml(copy.parallelShellCopyMiddle)}</p>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.quickCheck)}</strong>
      <pre>${escapeHtml(payload.examples.health_curl)}</pre>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.browserDemo)}</strong>
      <pre>${escapeHtml(payload.viewer.command)}
${escapeHtml(payload.viewer.npm_script)}</pre>
    </div>
    <div class="card">
      <strong>${escapeHtml(copy.tip)}</strong>
      <p>${copy.tipCopy}</p>
    </div>
  </main>
  <script>
    document.getElementById('locale-select')?.addEventListener('change', function(event) {
      document.cookie = '${LOCALE_COOKIE_NAME}=' + encodeURIComponent(event.target.value) + '; Path=/; Max-Age=31536000; SameSite=Lax';
      window.location.reload();
    });
  </script>
</body>
</html>`;
}

function assertResponse(kind, payload) {
  const validation = validateLocalApiResponse(kind, payload);
  if (!validation.ok) {
    throw new Error(`Invalid ${kind} response: ${validation.errors.join(' | ')}`);
  }
  return payload;
}

function sendLandingResponse(req, res, payload) {
  const locale = resolveRequestLocale(req);
  const copy = buildLandingCopy(locale);
  const accepted = req.accepts(['html', 'json', 'text']);
  if (accepted === 'json') {
    res.json(payload);
    return;
  }
  if (accepted === 'text') {
    res.type('text/plain').send([
      copy.plainHeader,
      copy.plainBrowserLanding,
      `${copy.plainProjectRoot}: ${payload.project_root}`,
      `${copy.plainStudioShell}: /`,
      `${copy.plainDirectStudio}: /studio`,
      `${copy.plainApiInfo}: /api`,
      `${copy.plainHealth}: /health`,
      `${copy.plainModelPreview}: POST /api/studio/model-preview`,
      `${copy.plainImportBootstrap}: POST /api/studio/import-bootstrap`,
      `${copy.plainDrawingPreview}: POST /api/studio/drawing-preview`,
      `${copy.plainDimensionEdits}: POST /api/studio/drawing-previews/:id/dimensions`,
      `${copy.plainTrackedJobs}: POST /api/studio/jobs`,
      `${copy.plainDirectJobs}: POST /jobs`,
      `${copy.plainJobs}: GET /jobs`,
      `${copy.plainJobStatus}: /jobs/example-job`,
      `${copy.plainQueueCancel}: POST /jobs/:id/cancel`,
      `${copy.plainQueueRetry}: POST /jobs/:id/retry`,
      `${copy.plainArtifactShape}: /jobs/example-job/artifacts`,
      `${copy.plainArtifactOpen}: /artifacts/:jobId/:artifactId`,
      `${copy.plainArtifactDownload}: /artifacts/:jobId/:artifactId/download`,
      `${copy.plainQuickCheck}: curl http://127.0.0.1:3000/health`,
      `${copy.plainBrowserDemo}: fcad serve --legacy-viewer`,
      `${copy.plainBrowserFallback}: npm run serve:legacy`,
    ].join('\n'));
    return;
  }
  res.type('html').send(renderLandingPage(payload, locale));
}

export function buildHealthPayload({
  jobsDir,
  runtimeDiagnostics = buildRuntimeDiagnostics(),
}) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    jobs_dir: jobsDir,
    runtime: runtimeDiagnostics,
  };
}

async function toJobResponse(jobStore, job, { executor = null } = {}) {
  const storage = toPublicStorage(await jobStore.describeStorage(job.id));
  const status = String(job.status || '').toLowerCase();
  const cancellationSupported = status === 'queued'
    || (status === 'running' && typeof executor?.cancelRunningJob === 'function');
  const executionContract = getAfExecutionJobContract(job.type);
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    retried_from_job_id: job.retried_from_job_id || null,
    request: toPublicJobRequest(job.request),
    diagnostics: job.diagnostics,
    artifacts: redactPublicPathValues(job.artifacts),
    manifest: redactPublicPathValues(job.manifest),
    result: redactPublicPathValues(job.result),
    status_history: job.status_history,
    storage,
    execution: executionContract
      ? {
          ...executionContract,
          ...buildAfExecutionStateDescriptor(job.status),
        }
      : null,
    capabilities: {
      cancellation_supported: cancellationSupported,
      retry_supported: status === 'failed' || status === 'cancelled',
    },
    links: {
      self: `/jobs/${job.id}`,
      artifacts: `/jobs/${job.id}/artifacts`,
      cancel: `/jobs/${job.id}/cancel`,
      retry: `/jobs/${job.id}/retry`,
    },
  };
}

export function createLocalApiServer({
  projectRoot,
  jobsDir,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
  studioModelServiceFactory = createStudioModelService,
  studioDrawingServiceFactory = createStudioDrawingService,
  bootstrapImportServiceFactory = createBootstrapImportService,
  executorFactory = null,
}) {
  const app = express();
  const server = createServer(app);
  const jobStore = createJobStore({ jobsDir });
  const baseExecutor = createJobExecutor({
    projectRoot,
    jobStore,
  });
  const executor = typeof executorFactory === 'function'
    ? executorFactory({
        projectRoot,
        jobStore,
        baseExecutor,
      })
    : baseExecutor;
  const studioModelService = studioModelServiceFactory({ projectRoot });
  const studioDrawingService = studioDrawingServiceFactory({ projectRoot });
  const studioBootstrapImportService = bootstrapImportServiceFactory();

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeStudioOptions(options = {}, studio = {}) {
    if (options !== undefined && !isPlainObject(options)) {
      return options;
    }

    const nextOptions = isPlainObject(options)
      ? structuredClone(options)
      : {};
    nextOptions.studio = {
      ...(isPlainObject(nextOptions.studio)
        ? nextOptions.studio
        : {}),
      ...studio,
    };
    return nextOptions;
  }

  async function prepareStudioJobBody(body = {}) {
    if (body?.type !== 'draw') return body;

    let drawingPlan = null;
    let previewPlanReason = 'not_requested';
    const previewId = typeof body.drawing_preview_id === 'string' ? body.drawing_preview_id.trim() : '';

    if (previewId) {
      try {
        const resolved = typeof studioDrawingService.getTrackedDrawPlan === 'function'
          ? await studioDrawingService.getTrackedDrawPlan({
              previewId,
              configToml: body.config_toml,
            })
          : { drawingPlan: null, reason: 'preview_not_supported' };
        drawingPlan = resolved.drawingPlan;
        previewPlanReason = resolved.reason || 'not_requested';
      } catch {
        drawingPlan = null;
        previewPlanReason = 'preview_unavailable';
      }
    }

    return {
      ...body,
      ...(drawingPlan ? { drawing_plan: drawingPlan } : {}),
      options: mergeStudioOptions(body.options, {
        source: 'drawing-workspace',
        drawing_settings: structuredClone(body.drawing_settings || {}),
        preview_plan: {
          requested: Boolean(previewId),
          preserved: Boolean(drawingPlan),
          reason: previewPlanReason,
        },
      }),
    };
  }

  async function enqueueJob(request, res) {
    const validation = validateJobRequest(request);
    if (!validation.ok) {
      const response = createErrorResponse('invalid_request', validation.errors);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    const job = await jobStore.createJob(validation.request);
    const payload = {
      api_version: LOCAL_API_VERSION,
      ok: true,
      job: await toJobResponse(jobStore, job, { executor }),
    };
    res.status(202).json(assertResponse('job', payload));

    setImmediate(() => {
      executor.execute(job.id).catch(() => {
        // The executor persists failures in the job store.
      });
    });
  }

  async function buildJobActionResponse({
    type,
    status,
    message,
    sourceJobId,
    retryJobId = null,
    job,
  }) {
    return assertResponse('job_action', {
      api_version: LOCAL_API_VERSION,
      ok: true,
      action: {
        type,
        status,
        message,
        source_job_id: sourceJobId,
        retry_job_id: retryJobId,
      },
      job: await toJobResponse(jobStore, job, { executor }),
    });
  }

  app.use(express.json({ limit: '5mb' }));
  app.use('/js/app', express.static(APP_JS_DIR, { index: false, ...STATIC_FILE_OPTIONS }));
  app.use('/js/i18n', express.static(I18N_JS_DIR, { index: false, ...STATIC_FILE_OPTIONS }));
  app.use('/js/studio', express.static(STUDIO_JS_DIR, { index: false, ...STATIC_FILE_OPTIONS }));

  app.use((error, _req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      const response = createErrorResponse('invalid_json', ['Request body must be valid JSON.']);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    next(error);
  });

  app.get('/health', (_req, res) => {
    const payload = buildHealthPayload({
      jobsDir: jobStore.jobsDir,
      runtimeDiagnostics: runtimeDiagnosticsFactory(),
    });
    res.json(assertResponse('health', payload));
  });

  app.get('/api/examples', async (_req, res, next) => {
    try {
      res.json(await loadExampleConfigs());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/config/profiles', async (_req, res) => {
    try {
      res.json({
        api_version: LOCAL_API_VERSION,
        ok: true,
        profiles: await listShopProfiles(projectRoot),
      });
    } catch (error) {
      const response = createErrorResponse(
        'config_profiles_unavailable',
        [error instanceof Error ? error.message : String(error)],
        500
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get(['/api', '/api/'], (req, res) => {
    const payload = buildLandingPayload({
      projectRoot,
      jobsDir: jobStore.jobsDir,
    });
    sendLandingResponse(req, res, payload);
  });

  app.get('/', (req, res) => {
    const payload = buildLandingPayload({
      projectRoot,
      jobsDir: jobStore.jobsDir,
    });
    const accepted = req.accepts(['html', 'json', 'text']);
    if (accepted === 'html') {
      res.redirect(302, '/studio/');
      return;
    }
    sendLandingResponse(req, res, payload);
  });

  app.get(['/studio', '/studio/'], async (_req, res, next) => {
    try {
      res.type('html').send(await readFile(STUDIO_HTML));
    } catch (error) {
      next(error);
    }
  });

  app.get('/css/studio.css', async (_req, res, next) => {
    try {
      res.type('text/css').send(await readFile(STUDIO_CSS));
    } catch (error) {
      next(error);
    }
  });

  app.get('/js/studio-shell.js', async (_req, res, next) => {
    try {
      res.type('application/javascript').send(await readFile(STUDIO_SHELL_JS));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/studio/validate-config', async (req, res) => {
    try {
      const payload = await studioModelService.validateConfigToml(req.body?.config_toml);
      res.json({
        ok: true,
        validation: payload.summary,
        overview: payload.overview,
      });
    } catch (error) {
      const response = createErrorResponse(
        'invalid_config',
        [error instanceof Error ? error.message : String(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/design', async (req, res) => {
    try {
      const payload = await studioModelService.designFromPrompt(req.body?.description);
      res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const response = createErrorResponse(
        'design_failed',
        [error instanceof Error ? error.message : String(error)]
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/model-preview', async (req, res) => {
    try {
      const payload = await studioModelService.buildPreview({
        configToml: req.body?.config_toml,
        buildSettings: req.body?.build_settings || {},
      });
      res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'model_preview_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/import-bootstrap', async (req, res) => {
    try {
      const payload = await studioBootstrapImportService({
        projectRoot,
        runScript,
        model: toBootstrapFileInput(req.body, 'model', projectRoot),
        bom: toBootstrapFileInput(req.body, 'bom', projectRoot),
        inspection: toBootstrapFileInput(req.body, 'inspection', projectRoot),
        quality: toBootstrapFileInput(req.body, 'quality', projectRoot),
        metadata: isPlainObject(req.body?.metadata) ? req.body.metadata : {},
      });
      res.json({
        ok: true,
        ...redactBootstrapPreviewPaths(projectRoot, payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /required|unsupported|must stay inside|must be inside|failed bootstrap intake/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'import_bootstrap_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/drawing-preview', async (req, res) => {
    try {
      const payload = await studioDrawingService.buildPreview({
        configToml: req.body?.config_toml,
        drawingSettings: req.body?.drawing_settings || {},
      });
      res.json({
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /TOML parse error|Config TOML is required|must include|invalid/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_preview_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/api/studio/jobs', async (req, res) => {
    const preparedBody = await prepareStudioJobBody(req.body);
    const translated = await translateStudioJobSubmission(preparedBody, {
      async resolveArtifactRef({ job_id: jobId, artifact_id: artifactId }) {
        await jobStore.getJob(jobId);
        const artifact = await jobStore.getArtifact(jobId, artifactId);
        if (!artifact) {
          throw new Error(`No artifact ${artifactId} found for job ${jobId}.`);
        }
        if (!artifact.exists) {
          throw new Error(`Artifact ${artifact.file_name} is registered for job ${jobId}, but the file is missing.`);
        }
        const jobArtifacts = await jobStore.listArtifacts(jobId);
        return {
          jobId,
          artifact,
          jobArtifacts,
        };
      },
    });
    if (!translated.ok) {
      const response = createErrorResponse('invalid_request', translated.errors);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    await enqueueJob(translated.request, res);
  });

  app.post('/api/studio/drawing-previews/:id/dimensions', async (req, res) => {
    try {
      const payload = await studioDrawingService.updateDimension({
        previewId: req.params.id,
        dimId: req.body?.dim_id,
        valueMm: req.body?.value_mm,
        historyOp: req.body?.history_op,
      });
      res.json({
        ok: true,
        ...toPublicDrawingPreviewPayload(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /No drawing preview found|editable plan path|Could not update|dim_intent|Invalid value|positive/i.test(message) ? 400 : 500;
      const response = createErrorResponse(
        'drawing_dimension_update_failed',
        [message],
        status
      );
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/api/studio/model-previews/:id/model', async (req, res, next) => {
    const modelPath = studioModelService.getPreviewModelPath(req.params.id);
    if (!modelPath) {
      const response = createErrorResponse('preview_not_found', [`No model preview found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    try {
      res.type('model/stl').send(await readFile(modelPath));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/studio/model-previews/:id/parts/:index', async (req, res, next) => {
    const partPath = studioModelService.getPreviewPartPath(req.params.id, Number.parseInt(req.params.index, 10));
    if (!partPath) {
      const response = createErrorResponse(
        'preview_part_not_found',
        [`No preview part ${req.params.index} found for id ${req.params.id}.`],
        404
      );
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }
    try {
      res.type('model/stl').send(await readFile(partPath));
    } catch (error) {
      next(error);
    }
  });

  app.get('/jobs', async (req, res, next) => {
    try {
      const parsedLimit = Number(req.query.limit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(parsedLimit)))
        : 8;
      const jobs = await jobStore.listJobs({ limit });
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        jobs: await Promise.all(jobs.map((job) => toJobResponse(jobStore, job, { executor }))),
      };
      res.json(assertResponse('jobs', payload));
    } catch (error) {
      next(error);
    }
  });

  app.post('/jobs', async (req, res) => {
    await enqueueJob(req.body, res);
  });

  app.post('/jobs/:id/cancel', async (req, res) => {
    try {
      const cancelled = await jobStore.cancelJob(req.params.id, {
        message: 'Queued job cancelled before execution started.',
      });

      if (cancelled.ok) {
        await jobStore.appendLog(req.params.id, 'Job cancelled before execution started.');
        res.json(await buildJobActionResponse({
          type: 'cancel',
          status: 'cancelled',
          message: 'Queued job cancelled before execution started.',
          sourceJobId: req.params.id,
          job: cancelled.job,
        }));
        return;
      }

      if (cancelled.job?.status === 'running') {
        if (typeof executor.cancelRunningJob === 'function') {
          const outcome = await executor.cancelRunningJob(req.params.id, cancelled.job);
          if (outcome?.ok && outcome.job) {
            await jobStore.appendLog(req.params.id, outcome.message || 'Running job cancellation completed.');
            res.json(await buildJobActionResponse({
              type: 'cancel',
              status: 'cancelled',
              message: outcome.message || 'Running job cancelled through executor support.',
              sourceJobId: req.params.id,
              job: outcome.job,
            }));
            return;
          }

          const response = createErrorResponse(
            outcome?.code || 'job_cancel_not_supported',
            outcome?.messages || [`Job ${req.params.id} is already running. This executor does not support safe mid-command cancellation.`],
            outcome?.status || 409
          );
          res.status(response.status).json(assertResponse('error', response.body));
          return;
        }

        const response = createErrorResponse(
          'job_cancel_not_supported',
          [`Job ${req.params.id} is already running. This executor does not support safe mid-command cancellation.`],
          409
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const response = createErrorResponse(
        'job_cancel_not_supported',
        [`Job ${req.params.id} is already ${cancelled.job?.status || 'finished'}. Only queued jobs can be cancelled on this runtime.`],
        409
      );
      res.status(response.status).json(assertResponse('error', response.body));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/jobs/:id/retry', async (req, res) => {
    try {
      const sourceJob = await jobStore.getJob(req.params.id);
      const sourceStatus = String(sourceJob.status || '').toLowerCase();
      if (sourceStatus !== 'failed' && sourceStatus !== 'cancelled') {
        const response = createErrorResponse(
          'job_retry_not_supported',
          [`Job ${req.params.id} is ${sourceJob.status}. Only failed or cancelled jobs can be retried.`],
          409
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const retriedJob = await jobStore.createJob(structuredClone(sourceJob.request), {
        retriedFromJobId: sourceJob.id,
      });
      await jobStore.appendLog(retriedJob.id, `Retry queued from job ${sourceJob.id}.`);

      res.status(202).json(await buildJobActionResponse({
        type: 'retry',
        status: 'queued',
        message: `Retry queued from ${sourceStatus} job ${sourceJob.id}.`,
        sourceJobId: sourceJob.id,
        retryJobId: retriedJob.id,
        job: retriedJob,
      }));

      setImmediate(() => {
        executor.execute(retriedJob.id).catch(() => {
          // The executor persists failures in the job store.
        });
      });
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/jobs/:id', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job: await toJobResponse(jobStore, job, { executor }),
      };
      res.json(assertResponse('job', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/jobs/:id/artifacts', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const artifacts = (await jobStore.listArtifacts(req.params.id)).map((artifact) =>
        toArtifactResponse(req.params.id, artifact)
      );
      const storage = toPublicStorage(await jobStore.describeStorage(req.params.id));
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job_id: req.params.id,
        artifacts,
        manifest: redactPublicPathValues(job.manifest),
        storage,
      };
      res.json(assertResponse('artifacts', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  async function sendArtifactContent({ jobId, artifactId, download = false }, res) {
    try {
      await jobStore.getJob(jobId);
      const artifact = await jobStore.getArtifact(jobId, artifactId);
      if (!artifact) {
        const response = createErrorResponse(
          'artifact_not_found',
          [`No artifact ${artifactId} found for job ${jobId}.`],
          404
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }
      if (!artifact.exists) {
        const response = createErrorResponse(
          'artifact_missing',
          [`Artifact ${artifact.file_name} is registered for job ${jobId}, but the file is missing.`],
          404
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      res.type(inferArtifactContentType(artifact.path));
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${artifact.file_name.replaceAll('"', '')}"`
      );
      res.send(await readFile(resolve(artifact.path)));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${jobId}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  }

  app.get('/jobs/:id/artifacts/:artifactId/content', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.id,
      artifactId: req.params.artifactId,
      download: req.query.download === '1',
    }, res);
  });

  app.get('/artifacts/:jobId/:artifactId', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.jobId,
      artifactId: req.params.artifactId,
      download: false,
    }, res);
  });

  app.get('/artifacts/:jobId/:artifactId/download', async (req, res) => {
    await sendArtifactContent({
      jobId: req.params.jobId,
      artifactId: req.params.artifactId,
      download: true,
    }, res);
  });

  app.use((error, _req, res, _next) => {
    const response = createErrorResponse(
      'internal_error',
      [error instanceof Error ? error.message : String(error)],
      500
    );
    res.status(response.status).json(assertResponse('error', response.body));
  });

  server.on('close', () => {
    studioModelService.dispose().catch(() => {});
    studioDrawingService.dispose().catch(() => {});
  });

  return {
    app,
    server,
    jobStore,
    executor,
    studioModelService,
    studioDrawingService,
  };
}

export async function startLocalApiServer({
  port = 3000,
  jobsDir,
  projectRoot,
}) {
  const { server, jobStore } = createLocalApiServer({
    projectRoot,
    jobsDir,
  });

  await new Promise((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Project root: ${projectRoot}`);
  console.log(`fcad local API listening on http://127.0.0.1:${actualPort}`);
  console.log(`Studio shell: http://127.0.0.1:${actualPort}/`);
  console.log(`Direct studio route: http://127.0.0.1:${actualPort}/studio`);
  console.log(`API info page: http://127.0.0.1:${actualPort}/api`);
  console.log(`Health endpoint: http://127.0.0.1:${actualPort}/health`);
  console.log('Browser requests open the studio shell by default; JSON/text callers still reach the local API on /.');
  console.log(`Legacy viewer: fcad serve ${actualPort} --legacy-viewer`);
  console.log('If localhost resolves to another process on your machine, use 127.0.0.1 explicitly.');
  console.log(`Job store: ${jobStore.jobsDir}`);
  return { server, port: actualPort, jobsDir: jobStore.jobsDir };
}
