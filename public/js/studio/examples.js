function normalizeExampleValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getStudioExampleValue(example = {}) {
  return normalizeExampleValue(example.id) || normalizeExampleValue(example.name);
}

export function findStudioExampleById(items = [], selectedId = '') {
  const normalizedId = normalizeExampleValue(selectedId);
  if (!normalizedId) return null;
  return items.find((example) => getStudioExampleValue(example) === normalizedId) || null;
}

export function resolveSelectedStudioExampleId(items = [], selectedId = '') {
  const selected = findStudioExampleById(items, selectedId);
  if (selected) return getStudioExampleValue(selected);
  return getStudioExampleValue(items[0]);
}

export function getSelectedStudioExample(examplesState = {}) {
  const items = Array.isArray(examplesState.items) ? examplesState.items : [];
  return findStudioExampleById(items, examplesState.selectedId) || items[0] || null;
}
