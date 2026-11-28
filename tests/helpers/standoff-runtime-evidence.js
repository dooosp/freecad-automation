// Hand-checked boundary artifacts for four separate 8/10 mm support cylinders.
// Real FreeCAD production is covered separately by the runtime tests.
export const STANDOFF_GROUP = 'standoff1,standoff2,standoff3,standoff4';

export function standoffRuntimeInput(height = 8) {
  const top = 190 - height / 2;
  const binding = {
    status: 'resolved', source: 'freecad_runtime', measurement: 'standoff_cylindrical_faces',
    feature_id: STANDOFF_GROUP, model_object_id: 'final', axis: 'v', measured_mm: height,
    member_feature_ids: STANDOFF_GROUP.split(','),
    members: [[18, 18], [127, 18], [18, 80], [127, 80]].map((center, index) => ({
      feature_id: `standoff${index + 1}`, face_ref: `final:Face${index + 1}`,
      center_xy_mm: center, radius_mm: 3.5, z_range_mm: [4, 4 + height], height_mm: height,
      lower_edge_ref: `final:Edge${index * 2 + 1}`, upper_edge_ref: `final:Edge${index * 2 + 2}`,
    })),
    representative_feature_id: 'standoff1', coincident_member_ids: ['standoff1', 'standoff3'],
    selected_side: 'right', projection_group_index: 0,
    endpoints_3d_mm: [[21.5, 18, 4], [21.5, 18, 4 + height]],
    endpoints_uv_mm: [[21.5, 4], [21.5, 4 + height]], bounds: [21.5, 4, 21.5, 4 + height],
    page_endpoints_mm: [[87, 190], [87, top]], page_extension_gap_x_mm: 2,
    effective_gap_mm: 2, placement_side: 'left',
  };
  return {
    drawingSvgPath: '/tmp/pcb_standoff_drawing.svg',
    svgContent: `<svg><g id="drawing-view-front"><g class="dimensions-front plan-dimensions-front">
      <line data-dimension-extension="linear" data-dim-id="STANDOFF_HEIGHT" data-endpoint-index="1" data-reference-x="87" data-reference-y="${top}" data-gap-x="2" x1="89" y1="${top}" x2="58.5" y2="${top}"/>
      <line data-dimension-extension="linear" data-dim-id="STANDOFF_HEIGHT" data-endpoint-index="0" data-reference-x="87" data-reference-y="190" data-gap-x="2" x1="89" y1="190" x2="58.5" y2="190"/>
      <line data-dimension-line="linear" data-dim-id="STANDOFF_HEIGHT" data-scale="0.5" data-axis="v" data-reference-y1="${top}" data-reference-y2="190" x1="60" y1="${top}" x2="60" y2="190"/>
      <text data-dim-id="STANDOFF_HEIGHT" data-value-mm="${height}" data-linear-binding="view_extent">${height}</text>
      </g></g><g class="dimensions-top"><text>${height}</text></g></svg>`,
    dimensionMap: { plan_dimensions: [{ dim_id: 'STANDOFF_HEIGHT', feature: STANDOFF_GROUP,
      view: 'front', style: 'linear', value_mm: height, rendered: true, status: 'rendered',
      runtime_binding: structuredClone(binding) }] },
    traceability: { links: [{ dim_id: 'STANDOFF_HEIGHT', feature_id: STANDOFF_GROUP,
      feature_key: STANDOFF_GROUP, source: 'freecad_runtime', rendered: true, status: 'rendered',
      represented_by: 'STANDOFF_HEIGHT', evidence: { ...structuredClone(binding), model_value_mm: height } }] },
    drawingIntent: { required_dimensions: [{ id: 'STANDOFF_HEIGHT', feature: STANDOFF_GROUP,
      view: 'front', dimension_type: 'linear', value_mm: height, required: true }] },
  };
}

export const invalidStandoffCases = {
  'one member missing': (input) => { input.dimensionMap.plan_dimensions[0].runtime_binding.members.pop(); },
  'duplicate member': (input) => { input.dimensionMap.plan_dimensions[0].runtime_binding.members[3] = structuredClone(input.dimensionMap.plan_dimensions[0].runtime_binding.members[0]); },
  'unequal group heights': (input) => { input.dimensionMap.plan_dimensions[0].runtime_binding.members[3].height_mm = 9; },
  'wrong feature group': (input) => { input.dimensionMap.plan_dimensions[0].feature = 'standoff1,standoff2,standoff3,slot'; },
  'wrong view': (input) => { input.dimensionMap.plan_dimensions[0].view = 'top'; },
  'wrong nominal': (input) => { input.dimensionMap.plan_dimensions[0].value_mm = 9; },
  'duplicate plan identity': (input) => { input.dimensionMap.plan_dimensions.push(structuredClone(input.dimensionMap.plan_dimensions[0])); },
  'unrendered annotation': (input) => { input.dimensionMap.plan_dimensions[0].rendered = false; },
  'missing runtime proof': (input) => { delete input.traceability.links[0].evidence; },
  'unverified legacy trace': (input) => { input.traceability.links[0].source = 'plan'; },
  'hidden ancestor': (input) => { input.svgContent = input.svgContent.replace('id="drawing-view-front"', 'id="drawing-view-front" display="none"'); },
  'renamed label identity': (input) => { input.svgContent = input.svgContent.replace('<text data-dim-id="STANDOFF_HEIGHT"', '<text data-dim-id="RENAMED"'); },
  'changed visible value': (input) => { input.svgContent = input.svgContent.replace('>8</text>', '>9</text>'); },
  'shifted equal length dimension': (input) => { input.svgContent = input.svgContent.replace('x1="60" y1="186" x2="60" y2="190"', 'x1="60" y1="176" x2="60" y2="180"'); },
  'wrong extension target X': (input) => { input.svgContent = input.svgContent.replace('x1="89"', 'x1="139"'); },
  'forged extension gap': (input) => { input.svgContent = input.svgContent.replace('data-gap-x="2" x1="89"', 'data-gap-x="52" x1="139"'); },
  'transformed annotation': (input) => { input.svgContent = input.svgContent.replace('class="dimensions-front plan-dimensions-front"', 'class="dimensions-front plan-dimensions-front" transform="translate(40,0)"'); },
  'missing extension evidence': (input) => { input.svgContent = input.svgContent.replace('data-dimension-extension="linear"', 'data-dimension-extension="unknown"'); },
  'unrelated topology reference': (input) => { input.traceability.links[0].evidence.members[0].face_ref = 'different:Face1'; },
};
