import {
  createActionSummary,
  createInfoGrid,
  createInlineStatus,
  createPrimaryAction,
  createSecondaryAction,
  el,
} from './renderers.js';
import { fetchArtifactText, parseArtifactPayload } from './artifact-insights.js';
import {
  MANUFACTURING_ROBOTICS_DEMO_PROFILE,
  MANUFACTURING_ROBOTICS_JOB_TYPE,
  MANUFACTURING_ROBOTICS_TRUST_DEMO,
  isManufacturingRoboticsMismatchFailure,
} from './jobs-client.js';
import { applyTranslations, getLocale, t } from '../i18n/index.js';

export const MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT = 8;
export const MANUFACTURING_ROBOTICS_MINIMUM_PROGRESS_MS = 5000;

export const MANUFACTURING_ROBOTICS_OUTPUT_FILENAMES = Object.freeze([
  'manufacturing_action_dictionary.json',
  'manufacturing_episode_annotation.json',
  'manufacturing_data_validation_report.json',
  'manufacturing_robotics_dataset_manifest.json',
  'design_manufacturing_quality_handoff.json',
  'design_manufacturing_quality_handoff.md',
  'artifact-manifest.json',
  'output-manifest.json',
]);

const PAYLOAD_SPECS = Object.freeze([
  Object.freeze({
    key: 'actionDictionary',
    fileName: 'manufacturing_action_dictionary.json',
    artifactType: 'manufacturing_action_dictionary',
  }),
  Object.freeze({
    key: 'episodeAnnotation',
    fileName: 'manufacturing_episode_annotation.json',
    artifactType: 'manufacturing_episode_annotation',
  }),
  Object.freeze({
    key: 'validationReport',
    fileName: 'manufacturing_data_validation_report.json',
    artifactType: 'manufacturing_data_validation_report',
  }),
  Object.freeze({
    key: 'datasetManifest',
    fileName: 'manufacturing_robotics_dataset_manifest.json',
    artifactType: 'manufacturing_robotics_dataset_manifest',
  }),
  Object.freeze({
    key: 'handoff',
    fileName: 'design_manufacturing_quality_handoff.json',
    artifactType: 'design_manufacturing_quality_handoff',
  }),
]);

const BOUNDARY_KEYS = Object.freeze([
  'synthetic_demo',
  'real_shop_floor_data',
  'automatic_video_segmentation',
  'computer_vision_model_used',
  'lerobot_compatible',
  'training_ready',
  'inspection_evidence',
  'evidence_attached',
  'readiness_regenerated',
  'product_release',
  'production_readiness',
  'human_review_required',
]);

const cardRuntimeByState = new WeakMap();

function ensureCardRuntime(cardState) {
  if (!cardRuntimeByState.has(cardState)) {
    cardRuntimeByState.set(cardState, {
      activeSync: null,
      submissionSequence: 0,
    });
  }
  return cardRuntimeByState.get(cardState);
}

export const LEROBOT_AVAILABLE_CAPABILITIES = Object.freeze([
  'episode-identity',
  'task-instructions',
  'action-semantics',
  'robot-joint-references',
  'segment-timing',
  'source-lineage',
]);

