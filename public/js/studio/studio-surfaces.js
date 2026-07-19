const STUDIO_SURFACES = Object.freeze([
  Object.freeze({
    route: 'start',
    label: 'Home',
    summary: 'Choose what you want to create, review, or reopen.',
    labelI18nKey: 'studio.nav.start.label',
    summaryI18nKey: 'studio.nav.start.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'history',
    label: 'Run history',
    summary: 'Return to recent models, drawings, reports, and reviews.',
    labelI18nKey: 'studio.nav.history.label',
    summaryI18nKey: 'studio.nav.history.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'artifacts',
    label: 'Result files',
    summary: 'Open generated models, drawings, reports, and supporting files.',
    labelI18nKey: 'studio.nav.artifacts.label',
    summaryI18nKey: 'studio.nav.artifacts.copy',
    supportsSelectedJob: true,
  }),
  Object.freeze({
    route: 'console',
    label: 'Review intake tools',
    summary: 'Existing import, comparison, package, and runtime controls.',
    labelI18nKey: 'studio.nav.console.label',
    summaryI18nKey: 'studio.nav.console.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'model',
    label: 'Model editing',
    summary: 'Edit configurations, previews, exports, and view controls.',
    labelI18nKey: 'studio.nav.model.label',
    summaryI18nKey: 'studio.nav.model.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'drawing',
    label: 'Drawing editing',
    summary: 'Prepare sheets and drawing-specific controls.',
    labelI18nKey: 'studio.nav.drawing.label',
    summaryI18nKey: 'studio.nav.drawing.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'review',
    label: 'Review and readiness',
    summary: 'Detailed evidence, inspection, readiness, and Stage 5B controls.',
    labelI18nKey: 'studio.nav.review.label',
    summaryI18nKey: 'studio.nav.review.copy',
    supportsSelectedJob: true,
  }),
]);

export const STUDIO_SURFACE_ROUTES = Object.freeze(STUDIO_SURFACES.map((surface) => surface.route));

export const STUDIO_JOB_CONTEXT_ROUTES = Object.freeze(
  STUDIO_SURFACES
    .filter((surface) => surface.supportsSelectedJob)
    .map((surface) => surface.route)
);

export function getStudioSurfaceMetadata() {
  return STUDIO_SURFACES.map((surface) => ({ ...surface }));
}
