// Runtime model measurements establish a link only while the corresponding
// annotation still exists in the final SVG. Legacy links retain their contract.
function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map((match) => [match[1], match[3]]));
}

function hidden(attrs) {
  return attrs.display === 'none' || attrs.visibility === 'hidden' || Number(attrs.opacity) === 0
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?)\s*(?:!important\s*)?(?:;|$)/i.test(attrs.style || '');
}

function currentPlanLabel(entry, svgContent) {
  if (typeof svgContent !== 'string' || !['front', 'top', 'right'].includes(entry.view)) return false;
  const svg = svgContent.replace(/<!--[\s\S]*?-->/g, '');
  const candidates = [];
  const pattern = /<g\b([^>]*\bclass=(["'])dimensions-(front|top|right) plan-dimensions-\3\2[^>]*)>([\s\S]*?)<\/g>/g;
  for (const group of svg.matchAll(pattern)) {
    if (group[3] !== entry.view || hidden(attributes(group[1])) || /<g\b/.test(group[4])) continue;
    for (const text of group[4].matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
      const attrs = attributes(text[1]);
      if (attrs['data-dim-id'] !== entry.dim_id || hidden(attrs)) continue;
      const numeric = entry.style === 'linear' ? /^\d+(?:\.\d+)?$/ : /^[⌀Ø]\d+(?:\.\d+)?$/;
      if (!numeric.test(text[2].trim())) continue;
      candidates.push(Number(text[2].trim().replace(/^[⌀Ø]/, '')));
    }
  }
  return candidates.length === 1 && Math.abs(candidates[0] - entry.value_mm) <= 1e-6;
}

export function currentTraceability(traceability, dimensionMap, svgContent, autoRepresentations) {
  if (!traceability || !Array.isArray(traceability.links)) return traceability;
  const plan = Array.isArray(dimensionMap?.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  const links = traceability.links.map((link) => {
    if (link?.source !== 'freecad_runtime') return link;
    const entries = plan.filter((entry) => entry.dim_id === link.dim_id);
    const entry = entries.length === 1 ? entries[0] : null;
    const representation = entry && autoRepresentations.get(entry);
    const value = link.evidence?.model_value_mm;
    const consistent = entry && typeof value === 'number' && Number.isFinite(value)
      && typeof entry.value_mm === 'number' && Number.isFinite(entry.value_mm)
      && Math.abs(entry.value_mm - value) <= 1e-6;
    const present = consistent && (representation
      ? representation.svg_element_id === link.svg_element_id && representation.auto_dim_id === link.represented_by
      : entry.rendered === true && link.represented_by === entry.dim_id && currentPlanLabel(entry, svgContent));
    return present ? link : { ...link, feature_id: null, reason: 'final_svg_evidence_missing_or_changed' };
  });
  return { ...traceability, links };
}
