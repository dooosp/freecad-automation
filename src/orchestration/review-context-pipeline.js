import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  writeJsonFile,
} from '../../lib/context-loader.js';
import { AttachmentAuthorizationValidationError } from '../../lib/inspection-evidence.js';
import { publishAtomicOutputSet } from '../../lib/atomic-output-publication.js';
import { assertValidDArtifact } from '../../lib/d-artifact-schema.js';
import { resolveModelAnalysisInputs } from '../../lib/model-analysis.js';
import {
  RevisionLineageError,
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineageSnapshotCurrent,
  buildRevisionLineage,
  buildRevisionLineageParent,
  readAuthoritativeConfigSnapshot,
} from '../../lib/revision-lineage-contract.js';
import { generateConfigFromAnalysis } from '../api/model.js';
import { assertSafeStage5bInputFile } from '../shared/stage5b-path-boundary.js';
import { verifyCanonicalInspectionEvidenceAttachment } from '../services/inspection-evidence-intake/inspection-evidence-onboarding-service.js';
import { summarizeInspectionEvidenceResults } from '../../lib/inspection-evidence-onboarding.js';

function normalizeJsonOutputPath(pathValue) {
  if (!pathValue) return null;
  const absPath = resolve(pathValue);
  return absPath.toLowerCase().endsWith('.json') ? absPath : `${absPath}.json`;
}

function siblingArtifactPath(primaryJsonPath, suffix) {
  const stem = deriveArtifactStem(primaryJsonPath, 'review_context');
  return artifactPathFor(dirname(primaryJsonPath), stem, suffix);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

const PACKAGE_EVIDENCE_SPECS = Object.freeze([
  Object.freeze({
    key: 'createQualityPath',
    artifactType: 'create_quality_report',
    evidenceType: 'create_quality_report',
    label: 'Create quality report',
    classifications: ['quality_evidence'],
  }),
  Object.freeze({
    key: 'drawingQualityPath',
    artifactType: 'drawing_quality_report',
    evidenceType: 'drawing_quality_report',
    label: 'Drawing quality report',
    classifications: ['quality_evidence', 'drawing_evidence'],
  }),
  Object.freeze({
    key: 'drawingQaPath',
    artifactType: 'drawing_qa_report',
    evidenceType: 'drawing_qa_report',
    label: 'Drawing QA report',
    classifications: ['quality_evidence', 'drawing_evidence'],
  }),
  Object.freeze({
    key: 'drawingIntentPath',
    artifactType: 'drawing_intent',
    evidenceType: 'drawing_intent',
    label: 'Drawing intent',
    classifications: ['design_traceability_evidence', 'advisory_context'],
  }),
  Object.freeze({
    key: 'featureCatalogPath',
    artifactType: 'feature_catalog',
    evidenceType: 'feature_catalog',
    label: 'Feature catalog',
    classifications: ['design_traceability_evidence', 'advisory_context'],
  }),
  Object.freeze({
    key: 'dfmReportPath',
    artifactType: 'dfm_report',
    evidenceType: 'dfm_report',
    label: 'DFM report',
    classifications: ['quality_evidence'],
  }),
]);

function portableRepoPath(projectRoot, inputPath) {
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(inputPath);
  const relPath = relative(resolvedRoot, resolvedPath).replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('..') || relPath.startsWith('/')) {
    return {
      ok: false,
      sourceRef: basename(resolvedPath),
      warning: `Package evidence input ${basename(resolvedPath)} is outside the repository and was not linked as canonical evidence.`,
    };
  }
  if (relPath === 'output' || relPath.startsWith('output/')) {
    return {
      ok: false,
      sourceRef: relPath,
      warning: 'Package evidence input under ignored output/ was not linked as canonical evidence.',
    };
  }
  if (relPath === 'tmp/codex' || relPath.startsWith('tmp/codex/')) {
    return {
      ok: false,
      sourceRef: relPath,
      warning: 'Package evidence input under the task-status scratch area was not linked as canonical evidence.',
    };
  }
  if (relPath === 'local/stage5b-candidate-evidence-inbox' || relPath.startsWith('local/stage5b-candidate-evidence-inbox/')) {
    return {
      ok: false,
      sourceRef: relPath,
      warning: 'Package evidence input under the ignored Stage 5B candidate inbox was not linked as canonical evidence.',
    };
  }
  return {
    ok: true,
    sourceRef: relPath,
    warning: null,
  };
}

async function buildPackageEvidenceRecords(projectRoot, sideInputPaths = {}) {
  const records = [];
  const warnings = [];

  for (const spec of PACKAGE_EVIDENCE_SPECS) {
    const inputPath = sideInputPaths[spec.key];
    if (!inputPath) continue;

    const portable = portableRepoPath(projectRoot, inputPath);
    if (!portable.ok) {
      warnings.push(portable.warning);
      continue;
    }

    const fileBuffer = await readFile(inputPath);
    const fileStat = await stat(inputPath);
    records.push({
      evidence_id: `package:${spec.evidenceType}:${portable.sourceRef}`,
      type: spec.evidenceType,
      artifact_type: spec.artifactType,
      category: spec.classifications[0],
      classifications: spec.classifications,
      source_ref: portable.sourceRef,
      file_name: basename(portable.sourceRef),
      size_bytes: fileStat.size,
      sha256: createHash('sha256').update(fileBuffer).digest('hex'),
      label: spec.label,
      inspection_evidence: false,
      rationale: `${spec.label} supplied as explicit review-context package side input.`,
    });
  }

  if (records.length > 0) {
    warnings.push('Package quality/drawing side inputs are review evidence, but they do not satisfy inspection_evidence without a genuine inspection input.');
  }

  return { records, warnings: uniqueWarnings(warnings) };
}

