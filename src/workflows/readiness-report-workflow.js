import { writeFile } from 'node:fs/promises';

import { runPythonJsonScript, writeJsonFile } from '../../lib/context-loader.js';
import { createDfmService } from '../services/analysis/dfm-service.js';
import { createCostService } from '../services/cost/cost-service.js';
import { loadShopProfile } from '../services/config/profile-service.js';
import { runProductReviewAgent } from '../agents/product-review-agent.js';
import { runProcessPlanningAgent } from '../agents/process-planning-agent.js';
import { runLineLayoutAgent } from '../agents/line-layout-agent.js';
import { runQualityTraceabilityAgent } from '../agents/quality-traceability-agent.js';
import { runCostInvestmentAgent } from '../agents/cost-investment-agent.js';
import { runStabilizationReviewAgent } from '../agents/stabilization-review-agent.js';
import {
  severityWeight,
  toReadinessStatus,
  getPartIdentity,
  summarizeActions,
} from '../agents/common.js';

function computeQualityScore(qualityRiskPack = {}) {
  const risks = Array.isArray(qualityRiskPack.quality_risks) ? qualityRiskPack.quality_risks : [];
  const penalty = risks.reduce((sum, risk) => sum + severityWeight(risk.severity), 0);
  return Math.max(40, 100 - penalty);
}

function computePlanningScore(processPlan = {}, linePlan = {}) {
  const flowScore = Array.isArray(processPlan.process_flow) && processPlan.process_flow.length >= 5 ? 88 : 65;
  const layoutScore = Array.isArray(linePlan.station_concept) && linePlan.station_concept.length >= 4 ? 84 : 68;
  return Math.round((flowScore + layoutScore) / 2);
}

function computeInvestmentScore(investmentReview = {}) {
  const notePenalty = Array.isArray(investmentReview.investment_review_notes)
    ? investmentReview.investment_review_notes.length * 5
    : 0;
  return Math.max(45, 85 - notePenalty);
}

function computeStabilizationScore(stabilizationReview = {}) {
  const runtimeSummary = stabilizationReview?.analysis_basis?.runtime_summary || {};
  if (!runtimeSummary.runtime_informed) return null;

  let score = 86;
  score -= (runtimeSummary.stations_over_target || []).length * 6;
  score -= Math.max(0, (runtimeSummary.average_downtime_pct || 0) - 6) * 1.5;
  score -= Math.max(0, 0.98 - (runtimeSummary.average_fpy || 0.98)) * 200;
  return Math.max(40, Math.round(score));
}

function buildDecisionSummary(report) {
  const goSignals = [];
  const holdPoints = [];

  if ((report.product_review.summary?.dfm_score ?? 0) >= 80) {
    goSignals.push('DFM score supports pilot-line planning with standard launch controls.');
  } else {
    holdPoints.push('DFM score remains below the preferred pilot-line threshold.');
  }

  if ((report.quality_risk.critical_dimensions || []).length > 0) {
    goSignals.push('Critical dimensions and quality gates are explicitly identified.');
  } else {
    holdPoints.push('Critical dimensions are not yet formalized for production control.');
  }

  if ((report.investment_review.process_comparison || []).length > 0) {
    goSignals.push('Cost and process comparison data is available for screening-level investment review.');
  } else {
    holdPoints.push('Investment review lacks process comparison evidence.');
  }

  if (report.stabilization_review?.analysis_basis?.runtime_summary?.runtime_informed) {
    if ((report.stabilization_review.analysis_basis.runtime_summary.stations_over_target || []).length === 0) {
      goSignals.push('Runtime-informed line review shows no stations above the current target CT guardrail.');
    } else {
      holdPoints.push('Runtime-informed review still shows CT instability at one or more launch stations.');
    }
  }

  const nextActions = [
    'Confirm PFMEA/control-plan ownership for launch site rollout.',
    'Review line-side inspection concept against connector access and fastening assumptions.',
    report.stabilization_review?.summary?.recommended_actions?.[0] || null,
    'Use this output as an early decision-support artifact, then refine with real line data.',
  ].filter(Boolean);

  return { go_signals: goSignals, hold_points: holdPoints, next_actions: nextActions };
}

