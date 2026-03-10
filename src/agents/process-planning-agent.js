import {
  buildAssumptionNotes,
  buildDefaultAutomationCandidates,
  deriveOverallRiskLevel,
  extractCriticalDimensions,
  extractFeatureCounts,
  getPartIdentity,
  getProductionTargets,
  summarizeActions,
  topIssueTitles,
} from './common.js';

function buildBaseFlow(process, partType) {
  if (process === 'sheet_metal') {
    return [
      ['incoming material', 'Receive coil or blank and confirm surface condition.'],
      ['blanking / laser cut', 'Create primary outline and connector cut-outs.'],
      ['forming / bending', 'Generate bracket geometry and maintain datum stability.'],
      ['pierce / tapping / hardware insertion', 'Complete mounting features and hardware prep.'],
      ['deburr / clean', 'Remove sharp edges and contamination before assembly.'],
      ['dimensional inspection', 'Verify bend angle, hole pattern, and mounting stack-up.'],
      ['subassembly / packaging', 'Protect cosmetic faces and release to downstream build.'],
    ];
  }

  if (process === 'casting') {
    return [
      ['incoming casting', 'Receive cast housing and verify revision/lot trace.'],
      ['trim / flash removal', 'Stabilize casting before secondary machining.'],
      ['critical machining', 'Machine sealing faces, bosses, and connector datums.'],
      ['cleaning', 'Remove chips and casting residue.'],
      ['inspection / leak surrogate', 'Check critical datums and fit interfaces.'],
      ['assembly preparation', 'Prepare inserts, labels, and packaging protection.'],
    ];
  }

  if (process === '3d_printing') {
    return [
      ['prototype build prep', 'Confirm print orientation and support strategy.'],
      ['additive build', 'Produce engineering validation parts.'],
      ['support removal / post-process', 'Trim supports and improve touch surfaces.'],
      ['inspection', 'Validate prototype dimensions for design review.'],
      ['trial fit / packaging', 'Prepare sample build for evaluation and shipment.'],
    ];
  }

  return [
    ['incoming stock', 'Receive raw stock or supplied blank.'],
    ['rough machining', 'Establish primary datums and remove bulk material.'],
    ['hole / feature machining', 'Complete mounting and connector-related features.'],
    ['deburr / cleaning', 'Protect inspection repeatability and assembly quality.'],
    ['inspection', 'Check critical dimensions and feature accessibility.'],
    ['subassembly / packaging', 'Release to downstream line or logistics flow.'],
  ];
}

function operationMode(stepName, automationMode) {
  if (/inspection/i.test(stepName)) return 'semi_auto';
  if (/incoming|packaging/i.test(stepName)) return 'manual';
  if (/laser|machining|casting|build/i.test(stepName)) return automationMode === 'manual' ? 'manual' : 'auto_capable';
  return automationMode === 'auto' ? 'auto_capable' : 'manual';
}

export function createProcessPlanningAgent() {
  return async function runProcessPlanningAgent({
    config,
    enrichedConfig,
    dfmResult,
  }) {
    const part = getPartIdentity(config);
    const targets = getProductionTargets(config);
    const partType = enrichedConfig?.drawing_plan?.part_type || 'generic';
    const featureCounts = extractFeatureCounts(config);
    const criticalDimensions = extractCriticalDimensions(config);
    const baseFlow = buildBaseFlow(part.process, partType);
    const automationCandidates = buildDefaultAutomationCandidates(config, featureCounts);

    const processFlow = baseFlow.map(([operation, purpose], index) => ({
      step: (index + 1) * 10,
      operation,
      purpose,
      mode: operationMode(operation, targets.automation_mode),
      key_output: operation.includes('inspection') ? 'quality evidence' : 'part progression',
    }));

    const keyInspectionPoints = criticalDimensions.length > 0
      ? criticalDimensions.map((dimension, index) => ({
          id: dimension.id || `inspection-${index + 1}`,
          checkpoint: dimension.name,
          rationale: dimension.rationale,
          control_method: index === 0 ? 'first_article_and_launch_control' : 'periodic_or_inline_check',
        }))
      : [
          {
            id: 'inspection-1',
            checkpoint: 'mounting hole pattern',
            rationale: 'assembly alignment',
            control_method: 'launch and periodic audit',
          },
        ];

    const bottleneckRisks = [];
    if (featureCounts.holes >= 8) {
      bottleneckRisks.push('Hole-intensive design can increase handling and verification time.');
    }
    if ((dfmResult?.summary?.warnings || 0) > 0) {
      bottleneckRisks.push('DFM warnings indicate likely setup tuning during early line stabilization.');
    }
    if (targets.annual_volume >= 150000 && targets.automation_mode === 'manual') {
      bottleneckRisks.push('Manual bias is aggressive relative to assumed volume; review automation split.');
    }

    return {
      schema_version: '0.1',
      agent: 'process_planning',
      part,
      summary: {
        overall_risk_level: deriveOverallRiskLevel(
          bottleneckRisks.map((note) => ({ severity: 'medium', title: note }))
        ),
        top_issues: topIssueTitles(
          bottleneckRisks.map((note) => ({ severity: 'medium', title: note })),
          3
        ),
        recommended_actions: summarizeActions([
          'Confirm inspection ownership for connector access, mounting pattern, and critical dimensions.',
          automationCandidates.length > 0 ? `Review automation candidates: ${automationCandidates.join(', ')}` : null,
          'Use the process sequence as a preliminary launch planning aid, then validate with site-specific PFMEA and layout data.',
        ]),
        likely_inspection_critical_features: keyInspectionPoints.map((point) => point.checkpoint).slice(0, 4),
        likely_bottleneck_candidates: bottleneckRisks.slice(0, 3),
        heuristics_notice: 'Process plan is generated from part/process heuristics and requires site-specific validation.',
      },
      planning_basis: {
        part_type: partType,
        production_targets: targets,
        assumptions: buildAssumptionNotes(config),
      },
      process_flow: processFlow,
      key_inspection_points: keyInspectionPoints,
      automation_candidates: automationCandidates,
      bottleneck_risks: bottleneckRisks,
      planning_notes: [
        'Sequence is heuristic and intended for early production-engineering review.',
        `Drawing-plan process sequence reference: ${(enrichedConfig?.drawing_plan?.process?.sequence || []).join(', ') || 'not defined'}`,
      ],
    };
  };
}

export const runProcessPlanningAgent = createProcessPlanningAgent();
