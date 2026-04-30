import { open, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import {
  CANONICAL_ARTIFACT_KEY_CONTRACT,
  buildCanonicalArtifactCatalog,
} from './canonical-artifact-key-contract.js';

export const CANONICAL_PACKAGE_SLUGS = Object.freeze([
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
  'hinge-block',
]);

const EVIDENCE_BOUNDARY = Object.freeze({
  release_bundle_presence_does_not_mean_production_ready:
    'Release bundle presence does not mean production-ready; readiness remains gated by the canonical readiness report.',
  quality_drawing_evidence_does_not_satisfy_inspection_evidence:
    'Quality and drawing evidence does not satisfy inspection_evidence without genuine completed inspection evidence.',
  packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached:
    'Canonical packages remain needs_more_evidence until real inspection_evidence is attached through the canonical flow.',
});

const STUDIO_BOUNDARY = Object.freeze({
  checked_in_canonical_packages_are_read_only_docs_packages:
    'Checked-in canonical packages are read-only docs packages for discovery.',
  tracked_job_artifact_reopen_remains_separate:
    'Studio tracked job/artifact reopen remains separate from checked-in canonical docs package discovery.',
});

const PREVIEW_SIZE_CAPS_BYTES = Object.freeze({
  json: 128 * 1024,
  manifest: 128 * 1024,
  markdown: 64 * 1024,
  text: 64 * 1024,
  checksum: 32 * 1024,
});

const DEFAULT_PREVIEW_SIZE_CAP_BYTES = 64 * 1024;

const CONTENT_TYPES_BY_KIND = Object.freeze({
  json: 'application/json; charset=utf-8',
  manifest: 'application/json; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  checksum: 'text/plain; charset=utf-8',
});

export const CANONICAL_ARTIFACT_PREVIEW_ROUTE = '/api/canonical-packages/:slug/artifacts/:artifactKey/preview';

function packageRelativePath(slug, suffix = '') {
  return suffix ? `docs/examples/${slug}/${suffix}` : `docs/examples/${slug}`;
}

function inspectionEvidenceRelativePath(slug) {
  return packageRelativePath(slug, 'inspection/inspection_evidence.json');
}

async function readJson(projectRoot, relativePath, { required = false } = {}) {
  try {
    const raw = await readFile(join(projectRoot, relativePath), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (required) {
      throw new Error(`Missing or invalid canonical package JSON: ${relativePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid canonical package JSON: ${relativePath}`);
    }
    return null;
  }
}

async function pathExists(projectRoot, relativePath) {
  try {
    await stat(join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function findArtifactDefinition(artifactKey) {
  return CANONICAL_ARTIFACT_KEY_CONTRACT.find((definition) => definition.key === artifactKey) || null;
}

function findArtifactCatalogEntry(pkg, artifactKey) {
  return pkg.artifact_catalog.find((entry) => entry.key === artifactKey) || null;
}

function assertSafeCanonicalArtifactPath(relativePathValue, slug) {
  if (typeof relativePathValue !== 'string' || relativePathValue.length === 0) {
    throw Object.assign(new Error('Canonical artifact is missing.'), { code: 'canonical_artifact_not_found', status: 404 });
  }
  if (
    relativePathValue.includes('\\')
    || isAbsolute(relativePathValue)
    || /^[A-Za-z]:[\\/]/.test(relativePathValue)
    || relativePathValue.startsWith('~')
    || relativePathValue.split('/').includes('..')
    || relativePathValue.startsWith('tmp/')
    || relativePathValue.startsWith('/tmp/')
    || relativePathValue.startsWith('var/folders/')
    || relativePathValue.startsWith('output/')
    || relativePathValue.includes('/Users/')
  ) {
    throw Object.assign(new Error('Canonical artifact path failed safety checks.'), {
      code: 'canonical_artifact_unsafe_path',
      status: 400,
    });
  }

  const packagePrefix = `docs/examples/${slug}/`;
  const collectionGuidePath = `docs/inspection-evidence-collection/${slug}.md`;
  if (!relativePathValue.startsWith(packagePrefix) && relativePathValue !== collectionGuidePath) {
    throw Object.assign(new Error('Canonical artifact path is outside the canonical package allowlist.'), {
      code: 'canonical_artifact_unsafe_path',
      status: 400,
    });
  }
}

async function resolveCanonicalArtifactPath(projectRoot, relativePathValue, slug) {
  assertSafeCanonicalArtifactPath(relativePathValue, slug);
  const rootRealPath = await realpath(projectRoot);
  const resolvedPath = resolve(rootRealPath, relativePathValue);
  const rootRelativePath = relative(rootRealPath, resolvedPath);
  if (rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) {
    throw Object.assign(new Error('Canonical artifact path failed repository boundary checks.'), {
      code: 'canonical_artifact_unsafe_path',
      status: 400,
    });
  }

  let fileRealPath;
  try {
    fileRealPath = await realpath(resolvedPath);
  } catch {
    throw Object.assign(new Error('Canonical artifact is not available for preview.'), {
      code: 'canonical_artifact_not_found',
      status: 404,
    });
  }
  const fileRootRelativePath = relative(rootRealPath, fileRealPath);
  if (fileRootRelativePath.startsWith('..') || isAbsolute(fileRootRelativePath)) {
    throw Object.assign(new Error('Canonical artifact path failed repository boundary checks.'), {
      code: 'canonical_artifact_unsafe_path',
      status: 400,
    });
  }
  return fileRealPath;
}

async function readPreviewContent(filePath, capBytes) {
  const fileStat = await stat(filePath);
  const sizeBytes = fileStat.size;
  if (sizeBytes <= capBytes) {
    return {
      sizeBytes,
      truncated: false,
      content: await readFile(filePath, 'utf8'),
    };
  }

  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(capBytes);
    const { bytesRead } = await handle.read(buffer, 0, capBytes, 0);
    return {
      sizeBytes,
      truncated: true,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
    };
  } finally {
    await handle.close();
  }
}

function previewWarnings(pkg, artifact) {
  const warnings = [];
  if (artifact.warning) {
    warnings.push(artifact.warning);
  }
  if (artifact.key.startsWith('release_')) {
    warnings.push(pkg.evidence_boundary.release_bundle_presence_does_not_mean_production_ready);
    warnings.push(pkg.evidence_boundary.packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached);
    if (pkg.readiness.inspection_evidence_missing) {
      warnings.push('inspection_evidence remains missing unless real completed inspection evidence is attached.');
    }
  }
  return [...new Set(warnings.filter(Boolean))];
}

async function optionalPath(projectRoot, relativePath) {
  return (await pathExists(projectRoot, relativePath)) ? relativePath : null;
}

async function readPackageTitle(projectRoot, readmePath, fallback) {
  try {
    const readme = await readFile(join(projectRoot, readmePath), 'utf8');
    const heading = readme
      .split(/\r?\n/)
      .find((line) => line.startsWith('# '));
    return heading ? heading.replace(/^#\s+/, '').trim() : fallback;
  } catch {
    return fallback;
  }
}

function readinessFromReport(readinessReport, readinessPath, inspectionEvidenceMissing) {
  const summary = readinessReport?.readiness_summary;
  if (!summary || typeof summary !== 'object') {
    throw new Error(`Canonical readiness report is missing readiness_summary: ${readinessPath}`);
  }

  const missingInputs = Array.isArray(summary.missing_inputs)
    ? summary.missing_inputs
    : [
        ...new Set([
          ...(readinessReport?.process_plan?.summary?.missing_inputs || []),
          ...(readinessReport?.quality_risk?.summary?.missing_inputs || []),
        ]),
      ];

  return {
    status: summary.status || null,
    score: summary.score ?? null,
    gate_decision: summary.gate_decision || null,
    missing_inputs: missingInputs,
    inspection_evidence_missing: inspectionEvidenceMissing,
    source_of_truth_path: readinessPath,
  };
}

async function buildCanonicalPackage(projectRoot, slug) {
  const packagePath = packageRelativePath(slug);
  const readmePath = packageRelativePath(slug, 'README.md');
  const readinessPath = packageRelativePath(slug, 'readiness/readiness_report.json');
  const reviewPackPath = packageRelativePath(slug, 'review/review_pack.json');
  const inspectionEvidencePath = inspectionEvidenceRelativePath(slug);
  const readinessReport = await readJson(projectRoot, readinessPath, { required: true });
  const inspectionEvidenceMissing = !(await pathExists(projectRoot, inspectionEvidencePath));
  const title = await readPackageTitle(projectRoot, readmePath, slug);
  const artifacts = {
    review_pack_path: await optionalPath(projectRoot, reviewPackPath),
    readiness_report_path: readinessPath,
    standard_docs_manifest_path: await optionalPath(
      projectRoot,
      packageRelativePath(slug, 'standard-docs/standard_docs_manifest.json')
    ),
    release_manifest_path: await optionalPath(
      projectRoot,
      packageRelativePath(slug, 'release/release_bundle_manifest.json')
    ),
    release_checksums_path: await optionalPath(
      projectRoot,
      packageRelativePath(slug, 'release/release_bundle_checksums.sha256')
    ),
    release_bundle_path: await optionalPath(
      projectRoot,
      packageRelativePath(slug, 'release/release_bundle.zip')
    ),
    reopen_notes_path: await optionalPath(projectRoot, packageRelativePath(slug, 'reopen-notes.md')),
  };
  const collectionGuidePath = await optionalPath(
    projectRoot,
    `docs/inspection-evidence-collection/${slug}.md`
  );

  return {
    slug,
    name: title,
    package_path: packagePath,
    readme_path: readmePath,
    readiness: readinessFromReport(readinessReport, readinessPath, inspectionEvidenceMissing),
    artifacts,
    artifact_catalog: buildCanonicalArtifactCatalog({
      readme_path: readmePath,
      collection_guide_path: collectionGuidePath,
      ...artifacts,
    }),
    evidence_boundary: { ...EVIDENCE_BOUNDARY },
    studio_boundary: { ...STUDIO_BOUNDARY },
    collection_guide_path: collectionGuidePath,
    inspection_evidence_path: inspectionEvidenceMissing ? null : inspectionEvidencePath,
  };
}

export async function buildCanonicalPackagesPayload({ projectRoot }) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    packages: await Promise.all(
      CANONICAL_PACKAGE_SLUGS.map((slug) => buildCanonicalPackage(projectRoot, slug))
    ),
  };
}

export async function buildCanonicalArtifactPreviewPayload({ projectRoot, slug, artifactKey }) {
  if (!CANONICAL_PACKAGE_SLUGS.includes(slug)) {
    throw Object.assign(new Error('Canonical package was not found.'), {
      code: 'canonical_package_not_found',
      status: 404,
    });
  }

  const definition = findArtifactDefinition(artifactKey);
  if (!definition) {
    throw Object.assign(new Error('Canonical artifact key was not found.'), {
      code: 'canonical_artifact_key_not_found',
      status: 404,
    });
  }
  if (definition.text_preview_allowed !== true) {
    throw Object.assign(new Error('Canonical artifact is not previewable as text.'), {
      code: 'canonical_artifact_preview_unsupported',
      status: 415,
    });
  }

  const pkg = await buildCanonicalPackage(projectRoot, slug);
  const artifact = findArtifactCatalogEntry(pkg, artifactKey);
  if (!artifact) {
    throw Object.assign(new Error('Canonical artifact key was not found.'), {
      code: 'canonical_artifact_key_not_found',
      status: 404,
    });
  }
  if (artifact.available !== true || typeof artifact.path !== 'string') {
    throw Object.assign(new Error('Canonical artifact is not available for preview.'), {
      code: 'canonical_artifact_not_found',
      status: 404,
    });
  }
  if (artifact.text_preview_allowed !== true) {
    throw Object.assign(new Error('Canonical artifact is not previewable as text.'), {
      code: 'canonical_artifact_preview_unsupported',
      status: 415,
    });
  }

  const filePath = await resolveCanonicalArtifactPath(projectRoot, artifact.path, slug);
  const capBytes = PREVIEW_SIZE_CAPS_BYTES[artifact.content_kind] || DEFAULT_PREVIEW_SIZE_CAP_BYTES;
  const { sizeBytes, truncated, content } = await readPreviewContent(filePath, capBytes);

  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    slug,
    artifact_key: artifact.key,
    path: artifact.path,
    content_kind: artifact.content_kind,
    content_type: CONTENT_TYPES_BY_KIND[artifact.content_kind] || 'text/plain; charset=utf-8',
    size_bytes: sizeBytes,
    truncated,
    content,
    warnings: previewWarnings(pkg, artifact),
  };
}
