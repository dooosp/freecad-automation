const DRAWING_SEMANTIC_ALIASES = Object.freeze({
  HOLE_DIA: Object.freeze(['hole dia', 'hole diameter', 'diameter', 'dia', 'ø']),
  MOUNTING_HOLE_DIA: Object.freeze(['mounting hole dia', 'mounting hole diameter', 'hole dia', 'ø']),
  BASE_PLATE_ENVELOPE: Object.freeze(['base plate envelope', 'overall size', 'length width', 'l x w']),
  MATERIAL: Object.freeze(['material', 'matl']),
  GENERAL_TOLERANCE: Object.freeze(['general tolerance', 'tolerance', 'tol']),
});

export function normalizeSemanticToken(value = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).toLowerCase().replace(/[^a-z0-9ø]+/g, '');
}

export function aliasesForSemanticId(id) {
  const semanticId = typeof id === 'string' || typeof id === 'number'
    ? String(id).trim()
    : '';
  const explicitAliases = DRAWING_SEMANTIC_ALIASES[semanticId.toUpperCase()] || [];
  return [...new Set([semanticId, ...explicitAliases]
    .map((value) => normalizeSemanticToken(value))
    .filter(Boolean))];
}
