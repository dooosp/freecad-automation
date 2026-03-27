function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getRuleProfileDocContext(ruleProfile = null) {
  const pack = ruleProfile?.standards || {};
  const metadata = pack.report_metadata || {};
  return {
    label: metadata.profile_label || ruleProfile?.label || ruleProfile?.id || 'KS basic',
    document_note: metadata.document_note || 'Uses the default release standards metadata.',
    standards_reference: Array.isArray(metadata.standards_reference) ? metadata.standards_reference : [],
  };
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

function getProfileStandardDocPresets(siteProfile = {}) {
  const presets = siteProfile.standard_docs || {};
  return {
    profile_name: siteProfile.label || siteProfile.name || siteProfile.site?.name || 'default profile preset',
    owners: {
      process_owner: presets.owners?.process_owner || 'Production engineering',
      quality_owner: presets.owners?.quality_owner || 'Quality engineering',
      maintenance_owner: presets.owners?.maintenance_owner || 'Maintenance engineering',
      traceability_owner: presets.owners?.traceability_owner || 'Production engineering + MES',
      pfmea_owner: presets.owners?.pfmea_owner || 'Production engineering',
      work_instruction_owner: presets.owners?.work_instruction_owner || 'Production engineering',
    },
    frequencies: {
      default_control: presets.frequencies?.default_control || 'Launch + periodic audit',
      launch_control: presets.frequencies?.launch_control || 'Launch 100% + periodic audit',
      critical_dimension: presets.frequencies?.critical_dimension || 'Launch 100% then per control plan',
      torque_trace: presets.frequencies?.torque_trace || 'Every unit',
      barcode_pairing: presets.frequencies?.barcode_pairing || 'Every unit',
      eol_test: presets.frequencies?.eol_test || 'Every unit',
      visual_confirmation: presets.frequencies?.visual_confirmation || 'Per launch audit plan',
      checksheet_default: presets.frequencies?.checksheet_default || 'Launch 100% then per control plan',
    },
    responsibility_hints: {
      operator: presets.responsibility_hints?.operator || 'Operator confirms work sequence and abnormality escalation.',
      technician: presets.responsibility_hints?.technician || 'Technician restores station condition after downtime or setup change.',
      quality_engineer: presets.responsibility_hints?.quality_engineer || 'QE validates sampling relaxation and containment closure.',
      production_engineer: presets.responsibility_hints?.production_engineer || 'PE owns line-balance updates and launch countermeasures.',
    },
  };
}

function frequencyForCheckpoint(point = {}, profilePresets) {
  const text = `${point.control_method || ''} ${point.checkpoint || ''}`.toLowerCase();
  if (/launch_control|first_article/.test(text)) return profilePresets.frequencies.launch_control;
  if (/torque/.test(text)) return profilePresets.frequencies.torque_trace;
  if (/barcode|serial/.test(text)) return profilePresets.frequencies.barcode_pairing;
  if (/functional|electrical|eol/.test(text)) return profilePresets.frequencies.eol_test;
  if (/vision/.test(text)) return profilePresets.frequencies.visual_confirmation;
  if (/critical|dimension/.test(text)) return profilePresets.frequencies.critical_dimension;
  return profilePresets.frequencies.default_control;
}

function ownerForCheckpoint(point = {}, profilePresets) {
  const text = `${point.control_method || ''} ${point.checkpoint || ''}`.toLowerCase();
  if (/barcode|serial/.test(text)) return profilePresets.owners.traceability_owner;
  if (/torque|functional|electrical|eol/.test(text)) return `${profilePresets.owners.process_owner} + ${profilePresets.owners.quality_owner}`;
  return profilePresets.owners.quality_owner;
}

function ownerForRisk(risk = {}, profilePresets) {
  const text = `${risk.title || ''} ${risk.category || ''}`.toLowerCase();
  if (/traceability|barcode|serial/.test(text)) return profilePresets.owners.traceability_owner;
  if (/fixture|downtime|maintenance|test/.test(text)) return profilePresets.owners.maintenance_owner;
  return profilePresets.owners.pfmea_owner;
}

function deriveControlPlanRows(report, profilePresets) {
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
      frequency: frequencyForCheckpoint(point, profilePresets),
      reaction_plan: 'Hold suspect parts, notify production engineering / quality, and update the launch issue tracker.',
      owner: ownerForCheckpoint(point, profilePresets),
    });
  }

  if (report.quality_risk?.traceability_summary?.barcode_pairing_required) {
    rows.push({
      process_step: 'barcode / serial pairing',
      station_id: findStationIdByText(stations, 'barcode'),
      characteristic: 'housing / PCB / label serialization match',
      spec_or_target: '100% match with no manual override',
      control_method: 'scanner validation + MES pairing rule',
      frequency: profilePresets.frequencies.barcode_pairing,
      reaction_plan: 'Block release, quarantine the unit, and resolve pairing exception before EOL.',
      owner: profilePresets.owners.traceability_owner,
    });
  }

  return rows;
}

