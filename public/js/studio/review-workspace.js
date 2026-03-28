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

function ensureReviewState(review = {}) {
  review.status = review.status || 'idle';
  review.jobId = review.jobId || '';
  review.cards = Array.isArray(review.cards) ? review.cards : [];
  review.selectedCardId = review.selectedCardId || '';
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
      title: 'No tracked jobs yet',
      copy: 'Run work through `fcad serve` and tracked jobs will show up here for review routing.',
    });
  }

  return el('div', {
    className: 'job-list job-list-compact',
    children: recentJobs.slice(0, 5).map((job, index) =>
      el('article', {
        className: 'job-item',
        children: [
          el('div', {
            children: [
              el('div', {
                className: 'job-title-row',
                children: [
                  el('p', { className: 'job-title', text: `${job.type} ${shortJobId(job.id)}` }),
                  el('span', { className: 'pill', text: index === 0 ? 'Latest' : 'Recent' }),
                ],
              }),
              el('p', {
                className: 'job-copy',
                text: `${formatJobStatus(job.status)} • ${formatDateTime(job.updated_at)}`,
              }),
            ],
          }),
          createButton({
            label: 'Open',
            action: 'review-open-job',
            tone: 'ghost',
            dataset: { jobId: job.id },
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
            text: card.score !== null && card.score !== undefined ? `${card.score}` : 'status',
          }),
        ],
      }),
      el('p', { className: 'card-copy', text: card.summary }),
      el('div', {
        className: 'review-card-actions',
        children: [
          createButton({
            label: card.empty ? 'Show gap' : 'Open detail',
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
      title: `${card.title} is missing`,
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
    className: 'workspace-shell',
    children: [
      createSectionHeader({
        kicker: 'Review workspace',
        title: activeJob?.summary
          ? `Decision console for ${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}`
          : 'Decision console for review, readiness, and launch signals',
        description: 'Review is status-first: load a tracked job, scan normalized manufacturing signals, then open the raw evidence only when you need it.',
        badges: [
          { label: activeJob?.summary ? 'Tracked job selected' : 'No job selected', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `${recentJobs.length || 0} recent jobs`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: 'Raw evidence available when present', tone: 'info' },
        ],
      }),
      el('div', {
        className: 'review-layout',
        children: [
          el('div', {
            className: 'pane-stack',
            children: [
              createCard({
                kicker: 'Active review source',
                title: activeJobTitle(activeJob),
                copy: activeJob?.summary
                  ? 'The Review workspace reads from the selected tracked job and its artifact manifest.'
                  : 'Open a tracked job to populate DFM, quality, readiness, and document-status cards.',
                body: [
                  el('div', { dataset: { hook: 'review-job-summary' } }),
                ],
              }),
              createCard({
                kicker: 'Recent jobs',
                title: 'Switch review source',
                copy: 'Use recent tracked jobs as the source of truth instead of pulling directly from filesystem paths.',
                body: [
                  el('div', { dataset: { hook: 'review-recent-jobs' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'pane-stack',
            children: [
              createCard({
                kicker: 'Review board',
                title: 'Normalized manufacturing and readiness signals',
                copy: 'Cards stay color-led and compact so the workspace answers go, hold, and what changed first.',
                surface: 'canvas',
                body: [
                  el('div', { dataset: { hook: 'review-status' } }),
                  el('div', { className: 'review-card-grid', dataset: { hook: 'review-cards' } }),
                ],
              }),
              createCard({
                kicker: 'Detail panel',
                title: 'Normalized summary, raw output, and provenance',
                copy: 'Select a review card to inspect the structured summary, attached raw JSON or Markdown, and manifest notes.',
                surface: 'canvas',
                body: [
                  el('div', { dataset: { hook: 'review-detail-summary' } }),
                  el('div', { className: 'review-detail-actions', dataset: { hook: 'review-detail-actions' } }),
                  el('pre', { className: 'artifact-raw-preview', dataset: { hook: 'review-detail-raw' } }),
                  el('div', { className: 'review-provenance-list', dataset: { hook: 'review-detail-provenance' } }),
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
  const detailSummaryElement = root.querySelector('[data-hook="review-detail-summary"]');
  const detailActionsElement = root.querySelector('[data-hook="review-detail-actions"]');
  const detailRawElement = root.querySelector('[data-hook="review-detail-raw"]');
  const detailProvenanceElement = root.querySelector('[data-hook="review-detail-provenance"]');
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
          title: 'No tracked job selected',
          copy: 'Start or Artifacts can open a tracked job first. Review then uses that job manifest and artifact list.',
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
        { label: 'Warnings', value: String((activeJob.manifest?.warnings || []).length) },
        { label: 'Artifacts', value: String((activeJob.artifacts || []).length) },
      ])
    );
  }

  function syncStatus() {
    if (review.status === 'loading') {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '...',
          title: 'Loading review signals',
          copy: 'The studio is normalizing available readiness and review artifacts for the selected job.',
        })
      );
      return;
    }

    if (review.status === 'error') {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: 'Review signals could not be prepared',
          copy: review.errorMessage || 'The selected job exists, but its review artifacts could not be parsed in the studio.',
        })
      );
      return;
    }

    const activeJob = state.data.activeJob;
    if (!activeJob?.summary) {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '[]',
          title: 'Review needs a tracked job',
          copy: 'Open a recent job to populate DFM, quality, readiness, and standard-doc cards.',
        })
      );
      return;
    }

    const coverage = reviewCoverage(review.cards);
    statusElement.replaceChildren(
      createInfoGrid([
        { label: 'Selected job', value: `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` },
        { label: 'Review cards with data', value: `${coverage}/${review.cards.length || 6}` },
        { label: 'Manifest warnings', value: String((activeJob.manifest?.warnings || []).length) },
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

  function syncDetail() {
    const card = getSelectedCard();
    const sourceConfigArtifact = findPreferredConfigArtifact(state.data.activeJob.artifacts || []);
    const sourceConfigReentry = deriveArtifactReentryCapabilities(sourceConfigArtifact || {});
    if (!card) {
      detailSummaryElement.replaceChildren(
        createEmptyState({
          icon: '>',
          title: 'Select a card',
          copy: 'The detail panel will show normalized facts, raw text, and provenance for the selected review signal.',
        })
      );
      detailActionsElement.replaceChildren();
      detailRawElement.textContent = '';
      detailRawElement.hidden = true;
      detailProvenanceElement.replaceChildren();
      return;
    }

    detailSummaryElement.replaceChildren(renderDetailSummary(card));
    detailActionsElement.replaceChildren(
      ...(card.artifact
        ? [
            card.artifact.capabilities?.can_open
              ? el('a', {
                  className: 'action-button action-button-primary',
                  text: 'Open source artifact',
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
              label: 'Open Artifacts',
              action: 'open-artifacts',
              tone: 'ghost',
            }),
          ]
        : []),
      ...(state.data.activeJob.summary && sourceConfigReentry.canOpenInModel
        ? [
            createButton({
              label: 'Re-open in Model',
              action: 'open-config-artifact-in-model',
              tone: 'ghost',
              dataset: {
                jobId: state.data.activeJob.summary.id,
                artifactId: sourceConfigArtifact.id,
              },
            }),
            createButton({
              label: 'Run tracked report',
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
  }

  function syncAll() {
    if (destroyed) return;
    syncJobSummary();
    recentJobsElement.replaceChildren(renderRecentJobs(state.data.recentJobs.items || []));
    syncStatus();
    syncCards();
    syncDetail();
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
      syncDetail();
      return;
    }

    if (actionTarget.dataset.action === 'review-open-job' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'review' });
    }
  }

  root.addEventListener('click', handleClick);
  loadReviewState();

  return {
    destroy() {
      destroyed = true;
      root.removeEventListener('click', handleClick);
    },
  };
}
