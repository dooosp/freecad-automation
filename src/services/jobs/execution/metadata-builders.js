import {
  buildAfArtifactContractMetadata,
  buildCompatibilityMarkers,
  createAfArtifactIdentityRecord,
} from '../../../../lib/af-execution-contract.js';

function buildLineageIdentity(document = {}) {
  const part = document?.part && typeof document.part === 'object' ? document.part : {};
  return {
    part_id: part.part_id || document.part_id || null,
    name: part.name || null,
    revision: part.revision || document.revision || null,
  };
}

export function buildGenericAfMetadata(jobType, document, executionNotes = []) {
  return buildAfArtifactContractMetadata({
    jobType,
    artifactIdentity: createAfArtifactIdentityRecord({
      artifactType: document?.artifact_type || jobType,
      schemaVersion: document?.schema_version || '1.0',
      sourceArtifactRefs: document?.source_artifact_refs || [],
      warnings: document?.warnings || [],
      coverage: document?.coverage || {},
      confidence: document?.confidence || {
        level: 'heuristic',
        score: 0.5,
        rationale: `${jobType} artifact metadata was derived from the canonical JSON output.`,
      },
      lineage: buildLineageIdentity(document),
      compatibility: buildCompatibilityMarkers(document),
    }),
    executionNotes,
  });
}

export function buildReleaseBundleMetadata({
  readinessReport,
  releaseBundleManifest,
}) {
  const lineage = buildLineageIdentity(readinessReport);
  return buildAfArtifactContractMetadata({
    jobType: 'pack',
    target: 'release_bundle',
    artifactIdentity: createAfArtifactIdentityRecord({
      artifactType: 'release_bundle',
      schemaVersion: releaseBundleManifest?.schema_version || '1.0',
      sourceArtifactRefs: releaseBundleManifest?.source_artifact_refs || [],
      warnings: releaseBundleManifest?.warnings || [],
      coverage: releaseBundleManifest?.coverage || {},
      confidence: releaseBundleManifest?.confidence || {
        level: 'heuristic',
        score: 0.5,
        rationale: 'Release bundle metadata was derived from the release bundle manifest.',
      },
      lineage,
      compatibility: {
        mode: 'canonical',
        canonical_review_pack_backed: null,
        markers: ['derived_transport_artifact', ...(buildCompatibilityMarkers(releaseBundleManifest).markers || [])],
      },
    }),
    executionNotes: [
      'release_bundle.zip is a derived transport artifact backed by canonical packaging metadata.',
    ],
  });
}

export function buildReleaseBundleManifestMetadata({
  readinessReport,
  releaseBundleManifest,
}) {
  const lineage = buildLineageIdentity(readinessReport);
  return buildAfArtifactContractMetadata({
    jobType: 'pack',
    artifactIdentity: createAfArtifactIdentityRecord({
      artifactType: releaseBundleManifest?.artifact_type || 'release_bundle_manifest',
      schemaVersion: releaseBundleManifest?.schema_version || '1.0',
      sourceArtifactRefs: releaseBundleManifest?.source_artifact_refs || [],
      warnings: releaseBundleManifest?.warnings || [],
      coverage: releaseBundleManifest?.coverage || {},
      confidence: releaseBundleManifest?.confidence || {
        level: 'heuristic',
        score: 0.5,
        rationale: 'Release bundle manifest metadata was derived from the release bundle manifest.',
      },
      lineage,
      compatibility: buildCompatibilityMarkers(releaseBundleManifest),
    }),
    executionNotes: [
      'Release bundle manifest preserves readiness lineage for reopenable packaging metadata.',
    ],
  });
}
