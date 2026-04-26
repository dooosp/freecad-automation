import {
  createButton,
  createCard,
  createEmptyState,
  createInfoGrid,
  createList,
  createPill,
  createSectionHeader,
  el,
} from './renderers.js';
import {
  buildArtifactOpenLabel,
  buildArtifactDetailItems,
  buildArtifactDetailNotes,
  buildArtifactViewer,
  canPreviewAsText,
  classifyArtifact,
  fetchArtifactText,
  formatBytes,
  formatDateTime,
  formatJobStatus,
  parseArtifactPayload,
  shortJobId,
} from './artifact-insights.js';
import {
  deriveArtifactReentryCapabilities,
  findDefaultArtifactForJob,
  findPreferredConfigArtifact,
  findPreferredDocsManifestArtifact,
  findPreferredReadinessReportArtifact,
  findPreferredReleaseBundleArtifact,
  findPreferredReleaseBundleManifestArtifact,
  findPreferredReviewPackArtifact,
  isReadinessReportArtifact,
  isReleaseBundleArtifact,
  isReviewPackArtifact,
} from './artifact-actions.js';
import {
  buildQualityDashboardModel,
  collectQualityDashboardArtifacts,
  formatQualityStatusLabel,
} from './quality-dashboard.js';
import {
  deriveRecentJobQualityStatus,
  formatRecentJobQualityLine,
} from './recent-job-quality-status.js';
import { applyTranslations } from '../i18n/index.js';

function ensureArtifactsWorkspaceState(store = {}) {
  store.selectedArtifactId = store.selectedArtifactId || '';
  store.previewStatus = store.previewStatus || 'idle';
  store.previewText = store.previewText || '';
  store.previewArtifactId = store.previewArtifactId || '';
  store.previewError = store.previewError || '';
  store.viewerStatus = store.viewerStatus || 'idle';
  store.viewerArtifactId = store.viewerArtifactId || '';
  store.viewerError = store.viewerError || '';
  store.viewerData = store.viewerData || null;
  store.qualityStatus = store.qualityStatus || 'idle';
  store.qualityError = store.qualityError || '';
  store.qualityData = store.qualityData || null;
  store.qualityCacheKey = store.qualityCacheKey || '';
  store.compare = store.compare && typeof store.compare === 'object'
    ? store.compare
    : {
        jobId: '',
        status: 'idle',
        errorMessage: '',
        job: null,
        artifacts: [],
      };
  store.cache = store.cache && typeof store.cache === 'object' ? store.cache : {};
  store.viewerCache = store.viewerCache && typeof store.viewerCache === 'object' ? store.viewerCache : {};
  store.qualityCache = store.qualityCache && typeof store.qualityCache === 'object' ? store.qualityCache : {};
  return store;
}

function activeJobIdFromState(state = {}) {
  return state.data?.activeJob?.summary?.id || '';
}

function normalizeConfigIdentity(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.toml$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function artifactStateCacheKey(jobId = '', artifactId = '') {
  return `${jobId || 'no-job'}:${artifactId || 'no-artifact'}`;
}

function renderViewerBlock(viewer) {
  if (!viewer) return [];

  const blocks = [];
  if (viewer.summary) {
    blocks.push(
      el('div', {
        className: 'support-note',
        text: viewer.summary,
      })
    );
  }
  if (Array.isArray(viewer.highlights) && viewer.highlights.length > 0) {
    blocks.push(createInfoGrid(viewer.highlights));
  }
  for (const section of viewer.sections || []) {
    blocks.push(
      el('div', {
        className: 'support-note',
        text: section.title,
      })
    );
    if (Array.isArray(section.items) && section.items.length > 0) {
      blocks.push(createInfoGrid(section.items));
    }
    for (const entry of section.entries || []) {
      blocks.push(
        el('div', {
          className: 'support-note',
          text: `- ${entry}`,
        })
      );
    }
  }
  return blocks;
}

function renderTimeline(recentJobs = [], activeJobId = '', compareJobId = '') {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: '[]',
      title: 'No tracked jobs',
      copy: 'Tracked jobs created by `fcad serve` appear here as an artifact timeline.',
    });
  }

  return el('div', {
    className: 'artifact-timeline',
    children: recentJobs.map((job, index) => {
      const isActive = job.id === activeJobId;
      const isCompare = job.id === compareJobId;
      const status = deriveRecentJobQualityStatus(job);
      return el('article', {
        className: `timeline-item${isActive ? ' is-active' : ''}${index === 0 ? ' is-latest' : ''}`,
        children: [
          el('div', { className: 'timeline-dot' }),
          el('div', {
            className: 'timeline-content',
            children: [
              el('div', {
                className: 'job-title-row',
                children: [
                  el('p', { className: 'job-title', text: formatRecentJobQualityLine(job, shortJobId(job.id)) }),
                  el('span', { className: 'pill', text: index === 0 ? 'Latest' : isActive ? 'Active' : 'Previous' }),
                  isCompare ? el('span', { className: 'pill', text: 'Compare' }) : null,
                ],
              }),
              el('p', {
                className: 'timeline-copy',
                text: `${status.configName} • ${formatDateTime(job.updated_at)}`,
              }),
            ],
          }),
          el('div', {
            className: 'timeline-actions',
            children: [
              createButton({
                label: isActive ? 'Active' : 'Open',
                action: 'artifacts-open-job',
                tone: isActive ? 'primary' : 'ghost',
                dataset: { jobId: job.id },
                disabled: isActive,
              }),
              createButton({
                label: isCompare ? 'Comparing' : 'Compare',
                action: 'artifacts-compare-job',
                tone: 'ghost',
                dataset: { jobId: job.id },
                disabled: !activeJobId || isActive,
              }),
            ],
          }),
        ],
      });
    }),
  });
}

function renderArtifactCard(artifact, selected = false) {
  const classification = classifyArtifact(artifact);
  return el('article', {
    className: `artifact-card${selected ? ' is-selected' : ''}`,
    dataset: { tone: classification.tone },
    children: [
      el('div', {
        className: 'artifact-card-header',
        children: [
          el('div', {
            children: [
              el('div', {
                className: 'job-title-row',
                children: [
                  el('p', { className: 'artifact-title', text: artifact.key }),
                  el('span', { className: `pill pill-status-${classification.tone}`, text: classification.badge }),
                ],
              }),
              el('p', {
                className: 'artifact-meta',
                text: `${artifact.file_name} • ${artifact.exists ? formatBytes(artifact.size_bytes) : 'Missing'}${artifact.type ? ` • ${artifact.type}` : ''}`,
              }),
            ],
          }),
          el('div', {
            className: 'artifact-card-actions',
            children: [
              createButton({
                label: 'Inspect',
                action: 'artifacts-select-artifact',
                tone: selected ? 'primary' : 'ghost',
                dataset: { artifactId: artifact.id },
              }),
            ],
          }),
        ],
      }),
      el('div', {
        className: 'artifact-card-action-row',
        children: [
          artifact.capabilities?.can_open
            ? el('a', {
                className: 'action-button action-button-primary',
                text: 'Open',
                attrs: { href: artifact.links.open, target: '_blank', rel: 'noreferrer noopener' },
              })
            : null,
          artifact.capabilities?.can_download
            ? el('a', {
                className: 'action-button action-button-ghost',
                text: 'Download',
                attrs: { href: artifact.links.download, rel: 'noreferrer' },
              })
            : null,
        ].filter(Boolean),
      }),
    ],
  });
}

function summarizeStorage(storage = null) {
  const files = storage?.files || {};
  const entries = Object.entries(files);
  if (entries.length === 0) return 'Unavailable';
  const available = entries.filter(([, record]) => record?.exists).length;
  return `${available}/${entries.length} indexed`;
}

function diffArtifacts(current = [], baseline = []) {
  const currentTypes = new Set(current.map((artifact) => artifact.type || artifact.file_name));
  const baselineTypes = new Set(baseline.map((artifact) => artifact.type || artifact.file_name));
  const added = [...currentTypes].filter((entry) => !baselineTypes.has(entry));
  const removed = [...baselineTypes].filter((entry) => !currentTypes.has(entry));
  return { added, removed };
}

function compareAvailabilityLabel(isAvailable) {
  return isAvailable ? 'Ready' : 'Missing';
}

