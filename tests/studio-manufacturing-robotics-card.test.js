import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LEROBOT_AVAILABLE_CAPABILITIES,
  MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT,
  MANUFACTURING_ROBOTICS_MINIMUM_PROGRESS_MS,
  buildManufacturingRoboticsViewModel,
  createManufacturingRoboticsSubmission,
  ensureManufacturingRoboticsCardState,
  extractManufacturingRoboticsDiagnostic,
  findManufacturingRoboticsCardJob,
  renderManufacturingRoboticsCard,
  resolveManufacturingRoboticsPresentationPhase,
  shouldIgnoreManufacturingRoboticsActiveJob,
} from '../public/js/studio/manufacturing-robotics-card.js';

const ROOT = resolve(import.meta.dirname, '..');
const reviewSource = readFileSync(resolve(ROOT, 'public/js/studio/review-workspace.js'), 'utf8');
const surfaceSource = readFileSync(resolve(ROOT, 'public/js/studio/studio-surfaces.js'), 'utf8');
const beginnerIndex = reviewSource.indexOf('      renderBeginnerReviewSummary(state),');
const manufacturingCardIndex = reviewSource.indexOf('renderManufacturingRoboticsCard(state)', beginnerIndex);
const advancedIndex = reviewSource.indexOf("className: 'review-advanced-tools'", manufacturingCardIndex);
assert.notEqual(beginnerIndex, -1);
assert.equal(manufacturingCardIndex > beginnerIndex, true);
assert.equal(advancedIndex > manufacturingCardIndex, true);
assert.equal(surfaceSource.includes('manufacturing-action-dataset'), false, 'The demo must not add a Studio surface or route.');

const boundaries = {
  synthetic_demo: true,
  real_shop_floor_data: false,
  automatic_video_segmentation: false,
  computer_vision_model_used: false,
  lerobot_compatible: false,
  training_ready: false,
  inspection_evidence: false,
  evidence_attached: false,
  readiness_regenerated: false,
  product_release: false,
  production_readiness: false,
  human_review_required: true,
};

const actions = Array.from({ length: 10 }, (_, index) => ({
  order: index + 1,
  action_id: `action_${String(index + 1).padStart(2, '0')}`,
  primitive: index === 0 ? 'approach' : 'inspect',
  actor_type: 'robot',
  duration_ms: 1000 + index,
  references: {
    part_ids: ['hinge_block'],
    feature_ids: ['base_block'],
    quality_characteristic_ids: ['cd-01'],
    robot_joint_ids: ['j1_base_yaw'],
    tool_interface_ids: ['tool_flange'],
    inspection_plan_item_ids: ['inspection-01'],
  },
  preconditions: ['fixture_review_required'],
  postconditions: ['synthetic_step_recorded'],
  instruction: {
    ko: `${index + 1}단계 합성 지시`,
    en: `Synthetic instruction ${index + 1}`,
  },
  instruction_origin: 'curated_task_plan',
  human_review_required: true,
  unresolved_requirement_ids: ['physical_transform_required'],
}));

