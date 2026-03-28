import {
  createArtifactList,
  createButton,
  createCard,
  createDisclosure,
  createEmptyState,
  createFlowRail,
  createInfoGrid,
  createList,
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
              value: example.name,
              selected: example.name === state.data.examples.selectedName,
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
  const canTryExample = examples.status === 'ready' && examples.items.length > 0;
  const canOpenRecent = recentJobs.status === 'ready' && recentJobs.items.length > 0;

  return createCard({
    kicker: 'Primary actions',
    title: 'What can you do next?',
    copy: 'Pick the lane that gets you moving without dropping into the full editing surface first.',
    body: [
      createActionGrid([
        {
          kicker: 'Example-first',
          title: 'Try Example',
          copy: 'Load a repository example and move straight into the Model workspace with editable config state.',
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
          kicker: 'Source-backed',
          title: 'Open Existing Config',
          copy: 'Bring a local TOML or JSON config into the Model workspace and keep editing there.',
          meta: 'Local file only. Start stays focused on launch decisions, not full editing.',
          controls: [
            createButton({
              label: 'Choose config file',
              action: 'open-config',
              tone: 'primary',
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
        },
        {
          kicker: 'Prompt-assisted',
          title: 'Generate From Prompt',
          copy: 'Route into the model-building flow with prompt drafting ready, without making prompting the whole product.',
          meta: 'Prompt execution still depends on later API wiring.',
          controls: [
            createButton({
              label: 'Open prompt flow',
              action: 'open-prompt-flow',
              tone: 'primary',
            }),
          ],
        },
        {
          kicker: 'Job trail',
          title: 'Open Recent Job',
          copy: 'Jump into the most recent tracked run and continue from the artifact trail instead of starting over.',
          meta: recentJobs.status === 'unavailable'
            ? 'Recent jobs require the local API path from `fcad serve`.'
            : `${recentJobs.items.length || 0} recent jobs visible`,
          controls: [
            createButton({
              label: recentJobActionLabel(recentJobs),
              action: 'open-recent-job',
              tone: 'primary',
              disabled: !canOpenRecent,
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
      kicker: 'Recent jobs',
      title: 'Job history',
      copy: 'Loading the most recent tracked runs from the local API.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '...',
          title: 'Checking recent runs',
          copy: 'The Start workspace will use recent jobs as the fastest path back into artifacts and review.',
        }),
      ],
    });
  }

  if (recentJobs.status === 'unavailable') {
    return createCard({
      kicker: 'Recent jobs',
      title: 'No job history on this path',
      copy: 'The legacy shell does not expose tracked job history, so this space stays honest instead of showing broken controls.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '[]',
          title: 'Recent jobs need the local API',
          copy: recentJobs.message || 'Run `fcad serve` to expose `/jobs` and artifact history for the new studio shell.',
        }),
      ],
    });
  }

  if (recentJobs.items.length === 0) {
    return createCard({
      kicker: 'Recent jobs',
      title: 'Nothing has been tracked yet',
      copy: 'Use an example or open a config first. As soon as jobs are created, this list becomes the fastest return path.',
      surface: 'canvas',
      body: [
        createEmptyState({
          icon: '+',
          title: 'No recent jobs yet',
          copy: recentJobs.message || 'Start with a model or drawing run to build an artifact trail here.',
        }),
      ],
    });
  }

  return createCard({
    kicker: 'Recent jobs',
    title: 'Resume from tracked work',
    copy: 'Recent runs stay visible so the launchpad answers what to do next even after a partial workflow.',
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
        el('span', { className: 'quick-link-label', text: 'Studio shell' }),
        el('code', { className: 'code-chip', text: 'fcad serve' }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Studio route' }),
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
        el('span', { className: 'quick-link-label', text: 'Legacy viewer' }),
        el('code', { className: 'code-chip', text: 'fcad serve --legacy-viewer' }),
      ],
    }),
    el('div', {
      className: 'quick-link-row',
      children: [
        el('span', { className: 'quick-link-label', text: 'Legacy npm script' }),
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
    kicker: 'Quick links',
    title: 'CLI and API shortcuts',
    copy: 'Keep the lightweight commands and endpoints close without letting them dominate the landing workspace.',
    body: [
      createDisclosure({
        summary: 'Show quick links',
        body: links,
      }),
    ],
  });
}

function createModelSourceSummary(state) {
  const model = state.data.model;
  if (!model.configText) {
    return createEmptyState({
      icon: 'M',
      title: 'No config loaded yet',
      copy: 'Start with Try Example or Open Existing Config from the Start workspace to bring editable config state here.',
    });
  }

  return createInfoGrid([
    { label: 'Source', value: model.sourceType || 'manual' },
    { label: 'Name', value: model.sourceName || 'Untitled config' },
    { label: 'Path', value: model.sourcePath || 'In-memory draft' },
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
              value: example.name,
              selected: example.name === state.data.examples.selectedName,
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
                            label: 'Draft TOML',
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
                kicker: 'Viewport',
                title: 'Inspect the latest build result',
                copy: 'The model canvas now leads the workspace so the user can see the outcome immediately after build.',
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
                    text: 'The viewport stays dominant so the workflow reads as choose input, build, then inspect the result.',
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
          { label: `Drawing ${drawingStatus}`, tone },
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
              el('p', { className: 'model-status-copy', text: 'Drawing generation follows the same FreeCAD-backed pipeline posture as the rest of the studio.' }),
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
                    text: 'Preview Drawing stays local and fast. Run Tracked Draw Job publishes the current sheet setup into tracked jobs and artifacts.',
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
                title: 'Bill of materials',
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

export const workspaceOrder = ['start', 'model', 'drawing', 'review', 'artifacts'];

export const workspaceDefinitions = {
  start: {
    label: 'Start',
    summary: 'Launchpad for runtime posture, examples, and recent jobs.',
    render(state) {
      return workspaceShell({
        kicker: 'Start workspace',
        title: 'Start with runtime posture and the next best move',
        description: 'The launchpad answers what can I do next first, then exposes the runtime and artifact context that makes the answer trustworthy.',
        badges: [
          { label: `Connection ${state.connectionLabel}`, tone: connectionTone(state.connectionState) },
          { label: `Runtime ${state.runtimeToneLabel}`, tone: state.runtimeTone },
          { label: `${state.data.recentJobs.items.length || 0} recent jobs`, tone: state.data.recentJobs.items.length ? 'info' : 'warn' },
        ],
        controls: [
          createStartActionsCard(state),
          createQuickLinksCard(state),
        ],
        canvas: [
          createRuntimeHealthCard(state),
          createRecentJobsCard(state),
        ],
      });
    },
  },
  model: {
    label: 'Model',
    summary: 'Choose input, build the preview, and inspect model results with metadata, parts, logs, and motion.',
    render(state) {
      return createModelWorkspace(state);
    },
  },
  drawing: {
    label: 'Drawing',
    summary: 'Drawing plan, SVG canvas, BOM, and dimension loop staging.',
    render(state) {
      return createDrawingWorkspace(state);
    },
  },
  review: {
    label: 'Review',
    summary: 'Design, DFM, readiness, and stabilization decisions.',
    render(state) {
      return renderReviewWorkspace(state);
    },
  },
  artifacts: {
    label: 'Artifacts',
    summary: 'Recent-job artifact trail, manifests, and output storage.',
    render(state) {
      return renderArtifactsWorkspace(state);
    },
  },
};
