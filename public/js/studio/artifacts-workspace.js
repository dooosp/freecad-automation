import {
  createButton,
  createCard,
  createEmptyState,
  createInfoGrid,
  createSectionHeader,
  el,
} from './renderers.js';
import {
  buildArtifactDetailItems,
  buildArtifactDetailNotes,
  canPreviewAsText,
  classifyArtifact,
  fetchArtifactText,
  formatBytes,
  formatDateTime,
  formatJobStatus,
  shortJobId,
} from './artifact-insights.js';
import {
  deriveArtifactReentryCapabilities,
} from './artifact-actions.js';

function ensureArtifactsWorkspaceState(store = {}) {
  store.selectedArtifactId = store.selectedArtifactId || '';
  store.previewStatus = store.previewStatus || 'idle';
  store.previewText = store.previewText || '';
  store.previewArtifactId = store.previewArtifactId || '';
  store.previewError = store.previewError || '';
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
  return store;
}

function renderTimeline(recentJobs = [], activeJobId = '', compareJobId = '') {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: '[]',
      title: 'No tracked jobs',
      copy: 'Tracked jobs created through `fcad serve` will appear here as the artifact timeline.',
    });
  }

  return el('div', {
    className: 'artifact-timeline',
    children: recentJobs.map((job, index) => {
      const isActive = job.id === activeJobId;
      const isCompare = job.id === compareJobId;
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
                  el('p', { className: 'job-title', text: `${job.type} ${shortJobId(job.id)}` }),
                  el('span', { className: 'pill', text: index === 0 ? 'Latest' : isActive ? 'Active' : 'Older' }),
                  isCompare ? el('span', { className: 'pill', text: 'Compare' }) : null,
                ],
              }),
              el('p', {
                className: 'timeline-copy',
                text: `${formatJobStatus(job.status)} • ${formatDateTime(job.updated_at)}`,
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
                label: isCompare ? 'Compared' : 'Compare',
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

export function renderArtifactsWorkspace(state) {
  ensureArtifactsWorkspaceState(state.data.artifactsWorkspace);
  const activeJob = state.data.activeJob;
  const recentJobs = state.data.recentJobs.items || [];

  return el('section', {
    className: 'workspace-shell',
    children: [
      createSectionHeader({
        kicker: 'Artifacts workspace',
        title: activeJob?.summary
          ? `Artifact trail for ${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}`
          : 'Artifact trail, manifests, and job history',
        description: 'Jobs stay visible as a timeline, artifacts become first-class product objects, and file-opening stays route-safe instead of relying on absolute paths.',
        badges: [
          { label: activeJob?.summary ? 'Tracked job selected' : 'No job selected', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `${recentJobs.length || 0} jobs in timeline`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: 'Browser-safe artifact links', tone: 'ok' },
        ],
      }),
      el('div', {
        className: 'artifacts-layout',
        children: [
          el('div', {
            className: 'pane-stack',
            children: [
              createCard({
                kicker: 'Recent jobs',
                title: 'Job timeline',
                copy: 'The newest job is called out explicitly, while older runs stay available for compare and reopen flows.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-timeline' } }),
                ],
              }),
              createCard({
                kicker: 'Manifest summary',
                title: activeJob?.summary ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` : 'Select a tracked job',
                copy: 'Manifest facts and storage metadata stay visible while you inspect output files.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-job-summary' } }),
                ],
              }),
              createCard({
                kicker: 'Compare',
                title: 'Latest vs older runs',
                copy: 'Compare stays lightweight for now: artifact coverage and manifest shape instead of semantic CAD diffs.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-compare' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'pane-stack',
            children: [
              createCard({
                kicker: 'Artifact board',
                title: 'Known outputs for the active job',
                copy: 'Artifacts are grouped by job and carry type badges, open/download actions, and manifest-backed metadata.',
                surface: 'canvas',
                body: [
                  el('div', { className: 'artifact-card-grid', dataset: { hook: 'artifacts-cards' } }),
                ],
              }),
              createCard({
                kicker: 'Detail panel',
                title: 'Artifact detail',
                copy: 'Inspect the selected artifact, open it in the browser when safe, or download it without using raw filesystem paths.',
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
  const compareElement = root.querySelector('[data-hook="artifacts-compare"]');
  const cardsElement = root.querySelector('[data-hook="artifacts-cards"]');
  const detailSummaryElement = root.querySelector('[data-hook="artifacts-detail-summary"]');
  const detailActionsElement = root.querySelector('[data-hook="artifacts-detail-actions"]');
  const detailPreviewElement = root.querySelector('[data-hook="artifacts-detail-preview"]');
  const detailNotesElement = root.querySelector('[data-hook="artifacts-detail-notes"]');
  let destroyed = false;

  function getSelectedArtifact() {
    const artifacts = state.data.activeJob.artifacts || [];
    return artifacts.find((artifact) => artifact.id === artifactsState.selectedArtifactId) || artifacts[0] || null;
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
    if (!activeJob?.summary) {
      jobSummaryElement.replaceChildren(
        createEmptyState({
          icon: 'A',
          title: 'No active job',
          copy: 'Open a recent job from the timeline to make its artifact set inspectable here.',
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

    if (artifactsState.compare.status === 'loading') {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading baseline artifacts',
          copy: 'Preparing a lightweight manifest and artifact-set comparison.',
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
          copy: 'Choose Compare on an older timeline entry to see what artifact coverage changed.',
        })
      );
      return;
    }

    const diff = diffArtifacts(state.data.activeJob.artifacts || [], artifactsState.compare.artifacts || []);
    compareElement.replaceChildren(
      createInfoGrid([
        { label: 'Baseline', value: `${artifactsState.compare.job.type} ${shortJobId(artifactsState.compare.job.id)}` },
        { label: 'Added artifact types', value: diff.added.join(', ') || 'None' },
        { label: 'Missing vs baseline', value: diff.removed.join(', ') || 'None' },
        { label: 'Baseline updated', value: formatDateTime(artifactsState.compare.job.updated_at) },
      ])
    );
  }

  function syncCards() {
    const activeJob = state.data.activeJob;
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

    if (artifactsState.cache[artifact.id]) {
      artifactsState.previewStatus = 'ready';
      artifactsState.previewText = artifactsState.cache[artifact.id];
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
      artifactsState.cache[artifact.id] = text || '';
      artifactsState.previewStatus = 'ready';
      artifactsState.previewText = text || '';
    } catch (error) {
      artifactsState.previewStatus = 'error';
      artifactsState.previewError = error instanceof Error ? error.message : String(error);
    }
  }

  function syncDetail() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      detailSummaryElement.replaceChildren(
        createEmptyState({
          icon: '>',
          title: 'Select an artifact',
          copy: 'The detail panel will show metadata, manifest notes, and a raw preview when the artifact is browser-friendly.',
        })
      );
      detailActionsElement.replaceChildren();
      detailPreviewElement.hidden = true;
      detailPreviewElement.textContent = '';
      detailNotesElement.replaceChildren();
      return;
    }

    const reentry = deriveArtifactReentryCapabilities(artifact);
    detailSummaryElement.replaceChildren(
      createInfoGrid(buildArtifactDetailItems(artifact, state.data.activeJob))
    );

    detailActionsElement.replaceChildren(
      ...(artifact.capabilities?.can_open
        ? [
            el('a', {
              className: 'action-button action-button-primary',
              text: 'Open',
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
    syncCompare();
    syncCards();
    await ensureArtifactPreview();
    syncDetail();
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
      syncAll();
      return;
    }

    if (actionTarget.dataset.action === 'artifacts-compare-job' && actionTarget.dataset.jobId) {
      loadCompareJob(actionTarget.dataset.jobId);
    }
  }

  root.addEventListener('click', handleClick);
  if (!artifactsState.selectedArtifactId) {
    artifactsState.selectedArtifactId = state.data.activeJob.artifacts?.[0]?.id || '';
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
