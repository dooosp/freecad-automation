import { el } from './renderers.js';

export const EVIDENCE_GRAPH_BOUNDARY = 'Evidence graph artifacts are generated review/control metadata only; generated, review, and control graph nodes are not inspection evidence and do not satisfy inspection_evidence. Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function evidenceGraphSummary(graph = {}) {
  if (!isPlainObject(graph)) return {};
  return isPlainObject(graph.summary) ? graph.summary : graph;
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : 'Unknown';
}

function formatField(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  return String(value);
}

export function renderEvidenceGraphSummary(graph = {}) {
  const summary = evidenceGraphSummary(graph);
  const readinessStatus = formatField(summary.readiness_status);
  const gateDecision = formatField(summary.readiness_gate_decision);
  const inspectionEvidenceRecords = formatCount(summary.inspection_evidence_record_count);
  const generatedArtifacts = formatCount(summary.generated_artifact_count);
  const evidenceBoundary = formatField(summary.evidence_boundary || EVIDENCE_GRAPH_BOUNDARY);
  const statusTone = readinessStatus === 'needs_more_evidence' || gateDecision === 'hold_for_evidence_completion'
    ? 'warn'
    : 'info';
  const fields = [
    ['Readiness status', readinessStatus],
    ['Gate decision', gateDecision],
    ['Inspection evidence records', inspectionEvidenceRecords],
    ['Generated artifacts', generatedArtifacts],
    ['Nodes', formatCount(summary.node_count)],
    ['Edges', formatCount(summary.edge_count)],
    ['Evidence boundary', evidenceBoundary],
  ];

  return el('section', {
    className: 'evidence-graph-panel inspector-panel-section',
    attrs: { 'aria-label': 'Evidence graph summary' },
    children: [
      el('div', {
        className: 'card-title-row',
        children: [
          el('div', {
            children: [
              el('p', { className: 'card-kicker', text: 'Evidence decision' }),
              el('h3', { className: 'card-title', text: 'Evidence graph' }),
            ],
          }),
          el('span', { className: `pill pill-status-${statusTone}`, text: readinessStatus }),
        ],
      }),
      el('div', {
        className: 'support-note-list',
        children: fields.map(([label, value]) =>
          el('p', { className: 'support-note', text: `${label}: ${value}` })
        ),
      }),
    ],
  });
}
