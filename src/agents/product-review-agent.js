import {
  buildAssumptionNotes,
  buildDefaultAutomationCandidates,
  deriveOverallRiskLevel,
  estimateEnvelopeMm,
  extractFeatureCounts,
  extractThinWallCandidates,
  getPartIdentity,
  summarizeActions,
  summarizeDfmChecks,
  topIssueTitles,
} from './common.js';

function buildHeuristicRisks(config, part, featureCounts, envelope, thinWalls) {
  const risks = [];
  const connectorClearance = Number(
    config.product?.connector_clearance_mm
    || config.product?.connector?.clearance_mm
    || 0
  );

  if (thinWalls.some((entry) => entry.thickness_mm <= 2.0)) {
    risks.push({
      id: 'heuristic-thin-wall',
      category: 'structure',
      severity: 'medium',
      title: 'Thin wall candidate may reduce process stability during launch',
      recommendation: 'Review ribbing, bend relief, or local reinforcement before pilot tooling freeze.',
      source: 'config_geometry',
    });
  }

  if (featureCounts.holes >= 8) {
    risks.push({
      id: 'heuristic-fastener-access',
      category: 'assembly_access',
      severity: 'medium',
      title: 'High fastener count suggests accessibility and takt-time exposure',
      recommendation: 'Confirm tool approach, screw sequence, and error-proofing for mass-production stations.',
      source: 'feature_count',
    });
  }

  if (connectorClearance > 0 && connectorClearance < 5) {
    risks.push({
      id: 'heuristic-connector-clearance',
      category: 'service_clearance',
      severity: 'high',
      title: 'Connector keep-out assumption is tight for line-side assembly and inspection',
      recommendation: 'Reserve additional probe and hand-tool clearance or define dedicated access tooling.',
      source: 'product_metadata',
    });
  }

  if (envelope.length > 220 || envelope.width > 180) {
    risks.push({
      id: 'heuristic-large-footprint',
      category: 'layout',
      severity: 'low',
      title: 'Large component footprint may constrain fixture density and operator reach',
      recommendation: 'Validate carrier size, nesting, and logistics flow for domestic and overseas sites.',
      source: 'envelope',
    });
  }

  if (part.production_sites.length > 1) {
    risks.push({
      id: 'heuristic-cross-site',
      category: 'standardization',
      severity: 'medium',
      title: 'Cross-site launch requires stronger process standardization and document control',
      recommendation: 'Package PFMEA, control plan, work instruction, and gauge concept in one rollout set.',
      source: 'production_scope',
    });
  }

  return risks;
}

export function createProductReviewAgent() {
  return async function runProductReviewAgent({
    config,
    enrichedConfig,
    dfmResult,
  }) {
    const part = getPartIdentity(config);
    const featureCounts = extractFeatureCounts(config);
    const envelope = estimateEnvelopeMm(config);
    const thinWalls = extractThinWallCandidates(config);
    const dfmRisks = summarizeDfmChecks(dfmResult);
    const heuristicRisks = buildHeuristicRisks(config, part, featureCounts, envelope, thinWalls);
    const riskItems = [...dfmRisks, ...heuristicRisks];
    const overallRiskLevel = deriveOverallRiskLevel(riskItems);
    const recommendations = [
      ...new Set(
        riskItems
          .map((risk) => risk.recommendation)
          .filter(Boolean)
          .concat(buildDefaultAutomationCandidates(config, featureCounts).map((item) => `Evaluate ${item}.`))
      ),
    ];

    return {
      schema_version: '0.1',
      agent: 'product_review',
      part,
      summary: {
        positioning: 'preliminary_manufacturing_structure_review',
        part_type: enrichedConfig?.drawing_plan?.part_type || 'generic',
        dfm_score: dfmResult?.score ?? null,
        review_scope: 'design-phase manufacturability and structure review',
        overall_risk_level: overallRiskLevel,
        primary_risks: riskItems.slice(0, 4).map((risk) => risk.title),
        top_issues: topIssueTitles(riskItems, 3),
        recommended_actions: summarizeActions(recommendations, 4),
        likely_automation_candidates: buildDefaultAutomationCandidates(config, featureCounts),
        heuristics_notice: 'Rule-based manufacturing review intended for early design-stage decision support.',
      },
      structure_signals: {
        envelope_mm: envelope,
        feature_counts: featureCounts,
        thin_wall_candidates: thinWalls,
        drawing_strategy: enrichedConfig?.drawing_plan?.process?.sequence || [],
      },
      risk_items: riskItems,
      recommendations,
      evidence: {
        assumptions: buildAssumptionNotes(config),
        automation_candidates: buildDefaultAutomationCandidates(config, featureCounts),
        drawing_plan: enrichedConfig?.drawing_plan || {},
      },
    };
  };
}

export const runProductReviewAgent = createProductReviewAgent();
