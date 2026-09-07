// Additive Y/XZ contract; legacy rows without projection metadata remain XY.
const extensionKeys = ['hole_axis', 'center_plane', 'expected_center_xz_mm', 'actual_center_xz_mm'];
const has = (row, key) => Object.hasOwn(row, key);
const vector2 = value => Array.isArray(value) && value.length === 2
  && value.every(n => typeof n === 'number' && Number.isFinite(n));

export function validCreateQualityProjection(row = {}) {
  if (!extensionKeys.some(key => has(row, key))) return true;
  if (!['pass', 'fail', 'missing', 'unavailable'].includes(row.status)) return false;
  if (!has(row, 'hole_axis') || !has(row, 'center_plane')) return false;
  if (row.hole_axis === 'z') return row.center_plane === 'xy'
    && !has(row, 'expected_center_xz_mm') && !has(row, 'actual_center_xz_mm');
  if (row.hole_axis !== 'y' || row.center_plane !== 'xz'
    || row.expected_center_xy_mm !== null || row.actual_center_xy_mm !== null) return false;
  return ['expected_center_xz_mm', 'actual_center_xz_mm'].every(key => has(row, key)
    && (vector2(row[key]) || (row[key] === null && row.status !== 'pass')));
}
