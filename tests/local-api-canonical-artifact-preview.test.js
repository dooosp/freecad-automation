import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildCanonicalArtifactPreviewPayload } from '../src/server/canonical-package-discovery.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-canonical-artifact-preview-api-'));
const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: join(tmpRoot, 'jobs'),
});

const PREVIEWABLE_CASES = [
  {
    slug: 'quality-pass-bracket',
    artifactKey: 'readiness_report',
    contentKind: 'json',
    contentType: 'application/json; charset=utf-8',
    path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
    contentPattern: /"readiness_summary"/,
  },
  {
    slug: 'quality-pass-bracket',
    artifactKey: 'review_pack',
    contentKind: 'json',
    contentType: 'application/json; charset=utf-8',
    path: 'docs/examples/quality-pass-bracket/review/review_pack.json',
    contentPattern: /"review_priorities"/,
  },
  {
    slug: 'quality-pass-bracket',
    artifactKey: 'readme',
    contentKind: 'markdown',
    contentType: 'text/markdown; charset=utf-8',
    path: 'docs/examples/quality-pass-bracket/README.md',
    contentPattern: /^# /,
  },
  {
    slug: 'quality-pass-bracket',
    artifactKey: 'release_checksums',
    contentKind: 'checksum',
    contentType: 'text/plain; charset=utf-8',
    path: 'docs/examples/quality-pass-bracket/release/release_bundle_checksums.sha256',
    contentPattern: /^[a-f0-9]{64}\s{2}/,
  },
  {
    slug: 'quality-pass-bracket',
    artifactKey: 'collection_guide',
    contentKind: 'markdown',
    contentType: 'text/markdown; charset=utf-8',
    path: 'docs/inspection-evidence-collection/quality-pass-bracket.md',
    contentPattern: /^# /,
  },
];

const BLOCKED_PATH_PATTERNS = [
  /^\/|^[A-Za-z]:[\\/]/,
  /^~/,
  /^tmp\//,
  /^\/tmp\//,
  /^var\/folders\//,
  /^output\//,
];

async function listen() {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

function assertPathSafe(value) {
  assert.equal(value.includes('\\'), false, `${value} should use portable slash separators`);
  assert.equal(value.includes('..'), false, `${value} should not include traversal segments`);
  assert.equal(value.includes(ROOT), false, `${value} should not include the repo absolute path`);
  assert.equal(value.includes(tmpRoot), false, `${value} should not include temp paths`);
  assert.equal(value.includes('/Users/'), false, `${value} should not include home-directory paths`);
  assert.equal(value.includes('job_id'), false, `${value} should not expose job identifiers`);
  assert.equal(value.includes('artifact_ref'), false, `${value} should not expose tracked artifact refs`);
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    assert.equal(pattern.test(value), false, `${value} should be repo-relative and path-safe`);
  }
}

async function fetchPreview(baseUrl, slug, artifactKey) {
  return fetch(`${baseUrl}/api/canonical-packages/${slug}/artifacts/${artifactKey}/preview`, {
    headers: { accept: 'application/json' },
  });
}

