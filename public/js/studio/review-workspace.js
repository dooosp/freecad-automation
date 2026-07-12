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
  findPreferredInspectionEvidenceIntakeArtifact,
} from './artifact-actions.js';
import { fetchStudioJobArtifacts } from './jobs-client.js';
import {
  deriveRecentJobDecisionState,
  formatRecentJobQualityLine,
} from './recent-job-quality-status.js';
import { renderEvidenceGraphSummary } from './evidence-graph-panel.js';
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
      title: 'No tracked jobs yet',
      copy: 'Tracked jobs launched with `fcad serve` will appear here for the review path.',
    });
  }

  return el('div', {
    className: 'review-job-table',
    children: recentJobs.slice(0, 5).map((job, index) => {
      const status = deriveRecentJobDecisionState(job);
      return el('article', {
        className: 'review-job-row',
        children: [
          el('div', {
            className: 'review-job-source',
            children: [
              el('p', { className: 'job-title', text: formatRecentJobQualityLine(job, shortJobId(job.id)) }),
              el('p', { className: 'job-copy', text: index === 0 ? 'Latest tracked source' : 'Tracked source' }),
            ],
          }),
          el('p', { className: 'review-job-time', text: formatDateTime(job.updated_at) }),
          el('span', { className: `pill pill-status-${status.tone}`, text: status.label }),
          createButton({
            label: 'Open',
            action: 'review-open-job',
            tone: 'ghost',
            dataset: { jobId: job.id },
          }),
        ],
      });
    }),
  });
}

