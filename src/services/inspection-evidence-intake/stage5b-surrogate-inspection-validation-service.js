import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { validateAttachableInspectionEvidence, validateInspectionEvidence } from '../../../lib/inspection-evidence.js';
import { evaluateStage5bCandidateEvidence } from '../../../lib/stage5b-candidate-evidence-gate.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';
import { assertValidStage5bSurrogateInspectionValidation } from './stage5b-runtime-validation.js';
import { writeStage5bEvidenceAuditBundle } from './stage5b-evidence-audit-service.js';

export const STAGE5B_SURROGATE_INSPECTION_VALIDATION_ARTIFACT_TYPE = 'surrogate_inspection_validation';
export const STAGE5B_SYNTHETIC_PIPELINE_FIXTURE_ARTIFACT_TYPE = 'synthetic_stage5b_pipeline_fixture';
export const STAGE5B_SURROGATE_INSPECTION_VALIDATION_FILE_NAME = 'surrogate_inspection_validation.json';
export const STAGE5B_SURROGATE_SCHEMA_VERSION = '1.0';

const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const SURROGATE_VALUE_PREFIX = 'SURROGATE_NON_EVIDENCE';
const REJECTED_AS_FINAL_EVIDENCE = Object.freeze([
  'surrogate inspection validation artifacts',
  'synthetic Stage 5B pipeline fixtures',
  'generated CAD/spec/doc values',
  'intake reports',
  'promotion dry-run manifests',
  'audit manifests',
  'authorization records',
  'fixtures',
  'templates',
  'collection guides',
  'CI/GitHub metadata',
  'release bundles',
]);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function assertPathInsideProject(projectRoot, pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw new Error(`${label} is required`);
  }
  if (pathValue.includes('\0') || pathValue.includes('\\') || pathValue.startsWith('~') || isWindowsAbsolutePath(pathValue)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  return { absolute, relative: rel };
}

function repoRelativePath(projectRoot, pathValue) {
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : pathValue;
}

async function writeJsonFile(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return pathValue;
}

