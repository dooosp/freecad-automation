function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(columns, rows) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','));
  return `${[header, ...body].join('\n')}\n`;
}

function findStationIdByText(stations = [], text = '') {
  const normalized = text.toLowerCase();
  const directMatch = stations.find((station) => station.station_name.toLowerCase().includes(normalized));
  if (directMatch) return directMatch.station_id;

  if (/torque/i.test(text)) return stations.find((station) => /torque/i.test(station.station_name))?.station_id || '';
  if (/barcode|serial/i.test(text)) return stations.find((station) => /barcode/i.test(station.station_name))?.station_id || '';
  if (/connector/i.test(text)) return stations.find((station) => /connector/i.test(station.station_name))?.station_id || '';
  if (/vision/i.test(text)) return stations.find((station) => /vision/i.test(station.station_name))?.station_id || '';
  if (/electrical|functional/i.test(text)) return stations.find((station) => /eol electrical|functional fit/i.test(station.station_name))?.station_id || '';
  if (/gasket|seal/i.test(text)) return stations.find((station) => /gasket|seal/i.test(station.station_name))?.station_id || '';
  return stations.find((station) => /inspection/i.test(station.station_name))?.station_id || stations[0]?.station_id || '';
}

function deriveControlPlanRows(report) {
  const stations = report.line_plan?.station_concept || [];
  const criticalDimensions = report.quality_risk?.critical_dimensions || [];
  const keyInspectionPoints = report.process_plan?.key_inspection_points || [];
  const rows = [];

  for (const point of keyInspectionPoints) {
    const matchedDimension = criticalDimensions.find((dimension) => dimension.name === point.checkpoint);
    rows.push({
      process_step: point.checkpoint,
      station_id: findStationIdByText(stations, point.checkpoint),
      characteristic: point.checkpoint,
      spec_or_target: matchedDimension?.target_mm !== null && matchedDimension?.target_mm !== undefined
        ? `${matchedDimension.target_mm} ${matchedDimension.tolerance || ''}`.trim()
        : matchedDimension?.tolerance || 'See engineering specification',
      control_method: point.control_method || 'operator confirmation',
      frequency: /every_unit|barcode|torque|functional/i.test(point.control_method || point.checkpoint) ? 'Every unit' : 'Launch + periodic audit',
      reaction_plan: 'Hold suspect parts, notify production engineering / quality, and update the launch issue tracker.',
      owner: /torque|barcode|functional/i.test(point.checkpoint) ? 'Production engineering + quality' : 'Quality engineering',
    });
  }

  if ((report.quality_risk?.traceability_summary?.barcode_pairing_required)) {
    rows.push({
      process_step: 'barcode / serial pairing',
      station_id: findStationIdByText(stations, 'barcode'),
      characteristic: 'housing / PCB / label serialization match',
      spec_or_target: '100% match with no manual override',
      control_method: 'scanner validation + MES pairing rule',
      frequency: 'Every unit',
      reaction_plan: 'Block release, quarantine the unit, and resolve pairing exception before EOL.',
      owner: 'Production engineering + IT/MES',
    });
  }

  return rows;
}

function deriveInspectionChecksheetRows(report) {
  const criticalDimensions = report.quality_risk?.critical_dimensions || [];
  const checkpoints = report.process_plan?.key_inspection_points || [];

  const rows = criticalDimensions.map((dimension) => ({
    checkpoint: dimension.name,
    target: dimension.target_mm ?? '',
    tolerance: dimension.tolerance || 'See drawing',
    method: 'Gauge / caliper / fixture check',
    sample_size: 'Launch 100% then per control plan',
    judgement_rule: 'Accept only when inside target and tolerance band',
    remarks: 'Draft generated planning aid. Engineering review required.',
  }));

  for (const checkpoint of checkpoints) {
    if (rows.some((row) => row.checkpoint === checkpoint.checkpoint)) continue;
    rows.push({
      checkpoint: checkpoint.checkpoint,
      target: 'See specification / test criterion',
      tolerance: 'No deviation allowed',
      method: checkpoint.control_method || 'operator confirmation',
      sample_size: /every_unit|barcode|torque|functional/i.test(checkpoint.control_method || checkpoint.checkpoint) ? 'Every unit' : 'Per launch audit plan',
      judgement_rule: 'Accept only when confirmation record is complete',
      remarks: 'Draft generated planning aid. Engineering review required.',
    });
  }

  return rows;
}

