import {
  createButton,
  createCard,
  createEmptyState,
  createInfoGrid,
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
  return store;
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
      title: '추적 작업이 없습니다',
      copy: '`fcad serve`로 생성한 추적 작업이 여기에 산출물 타임라인으로 표시됩니다.',
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
                  el('span', { className: 'pill', text: index === 0 ? '최신' : isActive ? '활성' : '이전' }),
                  isCompare ? el('span', { className: 'pill', text: '비교' }) : null,
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
                label: isActive ? '활성' : '열기',
                action: 'artifacts-open-job',
                tone: isActive ? 'primary' : 'ghost',
                dataset: { jobId: job.id },
                disabled: isActive,
              }),
              createButton({
                label: isCompare ? '비교 중' : '비교',
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
                text: `${artifact.file_name} • ${artifact.exists ? formatBytes(artifact.size_bytes) : '누락됨'}${artifact.type ? ` • ${artifact.type}` : ''}`,
              }),
            ],
          }),
          el('div', {
            className: 'artifact-card-actions',
            children: [
              createButton({
                label: '검토',
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
                text: '열기',
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
  if (entries.length === 0) return '사용할 수 없음';
  const available = entries.filter(([, record]) => record?.exists).length;
  return `${available}/${entries.length} 인덱싱됨`;
}

function diffArtifacts(current = [], baseline = []) {
  const currentTypes = new Set(current.map((artifact) => artifact.type || artifact.file_name));
  const baselineTypes = new Set(baseline.map((artifact) => artifact.type || artifact.file_name));
  const added = [...currentTypes].filter((entry) => !baselineTypes.has(entry));
  const removed = [...baselineTypes].filter((entry) => !currentTypes.has(entry));
  return { added, removed };
}

function compareAvailabilityLabel(isAvailable) {
  return isAvailable ? '준비됨' : '누락됨';
}

function renderArtifactPipeline(activeJob) {
  const artifacts = activeJob?.artifacts || [];
  const hasArtifacts = artifacts.length > 0;
  const hasReview = Boolean(findPreferredReviewPackArtifact(artifacts));
  const hasManifest = Boolean(activeJob?.manifest?.command || hasArtifacts);
  const hasPackage = Boolean(findPreferredReleaseBundleArtifact(artifacts) || findPreferredReleaseBundleManifestArtifact(artifacts));
  const hasDownload = artifacts.some((artifact) => artifact.capabilities?.can_download);
  const steps = [
    { label: '검토', state: hasReview ? '준비됨' : '대기 중', tone: hasReview ? 'ok' : 'warn' },
    { label: 'Manifest', state: hasManifest ? '인덱싱됨' : '대기 중', tone: hasManifest ? 'info' : 'warn' },
    { label: '패키지', state: hasPackage ? '사용 가능' : '대기 중', tone: hasPackage ? 'ok' : 'warn' },
    { label: '다운로드', state: hasDownload ? '준비됨' : '대기 중', tone: hasDownload ? 'ok' : 'info' },
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
      title: '아직 대기 중인 출력이 없습니다',
      copy: '로컬 API가 기록하는 즉시 추적 검토, 패키지, 내보내기 실행이 여기에 표시됩니다.',
    });
  }

  return el('div', {
    className: 'output-queue',
    children: recentJobs.slice(0, 4).map((job) =>
      el('article', {
        className: 'queue-row',
        children: [
          el('div', {
            className: 'queue-row-copy',
            children: [
              el('p', { className: 'queue-row-title', text: `${job.type} ${shortJobId(job.id)}` }),
              el('p', { className: 'queue-row-meta', text: formatDateTime(job.updated_at) }),
            ],
          }),
          el('span', { className: 'pill', text: formatJobStatus(job.status) }),
        ],
      })
    ),
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
        kicker: '패키지 작업 영역',
        title: '산출물 관리 대시보드',
        description: '최근 작업, 매니페스트 상태, 패키지 준비도, 안전한 다운로드 경로를 하나의 산출물 중심 작업 영역에서 확인합니다.',
        badges: [
          { label: activeJob?.summary ? '추적 작업 선택됨' : '활성 패키지 없음', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `최근 실행 ${recentJobs.length || 0}개`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: '매니페스트 기반 다운로드 경로', tone: 'ok' },
        ],
      }),
      createCard({
        kicker: '산출물 파이프라인',
        title: '검토에서 다운로드까지의 흐름',
        copy: '활성 산출물 세트가 표준 검토 출력, 매니페스트 인덱싱, 패키지 조립, 명시적 다운로드 준비 상태에 기반하도록 유지합니다.',
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
                kicker: '최근 작업',
                title: '최근 작업 흐름',
                copy: '최신 작업은 눈에 띄게 유지되고, 이전 실행은 비교 준비 상태와 재열기 가능 상태를 유지합니다.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-timeline' } }),
                ],
              }),
              createCard({
                kicker: '패키지 상태',
                title: activeJob?.summary ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` : '추적 작업 선택',
                copy: '출력 파일을 검토하는 동안 매니페스트 정보, 저장소 상태, 내보내기 준비 상태를 계속 볼 수 있습니다.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-job-summary' } }),
                ],
              }),
              createCard({
                kicker: '비교',
                title: '현재 패키지와 기준선 비교',
                copy: '이전 추적 실행을 기준선으로 선택하세요. 양쪽에 표준 review-pack 또는 readiness 입력이 있으면 Studio가 여기서 compare-rev 또는 stabilization-review를 대기열에 넣을 수 있습니다.',
                body: [
                  el('div', { dataset: { hook: 'artifacts-compare' } }),
                ],
              }),
              createCard({
                kicker: '실시간 출력 대기열',
                title: '최근 패키지 및 내보내기 활동',
                copy: '산출물을 선택하지 않아도 패키지, 보고서, 내보내기 활동이 작은 대기열 행으로 계속 보입니다.',
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
                kicker: '활성 산출물',
                title: '현재 작업의 출력 목록',
                copy: '산출물은 작업별로 그룹화되고 유형 배지, 열기/다운로드 작업, 구조화된 메타데이터를 제공합니다.',
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
                kicker: '구조화된 인스펙터',
                title: '산출물 세부 정보',
                copy: '선택한 산출물을 검토하고, 안전한 경우 미리본 뒤, 원시 파일 시스템 경로 없이 후속 작업으로 이어가세요.',
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
          title: '활성 작업이 없습니다',
          copy: '타임라인에서 최근 작업을 열면 이곳에서 해당 산출물 세트를 검토할 수 있습니다.',
        })
      );
      return;
    }

    jobSummaryElement.replaceChildren(
      createInfoGrid([
        { label: '작업', value: `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` },
        { label: '상태', value: formatJobStatus(activeJob.summary.status) },
        { label: '업데이트', value: formatDateTime(activeJob.summary.updated_at) },
        { label: '매니페스트 명령', value: activeJob.manifest?.command || '알 수 없음' },
        { label: '산출물 수', value: String((activeJob.artifacts || []).length) },
        { label: '작업 저장소', value: summarizeStorage(activeJob.storage) },
      ])
    );
  }

  function syncCompare() {
    if (!state.data.activeJob.summary) {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '=',
          title: '비교에는 활성 작업이 필요합니다',
          copy: '먼저 추적 작업을 연 뒤 타임라인에서 이전 실행을 기준선으로 선택하세요.',
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
          title: '기준선 산출물을 불러오는 중입니다',
          copy: '선택한 기준선을 준비하여 compare-rev와 안정화 준비 상태를 확인하고 있습니다.',
        })
      );
      return;
    }

    if (artifactsState.compare.status === 'error') {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: '기준선 비교를 준비하지 못했습니다',
          copy: artifactsState.compare.errorMessage || '선택한 기준선 작업을 불러오지 못했습니다.',
        })
      );
      return;
    }

    if (!artifactsState.compare.job) {
      compareElement.replaceChildren(
        createEmptyState({
          icon: '<>',
          title: '기준선이 선택되지 않았습니다',
          copy: '이전 타임라인 항목에서 비교를 선택하면 커버리지 변화를 확인하고, 표준 산출물이 있을 때 추적 비교 작업을 실행할 수 있습니다.',
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

  async function ensureArtifactViewer() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      artifactsState.viewerStatus = 'idle';
      artifactsState.viewerArtifactId = '';
      artifactsState.viewerError = '';
      artifactsState.viewerData = null;
      return;
    }

    if (artifactsState.viewerCache[artifact.id]) {
      artifactsState.viewerStatus = 'ready';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerError = '';
      artifactsState.viewerData = artifactsState.viewerCache[artifact.id];
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
      artifactsState.viewerCache[artifact.id] = viewer;
      artifactsState.viewerStatus = 'ready';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerData = viewer;
    } catch (error) {
      artifactsState.viewerStatus = 'error';
      artifactsState.viewerArtifactId = artifact.id;
      artifactsState.viewerError = error instanceof Error ? error.message : String(error);
      artifactsState.viewerData = buildArtifactViewer({ artifact });
    }
  }

  function syncDetail() {
    const artifact = getSelectedArtifact();
    if (!artifact) {
      detailSummaryElement.replaceChildren(
        createEmptyState({
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
    syncCompare();
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
