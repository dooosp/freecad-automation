import {
  createArtifactList,
  createButton,
  createCard,
  createDisclosure,
  createEmptyState,
  createFlowRail,
  createInfoGrid,
  createList,
  createMetricGrid,
  createEmptyStateWithNextAction,
  createInlineStatus,
  createPrimaryAction,
  createSecondaryAction,
  createSectionHeader,
  createSplitPane,
  createStatusStrip,
  createActionGrid,
  createActionSummary,
  createResultCard,
  createTaskStepper,
  el,
} from './renderers.js';
import { getLocale, t } from '../i18n/index.js';
import { ensureModelTrackedRunState } from './model-tracked-runs.js';
import {
  createModelGuidedStepStates,
  ensureModelGuidedFlowState,
  resolveModelGuidedStep,
} from './model-guided-flow.js';
import { ensureAiDraftState } from './ai-guided-flow.js';
import {
  createImportGuidedStepStates,
  ensureImportGuidedFlowState,
  resolveImportGuidedError,
  resolveImportGuidedStep,
} from './import-guided-flow.js';
import {
  buildCanonicalPackageSectionModel,
} from './canonical-packages.js';
import {
  findStudioExampleById,
  getStudioExampleValue,
  VERIFIED_BRACKET_EXAMPLE_ID,
} from './examples.js';
import {
  deriveRecentJobQualityStatus,
  formatRecentJobQualityLine,
} from './recent-job-quality-status.js';
import {
  STUDIO_SURFACE_ROUTES,
  getStudioSurfaceMetadata,
} from './studio-surfaces.js';
import { renderReviewWorkspace } from './review-workspace.js';
import { renderArtifactsWorkspace } from './artifacts-workspace.js';
import { deriveLocalFirstWorkflowGuidance } from './local-first-workflows.js';
import { deriveJobsCenterActionEligibility } from './jobs-center.js';

function workspaceShell({ kicker, title, description, badges, controls, canvas }) {
  return el('section', {
    className: 'workspace-shell',
    children: [
      createSectionHeader({ kicker, title, description, badges }),
      createSplitPane({ controls, canvas }),
    ],
  });
}

function createCanvasCard({ kicker, title, copy, emptyState }) {
  return createCard({
    kicker,
    title,
    copy,
    surface: 'canvas',
    body: [
      el('div', {
        className: 'canvas-stage',
        children: [emptyState],
      }),
    ],
  });
}

function connectionTone(connectionState) {
  if (connectionState === 'connected') return 'ok';
  if (connectionState === 'legacy') return 'warn';
  if (connectionState === 'degraded') return 'warn';
  return 'info';
}

function formatDateTime(value) {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(value) {
  if (!value) return formatDateTime(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);
  const differenceMs = date.getTime() - Date.now();
  const absoluteMs = Math.abs(differenceMs);
  const units = absoluteMs < 60_000
    ? ['second', 1_000]
    : absoluteMs < 3_600_000
      ? ['minute', 60_000]
      : absoluteMs < 86_400_000
        ? ['hour', 3_600_000]
        : ['day', 86_400_000];
  return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(
    Math.round(differenceMs / units[1]),
    units[0]
  );
}

function formatJobStatus(status) {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortJobId(id = '') {
  if (!id) return 'Unknown job';
  return id.length > 8 ? id.slice(0, 8) : id;
}

function recentJobPillLabel(job = {}) {
  const status = deriveRecentJobQualityStatus(job);
  return status.hasQualityDecision ? status.qualityStatus : status.jobExecutionStatus;
}

function exampleCountLabel(examplesState) {
  if (examplesState.status === 'ready') return `${examplesState.items.length} examples ready`;
  if (examplesState.status === 'empty') return 'No examples found';
  if (examplesState.status === 'unavailable') return 'Examples unavailable';
  return 'Loading examples';
}

function recentJobActionLabel(recentJobsState) {
  if (recentJobsState.status !== 'ready' || recentJobsState.items.length === 0) return 'No recent job';
  const [job] = recentJobsState.items;
  return `Open ${job.type} ${shortJobId(job.id)}`;
}

function ensureImportBootstrapState(state) {
  const importBootstrap = state.data.importBootstrap || {};
  const defaults = {
    status: 'idle',
    modelPath: '',
    modelFile: null,
    modelFileName: '',
    bomPath: '',
    inspectionPath: '',
    qualityPath: '',
    preview: null,
    errorMessage: '',
    submitting: false,
    lastJobId: '',
    reviewJob: null,
    corrections: {},
  };
  Object.entries(defaults).forEach(([key, value]) => {
    if (importBootstrap[key] === undefined) importBootstrap[key] = value;
  });
  ensureImportGuidedFlowState(importBootstrap);
  state.data.importBootstrap = importBootstrap;
  return importBootstrap;
}

function formatConfidenceBadge(score) {
  if (!Number.isFinite(score)) return 'Confidence pending';
  return `Confidence ${Math.round(score * 100)}%`;
}

function formatDimension(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  return `${number.toFixed(2)} mm`;
}

function createImportBootstrapCard(state) {
  const importBootstrap = ensureImportBootstrapState(state);
  const preview = importBootstrap.preview;
  const bootstrap = preview?.bootstrap || {};
  const summary = bootstrap.bootstrap_summary || {};
  const diagnostics = bootstrap.import_diagnostics || {};
  const warnings = bootstrap.bootstrap_warnings?.warnings || [];
  const confidence = bootstrap.confidence_map?.import_bootstrap?.overall || diagnostics.confidence || null;
  const featureSummary = summary.feature_summary || {};
  const source = preview?.source || {};
  const corrections = importBootstrap.corrections || {};
  const guidedError = resolveImportGuidedError(importBootstrap, t);

  if (importBootstrap.status === 'loading') {
    return createCard({
      kicker: 'Imported CAD bootstrap',
      title: 'Preparing the review gate',
      copy: 'Studio is generating machine-readable diagnostics, draft bootstrap artifacts, warnings, and confidence before anything reaches tracked review.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '...',
          title: 'Building bootstrap preview',
          copy: 'This lane keeps imported STEP and FCStd honest: it records assumptions, preserves warnings, and stops before pretending design intent is known.',
        }),
      ],
    });
  }

  if (importBootstrap.status === 'error') {
    return createCard({
      kicker: 'Imported CAD bootstrap',
      title: 'Bootstrap preview needs correction',
      copy: 'Unsupported, empty, or unstable imports fail closed here so Studio does not queue misleading downstream review work.',
      surface: 'canvas',
      body: [
        el('p', {
          className: 'support-note support-note-warn',
          text: guidedError || importBootstrap.errorMessage || 'Bootstrap preview failed.',
        }),
      ],
    });
  }

  if (!preview) {
    return createCard({
      kicker: 'Imported CAD bootstrap',
      title: 'Bring existing STEP or FCStd into review',
      copy: 'Use the Start workspace to preview imported CAD through diagnostics, warnings, confidence, and a human correction gate before Studio queues tracked review-context work.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: 'G',
          title: 'Bootstrap lane is ready',
          copy: 'Expected artifacts include import diagnostics, bootstrap summary, draft config, engineering context, geometry intelligence, warnings, and a confidence map.',
        }),
      ],
    });
  }

  return createCard({
    kicker: 'Imported CAD bootstrap',
    title: 'Bootstrap review gate',
    copy: 'Review the intake evidence first, then hand the corrected import state into the canonical review-pack and readiness flow.',
    badges: [
      {
        label: summary.review_gate?.status === 'blocked' ? 'Review blocked' : 'Review gate ready',
        tone: summary.review_gate?.status === 'blocked' ? 'warn' : 'ok',
      },
      {
        label: formatConfidenceBadge(confidence?.score),
        tone: confidence?.level === 'high' ? 'ok' : confidence?.level === 'medium' ? 'info' : 'warn',
      },
    ],
    surface: 'canvas',
    body: [
      createInfoGrid([
        { label: 'Imported model', value: source.model_path || diagnostics.source_model_path || importBootstrap.modelPath || importBootstrap.modelFileName || 'Unavailable' },
        { label: 'File type', value: diagnostics.file_type || source.model_path?.split('.').pop()?.toUpperCase() || 'Unknown' },
        { label: 'Part vs assembly', value: diagnostics.import_kind || 'Unknown' },
        { label: 'Body count', value: diagnostics.body_count ?? 'Unavailable' },
        { label: 'Units', value: diagnostics.unit_assumption?.unit || 'Unknown', note: diagnostics.unit_assumption?.rationale || '' },
        { label: 'Tracked handoff', value: preview.tracked_review_seed?.context_path || 'Unavailable' },
      ]),
      el('div', {
        className: 'action-controls',
        children: [
          el('p', {
            className: 'support-note',
            text: 'Confirm or correct imported assumptions before tracked review.',
          }),
          el('input', {
            className: 'studio-input',
            attrs: {
              type: 'text',
              placeholder: 'Corrected part or assembly classification',
              value: corrections.importKind || diagnostics.import_kind || '',
            },
            dataset: { field: 'import-correction-kind' },
          }),
          el('input', {
            className: 'studio-input',
            attrs: {
              type: 'text',
              placeholder: 'Confirmed unit system like mm or in',
              value: corrections.unit || diagnostics.unit_assumption?.unit || '',
            },
            dataset: { field: 'import-correction-unit' },
          }),
          el('input', {
            className: 'studio-input',
            attrs: {
              type: 'number',
              min: '0',
              step: '1',
              placeholder: 'Confirmed body count',
              value: corrections.bodyCount || `${diagnostics.body_count ?? ''}`,
            },
            dataset: { field: 'import-correction-body-count' },
          }),
          el('textarea', {
            className: 'studio-textarea studio-textarea-compact',
            text: corrections.note || '',
            attrs: {
              placeholder: 'Optional correction note for downstream review',
            },
            dataset: { field: 'import-correction-note' },
          }),
        ],
      }),
      createMetricGrid([
        { label: 'X size', value: formatDimension(summary.dimensions_mm?.x), copy: 'Bounding-box estimate only; not design intent.' },
        { label: 'Y size', value: formatDimension(summary.dimensions_mm?.y), copy: 'Use review corrections when import assumptions look off.' },
        { label: 'Z size', value: formatDimension(summary.dimensions_mm?.z), copy: 'Large differences should be confirmed before readiness work.' },
        { label: 'Cylinders', value: featureSummary.cylinder_count ?? 0, copy: 'Detected from geometry hints, not reconstructed history.' },
        { label: 'Bolt circles', value: featureSummary.bolt_circle_count ?? 0, copy: 'Pattern clues stay review-needed when certainty is limited.' },
        { label: 'Hotspots', value: featureSummary.hotspot_count ?? 0, copy: 'Manufacturing hotspots remain advisory evidence for review.' },
      ]),
      warnings.length > 0
        ? createList(warnings.map((warning) => ({
            label: warning,
            copy: 'Visible warning',
            meta: 'Review required',
          })))
        : createList([
            {
              label: 'No bootstrap warnings recorded',
              copy: 'Studio still requires a human review gate before the tracked review-context run begins.',
              meta: 'Review required',
            },
          ]),
      createArtifactList((preview.artifacts || []).map((artifact) => ({
        title: artifact.file_name || artifact.key,
        meta: artifact.key,
        path: artifact.path,
      }))),
    ],
  });
}

const REVIEW_CONSOLE_JOB_TYPES = Object.freeze({
  review: new Set(['review-context', 'report', 'inspect']),
  readiness: new Set(['readiness-pack', 'generate-standard-docs']),
  compare: new Set(['compare-rev', 'stabilization-review']),
  pack: new Set(['pack']),
});

function findLatestTrackedJob(recentJobsState, types = new Set()) {
  if (recentJobsState.status !== 'ready') return null;
  return recentJobsState.items.find((job) => types.has(String(job.type || '').toLowerCase())) || null;
}

function createRuntimeHealthCard(state) {
  const { health } = state.data;
  const runtimeAvailable = health.status === 'ready' && health.available;
  const pathValue = health.runtimePath || 'Unavailable on this serve path';
  const healthTone = runtimeAvailable ? 'ok' : (health.status === 'ready' ? 'warn' : 'info');
  const notes = [];

  if (health.status === 'unavailable' && health.fallbackMessage) {
    notes.push(
      el('p', {
        className: 'support-note',
        text: health.fallbackMessage,
      })
    );
  }

  if (health.warnings.length > 0) {
    notes.push(
      el('div', {
        className: 'note-stack',
        children: health.warnings.slice(0, 2).map((warning) =>
          el('p', {
            className: 'support-note',
            text: warning,
          })
        ),
      })
    );
  }

  if (health.errors.length > 0) {
    notes.push(
      el('div', {
        className: 'note-stack',
        children: health.errors.slice(0, 2).map((error) =>
          el('p', {
            className: 'support-note support-note-warn',
            text: error,
          })
        ),
      })
    );
  }

  return createCard({
    kicker: 'Runtime health',
    title: 'Runtime posture',
    copy: 'Check API reachability first, then verify the FreeCAD runtime details that back model and drawing work.',
    badges: [
      { label: runtimeAvailable ? 'Runtime detected' : 'Runtime unavailable', tone: healthTone },
      { label: health.reachable ? 'API reachable' : 'API unavailable', tone: health.reachable ? 'ok' : 'warn' },
    ],
    surface: 'canvas',
    body: [
      el('div', {
        className: 'card-toolbar',
        children: [
          el('p', {
            className: 'inline-note',
            text: health.runtimeSummary || 'Runtime details will appear here when /health is available.',
          }),
          createButton({
            label: 'Refresh status',
            action: 'refresh-health',
            tone: 'ghost',
          }),
        ],
      }),
      createInfoGrid([
        {
          label: 'API reachability',
          value: health.reachable ? 'Reachable' : 'Unavailable',
          note: health.reachable ? 'GET /health responded successfully.' : 'Falling back to shell-safe defaults.',
        },
        {
          label: 'Runtime',
          value: runtimeAvailable ? 'Detected' : 'Unavailable',
          note: health.status === 'ready' ? (health.runtimeSummary || 'Runtime payload received.') : 'No runtime diagnostics payload available.',
        },
        {
          label: 'Selected runtime path',
          value: pathValue,
        },
        {
          label: 'Python / FreeCAD',
          value: [health.pythonVersion, health.freecadVersion].filter(Boolean).join(' / ') || 'Version details unavailable',
        },
        {
          label: 'Project root',
          value: health.projectRoot || 'Unavailable on this serve path',
        },
        {
          label: 'Last check',
          value: formatDateTime(health.checkedAt),
        },
      ]),
      ...notes,
    ],
  });
}

function createExamplesSelect(state) {
  const { examples } = state.data;
  return el('select', {
    className: 'studio-select',
    dataset: { action: 'select-example' },
    attrs: {
      'aria-label': 'Select example',
      disabled: examples.status !== 'ready' || examples.items.length === 0,
    },
    children: examples.status === 'ready'
      ? examples.items.map((example) =>
          el('option', {
            text: example.name,
            attrs: {
              value: getStudioExampleValue(example),
              ...(getStudioExampleValue(example) === state.data.examples.selectedId
                ? { selected: true }
                : {}),
            },
          })
        )
      : [
          el('option', {
            text: examples.status === 'loading' ? 'Loading examples...' : 'Examples unavailable',
            attrs: { value: '' },
          }),
        ],
  });
}

