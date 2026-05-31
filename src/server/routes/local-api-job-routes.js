import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve, win32 } from 'node:path';
import { LOCAL_API_VERSION } from '../local-api-contract.js';
import { toJobResponse } from '../local-api-job-response.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';
import { validateJobRequest } from '../../services/jobs/job-executor.js';

const RETRY_INPUT_PATH_FIELDS = Object.freeze([
  'config_path',
  'file_path',
  'context_path',
  'model_path',
  'bom_path',
  'inspection_path',
  'quality_path',
  'create_quality_path',
  'drawing_quality_path',
  'drawing_qa_path',
  'drawing_intent_path',
  'feature_catalog_path',
  'dfm_report_path',
  'compare_to_path',
  'baseline_path',
  'candidate_path',
  'review_pack_path',
  'process_plan_path',
  'quality_risk_path',
  'readiness_report_path',
  'docs_manifest_path',
  'intake_report_path',
]);

const RETRY_ARTIFACT_REF_FIELDS = Object.freeze([
  'artifact_ref',
  'intake_report_artifact_ref',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWindowsAbsolutePath(value) {
  return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value.trim());
}

function basenameFromAnyPath(value) {
  return win32.isAbsolute(value) ? win32.basename(value) : basename(value);
}

function resolveInputPath(projectRoot, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (isAbsolute(trimmed) || isWindowsAbsolutePath(trimmed)) return resolve(trimmed);
  return resolve(projectRoot, trimmed);
}

async function fileExists(pathValue) {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function retryReferenceErrors(request, { projectRoot, jobStore }) {
  const errors = [];

  for (const field of RETRY_ARTIFACT_REF_FIELDS) {
    const ref = request[field];
    if (!isPlainObject(ref)) continue;
    const jobId = String(ref.job_id || '').trim();
    const artifactId = String(ref.artifact_id || '').trim();
    try {
      const artifact = await jobStore.getArtifact(jobId, artifactId);
      if (!artifact) {
        errors.push(`${field} points to a missing tracked artifact.`);
      } else if (!artifact.exists) {
        errors.push(`${field} points to tracked artifact ${artifact.file_name || artifactId}, but the file is missing.`);
      }
    } catch {
      errors.push(`${field} points to a missing tracked job or artifact.`);
    }
  }

  for (const field of RETRY_INPUT_PATH_FIELDS) {
    const inputPath = request[field];
    if (typeof inputPath !== 'string' || !inputPath.trim()) continue;
    const resolvedPath = resolveInputPath(projectRoot, inputPath);
    if (!resolvedPath || await fileExists(resolvedPath)) continue;
    errors.push(`${field} input ${basenameFromAnyPath(inputPath)} is no longer available.`);
  }

  return errors;
}

export function registerJobRoutes(app, {
  projectRoot,
  jobStore,
  executor,
  jobCoordinator,
}) {
  app.get('/jobs', async (req, res, next) => {
    try {
      const parsedLimit = Number(req.query.limit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(parsedLimit)))
        : 8;
      const jobs = await jobStore.listJobs({ limit });
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        jobs: await Promise.all(jobs.map((job) => toJobResponse(jobStore, job, { executor }))),
      };
      res.json(assertResponse('jobs', payload));
    } catch (error) {
      next(error);
    }
  });

  app.post('/jobs', async (req, res) => {
    await jobCoordinator.enqueueJob(req.body, res);
  });

  app.post('/jobs/:id/cancel', async (req, res) => {
    try {
      const cancelled = await jobStore.cancelJob(req.params.id, {
        message: 'Queued job cancelled before execution started.',
      });

      if (cancelled.ok) {
        await jobStore.appendLog(req.params.id, 'Job cancelled before execution started.');
        res.json(await jobCoordinator.buildJobActionResponse({
          type: 'cancel',
          status: 'cancelled',
          message: 'Queued job cancelled before execution started.',
          sourceJobId: req.params.id,
          job: cancelled.job,
        }));
        return;
      }

      if (cancelled.job?.status === 'running') {
        if (typeof executor.cancelRunningJob === 'function') {
          const outcome = await executor.cancelRunningJob(req.params.id, cancelled.job);
          if (outcome?.ok && outcome.job) {
            await jobStore.appendLog(req.params.id, outcome.message || 'Running job cancellation completed.');
            res.json(await jobCoordinator.buildJobActionResponse({
              type: 'cancel',
              status: 'cancelled',
              message: outcome.message || 'Running job cancelled through executor support.',
              sourceJobId: req.params.id,
              job: outcome.job,
            }));
            return;
          }

          const response = createErrorResponse(
            outcome?.code || 'job_cancel_not_supported',
            outcome?.messages || [`Job ${req.params.id} is already running. This executor does not support safe mid-command cancellation.`],
            outcome?.status || 409
          );
          res.status(response.status).json(assertResponse('error', response.body));
          return;
        }

        const response = createErrorResponse(
          'job_cancel_not_supported',
          [`Job ${req.params.id} is already running. This executor does not support safe mid-command cancellation.`],
          409
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const response = createErrorResponse(
        'job_cancel_not_supported',
        [`Job ${req.params.id} is already ${cancelled.job?.status || 'finished'}. Only queued jobs can be cancelled on this runtime.`],
        409
      );
      res.status(response.status).json(assertResponse('error', response.body));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.post('/jobs/:id/retry', async (req, res) => {
    try {
      const sourceJob = await jobStore.getJob(req.params.id);
      const sourceStatus = String(sourceJob.status || '').toLowerCase();
      if (sourceStatus !== 'failed' && sourceStatus !== 'cancelled') {
        const response = createErrorResponse(
          'job_retry_not_supported',
          [`Job ${req.params.id} is ${sourceJob.status}. Only failed or cancelled jobs can be retried.`],
          409
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const validation = validateJobRequest(structuredClone(sourceJob.request));
      if (!validation.ok) {
        const response = createErrorResponse(
          'invalid_retry_request',
          validation.errors,
          400
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const retryErrors = await retryReferenceErrors(validation.request, { projectRoot, jobStore });
      if (retryErrors.length > 0) {
        const response = createErrorResponse(
          'stale_retry_reference',
          retryErrors,
          409
        );
        res.status(response.status).json(assertResponse('error', response.body));
        return;
      }

      const retriedJob = await jobStore.createJob(validation.request, {
        retriedFromJobId: sourceJob.id,
      });
      await jobStore.appendLog(retriedJob.id, `Retry queued from job ${sourceJob.id}.`);

      res.status(202).json(await jobCoordinator.buildJobActionResponse({
        type: 'retry',
        status: 'queued',
        message: `Retry queued from ${sourceStatus} job ${sourceJob.id}.`,
        sourceJobId: sourceJob.id,
        retryJobId: retriedJob.id,
        job: retriedJob,
      }));

      setImmediate(() => {
        executor.execute(retriedJob.id).catch(() => {
          // The executor persists failures in the job store.
        });
      });
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });

  app.get('/jobs/:id', async (req, res) => {
    try {
      const job = await jobStore.getJob(req.params.id);
      const payload = {
        api_version: LOCAL_API_VERSION,
        ok: true,
        job: await toJobResponse(jobStore, job, { executor }),
      };
      res.json(assertResponse('job', payload));
    } catch {
      const response = createErrorResponse('job_not_found', [`No job found for id ${req.params.id}.`], 404);
      res.status(response.status).json(assertResponse('error', response.body));
    }
  });
}
