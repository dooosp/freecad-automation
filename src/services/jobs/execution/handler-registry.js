import { JOB_EXECUTOR_COMMANDS } from '../../../shared/command-manifest.js';
import { createCanonicalArtifactHandlers } from './canonical-artifact-handlers.js';
import { createEvidenceReadinessHandlers } from './evidence-readiness-handlers.js';
import { createReviewArtifactHandlers } from './review-artifact-handlers.js';
import { createRuntimeBackedHandlers } from './runtime-backed-handlers.js';
import { createStage5bHandlers } from './stage5b-handlers.js';

export function createJobHandlerRegistry(overrides = {}) {
  return Object.freeze({
    ...createRuntimeBackedHandlers(),
    ...createReviewArtifactHandlers(),
    ...createCanonicalArtifactHandlers(),
    ...createEvidenceReadinessHandlers(),
    ...createStage5bHandlers(),
    ...overrides,
  });
}

export const JOB_HANDLER_REGISTRY = createJobHandlerRegistry();

export async function executeJobByType(job, context, registry = JOB_HANDLER_REGISTRY) {
  const handler = registry[job?.type];
  if (typeof handler !== 'function') {
    throw new Error(`Unsupported job type: ${job?.type}`);
  }
  return handler(job, context);
}

const registryCommands = Object.keys(JOB_HANDLER_REGISTRY).sort();
const manifestCommands = [...JOB_EXECUTOR_COMMANDS].sort();
if (JSON.stringify(registryCommands) !== JSON.stringify(manifestCommands)) {
  throw new Error('Job handler registry does not match JOB_EXECUTOR_COMMANDS.');
}
