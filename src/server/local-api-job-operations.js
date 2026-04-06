import { validateJobRequest } from '../services/jobs/job-executor.js';
import { LOCAL_API_VERSION } from './local-api-contract.js';
import { toJobResponse } from './local-api-job-response.js';
import { assertResponse, createErrorResponse } from './local-api-response-helpers.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeStudioOptions(options = {}, studio = {}) {
  if (options !== undefined && !isPlainObject(options)) {
    return options;
  }

  const nextOptions = isPlainObject(options)
    ? structuredClone(options)
    : {};
  nextOptions.studio = {
    ...(isPlainObject(nextOptions.studio)
      ? nextOptions.studio
      : {}),
    ...studio,
  };
  return nextOptions;
}

export function createLocalApiJobCoordinator({
  jobStore,
  executor,
  studioDrawingService,
}) {
  async function prepareStudioJobBody(body = {}) {
    if (body?.type !== 'draw') return body;

    let drawingPlan = null;
    let previewPlanReason = 'not_requested';
    const previewId = typeof body.drawing_preview_id === 'string' ? body.drawing_preview_id.trim() : '';

    if (previewId) {
      try {
        const resolved = typeof studioDrawingService.getTrackedDrawPlan === 'function'
          ? await studioDrawingService.getTrackedDrawPlan({
              previewId,
              configToml: body.config_toml,
            })
          : { drawingPlan: null, reason: 'preview_not_supported' };
        drawingPlan = resolved.drawingPlan;
        previewPlanReason = resolved.reason || 'not_requested';
      } catch {
        drawingPlan = null;
        previewPlanReason = 'preview_unavailable';
      }
    }

    return {
      ...body,
      ...(drawingPlan ? { drawing_plan: drawingPlan } : {}),
      options: mergeStudioOptions(body.options, {
        source: 'drawing-workspace',
        drawing_settings: structuredClone(body.drawing_settings || {}),
        preview_plan: {
          requested: Boolean(previewId),
          preserved: Boolean(drawingPlan),
          reason: previewPlanReason,
        },
      }),
    };
  }

  async function enqueueJob(request, res) {
    const validation = validateJobRequest(request);
    if (!validation.ok) {
      const response = createErrorResponse('invalid_request', validation.errors);
      res.status(response.status).json(assertResponse('error', response.body));
      return;
    }

    const job = await jobStore.createJob(validation.request);
    const payload = {
      api_version: LOCAL_API_VERSION,
      ok: true,
      job: await toJobResponse(jobStore, job, { executor }),
    };
    res.status(202).json(assertResponse('job', payload));

    setImmediate(() => {
      executor.execute(job.id).catch(() => {
        // The executor persists failures in the job store.
      });
    });
  }

  async function buildJobActionResponse({
    type,
    status,
    message,
    sourceJobId,
    retryJobId = null,
    job,
  }) {
    return assertResponse('job_action', {
      api_version: LOCAL_API_VERSION,
      ok: true,
      action: {
        type,
        status,
        message,
        source_job_id: sourceJobId,
        retry_job_id: retryJobId,
      },
      job: await toJobResponse(jobStore, job, { executor }),
    });
  }

  async function resolveArtifactRef({ job_id: jobId, artifact_id: artifactId }) {
    await jobStore.getJob(jobId);
    const artifact = await jobStore.getArtifact(jobId, artifactId);
    if (!artifact) {
      throw new Error(`No artifact ${artifactId} found for job ${jobId}.`);
    }
    if (!artifact.exists) {
      throw new Error(`Artifact ${artifact.file_name} is registered for job ${jobId}, but the file is missing.`);
    }
    const jobArtifacts = await jobStore.listArtifacts(jobId);
    return {
      jobId,
      artifact,
      jobArtifacts,
    };
  }

  return {
    prepareStudioJobBody,
    enqueueJob,
    buildJobActionResponse,
    resolveArtifactRef,
  };
}
