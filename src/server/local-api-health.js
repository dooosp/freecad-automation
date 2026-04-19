import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import { createPublicPathContext, sanitizePublicPayload } from './public-path-sanitizer.js';

export function buildHealthPayload({
  projectRoot = '',
  jobsDir,
  runtimeDiagnostics = buildRuntimeDiagnostics(),
}) {
  return sanitizePublicPayload({
    api_version: LOCAL_API_VERSION,
    ok: true,
    status: 'ok',
    service: LOCAL_API_SERVICE,
    jobs_dir: jobsDir,
    runtime: runtimeDiagnostics,
  }, createPublicPathContext({ projectRoot, jobsDir, runtimeDiagnostics }));
}