function buildExecutiveSummary(report) {
  const topIssues = [
    ...(report.product_review.summary?.top_issues || []),
    ...(report.line_plan.summary?.top_issues || []),
    ...(report.quality_risk.summary?.top_issues || []),
  ].filter(Boolean).slice(0, 5);
  const likelyAutomationCandidates = [...new Set([
    ...(report.process_plan.automation_candidates || []),
    ...(report.investment_review.automation_candidate_notes || []),
  ].filter(Boolean))].slice(0, 5);

  return {
    overall_risk_level: report.readiness_summary.score >= 80
      ? 'low'
      : report.readiness_summary.score >= 65
        ? 'medium'
        : 'high',
    top_issues: topIssues,
    recommended_actions: summarizeActions([
      ...(report.product_review.summary?.recommended_actions || []),
      ...(report.line_plan.summary?.recommended_actions || []),
      ...(report.stabilization_review?.summary?.recommended_actions || []),
      ...(report.investment_review.summary?.recommended_actions || []),
    ], 5),
    likely_bottleneck_candidates: report.line_plan.summary?.likely_bottleneck_candidates || [],
    likely_automation_candidates: likelyAutomationCandidates,
    launch_stabilization_focus: report.stabilization_review?.summary?.top_bottlenecks || [],
    interview_explainer: 'This report packages design-stage manufacturing risk review, process flow thinking, line-support assumptions, quality gates, and screening-level investment logic into one early production-engineering artifact.',
  };
}

export function renderMarkdown(report) {
  const decision = report.decision_summary;
  const summary = report.summary || {};
  return `# Production Readiness Report: ${report.part.name}

- Status: ${report.readiness_summary.status}
- Composite score: ${report.readiness_summary.score}
- Gate decision: ${report.readiness_summary.gate_decision}

## Executive Summary

- Overall risk level: ${summary.overall_risk_level ?? 'n/a'}
- Top issues: ${(summary.top_issues || []).join('; ') || 'none'}
- Recommended actions: ${(summary.recommended_actions || []).join('; ') || 'none'}
- Likely bottlenecks: ${(summary.likely_bottleneck_candidates || []).join('; ') || 'none'}

## Product Review

- Part type: ${report.product_review.summary.part_type}
- DFM score: ${report.product_review.summary.dfm_score ?? 'n/a'}
- Primary risks: ${(report.product_review.summary.primary_risks || []).join('; ') || 'none'}

## Process Planning

- Flow steps: ${(report.process_plan.process_flow || []).length}
- Automation candidates: ${(report.process_plan.automation_candidates || []).join(', ') || 'none'}

## Line Layout

- Stations: ${(report.line_plan.station_concept || []).length}
- Target cycle time: ${report.line_plan.cycle_time_assumptions?.target_ct_sec ?? 'n/a'} s
- Inline inspection stations: ${(report.line_plan.inspection_split?.in_line_inspection_stations || []).join(', ') || 'none'}
- End-of-line inspection stations: ${(report.line_plan.inspection_split?.end_of_line_inspection_stations || []).join(', ') || 'none'}
${report.line_plan.runtime_summary?.runtime_informed ? `- Runtime-informed stations above target: ${(report.line_plan.runtime_summary.stations_over_target || []).join(', ') || 'none'}` : ''}

## Quality / Traceability

- Critical dimensions: ${(report.quality_risk.critical_dimensions || []).length}
- Quality gates: ${(report.quality_risk.quality_gates || []).length}

${report.stabilization_review ? `## Launch Stabilization

- Runtime basis: ${report.stabilization_review.summary.runtime_basis}
- Top bottlenecks: ${(report.stabilization_review.summary.top_bottlenecks || []).join('; ') || 'none'}
- Launch instability signals: ${(report.stabilization_review.launch_instability_signals || []).join('; ') || 'none'}
` : ''}

## Cost / Investment

- Unit cost: ${report.investment_review.cost_breakdown?.unit_cost ?? 'n/a'}
- Total cost: ${report.investment_review.cost_breakdown?.total_cost ?? 'n/a'}

## Decision Summary

- Go signals: ${(decision.go_signals || []).join('; ') || 'none'}
- Hold points: ${(decision.hold_points || []).join('; ') || 'none'}
- Next actions: ${(decision.next_actions || []).join('; ') || 'none'}
`;
}

