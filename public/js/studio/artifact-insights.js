import {
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReleaseBundleManifestArtifact,
  isReviewPackArtifact,
  isRevisionImpactArtifact,
  isRevisionComparisonArtifact,
  isStabilizationReviewArtifact,
} from './artifact-actions.js';
import { EVIDENCE_GRAPH_BOUNDARY } from './evidence-graph-panel.js';

const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/toml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
  'text/',
];
const TRUNCATED_PREVIEW_MARKER = 'truncated for the studio preview';

function includesAny(haystack, needles = []) {
  return needles.some((needle) => haystack.includes(needle));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return isPlainObject(value) ? value : {};
}

function toSearchString(artifact = {}) {
  return [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
    artifact.extension,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function shortJobId(id = '') {
  return id.length > 8 ? id.slice(0, 8) : id || 'unknown';
}

export function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatJobStatus(status) {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return 'Unknown size';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatArtifactAvailability(artifact = {}) {
  const size = Number.isFinite(artifact.size_bytes) ? formatBytes(artifact.size_bytes) : 'Size unavailable';
  return `${artifact.exists ? 'Available' : 'Missing'} • ${size}`;
}

function formatArtifactContract(artifact = {}) {
  return `${artifact.scope || 'unknown'} • ${artifact.stability || 'unknown'}`;
}

function formatRouteAvailability(enabled, copy) {
  return {
    value: enabled ? 'Available' : 'Unavailable',
    note: copy,
  };
}

export function getTrackedJobSourceLabel(activeJob = null) {
  const request = activeJob?.summary?.request;
  if (typeof request?.source_label === 'string' && request.source_label.trim()) {
    return request.source_label.trim();
  }
  if (typeof request?.options?.studio?.source_label === 'string' && request.options.studio.source_label.trim()) {
    return request.options.studio.source_label.trim();
  }
  return '';
}

export function classifyArtifact(artifact = {}) {
  const search = toSearchString(artifact);
  const extension = String(artifact.extension || '').toLowerCase();

  if (isReleaseBundleArtifact(artifact)) return { badge: 'bundle', tone: 'warn' };
  if (isReleaseBundleManifestArtifact(artifact)) return { badge: 'bundle-manifest', tone: 'info' };
  if (isRevisionImpactArtifact(artifact)) return { badge: 'revision-impact', tone: 'warn' };
  if (isRevisionComparisonArtifact(artifact)) return { badge: 'compare', tone: 'warn' };
  if (isStabilizationReviewArtifact(artifact)) return { badge: 'stabilization', tone: 'warn' };
  if (includesAny(search, ['validation-diagnostics', 'validation_diagnostics'])) return { badge: 'validation', tone: 'bad' };
  if (includesAny(search, ['readiness'])) return { badge: 'readiness', tone: 'ok' };
  if (includesAny(search, ['review-pack', 'product_review', 'quality_risk', 'investment_review', 'process_plan', 'line_plan'])) {
    return { badge: 'report', tone: 'warn' };
  }
  if (extension === '.svg') return { badge: 'svg', tone: 'info' };
  if (extension === '.csv') return { badge: 'csv', tone: 'info' };
  if (extension === '.dxf') return { badge: 'dxf', tone: 'warn' };
  if (extension === '.pdf') return { badge: 'pdf', tone: 'info' };
  if (extension === '.json') return { badge: 'json', tone: 'info' };
  if (extension === '.md' || extension === '.markdown') return { badge: 'markdown', tone: 'info' };
  if (includesAny(search, ['report'])) return { badge: 'report', tone: 'info' };
  if (includesAny(search, ['model', '.step', '.stl', '.obj', '.fcstd'])) return { badge: 'model', tone: 'warn' };
  return { badge: extension.replace(/^\./, '') || 'artifact', tone: 'info' };
}

export function canPreviewAsText(artifact = {}) {
  const contentType = String(artifact.content_type || '').toLowerCase();
  if (!artifact.capabilities?.can_open) return false;
  if (contentType === 'application/pdf' || contentType === 'application/octet-stream') return false;
  return TEXT_CONTENT_TYPES.some((entry) => contentType.startsWith(entry));
}

export async function fetchArtifactText(artifact, maxChars = 16000) {
  if (!artifact?.links?.open || !canPreviewAsText(artifact)) {
    return null;
  }
  const response = await fetch(artifact.links.open, {
    headers: {
      accept: 'text/plain, application/json, text/markdown, text/csv, image/svg+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`${artifact.file_name || artifact.key} returned ${response.status}`);
  }
  const text = await response.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n…truncated for the studio preview…` : text;
}

export function parseArtifactPayload(artifact, rawText) {
  if (!rawText) return null;
  if (String(rawText).includes(TRUNCATED_PREVIEW_MARKER)) return null;
  const contentType = String(artifact?.content_type || '').toLowerCase();
  const extension = String(artifact?.extension || '').toLowerCase();

  if (contentType.includes('json') || extension === '.json') {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  return rawText;
}

export function findArtifact(artifacts = [], matchers = []) {
  return artifacts.find((artifact) => {
    const search = toSearchString(artifact);
    return matchers.some((matcher) => search.includes(String(matcher).toLowerCase()));
  }) || null;
}

function formatNumeric(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return String(Number(value.toFixed(digits)));
}

function formatConfidence(confidence = null) {
  if (!isPlainObject(confidence)) return 'Unavailable';
  const level = confidence.level || 'Unknown';
  const score = Number.isFinite(confidence.score) ? ` (${formatNumeric(confidence.score)})` : '';
  return `${level}${score}`;
}

function formatCoverage(coverage = null) {
  if (!isPlainObject(coverage)) return 'Unavailable';
  const preferredKeys = [
    ['source_artifact_count', 'source refs'],
    ['source_file_count', 'files'],
    ['review_priority_count', 'priorities'],
    ['quality_gate_count', 'quality gates'],
    ['missing_input_count', 'missing inputs'],
  ];
  const entries = preferredKeys
    .filter(([key]) => Number.isFinite(coverage[key]))
    .map(([key, label]) => `${coverage[key]} ${label}`);
  return entries.join(' • ') || `${Object.keys(coverage).length} coverage fields`;
}

function formatLineage(lineage = null) {
  if (!isPlainObject(lineage)) return 'Unavailable';
  const primary = lineage.part_id || lineage.name || 'Unknown';
  return [
    primary,
    lineage.revision ? `rev ${lineage.revision}` : null,
  ].filter(Boolean).join(' • ');
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'Unavailable';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

// Keep payload-derived display tokens centralized so the browser i18n layer can
// translate only rendered labels and enum values without mutating raw payloads.
function formatReviewDisplayValue(value, fallback = 'Unknown') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  const formatted = formatValue(value);
  return formatted === 'Unavailable' ? fallback : formatted;
}

function buildReviewDisplayField(label, value, fallback = 'Unknown') {
  return [
    formatReviewDisplayValue(label, 'Unknown'),
    formatReviewDisplayValue(value, fallback),
  ];
}

function normalizeLineage(document = {}) {
  const part = safeObject(document.part);
  return {
    part_id: part.part_id || document.part_id || null,
    name: part.name || document.name || null,
    revision: part.revision || document.revision || null,
  };
}

function getArtifactIdentity(artifact = {}, parsedPayload = null) {
  const fromContract = safeObject(artifact.contract?.artifact_identity);
  if (Object.keys(fromContract).length > 0) {
    return fromContract;
  }

  const sourceArtifactRefs = safeList(parsedPayload?.source_artifact_refs);
  return {
    warnings: safeList(parsedPayload?.warnings),
    coverage: safeObject(parsedPayload?.coverage),
    confidence: safeObject(parsedPayload?.confidence),
    lineage: normalizeLineage(parsedPayload || {}),
    source_artifact_refs: sourceArtifactRefs,
  };
}

function stringifyListEntries(items = [], { key = null, fallback = 'None' } = {}) {
  const resolved = items
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isPlainObject(entry)) return null;
      if (key && typeof entry[key] === 'string' && entry[key].trim()) return entry[key].trim();
      return entry.title || entry.label || entry.recommended_action || entry.category || null;
    })
    .filter(Boolean);
  return resolved.length > 0 ? resolved : [fallback];
}

function buildCommonViewerSections(identity = {}) {
  const sections = [];

  if (isPlainObject(identity.coverage) || isPlainObject(identity.confidence)) {
    sections.push({
      title: 'Coverage and confidence',
      items: [
        { label: 'Coverage', value: formatCoverage(identity.coverage) },
        { label: 'Confidence', value: formatConfidence(identity.confidence) },
        { label: 'Source refs', value: String(safeList(identity.source_artifact_refs).length) },
      ],
    });
  }

  if (isPlainObject(identity.lineage)) {
    sections.push({
      title: 'Lineage',
      items: [
        { label: 'Part', value: identity.lineage.part_id || identity.lineage.name || 'Unknown' },
        { label: 'Name', value: identity.lineage.name || 'Unknown' },
        { label: 'Revision', value: identity.lineage.revision || 'Unknown' },
      ],
    });
  }

  const warnings = safeList(identity.warnings);
  if (warnings.length > 0) {
    sections.push({
      title: 'Warnings',
      entries: warnings.slice(0, 6),
    });
  }

  return sections;
}

function buildReviewPackViewer(artifact, parsedPayload, identity) {
  const part = safeObject(parsedPayload?.part);
  const recommendedActions = stringifyListEntries(parsedPayload?.recommended_actions, { key: 'recommended_action' });
  const priorityEntries = safeList(parsedPayload?.review_priorities);
  const topPriorityTitles = stringifyListEntries(priorityEntries, { key: 'title', fallback: 'No prioritized hotspots were captured.' });

  return {
    kind: 'review_pack',
    title: 'Review pack viewer',
    summary: `${part.name || part.part_id || 'This part'} exposes ${priorityEntries.length} prioritized review items for reopen and continuation.`,
    highlights: [
      { label: 'Part', value: part.name || part.part_id || 'Unknown' },
      { label: 'Revision', value: part.revision || parsedPayload?.revision || 'Unknown' },
      { label: 'Review priorities', value: String(priorityEntries.length) },
      { label: 'Warnings', value: String(safeList(identity.warnings).length) },
    ],
    sections: [
      {
        title: 'Review signals',
        items: [
          { label: 'Geometry hotspots', value: String(safeList(parsedPayload?.geometry_hotspots).length) },
          { label: 'Quality hotspots', value: String(safeList(parsedPayload?.quality_hotspots).length) },
          { label: 'Inspection anomalies', value: String(safeList(parsedPayload?.inspection_anomalies).length) },
        ],
      },
      {
        title: 'Top review priorities',
        entries: topPriorityTitles.slice(0, 4),
      },
      {
        title: 'Next actions in artifact',
        entries: recommendedActions.slice(0, 4),
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildReadinessViewer(artifact, parsedPayload, identity) {
  const readinessSummary = safeObject(parsedPayload?.readiness_summary);
  const summary = safeObject(parsedPayload?.summary);
  const decisionSummary = safeObject(parsedPayload?.decision_summary);
  const nextActions = stringifyListEntries(decisionSummary.next_actions || summary.recommended_actions, { fallback: 'No next actions were listed.' });

  return {
    kind: 'readiness_report',
    title: 'Readiness viewer',
    summary: `${summary.overall_risk_level || 'Readiness'} status is ${readinessSummary.status || readinessSummary.gate_decision || 'available'} with a score of ${formatValue(readinessSummary.score)}.`,
    highlights: [
      { label: 'Score', value: readinessSummary.score ?? 'Unknown' },
      { label: 'Gate', value: readinessSummary.gate_decision || 'Unknown' },
      { label: 'Risk level', value: summary.overall_risk_level || 'Unknown' },
      { label: 'Warnings', value: String(safeList(identity.warnings).length) },
    ],
    sections: [
      {
        title: 'Decision summary',
        items: [
          { label: 'Go signals', value: String(safeList(decisionSummary.go_signals).length) },
          { label: 'Hold points', value: String(safeList(decisionSummary.hold_points).length) },
          { label: 'Bottleneck candidates', value: String(safeList(summary.likely_bottleneck_candidates).length) },
        ],
      },
      {
        title: 'Next actions in artifact',
        entries: nextActions.slice(0, 4),
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildRevisionComparisonViewer(artifact, parsedPayload, identity) {
  const confidenceChanges = safeObject(parsedPayload?.confidence_changes);
  const revisionStory = stringifyListEntries(parsedPayload?.revision_story, { fallback: 'No revision story was provided.' });

  return {
    kind: 'revision_comparison',
    title: 'Compare viewer',
    summary: `This comparison tracks ${safeList(parsedPayload?.new_hotspots).length} new, ${safeList(parsedPayload?.resolved_hotspots).length} resolved, and ${safeList(parsedPayload?.shifted_hotspots).length} shifted hotspot categories.`,
    highlights: [
      { label: 'Comparison', value: parsedPayload?.comparison_type || 'Unknown' },
      { label: 'New hotspots', value: String(safeList(parsedPayload?.new_hotspots).length) },
      { label: 'Resolved hotspots', value: String(safeList(parsedPayload?.resolved_hotspots).length) },
      { label: 'Shifted hotspots', value: String(safeList(parsedPayload?.shifted_hotspots).length) },
    ],
    sections: [
      {
        title: 'Comparison basis',
        items: [
          { label: 'Baseline revision', value: parsedPayload?.revision?.baseline || 'Unknown' },
          { label: 'Candidate revision', value: parsedPayload?.revision?.candidate || 'Unknown' },
          { label: 'Confidence delta', value: confidenceChanges.delta ?? 'Unknown' },
        ],
      },
      {
        title: 'Revision story',
        entries: revisionStory.slice(0, 4),
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildRevisionImpactViewer(artifact, parsedPayload, identity) {
  const summary = safeObject(parsedPayload?.summary);
  const baseline = safeObject(parsedPayload?.baseline);
  const candidate = safeObject(parsedPayload?.candidate);
  const changes = safeList(parsedPayload?.changes);
  const assessments = safeList(parsedPayload?.evidence_applicability?.assessments);
  const planItems = safeList(parsedPayload?.reinspection_plan?.items);
  const unresolved = changes.filter((change) => change?.determinability === 'unable_to_determine');
  const requirementChangeTypes = new Set([
    'nominal_dimension_change',
    'tolerance_change',
    'datum_or_reference_change',
    'drawing_requirement_change',
    'quality_gate_change',
    'inspection_method_requirement_change',
    'specification_reference_change',
  ]);
  const requirementChanges = changes.filter((change) => requirementChangeTypes.has(change?.change_type));
  const formatChange = (change) => {
    const type = formatReviewDisplayValue(change?.change_type, 'change');
    const entity = formatReviewDisplayValue(
      change?.affected_entity_id || change?.affected_entity_or_characteristic_id || change?.entity_id,
      'unresolved identity'
    );
    const rationale = formatReviewDisplayValue(change?.engineering_rationale || change?.rationale, 'Human review required.');
    return `${type} • ${entity} — ${rationale}`;
  };
  const formatPlanItem = (item) => {
    const entity = formatReviewDisplayValue(
      item?.affected_entity_id || item?.affected_feature_or_characteristic_id || item?.characteristic_id || item?.feature_id,
      'unresolved characteristic'
    );
    const reason = formatReviewDisplayValue(item?.reason_reinspection_is_required || item?.reason, 'Reinspection is required.');
    return `${entity} — ${reason}`;
  };
  const applicabilityCounts = assessments.reduce((counts, assessment) => {
    const key = formatReviewDisplayValue(assessment?.applicability_status, 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sourceHashEntries = [
    ...Object.entries(safeObject(baseline.source_hashes))
      .map(([label, value]) => `Baseline ${label} • ${formatReviewDisplayValue(value, 'Unknown hash')}`),
    ...Object.entries(safeObject(candidate.source_hashes))
      .map(([label, value]) => `Candidate ${label} • ${formatReviewDisplayValue(value, 'Unknown hash')}`),
  ];
  const provenanceEntries = [
    ...safeList(baseline.artifact_refs).map((value) => `Baseline • ${formatReviewDisplayValue(value, 'Unknown artifact')}`),
    ...safeList(candidate.artifact_refs).map((value) => `Candidate • ${formatReviewDisplayValue(value, 'Unknown artifact')}`),
  ];

  return {
    kind: 'revision_impact_report',
    title: 'Revision impact viewer',
    summary: `${formatReviewDisplayValue(summary.decision, 'Review required')} with ${summary.material_change_count || 0} material changes and ${summary.reinspection_required_count || 0} reinspection requirements.`,
    highlights: [
      { label: 'Decision', value: summary.decision || 'Unknown' },
      { label: 'Material changes', value: String(summary.material_change_count || 0) },
      { label: 'Reinspection required', value: String(summary.reinspection_required_count || 0) },
      { label: 'Unable to determine', value: String(summary.unable_to_determine_count || 0) },
    ],
    sections: [
      {
        title: 'Comparison basis',
        items: [
          { label: 'Package', value: candidate.package_slug || baseline.package_slug || 'Unknown' },
          { label: 'Baseline revision', value: baseline.revision || 'Unknown' },
          { label: 'Candidate revision', value: candidate.revision || 'Unknown' },
          { label: 'Readiness review required', value: summary.readiness_review_required ? 'Yes' : 'No' },
        ],
      },
      {
        title: 'Material engineering changes',
        entries: changes.length > 0 ? changes.slice(0, 8).map(formatChange) : ['No material engineering change was identified.'],
      },
      {
        title: 'Dimensions, tolerances, drawing and specification impacts',
        entries: requirementChanges.length > 0
          ? requirementChanges.slice(0, 8).map(formatChange)
          : ['No dimension, tolerance, drawing, quality-gate, or specification impact was reported.'],
      },
      {
        title: 'Evidence applicability',
        items: Object.entries(applicabilityCounts).length > 0
          ? Object.entries(applicabilityCounts).map(([label, value]) => ({ label, value: String(value) }))
          : [{ label: 'Assessments', value: 'None' }],
      },
      {
        title: 'Affected inspection characteristics',
        entries: assessments.length > 0
          ? assessments.slice(0, 8).map((assessment) => (
              `${formatReviewDisplayValue(assessment?.evidence_or_characteristic_id, 'Unknown characteristic')} • ${formatReviewDisplayValue(assessment?.applicability_status, 'unknown')}`
            ))
          : ['No inspection characteristic applicability assessment was reported.'],
      },
      {
        title: 'Reinspection requirements',
        entries: planItems.length > 0 ? planItems.slice(0, 8).map(formatPlanItem) : ['No reinspection item was generated.'],
      },
      {
        title: 'Unresolved mappings',
        entries: unresolved.length > 0 ? unresolved.slice(0, 8).map(formatChange) : ['No unresolved stable-identity mapping was reported.'],
      },
      {
        title: 'Source hashes and provenance',
        entries: [...sourceHashEntries, ...provenanceEntries].length > 0
          ? [...sourceHashEntries, ...provenanceEntries]
          : ['No source hash or artifact reference was reported.'],
      },
      {
        title: 'Non-mutation boundaries',
        entries: [
          'No inspection evidence was attached.',
          'Existing evidence was not mutated.',
          'No evidence was superseded.',
          'Readiness was not regenerated.',
          'A reinspection plan is not completed inspection evidence.',
          'Human review is required before any evidence or readiness action.',
        ],
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildStabilizationViewer(artifact, parsedPayload, identity) {
  const summary = safeObject(parsedPayload?.summary);
  const deltas = safeObject(parsedPayload?.readiness_deltas);
  const changeReasons = safeList(parsedPayload?.change_reasons);
  const actionChanges = safeObject(parsedPayload?.recommended_action_changes);

  return {
    kind: 'stabilization_review',
    title: 'Stabilization viewer',
    summary: `${summary.runtime_basis || 'Readiness delta'} comparison is reopenable with baseline-versus-candidate deltas and preserved readiness lineage.`,
    highlights: [
      { label: 'Runtime basis', value: summary.runtime_basis || 'Unknown' },
      { label: 'Top bottlenecks', value: String(safeList(summary.top_bottlenecks).length) },
      { label: 'Score delta', value: deltas.score_delta ?? 'Unknown' },
      { label: 'Warning delta', value: deltas.warning_delta ?? 'Unknown' },
    ],
    sections: [
      {
        title: 'Comparison basis',
        items: [
          { label: 'Baseline revision', value: parsedPayload?.baseline?.revision || 'Unknown' },
          { label: 'Candidate revision', value: parsedPayload?.candidate?.revision || 'Unknown' },
          { label: 'Missing-input delta', value: deltas.missing_input_delta ?? 'Unknown' },
        ],
      },
      {
        title: 'Change reasons',
        entries: stringifyListEntries(changeReasons, { key: 'reason', fallback: 'No change reasons were captured.' }).slice(0, 5),
      },
      {
        title: 'Recommended action changes',
        items: [
          { label: 'Added', value: String(safeList(actionChanges.added).length) },
          { label: 'Removed', value: String(safeList(actionChanges.removed).length) },
          { label: 'Changed', value: String(safeList(actionChanges.changed).length) },
        ],
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildBundleViewer(artifact, parsedPayload, identity, { companionManifestArtifact = null } = {}) {
  const manifestDocument = safeObject(parsedPayload);
  const includedArtifacts = safeList(manifestDocument.included_artifacts || manifestDocument.bundle_entries || manifestDocument.artifacts);
  const canonicalEntries = includedArtifacts
    .map((entry) => entry?.path)
    .filter((value) => typeof value === 'string' && value.startsWith('canonical/'));
  const releaseNotes = stringifyListEntries(manifestDocument.release_notes, { fallback: 'Canonical bundle metadata is available for this release artifact.' });

  return {
    kind: 'release_bundle',
    title: 'Bundle viewer',
    summary: companionManifestArtifact
      ? `This release bundle stays reopenable through ${includedArtifacts.length} recorded bundle entries and preserved canonical metadata.`
      : 'This release bundle exposes canonical contract metadata, but no companion manifest was attached to this tracked job.',
    highlights: [
      { label: 'Included artifacts', value: String(includedArtifacts.length) },
      { label: 'Canonical entries', value: String(canonicalEntries.length) },
      { label: 'Warnings', value: String(safeList(identity.warnings).length) },
      { label: 'Companion manifest', value: companionManifestArtifact ? companionManifestArtifact.file_name : 'Missing' },
    ],
    sections: [
      {
        title: 'Bundle contents',
        items: [
          { label: 'Docs listed', value: String(includedArtifacts.filter((entry) => String(entry?.path || '').startsWith('docs/')).length) },
          { label: 'Canonical review pack', value: canonicalEntries.some((entry) => entry.endsWith('review_pack.json')) ? 'Included' : 'Missing' },
          { label: 'Canonical readiness report', value: canonicalEntries.some((entry) => entry.endsWith('readiness_report.json')) ? 'Included' : 'Missing' },
        ],
      },
      {
        title: 'Release notes',
        entries: releaseNotes.slice(0, 4),
      },
      ...buildCommonViewerSections(identity),
    ],
  };
}

function buildGenericViewer(artifact, identity) {
  return {
    kind: 'generic',
    title: 'Structured reopen state',
    summary: 'The selected artifact does not expose a specialized viewer on this surface yet, but tracked metadata and follow-up actions still remain available.',
    highlights: [
      { label: 'Artifact', value: artifact.file_name || artifact.key || artifact.id || 'Unknown' },
      { label: 'Type', value: artifact.type || 'Unknown' },
      { label: 'Warnings', value: String(safeList(identity.warnings).length) },
      { label: 'Source refs', value: String(safeList(identity.source_artifact_refs).length) },
    ],
    sections: buildCommonViewerSections(identity),
  };
}

export function buildArtifactOpenLabel(artifact = {}) {
  if (isRevisionImpactArtifact(artifact)) return 'Open revision impact';
  if (isReviewPackArtifact(artifact)) return 'Open review pack';
  if (isReadinessReportArtifact(artifact)) return 'Open readiness report';
  if (isReleaseBundleArtifact(artifact)) return 'Open release bundle';
  if (isReleaseBundleManifestArtifact(artifact)) return 'Open bundle manifest';
  return 'Open';
}

export function buildArtifactViewer({
  artifact = {},
  parsedPayload = null,
  relatedArtifacts = [],
  relatedPayloads = {},
} = {}) {
  const identity = getArtifactIdentity(artifact, parsedPayload);

  if (isReviewPackArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildReviewPackViewer(artifact, parsedPayload, identity);
  }
  if (isReadinessReportArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildReadinessViewer(artifact, parsedPayload, identity);
  }
  if (isRevisionImpactArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildRevisionImpactViewer(artifact, parsedPayload, identity);
  }
  if (isRevisionComparisonArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildRevisionComparisonViewer(artifact, parsedPayload, identity);
  }
  if (isStabilizationReviewArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildStabilizationViewer(artifact, parsedPayload, identity);
  }
  if (isReleaseBundleManifestArtifact(artifact) && isPlainObject(parsedPayload)) {
    return buildBundleViewer(artifact, parsedPayload, identity);
  }
  if (isReleaseBundleArtifact(artifact)) {
    const companionManifestArtifact = relatedArtifacts.find((entry) => isReleaseBundleManifestArtifact(entry)) || null;
    const companionPayload = companionManifestArtifact ? relatedPayloads[companionManifestArtifact.id] || null : null;
    return buildBundleViewer(artifact, companionPayload, identity, { companionManifestArtifact });
  }
  return buildGenericViewer(artifact, identity);
}

export function buildArtifactDetailItems(artifact = {}, activeJob = null) {
  const classification = classifyArtifact(artifact);
  const sourceLabel = getTrackedJobSourceLabel(activeJob);
  const identity = getArtifactIdentity(artifact);
  const openRoute = formatRouteAvailability(
    artifact.capabilities?.can_open,
    artifact.capabilities?.can_open
      ? 'Opens through the tracked artifact route.'
      : 'No browser-open route is published for this artifact.'
  );
  const downloadRoute = formatRouteAvailability(
    artifact.capabilities?.can_download,
    artifact.capabilities?.can_download
      ? 'Downloads through the tracked artifact route.'
      : 'No download route is published for this artifact.'
  );

  return [
    { label: 'Artifact', value: artifact.key || artifact.id || 'Unknown artifact' },
    { label: 'Badge', value: classification.badge },
    { label: 'Type', value: artifact.type || 'Unknown' },
    { label: 'File name', value: artifact.file_name || 'Unknown' },
    { label: 'Content type', value: artifact.content_type || 'Unknown' },
    { label: 'Exists / size', value: formatArtifactAvailability(artifact) },
    { label: 'Scope / stability', value: formatArtifactContract(artifact) },
    ...(artifact.contract?.reentry_target
      ? [{ label: 'Re-entry target', value: artifact.contract.reentry_target }]
      : []),
    ...(identity && Object.keys(identity).length > 0
      ? [
          { label: 'Warning count', value: String(safeList(identity.warnings).length) },
          { label: 'Confidence', value: formatConfidence(identity.confidence) },
          { label: 'Lineage', value: formatLineage(identity.lineage) },
          { label: 'Source refs', value: String(safeList(identity.source_artifact_refs).length) },
        ]
      : []),
    { label: 'Open route', value: openRoute.value, note: openRoute.note },
    { label: 'Download route', value: downloadRoute.value, note: downloadRoute.note },
    ...(sourceLabel ? [{ label: 'Tracked source', value: sourceLabel }] : []),
  ];
}

export function buildArtifactDetailNotes(artifact = {}, activeJob = null) {
  const notes = [
    `Artifact ID: ${artifact.id || 'unknown'}`,
  ];
  const executionNotes = safeList(artifact.contract?.execution_notes);

  const sourceLabel = getTrackedJobSourceLabel(activeJob);
  if (sourceLabel) {
    notes.push(`Tracked source label: ${sourceLabel}`);
  }

  notes.push(...executionNotes.slice(0, 2));

  if (Array.isArray(activeJob?.manifest?.warnings) && activeJob.manifest.warnings.length > 0) {
    notes.push(...activeJob.manifest.warnings.slice(0, 2));
  }

  return notes;
}

function scoreTone(score, { good = 80, warn = 60 } = {}) {
  if (!Number.isFinite(score)) return 'info';
  if (score >= good) return 'ok';
  if (score >= warn) return 'warn';
  return 'bad';
}

function levelTone(level = '') {
  const normalized = String(level).toLowerCase();
  if (normalized === 'low' || normalized === 'ready' || normalized === 'go') return 'ok';
  if (normalized === 'medium' || normalized === 'warning' || normalized === 'candidate_for_pilot_line_review') return 'warn';
  if (normalized === 'high' || normalized === 'hold' || normalized === 'hold_before_line_commitment') return 'bad';
  return 'info';
}

function summarizeList(items = [], fallback = 'No key points were captured in this output.') {
  return Array.isArray(items) && items.length > 0 ? items.slice(0, 3).join(' • ') : fallback;
}

function summarizeClasses(items = [], key = 'classification') {
  const values = uniqueStrings(
    safeList(items).map((entry) => (isPlainObject(entry) ? entry[key] : null))
  );
  return values.length > 0 ? values.join(' • ') : 'none';
}

function summarizeSourceClasses(sources = []) {
  const values = uniqueStrings(
    safeList(sources).map((entry) => (isPlainObject(entry) ? entry.kind : null))
  );
  return values.length > 0 ? values.join(' • ') : 'none';
}

function summarizePackageReadiness(packages = []) {
  const values = safeList(packages)
    .map((pkg) => {
      if (!isPlainObject(pkg)) return null;
      const readiness = safeObject(pkg.readiness_after);
      return `${pkg.slug || 'unknown'}: ${readiness.status || 'unknown'} / ${readiness.gate_decision || 'unknown'}`;
    })
    .filter(Boolean);
  return values.length > 0 ? values.join(' • ') : 'No package readiness records';
}

function formatInspectionIntakeBoundary() {
  return 'Generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts, fixtures, templates, and collection guides are not inspection evidence.';
}

function formatPromotionDryRunBoundary(manifest = {}) {
  const rejected = uniqueStrings(safeList(manifest.evidence_boundary?.rejected_as_final_evidence));
  const prefix = rejected.length > 0
    ? rejected.join(', ')
    : 'Dry-run manifests, intake reports, generated CAD/drawing/quality/readiness/review reports, release bundles, screenshots, CI summaries, templates, collection guides, and GitHub metadata';
  return `${prefix} are not inspection evidence. Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.`;
}

function formatStage5bAuditBoundary(manifest = {}) {
  const rejected = uniqueStrings(safeList(manifest.evidence_boundary?.rejected_as_final_evidence));
  const prefix = rejected.length > 0
    ? rejected.join(', ')
    : 'Intake reports, dry-run manifests, audit manifests, fixtures, generated CAD/drawing/quality/DFM/readiness/review reports, release bundles, screenshots, CI summaries, templates, collection guides, and GitHub metadata alone';
  return `${prefix} are not evidence. Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.`;
}

function firstPromotionDryRunPackage(manifest = {}) {
  return safeList(manifest.packages).find((entry) => isPlainObject(entry)) || {};
}

function formatCommand(command = null) {
  if (!Array.isArray(command) || command.length === 0) return 'None';
  return command.join(' ');
}

function formatExpectedArtifacts(artifacts = []) {
  const paths = safeList(artifacts)
    .map((entry) => (isPlainObject(entry) ? entry.path || entry.artifact_type : null))
    .filter(Boolean);
  return paths.length > 0 ? paths.slice(0, 4).join(' • ') : 'none';
}

function formatStage5bPackageReadiness(packages = []) {
  const values = safeList(packages)
    .map((pkg) => {
      if (!isPlainObject(pkg)) return null;
      const readiness = safeObject(pkg.readiness_after);
      return `${pkg.slug || 'unknown'}: ${readiness.status || 'unknown'} / ${readiness.gate_decision || 'unknown'} (${pkg.promotion_status || 'not_evaluated'})`;
    })
    .filter(Boolean);
  return values.length > 0 ? values.join(' • ') : 'No package readiness states recorded';
}

function formatStage5bGitHubSummary(github = {}) {
  const enabled = github.enabled === true ? 'Enabled' : 'Disabled';
  return `${enabled} for ${github.repo || 'unknown repo'}; searched ${github.searched_source_count || 0}, skipped ${github.skipped_source_count || 0}, downloaded ${github.downloaded_candidate_count || 0}`;
}

function formatStage5bNextSafeCommands(commands = []) {
  const values = safeList(commands)
    .filter((entry) => isPlainObject(entry))
    .map((entry) => `${entry.name || 'command'}: ${formatCommand(entry.command)} (${entry.mutates_canonical_artifacts === true ? 'mutates canonical artifacts' : 'non-mutating'})`);
  return values.length > 0 ? values.slice(0, 4).join(' • ') : 'No safe commands recorded';
}

function formatEvidenceReadinessPackageStates(packages = []) {
  const values = safeList(packages)
    .map((pkg) => {
      if (!isPlainObject(pkg)) return null;
      const readiness = safeObject(pkg.readiness);
      return `${pkg.slug || 'unknown'}: ${readiness.status || 'unknown'} / ${readiness.gate_decision || 'unknown'}`;
    })
    .filter(Boolean);
  return values.length > 0 ? values.slice(0, 5).join(' • ') : 'No package states recorded';
}

function formatPr170ArtifactCoverage(summary = {}) {
  const coverage = safeObject(summary.pr170_artifact_coverage);
  const packageCount = Number.isFinite(summary.package_count) ? summary.package_count : 0;
  const complete = Number.isFinite(coverage.complete_package_count) ? coverage.complete_package_count : 0;
  const missing = Number.isFinite(coverage.missing_package_count)
    ? coverage.missing_package_count
    : Math.max(0, packageCount - complete);
  return `complete ${complete}/${packageCount}; missing ${missing}`;
}

function formatPr170ArtifactStates(packages = []) {
  const values = safeList(packages)
    .map((pkg) => {
      if (!isPlainObject(pkg)) return null;
      const artifacts = safeObject(pkg.pr170_artifacts);
      const graph = safeObject(artifacts.evidence_graph).status || 'missing';
      const runtime = safeObject(artifacts.runtime_fingerprint).status || 'missing';
      const qif = safeObject(artifacts.qif_lite).status || 'missing';
      return `${pkg.slug || 'unknown'}: graph ${graph}; runtime ${runtime}; qif_lite ${qif}`;
    })
    .filter(Boolean);
  return values.length > 0 ? values.slice(0, 5).join(' • ') : 'No PR #170 artifact states recorded';
}

function formatEvidenceReadinessRuntime(runtime = {}) {
  return runtime.available === true ? 'Available' : 'Unavailable';
}

function formatMutationBoundary(boundary = {}) {
  const futureRoots = safeList(boundary.allowed_future_mutation_roots);
  const files = safeList(boundary.files_that_would_be_mutated);
  return [
    `dry_run_writes: ${safeList(boundary.dry_run_writes).join(', ') || 'promotion_dry_run_manifest.json'}`,
    `canonical_artifacts_mutated_by_dry_run: ${boundary.canonical_artifacts_mutated_by_dry_run === true ? 'true' : 'false'}`,
    `future mutation roots: ${futureRoots.length > 0 ? futureRoots.join(', ') : 'none'}`,
    `future file count: ${files.length}`,
  ].join(' • ');
}

function formatReadinessExpectationForDryRun(pkg = {}, summary = {}) {
  const dryRun = safeObject(pkg.readiness_expectation?.dry_run);
  const status = dryRun.status || 'needs_more_evidence';
  const gate = dryRun.gate_decision || 'hold_for_evidence_completion';
  return `${status} / ${gate}; ${summary.readiness_expectation || 'Dry-run does not mutate readiness.'}`;
}

function manifestNotes(manifest = null, artifact = null) {
  if (!manifest) return [];
  const notes = [];
  if (manifest.command) notes.push(`Command: ${manifest.command}`);
  if (manifest.git_commit) notes.push(`Git commit: ${String(manifest.git_commit).slice(0, 12)}`);
  if (manifest.config_path) notes.push(`Config: ${manifest.config_path}`);
  if (Array.isArray(manifest.warnings) && manifest.warnings.length > 0) {
    notes.push(`Warnings: ${manifest.warnings.slice(0, 2).join(' | ')}`);
  }
  if (Array.isArray(manifest.deprecations) && manifest.deprecations.length > 0) {
    notes.push(`Deprecations: ${manifest.deprecations.slice(0, 2).join(' | ')}`);
  }
  if (artifact?.scope) notes.push(`Scope: ${artifact.scope}`);
  if (artifact?.stability) notes.push(`Stability: ${artifact.stability}`);
  return notes;
}

function buildCard({
  id,
  title,
  tone = 'info',
  score = null,
  status = 'Not available',
  summary,
  artifact = null,
  normalized = [],
  raw = null,
  empty = false,
  provenance = [],
  graphSummary = null,
}) {
  return {
    id,
    title,
    tone,
    score,
    status,
    summary,
    artifact,
    normalized,
    raw,
    empty,
    provenance,
    graphSummary,
  };
}

function graphSummary(document = {}) {
  if (!isPlainObject(document)) return {};
  return isPlainObject(document.summary) ? document.summary : document;
}

function formatEvidenceGraphCount(value) {
  return Number.isFinite(value) ? String(value) : 'Unknown';
}

function evidenceGraphTone(summary = {}) {
  const status = String(summary.readiness_status || '').toLowerCase();
  const gate = String(summary.readiness_gate_decision || '').toLowerCase();
  if (status === 'needs_more_evidence' || gate === 'hold_for_evidence_completion') return 'warn';
  return Number(summary.inspection_evidence_record_count) > 0 ? 'ok' : 'info';
}

function buildEvidenceGraphCard({
  graph = {},
  artifact = null,
  raw = null,
  activeManifest = null,
} = {}) {
  const summary = graphSummary(graph);
  const readinessStatus = formatReviewDisplayValue(summary.readiness_status, 'Unknown');
  const gateDecision = formatReviewDisplayValue(summary.readiness_gate_decision, 'Unknown');
  const inspectionEvidenceRecords = formatEvidenceGraphCount(summary.inspection_evidence_record_count);
  const generatedArtifacts = formatEvidenceGraphCount(summary.generated_artifact_count);

  return buildCard({
    id: 'evidence-graph',
    title: 'Evidence graph',
    tone: evidenceGraphTone(summary),
    score: Number.isFinite(summary.inspection_evidence_record_count)
      ? summary.inspection_evidence_record_count
      : null,
    status: readinessStatus,
    summary: `${readinessStatus} / ${gateDecision}; inspection evidence records: ${inspectionEvidenceRecords}; generated artifacts: ${generatedArtifacts}. ${EVIDENCE_GRAPH_BOUNDARY}`,
    artifact,
    normalized: [
      buildReviewDisplayField('Readiness status', readinessStatus),
      buildReviewDisplayField('Gate decision', gateDecision),
      buildReviewDisplayField('Inspection evidence records', inspectionEvidenceRecords),
      buildReviewDisplayField('Generated artifacts', generatedArtifacts),
      buildReviewDisplayField('Nodes', formatEvidenceGraphCount(summary.node_count)),
      buildReviewDisplayField('Edges', formatEvidenceGraphCount(summary.edge_count)),
      buildReviewDisplayField('Evidence boundary', EVIDENCE_GRAPH_BOUNDARY),
    ],
    raw,
    provenance: [
      ...manifestNotes(activeManifest, artifact),
      EVIDENCE_GRAPH_BOUNDARY,
      'Preview is limited to registered tracked job artifact routes; no arbitrary local file path is opened.',
    ],
    graphSummary: {
      ...summary,
      evidence_boundary: EVIDENCE_GRAPH_BOUNDARY,
    },
  });
}

function formatValidationDiagnostic(diagnostic = {}) {
  const code = diagnostic.code || 'stage5b.validation_failed';
  const pointer = diagnostic.json_pointer || '/';
  const message = diagnostic.message || 'Validation failed.';
  return `${code} ${pointer}: ${message}`;
}

function summarizeValidationDiagnostics(payload = {}) {
  const diagnostics = safeList(payload.diagnostics);
  return diagnostics.length > 0
    ? diagnostics.map(formatValidationDiagnostic).join(' • ')
    : 'No diagnostics recorded.';
}

function firstValidationDiagnostic(payload = {}) {
  return safeList(payload.diagnostics)[0] || {};
}

export function buildStage5bValidationDiagnosticsCard({
  diagnosticsPayload = {},
  artifact = null,
  raw = null,
  activeManifest = null,
} = {}) {
  const diagnostics = safeList(diagnosticsPayload.diagnostics);
  const firstDiagnostic = firstValidationDiagnostic(diagnosticsPayload);
  const remediation = firstDiagnostic.remediation
    || 'Fix the Stage 5B control artifact field indicated by json_pointer, then rerun validation.';
  const boundary = firstDiagnostic.evidence_boundary_note
    || diagnosticsPayload.evidence_boundary_note
    || 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

  return buildCard({
    id: 'stage5b-validation-diagnostics',
    title: 'Stage 5B validation diagnostics',
    tone: 'bad',
    score: diagnostics.length,
    status: diagnosticsPayload.validation_status === 'failed' ? 'Validation failed' : 'Validation diagnostics',
    summary: `${formatValidationDiagnostic(firstDiagnostic)} ${boundary}`,
    artifact,
    normalized: [
      buildReviewDisplayField('Artifact type', diagnosticsPayload.artifact_type || firstDiagnostic.artifact_type || 'unknown'),
      buildReviewDisplayField('Artifact path', diagnosticsPayload.artifact_path || firstDiagnostic.artifact_path || 'not exposed'),
      buildReviewDisplayField('Diagnostic count', String(diagnostics.length)),
      buildReviewDisplayField('Top diagnostic', formatValidationDiagnostic(firstDiagnostic)),
      buildReviewDisplayField('All diagnostics', summarizeValidationDiagnostics(diagnosticsPayload)),
      buildReviewDisplayField('Remediation', remediation),
      buildReviewDisplayField('Evidence boundary', boundary),
    ],
    raw,
    provenance: [
      ...manifestNotes(activeManifest, artifact),
      'Validation diagnostics are sanitized tracked job artifacts only; they are not inspection evidence.',
      'The browser reads registered diagnostics artifacts or public job diagnostics, not arbitrary local files.',
    ],
  });
}

export function buildInspectionEvidenceIntakeCard({
  report = {},
  artifact = null,
  raw = null,
  manifest = null,
} = {}) {
  const summary = safeObject(report.summary);
  const acceptedCount = Number.isFinite(summary.accepted_candidate_count) ? summary.accepted_candidate_count : 0;
  const rejectedCount = Number.isFinite(summary.rejected_candidate_count) ? summary.rejected_candidate_count : 0;
  const attachmentReadyCount = Number.isFinite(summary.attachment_ready_candidate_count)
    ? summary.attachment_ready_candidate_count
    : 0;
  const foundGenuineEvidence = summary.genuine_inspection_evidence_found === true;
  const hasAttachmentReadyCandidate = attachmentReadyCount > 0;
  const readinessTruth = summary.readiness_truth
    || (foundGenuineEvidence
      ? 'candidate evidence found; readiness remains held until later authorized attachment'
      : 'readiness remains needs_more_evidence / hold_for_evidence_completion');
  const status = hasAttachmentReadyCandidate
    ? 'Attachment-ready candidate needs authorization'
    : (foundGenuineEvidence
      ? 'Genuine candidate found; readiness held'
      : 'No accepted genuine candidate');

  return buildCard({
    id: 'inspection-intake',
    title: 'Stage 5B inspection evidence intake',
    tone: 'warn',
    score: acceptedCount,
    status,
    summary: `${readinessTruth}. No human-entered measurements requested.`,
    artifact,
    normalized: [
      buildReviewDisplayField('Searched source classes', summarizeSourceClasses(report.searched_sources)),
      buildReviewDisplayField('Accepted candidates', String(acceptedCount)),
      buildReviewDisplayField('Inspection evidence attached', 'No'),
      buildReviewDisplayField('Attachment-ready candidates', String(attachmentReadyCount)),
      buildReviewDisplayField('Rejected candidates', String(rejectedCount)),
      buildReviewDisplayField('Rejection classes', summarizeClasses(report.rejected_candidates)),
      buildReviewDisplayField('Package readiness', summarizePackageReadiness(report.packages)),
      buildReviewDisplayField('Readiness explanation', readinessTruth),
      buildReviewDisplayField('Evidence boundary', formatInspectionIntakeBoundary(report)),
    ],
    raw,
    provenance: [
      ...manifestNotes(manifest, artifact),
      'Tracked job report preview only; no arbitrary local file import is used.',
      'Intake reports are discovery/review artifacts only, not inspection evidence.',
    ],
  });
}

export function buildInspectionEvidencePromotionDryRunCard({
  manifest = {},
  artifact = null,
  raw = null,
  activeManifest = null,
} = {}) {
  const summary = safeObject(manifest.summary);
  const pkg = firstPromotionDryRunPackage(manifest);
  const promotionCanRun = summary.promotion_can_run === true;
  const readinessExpectation = summary.readiness_expectation
    || (promotionCanRun
      ? 'Future promotion commands are listed, but readiness remains unchanged until deliberately run with genuine evidence.'
      : 'No promotion can run; readiness remains needs_more_evidence / hold_for_evidence_completion.');
  const canonicalMutated = summary.canonical_artifacts_mutated === true;

  return buildCard({
    id: 'inspection-promotion-dry-run',
    title: 'Stage 5B promotion dry-run',
    tone: promotionCanRun ? 'ok' : 'warn',
    score: Number.isFinite(summary.ready_package_count) ? summary.ready_package_count : null,
    status: promotionCanRun ? 'Future promotion plan ready' : 'Promotion held',
    summary: `${readinessExpectation} No canonical artifacts mutated by the dry-run.`,
    artifact,
    normalized: [
      buildReviewDisplayField('Package slug', pkg.package_slug || 'none'),
      buildReviewDisplayField('Attachment ready', pkg.attachment_ready === true ? 'Yes' : 'No'),
      buildReviewDisplayField('Match confidence', pkg.match_confidence || 'none'),
      buildReviewDisplayField('Blockers', uniqueStrings(safeList(pkg.blockers)).join(' • ') || 'none'),
      buildReviewDisplayField('Canonical next command', formatCommand(pkg.canonical_next_command)),
      buildReviewDisplayField('Expected artifacts', formatExpectedArtifacts(pkg.expected_artifacts)),
      buildReviewDisplayField('Mutation boundaries', formatMutationBoundary(safeObject(pkg.mutation_boundaries))),
      buildReviewDisplayField('Readiness expectation', formatReadinessExpectationForDryRun(pkg, summary)),
      buildReviewDisplayField('Rollback guidance', summarizeList(pkg.rollback_guidance, 'No rollback guidance recorded.')),
      buildReviewDisplayField('Evidence boundary', formatPromotionDryRunBoundary(manifest)),
      buildReviewDisplayField('Canonical artifacts mutated', canonicalMutated ? 'Yes' : 'No'),
    ],
    raw,
    provenance: [
      ...manifestNotes(activeManifest, artifact),
      'Dry-run manifests are planning/control artifacts only, not package inspection evidence.',
      'Preview is limited to the registered tracked job artifact route.',
    ],
  });
}

export function buildStage5bEvidenceAuditCard({
  manifest = {},
  artifact = null,
  raw = null,
  activeManifest = null,
} = {}) {
  const summary = safeObject(manifest.summary);
  const truth = safeObject(manifest.readiness_held_truth);
  const genuineFound = summary.genuine_inspection_evidence_found === true;
  const promotionCanRun = summary.promotion_can_run === true;
  const attachmentReadyCount = Number.isFinite(summary.attachment_ready_candidate_count)
    ? summary.attachment_ready_candidate_count
    : (Number.isFinite(manifest.attachment_ready?.count) ? manifest.attachment_ready.count : null);
  const readinessStatement = truth.statement
    || (promotionCanRun
      ? 'A future promotion plan exists, but this audit did not attach evidence or change canonical readiness.'
      : 'No genuine completed inspection evidence is available for promotion; no promotion can run and readiness remains needs_more_evidence / hold_for_evidence_completion.');

  return buildCard({
    id: 'stage5b-evidence-audit',
    title: 'Stage 5B evidence audit',
    tone: promotionCanRun && genuineFound ? 'ok' : 'warn',
    score: attachmentReadyCount,
    status: 'Readiness held',
    summary: `${readinessStatement} ${promotionCanRun ? 'Promotion can run only as a future controlled command.' : 'No promotion can run.'} No canonical artifacts mutated.`,
    artifact,
    normalized: [
      buildReviewDisplayField('Genuine candidate found', genuineFound ? 'Yes' : 'No'),
      buildReviewDisplayField('Inspection evidence attached', 'No'),
      buildReviewDisplayField('Promotion can run', promotionCanRun ? 'Yes' : 'No'),
      buildReviewDisplayField('Attachment-ready candidates', attachmentReadyCount === null ? 'Unknown' : String(attachmentReadyCount)),
      buildReviewDisplayField('Blockers', uniqueStrings(safeList(manifest.blockers)).join(' • ') || 'none'),
      buildReviewDisplayField('Package readiness states', formatStage5bPackageReadiness(manifest.canonical_package_readiness_states)),
      buildReviewDisplayField('GitHub summary', formatStage5bGitHubSummary(safeObject(manifest.github_summary))),
      buildReviewDisplayField('Next safe commands', formatStage5bNextSafeCommands(manifest.next_safe_commands)),
      buildReviewDisplayField('Readiness-held truth', readinessStatement),
      buildReviewDisplayField('Evidence boundary', formatStage5bAuditBoundary(manifest)),
      buildReviewDisplayField('Canonical artifacts mutated', summary.canonical_artifacts_mutated === true ? 'Yes' : 'No'),
    ],
    raw,
    provenance: [
      ...manifestNotes(activeManifest, artifact),
      'Stage 5B audit bundles are review/control artifacts only, not package inspection evidence.',
      'Preview is limited to registered tracked job artifact routes; no arbitrary local file path is opened.',
    ],
  });
}

export function buildEvidenceReadinessAuditCard({
  audit = {},
  artifact = null,
  raw = null,
  activeManifest = null,
} = {}) {
  const summary = safeObject(audit.summary);
  const decision = safeObject(audit.maintainer_decision);
  const heldCount = Number.isFinite(summary.held_package_count) ? summary.held_package_count : 0;
  const packageCount = Number.isFinite(summary.package_count) ? summary.package_count : 0;
  const trustedCount = Number.isFinite(summary.trusted_evidence_record_count)
    ? summary.trusted_evidence_record_count
    : 0;
  const generatedCount = Number.isFinite(summary.generated_review_artifact_count)
    ? summary.generated_review_artifact_count
    : 0;
  const releaseRiskCount = Number.isFinite(summary.release_overclaim_risk_count)
    ? summary.release_overclaim_risk_count
    : 0;
  const hold = summary.decision === 'hold' || heldCount > 0 || releaseRiskCount > 0;
  const boundary = audit.boundary?.hard_evidence_rule
    || 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';

  return buildCard({
    id: 'evidence-readiness-audit',
    title: 'Evidence/readiness maintainer audit',
    tone: hold ? 'warn' : 'ok',
    score: heldCount,
    status: hold ? 'Maintainer hold' : 'Maintainer pass',
    summary: `${heldCount} of ${packageCount} canonical packages held; ${trustedCount} trusted inspection evidence records; ${generatedCount} generated review/control artifacts. ${decision.reason || 'Read-only audit.'}`,
    artifact,
    normalized: [
      buildReviewDisplayField('Packages held', `${heldCount}/${packageCount}`),
      buildReviewDisplayField('Trusted inspection evidence', String(trustedCount)),
      buildReviewDisplayField('Generated review/control artifacts', String(generatedCount)),
      buildReviewDisplayField('Evidence graph packages', String(summary.evidence_graph_package_count ?? 0)),
      buildReviewDisplayField('Runtime fingerprint packages', String(summary.runtime_fingerprint_package_count ?? 0)),
      buildReviewDisplayField('QIF-lite packages', String(summary.qif_lite_package_count ?? 0)),
      buildReviewDisplayField('PR #170 artifact coverage', formatPr170ArtifactCoverage(summary)),
      buildReviewDisplayField('PR #170 artifact states', formatPr170ArtifactStates(audit.packages)),
      buildReviewDisplayField('Release overclaim risks', String(releaseRiskCount)),
      buildReviewDisplayField('Runtime context', formatEvidenceReadinessRuntime(safeObject(audit.runtime_context))),
      buildReviewDisplayField('Package readiness states', formatEvidenceReadinessPackageStates(audit.packages)),
      buildReviewDisplayField('Next safe commands', formatStage5bNextSafeCommands(audit.next_safe_commands)),
      buildReviewDisplayField('Evidence boundary', boundary),
    ],
    raw,
    provenance: [
      ...manifestNotes(activeManifest, artifact),
      'Evidence/readiness audits are maintainer decision artifacts; they do not attach evidence or regenerate readiness.',
      'Preview is limited to the registered tracked job artifact route.',
    ],
  });
}

export function buildReviewCards({ activeJob, artifacts = [], sourceMap = {} }) {
  const manifest = activeJob?.manifest || null;
  const evidenceReadinessAuditArtifact = findArtifact(artifacts, ['evidence-readiness.audit-json', 'evidence_readiness_audit']);
  const evidenceReadinessAudit = sourceMap.evidenceReadinessAudit;
  const validationDiagnosticsArtifact = findArtifact(artifacts, ['stage5b.validation-diagnostics', 'validation_diagnostics']);
  const validationDiagnostics = sourceMap.stage5bValidationDiagnostics
    || activeJob?.diagnostics?.stage5b_validation_diagnostics
    || null;
  const evidenceGraphArtifact = findArtifact(artifacts, ['evidence-graph', 'evidence_graph']);
  const evidenceGraph = sourceMap.evidenceGraph;
  const stage5bAuditArtifact = findArtifact(artifacts, ['stage5b.evidence-audit-manifest', 'stage5b-evidence-audit', 'stage5b_audit_manifest']);
  const stage5bAudit = sourceMap.stage5bAudit;
  const inspectionIntakeArtifact = findArtifact(artifacts, ['inspection-evidence.intake-report', 'inspection-evidence-intake-report', 'intake-report']);
  const inspectionIntake = sourceMap.inspectionIntake;
  const inspectionPromotionDryRunArtifact = findArtifact(artifacts, ['inspection-evidence.promotion-dry-run-manifest', 'inspection-evidence-promotion-dry-run-manifest', 'promotion_dry_run_manifest']);
  const inspectionPromotionDryRun = sourceMap.inspectionPromotionDryRun;
  const readinessArtifact = findArtifact(artifacts, ['readiness']);
  const readiness = sourceMap.readiness;
  const productReviewArtifact = readinessArtifact || findArtifact(artifacts, ['product_review', 'review.product']);
  const qualityArtifact = readinessArtifact || findArtifact(artifacts, ['quality_risk', 'review.quality-risk']);
  const investmentArtifact = readinessArtifact || findArtifact(artifacts, ['investment_review', 'review.investment-review']);
  const standardDocsArtifact = findArtifact(artifacts, ['standard_docs_manifest', 'standard-docs.summary']);
  const reviewPackArtifact = findArtifact(artifacts, ['review-pack', 'process_plan', 'line_plan', 'drawing.qa-report']);
  const revisionImpactArtifact = findArtifact(artifacts, ['revision-impact.report-json', 'revision_impact_report.json']);
  const revisionImpact = sourceMap.revisionImpact;

  const productReview = readiness?.product_review || sourceMap.productReview;
  const qualityRisk = readiness?.quality_risk || sourceMap.qualityRisk;
  const investmentReview = readiness?.investment_review || sourceMap.investmentReview;
  const standardDocs = sourceMap.standardDocs;
  const reviewPack = sourceMap.reviewPack;

  const cards = [
    ...(revisionImpact
      ? [
          buildCard({
            id: 'revision-impact',
            title: 'Revision impact and reinspection',
            tone: revisionImpact.summary?.decision === 'no_material_change' ? 'ok' : 'warn',
            score: revisionImpact.summary?.material_change_count ?? null,
            status: formatReviewDisplayValue(revisionImpact.summary?.decision, 'Human review required'),
            summary: `${revisionImpact.summary?.material_change_count || 0} material changes; ${revisionImpact.summary?.reinspection_required_count || 0} reinspection requirements; ${revisionImpact.summary?.unable_to_determine_count || 0} unresolved impacts.`,
            artifact: revisionImpactArtifact,
            normalized: [
              buildReviewDisplayField('Baseline revision', revisionImpact.baseline?.revision, 'Unknown'),
              buildReviewDisplayField('Candidate revision', revisionImpact.candidate?.revision, 'Unknown'),
              buildReviewDisplayField('Readiness review required', revisionImpact.summary?.readiness_review_required ? 'Yes' : 'No'),
              buildReviewDisplayField('Evidence state changed', revisionImpact.evidence_applicability?.authoritative_evidence_state_changed ? 'Yes' : 'No'),
            ],
            raw: sourceMap.revisionImpactRaw,
            provenance: [
              ...manifestNotes(manifest, revisionImpactArtifact),
              'No inspection evidence was attached.',
              'Existing evidence was not mutated.',
              'No evidence was superseded.',
              'Readiness was not regenerated.',
              'A reinspection plan is not completed inspection evidence.',
              'Human review is required before any evidence or readiness action.',
            ],
          }),
        ]
      : []),
    ...(evidenceReadinessAudit
      ? [
          buildEvidenceReadinessAuditCard({
            audit: evidenceReadinessAudit,
            artifact: evidenceReadinessAuditArtifact,
            raw: sourceMap.evidenceReadinessAuditRaw,
            activeManifest: manifest,
          }),
        ]
      : []),
    ...(validationDiagnostics
      ? [
          buildStage5bValidationDiagnosticsCard({
            diagnosticsPayload: validationDiagnostics,
            artifact: validationDiagnosticsArtifact,
            raw: sourceMap.stage5bValidationDiagnosticsRaw,
            activeManifest: manifest,
          }),
        ]
      : []),
    ...(evidenceGraph
      ? [
          buildEvidenceGraphCard({
            graph: evidenceGraph,
            artifact: evidenceGraphArtifact,
            raw: sourceMap.evidenceGraphRaw,
            activeManifest: manifest,
          }),
        ]
      : []),
    ...(stage5bAudit
      ? [
          buildStage5bEvidenceAuditCard({
            manifest: stage5bAudit,
            artifact: stage5bAuditArtifact,
            raw: sourceMap.stage5bAuditRaw,
            activeManifest: manifest,
          }),
        ]
      : []),
    ...(inspectionPromotionDryRun
      ? [
          buildInspectionEvidencePromotionDryRunCard({
            manifest: inspectionPromotionDryRun,
            artifact: inspectionPromotionDryRunArtifact,
            raw: sourceMap.inspectionPromotionDryRunRaw,
            activeManifest: manifest,
          }),
        ]
      : []),
    ...(inspectionIntake
      ? [
          buildInspectionEvidenceIntakeCard({
            report: inspectionIntake,
            artifact: inspectionIntakeArtifact,
            raw: sourceMap.inspectionIntakeRaw,
            manifest,
          }),
        ]
      : []),
    productReview
      ? buildCard({
          id: 'dfm',
          title: 'DFM risk',
          tone: scoreTone(productReview.summary?.dfm_score, { good: 82, warn: 68 }),
          score: productReview.summary?.dfm_score ?? null,
          status: formatReviewDisplayValue(productReview.summary?.overall_risk_level, 'Heuristic review available'),
          summary: summarizeList(productReview.summary?.top_issues || productReview.summary?.primary_risks),
          artifact: productReviewArtifact,
          normalized: [
            buildReviewDisplayField('Part type', productReview.summary?.part_type, 'Unknown'),
            buildReviewDisplayField('Overall risk', productReview.summary?.overall_risk_level, 'Unknown'),
            buildReviewDisplayField('Recommended action', (productReview.summary?.recommended_actions || [])[0], 'No explicit action listed'),
          ],
          raw: sourceMap.productReviewRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, productReviewArtifact),
        })
      : buildCard({
          id: 'dfm',
          title: 'DFM risk',
          tone: 'info',
          status: 'Missing',
          summary: 'No manufacturability review artifact is attached to the selected job yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    qualityRisk
      ? buildCard({
          id: 'quality',
          title: 'Quality risk',
          tone: levelTone(qualityRisk.summary?.overall_risk_level),
          score: Array.isArray(qualityRisk.critical_dimensions) ? qualityRisk.critical_dimensions.length : null,
          status: formatReviewDisplayValue(qualityRisk.summary?.overall_risk_level, 'Quality review available'),
          summary: summarizeList(qualityRisk.summary?.top_issues),
          artifact: qualityArtifact,
          normalized: [
            buildReviewDisplayField('Critical dimensions', String((qualityRisk.critical_dimensions || []).length)),
            buildReviewDisplayField('Quality gates', String((qualityRisk.quality_gates || []).length)),
            buildReviewDisplayField('Traceability focus', summarizeList(qualityRisk.summary?.traceability_focus, 'Not provided')),
          ],
          raw: sourceMap.qualityRiskRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, qualityArtifact),
        })
      : buildCard({
          id: 'quality',
          title: 'Quality risk',
          tone: 'info',
          status: 'Missing',
          summary: 'No quality-risk or traceability output is available for this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    investmentReview
      ? buildCard({
          id: 'investment',
          title: 'Investment / cost review',
          tone: levelTone(investmentReview.summary?.investment_pressure),
          score: investmentReview.cost_breakdown?.unit_cost ?? null,
          status: formatReviewDisplayValue(investmentReview.summary?.investment_pressure, 'Cost screen available'),
          summary: summarizeList(investmentReview.summary?.top_cost_drivers),
          artifact: investmentArtifact,
          normalized: [
            buildReviewDisplayField('Unit cost', investmentReview.cost_breakdown?.unit_cost, 'n/a'),
            buildReviewDisplayField('Total cost', investmentReview.cost_breakdown?.total_cost, 'n/a'),
            buildReviewDisplayField('Pressure', investmentReview.summary?.investment_pressure, 'Unknown'),
          ],
          raw: sourceMap.investmentReviewRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, investmentArtifact),
        })
      : buildCard({
          id: 'investment',
          title: 'Investment / cost review',
          tone: 'info',
          status: 'Missing',
          summary: 'No investment or cost review artifact is attached to this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    readiness
      ? buildCard({
          id: 'readiness',
          title: 'Readiness summary',
          tone: scoreTone(readiness.readiness_summary?.score, { good: 78, warn: 65 }),
          score: readiness.readiness_summary?.score ?? null,
          status: formatReviewDisplayValue(
            readiness.readiness_summary?.status || readiness.readiness_summary?.gate_decision,
            'Readiness available'
          ),
          summary: summarizeList(readiness.summary?.recommended_actions || readiness.decision_summary?.next_actions),
          artifact: readinessArtifact,
          normalized: [
            buildReviewDisplayField('Gate', readiness.readiness_summary?.gate_decision, 'Unknown'),
            buildReviewDisplayField('Risk level', readiness.summary?.overall_risk_level, 'Unknown'),
            buildReviewDisplayField('Hold points', String((readiness.decision_summary?.hold_points || []).length)),
          ],
          raw: sourceMap.readinessRaw || sourceMap.readinessMarkdownRaw,
          provenance: manifestNotes(manifest, readinessArtifact),
        })
      : buildCard({
          id: 'readiness',
          title: 'Readiness summary',
          tone: 'info',
          status: 'Missing',
          summary: 'No readiness report is attached to the selected job yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    standardDocs
      ? buildCard({
          id: 'standard-docs',
          title: 'Standard docs status',
          tone: (standardDocs.documents || []).length >= 4 ? 'ok' : 'warn',
          score: (standardDocs.documents || []).length,
          status: `${(standardDocs.documents || []).length} docs found`,
          summary: summarizeList((standardDocs.documents || []).map((doc) => doc.filename)),
          artifact: standardDocsArtifact,
          normalized: [
            buildReviewDisplayField('Generated at', standardDocs.generated_at, 'Unknown'),
            buildReviewDisplayField('Draft notice', standardDocs.draft_notice, 'Not provided'),
            buildReviewDisplayField('Docs', String((standardDocs.documents || []).length)),
          ],
          raw: sourceMap.standardDocsRaw,
          provenance: manifestNotes(manifest, standardDocsArtifact),
        })
      : buildCard({
          id: 'standard-docs',
          title: 'Standard docs status',
          tone: 'info',
          status: 'Missing',
          summary: 'No standard-doc manifest or draft document set is available for this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    reviewPack || reviewPackArtifact
      ? buildCard({
          id: 'review-outputs',
          title: 'Design review outputs',
          tone: 'warn',
          status: reviewPack ? 'Review pack available' : 'Artifact set available',
          summary: reviewPack
            ? summarizeList(reviewPack.summary?.top_issues || reviewPack.executive_summary?.top_issues)
            : 'Supplemental review artifacts are attached and ready to inspect.',
          artifact: reviewPackArtifact,
          normalized: reviewPack
            ? [
                buildReviewDisplayField('Summary', reviewPack.summary?.overall_risk_level, 'Available'),
                buildReviewDisplayField('Open items', String((reviewPack.issues || []).length)),
                buildReviewDisplayField('Recommendation', (reviewPack.summary?.recommended_actions || [])[0], 'No explicit recommendation listed'),
              ]
            : [
                buildReviewDisplayField('Artifact', reviewPackArtifact.file_name || reviewPackArtifact.key),
                buildReviewDisplayField('Type', reviewPackArtifact.type, 'review output'),
                buildReviewDisplayField('Status', reviewPackArtifact.exists ? 'Available' : 'Missing'),
              ],
          raw: sourceMap.reviewPackRaw || null,
          provenance: manifestNotes(manifest, reviewPackArtifact),
        })
      : buildCard({
          id: 'review-outputs',
          title: 'Design review outputs',
          tone: 'info',
          status: 'Missing',
          summary: 'No review-pack, process-plan, line-plan, or design-review sidecar is available yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
  ];

  return cards;
}