function renderReviewActivity(recentJobs = []) {
  if (recentJobs.length === 0) {
    return createEmptyState({
      icon: '~',
      title: 'No recent source changes',
      copy: 'This feed summarizes the latest review prep activity when you open tracked jobs.',
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
                text: `${index === 0 ? 'Latest' : 'Recent'} ${job.type} ${shortJobId(job.id)}`,
              }),
              el('p', {
                className: 'activity-meta',
                text: `${formatRecentJobQualityLine(job, shortJobId(job.id))} • ${formatDateTime(job.updated_at)}`,
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function findLatestInspectionIntakeJob(recentJobs = []) {
  return recentJobs.find((job) => String(job?.type || '').toLowerCase() === 'inspection-evidence-intake') || null;
}

function findLatestStage5bAuditJob(recentJobs = []) {
  return recentJobs.find((job) => String(job?.type || '').toLowerCase() === 'stage5b-evidence-audit') || null;
}

function findLatestEvidenceReadinessAuditJob(recentJobs = []) {
  return recentJobs.find((job) => String(job?.type || '').toLowerCase() === 'evidence-readiness-audit') || null;
}

function renderInspectionIntakeLauncher(recentJobs = []) {
  const latestEvidenceReadinessAudit = findLatestEvidenceReadinessAuditJob(recentJobs);
  const latestAudit = findLatestStage5bAuditJob(recentJobs);
  const latestIntake = findLatestInspectionIntakeJob(recentJobs);
  return el('div', {
    className: 'inspection-intake-launcher',
    children: [
      el('p', {
        className: 'inline-note',
        text: 'Maintainer audit summarizes canonical package readiness, trusted-vs-generated evidence counts, runtime context, release overclaim risk, and exact safe next commands.',
      }),
      el('p', {
        className: 'inline-note',
        text: 'Run the Stage 5B audit bundle without human-entered measurements. It summarizes intake, promotion dry-run blockers, readiness-held truth, and the evidence boundary without creating inspection evidence.',
      }),
      el('div', {
        className: 'review-card-actions',
        children: [
          createButton({
            label: 'Run maintainer audit',
            action: 'run-evidence-readiness-audit',
            tone: 'primary',
          }),
          createButton({
            label: latestEvidenceReadinessAudit ? 'Open latest maintainer audit' : 'No maintainer audit yet',
            action: 'open-latest-evidence-readiness-audit',
            tone: 'ghost',
            disabled: !latestEvidenceReadinessAudit,
            dataset: latestEvidenceReadinessAudit ? { jobId: latestEvidenceReadinessAudit.id } : {},
          }),
          createButton({
            label: 'Run audit',
            action: 'run-stage5b-audit',
            tone: 'ghost',
          }),
          createButton({
            label: latestAudit ? 'Open latest audit' : 'No audit bundle yet',
            action: 'open-latest-stage5b-audit',
            tone: 'ghost',
            disabled: !latestAudit,
            dataset: latestAudit ? { jobId: latestAudit.id } : {},
          }),
          createButton({
            label: 'Run intake',
            action: 'run-stage5b-intake',
            tone: 'ghost',
          }),
          createButton({
            label: latestIntake ? 'Open latest intake' : 'No intake report yet',
            action: 'open-latest-stage5b-intake',
            tone: 'ghost',
            disabled: !latestIntake,
            dataset: latestIntake ? { jobId: latestIntake.id } : {},
          }),
          createButton({
            label: 'Run dry-run',
            action: 'run-stage5b-dry-run-latest',
            tone: 'ghost',
            disabled: !latestIntake,
            dataset: latestIntake ? { jobId: latestIntake.id } : {},
          }),
        ],
      }),
    ],
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
            text: card.score !== null && card.score !== undefined ? `${card.score}` : 'Status',
          }),
        ],
      }),
      el('p', { className: 'card-copy', text: card.summary }),
      el('div', {
        className: 'review-card-actions',
        children: [
          createButton({
            label: card.empty ? 'View empty state' : 'View details',
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
      title: `${card.title} section is empty`,
      copy: card.summary,
    });
  }

  if (card.graphSummary) {
    return renderEvidenceGraphSummary(card.graphSummary);
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
        kicker: 'Review workspace',
        title: activeJob?.summary
          ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)} review dashboard`
          : 'Review dashboard for signals, readiness, and manufacturing gates',
        description: 'Choose a tracked source, scan the quality board, then inspect only the evidence areas that need deeper review.',
        badges: [
          { label: activeJob?.summary ? 'Tracked source selected' : 'No tracked source', tone: activeJob?.summary ? 'ok' : 'warn' },
          { label: `${recentJobs.length || 0} recent sources`, tone: recentJobs.length ? 'info' : 'warn' },
          { label: 'DFM · quality · readiness · standard docs', tone: 'info' },
        ],
      }),
      el('div', {
        className: 'review-dashboard-grid',
        children: [
          el('div', {
            className: 'review-column review-column-left',
            children: [
      createCard({
                kicker: 'Maintainer audit · Stage 5B intake',
                title: 'Evidence and readiness decision review',
                copy: 'Run the maintainer audit or bundled Stage 5B audit locally, then inspect tracked artifacts in Review. No human-entered measurements are requested.',
                body: [
                  el('div', {
                    dataset: { hook: 'review-intake-launcher' },
                    children: [renderInspectionIntakeLauncher(recentJobs)],
                  }),
                ],
              }),
              createCard({
                kicker: 'Source selection',
                title: 'Choose a tracked job',
                copy: activeJob?.summary
                  ? 'The review board reads from the selected tracked job and its manifest-backed artifact set.'
                  : 'Open a tracked job to populate DFM, quality, readiness, and standard-doc cards.',
                body: [
                  el('div', { dataset: { hook: 'review-job-summary' } }),
                  el('div', { dataset: { hook: 'review-recent-jobs' } }),
                ],
              }),
              createCard({
                kicker: 'Recent source changes',
                title: 'Activity feed',
                copy: 'Keep recent tracked review activity visible without leaving the dashboard.',
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
                kicker: 'Review board',
                title: 'Review signal board',
                copy: 'Cards stay compact and status-first so changed, ready, and next-review areas surface first.',
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
                kicker: 'Detail inspector',
                title: 'Normalized summary, source output, generation history',
                copy: 'Inspect the selected signal as a structured summary first, then switch to source output or generation history only when needed.',
                surface: 'canvas',
                body: [
                  el('div', {
                    className: 'inspector-tabs',
                    children: [
                      createButton({
                        label: 'Summary',
                        action: 'review-set-tab',
                        tone: 'ghost',
                        dataset: { tab: 'summary', hook: 'review-tab-summary' },
                      }),
                      createButton({
                        label: 'Source output',
                        action: 'review-set-tab',
                        tone: 'ghost',
                        dataset: { tab: 'raw', hook: 'review-tab-raw' },
                      }),
                      createButton({
                        label: 'Generation history',
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

export function mountReviewWorkspace({ root, state, addLog, openJob, submitTrackedJob }) {
  const review = ensureReviewState(state.data.review);
  const intakeLauncherElement = root.querySelector('[data-hook="review-intake-launcher"]');
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
          title: 'No tracked job selected',
          copy: 'Start from Console or Artifacts by opening a tracked job. Review will then use that job manifest and artifact list.',
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
          copy: 'Preparing readiness and review artifacts from the selected job for Studio.',
        })
      );
      return;
    }

    if (review.status === 'error') {
      statusElement.replaceChildren(
        createEmptyState({
          icon: '!',
          title: 'Review signals unavailable',
          copy: review.errorMessage || 'The selected job exists, but Studio could not interpret its review artifacts.',
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
          title: 'Select a card',
          copy: 'The detail panel shows normalized data, source text, and generation history for the selected review signal.',
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
            card.id === 'inspection-intake'
              ? createButton({
                  label: 'Run dry-run',
                  action: 'run-stage5b-dry-run-from-artifact',
                  tone: 'ghost',
                  dataset: {
                    jobId: state.data.activeJob.summary?.id || '',
                    artifactId: card.artifact.id,
                  },
                })
              : null,
          ].filter(Boolean)
        : []),
      ...(state.data.activeJob.summary
        ? [
            createButton({
                label: 'Open package',
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
    syncTabs();
  }

  function syncAll() {
    if (destroyed) return;
    intakeLauncherElement?.replaceChildren(renderInspectionIntakeLauncher(state.data.recentJobs.items || []));
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
        inspectionIntake: findBy('inspection-evidence.intake-report', '.json')
          || findBy('inspection-evidence-intake-report', '.json')
          || findBy('intake-report', '.json'),
        inspectionPromotionDryRun: findBy('inspection-evidence.promotion-dry-run-manifest', '.json')
          || findBy('inspection-evidence-promotion-dry-run-manifest', '.json')
          || findBy('promotion_dry_run_manifest', '.json'),
        stage5bAudit: findBy('stage5b.evidence-audit-manifest', '.json')
          || findBy('stage5b-evidence-audit', '.json')
          || findBy('stage5b_audit_manifest', '.json'),
        evidenceReadinessAudit: findBy('evidence-readiness.audit-json', '.json')
          || findBy('evidence-readiness-audit', '.json')
          || findBy('evidence_readiness_audit', '.json'),
        stage5bValidationDiagnostics: findBy('stage5b.validation-diagnostics', '.json')
          || findBy('validation_diagnostics', '.json'),
        evidenceGraph: findBy('evidence-graph', '.json')
          || findBy('evidence_graph', '.json'),
        revisionImpact: findBy('revision-impact.report-json', '.json')
          || findBy('revision_impact_report', '.json'),
        inspectionPlan: findBy('inspection-plan.json', '.json')
          || findBy('inspection_plan.json', '.json'),
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

  async function handleClick(event) {
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
      return;
    }

    if (actionTarget.dataset.action === 'open-latest-stage5b-intake' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'review' });
      return;
    }

    if (actionTarget.dataset.action === 'open-latest-stage5b-audit' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'review' });
      return;
    }

    if (actionTarget.dataset.action === 'open-latest-evidence-readiness-audit' && actionTarget.dataset.jobId) {
      openJob(actionTarget.dataset.jobId, { route: 'review' });
      return;
    }

    if (actionTarget.dataset.action === 'run-evidence-readiness-audit') {
      if (typeof submitTrackedJob !== 'function') {
        addLog({
          status: 'Maintainer audit',
          message: 'Tracked maintainer audit submission is unavailable on this serve path.',
          tone: 'warn',
          time: 'review',
        });
        return;
      }
      submitTrackedJob({
        type: 'evidence-readiness-audit',
        options: {},
        completionAction: {
          preferredRoute: 'review',
        },
      }).then((job) => {
        addLog({
          status: 'Maintainer audit',
          message: `Queued tracked evidence-readiness-audit ${shortJobId(job?.id || '')}.`,
          tone: 'info',
          time: 'review',
        });
      }).catch((error) => {
        addLog({
          status: 'Maintainer audit',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
          time: 'review',
        });
      });
      return;
    }

    if (actionTarget.dataset.action === 'run-stage5b-audit') {
      if (typeof submitTrackedJob !== 'function') {
        addLog({
          status: 'Stage 5B audit',
          message: 'Tracked audit submission is unavailable on this serve path.',
          tone: 'warn',
          time: 'review',
        });
        return;
      }
      submitTrackedJob({
        type: 'stage5b-evidence-audit',
        options: {
          include_github: false,
        },
        completionAction: {
          preferredRoute: 'review',
        },
      }).then((job) => {
        addLog({
          status: 'Stage 5B audit',
          message: `Queued tracked stage5b-evidence-audit ${shortJobId(job?.id || '')}.`,
          tone: 'info',
          time: 'review',
        });
      }).catch((error) => {
        addLog({
          status: 'Stage 5B audit',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
          time: 'review',
        });
      });
      return;
    }

    if (actionTarget.dataset.action === 'run-stage5b-intake') {
      if (typeof submitTrackedJob !== 'function') {
        addLog({
          status: 'Stage 5B intake',
          message: 'Tracked intake submission is unavailable on this serve path.',
          tone: 'warn',
          time: 'review',
        });
        return;
      }
      submitTrackedJob({
        type: 'inspection-evidence-intake',
        options: {
          include_github: false,
        },
        completionAction: {
          preferredRoute: 'review',
        },
      }).then((job) => {
        addLog({
          status: 'Stage 5B intake',
          message: `Queued tracked inspection-evidence-intake ${shortJobId(job?.id || '')}.`,
          tone: 'info',
          time: 'review',
        });
      }).catch((error) => {
        addLog({
          status: 'Stage 5B intake',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
          time: 'review',
        });
      });
    }

    if (
      (actionTarget.dataset.action === 'run-stage5b-dry-run-latest'
        || actionTarget.dataset.action === 'run-stage5b-dry-run-from-artifact')
      && actionTarget.dataset.jobId
    ) {
      if (typeof submitTrackedJob !== 'function') {
        addLog({
          status: 'Stage 5B dry-run',
          message: 'Tracked promotion dry-run submission is unavailable on this serve path.',
          tone: 'warn',
          time: 'review',
        });
        return;
      }

      const sourceJobId = actionTarget.dataset.jobId;
      const explicitArtifactId = actionTarget.dataset.artifactId || '';
      const activeArtifacts = state.data.activeJob.summary?.id === sourceJobId
        ? state.data.activeJob.artifacts || []
        : [];
      const intakeArtifact = explicitArtifactId
        ? activeArtifacts.find((artifact) => artifact.id === explicitArtifactId)
        : findPreferredInspectionEvidenceIntakeArtifact(activeArtifacts);

      try {
        const artifact = intakeArtifact || findPreferredInspectionEvidenceIntakeArtifact(
          await fetchStudioJobArtifacts(sourceJobId)
        );
        if (!artifact) {
          throw new Error('No registered inspection-evidence intake report artifact is available for the selected job.');
        }
        const job = await submitTrackedJob({
          type: 'inspection-evidence-promotion-dry-run',
          artifactRef: {
            job_id: sourceJobId,
            artifact_id: artifact.id,
          },
          completionAction: {
            preferredRoute: 'review',
          },
        });
        addLog({
          status: 'Stage 5B dry-run',
          message: `Queued tracked inspection-evidence-promotion-dry-run ${shortJobId(job?.id || '')}.`,
          tone: 'info',
          time: 'review',
        });
      } catch (error) {
        addLog({
          status: 'Stage 5B dry-run',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
          time: 'review',
        });
      }
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
