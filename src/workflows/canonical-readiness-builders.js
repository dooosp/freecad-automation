import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  C_ARTIFACT_SCHEMA_VERSION,
  assertValidCArtifact,
  getCCommandContract,
} from '../../lib/c-artifact-schema.js';
import { writeReadinessArtifactPair } from '../../lib/canonical-package-mutation-lock.js';
import { assertValidDArtifact, buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';
import {
  parseInspectionEvidenceJsonBytes,
  validateJsonDocumentBounds,
} from '../../lib/inspection-evidence-onboarding.js';
import {
  REVISION_LINEAGE_MAX_PARENT_BYTES,
  RevisionLineageError,
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineageParentAgreement,
  buildRevisionLineage,
  buildRevisionLineageParent,
  readRevisionLineageFileSnapshot,
} from '../../lib/revision-lineage-contract.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REVIEW_PACK_BYTES = REVISION_LINEAGE_MAX_PARENT_BYTES;

function nowIso(explicitValue = null) {
  if (typeof explicitValue === 'string' && explicitValue.trim()) return explicitValue.trim();
  return new Date().toISOString();
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isSafeRepoSourceRef(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.trim().replaceAll('\\', '/');
  if (normalized !== value.trim()) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  if (normalized.split('/').includes('..')) return false;
  if (normalized === 'output' || normalized.startsWith('output/')) return false;
  if (normalized === 'tmp/codex' || normalized.startsWith('tmp/codex/')) return false;
  if (normalized === 'local/stage5b-candidate-evidence-inbox' || normalized.startsWith('local/stage5b-candidate-evidence-inbox/')) return false;
  if (normalized.startsWith('tests/fixtures/') || normalized.startsWith('schemas/')) return false;
  if (!/^docs\/examples\/[^/]+\/inspection\/[^/]+\.json$/i.test(normalized)) return false;
  return true;
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeSourceArtifactRefs(primary = [], secondary = []) {
  const merged = [];
  const indexes = new Map();

  for (const ref of [...primary, ...secondary]) {
    if (!ref?.artifact_type || !ref?.role) continue;
    const key = `${ref.artifact_type}|${ref.path || ''}|${ref.role}|${ref.label || ''}`;
    const normalized = cloneJson(ref);
    normalized.path = ref.path || null;
    normalized.label = ref.label || null;
    if (!indexes.has(key)) {
      indexes.set(key, merged.length);
      merged.push(normalized);
      continue;
    }
    const index = indexes.get(key);
    merged[index] = Object.fromEntries(
      Object.entries({ ...merged[index], ...normalized })
        .filter(([, value]) => value !== undefined)
    );
  }

  return merged;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function lineageError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}

function requiredProofAlias(container, key, path) {
  if (!hasOwn(container, key) || container[key] === null || container[key] === undefined) {
    throw lineageError('missing_identity', `Proof lineage requires ${path}.`, { path });
  }
  if (typeof container[key] !== 'string') {
    throw lineageError('malformed_identity', `Proof lineage requires ${path} to be a string.`, { path });
  }
  const value = container[key].trim();
  if (!value) {
    throw lineageError('missing_identity', `Proof lineage requires non-blank ${path}.`, { path });
  }
  return value;
}

function assertProofReviewAliases(reviewPack, identity) {
  const part = safeObject(reviewPack?.part);
  const aliases = {
    topLevelPartId: requiredProofAlias(safeObject(reviewPack), 'part_id', 'review_pack.part_id'),
    nestedPartId: requiredProofAlias(part, 'part_id', 'review_pack.part.part_id'),
    topLevelRevision: requiredProofAlias(safeObject(reviewPack), 'revision', 'review_pack.revision'),
    nestedRevision: requiredProofAlias(part, 'revision', 'review_pack.part.revision'),
  };
  const conflicts = [];
  if (aliases.topLevelPartId !== aliases.nestedPartId) {
    conflicts.push('review_pack.part_id does not equal review_pack.part.part_id');
  }
  if (aliases.topLevelRevision !== aliases.nestedRevision) {
    conflicts.push('review_pack.revision does not equal review_pack.part.revision');
  }
  if (aliases.topLevelPartId !== identity.part_id) {
    conflicts.push('review-pack part aliases do not equal revision_lineage.identity.part_id');
  }
  if (aliases.topLevelRevision !== identity.revision) {
    conflicts.push('review-pack revision aliases do not equal revision_lineage.identity.revision');
  }
  if (conflicts.length > 0) {
    throw lineageError('conflicting_identity', `Proof review-pack identity aliases conflict: ${conflicts.join('; ')}.`, {
      conflicts,
    });
  }
}

function safeRepoRelativeLocator(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const locator = value.trim();
  if (locator.includes('\0') || locator.includes('\\') || isAbsolute(locator) || /^[A-Za-z]:/.test(locator)) return null;
  const segments = locator.split('/');
  if (segments.includes('..') || segments.includes('.') || segments.includes('')) return null;
  return locator;
}

function assertedRepoRelativeLocator(value, path) {
  if (value === null || value === undefined) return null;
  const locator = safeRepoRelativeLocator(value);
  if (!locator) {
    throw lineageError('unsafe_path', `Proof readiness requires ${path} to be a safe repository-relative locator.`, {
      path,
    });
  }
  return locator;
}

function proofRunLocator(value) {
  const locator = safeRepoRelativeLocator(value);
  if (!locator) {
    throw lineageError('unsafe_path', 'Proof readiness requires a safe review-pack run locator.', {
      path: typeof value === 'string' ? value : null,
    });
  }
  return `run/${basename(locator)}`;
}

function proofGeneratedAt(reviewPack) {
  const value = reviewPack?.generated_at;
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw lineageError(
      'malformed_identity',
      'Proof readiness requires review_pack.generated_at to be a fixed parseable timestamp.'
    );
  }
  return value.trim();
}

function snapshotBytes(reviewPackSnapshot) {
  const raw = reviewPackSnapshot?.bytes;
  if (!Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) {
    throw lineageError('missing_parent', 'Proof readiness requires the exact review-pack byte snapshot.', {
      parent: 'review_pack',
    });
  }
  return Buffer.from(raw);
}

function snapshotSize(reviewPackSnapshot) {
  return reviewPackSnapshot?.size_bytes ?? reviewPackSnapshot?.size ?? null;
}

function assertReviewPackSnapshotIntegrity(reviewPackSnapshot, { reviewPack = null } = {}) {
  if (!reviewPackSnapshot || typeof reviewPackSnapshot !== 'object') {
    throw lineageError('missing_parent', 'Proof readiness requires a review-pack snapshot.', {
      parent: 'review_pack',
    });
  }
  const bytes = snapshotBytes(reviewPackSnapshot);
  if (bytes.length < 1 || bytes.length > MAX_REVIEW_PACK_BYTES) {
    throw lineageError('input_size_out_of_bounds', 'Review-pack snapshot exceeds the bounded proof-readiness size contract.', {
      parent: 'review_pack',
      size_bytes: bytes.length,
      max_bytes: MAX_REVIEW_PACK_BYTES,
    });
  }
  const declaredSha256 = reviewPackSnapshot.sha256;
  const declaredSize = snapshotSize(reviewPackSnapshot);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!SHA256_PATTERN.test(declaredSha256 || '') || declaredSha256 !== actualSha256) {
    throw lineageError('digest_mismatch', 'Review-pack snapshot SHA-256 does not match its exact bytes.', {
      parent: 'review_pack',
      expected_sha256: declaredSha256 || null,
      actual_sha256: actualSha256,
    });
  }
  if (!Number.isInteger(declaredSize) || declaredSize !== bytes.length) {
    throw lineageError('digest_mismatch', 'Review-pack snapshot size does not match its exact bytes.', {
      parent: 'review_pack',
      expected_size_bytes: declaredSize,
      actual_size_bytes: bytes.length,
    });
  }
  if (reviewPack !== null) {
    let parsed;
    try {
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error('UTF-8 BOM is not allowed');
      }
      parsed = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
    } catch (error) {
      throw lineageError('digest_mismatch', 'Review-pack snapshot bytes are not the claimed JSON document.', {
        parent: 'review_pack',
        cause: error.message,
      });
    }
    const bounds = validateJsonDocumentBounds(parsed, { maxDepth: 64, maxNodes: 50_000 });
    if (!bounds.ok) {
      throw lineageError('input_size_out_of_bounds', 'Review-pack snapshot exceeds bounded JSON depth or node limits.', {
        parent: 'review_pack',
        cause_code: bounds.errors[0]?.code || null,
      });
    }
    if (!isDeepStrictEqual(parsed, reviewPack)) {
      throw lineageError('digest_mismatch', 'The supplied review pack does not match the exact review-pack snapshot bytes.', {
        parent: 'review_pack',
      });
    }
  }
  return {
    bytes,
    sha256: actualSha256,
    size_bytes: bytes.length,
  };
}

function resolveReviewPackLocator(reviewPackPath, reviewPackSnapshot) {
  const explicitLocator = assertedRepoRelativeLocator(reviewPackPath, 'reviewPackPath');
  const snapshotRelativeLocator = assertedRepoRelativeLocator(
    reviewPackSnapshot?.relativePath,
    'reviewPackSnapshot.relativePath'
  );
  const snapshotPathLocator = assertedRepoRelativeLocator(
    reviewPackSnapshot?.path,
    'reviewPackSnapshot.path'
  );
  if (snapshotRelativeLocator && snapshotPathLocator && snapshotRelativeLocator !== snapshotPathLocator) {
    throw lineageError('conflicting_identity', 'Review-pack snapshot locators disagree.', {
      snapshot_relative_path: snapshotRelativeLocator,
      snapshot_path: snapshotPathLocator,
    });
  }
  const snapshotLocator = snapshotRelativeLocator || snapshotPathLocator;
  if (explicitLocator && snapshotLocator && explicitLocator !== snapshotLocator) {
    throw lineageError('conflicting_identity', 'Review-pack path and immutable snapshot locator disagree.', {
      review_pack_path: explicitLocator,
      snapshot_path: snapshotLocator,
    });
  }
  const locator = explicitLocator || snapshotLocator;
  if (!locator) {
    throw lineageError('missing_parent', 'Proof readiness requires a safe repository-relative review-pack locator.', {
      parent: 'review_pack',
    });
  }
  return locator;
}

