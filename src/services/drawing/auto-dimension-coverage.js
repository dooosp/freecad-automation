// Extent annotation coverage only; this does not establish model-feature
// traceability. Local features (webs, holes, thicknesses, chain segments) need
// their own anchors and must not inherit coverage from equal-valued extents.
const EXTENT_CATEGORIES = {
  base_length: { front: 'overall_width', top: 'overall_width' },
  base_width: { top: 'overall_height', right: 'overall_width' },
  overall_height: { front: 'overall_height', right: 'overall_height' },
};

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map((match) => [match[1], match[3]]));
}

function sameValue(a, b) {
  // Dedupe's 0.5 mm layout tolerance is too loose to prove coverage.
  return typeof a === 'number' && Number.isFinite(a)
    && typeof b === 'number' && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
}

function isHidden(attrs) {
  return attrs.display === 'none' || attrs.visibility === 'hidden' || attrs.opacity === '0'
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?)\s*(?:!important\s*)?(?:;|$)/i.test(attrs.style || '');
}

function extentLabels(svgContent) {
  if (typeof svgContent !== 'string') return new Map();
  const svg = svgContent.replace(/<!--[\s\S]*?-->/g, '');
  const idCounts = new Map();
  for (const tag of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const id = attributes(tag[0]).id;
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  const labels = new Map();
  // This is deliberately limited to the generator's flat automatic dimension
  // groups. Unknown SVG structures cannot supply positive coverage evidence.
  for (const group of svg.matchAll(/<g\b([^>]*\bclass=(["'])dimensions-(front|top|right)\2[^>]*)>([\s\S]*?)<\/g>/g)) {
    if (isHidden(attributes(group[1])) || /<g\b/.test(group[4])) continue;
    for (const text of group[4].matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
      const attrs = attributes(text[1]);
      if (!attrs.id || idCounts.get(attrs.id) !== 1 || isHidden(attrs)) continue;
      const value = text[2].trim();
      if (!/^\d+(?:\.\d+)?$/.test(value)) continue;
      const transform = (attrs.transform || '').trim();
      const category = !transform ? 'overall_width'
        : /^rotate\(\s*-90\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\)$/.test(transform) ? 'overall_height' : null;
      if (category) labels.set(attrs.id, { view: group[3], category, value: Number(value) });
    }
  }
  return labels;
}

export function resolveAutoDimensionCoverage(dimensionMap, svgContent) {
  const represented = new Map();
  const labels = extentLabels(svgContent);
  const autoDimensions = Array.isArray(dimensionMap?.auto_dimensions) ? dimensionMap.auto_dimensions : [];
  const planDimensions = Array.isArray(dimensionMap?.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  for (const entry of planDimensions) {
    const match = entry?.dedupe_match;
    const category = EXTENT_CATEGORIES[entry?.feature]?.[entry?.view];
    if (!category || entry.style !== 'linear' || entry.status !== 'skipped_duplicate'
        || entry.reason !== 'already_in_auto_dims' || match?.policy !== 'smart'
        || match.source !== 'auto_dimensions' || match.auto_category !== category
        || match.bucket !== (category === 'overall_width' ? 'linear_h' : 'linear_v')) continue;
    const candidates = autoDimensions.filter((auto) => auto?.dim_id === match.auto_dim_id);
    if (candidates.length !== 1) continue;
    const auto = candidates[0];
    const label = labels.get(auto.svg_element_id);
    if (auto.source !== 'auto' || auto.status !== 'rendered' || auto.rendered === false
        || auto.view !== entry.view || auto.category !== category
        || !auto.svg_element_id || auto.svg_element_id !== auto.dim_id
        || auto.drawing_object_id !== `svg:dimensions-${entry.view}:${auto.dim_id}`
        || !label || label.view !== entry.view || label.category !== category
        || !sameValue(entry.value_mm, auto.value_mm)
        || !sameValue(entry.value_mm, match.auto_value_mm)
        || !sameValue(entry.value_mm, label.value)) continue;
    represented.set(entry, {
      dim_id: entry.dim_id, auto_dim_id: auto.dim_id, feature: entry.feature,
      view: entry.view, category, value_mm: entry.value_mm,
      svg_element_id: auto.svg_element_id, evidence: 'current_svg_auto_extent',
    });
  }
  return represented;
}
