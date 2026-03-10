import {
  deriveOverallRiskLevel,
  extractAssemblyMetadata,
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
    const assemblyMeta = extractAssemblyMetadata(config);
    const traceability = config.quality?.traceability || {};
    const traceabilitySummary = {
      serial_level: traceability.serial_level || 'lot_and_revision',
      record_linkage: traceability.record_linkage || 'inspection + revision + operator',
      retention_note: traceability.retention_note || 'Retain launch evidence for cross-site troubleshooting.',
      label_strategy: traceability.label_strategy || 'part or tray label with revision and lot',
      barcode_pairing_required: assemblyMeta.requires_barcode_pairing,
      functional_test_fixture_type: assemblyMeta.functional_test_fixture_type || null,
    };
    const assemblyRisks = [];
    if (assemblyMeta.requires_connector_seating_confirmation) {
      assemblyRisks.push({
        id: 'assembly-connector-misalignment',
        category: 'electronics_assembly',
        severity: assemblyMeta.connector_mating_force_n !== null && assemblyMeta.connector_mating_force_n >= 40 ? 'high' : 'medium',
        title: 'Connector misalignment risk can create mate-force escapes and EOL instability',
        recommendation: 'Use seating confirmation, side-access checks, and fixture support for the connector join.',
      });
    }
    if (assemblyMeta.requires_torque_control) {
      assemblyRisks.push({
        id: 'assembly-torque',
        category: 'electronics_assembly',
        severity: 'medium',
        title: 'Under-torque / over-torque risk requires traceable fastening control',
        recommendation: 'Capture digital torque evidence and calibrate tools before pilot-line release.',
      });
    }
    if (assemblyMeta.requires_gasket) {
      assemblyRisks.push({
        id: 'assembly-gasket',
        category: 'electronics_assembly',
        severity: 'high',
        title: 'Gasket miss or sealing path damage can escape without explicit confirmation',
        recommendation: 'Add gasket presence and sealing-surface verification before the unit is closed.',
      });
    }
    if (assemblyMeta.fixture_load_sensitivity !== 'low') {
      assemblyRisks.push({
        id: 'assembly-fixture-loading',
        category: 'electronics_assembly',
        severity: assemblyMeta.fixture_load_sensitivity === 'high' ? 'high' : 'medium',
        title: 'Fixture loading sensitivity can extend CT and create false EOL failures',
        recommendation: 'Review nest support, probe access, and load/unload ergonomics with launch samples.',
      });
    }
    if (assemblyMeta.requires_eol_electrical_test) {
      assemblyRisks.push({
        id: 'assembly-eol-access',
        category: 'electronics_assembly',
        severity: 'medium',
        title: 'EOL access / probing constraint can delay release and complicate containment',
        recommendation: 'Confirm probing access, communication retry logic, and retest flow before SOP.',
      });
    }
    if (assemblyMeta.requires_barcode_pairing) {
      assemblyRisks.push({
        id: 'assembly-traceability-pairing',
        category: 'traceability',
        severity: 'medium',
        title: 'Traceability mismatch risk exists when housing, PCB, and label records are not paired at build time',
        recommendation: 'Capture barcode pairing before the unit leaves the controlled fixture and block mismatches.',
      });
    }
    if (assemblyMeta.pcb_insert_direction) {
      assemblyRisks.push({
        id: 'assembly-pcb-stackup',
        category: 'electronics_assembly',
        severity: 'medium',
        title: 'PCB stack-up alignment concern should be reviewed against housing and connector datums',
        recommendation: 'Validate PCB insertion path, boss height stack-up, and connector datum control together.',
      });
    }
    const qualityRisks = [
      ...dfmRisks,
      ...assemblyRisks,
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
          assemblyMeta.requires_barcode_pairing ? 'Pair housing / PCB / label serialization before EOL release.' : null,
          assemblyMeta.requires_eol_electrical_test ? 'Treat EOL fixture access and retest disposition as quality-system decisions, not only test-engineering details.' : null,
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
        assembly_specific_controls: assemblyMeta.is_electronics_assembly
          ? [
              assemblyMeta.requires_torque_control ? 'torque trace verification' : null,
              assemblyMeta.requires_barcode_pairing ? 'barcode pairing log' : null,
              assemblyMeta.requires_eol_electrical_test ? 'EOL electrical test record' : null,
              assemblyMeta.requires_vision_confirmation ? 'vision recipe approval' : null,
            ].filter(Boolean)
          : [],
      },
    };
  };
}

export const runQualityTraceabilityAgent = createQualityTraceabilityAgent();