function createProofReadinessContext({ reviewPack, reviewPackPath, reviewPackSnapshot }) {
  if (!reviewPack?.revision_lineage) {
    throw lineageError('unsupported_legacy', 'Proof readiness requires a review pack with revision_lineage.', {
      artifact_type: reviewPack?.artifact_type || null,
    });
  }
  assertRevisionLineage(reviewPack.revision_lineage);
  const identity = cloneJson(reviewPack.revision_lineage.identity);
  assertProofReviewAliases(reviewPack, identity);
  const configParent = reviewPack.revision_lineage.parents.find((parent) => (
    parent.role === 'authoritative_config'
  ));
  assertExactProofSourceRef(reviewPack, {
    artifactKind: 'review_pack',
    artifactType: 'config',
    role: 'input',
    parent: configParent,
  });
  const snapshot = assertReviewPackSnapshotIntegrity(reviewPackSnapshot, { reviewPack });
  const actualLocator = resolveReviewPackLocator(reviewPackPath, reviewPackSnapshot);
  const locator = proofRunLocator(actualLocator);
  const reviewParent = buildRevisionLineageParent({
    artifactType: 'review_pack',
    role: 'review_pack',
    path: locator,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.size_bytes,
  });
  const revisionLineage = buildRevisionLineage({
    identity,
    parents: [...reviewPack.revision_lineage.parents, reviewParent],
  });
  return Object.freeze({
    identity: Object.freeze(identity),
    reviewParent: Object.freeze(reviewParent),
    revisionLineage: Object.freeze(revisionLineage),
    generatedAt: proofGeneratedAt(reviewPack),
    sourceArtifactRef: Object.freeze({
      artifact_type: 'review_pack',
      path: locator,
      role: 'input',
      label: 'Canonical review-pack JSON',
      sha256: snapshot.sha256,
      size_bytes: snapshot.size_bytes,
    }),
  });
}

function resolveProofReadinessContext({
  reviewPack,
  reviewPackPath,
  reviewPackSnapshot,
  requireAuthoritativeLineage,
} = {}) {
  if (requireAuthoritativeLineage !== true && requireAuthoritativeLineage !== false) {
    throw lineageError('malformed_policy', 'requireAuthoritativeLineage must be a boolean.', {
      require_authoritative_lineage: requireAuthoritativeLineage,
    });
  }
  return requireAuthoritativeLineage === true
    ? createProofReadinessContext({ reviewPack, reviewPackPath, reviewPackSnapshot })
    : null;
}

function hasMatchingInspectionEvidenceSourceRef(sourceArtifactRefs = [], sourceRef = null) {
  return safeList(sourceArtifactRefs).some((ref) => (
    ref?.artifact_type === 'inspection_evidence'
    && ref?.role === 'evidence'
    && ref?.path === sourceRef
  ));
}

function hasMatchingAttachmentRecordSourceRef(sourceArtifactRefs = [], sourceRef = null) {
  return safeList(sourceArtifactRefs).some((ref) => (
    ref?.artifact_type === 'inspection_evidence_attachment_record'
    && ref?.role === 'input'
    && ref?.path === sourceRef
  ));
}

function isExplicitInspectionEvidenceRecord(record, sourceArtifactRefs = []) {
  const classifications = safeList(record?.classifications);
  const sourceRef = record?.source_ref;
  const attachmentRecord = safeObject(record?.attachment_record);
  const inspectionResult = safeObject(record?.inspection_result);
  const recordText = JSON.stringify(record || {});
  return Boolean(
    record?.inspection_evidence === true
    && record?.type === 'inspection_evidence'
    && record?.artifact_type === 'inspection_evidence'
    && record?.category === 'inspection_evidence'
    && classifications.includes('inspection_evidence')
    && isSafeRepoSourceRef(sourceRef)
    && typeof record?.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(record.sha256)
    && hasMatchingInspectionEvidenceSourceRef(sourceArtifactRefs, sourceRef)
    && attachmentRecord.record_type === 'inspection_evidence_attachment_record'
    && /^docs\/examples\/[^/]+\/inspection\/inspection_evidence_attachment\.json$/i.test(attachmentRecord.source_ref || '')
    && /^[a-f0-9]{64}$/.test(attachmentRecord.sha256 || '')
    && /^[a-f0-9]{64}$/.test(attachmentRecord.source_document_sha256 || '')
    && typeof attachmentRecord.package_revision === 'string'
    && attachmentRecord.package_revision.trim().length > 0
    && hasMatchingAttachmentRecordSourceRef(sourceArtifactRefs, attachmentRecord.source_ref)
    && ['pass', 'fail'].includes(inspectionResult.overall_result)
    && Number.isInteger(inspectionResult.characteristic_count)
    && inspectionResult.characteristic_count > 0
    && Number.isInteger(inspectionResult.nonconforming_characteristic_count)
    && inspectionResult.nonconforming_characteristic_count >= 0
    && inspectionResult.nonconforming_characteristic_count <= inspectionResult.characteristic_count
    && (
      inspectionResult.readiness_disposition === 'conforming'
        ? inspectionResult.overall_result === 'pass' && inspectionResult.nonconforming_characteristic_count === 0
        : inspectionResult.readiness_disposition === 'hold_nonconforming'
          && (inspectionResult.overall_result === 'fail' || inspectionResult.nonconforming_characteristic_count > 0)
    )
    && !/\b(?:synthetic|fixture|surrogate|simulated|test[-_ ]?only|non[-_ /]?evidence)\b/i.test(recordText)
  );
}

function getExplicitInspectionEvidenceRecords(reviewPack = {}) {
  const records = safeList(reviewPack?.evidence_ledger?.records);
  const sourceArtifactRefs = safeList(reviewPack?.source_artifact_refs);
  return records.filter((record) => isExplicitInspectionEvidenceRecord(record, sourceArtifactRefs));
}

function buildCanonicalArtifactDescriptor(kind, contract) {
  return {
    json_is_source_of_truth: true,
    artifact_type: kind,
    artifact_filename: contract?.primary_output || `${kind}.json`,
    derived_outputs: contract?.derived_outputs || [],
    rationale: kind === 'readiness_report'
      ? 'readiness_report.json is the canonical C artifact; downstream markdown and release packaging derive from it.'
      : 'This JSON artifact is the canonical machine-readable source for the downstream C output.',
  };
}

function rankToSeverity(priorityRank) {
  if (priorityRank === 1) return 'high';
  if (priorityRank === 2 || priorityRank === 3) return 'medium';
  return 'low';
}

function riskLevelFromSignals({ missingInputs = [], warnings = [], priorities = [] } = {}) {
  if (missingInputs.length > 0 || warnings.length >= 3) return 'high';
  if (priorities.length >= 4 || warnings.length >= 1) return 'medium';
  return 'low';
}

function buildPropagatedConfidence(sourceConfidence, {
  propagatedFrom,
  propagationNotes = [],
  sourceConfidenceRefs = [],
} = {}) {
  const upstream = safeObject(sourceConfidence);
  return {
    level: upstream.level || 'heuristic',
    score: Number.isFinite(upstream.score) ? upstream.score : 0.5,
    rationale: upstream.rationale || 'Confidence propagated from source artifact.',
    propagated_from: propagatedFrom || null,
    propagation_notes: propagationNotes.filter(Boolean),
    source_confidence_refs: sourceConfidenceRefs,
  };
}

function collectDataQualityMessages(reviewPack) {
  const notes = safeList(reviewPack.data_quality_notes);
  return notes
    .map((note) => note?.message)
    .filter((message) => typeof message === 'string' && message.trim());
}

function collectMissingInputs(reviewPack) {
  const missingInputs = uniqueStrings(safeList(reviewPack.uncertainty_coverage_report?.missing_inputs));
  const records = getExplicitInspectionEvidenceRecords(reviewPack);
  const withoutInspectionMarkers = missingInputs.filter((input) => ![
    'inspection_evidence',
    'inspection_evidence_ambiguous',
    'inspection_evidence_nonconforming',
  ].includes(input));
  if (records.length === 0) return uniqueStrings([...withoutInspectionMarkers, 'inspection_evidence']);
  if (records.length !== 1) return uniqueStrings([...withoutInspectionMarkers, 'inspection_evidence_ambiguous']);
  if (records[0].inspection_result.readiness_disposition !== 'conforming') {
    return uniqueStrings([...withoutInspectionMarkers, 'inspection_evidence_nonconforming']);
  }
  return withoutInspectionMarkers;
}

function normalizeDataQualityNotesForInspectionEvidence(reviewPack, notes) {
  const inspectionEvidenceRecords = getExplicitInspectionEvidenceRecords(reviewPack);
  if (inspectionEvidenceRecords.length === 0) {
    const existing = safeList(notes);
    const hasMissingInspectionNote = existing.some((note) => (
      typeof note?.message === 'string' && /Missing or limited inspection evidence/i.test(note.message)
    ));
    return hasMissingInspectionNote
      ? existing
      : [
          ...existing,
          {
            severity: 'info',
            message: 'Missing or limited inspection evidence; review-pack remains usable with partial evidence.',
          },
        ];
  }
  const retained = safeList(notes).filter((note) => {
    const message = note?.message;
    return !(typeof message === 'string' && /Missing or limited inspection evidence/i.test(message));
  });
  if (inspectionEvidenceRecords.some((record) => record.inspection_result.readiness_disposition !== 'conforming')) {
    return [
      ...retained,
      {
        severity: 'high',
        message: 'Attached inspection evidence contains a failed or not-accepted result; readiness remains on hold pending disposition and conforming evidence.',
      },
    ];
  }
  return retained;
}

