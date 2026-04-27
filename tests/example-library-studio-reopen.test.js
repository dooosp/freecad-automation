import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import {
  canStartTrackedArtifactRun,
  findPreferredDocsManifestArtifact,
  findPreferredReadinessReportArtifact,
  findPreferredReleaseBundleArtifact,
  findPreferredReleaseBundleManifestArtifact,
  findPreferredReviewPackArtifact,
  isReleaseBundleArtifact,
  isReleaseBundleManifestArtifact,
} from '../public/js/studio/artifact-actions.js';
import { buildArtifactOpenLabel } from '../public/js/studio/artifact-insights.js';
import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');

const CANONICAL_PACKAGES = Object.freeze([
  {
    slug: 'quality-pass-bracket',
    partId: 'quality_pass_bracket',
  },
  {
    slug: 'plate-with-holes',
    partId: 'pcb_mount_plate',
  },
  {
    slug: 'motor-mount',
    partId: 'cnc_motor_mount_bracket',
  },
  {
    slug: 'controller-housing-eol',
    partId: 'controller_housing_eol',
  },
]);

const CANONICAL_ARTIFACTS = Object.freeze([
  {
    id: 'review-pack',
    source: 'review/review_pack.json',
    fileName: 'review_pack.json',
    type: 'review-pack.json',
    label: 'Canonical review pack JSON',
    reentryTarget: 'review_pack',
    openLabel: 'Open review pack',
  },
  {
    id: 'readiness-report',
    source: 'readiness/readiness_report.json',
    fileName: 'readiness_report.json',
    type: 'readiness-report.json',
    label: 'Canonical readiness report JSON',
    reentryTarget: 'readiness_report',
    openLabel: 'Open readiness report',
  },
  {
    id: 'standard-docs-manifest',
    source: 'standard-docs/standard_docs_manifest.json',
    fileName: 'standard_docs_manifest.json',
    type: 'standard-docs.summary',
    label: 'Standard docs manifest JSON',
    reentryTarget: null,
    openLabel: 'Open',
  },
  {
    id: 'release-bundle-manifest',
    source: 'release/release_bundle_manifest.json',
    fileName: 'release_bundle_manifest.json',
    type: 'release-bundle.manifest.json',
    label: 'Release bundle manifest JSON',
    reentryTarget: null,
    openLabel: 'Open bundle manifest',
  },
  {
    id: 'release-bundle',
    source: 'release/release_bundle.zip',
    fileName: 'release_bundle.zip',
    type: 'release-bundle.zip',
    label: 'Release bundle ZIP',
    reentryTarget: 'release_bundle',
    openLabel: 'Open release bundle',
  },
]);

const STALE_AF5_FILE_NAMES = Object.freeze([
  'review-pack.json',
  'readiness-report.json',
  'standard-docs-manifest.json',
  'release-bundle-manifest.json',
  'release-bundle.zip',
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, strings));
    return strings;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, strings));
  }
  return strings;
}

