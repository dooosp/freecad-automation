import {
  createButton,
  createCard,
  createEmptyState,
  createInfoGrid,
  createSectionHeader,
  el,
} from './renderers.js';
import {
  buildReviewCards,
  fetchArtifactText,
  formatDateTime,
  formatJobStatus,
  parseArtifactPayload,
  shortJobId,
} from './artifact-insights.js';
import {
  deriveArtifactReentryCapabilities,
  findPreferredConfigArtifact,
} from './artifact-actions.js';
import { applyTranslations } from '../i18n/index.js';

function ensureReviewState(review = {}) {
  review.status = review.status || 'idle';
  review.jobId = review.jobId || '';
  review.cards = Array.isArray(review.cards) ? review.cards : [];
  review.selectedCardId = review.selectedCardId || '';
  review.activeTab = review.activeTab || 'summary';
  review.errorMessage = review.errorMessage || '';
  review.cache = review.cache && typeof review.cache === 'object' ? review.cache : {};
  return review;
}

function activeJobTitle(activeJob) {
  if (!activeJob?.summary) return 'Select a tracked job';
  return `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}`;
}

function reviewCoverage(cards = []) {
  return cards.filter((card) => !card.empty).length;
}

function cardButtonTone(card) {
  if (card.tone === 'ok') return 'primary';
  return 'ghost';
}

function renderRecentJobs(recentJobs = []) {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: '+',
      title: '아직 추적 작업이 없습니다',
      copy: '`fcad serve`로 작업을 실행하면 검토 경로에 사용할 추적 작업이 여기에 표시됩니다.',
    });
  }

  return el('div', {
    className: 'review-job-table',
    children: recentJobs.slice(0, 5).map((job, index) =>
      el('article', {
        className: 'review-job-row',
        children: [
          el('div', {
            className: 'review-job-source',
            children: [
              el('p', { className: 'job-title', text: `${job.type} ${shortJobId(job.id)}` }),
              el('p', { className: 'job-copy', text: index === 0 ? '최신 추적 소스' : '추적 소스' }),
            ],
          }),
          el('p', { className: 'review-job-time', text: formatDateTime(job.updated_at) }),
          el('span', { className: 'pill', text: formatJobStatus(job.status) }),
          createButton({
            label: '열기',
            action: 'review-open-job',
            tone: 'ghost',
            dataset: { jobId: job.id },
          }),
        ],
      })
    ),
  });
}