export const LEROBOT_MISSING_CAPABILITIES = Object.freeze([
  'observation-state',
  'action-vector',
  'frame-clock',
  'parquet-storage',
  'metadata-offsets',
  'dataset-statistics',
  'loader-validation',
  'inspection-vision-modality',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function objectValue(value) {
  return isObject(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function portablePathValue(value) {
  const path = textValue(value).replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:\//i.test(path)) return '';
  if (path.split('/').some((segment) => segment === '..')) return '';
  return path;
}

function booleanValue(value) {
  return value === true ? true : value === false ? false : null;
}

function stringList(value) {
  return arrayValue(value)
    .map((entry) => textValue(entry))
    .filter(Boolean);
}

function normalizedJobStatus(job = {}) {
  return textValue(job?.status).toLowerCase();
}

export function isManufacturingRoboticsJob(job = {}) {
  return textValue(job?.type).toLowerCase() === MANUFACTURING_ROBOTICS_JOB_TYPE;
}

function metadataCandidates(job = {}) {
  return [
    job?.diagnostics?.manufacturing_action_demo,
    job?.diagnostics?.manufacturing_robotics_demo,
    job?.result?.diagnostics?.manufacturing_action_demo,
    job?.result?.diagnostics?.manufacturing_robotics_demo,
    job?.result?.manufacturing_action_demo,
    job?.result?.manufacturing_robotics_demo,
    job?.metadata?.manufacturing_action_demo,
    job?.metadata?.manufacturing_robotics_demo,
    job?.error?.details?.manufacturing_action_demo,
    job?.error?.details?.manufacturing_robotics_demo,
    job?.diagnostics,
    job?.result?.diagnostics,
    job?.result,
    job?.error?.details,
  ].filter(isObject);
}

function findDemoMetadata(job = {}) {
  return metadataCandidates(job).find((candidate) => (
    candidate.reason_code
    || candidate.code
    || candidate.demo_profile
    || candidate.profile_id
    || candidate.publication
    || candidate.published
    || candidate.expected_identity
    || candidate.expected
  )) || {};
}

function normalizeIdentity(value) {
  if (typeof value === 'string') {
    return { packageSlug: '', partId: '', revision: '', label: value.trim() };
  }
  const identity = objectValue(value);
  const packageSlug = textValue(identity.package_slug || identity.package || identity.package_id);
  const partId = textValue(identity.part_id || identity.part);
  const revision = textValue(identity.revision || identity.revision_id);
  const revisionLabel = revision && !/^revision\b/i.test(revision) ? `Revision ${revision}` : revision;
  return {
    packageSlug,
    partId,
    revision,
    label: [packageSlug, partId, revisionLabel].filter(Boolean).join(' / '),
  };
}

export function extractManufacturingRoboticsDiagnostic(job = {}) {
  const metadata = findDemoMetadata(job);
  const publication = objectValue(metadata.publication || metadata.published);
  const nextAction = objectValue(metadata.next_action);
  const expectedIdentity = normalizeIdentity(
    metadata.expected_identity || metadata.expected || metadata.identity_expected
  );
  const receivedIdentity = normalizeIdentity(
    metadata.received_identity || metadata.received || metadata.identity_received
  );
  return {
    reasonCode: textValue(metadata.reason_code || metadata.code),
    expectedIdentity,
    receivedIdentity,
    expectedOutputCount: Number.isInteger(publication.expected_count)
      ? publication.expected_count
      : Number.isInteger(metadata.expected_output_count)
        ? metadata.expected_output_count
        : MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT,
    publishedOutputCount: Number.isInteger(publication.published_count)
      ? publication.published_count
      : Number.isInteger(metadata.published_output_count)
        ? metadata.published_output_count
        : 0,
    nextAction: textValue(nextAction.message || metadata.next_action),
  };
}

function normalizeCoverage(value) {
  const coverage = objectValue(value);
  return {
    referencedCount: Number.isFinite(coverage.referenced_count) ? coverage.referenced_count : null,
    totalCount: Number.isFinite(coverage.total_count) ? coverage.total_count : null,
    percent: Number.isFinite(coverage.coverage_percent) ? coverage.coverage_percent : null,
  };
}

function normalizeAction(action = {}) {
  const references = objectValue(action.references);
  const instruction = objectValue(action.instruction);
  return {
    order: Number.isInteger(action.order) ? action.order : null,
    actionId: textValue(action.action_id),
    primitive: textValue(action.primitive),
    actorType: textValue(action.actor_type),
    durationMs: Number.isFinite(action.duration_ms) ? action.duration_ms : null,
    instruction: {
      ko: textValue(instruction.ko),
      en: textValue(instruction.en),
    },
    partIds: stringList(references.part_ids),
    featureIds: stringList(references.feature_ids),
    qualityIds: stringList(references.quality_characteristic_ids),
    robotJointIds: stringList(references.robot_joint_ids),
    toolInterfaceIds: stringList(references.tool_interface_ids),
    inspectionPlanItemIds: stringList(references.inspection_plan_item_ids),
    preconditions: stringList(action.preconditions),
    postconditions: stringList(action.postconditions),
    instructionOrigin: textValue(action.instruction_origin),
    humanReviewRequired: booleanValue(action.human_review_required),
    unresolvedRequirementIds: stringList(action.unresolved_requirement_ids),
  };
}

function normalizeQuality(validation = {}) {
  const metrics = objectValue(validation.metrics);
  const languageCoverage = objectValue(metrics.language_coverage);
  return {
    status: textValue(validation.status),
    actionCount: Number.isFinite(metrics.action_count) ? metrics.action_count : null,
    segmentCount: Number.isFinite(metrics.segment_count) ? metrics.segment_count : null,
    uniquePrimitiveCount: Number.isFinite(metrics.unique_primitive_count) ? metrics.unique_primitive_count : null,
    featureCoverage: normalizeCoverage(metrics.feature_coverage),
    jointCoverage: normalizeCoverage(metrics.joint_coverage),
    qualityCoverage: normalizeCoverage(metrics.quality_coverage),
    koreanPercent: Number.isFinite(languageCoverage.korean_percent) ? languageCoverage.korean_percent : null,
    englishPercent: Number.isFinite(languageCoverage.english_percent) ? languageCoverage.english_percent : null,
    unknownReferenceCount: Number.isFinite(metrics.unknown_reference_count) ? metrics.unknown_reference_count : null,
    unknownFeatureCount: null,
    unknownJointCount: null,
    unknownQualityCount: null,
    duplicateReferenceCount: Number.isFinite(metrics.duplicate_reference_count) ? metrics.duplicate_reference_count : null,
    transitionViolationCount: Number.isFinite(metrics.transition_violation_count) ? metrics.transition_violation_count : null,
    timelineViolationCount: Number.isFinite(metrics.timeline_violation_count) ? metrics.timeline_violation_count : null,
    unresolvedRequirementCount: Number.isFinite(metrics.unresolved_requirement_count)
      ? metrics.unresolved_requirement_count
      : null,
    lineageStatus: textValue(metrics.lineage_status),
    boundaryStatus: textValue(metrics.boundary_status),
    checks: arrayValue(validation.checks).map((check) => ({
      id: textValue(check?.check_id),
      status: textValue(check?.status),
      violationCount: Number.isFinite(check?.violation_count) ? check.violation_count : null,
    })),
  };
}

function unknownReferenceCount(actions, referenceField, universe, universeField) {
  if (!Array.isArray(universe?.[universeField])) return null;
  const known = new Set(stringList(universe[universeField]));
  const referenced = new Set(actions.flatMap((action) => action[referenceField]));
  return [...referenced].filter((reference) => !known.has(reference)).length;
}

function normalizeArtifactReference(value) {
  const reference = objectValue(value);
  return {
    role: textValue(reference.role),
    artifactType: textValue(reference.artifact_type),
    path: portablePathValue(reference.path),
    sha256: textValue(reference.sha256),
    sizeBytes: Number.isFinite(reference.size_bytes) ? reference.size_bytes : null,
  };
}

function normalizeHandoff(handoff = {}) {
  const identity = objectValue(handoff.identity);
  const design = objectValue(handoff.design);
  const manufacturing = objectValue(handoff.manufacturing);
  const quality = objectValue(handoff.quality);
  const trust = objectValue(handoff.trust);
  const approvals = objectValue(handoff.approvals);
  return {
    design: {
      packageSlug: textValue(identity.package_slug),
      partId: textValue(design.part_id),
      revision: textValue(design.revision),
      featureIds: stringList(design.feature_ids),
      sourceDigest: textValue(design.source_digest),
    },
    manufacturing: {
      actionIds: stringList(manufacturing.action_ids),
      robotJointIds: stringList(manufacturing.robot_joint_ids),
      toolInterfaceIds: stringList(manufacturing.tool_interface_ids),
      preconditions: stringList(manufacturing.preconditions),
      postconditions: stringList(manufacturing.postconditions),
      unresolvedRequirementIds: stringList(manufacturing.unresolved_requirement_ids),
    },
    quality: {
      characteristicIds: stringList(quality.quality_characteristic_ids),
      inspectionEvidence: booleanValue(quality.inspection_evidence),
      approvalGranted: booleanValue(quality.approval_granted),
      inspectionPlanRef: normalizeArtifactReference(quality.inspection_plan_ref),
    },
    trust: {
      lineageStatus: textValue(trust.lineage_status),
      syntheticOnly: booleanValue(trust.synthetic_only),
      remainingHolds: stringList(trust.remaining_holds),
      exactHashes: arrayValue(trust.exact_hashes).map(normalizeArtifactReference),
    },
    approvals: {
      engineering: booleanValue(approvals.engineering),
      manufacturing: booleanValue(approvals.manufacturing),
      quality: booleanValue(approvals.quality),
      inspection: booleanValue(approvals.inspection),
      readiness: booleanValue(approvals.readiness),
      release: booleanValue(approvals.release),
    },
  };
}

function payloadDocument(payloads, key, fileName) {
  return objectValue(payloads?.[key] || payloads?.[fileName]);
}

function deriveLeRobotAvailableCapabilities({ actionDictionary, episodeAnnotation, actions }) {
  const segments = arrayValue(episodeAnnotation.segments);
  const sourceSnapshots = arrayValue(
    episodeAnnotation.source_snapshots || actionDictionary.source_snapshots
  );
  const available = [];
  if (textValue(episodeAnnotation.artifact_id) && isObject(episodeAnnotation.identity)) {
    available.push('episode-identity');
  }
  if (actions.length > 0 && actions.every((action) => action.instruction.ko && action.instruction.en)) {
    available.push('task-instructions');
  }
  if (actions.length > 0 && actions.every((action) => action.actionId && action.primitive)) {
    available.push('action-semantics');
  }
  if (new Set(actions.flatMap((action) => action.robotJointIds)).size > 0) {
    available.push('robot-joint-references');
  }
  if (segments.length === actions.length && segments.length > 0 && segments.every((segment) => (
    Number.isFinite(segment?.start_ms)
    && Number.isFinite(segment?.end_ms)
    && Number.isFinite(segment?.duration_ms)
  ))) {
    available.push('segment-timing');
  }
  if (sourceSnapshots.length === 5 && isObject(episodeAnnotation.revision_lineage)) {
    available.push('source-lineage');
  }
  return available;
}

export function buildManufacturingRoboticsViewModel({
  job = null,
  artifacts = [],
  payloads = {},
  requestStatus = 'idle',
  artifactLoadStatus = 'idle',
  errorMessage = '',
} = {}) {
  const status = normalizedJobStatus(job);
  const diagnostic = extractManufacturingRoboticsDiagnostic(job || {});
  const actionDictionary = payloadDocument(payloads, 'actionDictionary', PAYLOAD_SPECS[0].fileName);
  const episodeAnnotation = payloadDocument(payloads, 'episodeAnnotation', PAYLOAD_SPECS[1].fileName);
  const validationReport = payloadDocument(payloads, 'validationReport', PAYLOAD_SPECS[2].fileName);
  const datasetManifest = payloadDocument(payloads, 'datasetManifest', PAYLOAD_SPECS[3].fileName);
  const handoffDocument = payloadDocument(payloads, 'handoff', PAYLOAD_SPECS[4].fileName);
  const actions = arrayValue(actionDictionary.actions).map(normalizeAction).filter((action) => action.actionId);
  const quality = normalizeQuality(validationReport);
  quality.unknownFeatureCount = unknownReferenceCount(
    actions,
    'featureIds',
    actionDictionary.source_universe,
    'feature_ids'
  );
  quality.unknownJointCount = unknownReferenceCount(
    actions,
    'robotJointIds',
    actionDictionary.source_universe,
    'robot_joint_ids'
  );
  quality.unknownQualityCount = unknownReferenceCount(
    actions,
    'qualityIds',
    actionDictionary.source_universe,
    'quality_characteristic_ids'
  );
  const boundaries = objectValue(
    validationReport.boundaries || handoffDocument.boundaries || actionDictionary.boundaries
  );
  const availableArtifactCount = arrayValue(artifacts).filter((artifact) => artifact?.exists !== false).length;
  const availableLeRobotCapabilities = deriveLeRobotAvailableCapabilities({
    actionDictionary,
    episodeAnnotation,
    actions,
  });
  const isBlockedMismatch = isManufacturingRoboticsMismatchFailure(job || {});
  const errorContext = requestStatus === 'error'
    ? 'submission'
    : status === 'failed'
      ? 'execution'
      : status === 'cancelled'
        ? 'cancelled'
        : 'submission';

  let phase = 'pre-run';
  if (requestStatus === 'submitting' || status === 'queued' || status === 'running') phase = 'running';
  else if (requestStatus === 'error') phase = 'error';
  else if (isBlockedMismatch) phase = 'blocked';
  else if (status === 'failed' || status === 'cancelled') phase = 'error';
  else if (status === 'succeeded' && artifactLoadStatus === 'error') phase = 'artifact-error';
  else if (status === 'succeeded' && artifactLoadStatus !== 'ready') phase = 'loading';
  else if (status === 'succeeded') phase = 'success';
  else if (requestStatus === 'error' || errorMessage) phase = 'error';

  return {
    phase,
    jobId: textValue(job?.id),
    jobStatus: status,
    errorContext,
    diagnostic,
    actions,
    quality,
    handoff: normalizeHandoff(handoffDocument),
    boundaries: BOUNDARY_KEYS.map((key) => ({ key, value: booleanValue(boundaries[key]) })),
    availableArtifactCount,
    expectedArtifactCount: MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT,
    dataset: {
      actionCount: Number.isFinite(datasetManifest?.dataset?.action_count)
        ? datasetManifest.dataset.action_count
        : actions.length,
      segmentCount: Number.isFinite(datasetManifest?.dataset?.segment_count)
        ? datasetManifest.dataset.segment_count
        : arrayValue(episodeAnnotation.segments).length,
      source: textValue(datasetManifest?.dataset?.source),
      annotationOrigin: textValue(
        episodeAnnotation.annotation_origin || datasetManifest?.dataset?.annotation_origin
      ),
    },
    lerobot: {
      exportStatus: 'NOT_EXPORTABLE_YET',
      compatible: boundaries.lerobot_compatible === true,
      trainingReady: boundaries.training_ready === true,
      available: availableLeRobotCapabilities,
      missing: [...LEROBOT_MISSING_CAPABILITIES],
    },
    errorMessage: textValue(errorMessage),
  };
}

export function ensureManufacturingRoboticsCardState(review = {}) {
  const existing = objectValue(review.manufacturingRobotics);
  const focusHandoff = objectValue(existing.focusHandoff);
  const targetPhase = textValue(focusHandoff.targetPhase);
  const targetAction = textValue(focusHandoff.targetAction);
  const normalizedFocusHandoff = (
    (targetPhase === 'blocked'
      && targetAction === 'manufacturing-robotics-regenerate-approved')
    || (targetPhase === 'success'
      && [
        'manufacturing-robotics-open-artifacts',
        'manufacturing-robotics-select-action',
      ].includes(targetAction))
  )
    ? {
        jobId: textValue(focusHandoff.jobId),
        targetPhase,
        targetAction,
      }
    : null;
  const normalized = {
    jobId: textValue(existing.jobId),
    job: isObject(existing.job) ? existing.job : null,
    requestStatus: textValue(existing.requestStatus, 'idle'),
    artifactLoadStatus: textValue(existing.artifactLoadStatus, 'idle'),
    loadedJobId: textValue(existing.loadedJobId),
    payloads: objectValue(existing.payloads),
    selectedActionId: textValue(existing.selectedActionId),
    trustDemo: existing.trustDemo === true,
    progressVisibleUntil: Number.isFinite(existing.progressVisibleUntil)
      && existing.progressVisibleUntil > 0
      ? existing.progressVisibleUntil
      : 0,
    errorMessage: textValue(existing.errorMessage),
    ignoredActiveJobId: textValue(existing.ignoredActiveJobId),
    focusHandoff: normalizedFocusHandoff,
  };
  for (const key of Object.keys(existing)) delete existing[key];
  Object.assign(existing, normalized);
  review.manufacturingRobotics = existing;
  return existing;
}

export function createManufacturingRoboticsSubmission({ trustDemo = false } = {}) {
  return {
    type: MANUFACTURING_ROBOTICS_JOB_TYPE,
    demoProfile: MANUFACTURING_ROBOTICS_DEMO_PROFILE,
    ...(trustDemo ? { trustDemo: MANUFACTURING_ROBOTICS_TRUST_DEMO } : {}),
    completionAction: {
      preferredRoute: 'review',
      failureRoute: 'review',
    },
  };
}

export function shouldIgnoreManufacturingRoboticsActiveJob(activeJob = null, cardState = {}) {
  const activeJobId = textValue(activeJob?.id);
  if (!activeJobId || activeJobId !== textValue(cardState.ignoredActiveJobId)) return false;
  return textValue(cardState.requestStatus) === 'submitting'
    || activeJobId !== textValue(cardState.jobId);
}

function phaseLabel(phase) {
  return t(`studio.manufacturing-robotics.phase.${phase}`);
}

export function resolveManufacturingRoboticsPresentationPhase(
  phase,
  progressVisibleUntil,
  now = Date.now()
) {
  const terminalSuccessPreparing = phase === 'loading' || phase === 'success';
  return terminalSuccessPreparing
    && Number.isFinite(progressVisibleUntil)
    && progressVisibleUntil > now
    ? 'preparing'
    : phase;
}

function boolLabel(value) {
  if (value === true) return t('studio.manufacturing-robotics.value.yes');
  if (value === false) return t('studio.manufacturing-robotics.value.no');
  return t('studio.manufacturing-robotics.value.unavailable');
}

function displayValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : t('studio.manufacturing-robotics.value.none');
  if (value === null || value === undefined || value === '') return t('studio.manufacturing-robotics.value.unavailable');
  return String(value);
}

function renderExpectedOutputs() {
  return el('ol', {
    className: 'manufacturing-robotics-output-list',
    attrs: { 'aria-label': t('studio.manufacturing-robotics.preflight.outputs-label') },
    children: MANUFACTURING_ROBOTICS_OUTPUT_FILENAMES.map((fileName) =>
      el('li', { children: [el('code', { text: fileName })] })
    ),
  });
}

function renderTrustDemoChoice(cardState) {
  return el('div', {
    className: 'manufacturing-robotics-trust-choice',
    children: [
      el('input', {
        attrs: {
          id: 'manufacturing-robotics-trust-demo',
          type: 'checkbox',
          ...(cardState.trustDemo ? { checked: true } : {}),
        },
        dataset: { manufacturingRoboticsTrustDemo: 'true' },
      }),
      el('div', {
        children: [
          el('label', {
            attrs: { for: 'manufacturing-robotics-trust-demo' },
            text: t('studio.manufacturing-robotics.trust-demo.label'),
          }),
          el('p', {
            className: 'inline-note',
            text: t('studio.manufacturing-robotics.trust-demo.copy'),
          }),
        ],
      }),
    ],
  });
}

function renderPreRun() {
  return el('div', {
    className: 'manufacturing-robotics-preflight',
    children: [
      createActionSummary({
        actionId: 'manufacturing-robotics-generate',
        title: t('studio.manufacturing-robotics.preflight.title'),
        description: t('studio.manufacturing-robotics.preflight.description'),
        requiredInputs: [
          t('studio.manufacturing-robotics.preflight.input.profile'),
          t('studio.manufacturing-robotics.preflight.input.identity'),
          t('studio.manufacturing-robotics.preflight.input.proof'),
          t('studio.manufacturing-robotics.preflight.input.robot'),
          t('studio.manufacturing-robotics.preflight.input.plan'),
        ],
        expectedOutputs: [t('studio.manufacturing-robotics.preflight.output-summary')],
        launchesFreeCAD: t('studio.manufacturing-robotics.preflight.freecad'),
        fileEffects: t('studio.manufacturing-robotics.preflight.files'),
        networkAccess: t('studio.manufacturing-robotics.preflight.network'),
        provider: t('studio.manufacturing-robotics.preflight.provider'),
        cost: t('studio.manufacturing-robotics.preflight.cost'),
        humanConfirmationRequired: true,
        safetyNotes: t('studio.manufacturing-robotics.preflight.safety'),
      }),
      el('section', {
        className: 'manufacturing-robotics-expected',
        attrs: { 'aria-labelledby': 'manufacturing-robotics-expected-title' },
        children: [
          el('h3', {
            className: 'manufacturing-robotics-section-title',
            attrs: { id: 'manufacturing-robotics-expected-title' },
            text: t('studio.manufacturing-robotics.preflight.outputs-title'),
          }),
          renderExpectedOutputs(),
        ],
      }),
      el('div', {
        className: 'manufacturing-robotics-primary-action',
        children: [createPrimaryAction({
          label: t('studio.manufacturing-robotics.action.generate'),
          action: 'manufacturing-robotics-generate',
        })],
      }),
    ],
  });
}

function renderRunning(viewModel) {
  const running = viewModel.jobStatus === 'running';
  return el('div', {
    className: 'manufacturing-robotics-stage',
    children: [
      createInlineStatus({
        title: running
          ? t('studio.manufacturing-robotics.running.title')
          : t('studio.manufacturing-robotics.queued.title'),
        copy: t('studio.manufacturing-robotics.running.copy'),
        tone: 'info',
      }),
      createPrimaryAction({
        label: t('studio.manufacturing-robotics.action.generating'),
        action: 'manufacturing-robotics-generating',
        disabled: true,
      }),
    ],
  });
}

function renderPreparing() {
  return el('div', {
    className: 'manufacturing-robotics-stage',
    children: [
      createInlineStatus({
        title: t('studio.manufacturing-robotics.preparing.title'),
        copy: t('studio.manufacturing-robotics.preparing.copy'),
        tone: 'info',
      }),
      createPrimaryAction({
        label: t('studio.manufacturing-robotics.action.preparing'),
        action: 'manufacturing-robotics-preparing',
        disabled: true,
      }),
    ],
  });
}

function renderLoading() {
  return el('div', {
    className: 'manufacturing-robotics-stage',
    children: [
      createInlineStatus({
        title: t('studio.manufacturing-robotics.loading.title'),
        copy: t('studio.manufacturing-robotics.loading.copy'),
        tone: 'info',
      }),
      createPrimaryAction({
        label: t('studio.manufacturing-robotics.action.loading'),
        action: 'manufacturing-robotics-loading',
        disabled: true,
      }),
    ],
  });
}

function renderError({ artifactError = false, errorContext = 'submission' } = {}) {
  const content = artifactError
    ? {
        title: t('studio.manufacturing-robotics.artifact-error.title'),
        copy: t('studio.manufacturing-robotics.artifact-error.copy'),
      }
    : errorContext === 'execution'
      ? {
          title: t('studio.manufacturing-robotics.execution-error.title'),
          copy: t('studio.manufacturing-robotics.execution-error.copy'),
        }
      : errorContext === 'cancelled'
        ? {
            title: t('studio.manufacturing-robotics.cancelled.title'),
            copy: t('studio.manufacturing-robotics.cancelled.copy'),
          }
        : {
            title: t('studio.manufacturing-robotics.error.title'),
            copy: t('studio.manufacturing-robotics.error.copy'),
          };
  return el('div', {
    className: 'manufacturing-robotics-stage',
    children: [
      createInlineStatus({
        title: content.title,
        copy: content.copy,
        tone: 'bad',
      }),
      createPrimaryAction({
        label: t('studio.manufacturing-robotics.action.retry'),
        action: artifactError ? 'manufacturing-robotics-reload-artifacts' : 'manufacturing-robotics-retry',
      }),
    ],
  });
}

function renderBlocked(viewModel) {
  const diagnostic = viewModel.diagnostic;
  return el('div', {
    className: 'manufacturing-robotics-stage manufacturing-robotics-blocked',
    children: [
      createInlineStatus({
        title: t('studio.manufacturing-robotics.blocked.title'),
        copy: t('studio.manufacturing-robotics.blocked.copy'),
        tone: 'bad',
      }),
      createInfoGrid([
        { label: t('studio.manufacturing-robotics.blocked.reason'), value: displayValue(diagnostic.reasonCode) },
        { label: t('studio.manufacturing-robotics.blocked.expected'), value: displayValue(diagnostic.expectedIdentity.label) },
        { label: t('studio.manufacturing-robotics.blocked.received'), value: displayValue(diagnostic.receivedIdentity.label) },
        {
          label: t('studio.manufacturing-robotics.blocked.outputs'),
          value: `${diagnostic.publishedOutputCount} / ${diagnostic.expectedOutputCount}`,
        },
        {
          label: t('studio.manufacturing-robotics.blocked.next-action'),
          value: t('studio.manufacturing-robotics.blocked.next-action-value'),
        },
      ]),
      el('p', {
        className: 'manufacturing-robotics-boundary-note',
        text: t('studio.manufacturing-robotics.blocked.no-partial'),
      }),
      createPrimaryAction({
        label: t('studio.manufacturing-robotics.action.regenerate-approved'),
        action: 'manufacturing-robotics-regenerate-approved',
      }),
    ],
  });
}

function localizedInstruction(action) {
  return getLocale() === 'ko' ? action.instruction.ko || action.instruction.en : action.instruction.en || action.instruction.ko;
}

function renderActionTimeline(actions, selectedActionId) {
  return el('ol', {
    className: 'manufacturing-action-timeline',
    attrs: { 'aria-label': t('studio.manufacturing-robotics.timeline.label') },
    children: actions.map((action, index) => {
      const selected = action.actionId === selectedActionId;
      const displayOrder = action.order ?? index + 1;
      return el('li', {
        className: 'manufacturing-action-step',
        attrs: selected ? { 'aria-current': 'step' } : {},
        children: [
          el('button', {
            className: 'manufacturing-action-button',
            attrs: {
              type: 'button',
              ...(selected ? { 'aria-current': 'step' } : {}),
              'aria-label': t('studio.manufacturing-robotics.timeline.button-label', {
                order: displayOrder,
                actionId: action.actionId,
              }),
            },
            dataset: {
              action: 'manufacturing-robotics-select-action',
              actionId: action.actionId,
            },
            children: [
              el('span', { className: 'manufacturing-action-index', text: String(displayOrder) }),
              el('span', {
                className: 'manufacturing-action-button-copy',
                children: [
                  el('strong', { text: action.actionId }),
                  el('span', { text: localizedInstruction(action) }),
                ],
              }),
            ],
          }),
        ],
      });
    }),
  });
}

function renderInstruction(language, copy) {
  return el('div', {
    className: 'manufacturing-action-instruction',
    children: [
      el('p', {
        className: 'manufacturing-action-instruction-label',
        text: t(`studio.manufacturing-robotics.action-detail.instruction-${language}`),
      }),
      el('p', {
        attrs: { lang: language },
        text: displayValue(copy),
      }),
    ],
  });
}

function renderActionDetail(action, annotationOrigin, { hasActions = false } = {}) {
  if (!action) {
    return createInlineStatus({
      title: hasActions
        ? t('studio.manufacturing-robotics.action-detail.select-title')
        : t('studio.manufacturing-robotics.action-detail.unavailable-title'),
      copy: hasActions
        ? t('studio.manufacturing-robotics.action-detail.select-copy')
        : t('studio.manufacturing-robotics.action-detail.unavailable-copy'),
      tone: hasActions ? 'info' : 'warn',
    });
  }
  return el('section', {
    className: 'manufacturing-action-detail',
    attrs: {
      'aria-labelledby': 'manufacturing-action-detail-title',
      'aria-live': 'polite',
    },
    children: [
      el('h3', {
        className: 'manufacturing-robotics-section-title',
        attrs: { id: 'manufacturing-action-detail-title' },
        text: t('studio.manufacturing-robotics.action-detail.title', { actionId: action.actionId }),
      }),
      el('div', {
        className: 'manufacturing-action-instructions',
        children: [
          renderInstruction('ko', action.instruction.ko),
          renderInstruction('en', action.instruction.en),
        ],
      }),
      createInfoGrid([
        { label: t('studio.manufacturing-robotics.action-detail.id'), value: action.actionId },
        { label: t('studio.manufacturing-robotics.action-detail.primitive'), value: displayValue(action.primitive) },
        { label: t('studio.manufacturing-robotics.action-detail.actor'), value: displayValue(action.actorType) },
        { label: t('studio.manufacturing-robotics.action-detail.duration'), value: action.durationMs === null ? displayValue(null) : `${action.durationMs} ms` },
        { label: t('studio.manufacturing-robotics.action-detail.tool'), value: displayValue(action.toolInterfaceIds) },
        { label: t('studio.manufacturing-robotics.action-detail.part'), value: displayValue(action.partIds) },
        { label: t('studio.manufacturing-robotics.action-detail.features'), value: displayValue(action.featureIds) },
        { label: t('studio.manufacturing-robotics.action-detail.quality'), value: displayValue(action.qualityIds) },
        { label: t('studio.manufacturing-robotics.action-detail.joints'), value: displayValue(action.robotJointIds) },
        { label: t('studio.manufacturing-robotics.action-detail.inspection'), value: displayValue(action.inspectionPlanItemIds) },
        { label: t('studio.manufacturing-robotics.action-detail.preconditions'), value: displayValue(action.preconditions) },
        { label: t('studio.manufacturing-robotics.action-detail.postconditions'), value: displayValue(action.postconditions) },
        { label: t('studio.manufacturing-robotics.action-detail.origin'), value: displayValue(annotationOrigin) },
        { label: t('studio.manufacturing-robotics.action-detail.instruction-origin'), value: displayValue(action.instructionOrigin) },
        { label: t('studio.manufacturing-robotics.action-detail.human-review'), value: boolLabel(action.humanReviewRequired) },
      ]),
    ],
  });
}

function formatCoverage(coverage) {
  if (coverage.referencedCount === null || coverage.totalCount === null || coverage.percent === null) {
    return displayValue(null);
  }
  return `${coverage.referencedCount} / ${coverage.totalCount} · ${coverage.percent}%`;
}

function renderQualityPanel(quality) {
  const statusLabel = quality.status === 'valid_synthetic_demo'
    ? t('studio.manufacturing-robotics.quality.valid-status')
    : displayValue(quality.status);
  return el('section', {
    className: 'manufacturing-robotics-result-panel manufacturing-robotics-quality',
    attrs: { 'aria-labelledby': 'manufacturing-robotics-quality-title' },
    children: [
      el('h3', {
        className: 'manufacturing-robotics-section-title',
        attrs: { id: 'manufacturing-robotics-quality-title' },
        text: t('studio.manufacturing-robotics.quality.title'),
      }),
      el('p', { className: 'manufacturing-robotics-status-callout', text: statusLabel }),
      createInfoGrid([
        { label: t('studio.manufacturing-robotics.quality.actions'), value: displayValue(quality.actionCount) },
        { label: t('studio.manufacturing-robotics.quality.segments'), value: displayValue(quality.segmentCount) },
        { label: t('studio.manufacturing-robotics.quality.primitives'), value: displayValue(quality.uniquePrimitiveCount) },
        { label: t('studio.manufacturing-robotics.quality.feature-coverage'), value: formatCoverage(quality.featureCoverage) },
        { label: t('studio.manufacturing-robotics.quality.joint-coverage'), value: formatCoverage(quality.jointCoverage) },
        { label: t('studio.manufacturing-robotics.quality.quality-coverage'), value: formatCoverage(quality.qualityCoverage) },
        { label: t('studio.manufacturing-robotics.quality.languages'), value: `${displayValue(quality.koreanPercent)}% / ${displayValue(quality.englishPercent)}%` },
        { label: t('studio.manufacturing-robotics.quality.unknown'), value: displayValue(quality.unknownReferenceCount) },
        { label: t('studio.manufacturing-robotics.quality.unknown-features'), value: displayValue(quality.unknownFeatureCount) },
        { label: t('studio.manufacturing-robotics.quality.unknown-joints'), value: displayValue(quality.unknownJointCount) },
        { label: t('studio.manufacturing-robotics.quality.unknown-quality'), value: displayValue(quality.unknownQualityCount) },
        { label: t('studio.manufacturing-robotics.quality.duplicates'), value: displayValue(quality.duplicateReferenceCount) },
        { label: t('studio.manufacturing-robotics.quality.transitions'), value: displayValue(quality.transitionViolationCount) },
        { label: t('studio.manufacturing-robotics.quality.timeline'), value: displayValue(quality.timelineViolationCount) },
        { label: t('studio.manufacturing-robotics.quality.unresolved'), value: displayValue(quality.unresolvedRequirementCount) },
        { label: t('studio.manufacturing-robotics.quality.lineage'), value: displayValue(quality.lineageStatus) },
        { label: t('studio.manufacturing-robotics.quality.boundary'), value: displayValue(quality.boundaryStatus) },
      ]),
    ],
  });
}

function renderHandoffSection(id, titleKey, items) {
  return el('section', {
    className: 'manufacturing-handoff-section',
    attrs: { 'aria-labelledby': `manufacturing-handoff-${id}` },
    children: [
      el('h4', {
        attrs: { id: `manufacturing-handoff-${id}` },
        text: t(titleKey),
      }),
      createInfoGrid(items),
    ],
  });
}

function artifactReferenceSummary(reference) {
  return [
    reference.role || reference.artifactType,
    reference.path,
    reference.sha256,
    reference.sizeBytes === null ? '' : `${reference.sizeBytes} B`,
  ].filter(Boolean).join(' · ');
}

function renderExactHashes(references) {
  return el('section', {
    className: 'manufacturing-exact-hashes',
    attrs: { 'aria-labelledby': 'manufacturing-exact-hashes-title' },
    children: [
      el('h4', {
        attrs: { id: 'manufacturing-exact-hashes-title' },
        text: t('studio.manufacturing-robotics.handoff.exact-hashes'),
      }),
      el('ul', {
        children: references.map((reference) =>
          el('li', { children: [el('code', { text: artifactReferenceSummary(reference) })] })
        ),
      }),
    ],
  });
}

function renderHandoffPanel(handoff) {
  return el('section', {
    className: 'manufacturing-robotics-result-panel manufacturing-robotics-handoff',
    attrs: { 'aria-labelledby': 'manufacturing-robotics-handoff-title' },
    children: [
      el('h3', {
        className: 'manufacturing-robotics-section-title',
        attrs: { id: 'manufacturing-robotics-handoff-title' },
        text: t('studio.manufacturing-robotics.handoff.title'),
      }),
      el('div', {
        className: 'manufacturing-handoff-grid',
        children: [
          renderHandoffSection('design', 'studio.manufacturing-robotics.handoff.design', [
            { label: t('studio.manufacturing-robotics.handoff.package'), value: displayValue(handoff.design.packageSlug) },
            { label: t('studio.manufacturing-robotics.handoff.part'), value: displayValue(handoff.design.partId) },
            { label: t('studio.manufacturing-robotics.handoff.revision'), value: displayValue(handoff.design.revision) },
            { label: t('studio.manufacturing-robotics.handoff.features'), value: displayValue(handoff.design.featureIds) },
            { label: t('studio.manufacturing-robotics.handoff.digest'), value: displayValue(handoff.design.sourceDigest) },
          ]),
          renderHandoffSection('manufacturing', 'studio.manufacturing-robotics.handoff.manufacturing', [
            { label: t('studio.manufacturing-robotics.handoff.actions'), value: displayValue(handoff.manufacturing.actionIds) },
            { label: t('studio.manufacturing-robotics.handoff.joints'), value: displayValue(handoff.manufacturing.robotJointIds) },
            { label: t('studio.manufacturing-robotics.handoff.tools'), value: displayValue(handoff.manufacturing.toolInterfaceIds) },
            { label: t('studio.manufacturing-robotics.handoff.preconditions'), value: displayValue(handoff.manufacturing.preconditions) },
            { label: t('studio.manufacturing-robotics.handoff.postconditions'), value: displayValue(handoff.manufacturing.postconditions) },
            { label: t('studio.manufacturing-robotics.handoff.unresolved'), value: displayValue(handoff.manufacturing.unresolvedRequirementIds) },
          ]),
          renderHandoffSection('quality', 'studio.manufacturing-robotics.handoff.quality', [
            { label: t('studio.manufacturing-robotics.handoff.characteristics'), value: displayValue(handoff.quality.characteristicIds) },
            { label: t('studio.manufacturing-robotics.handoff.inspection-evidence'), value: boolLabel(handoff.quality.inspectionEvidence) },
            { label: t('studio.manufacturing-robotics.handoff.approval'), value: boolLabel(handoff.quality.approvalGranted) },
            { label: t('studio.manufacturing-robotics.handoff.inspection-plan-ref'), value: displayValue(artifactReferenceSummary(handoff.quality.inspectionPlanRef)) },
          ]),
          renderHandoffSection('trust', 'studio.manufacturing-robotics.handoff.trust', [
            { label: t('studio.manufacturing-robotics.handoff.lineage'), value: displayValue(handoff.trust.lineageStatus) },
            { label: t('studio.manufacturing-robotics.handoff.synthetic'), value: boolLabel(handoff.trust.syntheticOnly) },
            { label: t('studio.manufacturing-robotics.handoff.holds'), value: displayValue(handoff.trust.remainingHolds) },
          ]),
        ],
      }),
      renderExactHashes(handoff.trust.exactHashes),
    ],
  });
}

function renderCapabilityList(titleKey, items, kind) {
  return el('section', {
    className: `manufacturing-lerobot-list manufacturing-lerobot-list-${kind}`,
    children: [
      el('h4', { text: t(titleKey, { count: items.length }) }),
      el('ul', {
        children: items.map((item) =>
          el('li', { text: t(`studio.manufacturing-robotics.lerobot.${kind}.${item}`) })
        ),
      }),
    ],
  });
}

function renderTrustPanel(viewModel) {
  return el('section', {
    className: 'manufacturing-robotics-result-panel manufacturing-robotics-trust',
    attrs: { 'aria-labelledby': 'manufacturing-robotics-trust-title' },
    children: [
      el('h3', {
        className: 'manufacturing-robotics-section-title',
        attrs: { id: 'manufacturing-robotics-trust-title' },
        text: t('studio.manufacturing-robotics.trust.title'),
      }),
      el('p', {
        className: 'manufacturing-robotics-boundary-note',
        text: t('studio.manufacturing-robotics.trust.copy'),
      }),
      el('dl', {
        className: 'manufacturing-boundary-grid',
        children: viewModel.boundaries.map((boundary) =>
          el('div', {
            className: 'manufacturing-boundary-item',
            children: [
              el('dt', { text: boundary.key }),
              el('dd', { text: boolLabel(boundary.value) }),
            ],
          })
        ),
      }),
      el('div', {
        className: 'manufacturing-lerobot-header',
        children: [
          el('h3', { text: t('studio.manufacturing-robotics.lerobot.title') }),
          el('p', { text: t('studio.manufacturing-robotics.lerobot.copy') }),
          createInfoGrid([
            { label: t('studio.manufacturing-robotics.lerobot.export-status'), value: viewModel.lerobot.exportStatus },
            { label: 'LEROBOT_COMPATIBLE', value: String(viewModel.lerobot.compatible) },
            { label: 'TRAINING_READY', value: String(viewModel.lerobot.trainingReady) },
          ]),
        ],
      }),
      el('div', {
        className: 'manufacturing-lerobot-grid',
        children: [
          renderCapabilityList(
            'studio.manufacturing-robotics.lerobot.available-title',
            viewModel.lerobot.available,
            'available'
          ),
          renderCapabilityList(
            'studio.manufacturing-robotics.lerobot.missing-title',
            viewModel.lerobot.missing,
            'missing'
          ),
        ],
      }),
    ],
  });
}

function renderSuccess(viewModel, cardState) {
  const selectedAction = viewModel.actions.find(
    (action) => action.actionId === cardState.selectedActionId
  ) || null;
  return el('div', {
    className: 'manufacturing-robotics-success',
    children: [
      createInlineStatus({
        title: t('studio.manufacturing-robotics.success.title'),
        copy: t('studio.manufacturing-robotics.success.copy', {
          actions: viewModel.actions.length,
          artifacts: viewModel.availableArtifactCount,
        }),
        tone: viewModel.actions.length === 10
          && viewModel.availableArtifactCount === MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT
          ? 'ok'
          : 'warn',
      }),
      el('section', {
        className: 'manufacturing-robotics-timeline-section',
        attrs: { 'aria-labelledby': 'manufacturing-robotics-timeline-title' },
        children: [
          el('h3', {
            className: 'manufacturing-robotics-section-title',
            attrs: { id: 'manufacturing-robotics-timeline-title' },
            text: t('studio.manufacturing-robotics.timeline.title'),
          }),
          el('p', {
            className: 'inline-note',
            text: t('studio.manufacturing-robotics.timeline.copy'),
          }),
          el('div', {
            className: 'manufacturing-robotics-timeline-layout',
            children: [
              renderActionTimeline(viewModel.actions, selectedAction?.actionId || ''),
              renderActionDetail(selectedAction, viewModel.dataset.annotationOrigin, {
                hasActions: viewModel.actions.length > 0,
              }),
            ],
          }),
        ],
      }),
      el('div', {
        className: 'manufacturing-robotics-panel-grid',
        children: [renderQualityPanel(viewModel.quality), renderHandoffPanel(viewModel.handoff)],
      }),
      renderTrustPanel(viewModel),
      renderTrustDemoChoice(cardState),
      el('div', {
        className: 'manufacturing-robotics-primary-action',
        children: [
          createPrimaryAction({
            label: t('studio.manufacturing-robotics.action.view-files'),
            action: 'manufacturing-robotics-open-artifacts',
            dataset: { jobId: viewModel.jobId },
          }),
          createSecondaryAction({
            label: t('studio.manufacturing-robotics.action.run-blocked-demo'),
            action: 'manufacturing-robotics-run-blocked-demo',
            disabled: !cardState.trustDemo,
          }),
        ],
      }),
    ],
  });
}

function renderCardBody(viewModel, cardState) {
  if (viewModel.phase === 'running') return renderRunning(viewModel);
  if (viewModel.phase === 'preparing') return renderPreparing();
  if (viewModel.phase === 'loading') return renderLoading();
  if (viewModel.phase === 'error') return renderError({ errorContext: viewModel.errorContext });
  if (viewModel.phase === 'artifact-error') return renderError({ artifactError: true });
  if (viewModel.phase === 'blocked') return renderBlocked(viewModel);
  if (viewModel.phase === 'success') return renderSuccess(viewModel, cardState);
  return renderPreRun();
}

export function findManufacturingRoboticsCardJob(state, cardState) {
  const activeJob = state.data.activeJob?.summary;
  const candidates = [
    activeJob,
    ...(state.data.recentJobs?.items || []),
    ...(state.data.jobMonitor?.items || []),
    cardState.job,
  ];
  const selectedJob = candidates.find((job) => job?.id && job.id === cardState.jobId);
  if (selectedJob) return selectedJob;
  if (!cardState.jobId && isManufacturingRoboticsJob(activeJob)) return activeJob;
  return cardState.job || null;
}

function activeArtifactsForJob(state, jobId) {
  if (state.data.activeJob?.summary?.id !== jobId || state.data.activeJob?.status !== 'ready') return [];
  return arrayValue(state.data.activeJob.artifacts);
}

function artifactSearchText(artifact = {}) {
  return [artifact.file_name, artifact.key, artifact.id, artifact.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function findPayloadArtifact(artifacts, spec) {
  return artifacts.find((artifact) => {
    const search = artifactSearchText(artifact);
    return search.includes(spec.fileName) || search.includes(spec.artifactType);
  }) || null;
}

async function loadPayloadDocuments(artifacts) {
  const entries = await Promise.all(PAYLOAD_SPECS.map(async (spec) => {
    const artifact = findPayloadArtifact(artifacts, spec);
    if (!artifact) throw new Error(`Missing registered artifact: ${spec.fileName}`);
    const text = await fetchArtifactText(artifact, 300000);
    const payload = parseArtifactPayload(artifact, text);
    if (!isObject(payload)) throw new Error(`Unreadable registered artifact: ${spec.fileName}`);
    return [spec.key, payload];
  }));
  return Object.fromEntries(entries);
}

function cardViewModel(state, cardState) {
  const job = findManufacturingRoboticsCardJob(state, cardState);
  const artifacts = job?.id ? activeArtifactsForJob(state, job.id) : [];
  const viewModel = buildManufacturingRoboticsViewModel({
    job,
    artifacts,
    payloads: cardState.payloads,
    requestStatus: cardState.requestStatus,
    artifactLoadStatus: cardState.artifactLoadStatus,
    errorMessage: cardState.errorMessage,
  });
  return {
    ...viewModel,
    phase: resolveManufacturingRoboticsPresentationPhase(
      viewModel.phase,
      cardState.progressVisibleUntil
    ),
  };
}

export function renderManufacturingRoboticsCard(state) {
  const cardState = ensureManufacturingRoboticsCardState(state.data.review);
  const viewModel = cardViewModel(state, cardState);
  return el('article', {
    className: 'studio-card manufacturing-robotics-card',
    attrs: {
      'aria-labelledby': 'manufacturing-robotics-card-title',
      'data-surface': 'panel',
    },
    dataset: {
      hook: 'manufacturing-robotics-card',
      phase: viewModel.phase,
    },
    children: [
      el('div', {
        className: 'card-header manufacturing-robotics-card-header',
        children: [
          el('div', {
            className: 'card-title-row',
            children: [
              el('div', {
                children: [
                  el('p', {
                    className: 'card-kicker',
                    text: t('studio.manufacturing-robotics.kicker'),
                  }),
                  el('h2', {
                    className: 'card-title',
                    attrs: { id: 'manufacturing-robotics-card-title' },
                    text: t('studio.manufacturing-robotics.title'),
                  }),
                ],
              }),
              el('span', {
                className: `pill manufacturing-robotics-phase manufacturing-robotics-phase-${viewModel.phase}`,
                text: phaseLabel(viewModel.phase),
                dataset: { hook: 'manufacturing-robotics-phase' },
              }),
            ],
          }),
          el('p', {
            className: 'card-copy',
            text: t('studio.manufacturing-robotics.description'),
          }),
        ],
      }),
      el('div', {
        className: 'card-body manufacturing-robotics-body',
        dataset: { hook: 'manufacturing-robotics-body' },
        children: [renderCardBody(viewModel, cardState)],
      }),
    ],
  });
}

export function mountManufacturingRoboticsCard({
  root,
  state,
  submitTrackedJob,
  openJob,
}) {
  const cardRoot = root.querySelector('[data-hook="manufacturing-robotics-card"]');
  if (!cardRoot) return { syncFromShell() {}, destroy() {} };
  const cardState = ensureManufacturingRoboticsCardState(state.data.review);
  const cardRuntime = ensureCardRuntime(cardState);
  const body = cardRoot.querySelector('[data-hook="manufacturing-robotics-body"]');
  const phase = cardRoot.querySelector('[data-hook="manufacturing-robotics-phase"]');
  let destroyed = false;
  let loadSequence = 0;
  let artifactLoadOwner = null;
  let focusDeliverySequence = 0;
  let progressReleaseTimer = null;

  function armFocusHandoff(event, control, { targetAction, phase: targetPhase }) {
    cardState.focusHandoff = event.detail === 0
      && cardRoot.ownerDocument.activeElement === control
      ? { jobId: '', targetAction, targetPhase }
      : null;
  }

  function findActionControl(action) {
    return [...cardRoot.querySelectorAll('[data-action]')]
      .find((control) => control.dataset.action === action) || null;
  }

  function adoptActiveJob() {
    const activeJob = state.data.activeJob?.summary;
    if (!isManufacturingRoboticsJob(activeJob) || !activeJob?.id) return;
    if (cardState.requestStatus === 'submitting') return;
    if (cardState.focusHandoff?.jobId && cardState.focusHandoff.jobId !== activeJob.id) return;
    if (shouldIgnoreManufacturingRoboticsActiveJob(activeJob, cardState)) return;
    if (cardState.jobId !== activeJob.id) {
      cardState.jobId = activeJob.id;
      cardState.job = activeJob;
      cardState.requestStatus = 'idle';
      cardState.artifactLoadStatus = 'idle';
      cardState.loadedJobId = '';
      cardState.payloads = {};
      cardState.selectedActionId = '';
      cardState.trustDemo = false;
      cardState.progressVisibleUntil = 0;
      cardState.errorMessage = '';
    } else {
      cardState.job = activeJob;
    }
    cardState.ignoredActiveJobId = '';
  }

  function isShellTransientFocus(activeElement) {
    const documentRef = cardRoot.ownerDocument;
    return !activeElement
      || activeElement === documentRef.body
      || activeElement === documentRef.documentElement
      || activeElement === documentRef.getElementById('workspace-root');
  }

  function clearFocusHandoff() {
    cardState.focusHandoff = null;
    focusDeliverySequence += 1;
  }

  function scheduleFocusHandoff(viewModel) {
    const handoff = cardState.focusHandoff;
    if (!handoff?.jobId) return;
    const activeJob = state.data.activeJob;
    const selectedJobReady = state.route === 'review'
      && activeJob?.status === 'ready'
      && activeJob?.summary?.id === handoff.jobId
      && viewModel.jobId === handoff.jobId;
    if (!selectedJobReady) return;

    if (viewModel.phase !== handoff.targetPhase) {
      const mayStillReachSuccess = handoff.targetPhase === 'success'
        && ['running', 'loading', 'preparing'].includes(viewModel.phase);
      if (!mayStillReachSuccess) clearFocusHandoff();
      return;
    }
    if (
      handoff.targetPhase === 'success'
      && (cardState.artifactLoadStatus !== 'ready' || cardState.loadedJobId !== handoff.jobId)
    ) {
      return;
    }

    const sequence = ++focusDeliverySequence;
    const attemptFocus = ({ settle = false } = {}) => {
      if (destroyed || sequence !== focusDeliverySequence) return;
      const currentHandoff = cardState.focusHandoff;
      const currentViewModel = cardViewModel(state, cardState);
      const currentActiveJob = state.data.activeJob;
      if (
        !currentHandoff
        || currentHandoff.jobId !== handoff.jobId
        || currentHandoff.targetAction !== handoff.targetAction
        || currentHandoff.targetPhase !== handoff.targetPhase
        || state.route !== 'review'
        || currentActiveJob?.status !== 'ready'
        || currentActiveJob?.summary?.id !== handoff.jobId
        || currentViewModel.jobId !== handoff.jobId
        || currentViewModel.phase !== handoff.targetPhase
      ) {
        return;
      }
      const focusTarget = findActionControl(handoff.targetAction);
      if (!(focusTarget instanceof cardRoot.ownerDocument.defaultView.HTMLElement) || !focusTarget.isConnected) {
        return;
      }
      const activeElement = cardRoot.ownerDocument.activeElement;
      if (activeElement !== focusTarget && !isShellTransientFocus(activeElement)) {
        clearFocusHandoff();
        return;
      }
      focusTarget.focus({ preventScroll: true });
      if (settle && cardRoot.ownerDocument.activeElement === focusTarget) {
        clearFocusHandoff();
      }
    };

    cardRoot.ownerDocument.defaultView.requestAnimationFrame(() => {
      cardRoot.ownerDocument.defaultView.requestAnimationFrame(() => attemptFocus());
    });
    cardRoot.ownerDocument.defaultView.setTimeout(() => attemptFocus({ settle: true }), 100);
  }

  function render({ restoreFocus = null } = {}) {
    if (destroyed) return;
    if (cardState.progressVisibleUntil > 0 && cardState.progressVisibleUntil <= Date.now()) {
      cardState.progressVisibleUntil = 0;
    }
    const viewModel = cardViewModel(state, cardState);
    cardRoot.dataset.phase = viewModel.phase;
    phase.className = `pill manufacturing-robotics-phase manufacturing-robotics-phase-${viewModel.phase}`;
    phase.textContent = phaseLabel(viewModel.phase);
    body.replaceChildren(renderCardBody(viewModel, cardState));
    applyTranslations(cardRoot);
    const explicitFocusTarget = restoreFocus?.();
    if (explicitFocusTarget) {
      explicitFocusTarget.focus?.({ preventScroll: true });
      return;
    }
    scheduleFocusHandoff(viewModel);
    if (progressReleaseTimer) {
      cardRoot.ownerDocument.defaultView.clearTimeout(progressReleaseTimer);
      progressReleaseTimer = null;
    }
    if (viewModel.phase === 'preparing') {
      const delay = Math.max(0, cardState.progressVisibleUntil - Date.now());
      progressReleaseTimer = cardRoot.ownerDocument.defaultView.setTimeout(() => {
        progressReleaseTimer = null;
        cardState.progressVisibleUntil = 0;
        render();
      }, delay + 1);
    }
  }

  async function loadArtifacts({ force = false } = {}) {
    const job = findManufacturingRoboticsCardJob(state, cardState);
    if (normalizedJobStatus(job) !== 'succeeded' || !job?.id) return;
    const artifacts = activeArtifactsForJob(state, job.id);
    if (artifacts.length === 0) return;
    if (!force && (cardState.loadedJobId === job.id || cardState.artifactLoadStatus === 'loading')) return;

    const sequence = ++loadSequence;
    const owner = { jobId: job.id, sequence };
    artifactLoadOwner = owner;
    cardState.artifactLoadStatus = 'loading';
    cardState.errorMessage = '';
    render();
    try {
      const payloads = await loadPayloadDocuments(artifacts);
      if (destroyed || sequence !== loadSequence) return;
      cardState.payloads = payloads;
      cardState.loadedJobId = job.id;
      cardState.artifactLoadStatus = 'ready';
      cardState.selectedActionId = '';
    } catch {
      if (destroyed || sequence !== loadSequence) return;
      cardState.payloads = {};
      cardState.loadedJobId = '';
      cardState.artifactLoadStatus = 'error';
      cardState.errorMessage = t('studio.manufacturing-robotics.artifact-error.copy');
    } finally {
      if (artifactLoadOwner === owner) artifactLoadOwner = null;
    }
    render();
  }

  async function submit({ trustDemo = cardState.trustDemo } = {}) {
    const submissionSequence = ++cardRuntime.submissionSequence;
    cardState.ignoredActiveJobId = textValue(state.data.activeJob?.summary?.id);
    cardState.trustDemo = trustDemo === true;
    cardState.requestStatus = 'submitting';
    cardState.artifactLoadStatus = 'idle';
    cardState.loadedJobId = '';
    cardState.payloads = {};
    cardState.selectedActionId = '';
    cardState.progressVisibleUntil = cardState.trustDemo
      ? 0
      : Date.now() + MANUFACTURING_ROBOTICS_MINIMUM_PROGRESS_MS;
    cardState.errorMessage = '';
    render();
    try {
      const job = await submitTrackedJob(createManufacturingRoboticsSubmission({
        trustDemo: cardState.trustDemo,
      }));
      if (submissionSequence !== cardRuntime.submissionSequence) return;
      if (!job?.id) {
        clearFocusHandoff();
        throw new Error('Tracked manufacturing job did not return an id.');
      }
      if (cardState.focusHandoff && !cardState.focusHandoff.jobId) {
        cardState.focusHandoff.jobId = job.id;
      }
      cardState.jobId = job.id;
      cardState.job = job;
      cardState.requestStatus = 'idle';
    } catch {
      if (submissionSequence !== cardRuntime.submissionSequence) return;
      clearFocusHandoff();
      cardState.requestStatus = 'error';
      cardState.progressVisibleUntil = 0;
      cardState.errorMessage = t('studio.manufacturing-robotics.error.copy');
    }
    if (destroyed) {
      cardRuntime.activeSync?.();
      return;
    }
    render();
  }

  function handleChange(event) {
    const control = event.target.closest?.('[data-manufacturing-robotics-trust-demo="true"]');
    if (!control || !cardRoot.contains(control)) return;
    const shouldRestoreFocus = cardRoot.ownerDocument.activeElement === control;
    cardState.trustDemo = control.checked === true;
    render({
      restoreFocus: shouldRestoreFocus
        ? () => cardRoot.querySelector('[data-manufacturing-robotics-trust-demo="true"]')
        : null,
    });
  }

  function handleClick(event) {
    const control = event.target.closest?.('[data-action]');
    if (!control || !cardRoot.contains(control)) return;
    const action = control.dataset.action;
    if (action === 'manufacturing-robotics-generate') {
      armFocusHandoff(event, control, {
        targetAction: 'manufacturing-robotics-select-action',
        phase: 'success',
      });
      submit({ trustDemo: false }).catch(() => {});
      return;
    }
    if (action === 'manufacturing-robotics-retry') {
      if (cardState.trustDemo) {
        armFocusHandoff(event, control, {
          targetAction: 'manufacturing-robotics-regenerate-approved',
          phase: 'blocked',
        });
      } else {
        clearFocusHandoff();
      }
      submit().catch(() => {});
      return;
    }
    if (action === 'manufacturing-robotics-regenerate-approved') {
      armFocusHandoff(event, control, {
        targetAction: 'manufacturing-robotics-open-artifacts',
        phase: 'success',
      });
      submit({ trustDemo: false }).catch(() => {});
      return;
    }
    if (action === 'manufacturing-robotics-run-blocked-demo') {
      if (!cardState.trustDemo) return;
      armFocusHandoff(event, control, {
        targetAction: 'manufacturing-robotics-regenerate-approved',
        phase: 'blocked',
      });
      submit({ trustDemo: true }).catch(() => {});
      return;
    }
    if (action === 'manufacturing-robotics-reload-artifacts') {
      loadArtifacts({ force: true }).catch(() => {});
      return;
    }
    if (action === 'manufacturing-robotics-select-action') {
      const selectedActionId = textValue(control.dataset.actionId);
      const shouldRestoreFocus = cardRoot.ownerDocument.activeElement === control;
      cardState.selectedActionId = selectedActionId;
      render({
        restoreFocus: shouldRestoreFocus
          ? () => [...cardRoot.querySelectorAll('[data-action="manufacturing-robotics-select-action"]')]
              .find((candidate) => candidate.dataset.actionId === selectedActionId)
          : null,
      });
      return;
    }
    if (action === 'manufacturing-robotics-open-artifacts') {
      const jobId = textValue(control.dataset.jobId || cardState.jobId);
      if (jobId) openJob(jobId, { route: 'artifacts' }).catch(() => {});
    }
  }

  function handlePointerDown() {
    if (cardState.focusHandoff) clearFocusHandoff();
  }

  function handleDocumentFocusIn(event) {
    const handoff = cardState.focusHandoff;
    if (!handoff) return;
    const focusTarget = findActionControl(handoff.targetAction);
    if (event.target === focusTarget || isShellTransientFocus(event.target)) return;
    clearFocusHandoff();
  }

  function syncFromShell() {
    if (destroyed) return;
    adoptActiveJob();
    const job = findManufacturingRoboticsCardJob(state, cardState);
    if (job?.id === cardState.jobId) cardState.job = job;
    render();
    loadArtifacts().catch(() => {});
  }

  cardRoot.addEventListener('change', handleChange);
  cardRoot.addEventListener('click', handleClick);
  cardRoot.ownerDocument.addEventListener('pointerdown', handlePointerDown, true);
  cardRoot.ownerDocument.addEventListener('focusin', handleDocumentFocusIn, true);
  cardRuntime.activeSync = syncFromShell;
  syncFromShell();

  return {
    syncFromShell,
    destroy() {
      destroyed = true;
      loadSequence += 1;
      if (
        artifactLoadOwner
        && cardState.jobId === artifactLoadOwner.jobId
        && cardState.artifactLoadStatus === 'loading'
      ) {
        cardState.artifactLoadStatus = cardState.loadedJobId === artifactLoadOwner.jobId
          ? 'ready'
          : 'idle';
      }
      artifactLoadOwner = null;
      focusDeliverySequence += 1;
      if (progressReleaseTimer) {
        cardRoot.ownerDocument.defaultView.clearTimeout(progressReleaseTimer);
        progressReleaseTimer = null;
      }
      if (state.route !== 'review') cardState.focusHandoff = null;
      if (cardRuntime.activeSync === syncFromShell) cardRuntime.activeSync = null;
      cardRoot.removeEventListener('change', handleChange);
      cardRoot.removeEventListener('click', handleClick);
      cardRoot.ownerDocument.removeEventListener('pointerdown', handlePointerDown, true);
      cardRoot.ownerDocument.removeEventListener('focusin', handleDocumentFocusIn, true);
    },
  };
}