function artifactVisibilityText(artifact = {}) {
  return [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
    artifact.extension,
    artifact.content_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function artifactHasAny(artifact = {}, needles = []) {
  const search = artifactVisibilityText(artifact);
  return needles.some((needle) => search.includes(needle));
}

function isAvailableArtifact(artifact = {}) {
  return artifact && artifact.exists !== false;
}

function isStepArtifact(artifact = {}) {
  const extension = String(artifact.extension || '').toLowerCase();
  return isAvailableArtifact(artifact)
    && (extension === '.step' || extension === '.stp' || artifactHasAny(artifact, ['.step', '.stp', 'step export', 'model.step']));
}

function isStlArtifact(artifact = {}) {
  const extension = String(artifact.extension || '').toLowerCase();
  return isAvailableArtifact(artifact)
    && (extension === '.stl' || artifactHasAny(artifact, ['.stl', 'stl export', 'model.stl', 'mesh.stl']));
}

function isPdfReportArtifact(artifact = {}) {
  const extension = String(artifact.extension || '').toLowerCase();
  return isAvailableArtifact(artifact)
    && extension === '.pdf'
    && artifactHasAny(artifact, ['report', 'pdf']);
}

function isReportSummaryArtifactForDownloads(artifact = {}) {
  return isAvailableArtifact(artifact) && artifactHasAny(artifact, [
    'report_summary_json',
    'report summary json',
    '_report_summary.json',
    'report.summary',
  ]);
}

function isCreateQualityArtifactForDownloads(artifact = {}) {
  return isAvailableArtifact(artifact) && artifactHasAny(artifact, [
    'create_quality',
    '_create_quality.json',
    'model.quality-summary',
  ]);
}

function isDrawingQualityArtifactForDownloads(artifact = {}) {
  return isAvailableArtifact(artifact) && artifactHasAny(artifact, [
    'drawing_quality',
    '_drawing_quality.json',
    'drawing.quality-summary',
  ]);
}

function isManifestArtifactForDownloads(artifact = {}) {
  return isAvailableArtifact(artifact) && artifactHasAny(artifact, [
    'artifact-manifest',
    'artifact manifest',
    'output.manifest.json',
    '_manifest.json',
    'create_manifest',
    'drawing_manifest',
    'report_manifest',
  ]);
}

function firstMatchingArtifact(artifacts = [], predicate) {
  return artifacts.find((artifact) => predicate(artifact)) || null;
}

function buildGeneratedArtifactRow({ id, label, hint, artifact }) {
  const canOpen = Boolean(artifact?.capabilities?.can_open && artifact?.links?.open);
  const canDownload = Boolean(artifact?.capabilities?.can_download && artifact?.links?.download);
  return {
    id,
    label,
    hint,
    artifactId: artifact.id || '',
    fileName: artifact.file_name || artifact.key || 'Artifact',
    type: artifact.type || '',
    openHref: canOpen ? artifact.links.open : '',
    downloadHref: canDownload ? artifact.links.download : '',
    canOpen,
    canDownload,
  };
}

export function collectGeneratedArtifactGroups(artifacts = []) {
  const cadRows = [
    firstMatchingArtifact(artifacts, isStepArtifact)
      ? buildGeneratedArtifactRow({
          id: 'step',
          label: 'STEP model',
          hint: 'STEP export',
          artifact: firstMatchingArtifact(artifacts, isStepArtifact),
        })
      : null,
    firstMatchingArtifact(artifacts, isStlArtifact)
      ? buildGeneratedArtifactRow({
          id: 'stl',
          label: 'STL mesh',
          hint: 'STL export',
          artifact: firstMatchingArtifact(artifacts, isStlArtifact),
        })
      : null,
  ].filter(Boolean);

  const reportRows = [
    firstMatchingArtifact(artifacts, isPdfReportArtifact)
      ? buildGeneratedArtifactRow({
          id: 'pdf-report',
          label: 'PDF report',
          hint: 'Report PDF',
          artifact: firstMatchingArtifact(artifacts, isPdfReportArtifact),
        })
      : null,
    firstMatchingArtifact(artifacts, isReportSummaryArtifactForDownloads)
      ? buildGeneratedArtifactRow({
          id: 'report-summary',
          label: 'Report summary',
          hint: 'Summary JSON',
          artifact: firstMatchingArtifact(artifacts, isReportSummaryArtifactForDownloads),
        })
      : null,
  ].filter(Boolean);

  const qualityRows = [
    firstMatchingArtifact(artifacts, isCreateQualityArtifactForDownloads)
      ? buildGeneratedArtifactRow({
          id: 'create-quality',
          label: 'Create quality JSON',
          hint: 'Model quality evidence',
          artifact: firstMatchingArtifact(artifacts, isCreateQualityArtifactForDownloads),
        })
      : null,
    firstMatchingArtifact(artifacts, isDrawingQualityArtifactForDownloads)
      ? buildGeneratedArtifactRow({
          id: 'drawing-quality',
          label: 'Drawing quality JSON',
          hint: 'Drawing QA evidence',
          artifact: firstMatchingArtifact(artifacts, isDrawingQualityArtifactForDownloads),
        })
      : null,
    firstMatchingArtifact(artifacts, isManifestArtifactForDownloads)
      ? buildGeneratedArtifactRow({
          id: 'manifest',
          label: 'Manifest',
          hint: 'Artifact index',
          artifact: firstMatchingArtifact(artifacts, isManifestArtifactForDownloads),
        })
      : null,
  ].filter(Boolean);

  return [
    { id: 'cad-exports', title: 'CAD exports', rows: cadRows },
    { id: 'reports', title: 'Reports', rows: reportRows },
    { id: 'quality-evidence', title: 'Quality evidence', rows: qualityRows },
  ];
}

function renderGeneratedArtifactRow(row) {
  return el('div', {
    className: 'generated-file-row',
    dataset: { artifactKind: row.id, artifactId: row.artifactId },
    children: [
      el('div', {
        className: 'generated-file-copy',
        children: [
          el('p', { className: 'generated-file-label', text: row.label }),
          el('p', {
            className: 'generated-file-hint',
            text: `${row.hint}${row.fileName ? ` • ${row.fileName}` : ''}${row.type ? ` • ${row.type}` : ''}`,
          }),
        ],
      }),
      el('div', {
        className: 'generated-file-actions',
        children: [
          row.canOpen
            ? el('a', {
                className: 'action-button action-button-primary',
                text: 'Open',
                attrs: { href: row.openHref, target: '_blank', rel: 'noreferrer noopener' },
              })
            : null,
          row.canDownload
            ? el('a', {
                className: 'action-button action-button-ghost',
                text: 'Download',
                attrs: { href: row.downloadHref, rel: 'noreferrer' },
              })
            : null,
        ].filter(Boolean),
      }),
    ],
  });
}

function renderGeneratedArtifactGroup(group) {
  if (!group.rows.length) return null;
  return el('section', {
    className: 'generated-file-group',
    dataset: { generatedGroup: group.id },
    children: [
      el('h4', { className: 'generated-file-group-title', text: group.title }),
      el('div', {
        className: 'generated-file-list',
        children: group.rows.map(renderGeneratedArtifactRow),
      }),
    ],
  });
}

function renderGeneratedFilesPanel(artifacts = []) {
  const groups = collectGeneratedArtifactGroups(artifacts);
  const hasHighlightedArtifacts = groups.some((group) => group.rows.length > 0);

  return el('div', {
    className: 'generated-files-panel',
    children: [
      hasHighlightedArtifacts
        ? el('div', {
            className: 'generated-file-groups',
            children: groups.map(renderGeneratedArtifactGroup).filter(Boolean),
          })
        : el('div', {
            className: 'support-note',
            text: 'No primary STEP, STL, report, or quality evidence files were detected for this run yet. Use All artifacts below for the raw manifest-backed list.',
          }),
    ],
  });
}

function renderArtifactPipeline(activeJob) {
  const artifacts = activeJob?.artifacts || [];
  const hasArtifacts = artifacts.length > 0;
  const hasReview = Boolean(findPreferredReviewPackArtifact(artifacts));
  const hasManifest = Boolean(activeJob?.manifest?.command || hasArtifacts);
  const hasPackage = Boolean(findPreferredReleaseBundleArtifact(artifacts) || findPreferredReleaseBundleManifestArtifact(artifacts));
  const hasDownload = artifacts.some((artifact) => artifact.capabilities?.can_download);
  const steps = [
    { label: 'Review', state: hasReview ? 'Ready' : 'Waiting', tone: hasReview ? 'ok' : 'warn' },
    { label: 'Manifest', state: hasManifest ? 'Indexed' : 'Waiting', tone: hasManifest ? 'info' : 'warn' },
    { label: 'Package', state: hasPackage ? 'Available' : 'Waiting', tone: hasPackage ? 'ok' : 'warn' },
    { label: 'Download', state: hasDownload ? 'Ready' : 'Waiting', tone: hasDownload ? 'ok' : 'info' },
  ];

  return el('div', {
    className: 'artifact-pipeline',
    children: steps.map((step, index) =>
      el('div', {
        className: 'artifact-pipeline-step',
        dataset: { tone: step.tone },
        children: [
          el('span', { className: 'artifact-pipeline-index', text: `${index + 1}` }),
          el('div', {
            className: 'artifact-pipeline-copy',
            children: [
              el('p', { className: 'artifact-pipeline-label', text: step.label }),
              el('p', { className: 'artifact-pipeline-state', text: step.state }),
            ],
          }),
        ],
      })
    ),
  });
}

function renderOutputQueue(recentJobs = []) {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: 'Q',
      title: 'No queued outputs yet',
      copy: 'Tracked review, package, and export runs appear here as soon as the local API records them.',
    });
  }

  return el('div', {
    className: 'output-queue',
    children: recentJobs.slice(0, 4).map((job) => {
      const status = deriveRecentJobQualityStatus(job);
      return el('article', {
        className: 'queue-row',
        children: [
          el('div', {
            className: 'queue-row-copy',
            children: [
              el('p', { className: 'queue-row-title', text: `${job.type} ${shortJobId(job.id)}` }),
              el('p', { className: 'queue-row-meta', text: formatRecentJobQualityLine(job, shortJobId(job.id)) }),
            ],
          }),
          el('span', { className: 'pill', text: status.hasQualityDecision ? status.qualityStatus : status.jobExecutionStatus }),
        ],
      });
    }),
  });
}

