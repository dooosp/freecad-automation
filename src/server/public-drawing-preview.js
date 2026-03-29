import { basename, posix, win32 } from 'node:path';

const SERVER_ONLY_DRAWING_FIELDS = new Set([
  'artifacts',
  'dim_conflicts',
  'dimension_map',
  'layout_report',
  'logs',
  'plan_path',
  'repair_report',
  'run_log',
  'traceability',
]);

const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const POSIX_PATH_PATTERN = /(^|[\s>([{"'`])((?:\/[^/\s)\]}>"'`]+)+\/?)/g;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbsoluteFilesystemPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (posix.isAbsolute(value) || win32.isAbsolute(value));
}

function basenameFromAnyPath(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (win32.isAbsolute(value)) return win32.basename(value);
  return basename(value);
}

function redactPathString(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (isAbsoluteFilesystemPath(value)) {
    return basenameFromAnyPath(value) || '[hidden-path]';
  }

  const windowsRedacted = value.replace(WINDOWS_PATH_PATTERN, (match) => basenameFromAnyPath(match) || '[hidden-path]');
  return windowsRedacted.replace(POSIX_PATH_PATTERN, (match, prefix, pathValue) => {
    const replacement = basenameFromAnyPath(pathValue) || '[hidden-path]';
    return `${prefix}${replacement}`;
  });
}

function sanitizePublicValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePublicValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SERVER_ONLY_DRAWING_FIELDS.has(key))
        .map(([key, entry]) => [key, sanitizePublicValue(entry)])
    );
  }

  if (typeof value === 'string') {
    return redactPathString(value);
  }

  return value;
}

function hasData(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== '';
}

function buildPreviewToken(preview = {}) {
  if (typeof preview.id === 'string' && preview.id.trim()) {
    return redactPathString(preview.id.trim());
  }
  return 'preview';
}

function buildPreviewReference(preview = {}) {
  const fallback = buildPreviewToken(preview);
  const existing = typeof preview.preview_reference === 'string' ? redactPathString(preview.preview_reference.trim()) : '';
  return existing || `drawing-preview:${fallback}`;
}

function buildEditablePlanReference(preview = {}) {
  return preview.plan_path ? `preview-plan:${buildPreviewToken(preview)}` : '';
}

function buildArtifactCapabilities(preview = {}) {
  const artifacts = isPlainObject(preview.artifacts) ? preview.artifacts : {};
  return {
    editable_plan: Boolean(preview.plan_path),
    traceability: hasData(preview.traceability) || hasData(artifacts.traceability),
    layout_report: hasData(preview.layout_report) || hasData(artifacts.layout_report),
    repair_report: hasData(preview.repair_report) || hasData(artifacts.repair_report),
    dimension_map: hasData(preview.dimension_map) || hasData(artifacts.dimension_map),
    dimension_conflicts: hasData(preview.dim_conflicts) || hasData(artifacts.dim_conflicts),
    run_log: hasData(preview.run_log) || hasData(artifacts.run_log),
  };
}

export function toPublicDrawingPreview(preview = {}) {
  const source = isPlainObject(preview) ? preview : {};
  const dimensions = Array.isArray(source.dimensions)
    ? sanitizePublicValue(structuredClone(source.dimensions))
    : [];
  const editablePlanAvailable = Boolean(source.plan_path);
  const qaSummary = hasData(source.qa_summary)
    ? sanitizePublicValue(structuredClone(source.qa_summary))
    : null;

  return {
    id: sanitizePublicValue(source.id || ''),
    drawn_at: sanitizePublicValue(source.drawn_at || ''),
    settings: sanitizePublicValue(structuredClone(isPlainObject(source.settings) ? source.settings : {})),
    overview: sanitizePublicValue(structuredClone(isPlainObject(source.overview) ? source.overview : {})),
    validation: sanitizePublicValue(structuredClone(isPlainObject(source.validation) ? source.validation : {})),
    svg: typeof source.svg === 'string' ? redactPathString(source.svg) : '',
    bom: sanitizePublicValue(structuredClone(Array.isArray(source.bom) ? source.bom : [])),
    views: sanitizePublicValue(structuredClone(Array.isArray(source.views) ? source.views : [])),
    scale: sanitizePublicValue(source.scale || source.overview?.scale || null),
    qa_summary: qaSummary,
    annotations: sanitizePublicValue(structuredClone(Array.isArray(source.annotations) ? source.annotations : [])),
    dimensions,
    preview_reference: buildPreviewReference(source),
    editable_plan_reference: buildEditablePlanReference(source),
    editable_plan_available: editablePlanAvailable,
    dimension_editing_available: editablePlanAvailable && dimensions.length > 0,
    tracked_draw_bridge_available: editablePlanAvailable,
    artifact_capabilities: buildArtifactCapabilities(source),
  };
}

export function toPublicDrawingPreviewPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const next = {};

  if (hasData(source.update)) {
    next.update = sanitizePublicValue(structuredClone(source.update));
  }
  if (source.preview !== undefined) {
    next.preview = toPublicDrawingPreview(source.preview);
  }

  return next;
}