async function buildInspectionEvidenceRecord(
  projectRoot,
  inspectionEvidencePath,
  attachmentAuthorizationPath = null,
  attachmentRecordPath = null
) {
  if (!inspectionEvidencePath) {
    return { record: null, warning: null };
  }

  const evidenceBoundary = await assertSafeStage5bInputFile(projectRoot, inspectionEvidencePath, {
    label: 'review-context inspection evidence',
  });
  const portable = {
    ok: true,
    sourceRef: evidenceBoundary.relative,
    warning: null,
  };

  if (!attachmentAuthorizationPath) {
    throw new AttachmentAuthorizationValidationError([
      'review-context --inspection-evidence requires the canonical checksum-bound --attachment-authorization <inspection_evidence_authorization.json> produced by quarantine onboarding',
    ], { path: inspectionEvidencePath });
  }

  const authorizationBoundary = await assertSafeStage5bInputFile(projectRoot, attachmentAuthorizationPath, {
    label: 'review-context attachment authorization',
  });
  const authorizationPortable = {
    ok: true,
    sourceRef: authorizationBoundary.relative,
    warning: null,
  };

  if (!attachmentRecordPath) {
    throw new AttachmentAuthorizationValidationError([
      'review-context --inspection-evidence requires --evidence-attachment-record <inspection_evidence_attachment.json>; authorization alone cannot prove attachment',
    ], { path: inspectionEvidencePath });
  }
  const verifiedAttachment = await verifyCanonicalInspectionEvidenceAttachment(projectRoot, attachmentRecordPath);
  if (verifiedAttachment.envelopeArtifact.path !== portable.sourceRef) {
    throw new AttachmentAuthorizationValidationError([
      'supplied inspection evidence path does not match the immutable attachment record',
    ], { path: inspectionEvidencePath });
  }
  if (verifiedAttachment.authorizationArtifact.path !== authorizationPortable.sourceRef) {
    throw new AttachmentAuthorizationValidationError([
      'supplied attachment authorization path does not match the immutable attachment record',
    ], { path: attachmentAuthorizationPath });
  }
  const inspectionEvidence = verifiedAttachment.envelope;
  const inspectionResult = summarizeInspectionEvidenceResults(inspectionEvidence);

  const fileBuffer = await readFile(evidenceBoundary.absolute);
  const fileStat = await stat(evidenceBoundary.absolute);
  const authorizationBuffer = await readFile(authorizationBoundary.absolute);
  const authorizationStat = await stat(authorizationBoundary.absolute);
  const attachmentRecordStat = await stat(resolve(projectRoot, verifiedAttachment.receiptRef));
  return {
    record: {
      evidence_id: `package:inspection_evidence:${portable.sourceRef}`,
      type: 'inspection_evidence',
      artifact_type: 'inspection_evidence',
      category: 'inspection_evidence',
      classifications: ['inspection_evidence'],
      source_ref: portable.sourceRef,
      file_name: basename(portable.sourceRef),
      size_bytes: fileStat.size,
      sha256: createHash('sha256').update(fileBuffer).digest('hex'),
      label: 'Inspection evidence',
      inspection_evidence: true,
      rationale: 'Canonical inspection evidence verified through the immutable onboarding attachment chain.',
      inspection_result: inspectionResult,
      attachment_authorization: {
        record_type: 'inspection_evidence_attachment_authorization',
        source_ref: authorizationPortable.sourceRef,
        file_name: basename(authorizationPortable.sourceRef),
        size_bytes: authorizationStat.size,
        sha256: createHash('sha256').update(authorizationBuffer).digest('hex'),
        inspection_evidence: false,
        rationale: 'Control metadata authorizing this later attachment; not inspection evidence.',
      },
      attachment_record: {
        record_type: 'inspection_evidence_attachment_record',
        source_ref: verifiedAttachment.receiptRef,
        file_name: basename(verifiedAttachment.receiptRef),
        sha256: verifiedAttachment.receiptSha256,
        size_bytes: attachmentRecordStat.size,
        attachment_id: verifiedAttachment.receipt.attachment_id,
        package_revision: verifiedAttachment.receipt.package_revision,
        source_document_sha256: verifiedAttachment.receipt.source_document_sha256,
        inspection_evidence: false,
        rationale: 'Immutable attachment trust anchor; not inspection evidence by itself.',
      },
    },
    packageRevision: verifiedAttachment.receipt.package_revision,
    subjectIdentifier: verifiedAttachment.envelope.subject.identifier,
    warning: null,
  };
}

function normalizeBootstrapConfidenceMap(value) {
  const confidenceMap = safeObject(value);
  if (Object.keys(confidenceMap).length === 0) {
    return {};
  }

  if (
    Object.hasOwn(confidenceMap, 'import_bootstrap')
    || Object.hasOwn(confidenceMap, 'geometry_intelligence')
    || Object.hasOwn(confidenceMap, 'manufacturing_hotspots')
    || Object.hasOwn(confidenceMap, 'review_pack')
  ) {
    return {
      artifact_type: confidenceMap.artifact_type || 'confidence_map',
      generated_at: confidenceMap.generated_at || null,
      import_bootstrap: safeObject(confidenceMap.import_bootstrap),
      geometry_intelligence: confidenceMap.geometry_intelligence || null,
      manufacturing_hotspots: confidenceMap.manufacturing_hotspots || null,
      review_pack: confidenceMap.review_pack || null,
    };
  }

  return {
    artifact_type: 'confidence_map',
    generated_at: null,
    import_bootstrap: (
      Object.hasOwn(confidenceMap, 'overall')
      || Object.hasOwn(confidenceMap, 'part_vs_assembly')
      || Object.hasOwn(confidenceMap, 'unit_assumption')
      || Object.hasOwn(confidenceMap, 'feature_extraction')
    )
      ? confidenceMap
      : { overall: confidenceMap },
    geometry_intelligence: null,
    manufacturing_hotspots: null,
    review_pack: null,
  };
}

function normalizeBootstrapDiagnostics(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  }
  const objectValue = safeObject(value);
  return Object.keys(objectValue).length > 0 ? [objectValue] : [];
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function featureCollectionCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function shouldRequireBootstrapCorrection({ importDiagnostics = {}, usedMetadataOnlyFallback = false } = {}) {
  const diagnostics = safeObject(importDiagnostics);
  const conditions = safeObject(diagnostics.conditions);
  const unitAssumption = safeObject(diagnostics.unit_assumption);
  return Boolean(
    diagnostics.partial_import === true
    || conditions.partial_import === true
    || unitAssumption.assumed !== false
    || usedMetadataOnlyFallback
    || diagnostics.fallback_used === true
  );
}

function buildImportBootstrapConfidenceMap({
  bootstrapConfidenceSeed = {},
  analysisInputs,
  importDiagnostics = {},
}) {
  if (Object.keys(bootstrapConfidenceSeed).length > 0) {
    return bootstrapConfidenceSeed.import_bootstrap;
  }

  if (analysisInputs.stepFeatureResult?.confidence_map) {
    return analysisInputs.stepFeatureResult.confidence_map;
  }

  const diagnostics = safeObject(importDiagnostics);
  const unitAssumption = safeObject(diagnostics.unit_assumption);
  const inferredOverall = {
    level: analysisInputs.usedMetadataOnlyFallback ? 'low' : 'heuristic',
    score: analysisInputs.usedMetadataOnlyFallback ? 0.3 : 0.64,
    rationale: analysisInputs.usedMetadataOnlyFallback
      ? 'Bootstrap relied on metadata-only fallback because runtime-backed geometry inspection could not produce stronger shape evidence.'
      : 'Bootstrap confidence is derived from import diagnostics plus runtime-backed or STEP-derived geometry support when available.',
  };

  return {
    overall: inferredOverall,
    part_vs_assembly: {
      level: analysisInputs.usedMetadataOnlyFallback ? 'low' : 'medium',
      score: analysisInputs.usedMetadataOnlyFallback ? 0.34 : 0.64,
      rationale: diagnostics.import_kind
        ? `Classified import as ${diagnostics.import_kind} using the available import diagnostics.`
        : 'Part-versus-assembly classification is bounded by the available import diagnostics.',
    },
    unit_assumption: {
      level: unitAssumption.assumed === false ? 'high' : analysisInputs.usedMetadataOnlyFallback ? 'low' : 'medium',
      score: unitAssumption.assumed === false ? 0.92 : analysisInputs.usedMetadataOnlyFallback ? 0.35 : 0.6,
      rationale: unitAssumption.rationale
        || 'Unit handling remains bounded by the available import diagnostics.',
    },
    feature_extraction: analysisInputs.usedMetadataOnlyFallback
      ? {
        level: 'low',
        score: 0.2,
        rationale: 'Feature extraction relied on metadata-only fallback rather than shape-derived STEP evidence.',
      }
      : {
        level: 'heuristic',
        score: 0.64,
        rationale: 'Feature extraction confidence is inferred from the available bootstrap diagnostics.',
      },
  };
}