function formatStatusLabel(value = '') {
  return formatQualityStatusLabel(value);
}

function renderQualityDashboardHeader(model) {
  return [
    el('h3', {
      className: 'quality-dashboard-title',
      text: `Quality Dashboard - ${model.configName || 'Unknown config'}`,
    }),
    createInfoGrid([
      { label: 'Overall quality status', value: formatStatusLabel(model.overallStatus) },
      { label: 'Ready for manufacturing review', value: model.readyLabel },
      { label: 'Source', value: model.source === 'report_summary' ? 'report_summary.json' : 'create/drawing/manifest fallback' },
      { label: 'Artifact links', value: String(model.artifactLinks.length) },
    ]),
  ];
}

function renderDecisionNotes(model) {
  return [
    el('div', {
      className: model.layout === 'failed' ? 'support-note support-note-warn' : 'support-note',
      text: model.decisionCopies.blockedCopy,
    }),
    el('div', {
      className: model.layout === 'failed' ? 'support-note support-note-warn' : 'support-note',
      text: model.decisionCopies.readyCopy,
    }),
  ];
}

function renderCheckSection({ title, empty, items = [], grouped = false }) {
  if (grouped) {
    const groupedItems = items.reduce((groups, item) => {
      const surface = item.surface || item.label || 'Quality';
      groups[surface] = groups[surface] || [];
      groups[surface].push(item);
      return groups;
    }, {});

    return el('div', {
      className: 'quality-check-section',
      children: [
        el('p', { className: 'list-label', text: `${title} (${items.length})` }),
        items.length > 0
          ? createList(
              Object.entries(groupedItems).flatMap(([surface, surfaceItems]) =>
                surfaceItems.map((entry) => ({
                  label: surface,
                  copy: entry.detail || `${entry.label} failed`,
                  meta: entry.displayStatus || formatQualityStatusLabel(entry.status, entry.required),
                }))
              )
            )
          : el('div', { className: 'support-note', text: empty }),
      ],
    });
  }

  return el('div', {
    className: 'quality-check-section',
    children: [
      el('p', { className: 'list-label', text: `${title} (${items.length})` }),
      items.length > 0
        ? createList(
            items.map((entry) => ({
              label: entry.label,
              copy: entry.detail,
              meta: entry.displayStatus || formatQualityStatusLabel(entry.status, entry.required),
            }))
          )
        : el('div', { className: 'support-note', text: empty }),
    ],
  });
}

function renderTextListSection({ title, empty, items = [], labelPrefix }) {
  return el('div', {
    className: 'quality-check-section',
    children: [
      el('p', { className: 'list-label', text: `${title} (${items.length})` }),
      items.length > 0
        ? createList(
            items.map((entry, index) => ({
              label: `${labelPrefix} ${index + 1}`,
              copy: entry,
            }))
          )
        : el('div', { className: 'support-note', text: empty }),
    ],
  });
}

function renderSemanticEvidenceSection({ title, empty, items = [] }) {
  return el('div', {
    className: 'quality-check-section quality-semantic-subsection',
    children: [
      el('p', { className: 'list-label', text: `${title} (${items.length})` }),
      items.length > 0
        ? el('div', {
            className: 'quality-semantic-list',
            children: items.map((entry) =>
              el('div', {
                className: 'quality-semantic-item',
                children: [
                  el('div', {
                    className: 'quality-semantic-item-copy',
                    children: [
                      el('p', { className: 'list-label', text: entry.label }),
                      entry.detail ? el('p', { className: 'list-copy', text: entry.detail }) : null,
                      entry.note ? el('p', { className: 'artifact-meta', text: entry.note }) : null,
                    ],
                  }),
                  createPill(entry.classificationLabel || 'Unknown', entry.classificationTone || 'info'),
                ],
              })
            ),
          })
        : el('div', { className: 'support-note', text: empty }),
    ],
  });
}

function renderExtractedSemanticsSection(extractedSemantics = null) {
  if (!extractedSemantics) return null;
  const evidenceArtifact = extractedSemantics.evidenceArtifact;

  return el('div', {
    className: 'quality-extracted-panel',
    children: [
      el('div', {
        className: 'quality-drawing-panel-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'list-label', text: 'Extracted drawing semantics' }),
              el('p', {
                className: 'list-copy',
                text: extractedSemantics.summary,
              }),
            ],
          }),
          el('div', {
            className: 'quality-extracted-badges',
            children: [
              createPill(extractedSemantics.impactLabel || 'Advisory', extractedSemantics.impactTone || 'info'),
              createPill(extractedSemantics.statusLabel || 'Unknown', extractedSemantics.tone || 'info'),
            ],
          }),
        ],
      }),
      createInfoGrid([
        {
          label: 'Status',
          value: extractedSemantics.statusLabel || 'Unknown',
        },
        {
          label: 'Impact',
          value: extractedSemantics.impactLabel || 'Advisory',
          note: extractedSemantics.impactCopy || '',
        },
      ]),
      el('p', { className: 'list-label', text: 'Coverage' }),
      createInfoGrid([
        ...extractedSemantics.coverageItems,
      ]),
      el('p', { className: 'list-label', text: 'Evidence' }),
      createInfoGrid([
        extractedSemantics.evidenceItem,
      ]),
      el('p', { className: 'list-label', text: 'Manufacturing readiness' }),
      el('div', {
        className: 'support-note',
        text: extractedSemantics.readinessCopy,
      }),
      extractedSemantics.unmatchedSummary
        ? el('div', {
            className: 'support-note',
            text: extractedSemantics.unmatchedSummary,
          })
        : null,
      renderSuggestedActionGroups(extractedSemantics),
      ...extractedSemantics.requiredGroups.map((group) => renderSemanticEvidenceSection(group)),
      ...extractedSemantics.unmatchedGroups.map((group) => renderSemanticEvidenceSection(group)),
      renderTextListSection({
        title: 'Semantic unknowns',
        empty: 'No extracted-semantics unknowns were reported.',
        items: extractedSemantics.unknowns || [],
        labelPrefix: 'Unknown',
      }),
      renderTextListSection({
        title: 'Semantic limitations',
        empty: 'No extracted-semantics limitations were reported.',
        items: extractedSemantics.limitations || [],
        labelPrefix: 'Limitation',
      }),
      evidenceArtifact?.href
        ? el('div', {
            className: 'review-detail-actions quality-dashboard-links',
            children: [
              el('a', {
                className: 'action-button action-button-ghost',
                text: `Open evidence - ${evidenceArtifact.label}`,
                attrs: { href: evidenceArtifact.href, target: '_blank', rel: 'noreferrer noopener' },
              }),
            ],
          })
        : null,
    ].filter(Boolean),
  });
}

function renderSuggestedActionGroups(extractedSemantics = null) {
  if (!extractedSemantics) return null;
  const groups = Array.isArray(extractedSemantics.suggestedActionGroups)
    ? extractedSemantics.suggestedActionGroups
    : [];
  const totalCount = Number(extractedSemantics.suggestedActionCount || 0);

  return el('div', {
    className: 'quality-check-section quality-suggested-actions',
    children: [
      el('p', { className: 'list-label', text: `Suggested drawing actions (${totalCount})` }),
      groups.length > 0
        ? el('div', {
            className: 'support-note',
            text: `Showing ${totalCount} deduped suggested action${totalCount === 1 ? '' : 's'}. ${extractedSemantics.suggestedActionAdvisoryCopy || ''}`.trim(),
          })
        : el('div', {
            className: 'support-note',
            text: extractedSemantics.suggestedActionEmptyCopy || 'No additional drawing actions were suggested from extracted evidence.',
          }),
      ...groups.map((group) => (
        el('div', {
          className: 'quality-semantic-subsection',
          children: [
            el('p', { className: 'list-label', text: `${group.title} (${group.items.length})` }),
            el('div', {
              className: 'quality-suggested-action-list',
              children: group.items.map((entry) => (
                el('div', {
                  className: 'quality-suggested-action-item',
                  children: [
                    el('div', {
                      className: 'quality-suggested-action-copy',
                      children: [
                        el('p', { className: 'list-label', text: entry.title }),
                        entry.message ? el('p', { className: 'list-copy', text: entry.message }) : null,
                        entry.recommendedFix
                          ? el('p', { className: 'list-copy', text: `Recommended fix: ${entry.recommendedFix}` })
                          : null,
                        entry.targetSummary ? el('p', { className: 'artifact-meta', text: entry.targetSummary }) : null,
                        entry.evidenceSourceSummary ? el('p', { className: 'artifact-meta', text: entry.evidenceSourceSummary }) : null,
                        entry.evidencePathSummary ? el('p', { className: 'artifact-meta', text: entry.evidencePathSummary }) : null,
                      ].filter(Boolean),
                    }),
                    el('div', {
                      className: 'quality-suggested-action-badges',
                      children: [
                        createPill(entry.impactLabel || 'Advisory', entry.impactTone || 'info'),
                        createPill(entry.classificationLabel || 'Unknown', entry.classificationTone || 'info'),
                      ],
                    }),
                  ],
                })
              )),
            }),
          ],
        })
      )),
    ],
  });
}