const payloads = {
  actionDictionary: {
    actions,
    boundaries,
    source_universe: {
      feature_ids: ['base_block'],
      robot_joint_ids: ['j1_base_yaw'],
      quality_characteristic_ids: ['cd-01'],
    },
  },
  episodeAnnotation: {
    artifact_id: 'manufacturing-episode-annotation-demo',
    identity: { package_slug: 'hinge-block', part_id: 'hinge_block', revision: 'A' },
    annotation_origin: 'curated_task_plan',
    segments: actions.map((action, index) => ({
      action_id: action.action_id,
      start_ms: index * 1000,
      end_ms: (index + 1) * 1000,
      duration_ms: 1000,
    })),
    source_snapshots: Array.from({ length: 5 }, (_, index) => ({ role: `source_${index + 1}` })),
    revision_lineage: { identity: { package_slug: 'hinge-block', part_id: 'hinge_block', revision: 'A' } },
    boundaries,
  },
  validationReport: {
    status: 'valid_synthetic_demo',
    boundaries,
    metrics: {
      action_count: 10,
      segment_count: 10,
      unique_primitive_count: 2,
      feature_coverage: { referenced_count: 7, total_count: 7, coverage_percent: 100 },
      joint_coverage: { referenced_count: 6, total_count: 6, coverage_percent: 100 },
      quality_coverage: { referenced_count: 4, total_count: 4, coverage_percent: 100 },
      language_coverage: { korean_percent: 100, english_percent: 100 },
      unknown_reference_count: 0,
      duplicate_reference_count: 0,
      transition_violation_count: 0,
      timeline_violation_count: 0,
      unresolved_requirement_count: 6,
      lineage_status: 'valid',
      boundary_status: 'valid',
    },
    checks: [{ check_id: 'lineage_integrity', status: 'pass', violation_count: 0 }],
  },
  datasetManifest: {
    dataset: {
      action_count: 10,
      segment_count: 10,
      source: 'synthetic_task_timeline',
      annotation_origin: 'curated_task_plan',
    },
    boundaries,
  },
  handoff: {
    boundaries,
    identity: { package_slug: 'hinge-block', part_id: 'hinge_block', revision: 'A' },
    design: {
      part_id: 'hinge_block',
      revision: 'A',
      feature_ids: ['base_block'],
      source_digest: 'a'.repeat(64),
    },
    manufacturing: {
      action_ids: actions.map((action) => action.action_id),
      robot_joint_ids: ['j1_base_yaw'],
      tool_interface_ids: ['tool_flange'],
      preconditions: ['fixture_review_required'],
      postconditions: ['synthetic_step_recorded'],
      unresolved_requirement_ids: ['physical_transform_required'],
    },
    quality: {
      quality_characteristic_ids: ['cd-01'],
      inspection_evidence: false,
      approval_granted: false,
      inspection_plan_ref: {
        role: 'inspection_plan',
        artifact_type: 'inspection_plan',
        path: 'run/inspection_plan.json',
        sha256: 'b'.repeat(64),
        size_bytes: 2048,
      },
    },
    trust: {
      lineage_status: 'valid',
      synthetic_only: true,
      remaining_holds: ['HUMAN_UAT: NOT_RUN', 'PRODUCTION_RELEASE: NOT_PERFORMED'],
      exact_hashes: Array.from({ length: 5 }, (_, index) => ({
        role: `source_${index + 1}`,
        artifact_type: 'source_snapshot',
        path: `inputs/source_${index + 1}.json`,
        sha256: String(index + 1).repeat(64),
        size_bytes: 100 + index,
      })),
    },
    approvals: {
      engineering: false,
      manufacturing: false,
      quality: false,
      inspection: false,
      readiness: false,
      release: false,
    },
  },
};

const registeredArtifacts = Array.from({ length: 8 }, (_, index) => ({
  id: `artifact-${index + 1}`,
  exists: true,
}));

assert.deepEqual(createManufacturingRoboticsSubmission(), {
  type: 'manufacturing-action-dataset',
  demoProfile: 'hinge-block-synthetic-inspection-v1',
  completionAction: {
    preferredRoute: 'review',
    failureRoute: 'review',
  },
});
assert.deepEqual(createManufacturingRoboticsSubmission({ trustDemo: true }), {
  type: 'manufacturing-action-dataset',
  demoProfile: 'hinge-block-synthetic-inspection-v1',
  trustDemo: 'revision-mismatch',
  completionAction: {
    preferredRoute: 'review',
    failureRoute: 'review',
  },
});

const persistentFocusState = {
  jobId: 'job-before-remount',
  requestStatus: 'idle',
  focusHandoff: {
    jobId: 'job-after-remount',
    targetPhase: 'blocked',
    targetAction: 'manufacturing-robotics-regenerate-approved',
  },
};
const persistentFocusReview = { manufacturingRobotics: persistentFocusState };
const normalizedPersistentFocusState = ensureManufacturingRoboticsCardState(persistentFocusReview);
assert.equal(normalizedPersistentFocusState, persistentFocusState);
assert.equal(persistentFocusReview.manufacturingRobotics, persistentFocusState);
assert.deepEqual(normalizedPersistentFocusState.focusHandoff, {
  jobId: 'job-after-remount',
  targetPhase: 'blocked',
  targetAction: 'manufacturing-robotics-regenerate-approved',
});
persistentFocusState.focusHandoff = {
  jobId: 'job-after-remount',
  targetPhase: 'success',
  targetAction: 'manufacturing-robotics-select-action',
};
assert.deepEqual(ensureManufacturingRoboticsCardState(persistentFocusReview).focusHandoff, {
  jobId: 'job-after-remount',
  targetPhase: 'success',
  targetAction: 'manufacturing-robotics-select-action',
});
persistentFocusState.focusHandoff = {
  jobId: 'job-after-remount',
  targetPhase: 'success',
  targetAction: 'arbitrary-selector',
};
assert.equal(ensureManufacturingRoboticsCardState(persistentFocusReview).focusHandoff, null);

