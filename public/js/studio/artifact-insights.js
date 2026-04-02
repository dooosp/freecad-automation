import {
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReleaseBundleManifestArtifact,
  isReviewPackArtifact,
  isRevisionComparisonArtifact,
  isStabilizationReviewArtifact,
} from './artifact-actions.js';

const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/toml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
  'text/',
];

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
  if (isRevisionComparisonArtifact(artifact)) return { badge: 'compare', tone: 'warn' };
  if (isStabilizationReviewArtifact(artifact)) return { badge: 'stabilization', tone: 'warn' };
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
  const contentType = String(artifact?.content_type || '').toLowerCase();
  const extension = String(artifact?.extension || '').toLowerCase();

  if (contentType.includes('json') || extension === '.json') {
    return JSON.parse(rawText);
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
  };
}

export function buildReviewCards({ activeJob, artifacts = [], sourceMap = {} }) {
  const manifest = activeJob?.manifest || null;
  const readinessArtifact = findArtifact(artifacts, ['readiness']);
  const readiness = sourceMap.readiness;
  const productReviewArtifact = readinessArtifact || findArtifact(artifacts, ['product_review', 'review.product']);
  const qualityArtifact = readinessArtifact || findArtifact(artifacts, ['quality_risk', 'review.quality-risk']);
  const investmentArtifact = readinessArtifact || findArtifact(artifacts, ['investment_review', 'review.investment-review']);
  const standardDocsArtifact = findArtifact(artifacts, ['standard_docs_manifest', 'standard-docs.summary']);
  const reviewPackArtifact = findArtifact(artifacts, ['review-pack', 'process_plan', 'line_plan', 'drawing.qa-report']);

  const productReview = readiness?.product_review || sourceMap.productReview;
  const qualityRisk = readiness?.quality_risk || sourceMap.qualityRisk;
  const investmentReview = readiness?.investment_review || sourceMap.investmentReview;
  const standardDocs = sourceMap.standardDocs;
  const reviewPack = sourceMap.reviewPack;

  const cards = [
    productReview
      ? buildCard({
          id: 'dfm',
          title: 'DFM risk',
          tone: scoreTone(productReview.summary?.dfm_score, { good: 82, warn: 68 }),
          score: productReview.summary?.dfm_score ?? null,
          status: productReview.summary?.overall_risk_level || 'Heuristic review available',
          summary: summarizeList(productReview.summary?.top_issues || productReview.summary?.primary_risks),
          artifact: productReviewArtifact,
          normalized: [
            ['Part type', productReview.summary?.part_type || 'Unknown'],
            ['Overall risk', productReview.summary?.overall_risk_level || 'Unknown'],
            ['Recommended action', (productReview.summary?.recommended_actions || [])[0] || 'No explicit action listed'],
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
          status: qualityRisk.summary?.overall_risk_level || 'Quality review available',
          summary: summarizeList(qualityRisk.summary?.top_issues),
          artifact: qualityArtifact,
          normalized: [
            ['Critical dimensions', String((qualityRisk.critical_dimensions || []).length)],
            ['Quality gates', String((qualityRisk.quality_gates || []).length)],
            ['Traceability focus', summarizeList(qualityRisk.summary?.traceability_focus, 'Not provided')],
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
          status: investmentReview.summary?.investment_pressure || 'Cost screen available',
          summary: summarizeList(investmentReview.summary?.top_cost_drivers),
          artifact: investmentArtifact,
          normalized: [
            ['Unit cost', investmentReview.cost_breakdown?.unit_cost ?? 'n/a'],
            ['Total cost', investmentReview.cost_breakdown?.total_cost ?? 'n/a'],
            ['Pressure', investmentReview.summary?.investment_pressure || 'Unknown'],
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
          status: readiness.readiness_summary?.status || readiness.readiness_summary?.gate_decision || 'Readiness available',
          summary: summarizeList(readiness.summary?.recommended_actions || readiness.decision_summary?.next_actions),
          artifact: readinessArtifact,
          normalized: [
            ['Gate', readiness.readiness_summary?.gate_decision || 'Unknown'],
            ['Risk level', readiness.summary?.overall_risk_level || 'Unknown'],
            ['Hold points', String((readiness.decision_summary?.hold_points || []).length)],
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
            ['Generated at', standardDocs.generated_at || 'Unknown'],
            ['Draft notice', standardDocs.draft_notice || 'Not provided'],
            ['Docs', String((standardDocs.documents || []).length)],
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
                ['Summary', reviewPack.summary?.overall_risk_level || 'Available'],
                ['Open items', String((reviewPack.issues || []).length)],
                ['Recommendation', (reviewPack.summary?.recommended_actions || [])[0] || 'No explicit recommendation listed'],
              ]
            : [
                ['Artifact', reviewPackArtifact.file_name || reviewPackArtifact.key],
                ['Type', reviewPackArtifact.type || 'review output'],
                ['Status', reviewPackArtifact.exists ? 'Available' : 'Missing'],
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
