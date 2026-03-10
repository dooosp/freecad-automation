import {
  buildDefaultAutomationCandidates,
  connectorClearanceMm,
  extractCriticalDimensions,
  extractFeatureCounts,
  fasteningStrategy,
  getPartIdentity,
  getProductionTargets,
  summarizeActions,
} from './common.js';

export function createCostInvestmentAgent() {
  return async function runCostInvestmentAgent({
    config,
    costResult,
    dfmResult,
  }) {
    const part = getPartIdentity(config);
    const targets = getProductionTargets(config);
    const featureCounts = extractFeatureCounts(config);
    const criticalDimensions = extractCriticalDimensions(config);
    const connectorClearance = connectorClearanceMm(config);
    const fasteningText = fasteningStrategy(config);
    const automationCandidates = buildDefaultAutomationCandidates(config, featureCounts);
    const dfmPenaltyPerBatch = costResult?.dfm_savings?.amount || 0;

    const processComparison = Array.isArray(costResult?.process_comparison)
      ? [...costResult.process_comparison].sort((left, right) => left.total - right.total)
      : [];

    const investmentNotes = [];
    if (targets.annual_volume >= 120000) {
      investmentNotes.push('Volume assumption justifies review of dedicated fixtures and inline quality capture.');
    }
    if ((dfmResult?.score ?? 100) < 75) {
      investmentNotes.push('DFM score indicates that capex decisions should wait until design risks are reduced.');
    }
    if (processComparison[0] && !processComparison[0].current) {
      investmentNotes.push(`Current process is not the lowest heuristic cost path; compare against ${processComparison[0].process}.`);
    }
    if (automationCandidates.length > 0) {
      investmentNotes.push('Automation candidates exist, but outputs remain early-phase decision-support only.');
    }

    const equipmentNeedHints = [];
    if (part.process === 'sheet_metal') {
      equipmentNeedHints.push('blanking / laser fixture set');
      equipmentNeedHints.push('bend-angle control tooling');
    } else if (part.process === 'casting') {
      equipmentNeedHints.push('casting trim and secondary machining fixtures');
      equipmentNeedHints.push('connector-side datum machining support');
    } else {
      equipmentNeedHints.push('machining fixture for datum and mounting-boss control');
    }
    if (automationCandidates.length > 0) {
      equipmentNeedHints.push('vision or gauging interface for automation-candidate stations');
    }

    const inspectionFixtureToolingHints = [
      criticalDimensions.length > 0
        ? `Inspection fixture should control ${criticalDimensions.slice(0, 3).map((item) => item.name).join(', ')}.`
        : 'Prepare a launch gauge concept for mounting and alignment features.',
      connectorClearance > 0 && connectorClearance < 5
        ? 'Connector-side clearance is tight; consider probe-access fixture or go/no-go check.'
        : 'Connector-side access appears manageable with standard launch inspection planning.',
      `Traceability label area should be protected during inspection and packaging flow.`,
    ];

    const setupComplexityNotes = [
      featureCounts.cut_ops >= 4
        ? 'Multiple feature operations suggest additional setup confirmation and fixture repeatability review.'
        : 'Setup count appears moderate for early launch planning.',
      /manual/i.test(fasteningText)
        ? 'Manual fastening strategy increases line-side setup and operator training sensitivity.'
        : 'Fastening approach may be compatible with semi-automatic tool support.',
    ];

    let manualLaborSensitivity = 'low';
    if (targets.annual_volume >= 100000 || /manual/i.test(fasteningText) || connectorClearance < 5) {
      manualLaborSensitivity = 'medium';
    }
    if (targets.annual_volume >= 180000 && (/manual/i.test(fasteningText) || automationCandidates.length > 0)) {
      manualLaborSensitivity = 'high';
    }

    let investmentPressure = 'low';
    if (targets.annual_volume >= 80000 || criticalDimensions.length >= 2 || automationCandidates.length > 0) {
      investmentPressure = 'medium';
    }
    if (targets.annual_volume >= 150000 || manualLaborSensitivity === 'high' || connectorClearance < 5) {
      investmentPressure = 'high';
    }

    const topCostDrivers = [
      costResult?.breakdown?.machining ? 'process cost' : null,
      costResult?.breakdown?.setup ? 'setup cost' : null,
      costResult?.breakdown?.inspection ? 'inspection cost' : null,
      dfmPenaltyPerBatch > 0 ? 'DFM penalty exposure' : null,
    ].filter(Boolean);

    return {
      schema_version: '0.1',
      agent: 'cost_investment_review',
      part,
      summary: {
        investment_pressure: investmentPressure,
        manual_labor_sensitivity: manualLaborSensitivity,
        top_cost_drivers: topCostDrivers,
        likely_equipment_needs: equipmentNeedHints.slice(0, 4),
        recommended_actions: summarizeActions([
          processComparison[0] && !processComparison[0].current
            ? `Compare the current process against ${processComparison[0].process} before line investment lock.`
            : null,
          automationCandidates.length > 0 ? `Screen automation candidates: ${automationCandidates.join(', ')}` : null,
          'Treat this output as heuristic investment screening, then validate with site-specific volume, labor, and capex data.',
        ]),
        heuristics_notice: 'Investment review is rule-based and does not represent a real capex quotation.',
      },
      cost_breakdown: {
        material: costResult?.breakdown?.material ?? null,
        process: costResult?.breakdown?.machining ?? null,
        setup: costResult?.breakdown?.setup ?? null,
        inspection: costResult?.breakdown?.inspection ?? null,
        dfm_penalty: dfmPenaltyPerBatch,
        total_cost: costResult?.total_cost ?? null,
        unit_cost: costResult?.unit_cost ?? null,
        batch_size: costResult?.batch_size ?? targets.batch_size,
      },
      process_comparison: processComparison,
      equipment_need_hints: equipmentNeedHints,
      inspection_fixture_tooling_hints: inspectionFixtureToolingHints,
      setup_complexity_notes: setupComplexityNotes,
      manual_labor_sensitivity: {
        level: manualLaborSensitivity,
        rationale: 'Based on volume assumption, connector-side access, fastening approach, and automation gap.',
      },
      investment_pressure: {
        level: investmentPressure,
        rationale: 'Derived from annual volume, critical dimensions, connector access, and automation / labor sensitivity.',
      },
      investment_review_notes: investmentNotes,
      automation_candidate_notes: automationCandidates,
      assumptions: [
        'Cost outputs are heuristic and suitable for screening-level production engineering decisions.',
        `Process family under review: ${part.process}`,
      ],
    };
  };
}

export const runCostInvestmentAgent = createCostInvestmentAgent();