function normalizeReviewPackInspectionEvidenceCoverage(reviewPack) {
  const normalized = cloneJson(reviewPack);
  const missingInputs = collectMissingInputs(normalized);
  const inspectionEvidenceRecords = getExplicitInspectionEvidenceRecords(normalized);
  normalized.uncertainty_coverage_report = {
    ...safeObject(normalized.uncertainty_coverage_report),
    partial_evidence: missingInputs.length > 0,
    missing_inputs: missingInputs,
    coverage: {
      ...safeObject(normalized.uncertainty_coverage_report?.coverage),
      inspection_evidence_record_count: inspectionEvidenceRecords.length,
      inspection_evidence_conforming_count: inspectionEvidenceRecords.filter((record) => record.inspection_result.readiness_disposition === 'conforming').length,
      inspection_evidence_nonconforming_count: inspectionEvidenceRecords.filter((record) => record.inspection_result.readiness_disposition !== 'conforming').length,
    },
  };
  normalized.data_quality_notes = normalizeDataQualityNotesForInspectionEvidence(
    normalized,
    normalized.data_quality_notes
  );
  return normalized;
}

function getReviewPackExecutiveSummary(reviewPack) {
  const explicit = safeObject(reviewPack.executive_summary);
  if (Object.keys(explicit).length > 0) return explicit;

  const priorities = safeList(reviewPack.review_priorities);
  const topCategories = priorities.slice(0, 3).map((priority) => priority.category).filter(Boolean);
  return {
    headline: `${reviewPack.part?.name || 'unknown_part'} revision ${reviewPack.part?.revision || reviewPack.revision || 'n/a'} packages ${priorities.length} prioritized review topics.`,
    part_revision: reviewPack.part?.revision || reviewPack.revision || null,
    top_risk_categories: topCategories,
    priority_count: priorities.length,
    geometry_hotspot_count: safeList(reviewPack.geometry_hotspots).length,
    inspection_anomaly_count: safeList(reviewPack.inspection_anomalies).length,
    quality_signal_count: safeList(reviewPack.quality_linkage?.records).length,
    recommended_action_count: safeList(reviewPack.recommended_actions).length,
    confidence: {
      label: reviewPack.confidence?.level || 'heuristic',
      numeric_score: reviewPack.confidence?.score ?? null,
    },
  };
}

function getReviewPackPrioritizedHotspots(reviewPack) {
  const explicit = safeList(reviewPack.prioritized_hotspots);
  if (explicit.length > 0) return explicit;
  return safeList(reviewPack.review_priorities).map((priority) => ({
    title: priority.title || `Review ${priority.category || 'priority'}`,
    category: priority.category || null,
    priority_rank: priority.priority_rank ?? null,
    score: priority.score ?? null,
  }));
}

function getReviewPackUncertaintyReport(reviewPack) {
  const explicit = safeObject(reviewPack.uncertainty_coverage_report);
  if (Object.keys(explicit).length > 0) {
    const missingInputs = collectMissingInputs(reviewPack);
    const inspectionEvidenceRecords = getExplicitInspectionEvidenceRecords(reviewPack);
    return {
      ...explicit,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
      coverage: inspectionEvidenceRecords.length > 0
        ? {
          ...safeObject(explicit.coverage),
          inspection_evidence_record_count: inspectionEvidenceRecords.length,
        }
        : safeObject(explicit.coverage),
    };
  }
  return {
    analysis_confidence: reviewPack.confidence?.level || 'heuristic',
    numeric_score: reviewPack.confidence?.score ?? null,
    partial_evidence: true,
    missing_inputs: collectMissingInputs(reviewPack),
    coverage: {
      ...safeObject(reviewPack.coverage),
      inspection_evidence_record_count: getExplicitInspectionEvidenceRecords(reviewPack).length,
    },
    warnings: safeList(reviewPack.warnings),
  };
}

function getReviewPackEvidenceLedger(reviewPack) {
  const explicit = safeObject(reviewPack.evidence_ledger);
  if (Object.keys(explicit).length > 0) return explicit;
  const geometryCount = safeList(reviewPack.geometry_hotspots).length;
  const inspectionCount = safeList(reviewPack.inspection_anomalies).length;
  const qualityCount = safeList(reviewPack.quality_linkage?.records).length;
  return {
    record_count: geometryCount + inspectionCount + qualityCount,
    counts_by_type: {
      geometry_hotspot: geometryCount,
      inspection_anomaly: inspectionCount,
      quality_pattern: qualityCount,
    },
    records: [],
  };
}

function collectReviewPackWarnings(reviewPack, extraWarnings = []) {
  return uniqueStrings([
    ...safeList(reviewPack.warnings),
    ...safeList(reviewPack.uncertainty_coverage_report?.warnings),
    ...collectDataQualityMessages(reviewPack),
    ...extraWarnings,
  ]);
}

function normalizePart(part = {}, lineageIdentity = null) {
  return {
    ...(lineageIdentity ? { package_slug: lineageIdentity.package_slug } : {}),
    part_id: lineageIdentity?.part_id || part.part_id || null,
    name: part.name || 'unknown_part',
    description: part.description || null,
    revision: lineageIdentity?.revision || part.revision || null,
    material: part.material || null,
    process: part.process || null,
  };
}

function extractReviewPackIdentity(reviewPack, { includeRevision = true } = {}) {
  const part = safeObject(reviewPack?.part);
  return {
    part_id: part.part_id || reviewPack?.part_id || null,
    name: part.name || null,
    revision: includeRevision ? (part.revision || reviewPack?.revision || null) : null,
  };
}

function extractArtifactIdentity(artifact, { includeRevision = true } = {}) {
  const part = safeObject(artifact?.part);
  return {
    part_id: part.part_id || artifact?.part_id || null,
    name: part.name || null,
    revision: includeRevision ? (part.revision || artifact?.revision || null) : null,
  };
}

function describeIdentity(identity = {}, { includeRevision = true } = {}) {
  const parts = [];
  if (identity.part_id) parts.push(`part_id=${identity.part_id}`);
  if (identity.name) parts.push(`name=${identity.name}`);
  if (includeRevision && identity.revision) parts.push(`revision=${identity.revision}`);
  return parts.join(', ') || 'unknown identity';
}

function collectIdentityMismatches(expected, actual, { allowRevisionDifference = false } = {}) {
  const mismatches = [];
  if (expected.part_id && actual.part_id && expected.part_id !== actual.part_id) {
    mismatches.push(`part_id mismatch (${expected.part_id} != ${actual.part_id})`);
  }
  if (expected.name && actual.name && expected.name !== actual.name) {
    mismatches.push(`name mismatch (${expected.name} != ${actual.name})`);
  }
  if (!allowRevisionDifference && expected.revision && actual.revision && expected.revision !== actual.revision) {
    mismatches.push(`revision mismatch (${expected.revision} != ${actual.revision})`);
  }
  return mismatches;
}

function findSourceArtifactRefs(artifact, artifactType) {
  return safeList(artifact?.source_artifact_refs)
    .filter((ref) => ref?.artifact_type === artifactType && typeof ref.path === 'string' && ref.path.trim());
}

function assertExactProofSourceRef(artifact, {
  artifactKind,
  artifactType,
  role,
  parent,
}) {
  const refs = findSourceArtifactRefs(artifact, artifactType)
    .filter((ref) => ref.role === role);
  if (refs.length === 0) {
    throw lineageError('missing_parent', `${artifactKind} does not retain the required ${artifactType} source reference.`, {
      artifact_type: artifactKind,
      parent: parent?.role || artifactType,
    });
  }
  if (refs.some((ref) => ref.path !== parent.path)) {
    throw lineageError('conflicting_identity', `${artifactKind} contains a conflicting ${artifactType} source path.`, {
      artifact_type: artifactKind,
      parent: parent.role,
    });
  }
  if (refs.some((ref) => ref.sha256 !== parent.sha256 || ref.size_bytes !== parent.size_bytes)) {
    throw lineageError('digest_mismatch', `${artifactKind} ${artifactType} source reference does not match the exact parent bytes.`, {
      artifact_type: artifactKind,
      parent: parent.role,
    });
  }
}

function assertProofArtifactMatchesReviewPack(artifact, { artifactKind, proofContext }) {
  if (!artifact?.revision_lineage) {
    throw lineageError('unsupported_legacy', `${artifactKind} lacks revision_lineage required by proof readiness.`, {
      artifact_type: artifactKind,
    });
  }
  assertRevisionLineage(artifact.revision_lineage);
  assertRevisionLineageIdentityAgreement([
    proofContext.revisionLineage,
    artifact.revision_lineage,
  ]);
  assertRevisionLineageParentAgreement(
    proofContext.revisionLineage,
    artifact.revision_lineage
  );

  const part = safeObject(artifact.part);
  const packageSlug = requiredProofAlias(part, 'package_slug', `${artifactKind}.part.package_slug`);
  const partId = requiredProofAlias(part, 'part_id', `${artifactKind}.part.part_id`);
  const revision = requiredProofAlias(part, 'revision', `${artifactKind}.part.revision`);
  const identity = proofContext.identity;
  if (packageSlug !== identity.package_slug || partId !== identity.part_id || revision !== identity.revision) {
    throw lineageError('conflicting_identity', `${artifactKind} part identity does not match the proof review-pack identity.`, {
      artifact_type: artifactKind,
    });
  }

  assertExactProofSourceRef(artifact, {
    artifactKind,
    artifactType: 'review_pack',
    role: proofContext.sourceArtifactRef.role,
    parent: proofContext.reviewParent,
  });
  const configParent = proofContext.revisionLineage.parents.find((parent) => (
    parent.role === 'authoritative_config'
  ));
  assertExactProofSourceRef(artifact, {
    artifactKind,
    artifactType: 'config',
    role: 'input',
    parent: configParent,
  });
}