assert.equal(MANUFACTURING_ROBOTICS_MINIMUM_PROGRESS_MS, 5000);
assert.equal(resolveManufacturingRoboticsPresentationPhase('loading', 10_000, 9_999), 'preparing');
assert.equal(resolveManufacturingRoboticsPresentationPhase('success', 10_000, 9_999), 'preparing');
assert.equal(resolveManufacturingRoboticsPresentationPhase('success', 10_000, 10_000), 'success');
assert.equal(resolveManufacturingRoboticsPresentationPhase('running', 10_000, 9_999), 'running');
assert.equal(resolveManufacturingRoboticsPresentationPhase('blocked', 10_000, 9_999), 'blocked');
const progressReview = { manufacturingRobotics: { progressVisibleUntil: 12_345 } };
assert.equal(ensureManufacturingRoboticsCardState(progressReview).progressVisibleUntil, 12_345);
progressReview.manufacturingRobotics.progressVisibleUntil = 'not-a-timestamp';
assert.equal(ensureManufacturingRoboticsCardState(progressReview).progressVisibleUntil, 0);
persistentFocusState.focusHandoff = {
  jobId: 'job-after-remount',
  targetPhase: 'blocked',
  targetAction: 'manufacturing-robotics-open-artifacts',
};
assert.equal(ensureManufacturingRoboticsCardState(persistentFocusReview).focusHandoff, null);

const previousSuccessJob = {
  id: 'job-previous-success',
  type: 'manufacturing-action-dataset',
  status: 'succeeded',
};
assert.equal(shouldIgnoreManufacturingRoboticsActiveJob(previousSuccessJob, {
  jobId: previousSuccessJob.id,
  ignoredActiveJobId: previousSuccessJob.id,
  requestStatus: 'submitting',
}), true, 'Submission refresh must not clear the previous active-job guard before the new job is acquired.');
assert.equal(shouldIgnoreManufacturingRoboticsActiveJob(previousSuccessJob, {
  jobId: 'job-new-queued',
  ignoredActiveJobId: previousSuccessJob.id,
  requestStatus: 'idle',
}), true, 'The previous success must not reclaim the card after the new job is acquired.');
assert.equal(shouldIgnoreManufacturingRoboticsActiveJob(previousSuccessJob, {
  jobId: previousSuccessJob.id,
  ignoredActiveJobId: previousSuccessJob.id,
  requestStatus: 'error',
}), false, 'A failed submission may restore the still-active previous job.');

const successJob = {
  id: 'job-manufacturing-success',
  type: 'manufacturing-action-dataset',
  status: 'succeeded',
  result: {
    status: 'valid_synthetic_demo',
    demo_profile: 'hinge-block-synthetic-inspection-v1',
    publication: { expected_count: 8, published_count: 8, exact: true },
  },
};
const viewModel = buildManufacturingRoboticsViewModel({
  job: successJob,
  artifacts: registeredArtifacts,
  payloads,
  artifactLoadStatus: 'ready',
});
assert.equal(viewModel.phase, 'success');
assert.equal(viewModel.actions.length, 10);
assert.equal(viewModel.actions[0].actionId, 'action_01');
assert.equal(viewModel.actions[0].instruction.ko, '1단계 합성 지시');
assert.equal(viewModel.actions[0].robotJointIds[0], 'j1_base_yaw');
assert.equal(viewModel.quality.status, 'valid_synthetic_demo');
assert.equal(viewModel.quality.transitionViolationCount, 0);
assert.equal(viewModel.quality.timelineViolationCount, 0);
assert.equal(viewModel.quality.unknownFeatureCount, 0);
assert.equal(viewModel.quality.unknownJointCount, 0);
assert.equal(viewModel.quality.unknownQualityCount, 0);
assert.equal(viewModel.handoff.design.packageSlug, 'hinge-block');
assert.deepEqual(viewModel.handoff.manufacturing.preconditions, ['fixture_review_required']);
assert.deepEqual(viewModel.handoff.manufacturing.postconditions, ['synthetic_step_recorded']);
assert.equal(viewModel.handoff.quality.inspectionEvidence, false);
assert.equal(viewModel.handoff.quality.inspectionPlanRef.path, 'run/inspection_plan.json');
assert.equal(viewModel.handoff.trust.exactHashes.length, 5);
assert.equal(viewModel.handoff.approvals.release, false);
assert.equal(viewModel.lerobot.exportStatus, 'NOT_EXPORTABLE_YET');
assert.equal(viewModel.lerobot.compatible, false);
assert.equal(viewModel.lerobot.trainingReady, false);
assert.deepEqual(viewModel.lerobot.available, [...LEROBOT_AVAILABLE_CAPABILITIES]);
assert.equal(viewModel.lerobot.available.length, 6);
assert.equal(viewModel.availableArtifactCount, MANUFACTURING_ROBOTICS_EXPECTED_OUTPUT_COUNT);