function derivePfmeaRows(report) {
  const gates = report.quality_risk?.quality_gates || [];
  const controls = report.process_plan?.key_inspection_points || [];
  const bottlenecks = report.line_plan?.station_concept || [];
  const risks = [
    ...(report.product_review?.risk_items || []),
    ...(report.quality_risk?.quality_risks || []),
    ...bottlenecks
      .filter((station) => station.bottleneck_confidence?.level === 'high' || station.bottleneck_candidate_note.startsWith('Candidate bottleneck'))
      .map((station) => ({
        title: `${station.station_name} launch bottleneck`,
        recommendation: station.improvement_candidates?.[0] || station.bottleneck_candidate_note,
        category: 'line_launch',
      })),
  ];

  const seen = new Set();
  return risks
    .map((risk) => ({
      process_step: findStationIdByText(report.line_plan?.station_concept || [], risk.title || risk.category || '') || 'Review required',
      failure_mode: risk.title || risk.category || 'Potential manufacturing failure mode',
      effect: risk.effect || 'Launch disruption, defect escape, or traceability loss',
      likely_cause: risk.source || risk.category || 'To be confirmed during PFMEA workshop',
      current_control: controls[0]?.control_method || gates[0]?.name || 'Generated seed only; current control requires engineering review',
      recommended_action: risk.recommendation || 'Confirm containment and standard work before release',
    }))
    .filter((row) => {
      if (seen.has(row.failure_mode)) return false;
      seen.add(row.failure_mode);
      return true;
    })
    .slice(0, 24);
}

function renderProcessFlowMarkdown(report) {
  const steps = report.process_plan?.process_flow || [];
  const stations = report.line_plan?.station_concept || [];
  const lines = [
    '# Process Flow Draft',
    '',
    '> Draft / generated planning aid. Requires production-engineering review before controlled use.',
    '',
    `Part: ${report.part?.name || 'unknown'}`,
    '',
    '| Step | Process Step | Station Purpose | Key Output | Manual/Auto Mode |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const step of steps) {
    const station = stations.find((item) => item.station_id === `ST${String(step.step).padStart(2, '0')}`) || {};
    lines.push(`| ${step.step} | ${step.operation} | ${station.station_purpose || step.purpose} | ${step.key_output || 'part progression'} | ${step.mode || 'manual'} |`);
  }

  return `${lines.join('\n')}\n`;
}

function renderWorkInstructionMarkdown(report) {
  const stations = report.line_plan?.station_concept || [];
  const traceabilityPoints = report.line_plan?.traceability_capture_points || [];
  const checkpoints = report.process_plan?.key_inspection_points || [];
  const risks = [
    ...(report.product_review?.risk_items || []),
    ...(report.quality_risk?.quality_risks || []),
  ];
  const lines = [
    '# Work Instruction Draft',
    '',
    '> Draft / generated planning aid. Requires production-engineering review before release to operators.',
    '',
    `Part: ${report.part?.name || 'unknown'}`,
    '',
  ];

  for (const station of stations) {
    const relatedTraceability = traceabilityPoints.filter((point) => point.station_id === station.station_id);
    const relatedCheckpoints = checkpoints.filter((checkpoint) => findStationIdByText(stations, checkpoint.checkpoint) === station.station_id);
    const relatedRisks = risks
      .filter((risk) => {
        const title = (risk.title || '').toLowerCase();
        return title.includes(station.station_name.toLowerCase().split(' ')[0]) || title.includes('connector') && /connector/i.test(station.station_name);
      })
      .slice(0, 3);

    lines.push(`## ${station.station_id} ${station.station_name}`);
    lines.push('');
    lines.push(`- Station overview: ${station.station_purpose}`);
    lines.push(`- Input material / part: ${report.part?.name || 'part under review'}`);
    lines.push(`- Key tasks: ${(station.grouped_processes || []).join(', ') || station.station_name}`);
    lines.push(`- Caution points: ${relatedRisks.map((risk) => risk.title).join('; ') || 'Confirm standard work, ergonomics, and change-point control.'}`);
    lines.push(`- Quality checkpoints: ${relatedCheckpoints.map((checkpoint) => checkpoint.checkpoint).join('; ') || 'Follow line-plan inspection strategy for this station.'}`);
    lines.push(`- Traceability capture items: ${relatedTraceability.map((point) => point.data_capture).join('; ') || 'No dedicated traceability capture beyond normal lot control.'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function createStandardDocTemplateService() {
  return function generateStandardDocs(report) {
    const controlPlanColumns = [
      'process_step',
      'station_id',
      'characteristic',
      'spec_or_target',
      'control_method',
      'frequency',
      'reaction_plan',
      'owner',
    ];
    const inspectionColumns = [
      'checkpoint',
      'target',
      'tolerance',
      'method',
      'sample_size',
      'judgement_rule',
      'remarks',
    ];
    const pfmeaColumns = [
      'process_step',
      'failure_mode',
      'effect',
      'likely_cause',
      'current_control',
      'recommended_action',
    ];

    return {
      'process_flow.md': renderProcessFlowMarkdown(report),
      'control_plan_draft.csv': renderCsv(controlPlanColumns, deriveControlPlanRows(report)),
      'inspection_checksheet_draft.csv': renderCsv(inspectionColumns, deriveInspectionChecksheetRows(report)),
      'work_instruction_draft.md': renderWorkInstructionMarkdown(report),
      'pfmea_seed.csv': renderCsv(pfmeaColumns, derivePfmeaRows(report)),
    };
  };
}