function buildOutputPaths({ outputPath, outDir, defaultStem }) {
  const primaryOutputPath = normalizeJsonOutputPath(outputPath)
    || artifactPathFor(resolve(outDir), defaultStem, '_review_pack.json');
  return {
    reviewPackJson: primaryOutputPath,
    reviewPackMarkdown: siblingArtifactPath(primaryOutputPath, '_review_pack.md'),
    reviewPackPdf: siblingArtifactPath(primaryOutputPath, '_review_pack.pdf'),
    context: siblingArtifactPath(primaryOutputPath, '_context.json'),
    engineeringContext: siblingArtifactPath(primaryOutputPath, '_engineering_context.json'),
    ingestLog: siblingArtifactPath(primaryOutputPath, '_ingest_log.json'),
    importDiagnostics: siblingArtifactPath(primaryOutputPath, '_import_diagnostics.json'),
    bootstrapSummary: siblingArtifactPath(primaryOutputPath, '_bootstrap_summary.json'),
    bootstrapWarnings: siblingArtifactPath(primaryOutputPath, '_bootstrap_warnings.json'),
    confidenceMap: siblingArtifactPath(primaryOutputPath, '_confidence_map.json'),
    draftConfig: artifactPathFor(dirname(primaryOutputPath), deriveArtifactStem(primaryOutputPath, defaultStem), '_draft_config.toml'),
    geometry: siblingArtifactPath(primaryOutputPath, '_geometry_intelligence.json'),
    hotspots: siblingArtifactPath(primaryOutputPath, '_manufacturing_hotspots.json'),
    inspectionLinkage: siblingArtifactPath(primaryOutputPath, '_inspection_linkage.json'),
    inspectionOutliers: siblingArtifactPath(primaryOutputPath, '_inspection_outliers.json'),
    qualityLinkage: siblingArtifactPath(primaryOutputPath, '_quality_linkage.json'),
    qualityHotspots: siblingArtifactPath(primaryOutputPath, '_quality_hotspots.json'),
    reviewPriorities: siblingArtifactPath(primaryOutputPath, '_review_priorities.json'),
    revisionComparison: siblingArtifactPath(primaryOutputPath, '_revision_comparison.json'),
  };
}

function lineageError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}

function optionalIdentityValue(value, path) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw lineageError('malformed_identity', `${path} must be a non-blank string when supplied in proof mode.`, { path });
  }
  return value.trim();
}

function assertCallerIdentityMatchesConfig({ partId, revision }, identity) {
  const suppliedPartId = optionalIdentityValue(partId, 'review-context part_id');
  const suppliedRevision = optionalIdentityValue(revision, 'review-context revision');
  const conflicts = [];
  if (suppliedPartId !== null && suppliedPartId !== identity.part_id) {
    conflicts.push(`part_id ${suppliedPartId} does not match authoritative config ${identity.part_id}`);
  }
  if (suppliedRevision !== null && suppliedRevision !== identity.revision) {
    conflicts.push(`revision ${suppliedRevision} does not match authoritative config ${identity.revision}`);
  }
  if (conflicts.length > 0) {
    throw lineageError('conflicting_identity', `Proof review-context caller identity conflicts with the authoritative config: ${conflicts.join('; ')}.`, {
      conflicts,
    });
  }
}

function bindContextToAuthoritativeIdentity(contextValue, identity) {
  const context = safeObject(contextValue);
  const part = safeObject(context.part);
  const contextPackageSlug = optionalIdentityValue(part.package_slug, 'review context part.package_slug');
  const contextPartId = optionalIdentityValue(part.part_id, 'review context part.part_id');
  const contextRevision = optionalIdentityValue(part.revision, 'review context part.revision');
  const conflicts = [];
  if (contextPackageSlug !== null && contextPackageSlug !== identity.package_slug) {
    conflicts.push(`context package_slug ${contextPackageSlug} does not match ${identity.package_slug}`);
  }
  if (contextPartId !== null && contextPartId !== identity.part_id) {
    conflicts.push(`context part_id ${contextPartId} does not match ${identity.part_id}`);
  }
  if (contextRevision !== null && contextRevision !== identity.revision) {
    conflicts.push(`context revision ${contextRevision} does not match ${identity.revision}`);
  }
  if (conflicts.length > 0) {
    throw lineageError('conflicting_identity', `Proof review-context input identity conflicts with the authoritative config: ${conflicts.join('; ')}.`, {
      conflicts,
    });
  }
  return {
    ...context,
    part: {
      ...part,
      package_slug: identity.package_slug,
      part_id: identity.part_id,
      revision: identity.revision,
      name: part.name || identity.part_id,
    },
  };
}

function assertProofReviewPackIdentity(reviewPack, revisionLineage) {
  assertValidDArtifact('review_pack', reviewPack, { command: 'review-context' });
  const actualLineage = assertRevisionLineage(reviewPack.revision_lineage);
  assertRevisionLineageIdentityAgreement([revisionLineage, actualLineage]);
  const part = safeObject(reviewPack.part);
  const aliases = {
    nested_package_slug: optionalIdentityValue(part.package_slug, 'review_pack.part.package_slug'),
    top_part_id: optionalIdentityValue(reviewPack.part_id, 'review_pack.part_id'),
    nested_part_id: optionalIdentityValue(part.part_id, 'review_pack.part.part_id'),
    top_revision: optionalIdentityValue(reviewPack.revision, 'review_pack.revision'),
    nested_revision: optionalIdentityValue(part.revision, 'review_pack.part.revision'),
  };
  if (Object.values(aliases).some((value) => value === null)) {
    throw lineageError('missing_identity', 'Proof review pack requires explicit nested package slug plus top-level and nested part/revision identity.', { aliases });
  }
  const identity = revisionLineage.identity;
  if (
    aliases.top_part_id !== aliases.nested_part_id
    || aliases.top_revision !== aliases.nested_revision
    || aliases.nested_package_slug !== identity.package_slug
    || aliases.top_part_id !== identity.part_id
    || aliases.top_revision !== identity.revision
  ) {
    throw lineageError('conflicting_identity', 'Proof review pack package slug, top-level/nested part and revision, and authoritative config identities must agree exactly.', {
      aliases,
      authoritative_identity: identity,
    });
  }
  return actualLineage;
}

