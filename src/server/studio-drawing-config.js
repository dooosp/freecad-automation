import {
  ensureDrawingViews,
  ensureDrawSchema,
} from '../orchestration/drawing-prep.js';

export const DEFAULT_STUDIO_DRAWING_VIEWS = ['front', 'top', 'right', 'iso'];
export const DEFAULT_STUDIO_DRAWING_SCALE = 'auto';

export function normalizeStudioDrawingSettings(settings = {}, config = {}) {
  const configViews = Array.isArray(config.drawing?.views) && config.drawing.views.length > 0
    ? config.drawing.views
    : DEFAULT_STUDIO_DRAWING_VIEWS;
  const requestedViews = Array.isArray(settings.views) && settings.views.length > 0
    ? settings.views
    : configViews;
  const views = [...new Set(requestedViews.map((entry) => String(entry || '').trim()).filter(Boolean))];
  return {
    views: views.length > 0 ? views : [...DEFAULT_STUDIO_DRAWING_VIEWS],
    scale: String(settings.scale || config.drawing?.scale || DEFAULT_STUDIO_DRAWING_SCALE).trim() || DEFAULT_STUDIO_DRAWING_SCALE,
    section_assist: settings.section_assist === true,
    detail_assist: settings.detail_assist === true,
  };
}

export function applyStudioDrawingSettings(config, settings) {
  ensureDrawSchema(config);
  config.drawing.views = [...settings.views];
  config.drawing.scale = settings.scale;
  config.drawing.bom_csv = true;

  if (settings.section_assist && !config.drawing.section) {
    config.drawing.section = {
      plane: 'XZ',
      offset: 0,
    };
  }

  if (settings.detail_assist && !config.drawing.detail) {
    config.drawing.detail = {
      center: [0, 0],
      radius: 10,
      source_view: 'front',
      scale_factor: 3,
      label: 'Z',
    };
  }

  ensureDrawingViews(config, settings.views);
}
