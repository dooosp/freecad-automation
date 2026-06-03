import { relative, resolve, sep } from 'node:path';

export const RUNTIME_SMOKE_HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

export function normalizeSmokeRunId(rawValue = '') {
  const normalized = String(rawValue || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('..')
  ) {
    throw new Error(`Unsafe smoke run id: ${rawValue || '(empty)'}`);
  }

  return normalized;
}

export function resolveSmokeOutputDir(projectRoot, rawRunId) {
  const runId = normalizeSmokeRunId(rawRunId);
  const smokeRoot = resolve(projectRoot, 'output', 'smoke');
  const outputDir = resolve(smokeRoot, runId);
  const relativeOutput = relative(smokeRoot, outputDir).split(sep).join('/');
  if (!relativeOutput || relativeOutput.startsWith('..') || relativeOutput.includes('/..')) {
    throw new Error(`Unsafe smoke run id: ${rawRunId || '(empty)'}`);
  }
  return outputDir;
}

export function buildRuntimeSmokeBoundary() {
  return {
    artifact_class: 'runtime_smoke_ci_metadata',
    inspection_evidence_status: 'not_inspection_evidence',
    readiness_effect: 'no_readiness_change',
    release_artifact_status: 'not_release_artifact',
    package_artifact_status: 'not_package_artifact',
    hard_evidence_rule: RUNTIME_SMOKE_HARD_EVIDENCE_RULE,
  };
}
