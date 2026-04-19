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
  createSectionHeader,
  createSplitPane,
  createStatusStrip,
  createActionGrid,
  el,
} from './renderers.js';
import {
  deriveModelTrackedRunPresentation,
  ensureModelTrackedRunState,
} from './model-tracked-runs.js';
import { getStudioExampleValue } from './examples.js';
import { renderReviewWorkspace } from './review-workspace.js';
import { renderArtifactsWorkspace } from './artifacts-workspace.js';

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

function formatJobStatus(status) {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortJobId(id = '') {
  if (!id) return 'Unknown job';
  return id.length > 8 ? id.slice(0, 8) : id;
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
  return {
    status: 'idle',
    modelPath: '',
    modelFileName: '',
    bomPath: '',
    inspectionPath: '',
    qualityPath: '',
    preview: null,
    errorMessage: '',
    submitting: false,
    ...(state.data.importBootstrap || {}),
  };
}

function importBootstrapMeta(importBootstrap) {
  if (importBootstrap.status === 'loading') return 'Generating diagnostics, warnings, and draft bootstrap artifacts...';
  if (importBootstrap.status === 'ready') {
    const warnings = importBootstrap.preview?.bootstrap?.bootstrap_warnings?.warning_count ?? 0;
    return `${warnings} warning${warnings === 1 ? '' : 's'} visible before tracked review starts`;
  }
  if (importBootstrap.status === 'error') return importBootstrap.errorMessage || 'Bootstrap preview failed.';
  if (importBootstrap.modelFileName) return `Local file selected: ${importBootstrap.modelFileName}`;
  if (importBootstrap.modelPath) return `Project path selected: ${importBootstrap.modelPath}`;
  return 'Use a checked-in path or a local file to bring existing CAD into the review loop.';
}

function importBootstrapPrimaryLabel(importBootstrap) {
  return importBootstrap.qualityPath
    ? 'Start review from imported STEP + quality context'
    : 'Start review from imported STEP';
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
          text: importBootstrap.errorMessage || 'Bootstrap preview failed.',
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
              selected: getStudioExampleValue(example) === state.data.examples.selectedId,
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

function createStartActionsCard(state) {
  const { examples, recentJobs } = state.data;
  const importBootstrap = ensureImportBootstrapState(state);
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
          copy: 'Studio surfaces geometry, inspection, and quality outputs as tracked evidence instead of recreating D or C reasoning.',
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
          kicker: 'Import existing STEP / FCStd',
          title: 'Start review from imported STEP',
          copy: 'Bootstrap imported CAD into the review loop with diagnostics, warnings, confidence, and a tracked handoff. This gate stays review-first and does not pretend to reverse-engineer design intent.',
          meta: importBootstrapMeta(importBootstrap),
          controls: [
            el('input', {
              className: 'studio-input',
              attrs: {
                type: 'text',
                placeholder: 'Project-relative path like tests/fixtures/imports/simple_bracket.step',
                value: importBootstrap.modelPath || '',
              },
              dataset: { field: 'import-model-path' },
            }),
            createButton({
              label: importBootstrap.modelFileName ? `Use local file: ${importBootstrap.modelFileName}` : 'Choose local STEP / FCStd',
              action: 'choose-import-model-file',
              tone: 'ghost',
            }),
            el('input', {
              className: 'visually-hidden',
              attrs: {
                id: 'start-import-model-file',
                type: 'file',
                accept: '.step,.stp,.fcstd',
              },
            }),
            el('input', {
              className: 'studio-input',
              attrs: {
                type: 'text',
                placeholder: 'Optional BOM path (csv/json)',
                value: importBootstrap.bomPath || '',
              },
              dataset: { field: 'import-bom-path' },
            }),
            el('input', {
              className: 'studio-input',
              attrs: {
                type: 'text',
                placeholder: 'Optional inspection path (csv/json)',
                value: importBootstrap.inspectionPath || '',
              },
              dataset: { field: 'import-inspection-path' },
            }),
            el('input', {
              className: 'studio-input',
              attrs: {
                type: 'text',
                placeholder: 'Optional quality path (csv/json)',
                value: importBootstrap.qualityPath || '',
              },
              dataset: { field: 'import-quality-path' },
            }),
            createButton({
              label: importBootstrap.status === 'loading' ? 'Previewing bootstrap...' : 'Preview bootstrap gate',
              action: 'preview-import-bootstrap',
              tone: 'primary',
              disabled: importBootstrap.status === 'loading' || importBootstrap.submitting,
            }),
            createButton({
              label: importBootstrap.submitting ? 'Submitting tracked review...' : importBootstrapPrimaryLabel(importBootstrap),
              action: 'submit-import-review',
              tone: 'ghost',
              disabled: !importBootstrap.preview || importBootstrap.status === 'loading' || importBootstrap.submitting,
            }),
          ],
        },
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
          title: 'Reopen tracked evidence',
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
          title: 'Stage compare-rev and stabilization',
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
          title: 'Package release-ready outputs',
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
                        text: `${job.type} ${shortJobId(job.id)}`,
                      }),
                      el('span', {
                        className: 'pill',
                        text: formatJobStatus(job.status),
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
              selected: getStudioExampleValue(example) === state.data.examples.selectedId,
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

function createModelWorkspace(state) {
  const model = ensureModelTrackedRunState(state.data.model);
  const promptReady = Boolean(model.promptMode || model.promptText);
  const buildTone = model.buildState === 'success' ? 'ok' : model.buildState === 'error' ? 'bad' : model.buildState === 'building' ? 'warn' : 'info';
  const trackedRun = deriveModelTrackedRunPresentation({
    model,
    recentJobs: state.data.recentJobs.items || [],
    jobMonitor: state.data.jobMonitor || {},
  });

  return el('section', {
    className: 'workspace-shell model-workbench',
    children: [
      createSectionHeader({
        kicker: 'Model workspace',
        title: 'Choose input, build, then inspect the model result',
        description: 'The model workbench keeps input, build posture, viewport inspection, metadata, parts, and motion in one place without leading with the TOML editor.',
        badges: [
          { label: model.configText ? 'Input loaded' : 'Input pending', tone: model.configText ? 'ok' : 'warn' },
          { label: promptReady ? 'Assistant ready' : 'Assistant available', tone: 'info' },
          { label: `Preview ${model.buildState || 'idle'}`, tone: buildTone },
          { label: trackedRun.badgeLabel, tone: trackedRun.tone },
        ],
      }),
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
        className: 'model-grid',
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
                            label: 'Preview Build',
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
              createCard({
                kicker: 'Assistant',
                title: 'Prompt-based design stays secondary',
                copy: 'Use the assistant to draft or revise TOML, but keep the build-and-inspect loop in the foreground.',
                body: [
                  createDisclosure({
                    summary: 'Prompt-assisted design',
                    open: promptReady,
                    body: [
                      el('textarea', {
                        className: 'studio-textarea studio-textarea-compact',
                        text: model.promptText || '',
                        dataset: {
                          hook: 'assistant-textarea',
                          field: 'prompt-text',
                        },
                        attrs: {
                          placeholder: 'Describe geometry intent, manufacturing assumptions, and what should be generated.',
                          rows: 6,
                        },
                      }),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: 'TOML 초안 생성',
                            action: 'model-draft-prompt',
                            tone: 'ghost',
                            dataset: { hook: 'draft-prompt' },
                          }),
                        ],
                      }),
                      el('div', { className: 'studio-note-stack', dataset: { hook: 'assistant-report' } }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'model-column model-column-center',
            children: [
              createCard({
                kicker: '뷰포트',
                title: '최신 빌드 결과를 검토하세요',
                copy: '이제 모델 캔버스가 작업 영역의 중심이어서 빌드 직후 결과를 바로 확인할 수 있습니다.',
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
                          el('span', { text: '와이어프레임' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-toggle',
                        children: [
                          el('input', {
                            dataset: { hook: 'edges' },
                            attrs: { type: 'checkbox', checked: true },
                          }),
                          el('span', { text: '에지' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-range-row',
                        children: [
                          el('span', { text: '불투명도' }),
                          el('input', {
                            dataset: { hook: 'opacity' },
                            attrs: { type: 'range', min: 10, max: 100, value: 100 },
                          }),
                        ],
                      }),
                      createButton({
                        label: '스크린샷',
                        action: 'model-screenshot',
                        tone: 'ghost',
                        dataset: { hook: 'screenshot' },
                      }),
                      createButton({
                        label: '뷰 맞춤',
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
                    text: '뷰포트가 중심에 남아 있어서 워크플로우가 입력 선택 → 빌드 → 결과 검토 순서로 읽힙니다.',
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'model-column model-column-right',
            children: [
              createCard({
                kicker: '모델 메타데이터',
                title: '운영용 모델 정보',
                copy: '메타데이터는 임의의 텍스트 덤프가 아니라 빌드 피드백으로 정리됩니다.',
                body: [
                  el('div', { className: 'model-info studio-side-panel', dataset: { hook: 'model-info' } }),
                ],
              }),
              createCard({
                kicker: '부품',
                title: '부품/어셈블리 구조',
                copy: '부품 선택, 재질 스와치, 부품별 검토는 입력 패널이 아니라 뷰포트 옆에 유지됩니다.',
                body: [
                  el('div', { className: 'parts-list studio-side-panel', dataset: { hook: 'parts-list' } }),
                ],
              }),
              createCard({
                kicker: '빌드 로그',
                title: '빌드 파이프라인 출력',
                copy: '로그는 일반 콘솔 잡음이 아니라 파이프라인의 운영 피드백으로 정리됩니다.',
                body: [
                  el('div', { className: 'build-log studio-side-panel', dataset: { hook: 'build-log' } }),
                ],
              }),
              createCard({
                kicker: '모션 제어',
                title: '모션 데이터가 있으면 애니메이션을 유지합니다',
                copy: '모델에 모션 데이터가 있으면 동일한 재생 동작을 여기서 계속 사용할 수 있습니다.',
                body: [
                  el('div', {
                    className: 'animation-controls studio-side-panel',
                    dataset: { hook: 'animation-controls' },
                    children: [
                      el('div', {
                        className: 'anim-btn-row',
                        children: [
                          createButton({ label: '재생', action: 'play', tone: 'ghost', dataset: { hook: 'play' } }),
                          createButton({ label: '일시정지', action: 'pause', tone: 'ghost', dataset: { hook: 'pause' } }),
                          createButton({ label: '재설정', action: 'reset-motion', tone: 'ghost', dataset: { hook: 'reset-motion' } }),
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
        kicker: '도면 작업 영역',
        title: 'FreeCAD 도면은 시트 중심으로 유지됩니다',
        description: '예전 오버레이 흐름으로 떨어지지 않고 전용 작업대에서 제조용 시트를 생성, 검토, 수정하세요.',
        badges: [
          { label: hasConfig ? '설정 로드됨' : '설정 필요', tone: hasConfig ? 'ok' : 'warn' },
          { label: `도면 ${drawingStatus === 'ready' ? '준비됨' : drawingStatus === 'error' ? '오류' : drawingStatus === 'generating' ? '생성 중' : '대기'}`, tone },
          { label: 'BOM 및 QA 보조 패널', tone: 'info' },
        ],
      }),
      el('div', {
        className: 'drawing-status-grid',
        children: [
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-source-surface', tone: hasConfig ? 'ok' : 'warn' },
            children: [
              el('h3', { className: 'model-status-title', text: hasConfig ? '설정 준비됨' : '설정 대기 중' }),
              el('p', { className: 'model-status-copy', text: hasConfig ? '이 작업 영역은 공유된 설정 상태에서 바로 시트를 생성할 수 있습니다.' : '시트를 생성하기 전에 여기서 예제를 불러오거나 설정 파일을 여세요.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-runtime-surface', tone: 'info' },
            children: [
              el('h3', { className: 'model-status-title', text: '런타임 대기 중' }),
              el('p', { className: 'model-status-copy', text: '도면 미리보기와 추적 시트 실행은 Studio의 다른 화면과 같은 런타임과 작업 모델을 사용합니다.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-job-surface', tone },
            children: [
              el('h3', { className: 'model-status-title', text: drawingStatus === 'generating' ? '생성 중' : '아직 도면이 없습니다' }),
              el('p', { className: 'model-status-copy', text: 'Preview Drawing은 로컬에서 빠르게 동작하고, 추적 도면 실행은 모니터링되는 작업으로 전달됩니다.' }),
            ],
          }),
          el('article', {
            className: 'model-status-surface',
            dataset: { hook: 'drawing-result-surface', tone: 'info' },
            children: [
              el('h3', { className: 'model-status-title', text: '시트 준비 대기' }),
              el('p', { className: 'model-status-copy', text: '첫 렌더링 이후 BOM, 주석, QA, 치수 상태가 여기에 요약됩니다.' }),
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
                kicker: '소스',
                title: '시트 입력 소스를 선택하세요',
                copy: '도면 작업 영역에서 예제나 설정을 불러오고, 형상이나 전체 TOML을 실제로 수정할 때만 모델로 이동하세요.',
                body: [
                  el('div', {
                    className: 'action-controls',
                    children: [
                      createModelExampleSelect(state),
                      el('div', {
                        className: 'model-action-row',
                        children: [
                          createButton({
                            label: '예제 불러오기',
                            action: 'drawing-load-example',
                            tone: 'primary',
                          }),
                          createButton({
                            label: '설정 파일 열기',
                            action: 'drawing-open-config',
                            tone: 'ghost',
                          }),
                          createButton({
                            label: '모델에서 편집',
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
                kicker: '미리보기 vs 추적 실행',
                title: '시트를 준비한 뒤 실행 경로를 고르세요',
                copy: 'Preview Drawing은 빠른 시트 중심 반복 작업을 유지합니다. Run Tracked Draw Job은 현재 TOML과 도면 설정을 일반 작업 파이프라인과 산출물 타임라인으로 전달합니다.',
                body: [
                  el('div', {
                    className: 'drawing-preset-group',
                    children: [
                      el('p', { className: 'info-label', text: '보기 프리셋' }),
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
                          el('span', { className: 'info-label', text: '시트 축척' }),
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
                          el('span', { text: '단면 보조' }),
                        ],
                      }),
                      el('label', {
                        className: 'studio-check-row',
                        children: [
                          el('input', {
                            dataset: { hook: 'drawing-detail-assist' },
                            attrs: { type: 'checkbox' },
                          }),
                          el('span', { text: '상세도 보조' }),
                        ],
                      }),
                    ],
                  }),
                  el('p', {
                    className: 'inline-note',
                    dataset: { hook: 'drawing-summary' },
                    text: 'Preview Drawing은 로컬에서 빠르게 동작합니다. Run Tracked Draw Job은 현재 시트 설정을 추적 작업과 산출물로 게시합니다.',
                  }),
                  el('div', {
                    className: 'model-action-row',
                    children: [
                      createButton({
                        label: '도면 미리보기',
                        action: 'drawing-generate',
                        tone: 'primary',
                        dataset: { hook: 'drawing-generate' },
                      }),
                      createButton({
                        label: '추적 도면 실행',
                        action: 'drawing-run-tracked',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-tracked-run' },
                      }),
                      createButton({
                        label: '시트 맞춤',
                        action: 'drawing-fit',
                        tone: 'ghost',
                        dataset: { hook: 'drawing-fit-side' },
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
                kicker: '도면 캔버스',
                title: '시트 보기',
                copy: '여기서는 시트가 중심 표면이며, 도면 검토에 필요한 제어만 남깁니다.',
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
                        label: '맞춤',
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
                            title: '아직 도면이 없습니다',
                            copy: '빠른 반복에는 Preview Drawing을, 현재 TOML과 시트 설정을 작업 대기열에 넣으려면 Run Tracked Draw Job을 사용하세요.',
                          }),
                        ],
                      }),
                      el('div', {
                        className: 'drawing-canvas',
                        dataset: { hook: 'drawing-canvas' },
                      }),
                    ],
                  }),
                  el('p', {
                    className: 'inline-note',
                    dataset: { hook: 'drawing-canvas-caption' },
                    text: '드래그로 이동하고, 마우스 휠로 확대/축소하고, 치수 텍스트를 클릭해 편집 루프를 시트에 붙여 두세요.',
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
                copy: '제조용 부품 구조는 시트 아래가 아니라 옆에 유지됩니다.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-bom' } }),
                ],
              }),
              createCard({
                kicker: '주석',
                title: '메모 및 콜아웃',
                copy: '일반 메모와 도면 계획 콜아웃은 문서화 보조 패널로 계속 보입니다.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-annotations' } }),
                ],
              }),
              createCard({
                kicker: 'QA 요약',
                title: '시트 준비 상태',
                copy: '반복 작업 중에도 도면 점수와 치수 상태를 계속 볼 수 있습니다.',
                body: [
                  el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-qa' } }),
                ],
              }),
              createCard({
                kicker: '치수 반복 작업',
                title: '편집 가능한 치수와 이력',
                copy: '기존 편집 루프는 시트에 그대로 연결되고, 오른쪽 패널에서 현재 값과 변경 이력을 확인할 수 있습니다.',
                body: [
                  createDisclosure({
                    summary: '현재 편집 가능한 치수',
                    open: true,
                    body: [
                      el('div', { className: 'drawing-side-panel', dataset: { hook: 'drawing-dimensions' } }),
                    ],
                  }),
                  createDisclosure({
                    summary: '편집 이력',
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
        children: [
          el('p', { className: 'eyebrow', text: 'Recommended next action' }),
          el('h3', { className: 'card-title', text: 'Step 1. Connect input context to the console' }),
          el('p', {
            className: 'card-copy',
            text: importBootstrap.modelPath || importBootstrap.modelFileName
              ? 'Input context is partially staged. Continue from the console to validate source assumptions before tracked review.'
              : 'Start from an example, a checked-in config, or the tracked job trail. Model and Drawing remain available, but the review path begins here.',
          }),
          el('div', {
            className: 'console-hero-actions',
            children: [
              createExamplesSelect(state),
              createButton({
                label: 'Bring source context into the console',
                action: 'try-example',
                tone: 'primary',
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
    { index: '01', label: 'Input', tone: 'ok', active: true },
    { index: '02', label: 'Review signals', tone: 'info' },
    { index: '03', label: 'Package', tone: 'info' },
    { index: '04', label: 'Model', tone: 'info' },
    { index: '05', label: 'Drawing', tone: 'info' },
    { index: '06', label: 'Export', tone: 'warn' },
  ];

  return createCard({
    kicker: 'Workflow progress',
    title: 'Current location: Input',
    copy: 'The console now stages context first and keeps downstream review, packaging, model inspection, drawing evidence, and export steps visible as one guided trail.',
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
  const recentJobs = state.data.recentJobs;
  const latestReviewJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.review);
  const latestReadinessJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.readiness);
  const latestPackJob = findLatestTrackedJob(recentJobs, REVIEW_CONSOLE_JOB_TYPES.pack);

  return createCard({
    kicker: 'Guided workflow',
    title: 'Move through the review console with a clear trail',
    copy: 'The old guidance cards become one calmer list: connect context, scan signals, carry canonical packages, then reopen or export when the trail is ready.',
    body: [
      createList([
        {
          label: 'Connect source context',
          copy: 'Load an example or config so the console can stage review-first work without jumping straight into geometry editing.',
          meta: state.data.examples.items.length > 0 ? 'Ready' : 'Input pending',
        },
        {
          label: 'Scan review signals',
          copy: latestReviewJob ? 'A review-ready tracked run can reopen directly into the Review dashboard.' : 'Review cards will populate after the first tracked review-ready run.',
          meta: latestReviewJob ? 'Available' : 'Pending',
        },
        {
          label: 'Carry package baselines',
          copy: latestReadinessJob ? 'Readiness-backed output is available for go/hold review and package decisions.' : 'Readiness packages stay visible here once canonical review inputs exist.',
          meta: latestReadinessJob ? 'Ready' : 'Baseline needed',
        },
        {
          label: 'Reopen or export intentionally',
          copy: latestPackJob ? 'A package/export-oriented run is already present in the trail.' : 'Release bundle and export actions stay downstream from the tracked package trail.',
          meta: latestPackJob ? 'Available' : 'Pending',
        },
      ]),
      el('div', {
        className: 'console-inline-actions',
        children: [
          createButton({
            label: 'Open Review',
            action: latestReviewJob ? 'open-job' : 'go-artifacts',
            tone: 'ghost',
            dataset: latestReviewJob ? { jobId: latestReviewJob.id, route: 'review' } : {},
          }),
          createButton({
            label: 'Open Package trail',
            action: 'go-artifacts',
            tone: 'ghost',
          }),
          createButton({
            label: 'Open prompt flow',
            action: 'open-prompt-flow',
            tone: 'ghost',
          }),
        ],
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
                      el('p', { className: 'queue-row-meta', text: formatDateTime(job.updated_at) }),
                    ],
                  }),
                  el('span', { className: 'pill', text: formatJobStatus(job.status) }),
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

function createConsoleWorkspace(state) {
  return el('section', {
    className: 'workspace-shell console-workspace',
    children: [
      createConsoleHero(state),
      createConsoleWorkflowRail(),
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
              createImportBootstrapCard(state),
              createConsoleQueueCard(state),
              createDecisionPackagesCard(state),
              createRuntimeHealthCard(state),
            ],
          }),
        ],
      }),
    ],
  });
}

export const workspaceOrder = ['start', 'review', 'artifacts', 'model', 'drawing'];

export const workspaceDefinitions = {
  start: {
    label: 'Console',
    summary: 'Review-first launchpad for ingest, packs, compare, and reopen actions.',
    render(state) {
      return createConsoleWorkspace(state);
    },
  },
  model: {
    label: 'Model',
    summary: 'Optional prep lane for configs and geometry previews before review.',
    render(state) {
      return createModelWorkspace(state);
    },
  },
  drawing: {
    label: 'Drawing',
    summary: 'Optional sheet-prep lane when a review needs drawing evidence.',
    render(state) {
      return createDrawingWorkspace(state);
    },
  },
  review: {
    label: 'Review',
    summary: 'Hotspots, quality linkage, recommended actions, and readiness signals.',
    render(state) {
      return renderReviewWorkspace(state);
    },
  },
  artifacts: {
    label: 'Packs',
    summary: 'Review packs, readiness packages, compare baselines, exports, and reopen actions.',
    render(state) {
      return renderArtifactsWorkspace(state);
    },
  },
};