function formatListValue(items = [], empty = 'None') {
  return items.length > 0 ? items.join(', ') : empty;
}

function renderDrawingQualitySection(drawingQuality = null) {
  if (!drawingQuality) return null;
  const scoreNote = drawingQuality.score !== null && drawingQuality.score !== undefined
    ? `score ${drawingQuality.score}`
    : '';
  const evidenceArtifact = drawingQuality.evidenceArtifact;

  return el('div', {
    className: 'quality-drawing-panel',
    children: [
      el('div', {
        className: 'quality-drawing-panel-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'list-label', text: 'Drawing semantic QA' }),
              el('p', {
                className: 'list-copy',
                text: drawingQuality.available
                  ? 'Semantic drawing evidence is interpreted separately from job execution status.'
                  : 'Drawing semantic QA not available for this job.',
              }),
            ],
          }),
          el('span', {
            className: `pill pill-status-${drawingQuality.tone || 'info'}`,
            text: drawingQuality.statusLabel || 'Unknown',
          }),
        ],
      }),
      createInfoGrid([
        {
          label: 'Overall drawing quality',
          value: drawingQuality.statusLabel || 'Unknown',
          note: scoreNote,
        },
        {
          label: 'Critical feature coverage',
          value: drawingQuality.criticalCoverageLabel || 'Unknown',
        },
        {
          label: 'Missing required dimensions',
          value: formatListValue(drawingQuality.missingRequiredDimensions),
        },
        {
          label: 'Missing notes/views',
          value: formatListValue(drawingQuality.missingNotesViews),
        },
        {
          label: 'Manufacturing review impact',
          value: drawingQuality.decisionImpact || 'Unknown',
        },
        {
          label: 'Evidence artifact',
          value: evidenceArtifact?.label || 'Report summary',
          note: evidenceArtifact?.fileName || drawingQuality.evidenceSource || '',
        },
      ]),
      renderTextListSection({
        title: 'Drawing blockers',
        empty: 'No drawing blockers were reported.',
        items: drawingQuality.blockers || [],
        labelPrefix: 'Drawing blocker',
      }),
      renderTextListSection({
        title: 'Drawing advisories',
        empty: 'No advisory drawing items were reported.',
        items: drawingQuality.advisoryItems || [],
        labelPrefix: 'Drawing advisory',
      }),
      renderTextListSection({
        title: 'Suggested drawing actions',
        empty: 'No drawing action was suggested.',
        items: drawingQuality.suggestedActions || [],
        labelPrefix: 'Drawing action',
      }),
      renderExtractedSemanticsSection(drawingQuality.extractedSemantics),
      evidenceArtifact?.href
        ? el('div', {
            className: 'review-detail-actions quality-dashboard-links',
            children: [
              el('a', {
                className: 'action-button action-button-ghost',
                text: `Open evidence - ${evidenceArtifact.label}`,
                attrs: { href: evidenceArtifact.href, target: '_blank', rel: 'noreferrer noopener' },
              }),
            ],
          })
        : null,
    ].filter(Boolean),
  });
}

function renderEngineeringQualityRows(rows = []) {
  return el('div', {
    className: 'quality-engineering-rows',
    children: rows.map((row) => (
      el('div', {
        className: 'quality-engineering-row',
        dataset: { tone: row.tone || 'info' },
        children: [
          el('div', {
            className: 'quality-engineering-row-main',
            children: [
              el('div', {
                className: 'quality-engineering-row-title',
                children: [
                  el('span', { className: 'list-label', text: row.label || 'Engineering check' }),
                  createPill(row.statusLabel || formatQualityStatusLabel(row.status), row.tone || 'info'),
                ],
              }),
              row.detail ? el('p', { className: 'list-copy', text: row.detail }) : null,
            ].filter(Boolean),
          }),
          el('dl', {
            className: 'quality-engineering-fields',
            children: [
              ['Expected', row.expected],
              ['Actual', row.actual],
              ['Delta / error', row.delta],
              ['Tolerance', row.tolerance],
              ['Source', row.source],
            ].flatMap(([label, value]) => [
              el('dt', { text: label }),
              el('dd', { text: value || 'Not reported' }),
            ]),
          }),
        ],
      })
    )),
  });
}

function canRunTrackedQualityFlow(state = {}, dashboardModel = {}) {
  const sharedModel = state.data?.model || {};
  const configText = sharedModel.configText || '';
  if (state.connectionState !== 'connected') return false;
  if (state.data?.health?.available !== true) return false;
  if (!configText.trim()) return false;

  const targetName = normalizeConfigIdentity(dashboardModel.configName);
  if (!targetName || targetName === 'unknown_config') return false;

  const sourceCandidates = [
    sharedModel.sourceName,
    sharedModel.sourcePath,
    configText.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || '',
  ].map(normalizeConfigIdentity);
  return sourceCandidates.includes(targetName);
}

function qualityActionLink(model = {}, id = '') {
  return (model.artifactLinks || []).find((entry) => entry.id === id && entry.href) || null;
}

function hasGeneratedFileTargets(model = {}) {
  const generatedLinkIds = new Set([
    'model_step',
    'model_stl',
    'report_pdf',
    'report_summary_json',
    'create_quality_json',
    'drawing_quality_json',
    'manifest_json',
  ]);
  return (model.artifactLinks || []).some((entry) => generatedLinkIds.has(entry.id));
}

function renderFailureActionButtons({ model = {}, state = {} } = {}) {
  const createQualityLink = qualityActionLink(model, 'create_quality_json');
  const canRerun = canRunTrackedQualityFlow(state, model);
  const actions = [
    createQualityLink
      ? el('a', {
          className: 'action-button action-button-primary',
          text: 'Inspect quality evidence',
          attrs: { href: createQualityLink.href, target: '_blank', rel: 'noreferrer noopener' },
        })
      : null,
    hasGeneratedFileTargets(model)
      ? el('a', {
          className: 'action-button action-button-ghost',
          text: 'Open generated files',
          attrs: { href: '#studio-generated-files' },
        })
      : null,
    createButton({
      label: 'Open Model workspace',
      action: 'go-model',
      tone: 'ghost',
    }),
    canRerun
      ? createButton({
          label: 'Run tracked create again',
          action: 'start-run-tracked-create',
          tone: 'ghost',
        })
      : null,
    canRerun
      ? createButton({
          label: 'Run tracked report again',
          action: 'start-run-tracked-report',
          tone: 'ghost',
        })
      : null,
  ].filter(Boolean);

  if (actions.length === 0) return null;
  return el('div', {
    className: 'review-detail-actions quality-dashboard-links quality-failure-actions',
    children: actions,
  });
}

function renderEngineeringFailureNextActions(nextActions = null, { model = {}, state = {} } = {}) {
  if (!nextActions) return null;
  const entries = Array.isArray(nextActions.entries) ? nextActions.entries : [];
  const steps = Array.isArray(nextActions.steps) ? nextActions.steps : [];

  return el('div', {
    className: 'quality-failure-next-actions',
    children: [
      el('div', {
        className: 'quality-drawing-panel-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'list-label', text: nextActions.title || 'What to do next' }),
              el('p', {
                className: 'list-copy',
                text: nextActions.summary || 'Inspect the linked evidence, fix the source issue, then rerun the tracked flow.',
              }),
            ],
          }),
        ],
      }),
      entries.length > 0
        ? el('div', {
            className: 'quality-failure-guidance-list',
            children: entries.slice(0, 4).map((entry) => (
              el('article', {
                className: 'quality-failure-guidance-card',
                children: [
                  el('p', { className: 'list-label', text: entry.whatFailed || `${entry.label || 'Engineering check'} failed.` }),
                  el('p', { className: 'list-copy', text: entry.whyItMatters || 'This quality gate protects downstream CAD and manufacturing review decisions.' }),
                  createInfoGrid([
                    { label: 'Inspect', value: entry.evidence || 'Inspect the quality evidence JSON.' },
                    { label: 'Change', value: entry.change || 'Fix the related config or source geometry.' },
                    { label: 'Rerun', value: entry.rerun || 'Run tracked create again after the fix.' },
                    { label: 'Success', value: entry.success || 'Confirm Engineering Quality becomes PASS.' },
                  ]),
                ],
              })
            )),
          })
        : null,
      steps.length > 0
        ? el('ol', {
            className: 'quality-failure-step-list',
            children: steps.map((step) => el('li', { text: step })),
          })
        : null,
      renderFailureActionButtons({ model, state }),
    ].filter(Boolean),
  });
}

