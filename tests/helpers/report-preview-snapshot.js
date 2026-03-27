import {
  assertTextSnapshot,
  normalizeAbsolutePaths,
  normalizeTextSnapshot,
  normalizeTimestamps,
} from './text-snapshot.js';
import { renderMarkdown } from '../../src/workflows/readiness-report-workflow.js';

function listSection(title, values = []) {
  const entries = Array.isArray(values) ? values : [];
  if (entries.length === 0) return `${title}: none`;
  return `${title}:\n${entries.map((value) => `- ${value}`).join('\n')}`;
}

export function renderReportPreview(report = {}) {
  const processOperations = (report.process_plan?.process_flow || [])
    .map((step) => step.operation || step.name || step.id)
    .filter(Boolean);
  const stationNames = (
    report.line_plan?.station_concept
    || report.line_plan?.station_list
    || []
  )
    .map((station) => station.station_name || station.name || station.id)
    .filter(Boolean);
  const qualityGateNames = (report.quality_risk?.quality_gates || [])
    .map((gate) => gate.title || gate.name || gate.id)
    .filter(Boolean);
  const qualityRiskTitles = (report.quality_risk?.quality_risks || [])
    .map((risk) => risk.title || risk.name || risk.id)
    .filter(Boolean);

  const markdown = typeof report.markdown === 'string' && report.markdown.trim()
    ? report.markdown.trim()
    : renderMarkdown(report).trim();

  return [
    `workflow: ${report.workflow || ''}`,
    `part.name: ${report.part?.name || ''}`,
    `part.revision: ${report.part?.revision || ''}`,
    `part.material: ${report.part?.material || ''}`,
    `part.process: ${report.part?.process || ''}`,
    `generated_at: ${report.generated_at || ''}`,
    `artifact_path: ${report.artifact_path || report.output_path || report.report_path || ''}`,
    `run_id: ${report.run_id || report.job_id || ''}`,
    `status: ${report.readiness_summary?.status || ''}`,
    `score: ${report.readiness_summary?.score ?? ''}`,
    `gate_decision: ${report.readiness_summary?.gate_decision || ''}`,
    `dfm_score: ${report.product_review?.summary?.dfm_score ?? ''}`,
    `part_type: ${report.product_review?.summary?.part_type || ''}`,
    `target_ct_sec: ${report.line_plan?.cycle_time_assumptions?.target_ct_sec ?? ''}`,
    `critical_dimensions: ${(report.quality_risk?.critical_dimensions || []).length}`,
    `quality_gates: ${(report.quality_risk?.quality_gates || []).length}`,
    `unit_cost: ${report.investment_review?.cost_breakdown?.unit_cost ?? ''}`,
    `total_cost: ${report.investment_review?.cost_breakdown?.total_cost ?? ''}`,
    '',
    listSection('summary.top_issues', report.summary?.top_issues),
    '',
    listSection('summary.recommended_actions', report.summary?.recommended_actions),
    '',
    listSection('process.operations', processOperations),
    '',
    listSection('line.stations', stationNames),
    '',
    listSection('quality.gates', qualityGateNames),
    '',
    listSection('quality.risks', qualityRiskTitles),
    '',
    listSection('decision.go_signals', report.decision_summary?.go_signals),
    '',
    listSection('decision.hold_points', report.decision_summary?.hold_points),
    '',
    listSection('decision.next_actions', report.decision_summary?.next_actions),
    '',
    'markdown:',
    markdown,
  ].join('\n');
}

export function normalizeReportPreviewSnapshot(reportOrText) {
  let normalized = typeof reportOrText === 'string'
    ? reportOrText
    : renderReportPreview(reportOrText);
  normalized = normalizeAbsolutePaths(normalized);
  normalized = normalizeTimestamps(normalized);
  normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '__UUID__');
  normalized = normalized.replace(/\b(?:run|job|build|session)-[A-Za-z0-9_-]{6,}\b/gi, (value) => {
    const prefix = value.split('-')[0].toLowerCase();
    return `${prefix}-__VOLATILE__`;
  });
  return normalizeTextSnapshot(normalized);
}

export function assertReportPreviewSnapshot(snapshotName, reportOrText, {
  snapshotDir,
  update = process.env.UPDATE_SNAPSHOTS === '1',
} = {}) {
  return assertTextSnapshot(snapshotName, reportOrText, {
    snapshotDir,
    extension: '.normalized.txt',
    normalize: normalizeReportPreviewSnapshot,
    label: 'Report preview',
    update,
  });
}
