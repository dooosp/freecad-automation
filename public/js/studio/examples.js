function normalizeExampleValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const VERIFIED_BRACKET_EXAMPLE_ID = 'quality_pass_bracket';

// These configs have checked-in canonical example packages. Their inclusion
// describes useful starter geometry, not a quality decision for a new run.
const RECOMMENDED_STUDIO_EXAMPLES = Object.freeze([
  { id: VERIFIED_BRACKET_EXAMPLE_ID, labelKey: 'studio.examples.bracket.label', descriptionKey: 'studio.examples.bracket.description' },
  { id: 'hinge_block', labelKey: 'studio.examples.hinge.label', descriptionKey: 'studio.examples.hinge.description' },
]);

export function getRecommendedStudioExamples(items = []) {
  const examples = Array.isArray(items) ? items : [];
  return RECOMMENDED_STUDIO_EXAMPLES.flatMap((recommendation) => {
    const example = findStudioExampleById(examples, recommendation.id);
    return example ? [{ ...recommendation, example }] : [];
  });
}

export function getSelectedRecommendedStudioExample(examplesState = {}) {
  const recommended = getRecommendedStudioExamples(examplesState.items);
  return recommended.find((entry) => entry.id === examplesState.selectedId) || recommended[0] || null;
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