async function readJsonIfExists(projectRoot, relativePath) {
  try {
    return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

async function findPackageJsonFile(projectRoot, slug, directory, suffix) {
  const relativeDir = `docs/examples/${slug}/${directory}`;
  try {
    const names = await readdir(resolve(projectRoot, relativeDir));
    const match = names.find((name) => name.endsWith(suffix));
    return match ? `${relativeDir}/${match}` : null;
  } catch {
    return null;
  }
}

function readinessStateFromDocument(slug, document = {}) {
  const summary = safeObject(document.readiness_summary || document.summary);
  const missingInputs = safeList(summary.missing_inputs).length > 0
    ? summary.missing_inputs
    : ['inspection_evidence'];
  return {
    status: summary.status || 'needs_more_evidence',
    score: typeof summary.score === 'number' ? summary.score : null,
    gate_decision: summary.gate_decision || 'hold_for_evidence_completion',
    missing_inputs: uniqueStrings([...missingInputs, 'inspection_evidence']),
    inspection_evidence_missing: true,
    source_of_truth_path: `docs/examples/${slug}/readiness/readiness_report.json`,
  };
}

function featureIdList(value) {
  if (Array.isArray(value)) return uniqueStrings(value.map(String));
  return uniqueStrings(String(value || '')
    .split(/[,;|]/)
    .flatMap((part) => part.split(/\s+and\s+/i))
    .map((part) => part.trim()));
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function firstNumericDimension(dimensions = {}) {
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { key, value };
    }
  }
  return null;
}

function valueFromFeature(feature = {}, dimensionType = null) {
  const dimensions = safeObject(feature.dimensions);
  const type = normalizeToken(dimensionType);
  if (type && typeof dimensions[`${type}_mm`] === 'number') return dimensions[`${type}_mm`];
  if (type === 'diameter' && typeof dimensions.diameter_mm === 'number') return dimensions.diameter_mm;
  if (type === 'radius' && typeof dimensions.radius_mm === 'number') return dimensions.radius_mm;
  const first = firstNumericDimension(dimensions);
  return first ? first.value : null;
}

function dimensionLabel(dimension = {}, index = 0) {
  return dimension.id || dimension.label || dimension.feature || `SURROGATE_DIMENSION_${index + 1}`;
}

function representativeDimensions({
  drawingIntent = {},
  featureCatalog = {},
  drawingIntentPath = null,
  featureCatalogPath = null,
}) {
  const features = safeList(featureCatalog.features);
  const featureByToken = new Map(features.flatMap((feature) => {
    const ids = [feature.feature_id, feature.id].filter(Boolean).map(normalizeToken);
    return ids.map((id) => [id, feature]);
  }));

  const requiredDimensions = safeList(drawingIntent.required_dimensions)
    .filter((dimension) => dimension && typeof dimension === 'object' && dimension.required !== false)
    .slice(0, 3)
    .map((dimension, index) => {
      const featureIds = featureIdList(dimension.feature || dimension.feature_id || dimension.feature_ids);
      const feature = featureIds.map((id) => featureByToken.get(normalizeToken(id))).find(Boolean) || {};
      const value = typeof dimension.value_mm === 'number'
        ? dimension.value_mm
        : valueFromFeature(feature, dimension.dimension_type);
      return {
        requirement_ref: dimension.id || `SURROGATE_REQUIREMENT_${index + 1}`,
        feature_id: featureIds[0] || feature.feature_id || feature.id || `surrogate_feature_${index + 1}`,
        drawing_ref: drawingIntentPath,
        label: dimension.label || dimension.reason || dimensionLabel(dimension, index),
        dimension_type: dimension.dimension_type || 'unknown',
        value_mm: value,
        value_source: value === null ? 'repo_local_dimension_metadata_missing' : 'repo_local_drawing_intent',
        source_paths: uniqueStrings([drawingIntentPath, featureCatalogPath].filter(Boolean)),
      };
    });

  if (requiredDimensions.length > 0) return requiredDimensions;

  return features.slice(0, 3).map((feature, index) => {
    const firstDimension = firstNumericDimension(safeObject(feature.dimensions));
    return {
      requirement_ref: `SURROGATE_FEATURE_${index + 1}`,
      feature_id: feature.feature_id || feature.id || `surrogate_feature_${index + 1}`,
      drawing_ref: featureCatalogPath,
      label: feature.type || `Feature ${index + 1}`,
      dimension_type: firstDimension?.key || 'unknown',
      value_mm: firstDimension?.value ?? null,
      value_source: firstDimension ? 'repo_local_feature_catalog' : 'repo_local_feature_catalog_without_numeric_value',
      source_paths: uniqueStrings([featureCatalogPath].filter(Boolean)),
    };
  });
}

function labeledValue(value, sourceLabel) {
  const normalizedValue = value === null || value === undefined ? 'unknown' : String(value);
  return `${SURROGATE_VALUE_PREFIX}:${sourceLabel}:${normalizedValue}`;
}

function buildInspectionShape({ slug, dimensions, generatedAt }) {
  return {
    schema_version: '1.0',
    evidence_type: 'inspection_evidence',
    source_type: 'other_inspection_source',
    package_id: slug,
    inspected_part: slug,
    part_revision: `${SURROGATE_VALUE_PREFIX}:repo_local_revision_unknown`,
    inspected_at: generatedAt,
    inspection_status: 'synthetic_surrogate_non_evidence_completed_fixture',
    inspector: `${SURROGATE_VALUE_PREFIX}:automated_fixture_generator`,
    reviewed_by: `${SURROGATE_VALUE_PREFIX}:automated_fixture_validator`,
    measurement_system: 'metric',
    units: 'mm',
    source_ref: `docs/examples/${slug}/inspection/surrogate_inspection_validation.json`,
    measured_features: dimensions.map((dimension, index) => ({
      feature_id: dimension.feature_id,
      drawing_ref: dimension.drawing_ref,
      requirement_ref: dimension.requirement_ref,
      nominal_value: labeledValue(dimension.value_mm, dimension.value_source),
      measured_value: labeledValue(dimension.value_mm, 'repo_local_spec_similarity_value'),
      tolerance_upper: null,
      tolerance_lower: null,
      units: 'mm',
      result: 'not_measured',
      measurement_method: 'synthetic_surrogate_non_evidence_from_repo_local_cad_spec',
      measurement_source: 'repo_local_spec_surrogate_non_evidence',
      value_origin: 'repo_local_spec_surrogate_non_evidence',
      canonical_evidence_eligible: false,
      surrogate_note: `Synthetic surrogate/non-evidence value ${index + 1}; validates automation parsing only.`,
    })),
    overall_result: 'unknown',
    traceability_refs: [
      `${SURROGATE_VALUE_PREFIX}:repo-local-docs-examples`,
      `${SURROGATE_VALUE_PREFIX}:automation-readiness-only`,
    ],
    notes: 'Synthetic surrogate non-evidence record generated from repo-local specs/CAD metadata only. It is not physical, supplier, lab, or QA inspection evidence and cannot unlock inspection_evidence, ready, or product inspection readiness.',
  };
}

function redactionCheck(record) {
  const text = JSON.stringify(record);
  return {
    no_private_urls: !/https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])|[^/\s]+\.local)/i.test(text),
    no_absolute_paths: !/(?:\/Users\/|\/private\/|[A-Za-z]:\\|\\\\)/.test(text),
    no_tokens_or_secrets: !/(?:authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]+|github_pat_|gho_|access_token=|token=|secret=|api[_-]?key=)/i.test(text),
  };
}

