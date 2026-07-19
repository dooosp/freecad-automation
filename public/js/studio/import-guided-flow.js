const IMPORT_GUIDED_STEP_IDS = Object.freeze([
  'select_file',
  'diagnostics',
  'confirm',
  'running',
  'result',
]);

export const STUDIO_IMPORT_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024;
export const STUDIO_IMPORT_UPLOAD_LIMIT_LABEL = '32 MiB';

export function formatImportUploadSize(value = 0) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  const mebibytes = bytes / (1024 * 1024);
  return `${(Math.ceil(mebibytes * 10) / 10).toFixed(1)} MiB`;
}

export function validateImportUploadFile(file = null) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size < 0) {
    return {
      ok: false,
      sizeLabel: formatImportUploadSize(size),
      limitLabel: STUDIO_IMPORT_UPLOAD_LIMIT_LABEL,
    };
  }
  return {
    ok: size <= STUDIO_IMPORT_UPLOAD_LIMIT_BYTES,
    sizeLabel: formatImportUploadSize(size),
    limitLabel: STUDIO_IMPORT_UPLOAD_LIMIT_LABEL,
  };
}

function normalizeStep(step = '') {
  return IMPORT_GUIDED_STEP_IDS.includes(step) ? step : 'select_file';
}

function optionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clearImportGuidedErrorState(flow) {
  flow.error = '';
  delete flow.errorKey;
  delete flow.errorParams;
  return flow;
}

export function ensureImportGuidedFlowState(importBootstrap = {}) {
  const hasCurrent = importBootstrap.guidedFlow && typeof importBootstrap.guidedFlow === 'object';
  const current = hasCurrent ? importBootstrap.guidedFlow : {};
  const initialStep = importBootstrap.lastJobId
    ? 'result'
    : importBootstrap.preview
      ? 'confirm'
      : 'select_file';

  current.step = normalizeStep(hasCurrent ? current.step : initialStep);
  current.error = typeof current.error === 'string' ? current.error : '';
  if (current.errorKey !== undefined && typeof current.errorKey !== 'string') {
    delete current.errorKey;
  }
  if (
    current.errorParams !== undefined
    && (!current.errorParams || typeof current.errorParams !== 'object' || Array.isArray(current.errorParams))
  ) {
    delete current.errorParams;
  }
  importBootstrap.guidedFlow = current;
  return current;
}

export function setImportGuidedError(importBootstrap = {}, {
  message = '',
  key = '',
  params = {},
} = {}) {
  const flow = ensureImportGuidedFlowState(importBootstrap);
  clearImportGuidedErrorState(flow);
  if (typeof key === 'string' && key) {
    flow.errorKey = key;
    flow.errorParams = params && typeof params === 'object' && !Array.isArray(params)
      ? { ...params }
      : {};
  } else if (typeof message === 'string') {
    flow.error = message;
  }
  return flow;
}

export function resolveImportGuidedError(importBootstrap = {}, translate = (key) => key) {
  const flow = ensureImportGuidedFlowState(importBootstrap);
  if (flow.errorKey) {
    return translate(flow.errorKey, flow.errorParams || {});
  }
  return flow.error;
}

export function resolveImportGuidedStep(importBootstrap = {}) {
  const flow = ensureImportGuidedFlowState(importBootstrap);
  if (importBootstrap.submitting === true) return 'running';
  if (importBootstrap.status === 'loading') return 'diagnostics';
  if (importBootstrap.lastJobId && flow.step !== 'select_file') return 'result';
  if (importBootstrap.preview && flow.step === 'diagnostics') return 'confirm';
  return flow.step;
}

export function setImportGuidedStep(importBootstrap = {}, step = 'select_file', {
  clearError = true,
} = {}) {
  const flow = ensureImportGuidedFlowState(importBootstrap);
  flow.step = normalizeStep(step);
  if (clearError) clearImportGuidedErrorState(flow);
  return flow;
}

export function resetImportGuidedFlow(importBootstrap = {}) {
  const flow = ensureImportGuidedFlowState(importBootstrap);
  flow.step = 'select_file';
  clearImportGuidedErrorState(flow);
  importBootstrap.preview = null;
  importBootstrap.status = 'idle';
  importBootstrap.errorMessage = '';
  importBootstrap.submitting = false;
  importBootstrap.lastJobId = '';
  importBootstrap.reviewJob = null;
  importBootstrap.corrections = {};
  return flow;
}

export function createImportGuidedStepStates(importBootstrap = {}) {
  const current = resolveImportGuidedStep(importBootstrap);
  const currentIndex = IMPORT_GUIDED_STEP_IDS.indexOf(current);
  return IMPORT_GUIDED_STEP_IDS.map((id, index) => ({
    id,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

export function buildImportBootstrapRequestBody(importBootstrap = {}, {
  modelUpload = null,
} = {}) {
  const payload = {};
  const modelPath = optionalString(importBootstrap.modelPath);

  if (modelUpload && typeof modelUpload === 'object') payload.model_upload = modelUpload;
  else if (modelPath) payload.model_path = modelPath;

  [
    ['bom_path', importBootstrap.bomPath],
    ['inspection_path', importBootstrap.inspectionPath],
    ['quality_path', importBootstrap.qualityPath],
  ].forEach(([key, value]) => {
    const normalized = optionalString(value);
    if (normalized) payload[key] = normalized;
  });

  return payload;
}

export const IMPORT_GUIDED_STEPS = IMPORT_GUIDED_STEP_IDS;
