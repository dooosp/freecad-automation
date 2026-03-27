import {
  connectorClearanceMm,
  deriveOverallRiskLevel,
  extractAssemblyMetadata,
  extractCriticalDimensions,
  extractFeatureCounts,
  extractFunctionalTestPoints,
  fasteningStrategy,
  getPartIdentity,
  getProductionTargets,
  summarizeActions,
  topIssueTitles,
  traceabilityLabelArea,
} from './common.js';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function classifyInspectionMode(step) {
  if (/eol electrical|functional fit|functional confirmation/i.test(step.operation)) return 'end_of_line';
  if (/inspection|torque verification|barcode pairing|connector fit|connector seating|vision/i.test(step.operation)) {
    return 'in_line';
  }
  return 'not_primary';
}

function stationPurpose(step) {
  if (/incoming/i.test(step.operation)) return 'Receive material, confirm lot/revision, and prepare kits.';
  if (/machining|laser|forming|build|trim/i.test(step.operation)) return 'Create or stabilize the manufacturable geometry.';
  if (/pcb loading/i.test(step.operation)) return 'Load and protect PCB / electronics content before joining and fastening.';
  if (/connector/i.test(step.operation)) return 'Verify connector seating, side access, and mating stability.';
  if (/gasket|sealing/i.test(step.operation)) return 'Protect sealing integrity and visual completeness before closure.';
  if (/torque/i.test(step.operation)) return 'Control fastening sequence and capture torque trace evidence.';
  if (/barcode/i.test(step.operation)) return 'Capture serialization and maintain traceability linkage.';
  if (/vision/i.test(step.operation)) return 'Run vision-based completeness or alignment confirmation.';
  if (/eol electrical/i.test(step.operation)) return 'Confirm functional release and protect fixture / probe access.';
  if (/functional fit/i.test(step.operation)) return 'Verify downstream install fit and cosmetic / handling release.';
  if (/fixture load/i.test(step.operation)) return 'Stabilize nest loading, unload sequence, and operator posture.';
  if (/inspection/i.test(step.operation)) return 'Capture dimensional evidence and launch quality data.';
  if (/packaging/i.test(step.operation)) return 'Protect the part and preserve traceability for downstream flow.';
  return step.purpose || 'Advance the part through the planned line sequence.';
}

function skillSensitivity(step, connectorClearance, fasteningText, assemblyMeta) {
  if (/packaging|incoming/i.test(step.operation)) return 'low';
  if (/inspection|barcode|vision/i.test(step.operation)) return 'medium';
  if (/connector|pcb loading|torque|fixture load|eol electrical/i.test(step.operation)) return 'high';
  if (connectorClearance > 0 && connectorClearance < 5) return 'high';
  if (assemblyMeta.fixture_load_sensitivity === 'high' && /functional fit|eol electrical/i.test(step.operation)) {
    return 'high';
  }
  if (/manual/i.test(fasteningText)) return 'medium';
  return 'medium';
}