function allRedactionChecksPass(check = {}) {
  return check.no_private_urls === true
    && check.no_absolute_paths === true
    && check.no_tokens_or_secrets === true;
}

function buildOutputRef(projectRoot, pathValue, artifactType, sha256 = null) {
  return {
    path: repoRelativePath(projectRoot, pathValue),
    artifact_type: artifactType,
    sha256,
  };
}

async function sha256IfReadable(pathValue) {
  try {
    return createHash('sha256').update(await readFile(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

async function buildPackageSurrogateValidation({
  projectRoot,
  slug,
  generatedAt,
  auditManifest,
}) {
  const drawingIntentPath = await findPackageJsonFile(projectRoot, slug, 'drawing', '_drawing_intent.json');
  const featureCatalogPath = await findPackageJsonFile(projectRoot, slug, 'drawing', '_feature_catalog.json');
  const readinessPath = `docs/examples/${slug}/readiness/readiness_report.json`;
  const drawingIntent = drawingIntentPath ? await readJsonIfExists(projectRoot, drawingIntentPath) : {};
  const featureCatalog = featureCatalogPath ? await readJsonIfExists(projectRoot, featureCatalogPath) : {};
  const readinessDocument = await readJsonIfExists(projectRoot, readinessPath);
  const readiness = readinessStateFromDocument(slug, readinessDocument || {});
  const dimensions = representativeDimensions({
    drawingIntent: drawingIntent || {},
    featureCatalog: featureCatalog || {},
    drawingIntentPath,
    featureCatalogPath,
  });
  const inspectionShape = buildInspectionShape({ slug, dimensions, generatedAt });
  const parserValidation = validateInspectionEvidence(inspectionShape);
  const attachableValidation = validateAttachableInspectionEvidence(inspectionShape, {
    evidencePath: `docs/examples/${slug}/inspection/surrogate_inspection_validation.json`,
    expectedPackageSlug: slug,
  });
  const candidateGate = evaluateStage5bCandidateEvidence({
    document: inspectionShape,
    candidatePath: `docs/examples/${slug}/inspection/surrogate_inspection_validation.json`,
    generatedAt,
  });
  const redaction = redactionCheck(inspectionShape);
  const surrogateRecord = {
    artifact_type: STAGE5B_SYNTHETIC_PIPELINE_FIXTURE_ARTIFACT_TYPE,
    surrogate_id: `surrogate:${slug}:repo-local-spec-values`,
    surrogate_lane_only: true,
    synthetic: true,
    non_evidence: true,
    canonical_evidence_eligible: false,
    source_artifacts: {
      drawing_intent: drawingIntentPath,
      feature_catalog: featureCatalogPath,
      readiness_report: readinessPath,
    },
    parser_validation: {
      inspection_evidence_contract_ok: parserValidation.ok,
      errors: parserValidation.errors,
    },
    redaction_validation: redaction,
    package_mapping: {
      matched_package: slug,
      match_confidence: 'surrogate_direct_package_slug',
      mapping_source: 'repo-local docs/examples package slug and drawing intent metadata',
      canonical_evidence_match_confidence: 'none',
    },
    inspection_shape: inspectionShape,
  };

  return {
    slug,
    source_artifacts: surrogateRecord.source_artifacts,
    surrogate_lane: {
      status: 'accepted_surrogate_non_evidence',
      parser_contract_validated: parserValidation.ok,
      redaction_contract_validated: allRedactionChecksPass(redaction),
      package_mapping_validated: true,
      gate_behavior_validated: candidateGate.decision?.result === 'reject',
      audit_reporting_validated: auditManifest?.summary?.readiness_remains_held === true,
      readiness_message_validated: /needs_more_evidence \/ hold_for_evidence_completion/i.test(String(auditManifest?.readiness_held_truth?.statement || '')),
    },
    canonical_evidence_rejection: {
      candidate_gate_decision: candidateGate.decision?.result || 'reject',
      rejection_codes: uniqueStrings(candidateGate.summary?.rejection_codes || []),
      attachable_evidence_valid: attachableValidation.ok,
      attachable_validation_errors: attachableValidation.errors,
      canonical_intake_classification: 'invalid_generated',
      evidence_attached: false,
      product_inspection_readiness: false,
      readiness_unlock_allowed: false,
    },
    readiness_after_surrogate: readiness,
    surrogate_records: [surrogateRecord],
  };
}

export async function buildStage5bSurrogateInspectionValidation({
  projectRoot,
  outDir,
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  generatedAt = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const outputDir = assertPathInsideProject(resolvedRoot, outDir || 'output/stage5b-surrogate-inspection-validation', 'surrogate validation out-dir');
  const slugs = safeList(packageSlugs).length > 0 ? packageSlugs.map(String) : [...CANONICAL_PACKAGE_SLUGS];
  const generated = nowIso(generatedAt);
  const auditResult = await writeStage5bEvidenceAuditBundle({
    projectRoot: resolvedRoot,
    outDir: join(outputDir.absolute, 'canonical_evidence_audit'),
    packageSlugs: slugs,
    includeGitHub: false,
    generatedAt: generated,
  });
  const packages = [];
  for (const slug of slugs) {
    packages.push(await buildPackageSurrogateValidation({
      projectRoot: resolvedRoot,
      slug,
      generatedAt: generated,
      auditManifest: auditResult.manifest,
    }));
  }
  const surrogateRecordCount = packages.reduce((count, pkg) => count + safeList(pkg.surrogate_records).length, 0);
  const surrogateAcceptedCount = packages.reduce((count, pkg) => (
    count + safeList(pkg.surrogate_records).filter((record) => (
      record.synthetic === true
      && record.non_evidence === true
      && record.canonical_evidence_eligible === false
      && record.parser_validation?.inspection_evidence_contract_ok === true
    )).length
  ), 0);

  return {
    artifact_type: STAGE5B_SURROGATE_INSPECTION_VALIDATION_ARTIFACT_TYPE,
    schema_version: STAGE5B_SURROGATE_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: true,
    non_evidence: true,
    surrogate_lane_only: true,
    requested_package_slugs: slugs,
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      synthetic_surrogate_values_are_not_evidence: true,
      surrogate_records_cannot_unlock_readiness: true,
      canonical_evidence_attached: false,
      product_inspection_readiness: false,
      canonical_artifacts_mutated: false,
      rejected_as_final_evidence: [...REJECTED_AS_FINAL_EVIDENCE],
    },
    canonical_evidence_audit: {
      outputs: auditResult.manifest.outputs,
      summary: {
        genuine_inspection_evidence_found: auditResult.manifest.summary.genuine_inspection_evidence_found,
        promotion_can_run: auditResult.manifest.summary.promotion_can_run,
        readiness_remains_held: auditResult.manifest.summary.readiness_remains_held,
        canonical_artifacts_mutated: auditResult.manifest.summary.canonical_artifacts_mutated,
      },
      readiness_held_truth: auditResult.manifest.readiness_held_truth,
      blockers: auditResult.manifest.blockers,
    },
    packages,
    summary: {
      package_count: packages.length,
      surrogate_package_count: packages.filter((pkg) => pkg.surrogate_lane?.status === 'accepted_surrogate_non_evidence').length,
      surrogate_record_count: surrogateRecordCount,
      surrogate_records_accepted_by_surrogate_lane: surrogateAcceptedCount,
      genuine_inspection_evidence_found: false,
      evidence_attached: false,
      product_inspection_readiness: false,
      canonical_artifacts_mutated: false,
      readiness_remains_held: true,
      readiness_truth: 'surrogate inspection validation proves automation readiness only; canonical packages remain needs_more_evidence / hold_for_evidence_completion until genuine completed physical/supplier/lab/QA evidence is attached in a later authorized task',
    },
  };
}

export async function writeStage5bSurrogateInspectionValidationBundle({
  projectRoot,
  outDir,
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  generatedAt = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const outputDir = assertPathInsideProject(resolvedRoot, outDir || 'output/stage5b-surrogate-inspection-validation', 'surrogate validation out-dir');
  await mkdir(outputDir.absolute, { recursive: true });
  const manifest = await buildStage5bSurrogateInspectionValidation({
    projectRoot: resolvedRoot,
    outDir: outputDir.absolute,
    packageSlugs,
    generatedAt,
  });
  const manifestPath = join(outputDir.absolute, STAGE5B_SURROGATE_INSPECTION_VALIDATION_FILE_NAME);
  assertValidStage5bSurrogateInspectionValidation(manifest, {
    label: 'surrogate inspection validation',
    artifactPath: manifestPath,
    projectRoot: resolvedRoot,
  });
  await writeJsonFile(manifestPath, manifest);
  const sha256 = await sha256IfReadable(manifestPath);
  return {
    manifest,
    manifest_path: repoRelativePath(resolvedRoot, manifestPath),
    output_dir: outputDir.relative,
    outputs: {
      surrogate_inspection_validation: buildOutputRef(
        resolvedRoot,
        manifestPath,
        STAGE5B_SURROGATE_INSPECTION_VALIDATION_ARTIFACT_TYPE,
        sha256
      ),
      canonical_evidence_audit: manifest.canonical_evidence_audit.outputs,
    },
  };
}
