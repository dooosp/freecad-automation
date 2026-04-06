import { LOCAL_API_VERSION } from '../local-api-contract.js';
import { toJobResponse } from '../local-api-job-response.js';
import { assertResponse, createErrorResponse } from '../local-api-response-helpers.js';

export function registerJobRoutes(app, {
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

      const retriedJob = await jobStore.createJob(structuredClone(sourceJob.request), {
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