function createVerifiedBracketMeta(examples = {}) {
  if (examples.status === 'loading') return 'Loading examples...';
  if (examples.status !== 'ready') return 'Verified bracket example loads when the checked-in examples source is available.';

  const verifiedExample = findStudioExampleById(examples.items, VERIFIED_BRACKET_EXAMPLE_ID);
  if (!verifiedExample) return 'quality_pass_bracket is not currently exposed by the examples endpoint.';
  return 'Recommended example: quality_pass_bracket';
}

function canLoadVerifiedBracket(examples = {}) {
  return examples.status === 'ready'
    && Boolean(findStudioExampleById(examples.items, VERIFIED_BRACKET_EXAMPLE_ID));
}

function isVerifiedBracketLoaded(model = {}) {
  return model.sourcePath === VERIFIED_BRACKET_EXAMPLE_ID
    || model.sourceName === `${VERIFIED_BRACKET_EXAMPLE_ID}.toml`;
}

function createHomeStartChoice({
  goal,
  title,
  copy,
  needed,
  result,
  freecad,
  action,
  actionLabel,
}) {
  return el('article', {
    className: 'home-start-card',
    dataset: { startGoal: goal },
    children: [
      el('div', {
        className: 'home-start-card-copy',
        children: [
          el('h3', { className: 'home-start-card-title', text: title }),
          el('p', { className: 'home-start-card-description', text: copy }),
        ],
      }),
      createInfoGrid([
        { label: t('studio.home.field.needed'), value: needed },
        { label: t('studio.home.field.result'), value: result },
        { label: t('studio.home.field.freecad'), value: freecad },
      ]),
      createPrimaryAction({ label: actionLabel, action }),
    ],
  });
}

function createHomeRuntimeStatus(state) {
  const health = state.data.health || {};
  if (health.status === 'ready' && health.available) {
    return createInlineStatus({
      title: t('studio.home.runtime.ready.title'),
      copy: t('studio.home.runtime.ready.copy'),
      tone: 'ok',
    });
  }
  if (health.status === 'ready' || health.status === 'unavailable') {
    return createInlineStatus({
      title: t('studio.home.runtime.unavailable.title'),
      copy: t('studio.home.runtime.unavailable.copy'),
      tone: 'warn',
      action: {
        label: t('studio.home.runtime.unavailable.action'),
        action: 'go-runtime-details',
      },
    });
  }
  return createInlineStatus({
    title: t('studio.home.runtime.checking.title'),
    copy: t('studio.home.runtime.checking.copy'),
    tone: 'info',
  });
}

function createHomeRecentRuns(state) {
  const recentJobs = state.data.recentJobs || {};
  const items = Array.isArray(recentJobs.items) ? recentJobs.items.slice(0, 3) : [];
  let body;
  if (recentJobs.status === 'loading') {
    body = createEmptyState({
      icon: '…',
      title: t('studio.home.recent.loading.title'),
      copy: t('studio.home.recent.loading.copy'),
    });
  } else if (recentJobs.status === 'unavailable') {
    body = createEmptyStateWithNextAction({
      icon: '!',
      title: t('studio.home.recent.unavailable.title'),
      copy: t('studio.home.recent.unavailable.copy'),
      action: {
        label: t('studio.home.recent.unavailable.action'),
        action: 'go-runtime-details',
      },
    });
  } else if (items.length === 0) {
    body = createEmptyState({
      icon: '↺',
      title: t('studio.home.recent.empty.title'),
      copy: t('studio.home.recent.empty.copy'),
    });
  } else {
    body = el('div', {
      className: 'home-recent-list',
      children: items.map((job) =>
        el('article', {
          className: 'home-recent-item',
          children: [
            el('div', {
              children: [
                el('p', { className: 'home-recent-title', text: userRunTitle(job) }),
                el('p', { className: 'home-recent-meta', text: `${userRunTypeLabel(job.type)} · ${formatRelativeTime(job.updated_at || job.created_at)}` }),
              ],
            }),
            createSecondaryAction({
              label: t('studio.home.recent.open'),
              action: 'open-job',
              dataset: { jobId: job.id, route: 'artifacts' },
            }),
          ],
        })
      ),
    });
  }

  return createCard({
    kicker: t('studio.home.recent.kicker'),
    title: t('studio.home.recent.title'),
    copy: t('studio.home.recent.copy'),
    body: [body],
  });
}

function createHomeWorkspace(state) {
  return el('section', {
    className: 'workspace-shell home-workspace',
    children: [
      createSectionHeader({
        kicker: t('studio.home.kicker'),
        title: t('studio.home.title'),
        description: t('studio.home.description'),
      }),
      createHomeRuntimeStatus(state),
      el('div', {
        className: 'home-start-grid',
        attrs: { 'aria-label': t('studio.home.choices.aria-label') },
        dataset: { hook: 'home-start-choices' },
        children: [
          createHomeStartChoice({
            goal: 'create-model',
            title: t('studio.home.create.title'),
            copy: t('studio.home.create.copy'),
            needed: t('studio.home.create.needed'),
            result: t('studio.home.create.result'),
            freecad: t('studio.home.create.freecad'),
            action: 'go-model',
            actionLabel: t('studio.home.create.action'),
          }),
          createHomeStartChoice({
            goal: 'review-cad',
            title: t('studio.home.review.title'),
            copy: t('studio.home.review.copy'),
            needed: t('studio.home.review.needed'),
            result: t('studio.home.review.result'),
            freecad: t('studio.home.review.freecad'),
            action: 'go-console',
            actionLabel: t('studio.home.review.action'),
          }),
          createHomeStartChoice({
            goal: 'previous-work',
            title: t('studio.home.previous.title'),
            copy: t('studio.home.previous.copy'),
            needed: t('studio.home.previous.needed'),
            result: t('studio.home.previous.result'),
            freecad: t('studio.home.previous.freecad'),
            action: 'go-history',
            actionLabel: t('studio.home.previous.action'),
          }),
        ],
      }),
      createHomeRecentRuns(state),
    ],
  });
}

function userRunTypeLabel(type = '') {
  const labels = {
    create: t('studio.history.type.model'),
    draw: t('studio.history.type.drawing'),
    report: t('studio.history.type.report'),
    review: t('studio.history.type.review'),
  };
  return labels[String(type).toLowerCase()] || t('studio.history.type.other');
}

function userRunTitle(job = {}) {
  const derivedName = deriveRecentJobQualityStatus(job).configName;
  return job.label
    || job.config_name
    || (derivedName && derivedName !== 'Unknown' ? derivedName : userRunTypeLabel(job.type));
}

function userExecutionStatus(status = '') {
  const normalized = String(status).toLowerCase();
  const supported = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
  return t(`studio.history.status.${supported.has(normalized) ? normalized : 'unknown'}`);
}

function userQualityStatus(job = {}) {
  const qualityStatus = deriveRecentJobQualityStatus(job).qualityStatus;
  const keys = {
    'Quality passed': 'passed',
    'Quality failed': 'failed',
    'Quality warning': 'warning',
  };
  return t(`studio.history.quality.${keys[qualityStatus] || 'unknown'}`);
}

function createRunHistoryMenuItems(job = {}) {
  const eligibility = deriveJobsCenterActionEligibility(job);
  return [
    ...(eligibility.canOpenReview
      ? [{
          label: t('studio.history.open-review'),
          action: 'open-job',
          dataset: { jobId: job.id, route: 'review' },
        }]
      : []),
    {
      label: t('studio.history.run-information'),
      action: 'open-jobs-center',
    },
    ...(eligibility.canRetry
      ? [{
          label: t('studio.history.retry'),
          action: 'retry-job',
          dataset: { jobId: job.id },
        }]
      : []),
    ...(eligibility.canCancel
      ? [{
          label: t('studio.history.cancel'),
          action: 'cancel-job',
          destructive: true,
          dataset: { jobId: job.id },
        }]
      : []),
  ];
}

function createRunHistoryWorkspace(state) {
  const recentJobs = state.data.recentJobs || {};
  const items = Array.isArray(recentJobs.items) ? recentJobs.items : [];
  let body;

  if (recentJobs.status === 'loading') {
    body = createEmptyState({
      icon: '…',
      title: t('studio.history.loading.title'),
      copy: t('studio.history.loading.copy'),
    });
  } else if (recentJobs.status === 'unavailable') {
    body = createEmptyStateWithNextAction({
      icon: '!',
      title: t('studio.history.unavailable.title'),
      copy: t('studio.history.unavailable.copy'),
      action: {
        label: t('studio.history.unavailable.action'),
        action: 'go-runtime-details',
      },
    });
  } else if (items.length === 0) {
    body = createEmptyStateWithNextAction({
      icon: '↺',
      title: t('studio.history.empty.title'),
      copy: t('studio.history.empty.copy'),
      action: {
        label: t('studio.history.empty.action'),
        action: 'go-model',
      },
    });
  } else {
    body = el('div', {
      className: 'run-history-list',
      children: items.map((job) =>
        createResultCard({
          title: userRunTitle(job),
          meta: `${userRunTypeLabel(job.type)} · ${formatRelativeTime(job.updated_at || job.created_at)}`,
          copy: `${t('studio.history.execution')}: ${userExecutionStatus(job.status)} · ${t('studio.history.quality')}: ${userQualityStatus(job)}`,
          primaryAction: {
            label: t('studio.history.open'),
            action: 'open-job',
            dataset: { jobId: job.id, route: 'artifacts' },
          },
          menuItems: createRunHistoryMenuItems(job),
          menuLabel: `${t('studio.history.more-actions')} ${userRunTitle(job)}`,
          dataset: {
            workflowStep: `history-${job.id}`,
            historyJobId: job.id,
          },
        })
      ),
    });
  }

  return el('section', {
    className: 'workspace-shell run-history-workspace',
    children: [
      createSectionHeader({
        kicker: t('studio.history.kicker'),
        title: t('studio.history.title'),
        description: t('studio.history.description'),
      }),
      body,
    ],
  });
}

function canRunStartTrackedPath(state) {
  const model = state.data.model || {};
  return state.connectionState === 'connected'
    && state.data.health.available === true
    && Boolean((model.configText || '').trim())
    && model.trackedRun?.submitting !== true;
}

function startTrackedPathMeta(state) {
  const model = state.data.model || {};
  if (!model.configText) return 'Load the verified bracket to unlock tracked create and report actions.';
  if (state.connectionState !== 'connected') return 'Tracked jobs require the local API path from `fcad serve`.';
  if (state.data.health.available !== true) return 'Tracked jobs unlock after runtime health is ready.';
  if (model.trackedRun?.submitting === true) return 'Submitting the tracked job...';
  if (isVerifiedBracketLoaded(model)) return 'Recommended path: run tracked create first, then tracked report.';
  return 'Tracked create/report will use the currently loaded config.';
}

function createStartActionsCard(state) {
  const { examples, recentJobs } = state.data;
  const canTryExample = examples.status === 'ready' && examples.items.length > 0;
  const canOpenRecent = recentJobs.status === 'ready' && recentJobs.items.length > 0;
  const latestReviewJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.review);
  const latestReadinessJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.readiness);
  const latestCompareJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.compare);
  const latestPackJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.pack);

  return createCard({
    kicker: 'Review console',
    title: 'Open the next review decision',
    copy: 'Start from context ingest, then move through review packs, readiness packages, compare baselines, and exportable packs without making Model or Drawing the default first stop.',
    body: [
      createFlowRail([
        {
          kicker: '1. Context ingest',
          title: 'Bring source context into the console',
          copy: 'Use an example, a config, or a tracked artifact trail to establish the review lineage.',
          tone: 'info',
        },
        {
          kicker: '2-4. Review signal path',
          title: 'Hotspots, linkage, and recommended actions stay upstream',
          copy: 'Studio surfaces geometry, inspection, and quality outputs as tracked control outputs instead of recreating D or C reasoning.',
          tone: 'ok',
        },
        {
          kicker: '5-6. Review to readiness',
          title: 'Carry canonical packs forward',
          copy: 'Review packs and readiness packages stay reopenable so downstream docs and export steps keep lineage intact.',
          tone: 'warn',
        },
        {
          kicker: '7. Compare and stabilize',
          title: 'Use tracked baselines instead of ad hoc diffs',
          copy: 'Packs can stage compare-rev and stabilization-review from canonical review and readiness artifacts.',
          tone: 'info',
        },
        {
          kicker: '8. Export and reopen',
          title: 'Package the decision trail',
          copy: 'Release bundles and related docs remain browser-safe to reopen, inspect, download, and continue.',
          tone: 'warn',
        },
      ]),
      createActionGrid([
        {
          kicker: 'Start new review',
          title: 'Ingest fresh review context',
          copy: 'Use a checked-in example, your own config, or the prompt-assisted draft flow when you need new review evidence.',
          meta: exampleCountLabel(examples),
          controls: [
            createExamplesSelect(state),
            createButton({
              label: 'Load example',
              action: 'try-example',
              tone: 'primary',
              disabled: !canTryExample,
            }),
          ],
        },
        {
          kicker: 'Import existing artifact / bundle',
          title: 'Reopen tracked outputs',
          copy: 'Use the Packs workspace to reopen tracked review packs, readiness reports, and release bundles. Local file import is not available on this path yet.',
          meta: recentJobs.status === 'unavailable'
            ? 'Tracked artifact import needs the local API path from `fcad serve`.'
            : `${recentJobs.items.length || 0} recent jobs visible`,
          controls: [
            createButton({
              label: 'Open Packs workspace',
              action: 'go-artifacts',
              tone: 'primary',
            }),
            createButton({
              label: recentJobActionLabel(recentJobs),
              action: 'open-recent-job',
              tone: 'ghost',
              disabled: !canOpenRecent,
            }),
          ],
        },
        {
          kicker: 'Recent review packs',
          title: 'Jump into the latest review-ready run',
          copy: 'Open the newest tracked review-oriented run when you want hotspots, linked evidence, and recommended actions first.',
          meta: latestReviewJob ? 'Review-ready tracked run available' : 'No tracked review-ready run yet',
          controls: [
            createButton({
              label: latestReviewJob ? 'Open Review' : 'Review pending',
              action: 'open-job',
              tone: 'primary',
              disabled: !latestReviewJob,
              dataset: latestReviewJob ? { jobId: latestReviewJob.id, route: 'review' } : {},
            }),
          ],
        },
        {
          kicker: 'Readiness packages',
          title: 'Carry review packs into go/hold packaging',
          copy: 'Move into readiness-backed output review before compare or export steps so the canonical report stays central.',
          meta: latestReadinessJob ? 'Readiness package available' : 'No readiness package yet',
          controls: [
            createButton({
              label: latestReadinessJob ? 'Open Readiness' : 'Readiness pending',
              action: latestReadinessJob ? 'open-job' : 'go-artifacts',
              tone: 'primary',
              disabled: !latestReadinessJob && recentJobs.status === 'unavailable',
              dataset: latestReadinessJob ? { jobId: latestReadinessJob.id, route: 'review' } : {},
            }),
          ],
        },
        {
          kicker: 'Compare revisions',
          title: 'Stage Compare Revisions and stabilization',
          copy: 'Use the Packs workspace to choose the current run plus a baseline. When canonical inputs exist, Studio can queue tracked compare and stabilization jobs from there.',
          meta: latestCompareJob ? 'Latest comparison run available' : 'Use active plus baseline tracked runs',
          controls: [
            createButton({
              label: latestCompareJob ? 'Open latest comparison' : 'Open compare workspace',
              action: latestCompareJob ? 'open-job' : 'go-artifacts',
              tone: 'primary',
              dataset: latestCompareJob ? { jobId: latestCompareJob.id, route: 'artifacts' } : {},
            }),
          ],
        },
        {
          kicker: 'Export / pack',
          title: 'Package readiness-backed outputs',
          copy: 'Keep the final export step grounded in readiness-backed artifacts, docs manifests, and release bundles instead of ad hoc downloads.',
          meta: latestPackJob ? 'Release pack available' : 'No release bundle yet',
          controls: [
            createButton({
              label: latestPackJob ? 'Open Pack' : 'Open Packs workspace',
              action: latestPackJob ? 'open-job' : 'go-artifacts',
              dataset: latestPackJob ? { jobId: latestPackJob.id, route: 'artifacts' } : {},
            }),
          ],
        },
        {
          kicker: 'Secondary authoring lanes',
          title: 'Use Model and Drawing only when needed',
          copy: 'Config authoring, geometry preview, and sheet prep stay available, but they now support the review console instead of defining it.',
          meta: 'Prompt and config editing remain available without promoting Studio into a generic CAD modeler.',
          controls: [
            createButton({
              label: 'Choose config file',
              action: 'open-config',
              tone: 'ghost',
            }),
            el('input', {
              className: 'visually-hidden',
              attrs: {
                id: 'start-config-file',
                type: 'file',
                accept: '.toml,.json,text/plain',
              },
            }),
            createButton({
              label: 'Open prompt flow',
              action: 'open-prompt-flow',
            }),
          ],
        },
      ]),
    ],
  });
}

