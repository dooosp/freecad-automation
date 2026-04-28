import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import { buildCanonicalArtifactCatalog } from './canonical-artifact-key-contract.js';

export const CANONICAL_PACKAGE_SLUGS = Object.freeze([
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
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