function renderEngineeringQualitySection(engineeringQuality = null, { model = {}, state = {} } = {}) {
  if (!engineeringQuality) return null;

  return el('div', {
    className: 'quality-engineering-panel',
    children: [
      el('div', {
        className: 'quality-drawing-panel-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'list-label', text: 'Engineering Quality' }),
              el('p', {
                className: 'list-copy',
                text: engineeringQuality.summary || 'Generated geometry and STEP reimport evidence are shown as human-readable checks.',
              }),
            ],
          }),
          el('span', {
            className: `pill pill-status-${engineeringQuality.tone || 'info'}`,
            text: engineeringQuality.statusLabel || 'UNKNOWN',
          }),
        ],
      }),
      createInfoGrid([
        {
          label: 'Engineering Quality',
          value: engineeringQuality.statusLabel || 'UNKNOWN',
        },
      ]),
      ...engineeringQuality.sections.map((section) => (
        el('div', {
          className: 'quality-check-section',
          children: [
            el('p', { className: 'list-label', text: `${section.title} (${section.rows.length})` }),
            renderEngineeringQualityRows(section.rows),
          ],
        })
      )),
      engineeringQuality.failures.length > 0
        ? el('div', {
            className: 'quality-check-section',
            children: [
              el('p', { className: 'list-label', text: `Problems found (${engineeringQuality.failures.length})` }),
              renderEngineeringQualityRows(engineeringQuality.failures),
            ],
          })
        : null,
      renderEngineeringFailureNextActions(engineeringQuality.nextActions, { model, state }),
    ].filter(Boolean),
  });
}

function renderArtifactLinks(artifactLinks = []) {
  if (artifactLinks.length === 0) return null;
  return el('div', {
    className: 'review-detail-actions quality-dashboard-links',
    children: artifactLinks.map((artifact) =>
      el('a', {
        className: 'action-button action-button-ghost',
        text: artifact.statusLabel ? `${artifact.label} - ${artifact.statusLabel}` : artifact.label,
        attrs: { href: artifact.href, target: '_blank', rel: 'noreferrer noopener' },
      })
    ),
  });
}

function renderQualityDashboard(model, state = {}) {
  const checks = model.checks || {};
  const requiredUnavailable = (checks.unavailable || []).filter((entry) => entry.required && !entry.decision);
  const failedChecks = [
    ...(checks.failed || []).filter((entry) => !entry.decision),
    ...requiredUnavailable,
  ];
  const passedChecks = (checks.passed || []).filter((entry) => !entry.decision);
  const unavailableChecks = (checks.unavailable || []).filter((entry) => !entry.required || entry.decision);
  const commonHeader = [
    ...renderQualityDashboardHeader(model),
    ...renderDecisionNotes(model),
  ];

  if (model.layout === 'passed') {
    return el('div', {
      className: 'quality-dashboard-stack',
      children: [
        ...commonHeader,
        renderEngineeringQualitySection(model.engineeringQuality, { model, state }),
        renderDrawingQualitySection(model.drawingQuality),
        el('div', { className: 'support-note', text: model.decisionCopies.gateCopy }),
        renderCheckSection({
          title: 'Required gates passed',
          empty: 'No required gate evidence was reported for this artifact set.',
          items: model.passedRequiredGateChecks || [],
        }),
        renderTextListSection({
          title: 'Optional improvements',
          empty: 'No optional improvements were recommended.',
          items: model.optionalImprovements || [],
          labelPrefix: 'Optional improvement',
        }),
        renderArtifactLinks(model.artifactLinks),
      ].filter(Boolean),
    });
  }

  if (model.layout === 'failed') {
    return el('div', {
      className: 'quality-dashboard-stack',
      children: [
        ...commonHeader,
        renderEngineeringQualitySection(model.engineeringQuality, { model, state }),
        renderDrawingQualitySection(model.drawingQuality),
        renderCheckSection({
          title: 'Failed checks',
          empty: 'No failed checks were reported for this artifact set.',
          items: failedChecks,
          grouped: true,
        }),
        renderTextListSection({
          title: 'Top blockers',
          empty: 'No top blockers were reported for this artifact set.',
          items: model.blockers,
          labelPrefix: 'Top blocker',
        }),
        renderTextListSection({
          title: 'Recommended actions',
          empty: 'No recommended actions were provided by the selected quality artifacts.',
          items: model.recommendedActions,
          labelPrefix: 'Recommended action',
        }),
        renderCheckSection({
          title: 'Passed checks',
          empty: 'No passed checks were reported for this artifact set.',
          items: passedChecks,
        }),
        renderArtifactLinks(model.artifactLinks),
      ].filter(Boolean),
    });
  }

  return el('div', {
    className: 'quality-dashboard-stack',
    children: [
      ...commonHeader,
        renderEngineeringQualitySection(model.engineeringQuality, { model, state }),
      renderDrawingQualitySection(model.drawingQuality),
      renderCheckSection({
        title: 'Failed checks',
        empty: 'No failed checks were reported for this artifact set.',
        items: failedChecks,
        grouped: true,
      }),
      renderTextListSection({
        title: 'Top blockers',
        empty: 'No top blockers were reported for this artifact set.',
        items: model.blockers,
        labelPrefix: 'Top blocker',
      }),
      renderTextListSection({
        title: 'Recommended actions',
        empty: 'No recommended actions were provided by the selected quality artifacts.',
        items: model.recommendedActions,
        labelPrefix: 'Recommended action',
      }),
      renderCheckSection({
        title: 'Passed checks',
        empty: 'No passed checks were reported for this artifact set.',
        items: passedChecks,
      }),
      renderCheckSection({
        title: 'Not run or unavailable',
        empty: 'No unavailable checks were reported for this artifact set.',
        items: unavailableChecks,
      }),
      renderArtifactLinks(model.artifactLinks),
    ].filter(Boolean),
  });
}