function createRecentJobsCard(state) {
  const { recentJobs } = state.data;

  if (recentJobs.status === 'loading') {
    return createCard({
      kicker: 'Recent review trail',
      title: 'Tracked console runs',
      copy: 'Loading the latest tracked runs you can reopen for review, compare staging, pack, or retry.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '...',
          title: 'Checking tracked decisions',
          copy: 'As tracked runs appear, the console becomes the fastest path back into review packs, readiness, compare, and export.',
        }),
      ],
    });
  }

  if (recentJobs.status === 'unavailable') {
    return createCard({
      kicker: 'Recent review trail',
      title: 'Tracked console history is unavailable on this path',
      copy: 'Classic compatibility mode does not expose tracked job history, so the review console avoids promising reopenable packs here.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '[]',
          title: 'Tracked history needs the local API',
          copy: recentJobs.message || 'Run `fcad serve` to expose `/jobs` and artifact history for the new studio shell.',
        }),
      ],
    });
  }

  if (recentJobs.items.length === 0) {
    return createCard({
      kicker: 'Recent review trail',
      title: 'No tracked decision trail yet',
      copy: 'Use the review-start actions above. As soon as tracked jobs exist, this list becomes the fastest return path into review and packaging.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '+',
          title: 'No recent console runs yet',
          copy: recentJobs.message || 'Run a tracked review, readiness, compare, or pack job to build a reusable decision trail here.',
        }),
      ],
    });
  }

  return createCard({
    kicker: 'Recent review trail',
    title: 'Resume from tracked decision runs',
    copy: 'Reopen review outputs, readiness packages, compare staging, or export work from the latest tracked runs.',
    surface: 'canvas',
    body: [
      el('div', {
        className: 'job-list',
        children: recentJobs.items.map((job) =>
          el('article', {
            className: 'job-item',
            children: [
              el('div', {
                children: [
                  el('div', {
                    className: 'job-title-row',
                    children: [
                      el('p', {
                        className: 'job-title',
                        text: formatRecentJobQualityLine(job, shortJobId(job.id)),
                      }),
                      el('span', {
                        className: 'pill',
                        text: recentJobPillLabel(job),
                      }),
                    ],
                  }),
                  el('p', {
                    className: 'job-copy',
                    text: `Updated ${formatDateTime(job.updated_at)}${job.error?.message ? ` • ${job.error.message}` : ''}`,
                  }),
                ],
              }),
              createButton({
                label: 'Open',
                action: 'open-job',
                tone: 'ghost',
                dataset: { jobId: job.id },
              }),
            ],
          })
        ),
      }),
    ],
  });
}

function createQuickLinksCard(state) {
  const links = [
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Studio command' }),
        el('code', { className: 'code-chip', text: 'fcad serve' }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Studio home' }),
        el('a', {
          className: 'quick-link-anchor',
          text: '/',
          attrs: { href: '/' },
        }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'API info' }),
        el('a', {
          className: 'quick-link-anchor',
          text: '/api',
          attrs: { href: '/api' },
        }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Classic compatibility route' }),
        el('code', { className: 'code-chip', text: 'fcad serve --legacy-viewer' }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Classic npm command' }),
        el('code', { className: 'code-chip', text: 'npm run serve:legacy' }),
      ],
    }),
    state.data.health.reachable
      ? el('div', {
          className: 'quick-link-row',
          children: [
            el('span', { className: 'quick-link-label', text: 'Health' }),
            el('a', {
              className: 'quick-link-anchor',
              text: '/health',
              attrs: { href: '/health' },
            }),
          ],
        })
      : null,
    state.connectionState === 'connected'
      ? el('div', {
          className: 'quick-link-row',
          children: [
            el('span', { className: 'quick-link-label', text: 'Jobs' }),
            el('a', {
              className: 'quick-link-anchor',
              text: '/jobs?limit=8',
              attrs: { href: '/jobs?limit=8' },
            }),
          ],
        })
      : null,
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Examples source' }),
        el('code', { className: 'code-chip', text: state.data.examples.sourceLabel }),
      ],
    }),
  ].filter(Boolean);

  return createCard({
    kicker: 'Advanced links',
    title: 'API routes and compatibility paths',
    copy: 'Keep API discovery, health checks, and classic-viewer escape hatches nearby without letting them outrank the review console.',
    body: [
      createDisclosure({
        summary: 'Show advanced routes',
        body: links,
      }),
    ],
  });
}

function createDecisionPackagesCard(state) {
  const recentJobs = state.data.recentJobs;
  const latestReviewJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.review);
  const latestReadinessJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.readiness);
  const latestCompareJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.compare);
  const latestPackJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.pack);

  return createCard({
    kicker: 'Decision packages',
    title: 'Review-first tracked outputs',
    copy: 'Keep the canonical review, readiness, compare, and export checkpoints visible on the default surface.',
    surface: 'canvas',
    body: [
      createList([
        {
          label: 'Recent review packs',
          copy: latestReviewJob ? 'A tracked review-ready run can reopen directly into the Review workspace.' : 'No tracked review-ready run exists yet.',
          meta: latestReviewJob ? 'Available' : 'Pending',
        },
        {
          label: 'Readiness packages',
          copy: latestReadinessJob ? 'A readiness-backed run is available for go/hold review and downstream docs.' : 'No readiness-backed run exists yet.',
          meta: latestReadinessJob ? 'Available' : 'Pending',
        },
        {
          label: 'Compare and stabilization',
          copy: latestCompareJob ? 'A comparison-oriented tracked run already exists in the trail.' : 'Use the Packs workspace to select active and baseline runs for compare or stabilization.',
          meta: latestCompareJob ? 'Available' : 'Needs baseline',
        },
        {
          label: 'Export and pack',
          copy: latestPackJob ? 'A release bundle or pack-oriented tracked run is ready to reopen.' : 'Pack remains available once readiness-backed outputs exist.',
          meta: latestPackJob ? 'Available' : 'Pending',
        },
      ]),
    ],
  });
}

function createModelSourceSummary(state) {
  const model = state.data.model;
  if (!model.configText) {
    return createEmptyState({
      icon: 'M',
      title: 'No config loaded yet',
      copy: 'Start with Load example or Choose config file from the Console to bring editable config state here.',
    });
  }

  return createInfoGrid([
    { label: 'Source', value: model.sourceType || 'manual' },
    { label: 'Name', value: model.sourceName || 'Untitled config' },
    { label: 'Reference', value: model.sourcePath || 'In-memory draft' },
    { label: 'Editing', value: model.editingEnabled ? 'Enabled' : 'Disabled' },
  ]);
}

function createModelExampleSelect(state) {
  const { examples } = state.data;
  return el('select', {
    className: 'studio-select',
    attrs: {
      disabled: examples.items.length === 0,
    },
    dataset: {
      hook: 'example-select',
    },
    children: examples.items.length > 0
      ? examples.items.map((example) =>
          el('option', {
            text: example.name,
            attrs: {
              value: getStudioExampleValue(example),
              ...(getStudioExampleValue(example) === state.data.examples.selectedId
                ? { selected: true }
                : {}),
            },
          })
        )
      : [
          el('option', {
            text: examples.status === 'loading' ? 'Loading examples...' : 'Examples unavailable',
            attrs: { value: '' },
          }),
        ],
  });
}

function createGuidedModelExampleSelect(state) {
  const { examples } = state.data;
  return el('select', {
    className: 'studio-select',
    attrs: {
      'aria-label': t('studio.model.guided.input.example.select'),
      'aria-describedby': 'guided-model-input-hint',
      disabled: examples.items.length === 0,
    },
    dataset: { hook: 'guided-example-select' },
    children: examples.items.length > 0
      ? examples.items.map((example) =>
          el('option', {
            text: example.name,
            attrs: {
              value: getStudioExampleValue(example),
              ...(getStudioExampleValue(example) === state.data.examples.selectedId
                ? { selected: true }
                : {}),
            },
          })
        )
      : [
          el('option', {
            text: examples.status === 'loading'
              ? t('studio.model.guided.input.examples-loading')
              : t('studio.model.guided.input.examples-empty'),
            attrs: { value: '' },
          }),
        ],
  });
}

function createGuidedModelViewport() {
  return createCard({
    kicker: t('studio.model.guided.result.primary'),
    title: t('studio.model.guided.result.inspector-title'),
    copy: t('studio.model.guided.result.inspector-copy'),
    surface: 'canvas',
    body: [
      el('div', {
        className: 'viewport-toolbar',
        children: [
          el('label', {
            className: 'studio-toggle',
            children: [
              el('input', {
                dataset: { hook: 'wireframe' },
                attrs: { type: 'checkbox' },
              }),
              el('span', { text: 'Wireframe' }),
            ],
          }),
          el('label', {
            className: 'studio-toggle',
            children: [
              el('input', {
                dataset: { hook: 'edges' },
                attrs: { type: 'checkbox', checked: true },
              }),
              el('span', { text: 'Edges' }),
            ],
          }),
          el('label', {
            className: 'studio-range-row',
            children: [
              el('span', { text: 'Opacity' }),
              el('input', {
                dataset: { hook: 'opacity' },
                attrs: { type: 'range', min: 10, max: 100, value: 100 },
              }),
            ],
          }),
          createButton({
            label: 'Screenshot',
            action: 'model-screenshot',
            tone: 'ghost',
            dataset: { hook: 'screenshot' },
          }),
          createButton({
            label: 'Fit view',
            action: 'model-fit-view',
            tone: 'ghost',
            dataset: { hook: 'fit-view' },
          }),
        ],
      }),
      el('div', {
        className: 'studio-viewport-shell',
        children: [
          el('div', { className: 'studio-viewport', dataset: { hook: 'viewport' } }),
        ],
      }),
      el('p', {
        className: 'inline-note',
        dataset: { hook: 'viewport-caption' },
        text: t('studio.model.guided.result.inspector-copy'),
      }),
    ],
  });
}

function guidedModelStepSection(step, currentStep, children) {
  return el('section', {
    className: 'guided-model-step',
    attrs: {
      tabindex: '-1',
      ...(step !== currentStep ? { hidden: true } : {}),
    },
    dataset: {
      modelGuidedStep: step,
      workflowStep: `model-${step}`,
    },
    children,
  });
}

