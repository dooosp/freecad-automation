// Synthetic unit data only. Actual FreeCAD checks live in the runtime lane.
export function unitDimension(dim_id, feature, value_mm = 40, style = 'linear', view = 'front', requirement = dim_id) {
  const features = feature.split(',');
  const members = features.map(feature_id => ({ feature_id, value_mm,
    ...(style === 'diameter' ? { circle_uv: [10,20,value_mm/2], final_face_indices: [0] }
      : { points_model_mm: [[0,0,0],[value_mm,0,0]], points_uv_mm: [[0,0],[value_mm,0]], final_edge_indices: [0] }),
  }));
  return { dim_id, feature, value_mm, style, view, rendered: true, status: 'rendered', required: true,
    observation: { source: 'freecad_final_topology', status: 'resolved', dim_id,
      feature_ids: features, value_mm, style, view, measurement: style === 'diameter' ? 'diameter' : 'extent:0',
      requirement_ids: [requirement], members } };
}

export function unitDimensionText(row, raw = String(row.value_mm)) {
  const json = JSON.stringify(row.observation).replaceAll('&','&amp;').replaceAll('"','&quot;');
  return `<text data-dim-id="${row.dim_id}" data-observation="${json}">${raw}</text>`;
}
