// A rendered nominal or copied feature ID alone is not an observed dimension.
const finite = Number.isFinite;
const close = (a, b) => finite(a) && finite(b)
  && Math.abs(a - b) <= Math.max(1e-4, Math.abs(a) * 1e-6);
const ids = value => (Array.isArray(value) ? value : String(value || '').split(','))
  .map(v => String(v).trim()).filter(Boolean).sort();
const sameIds = (a, b) => JSON.stringify(ids(a)) === JSON.stringify(ids(b));
const point = (p, n) => Array.isArray(p) && p.length === n && p.every(finite);

export function hasObservedDimension(entry = {}, requirement = null) {
  const o = entry.observation;
  if (!o || o.source !== 'freecad_final_topology' || o.status !== 'resolved') return false;
  if (!finite(o.value_mm) || o.value_mm <= 0 || !Array.isArray(o.requirement_ids)
      || o.requirement_ids.some(v => typeof v !== 'string' || !v.trim())) return false;
  const emitted = entry.emitted_dim_id ?? entry.dim_id;
  if (!emitted || emitted !== o.dim_id || !close(entry.value_mm ?? entry.value, o.value_mm)) return false;
  if (Object.hasOwn(entry,'value') && !close(entry.value,o.value_mm)) return false;
  if (entry.unit && entry.unit !== 'mm') return false;
  const raw = String(entry.raw_text || '');
  if (/^[\s\dXx×]*[Ø⌀]|\b(?:DIA|DIAMETER)\b/i.test(raw) && o.style !== 'diameter') return false;
  if (/^R\s*\d/i.test(raw) && o.style !== 'radius') return false;
  if (!['front', 'top', 'right'].includes(o.view) || !['linear', 'diameter'].includes(o.style)) return false;
  if (!Array.isArray(o.feature_ids) || !o.feature_ids.length
      || o.feature_ids.some(v => typeof v !== 'string' || !v.trim())
      || new Set(o.feature_ids).size !== o.feature_ids.length) return false;
  if (!Array.isArray(o.members) || o.members.some(m => !m || typeof m !== 'object')
      || !sameIds(o.members.map(m => m.feature_id), o.feature_ids)) return false;
  if (o.members.some(m => {
    const refs = m.final_face_indices ?? m.final_edge_indices;
    if (!Array.isArray(refs) || !refs.length || !refs.every(v => Number.isInteger(v) && v >= 0)) return true;
    if (!close(m.value_mm, o.value_mm)) return true;
    if (o.style === 'diameter') return o.measurement !== 'diameter' || !point(m.circle_uv, 3)
      || m.circle_uv[2] <= 0 || !close(2 * m.circle_uv[2], o.value_mm);
    if (!/^extent:[012]$/.test(o.measurement) || !Array.isArray(m.points_model_mm)
        || m.points_model_mm.length !== 2 || !m.points_model_mm.every(p => point(p, 3))
        || !Array.isArray(m.points_uv_mm) || m.points_uv_mm.length !== 2
        || !m.points_uv_mm.every(p => point(p, 2))) return true;
    const axis = Number(o.measurement.slice(-1));
    const uv = { front: [0, 2], top: [0, 1], right: [1, 2] }[o.view];
    return !uv.includes(axis) || !close(Math.abs(m.points_model_mm[1][axis] - m.points_model_mm[0][axis]), o.value_mm)
      || [0,1,2].some(a => a !== axis && !close(m.points_model_mm[0][a],m.points_model_mm[1][a]))
      || m.points_model_mm.some((p, i) => uv.some((a, j) => !close(p[a], m.points_uv_mm[i][j])));
  })) return false;
  for (const key of ['feature','feature_id','matched_feature_id']) {
    if (entry[key] != null && !sameIds(entry[key], o.feature_ids)) return false;
  }
  if (entry.matched_intent_id != null && !o.requirement_ids?.includes(entry.matched_intent_id)) return false;
  if (entry.view && entry.view !== o.view) return false;
  if (entry.style && entry.style !== o.style) return false;
  if (!requirement) return true;
  if (!Array.isArray(o.requirement_ids) || o.requirement_ids.length !== 1 || o.requirement_ids[0] !== requirement.id) return false;
  const feature = requirement.feature ?? requirement.feature_id;
  if (feature && !sameIds(feature, o.feature_ids)) return false;
  if (requirement.view && requirement.view !== o.view) return false;
  const style = requirement.dimension_type ?? requirement.style;
  if (style && style !== o.style) return false;
  return requirement.value_mm == null || close(requirement.value_mm, o.value_mm);
}
