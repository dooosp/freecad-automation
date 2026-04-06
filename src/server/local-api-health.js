import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';

export function buildHealthPayload({
  jobsDir,
  runtimeDiagnostics = buildRuntimeDiagnostics(),
}) {
  return {
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    jobs_dir: jobsDir,
    runtime: runtimeDiagnostics,
  };
}