function assertArtifactMatchesReviewPack(reviewPack, artifact, {
  artifactKind,
  reviewPackPath = null,
  proofContext = null,
} = {}) {
  if (!artifact) return;

  if (proofContext) {
    assertProofArtifactMatchesReviewPack(artifact, { artifactKind, proofContext });
  }

  const reviewPackIdentity = extractReviewPackIdentity(reviewPack);
  const artifactIdentity = extractArtifactIdentity(artifact);
  const expectedReviewPackPath = proofContext?.reviewParent.path || reviewPackPath;
  const mismatches = collectIdentityMismatches(reviewPackIdentity, artifactIdentity);
  if (mismatches.length > 0) {
    throw new Error(
      `${artifactKind} does not match the supplied review_pack identity (${describeIdentity(reviewPackIdentity)} vs ${describeIdentity(artifactIdentity)}): ${mismatches.join('; ')}`
    );
  }

  const reviewPackRefs = findSourceArtifactRefs(artifact, 'review_pack');
  if (expectedReviewPackPath && reviewPackRefs.length > 0 && !reviewPackRefs.some((ref) => ref.path === expectedReviewPackPath)) {
    throw new Error(
      `${artifactKind} does not reference the supplied review_pack path (${expectedReviewPackPath}).`
    );
  }

  if (artifactKind === 'process_plan') {
    const basis = safeObject(artifact.planning_basis?.source_review_pack);
    if (proofContext) {
      const basisAliases = {
        packageSlug: requiredProofAlias(basis, 'package_slug', 'process_plan.planning_basis.source_review_pack.package_slug'),
        partId: requiredProofAlias(basis, 'part_id', 'process_plan.planning_basis.source_review_pack.part_id'),
        revision: requiredProofAlias(basis, 'revision', 'process_plan.planning_basis.source_review_pack.revision'),
        path: requiredProofAlias(basis, 'path', 'process_plan.planning_basis.source_review_pack.path'),
      };
      if (
        basisAliases.packageSlug !== proofContext.identity.package_slug
        || basisAliases.partId !== proofContext.identity.part_id
        || basisAliases.revision !== proofContext.identity.revision
        || basisAliases.path !== proofContext.reviewParent.path
      ) {
        throw lineageError('conflicting_identity', 'process_plan planning basis conflicts with the proof review-pack identity.', {
          artifact_type: artifactKind,
          parent: 'review_pack',
        });
      }
      if (
        basis.sha256 !== proofContext.reviewParent.sha256
        || basis.size_bytes !== proofContext.reviewParent.size_bytes
        || basis.config_sha256 !== proofContext.identity.config_sha256
      ) {
        throw lineageError('digest_mismatch', 'process_plan planning basis does not retain the exact proof review-pack/config binding.', {
          artifact_type: artifactKind,
          parent: 'review_pack',
        });
      }
    } else {
      if (expectedReviewPackPath && basis.path && basis.path !== expectedReviewPackPath) {
        throw new Error(
          `${artifactKind} planning_basis.source_review_pack.path does not match the supplied review_pack path (${expectedReviewPackPath}).`
        );
      }
      if (reviewPackIdentity.revision && basis.revision && basis.revision !== reviewPackIdentity.revision) {
        throw new Error(
          `${artifactKind} planning_basis.source_review_pack.revision does not match the supplied review_pack revision (${reviewPackIdentity.revision}).`
        );
      }
    }
  }
}

function assertComparableReadinessReports(baselineReport, candidateReport) {
  const baselineIdentity = extractArtifactIdentity(baselineReport, { includeRevision: false });
  const candidateIdentity = extractArtifactIdentity(candidateReport, { includeRevision: false });
  const mismatches = collectIdentityMismatches(baselineIdentity, candidateIdentity, {
    allowRevisionDifference: true,
  });

  if (mismatches.length > 0) {
    throw new Error(
      `Baseline and candidate readiness reports do not describe the same part lineage (${describeIdentity(baselineIdentity, { includeRevision: false })} vs ${describeIdentity(candidateIdentity, { includeRevision: false })}): ${mismatches.join('; ')}`
    );
  }
}

function buildArtifactEnvelope(payload, {
  kind,
  command,
  generatedAt = null,
  warnings = [],
  coverage = {},
  confidence = null,
  sourceArtifactRefs = [],
  revisionLineage = null,
}) {
  const contract = getCCommandContract(command);
  return {
    ...payload,
    schema_version: C_ARTIFACT_SCHEMA_VERSION,
    artifact_type: kind,
    generated_at: payload.generated_at || nowIso(generatedAt),
    warnings: uniqueStrings([...(payload.warnings || []), ...warnings]),
    coverage: payload.coverage || coverage,
    confidence: payload.confidence || confidence,
    source_artifact_refs: mergeSourceArtifactRefs(payload.source_artifact_refs || [], sourceArtifactRefs),
    ...(revisionLineage ? { revision_lineage: cloneJson(revisionLineage) } : {}),
    canonical_artifact: payload.canonical_artifact || buildCanonicalArtifactDescriptor(kind, contract),
    contract: payload.contract || contract,
  };
}

function buildReviewPackSourceRefs(reviewPack, reviewPackPath, proofContext = null) {
  return mergeSourceArtifactRefs(
    safeList(reviewPack.source_artifact_refs),
    proofContext
      ? [proofContext.sourceArtifactRef]
      : reviewPackPath
        ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'input', 'Canonical review-pack JSON')]
      : []
  );
}

function indexInspectionRecords(reviewPack) {
  const inspectionRecords = safeList(reviewPack.inspection_linkage?.records);
  return new Map(
    inspectionRecords
      .filter((record) => record?.record_id)
      .map((record) => [record.record_id, record])
  );
}

function indexInspectionAnomalies(reviewPack) {
  const anomalies = safeList(reviewPack.inspection_anomalies);
  return new Map(
    anomalies
      .filter((record) => record?.record_id)
      .map((record) => [record.record_id, record])
  );
}

function indexQualityRecords(reviewPack) {
  const qualityRecords = safeList(reviewPack.quality_linkage?.records);
  return new Map(
    qualityRecords
      .filter((record) => record?.issue_id)
      .map((record) => [record.issue_id, record])
  );
}

function actionMapForReviewPack(reviewPack) {
  return new Map(
    safeList(reviewPack.recommended_actions)
      .filter((action) => action?.category)
      .map((action) => [action.category, action])
  );
}

function buildProcessFlow(reviewPack) {
  const priorities = safeList(reviewPack.review_priorities);
  const actionsByCategory = actionMapForReviewPack(reviewPack);
  const inspectionRecordsById = indexInspectionRecords(reviewPack);
  const qualityRecordsById = indexQualityRecords(reviewPack);
  const steps = priorities.map((priority, index) => {
    const action = actionsByCategory.get(priority.category) || null;
    const linkedInspection = safeList(priority.related_inspection_records)
      .map((recordId) => inspectionRecordsById.get(recordId))
      .filter(Boolean);
    const linkedQuality = safeList(priority.related_quality_issues)
      .map((issueId) => qualityRecordsById.get(issueId))
      .filter(Boolean);
    return {
      step: (index + 1) * 10,
      operation: priority.title || `Review ${priority.category || 'priority'}`,
      execution_type: linkedInspection.length > 0 || linkedQuality.length > 0
        ? 'evidence_closure'
        : 'risk_review',
      priority_rank: priority.priority_rank ?? null,
      category: priority.category || null,
      score: priority.score ?? null,
      recommended_action: action?.recommended_action || null,
      related_inspection_records: linkedInspection.map((record) => ({
        record_id: record.record_id || null,
        dimension_name: record.dimension_name || null,
        status: record.status || null,
      })),
      related_quality_issues: linkedQuality.map((record) => ({
        issue_id: record.issue_id || null,
        description: record.description || null,
        defect_code: record.defect_code || null,
      })),
      completion_evidence: uniqueStrings([
        ...(linkedInspection.map((record) => record.dimension_name).filter(Boolean)),
        ...(linkedQuality.map((record) => record.description).filter(Boolean)),
        action?.recommended_action || '',
      ]),
      rationale: priority.rationale || null,
    };
  });

  const missingInputs = collectMissingInputs(reviewPack);
  if (missingInputs.length > 0) {
    steps.push({
      step: (steps.length + 1) * 10,
      operation: 'Close missing evidence before release',
      execution_type: 'evidence_gap_closure',
      priority_rank: null,
      category: 'evidence_gap',
      score: null,
      recommended_action: `Collect or validate: ${missingInputs.join(', ')}`,
      related_inspection_records: [],
      related_quality_issues: [],
      completion_evidence: missingInputs,
      rationale: 'Review-pack uncertainty report identified missing upstream evidence that must stay visible in C outputs.',
    });
  }

  if (steps.length === 0) {
    steps.push({
      step: 10,
      operation: 'Review upstream readiness evidence',
      execution_type: 'evidence_review',
      priority_rank: null,
      category: 'readiness_review',
      score: null,
      recommended_action: 'No prioritized hotspots were present; confirm the review-pack inputs and release assumptions.',
      related_inspection_records: [],
      related_quality_issues: [],
      completion_evidence: [],
      rationale: 'No review priorities were present in the supplied review pack.',
    });
  }

  return steps;
}