async function buildProofWorkingPaths(finalPaths) {
  const outputDirectory = dirname(finalPaths.reviewPackJson);
  await mkdir(outputDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(join(outputDirectory, '.fcad-review-context-stage-'));
  const paths = Object.fromEntries(
    Object.entries(finalPaths).map(([key, value]) => [key, join(stagingDirectory, basename(value))])
  );
  return { outputDirectory, stagingDirectory, paths };
}

async function collectProofPublicationOutputs(workingPaths, finalPaths) {
  const outputs = [];
  const metadata = {};
  for (const [key, workingPath] of Object.entries(workingPaths)) {
    let info;
    try {
      info = await stat(workingPath);
    } catch (error) {
      if (error?.code === 'ENOENT' && ['draftConfig', 'revisionComparison'].includes(key)) continue;
      throw error;
    }
    if (!info.isFile()) {
      throw lineageError('unsafe_output', `Proof review output is not a regular file: ${key}.`, { key });
    }
    const content = await readFile(workingPath);
    const finalPath = finalPaths[key];
    outputs.push({ path: finalPath, content });
    metadata[resolve(finalPath)] = {
      exists: true,
      size_bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }
  return { outputs, metadata };
}

function uniqueWarnings(...lists) {
  return [...new Set(
    lists
      .flat()
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function repoRelativeArtifactPath(projectRoot, inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) return inputPath;
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(inputPath);
  const relPath = relative(resolvedRoot, resolvedPath).replace(/\\/g, '/');
  return relPath && !relPath.startsWith('..') && !relPath.startsWith('/')
    ? relPath
    : inputPath;
}

function sanitizeRepoLocalArtifactString(projectRoot, value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const root = resolve(projectRoot).replace(/\\/g, '/');
  let output = value.replaceAll('\\', '/');
  output = output.replaceAll(`file://${root}/`, '');
  output = output.replaceAll(`${root}/`, '');
  output = output.replaceAll(`file://${root}`, '.');
  output = output.replaceAll(root, '.');
  return output;
}

function sanitizeRepoLocalArtifactValue(projectRoot, value) {
  if (typeof value === 'string') {
    return sanitizeRepoLocalArtifactString(projectRoot, value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRepoLocalArtifactValue(projectRoot, entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeRepoLocalArtifactValue(projectRoot, entry)])
    );
  }
  return value;
}

function compactRuntimeDiagnostics(runtimeDiagnostics = []) {
  return runtimeDiagnostics.map((diagnostic) => ({
    stage: diagnostic?.stage || null,
    message: diagnostic?.message || null,
    actionable_hint: diagnostic?.actionable_hint || diagnostic?.actionableHint || null,
    fallback_mode: diagnostic?.fallback_mode || diagnostic?.fallbackMode || null,
  }));
}

function buildImportDiagnostics({ context, resolvedModelPath, analysisInputs }) {
  const geometrySource = context?.geometry_source || {};
  const featureResult = analysisInputs.stepFeatureResult || {};
  const geometryImportDiagnostics = safeObject(geometrySource.import_diagnostics);
  const featureImportDiagnostics = safeObject(featureResult.import_diagnostics);
  const importDiagnostics = Object.keys(geometryImportDiagnostics).length > 0
    ? geometryImportDiagnostics
    : featureImportDiagnostics;
  return {
    artifact_type: 'import_diagnostics',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    source_model: resolvedModelPath || geometrySource.path || null,
    file_type: geometrySource.file_type || null,
    part_type: featureResult.part_type || importDiagnostics.part_type || null,
    import_kind: importDiagnostics.import_kind || null,
    assembly_detected: importDiagnostics.assembly_detected ?? null,
    body_count: importDiagnostics.body_count ?? null,
    bounding_box: importDiagnostics.bounding_box || featureResult.bounding_box || null,
    unit_system: importDiagnostics.unit_system || featureResult.unit_system || null,
    unit_assumption: importDiagnostics.unit_assumption || featureResult.unit_assumption || null,
    empty_import: importDiagnostics.empty_import === true,
    partial_import: importDiagnostics.partial_import === true,
    unsupported_import: importDiagnostics.unsupported_import === true,
    fail_closed: importDiagnostics.fail_closed === true,
    warnings: uniqueWarnings(
      geometrySource.import_warnings,
      featureResult.bootstrap_warnings,
      analysisInputs.warningMessages
    ),
    runtime_diagnostics: compactRuntimeDiagnostics(analysisInputs.runtimeDiagnostics),
  };
}

function buildBootstrapWarnings({ context, analysisInputs, analysisResult }) {
  const geometrySource = context?.geometry_source || {};
  return {
    artifact_type: 'bootstrap_warnings',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    warnings: uniqueWarnings(
      context?.metadata?.warnings,
      geometrySource.import_warnings,
      analysisInputs.warningMessages,
      analysisResult?.geometry_intelligence?.warnings,
      analysisResult?.manufacturing_hotspots?.warnings
    ),
    runtime_diagnostics: compactRuntimeDiagnostics(analysisInputs.runtimeDiagnostics),
  };
}

function buildConfidenceMap({ analysisInputs, analysisResult, reviewPackResult }) {
  return {
    artifact_type: 'confidence_map',
    generated_at: analysisResult?.geometry_intelligence?.generated_at || new Date().toISOString(),
    import_bootstrap: analysisInputs.stepFeatureResult?.confidence_map || null,
    geometry_intelligence: analysisResult?.geometry_intelligence?.confidence || null,
    manufacturing_hotspots: analysisResult?.manufacturing_hotspots?.confidence || null,
    review_pack: reviewPackResult?.summary?.confidence || null,
  };
}

function buildBootstrapSummary({
  context,
  analysisInputs,
  analysisResult,
  linkageResult,
  reviewPackResult,
}) {
  const geometrySource = context?.geometry_source || {};
  const featureResult = analysisInputs.stepFeatureResult || {};
  const geometryImportDiagnostics = safeObject(geometrySource.import_diagnostics);
  const featureImportDiagnostics = safeObject(featureResult.import_diagnostics);
  const importDiagnostics = Object.keys(geometryImportDiagnostics).length > 0
    ? geometryImportDiagnostics
    : featureImportDiagnostics;
  const features = analysisResult?.geometry_intelligence?.features || {};
  return {
    artifact_type: 'bootstrap_summary',
    generated_at: analysisResult?.geometry_intelligence?.generated_at || new Date().toISOString(),
    part: context?.part || {},
    source_model: geometrySource.path || null,
    file_type: geometrySource.file_type || null,
    analysis_mode: geometrySource.analysis_mode || null,
    part_type: featureResult.part_type || importDiagnostics.part_type || null,
    import_kind: importDiagnostics.import_kind || null,
    unit_assumption: importDiagnostics.unit_assumption || featureResult.unit_assumption || null,
    bounding_box: featureResult.bounding_box || importDiagnostics.bounding_box || null,
    detected_features: {
      hole_like_feature_count: features.hole_like_feature_count ?? null,
      hole_pattern_count: features.hole_pattern_count ?? null,
      repeated_feature_count: features.repeated_feature_count ?? null,
      complexity_score: features.complexity_score ?? null,
      review_priority_count: Array.isArray(linkageResult?.review_priorities) ? linkageResult.review_priorities.length : null,
    },
    confidence_map: buildConfidenceMap({ analysisInputs, analysisResult, reviewPackResult }),
    warnings: uniqueWarnings(
      context?.metadata?.warnings,
      geometrySource.import_warnings,
      analysisInputs.warningMessages,
      reviewPackResult?.summary?.warnings
    ),
    review_gate: {
      ready_for_review_context: true,
      correction_required: Boolean(
        importDiagnostics.partial_import
        || importDiagnostics.unit_assumption
        || analysisInputs.usedMetadataOnlyFallback
      ),
      optional_context_inputs: ['bom', 'inspection', 'quality', 'create_quality', 'drawing_quality', 'drawing_qa', 'drawing_intent', 'feature_catalog', 'dfm_report'],
    },
  };
}

export async function runReviewContextPipeline({
  projectRoot,
  authoritativeConfigPath = null,
  authoritativeConfigSnapshot: providedAuthoritativeConfigSnapshot = null,
  requireAuthoritativeLineage = false,
  proofLineageSelection = undefined,
  prepareProofPublicationOutputs = null,
  proofPublicationHooks = {},
  contextPath = null,
  modelPath,
  bomPath = null,
  inspectionPath = null,
  qualityPath = null,
  createQualityPath = null,
  drawingQualityPath = null,
  drawingQaPath = null,
  drawingIntentPath = null,
  featureCatalogPath = null,
  dfmReportPath = null,
  inspectionEvidencePath = null,
  attachmentAuthorizationPath = null,
  attachmentRecordPath = null,
  compareToPath = null,
  outputPath = null,
  outDir = null,
  partName = null,
  partId = null,
  revision = null,
  material = null,
  manufacturingProcess = null,
  facility = null,
  supplier = null,
  manufacturingNotes = null,
  bootstrap = null,
  runPythonJsonScript,
  inspectModelIfAvailable,
  detectStepFeaturesIfAvailable,
}) {
  if (requireAuthoritativeLineage !== true && requireAuthoritativeLineage !== false) {
    throw lineageError('malformed_policy', 'requireAuthoritativeLineage must be a boolean.', {
      require_authoritative_lineage: requireAuthoritativeLineage,
    });
  }

  let authoritativeConfigSnapshot = null;
  let revisionLineage = null;
  if (requireAuthoritativeLineage === true) {
    if (!authoritativeConfigPath) {
      throw lineageError('missing_parent', 'Proof review-context requires an authoritative config path.', {
        parent: 'authoritative_config',
      });
    }
    authoritativeConfigSnapshot = providedAuthoritativeConfigSnapshot || await readAuthoritativeConfigSnapshot({
      projectRoot,
      configPath: authoritativeConfigPath,
      ...(proofLineageSelection === undefined ? {} : { selection: proofLineageSelection }),
    });
    if (authoritativeConfigSnapshot.path !== authoritativeConfigPath) {
      throw lineageError('conflicting_identity', 'Proof authoritative config snapshot path does not match authoritativeConfigPath.', {
        authoritative_config_path: authoritativeConfigPath,
        snapshot_path: authoritativeConfigSnapshot.path,
      });
    }
    assertCallerIdentityMatchesConfig({ partId, revision }, authoritativeConfigSnapshot.identity);
    const configParent = buildRevisionLineageParent({
      artifactType: 'config',
      role: 'authoritative_config',
      path: authoritativeConfigSnapshot.path,
      sha256: authoritativeConfigSnapshot.sha256,
      sizeBytes: authoritativeConfigSnapshot.size_bytes,
    });
    revisionLineage = buildRevisionLineage({
      identity: authoritativeConfigSnapshot.identity,
      parents: [configParent],
    });
  } else if (authoritativeConfigPath) {
    throw lineageError('unsupported_legacy', 'authoritativeConfigPath is accepted only when requireAuthoritativeLineage is true.');
  }

  const effectivePartId = revisionLineage?.identity.part_id || partId;
  const effectiveRevision = revisionLineage?.identity.revision || revision;
  const effectivePartName = partName || authoritativeConfigSnapshot?.config?.name || null;
  const defaultStem = deriveArtifactStem(outputPath || modelPath || bomPath || inspectionPath || qualityPath, effectivePartName || 'engineering_part');
  const outputDir = resolve(outDir || dirname(outputPath || artifactPathFor(resolve(projectRoot, 'output'), defaultStem, '_review_pack.json')));
  const finalPaths = buildOutputPaths({
    outputPath,
    outDir: outputDir,
    defaultStem,
  });
  let paths = finalPaths;
  let proofStagingDirectory = null;
  let proofOutputDirectory = null;
  if (requireAuthoritativeLineage === true) {
    const proofPaths = await buildProofWorkingPaths(finalPaths);
    paths = proofPaths.paths;
    proofStagingDirectory = proofPaths.stagingDirectory;
    proofOutputDirectory = proofPaths.outputDirectory;
  }

  try {

  // Validate the complete attachment hash chain before ingest or any output write.
  const inspectionEvidence = await buildInspectionEvidenceRecord(
    projectRoot,
    inspectionEvidencePath,
    attachmentAuthorizationPath,
    attachmentRecordPath
  );
  if (inspectionEvidence.record) {
    if (effectiveRevision !== inspectionEvidence.packageRevision) {
      throw new AttachmentAuthorizationValidationError([
        `review-context revision must explicitly match attached inspection evidence revision ${inspectionEvidence.packageRevision}`,
      ], { path: attachmentRecordPath });
    }
    if (effectivePartId !== inspectionEvidence.subjectIdentifier) {
      throw new AttachmentAuthorizationValidationError([
        `review-context part id must explicitly match inspected subject ${inspectionEvidence.subjectIdentifier}`,
      ], { path: attachmentRecordPath });
    }
  }

  let context;
  let ingestLog;

  if (contextPath) {
    context = await readJsonFile(contextPath);
    ingestLog = {
      created_at: context?.metadata?.created_at || new Date().toISOString(),
      sources: [],
      warnings: context?.metadata?.warnings || [],
      summary: {
        bom_entries: context?.bom?.length || 0,
        inspection_results: context?.inspection_results?.length || 0,
        quality_issues: context?.quality_issues?.length || 0,
      },
      mode: 'prebuilt_context',
    };
  } else {
    const ingestResult = await runPythonJsonScript(projectRoot, 'scripts/ingest_context.py', {
      model: modelPath,
      bom: bomPath,
      inspection: inspectionPath,
      quality: qualityPath,
      part_name: effectivePartName,
      part_id: effectivePartId,
      revision: effectiveRevision,
      material,
      process: manufacturingProcess,
      facility,
      supplier,
      manufacturing_notes: manufacturingNotes,
    }, {
      onStderr: (text) => process.stderr.write(text),
    });
    context = ingestResult.context;
    ingestLog = ingestResult.ingest_log;
  }

  if (revisionLineage) {
    context = bindContextToAuthoritativeIdentity(context, revisionLineage.identity);
  }

  let proofGeneratedAt = null;
  if (revisionLineage) {
    const candidate = context?.metadata?.created_at;
    if (
      typeof candidate !== 'string'
      || !candidate.trim()
      || Number.isNaN(Date.parse(candidate))
    ) {
      throw lineageError(
        'malformed_identity',
        'Proof review-context requires metadata.created_at to be a fixed parseable timestamp.'
      );
    }
    proofGeneratedAt = candidate.trim();
  }

  const resolvedModelPath = modelPath || context?.geometry_source?.path || null;
  const portableResolvedModelPath = resolvedModelPath
    ? repoRelativeArtifactPath(projectRoot, resolvedModelPath)
    : null;
  const analysisInputs = await resolveModelAnalysisInputs({
    modelPath: resolvedModelPath,
    modelMetadata: context?.geometry_source?.model_metadata || null,
    featureHints: context?.geometry_source?.feature_hints || null,
    inspectModelIfAvailable,
    detectStepFeaturesIfAvailable,
  });

  const bootstrapState = safeObject(bootstrap);
  const bootstrapWarnings = uniqueStrings([
    ...safeList(bootstrapState.warnings),
    ...safeList(bootstrapState.warning_messages),
  ]);
  const bootstrapDiagnostics = normalizeBootstrapDiagnostics(bootstrapState.import_diagnostics);
  const primaryBootstrapDiagnostics = bootstrapDiagnostics[0] || {};
  const bootstrapSummarySeed = safeObject(bootstrapState.bootstrap_summary);
  const bootstrapConfidenceSeed = normalizeBootstrapConfidenceMap(
    bootstrapState.confidence_map || bootstrapState.confidence
  );
  const draftConfigToml = typeof bootstrapState.draft_config_toml === 'string' && bootstrapState.draft_config_toml.trim()
    ? bootstrapState.draft_config_toml
    : null;

  context.geometry_source = {
    ...(context?.geometry_source || {}),
    ...(analysisInputs.geometrySourcePatch || {}),
    ...(portableResolvedModelPath ? { path: portableResolvedModelPath } : {}),
    ...(bootstrapSummarySeed.model_kind ? { model_kind: bootstrapSummarySeed.model_kind } : {}),
    ...(bootstrapSummarySeed.part_count !== undefined ? { part_count: bootstrapSummarySeed.part_count } : {}),
    ...(bootstrapSummarySeed.body_count !== undefined ? { body_count: bootstrapSummarySeed.body_count } : {}),
    ...(bootstrapSummarySeed.unit_system ? { unit_system: bootstrapSummarySeed.unit_system } : {}),
    ...(Object.keys(primaryBootstrapDiagnostics).length > 0 ? { import_diagnostics: primaryBootstrapDiagnostics } : {}),
    ...(draftConfigToml ? {
      bootstrap: {
        ...safeObject(context?.geometry_source?.bootstrap),
        draft_config_available: true,
      },
    } : {}),
  };
  context.metadata = {
    ...(context?.metadata || {}),
    warnings: [
      ...new Set([
        ...((context?.metadata?.warnings) || []),
        ...analysisInputs.warningMessages,
        ...bootstrapWarnings,
      ]),
    ],
    runtime_diagnostics: analysisInputs.runtimeDiagnostics,
  };
  context = sanitizeRepoLocalArtifactValue(projectRoot, context);
  ingestLog = {
    ...(ingestLog || {}),
    warnings: [
      ...new Set([
        ...((ingestLog?.warnings) || []),
        ...analysisInputs.warningMessages,
      ]),
    ],
    diagnostics: [
      ...((ingestLog?.diagnostics) || []),
      ...analysisInputs.runtimeDiagnostics.map((diagnostic) => ({
        stage: diagnostic.stage,
        message: diagnostic.message,
        actionable_hint: diagnostic.actionable_hint,
        fallback_mode: diagnostic.fallback_mode,
      })),
    ],
    summary: {
      ...((ingestLog?.summary) || {}),
      diagnostics: (((ingestLog?.diagnostics) || []).length + analysisInputs.runtimeDiagnostics.length),
    },
  };
  ingestLog = sanitizeRepoLocalArtifactValue(projectRoot, ingestLog);

  await writeJsonFile(paths.context, context);
  await writeJsonFile(paths.engineeringContext, context);
  await writeJsonFile(paths.ingestLog, ingestLog);

  const analysisResult = await runPythonJsonScript(projectRoot, 'scripts/analyze_part.py', {
    context,
    ...(proofGeneratedAt ? { generated_at: proofGeneratedAt } : {}),
    model_metadata: analysisInputs.modelMetadata,
    feature_hints: analysisInputs.featureHints,
    geometry_source: context?.geometry_source || (resolvedModelPath ? { path: resolvedModelPath } : {}),
    part: context?.part || { name: defaultStem },
    warnings: analysisInputs.warningMessages,
    runtime_diagnostics: analysisInputs.runtimeDiagnostics,
    allow_metadata_only_fallback: true,
    used_metadata_only_fallback: analysisInputs.usedMetadataOnlyFallback,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });
  const portableAnalysisResult = sanitizeRepoLocalArtifactValue(projectRoot, analysisResult);

  await writeJsonFile(paths.geometry, portableAnalysisResult.geometry_intelligence);
  await writeJsonFile(paths.hotspots, portableAnalysisResult.manufacturing_hotspots);

  const linkageResult = await runPythonJsonScript(projectRoot, 'scripts/quality_link.py', {
    context,
    ...(proofGeneratedAt ? { generated_at: proofGeneratedAt } : {}),
    geometry_intelligence: portableAnalysisResult.geometry_intelligence,
    manufacturing_hotspots: portableAnalysisResult.manufacturing_hotspots,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });
  const portableLinkageResult = sanitizeRepoLocalArtifactValue(projectRoot, linkageResult);

  await writeJsonFile(paths.inspectionLinkage, portableLinkageResult.inspection_linkage);
  await writeJsonFile(paths.inspectionOutliers, portableLinkageResult.inspection_outliers);
  await writeJsonFile(paths.qualityLinkage, portableLinkageResult.quality_linkage);
  await writeJsonFile(paths.qualityHotspots, portableLinkageResult.quality_hotspots);
  await writeJsonFile(paths.reviewPriorities, portableLinkageResult.review_priorities);

  const packageEvidence = await buildPackageEvidenceRecords(projectRoot, {
    createQualityPath,
    drawingQualityPath,
    drawingQaPath,
    drawingIntentPath,
    featureCatalogPath,
    dfmReportPath,
  });
  const reviewPackageEvidence = [
    ...packageEvidence.records,
    ...(inspectionEvidence.record ? [inspectionEvidence.record] : []),
  ];
  const evidenceWarnings = uniqueWarnings(
    packageEvidence.warnings,
    inspectionEvidence.warning ? [inspectionEvidence.warning] : []
  );
  const packageEvidenceSourceRefs = packageEvidence.records.map((record) => ({
    artifact_type: record.artifact_type,
    path: record.source_ref,
    role: 'evidence',
    label: record.label,
    sha256: record.sha256,
    size_bytes: record.size_bytes,
  }));
  if (authoritativeConfigSnapshot) {
    packageEvidenceSourceRefs.unshift({
      artifact_type: 'config',
      path: authoritativeConfigSnapshot.path,
      role: 'input',
      label: 'Authoritative proof-lineage config',
      sha256: authoritativeConfigSnapshot.sha256,
      size_bytes: authoritativeConfigSnapshot.size_bytes,
    });
  }
  if (inspectionEvidence.record) {
    packageEvidenceSourceRefs.push({
      artifact_type: inspectionEvidence.record.artifact_type,
      path: inspectionEvidence.record.source_ref,
      role: 'evidence',
      label: inspectionEvidence.record.label,
      sha256: inspectionEvidence.record.sha256,
      size_bytes: inspectionEvidence.record.size_bytes,
    });
    packageEvidenceSourceRefs.push({
      artifact_type: 'inspection_evidence_attachment_authorization',
      path: inspectionEvidence.record.attachment_authorization.source_ref,
      role: 'input',
      label: 'Inspection evidence attachment authorization',
      sha256: inspectionEvidence.record.attachment_authorization.sha256,
      size_bytes: inspectionEvidence.record.attachment_authorization.size_bytes,
    });
    packageEvidenceSourceRefs.push({
      artifact_type: 'inspection_evidence_attachment_record',
      path: inspectionEvidence.record.attachment_record.source_ref,
      role: 'input',
      label: 'Immutable inspection evidence attachment record',
      sha256: inspectionEvidence.record.attachment_record.sha256,
      size_bytes: inspectionEvidence.record.attachment_record.size_bytes,
    });
  }
  if (evidenceWarnings.length > 0) {
    context.metadata = {
      ...(context.metadata || {}),
      warnings: uniqueWarnings(context.metadata?.warnings, evidenceWarnings),
    };
  }

  const reviewPackResult = await runPythonJsonScript(projectRoot, 'scripts/reporting/review_pack.py', {
    context,
    geometry_intelligence: portableAnalysisResult.geometry_intelligence,
    manufacturing_hotspots: portableAnalysisResult.manufacturing_hotspots,
    inspection_linkage: portableLinkageResult.inspection_linkage,
    inspection_outliers: portableLinkageResult.inspection_outliers,
    quality_linkage: portableLinkageResult.quality_linkage,
    quality_hotspots: portableLinkageResult.quality_hotspots,
    review_priorities: portableLinkageResult.review_priorities,
    workflow: {
      steps: contextPath
        ? ['context-input', 'analyze-part', 'quality-link', 'review-pack']
        : ['ingest', 'analyze-part', 'quality-link', 'review-pack'],
    },
    package_evidence: reviewPackageEvidence,
    source_artifact_refs: packageEvidenceSourceRefs,
    ...(revisionLineage ? {
      revision_lineage: revisionLineage,
      generated_at: proofGeneratedAt,
    } : {}),
    output_dir: dirname(paths.reviewPackJson),
    output_stem: deriveArtifactStem(paths.reviewPackJson, defaultStem),
    output_json_path: paths.reviewPackJson,
    output_markdown_path: paths.reviewPackMarkdown,
    output_pdf_path: paths.reviewPackPdf,
  }, {
    timeout: 180_000,
    onStderr: (text) => process.stderr.write(text),
  });
  reviewPackResult.summary = sanitizeRepoLocalArtifactValue(projectRoot, reviewPackResult.summary);
  if (revisionLineage) {
    assertProofReviewPackIdentity(reviewPackResult.summary, revisionLineage);
  }
  await writeJsonFile(paths.reviewPackJson, reviewPackResult.summary);

  let revisionComparison = null;
  if (compareToPath) {
    const baselineReviewPack = await readJsonFile(compareToPath);
    const candidateReviewPack = await readJsonFile(reviewPackResult.artifacts.json);
    const comparisonResult = await runPythonJsonScript(projectRoot, 'scripts/reporting/revision_diff.py', {
      baseline: baselineReviewPack,
      candidate: candidateReviewPack,
      baseline_path: compareToPath,
      candidate_path: reviewPackResult.artifacts.json,
    }, {
      onStderr: (text) => process.stderr.write(text),
    });
    revisionComparison = sanitizeRepoLocalArtifactValue(projectRoot, comparisonResult.comparison);
    await writeJsonFile(paths.revisionComparison, revisionComparison);
  }

  const rawImportDiagnostics = safeObject(context?.geometry_source?.import_diagnostics);
  const importDiagnostics = {
    artifact_type: 'import_diagnostics',
    generated_at: context?.metadata?.created_at || new Date().toISOString(),
    source_model_path: portableResolvedModelPath || resolvedModelPath,
    file_type: context?.geometry_source?.file_type || null,
    analysis_mode: context?.geometry_source?.analysis_mode || null,
    model_kind: context?.geometry_source?.model_kind || rawImportDiagnostics.import_kind || bootstrapSummarySeed.model_kind || null,
    unit_system: context?.geometry_source?.unit_system || rawImportDiagnostics.unit_assumption?.unit || bootstrapSummarySeed.unit_system || null,
    unit_assumption: rawImportDiagnostics.unit_assumption || null,
    body_count: context?.geometry_source?.body_count ?? rawImportDiagnostics.body_count ?? bootstrapSummarySeed.body_count ?? null,
    part_count: context?.geometry_source?.part_count ?? bootstrapSummarySeed.part_count ?? null,
    diagnostics: [
      ...bootstrapDiagnostics,
      ...analysisInputs.runtimeDiagnostics,
    ],
    warnings: uniqueStrings([
      ...safeList(context?.metadata?.warnings),
      ...bootstrapWarnings,
    ]),
  };
  const portableImportDiagnostics = sanitizeRepoLocalArtifactValue(projectRoot, importDiagnostics);
  await writeJsonFile(paths.importDiagnostics, portableImportDiagnostics);

  const bootstrapWarningsDocument = {
    artifact_type: 'bootstrap_warnings',
    generated_at: portableImportDiagnostics.generated_at,
    warning_count: portableImportDiagnostics.warnings.length,
    warnings: portableImportDiagnostics.warnings,
  };
  await writeJsonFile(paths.bootstrapWarnings, bootstrapWarningsDocument);

  const confidenceMap = {
    artifact_type: 'confidence_map',
    generated_at: portableImportDiagnostics.generated_at,
    import_bootstrap: buildImportBootstrapConfidenceMap({
      bootstrapConfidenceSeed,
      analysisInputs,
      importDiagnostics: rawImportDiagnostics,
    }),
    geometry_intelligence: portableAnalysisResult.geometry_intelligence.confidence || null,
    manufacturing_hotspots: portableAnalysisResult.manufacturing_hotspots.confidence || null,
    review_pack: reviewPackResult.summary?.confidence || null,
  };
  await writeJsonFile(paths.confidenceMap, sanitizeRepoLocalArtifactValue(projectRoot, confidenceMap));

  const geometryMetrics = portableAnalysisResult.geometry_intelligence.metrics?.bounding_box_mm || {};
  const featureHints = safeObject(context?.geometry_source?.feature_hints);
  const bootstrapSummary = {
    artifact_type: 'bootstrap_summary',
    generated_at: portableImportDiagnostics.generated_at,
    part: context?.part || { name: defaultStem },
    source: {
      model_path: portableResolvedModelPath || resolvedModelPath,
      file_type: context?.geometry_source?.file_type || null,
      analysis_mode: context?.geometry_source?.analysis_mode || null,
      model_kind: portableImportDiagnostics.model_kind,
    },
    dimensions_mm: {
      x: geometryMetrics.x ?? null,
      y: geometryMetrics.y ?? null,
      z: geometryMetrics.z ?? null,
    },
    feature_summary: {
      cylinder_count: featureCollectionCount(featureHints.cylinders),
      bolt_circle_count: featureCollectionCount(featureHints.bolt_circles),
      fillet_count: featureCollectionCount(featureHints.fillets),
      chamfer_count: featureCollectionCount(featureHints.chamfers),
      derived_feature_count: featureCollectionCount(portableAnalysisResult.geometry_intelligence.derived_features),
      hotspot_count: featureCollectionCount(portableAnalysisResult.manufacturing_hotspots.hotspots),
    },
    warning_count: bootstrapWarningsDocument.warning_count,
    diagnostics_count: portableImportDiagnostics.diagnostics.length,
    review_gate: {
      ready_for_review_context: true,
      correction_required: shouldRequireBootstrapCorrection({
        importDiagnostics: rawImportDiagnostics,
        usedMetadataOnlyFallback: analysisInputs.usedMetadataOnlyFallback,
      }),
      optional_context_inputs: ['bom', 'inspection', 'quality', 'create_quality', 'drawing_quality', 'drawing_qa', 'drawing_intent', 'feature_catalog', 'dfm_report'],
    },
    review_ready: Boolean(resolvedModelPath || contextPath),
  };
  await writeJsonFile(paths.bootstrapSummary, sanitizeRepoLocalArtifactValue(projectRoot, bootstrapSummary));

  const generatedDraftConfigToml = draftConfigToml
    || (analysisInputs.stepFeatureResult?.suggested_config
      ? `${generateConfigFromAnalysis(analysisInputs.stepFeatureResult).trimEnd()}\n`
      : null);

  if (generatedDraftConfigToml) {
    await writeFile(paths.draftConfig, generatedDraftConfigToml, 'utf8');
  }

  let proofPublicationArtifacts = [];
  let proofPublicationMetadata = null;
  if (revisionLineage) {
    const prepared = await collectProofPublicationOutputs(paths, finalPaths);
    proofPublicationMetadata = prepared.metadata;
    if (typeof prepareProofPublicationOutputs === 'function') {
      const additionalOutputs = await prepareProofPublicationOutputs({
        artifacts: {
          ...finalPaths,
          draftConfig: generatedDraftConfigToml ? finalPaths.draftConfig : null,
          revisionComparison: revisionComparison ? finalPaths.revisionComparison : null,
        },
        reviewPack: reviewPackResult.summary,
        revisionLineage,
        authoritativeConfig: {
          path: authoritativeConfigSnapshot.path,
          sha256: authoritativeConfigSnapshot.sha256,
          size_bytes: authoritativeConfigSnapshot.size_bytes,
        },
        precomputedMetadata: prepared.metadata,
      });
      if (!Array.isArray(additionalOutputs)) {
        throw lineageError('unsafe_output', 'Proof publication callback must return an array of outputs.');
      }
      const occupied = new Set(prepared.outputs.map((entry) => resolve(entry.path)));
      for (const output of additionalOutputs) {
        const target = resolve(output?.path || '');
        if (!output?.path || output.content === undefined || dirname(target) !== proofOutputDirectory || occupied.has(target)) {
          throw lineageError('unsafe_output', 'Proof publication callback returned an unsafe or duplicate output target.', {
            path: output?.path || null,
          });
        }
        occupied.add(target);
        prepared.outputs.push({ path: target, content: output.content });
        proofPublicationArtifacts.push(target);
      }
    }
    await assertRevisionLineageSnapshotCurrent(authoritativeConfigSnapshot, { projectRoot });
    await publishAtomicOutputSet({
      directory: proofOutputDirectory,
      outputs: prepared.outputs,
      hooks: proofPublicationHooks,
    });
    await rm(proofStagingDirectory, { recursive: true, force: true });
    proofStagingDirectory = null;
    paths = finalPaths;
  }

  return {
    context,
    ingestLog,
    geometryIntelligence: portableAnalysisResult.geometry_intelligence,
    manufacturingHotspots: portableAnalysisResult.manufacturing_hotspots,
    linkage: portableLinkageResult,
    reviewPack: reviewPackResult.summary,
    revisionLineage,
    authoritativeConfig: authoritativeConfigSnapshot ? {
      path: authoritativeConfigSnapshot.path,
      sha256: authoritativeConfigSnapshot.sha256,
      size_bytes: authoritativeConfigSnapshot.size_bytes,
    } : null,
    proofPublication: revisionLineage ? {
      atomic: true,
      additional_artifacts: proofPublicationArtifacts,
      metadata: proofPublicationMetadata,
    } : null,
    artifacts: {
      context: paths.context,
      engineeringContext: paths.engineeringContext,
      ingestLog: paths.ingestLog,
      importDiagnostics: paths.importDiagnostics,
      bootstrapSummary: paths.bootstrapSummary,
      bootstrapWarnings: paths.bootstrapWarnings,
      confidenceMap: paths.confidenceMap,
      draftConfig: generatedDraftConfigToml ? paths.draftConfig : null,
      geometry: paths.geometry,
      hotspots: paths.hotspots,
      inspectionLinkage: paths.inspectionLinkage,
      inspectionOutliers: paths.inspectionOutliers,
      qualityLinkage: paths.qualityLinkage,
      qualityHotspots: paths.qualityHotspots,
      reviewPriorities: paths.reviewPriorities,
      reviewPackJson: paths.reviewPackJson,
      reviewPackMarkdown: paths.reviewPackMarkdown,
      reviewPackPdf: paths.reviewPackPdf,
      revisionComparison: revisionComparison ? paths.revisionComparison : null,
    },
    revisionComparison,
  };
  } catch (error) {
    if (proofStagingDirectory) {
      await rm(proofStagingDirectory, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}