function createModelWorkspace(state) {
  const model = ensureModelTrackedRunState(state.data.model);
  const guidedFlow = ensureModelGuidedFlowState(model);
  const aiDraft = ensureAiDraftState(model);
  const guidedStep = resolveModelGuidedStep(model);
  const guidedStepLabels = {
    select_input: t('studio.model.guided.step.input'),
    preflight: t('studio.model.guided.step.preflight'),
    running: t('studio.model.guided.step.running'),
    result: t('studio.model.guided.step.result'),
  };
  const guidedSteps = createModelGuidedStepStates(model).map((step) => ({
    ...step,
    label: guidedStepLabels[step.id],
  }));
  const guidedCanContinue = guidedFlow.inputMethod === 'example'
    ? state.data.examples.items.length > 0
    : guidedFlow.inputMethod === 'file'
      ? model.sourceType === 'local file' && Boolean(model.configText?.trim())
      : aiDraft.phase === 'validated';

  return el('section', {
    className: 'workspace-shell model-workbench',
    children: [
      createSectionHeader({
        kicker: t('studio.model.guided.kicker'),
        title: t('studio.model.guided.title'),
        description: t('studio.model.guided.description'),
      }),
      createTaskStepper({
        label: t('studio.model.guided.progress'),
        steps: guidedSteps,
      }),
      el('p', {
        className: 'visually-hidden',
        text: guidedStepLabels[guidedStep],
        attrs: { role: 'status', 'aria-live': 'polite' },
        dataset: { hook: 'guided-progress' },
      }),
      el('div', {
        className: 'guided-model-flow',
        children: [
          guidedModelStepSection('select_input', guidedStep, [
            el('h2', {
              className: 'guided-model-step-title',
              text: t('studio.model.guided.input.title'),
              dataset: { hook: 'guided-step-title' },
            }),
            el('p', {
              className: 'guided-model-step-copy',
              text: t('studio.model.guided.input.copy'),
            }),
            el('fieldset', {
              className: 'guided-model-input-methods',
              children: [
                el('legend', {
                  className: 'visually-hidden',
                  text: t('studio.model.guided.input.title'),
                }),
                el('label', {
                  className: 'guided-model-input-option',
                  dataset: { selected: guidedFlow.inputMethod === 'example' ? 'true' : 'false' },
                  children: [
                    el('input', {
                      attrs: {
                        type: 'radio',
                        name: 'guided-model-input-method',
                        value: 'example',
                        ...(guidedFlow.inputMethod === 'example' ? { checked: true } : {}),
                      },
                      dataset: { hook: 'guided-input-method' },
                    }),
                    el('span', {
                      children: [
                        el('strong', { text: t('studio.model.guided.input.example.label') }),
                        el('small', { text: t('studio.model.guided.input.example.copy') }),
                      ],
                    }),
                  ],
                }),
                el('label', {
                  className: 'guided-model-input-option',
                  dataset: { selected: guidedFlow.inputMethod === 'file' ? 'true' : 'false' },
                  children: [
                    el('input', {
                      attrs: {
                        type: 'radio',
                        name: 'guided-model-input-method',
                        value: 'file',
                        ...(guidedFlow.inputMethod === 'file' ? { checked: true } : {}),
                      },
                      dataset: { hook: 'guided-input-method' },
                    }),
                    el('span', {
                      children: [
                        el('strong', { text: t('studio.model.guided.input.file.label') }),
                        el('small', { text: t('studio.model.guided.input.file.copy') }),
                      ],
                    }),
                  ],
                }),
                el('label', {
                  className: 'guided-model-input-option',
                  dataset: { selected: guidedFlow.inputMethod === 'ai' ? 'true' : 'false' },
                  children: [
                    el('input', {
                      attrs: {
                        type: 'radio',
                        name: 'guided-model-input-method',
                        value: 'ai',
                        ...(guidedFlow.inputMethod === 'ai' ? { checked: true } : {}),
                      },
                      dataset: { hook: 'guided-input-method' },
                    }),
                    el('span', {
                      children: [
                        el('strong', { text: t('studio.model.ai.method.label') }),
                        el('small', { text: t('studio.model.ai.method.copy') }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            el('div', {
              className: 'guided-model-input-panel',
              attrs: guidedFlow.inputMethod !== 'example' ? { hidden: true } : {},
              dataset: { hook: 'guided-example-panel' },
              children: [
                el('label', {
                  className: 'studio-field',
                  children: [
                    el('span', {
                      className: 'studio-field-label',
                      text: t('studio.model.guided.input.example.select'),
                    }),
                    createGuidedModelExampleSelect(state),
                  ],
                }),
              ],
            }),
            el('div', {
              className: 'guided-model-input-panel',
              attrs: guidedFlow.inputMethod !== 'file' ? { hidden: true } : {},
              dataset: { hook: 'guided-file-panel' },
              children: [
                el('p', {
                  className: 'guided-model-file-name',
                  text: model.sourceType === 'local file'
                    ? `${t('studio.model.guided.input.file.selected')}: ${model.sourceName}`
                    : t('studio.model.guided.input.file.none'),
                  dataset: { hook: 'guided-file-name' },
                }),
                createSecondaryAction({
                  label: t('studio.model.guided.input.file.action'),
                  action: 'model-guided-open-file',
                  dataset: { hook: 'guided-open-config' },
                }),
                el('input', {
                  className: 'visually-hidden',
                  dataset: { hook: 'guided-config-file' },
                  attrs: { type: 'file', accept: '.toml,.json,text/plain' },
                }),
              ],
            }),
            el('div', {
              className: 'guided-model-input-panel guided-ai-panel',
              attrs: guidedFlow.inputMethod !== 'ai' ? { hidden: true } : {},
              dataset: { hook: 'guided-ai-panel' },
              children: [
                el('div', {
                  className: 'guided-ai-stage',
                  attrs: ['review', 'validating', 'validated'].includes(aiDraft.phase) ? { hidden: true } : {},
                  dataset: { hook: 'guided-ai-request-stage' },
                  children: [
                    el('label', {
                      className: 'studio-field',
                      children: [
                        el('span', {
                          className: 'studio-field-label',
                          text: t('studio.model.ai.prompt.label'),
                        }),
                        el('textarea', {
                          className: 'studio-textarea studio-textarea-compact',
                          text: model.promptText || '',
                          dataset: {
                            hook: 'assistant-textarea',
                            field: 'prompt-text',
                          },
                          attrs: {
                            placeholder: t('studio.model.ai.prompt.placeholder'),
                            rows: 6,
                          },
                        }),
                      ],
                    }),
                    createActionSummary({
                      actionId: 'create-ai-draft',
                      title: t('studio.model.ai.preflight.title'),
                      description: t('studio.model.ai.preflight.copy'),
                      requiredInputs: [t('studio.model.ai.preflight.submitted')],
                      expectedOutputs: [t('studio.model.ai.preflight.result')],
                      launchesFreeCAD: t('studio.model.ai.preflight.freecad'),
                      fileEffects: t('studio.model.ai.preflight.local-files'),
                      networkAccess: t('studio.model.ai.preflight.network'),
                      provider: t('studio.model.ai.preflight.provider'),
                      cost: t('studio.model.ai.preflight.cost'),
                      safetyNotes: t('studio.model.ai.preflight.safety'),
                    }),
                    createInfoGrid([
                      {
                        label: t('studio.model.ai.preflight.submitted-label'),
                        value: t('studio.model.ai.preflight.submitted'),
                      },
                      {
                        label: t('studio.model.ai.preflight.local-files-label'),
                        value: t('studio.model.ai.preflight.local-files'),
                      },
                      {
                        label: t('studio.model.ai.preflight.api-key-label'),
                        value: t('studio.model.ai.preflight.api-key'),
                      },
                    ]),
                    el('div', {
                      className: 'inline-status',
                      attrs: { role: 'alert', hidden: !aiDraft.error },
                      dataset: { hook: 'ai-request-error', tone: 'bad' },
                      children: [
                        el('div', {
                          className: 'inline-status-copy',
                          children: [
                            el('p', {
                              className: 'inline-status-title',
                              text: t('studio.model.ai.error.title'),
                            }),
                            el('p', {
                              className: 'inline-status-message',
                              text: aiDraft.error,
                              dataset: { hook: 'ai-request-error-message' },
                            }),
                          ],
                        }),
                      ],
                    }),
                    el('p', {
                      className: 'inline-note',
                      text: t('studio.model.ai.preflight.prompt-needed'),
                      attrs: { id: 'guided-ai-create-hint' },
                      dataset: { hook: 'ai-create-hint' },
                    }),
                    createPrimaryAction({
                      label: t('studio.model.ai.preflight.confirm'),
                      action: 'model-ai-create-draft',
                      attrs: { 'aria-describedby': 'guided-ai-create-hint' },
                      dataset: { hook: 'ai-create-draft' },
                    }),
                  ],
                }),
                el('div', {
                  className: 'guided-ai-stage',
                  attrs: ['review', 'validating', 'validated'].includes(aiDraft.phase) ? {} : { hidden: true },
                  dataset: { hook: 'guided-ai-review-stage' },
                  children: [
                    el('h3', {
                      className: 'guided-ai-review-title',
                      text: t('studio.model.ai.review.title'),
                    }),
                    el('p', {
                      className: 'guided-model-step-copy',
                      text: t('studio.model.ai.review.copy'),
                    }),
                    el('label', {
                      className: 'studio-field',
                      children: [
                        el('span', {
                          className: 'studio-field-label',
                          text: t('studio.model.ai.review.draft-label'),
                        }),
                        el('textarea', {
                          className: 'studio-textarea studio-textarea-code studio-textarea-model',
                          text: model.configText || '',
                          dataset: {
                            hook: 'ai-draft-textarea',
                            field: 'config-text',
                          },
                          attrs: { rows: 14, spellcheck: 'false' },
                        }),
                      ],
                    }),
                    el('div', {
                      className: 'studio-note-stack',
                      dataset: { hook: 'assistant-report' },
                    }),
                    el('p', {
                      className: 'inline-note',
                      text: t('studio.model.ai.review.required'),
                      attrs: { id: 'guided-ai-review-hint' },
                      dataset: { hook: 'ai-review-hint' },
                    }),
                    createPrimaryAction({
                      label: aiDraft.phase === 'validated'
                        ? t('studio.model.ai.review.continue')
                        : t('studio.model.ai.review.validate'),
                      action: 'model-ai-validate-draft',
                      attrs: { 'aria-describedby': 'guided-ai-review-hint' },
                      dataset: { hook: 'ai-validate-draft' },
                    }),
                  ],
                }),
              ],
            }),
            el('p', {
              className: 'inline-note',
              text: guidedCanContinue
                ? t('studio.model.guided.input.ready')
                : guidedFlow.inputMethod === 'example'
                  ? t('studio.model.guided.input.examples-loading')
                  : guidedFlow.inputMethod === 'file'
                    ? t('studio.model.guided.input.file-needed')
                    : t('studio.model.ai.preflight.prompt-needed'),
              attrs: { id: 'guided-model-input-hint' },
              dataset: { hook: 'guided-input-hint' },
            }),
            createPrimaryAction({
              label: t('studio.model.guided.input.continue'),
              action: 'model-guided-continue',
              disabled: !guidedCanContinue,
              attrs: {
                'aria-describedby': 'guided-model-input-hint',
                ...(guidedFlow.inputMethod === 'ai' ? { hidden: true } : {}),
              },
              dataset: { hook: 'guided-continue' },
            }),
          ]),
          guidedModelStepSection('preflight', guidedStep, [
            el('h2', {
              className: 'guided-model-step-title',
              text: t('studio.model.guided.preflight.title'),
              dataset: { hook: 'guided-step-title' },
            }),
            el('p', {
              className: 'guided-model-step-copy',
              text: t('studio.model.guided.preflight.copy'),
            }),
            createActionSummary({
              actionId: 'generate-model',
              title: t('studio.model.guided.preflight.action-title'),
              description: t('studio.model.guided.preflight.action-copy'),
              requiredInputs: [model.sourceName || t('studio.model.guided.preflight.input-fallback')],
              expectedOutputs: [t('studio.model.guided.preflight.outputs')],
              launchesFreeCAD: t('studio.model.guided.preflight.freecad'),
              fileEffects: t('studio.model.guided.preflight.files'),
              networkAccess: t('studio.model.guided.preflight.network'),
              provider: t('studio.model.guided.preflight.provider'),
              cost: t('studio.model.guided.preflight.cost'),
              safetyNotes: t('studio.model.guided.preflight.safety'),
            }),
            el('div', {
              className: 'inline-status',
              attrs: { role: 'alert', hidden: true },
              dataset: { hook: 'guided-error', tone: 'bad' },
              children: [
                el('div', {
                  className: 'inline-status-copy',
                  children: [
                    el('p', {
                      className: 'inline-status-title',
                      text: t('studio.model.guided.error.title'),
                    }),
                    el('p', {
                      className: 'inline-status-message',
                      dataset: { hook: 'guided-error-message' },
                    }),
                  ],
                }),
              ],
            }),
            el('p', {
              className: 'inline-note',
              attrs: { id: 'guided-model-generate-hint' },
              dataset: { hook: 'guided-generate-hint' },
            }),
            el('div', {
              className: 'guided-model-step-actions',
              children: [
                createSecondaryAction({
                  label: t('studio.model.guided.preflight.back'),
                  action: 'model-guided-back',
                  dataset: { hook: 'guided-back' },
                }),
                createPrimaryAction({
                  label: t('studio.model.guided.generate.action'),
                  action: 'model-guided-generate',
                  attrs: { 'aria-describedby': 'guided-model-generate-hint' },
                  dataset: { hook: 'guided-generate' },
                }),
              ],
            }),
          ]),
          guidedModelStepSection('running', guidedStep, [
            el('h2', {
              className: 'guided-model-step-title',
              text: t('studio.model.guided.running.title'),
              dataset: { hook: 'guided-step-title' },
            }),
            createInlineStatus({
              title: t('studio.model.guided.running.title'),
              copy: model.buildState === 'building'
                ? t('studio.model.guided.running.building')
                : t('studio.model.guided.running.validating'),
              tone: 'info',
              live: 'polite',
            }),
            createDisclosure({
              summary: t('studio.model.guided.running.details'),
              body: [
                el('div', {
                  className: 'build-log studio-side-panel',
                  dataset: { hook: 'guided-running-log' },
                }),
              ],
            }),
          ]),
          guidedModelStepSection('result', guidedStep, [
            el('h2', {
              className: 'guided-model-step-title',
              text: t('studio.model.guided.result.title'),
              dataset: { hook: 'guided-step-title' },
            }),
            el('p', {
              className: 'guided-model-step-copy',
              text: t('studio.model.guided.result.copy'),
            }),
            el('div', {
              className: 'studio-mini-grid guided-model-result-summary',
              dataset: { hook: 'guided-result-summary' },
            }),
            el('div', {
              className: 'inline-status',
              attrs: { role: 'alert', hidden: true },
              dataset: { hook: 'guided-result-error', tone: 'bad' },
              children: [
                el('div', {
                  className: 'inline-status-copy',
                  children: [
                    el('p', {
                      className: 'inline-status-title',
                      text: t('studio.model.guided.result.error-title'),
                    }),
                    el('p', {
                      className: 'inline-status-message',
                      dataset: { hook: 'guided-result-error-message' },
                    }),
                  ],
                }),
              ],
            }),
            createResultCard({
              title: t('studio.model.guided.result.card-title'),
              meta: t('studio.model.guided.result.card-meta'),
              copy: t('studio.model.guided.result.card-copy'),
              primaryAction: {
                label: t('studio.model.guided.result.view'),
                action: 'model-guided-view-result',
                dataset: { hook: 'guided-view-result' },
              },
              menuLabel: t('studio.model.guided.result.more'),
              menuItems: [
                {
                  label: t('studio.model.guided.result.create-drawing'),
                  action: 'go-drawing',
                },
                {
                  label: t('studio.model.guided.result.start-another'),
                  action: 'model-guided-reset',
                  dataset: { hook: 'guided-reset' },
                },
              ],
            }),
            el('div', {
              className: 'guided-model-result-inspection',
              attrs: {
                tabindex: '-1',
                ...(!guidedFlow.resultExpanded ? { hidden: true } : {}),
              },
              dataset: { hook: 'guided-result-inspection' },
              children: [createGuidedModelViewport()],
            }),
          ]),
        ],
      }),
      el('details', {
        className: 'guided-model-advanced-disclosure',
        dataset: { hook: 'model-advanced-tools' },
        children: [
          el('summary', {
            className: 'guided-model-advanced-summary',
            text: t('studio.model.guided.advanced.summary'),
            attrs: { 'aria-controls': 'model-advanced-content' },
          }),
          el('p', {
            className: 'guided-model-advanced-copy',
            text: t('studio.model.guided.advanced.copy'),
          }),
          el('div', {
            className: 'guided-model-advanced-content',
            attrs: { id: 'model-advanced-content', hidden: true },
            dataset: { hook: 'model-advanced-content' },
            children: [
              el('div', {
            className: 'model-status-grid',
            children: [
              el('article', {
                className: 'model-status-surface',
                dataset: { hook: 'runtime-surface', tone: 'info' },
                children: [
                  el('h3', { className: 'model-status-title', text: 'Runtime pending' }),
                  el('p', { className: 'model-status-copy', text: 'Runtime posture will resolve from the local API health check.' }),
                ],
              }),
              el('article', {
                className: 'model-status-surface',
                dataset: { hook: 'connection-surface', tone: 'info' },
                children: [
                  el('h3', { className: 'model-status-title', text: 'API pending' }),
                  el('p', { className: 'model-status-copy', text: 'Connection state will reflect whether the future-facing studio path is reachable.' }),
                ],
              }),
              el('article', {
                className: 'model-status-surface',
                dataset: { hook: 'build-surface', tone: 'info' },
                children: [
                  el('h3', { className: 'model-status-title', text: 'Idle' }),
                  el('p', { className: 'model-status-copy', text: 'Build remains the primary CTA in this workspace.' }),
                ],
              }),
              el('article', {
                className: 'model-status-surface',
                dataset: { hook: 'result-surface', tone: 'info' },
                children: [
                  el('h3', { className: 'model-status-title', text: 'Result pending' }),
                  el('p', { className: 'model-status-copy', text: 'The latest preview outcome will stay visible here.' }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'model-grid model-grid-advanced',
            children: [
          el('div', {
            className: 'model-column model-column-left',
            children: [
              createCard({
                kicker: 'Input',
                title: 'Choose the model source',
                copy: 'Examples and local configs stay close to Build, while editing remains available but no longer defines the whole screen.',
                body: [
                  el('div', {
                    className: 'action-controls',
                    children: [
                      createModelExampleSelect(state),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: 'Load example',
                            action: 'model-load-example',
                            tone: 'primary',
                            dataset: { hook: 'load-example' },
                          }),
                          createButton({
                            label: 'Open config file',
                            action: 'model-open-config',
                            tone: 'ghost',
                            dataset: { hook: 'open-config' },
                          }),
                          el('input', {
                            className: 'visually-hidden',
                            dataset: { hook: 'config-file' },
                            attrs: {
                              type: 'file',
                              accept: '.toml,.json,text/plain',
                            },
                          }),
                        ],
                      }),
                    ],
                  }),
                  el('div', { dataset: { hook: 'source-summary' }, children: [createModelSourceSummary(state)] }),
                ],
              }),
              createCard({
                kicker: 'Config and parameters',
                title: 'Review the working config',
                copy: 'Parameters are summarized first, while the full TOML stays available in a collapsible editor instead of dominating the page.',
                body: [
                  el('div', { className: 'studio-mini-grid', dataset: { hook: 'validation-summary' } }),
                  el('details', {
                    className: 'disclosure',
                    attrs: { open: true },
                    children: [
                      el('summary', { className: 'disclosure-summary', text: 'Edit TOML' }),
                      el('div', {
                        className: 'disclosure-body',
                        children: [
                          el('textarea', {
                            className: 'studio-textarea studio-textarea-code studio-textarea-model',
                            text: model.configText || '',
                            dataset: {
                              hook: 'config-textarea',
                              field: 'config-text',
                            },
                            attrs: {
                              placeholder: 'Load an example or open a local config to start editing here.',
                              spellcheck: 'false',
                              rows: 18,
                            },
                          }),
                        ],
                      }),
                    ],
                  }),
                  el('div', { className: 'studio-note-stack', dataset: { hook: 'validation-warnings' } }),
                ],
              }),
              createCard({
                kicker: 'Preview vs tracked run',
                title: 'Choose scratch preview or tracked execution',
                copy: 'Preview stays scratch-safe and viewport-first. Tracked create and report send the current TOML into the job timeline for provenance, downstream artifacts, and re-entry.',
                body: [
                  el('section', {
                    className: 'execution-lane',
                    children: [
                      el('p', { className: 'execution-lane-label', text: 'Preview path' }),
                      el('p', {
                        className: 'inline-note',
                        text: 'Use Validate and Preview Build for the fast local loop. This path stays viewport-first and does not create tracked job history.',
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'include-step' },
                            attrs: { type: 'checkbox', checked: true },
                          }),
                          el('span', { text: 'Keep STEP export alongside the viewport preview' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'include-stl' },
                            attrs: { type: 'checkbox', checked: true, disabled: true },
                          }),
                          el('span', { text: 'Generate STL preview assets for the viewport (required)' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'per-part-stl' },
                            attrs: { type: 'checkbox', checked: true },
                          }),
                          el('span', { text: 'Keep per-part STL loading for assembly inspection' }),
                        ],
                      }),
                      el('p', {
                        className: 'inline-note',
                        dataset: { hook: 'build-summary' },
                        text: model.buildSummary || 'Choose input, then build to inspect the preview.',
                      }),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: 'Validate',
                            action: 'model-validate',
                            tone: 'ghost',
                            dataset: { hook: 'validate-button' },
                          }),
                          createButton({
                            label: t('studio.model.guided.advanced.review-preview'),
                            action: 'model-build',
                            tone: 'primary',
                            dataset: { hook: 'build-button' },
                          }),
                          createButton({
                            label: 'Clear preview',
                            action: 'model-clear-result',
                            tone: 'ghost',
                            dataset: { hook: 'clear-result' },
                          }),
                        ],
                      }),
                    ],
                  }),
                  el('section', {
                    className: 'execution-lane execution-lane-tracked',
                    children: [
                      el('p', { className: 'execution-lane-label', text: 'Tracked path' }),
                      el('p', {
                        className: 'inline-note',
                        text: 'Use tracked runs when you want provenance, job history, and artifact-driven re-entry. Validation notes stay visible here before the run is queued.',
                      }),
                      createActionSummary({
                        actionId: 'run-tracked-model-work',
                        title: t('studio.model.guided.advanced.tracked-title'),
                        description: t('studio.model.guided.advanced.tracked-copy'),
                        requiredInputs: [model.sourceName || t('studio.model.guided.preflight.input-fallback')],
                        expectedOutputs: [t('studio.model.guided.advanced.tracked-outputs')],
                        launchesFreeCAD: t('studio.model.guided.preflight.freecad'),
                        fileEffects: t('studio.model.guided.advanced.tracked-files'),
                        networkAccess: t('studio.model.guided.preflight.network'),
                        provider: t('studio.model.guided.preflight.provider'),
                        cost: t('studio.model.guided.preflight.cost'),
                        safetyNotes: t('studio.model.guided.advanced.tracked-safety'),
                      }),
                      el('div', { className: 'studio-note-stack', dataset: { hook: 'tracked-validation-notes' } }),
                      createDisclosure({
                        summary: 'Tracked report options',
                        open: model.reportOptions.open,
                        body: [
                          el('label', {
                            className: 'studio-check-row',
                            children: [
                              el('input', {
                                dataset: { hook: 'report-include-drawing' },
                                attrs: { type: 'checkbox', checked: model.reportOptions.includeDrawing },
                              }),
                              el('span', { text: 'Include drawing in the tracked report run' }),
                            ],
                          }),
                          el('label', {
                            className: 'studio-check-row',
                            children: [
                              el('input', {
                                dataset: { hook: 'report-include-tolerance' },
                                attrs: { type: 'checkbox', checked: model.reportOptions.includeTolerance },
                              }),
                              el('span', { text: 'Include tolerance analysis when available' }),
                            ],
                          }),
                          el('label', {
                            className: 'studio-check-row',
                            children: [
                              el('input', {
                                dataset: { hook: 'report-include-dfm' },
                                attrs: { type: 'checkbox', checked: model.reportOptions.includeDfm },
                              }),
                              el('span', { text: 'Include DFM analysis in the tracked report' }),
                            ],
                          }),
                          el('label', {
                            className: 'studio-check-row',
                            children: [
                              el('input', {
                                dataset: { hook: 'report-include-cost' },
                                attrs: { type: 'checkbox', checked: model.reportOptions.includeCost },
                              }),
                              el('span', { text: 'Include cost analysis in the tracked report' }),
                            ],
                          }),
                          el('label', {
                            className: 'studio-field',
                            children: [
                              el('span', { className: 'studio-field-label', text: 'Optional profile name' }),
                              el('input', {
                                className: 'studio-input',
                                dataset: { hook: 'report-profile-name' },
                                attrs: {
                                  type: 'text',
                                  list: 'model-report-profile-list',
                                  placeholder: 'Leave blank for default profile handling',
                                  value: model.reportOptions.profileName || '',
                                },
                              }),
                              el('datalist', {
                                attrs: { id: 'model-report-profile-list' },
                                dataset: { hook: 'report-profile-list' },
                              }),
                              el('p', {
                                className: 'inline-note',
                                dataset: { hook: 'report-profile-hint' },
                                text: 'Existing backend-supported profile names can be supplied here when needed.',
                              }),
                            ],
                          }),
                        ],
                      }),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: 'Run Tracked Create Job',
                            action: 'model-run-tracked-create',
                            tone: 'ghost',
                            dataset: { hook: 'tracked-create-button' },
                          }),
                          createButton({
                            label: 'Run Tracked Report Job',
                            action: 'model-run-tracked-report',
                            tone: 'ghost',
                            dataset: { hook: 'tracked-report-button' },
                          }),
                        ],
                      }),
                      el('div', { className: 'studio-note-stack', dataset: { hook: 'tracked-status' } }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'model-column model-column-right',
            children: [
              createCard({
                kicker: 'Model metadata',
                title: 'Operational model facts',
                copy: 'Metadata is presented as build feedback, not a random textbox dump.',
                body: [
                  el('div', { className: 'model-info studio-side-panel', dataset: { hook: 'model-info' } }),
                ],
              }),
              createCard({
                kicker: 'Parts',
                title: 'Assembly structure',
                copy: 'Part selection, material swatches, and per-part inspection stay next to the viewport rather than inside the input stack.',
                body: [
                  el('div', { className: 'parts-list studio-side-panel', dataset: { hook: 'parts-list' } }),
                ],
              }),
              createCard({
                kicker: 'Build log',
                title: 'Build pipeline output',
                copy: 'Logs are framed as operational feedback from the pipeline instead of generic console noise.',
                body: [
                  el('div', { className: 'build-log studio-side-panel', dataset: { hook: 'build-log' } }),
                ],
              }),
              createCard({
                kicker: 'Motion controls',
                title: 'Preserve animation when motion data exists',
                copy: 'If the model carries motion data, the same playback behavior remains available here.',
                body: [
                  el('div', {
                    className: 'animation-controls studio-side-panel',
                    dataset: { hook: 'animation-controls' },
                    children: [
                      el('div', {
                        className: 'anim-btn-row',
                        children: [
                          createButton({ label: 'Play', action: 'play', tone: 'ghost', dataset: { hook: 'play' } }),
                          createButton({ label: 'Pause', action: 'pause', tone: 'ghost', dataset: { hook: 'pause' } }),
                          createButton({ label: 'Reset', action: 'reset-motion', tone: 'ghost', dataset: { hook: 'reset-motion' } }),
                        ],
                      }),
                      el('div', {
                        className: 'anim-slider-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'timeline' },
                            attrs: { type: 'range', min: 0, max: 1000, value: 0 },
                          }),
                          el('span', { className: 'time-display', dataset: { hook: 'time-display' }, text: '0.0s' }),
                        ],
                      }),
                      el('div', {
                        className: 'speed-row',
                        children: ['0.25', '0.5', '1', '2'].map((speed, index) =>
                          el('button', {
                            className: `action-button action-button-ghost${index === 2 ? ' selected' : ''}`,
                            text: `${speed}x`,
                            dataset: {
                              hook: 'speed-button',
                              speed,
                            },
                            attrs: { type: 'button' },
                          })
                        ),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
            ],
          }),
        ],
      }),
    ],
  });
}

function createDrawingWorkspace(state) {
  const hasConfig = Boolean(state.data.model?.configText?.trim());
  const drawingStatus = state.data.drawing?.status || 'idle';
  const tone = drawingStatus === 'ready' ? 'ok' : drawingStatus === 'error' ? 'bad' : drawingStatus === 'generating' ? 'warn' : 'info';

  return el('section', {
    className: 'workspace-shell',
    children: [
      createSectionHeader({
        kicker: 'Drawing workspace',
        title: 'FreeCAD drawing stays sheet-first',
        description: 'Generate, inspect, and revise manufacturing-facing sheets in a dedicated workbench instead of dropping into the old overlay flow.',
        badges: [
          { label: hasConfig ? 'Config loaded' : 'Config needed', tone: hasConfig ? 'ok' : 'warn' },
          { label: `Drawing ${drawingStatus === 'ready' ? 'ready' : drawingStatus === 'error' ? 'error' : drawingStatus === 'generating' ? 'generating' : 'pending'}`, tone },
          { label: 'BOM and QA sidecars', tone: 'info' },
        ],
      }),
      el('div', {
        className: 'drawing-status-grid',
        children: [
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-source-surface', tone: hasConfig ? 'ok' : 'warn' },
            children: [
              el('h3', { className: 'model-status-title', text: hasConfig ? 'Config ready' : 'Config pending' }),
              el('p', { className: 'model-status-copy', text: hasConfig ? 'This workspace can generate a sheet from the shared config state.' : 'Load an example or open a config here before generating a sheet.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-runtime-surface', tone: 'info' },
            children: [
              el('h3', { className: 'model-status-title', text: 'Runtime pending' }),
              el('p', { className: 'model-status-copy', text: 'Drawing previews and tracked sheet runs use the same runtime and job model as the rest of Studio.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-job-surface', tone },
            children: [
              el('h3', { className: 'model-status-title', text: drawingStatus === 'generating' ? 'Generating' : 'No drawing yet' }),
              el('p', { className: 'model-status-copy', text: 'Preview Drawing stays local and fast; tracked draw routes into monitored jobs.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-result-surface', tone: 'info' },
            children: [
              el('h3', { className: 'model-status-title', text: 'Sheet pending' }),
              el('p', { className: 'model-status-copy', text: 'BOM, annotations, QA, and dimension state will summarize here after the first render.' }),
            ],
          }),
        ],
      }),
      el('div', {
        className: 'drawing-grid',
        children: [
          el('div', {
            className: 'drawing-column drawing-column-left',
            children: [
              createCard({
                kicker: 'Source',
                title: 'Choose what feeds the sheet',
                copy: 'Stay in Drawing to load an example or config, then jump to Model only when you actually want to revise geometry or full TOML.',
                body: [
                  el('div', {
                    className: 'action-controls',
                    children: [
                      createModelExampleSelect(state),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: 'Load example',
                            action: 'drawing-load-example',
                            tone: 'primary',
                          }),
                          createButton({
                            label: 'Open config file',
                            action: 'drawing-open-config',
                            tone: 'ghost',
                          }),
                          createButton({
                            label: 'Edit in model',
                            action: 'drawing-open-model',
                            tone: 'ghost',
                          }),
                          el('input', {
                            className: 'visually-hidden',
                            dataset: { hook: 'drawing-config-file' },
                            attrs: {
                              type: 'file',
                              accept: '.toml,.json,text/plain',
                            },
                          }),
                        ],
                      }),
                    ],
                  }),
                  el('div', { className: 'studio-mini-grid', dataset: { hook: 'drawing-source-summary' } }),
                ],
              }),
              createCard({
                kicker: 'Preview vs tracked run',
                title: 'Set up the sheet, then choose the execution lane',
                copy: 'Preview Drawing keeps the fast sheet-first loop in place. Run Tracked Draw Job submits the current TOML plus drawing settings into the normal job pipeline and Artifacts timeline.',
                body: [
                  el('div', {
                    className: 'drawing-preset-group',
                    children: [
                      el('p', { className: 'info-label', text: 'View presets' }),
                      el('div', {
                        className: 'drawing-view-grid',
                        children: ['front', 'top', 'right', 'iso'].map((view) =>
                          el('label', {
                            className: 'studio-check-row',
                            children: [
                              el('input', {
                                dataset: { hook: 'drawing-view', view },
                                attrs: { type: 'checkbox', checked: true },
                              }),
                              el('span', { text: view }),
                            ],
                          })
                        ),
                      }),
                    ],
                  }),
                  el('div', {
                    className: 'drawing-controls-grid',
                    children: [
                      el('label', {
                        className: 'drawing-select-field',
                        children: [
                          el('span', { className: 'info-label', text: 'Sheet scale' }),
                          el('select', {
                            className: 'studio-select',
                            dataset: { hook: 'drawing-scale' },
                            children: ['auto', '1:1', '1:2', '1:5', '2:1'].map((value, index) =>
                              el('option', {
                                text: value.toUpperCase(),
                                attrs: {
                                  value,
                                  selected: index === 0,
                                },
                              })
                            ),
                          }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'drawing-section-assist' },
                            attrs: { type: 'checkbox' },
                          }),
                          el('span', { text: 'Section assist' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'drawing-detail-assist' },
                            attrs: { type: 'checkbox' },
                          }),
                          el('span', { text: 'Detail assist' }),
                        ],
                      }),
                    ],
                  }),
                  el('p', {
                    className: 'inline-note',
                    dataset: { hook: 'drawing-summary' },
                    text: 'Preview Drawing runs locally and quickly. Run Tracked Draw Job publishes the current sheet settings as a tracked job and artifact set.',
                  }),
                  createActionSummary({
                    actionId: 'preview-drawing',
                    title: t('studio.drawing.preview.summary-title'),
                    description: t('studio.drawing.preview.summary-copy'),
                    requiredInputs: [t('studio.drawing.preview.required-input')],
                    expectedOutputs: [t('studio.drawing.preview.expected-output')],
                    launchesFreeCAD: t('studio.drawing.preview.freecad'),
                    fileEffects: t('studio.drawing.preview.files'),
                    networkAccess: t('studio.drawing.local-api'),
                    provider: t('studio.drawing.none'),
                    cost: t('studio.drawing.none'),
                    humanConfirmationRequired: true,
                    safetyNotes: t('studio.drawing.preview.safety'),
                  }),
                  el('div', {
                    className: 'model-action-row',
                    children: [
                      createButton({
                        label: 'Preview drawing',
                        action: 'drawing-generate',
                        tone: 'primary',
                        dataset: { hook: 'drawing-generate' },
                      }),
                      createButton({
                        label: 'Run Tracked Draw Job',
                        action: 'drawing-run-tracked',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-tracked-run' },
                      }),
                      createButton({
                        label: 'Fit sheet',
                        action: 'drawing-fit',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-fit-side' },
                      }),
                    ],
                  }),
                  el('div', {
                    className: 'guided-follow-up-card',
                    attrs: { hidden: drawingStatus === 'ready' ? undefined : '' },
                    dataset: { hook: 'drawing-report-action' },
                    children: [
                      createActionSummary({
                        actionId: 'create-drawing-report',
                        title: t('studio.drawing.report.summary-title'),
                        description: t('studio.drawing.report.summary-copy'),
                        requiredInputs: [t('studio.drawing.report.required-input')],
                        expectedOutputs: [t('studio.drawing.report.expected-output')],
                        launchesFreeCAD: t('studio.drawing.report.freecad'),
                        fileEffects: t('studio.drawing.report.files'),
                        networkAccess: t('studio.drawing.local-api'),
                        provider: t('studio.drawing.none'),
                        cost: t('studio.drawing.none'),
                        humanConfirmationRequired: true,
                        safetyNotes: t('studio.drawing.report.safety'),
                      }),
                      createPrimaryAction({
                        label: t('studio.drawing.report.action'),
                        action: 'drawing-run-report',
                        dataset: { hook: 'drawing-report' },
                      }),
                      el('p', {
                        className: 'inline-note',
                        text: t('studio.drawing.report.status.idle'),
                        attrs: { role: 'status', 'aria-live': 'polite' },
                        dataset: { hook: 'drawing-report-status', tone: 'info' },
                      }),
                    ],
                  }),
                  el('div', { className: 'studio-mini-grid', dataset: { hook: 'drawing-tracked-status' } }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'drawing-column drawing-column-center',
            children: [
              createCard({
                kicker: 'Drawing canvas',
                title: 'Sheet view',
                copy: 'The sheet is the primary surface here, with just the controls that matter for drawing inspection.',
                surface: 'canvas',
                body: [
                  el('div', {
                    className: 'drawing-toolbar',
                    children: [
                      createButton({
                        label: '+',
                        action: 'drawing-zoom-in',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-zoom-in' },
                      }),
                      createButton({
                        label: '-',
                        action: 'drawing-zoom-out',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-zoom-out' },
                      }),
                      createButton({
                        label: 'Fit',
                        action: 'drawing-fit',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-fit' },
                      }),
                      el('span', { className: 'drawing-zoom-label', dataset: { hook: 'drawing-zoom-label' }, text: '100%' }),
                    ],
                  }),
                  el('div', {
                    className: 'drawing-stage-shell',
                    dataset: { hook: 'drawing-stage' },
                    children: [
                      el('div', {
                        className: 'drawing-empty-state',
                        dataset: { hook: 'drawing-empty' },
                        children: [
                          createEmptyState({
                            icon: '2D',
                            title: 'No drawing yet',
                            copy: 'Use Preview Drawing for the fast loop or Run Tracked Draw Job to queue the current TOML and sheet settings.',
                          }),
                        ],
                      }),
                      el('div', {
                        className: 'drawing-canvas',
                        dataset: { hook: 'drawing-canvas' },
                        attrs: {
                          tabindex: '-1',
                          role: 'region',
                          'aria-label': t('studio.drawing.canvas.label'),
                        },
                      }),
                    ],
                  }),
                  el('p', {
                    className: 'inline-note',
                    dataset: { hook: 'drawing-canvas-caption' },
                    text: 'Pan with drag, zoom with the mouse wheel, and click dimension text to keep the edit loop attached to the sheet.',
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'drawing-column drawing-column-right',
            children: [
              createCard({
                kicker: 'BOM',
                title: 'BOM',
                copy: 'Manufacturing-facing part structure stays beside the sheet instead of below it.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-bom' } }),
                ],
              }),
              createCard({
                kicker: 'Annotations',
                title: 'Notes and callouts',
                copy: 'General notes and drawing-plan callouts stay visible as documentation sidecars.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-annotations' } }),
                ],
              }),
              createCard({
                kicker: 'QA summary',
                title: 'Sheet readiness',
                copy: 'Keep the drawing score and dimension posture visible while you iterate.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-qa' } }),
                ],
              }),
              createCard({
                kicker: 'Dimension loop',
                title: 'Editable dimensions and history',
                copy: 'The existing edit loop stays attached to the sheet, with a right-side register for current values and change history.',
                body: [
                  createDisclosure({
                    summary: 'Current editable dimensions',
                    open: true,
                    body: [
                      el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-dimensions' } }),
                    ],
                  }),
                  createDisclosure({
                    summary: 'Edit history',
                    open: true,
                    body: [
                      el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-history' } }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function createReviewWorkspace() {
  return workspaceShell({
    kicker: 'Review workspace',
    title: 'Review remains decision-first',
    description: 'Design review, DFM, readiness, and stabilization outputs still belong in a dedicated decision surface.',
    badges: [
      { label: 'DFM and readiness preserved', tone: 'ok' },
      { label: 'Decision console pending', tone: 'warn' },
      { label: 'Status-first layout', tone: 'info' },
    ],
    controls: [
      createCard({
        kicker: 'Review lanes',
        title: 'Signals this workspace will carry',
        copy: 'The product identity stays aligned with an automation pipeline, not only a viewer.',
        body: [
          createStatusStrip([
            { label: 'Design review', copy: 'Issue summaries, geometry observations, and next actions.' },
            { label: 'Manufacturing review', copy: 'DFM, quality risk, and process planning outputs.' },
            { label: 'Readiness and stabilization', copy: 'Runtime-informed hold points and launch guidance.' },
          ]),
        ],
      }),
    ],
    canvas: [
      createCard({
        kicker: 'Decision board',
        title: 'Review flow',
        copy: 'This reserved board keeps status colors and next actions in the foreground when review wiring lands.',
        surface: 'canvas',
        body: [
          createFlowRail([
            { kicker: 'Signal', title: 'Geometry and model facts', copy: 'Pull facts from model creation and inspection outputs.' },
            { kicker: 'Assessment', title: 'Manufacturing and launch review', copy: 'Surface the review outputs that matter for go/hold decisions.', tone: 'warn' },
            { kicker: 'Decision', title: 'Actionable next step', copy: 'Keep the recommended action explicit and traceable.', tone: 'ok' },
          ]),
        ],
      }),
    ],
  });
}

function createArtifactsWorkspace(state) {
  const { activeJob, recentJobs } = state.data;
  const hasActiveJob = Boolean(activeJob.summary);

  let artifactBody;
  if (!hasActiveJob) {
    artifactBody = [
      createEmptyState({
        icon: '[]',
        title: 'No job selected',
        copy: 'Open a recent job from Start to inspect artifacts, manifests, and output storage here.',
      }),
    ];
  } else if (activeJob.status === 'loading') {
    artifactBody = [
      createEmptyState({
        icon: '...',
        title: `Loading ${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}`,
        copy: 'Fetching artifact metadata from the local API.',
      }),
    ];
  } else if (activeJob.status === 'unavailable') {
    artifactBody = [
      createEmptyState({
        icon: '!',
        title: 'Artifacts unavailable',
        copy: activeJob.errorMessage || 'Artifact details could not be loaded for this job.',
      }),
    ];
  } else if (activeJob.artifacts.length === 0) {
    artifactBody = [
      createEmptyState({
        icon: '0',
        title: 'This job has no exposed artifacts yet',
        copy: 'The job record exists, but no artifact entries were returned for it.',
      }),
    ];
  } else {
    artifactBody = [
      createArtifactList(
        activeJob.artifacts.map((artifact) => ({
          title: artifact.key,
          meta: `${artifact.exists ? 'Available' : 'Missing'}${artifact.type ? ` • ${artifact.type}` : ''}`,
          path: artifact.file_name || artifact.id,
        }))
      ),
    ];
  }

  return workspaceShell({
    kicker: 'Artifacts workspace',
    title: hasActiveJob ? `Artifacts for ${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` : 'Artifact trail and manifests',
    description: 'Tracked outputs need a dedicated surface so job history and artifact provenance do not get buried under entry controls.',
    badges: [
      { label: hasActiveJob ? 'Job selected' : 'No job selected', tone: hasActiveJob ? 'ok' : 'warn' },
      { label: `${recentJobs.items.length || 0} recent jobs`, tone: recentJobs.items.length ? 'info' : 'warn' },
      { label: 'Manifest-first layout', tone: 'info' },
    ],
    controls: [
      createCard({
        kicker: 'Active job',
        title: hasActiveJob ? `${activeJob.summary.type} ${shortJobId(activeJob.summary.id)}` : 'Select a recent job',
        copy: hasActiveJob
          ? 'Job status, timing, and storage stay visible while you inspect artifacts.'
          : 'Use Start to choose a recent job and route here.',
        body: [
          hasActiveJob
            ? createInfoGrid([
                { label: 'Status', value: formatJobStatus(activeJob.summary.status) },
                { label: 'Created', value: formatDateTime(activeJob.summary.created_at) },
                { label: 'Updated', value: formatDateTime(activeJob.summary.updated_at) },
                { label: 'Artifacts', value: String(activeJob.artifacts.length) },
              ])
            : createEmptyState({
                icon: 'J',
                title: 'No active job',
                copy: 'The Start workspace recent-jobs list is the intended entry point into artifacts.',
              }),
        ],
      }),
      createCard({
        kicker: 'Recent job shortcuts',
        title: 'Jump between runs',
        copy: 'Keep the most recent jobs close so the artifact trail stays fast to navigate.',
        body: [
          recentJobs.items.length > 0
            ? el('div', {
                className: 'job-list job-list-compact',
                children: recentJobs.items.slice(0, 4).map((job) =>
                  el('article', {
                    className: 'job-item',
                    children: [
                      el('div', {
                        children: [
                          el('p', { className: 'job-title', text: `${job.type} ${shortJobId(job.id)}` }),
                          el('p', { className: 'job-copy', text: formatDateTime(job.updated_at) }),
                        ],
                      }),
                      createButton({
                        label: 'Open',
                        action: 'open-job',
                        tone: 'ghost',
                        dataset: { jobId: job.id },
                      }),
                    ],
                  })
                ),
              })
            : createEmptyState({
                icon: '+',
                title: 'No tracked jobs yet',
                copy: 'Once jobs exist on the local API path, they will appear here automatically.',
              }),
        ],
      }),
    ],
    canvas: [
      createCard({
        kicker: 'Artifact board',
        title: 'Tracked outputs',
        copy: 'Artifacts, manifests, and storage details are grouped here instead of being scattered through the workflow.',
        surface: 'canvas',
        body: artifactBody,
      }),
      createCard({
        kicker: 'Manifest posture',
        title: 'Why this workspace exists',
        copy: 'Artifact and manifest views can deepen later without changing how Start routes users back into work.',
        surface: 'canvas',
        body: [
          createList([
            { label: 'No silent downloads', copy: 'Artifact actions stay explicit and traceable.', meta: 'Intentional' },
            { label: 'Manifest-first spine', copy: 'Artifact metadata stays central for previews and follow-up actions.', meta: 'Structural' },
            { label: 'Recent-job routing', copy: 'Start can reopen tracked work without reintroducing a monolithic viewer panel.', meta: 'Implemented' },
          ]),
        ],
      }),
    ],
  });
}

function createConsoleHero(state) {
  const recentJobs = state.data.recentJobs.items || [];
  const importBootstrap = ensureImportBootstrapState(state);
  const hasTrackedJobs = recentJobs.length > 0;
  const verifiedBracketAvailable = canLoadVerifiedBracket(state.data.examples);
  const canRunTracked = canRunStartTrackedPath(state);

  return el('section', {
    className: 'console-hero',
    children: [
      el('div', {
        className: 'console-hero-copy',
        children: [
          el('p', { className: 'section-kicker', text: 'Console · Start preparation' }),
          el('h2', { className: 'console-hero-title', text: 'Start the CAD automation review loop' }),
          el('p', {
            className: 'console-hero-description',
            text: 'Bring source context into the console first so Studio can stage review signals, readiness posture, package baselines, and export decisions in order.',
          }),
        ],
      }),
      el('div', {
        className: 'console-hero-panel',
        dataset: { hook: 'verified-bracket-card' },
        children: [
          el('p', { className: 'eyebrow', text: 'Start here' }),
          el('h3', { className: 'card-title', text: 'Start with a verified bracket' }),
          el('p', {
            className: 'card-copy',
            text: 'This example is the clean Stage 3 quality target. It should generate successfully and pass engineering quality.',
          }),
          el('p', {
            className: 'action-meta',
            text: createVerifiedBracketMeta(state.data.examples),
          }),
          el('p', {
            className: 'support-note',
            text: 'After loading, run a tracked create or report job to generate artifacts and review quality.',
          }),
          el('div', {
            className: 'start-tracked-path',
            dataset: { hook: 'start-tracked-primary-path' },
            children: [
              el('p', { className: 'eyebrow', text: 'Primary tracked path' }),
              el('p', {
                className: 'action-meta',
                text: startTrackedPathMeta(state),
              }),
              el('div', {
                className: 'console-hero-actions',
                children: [
                  createButton({
                    label: 'Run tracked create first',
                    action: 'start-run-tracked-create',
                    tone: 'primary',
                    disabled: !canRunTracked,
                    attrs: {
                      'aria-label': 'Run tracked create job for the loaded config',
                    },
                  }),
                  createButton({
                    label: 'Run tracked report',
                    action: 'start-run-tracked-report',
                    tone: 'ghost',
                    disabled: !canRunTracked,
                    attrs: {
                      'aria-label': 'Run tracked report job for the loaded config',
                    },
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'console-hero-actions',
            children: [
              createButton({
                label: 'Load verified bracket',
                action: 'load-verified-bracket',
                tone: 'primary',
                disabled: !verifiedBracketAvailable,
                attrs: {
                  'aria-label': 'Load verified bracket example quality_pass_bracket',
                },
              }),
              createButton({
                label: 'Open Model workspace',
                action: 'go-model',
                tone: 'ghost',
                attrs: {
                  'aria-label': 'Open Model workspace',
                },
              }),
            ],
          }),
          el('div', {
            className: 'console-example-fallback',
            children: [
              el('p', {
                className: 'inline-note',
                text: importBootstrap.modelPath || importBootstrap.modelFileName
                  ? 'Input context is partially staged. You can still load any checked-in example below.'
                  : 'Need a different starting point? The full example picker remains available.',
              }),
              createExamplesSelect(state),
              createButton({
                label: 'Load selected example',
                action: 'try-example',
                tone: 'ghost',
                disabled: state.data.examples.status !== 'ready' || state.data.examples.items.length === 0,
              }),
              createButton({
                label: hasTrackedJobs ? 'Open latest baseline' : 'Choose config file',
                action: hasTrackedJobs ? 'open-recent-job' : 'open-config',
                tone: 'ghost',
              }),
              el('input', {
                className: 'visually-hidden',
                attrs: {
                  id: 'start-config-file',
                  type: 'file',
                  accept: '.toml,.json,text/plain',
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function createConsoleWorkflowRail() {
  const steps = [
    { index: '01', label: 'Create or import & review', tone: 'ok', active: true },
    { index: '02', label: 'Compare revisions & plan', tone: 'info' },
    { index: '03', label: 'Receive results & onboard', tone: 'warn' },
  ];

  return createCard({
    kicker: 'Workflow progress',
    title: 'Choose one Local-first workflow',
    copy: 'Each workflow begins with explicit artifacts, derives one next safe action, and keeps runtime, generated outputs, and trust boundaries visible.',
    surface: 'canvas',
    body: [
      el('div', {
        className: 'workflow-progress',
        children: steps.map((step, index) =>
          el('div', {
            className: `workflow-step${step.active ? ' is-active' : ''}`,
            dataset: { tone: step.tone },
            children: [
              el('span', { className: 'workflow-step-index', text: step.index }),
              el('span', { className: 'workflow-step-label', text: step.label }),
              index < steps.length - 1 ? el('span', { className: 'workflow-step-line' }) : null,
            ].filter(Boolean),
          })
        ),
      }),
    ],
  });
}

function createConsoleGuidedWorkflowCard(state) {
  const workflows = deriveLocalFirstWorkflowGuidance(state);

  return createCard({
    kicker: 'Three guided workflows',
    title: 'Start from the artifact you actually have',
    copy: 'Studio derives the next safe action from tracked artifacts and explicit state. It never infers that evidence is trusted or readiness is clear.',
    body: [
      el('div', {
        className: 'local-first-workflow-grid',
        dataset: { hook: 'local-first-workflows' },
        children: workflows.map((workflow) => el('article', {
          className: 'local-first-workflow-card',
          dataset: { workflow: workflow.id, tone: workflow.tone },
          children: [
            el('p', { className: 'eyebrow', text: workflow.kicker }),
            el('h4', { className: 'action-title', text: workflow.title }),
            createInfoGrid([
              { label: 'Expected starting artifact', value: workflow.startingArtifact },
              { label: 'Current available artifacts', value: workflow.currentArtifacts },
              { label: 'Next safe action', value: workflow.nextSafeAction },
              { label: 'Runtime requirement', value: workflow.runtimeRequirement },
              { label: 'Generated outputs', value: workflow.generatedOutputs },
              { label: 'Safety boundary', value: workflow.safetyBoundary },
            ]),
            workflow.command ? el('code', { className: 'workflow-command', text: workflow.command }) : null,
            workflow.action ? createButton({
              label: workflow.actionLabel,
              action: workflow.action,
              tone: 'ghost',
            }) : null,
          ],
        })),
      }),
    ],
  });
}

function createCanonicalArtifactRefsList(artifactRefs = []) {
  return el('div', {
    className: 'canonical-artifact-refs',
    children: artifactRefs.map((ref) =>
      el('div', {
        className: 'canonical-artifact-ref',
        children: [
          el('div', {
            className: 'canonical-artifact-meta',
            children: [
              el('span', { className: 'canonical-artifact-label', text: ref.label }),
              ref.note ? el('p', { className: 'canonical-artifact-note', text: ref.note }) : null,
            ],
          }),
          el('div', {
            className: 'canonical-artifact-path-actions',
            children: [
              el('code', { className: 'canonical-path', text: ref.path }),
              el('div', {
                className: 'canonical-artifact-actions',
                children: [
                  ref.previewAction ? createButton({
                    label: ref.previewAction.label || 'Preview',
                    action: 'preview-canonical-artifact',
                    tone: 'ghost',
                    attrs: {
                      'aria-label': `Preview ${ref.label}`,
                      title: 'Preview',
                    },
                    dataset: {
                      canonicalPackageSlug: ref.slug,
                      canonicalArtifactKey: ref.key,
                      canonicalArtifactLabel: ref.label,
                    },
                  }) : null,
                  createButton({
                    label: ref.copyAction?.label || 'Copy repo path',
                    action: 'copy-canonical-artifact-path',
                    tone: 'ghost',
                    attrs: {
                      'aria-label': `Copy repo path: ${ref.path}`,
                      title: 'Copy repo path',
                    },
                    dataset: {
                      canonicalArtifactKey: ref.key,
                      canonicalArtifactPath: ref.path,
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function formatPreviewSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes)) return 'Unavailable';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createCanonicalArtifactPreviewPanel(preview) {
  if (!preview || preview.status === 'idle') return null;

  const isLoading = preview.status === 'loading';
  const isError = preview.status === 'error';

  return el('div', {
    className: `canonical-preview-panel${isError ? ' canonical-preview-panel-error' : ''}`,
    dataset: { hook: 'canonical-artifact-preview' },
    children: [
      el('div', {
        className: 'canonical-preview-header',
        children: [
          el('div', {
            children: [
              el('p', { className: 'eyebrow', text: 'Canonical artifact preview' }),
              el('h5', { className: 'canonical-preview-title', text: preview.label || preview.artifactKey || 'Preview' }),
            ],
          }),
          createButton({
            label: 'Close preview',
            action: 'close-canonical-artifact-preview',
            tone: 'ghost',
          }),
        ],
      }),
      isLoading ? el('p', { className: 'support-note', text: 'Loading preview...' }) : null,
      isError ? el('p', {
        className: 'support-note support-note-warn',
        text: preview.errorMessage || 'Preview failed',
      }) : null,
      !isLoading && !isError ? createInfoGrid([
        { label: 'Path', value: preview.path },
        { label: 'Content kind', value: preview.contentKind },
        { label: 'Content type', value: preview.contentType },
        { label: 'Size', value: formatPreviewSize(preview.sizeBytes) },
        { label: 'Truncated', value: preview.truncated ? 'Yes' : 'No' },
      ]) : null,
      !isLoading && !isError && preview.truncated ? el('p', {
        className: 'support-note support-note-warn',
        text: 'Preview truncated by server size limit.',
      }) : null,
      !isLoading && !isError && preview.warnings.length > 0 ? el('div', {
        className: 'canonical-preview-warnings',
        children: preview.warnings.map((warning) =>
          el('p', { className: 'support-note support-note-warn', text: warning })
        ),
      }) : null,
      !isLoading && !isError ? el('pre', {
        className: 'canonical-preview-content',
        attrs: { tabindex: '0' },
        text: preview.content,
      }) : null,
    ],
  });
}

function createCanonicalPackageCards(state) {
  const sectionModel = buildCanonicalPackageSectionModel(state.data.canonicalPackages);

  if (sectionModel.status === 'loading') {
    return createCard({
      kicker: 'Checked-in docs packages',
      title: sectionModel.title,
      copy: 'Loading read-only package cards from the local canonical packages endpoint.',
      body: [
        createEmptyState({
          icon: '...',
          title: 'Loading canonical packages',
          copy: 'Existing Studio examples and tracked artifact reopen stay available while package discovery loads.',
        }),
      ],
    });
  }

  if (sectionModel.status !== 'ready') {
    return createCard({
      kicker: 'Checked-in docs packages',
      title: sectionModel.title,
      copy: 'Canonical package discovery is optional for Studio startup.',
      body: [
        createEmptyState({
          icon: '!',
          title: 'Canonical packages unavailable',
          copy: sectionModel.message || 'Studio could not load read-only canonical package cards from the local API.',
        }),
      ],
    });
  }

  return createCard({
    kicker: 'Checked-in docs packages',
    title: sectionModel.title,
    copy: 'These first-user packages are repo-checked docs packages. They are separate from tracked jobs and expose copy-only repo path controls.',
    body: [
      el('div', {
        className: 'canonical-boundary-notes',
        children: sectionModel.boundaryNotes.map((note) =>
          el('p', { className: 'support-note', text: note })
        ),
      }),
      el('div', {
        className: 'canonical-package-grid',
        dataset: { hook: 'canonical-package-cards' },
        children: sectionModel.cards.map((card) =>
          el('article', {
            className: 'canonical-package-card',
            children: [
              el('div', {
                className: 'canonical-package-card-header',
                children: [
                  el('div', {
                    children: [
                      el('p', { className: 'eyebrow', text: card.slug }),
                      el('h4', { className: 'card-title', text: card.title }),
                    ],
                  }),
                  el('span', { className: 'pill pill-status-warn', text: card.readiness.status }),
                ],
              }),
              createInfoGrid([
                { label: 'Score', value: card.readiness.score },
                { label: 'Gate decision', value: card.readiness.gateDecision },
                { label: 'Source of truth', value: card.sourceOfTruthPath },
              ]),
              el('p', { className: 'canonical-callout', text: card.callout }),
              createCanonicalArtifactRefsList(card.artifactRefs),
              sectionModel.preview.slug === card.slug
                ? createCanonicalArtifactPreviewPanel(sectionModel.preview)
                : null,
            ],
          })
        ),
      }),
    ],
  });
}

function createConsoleQueueCard(state) {
  const recentJobs = state.data.recentJobs.items || [];
  const trackedRows = [
    {
      title: 'Recent review package',
      status: findLatestTrackedJob(state.data.recentJobs, REVIEW_CONSOLE_JOB_TYPES.review) ? 'Ready' : 'Pending',
      copy: 'Tracked review-ready output remains the first reopen target from the console.',
    },
    {
      title: 'Readiness package',
      status: findLatestTrackedJob(state.data.recentJobs, REVIEW_CONSOLE_JOB_TYPES.readiness) ? 'Ready' : 'Pending',
      copy: 'Go/hold packaging stays visible as soon as readiness-backed output is recorded.',
    },
    {
      title: 'Compare and stabilization',
      status: findLatestTrackedJob(state.data.recentJobs, REVIEW_CONSOLE_JOB_TYPES.compare) ? 'Ready' : 'Needs baseline',
      copy: 'Use active and baseline runs from the Package workspace when compare or stabilization is needed.',
    },
  ];

  return createCard({
    kicker: 'Live queue and status',
    title: 'Decision trail posture',
    copy: 'Empty states stay intentional here: even before artifacts exist, the console makes pending review, readiness, and packaging states explicit.',
    surface: 'canvas',
    body: [
      el('div', {
        className: 'queue-stack',
        children: trackedRows.map((row) =>
          el('article', {
            className: 'queue-panel',
            children: [
              el('div', {
                className: 'queue-panel-header',
                children: [
                  el('h3', { className: 'card-title', text: row.title }),
                  el('span', { className: 'pill', text: row.status }),
                ],
              }),
              el('p', { className: 'card-copy', text: row.copy }),
            ],
          })
        ),
      }),
      recentJobs.length > 0
        ? el('div', {
            className: 'output-queue',
            children: recentJobs.slice(0, 3).map((job) =>
              el('article', {
                className: 'queue-row',
                children: [
                  el('div', {
                    className: 'queue-row-copy',
                    children: [
                      el('p', { className: 'queue-row-title', text: `${job.type} ${shortJobId(job.id)}` }),
                      el('p', { className: 'queue-row-meta', text: formatRecentJobQualityLine(job, shortJobId(job.id)) }),
                    ],
                  }),
                  el('span', { className: 'pill', text: recentJobPillLabel(job) }),
                ],
              })
            ),
          })
        : createEmptyState({
            icon: 'Q',
            title: 'No tracked queue yet',
            copy: 'As soon as tracked review, readiness, package, or compare runs exist, the console will surface them here as the fastest re-entry path.',
          }),
    ],
  });
}

function guidedImportStepSection(step, currentStep, children) {
  return el('section', {
    className: 'guided-import-step',
    attrs: {
      tabindex: '-1',
      ...(step !== currentStep ? { hidden: true } : {}),
    },
    dataset: {
      importGuidedStep: step,
      workflowStep: `import-${step}`,
    },
    children,
  });
}

function createImportAdditionalMaterial(importBootstrap) {
  return createDisclosure({
    summary: t('studio.import.guided.additional.summary'),
    body: [
      el('p', {
        className: 'guided-import-detail-copy',
        text: t('studio.import.guided.additional.copy'),
      }),
      el('label', {
        className: 'studio-field',
        children: [
          el('span', { className: 'studio-field-label', text: t('studio.import.guided.additional.model-path') }),
          el('input', {
            className: 'studio-input',
            attrs: {
              type: 'text',
              placeholder: 'tests/fixtures/imports/simple_bracket.step',
              value: importBootstrap.modelPath || '',
            },
            dataset: { field: 'import-model-path' },
          }),
        ],
      }),
      el('label', {
        className: 'studio-field',
        children: [
          el('span', { className: 'studio-field-label', text: t('studio.import.guided.additional.bom') }),
          el('input', {
            className: 'studio-input',
            attrs: { type: 'text', value: importBootstrap.bomPath || '' },
            dataset: { field: 'import-bom-path' },
          }),
        ],
      }),
      el('label', {
        className: 'studio-field',
        children: [
          el('span', { className: 'studio-field-label', text: t('studio.import.guided.additional.inspection') }),
          el('input', {
            className: 'studio-input',
            attrs: { type: 'text', value: importBootstrap.inspectionPath || '' },
            dataset: { field: 'import-inspection-path' },
          }),
        ],
      }),
      el('label', {
        className: 'studio-field',
        children: [
          el('span', { className: 'studio-field-label', text: t('studio.import.guided.additional.quality') }),
          el('input', {
            className: 'studio-input',
            attrs: { type: 'text', value: importBootstrap.qualityPath || '' },
            dataset: { field: 'import-quality-path' },
          }),
        ],
      }),
      createSecondaryAction({
        label: t('studio.import.guided.additional.check-path'),
        action: 'preview-import-bootstrap',
        disabled: importBootstrap.status === 'loading',
      }),
    ],
  });
}

function importAssumptionCount(importBootstrap) {
  const diagnostics = importBootstrap.preview?.bootstrap?.import_diagnostics || {};
  const directAssumptions = [
    diagnostics.import_kind,
    diagnostics.unit_assumption?.unit,
    Number.isFinite(Number(diagnostics.body_count)) ? diagnostics.body_count : null,
  ].filter((value) => value !== null && value !== undefined && value !== '').length;
  const warningCount = Number(importBootstrap.preview?.bootstrap?.bootstrap_warnings?.warning_count) || 0;
  return Math.max(directAssumptions, warningCount, 1);
}

function createGuidedImportReviewWorkspace(state) {
  const importBootstrap = ensureImportBootstrapState(state);
  const guidedFlow = ensureImportGuidedFlowState(importBootstrap);
  const guidedError = resolveImportGuidedError(importBootstrap, t);
  const guidedStep = resolveImportGuidedStep(importBootstrap);
  const detailedSteps = createImportGuidedStepStates(importBootstrap);
  const activeDetailedStep = detailedSteps.find((step) => step.state === 'current')?.id || guidedStep;
  const groupedStepIndex = activeDetailedStep === 'select_file'
    ? 0
    : ['diagnostics', 'confirm'].includes(activeDetailedStep)
      ? 1
      : 2;
  const stepLabels = [
    t('studio.import.guided.step.file'),
    t('studio.import.guided.step.check'),
    t('studio.import.guided.step.result'),
  ];
  const groupedSteps = stepLabels.map((label, index) => ({
    id: ['select_file', 'import_check', 'review_result'][index],
    label,
    state: index < groupedStepIndex ? 'complete' : index === groupedStepIndex ? 'current' : 'upcoming',
  }));
  const preview = importBootstrap.preview;
  const diagnostics = preview?.bootstrap?.import_diagnostics || {};
  const seed = preview?.tracked_review_seed || {};
  const canStartReview = Boolean(seed.context_path && seed.model_path);
  const hasSelectedLocalFile = Boolean(importBootstrap.modelFile && importBootstrap.modelFileName);
  const sourceLabel = importBootstrap.modelFileName
    || importBootstrap.modelPath
    || diagnostics.source_model_path
    || t('studio.import.guided.file.none');
  const latestReviewJob = state.data.recentJobs?.items?.find(
    (job) => job.id === importBootstrap.lastJobId,
  ) || importBootstrap.reviewJob;
  const reviewStatus = latestReviewJob?.status || 'queued';
  const reviewStatusLabel = reviewStatus === 'succeeded'
    ? t('studio.import.guided.result.completed')
    : reviewStatus === 'failed'
      ? t('studio.import.guided.result.failed')
      : t('studio.import.guided.result.running');
  const reviewQualityLabel = reviewStatus === 'succeeded'
    ? t('studio.import.guided.result.quality-ready')
    : reviewStatus === 'failed'
      ? t('studio.import.guided.result.quality-unavailable')
      : t('studio.import.guided.result.quality-pending');
  const reviewDecisionLabel = reviewStatus === 'succeeded'
    ? t('studio.import.guided.result.decision-ready')
    : reviewStatus === 'failed'
      ? t('studio.import.guided.result.decision-failed')
      : t('studio.import.guided.result.decision-running');
  const reviewIssuesLabel = reviewStatus === 'failed'
    ? t('studio.import.guided.result.issues-failed')
    : reviewStatus === 'succeeded'
      ? t('studio.import.guided.result.issues-ready')
      : t('studio.import.guided.result.issues-pending');

  return el('section', {
    className: 'guided-import-workspace',
    dataset: { hook: 'guided-import-workspace' },
    children: [
      createSectionHeader({
        kicker: t('studio.import.guided.kicker'),
        title: t('studio.import.guided.title'),
        description: t('studio.import.guided.description'),
      }),
      createTaskStepper({
        label: t('studio.import.guided.progress'),
        steps: groupedSteps,
      }),
      el('p', {
        className: 'visually-hidden',
        text: groupedSteps[groupedStepIndex].label,
        attrs: { role: 'status', 'aria-live': 'polite' },
        dataset: { hook: 'guided-import-progress' },
      }),
      el('input', {
        className: 'visually-hidden',
        attrs: {
          id: 'guided-import-model-file',
          type: 'file',
          accept: '.step,.stp,.fcstd',
        },
        dataset: { hook: 'guided-import-file' },
      }),
      el('div', {
        className: 'guided-import-flow',
        children: [
          guidedImportStepSection('select_file', guidedStep, [
            el('h2', {
              className: 'guided-import-step-title',
              text: t('studio.import.guided.file.title'),
              dataset: { hook: 'guided-import-step-title' },
            }),
            el('p', {
              className: 'guided-import-step-copy',
              text: t('studio.import.guided.file.copy'),
            }),
            el('p', {
              className: 'inline-note',
              text: t('studio.import.guided.file.limit'),
            }),
            createActionSummary({
              actionId: 'check-imported-cad',
              title: t('studio.import.guided.file.summary-title'),
              description: t('studio.import.guided.file.summary-copy'),
              requiredInputs: [hasSelectedLocalFile ? sourceLabel : t('studio.import.guided.file.required-input')],
              expectedOutputs: [t('studio.import.guided.file.expected-output')],
              launchesFreeCAD: t('studio.import.guided.file.freecad'),
              fileEffects: t('studio.import.guided.file.files'),
              networkAccess: t('studio.import.guided.local-api'),
              provider: t('studio.import.guided.none'),
              cost: t('studio.import.guided.none'),
              humanConfirmationRequired: true,
              safetyNotes: t('studio.import.guided.file.safety'),
            }),
            guidedError
              ? createInlineStatus({
                  title: t('studio.import.guided.error.title'),
                  copy: guidedError,
                  tone: 'bad',
                })
              : null,
            hasSelectedLocalFile
              ? createInlineStatus({
                  title: t('studio.import.guided.file.selected-title'),
                  copy: sourceLabel,
                  tone: 'info',
                })
              : null,
            el('div', {
              className: 'guided-import-step-actions',
              children: [
                hasSelectedLocalFile
                  ? createPrimaryAction({
                      label: t('studio.import.guided.file.check-action'),
                      action: 'check-import-model-file',
                      dataset: { hook: 'guided-import-check' },
                    })
                  : null,
                createSecondaryAction({
                  label: hasSelectedLocalFile
                    ? t('studio.import.guided.file.change-action')
                    : t('studio.import.guided.file.choose-action'),
                  action: 'choose-import-model-file',
                  dataset: { hook: 'guided-import-choose' },
                }),
              ].filter(Boolean),
            }),
            createImportAdditionalMaterial(importBootstrap),
          ]),
          guidedImportStepSection('diagnostics', guidedStep, [
            el('h2', {
              className: 'guided-import-step-title',
              text: t('studio.import.guided.diagnostics.title'),
              dataset: { hook: 'guided-import-step-title' },
            }),
            el('p', {
              className: 'guided-import-step-copy',
              text: t('studio.import.guided.diagnostics.copy'),
            }),
            createInlineStatus({
              title: t('studio.import.guided.diagnostics.status-title'),
              copy: sourceLabel,
              tone: 'info',
            }),
          ]),
          guidedImportStepSection('confirm', guidedStep, [
            el('h2', {
              className: 'guided-import-step-title',
              text: t('studio.import.guided.confirm.title'),
              dataset: { hook: 'guided-import-step-title' },
            }),
            el('p', {
              className: 'guided-import-step-copy',
              text: t('studio.import.guided.confirm.copy'),
            }),
            createInfoGrid([
              { label: t('studio.import.guided.confirm.file'), value: t('studio.import.guided.confirm.readable') },
              {
                label: t('studio.import.guided.confirm.assumptions'),
                value: t('studio.import.guided.confirm.assumption-count', { count: importAssumptionCount(importBootstrap) }),
              },
              { label: t('studio.import.guided.confirm.review'), value: t('studio.import.guided.confirm.ready') },
            ]),
            createActionSummary({
              actionId: 'start-imported-cad-review',
              title: t('studio.import.guided.confirm.summary-title'),
              description: t('studio.import.guided.confirm.summary-copy'),
              requiredInputs: [sourceLabel, t('studio.import.guided.confirm.required-assumptions')],
              expectedOutputs: [t('studio.import.guided.confirm.expected-output')],
              launchesFreeCAD: t('studio.import.guided.confirm.freecad'),
              fileEffects: t('studio.import.guided.confirm.files'),
              networkAccess: t('studio.import.guided.local-api'),
              provider: t('studio.import.guided.none'),
              cost: t('studio.import.guided.none'),
              humanConfirmationRequired: true,
              safetyNotes: t('studio.import.guided.confirm.safety'),
            }),
            guidedError
              ? createInlineStatus({
                  title: t('studio.import.guided.error.title'),
                  copy: guidedError,
                  tone: 'bad',
                })
              : null,
            !canStartReview && !guidedError
              ? createInlineStatus({
                  title: t('studio.import.guided.confirm.blocked-title'),
                  copy: t('studio.import.guided.confirm.blocked-copy'),
                  tone: 'warn',
                  attrs: { id: 'guided-import-start-review-status' },
                  action: {
                    label: t('studio.import.guided.confirm.change-file'),
                    action: 'choose-import-model-file',
                  },
                })
              : null,
            el('div', {
              className: 'guided-import-step-actions',
              children: [
                createPrimaryAction({
                  label: t('studio.import.guided.confirm.action'),
                  action: 'submit-import-review',
                  disabled: !canStartReview || importBootstrap.submitting,
                  attrs: !canStartReview
                    ? { 'aria-describedby': 'guided-import-start-review-status' }
                    : {},
                  dataset: { hook: 'guided-import-start-review' },
                }),
                createSecondaryAction({
                  label: t('studio.import.guided.confirm.change-file'),
                  action: 'choose-import-model-file',
                }),
              ],
            }),
            createDisclosure({
              summary: t('studio.import.guided.confirm.details'),
              body: [createImportBootstrapCard(state)],
            }),
          ]),
          guidedImportStepSection('running', guidedStep, [
            el('h2', {
              className: 'guided-import-step-title',
              text: t('studio.import.guided.running.title'),
              dataset: { hook: 'guided-import-step-title' },
            }),
            el('p', {
              className: 'guided-import-step-copy',
              text: t('studio.import.guided.running.copy'),
            }),
            createInlineStatus({
              title: t('studio.import.guided.running.status-title'),
              copy: t('studio.import.guided.running.status-copy'),
              tone: 'info',
            }),
          ]),
          guidedImportStepSection('result', guidedStep, [
            el('h2', {
              className: 'guided-import-step-title',
              text: t('studio.import.guided.result.title'),
              dataset: { hook: 'guided-import-step-title' },
            }),
            el('p', {
              className: 'guided-import-step-copy',
              text: t('studio.import.guided.result.copy'),
            }),
            createInfoGrid([
              { label: t('studio.import.guided.result.execution'), value: reviewStatusLabel },
              { label: t('studio.import.guided.result.quality'), value: reviewQualityLabel },
              { label: t('studio.import.guided.result.primary'), value: t('studio.import.guided.result.primary-value') },
            ]),
            createInfoGrid([
              { label: t('studio.import.guided.result.decision'), value: reviewDecisionLabel },
              { label: t('studio.import.guided.result.issues'), value: reviewIssuesLabel },
              { label: t('studio.import.guided.result.next'), value: t('studio.import.guided.result.next-value') },
            ]),
            createResultCard({
              title: t('studio.import.guided.result.card-title'),
              meta: t('studio.import.guided.result.card-meta'),
              copy: t('studio.import.guided.result.card-copy'),
              primaryAction: {
                label: t('studio.import.guided.result.view'),
                action: 'import-view-review-result',
                disabled: !importBootstrap.lastJobId || reviewStatus !== 'succeeded',
                dataset: {
                  hook: 'guided-import-view-result',
                  jobId: importBootstrap.lastJobId,
                },
              },
              menuLabel: t('studio.import.guided.result.more'),
              menuItems: [
                {
                  label: t('studio.import.guided.result.files'),
                  action: 'import-open-result-files',
                  disabled: !importBootstrap.lastJobId,
                },
                {
                  label: t('studio.import.guided.result.start-another'),
                  action: 'import-start-another',
                },
              ],
            }),
            createDisclosure({
              summary: t('studio.import.guided.result.supporting'),
              body: preview?.artifacts?.length
                ? [createArtifactList(preview.artifacts.map((artifact) => ({
                    title: artifact.file_name || artifact.key,
                    meta: artifact.key,
                    path: artifact.path,
                  })))]
                : [el('p', { className: 'support-note', text: t('studio.import.guided.result.supporting-empty') })],
            }),
          ]),
        ],
      }),
    ],
  });
}

function createAdvancedConsoleWorkspace(state) {
  return el('section', {
    className: 'workspace-shell console-workspace',
    children: [
      createGuidedImportReviewWorkspace(state),
      el('details', {
        className: 'guided-import-advanced-disclosure',
        dataset: { hook: 'import-advanced-tools' },
        children: [
          el('summary', {
            className: 'guided-import-advanced-summary',
            text: t('studio.import.guided.advanced.summary'),
          }),
          el('p', {
            className: 'guided-import-detail-copy',
            text: t('studio.import.guided.advanced.copy'),
          }),
          el('div', {
            className: 'guided-import-advanced-content',
            children: [
              createConsoleHero(state),
              createStartActionsCard(state),
              createConsoleWorkflowRail(),
              createCanonicalPackageCards(state),
              el('div', {
                className: 'console-grid',
                children: [
                  el('div', {
                    className: 'console-column console-column-left',
                    children: [
                      createConsoleGuidedWorkflowCard(state),
                      createQuickLinksCard(state),
                      createRecentJobsCard(state),
                    ],
                  }),
                  el('div', {
                    className: 'console-column console-column-right',
                    children: [
                      createConsoleQueueCard(state),
                      createDecisionPackagesCard(state),
                      createRuntimeHealthCard(state),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

const workspaceRenderers = {
  start: createHomeWorkspace,
  history: createRunHistoryWorkspace,
  console: createAdvancedConsoleWorkspace,
  review: renderReviewWorkspace,
  artifacts: renderArtifactsWorkspace,
  model: createModelWorkspace,
  drawing: createDrawingWorkspace,
};

export const workspaceOrder = STUDIO_SURFACE_ROUTES;

export const workspaceDefinitions = Object.fromEntries(
  getStudioSurfaceMetadata().map((surface) => [
    surface.route,
    {
      label: surface.label,
      summary: surface.summary,
      labelI18nKey: surface.labelI18nKey,
      summaryI18nKey: surface.summaryI18nKey,
      render: workspaceRenderers[surface.route],
    },
  ])
);