const unknownPayloads = structuredClone(payloads);
unknownPayloads.actionDictionary.actions[0].references.feature_ids.push('unknown_feature');
unknownPayloads.actionDictionary.actions[0].references.robot_joint_ids.push('unknown_joint');
unknownPayloads.actionDictionary.actions[0].references.quality_characteristic_ids.push('unknown_quality');
const unknownViewModel = buildManufacturingRoboticsViewModel({
  job: successJob,
  artifacts: registeredArtifacts,
  payloads: unknownPayloads,
  artifactLoadStatus: 'ready',
});
assert.equal(unknownViewModel.quality.unknownFeatureCount, 1);
assert.equal(unknownViewModel.quality.unknownJointCount, 1);
assert.equal(unknownViewModel.quality.unknownQualityCount, 1);

const absolutePathPayloads = structuredClone(payloads);
absolutePathPayloads.handoff.quality.inspection_plan_ref.path = '/Users/private/inspection_plan.json';
absolutePathPayloads.handoff.trust.exact_hashes[0].path = '../outside/source.json';
const pathSafeViewModel = buildManufacturingRoboticsViewModel({
  job: successJob,
  artifacts: registeredArtifacts,
  payloads: absolutePathPayloads,
  artifactLoadStatus: 'ready',
});
assert.equal(pathSafeViewModel.handoff.quality.inspectionPlanRef.path, '');
assert.equal(pathSafeViewModel.handoff.trust.exactHashes[0].path, '');

const blockedJob = {
  id: 'job-manufacturing-blocked',
  type: 'manufacturing-action-dataset',
  status: 'failed',
  diagnostics: {
    manufacturing_action_demo: {
      status: 'blocked',
      reason_code: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
      expected: { package_slug: 'hinge-block', part_id: 'hinge_block', revision: 'A' },
      received: { package_slug: 'hinge-block', part_id: 'hinge_block', revision: 'B' },
      published: { expected_count: 8, published_count: 0 },
      next_action: {
        code: 'REGENERATE_REVIEW_FROM_AUTHORITATIVE_REVISION_A',
        message: 'Regenerate the authoritative Revision A review artifact.',
      },
    },
  },
};
assert.deepEqual(extractManufacturingRoboticsDiagnostic(blockedJob), {
  reasonCode: 'REVISION_LINEAGE_IDENTITY_MISMATCH',
  expectedIdentity: {
    packageSlug: 'hinge-block',
    partId: 'hinge_block',
    revision: 'A',
    label: 'hinge-block / hinge_block / Revision A',
  },
  receivedIdentity: {
    packageSlug: 'hinge-block',
    partId: 'hinge_block',
    revision: 'B',
    label: 'hinge-block / hinge_block / Revision B',
  },
  expectedOutputCount: 8,
  publishedOutputCount: 0,
  nextAction: 'Regenerate the authoritative Revision A review artifact.',
});
assert.equal(buildManufacturingRoboticsViewModel({ job: blockedJob }).phase, 'blocked');

