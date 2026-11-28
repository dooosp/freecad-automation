// Small, explicit artifact fixtures for the measured PCB reference contract.
const HOLES = ['hole1', 'hole2', 'hole3', 'hole4'];
const PLATE = [0, 0, 0, 145, 98, 4];
const SLOT = [60, 42, 0, 78, 52, 4];
const page = ([x, y]) => [76.25 + x / 2, 97.5 - y / 2];
const reference = { axis: 'Y', from: { feature: 'plate', boundary: 'y_min' }, to: { feature: 'slot', boundary: 'y_min' } };

function members() {
  return [[22, 22], [123, 22], [22, 76], [123, 76]].map((center, index) => ({
    feature_id: HOLES[index], face_ref: `final:Face${index + 1}`, center_xy_mm: center,
    radius_mm: 2, z_range_mm: [0, 4], height_mm: 4, axis: [0, 0, 1],
    lower_edge_ref: `final:Edge${index * 2 + 1}`, upper_edge_ref: `final:Edge${index * 2 + 2}`,
    surface_role: 'inward_hole', area_mm2: 50.26548245743669, circle_uv_mm: [...center, 2],
  }));
}

function linear(id, kind, feature, axis, xyz, refs, extra = {}) {
  const uv = xyz.map(([x, y]) => [x, y]);
  const index = axis === 'u' ? 0 : 1;
  const value = xyz[1][index] - xyz[0][index];
  const endpoints = uv.map(page);
  const binding = { source: 'freecad_runtime', status: 'resolved', model_object_id: 'final',
    feature_id: feature, measurement: 'pcb_linear_reference', dimension_kind: kind, axis,
    measured_mm: value, endpoints_3d_mm: xyz, endpoints_uv_mm: uv,
    bounds: [Math.min(...uv.map((p) => p[0])), Math.min(...uv.map((p) => p[1])),
      Math.max(...uv.map((p) => p[0])), Math.max(...uv.map((p) => p[1]))],
    reference_refs: refs.map(([name, geometry, role]) => ({ feature_id: name, geometry_ref: geometry, kind: role })),
    page_endpoints_mm: endpoints, effective_gap_mm: 2,
    placement_side: axis === 'u' ? 'bottom' : 'left',
    ...(axis === 'u' ? { page_extension_gap_y_mm: 2 } : { page_extension_gap_x_mm: 2 }), ...extra };
  const gapKey = axis === 'u' ? 'y' : 'x';
  const dimAt = axis === 'u' ? Math.max(...endpoints.map((p) => p[1])) + 12 : endpoints[0][0] - 12;
  const extensions = endpoints.map(([x, y], i) => `<line data-dimension-extension="linear" data-dim-id="${id}" data-endpoint-index="${i}" data-reference-x="${x}" data-reference-y="${y}" data-gap-${gapKey}="2" x1="${x + (axis === 'v' ? 2 : 0)}" y1="${y + (axis === 'u' ? 2 : 0)}" x2="${axis === 'v' ? dimAt - 1.5 : x}" y2="${axis === 'u' ? dimAt + 1.5 : y}"/>`).join('');
  const line = axis === 'u'
    ? `<line data-dimension-line="linear" data-dim-id="${id}" data-axis="u" data-scale="0.5" x1="${endpoints[0][0]}" y1="${dimAt}" x2="${endpoints[1][0]}" y2="${dimAt}"/>`
    : `<line data-dimension-line="linear" data-dim-id="${id}" data-axis="v" data-scale="0.5" x1="${dimAt}" y1="${endpoints[1][1]}" x2="${dimAt}" y2="${endpoints[0][1]}"/>`;
  return { id, feature, value, binding, svg: extensions + line + `<text data-dim-id="${id}">${value}</text>` };
}

