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

function sameCenter(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && actual.length === 2 && expected.length === 2
    && actual.every((value, i) => typeof value === 'number' && Number.isFinite(value)
      && typeof expected[i] === 'number' && Number.isFinite(expected[i])
      && Math.abs(value - expected[i]) <= 1e-6);
}

function currentPlanLabel(entry, svgContent, link) {
  if (typeof svgContent !== 'string' || !['front', 'top', 'right'].includes(entry.view)) return false;
  const svg = svgContent.replace(/<!--[\s\S]*?-->/g, '');
  const candidates = [];
  const pattern = /<g\b([^>]*\bclass=(["'])dimensions-(front|top|right) plan-dimensions-\3\2[^>]*)>([\s\S]*?)<\/g>/g;
  for (const group of svg.matchAll(pattern)) {
    if (group[3] !== entry.view || hidden(attributes(group[1])) || /<g\b/.test(group[4])) continue;
    for (const text of group[4].matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
      const attrs = attributes(text[1]);
      if (attrs['data-dim-id'] !== entry.dim_id || hidden(attrs)) continue;
      if (link.evidence?.measurement === 'cylindrical_faces') {
        const center = link.evidence.center_uv;
        if (!entry.svg_element_id || attrs.id !== entry.svg_element_id
            || link.svg_element_id !== entry.svg_element_id
            || !sameCenter(entry.center_uv, center)
            || !['data-center-u', 'data-center-v'].every((key) => attrs[key]?.trim())
            || !sameCenter([Number(attrs['data-center-u']), Number(attrs['data-center-v'])], center)) continue;
      }
      const numeric = entry.style === 'linear' ? /^\d+(?:\.\d+)?$/
        : entry.style === 'radius' ? /^R\d+(?:\.\d+)?$/ : /^[⌀Ø]\d+(?:\.\d+)?$/;
      if (!numeric.test(text[2].trim())) continue;
      candidates.push(Number(text[2].trim().replace(/^[⌀ØR]/, '')));
    }
  }
  return candidates.length === 1 && Math.abs(candidates[0] - entry.value_mm) <= 1e-6;
}

export function currentTraceability(traceability, dimensionMap, svgContent, autoRepresentations) {
  if (!traceability || !Array.isArray(traceability.links)) return traceability;
  const plan = Array.isArray(dimensionMap?.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  const links = traceability.links.map((link) => {
    if (!link || typeof link !== 'object') return link;
    const standoff = link?.dim_id === 'STANDOFF_HEIGHT';
    const entries = plan.filter((entry) => entry.dim_id === link.dim_id);
    const entry = entries.length === 1 ? entries[0] : null;
    const pcb = isPcbMeasurement(entry?.runtime_binding?.measurement) || isPcbMeasurement(link.evidence?.measurement);
    const bracket = [entry?.runtime_binding, link.evidence].some((item) => item?.measurement === 'bracket_vertical_reference');
    const fillet = [entry?.runtime_binding, link.evidence].some((item) => item?.measurement === 'bracket_fillet_radius');
    if (!standoff && !pcb && !bracket && !fillet && link?.source !== 'freecad_runtime') return link;
    const representation = entry && autoRepresentations.get(entry);
    const value = link.evidence?.model_value_mm;
    const consistent = entry && typeof value === 'number' && Number.isFinite(value)
      && typeof entry.value_mm === 'number' && Number.isFinite(entry.value_mm)
      && Math.abs(entry.value_mm - value) <= 1e-6;
    const present = pcb ? validPcbLink(entry, link, svgContent)
      : bracket ? validBracketVerticalLink(entry, link, svgContent)
      : fillet ? validBracketFilletLink(entry, link, svgContent)
      : standoff ? validStandoffLink(entry, link, svgContent) : consistent && (representation
      ? representation.svg_element_id === link.svg_element_id && representation.auto_dim_id === link.represented_by
      : entry.rendered === true && link.represented_by === entry.dim_id && currentPlanLabel(entry, svgContent, link));
    return present ? link : { ...link, feature_id: null, reason: 'final_svg_evidence_missing_or_changed' };
  });
  return { ...traceability, links };
}

function sameNumber(a, b) {
  return typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)
    && Math.abs(a - b) <= 1e-6;
}

function sameVector(a, b, size) {
  return Array.isArray(a) && Array.isArray(b) && a.length === size && b.length === size
    && a.every((value, index) => sameNumber(value, b[index]));
}

export function isFrontPlateLinearRequirement(requirement) {
  return requirement?.feature === 'plate' && requirement.view === 'front'
    && requirement.dimension_type === 'linear';
}

export function runtimePlateThicknessRequirements(requirements, traceability, dimensionMap, svgContent) {
  // Only the bounded front/THK final-edge producer is supported here. The
  // canonical requirement ID need not equal its annotation ID (THK).
  const result = new Map();
  const plan = Array.isArray(dimensionMap?.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  const entries = plan.filter((entry) => entry.dim_id === 'THK');
  if (entries.length !== 1) return result;
  const entry = entries[0];
  if (entry.feature !== 'plate' || entry.view !== 'front' || entry.style !== 'linear'
      || entry.rendered !== true || entry.status !== 'rendered') return result;
  const current = currentTraceability(traceability, dimensionMap, svgContent, new Map());
  const links = (current?.links || []).filter((link) => link.dim_id === 'THK' && link.feature_id === 'plate');
  if (links.length !== 1) return result;
  const link = links[0];
  const evidence = link.evidence;
  const binding = entry.runtime_binding;
  if (link.source !== 'freecad_runtime' || link.feature_key !== 'plate' || link.rendered !== true
      || link.status !== 'rendered' || link.represented_by !== 'THK' || !evidence || !binding) return result;
  for (const item of [evidence, binding]) {
    if (item.source !== 'freecad_runtime' || item.status !== 'resolved' || item.feature_id !== 'plate'
        || item.measurement !== 'final_edge' || typeof item.model_object_id !== 'string' || !item.model_object_id
        || typeof item.edge_ref !== 'string' || !item.edge_ref.startsWith(`${item.model_object_id}:Edge`)
        || !/:Edge[1-9]\d*$/.test(item.edge_ref) || !sameNumber(item.measured_mm, entry.value_mm)) return result;
    const xyz = item.endpoints_3d_mm;
    const uv = item.endpoints_uv_mm;
    if (!Array.isArray(xyz) || xyz.length !== 2 || !Array.isArray(uv) || uv.length !== 2
        || !sameVector(xyz[0], xyz[0], 3) || !sameVector(xyz[1], xyz[1], 3)
        || !sameVector(uv[0], uv[0], 2) || !sameVector(uv[1], uv[1], 2)
        || !sameNumber(xyz[0][0], xyz[1][0]) || !sameNumber(xyz[0][1], xyz[1][1])
        || !sameNumber(xyz[1][2] - xyz[0][2], entry.value_mm)
        || !sameNumber(uv[0][0], uv[1][0]) || !sameNumber(uv[1][1] - uv[0][1], entry.value_mm)
        || !sameVector(item.bounds, [...uv[0], ...uv[1]], 4)) return result;
  }
  if (evidence.model_object_id !== binding.model_object_id || evidence.edge_ref !== binding.edge_ref
      || !sameNumber(evidence.model_value_mm, entry.value_mm)
      || !evidence.endpoints_3d_mm.every((point, i) => sameVector(point, binding.endpoints_3d_mm[i], 3))
      || !evidence.endpoints_uv_mm.every((point, i) => sameVector(point, binding.endpoints_uv_mm[i], 2))) return result;
  const matches = requirements.filter((requirement) => isFrontPlateLinearRequirement(requirement)
    && sameNumber(requirement.value_mm, entry.value_mm));
  if (matches.length === 1) result.set(matches[0].id, { requirement: matches[0], entry, link });
  return result;
}

const STANDOFF_IDS = ['standoff1', 'standoff2', 'standoff3', 'standoff4'];
const PAPER_TOLERANCE = 0.011; // SVG's 0.01 mm serialization, not manufacturing tolerance.

function standoffIds(value) {
  const ids = typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value;
  return Array.isArray(ids) && ids.length === 4 && [...ids].sort().every((id, i) => id === STANDOFF_IDS[i]);
}

function topologyRef(value, model, kind) {
  return typeof value === 'string' && value.startsWith(`${model}:${kind}`)
    && new RegExp(`:${kind}[1-9]\\d*$`).test(value);
}

function sameSet(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && new Set(a).size === a.length && [...a].sort().every((item, i) => item === [...b].sort()[i]);
}

function validStandoffEvidence(item, value) {
  if (!item || item.source !== 'freecad_runtime' || item.status !== 'resolved'
      || item.measurement !== 'standoff_cylindrical_faces' || item.axis !== 'v'
      || !standoffIds(item.feature_id) || !standoffIds(item.member_feature_ids)
      || !sameNumber(item.measured_mm, value) || value <= 0
      || typeof item.model_object_id !== 'string' || !item.model_object_id
      || item.selected_side !== 'right' || ![0, 2].includes(item.projection_group_index)
      || !Array.isArray(item.members) || !standoffIds(item.members.map((member) => member?.feature_id))) return false;
  const members = item.members;
  for (const member of members) {
    if (!sameVector(member.center_xy_mm, member.center_xy_mm, 2)
        || !sameNumber(member.radius_mm, member.radius_mm) || member.radius_mm <= 0
        || !sameVector(member.z_range_mm, member.z_range_mm, 2)
        || !sameNumber(member.height_mm, value)
        || !sameNumber(member.z_range_mm[1] - member.z_range_mm[0], value)
        || !sameVector(member.z_range_mm, members[0].z_range_mm, 2)
        || !topologyRef(member.face_ref, item.model_object_id, 'Face')
        || !topologyRef(member.lower_edge_ref, item.model_object_id, 'Edge')
        || !topologyRef(member.upper_edge_ref, item.model_object_id, 'Edge')) return false;
  }
  if (new Set(members.map((m) => m.face_ref)).size !== 4
      || new Set(members.flatMap((m) => [m.lower_edge_ref, m.upper_edge_ref])).size !== 8
      || new Set(members.map((m) => m.center_xy_mm.join(','))).size !== 4) return false;
  const representative = members.find((member) => member.feature_id === item.representative_feature_id);
  if (!representative) return false;
  const [x, y] = representative.center_xy_mm;
  const u = x + representative.radius_mm;
  const [bottom, top] = representative.z_range_mm;
  const coincident = members.filter((member) => sameNumber(member.center_xy_mm[0] + member.radius_mm, u));
  if (!sameSet(item.coincident_member_ids, coincident.map((m) => m.feature_id))
      || !item.coincident_member_ids.includes(representative.feature_id)
      || !sameNumber(y, Math.min(...coincident.map((m) => m.center_xy_mm[1])))
      || !Array.isArray(item.endpoints_3d_mm) || item.endpoints_3d_mm.length !== 2
      || !sameVector(item.endpoints_3d_mm[0], [u, y, bottom], 3)
      || !sameVector(item.endpoints_3d_mm[1], [u, y, top], 3)
      || !Array.isArray(item.endpoints_uv_mm) || item.endpoints_uv_mm.length !== 2
      || !sameVector(item.endpoints_uv_mm[0], [u, bottom], 2)
      || !sameVector(item.endpoints_uv_mm[1], [u, top], 2)
      || !sameVector(item.bounds, [u, bottom, u, top], 4)) return false;
  const page = item.page_endpoints_mm;
  return Array.isArray(page) && page.length === 2 && sameVector(page[0], page[0], 2)
    && sameVector(page[1], page[1], 2) && sameNumber(page[0][0], page[1][0]) && page[0][1] > page[1][1]
    && sameNumber(item.effective_gap_mm, item.effective_gap_mm) && item.effective_gap_mm >= 0
    && ['left', 'right'].includes(item.placement_side)
    && sameNumber(item.page_extension_gap_x_mm, item.effective_gap_mm * (item.placement_side === 'left' ? 1 : -1));
}

function sameStandoffEvidence(a, b) {
  for (const key of ['model_object_id', 'representative_feature_id', 'selected_side', 'projection_group_index', 'placement_side']) {
    if (a[key] !== b[key]) return false;
  }
  for (const key of ['endpoints_3d_mm', 'endpoints_uv_mm', 'page_endpoints_mm']) {
    if (!a[key].every((point, i) => sameVector(point, b[key][i], point.length))) return false;
  }
  if (!sameNumber(a.page_extension_gap_x_mm, b.page_extension_gap_x_mm)) return false;
  return a.members.every((member) => {
    const other = b.members.find((candidate) => candidate.feature_id === member.feature_id);
    return other && ['face_ref', 'lower_edge_ref', 'upper_edge_ref'].every((key) => member[key] === other[key])
      && sameVector(member.center_xy_mm, other.center_xy_mm, 2)
      && sameNumber(member.radius_mm, other.radius_mm) && sameVector(member.z_range_mm, other.z_range_mm, 2);
  });
}

function viewGroups(svg, expectedView = 'front', kind = 'plan') {
  const stack = [], groups = [];
  for (const token of svg.matchAll(/<\/?g\b[^>]*>/g)) {
    if (token[0].startsWith('</')) {
      const group = stack.pop();
      if (group?.plan && !group.unsafe) groups.push(svg.slice(group.start, token.index));
      continue;
    }
    const attrs = attributes(token[0]);
    const parent = stack.at(-1);
    const view = attrs['data-view-id'] || attrs.id?.replace(/^drawing-view-/, '') || parent?.view;
    const classes = (attrs.class || '').split(/\s+/);
    stack.push({ start: token.index + token[0].length, view,
      unsafe: Boolean(parent?.unsafe || hidden(attrs) || attrs.transform || /transform\s*:/i.test(attrs.style || '')),
      plan: view === expectedView && (kind === 'geometry'
        ? classes.some((name) => ['hard_visible', 'outer_visible', 'smooth_visible'].includes(name))
        : classes.includes(`dimensions-${expectedView}`) && classes.includes(`plan-dimensions-${expectedView}`)) });
  }
  return groups.filter((body) => !/<g\b/.test(body));
}

function currentStandoffGeometry(svgContent, binding) {
  if (typeof svgContent !== 'string') return false;
  const svg = svgContent.replace(/<!--[\s\S]*?-->/g, '');
  if ([...svg.matchAll(/<text\b([^>]*)>/g)].filter((m) => attributes(m[1])['data-dim-id'] === 'STANDOFF_HEIGHT').length !== 1) return false;
  const candidates = viewGroups(svg).filter((body) => /data-dim-id=["']STANDOFF_HEIGHT["']/.test(body));
  if (candidates.length !== 1) return false;
  const lines = [...candidates[0].matchAll(/<line\b([^>]*)\/?\s*>/g)].map((m) => attributes(m[1]))
    .filter((attrs) => attrs['data-dim-id'] === 'STANDOFF_HEIGHT');
  if (lines.some((attrs) => hidden(attrs) || attrs.transform || /transform\s*:/i.test(attrs.style || ''))) return false;
  const dimensions = lines.filter((attrs) => attrs['data-dimension-line'] === 'linear');
  const extensions = lines.filter((attrs) => attrs['data-dimension-extension'] === 'linear');
  if (dimensions.length !== 1 || extensions.length !== 2) return false;
  const near = (actual, expected) => typeof actual === 'string' && actual.trim() !== ''
    && Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= PAPER_TOLERANCE;
  const [bottom, top] = binding.page_endpoints_mm;
  const line = dimensions[0];
  const scale = (bottom[1] - top[1]) / binding.measured_mm;
  if (line['data-axis'] !== 'v' || !near(line.x1, Number(line.x2))
      || !near(line.y1, top[1]) || !near(line.y2, bottom[1])
      || !near(line['data-reference-y1'], top[1]) || !near(line['data-reference-y2'], bottom[1])
      || !sameNumber(Number(line['data-scale']), scale)) return false;
  if (!sameSet(extensions.map((attrs) => attrs['data-endpoint-index']), ['0', '1'])) return false;
  return extensions.every((extension) => {
    const point = binding.page_endpoints_mm[Number(extension['data-endpoint-index'])];
    return near(extension['data-reference-x'], point[0]) && near(extension['data-reference-y'], point[1])
      && near(extension['data-gap-x'], binding.page_extension_gap_x_mm)
      && near(extension.x1, point[0] + binding.page_extension_gap_x_mm)
      && near(extension.y1, point[1]) && near(extension.y2, point[1])
      && Number.isFinite(Number(extension.x2))
      && Number(line.x1) >= Math.min(Number(extension.x1), Number(extension.x2)) - PAPER_TOLERANCE
      && Number(line.x1) <= Math.max(Number(extension.x1), Number(extension.x2)) + PAPER_TOLERANCE;
  });
}

function validStandoffLink(entry, link, svgContent) {
  if (!entry || entry.feature == null || !standoffIds(entry.feature) || entry.view !== 'front'
      || entry.style !== 'linear' || entry.rendered !== true || entry.status !== 'rendered'
      || link.source !== 'freecad_runtime' || !standoffIds(link.feature_id) || !standoffIds(link.feature_key)
      || link.rendered !== true || link.status !== 'rendered' || link.represented_by !== 'STANDOFF_HEIGHT'
      || !validStandoffEvidence(entry.runtime_binding, entry.value_mm)
      || !validStandoffEvidence(link.evidence, entry.value_mm)
      || !sameNumber(link.evidence.model_value_mm, entry.value_mm)
      || !sameStandoffEvidence(entry.runtime_binding, link.evidence)) return false;
  return currentPlanLabel(entry, svgContent, link) && currentStandoffGeometry(svgContent, entry.runtime_binding);
}

export function isStandoffHeightRequirement(requirement) {
  return requirement?.id === 'STANDOFF_HEIGHT';
}

export function runtimeStandoffHeightRequirements(requirements, traceability, dimensionMap, svgContent) {
  const result = new Map();
  const entries = (dimensionMap?.plan_dimensions || []).filter((entry) => entry.dim_id === 'STANDOFF_HEIGHT');
  const links = currentTraceability(traceability, dimensionMap, svgContent, new Map())?.links || [];
  const candidates = links.filter((link) => link.dim_id === 'STANDOFF_HEIGHT' && standoffIds(link.feature_id));
  if (entries.length !== 1 || candidates.length !== 1) return result;
  const matches = requirements.filter((requirement) => isStandoffHeightRequirement(requirement)
    && requirement.view === 'front' && requirement.dimension_type === 'linear' && standoffIds(requirement.feature)
    && sameNumber(requirement.value_mm, entries[0].value_mm));
  if (matches.length === 1) result.set(matches[0].id, { requirement: matches[0], entry: entries[0], link: candidates[0] });
  return result;
}

const PCB_KINDS = {
  plate_length: ['PLATE_LENGTH', 'plate', 'u'],
  plate_width: ['PLATE_WIDTH', 'plate', 'v'],
  hole_diameter: ['MOUNTING_HOLE_DIA', 'holes', null],
  hole_pitch_x: ['MOUNTING_HOLE_PATTERN_X', 'holes', 'u'],
  hole_pitch_y: ['MOUNTING_HOLE_PATTERN_Y', 'holes', 'v'],
  slot_length: ['CONNECTOR_SLOT_SIZE', 'slot', 'u'],
  slot_width: ['CONNECTOR_SLOT_WIDTH', 'slot', 'v'],
  slot_position_y: ['CONNECTOR_SLOT_POSITION', 'slot', 'v'],
};
const HOLE_IDS = ['hole1', 'hole2', 'hole3', 'hole4'];

function isPcbMeasurement(value) {
  return value === 'pcb_linear_reference' || value === 'pcb_hole_diameter';
}

export function isPcbDimensionRequirement(requirement) {
  return Object.values(PCB_KINDS).some(([id]) => id === requirement?.id);
}

export function hasPcbRuntimeContext(intent, dimensionMap, traceability) {
  return intent?.part_type === 'plate_with_holes'
    || (Array.isArray(dimensionMap?.plan_dimensions) && dimensionMap.plan_dimensions.some((d) => isPcbMeasurement(d.runtime_binding?.measurement)))
    || (Array.isArray(traceability?.links) && traceability.links.some((d) => isPcbMeasurement(d.evidence?.measurement)));
}

function holeIds(value) {
  const ids = typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value;
  return sameSet(ids, HOLE_IDS);
}

function validBounds(bounds) {
  return sameVector(bounds, bounds, 6) && [0, 1, 2].every((axis) => bounds[axis + 3] > bounds[axis]);
}

function validPcbSlotRelief(item) {
  const { slot_bounds_mm: slot, slot_opening_bounds_mm: opening, slot_relief_radius_mm: r,
    slot_relief_face_refs: faces } = item;
  if (opening === undefined && r === undefined && faces === undefined) return true;
  return Number.isFinite(r) && r > 0 && 4 * r < slot[4] - slot[1]
    && sameVector(opening, [slot[0] - r, slot[1], slot[2], slot[3] + r, slot[4], slot[5]], 6)
    && Array.isArray(faces) && faces.length === 4 && new Set(faces).size === 4
    && faces.every((ref) => topologyRef(ref, item.model_object_id, 'Face') && !item.slot_wall_refs.includes(ref));
}

function validPcbHoles(item) {
  if (!holeIds(item.feature_id) || !holeIds(item.member_feature_ids) || !validBounds(item.plate_bounds_mm)
      || !Array.isArray(item.members) || !holeIds(item.members.map((member) => member?.feature_id))) return false;
  const plate = item.plate_bounds_mm;
  for (const member of item.members) {
    if (!sameVector(member.center_xy_mm, member.center_xy_mm, 2) || !(member.radius_mm > 0)
        || !sameNumber(member.radius_mm, item.members[0].radius_mm)
        || !sameVector(member.z_range_mm, [plate[2], plate[5]], 2)
        || !sameNumber(member.height_mm, plate[5] - plate[2])
        || member.surface_role !== 'inward_hole' || !sameVector(member.axis, [0, 0, 1], 3)
        || !sameVector(member.circle_uv_mm, [...member.center_xy_mm, member.radius_mm], 3)
        || !topologyRef(member.face_ref, item.model_object_id, 'Face')
        || !topologyRef(member.lower_edge_ref, item.model_object_id, 'Edge')
        || !topologyRef(member.upper_edge_ref, item.model_object_id, 'Edge')) return false;
    const expectedArea = 2 * Math.PI * member.radius_mm * member.height_mm;
    if (!Number.isFinite(member.area_mm2) || Math.abs(member.area_mm2 - expectedArea) > Math.max(1e-6, expectedArea * 1e-6)
        || !member.center_xy_mm.every((coordinate, axis) => coordinate - member.radius_mm > plate[axis]
          && coordinate + member.radius_mm < plate[axis + 3])) return false;
  }
  return new Set(item.members.map((m) => m.face_ref)).size === 4
    && new Set(item.members.flatMap((m) => [m.lower_edge_ref, m.upper_edge_ref])).size === 8
    && new Set(item.members.map((m) => m.center_xy_mm.join(','))).size === 4;
}

function validPcbLinear(item, value) {
  const kind = PCB_KINDS[item.dimension_kind];
  const axis = item.axis === 'u' ? 0 : 1;
  const points = item.endpoints_3d_mm, uv = item.endpoints_uv_mm, page = item.page_endpoints_mm;
  if (!kind || item.axis !== kind[2] || !['u', 'v'].includes(item.axis)
      || !Array.isArray(points) || points.length !== 2 || !points.every((p) => sameVector(p, p, 3))
      || !Array.isArray(uv) || uv.length !== 2 || !uv.every((p, i) => sameVector(p, points[i].slice(0, 2), 2))
      || !sameNumber(points[1][axis] - points[0][axis], value)
      || !sameNumber(points[0][1 - axis], points[1][1 - axis]) || !sameNumber(points[0][2], points[1][2])
      || !sameVector(item.bounds, [Math.min(uv[0][0], uv[1][0]), Math.min(uv[0][1], uv[1][1]),
        Math.max(uv[0][0], uv[1][0]), Math.max(uv[0][1], uv[1][1])], 4)
      || !Array.isArray(page) || page.length !== 2 || !page.every((p) => sameVector(p, p, 2))
      || !sameNumber(page[0][1 - axis], page[1][1 - axis])
      || (axis === 0 ? page[1][0] <= page[0][0] : page[0][1] <= page[1][1])
      || !Number.isFinite(item.effective_gap_mm) || item.effective_gap_mm < 0
      || !Array.isArray(item.reference_refs) || item.reference_refs.length !== 2
      || !item.reference_refs.every((ref) => topologyRef(ref.geometry_ref, item.model_object_id, 'Edge')
        && ['edge_endpoint', 'circle_center', 'edge_point'].includes(ref.kind))) return false;
  const sides = axis === 0 ? ['top', 'bottom'] : ['left', 'right'];
  const gap = item[axis === 0 ? 'page_extension_gap_y_mm' : 'page_extension_gap_x_mm'];
  const sign = ['bottom', 'left'].includes(item.placement_side) ? 1 : -1;
  if (!sides.includes(item.placement_side) || !sameNumber(gap, sign * item.effective_gap_mm)) return false;
  if (item.dimension_kind.startsWith('plate_')) {
    const box = item.plate_bounds_mm;
    return item.feature_id === 'plate' && validBounds(box)
      && sameNumber(points[0][axis], box[axis]) && sameNumber(points[1][axis], box[axis + 3])
      && sameNumber(points[0][2], box[5])
      && [box[1 - axis], box[4 - axis]].some((edge) => sameNumber(points[0][1 - axis], edge))
      && item.reference_refs.every((ref) => ref.feature_id === 'plate' && ref.kind === 'edge_endpoint');
  }
  if (item.dimension_kind.startsWith('hole_pitch_')) {
    if (!validPcbHoles(item) || !Array.isArray(item.verification_pairs_3d_mm)
        || item.verification_pairs_3d_mm.length !== 2) return false;
    const used = [];
    for (const pair of item.verification_pairs_3d_mm) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((p) => sameVector(p, p, 3))
          || !sameNumber(pair[1][axis] - pair[0][axis], value)
          || !sameNumber(pair[0][1 - axis], pair[1][1 - axis])) return false;
      for (const point of pair) {
        const matches = item.members.filter((m) => sameVector(point, [...m.center_xy_mm, m.z_range_mm[1]], 3));
        if (matches.length !== 1) return false;
        used.push(matches[0].feature_id);
      }
    }
    return holeIds(used) && item.verification_pairs_3d_mm.some((pair) => pair.every((point, i) => sameVector(point, points[i], 3)))
      && item.reference_refs.every((ref, i) => {
        const member = item.members.find((m) => m.feature_id === ref.feature_id);
        return member && ref.kind === 'circle_center' && ref.geometry_ref === member.upper_edge_ref
          && sameVector(points[i], [...member.center_xy_mm, member.z_range_mm[1]], 3);
      });
  }
  const slot = item.slot_bounds_mm;
  if (item.feature_id !== 'slot' || !validBounds(slot) || !Array.isArray(item.slot_wall_refs)
      || item.slot_wall_refs.length !== 4 || new Set(item.slot_wall_refs).size !== 4
      || !item.slot_wall_refs.every((ref) => topologyRef(ref, item.model_object_id, 'Face'))
      || !validPcbSlotRelief(item)) return false;
  if (item.dimension_kind === 'slot_position_y') {
    const ref = item.explicit_reference, plate = item.plate_bounds_mm;
    return validBounds(plate) && item.reference_source === 'drawing_plan.dim_intents.reference'
      && ref?.axis === 'Y' && ref.from?.feature === 'plate' && ref.from.boundary === 'y_min'
      && ref.to?.feature === 'slot' && ref.to.boundary === 'y_min'
      && sameNumber(slot[5], plate[5]) && sameVector(points[0], [slot[0], plate[1], plate[5]], 3)
      && sameVector(points[1], [slot[0], slot[1], slot[5]], 3)
      && item.reference_refs[0].feature_id === 'plate' && item.reference_refs[0].kind === 'edge_point'
      && item.reference_refs[1].feature_id === 'slot' && item.reference_refs[1].kind === 'edge_endpoint';
  }
  if (item.slot_opening_bounds_mm && item.dimension_kind === 'slot_width'
      && (item.reference_refs[0].geometry_ref === item.reference_refs[1].geometry_ref
        || !sameNumber(points[0][0], slot[0]))) return false;
  return sameNumber(points[0][axis], slot[axis]) && sameNumber(points[1][axis], slot[axis + 3])
    && sameNumber(points[0][2], slot[5])
    && [slot[1 - axis], slot[4 - axis]].some((edge) => sameNumber(points[0][1 - axis], edge))
    && item.reference_refs.every((ref) => ref.feature_id === 'slot' && ref.kind === 'edge_endpoint');
}

function validPcbEvidence(item, value) {
  if (!item || item.source !== 'freecad_runtime' || item.status !== 'resolved'
      || !sameNumber(item.measured_mm, value) || value <= 0
      || typeof item.model_object_id !== 'string' || !item.model_object_id) return false;
  if (item.measurement === 'pcb_linear_reference') return validPcbLinear(item, value);
  if (item.measurement !== 'pcb_hole_diameter' || item.dimension_kind !== 'hole_diameter' || !validPcbHoles(item)) return false;
  const selected = item.members.find((m) => m.feature_id === item.selected_feature_id);
  return selected && sameNumber(2 * selected.radius_mm, value)
    && sameVector(item.center_uv, selected.center_xy_mm, 2)
    && sameVector(item.circle_uv_mm, selected.circle_uv_mm, 3)
    && sameVector(item.page_center_mm, item.page_center_mm, 2)
    && Number.isFinite(item.page_radius_mm) && item.page_radius_mm > 0;
}

function samePcbEvidence(a, b) {
  const fields = ['measurement', 'model_object_id', 'dimension_kind', 'axis', 'measured_mm', 'bounds',
    'endpoints_3d_mm', 'endpoints_uv_mm', 'page_endpoints_mm', 'effective_gap_mm', 'placement_side',
    'page_extension_gap_x_mm', 'page_extension_gap_y_mm', 'reference_refs', 'plate_bounds_mm', 'slot_bounds_mm',
    'verification_pairs_3d_mm', 'explicit_reference', 'reference_source', 'selected_feature_id', 'center_uv',
    'circle_uv_mm', 'page_center_mm', 'page_radius_mm', 'slot_opening_bounds_mm', 'slot_relief_radius_mm'];
  if (fields.some((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))) return false;
  if (a.slot_wall_refs && !sameSet(a.slot_wall_refs, b.slot_wall_refs)) return false;
  if ((a.slot_relief_face_refs || b.slot_relief_face_refs) && !sameSet(a.slot_relief_face_refs, b.slot_relief_face_refs)) return false;
  return !a.members || a.members.every((member) => {
    const other = b.members.find((m) => m.feature_id === member.feature_id);
    return other && Object.keys(member).every((key) => JSON.stringify(member[key]) === JSON.stringify(other[key]));
  });
}

function currentBoundGeometry(svgContent, entry, binding) {
  if (typeof svgContent !== 'string') return false;
  const svg = svgContent.replace(/<!--[\s\S]*?-->/g, '');
  const texts = [...svg.matchAll(/<text\b([^>]*)>/g)].map((m) => attributes(m[1])).filter((a) => a['data-dim-id'] === entry.dim_id);
  if (texts.length !== 1) return false;
  const groups = viewGroups(svg, entry.view).filter((body) => [...body.matchAll(/<text\b([^>]*)>/g)]
    .some((m) => attributes(m[1])['data-dim-id'] === entry.dim_id));
  if (groups.length !== 1) return false;
  const lines = [...groups[0].matchAll(/<line\b([^>]*)\/?\s*>/g)].map((m) => attributes(m[1]))
    .filter((attrs) => attrs['data-dim-id'] === entry.dim_id);
  if (lines.some((attrs) => hidden(attrs) || attrs.transform || /transform\s*:/i.test(attrs.style || ''))) return false;
  const near = (actual, expected) => typeof actual === 'string' && actual.trim() !== ''
    && Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= PAPER_TOLERANCE;
  if (binding.measurement === 'bracket_fillet_radius') {
    const leaders = lines.filter((a) => a['data-radius-leader'] === 'true');
    const [cx, cy] = binding.page_center_mm, [x, y] = binding.page_arc_point_mm;
    const leader = leaders[0];
    return leaders.length === 1 && texts[0]['data-runtime-radius'] === 'true'
      && near(leader.x1, x) && near(leader.y1, y) && near(leader['data-arc-x'], x) && near(leader['data-arc-y'], y)
      && near(leader['data-center-x'], cx) && near(leader['data-center-y'], cy)
      && near(leader['data-radius-page-mm'], binding.page_radius_mm)
      && sameNumber(Number(leader['data-scale']), binding.page_radius_mm / binding.measured_mm);
  }
  if (binding.measurement === 'pcb_hole_diameter') {
    const leaders = lines.filter((a) => a['data-diameter-leader'] === 'true');
    const [x, y] = binding.page_center_mm, radius = binding.page_radius_mm;
    const label = texts[0];
    if (leaders.length !== 1 || label['data-runtime-diameter'] !== 'true'
        || !near(label['data-center-u'], binding.center_uv[0]) || !near(label['data-center-v'], binding.center_uv[1])) return false;
    const leader = leaders[0];
    if (!near(leader['data-center-x'], x) || !near(leader['data-center-y'], y)
        || !near(leader['data-radius-page-mm'], radius)
        || !sameNumber(Number(leader['data-scale']), radius / binding.circle_uv_mm[2])
        || !Number.isFinite(Number(leader.x1)) || !Number.isFinite(Number(leader.y1))
        || Math.abs(Math.hypot(Number(leader.x1) - x, Number(leader.y1) - y) - radius) > PAPER_TOLERANCE) return false;
    return viewGroups(svg, 'top', 'geometry').some((body) => [...body.matchAll(/<circle\b([^>]*)\/?\s*>/g)]
      .map((m) => attributes(m[1])).some((a) => !hidden(a) && !a.transform && near(a.cx, x) && near(a.cy, y) && near(a.r, radius)));
  }
  const dimensions = lines.filter((a) => a['data-dimension-line'] === 'linear');
  const extensions = lines.filter((a) => a['data-dimension-extension'] === 'linear');
  if (dimensions.length !== 1 || extensions.length !== 2
      || !sameSet(extensions.map((a) => a['data-endpoint-index']), ['0', '1'])) return false;
  const axis = binding.axis === 'u' ? 0 : 1, other = 1 - axis;
  const keys = ['x', 'y'], line = dimensions[0], page = binding.page_endpoints_mm;
  const span = Math.abs(page[1][axis] - page[0][axis]);
  const target = [...page.map((p) => p[axis])].sort((a, b) => a - b);
  const actual = [Number(line[`${keys[axis]}1`]), Number(line[`${keys[axis]}2`])].sort((a, b) => a - b);
  if (binding.measurement === 'bracket_vertical_reference' && line['data-reference-kind'] !== binding.measurement) return false;
  if (line['data-axis'] !== binding.axis || !sameNumber(Number(line['data-scale']), span / binding.measured_mm)
      || !near(line[`${keys[other]}1`], Number(line[`${keys[other]}2`]))
      || actual.some((value, i) => !Number.isFinite(value) || Math.abs(value - target[i]) > PAPER_TOLERANCE)) return false;
  const gap = binding[axis === 0 ? 'page_extension_gap_y_mm' : 'page_extension_gap_x_mm'];
  return extensions.every((extension) => {
    const point = page[Number(extension['data-endpoint-index'])];
    const dimAt = Number(line[`${keys[other]}1`]);
    const begin = Number(extension[`${keys[other]}1`]), end = Number(extension[`${keys[other]}2`]);
    return near(extension['data-reference-x'], point[0]) && near(extension['data-reference-y'], point[1])
      && near(extension[`data-gap-${keys[other]}`], gap)
      && near(extension[`${keys[axis]}1`], point[axis]) && near(extension[`${keys[axis]}2`], point[axis])
      && near(extension[`${keys[other]}1`], point[other] + gap)
      && Number.isFinite(end) && dimAt >= Math.min(begin, end) - PAPER_TOLERANCE
      && dimAt <= Math.max(begin, end) + PAPER_TOLERANCE;
  });
}

function validPcbLink(entry, link, svgContent) {
  if (!entry || entry.view !== 'top' || entry.rendered !== true || entry.status !== 'rendered'
      || link.source !== 'freecad_runtime' || link.rendered !== true || link.status !== 'rendered'
      || link.represented_by !== entry.dim_id || !validPcbEvidence(entry.runtime_binding, entry.value_mm)
      || !validPcbEvidence(link.evidence, entry.value_mm) || !sameNumber(link.evidence.model_value_mm, entry.value_mm)
      || !samePcbEvidence(entry.runtime_binding, link.evidence)) return false;
  const [id, feature] = PCB_KINDS[entry.runtime_binding.dimension_kind];
  const allowedIds = [id, ...(id === 'PLATE_LENGTH' ? ['TOTAL_LENGTH'] : id === 'PLATE_WIDTH' ? ['HEIGHT'] : id === 'MOUNTING_HOLE_DIA' ? ['HOLE_DIA'] : [])];
  if (!allowedIds.includes(entry.dim_id) || entry.style !== (feature === 'holes' && id === 'MOUNTING_HOLE_DIA' ? 'diameter' : 'linear')) return false;
  if (![entry.feature, link.feature_key, link.feature_id, entry.runtime_binding.feature_id].every((value) => feature === 'holes' ? holeIds(value) : value === feature)) return false;
  return currentPlanLabel(entry, svgContent, link) && currentBoundGeometry(svgContent, entry, entry.runtime_binding);
}

const BRACKET_VERTICAL = {
  HEIGHT: ['overall_height', 'front', null, 2],
  THK: ['base_thickness', 'right', 'base_plate', 1],
  WEB_H: ['web_height', 'front', 'vertical_leg', 1],
};

function validBracketFilletLink(entry, link, svgContent) {
  const binding = entry?.runtime_binding, proof = link.evidence, value = entry?.value_mm;
  if (entry?.dim_id !== 'FILLET' || entry.feature !== 'fillet_radius' || entry.view !== 'front'
      || entry.style !== 'radius' || entry.rendered !== true || entry.status !== 'rendered'
      || link.source !== 'freecad_runtime' || link.rendered !== true || link.status !== 'rendered'
      || link.feature_key !== entry.feature || link.represented_by !== entry.dim_id
      || !binding || !proof || binding.source !== 'freecad_runtime' || binding.status !== 'resolved'
      || binding.measurement !== 'bracket_fillet_radius' || binding.feature_id !== 'vertical_leg_root'
      || link.feature_id !== binding.feature_id || !sameNumber(proof.model_value_mm, value)
      || !sameNumber(binding.measured_mm, value) || value <= 0
      || typeof binding.model_object_id !== 'string' || !binding.model_object_id
      || !topologyRef(binding.face_ref, binding.model_object_id, 'Face')
      || Object.keys(binding).some((key) => JSON.stringify(binding[key]) !== JSON.stringify(proof[key]))) return false;
  const radiusMatches = (center, point, radius) => sameVector(center, center, 2) && sameVector(point, point, 2)
    && radius > 0 && sameNumber(Math.hypot(point[0] - center[0], point[1] - center[1]), radius);
  return radiusMatches(binding.center_uv_mm, binding.arc_point_uv_mm, value)
    && radiusMatches(binding.page_center_mm, binding.page_arc_point_mm, binding.page_radius_mm)
    && currentPlanLabel(entry, svgContent, link) && currentBoundGeometry(svgContent, entry, binding);
}

function validBracketVerticalLink(entry, link, svgContent) {
  const role = entry && BRACKET_VERTICAL[entry.dim_id];
  if (!Array.isArray(role) || entry.style !== 'linear' || entry.rendered !== true || entry.status !== 'rendered'
      || link.rendered !== true || link.status !== 'rendered' || link.source !== 'freecad_runtime'
      || link.represented_by !== entry.dim_id) return false;
  const [feature, view, namedShape, edgeCount] = role;
  const { runtime_binding: binding, value_mm: value } = entry;
  const proof = link.evidence;
  if (!binding || !proof || entry.feature !== feature || link.feature_key !== feature || entry.view !== view
      || !sameNumber(proof.model_value_mm, value) || value <= 0
      || Object.keys(binding).some((key) => JSON.stringify(binding[key]) !== JSON.stringify(proof[key]))) return false;
  const { model_object_id: model, edge_refs: refs, endpoints_3d_mm: xyz,
    endpoints_uv_mm: uv, page_endpoints_mm: page } = binding;
  const target = namedShape || model;
  if (binding.source !== 'freecad_runtime' || binding.measurement !== 'bracket_vertical_reference'
      || binding.status !== 'resolved' || binding.axis !== 'v' || !sameNumber(binding.measured_mm, value)
      || typeof model !== 'string' || !model || binding.feature_id !== target || link.feature_id !== target
      || !Array.isArray(refs) || refs.length !== edgeCount || new Set(refs).size !== edgeCount
      || !refs.every((ref) => topologyRef(ref, model, 'Edge'))) return false;
  const u = view === 'front' ? 0 : 1;
  if (!Array.isArray(xyz) || xyz.length !== 2 || !xyz.every((p) => sameVector(p, p, 3))
      || !sameVector(xyz[0].slice(0, 2), xyz[1].slice(0, 2), 2) || !sameNumber(xyz[1][2] - xyz[0][2], value)
      || !Array.isArray(uv) || uv.length !== 2 || !uv.every((p, i) => sameVector(p, [xyz[i][u], xyz[i][2]], 2))
      || !sameVector(binding.bounds, [...uv[0], ...uv[1]], 4)
      || !Array.isArray(page) || page.length !== 2 || !page.every((p) => sameVector(p, p, 2))
      || !sameNumber(page[0][0], page[1][0]) || page[0][1] <= page[1][1]
      || !['left', 'right'].includes(binding.placement_side)
      || !Number.isFinite(binding.effective_gap_mm) || binding.effective_gap_mm < 0
      || !sameNumber(binding.page_extension_gap_x_mm,
        (binding.placement_side === 'left' ? 1 : -1) * binding.effective_gap_mm)) return false;
  return currentPlanLabel(entry, svgContent, link) && currentBoundGeometry(svgContent, entry, binding);
}

export function runtimePcbDimensionRequirements(requirements, traceability, dimensionMap, svgContent) {
  const result = new Map();
  const entries = Array.isArray(dimensionMap?.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  const links = currentTraceability(traceability, dimensionMap, svgContent, new Map())?.links;
  if (!Array.isArray(links)) return result;
  const byKind = new Map();
  for (const entry of entries) {
    const kind = entry.runtime_binding?.dimension_kind;
    if (!PCB_KINDS[kind] || !isPcbMeasurement(entry.runtime_binding?.measurement)) continue;
    const matching = links.filter((link) => link?.dim_id === entry.dim_id && link.feature_id);
    if (matching.length !== 1 || entries.filter((e) => e.dim_id === entry.dim_id).length !== 1) continue;
    const items = byKind.get(kind) || [];
    items.push({ entry, link: matching[0] }); byKind.set(kind, items);
  }
  for (const [kind, items] of byKind) {
    if (items.length !== 1 || kind === 'slot_width') continue;
    const [id, feature] = PCB_KINDS[kind], match = items[0];
    const candidates = requirements.filter((r) => r.id === id && r.view === 'top'
      && r.dimension_type === match.entry.style && sameNumber(r.value_mm, match.entry.value_mm)
      && (feature === 'holes' ? holeIds(r.feature) : r.feature === feature));
    if (candidates.length !== 1) continue;
    let supporting = [];
    if (kind === 'slot_length') {
      const widths = byKind.get('slot_width') || [];
      if (widths.length !== 1 || !sameVector(match.link.evidence.slot_bounds_mm, widths[0].link.evidence.slot_bounds_mm, 6)
          || !sameSet(match.link.evidence.slot_wall_refs, widths[0].link.evidence.slot_wall_refs)) continue;
      const length = match.link.evidence, width = widths[0].link.evidence;
      if ((length.slot_opening_bounds_mm || width.slot_opening_bounds_mm)
          && (!sameVector(length.slot_opening_bounds_mm, width.slot_opening_bounds_mm, 6)
            || !sameSet(length.slot_relief_face_refs, width.slot_relief_face_refs)
            || length.reference_refs[0].geometry_ref !== width.reference_refs[0].geometry_ref)) continue;
      supporting = widths;
    }
    result.set(id, { requirement: candidates[0], ...match, supporting });
  }
  return result;
}
