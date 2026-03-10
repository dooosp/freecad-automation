import {
  deriveOverallRiskLevel,
  extractCriticalDimensions,
  extractQualityGates,
  getPartIdentity,
  summarizeActions,
  summarizeDfmChecks,
  topIssueTitles,
} from './common.js';

export function createQualityTraceabilityAgent() {
  return async function runQualityTraceabilityAgent({
    config,
    dfmResult,
    productReview,
  }) {
    const part = getPartIdentity(config);
    const criticalDimensions = extractCriticalDimensions(config);
    const dfmRisks = summarizeDfmChecks(dfmResult).slice(0, 5);
    const traceability = config.quality?.traceability || {};
    const traceabilitySummary = {
      serial_level: traceability.serial_level || 'lot_and_revision',
      record_linkage: traceability.record_linkage || 'inspection + revision + operator',
      retention_note: traceability.retention_note || 'Retain launch evidence for cross-site troubleshooting.',
      label_strategy: traceability.label_strategy || 'part or tray label with revision and lot',
    };
    const qualityRisks = [
      ...dfmRisks,
      ...(productReview?.risk_items || [])
        .filter((item) => item.category === 'assembly_access' || item.category === 'service_clearance')
        .slice(0, 2),
    ];

    return {
      schema_version: '0.1',
      agent: 'quality_traceability',
      part,
      summary: {
        overall_risk_level: deriveOverallRiskLevel(qualityRisks),
        top_issues: topIssueTitles(qualityRisks, 3),
        recommended_actions: summarizeActions([
          'Lock critical dimensions into the launch control plan and reaction plan.',
          'Define operator / lot / revision linkage at the first in-line quality capture point.',
          'Use the traceability scheme as a production-stabilization aid, not only as a reporting artifact.',
        ]),
        likely_inspection_critical_features: criticalDimensions.map((dimension) => dimension.name).slice(0, 4),
        traceability_focus: [traceabilitySummary.serial_level, traceabilitySummary.record_linkage].filter(Boolean),
        heuristics_notice: 'Quality-risk pack is a rule-based readiness aid and should be validated against plant quality systems.',
      },
      critical_dimensions: criticalDimensions,
      inspection_required_points: criticalDimensions.map((dimension) => ({
        checkpoint: dimension.name,
        control_reason: dimension.rationale,
      })),
      traceability_summary: traceabilitySummary,
      quality_risks: qualityRisks,
      quality_gates: extractQualityGates(config),
      evidence_pack: {
        recommended_artifacts: [
          'control_plan',
          'work_instruction',
          'inspection_checksheet',
          'launch_issue_log',
        ],
      },
    };
  };
}

export const runQualityTraceabilityAgent = createQualityTraceabilityAgent();