function renderReviewActivity(recentJobs = []) {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: '~',
      title: '최근 소스 변경이 없습니다',
      copy: '추적 작업을 열면 이 피드가 최신 검토 준비 활동을 요약합니다.',
    });
  }

  return el('div', {
    className: 'activity-feed',
    children: recentJobs.slice(0, 4).map((job, index) =>
      el('article', {
        className: 'activity-item',
        children: [
          el('div', { className: 'activity-dot' }),
          el('div', {
            className: 'activity-copy',
            children: [
              el('p', {
                className: 'activity-title',
                text: `${index === 0 ? '최신' : '최근'} ${job.type} ${shortJobId(job.id)}`,
              }),
              el('p', {
                className: 'activity-meta',
                text: `${formatJobStatus(job.status)} • ${formatDateTime(job.updated_at)}`,
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function renderReviewCard(card, selected = false) {
  return el('article', {
    className: `review-card${selected ? ' is-selected' : ''}`,
    dataset: {
      tone: card.tone || 'info',
      empty: card.empty ? 'true' : 'false',
    },
    children: [
      el('div', {
        className: 'review-card-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'eyebrow', text: card.title }),
              el('h3', { className: 'card-title', text: card.status }),
            ],
          }),
          el('span', {
            className: `pill pill-status-${card.tone || 'info'}`,
            text: card.score !== null && card.score !== undefined ? `${card.score}` : '상태',
          }),
        ],
      }),
      el('p', { className: 'card-copy', text: card.summary }),
      el('div', {
        className: 'review-card-actions',
        children: [
          createButton({
            label: card.empty ? '빈 영역 보기' : '세부 보기',
            action: 'review-select-card',
            tone: cardButtonTone(card),
            dataset: { cardId: card.id },
          }),
        ],
      }),
    ],
  });
}

function renderDetailSummary(card) {
  if (card.empty) {
    return createEmptyState({
      icon: '!',
      title: `${card.title} 항목이 비어 있습니다`,
      copy: card.summary,
    });
  }

  return createInfoGrid(
    (card.normalized || []).map(([label, value]) => ({
      label,
      value: value ?? 'Unavailable',
    }))
  );
}

export function renderReviewWorkspace(state) {
  ensureReviewState(state.data.review);
  const activeJob = state.data.activeJob;
  const recentJobs = state.data.recentJobs.items || [];

  return el('section', {
    className: 'workspace-shell review-dashboard',
    children: [
      createSectionHeader({
        kicker: '검토 작업 영역',
        title: activeJob?.summary
          ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)} 검토 대시보드`
          : '신호, 준비 상태, 제조 게이트를 위한 검토 대시보드',
        description: '추적 소스를 선택하고 품질 보드를 훑은 뒤, 더 깊게 읽어야 하는 근거 영역만 세부 검토하세요.',
        badges: [
          { label: activeJob?.summary ? '추적 소스 선택됨' : '추적 소스 없음', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `최근 소스 ${recentJobs.length || 0}개`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: 'DFM · 품질 · 준비 상태 · 표준 문서', tone: 'info' },
        ],
      }),
      el('div', {
        className: 'review-dashboard-grid',
        children: [
          el('div', {
            className: 'review-column review-column-left',
            children: [
              createCard({
                kicker: '소스 선택',
                title: '추적 작업 선택',
                copy: activeJob?.summary
                  ? '검토 보드는 선택한 추적 작업과 그 매니페스트 기반 산출물 세트를 기준으로 읽습니다.'
                  : 'DFM, 품질, 준비 상태, 표준 문서 카드를 채우려면 추적 작업을 여세요.',
                body: [
                  el('div', { dataset: { hook: 'review-job-summary' } }),
                  el('div', { dataset: { hook: 'review-recent-jobs' } }),
                ],
              }),
              createCard({
                kicker: '최근 소스 변경',
                title: '활동 피드',
                copy: '대시보드를 벗어나지 않고 최신 추적 검토 활동을 계속 확인하세요.',
                body: [
                  el('div', { dataset: { hook: 'review-activity' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'review-column review-column-center',
            children: [
              createCard({
                kicker: '검토 보드',
                title: '검토 신호 보드',
                copy: '카드는 작고 상태 중심으로 유지되어 무엇이 바뀌었는지, 무엇이 준비되었는지, 다음에 어디를 검토해야 하는지 먼저 보여줍니다.',
                surface: 'canvas',
                body: [
                  el('div', { dataset: { hook: 'review-status' } }),
                  el('div', { className: 'review-card-grid', dataset: { hook: 'review-cards' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'review-column review-column-right',
            children: [
              createCard({
                kicker: '세부 인스펙터',
                title: '정규화 요약, 원본 출력, 생성 이력',
                copy: '선택한 신호는 먼저 구조화된 요약으로 보고, 필요할 때만 원본 출력이나 생성 이력으로 전환하세요.',
                surface: 'canvas',
                body: [
                  el('div', {
                    className: 'inspector-tabs',
                    children: [
                      createButton({
                        label: '요약',
                        action: 'review-set-tab',
                        tone: 'ghost',
                        dataset: { tab: 'summary', hook: 'review-tab-summary' },
                      }),
                      createButton({
                        label: '원본 출력',
                        action: 'review-set-tab',
                        tone: 'ghost',
                        dataset: { tab: 'raw', hook: 'review-tab-raw' },
                      }),
                      createButton({
                        label: '생성 이력',
                        action: 'review-set-tab',
                        tone: 'ghost',
                        dataset: { tab: 'provenance', hook: 'review-tab-provenance' },
                      }),
                    ],
                  }),
                  el('div', { className: 'review-detail-actions', dataset: { hook: 'review-detail-actions' } }),
                  el('section', { className: 'inspector-panel', dataset: { panel: 'summary' }, children: [el('div', { dataset: { hook: 'review-detail-summary' } })] }),
                  el('section', { className: 'inspector-panel', dataset: { panel: 'raw' }, children: [el('pre', { className: 'artifact-raw-preview', dataset: { hook: 'review-detail-raw' } })] }),
                  el('section', { className: 'inspector-panel', dataset: { panel: 'provenance' }, children: [el('div', { className: 'review-provenance-list', dataset: { hook: 'review-detail-provenance' } })] }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function mountReviewWorkspace({ root, state, addLog, openJob }) {
  const review = ensureReviewState(state.data.review);
  const jobSummaryElement = root.querySelector('[data-hook="review-job-summary"]');
  const recentJobsElement = root.querySelector('[data-hook="review-recent-jobs"]');
  const statusElement = root.querySelector('[data-hook="review-status"]');
  const cardsElement = root.querySelector('[data-hook="review-cards"]');
  const activityElement = root.querySelector('[data-hook="review-activity"]');
  const detailSummaryElement = root.querySelector('[data-hook="review-detail-summary"]');
  const detailActionsElement = root.querySelector('[data-hook="review-detail-actions"]');
  const detailRawElement = root.querySelector('[data-hook="review-detail-raw"]');
  const detailProvenanceElement = root.querySelector('[data-hook="review-detail-provenance"]');
  const detailPanels = [...root.querySelectorAll('[data-panel]')];
  const tabButtons = [...root.querySelectorAll('[data-action="review-set-tab"]')];
  let destroyed = false;

  function getSelectedCard() {
    return review.cards.find((card) => card.id === review.selectedCardId) || review.cards[0] || null;
  }

  function syncJobSummary() {
    const activeJob = state.data.activeJob;
    if (!activeJob?.summary) {
      jobSummaryElement.replaceChildren(
        createEmptyState({
          icon: 'R',
          title: '추적 작업이 선택되지 않았습니다',
          copy: '먼저 콘솔이나 패키지에서 추적 작업을 여세요. 그러면 검토 작업 영역이 해당 작업의 매니페스트와 산출물 목록을 사용합니다.',
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
        { label: '경고', value: String((activeJob.manifest?.warnings || []).length) },
        { label: '산출물', value: String((activeJob.artifacts || []).length) },
      ])
    );
  }

  function syncStatus() {
    if (review.status === 'loading') {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: '검토 신호를 불러오는 중입니다',
          copy: '선택한 작업의 준비 상태 및 검토 산출물을 스튜디오 형식으로 정리하고 있습니다.',
        })
      );
      return;
    }

    if (review.status === 'error') {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: '검토 신호를 준비하지 못했습니다',
          copy: review.errorMessage || '선택한 작업은 존재하지만, 검토 산출물을 스튜디오에서 해석하지 못했습니다.',
        })
      );
      return;
    }

    const activeJob = state.data.activeJob;
    if (!activeJob?.summary) {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '[]',
          title: '검토에는 추적 작업이 필요합니다',
          copy: '최근 작업을 열어 DFM, 품질, 준비 상태, 표준 문서 카드를 채우세요.',
        })
      );
      return;
    }

    const coverage = reviewCoverage(review.cards);
    statusElement.replaceChildren(
      createInfoGrid([
        { label: '선택된 작업', value: `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` },
        { label: '데이터가 있는 검토 카드', value: `${coverage}/${review.cards.length || 6}` },
        { label: '매니페스트 경고', value: String((activeJob.manifest?.warnings || []).length) },
      ])
    );
  }

  function syncCards() {
    if (review.status !== 'ready') {
      cardsElement.replaceChildren();
      return;
    }

    cardsElement.replaceChildren(
      ...review.cards.map((card) => renderReviewCard(card, card.id === review.selectedCardId))
    );
  }

  function syncTabs() {
    detailPanels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== review.activeTab;
    });
    tabButtons.forEach((button) => {
      button.dataset.selected = button.dataset.tab === review.activeTab ? 'true' : 'false';
    });
  }

  function syncDetail() {
    const card = getSelectedCard();
    const sourceConfigArtifact = findPreferredConfigArtifact(state.data.activeJob.artifacts || []);
    const sourceConfigReentry = deriveArtifactReentryCapabilities(sourceConfigArtifact || {});
    if (!card) {
      detailSummaryElement.replaceChildren(
        createEmptyState({
          icon: '>',
          title: '카드를 선택하세요',
          copy: '세부 패널에 선택한 검토 신호의 정규화 정보, 원문, 생성 이력이 표시됩니다.',
        })
      );
      detailActionsElement.replaceChildren();
      detailRawElement.textContent = '';
      detailRawElement.hidden = true;
      detailProvenanceElement.replaceChildren();
      syncTabs();
      return;
    }

    detailSummaryElement.replaceChildren(renderDetailSummary(card));
    detailActionsElement.replaceChildren(
      ...(card.artifact
        ? [
            card.artifact.capabilities?.can_open
              ? el('a', {
                  className: 'action-button action-button-primary',
                  text: '원본 산출물 열기',
                  attrs: { href: card.artifact.links.open, target: '_blank', rel: 'noreferrer noopener' },
                })
              : null,
            card.artifact.capabilities?.can_download
              ? el('a', {
                  className: 'action-button action-button-ghost',
                  text: 'Download',
                  attrs: { href: card.artifact.links.download, rel: 'noreferrer' },
                })
              : null,
          ].filter(Boolean)
        : []),
      ...(state.data.activeJob.summary
        ? [
            createButton({
                label: '패키지 열기',
                action: 'open-artifacts',
                tone: 'ghost',
              }),
          ]
        : []),
      ...(state.data.activeJob.summary && sourceConfigReentry.canOpenInModel
        ? [
            createButton({
              label: '모델에서 다시 열기',
              action: 'open-config-artifact-in-model',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: sourceConfigArtifact.id,
              },
            }),
            createButton({
              label: '추적 보고 실행',
              action: 'run-artifact-report',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: sourceConfigArtifact.id,
              },
            }),
          ]
        : [])
    );

    detailRawElement.hidden = !card.raw;
    detailRawElement.textContent = card.raw || '';
    detailProvenanceElement.replaceChildren(
      ...(card.provenance || []).map((note) =>
        el('div', {
          className: 'support-note',
          text: note,
        })
      )
    );
    syncTabs();
  }

  function syncAll() {
    if (destroyed) return;
    syncJobSummary();
    recentJobsElement.replaceChildren(renderRecentJobs(state.data.recentJobs.items || []));
    activityElement.replaceChildren(renderReviewActivity(state.data.recentJobs.items || []));
    syncStatus();
    syncCards();
    syncDetail();
    applyTranslations(root);
  }

  async function loadReviewState() {
    const activeJob = state.data.activeJob;
    if (!activeJob?.summary) {
      review.status = 'idle';
      review.cards = [];
      review.selectedCardId = '';
      syncAll();
      return;
    }

    const cacheKey = `${activeJob.summary.id}:${activeJob.summary.updated_at || ''}`;
    if (activeJob.status === 'loading') {
      review.status = 'loading';
      review.jobId = cacheKey;
      review.cards = [];
      review.selectedCardId = '';
      review.errorMessage = '';
      syncAll();
      return;
    }

    if (review.cache[cacheKey]) {
      review.status = 'ready';
      review.jobId = cacheKey;
      review.cards = review.cache[cacheKey];
      review.selectedCardId = review.selectedCardId || review.cards.find((card) => !card.empty)?.id || review.cards[0]?.id || '';
      syncAll();
      return;
    }

    review.status = 'loading';
    review.errorMessage = '';
    syncAll();

    try {
      const artifacts = activeJob.artifacts || [];
      const findBy = (matcher, preferredExtension = '') => artifacts.find((artifact) => {
        const search = `${artifact.type || ''} ${artifact.file_name || ''}`.toLowerCase();
        return search.includes(matcher) && (!preferredExtension || artifact.extension === preferredExtension);
      }) || null;
      const sourceArtifacts = {
        readiness: findBy('review.readiness', '.json') || findBy('readiness', '.json'),
        productReview: findBy('review.product', '.json') || findBy('product_review', '.json'),
        qualityRisk: findBy('review.quality-risk', '.json') || findBy('quality_risk', '.json'),
        investmentReview: findBy('review.investment-review', '.json') || findBy('investment_review', '.json'),
        standardDocs: findBy('standard-docs.summary', '.json') || findBy('standard_docs_manifest', '.json'),
        reviewPack: findBy('review-pack', '.json') || findBy('review_pack', '.json'),
      };

      const sourceEntries = Object.entries(sourceArtifacts).filter(([, artifact]) => artifact);
      const rawPayloads = await Promise.all(sourceEntries.map(async ([key, artifact]) => {
        try {
          const raw = await fetchArtifactText(artifact);
          return [key, raw, raw ? parseArtifactPayload(artifact, raw) : null];
        } catch {
          return [key, null, null];
        }
      }));

      const sourceMap = {};
      for (const [key, raw, parsed] of rawPayloads) {
        sourceMap[`${key}Raw`] = raw;
        sourceMap[key] = parsed;
      }
      sourceMap.readinessMarkdownRaw = sourceMap.readiness?.markdown || null;

      review.cards = buildReviewCards({
        activeJob,
        artifacts,
        sourceMap,
      });
      review.cache[cacheKey] = review.cards;
      review.jobId = cacheKey;
      review.status = 'ready';
      review.selectedCardId = review.cards.find((card) => !card.empty)?.id || review.cards[0]?.id || '';
      addLog({
        status: 'Review',
        message: `Prepared ${reviewCoverage(review.cards)} populated review lanes for ${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}.`,
        tone: reviewCoverage(review.cards) > 0 ? 'ok' : 'warn',
        time: 'review',
      });
    } catch (error) {
      review.status = 'error';
      review.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      syncAll();
    }
  }

  function handleClick(event) {
    const actionTarget = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!actionTarget) return;

    if (actionTarget.dataset.action === 'review-select-card') {
      review.selectedCardId = actionTarget.dataset.cardId || '';
      review.activeTab = 'summary';
      syncDetail();
      return;
    }

    if (actionTarget.dataset.action === 'review-set-tab') {
      review.activeTab = actionTarget.dataset.tab || 'summary';
      syncTabs();
      return;
    }

    if (actionTarget.dataset.action === 'review-open-job' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'review' });
    }
  }

  root.addEventListener('click', handleClick);
  loadReviewState();

  return {
    syncFromShell() {
      loadReviewState();
    },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', handleClick);
    },
  };
}