export function pcbRuntimeInput() {
  const holeGroup = HOLES.join(',');
  const holeExtra = { member_feature_ids: HOLES, members: members(), plate_bounds_mm: PLATE };
  const slotExtra = { slot_bounds_mm: SLOT, slot_wall_refs: ['final:Face11', 'final:Face12', 'final:Face13', 'final:Face14'] };
  const entries = [
    linear('PLATE_LENGTH', 'plate_length', 'plate', 'u', [[0, 0, 4], [145, 0, 4]],
      [['plate', 'final:Edge20', 'edge_endpoint'], ['plate', 'final:Edge20', 'edge_endpoint']], { plate_bounds_mm: PLATE }),
    linear('PLATE_WIDTH', 'plate_width', 'plate', 'v', [[0, 0, 4], [0, 98, 4]],
      [['plate', 'final:Edge21', 'edge_endpoint'], ['plate', 'final:Edge21', 'edge_endpoint']], { plate_bounds_mm: PLATE }),
    linear('MOUNTING_HOLE_PATTERN_X', 'hole_pitch_x', holeGroup, 'u', [[22, 22, 4], [123, 22, 4]],
      [['hole1', 'final:Edge2', 'circle_center'], ['hole2', 'final:Edge4', 'circle_center']],
      { ...holeExtra, verification_pairs_3d_mm: [[[22, 22, 4], [123, 22, 4]], [[22, 76, 4], [123, 76, 4]]] }),
    linear('MOUNTING_HOLE_PATTERN_Y', 'hole_pitch_y', holeGroup, 'v', [[22, 22, 4], [22, 76, 4]],
      [['hole1', 'final:Edge2', 'circle_center'], ['hole3', 'final:Edge6', 'circle_center']],
      { ...holeExtra, verification_pairs_3d_mm: [[[22, 22, 4], [22, 76, 4]], [[123, 22, 4], [123, 76, 4]]] }),
    linear('CONNECTOR_SLOT_SIZE', 'slot_length', 'slot', 'u', [[60, 42, 4], [78, 42, 4]],
      [['slot', 'final:Edge22', 'edge_endpoint'], ['slot', 'final:Edge22', 'edge_endpoint']], slotExtra),
    linear('CONNECTOR_SLOT_WIDTH', 'slot_width', 'slot', 'v', [[60, 42, 4], [60, 52, 4]],
      [['slot', 'final:Edge23', 'edge_endpoint'], ['slot', 'final:Edge23', 'edge_endpoint']], slotExtra),
    linear('CONNECTOR_SLOT_POSITION', 'slot_position_y', 'slot', 'v', [[60, 0, 4], [60, 42, 4]],
      [['plate', 'final:Edge20', 'edge_point'], ['slot', 'final:Edge22', 'edge_endpoint']],
      { ...slotExtra, plate_bounds_mm: PLATE, explicit_reference: reference, reference_source: 'drawing_plan.dim_intents.reference' }),
  ];
  const circle = [87.25, 86.5], radius = 1;
  const diameterBinding = { source: 'freecad_runtime', status: 'resolved', model_object_id: 'final',
    feature_id: holeGroup, measurement: 'pcb_hole_diameter', dimension_kind: 'hole_diameter', axis: null, measured_mm: 4,
    ...holeExtra, selected_feature_id: 'hole1', center_uv: [22, 22], circle_uv_mm: [22, 22, 2],
    page_center_mm: circle, page_radius_mm: radius };
  entries.push({ id: 'MOUNTING_HOLE_DIA', feature: holeGroup, value: 4, binding: diameterBinding,
    svg: `<line data-diameter-leader="true" data-dim-id="MOUNTING_HOLE_DIA" data-center-x="87.25" data-center-y="86.5" data-radius-page-mm="1" data-scale="0.5" x1="88.25" y1="86.5" x2="95" y2="80"/><text id="plan_top_dia" data-dim-id="MOUNTING_HOLE_DIA" data-runtime-diameter="true" data-center-u="22" data-center-v="22">Ø4</text>` });
  const dimensions = entries.map(({ id, feature, value, binding }) => ({ dim_id: id, feature,
    view: 'top', style: id === 'MOUNTING_HOLE_DIA' ? 'diameter' : 'linear', value_mm: value,
    required: true, rendered: true, status: 'rendered', runtime_binding: structuredClone(binding) }));
  const links = entries.map(({ id, feature, value, binding }) => ({ dim_id: id, feature_key: feature,
    feature_id: feature, source: 'freecad_runtime', rendered: true, status: 'rendered', represented_by: id,
    evidence: { ...structuredClone(binding), model_value_mm: value } }));
  return { drawingSvgPath: '/tmp/pcb_reference_drawing.svg',
    svgContent: `<svg><g id="drawing-view-top"><g class="hard_visible"><circle cx="87.25" cy="86.5" r="1"/></g><g class="dimensions-top plan-dimensions-top">${entries.map((e) => e.svg).join('')}</g></g><g class="dimensions-front"><text>4</text></g></svg>`,
    dimensionMap: { plan_dimensions: dimensions }, traceability: { links },
    drawingIntent: { part_type: 'plate_with_holes', required_dimensions: [
      ...entries.filter((entry) => entry.id !== 'CONNECTOR_SLOT_WIDTH').map((entry) => ({ id: entry.id,
        feature: entry.feature, view: 'top', dimension_type: entry.id === 'MOUNTING_HOLE_DIA' ? 'diameter' : 'linear',
        value_mm: entry.value, required: true })),
      { id: 'PLATE_THICKNESS', feature: 'plate', view: 'front', dimension_type: 'linear', value_mm: 4, required: true },
    ] },
  };
}