function buildKeyInspectionPoints(reviewPack) {
  const priorities = safeList(reviewPack.review_priorities);
  const priorityRankByCategory = new Map(
    priorities
      .filter((priority) => priority?.category)
      .map((priority) => [priority.category, priority.priority_rank ?? null])
  );
  const anomaliesById = indexInspectionAnomalies(reviewPack);
  const inspectionPoints = [];
  const seen = new Set();

  for (const record of safeList(reviewPack.inspection_linkage?.records)) {
    const categories = safeList(record.matched_categories);
    const primaryCategory = categories[0] || 'inspection_variation';
    const anomaly = anomaliesById.get(record.record_id) || {};
    const key = `${record.record_id || ''}|${record.dimension_name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    inspectionPoints.push({
      id: record.record_id || record.dimension_name || `inspection-${inspectionPoints.length + 1}`,
      checkpoint: record.dimension_name || 'Inspection checkpoint',
      status: record.status || anomaly.status || null,
      deviation: anomaly.magnitude ?? record.deviation ?? null,
      linked_categories: categories,
      priority_rank: priorityRankByCategory.get(primaryCategory) ?? null,
      rationale: record.rationale || null,
    });
  }

  return inspectionPoints;
}

function buildAutomationCandidates(reviewPack) {
  const triggerPattern = /\b(auto|automation|vision|camera|inline|fixture|probe)\b/i;
  return uniqueStrings(
    safeList(reviewPack.recommended_actions)
      .map((action) => action?.recommended_action)
      .filter((text) => typeof text === 'string' && triggerPattern.test(text))
  );
}

function buildProcessPlanCoverage(reviewPack, processFlow, inspectionPoints, automationCandidates, sourceArtifactRefs) {
  return {
    ...safeObject(reviewPack.coverage),
    review_priority_count: safeList(reviewPack.review_priorities).length,
    recommended_action_count: safeList(reviewPack.recommended_actions).length,
    process_step_count: processFlow.length,
    key_inspection_point_count: inspectionPoints.length,
    automation_candidate_count: automationCandidates.length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function buildProcessPlanFromReviewPack({
  reviewPack,
  reviewPackPath = null,
  reviewPackSnapshot = null,
  requireAuthoritativeLineage = false,
  generatedAt = null,
} = {}) {
  const proofContext = resolveProofReadinessContext({
    reviewPack,
    reviewPackPath,
    reviewPackSnapshot,
    requireAuthoritativeLineage,
  });
  assertValidDArtifact('review_pack', reviewPack, { command: 'process-plan' });
  return buildProcessPlanFromReviewPackCore({
    reviewPack,
    reviewPackPath,
    generatedAt: proofContext?.generatedAt || generatedAt,
    proofContext,
  });
}

function buildProcessPlanFromReviewPackCore({ reviewPack, reviewPackPath, generatedAt, proofContext }) {
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack);
  const normalizedPart = normalizePart(reviewPack.part, proofContext?.identity || null);
  const processFlow = buildProcessFlow(reviewPack);
  const inspectionPoints = buildKeyInspectionPoints(reviewPack);
  const automationCandidates = buildAutomationCandidates(reviewPack);
  const warnings = collectReviewPackWarnings(reviewPack);
  const missingInputs = collectMissingInputs(reviewPack);
  const sourceArtifactRefs = buildReviewPackSourceRefs(reviewPack, reviewPackPath, proofContext);
  const coverage = buildProcessPlanCoverage(
    reviewPack,
    processFlow,
    inspectionPoints,
    automationCandidates,
    sourceArtifactRefs
  );
  const confidence = buildPropagatedConfidence(reviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Process-plan-specific interpretation lives in planning_basis and summary fields instead of confidence.',
    ],
    sourceConfidenceRefs: proofContext
      ? [{ ...proofContext.sourceArtifactRef, role: 'confidence_source' }]
      : reviewPackPath
        ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
        : [],
  });

  return buildArtifactEnvelope({
    agent: 'process_planning',
    part: normalizedPart,
    summary: {
      overall_risk_level: riskLevelFromSignals({
        missingInputs,
        warnings,
        priorities: safeList(reviewPack.review_priorities),
      }),
      planning_mode: 'review_pack_execution',
      priority_count: safeList(reviewPack.review_priorities).length,
      recommended_action_count: safeList(reviewPack.recommended_actions).length,
      highest_priority_category: safeList(reviewPack.review_priorities)[0]?.category || null,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    planning_basis: {
      source_review_pack: {
        part_id: proofContext?.identity.part_id || reviewPack.part_id || null,
        revision: proofContext?.identity.revision || reviewPack.revision || null,
        generated_at: reviewPack.generated_at || null,
        path: proofContext?.reviewParent.path || reviewPackPath || null,
        ...(proofContext ? {
          package_slug: proofContext.identity.package_slug,
          config_sha256: proofContext.identity.config_sha256,
          sha256: proofContext.reviewParent.sha256,
          size_bytes: proofContext.reviewParent.size_bytes,
        } : {}),
      },
      review_pack_headline: executiveSummary.headline || null,
      top_risk_categories: safeList(executiveSummary.top_risk_categories),
      uncertainty_coverage_report: cloneJson(uncertaintyReport),
      upstream_confidence: cloneJson(reviewPack.confidence || {}),
    },
    process_flow: processFlow,
    key_inspection_points: inspectionPoints,
    automation_candidates: automationCandidates,
    bottleneck_risks: uniqueStrings([
      ...safeList(reviewPack.review_priorities).slice(0, 3).map((priority) => priority.title).filter(Boolean),
      ...missingInputs.map((item) => `Missing evidence: ${item}`),
    ]),
    planning_notes: uniqueStrings([
      ...warnings,
      missingInputs.length > 0
        ? 'Partial evidence propagated from review-pack uncertainty coverage report.'
        : '',
    ]),
  }, {
    kind: 'process_plan',
    command: 'process-plan',
    generatedAt,
    warnings,
    coverage,
    confidence,
    sourceArtifactRefs,
    revisionLineage: proofContext?.revisionLineage || null,
  });
}

function buildQualityRisks(reviewPack) {
  const actionsByCategory = actionMapForReviewPack(reviewPack);
  return safeList(reviewPack.review_priorities).map((priority, index) => {
    const action = actionsByCategory.get(priority.category) || null;
    return {
      risk_id: `quality-risk-${priority.priority_rank || index + 1}`,
      title: priority.title || `Review ${priority.category || 'priority'}`,
      category: priority.category || null,
      severity: rankToSeverity(priority.priority_rank),
      priority_rank: priority.priority_rank ?? null,
      score: priority.score ?? null,
      evidence_count: priority.evidence_count ?? 0,
      linked_inspection_records: safeList(priority.related_inspection_records),
      linked_quality_issues: safeList(priority.related_quality_issues),
      recommended_action: action?.recommended_action || null,
      rationale: priority.rationale || null,
      source: 'review_pack',
    };
  });
}

function buildCriticalDimensions(reviewPack) {
  const records = [];
  const seen = new Set();
  const anomaliesById = indexInspectionAnomalies(reviewPack);

  for (const record of safeList(reviewPack.inspection_linkage?.records)) {
    const key = record.dimension_name || record.record_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const anomaly = anomaliesById.get(record.record_id) || {};
    records.push({
      id: record.record_id || key,
      name: record.dimension_name || key,
      status: record.status || anomaly.status || null,
      deviation: anomaly.magnitude ?? record.deviation ?? null,
      linked_categories: safeList(record.matched_categories),
    });
  }

  return records;
}

function buildQualityGates(reviewPack, criticalDimensions, qualityRisks) {
  const gates = [];
  const seen = new Set();

  for (const dimension of criticalDimensions) {
    const key = `inspection|${dimension.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({
      gate_id: `gate-${dimension.id}`,
      title: `Verify ${dimension.name}`,
      gate_type: 'inspection_confirmation',
      linked_categories: safeList(dimension.linked_categories),
      status: dimension.status || null,
      deviation: dimension.deviation ?? null,
    });
  }

  for (const risk of qualityRisks) {
    const key = `risk|${risk.category}|${risk.priority_rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({
      gate_id: `gate-priority-${risk.priority_rank || gates.length + 1}`,
      title: risk.title,
      gate_type: risk.linked_quality_issues.length > 0 ? 'quality_containment' : 'readiness_review',
      linked_categories: risk.category ? [risk.category] : [],
      priority_rank: risk.priority_rank ?? null,
      recommended_action: risk.recommended_action || null,
    });
  }

  return gates;
}

function buildQualityRiskCoverage(reviewPack, criticalDimensions, qualityRisks, qualityGates, sourceArtifactRefs) {
  return {
    ...safeObject(reviewPack.coverage),
    critical_dimension_count: criticalDimensions.length,
    quality_risk_count: qualityRisks.length,
    quality_gate_count: qualityGates.length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function buildQualityRiskFromReviewPack({
  reviewPack,
  reviewPackPath = null,
  reviewPackSnapshot = null,
  requireAuthoritativeLineage = false,
  generatedAt = null,
} = {}) {
  const proofContext = resolveProofReadinessContext({
    reviewPack,
    reviewPackPath,
    reviewPackSnapshot,
    requireAuthoritativeLineage,
  });
  assertValidDArtifact('review_pack', reviewPack, { command: 'quality-risk' });
  return buildQualityRiskFromReviewPackCore({
    reviewPack,
    reviewPackPath,
    generatedAt: proofContext?.generatedAt || generatedAt,
    proofContext,
  });
}

function buildQualityRiskFromReviewPackCore({ reviewPack, reviewPackPath, generatedAt, proofContext }) {
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack);
  const normalizedPart = normalizePart(reviewPack.part, proofContext?.identity || null);
  const warnings = collectReviewPackWarnings(reviewPack);
  const missingInputs = collectMissingInputs(reviewPack);
  const sourceArtifactRefs = buildReviewPackSourceRefs(reviewPack, reviewPackPath, proofContext);
  const criticalDimensions = buildCriticalDimensions(reviewPack);
  const qualityRisks = buildQualityRisks(reviewPack);
  const qualityGates = buildQualityGates(reviewPack, criticalDimensions, qualityRisks);
  const coverage = buildQualityRiskCoverage(
    reviewPack,
    criticalDimensions,
    qualityRisks,
    qualityGates,
    sourceArtifactRefs
  );
  const confidence = buildPropagatedConfidence(reviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Quality-risk-specific interpretation lives in evidence_pack and summary fields instead of confidence.',
    ],
    sourceConfidenceRefs: proofContext
      ? [{ ...proofContext.sourceArtifactRef, role: 'confidence_source' }]
      : reviewPackPath
        ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
        : [],
  });

  return buildArtifactEnvelope({
    agent: 'quality_traceability',
    part: normalizedPart,
    summary: {
      overall_risk_level: riskLevelFromSignals({
        missingInputs,
        warnings,
        priorities: safeList(reviewPack.review_priorities),
      }),
      quality_signal_count: safeList(reviewPack.quality_linkage?.records).length,
      linked_priority_count: safeList(reviewPack.review_priorities).length,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    critical_dimensions: criticalDimensions,
    inspection_required_points: buildKeyInspectionPoints(reviewPack),
    traceability_summary: {
      source_file_count: safeObject(reviewPack.coverage).source_file_count ?? 0,
      evidence_record_count: safeObject(reviewPack.evidence_ledger).record_count ?? 0,
      inspection_record_count: safeObject(reviewPack.coverage).inspection_record_count ?? 0,
      quality_issue_count: safeObject(reviewPack.coverage).quality_issue_count ?? 0,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    quality_risks: qualityRisks,
    quality_gates: qualityGates,
    evidence_pack: {
      review_pack_headline: executiveSummary.headline || null,
      linkage_summary: {
        inspection: cloneJson(reviewPack.inspection_linkage?.summary || {}),
        quality: cloneJson(reviewPack.quality_linkage?.summary || {}),
      },
      uncertainty_coverage_report: cloneJson(uncertaintyReport),
      data_quality_notes: cloneJson(reviewPack.data_quality_notes || []),
      upstream_confidence: cloneJson(reviewPack.confidence || {}),
    },
  }, {
    kind: 'quality_risk',
    command: 'quality-risk',
    generatedAt,
    warnings,
    coverage,
    confidence,
    sourceArtifactRefs,
    revisionLineage: proofContext?.revisionLineage || null,
  });
}

function calculateReadinessScore(reviewPack, processPlan, qualityRisk, warnings, missingInputs) {
  const reviewPackConfidence = Number.isFinite(reviewPack?.confidence?.score) ? reviewPack.confidence.score : 0.5;
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack || {});
  const uncertaintyScore = Number.isFinite(uncertaintyReport.numeric_score)
    ? uncertaintyReport.numeric_score
    : reviewPackConfidence;
  const baseScore = 30 + (uncertaintyScore * 30) + (reviewPackConfidence * 25);
  const warningPenalty = warnings.length * 5;
  const missingInputPenalty = missingInputs.length * 8;
  const gateCoverageBonus = Math.min((qualityRisk.quality_gates || []).length, 4) * 2;
  const planCoverageBonus = Math.min((processPlan.process_flow || []).length, 5);
  const rawScore = baseScore + gateCoverageBonus + planCoverageBonus - warningPenalty - missingInputPenalty;
  return Math.max(20, Math.min(95, Math.round(rawScore)));
}

function readinessStatusForScore(score, missingInputs, confidenceLevel) {
  if (missingInputs.length > 0 || confidenceLevel === 'low') {
    return {
      status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
    };
  }
  if (score >= 80) {
    return {
      status: 'candidate_for_pilot_line_review',
      gate_decision: 'candidate_for_pilot_line_review',
    };
  }
  if (score >= 65) {
    return {
      status: 'needs_risk_reduction',
      gate_decision: 'hold_before_line_commitment',
    };
  }
  return {
    status: 'hold_before_line_commitment',
    gate_decision: 'hold_before_line_commitment',
  };
}

function buildReadinessSummary(report, missingInputs) {
  const score = calculateReadinessScore(
    report.review_pack,
    report.process_plan,
    report.quality_risk,
    safeList(report.warnings),
    missingInputs
  );
  return {
    score,
    ...readinessStatusForScore(score, missingInputs, report.confidence.level),
  };
}

function buildDecisionSummary(reviewPack, processPlan, qualityRisk, readinessSummary, warnings, missingInputs) {
  const goSignals = [];
  const holdPoints = [];

  if (missingInputs.length === 0) {
    goSignals.push('Canonical review-pack includes geometry, inspection, and quality evidence for downstream readiness packaging.');
  } else {
    holdPoints.push(`Upstream evidence is still partial: ${missingInputs.join(', ')}.`);
  }

  if ((processPlan.process_flow || []).length > 0) {
    goSignals.push('Manufacturing execution steps were derived directly from review priorities and recommended actions.');
  }

  if ((qualityRisk.quality_gates || []).length > 0) {
    goSignals.push('Quality gates and inspection-required points are explicitly listed for downstream follow-up.');
  } else {
    holdPoints.push('No auditable quality gates were derived from the supplied review pack.');
  }

  if (warnings.length > 0) {
    holdPoints.push(`Propagated warnings remain open: ${warnings.slice(0, 3).join('; ')}.`);
  }

  if (readinessSummary.status === 'candidate_for_pilot_line_review') {
    goSignals.push('Evidence completeness and propagated confidence are sufficient for pilot-line planning review.');
  } else {
    holdPoints.push('Release readiness remains gated until the open evidence and risk actions are closed.');
  }

  const nextActions = uniqueStrings([
    ...safeList(reviewPack.recommended_actions).map((action) => action.recommended_action),
    ...safeList(processPlan.process_flow).map((step) => step.recommended_action),
    ...safeList(qualityRisk.quality_risks).map((risk) => risk.recommended_action),
  ]).slice(0, 5);

  return {
    go_signals: goSignals,
    hold_points: holdPoints,
    next_actions: nextActions,
  };
}

function buildReportSummary(reviewPack, processPlan, qualityRisk, readinessSummary, warnings, missingInputs) {
  const prioritizedHotspots = getReviewPackPrioritizedHotspots(reviewPack);
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  return {
    overall_risk_level: readinessSummary.status === 'candidate_for_pilot_line_review'
      ? 'low'
      : readinessSummary.status === 'needs_risk_reduction'
        ? 'medium'
        : 'high',
    top_issues: uniqueStrings([
      ...prioritizedHotspots.slice(0, 3).map((item) => item.title),
      ...missingInputs.map((item) => `Missing evidence: ${item}`),
      ...warnings.slice(0, 2),
    ]).slice(0, 5),
    recommended_actions: uniqueStrings([
      ...safeList(reviewPack.recommended_actions).map((action) => action.recommended_action),
      ...safeList(processPlan.process_flow).map((step) => step.recommended_action),
    ]).slice(0, 5),
    likely_bottleneck_candidates: safeList(processPlan.bottleneck_risks).slice(0, 5),
    likely_automation_candidates: safeList(processPlan.automation_candidates).slice(0, 5),
    launch_stabilization_focus: [],
    review_pack_headline: executiveSummary.headline || null,
  };
}

function buildReadinessCoverage(reviewPack, processPlan, qualityRisk, sourceArtifactRefs) {
  const evidenceLedger = getReviewPackEvidenceLedger(reviewPack);
  return {
    ...safeObject(reviewPack.coverage),
    required_section_count: 4,
    available_section_count: 4,
    process_step_count: safeList(processPlan.process_flow).length,
    quality_gate_count: safeList(qualityRisk.quality_gates).length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    evidence_record_count: evidenceLedger.record_count ?? 0,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function renderCanonicalReadinessMarkdown(report) {
  const reviewPack = safeObject(report.review_pack);
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const summary = safeObject(report.summary);
  const decision = safeObject(report.decision_summary);
  const warnings = safeList(report.warnings);
  const missingInputs = collectMissingInputs(reviewPack);

  return `# Production Readiness Report: ${report.part.name}

- Status: ${report.readiness_summary.status}
- Composite score: ${report.readiness_summary.score}
- Gate decision: ${report.readiness_summary.gate_decision}
- Review-pack headline: ${executiveSummary.headline || 'n/a'}

## Executive Summary

- Overall risk level: ${summary.overall_risk_level ?? 'n/a'}
- Top issues: ${(summary.top_issues || []).join('; ') || 'none'}
- Recommended actions: ${(summary.recommended_actions || []).join('; ') || 'none'}
- Missing inputs: ${missingInputs.join(', ') || 'none'}

## Process Plan

- Flow steps: ${(report.process_plan?.process_flow || []).length}
- Key inspection points: ${(report.process_plan?.key_inspection_points || []).length}
- Bottleneck risks: ${(report.process_plan?.bottleneck_risks || []).join('; ') || 'none'}

## Quality Risk

- Critical dimensions: ${(report.quality_risk?.critical_dimensions || []).length}
- Quality risks: ${(report.quality_risk?.quality_risks || []).length}
- Quality gates: ${(report.quality_risk?.quality_gates || []).length}

## Decision Summary

- Go signals: ${(decision.go_signals || []).join('; ') || 'none'}
- Hold points: ${(decision.hold_points || []).join('; ') || 'none'}
- Next actions: ${(decision.next_actions || []).join('; ') || 'none'}

## Propagated Signals

- Warnings: ${warnings.join('; ') || 'none'}
- Confidence: ${report.confidence?.level || 'n/a'} (${report.confidence?.score ?? 'n/a'})
`;
}

export function buildReadinessReportFromReviewPack({
  reviewPack,
  reviewPackPath = null,
  reviewPackSnapshot = null,
  requireAuthoritativeLineage = false,
  processPlan = null,
  qualityRisk = null,
  generatedAt = null,
} = {}) {
  const proofContext = resolveProofReadinessContext({
    reviewPack,
    reviewPackPath,
    reviewPackSnapshot,
    requireAuthoritativeLineage,
  });
  assertValidDArtifact('review_pack', reviewPack, { command: 'readiness-report' });
  const readinessReviewPack = normalizeReviewPackInspectionEvidenceCoverage(reviewPack);
  assertArtifactMatchesReviewPack(readinessReviewPack, processPlan, {
    artifactKind: 'process_plan',
    reviewPackPath,
    proofContext,
  });
  assertArtifactMatchesReviewPack(readinessReviewPack, qualityRisk, {
    artifactKind: 'quality_risk',
    reviewPackPath,
    proofContext,
  });

  const resolvedProcessPlan = processPlan || buildProcessPlanFromReviewPackCore({
    reviewPack: readinessReviewPack,
    reviewPackPath,
    generatedAt: proofContext?.generatedAt || generatedAt,
    proofContext,
  });
  const resolvedQualityRisk = qualityRisk || buildQualityRiskFromReviewPackCore({
    reviewPack: readinessReviewPack,
    reviewPackPath,
    generatedAt: proofContext?.generatedAt || generatedAt,
    proofContext,
  });
  const sourceArtifactRefs = mergeSourceArtifactRefs(
    buildReviewPackSourceRefs(readinessReviewPack, reviewPackPath, proofContext),
    mergeSourceArtifactRefs(
      safeList(resolvedProcessPlan.source_artifact_refs),
      safeList(resolvedQualityRisk.source_artifact_refs)
    )
  );
  const warnings = uniqueStrings([
    ...collectReviewPackWarnings(readinessReviewPack),
    ...safeList(resolvedProcessPlan.warnings),
    ...safeList(resolvedQualityRisk.warnings),
  ]);
  const confidence = buildPropagatedConfidence(readinessReviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Readiness score, gate decision, and action synthesis remain downstream packaging fields, not confidence rewrites.',
    ],
    sourceConfidenceRefs: [
      ...(proofContext
        ? [{ ...proofContext.sourceArtifactRef, role: 'confidence_source' }]
        : reviewPackPath
          ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
          : []),
      ...safeList(resolvedProcessPlan.source_artifact_refs).filter((ref) => ref.artifact_type === 'review_pack'),
      ...safeList(resolvedQualityRisk.source_artifact_refs).filter((ref) => ref.artifact_type === 'review_pack'),
    ],
  });

  const report = buildArtifactEnvelope({
    workflow: 'production_readiness',
    part: normalizePart(readinessReviewPack.part, proofContext?.identity || null),
    review_pack: cloneJson(proofContext ? reviewPack : readinessReviewPack),
    process_plan: resolvedProcessPlan,
    quality_risk: resolvedQualityRisk,
  }, {
    kind: 'readiness_report',
    command: 'readiness-report',
    generatedAt: proofContext?.generatedAt || generatedAt,
    warnings,
    coverage: buildReadinessCoverage(readinessReviewPack, resolvedProcessPlan, resolvedQualityRisk, sourceArtifactRefs),
    confidence,
    sourceArtifactRefs,
    revisionLineage: proofContext?.revisionLineage || null,
  });

  const missingInputs = collectMissingInputs(readinessReviewPack);
  report.readiness_summary = buildReadinessSummary(report, missingInputs);
  report.summary = buildReportSummary(readinessReviewPack, resolvedProcessPlan, resolvedQualityRisk, report.readiness_summary, warnings, missingInputs);
  report.decision_summary = buildDecisionSummary(readinessReviewPack, resolvedProcessPlan, resolvedQualityRisk, report.readiness_summary, warnings, missingInputs);
  report.markdown = renderCanonicalReadinessMarkdown(report);
  return report;
}

function getExactReviewPackParent(revisionLineage) {
  const parents = safeList(revisionLineage?.parents).filter((parent) => (
    parent?.artifact_type === 'review_pack' && parent?.role === 'review_pack'
  ));
  if (parents.length === 0) {
    throw lineageError('missing_parent', 'Proof readiness lineage requires one exact review-pack parent.', {
      parent: 'review_pack',
    });
  }
  if (parents.length !== 1) {
    throw lineageError('conflicting_identity', 'Proof readiness lineage must contain exactly one review-pack parent.', {
      parent: 'review_pack',
      count: parents.length,
    });
  }
  return parents[0];
}

function assertReadinessOutputDoesNotAliasReviewParent(
  outputJsonPath,
  projectRoot,
  reviewParent,
  reviewPackSnapshot
) {
  const outputJson = resolve(outputJsonPath);
  const outputMarkdown = outputJson.replace(/\.json$/i, '.md');
  const actualReviewLocator = resolveReviewPackLocator(null, reviewPackSnapshot);
  if (reviewParent.path !== proofRunLocator(actualReviewLocator)) {
    throw lineageError('conflicting_identity', 'Proof readiness review parent has an invalid portable run locator.', {
      parent: 'review_pack',
      parent_path: reviewParent.path,
    });
  }
  const reviewPath = resolve(projectRoot, actualReviewLocator);
  if (dirname(outputJson) !== dirname(reviewPath)) {
    throw lineageError(
      'unsafe_path',
      'Proof readiness output must share the review-pack run directory so run/ parents remain revalidatable.',
      { parent: 'review_pack', parent_path: reviewParent.path }
    );
  }
  if (outputJson === reviewPath || outputMarkdown === reviewPath) {
    throw lineageError('unsafe_path', 'Proof readiness output cannot overwrite its bound review-pack parent.', {
      parent: 'review_pack',
      parent_path: reviewParent.path,
    });
  }
}

async function verifyReadinessReviewParentBeforeWrite(report, reviewPackSnapshot, projectRoot) {
  if (!report?.revision_lineage) {
    throw lineageError('unsupported_legacy', 'Proof readiness publication requires revision_lineage.', {
      artifact_type: report?.artifact_type || null,
    });
  }
  assertRevisionLineage(report.revision_lineage);
  if (!report.review_pack?.revision_lineage) {
    throw lineageError('unsupported_legacy', 'Proof readiness publication requires an embedded proof review pack.', {
      artifact_type: 'review_pack',
    });
  }
  assertRevisionLineage(report.review_pack.revision_lineage);
  assertRevisionLineageIdentityAgreement([
    report.revision_lineage,
    report.review_pack.revision_lineage,
  ]);
  assertProofReviewAliases(report.review_pack, report.revision_lineage.identity);
  const embeddedConfigParent = report.review_pack.revision_lineage.parents.find((parent) => (
    parent.role === 'authoritative_config'
  ));
  assertExactProofSourceRef(report.review_pack, {
    artifactKind: 'review_pack',
    artifactType: 'config',
    role: 'input',
    parent: embeddedConfigParent,
  });

  const reviewParent = getExactReviewPackParent(report.revision_lineage);
  const expectedReportLineage = buildRevisionLineage({
    identity: report.review_pack.revision_lineage.identity,
    parents: [...report.review_pack.revision_lineage.parents, reviewParent],
  });
  assertRevisionLineageParentAgreement(expectedReportLineage, report.revision_lineage);
  const actualReviewLocator = resolveReviewPackLocator(null, reviewPackSnapshot);
  if (reviewParent.path !== proofRunLocator(actualReviewLocator)) {
    throw lineageError('conflicting_identity', 'Proof readiness review parent has an invalid portable run locator.', {
      parent: 'review_pack',
      parent_path: reviewParent.path,
    });
  }
  const snapshot = assertReviewPackSnapshotIntegrity(reviewPackSnapshot, {
    reviewPack: report.review_pack,
  });
  if (snapshot.sha256 !== reviewParent.sha256 || snapshot.size_bytes !== reviewParent.size_bytes) {
    throw lineageError('digest_mismatch', 'Readiness review-pack parent does not match the supplied immutable snapshot.', {
      parent: 'review_pack',
      expected_sha256: reviewParent.sha256,
      actual_sha256: snapshot.sha256,
      expected_size_bytes: reviewParent.size_bytes,
      actual_size_bytes: snapshot.size_bytes,
    });
  }

  const proofContext = {
    identity: report.revision_lineage.identity,
    revisionLineage: report.revision_lineage,
    reviewParent,
    sourceArtifactRef: {
      artifact_type: 'review_pack',
      path: reviewParent.path,
      role: 'input',
      label: 'Canonical review-pack JSON',
      sha256: reviewParent.sha256,
      size_bytes: reviewParent.size_bytes,
    },
  };
  assertProofArtifactMatchesReviewPack(report, {
    artifactKind: 'readiness_report',
    proofContext,
  });
  assertArtifactMatchesReviewPack(report.review_pack, report.process_plan, {
    artifactKind: 'process_plan',
    reviewPackPath: reviewParent.path,
    proofContext,
  });
  assertArtifactMatchesReviewPack(report.review_pack, report.quality_risk, {
    artifactKind: 'quality_risk',
    reviewPackPath: reviewParent.path,
    proofContext,
  });
  try {
    const current = await readRevisionLineageFileSnapshot({
      projectRoot,
      path: actualReviewLocator,
      maxBytes: MAX_REVIEW_PACK_BYTES,
    });
    if (current.sha256 !== snapshot.sha256 || current.size_bytes !== snapshot.size_bytes) {
      throw lineageError('stale_parent', 'Review-pack bytes changed after readiness lineage validation.', {
        parent: 'review_pack',
      });
    }
  } catch (error) {
    if (error?.code === 'digest_mismatch' || error?.code === 'stale_parent') {
      throw lineageError('stale_parent', 'Review-pack bytes changed after readiness lineage validation.', {
        parent: 'review_pack',
        cause_code: error.code,
      });
    }
    throw error;
  }
}

export async function writeCanonicalReadinessArtifacts(outputJsonPath, report, {
  projectRoot = REPOSITORY_ROOT,
  reviewPackSnapshot = null,
  requireAuthoritativeLineage = false,
} = {}) {
  if (requireAuthoritativeLineage !== true && requireAuthoritativeLineage !== false) {
    throw lineageError('malformed_policy', 'requireAuthoritativeLineage must be a boolean.', {
      require_authoritative_lineage: requireAuthoritativeLineage,
    });
  }
  const reportSnapshot = cloneJson(report);
  if (reportSnapshot?.revision_lineage && requireAuthoritativeLineage !== true) {
    throw lineageError('malformed_policy', 'A proof readiness report cannot be published without explicit proof policy.', {
      require_authoritative_lineage: requireAuthoritativeLineage,
    });
  }
  if (requireAuthoritativeLineage === true) {
    assertReadinessOutputDoesNotAliasReviewParent(
      outputJsonPath,
      projectRoot,
      getExactReviewPackParent(reportSnapshot?.revision_lineage),
      reviewPackSnapshot
    );
    await verifyReadinessReviewParentBeforeWrite(reportSnapshot, reviewPackSnapshot, projectRoot);
  }
  assertValidCArtifact('readiness_report', reportSnapshot, {
    command: 'readiness-report',
    path: resolve(outputJsonPath),
  });
  return writeReadinessArtifactPair({
    projectRoot,
    outputJsonPath,
    jsonContent: `${JSON.stringify(reportSnapshot, null, 2)}\n`,
    markdownContent: `${String(reportSnapshot.markdown || '').trim()}\n`,
  });
}

function diffLists(baseline, candidate) {
  const baselineSet = new Set(safeList(baseline));
  const candidateSet = new Set(safeList(candidate));
  return {
    added: [...candidateSet].filter((item) => !baselineSet.has(item)),
    removed: [...baselineSet].filter((item) => !candidateSet.has(item)),
  };
}

function collectMissingInputsFromReport(report) {
  return uniqueStrings([
    ...safeList(report.review_pack?.uncertainty_coverage_report?.missing_inputs),
    ...safeList(report.process_plan?.summary?.missing_inputs),
    ...safeList(report.quality_risk?.summary?.missing_inputs),
  ]);
}

function buildStabilizationChangeReasons(baseline, candidate) {
  const reasons = [];
  const baselineMissing = collectMissingInputsFromReport(baseline);
  const candidateMissing = collectMissingInputsFromReport(candidate);
  const warningDiff = diffLists(baseline.warnings, candidate.warnings);
  const actionDiff = diffLists(
    safeList(baseline.summary?.recommended_actions),
    safeList(candidate.summary?.recommended_actions)
  );
  const topIssueDiff = diffLists(
    safeList(baseline.summary?.top_issues),
    safeList(candidate.summary?.top_issues)
  );
  const riskCategoryDiff = diffLists(
    safeList(getReviewPackExecutiveSummary(baseline.review_pack || {}).top_risk_categories),
    safeList(getReviewPackExecutiveSummary(candidate.review_pack || {}).top_risk_categories)
  );

  const readinessDelta = (candidate.readiness_summary?.score || 0) - (baseline.readiness_summary?.score || 0);
  if (readinessDelta !== 0) {
    reasons.push({
      change_type: 'readiness_score',
      delta: readinessDelta,
      reason: `Readiness score changed from ${baseline.readiness_summary?.score ?? 'n/a'} to ${candidate.readiness_summary?.score ?? 'n/a'}.`,
    });
  }
  if (baselineMissing.length !== candidateMissing.length || baselineMissing.join('|') !== candidateMissing.join('|')) {
    reasons.push({
      change_type: 'missing_evidence',
      baseline_missing_inputs: baselineMissing,
      candidate_missing_inputs: candidateMissing,
      reason: candidateMissing.length > baselineMissing.length
        ? 'Candidate readiness report carries more missing upstream evidence.'
        : 'Candidate readiness report closes some previously missing upstream evidence.',
    });
  }
  if (warningDiff.added.length > 0 || warningDiff.removed.length > 0) {
    reasons.push({
      change_type: 'warning_propagation',
      added: warningDiff.added,
      removed: warningDiff.removed,
      reason: 'Propagated warnings changed between the compared readiness reports.',
    });
  }
  if (topIssueDiff.added.length > 0 || topIssueDiff.removed.length > 0) {
    reasons.push({
      change_type: 'top_issue_shift',
      added: topIssueDiff.added,
      removed: topIssueDiff.removed,
      reason: 'The top readiness issues changed between the compared artifacts.',
    });
  }
  if (riskCategoryDiff.added.length > 0 || riskCategoryDiff.removed.length > 0) {
    reasons.push({
      change_type: 'priority_category_shift',
      added: riskCategoryDiff.added,
      removed: riskCategoryDiff.removed,
      reason: 'Upstream review-pack risk categories shifted between revisions.',
    });
  }
  if (actionDiff.added.length > 0 || actionDiff.removed.length > 0) {
    reasons.push({
      change_type: 'action_register',
      added: actionDiff.added,
      removed: actionDiff.removed,
      reason: 'Recommended action register changed between readiness revisions.',
    });
  }

  const baselineConfidence = safeObject(baseline.confidence);
  const candidateConfidence = safeObject(candidate.confidence);
  if ((baselineConfidence.score ?? null) !== (candidateConfidence.score ?? null)) {
    reasons.push({
      change_type: 'confidence_shift',
      baseline_score: baselineConfidence.score ?? null,
      candidate_score: candidateConfidence.score ?? null,
      baseline_level: baselineConfidence.level || null,
      candidate_level: candidateConfidence.level || null,
      reason: 'Composite readiness confidence changed because upstream evidence completeness or warnings changed.',
    });
  }

  return reasons;
}

function buildComparisonSummary(baseline, candidate, changeReasons) {
  const readinessDelta = (candidate.readiness_summary?.score || 0) - (baseline.readiness_summary?.score || 0);
  return {
    comparison_basis: 'readiness_report_delta',
    baseline_revision: baseline.part?.revision || null,
    candidate_revision: candidate.part?.revision || null,
    status_change: baseline.readiness_summary?.status === candidate.readiness_summary?.status
      ? 'unchanged'
      : `${baseline.readiness_summary?.status || 'unknown'} -> ${candidate.readiness_summary?.status || 'unknown'}`,
    readiness_score_delta: readinessDelta,
    higher_risk_revision: readinessDelta < 0
      ? candidate.part?.revision || 'candidate'
      : baseline.part?.revision || 'baseline',
    key_change_drivers: changeReasons.map((reason) => reason.reason).slice(0, 5),
    recommended_actions: uniqueStrings([
      ...safeList(candidate.summary?.recommended_actions),
      ...safeList(candidate.decision_summary?.next_actions),
    ]).slice(0, 5),
  };
}

function buildComparisonCoverage(baseline, candidate, sourceArtifactRefs) {
  return {
    baseline_warning_count: safeList(baseline.warnings).length,
    candidate_warning_count: safeList(candidate.warnings).length,
    baseline_missing_input_count: collectMissingInputsFromReport(baseline).length,
    candidate_missing_input_count: collectMissingInputsFromReport(candidate).length,
    baseline_process_step_count: safeList(baseline.process_plan?.process_flow).length,
    candidate_process_step_count: safeList(candidate.process_plan?.process_flow).length,
    baseline_quality_gate_count: safeList(baseline.quality_risk?.quality_gates).length,
    candidate_quality_gate_count: safeList(candidate.quality_risk?.quality_gates).length,
    source_artifact_count: sourceArtifactRefs.length,
  };
}

export function buildStabilizationReviewFromReadinessReports({
  baselineReport,
  candidateReport,
  baselinePath = null,
  candidatePath = null,
  generatedAt = null,
} = {}) {
  assertValidCArtifact('readiness_report', baselineReport, { command: 'stabilization-review' });
  assertValidCArtifact('readiness_report', candidateReport, { command: 'stabilization-review' });
  assertComparableReadinessReports(baselineReport, candidateReport);

  const sourceArtifactRefs = mergeSourceArtifactRefs(
    mergeSourceArtifactRefs(
      safeList(baselineReport.source_artifact_refs),
      baselinePath ? [buildSourceArtifactRef('readiness_report', baselinePath, 'input', 'Baseline readiness report')] : []
    ),
    mergeSourceArtifactRefs(
      safeList(candidateReport.source_artifact_refs),
      candidatePath ? [buildSourceArtifactRef('readiness_report', candidatePath, 'input', 'Candidate readiness report')] : []
    )
  );
  const changeReasons = buildStabilizationChangeReasons(baselineReport, candidateReport);
  const warnings = uniqueStrings([
    ...safeList(baselineReport.warnings),
    ...safeList(candidateReport.warnings),
  ]);
  const confidence = buildPropagatedConfidence(candidateReport.confidence, {
    propagatedFrom: 'candidate_readiness_report',
    propagationNotes: [
      'Stabilization review preserves the candidate readiness confidence without recalculating score or level.',
      'Baseline-versus-candidate confidence differences are reported under change_reasons instead of being folded into a new confidence value.',
    ],
    sourceConfidenceRefs: [
      ...(candidatePath
        ? [buildSourceArtifactRef('readiness_report', candidatePath, 'confidence_source', 'Candidate readiness confidence source')]
        : []),
      ...(baselinePath
        ? [buildSourceArtifactRef('readiness_report', baselinePath, 'comparison_confidence_source', 'Baseline readiness confidence reference')]
        : []),
    ],
  });

  return buildArtifactEnvelope({
    agent: 'stabilization_review',
    part: normalizePart(candidateReport.part || baselineReport.part || {}),
    summary: buildComparisonSummary(baselineReport, candidateReport, changeReasons),
    comparison_basis: {
      mode: 'readiness_report_delta',
      baseline_path: baselinePath || null,
      candidate_path: candidatePath || null,
    },
    baseline: {
      revision: baselineReport.part?.revision || null,
      readiness_summary: cloneJson(baselineReport.readiness_summary || {}),
      summary: cloneJson(baselineReport.summary || {}),
      warnings: cloneJson(baselineReport.warnings || []),
      coverage: cloneJson(baselineReport.coverage || {}),
      confidence: cloneJson(baselineReport.confidence || {}),
    },
    candidate: {
      revision: candidateReport.part?.revision || null,
      readiness_summary: cloneJson(candidateReport.readiness_summary || {}),
      summary: cloneJson(candidateReport.summary || {}),
      warnings: cloneJson(candidateReport.warnings || []),
      coverage: cloneJson(candidateReport.coverage || {}),
      confidence: cloneJson(candidateReport.confidence || {}),
    },
    readiness_deltas: {
      score_delta: (candidateReport.readiness_summary?.score || 0) - (baselineReport.readiness_summary?.score || 0),
      warning_delta: safeList(candidateReport.warnings).length - safeList(baselineReport.warnings).length,
      missing_input_delta: collectMissingInputsFromReport(candidateReport).length - collectMissingInputsFromReport(baselineReport).length,
      process_step_delta: safeList(candidateReport.process_plan?.process_flow).length - safeList(baselineReport.process_plan?.process_flow).length,
      quality_gate_delta: safeList(candidateReport.quality_risk?.quality_gates).length - safeList(baselineReport.quality_risk?.quality_gates).length,
    },
    change_reasons: changeReasons,
    recommended_action_changes: {
      ...diffLists(
        safeList(baselineReport.summary?.recommended_actions),
        safeList(candidateReport.summary?.recommended_actions)
      ),
    },
    warning_changes: {
      ...diffLists(baselineReport.warnings, candidateReport.warnings),
    },
  }, {
    kind: 'stabilization_review',
    command: 'stabilization-review',
    generatedAt,
    warnings,
    coverage: buildComparisonCoverage(baselineReport, candidateReport, sourceArtifactRefs),
    confidence,
    sourceArtifactRefs,
  });
}
