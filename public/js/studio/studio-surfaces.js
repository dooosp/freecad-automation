const STUDIO_SURFACES = Object.freeze([
  Object.freeze({
    route: 'start',
    label: 'Console',
    summary: 'Review-first launchpad for ingest, packs, compare, and reopen actions.',
    labelI18nKey: 'studio.nav.start.label',
    summaryI18nKey: 'studio.nav.start.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'review',
    label: 'Review',
    summary: 'Hotspots, quality linkage, recommended actions, and readiness signals.',
    labelI18nKey: 'studio.nav.review.label',
    summaryI18nKey: 'studio.nav.review.copy',
    supportsSelectedJob: true,
  }),
  Object.freeze({
    route: 'artifacts',
    label: 'Packs',
    summary: 'Review packs, readiness packages, compare baselines, exports, and reopen actions.',
    labelI18nKey: 'studio.nav.artifacts.label',
    summaryI18nKey: 'studio.nav.artifacts.copy',
    supportsSelectedJob: true,
  }),
  Object.freeze({
    route: 'model',
    label: 'Model',
    summary: 'Optional prep lane for configs and geometry previews before review.',
    labelI18nKey: 'studio.nav.model.label',
    summaryI18nKey: 'studio.nav.model.copy',
    supportsSelectedJob: false,
  }),
  Object.freeze({
    route: 'drawing',
    label: 'Drawing',
    summary: 'Optional sheet-prep lane when a review needs drawing output.',
    labelI18nKey: 'studio.nav.drawing.label',
    summaryI18nKey: 'studio.nav.drawing.copy',
    supportsSelectedJob: false,
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