try {
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}`;

  for (const previewCase of PREVIEWABLE_CASES) {
    const response = await fetchPreview(baseUrl, previewCase.slug, previewCase.artifactKey);
    assert.equal(response.headers.get('content-type')?.startsWith('application/json'), true);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(validateLocalApiResponse('canonical_artifact_preview', payload).ok, true);
    assert.equal(payload.ok, true);
    assert.equal(payload.slug, previewCase.slug);
    assert.equal(payload.artifact_key, previewCase.artifactKey);
    assert.equal(payload.path, previewCase.path);
    assert.equal(payload.content_kind, previewCase.contentKind);
    assert.equal(payload.content_type, previewCase.contentType);
    assert.equal(typeof payload.size_bytes, 'number');
    assert.equal(payload.size_bytes > 0, true);
    assert.equal(payload.truncated, false);
    assert.match(payload.content, previewCase.contentPattern);
    assert.equal(Array.isArray(payload.warnings), true);
    assert.equal(Object.hasOwn(payload, 'job_id'), false);
    assert.equal(Object.hasOwn(payload, 'artifact_id'), false);
    assertPathSafe(payload.path);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(ROOT), false);
    assert.equal(serialized.includes(tmpRoot), false);
    assert.equal(serialized.includes('/Users/'), false);
    assert.equal(serialized.includes('/tmp/'), false);
    assert.equal(serialized.includes('output/'), false);
  }

  const readinessResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', 'readiness_report');
  const readinessPayload = await readinessResponse.json();
  assert.equal(readinessPayload.content.trim().startsWith('{'), true);
  assert.notEqual(readinessPayload.content.trim(), readinessPayload);

  const releaseManifestResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', 'release_manifest');
  assert.equal(releaseManifestResponse.status, 200);
  const releaseManifestPayload = await releaseManifestResponse.json();
  assert.equal(validateLocalApiResponse('canonical_artifact_preview', releaseManifestPayload).ok, true);
  assert.equal(releaseManifestPayload.content_kind, 'manifest');
  assert.equal(releaseManifestPayload.content_type, 'application/json; charset=utf-8');
  assert.match(releaseManifestPayload.content, /"release_bundle\.zip"/);
  assert.equal(releaseManifestPayload.warnings.some((warning) => /does not mean production-ready/.test(warning)), true);
  assert.equal(releaseManifestPayload.warnings.some((warning) => /needs_more_evidence/.test(warning)), true);
  assert.equal(releaseManifestPayload.warnings.some((warning) => /inspection_evidence/.test(warning)), true);

  const unknownSlugResponse = await fetchPreview(baseUrl, 'unknown-package', 'readiness_report');
  assert.equal(unknownSlugResponse.status, 404);
  assert.equal(validateLocalApiResponse('error', await unknownSlugResponse.json()).ok, true);

  const unknownKeyResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', 'unknown_key');
  assert.equal(unknownKeyResponse.status, 404);
  assert.equal(validateLocalApiResponse('error', await unknownKeyResponse.json()).ok, true);

  const pathLikeKeyResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', '..%2FREADME.md');
  assert.equal(pathLikeKeyResponse.status, 404);
  const pathLikeError = await pathLikeKeyResponse.json();
  assert.equal(validateLocalApiResponse('error', pathLikeError).ok, true);
  assert.equal(JSON.stringify(pathLikeError).includes('/Users/'), false);
  assert.equal(JSON.stringify(pathLikeError).includes(ROOT), false);

  const releaseBundleResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', 'release_bundle');
  assert.equal(releaseBundleResponse.status, 415);
  const releaseBundleError = await releaseBundleResponse.json();
  assert.equal(validateLocalApiResponse('error', releaseBundleError).ok, true);
  assert.equal(JSON.stringify(releaseBundleError).includes('release_bundle.zip'), false);

  const stepResponse = await fetchPreview(baseUrl, 'quality-pass-bracket', 'quality_pass_bracket.step');
  assert.equal(stepResponse.status, 404);
  assert.equal(validateLocalApiResponse('error', await stepResponse.json()).ok, true);

  const truncationRoot = join(tmpRoot, 'truncation-root');
  mkdirSync(join(truncationRoot, 'docs/examples/quality-pass-bracket/readiness'), { recursive: true });
  writeFileSync(
    join(truncationRoot, 'docs/examples/quality-pass-bracket/readiness/readiness_report.json'),
    `${JSON.stringify({
      readiness_summary: {
        status: 'needs_more_evidence',
        score: 0,
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
    })}\n`
  );
  writeFileSync(
    join(truncationRoot, 'docs/examples/quality-pass-bracket/README.md'),
    `# Temporary package\n\n${'A'.repeat(70 * 1024)}`
  );
  const truncatedPayload = await buildCanonicalArtifactPreviewPayload({
    projectRoot: truncationRoot,
    slug: 'quality-pass-bracket',
    artifactKey: 'readme',
  });
  assert.equal(validateLocalApiResponse('canonical_artifact_preview', truncatedPayload).ok, true);
  assert.equal(truncatedPayload.truncated, true);
  assert.equal(truncatedPayload.size_bytes > 64 * 1024, true);
  assert.equal(Buffer.byteLength(truncatedPayload.content, 'utf8') <= 64 * 1024, true);
  assert.equal(truncatedPayload.path, 'docs/examples/quality-pass-bracket/README.md');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