function assertPortablePublicPayload(label, payload) {
  const text = JSON.stringify(payload);
  assert.equal(text.includes('/Users/'), false, `${label} should not expose local user paths`);
  assert.equal(text.includes('tmp/codex'), false, `${label} should not expose task notes`);
  assert.equal(text.includes('output/'), false, `${label} should not use ignored output as source of truth`);
  assert.equal(/\/(?:private\/)?tmp\/|\/var\/folders\//.test(text), false, `${label} should not expose temp filesystem paths`);
}

function artifactIdentityFromDocument(document = {}, partId = 'quality_pass_bracket') {
  return {
    warnings: Array.isArray(document.warnings) ? document.warnings : [],
    coverage: document.coverage || document.summary?.coverage || {},
    confidence: document.confidence || document.summary?.confidence || {},
    lineage: {
      part_id: document.part?.part_id || document.part_id || partId,
      name: document.part?.name || document.part_name || partId,
      revision: document.part?.revision || document.revision || null,
    },
    source_artifact_refs: Array.isArray(document.source_artifact_refs)
      ? document.source_artifact_refs
      : [],
  };
}

function buildAfContract({ definition, destinationPath, packageRoot, partId }) {
  if (extname(destinationPath) === '.zip') {
    const releaseManifest = readJson(join(packageRoot, 'release', 'release_bundle_manifest.json'));
    return {
      reentry_target: definition.reentryTarget,
      canonical_file_name: definition.fileName,
      artifact_identity: artifactIdentityFromDocument(releaseManifest, partId),
    };
  }

  const document = readJson(destinationPath);
  return {
    ...(definition.reentryTarget ? {
      reentry_target: definition.reentryTarget,
      canonical_file_name: definition.fileName,
    } : {}),
    artifact_identity: artifactIdentityFromDocument(document, partId),
  };
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json();
  return { response, payload };
}

function buildTrackedPackageArtifacts({ jobStore, jobId, packageRoot, jobSourceRoot, slug, partId }) {
  const artifactDir = join(jobStore.getJobDir(jobId), 'artifacts');
  mkdirSync(artifactDir, { recursive: true });

  return CANONICAL_ARTIFACTS.map((definition) => {
    const sourcePath = join(packageRoot, definition.source);
    assert.equal(existsSync(sourcePath), true, `${slug} canonical package artifact should exist: ${definition.source}`);
    assert.equal(STALE_AF5_FILE_NAMES.includes(basename(sourcePath)), false, `source should not use stale AF5 name: ${definition.source}`);

    const destinationPath = join(artifactDir, definition.fileName);
    copyFileSync(sourcePath, destinationPath);

    return {
      type: definition.type,
      path: destinationPath,
      label: definition.label,
      scope: 'user-facing',
      stability: 'stable',
      metadata: {
        af_contract: buildAfContract({ definition, destinationPath, packageRoot, partId }),
        source_package_ref: {
          slug,
          path: `${jobSourceRoot}/${definition.source}`,
        },
      },
    };
  });
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-example-reopen-'));

try {
  for (const packageDef of CANONICAL_PACKAGES) {
    const packageRoot = resolve(ROOT, 'docs', 'examples', packageDef.slug);
    const jobSourceRoot = `docs/examples/${packageDef.slug}`;
    assert.equal(existsSync(packageRoot), true, `${packageDef.slug} package should exist`);

    const { server, jobStore } = createLocalApiServer({
      projectRoot: ROOT,
      jobsDir: join(tmpRoot, packageDef.slug, 'jobs'),
    });

    const job = await jobStore.createJob({
      type: 'pack',
      readiness_report_path: `${jobSourceRoot}/readiness/readiness_report.json`,
      docs_manifest_path: `${jobSourceRoot}/standard-docs/standard_docs_manifest.json`,
      options: {
        studio: {
          source: 'example-library-package',
          source_label: packageDef.slug,
        },
      },
    });
    const manifestArtifacts = buildTrackedPackageArtifacts({
      jobStore,
      jobId: job.id,
      packageRoot,
      jobSourceRoot,
      slug: packageDef.slug,
      partId: packageDef.partId,
    });
    const manifest = await buildArtifactManifest({
      projectRoot: ROOT,
      interface: 'api',
      command: 'pack',
      jobType: 'pack',
      status: 'succeeded',
      requestId: job.id,
      artifacts: manifestArtifacts,
      timestamps: {
        created_at: job.created_at,
        started_at: job.started_at,
        finished_at: new Date().toISOString(),
      },
      details: {
        source_package: {
          slug: packageDef.slug,
          root: jobSourceRoot,
        },
        fixture: 'example-library-studio-reopen',
      },
    });
    await jobStore.completeJob(
      job.id,
      {
        example_slug: packageDef.slug,
        studio_reopen_fixture: true,
        package_root: jobSourceRoot,
        canonical_artifact_count: CANONICAL_ARTIFACTS.length,
      },
      {
        package_root: jobSourceRoot,
        canonical_artifacts: CANONICAL_ARTIFACTS.map((artifact) => artifact.fileName),
      },
      {},
      manifest
    );

    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const { response: artifactsResponse, payload: artifactsPayload } = await getJson(`${baseUrl}/jobs/${job.id}/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    assert.equal(artifactsPayload.ok, true);
    assert.equal(artifactsPayload.job_id, job.id);
    assertPortablePublicPayload(`${packageDef.slug} artifacts payload`, artifactsPayload);

    const artifacts = artifactsPayload.artifacts;
    assert.deepEqual(
      artifacts.map((artifact) => artifact.file_name).sort(),
      CANONICAL_ARTIFACTS.map((artifact) => artifact.fileName).sort()
    );
    for (const artifact of artifacts) {
      assert.equal(artifact.exists, true, `${packageDef.slug} ${artifact.file_name} should be tracked and present`);
      assert.equal(STALE_AF5_FILE_NAMES.includes(artifact.file_name), false, `${artifact.file_name} should use canonical underscore naming`);
      assert.equal(artifact.links.open, `/artifacts/${job.id}/${artifact.id}`);
      assert.equal(artifact.links.download, `/artifacts/${job.id}/${artifact.id}/download`);
      assert.equal(artifact.links.api, `/jobs/${job.id}/artifacts/${artifact.id}/content`);
      assert.equal(buildArtifactOpenLabel(artifact), CANONICAL_ARTIFACTS.find((entry) => entry.fileName === artifact.file_name).openLabel);
    }

    const reviewPack = findPreferredReviewPackArtifact(artifacts);
    const readinessReport = findPreferredReadinessReportArtifact(artifacts);
    const docsManifest = findPreferredDocsManifestArtifact(artifacts);
    const releaseBundleManifest = findPreferredReleaseBundleManifestArtifact(artifacts);
    const releaseBundle = findPreferredReleaseBundleArtifact(artifacts);

    assert.equal(reviewPack?.file_name, 'review_pack.json');
    assert.equal(readinessReport?.file_name, 'readiness_report.json');
    assert.equal(docsManifest?.file_name, 'standard_docs_manifest.json');
    assert.equal(releaseBundleManifest?.file_name, 'release_bundle_manifest.json');
    assert.equal(releaseBundle?.file_name, 'release_bundle.zip');

    assert.equal(canStartTrackedArtifactRun(reviewPack, 'readiness-pack'), true);
    assert.equal(canStartTrackedArtifactRun(readinessReport, 'generate-standard-docs'), true);
    assert.equal(canStartTrackedArtifactRun(readinessReport, 'pack'), true);
    assert.equal(canStartTrackedArtifactRun(releaseBundle, 'readiness-pack'), true);
    assert.equal(canStartTrackedArtifactRun(releaseBundle, 'generate-standard-docs'), true);
    assert.equal(canStartTrackedArtifactRun(releaseBundle, 'pack'), true);

    assert.equal(isReleaseBundleManifestArtifact(releaseBundleManifest), true);
    assert.equal(isReleaseBundleArtifact(releaseBundleManifest), false, 'release_bundle_manifest.json should not be treated as ZIP');
    assert.equal(releaseBundleManifest.extension, '.json');
    assert.match(releaseBundleManifest.content_type, /^application\/json/);
    assert.equal(isReleaseBundleArtifact(releaseBundle), true);
    assert.equal(releaseBundle.extension, '.zip');

    for (const definition of CANONICAL_ARTIFACTS) {
      const artifact = artifacts.find((entry) => entry.file_name === definition.fileName);
      const openResponse = await fetch(`${baseUrl}${artifact.links.open}`);
      assert.equal(openResponse.status, 200, `${packageDef.slug} ${definition.fileName} open route should succeed`);
      assert.match(
        openResponse.headers.get('content-disposition') || '',
        new RegExp(`filename="${definition.fileName}"`)
      );
      const bytes = await openResponse.arrayBuffer();
      assert.equal(bytes.byteLength > 0, true, `${packageDef.slug} ${definition.fileName} open route should return content`);
      if (artifact.extension === '.json') {
        assert.match(openResponse.headers.get('content-type') || '', /^application\/json/);
      }
    }

    const { response: recentResponse, payload: recentPayload } = await getJson(`${baseUrl}/jobs?limit=4`);
    assert.equal(recentResponse.status, 200);
    assert.equal(recentPayload.jobs[0].id, job.id);
    assert.equal(recentPayload.jobs[0].result.example_slug, packageDef.slug);
    assert.equal(recentPayload.jobs[0].result.package_root, jobSourceRoot);
    assert.equal(recentPayload.jobs[0].manifest.details.source_package.slug, packageDef.slug);
    assertPortablePublicPayload(`${packageDef.slug} recent jobs payload`, recentPayload);

    for (const text of collectStrings({
      packageReadme: readFileSync(join(packageRoot, 'README.md'), 'utf8'),
      packageNotes: readFileSync(join(packageRoot, 'reopen-notes.md'), 'utf8'),
      releaseManifest: readJson(join(packageRoot, 'release', 'release_bundle_manifest.json')),
    })) {
      assert.equal(text.includes('/Users/'), false, `${packageDef.slug} package text should not contain absolute local paths`);
      assert.equal(text.includes('tmp/codex'), false, `${packageDef.slug} package text should not reference task notes`);
      assert.equal(/job[-_][a-z0-9]{4,}/i.test(text), false, `${packageDef.slug} package text should not embed machine-specific job ids`);
    }

    await new Promise((resolveClose) => server.close(resolveClose));
  }

  console.log('example-library-studio-reopen.test.js: ok');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
