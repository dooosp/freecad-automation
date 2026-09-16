const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const number = value => typeof value === 'number' && Number.isFinite(value);
const center = value => Array.isArray(value) && value.length === 2 && value.every(number);

function duplicated(values) {
  return new Set(values).size !== values.length;
}

/** Compare explicitly mapped nominal CAD centers; never infer physical fit. */
export function compareMountingCenters(reference, measurements, { modelName = null, inputConfigPath = null } = {}) {
  const ref = isObject(reference) ? reference : {};
  const measured = isObject(measurements) ? measurements : {};
  const expected = Array.isArray(ref.holes) ? ref.holes : [];
  const observed = Array.isArray(measured.holes) ? measured.holes : [];
  const reasons = [];
  if (!isObject(reference)) reasons.push('invalid_reference');
  if (ref.source?.kind !== 'manufacturer_reference' || !text(ref.source?.product_id) || !text(ref.source?.evidence_ref)) {
    reasons.push('source_identity_missing');
  }
  if (ref.units !== 'mm') reasons.push('unsupported_reference_units');
  if (ref.coordinate_frame !== 'model_xy') reasons.push('unsupported_reference_frame');
  if (!number(ref.center_tolerance_mm) || ref.center_tolerance_mm < 0) reasons.push('invalid_tolerance');
  const validExpected = expected.length > 0 && expected.every(hole => isObject(hole)
    && text(hole.id) && text(hole.target_feature_id) && center(hole.center_mm));
  if (!validExpected) reasons.push('invalid_reference_holes');
  if (validExpected && (duplicated(expected.map(hole => hole.id))
    || duplicated(expected.map(hole => hole.target_feature_id))
    || duplicated(expected.map(hole => JSON.stringify(hole.center_mm))))) {
    reasons.push('ambiguous_reference');
  }
  if (measured.source !== 'freecad_runtime' || measured.status !== 'available' || !text(measured.model_object_id)) {
    reasons.push('runtime_measurements_unavailable');
  }
  if (measured.units !== 'mm') reasons.push('unsupported_measurement_units');
  if (measured.coordinate_frame !== 'model_xy') reasons.push('unsupported_measurement_frame');
  const validObserved = Array.isArray(measured.holes) && observed.every(hole => isObject(hole)
    && text(hole.feature_id) && center(hole.center_mm) && text(hole.face_ref));
  if (!validObserved) reasons.push('invalid_measurements');
  if (validObserved && (duplicated(observed.map(hole => hole.feature_id))
    || duplicated(observed.map(hole => hole.face_ref))
    || duplicated(observed.map(hole => JSON.stringify(hole.center_mm))))) {
    reasons.push('ambiguous_measurement');
  }

  const byId = new Map(observed.filter(isObject).map(hole => [hole.feature_id, hole]));
  const rows = expected.map(raw => {
    const hole = isObject(raw) ? raw : {};
    const row = {
      reference_id: text(hole.id) ? hole.id : null,
      target_feature_id: text(hole.target_feature_id) ? hole.target_feature_id : null,
      expected_center_mm: ref.units === 'mm' && ref.coordinate_frame === 'model_xy' && center(hole.center_mm) ? [...hole.center_mm] : null,
      measured_center_mm: null, delta_mm: null, distance_mm: null, face_ref: null,
      status: 'unknown', reason_codes: [...reasons],
    };
    if (reasons.length) return row;
    const match = byId.get(hole.target_feature_id);
    if (!match) return { ...row, status: 'fail', reason_codes: ['missing_feature'] };
    const delta = match.center_mm.map((value, axis) => value - hole.center_mm[axis]);
    const distance = Math.hypot(...delta);
    if (!number(distance)) return { ...row, reason_codes: ['invalid_measurements'] };
    const pass = distance <= ref.center_tolerance_mm + 1e-9;
    return { ...row, measured_center_mm: [...match.center_mm], delta_mm: delta,
      distance_mm: distance, face_ref: match.face_ref, status: pass ? 'pass' : 'fail',
      reason_codes: [pass ? 'center_within_tolerance' : 'center_out_of_tolerance'] };
  });
  const summary = { total: rows.length, pass: 0, fail: 0, unknown: 0, max_deviation_mm: null };
  for (const row of rows) {
    summary[row.status] += 1;
    if (row.distance_mm !== null) summary.max_deviation_mm = Math.max(summary.max_deviation_mm ?? 0, row.distance_mm);
  }
  return {
    schema_version: '0.1', artifact_type: 'mounting_center_comparison', scope: 'nominal_cad',
    model_name: modelName, input_config: inputConfigPath,
    status: summary.fail ? 'fail' : reasons.length || summary.unknown || !rows.length ? 'unknown' : 'pass',
    reason_codes: [...new Set([...reasons, ...rows.flatMap(row => row.reason_codes)])],
    reference: structuredClone(ref), measurements: structuredClone(measured), rows, summary,
    physical_fit_result: 'not_tested', user_hardware_identity: 'unknown', manufacturing_release: false,
  };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const statusLabel = { pass: '일치', fail: '불일치', unknown: '확인 불가' };
const reasonLabel = {
  center_within_tolerance: '비교 허용값 이내', center_out_of_tolerance: '비교 허용값 초과',
  missing_feature: '지정된 CAD 구멍 없음', ambiguous_reference: '중복된 기준 구멍 또는 연결',
  ambiguous_measurement: '중복된 CAD 구멍 또는 면 근거', source_identity_missing: '제조사 기준 식별·출처 미확인',
  invalid_reference: '기준 입력 형식 오류', invalid_reference_holes: '기준 구멍 좌표·ID 미확인',
  invalid_tolerance: '비교 허용값 미확인', runtime_measurements_unavailable: '지원되는 실제 CAD 측정 근거 없음',
  invalid_measurements: 'CAD 측정값 또는 면 근거 미확인', unsupported_reference_units: '지원하지 않는 기준 단위',
  unsupported_reference_frame: '지원하지 않는 기준 좌표계', unsupported_measurement_units: '지원하지 않는 측정 단위',
  unsupported_measurement_frame: '지원하지 않는 측정 좌표계',
};

/** A static downstream view of the canonical comparison JSON. */
export function renderMountingComparisonHtml(report, { jsonFileName = null } = {}) {
  const format = value => number(value) ? value.toFixed(4) : '확인 불가';
  const pair = value => center(value) ? value.map(format).join(', ') : '확인 불가';
  const label = value => statusLabel[value] || statusLabel.unknown;
  const reasonText = codes => (codes || []).map(code => reasonLabel[code] || code).join(' · ');
  const ref = report.reference || {};
  const rows = report.rows.map(row => `<tr><th scope="row">${escapeHtml(row.reference_id || '확인 불가')}<small>${escapeHtml(row.target_feature_id)}</small></th><td>${pair(row.expected_center_mm)}</td><td>${pair(row.measured_center_mm)}</td><td>${pair(row.delta_mm)}</td><td>${format(row.distance_mm)}</td><td>${escapeHtml(label(row.status))}<small>${escapeHtml(reasonText(row.reason_codes))}</small></td><td>${escapeHtml(row.face_ref || '확인 불가')}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>장착 구멍 좌표 비교</title><style>
body{margin:0;background:#f3f6fa;color:#203246;font:16px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:40px auto;padding:0 24px}h1{font-size:30px;margin:8px 0}h2{font-size:20px}section{background:white;border:1px solid #d7e0ea;border-radius:12px;padding:22px;margin:18px 0}.eyebrow,small{font-size:13px;color:#53687c}small{display:block}.status{display:inline-block;padding:4px 13px;border-radius:20px;background:#e4edf7;font-weight:700}.notice{border-left:4px solid #bd7b23;padding:12px 16px;background:#fff4df}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;white-space:nowrap}th,td{text-align:left;border-bottom:1px solid #e0e7ef;padding:12px 10px}thead{background:#f6f8fb}td{font-variant-numeric:tabular-nums}dl{display:grid;grid-template-columns:120px 1fr;gap:8px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}a{color:#075caa}.reason{overflow-wrap:anywhere}@media(max-width:600px){main{padding:0 14px;margin:24px auto}section{padding:16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}h1{font-size:25px}}
</style></head><body><main><p class="eyebrow">FREECAD · 공칭 CAD 좌표 검토</p><h1>장착 구멍 좌표 비교</h1><p><span class="status">${escapeHtml(label(report.status))}</span> 기준 ${report.summary.total}개 · 일치 ${report.summary.pass} · 불일치 ${report.summary.fail} · 확인 불가 ${report.summary.unknown}</p><p class="notice">실물 장착 미검증 · 실제 보유 허브 미확인 · 제조 승인 아님</p>
<section><h2>비교 기준</h2><dl><dt>기준 제품</dt><dd>${escapeHtml(ref.source?.product_id || '확인 불가')}</dd><dt>자료 구분</dt><dd>제조사 기준 자료 (${escapeHtml(ref.source?.kind || '확인 불가')})</dd><dt>출처</dt><dd>${escapeHtml(ref.source?.evidence_ref || '확인 불가')}</dd><dt>단위 · 좌표계</dt><dd>${escapeHtml(ref.units || '확인 불가')} · ${escapeHtml(ref.coordinate_frame || '확인 불가')}</dd><dt>좌표 정의</dt><dd>${escapeHtml(ref.coordinate_basis || '확인 불가')}</dd><dt>비교 허용값</dt><dd>${format(ref.center_tolerance_mm)} mm — XY 거리 기준의 소프트웨어 비교값</dd><dt>최대 편차</dt><dd>${format(report.summary.max_deviation_mm)} mm</dd></dl></section>
<section><h2>구멍별 결과</h2><p>좌표·편차 단위: mm. 편차는 CAD 측정값 − 기준값입니다. 지정한 구멍 ID로만 연결하며 자동 위치 맞춤을 하지 않습니다.</p><div class="scroll"><table><thead><tr><th>기준 / CAD 구멍</th><th>기준 X, Y</th><th>측정 X, Y</th><th>편차 ΔX, ΔY</th><th>거리 편차</th><th>결과 / 근거</th><th>측정 면</th></tr></thead><tbody>${rows || '<tr><td colspan="7">비교할 기준 구멍이 없습니다.</td></tr>'}</tbody></table></div><p class="reason">${escapeHtml(reasonText(report.reason_codes))}</p></section><p>지원 범위: 수평 단일 판의 완전한 원통 구멍. 면 참조는 이번 CAD 실행의 형상을 가리킵니다. 하중·열·제조 공차 시험은 포함하지 않습니다.</p>${jsonFileName ? `<p><a href="${escapeHtml(encodeURIComponent(jsonFileName))}">원본 비교 JSON 보기</a></p>` : ''}</main></body></html>`;
}