export function renderArtifactsWorkspace(state) {
  ensureArtifactsWorkspaceState(state.data.artifactsWorkspace);
  const activeJob = state.data.activeJob;
  const recentJobs = state.data.recentJobs.items || [];

  return el('section', {
    className: 'workspace-shell artifacts-dashboard',
    children: [
      createSectionHeader({
        kicker: 'Packs workspace',
        title: 'Artifact management dashboard',
        description: 'Review recent jobs, manifest status, package readiness, and safe download routes from one artifact-centered workspace.',
        badges: [
          { label: activeJob?.summary ? 'Tracked job selected' : 'No active package', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `${recentJobs.length || 0} recent runs`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: 'Manifest-backed download path', tone: 'ok' },
        ],
      }),
      createCard({
        kicker: 'Artifact pipeline',
        title: 'Review-to-download flow',
        copy: 'Keep the active artifact set grounded in standard review outputs, manifest indexing, package assembly, and explicit download readiness.',
        surface: 'canvas',
        body: [
          renderArtifactPipeline(activeJob),
        ],
      }),
      el('div', {
        className: 'artifacts-dashboard-grid',
        children: [
          el('div', {
            className: 'artifacts-column artifacts-column-left',
            children: [
              createCard({
                kicker: 'Recent jobs',
                title: 'Recent job flow',
                copy: 'Keep the latest job visible while older runs stay compare-ready and reopenable.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-timeline' } }),
                ],
              }),
              createCard({
                kicker: 'Package status',
                title: activeJob?.summary ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` : 'Select tracked job',
                copy: 'Keep manifest facts, storage status, and export readiness visible while you inspect output files.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-job-summary' } }),
                ],
              }),
              createCard({
                kicker: 'Quality dashboard',
                title: 'Manufacturing quality snapshot',
                copy: 'Prefer report_summary.json when it exists, then fall back to create/drawing/manifest evidence without inventing missing files.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-quality-dashboard' } }),
                ],
              }),
              createCard({
                kicker: 'Compare',
                title: 'Compare active package with baseline',
                copy: 'Choose an older tracked run as the baseline. When both sides have standard review-pack or readiness inputs, Studio can queue compare-rev or stabilization-review here.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-compare' } }),
                ],
              }),
              createCard({
                kicker: 'Live output queue',
                title: 'Recent package and export activity',
                copy: 'Keep package, report, and export activity visible as compact queue rows even when no artifact is selected.',
                body: [
                  renderOutputQueue(recentJobs),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'artifacts-column artifacts-column-center',
            children: [
              createCard({
                kicker: 'Generated files',
                title: 'Your generated files',
                copy: 'Download or inspect the main outputs from this run.',
                surface: 'canvas',
                body: [
                  el('div', {
                    attrs: { id: 'studio-generated-files' },
                    dataset: { hook: 'artifacts-generated-files' },
                  }),
                ],
              }),
              createCard({
                kicker: 'All artifacts',
                title: 'Current job output list',
                copy: 'Artifacts stay grouped by job with type badges, open/download actions, and structured metadata.',
                surface: 'canvas',
                body: [
                  el('div', { className: 'artifact-card-grid', dataset: { hook: 'artifacts-cards' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'artifacts-column artifacts-column-right',
            children: [
              createCard({
                kicker: 'Structured inspector',
                title: 'Artifact detail',
                copy: 'Inspect the selected artifact, preview it when safe, and continue into follow-up actions without raw filesystem paths.',
                surface: 'canvas',
                body: [
                  el('div', { dataset: { hook: 'artifacts-detail-summary' } }),
                  el('div', { className: 'review-detail-actions', dataset: { hook: 'artifacts-detail-actions' } }),
                  el('pre', { className: 'artifact-raw-preview', dataset: { hook: 'artifacts-detail-preview' } }),
                  el('div', { className: 'review-provenance-list', dataset: { hook: 'artifacts-detail-notes' } }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function mountArtifactsWorkspace({ root, state, addLog, openJob, fetchJson }) {
  const artifactsState = ensureArtifactsWorkspaceState(state.data.artifactsWorkspace);
  const timelineElement = root.querySelector('[data-hook="artifacts-timeline"]');
  const jobSummaryElement = root.querySelector('[data-hook="artifacts-job-summary"]');
  const qualityDashboardElement = root.querySelector('[data-hook="artifacts-quality-dashboard"]');
  const compareElement = root.querySelector('[data-hook="artifacts-compare"]');
  const generatedFilesElement = root.querySelector('[data-hook="artifacts-generated-files"]');
  const cardsElement = root.querySelector('[data-hook="artifacts-cards"]');
  const detailSummaryElement = root.querySelector('[data-hook="artifacts-detail-summary"]');
  const detailActionsElement = root.querySelector('[data-hook="artifacts-detail-actions"]');
  const detailPreviewElement = root.querySelector('[data-hook="artifacts-detail-preview"]');
  const detailNotesElement = root.querySelector('[data-hook="artifacts-detail-notes"]');
  let destroyed = false;

  function getSelectedArtifact() {
    const artifacts = state.data.activeJob.artifacts || [];
    return artifacts.find((artifact) => artifact.id === artifactsState.selectedArtifactId)
      || findDefaultArtifactForJob(artifacts)
      || null;
  }

  function getSelectedArtifactCacheKey(artifact = getSelectedArtifact()) {
    return artifactStateCacheKey(activeJobIdFromState(state), artifact?.id || '');
  }

  function isHydratingSelectedJob() {
    return Boolean(
      state.selectedJobId
      && state.data.activeJob.summary?.id !== state.selectedJobId
      && state.data.activeJob.status !== 'unavailable'
    );
  }

  function syncTimeline() {
    timelineElement.replaceChildren(
      renderTimeline(
        state.data.recentJobs.items || [],
        state.data.activeJob.summary?.id || '',
        artifactsState.compare.jobId || ''
      )
    );
  }

  function syncJobSummary() {
    const activeJob = state.data.activeJob;
    if (isHydratingSelectedJob()) {
      jobSummaryElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: `Hydrating tracked job ${shortJobId(state.selectedJobId)} from the direct route.`,
        })
      );
      return;
    }

    if (!activeJob?.summary) {
      jobSummaryElement.replaceChildren(
        createEmptyState({
          icon: 'A',
          title: 'No active job',
          copy: 'Open a recent job from the timeline to inspect its artifact set here.',
        })
      );
      return;
    }

    jobSummaryElement.replaceChildren(
      createInfoGrid([
        { label: 'Job', value: `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` },
        { label: 'Status', value: formatJobStatus(activeJob.summary.status) },
        { label: 'Updated', value: formatDateTime(activeJob.summary.updated_at) },
        { label: 'Manifest command', value: activeJob.manifest?.command || 'Unknown' },
        { label: 'Artifact count', value: String((activeJob.artifacts || []).length) },
        { label: 'Job storage', value: summarizeStorage(activeJob.storage) },
      ])
    );
  }

  function syncQualityDashboard() {
    const activeJob = state.data.activeJob;
    if (isHydratingSelectedJob()) {
      qualityDashboardElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: 'Hydrating the tracked job before deciding whether quality artifacts exist.',
        })
      );
      return;
    }

    if (!activeJob?.summary) {
      qualityDashboardElement.replaceChildren(
        createEmptyState({
          icon: 'Q',
          title: 'No active quality dashboard',
          copy: 'Open a tracked job to load report_summary.json or the fallback quality artifacts.',
        })
      );
      return;
    }

    if (artifactsState.qualityStatus === 'loading') {
      qualityDashboardElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: 'Hydrating the tracked job before deciding whether quality artifacts exist.',
        })
      );
      return;
    }

    if (artifactsState.qualityStatus === 'error') {
      qualityDashboardElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: 'Quality dashboard unavailable',
          copy: artifactsState.qualityError || 'The quality dashboard could not be prepared for this job.',
        })
      );
      return;
    }

    if (!artifactsState.qualityData) {
      qualityDashboardElement.replaceChildren(
        createEmptyState({
          icon: 'Q',
          title: 'No quality artifacts detected',
          copy: 'This job does not expose report_summary.json, create quality, drawing quality, or manifest evidence yet.',
        })
      );
      return;
    }

    qualityDashboardElement.replaceChildren(renderQualityDashboard(artifactsState.qualityData, state));
  }

  function syncCompare() {
    if (!state.data.activeJob.summary) {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '=',
          title: 'Compare needs an active job',
          copy: 'Open a tracked job first, then choose an older run from the timeline as the baseline.',
        })
      );
      return;
    }

    const activeReviewPack = findPreferredReviewPackArtifact(state.data.activeJob.artifacts || []);
    const activeReadiness = findPreferredReadinessReportArtifact(state.data.activeJob.artifacts || []);

    if (artifactsState.compare.status === 'loading') {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading baseline artifacts',
          copy: 'Preparing the selected baseline for compare-rev and stabilization readiness checks.',
        })
      );
      return;
    }

    if (artifactsState.compare.status === 'error') {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: 'Baseline compare failed',
          copy: artifactsState.compare.errorMessage || 'The selected baseline job could not be loaded.',
        })
      );
      return;
    }

    if (!artifactsState.compare.job) {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '<>',
          title: 'No baseline selected',
          copy: 'Choose Compare on an older timeline entry to inspect coverage changes and run tracked compare work when standard artifacts are available.',
        })
      );
      return;
    }

    const baselineReviewPack = findPreferredReviewPackArtifact(artifactsState.compare.artifacts || []);
    const baselineReadiness = findPreferredReadinessReportArtifact(artifactsState.compare.artifacts || []);
    const diff = diffArtifacts(state.data.activeJob.artifacts || [], artifactsState.compare.artifacts || []);
    const candidateJobId = state.data.activeJob.summary.id;
    const baselineJobId = artifactsState.compare.job.id;
    const compareActions = [
      createButton({
        label: 'Run compare-rev',
        action: 'artifacts-run-compare',
        tone: 'ghost',
        disabled: !activeReviewPack || !baselineReviewPack,
        dataset: {
          baselineJobId,
          baselineArtifactId: baselineReviewPack?.id || '',
          candidateJobId,
          candidateArtifactId: activeReviewPack?.id || '',
        },
      }),
      createButton({
        label: 'Run stabilization review',
        action: 'artifacts-run-stabilization',
        tone: 'ghost',
        disabled: !activeReadiness || !baselineReadiness,
        dataset: {
          baselineJobId,
          baselineArtifactId: baselineReadiness?.id || '',
          candidateJobId,
          candidateArtifactId: activeReadiness?.id || '',
        },
      }),
      createButton({
        label: 'Open baseline',
        action: 'open-job',
        tone: 'ghost',
        dataset: {
          jobId: baselineJobId,
          route: 'artifacts',
        },
      }),
    ];

    compareElement.replaceChildren(
      el('div', {
        children: [
          createInfoGrid([
            { label: 'Baseline', value: `${artifactsState.compare.job.type} ${shortJobId(artifactsState.compare.job.id)}` },
            { label: 'Added artifact types', value: diff.added.join(', ') || 'None' },
            { label: 'Missing vs baseline', value: diff.removed.join(', ') || 'None' },
            { label: 'Review-pack handoff', value: compareAvailabilityLabel(Boolean(activeReviewPack && baselineReviewPack)) },
            { label: 'Readiness handoff', value: compareAvailabilityLabel(Boolean(activeReadiness && baselineReadiness)) },
            { label: 'Baseline updated', value: formatDateTime(artifactsState.compare.job.updated_at) },
          ]),
          el('p', {
            className: 'support-note',
            text: 'Tracked compare-rev needs canonical review-pack JSON on both runs. Tracked stabilization-review needs canonical readiness-report JSON on both runs.',
          }),
          el('div', {
            className: 'review-detail-actions',
            children: compareActions,
          }),
        ],
      })
    );
  }

  function syncGeneratedFiles() {
    const activeJob = state.data.activeJob;
    if (isHydratingSelectedJob()) {
      generatedFilesElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: 'Hydrating the tracked job before listing generated files.',
        })
      );
      return;
    }

    if (!activeJob?.summary) {
      generatedFilesElement.replaceChildren(
        createEmptyState({
          icon: 'F',
          title: 'No active artifact set',
          copy: 'Open a recent job to see the generated STEP, STL, reports, and quality evidence here.',
        })
      );
      return;
    }

    if (activeJob.status === 'loading') {
      generatedFilesElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: 'Hydrating the selected tracked job artifact list.',
        })
      );
      return;
    }

    if ((activeJob.artifacts || []).length === 0) {
      generatedFilesElement.replaceChildren(
        createEmptyState({
          icon: '0',
          title: 'This job exposes no artifacts',
          copy: 'The job record exists, but the generated file list is empty.',
        })
      );
      return;
    }

    generatedFilesElement.replaceChildren(renderGeneratedFilesPanel(activeJob.artifacts || []));
  }

  function syncCards() {
    const activeJob = state.data.activeJob;
    if (isHydratingSelectedJob()) {
      cardsElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: `Hydrating tracked job ${shortJobId(state.selectedJobId)} from the direct route.`,
        })
      );
      return;
    }

    if (!activeJob?.summary) {
      cardsElement.replaceChildren(
        createEmptyState({
          icon: '[]',
          title: 'No active artifact set',
          copy: 'Select a tracked job from the timeline to populate this board.',
        })
      );
      return;
    }

    if (activeJob.status === 'loading') {
      cardsElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading artifacts',
          copy: 'Hydrating the selected tracked job artifact list.',
        })
      );
      return;
    }

    if ((activeJob.artifacts || []).length === 0) {
      cardsElement.replaceChildren(
        createEmptyState({
          icon: '0',
          title: 'This job exposes no artifacts',
          copy: 'The job record exists, but the artifact list is empty. The manifest may still explain why.',
        })
      );
      return;
    }

    cardsElement.replaceChildren(
      ...activeJob.artifacts.map((artifact) =>
        renderArtifactCard(artifact, artifact.id === artifactsState.selectedArtifactId)
      )
    );
  }

  async function ensureArtifactPreview() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      artifactsState.previewStatus = 'idle';
      artifactsState.previewText = '';
      artifactsState.previewArtifactId = '';
      artifactsState.previewError = '';
      return;
    }

    if (!canPreviewAsText(artifact)) {
      artifactsState.previewStatus = 'idle';
      artifactsState.previewText = '';
      artifactsState.previewArtifactId = artifact.id;
      artifactsState.previewError = '';
      return;
    }

    const cacheKey = getSelectedArtifactCacheKey(artifact);
    if (artifactsState.cache[cacheKey]) {
      artifactsState.previewStatus = 'ready';
      artifactsState.previewText = artifactsState.cache[cacheKey];
      artifactsState.previewArtifactId = artifact.id;
      artifactsState.previewError = '';
      return;
    }

    artifactsState.previewStatus = 'loading';
    artifactsState.previewText = '';
    artifactsState.previewArtifactId = artifact.id;
    artifactsState.previewError = '';
    syncDetail();

    try {
      const text = await fetchArtifactText(artifact);
      if (getSelectedArtifactCacheKey() !== cacheKey) return;
      artifactsState.cache[cacheKey] = text || '';
      artifactsState.previewStatus = 'ready';
      artifactsState.previewText = text || '';
    } catch (error) {
      if (getSelectedArtifactCacheKey() !== cacheKey) return;
      artifactsState.previewStatus = 'error';
      artifactsState.previewError = error instanceof Error ? error.message : String(error);
    }
  }

  async function ensureArtifactViewer() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      artifactsState.viewerStatus = 'idle';
      artifactsState.viewerArtifactId = '';
      artifactsState.viewerError = '';
      artifactsState.viewerData = null;
      return;
    }

    const cacheKey = getSelectedArtifactCacheKey(artifact);
    if (artifactsState.viewerCache[cacheKey]) {
      artifactsState.viewerStatus = 'ready';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerError = '';
      artifactsState.viewerData = artifactsState.viewerCache[cacheKey];
      return;
    }

    artifactsState.viewerStatus = 'loading';
    artifactsState.viewerArtifactId = artifact.id;
    artifactsState.viewerError = '';
    artifactsState.viewerData = null;
    syncDetail();

    try {
      let parsedPayload = null;
      if (canPreviewAsText(artifact)) {
        const raw = await fetchArtifactText(artifact, 250000);
        parsedPayload = raw ? parseArtifactPayload(artifact, raw) : null;
      }

      const relatedArtifacts = [];
      const relatedPayloads = {};
      if (isReleaseBundleArtifact(artifact)) {
        const companionManifestArtifact = findPreferredReleaseBundleManifestArtifact(state.data.activeJob.artifacts || []);
        if (companionManifestArtifact) {
          relatedArtifacts.push(companionManifestArtifact);
          const relatedRaw = await fetchArtifactText(companionManifestArtifact, 250000);
          relatedPayloads[companionManifestArtifact.id] = relatedRaw
            ? parseArtifactPayload(companionManifestArtifact, relatedRaw)
            : null;
        }
      }

      const viewer = buildArtifactViewer({
        artifact,
        parsedPayload,
        relatedArtifacts,
        relatedPayloads,
      });
      if (getSelectedArtifactCacheKey() !== cacheKey) return;
      artifactsState.viewerCache[cacheKey] = viewer;
      artifactsState.viewerStatus = 'ready';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerData = viewer;
    } catch (error) {
      if (getSelectedArtifactCacheKey() !== cacheKey) return;
      artifactsState.viewerStatus = 'error';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerError = error instanceof Error ? error.message : String(error);
      artifactsState.viewerData = buildArtifactViewer({ artifact });
    }
  }

  async function ensureQualityDashboard() {
    const activeJob = state.data.activeJob;
    if (!activeJob?.summary) {
      artifactsState.qualityStatus = 'idle';
      artifactsState.qualityError = '';
      artifactsState.qualityData = null;
      artifactsState.qualityCacheKey = '';
      return;
    }

    if (activeJob.status === 'loading') {
      artifactsState.qualityStatus = 'loading';
      artifactsState.qualityError = '';
      artifactsState.qualityData = null;
      artifactsState.qualityCacheKey = `${activeJob.summary.id}:loading`;
      return;
    }

    const selectedArtifacts = collectQualityDashboardArtifacts(activeJob.artifacts || []);
    const relevantArtifacts = selectedArtifacts.payloadArtifacts;
    const cacheKey = `${activeJob.summary.id}:${relevantArtifacts.map((artifact) => artifact.id).join('|')}`;

    if (cacheKey === artifactsState.qualityCacheKey && artifactsState.qualityStatus === 'ready') {
      return;
    }

    if (artifactsState.qualityCache[cacheKey]) {
      artifactsState.qualityStatus = 'ready';
      artifactsState.qualityError = '';
      artifactsState.qualityData = artifactsState.qualityCache[cacheKey];
      artifactsState.qualityCacheKey = cacheKey;
      return;
    }

    artifactsState.qualityStatus = 'loading';
    artifactsState.qualityError = '';
    artifactsState.qualityData = null;
    artifactsState.qualityCacheKey = cacheKey;
    syncQualityDashboard();

    try {
      const artifactPayloads = {};
      for (const artifact of relevantArtifacts) {
        if (!canPreviewAsText(artifact)) continue;
        try {
          const raw = await fetchArtifactText(artifact, 250000);
          artifactPayloads[artifact.id] = raw ? parseArtifactPayload(artifact, raw) : null;
        } catch {
          // Keep the dashboard best-effort and allow fallback sources to render.
        }
      }

      const model = buildQualityDashboardModel({
        artifacts: activeJob.artifacts || [],
        artifactPayloads,
      });

      if (artifactsState.qualityCacheKey !== cacheKey) return;
      artifactsState.qualityStatus = 'ready';
      artifactsState.qualityError = '';
      artifactsState.qualityData = model;
      artifactsState.qualityCache[cacheKey] = model;
    } catch (error) {
      if (artifactsState.qualityCacheKey !== cacheKey) return;
      artifactsState.qualityStatus = 'error';
      artifactsState.qualityError = error instanceof Error ? error.message : String(error);
      artifactsState.qualityData = null;
    }
  }

  function syncDetail() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      detailSummaryElement.replaceChildren(
        isHydratingSelectedJob()
          ? createEmptyState({
              icon: '...',
              title: 'Loading artifacts',
              copy: 'Waiting for the selected tracked job to hydrate before choosing an artifact.',
            })
          : createEmptyState({
              icon: '>',
              title: 'Select an artifact',
              copy: 'The detail panel will show structured reopen state, manifest notes, and a raw preview when the artifact is browser-friendly.',
            })
      );
      detailActionsElement.replaceChildren();
      detailPreviewElement.hidden = true;
      detailPreviewElement.textContent = '';
      detailNotesElement.replaceChildren();
      return;
    }

    const activeArtifacts = state.data.activeJob.artifacts || [];
    const sourceConfigArtifact = findPreferredConfigArtifact(activeArtifacts);
    const sourceDocsManifestArtifact = findPreferredDocsManifestArtifact(activeArtifacts);
    const preferredReviewPackArtifact = findPreferredReviewPackArtifact(activeArtifacts);
    const preferredReadinessArtifact = findPreferredReadinessReportArtifact(activeArtifacts);
    const preferredReleaseBundleArtifact = findPreferredReleaseBundleArtifact(activeArtifacts);
    const selectedOpenLabel = buildArtifactOpenLabel(artifact);
    const reentry = deriveArtifactReentryCapabilities(artifact);
    const supportsTrackedStandardDocs = reentry.canRunTrackedStandardDocs
      && (Boolean(sourceConfigArtifact) || isReleaseBundleArtifact(artifact));
    const baselineReviewPack = findPreferredReviewPackArtifact(artifactsState.compare.artifacts || []);
    const baselineReadiness = findPreferredReadinessReportArtifact(artifactsState.compare.artifacts || []);
    const compareJobId = artifactsState.compare.job?.id || '';
    const viewerBlocks = artifactsState.viewerStatus === 'loading' && artifactsState.viewerArtifactId === artifact.id
      ? [
          createEmptyState({
            icon: '...',
            title: 'Loading reopen state...',
            copy: 'Preparing the structured reopen view for the selected artifact.',
          }),
        ]
      : artifactsState.viewerStatus === 'error' && artifactsState.viewerArtifactId === artifact.id
        ? [
            createEmptyState({
              icon: '!',
              title: 'Failed to prepare reopen state',
              copy: artifactsState.viewerError || 'Open the raw artifact or use the follow-up actions below.',
            }),
          ]
        : renderViewerBlock(artifactsState.viewerData);
    detailSummaryElement.replaceChildren(
      createInfoGrid(buildArtifactDetailItems(artifact, state.data.activeJob)),
      ...viewerBlocks
    );

    detailActionsElement.replaceChildren(
      ...(artifact.capabilities?.can_open
        ? [
            el('a', {
              className: 'action-button action-button-primary',
              text: selectedOpenLabel,
              attrs: { href: artifact.links.open, target: '_blank', rel: 'noreferrer noopener' },
            }),
          ]
        : []),
      ...(artifact.capabilities?.can_download
        ? [
            el('a', {
              className: 'action-button action-button-ghost',
              text: 'Download',
              attrs: { href: artifact.links.download, rel: 'noreferrer' },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary
        ? [
            createButton({
              label: 'Open Review',
              action: 'open-review',
              tone: 'ghost',
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && preferredReviewPackArtifact && preferredReviewPackArtifact.id !== artifact.id
        ? [
            createButton({
              label: 'Open review pack',
              action: 'artifacts-select-artifact',
              tone: 'ghost',
              dataset: { artifactId: preferredReviewPackArtifact.id },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && preferredReadinessArtifact && preferredReadinessArtifact.id !== artifact.id
        ? [
            createButton({
              label: 'Open readiness report',
              action: 'artifacts-select-artifact',
              tone: 'ghost',
              dataset: { artifactId: preferredReadinessArtifact.id },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && preferredReleaseBundleArtifact && preferredReleaseBundleArtifact.id !== artifact.id
        ? [
            createButton({
              label: 'Open release bundle',
              action: 'artifacts-select-artifact',
              tone: 'ghost',
              dataset: { artifactId: preferredReleaseBundleArtifact.id },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && reentry.canOpenInModel
        ? [
            createButton({
              label: 'Open in Model',
              action: 'open-config-artifact-in-model',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
            createButton({
              label: 'Tracked report',
              action: 'run-artifact-report',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && reentry.canRunTrackedReviewContext
        ? [
            createButton({
              label: 'Tracked review context',
              action: 'run-artifact-review-context',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && reentry.canRunTrackedReadinessPack
        ? [
            createButton({
              label: 'Tracked readiness pack',
              action: 'run-artifact-readiness-pack',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary
        && compareJobId
        && isReviewPackArtifact(artifact)
        && baselineReviewPack
        ? [
            createButton({
              label: 'Tracked compare-rev',
              action: 'artifacts-run-compare',
              tone: 'ghost',
              dataset: {
                baselineJobId: compareJobId,
                baselineArtifactId: baselineReviewPack.id,
                candidateJobId: state.data.activeJob.summary.id,
                candidateArtifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary
        && compareJobId
        && isReadinessReportArtifact(artifact)
        && baselineReadiness
        ? [
            createButton({
              label: 'Tracked stabilization review',
              action: 'artifacts-run-stabilization',
              tone: 'ghost',
              dataset: {
                baselineJobId: compareJobId,
                baselineArtifactId: baselineReadiness.id,
                candidateJobId: state.data.activeJob.summary.id,
                candidateArtifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && supportsTrackedStandardDocs
        ? [
            createButton({
              label: 'Tracked standard docs',
              action: 'run-artifact-standard-docs',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && reentry.canRunTrackedPack
        ? [
            createButton({
              label: sourceDocsManifestArtifact ? 'Tracked pack (+ docs)' : 'Tracked pack',
              action: 'run-artifact-pack',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && reentry.canRunTrackedInspect
        ? [
            createButton({
              label: 'Tracked inspect',
              action: 'run-artifact-inspect',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: artifact.id,
              },
            }),
          ]
        : [])
    );

    if (artifactsState.previewStatus === 'loading' && artifactsState.previewArtifactId === artifact.id) {
      detailPreviewElement.hidden = false;
      detailPreviewElement.textContent = 'Loading preview...';
    } else if (artifactsState.previewStatus === 'error' && artifactsState.previewArtifactId === artifact.id) {
      detailPreviewElement.hidden = false;
      detailPreviewElement.textContent = artifactsState.previewError;
    } else if (artifactsState.previewText && artifactsState.previewArtifactId === artifact.id) {
      detailPreviewElement.hidden = false;
      detailPreviewElement.textContent = artifactsState.previewText;
    } else {
      detailPreviewElement.hidden = true;
      detailPreviewElement.textContent = '';
    }

    detailNotesElement.replaceChildren(
      ...buildArtifactDetailNotes(artifact, state.data.activeJob).map((note) =>
        el('div', {
          className: state.data.activeJob.manifest?.warnings?.includes(note)
            ? 'support-note support-note-warn'
            : 'support-note',
          text: note,
        })
      )
    );
  }

  async function syncAll() {
    if (destroyed) return;
    syncTimeline();
    syncJobSummary();
    await ensureQualityDashboard();
    syncQualityDashboard();
    syncCompare();
    syncGeneratedFiles();
    syncCards();
    await ensureArtifactViewer();
    await ensureArtifactPreview();
    syncDetail();
    applyTranslations(root);
  }

  async function loadCompareJob(jobId) {
    artifactsState.compare = {
      ...artifactsState.compare,
      jobId,
      status: 'loading',
      errorMessage: '',
      job: null,
      artifacts: [],
    };
    syncCompare();

    try {
      const [jobPayload, artifactsPayload] = await Promise.all([
        fetchJson(`/jobs/${jobId}`),
        fetchJson(`/jobs/${jobId}/artifacts`),
      ]);
      artifactsState.compare = {
        jobId,
        status: 'ready',
        errorMessage: '',
        job: jobPayload.job,
        artifacts: artifactsPayload.artifacts || [],
      };
      addLog({
        status: 'Artifacts',
        message: `Prepared compare baseline from ${jobPayload.job.type} ${shortJobId(jobId)}.`,
        tone: 'info',
        time: 'artifacts',
      });
    } catch (error) {
      artifactsState.compare = {
        jobId,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        job: null,
        artifacts: [],
      };
    } finally {
      syncCompare();
    }
  }

  function handleClick(event) {
    const actionTarget = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!actionTarget) return;

    if (actionTarget.dataset.action === 'artifacts-open-job' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'artifacts' });
      return;
    }

    if (actionTarget.dataset.action === 'artifacts-select-artifact') {
      artifactsState.selectedArtifactId = actionTarget.dataset.artifactId || '';
      artifactsState.previewStatus = 'idle';
      artifactsState.previewText = '';
      artifactsState.previewArtifactId = '';
      artifactsState.previewError = '';
      artifactsState.viewerStatus = 'idle';
      artifactsState.viewerArtifactId = '';
      artifactsState.viewerError = '';
      artifactsState.viewerData = null;
      syncAll();
      return;
    }

    if (actionTarget.dataset.action === 'artifacts-compare-job' && actionTarget.dataset.jobId) {
      loadCompareJob(actionTarget.dataset.jobId);
    }
  }

  root.addEventListener('click', handleClick);
  if (!artifactsState.selectedArtifactId) {
    artifactsState.selectedArtifactId = findDefaultArtifactForJob(state.data.activeJob.artifacts || [])?.id || '';
  }
  syncAll();

  return {
    syncFromShell() {
      syncAll();
    },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', handleClick);
    },
  };
}
