import {
  buildAfExecutionStateDescriptor,
  getAfExecutionJobContract,
} from '../../lib/af-execution-contract.js';
import { redactPublicPathValues, toPublicStorage } from './local-api-artifacts.js';
import { toPublicJobRequest } from './public-job-request.js';

export async function toJobResponse(jobStore, job, { executor = null } = {}) {
  const storage = toPublicStorage(await jobStore.describeStorage(job.id));
  const status = String(job.status || '').toLowerCase();
  const cancellationSupported = status === 'queued'
    || (status === 'running' && typeof executor?.cancelRunningJob === 'function');
  const executionContract = getAfExecutionJobContract(job.type);

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    retried_from_job_id: job.retried_from_job_id || null,
    request: toPublicJobRequest(job.request),
    diagnostics: job.diagnostics,
    artifacts: redactPublicPathValues(job.artifacts),
    manifest: redactPublicPathValues(job.manifest),
    result: redactPublicPathValues(job.result),
    status_history: job.status_history,
    storage,
    execution: executionContract
      ? {
          ...executionContract,
          ...buildAfExecutionStateDescriptor(job.status),
        }
      : null,
    capabilities: {
      cancellation_supported: cancellationSupported,
      retry_supported: status === 'failed' || status === 'cancelled',
    },
    links: {
      self: `/jobs/${job.id}`,
      artifacts: `/jobs/${job.id}/artifacts`,
      cancel: `/jobs/${job.id}/cancel`,
      retry: `/jobs/${job.id}/retry`,
    },
  };
}
