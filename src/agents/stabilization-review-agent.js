import {
  deriveOverallRiskLevel,
  getPartIdentity,
  summarizeActions,
  topIssueTitles,
} from './common.js';

function unique(values = [], limit = 6) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

export function createStabilizationReviewAgent() {
  return async function runStabilizationReviewAgent({
    config,
    linePlan,
    qualityRisk,
    runtimeData = null,
    siteProfile = null,
  }) {
    const part = getPartIdentity(config);
    const stationRuntimeReview = (linePlan?.station_concept || [])
      .filter((station) => station.runtime_indicators || station.bottleneck_confidence)
      .map((station) => ({
        station_id: station.station_id,
        station_name: station.station_name,
        actual_vs_target_ct: station.actual_vs_target_ct,
        actual_ct_gap_sec: station.actual_ct_gap_sec,
        bottleneck_confidence: station.bottleneck_confidence,
        launch_instability_signals: station.launch_instability_signals || [],
        likely_root_causes: station.likely_root_causes || [],
        improvement_candidates: station.improvement_candidates || [],
        runtime_indicators: station.runtime_indicators,
        evidence_basis: station.evidence_basis || 'heuristic_only',
      }))
      .sort((left, right) => (right.bottleneck_confidence?.score ?? 0) - (left.bottleneck_confidence?.score ?? 0));

    const lineRisks = stationRuntimeReview.map((station) => ({
      severity: station.bottleneck_confidence?.level === 'high' ? 'high' : station.bottleneck_confidence?.level === 'medium' ? 'medium' : 'low',
      title: `${station.station_id} ${station.station_name}: ${station.launch_instability_signals?.[0] || 'launch monitoring required'}`,
    }));

    const launchSignals = unique(stationRuntimeReview.flatMap((station) => station.launch_instability_signals));
    const likelyRootCauses = unique(stationRuntimeReview.flatMap((station) => station.likely_root_causes));
    const improvementCandidates = unique(stationRuntimeReview.flatMap((station) => station.improvement_candidates), 8);
    const runtimeSummary = linePlan?.runtime_summary || {
      runtime_informed: false,
      runtime_station_count: 0,
      stations_over_target: [],
    };

    return {
      schema_version: '0.1',
      agent: 'stabilization_review',
      part,
      summary: {
        overall_risk_level: deriveOverallRiskLevel(lineRisks),
        runtime_basis: runtimeSummary.runtime_informed ? 'runtime_informed' : 'heuristic_only',
        site: runtimeData?.site || siteProfile?.label || siteProfile?.site?.name || part.production_sites?.[0] || null,
        top_bottlenecks: topIssueTitles(lineRisks, 4),
        recommended_actions: summarizeActions([
          improvementCandidates[0] || null,
          improvementCandidates[1] || null,
          runtimeSummary.stations_over_target?.length > 0 ? 'Focus line-balancing effort on stations still above target CT before adding broader automation scope.' : null,
          qualityRisk?.traceability_summary?.barcode_pairing_required ? 'Confirm serialization pairing exceptions are blocked before EOL release.' : null,
          'Treat this review as launch-stabilization support, then confirm with real plant issue logs and engineering ownership.',
        ], 5),
        heuristics_notice: runtimeSummary.runtime_informed
          ? 'This review mixes supplied runtime indicators with heuristic root-cause suggestions and still requires engineering validation.'
          : 'Without runtime data, the stabilization review remains a heuristic launch-readiness aid only.',
      },
      analysis_basis: {
        runtime_station_count: runtimeSummary.runtime_station_count,
        stations_over_target: runtimeSummary.stations_over_target,
        site_profile: siteProfile
          ? {
              name: siteProfile.name || siteProfile.label || siteProfile.site?.name || null,
              line: siteProfile.line || {},
            }
          : null,
        runtime_summary: runtimeSummary,
      },
      station_runtime_review: stationRuntimeReview,
      launch_instability_signals: launchSignals,
      likely_root_causes: likelyRootCauses,
      improvement_candidates: improvementCandidates,
      quality_traceability_watchpoints: unique([
        ...(qualityRisk?.summary?.traceability_focus || []),
        ...(qualityRisk?.summary?.likely_inspection_critical_features || []),
      ], 6),
    };
  };
}

export const runStabilizationReviewAgent = createStabilizationReviewAgent();