function deriveInspectionChecksheetRows(report, profilePresets, ruleProfileDoc) {
  const criticalDimensions = report.quality_risk?.critical_dimensions || [];
  const checkpoints = report.process_plan?.key_inspection_points || [];

  const rows = criticalDimensions.map((dimension) => ({
    checkpoint: dimension.name,
    target: dimension.target_mm ?? '',
    tolerance: dimension.tolerance || 'See drawing',
    method: 'Gauge / caliper / fixture check',
    sample_size: profilePresets.frequencies.critical_dimension,
    judgement_rule: 'Accept only when inside target and tolerance band',
    remarks: `Draft generated planning aid. Profile preset: ${profilePresets.profile_name}. Rule profile: ${ruleProfileDoc.label}.`,
  }));

  for (const checkpoint of checkpoints) {
    if (rows.some((row) => row.checkpoint === checkpoint.checkpoint)) continue;
    rows.push({
      checkpoint: checkpoint.checkpoint,
      target: 'See specification / test criterion',
      tolerance: 'No deviation allowed',
      method: checkpoint.control_method || 'operator confirmation',
      sample_size: frequencyForCheckpoint(checkpoint, profilePresets),
      judgement_rule: 'Accept only when confirmation record is complete',
      remarks: `Draft generated planning aid. Responsibility follows ${profilePresets.profile_name} preset. Standards: ${ruleProfileDoc.standards_reference.join(', ') || ruleProfileDoc.label}.`,
    });
  }

  return rows;
}

function derivePfmeaRows(report, profilePresets) {
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
      recommended_action: `[Owner: ${ownerForRisk(risk, profilePresets)}] ${risk.recommendation || 'Confirm containment and standard work before release'}`,
      follow_up_role: ownerForRisk(risk, profilePresets),
    }))
    .filter((row) => {
      if (seen.has(row.failure_mode)) return false;
      seen.add(row.failure_mode);
      return true;
    })
    .slice(0, 24);
}

function renderProcessFlowMarkdown(report, profilePresets, ruleProfileDoc) {
  const steps = report.process_plan?.process_flow || [];
  const stations = report.line_plan?.station_concept || [];
  const lines = [
    '# Process Flow Draft',
    '',
    '> Draft / generated planning aid. Requires production-engineering review before controlled use.',
    '',
    `Part: ${report.part?.name || 'unknown'}`,
    `Profile preset: ${profilePresets.profile_name}`,
    `Rule profile: ${ruleProfileDoc.label}`,
    `Standards reference: ${ruleProfileDoc.standards_reference.join(', ') || 'Project default'}`,
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

function renderWorkInstructionMarkdown(report, profilePresets, ruleProfileDoc) {
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
    `Profile preset: ${profilePresets.profile_name}`,
    `Rule profile: ${ruleProfileDoc.label}`,
    `Standards reference: ${ruleProfileDoc.standards_reference.join(', ') || 'Project default'}`,
    `Rule note: ${ruleProfileDoc.document_note}`,
    '',
    '## Responsibility Assumptions',
    '',
    `- Work instruction owner: ${profilePresets.owners.work_instruction_owner}`,
    `- Operator hint: ${profilePresets.responsibility_hints.operator}`,
    `- Technician hint: ${profilePresets.responsibility_hints.technician}`,
    `- Quality engineer hint: ${profilePresets.responsibility_hints.quality_engineer}`,
    `- Production engineer hint: ${profilePresets.responsibility_hints.production_engineer}`,
    '',
  ];

  for (const station of stations) {
    const relatedTraceability = traceabilityPoints.filter((point) => point.station_id === station.station_id);
    const relatedCheckpoints = checkpoints.filter((checkpoint) => findStationIdByText(stations, checkpoint.checkpoint) === station.station_id);
    const relatedRisks = risks
      .filter((risk) => {
        const title = (risk.title || '').toLowerCase();
        return title.includes(station.station_name.toLowerCase().split(' ')[0]) || (title.includes('connector') && /connector/i.test(station.station_name));
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
    lines.push(`- Responsibility note: ${/barcode|serial/i.test(station.station_name) ? profilePresets.owners.traceability_owner : profilePresets.owners.process_owner} supports this station under the current site preset.`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function createStandardDocTemplateService() {
  return function generateStandardDocs(report, options = {}) {
    const profilePresets = getProfileStandardDocPresets(options.siteProfile || {});
    const ruleProfileDoc = getRuleProfileDocContext(options.ruleProfile || null);
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
      'follow_up_role',
    ];

    return {
      'process_flow.md': renderProcessFlowMarkdown(report, profilePresets, ruleProfileDoc),
      'control_plan_draft.csv': renderCsv(controlPlanColumns, deriveControlPlanRows(report, profilePresets)),
      'inspection_checksheet_draft.csv': renderCsv(inspectionColumns, deriveInspectionChecksheetRows(report, profilePresets, ruleProfileDoc)),
      'work_instruction_draft.md': renderWorkInstructionMarkdown(report, profilePresets, ruleProfileDoc),
      'pfmea_seed.csv': renderCsv(pfmeaColumns, derivePfmeaRows(report, profilePresets)),
    };
  };
}