const genericFailedJob = {
  id: 'job-manufacturing-generic-failure',
  type: 'manufacturing-action-dataset',
  status: 'failed',
  diagnostics: {
    manufacturing_action_demo: {
      reason_code: 'SOURCE_HASH_MISMATCH',
    },
  },
};
const cancelledJob = {
  ...blockedJob,
  id: 'job-manufacturing-cancelled',
  status: 'cancelled',
};
assert.equal(buildManufacturingRoboticsViewModel({ job: genericFailedJob }).phase, 'error');
assert.equal(buildManufacturingRoboticsViewModel({ job: cancelledJob }).phase, 'error');
assert.equal(buildManufacturingRoboticsViewModel({ job: genericFailedJob }).errorContext, 'execution');
assert.equal(buildManufacturingRoboticsViewModel({ job: cancelledJob }).errorContext, 'cancelled');
assert.equal(buildManufacturingRoboticsViewModel({ requestStatus: 'error' }).errorContext, 'submission');
assert.equal(buildManufacturingRoboticsViewModel({
  job: genericFailedJob,
  requestStatus: 'error',
}).errorContext, 'submission', 'A rejected retry must describe the new request, not the previous accepted job.');

const oldActiveJob = { ...successJob, id: 'job-previous-success' };
const newQueuedJob = {
  id: 'job-new-queued',
  type: 'manufacturing-action-dataset',
  status: 'queued',
};
assert.equal(findManufacturingRoboticsCardJob({
  data: {
    activeJob: { summary: oldActiveJob },
    recentJobs: { items: [newQueuedJob] },
    jobMonitor: { items: [newQueuedJob] },
  },
}, {
  jobId: newQueuedJob.id,
  job: newQueuedJob,
})?.id, newQueuedJob.id, 'A newly submitted job must win over the previously active success job.');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTestElement(tagName) {
  return {
    tagName: String(tagName).toLowerCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    attributes: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    get outerHTML() {
      const classAttribute = this.className ? ` class="${escapeHtml(this.className)}"` : '';
      const dataAttributes = Object.entries(this.dataset)
        .map(([key, value]) => ` data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeHtml(value)}"`)
        .join('');
      const attributes = Object.entries(this.attributes)
        .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
        .join('');
      const children = this.children
        .map((child) => (typeof child === 'string' ? escapeHtml(child) : child.outerHTML || escapeHtml(child.textContent || '')))
        .join('');
      return `<${this.tagName}${classAttribute}${dataAttributes}${attributes}>${escapeHtml(this.textContent)}${children}</${this.tagName}>`;
    },
  };
}

globalThis.document = { createElement: createTestElement };

function cardStateFor(job, manufacturingRobotics) {
  return {
    data: {
      review: { manufacturingRobotics },
      activeJob: {
        status: 'ready',
        summary: job,
        artifacts: job?.status === 'succeeded' ? registeredArtifacts : [],
      },
      recentJobs: { items: [] },
      jobMonitor: { items: [] },
    },
  };
}

const preRunHtml = renderManufacturingRoboticsCard(cardStateFor(null, {})).outerHTML;
assert.match(preRunHtml, /data-action="manufacturing-robotics-generate"/);
assert.doesNotMatch(preRunHtml, /manufacturing-robotics-trust-demo/);

const successHtml = renderManufacturingRoboticsCard(cardStateFor(successJob, {
  jobId: successJob.id,
  job: successJob,
  artifactLoadStatus: 'ready',
  loadedJobId: successJob.id,
  payloads,
  selectedActionId: '',
})).outerHTML;
assert.match(successHtml, /Manufacturing Robotics Data/);
assert.match(successHtml, /VALID SYNTHETIC DEMO/);
assert.match(successHtml, /NOT_EXPORTABLE_YET/);
assert.match(successHtml, /LEROBOT_COMPATIBLE/);
assert.match(successHtml, /TRAINING_READY/);
assert.equal((successHtml.match(/>false</g) || []).length >= 2, true);
assert.match(successHtml, /fixture_review_required/);
assert.match(successHtml, /run\/inspection_plan\.json/);
assert.match(successHtml, /inputs\/source_5\.json/);
assert.match(successHtml, /data-action="manufacturing-robotics-open-artifacts"/);
assert.match(successHtml, /data-action="manufacturing-robotics-run-blocked-demo"/);
assert.match(successHtml, /Select a timeline action/);
assert.doesNotMatch(successHtml, /class="manufacturing-action-detail"/);
assert.match(successHtml, /id="manufacturing-robotics-trust-demo"/);
assert.doesNotMatch(successHtml, /id="manufacturing-robotics-trust-demo"[^>]*checked/);
assert.match(successHtml, /data-action="manufacturing-robotics-run-blocked-demo"[^>]*disabled="true"/);
assert.equal((successHtml.match(/data-action="manufacturing-robotics-select-action"/g) || []).length, 10);
assert.equal((successHtml.match(/aria-current="step"/g) || []).length, 0);
assert.equal((successHtml.match(/data-action-kind="primary"/g) || []).length, 1);