function buildStationConcept({
  processFlow = [],
  targetCtSec = 45,
  connectorClearance = 0,
  fasteningText = '',
  assemblyMeta = {},
}) {
  return processFlow.map((step, index) => {
    const cycleMultiplier = step.mode === 'auto_capable' ? 0.85 : step.mode === 'semi_auto' ? 1.0 : 1.15;
    const inspectionMode = classifyInspectionMode(step);
    const stationName = step.operation.replace(/\//g, ' / ');
    const skill = skillSensitivity(step, connectorClearance, fasteningText, assemblyMeta);
    const bottleneckCandidate = (
      /inspection|torque|barcode|vision|connector|eol electrical|fixture load/i.test(step.operation)
      || (/manual/i.test(fasteningText) && /feature|assembly|preparation|functional fit/i.test(step.operation))
      || (connectorClearance > 0 && connectorClearance < 5 && /machining|feature|assembly|inspection|connector/i.test(step.operation))
    );

    return {
      station_id: `ST${String((index + 1) * 10).padStart(2, '0')}`,
      station_name: stationName,
      station_purpose: stationPurpose(step),
      mode: step.mode,
      manual_automatic_classification: step.mode,
      grouped_processes: [step.operation],
      inspection_strategy: inspectionMode,
      cycle_time_placeholder_sec: Number((targetCtSec * cycleMultiplier).toFixed(1)),
      traceability_capture: inspectionMode !== 'not_primary' || /incoming|packaging|barcode/i.test(step.operation),
      bottleneck_candidate_note: bottleneckCandidate
        ? 'Candidate bottleneck under launch conditions; verify staffing, fixture loading, and data capture time.'
        : 'No immediate bottleneck signal from the current rule set.',
      operator_skill_sensitivity: skill,
      rework_repair_path: /inspection|torque|barcode|vision|eol electrical/i.test(step.operation)
        ? 'Escalate failures to offline repair / containment review.'
        : 'Upstream correction before release to next station.',
      heuristic_basis: 'Rule-based preliminary line-support output, not a detailed time study.',
    };
  });
}

function normalizeRuntimeStations(runtimeData = {}) {
  const source = runtimeData || {};
  const stations = Array.isArray(runtimeData)
    ? runtimeData
    : Array.isArray(source.stations)
      ? source.stations
      : Array.isArray(source.station_runtime)
        ? source.station_runtime
        : [];

  return stations
    .filter((station) => station && station.station_id)
    .map((station) => ({
      station_id: station.station_id,
      actual_ct_sec: toNumber(station.actual_ct_sec, null),
      target_ct_sec: toNumber(station.target_ct_sec, null),
      fpy: toNumber(station.fpy, null),
      rework_rate: toNumber(station.rework_rate, null),
      scrap_rate: toNumber(station.scrap_rate, null),
      downtime_pct: toNumber(station.downtime_pct, null),
      operator_count: toNumber(station.operator_count, null),
      changeover_time_sec: toNumber(station.changeover_time_sec, null),
    }));
}

function getRuntimeThresholds(siteProfile = {}, targets = {}) {
  const line = siteProfile.line || {};
  return {
    target_fpy: toNumber(line.target_fpy, 0.98),
    max_rework_rate: toNumber(line.max_rework_rate, 0.02),
    max_scrap_rate: toNumber(line.max_scrap_rate, 0.005),
    max_downtime_pct: toNumber(line.max_downtime_pct, 6),
    changeover_guardrail_sec: toNumber(line.changeover_guardrail_sec, 420),
    line_target_ct_sec: toNumber(line.target_ct_sec, targets.target_ct_sec || 45),
  };
}

function buildRuntimeEnrichment({ station, runtimeEntry, thresholds, assemblyMeta }) {
  if (!runtimeEntry) {
    return {
      actual_vs_target_ct: null,
      actual_ct_gap_sec: null,
      bottleneck_confidence: {
        level: station.bottleneck_candidate_note.startsWith('Candidate bottleneck') ? 'medium' : 'low',
        score: station.bottleneck_candidate_note.startsWith('Candidate bottleneck') ? 0.35 : 0.15,
        basis: 'heuristic_only',
      },
      launch_instability_signals: [],
      likely_root_causes: [],
      improvement_candidates: [],
      runtime_indicators: null,
      evidence_basis: 'heuristic_only',
    };
  }

  const targetCt = runtimeEntry.target_ct_sec ?? station.cycle_time_placeholder_sec ?? thresholds.line_target_ct_sec;
  const actualCt = runtimeEntry.actual_ct_sec ?? targetCt;
  const actualVsTarget = targetCt > 0 ? Number((actualCt / targetCt).toFixed(2)) : null;
  const actualCtGap = Number((actualCt - targetCt).toFixed(1));
  const signals = [];
  const rootCauses = [];
  const improvements = [];
  let confidenceScore = 0.2;

  if (actualCtGap > 1.5) {
    signals.push(`Actual CT is ${actualCtGap.toFixed(1)}s above target.`);
    confidenceScore += 0.22;
    improvements.push('Rebalance manual content or split the work across launch staffing until the cycle stabilizes.');
  }
  if (runtimeEntry.downtime_pct !== null && runtimeEntry.downtime_pct > thresholds.max_downtime_pct) {
    signals.push(`Downtime ${runtimeEntry.downtime_pct.toFixed(1)}% is above the site guardrail.`);
    confidenceScore += 0.2;
    rootCauses.push('Fixture readiness, equipment debug, or scan/test retries are likely affecting availability.');
    improvements.push('Review fixture debug, barcode / probe retry logic, and changeover recovery checklist.');
  }
  if (runtimeEntry.fpy !== null && runtimeEntry.fpy < thresholds.target_fpy) {
    signals.push(`FPY ${runtimeEntry.fpy.toFixed(3)} is below the site target ${thresholds.target_fpy.toFixed(3)}.`);
    confidenceScore += 0.2;
    rootCauses.push('Launch escapes or unstable standard work are still driving first-pass loss.');
    improvements.push('Tighten containment, confirm standard work, and review top defect pareto before the next ramp lot.');
  }
  if (runtimeEntry.rework_rate !== null && runtimeEntry.rework_rate > thresholds.max_rework_rate) {
    signals.push(`Rework rate ${runtimeEntry.rework_rate.toFixed(3)} exceeds the launch target.`);
    confidenceScore += 0.15;
    rootCauses.push('Operator retraining or station-level error proofing is likely still incomplete.');
    improvements.push('Add layered audit checks and review poka-yoke coverage for the repeated defect mode.');
  }
  if (runtimeEntry.scrap_rate !== null && runtimeEntry.scrap_rate > thresholds.max_scrap_rate) {
    signals.push(`Scrap rate ${runtimeEntry.scrap_rate.toFixed(3)} is above the guardrail.`);
    confidenceScore += 0.12;
    rootCauses.push('Containment boundary may be late or fixture damage is creating irreversible defects.');
    improvements.push('Move defect capture earlier and verify fixture contact surfaces / seal condition.');
  }
  if (runtimeEntry.changeover_time_sec !== null && runtimeEntry.changeover_time_sec > thresholds.changeover_guardrail_sec) {
    signals.push(`Changeover time ${runtimeEntry.changeover_time_sec.toFixed(0)}s is above the site guardrail.`);
    confidenceScore += 0.1;
    rootCauses.push('Tool preset, recipe swap, or material presentation is slowing restart.');
    improvements.push('Standardize recipe preset, kit staging, and startup confirmation for the station.');
  }
  if (runtimeEntry.operator_count !== null && runtimeEntry.operator_count >= 2 && actualCtGap > 0) {
    rootCauses.push('Additional operators are not yet offsetting the manual content and station interference.');
  }
  if (/connector/i.test(station.station_name) && assemblyMeta.requires_connector_seating_confirmation) {
    rootCauses.push('Connector alignment, mating force, or access clearance may be extending station time.');
    improvements.push('Add guide features or visual seating confirmation near the connector fit station.');
  }
  if (/torque/i.test(station.station_name) && assemblyMeta.requires_torque_control) {
    rootCauses.push('Torque trace retries or tool calibration drift may be driving launch instability.');
    improvements.push('Verify torque tool calibration, rundown window, and trace upload latency.');
  }
  if (/barcode/i.test(station.station_name) && assemblyMeta.requires_barcode_pairing) {
    rootCauses.push('Serialization mismatch or scan readability loss can create holding and rework loops.');
    improvements.push('Review code contrast, scan angle, and pairing exception handling.');
  }
  if (/vision/i.test(station.station_name) && assemblyMeta.requires_vision_confirmation) {
    rootCauses.push('Vision recipe sensitivity or false-call tuning may be adding cycle and downtime loss.');
    improvements.push('Tune recipe thresholds against launch golden samples and revalidate false-call rate.');
  }
  if (/eol electrical/i.test(station.station_name) && assemblyMeta.requires_eol_electrical_test) {
    rootCauses.push('Probe access, fixture clamping, or retest logic may be dominating the EOL station loss.');
    improvements.push('Shorten fixture load steps and isolate probe / communication failures from product failures.');
  }

  const uniqueRootCauses = [...new Set(rootCauses)].slice(0, 4);
  const uniqueImprovements = [...new Set(improvements)].slice(0, 4);
  const level = confidenceScore >= 0.65 ? 'high' : confidenceScore >= 0.4 ? 'medium' : 'low';

  return {
    actual_vs_target_ct: actualVsTarget,
    actual_ct_gap_sec: actualCtGap,
    bottleneck_confidence: {
      level,
      score: Number(Math.min(confidenceScore, 0.95).toFixed(2)),
      basis: 'runtime_informed',
    },
    launch_instability_signals: signals,
    likely_root_causes: uniqueRootCauses,
    improvement_candidates: uniqueImprovements,
    runtime_indicators: {
      actual_ct_sec: actualCt,
      target_ct_sec: targetCt,
      fpy: runtimeEntry.fpy,
      rework_rate: runtimeEntry.rework_rate,
      scrap_rate: runtimeEntry.scrap_rate,
      downtime_pct: runtimeEntry.downtime_pct,
      operator_count: runtimeEntry.operator_count,
      changeover_time_sec: runtimeEntry.changeover_time_sec,
    },
    evidence_basis: 'runtime_informed',
  };
}

function summarizeRuntime(stationConcept = [], runtimeStations = [], thresholds = {}) {
  const enrichedStations = stationConcept.filter((station) => station.runtime_indicators);
  if (enrichedStations.length === 0) {
    return {
      runtime_informed: false,
      runtime_station_count: 0,
      line_target_ct_sec: thresholds.line_target_ct_sec || null,
      stations_over_target: [],
      highest_gap_station_id: null,
      highest_gap_sec: null,
      average_fpy: null,
      average_downtime_pct: null,
    };
  }

  const stationsOverTarget = enrichedStations
    .filter((station) => (station.actual_ct_gap_sec ?? 0) > 0)
    .map((station) => station.station_id);
  const highestGapStation = enrichedStations
    .slice()
    .sort((left, right) => (right.actual_ct_gap_sec ?? -999) - (left.actual_ct_gap_sec ?? -999))[0];
  const avgFpy = enrichedStations
    .map((station) => station.runtime_indicators?.fpy)
    .filter((value) => value !== null && value !== undefined);
  const avgDowntime = enrichedStations
    .map((station) => station.runtime_indicators?.downtime_pct)
    .filter((value) => value !== null && value !== undefined);

  return {
    runtime_informed: true,
    runtime_station_count: runtimeStations.length,
    line_target_ct_sec: thresholds.line_target_ct_sec || null,
    stations_over_target: stationsOverTarget,
    highest_gap_station_id: highestGapStation?.station_id || null,
    highest_gap_sec: highestGapStation?.actual_ct_gap_sec ?? null,
    average_fpy: avgFpy.length > 0
      ? Number((avgFpy.reduce((sum, value) => sum + value, 0) / avgFpy.length).toFixed(3))
      : null,
    average_downtime_pct: avgDowntime.length > 0
      ? Number((avgDowntime.reduce((sum, value) => sum + value, 0) / avgDowntime.length).toFixed(2))
      : null,
  };
}

export function createLineLayoutAgent() {
  return async function runLineLayoutAgent({
    config,
    processPlan,
    runtimeData = null,
    siteProfile = null,
  }) {
    const part = getPartIdentity(config);
    const targets = getProductionTargets(config);
    const assemblyMeta = extractAssemblyMetadata(config);
    const connectorClearance = connectorClearanceMm(config);
    const fasteningText = fasteningStrategy(config);
    const featureCounts = extractFeatureCounts(config);
    const criticalDimensions = extractCriticalDimensions(config);
    const functionalTestPoints = extractFunctionalTestPoints(config);
    const runtimeStations = normalizeRuntimeStations(runtimeData);
    const thresholds = getRuntimeThresholds(siteProfile || {}, targets);
    const runtimeMap = new Map(runtimeStations.map((station) => [station.station_id, station]));

    const stationConcept = buildStationConcept({
      processFlow: processPlan?.process_flow || [],
      targetCtSec: targets.target_ct_sec || thresholds.line_target_ct_sec || 45,
      connectorClearance,
      fasteningText,
      assemblyMeta,
    }).map((station) => ({
      ...station,
      ...buildRuntimeEnrichment({
        station,
        runtimeEntry: runtimeMap.get(station.station_id),
        thresholds,
        assemblyMeta,
      }),
    }));

    const inspectionStations = stationConcept
      .filter((station) => station.inspection_strategy !== 'not_primary')
      .map((station) => ({
        station_id: station.station_id,
        suggestion: station.inspection_strategy === 'in_line'
          ? 'Use this station for in-line dimensional evidence and traceability capture.'
          : 'Reserve this point for end-of-line confirmation or functional release.',
      }));

    const autoCount = stationConcept.filter((station) => station.mode === 'auto_capable').length;
    const manualCount = stationConcept.filter((station) => station.mode === 'manual').length;
    const semiAutoCount = stationConcept.length - autoCount - manualCount;
    const denominator = Math.max(stationConcept.length, 1);

    const prioritizedStations = stationConcept
      .filter((station) => station.bottleneck_confidence?.level !== 'low' || station.bottleneck_candidate_note.startsWith('Candidate bottleneck'))
      .slice()
      .sort((left, right) => (right.bottleneck_confidence?.score ?? 0) - (left.bottleneck_confidence?.score ?? 0));

    const bottleneckCandidateNotes = prioritizedStations.map((station) => {
      if (station.evidence_basis === 'runtime_informed' && station.actual_ct_gap_sec !== null) {
        return `${station.station_id} ${station.station_name}: actual CT gap ${station.actual_ct_gap_sec.toFixed(1)}s, confidence ${station.bottleneck_confidence.level}.`;
      }
      return `${station.station_id} ${station.station_name}: ${station.bottleneck_candidate_note}`;
    });

    const traceabilityCapturePoints = stationConcept
      .filter((station) => station.traceability_capture)
      .map((station) => ({
        station_id: station.station_id,
        station_name: station.station_name,
        data_capture: /barcode/i.test(station.station_name)
          ? 'serial pairing + operator result + timestamp'
          : station.inspection_strategy === 'not_primary'
            ? 'lot/revision handoff'
            : 'inspection + revision + operator result',
      }));

    const operatorSkillSensitivityNotes = stationConcept
      .filter((station) => station.operator_skill_sensitivity !== 'low')
      .map((station) => `${station.station_id} ${station.station_name} is ${station.operator_skill_sensitivity}-sensitivity due to access, inspection, or setup dependence.`);

    const inlineInspectionStations = stationConcept
      .filter((station) => station.inspection_strategy === 'in_line')
      .map((station) => station.station_id);

    const explicitEolStations = stationConcept
      .filter((station) => station.inspection_strategy === 'end_of_line')
      .map((station) => station.station_id);
    const eolInspectionStations = explicitEolStations.length > 0
      ? explicitEolStations
      : functionalTestPoints.length > 0
        ? ['EOL-FT']
        : [];

    const reworkRepairStation = {
      suggested: criticalDimensions.length > 0 || bottleneckCandidateNotes.length > 0,
      station_name: 'Offline containment / rework review',
      rationale: 'Provides a controlled path for launch-phase defects without stopping the main flow.',
    };

    const lineRisks = prioritizedStations.map((station) => ({
      severity: station.bottleneck_confidence?.level === 'high' ? 'high' : 'medium',
      title: `${station.station_id} ${station.station_name}: ${station.launch_instability_signals?.[0] || station.bottleneck_candidate_note}`,
    }));

    const runtimeSummary = summarizeRuntime(stationConcept, runtimeStations, thresholds);

    return {
      schema_version: '0.1',
      agent: 'line_layout_support',
      part,
      summary: {
        overall_risk_level: deriveOverallRiskLevel(lineRisks),
        top_issues: topIssueTitles(lineRisks, 3),
        recommended_actions: summarizeActions([
          'Separate in-line dimensional checks from end-of-line release logic.',
          bottleneckCandidateNotes.length > 0 ? 'Review staffing and fixture loading at bottleneck-candidate stations.' : null,
          `Define traceability label area and scan point near ${traceabilityLabelArea(config)}.`,
          assemblyMeta.requires_eol_electrical_test ? 'Protect EOL fixture load/unload time and retest routing as explicit launch controls.' : null,
          functionalTestPoints.length > 0 ? 'Reserve an end-of-line functional confirmation point for electronics-related checks.' : null,
        ]),
        likely_bottleneck_candidates: bottleneckCandidateNotes.slice(0, 4),
        likely_traceability_capture_points: traceabilityCapturePoints.map((point) => point.station_id).slice(0, 5),
        heuristics_notice: runtimeSummary.runtime_informed
          ? 'Line support output combines heuristic station design with supplied runtime indicators; validate before committing plant standards.'
          : 'Line support output is assumption-based and intended for preliminary production-engineering review.',
      },
      station_concept: stationConcept,
      station_list: stationConcept.map((station) => ({
        station_id: station.station_id,
        station_name: station.station_name,
        station_purpose: station.station_purpose,
        manual_automatic_classification: station.manual_automatic_classification,
      })),
      manual_automatic_split: {
        manual_ratio: Number((manualCount / denominator).toFixed(2)),
        semi_auto_ratio: Number((semiAutoCount / denominator).toFixed(2)),
        auto_capable_ratio: Number((autoCount / denominator).toFixed(2)),
      },
      cycle_time_assumptions: {
        target_ct_sec: targets.target_ct_sec || thresholds.line_target_ct_sec || 45,
        estimated_balance_loss_pct: targets.launch_sites.length > 1 ? 12 : 8,
        bottleneck_station_ct_sec: stationConcept.length > 0
          ? Math.max(...stationConcept.map((station) => station.runtime_indicators?.actual_ct_sec ?? station.cycle_time_placeholder_sec))
          : targets.target_ct_sec || thresholds.line_target_ct_sec || 45,
        actual_line_ct_sec: runtimeSummary.runtime_informed
          ? Math.max(...stationConcept.map((station) => station.runtime_indicators?.actual_ct_sec ?? 0))
          : null,
        note: runtimeSummary.runtime_informed
          ? 'Target values remain planning placeholders; actual comparisons reflect the supplied runtime file.'
          : 'Cycle-time values are placeholders for planning discussion, not simulation outputs.',
      },
      inspection_station_suggestions: inspectionStations,
      inspection_split: {
        in_line_inspection_stations: inlineInspectionStations,
        end_of_line_inspection_stations: eolInspectionStations,
      },
      bottleneck_candidate_notes: bottleneckCandidateNotes,
      traceability_capture_points: traceabilityCapturePoints,
      rework_repair_station: reworkRepairStation,
      operator_skill_sensitivity_notes: operatorSkillSensitivityNotes,
      runtime_summary: runtimeSummary,
      line_engineering_assumptions: {
        target_ct_sec: targets.target_ct_sec || thresholds.line_target_ct_sec || 45,
        connector_side_clearance_mm: connectorClearance,
        fastening_strategy: fasteningText,
        critical_dimension_count: criticalDimensions.length,
        feature_counts: featureCounts,
        assembly_metadata: assemblyMeta.is_electronics_assembly ? assemblyMeta : null,
        site_profile: siteProfile
          ? {
              name: siteProfile.name || siteProfile.label || siteProfile.site?.name || null,
              line: siteProfile.line || {},
            }
          : null,
      },
      layout_review_notes: [
        'Separate incoming/kitting from dimensional verification to simplify launch ownership.',
        targets.launch_sites.length > 1
          ? 'Prepare mirrored station standards for overseas rollout.'
          : 'Single-site rollout still benefits from common work and gauge packs.',
        'Use station grouping as an initial line concept before detailed PFEP and manpower balancing.',
        'Treat traceability capture, repair flow, and functional confirmation as explicit line-design decisions for infotainment launch readiness.',
      ],
    };
  };
}

export const runLineLayoutAgent = createLineLayoutAgent();
