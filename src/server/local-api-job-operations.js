import { validateJobRequest } from '../services/jobs/job-executor.js';
import { LOCAL_API_VERSION } from './local-api-contract.js';
import { toJobResponse } from './local-api-job-response.js';
import { assertResponse, createErrorResponse } from './local-api-response-helpers.js';
import { RESOLVED_STUDIO_DRAWING } from './studio-job-bridge.js';

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
    if (body?.type !== 'draw' && body?.type !== 'report') return body;
    // Leave malformed inputs intact for the request validator; resolving a
    // snapshot must not normalize an invalid caller field into a valid one.
    if (body.drawing_settings !== undefined && !isPlainObject(body.drawing_settings)) return body;

    let drawingPlan = null;
    let previewPlanReason = 'not_requested';
    const previewId = typeof body.drawing_preview_id === 'string' ? body.drawing_preview_id.trim() : '';
    const strict = body.type === 'report' || body.drawing_preview_revision !== undefined;
    let snapshot = null;

    if (previewId) {
      try {
        const resolved = typeof studioDrawingService.getTrackedDrawPlan === 'function'
          ? await studioDrawingService.getTrackedDrawPlan({
              previewId,
              configToml: body.config_toml,
              previewRevision: body.drawing_preview_revision,
              ...(strict ? { strict: true, drawingSettings: body.drawing_settings || {} } : {}),
            })
          : { drawingPlan: null, reason: 'preview_not_supported' };
        drawingPlan = resolved.drawingPlan;
        previewPlanReason = resolved.reason || 'not_requested';
        if (drawingPlan) snapshot = resolved;
      } catch {
        drawingPlan = null;
        previewPlanReason = 'preview_unavailable';
      }
    }

    const prepared = {
      ...body,
      ...(previewId ? { drawing_plan: drawingPlan || undefined } : {}),
      options: mergeStudioOptions(body.options, {
        ...(body.type === 'draw' || previewId ? { source: 'drawing-workspace' } : {}),
        drawing_settings: structuredClone(strict && snapshot ? snapshot.settings : body.drawing_settings || {}),
        preview_plan: {
          requested: Boolean(previewId),
          preserved: Boolean(drawingPlan),
          reason: previewPlanReason,
          ...(strict && snapshot ? { revision: snapshot.revision, annotation_only: true } : {}),
        },
      }),
    };
    if (strict && snapshot) {
      prepared.drawing_settings = structuredClone(snapshot.settings);
      Object.defineProperty(prepared, RESOLVED_STUDIO_DRAWING, { value: true });
    }
    return prepared;
  }

  async function enqueueJob(request, res, { trustedPathRoots = [] } = {}) {
    const validation = validateJobRequest(request, { trustedPathRoots });
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

  async function enqueueStudioResolvedJob(request, res) {
    return enqueueJob(request, res, { trustedPathRoots: [jobStore.jobsDir] });
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

  async function resolveArtifactRef(
    { job_id: jobId, artifact_id: artifactId },
    { proofLineage = false, expectedBinding = null, allowInternal = false } = {}
  ) {
    try {
      await jobStore.getJob(jobId);
    } catch {
      throw new Error('artifact_ref points to a missing tracked job or artifact.');
    }
    const artifact = await jobStore.getArtifact(jobId, artifactId);
    if (!artifact) {
      throw new Error('artifact_ref points to a missing tracked job or artifact.');
    }
    if (!artifact.exists) {
      throw new Error(`Artifact ${artifact.file_name} is registered for job ${jobId}, but the file is missing.`);
    }
    if (artifact.scope === 'internal' && allowInternal !== true) {
      throw new Error('artifact_ref points to an internal tracked artifact; use a user-facing tracked artifact.');
    }
    const artifactBinding = proofLineage === true
      ? Object.freeze({
          ...(await jobStore.verifyArtifactBinding(jobId, artifactId, { expectedBinding })),
        })
      : null;
    const jobArtifacts = await jobStore.listArtifacts(jobId);
    return {
      jobId,
      artifact,
      jobArtifacts,
      ...(artifactBinding ? { artifactBinding } : {}),
    };
  }

  return {
    prepareStudioJobBody,
    enqueueJob,
    enqueueStudioResolvedJob,
    buildJobActionResponse,
    resolveArtifactRef,
  };
}
