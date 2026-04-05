import { assertValidCArtifact } from './c-artifact-schema.js';
import { assertValidDArtifact } from './d-artifact-schema.js';

export const AF_EXECUTION_CONTRACT_VERSION = 'af1';
export const AF_EXECUTION_LIFECYCLE_STATES = Object.freeze([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);
export const AF_EXECUTION_STATE_ALIASES = Object.freeze({
  cancelled: 'canceled',
});

const AF_EXECUTION_JOB_CONTRACTS = Object.freeze({
  'review-context': Object.freeze({
    command: 'review-context',
    layer: 'A+F',
    reentry_target: 'review_pack',
    canonical_output: 'review_pack.json',
  }),
  'compare-rev': Object.freeze({
    command: 'compare-rev',
    layer: 'A+F',
    reentry_target: null,
    canonical_output: 'revision_comparison.json',
  }),
  'readiness-pack': Object.freeze({
    command: 'readiness-pack',
    layer: 'A+F',
    reentry_target: 'readiness_report',
    canonical_output: 'readiness_report.json',
  }),
  'readiness-report': Object.freeze({
    command: 'readiness-report',
    layer: 'A+F',
    reentry_target: 'readiness_report',
    canonical_output: 'readiness_report.json',
  }),
  'stabilization-review': Object.freeze({
    command: 'stabilization-review',
    layer: 'A+F',
    reentry_target: null,
    canonical_output: 'stabilization_review.json',
  }),
  'generate-standard-docs': Object.freeze({
    command: 'generate-standard-docs',
    layer: 'A+F',
    reentry_target: null,
    canonical_output: 'standard_docs_manifest.json',
  }),
  pack: Object.freeze({
    command: 'pack',
    layer: 'A+F',
    reentry_target: 'release_bundle',
    canonical_output: 'release_bundle.zip',
  }),
});

export const AF_REENTRY_TARGETS = Object.freeze({
  review_pack: Object.freeze({
    key: 'review_pack',
    artifact_type: 'review_pack',
    canonical_file_name: 'review_pack.json',
    schema_kind: 'review_pack',
  }),
  readiness_report: Object.freeze({
    key: 'readiness_report',
    artifact_type: 'readiness_report',
    canonical_file_name: 'readiness_report.json',
    schema_kind: 'readiness_report',
  }),
  release_bundle: Object.freeze({
    key: 'release_bundle',
    artifact_type: 'release_bundle',
    canonical_file_name: 'release_bundle.zip',
    schema_kind: null,
  }),
});

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function compactDetail(code, message) {
  return { code, message };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSourceArtifactRefs(value) {
  return ensureArray(value)
    .filter((entry) => isPlainObject(entry) && normalizeString(entry.artifact_type))
    .map((entry) => ({
      artifact_type: normalizeString(entry.artifact_type),
      path: normalizeString(entry.path) || null,
      role: normalizeString(entry.role) || null,
      label: normalizeString(entry.label) || null,
    }));
}

function extractArtifactPartIdentity(document = {}) {
  const part = isPlainObject(document.part) ? document.part : {};
  return {
    part_id: normalizeString(part.part_id || document.part_id) || null,
    name: normalizeString(part.name || document.name) || null,
    revision: normalizeString(part.revision || document.revision) || null,
  };
}

export function buildCompatibilityMarkers(document = {}) {
  const compatibilityMode = isPlainObject(document.compatibility_mode) ? document.compatibility_mode : null;
  const canonicalArtifact = isPlainObject(document.canonical_artifact) ? document.canonical_artifact : null;
  const contract = isPlainObject(document.contract) ? document.contract : null;
  const markers = [];

  if (canonicalArtifact?.json_is_source_of_truth === true) {
    markers.push('json_is_source_of_truth');
  }
  if (normalizeString(contract?.contract_version)) {
    markers.push(`command_contract:${normalizeString(contract.contract_version)}`);
  }
  if (normalizeString(compatibilityMode?.type)) {
    markers.push(`compatibility:${normalizeString(compatibilityMode.type)}`);
  }

  return {
    mode: normalizeString(compatibilityMode?.type) || 'canonical',
    canonical_review_pack_backed: compatibilityMode?.canonical_review_pack_backed === false
      ? false
      : null,
    markers,
  };
}

function validateArtifactIdentityRecord(record = {}) {
  const errors = [];
  if (!normalizeString(record.artifact_type)) {
    errors.push(compactDetail('missing_artifact_type', 'artifact_type is required.'));
  }
  if (!normalizeString(record.schema_version)) {
    errors.push(compactDetail('missing_schema_version', 'schema_version is required.'));
  }
  if (!Array.isArray(record.warnings)) {
    errors.push(compactDetail('missing_warnings', 'warnings must be an array.'));
  }
  if (!isPlainObject(record.coverage)) {
    errors.push(compactDetail('missing_coverage', 'coverage must be an object.'));
  }
  if (!isPlainObject(record.confidence)) {
    errors.push(compactDetail('missing_confidence', 'confidence must be an object.'));
  }
  if (!Array.isArray(record.source_artifact_refs) || record.source_artifact_refs.length === 0) {
    errors.push(compactDetail('missing_source_artifact_refs', 'source_artifact_refs must contain at least one artifact ref.'));
  }
  if (!isPlainObject(record.lineage)) {
    errors.push(compactDetail('missing_lineage', 'lineage must be an object.'));
  } else if (!record.lineage.part_id && !record.lineage.name) {
    errors.push(compactDetail('missing_lineage_identity', 'lineage must expose at least part_id or name.'));
  }
  if (!isPlainObject(record.compatibility)) {
    errors.push(compactDetail('missing_compatibility', 'compatibility markers are required.'));
  }
  return errors;
}

export class AfExecutionContractError extends Error {
  constructor(code, message, { status = 400, path = null, target = null, details = [] } = {}) {
    super(message);
    this.name = 'AfExecutionContractError';
    this.code = code;
    this.status = status;
    this.path = path;
    this.target = target;
    this.details = details;
  }
}

export function getAfExecutionJobContract(jobType) {
  const contract = AF_EXECUTION_JOB_CONTRACTS[jobType];
  return contract ? cloneJson(contract) : null;
}

export function isAfExecutionJobType(jobType) {
  return Boolean(AF_EXECUTION_JOB_CONTRACTS[jobType]);
}

export function normalizeAfExecutionState(state) {
  const normalized = normalizeString(state).toLowerCase();
  if (!normalized) return null;
  return AF_EXECUTION_STATE_ALIASES[normalized] || normalized;
}

export function buildAfExecutionStateDescriptor(state) {
  const normalized = normalizeAfExecutionState(state);
  return {
    contract_version: AF_EXECUTION_CONTRACT_VERSION,
    lifecycle_state: normalized,
    raw_state: normalizeString(state) || null,
    compatible: AF_EXECUTION_LIFECYCLE_STATES.includes(normalized),
    legacy_aliases: normalized && normalized !== normalizeString(state).toLowerCase()
      ? [normalizeString(state).toLowerCase()]
      : [],
  };
}

export function getAfReentryTarget(targetKey) {
  const target = AF_REENTRY_TARGETS[targetKey];
  return target ? cloneJson(target) : null;
}

export function createAfArtifactIdentityRecord({
  artifactType,
  schemaVersion,
  sourceArtifactRefs,
  warnings,
  coverage,
  confidence,
  lineage,
  compatibility,
}) {
  const record = {
    artifact_type: normalizeString(artifactType),
    schema_version: normalizeString(schemaVersion),
    source_artifact_refs: normalizeSourceArtifactRefs(sourceArtifactRefs),
    warnings: ensureArray(warnings).map((warning) => String(warning)),
    coverage: isPlainObject(coverage) ? cloneJson(coverage) : null,
    confidence: isPlainObject(confidence) ? cloneJson(confidence) : null,
    lineage: isPlainObject(lineage) ? cloneJson(lineage) : null,
    compatibility: isPlainObject(compatibility) ? cloneJson(compatibility) : null,
  };
  const errors = validateArtifactIdentityRecord(record);
  if (errors.length > 0) {
    throw new AfExecutionContractError(
      'invalid_artifact_identity',
      errors.map((detail) => detail.message).join(' '),
      { details: errors }
    );
  }
  return record;
}

export function buildAfArtifactContractMetadata({
  jobType,
  target = null,
  artifactIdentity,
  reentryReady = true,
  executionNotes = [],
}) {
  if (!isAfExecutionJobType(jobType)) {
    throw new AfExecutionContractError(
      'unsupported_job_type',
      `Unsupported AF execution job type: ${jobType}`
    );
  }

  const targetContract = target ? getAfReentryTarget(target) : null;
  return {
    af_contract: {
      contract_version: AF_EXECUTION_CONTRACT_VERSION,
      job_type: jobType,
      layer: 'A+F',
      reentry_target: targetContract?.key || null,
      canonical_file_name: targetContract?.canonical_file_name || null,
      reentry_ready: Boolean(reentryReady),
      artifact_identity: cloneJson(artifactIdentity),
      execution_notes: uniqueStrings(executionNotes),
    },
  };
}

export function buildAfArtifactContractFromDocument({
  jobType,
  target,
  document,
  path = null,
  strictReentry = true,
}) {
  const targetContract = getAfReentryTarget(target);
  if (!targetContract) {
    throw new AfExecutionContractError(
      'unsupported_reentry_target',
      `Unsupported AF re-entry target: ${target}`
    );
  }

  if (!isPlainObject(document)) {
    throw new AfExecutionContractError(
      'invalid_artifact_document',
      `${targetContract.canonical_file_name} must be a JSON object.`,
      { path, target }
    );
  }

  try {
    if (targetContract.schema_kind === 'review_pack') {
      assertValidDArtifact('review_pack', document, { command: jobType, path });
    } else if (targetContract.schema_kind === 'readiness_report') {
      assertValidCArtifact('readiness_report', document, { command: jobType, path });
    }
  } catch (error) {
    throw new AfExecutionContractError(
      'schema_mismatch',
      error instanceof Error ? error.message : String(error),
      {
        status: 422,
        path,
        target,
        details: Array.isArray(error?.errors)
          ? error.errors.map((message) => compactDetail('schema_error', message))
          : [compactDetail('schema_error', error instanceof Error ? error.message : String(error))],
      }
    );
  }

  const sourceArtifactRefs = normalizeSourceArtifactRefs(document.source_artifact_refs);
  const lineage = {
    ...extractArtifactPartIdentity(document),
    source_artifact_types: [...new Set(sourceArtifactRefs.map((ref) => ref.artifact_type))],
    source_artifact_count: sourceArtifactRefs.length,
  };
  const compatibility = buildCompatibilityMarkers(document);
  const errors = [];
  let artifactIdentity = null;
  try {
    artifactIdentity = createAfArtifactIdentityRecord({
      artifactType: document.artifact_type,
      schemaVersion: document.schema_version,
      sourceArtifactRefs,
      warnings: document.warnings,
      coverage: document.coverage,
      confidence: document.confidence,
      lineage,
      compatibility,
    });
  } catch (error) {
    if (error instanceof AfExecutionContractError && Array.isArray(error.details)) {
      errors.push(...error.details);
    } else {
      throw error;
    }
  }

  if (document.artifact_type !== targetContract.artifact_type) {
    errors.push(compactDetail(
      'artifact_type_mismatch',
      `${targetContract.canonical_file_name} must declare artifact_type=${targetContract.artifact_type}.`
    ));
  }

  if (strictReentry && sourceArtifactRefs.length === 0) {
    errors.push(compactDetail(
      'missing_lineage_refs',
      `${targetContract.canonical_file_name} must include source_artifact_refs for A+F re-entry.`
    ));
  }

  if (target === 'readiness_report') {
    const hasReviewPackLineage = sourceArtifactRefs.some((ref) => ref.artifact_type === 'review_pack');
    if (!hasReviewPackLineage) {
      errors.push(compactDetail(
        'missing_review_pack_lineage',
        'readiness_report.json must preserve review_pack lineage for A+F handoff.'
      ));
    }
    if (compatibility.canonical_review_pack_backed === false || compatibility.mode === 'legacy_config_compatibility') {
      errors.push(compactDetail(
        'legacy_handoff_not_allowed',
        'Legacy config-compatibility readiness artifacts are not valid A+F handoff inputs.'
      ));
    }
  }

  if (errors.length > 0) {
    throw new AfExecutionContractError(
      'invalid_artifact_handoff',
      errors.map((detail) => detail.message).join(' '),
      { status: 422, path, target, details: errors }
    );
  }

  artifactIdentity = artifactIdentity || createAfArtifactIdentityRecord({
    artifactType: document.artifact_type,
    schemaVersion: document.schema_version,
    sourceArtifactRefs,
    warnings: document.warnings,
    coverage: document.coverage,
    confidence: document.confidence,
    lineage,
    compatibility,
  });

  return buildAfArtifactContractMetadata({
    jobType,
    target,
    artifactIdentity,
    reentryReady: true,
    executionNotes: [
      `${targetContract.canonical_file_name} passed AF1 schema, lineage, and compatibility checks.`,
    ],
  });
}

export function validateDocsManifestAgainstReadiness({
  readinessReport,
  readinessPath = null,
  docsManifest,
  docsManifestPath = null,
  allowBundledPair = false,
}) {
  const readinessIdentity = extractArtifactPartIdentity(readinessReport);
  const docsIdentity = extractArtifactPartIdentity(docsManifest);
  const details = [];

  if (readinessIdentity.part_id && docsIdentity.part_id && readinessIdentity.part_id !== docsIdentity.part_id) {
    details.push(compactDetail('part_id_mismatch', `docs manifest part_id does not match readiness report (${readinessIdentity.part_id} != ${docsIdentity.part_id}).`));
  }
  if (readinessIdentity.name && docsIdentity.name && readinessIdentity.name !== docsIdentity.name) {
    details.push(compactDetail('name_mismatch', `docs manifest name does not match readiness report (${readinessIdentity.name} != ${docsIdentity.name}).`));
  }
  if (readinessIdentity.revision && docsIdentity.revision && readinessIdentity.revision !== docsIdentity.revision) {
    details.push(compactDetail('revision_mismatch', `docs manifest revision does not match readiness report (${readinessIdentity.revision} != ${docsIdentity.revision}).`));
  }

  const docsRefs = normalizeSourceArtifactRefs(docsManifest?.source_artifact_refs);
  const readinessRefs = docsRefs.filter((ref) => ref.artifact_type === 'readiness_report');
  if (
    readinessPath
    && readinessRefs.length > 0
    && !allowBundledPair
    && !readinessRefs.some((ref) => ref.path === readinessPath)
  ) {
    details.push(compactDetail(
      'readiness_ref_mismatch',
      `docs manifest does not reference the supplied readiness_report path (${readinessPath}).`
    ));
  }
  if (readinessRefs.length === 0) {
    details.push(compactDetail(
      'missing_readiness_ref',
      'docs manifest must preserve readiness_report lineage before release packaging.'
    ));
  }

  if (details.length > 0) {
    throw new AfExecutionContractError(
      'invalid_docs_manifest_handoff',
      `Invalid docs manifest handoff${docsManifestPath ? ` (${docsManifestPath})` : ''}.`,
      { status: 422, path: docsManifestPath, target: 'docs_manifest', details }
    );
  }
}
