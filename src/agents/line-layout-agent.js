import {
  connectorClearanceMm,
  deriveOverallRiskLevel,
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

function classifyInspectionMode(step) {
  if (/functional/i.test(step.operation)) return 'end_of_line';
  if (/inspection/i.test(step.operation)) return 'in_line';
  return 'not_primary';
}

function stationPurpose(step) {
  if (/incoming/i.test(step.operation)) return 'Receive material, confirm lot/revision, and prepare kits.';
  if (/machining|laser|forming|build|trim/i.test(step.operation)) return 'Create or stabilize the manufacturable geometry.';
  if (/inspection/i.test(step.operation)) return 'Capture dimensional evidence and launch quality data.';
  if (/packaging/i.test(step.operation)) return 'Protect the part and preserve traceability for downstream flow.';
  return step.purpose || 'Advance the part through the planned line sequence.';
}

function skillSensitivity(step, connectorClearance, fasteningText) {
  if (/packaging|incoming/i.test(step.operation)) return 'low';
  if (/inspection/i.test(step.operation)) return 'medium';
  if (connectorClearance > 0 && connectorClearance < 5) return 'high';
  if (/manual/i.test(fasteningText)) return 'medium';
  return 'medium';
}

function buildStationConcept({ processFlow = [], targetCtSec = 45, connectorClearance = 0, fasteningText = '' }) {
  return processFlow.map((step, index) => {
    const cycleMultiplier = step.mode === 'auto_capable' ? 0.85 : step.mode === 'semi_auto' ? 1.0 : 1.15;
    const inspectionMode = classifyInspectionMode(step);
    const stationName = step.operation.replace(/\//g, ' / ');
    const skill = skillSensitivity(step, connectorClearance, fasteningText);
    const bottleneckCandidate = (
      /inspection/i.test(step.operation)
      || (/manual/i.test(fasteningText) && /feature|assembly|preparation/i.test(step.operation))
      || (connectorClearance > 0 && connectorClearance < 5 && /machining|feature|assembly|inspection/i.test(step.operation))
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
      traceability_capture: inspectionMode !== 'not_primary' || /incoming|packaging/i.test(step.operation),
      bottleneck_candidate_note: bottleneckCandidate
        ? 'Candidate bottleneck under launch conditions; verify staffing, fixture loading, and data capture time.'
        : 'No immediate bottleneck signal from the current rule set.',
      operator_skill_sensitivity: skill,
      rework_repair_path: /inspection/i.test(step.operation)
        ? 'Escalate failures to offline repair / containment review.'
        : 'Upstream correction before release to next station.',
      heuristic_basis: 'Rule-based preliminary line-support output, not a detailed time study.',
    };
  });
}

export function createLineLayoutAgent() {
  return async function runLineLayoutAgent({
    config,
    processPlan,
  }) {
    const part = getPartIdentity(config);
    const targets = getProductionTargets(config);
    const connectorClearance = connectorClearanceMm(config);
    const fasteningText = fasteningStrategy(config);
    const featureCounts = extractFeatureCounts(config);
    const criticalDimensions = extractCriticalDimensions(config);
    const functionalTestPoints = extractFunctionalTestPoints(config);
    const stationConcept = buildStationConcept({
      processFlow: processPlan?.process_flow || [],
      targetCtSec: targets.target_ct_sec || 45,
      connectorClearance,
      fasteningText,
    });
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
    const bottleneckCandidateNotes = stationConcept
      .filter((station) => station.bottleneck_candidate_note.startsWith('Candidate bottleneck'))
      .map((station) => `${station.station_id} ${station.station_name}: ${station.bottleneck_candidate_note}`);
    const traceabilityCapturePoints = stationConcept
      .filter((station) => station.traceability_capture)
      .map((station) => ({
        station_id: station.station_id,
        station_name: station.station_name,
        data_capture: station.inspection_strategy === 'not_primary' ? 'lot/revision handoff' : 'inspection + revision + operator result',
      }));
    const operatorSkillSensitivityNotes = stationConcept
      .filter((station) => station.operator_skill_sensitivity !== 'low')
      .map((station) => `${station.station_id} ${station.station_name} is ${station.operator_skill_sensitivity}-sensitivity due to access, inspection, or setup dependence.`);
    const inlineInspectionStations = stationConcept
      .filter((station) => station.inspection_strategy === 'in_line')
      .map((station) => station.station_id);
    const eolInspectionStations = [
      ...stationConcept
        .filter((station) => station.inspection_strategy === 'end_of_line')
        .map((station) => station.station_id),
      ...(functionalTestPoints.length > 0 ? ['EOL-FT'] : []),
    ];
    const reworkRepairStation = {
      suggested: criticalDimensions.length > 0 || bottleneckCandidateNotes.length > 0,
      station_name: 'Offline containment / rework review',
      rationale: 'Provides a controlled path for launch-phase defects without stopping the main flow.',
    };
    const lineRisks = bottleneckCandidateNotes.map((note) => ({ severity: 'medium', title: note }));

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
          functionalTestPoints.length > 0 ? 'Reserve an end-of-line functional confirmation point for electronics-related checks.' : null,
        ]),
        likely_bottleneck_candidates: bottleneckCandidateNotes.slice(0, 3),
        likely_traceability_capture_points: traceabilityCapturePoints.map((point) => point.station_id).slice(0, 4),
        heuristics_notice: 'Line support output is assumption-based and intended for preliminary production-engineering review.',
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
        target_ct_sec: targets.target_ct_sec || 45,
        estimated_balance_loss_pct: targets.launch_sites.length > 1 ? 12 : 8,
        bottleneck_station_ct_sec: stationConcept.length > 0
          ? Math.max(...stationConcept.map((station) => station.cycle_time_placeholder_sec))
          : targets.target_ct_sec || 45,
        note: 'Cycle-time values are placeholders for planning discussion, not simulation outputs.',
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
      line_engineering_assumptions: {
        target_ct_sec: targets.target_ct_sec || 45,
        connector_side_clearance_mm: connectorClearance,
        fastening_strategy: fasteningText,
        critical_dimension_count: criticalDimensions.length,
        feature_counts: featureCounts,
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
