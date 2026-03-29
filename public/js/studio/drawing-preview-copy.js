function previewReference(preview = {}) {
  return preview.preview_reference || preview.id || '';
}

function editablePlanReference(preview = {}) {
  return preview.editable_plan_reference || '';
}

function formatPreviewTimestamp(timestamp = '') {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return '';
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '';

  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function previewEditLoopLabel(preview = {}) {
  return preview.editable_plan_available
    ? 'Editable preview available'
    : 'Editable preview unavailable';
}

function previewFactItems(preview = {}, fallbackSettings = {}) {
  const items = [];
  const scale = preview.scale || fallbackSettings.scale || 'auto';
  const reference = previewReference(preview);
  const editLoopReference = editablePlanReference(preview);
  const updatedAt = formatPreviewTimestamp(preview.drawn_at);
  const bomCount = Array.isArray(preview.bom) ? preview.bom.length : 0;
  const dimensionCount = Array.isArray(preview.dimensions) ? preview.dimensions.length : 0;

  items.push(['Scale', scale]);
  if (preview.id) items.push(['Preview ID', preview.id]);
  if (reference) items.push(['Preview reference', reference]);
  if (editLoopReference) items.push(['Edit loop source', editLoopReference]);
  items.push(['Edit loop', previewEditLoopLabel(preview)]);
  if (updatedAt) items.push(['Updated', updatedAt]);
  items.push(['BOM lines', String(bomCount)]);
  items.push(['Editable dimensions', String(dimensionCount)]);

  return items;
}

function factLine(items = []) {
  return items
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join(' • ');
}

export { previewReference };

export function buildDrawingPreviewResultSummary(preview = {}, fallbackSettings = {}) {
  return factLine(previewFactItems(preview, fallbackSettings));
}

export function buildDrawingPreviewReadySummary(preview = {}, fallbackSettings = {}) {
  const reference = previewReference(preview);
  const editLoopReference = editablePlanReference(preview);
  const updatedAt = formatPreviewTimestamp(preview.drawn_at);
  const line = factLine([
    ['Preview', 'Ready'],
    ...(reference ? [['Preview reference', reference]] : []),
    ...(editLoopReference ? [['Edit loop source', editLoopReference]] : []),
    ['Edit loop', previewEditLoopLabel(preview)],
    ...(updatedAt ? [['Updated', updatedAt]] : []),
  ]);

  return line || `Preview ready at ${preview.scale || fallbackSettings.scale || 'auto'}.`;
}

export function buildDrawingCanvasCaption(preview = {}) {
  const reference = previewReference(preview);
  const editLoopReference = editablePlanReference(preview);
  const details = [
    ...(reference ? [`Preview reference: ${reference}`] : []),
    ...(editLoopReference ? [`Edit loop source: ${editLoopReference}`] : []),
    `Edit loop: ${previewEditLoopLabel(preview)}`,
  ].join(' • ');

  return preview.editable_plan_available
    ? `Pan with drag, zoom with the mouse wheel, and click dimension text to edit this sheet. ${details}.`
    : `Pan with drag, zoom with the mouse wheel, and inspect this sheet from the dedicated Drawing workspace. ${details}.`;
}