export function createReadinessReportWorkflow() {
  const runDfm = createDfmService();
  const runCost = createCostService();

  return async function runReadinessReportWorkflow({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    options = {},
  }) {
    const loadedConfig = config ?? await loadConfig(configPath);
    const siteProfile = options.siteProfile || await loadShopProfile(freecadRoot, options.profileName || null, { silent: true });
    const enrichedConfig = await runPythonJsonScript(
      freecadRoot,
      'scripts/intent_compiler.py',
      loadedConfig,
      { onStderr: options.onStderr }
    );

    const dfmResult = await runDfm({
      freecadRoot,
      runScript,
      loadConfig,
      config: enrichedConfig,
      process: options.process || enrichedConfig.manufacturing?.process || 'machining',
      profileName: options.profileName || null,
      standard: options.standard || enrichedConfig.standard || loadedConfig.standard,
    });

    const costResult = await runCost({
      freecadRoot,
      runScript,
      loadConfig,
      config: enrichedConfig,
      process: options.process || enrichedConfig.manufacturing?.process || 'machining',
      material: options.material || enrichedConfig.manufacturing?.material || enrichedConfig.material || 'SS304',
      batchSize: options.batchSize || enrichedConfig.batch_size || 1,
      dfmResult,
      profileName: options.profileName || null,
      standard: options.standard || enrichedConfig.standard || loadedConfig.standard,
    });

    const productReview = await runProductReviewAgent({ config: loadedConfig, enrichedConfig, dfmResult });
    const processPlan = await runProcessPlanningAgent({ config: loadedConfig, enrichedConfig, dfmResult });
    const linePlan = await runLineLayoutAgent({
      config: loadedConfig,
      processPlan,
      runtimeData: options.runtimeData || null,
      siteProfile,
    });
    const qualityRisk = await runQualityTraceabilityAgent({ config: loadedConfig, dfmResult, productReview });
    const investmentReview = await runCostInvestmentAgent({ config: loadedConfig, costResult, dfmResult });
    const stabilizationReview = (options.runtimeData || linePlan.runtime_summary?.runtime_informed)
      ? await runStabilizationReviewAgent({
          config: loadedConfig,
          linePlan,
          qualityRisk,
          runtimeData: options.runtimeData || null,
          siteProfile,
        })
      : null;

    const qualityScore = computeQualityScore(qualityRisk);
    const planningScore = computePlanningScore(processPlan, linePlan);
    const investmentScore = computeInvestmentScore(investmentReview);
    const stabilizationScore = computeStabilizationScore(stabilizationReview);
    const overallScore = Math.round(
      stabilizationScore === null
        ? (productReview.summary.dfm_score ?? 70) * 0.35
          + qualityScore * 0.25
          + planningScore * 0.2
          + investmentScore * 0.2
        : (productReview.summary.dfm_score ?? 70) * 0.3
          + qualityScore * 0.2
          + planningScore * 0.15
          + investmentScore * 0.15
          + stabilizationScore * 0.2
    );

    const report = {
      schema_version: '0.1',
      workflow: 'production_readiness',
      part: getPartIdentity(loadedConfig),
      generated_at: new Date().toISOString(),
      readiness_summary: {
        status: toReadinessStatus(overallScore),
        score: overallScore,
        gate_decision: overallScore >= 65 ? 'candidate_for_pilot_line_review' : 'hold_before_line_commitment',
      },
      product_review: productReview,
      process_plan: processPlan,
      line_plan: linePlan,
      quality_risk: qualityRisk,
      investment_review: investmentReview,
      ...(stabilizationReview ? { stabilization_review: stabilizationReview } : {}),
    };

    report.decision_summary = buildDecisionSummary(report);
    report.summary = buildExecutiveSummary(report);
    report.markdown = renderMarkdown(report);
    return report;
  };
}

export const runReadinessReportWorkflow = createReadinessReportWorkflow();

export async function writeReadinessArtifacts(outputJsonPath, report) {
  const jsonPath = await writeJsonFile(outputJsonPath, report);
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  await writeFile(markdownPath, `${report.markdown.trim()}\n`, 'utf8');
  return { json: jsonPath, markdown: markdownPath };
}