const selectedSuccessHtml = renderManufacturingRoboticsCard(cardStateFor(successJob, {
  jobId: successJob.id,
  job: successJob,
  artifactLoadStatus: 'ready',
  loadedJobId: successJob.id,
  payloads,
  selectedActionId: 'action_01',
  trustDemo: true,
})).outerHTML;
assert.match(selectedSuccessHtml, /aria-live="polite"/);
assert.match(selectedSuccessHtml, /Action detail · action_01/);
assert.match(selectedSuccessHtml, /curated_task_plan/);
assert.equal((selectedSuccessHtml.match(/aria-current="step"/g) || []).length >= 2, true);
assert.match(selectedSuccessHtml, /id="manufacturing-robotics-trust-demo"[^>]*checked="true"/);
assert.doesNotMatch(
  selectedSuccessHtml,
  /data-action="manufacturing-robotics-run-blocked-demo"[^>]*disabled="true"/
);

const preparingHtml = renderManufacturingRoboticsCard(cardStateFor(successJob, {
  jobId: successJob.id,
  job: successJob,
  artifactLoadStatus: 'ready',
  loadedJobId: successJob.id,
  payloads,
  progressVisibleUntil: Date.now() + MANUFACTURING_ROBOTICS_MINIMUM_PROGRESS_MS,
})).outerHTML;
assert.match(preparingHtml, /data-phase="preparing"/);
assert.match(preparingHtml, /Tracked job succeeded; preparing its result view/);
assert.doesNotMatch(preparingHtml, /Ten-action manufacturing timeline/);

const blockedHtml = renderManufacturingRoboticsCard(cardStateFor(blockedJob, {
  jobId: blockedJob.id,
  job: blockedJob,
})).outerHTML;
assert.match(blockedHtml, /BLOCKED/);
assert.match(blockedHtml, /REVISION_LINEAGE_IDENTITY_MISMATCH/);
assert.match(blockedHtml, /hinge-block \/ hinge_block \/ Revision A/);
assert.match(blockedHtml, /hinge-block \/ hinge_block \/ Revision B/);
assert.match(blockedHtml, />0 \/ 8</);
assert.equal((blockedHtml.match(/data-action-kind="primary"/g) || []).length, 1);

const genericFailureHtml = renderManufacturingRoboticsCard(cardStateFor(genericFailedJob, {
  jobId: genericFailedJob.id,
  job: genericFailedJob,
})).outerHTML;
assert.match(genericFailureHtml, /data-phase="error"/);
assert.doesNotMatch(genericFailureHtml, />BLOCKED</);
assert.match(genericFailureHtml, /accepted dataset job failed during execution/i);
assert.doesNotMatch(genericFailureHtml, /could not be submitted|request was not accepted/i);

const cancelledHtml = renderManufacturingRoboticsCard(cardStateFor(cancelledJob, {
  jobId: cancelledJob.id,
  job: cancelledJob,
})).outerHTML;
assert.match(cancelledHtml, /data-phase="error"/);
assert.doesNotMatch(cancelledHtml, />BLOCKED</);
assert.match(cancelledHtml, /Action unavailable/);
assert.match(cancelledHtml, /accepted dataset job was cancelled/i);
assert.doesNotMatch(cancelledHtml, /could not be submitted|request was not accepted|failed during execution/i);

const submissionErrorHtml = renderManufacturingRoboticsCard(cardStateFor(null, {
  requestStatus: 'error',
  errorMessage: 'The local API did not accept the request.',
})).outerHTML;
assert.match(submissionErrorHtml, /data-phase="error"/);
assert.match(submissionErrorHtml, /could not be submitted/i);
assert.match(submissionErrorHtml, /request was not accepted/i);
assert.doesNotMatch(submissionErrorHtml, /accepted dataset job|was cancelled|failed during execution/i);

console.log('studio-manufacturing-robotics-card.test.js: ok');
