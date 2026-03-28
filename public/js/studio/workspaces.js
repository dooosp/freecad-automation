import {
  createArtifactList,
  createCard,
  createEmptyState,
  createFlowRail,
  createList,
  createMetricGrid,
  createSectionHeader,
  createSplitPane,
  createStatusStrip,
  el,
} from './renderers.js';

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
  if (connectionState === 'degraded') return 'warn';
  return 'info';
}

export const workspaceOrder = ['start', 'model', 'drawing', 'review', 'artifacts'];

export const workspaceDefinitions = {
  start: {
    label: 'Start',
    summary: 'Guided launch point for the automation pipeline.',
    render(state) {
      return workspaceShell({
        kicker: 'Start workspace',
        title: 'Start With System Posture, Not Buttons',
        description: 'Frame the job, confirm the runtime posture, and choose the workspace that matches the next engineering decision.',
        badges: [
          { label: `Connection ${state.connectionLabel}`, tone: connectionTone(state.connectionState) },
          { label: `Runtime ${state.runtimeToneLabel}`, tone: state.runtimeTone },
          { label: 'Migration in parallel', tone: 'info' },
        ],
        controls: [
          createCard({
            kicker: 'Entry points',
            title: 'Workspace lanes',
            copy: 'The studio breaks the legacy one-panel viewer into task-shaped surfaces.',
            body: [
              createList([
                { label: 'Model', copy: 'Prompt design, examples, TOML editing, model metadata, parts, animation.', meta: 'Next migration lane' },
                { label: 'Drawing', copy: 'Drawing plan review, SVG canvas, BOM, and dimension-edit loop.', meta: 'Canvas-first' },
                { label: 'Review', copy: 'DFM, readiness, stabilization, design review, and release decisions.', meta: 'Status-heavy' },
                { label: 'Artifacts', copy: 'Exports, manifests, reports, and job outputs with traceability.', meta: 'Audit trail' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Current posture',
            title: 'What is stubbed in this shell',
            copy: 'This pass establishes structure and navigation, not execution wiring.',
            body: [
              createStatusStrip([
                { label: 'Runtime checks', copy: 'Read-only surface placeholders; full launch actions land later.' },
                { label: 'Job control', copy: 'No enqueue, cancel, or watch actions yet.' },
                { label: 'Editors and canvas', copy: 'Panels are scaffolded so later threads can move features without reshaping the shell.' },
              ]),
            ],
          }),
        ],
        canvas: [
          createCard({
            kicker: 'Pipeline map',
            title: 'Automation flow',
            copy: 'Status carries the visual weight so the workspace reads like an engineering control room, not a generic dashboard.',
            surface: 'canvas',
            body: [
              createFlowRail([
                { kicker: '1. Shape the job', title: 'Prompt or load a config', copy: 'Choose an example, write a prompt, or open a TOML source of truth.' },
                { kicker: '2. Build outputs', title: 'Generate model and drawing artifacts', copy: 'Run model creation and TechDraw generation through the shared pipeline.', tone: 'ok' },
                { kicker: '3. Review evidence', title: 'Check metadata, BOM, and review signals', copy: 'Surface model facts, manufacturing review results, and dimension follow-up.', tone: 'warn' },
                { kicker: '4. Collect artifacts', title: 'Publish traceable outputs', copy: 'Gather manifests, reports, exports, and ready-to-share review packages.' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Operator notes',
            title: 'Parallel rollout guardrails',
            copy: 'Legacy behavior remains available while the new shell absorbs features workspace by workspace.',
            surface: 'canvas',
            body: [
              createList([
                { label: 'Legacy viewer', copy: 'Still owns the working all-in-one interactions for this handoff.', meta: 'Preserved' },
                { label: 'Studio shell', copy: 'Owns navigation, layout tokens, status rails, and migration targets.', meta: 'New' },
                { label: 'Future move', copy: 'Each capability can migrate into a dedicated workspace without changing the serve model again.', meta: 'Planned' },
              ]),
            ],
          }),
        ],
      });
    },
  },
  model: {
    label: 'Model',
    summary: 'Prompt design, config input, model status, and assembly context.',
    render(state) {
      return workspaceShell({
        kicker: 'Model workspace',
        title: 'Model Authoring And Inspection Surface',
        description: 'Separate control space for prompts and config from the future model canvas and inspection results.',
        badges: [
          { label: 'Examples retained', tone: 'ok' },
          { label: 'TOML editor pending', tone: 'warn' },
          { label: 'Parts and animation planned', tone: 'info' },
        ],
        controls: [
          createCard({
            kicker: 'Prompt design',
            title: 'Shape the request',
            copy: 'This lane will absorb AI prompt design and config generation from the legacy shell.',
            body: [
              createList([
                { label: 'Prompt brief', copy: 'Describe geometry intent, manufacturing assumptions, and output expectations.', meta: 'Stub' },
                { label: 'Example configs', copy: 'Load repository examples and compare canonical v1 patterns.', meta: 'Stub' },
                { label: 'TOML editor', copy: 'Keep config edits source-backed and visible before build.', meta: 'Stub' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Inspection lane',
            title: 'Model facts that belong here',
            copy: 'Later threads can move runtime-backed facts into a stable layout without rebuilding the shell.',
            body: [
              createMetricGrid([
                { label: 'Build state', value: state.jobLabel, copy: 'Current placeholder for create execution status.' },
                { label: 'Parts list', value: 'Pending', copy: 'Assembly members and materials can dock here.' },
                { label: 'Animation', value: 'Pending', copy: 'Motion timelines and playback controls stay separate from config entry.' },
              ]),
            ],
          }),
        ],
        canvas: [
          createCanvasCard({
            kicker: 'Model canvas',
            title: '3D viewport zone',
            copy: 'Canvas space stays visually separate from authoring controls so geometry remains readable.',
            emptyState: createEmptyState({
              icon: '3D',
              title: 'Model canvas placeholder',
              copy: 'The future 3D viewport, part selection, wireframe toggles, opacity, and screenshot actions can migrate here without reworking navigation.',
            }),
          }),
          createCard({
            kicker: 'Reserved rails',
            title: 'Metadata and motion sidecars',
            copy: 'The legacy shell combines these concerns. Studio keeps them modular.',
            surface: 'canvas',
            body: [
              el('div', {
                className: 'split-subgrid',
                children: [
                  createEmptyState({
                    icon: 'i',
                    title: 'Model metadata rail',
                    copy: 'Mass, bounds, material, and inspection facts.',
                  }),
                  createEmptyState({
                    icon: '>>',
                    title: 'Animation rail',
                    copy: 'Playback, time scrub, and speed controls.',
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    },
  },
  drawing: {
    label: 'Drawing',
    summary: 'Drawing plan controls, BOM, dimension loop, and SVG canvas staging.',
    render() {
      return workspaceShell({
        kicker: 'Drawing workspace',
        title: 'Drawing Planning, Canvas, And Dimension Feedback',
        description: 'Keep drawing intent, BOM controls, and the SVG canvas in related but separate zones.',
        badges: [
          { label: 'Drawing BOM retained', tone: 'ok' },
          { label: 'Dimension loop reserved', tone: 'warn' },
          { label: 'SVG canvas placeholder', tone: 'info' },
        ],
        controls: [
          createCard({
            kicker: 'Drawing controls',
            title: 'Plan before render',
            copy: 'This lane is designed for drawing plan authoring instead of burying it behind a single button.',
            body: [
              createList([
                { label: 'View set', copy: 'Front, top, right, iso, and future custom view orchestration.', meta: 'Stub' },
                { label: 'BOM output', copy: 'CSV and drawing BOM placement controls belong here.', meta: 'Stub' },
                { label: 'Dimension edits', copy: 'Round-trip dimension intent updates stay near the drawing context.', meta: 'Stub' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Review loop',
            title: 'Expected handoff signals',
            copy: 'The drawing workspace will carry the practical feedback loop between rendered output and editable intent.',
            body: [
              createStatusStrip([
                { label: 'Plan compile', copy: 'Expose compile status and saved plan paths.' },
                { label: 'SVG review', copy: 'Render and zoom the drawing without mixing it with config entry.' },
                { label: 'BOM and dimensions', copy: 'Keep bill-of-materials and dimension corrections close to the drawing.' },
              ]),
            ],
          }),
        ],
        canvas: [
          createCanvasCard({
            kicker: 'Drawing canvas',
            title: 'SVG and annotation stage',
            copy: 'This reserved canvas keeps drawing output centered and readable.',
            emptyState: createEmptyState({
              icon: '2D',
              title: 'Drawing canvas placeholder',
              copy: 'The current SVG overlay, zoom, fit, and pan interactions can migrate here once the drawing lane is wired.',
            }),
          }),
          createCard({
            kicker: 'Adjacent surfaces',
            title: 'BOM and dimension sidecars',
            copy: 'Artifacts and editing loops stay visible without crowding the canvas.',
            surface: 'canvas',
            body: [
              el('div', {
                className: 'split-subgrid',
                children: [
                  createEmptyState({
                    icon: 'B',
                    title: 'Drawing BOM panel',
                    copy: 'Parts, quantities, materials, and callout links.',
                  }),
                  createEmptyState({
                    icon: 'D',
                    title: 'Dimension feedback rail',
                    copy: 'Intent changes, review notes, and redraw requests.',
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    },
  },
  review: {
    label: 'Review',
    summary: 'Decision-focused space for design, DFM, readiness, and stabilization signals.',
    render() {
      return workspaceShell({
        kicker: 'Review workspace',
        title: 'Review Is A First-Class Workspace',
        description: 'Manufacturing review, readiness, and design-review evidence should read like decisions in progress, not an afterthought below the viewport.',
        badges: [
          { label: 'Design review planned', tone: 'warn' },
          { label: 'DFM and readiness preserved', tone: 'ok' },
          { label: 'Decision console placeholder', tone: 'info' },
        ],
        controls: [
          createCard({
            kicker: 'Review lanes',
            title: 'Signals this workspace will carry',
            copy: 'The browser shell should match the repository identity as an automation pipeline, not only a viewer.',
            body: [
              createList([
                { label: 'Design review', copy: 'Issue summaries, geometry observations, and next actions.', meta: 'Planned' },
                { label: 'DFM and process review', copy: 'Manufacturability, quality risk, and process planning outputs.', meta: 'Planned' },
                { label: 'Readiness and stabilization', copy: 'Runtime-informed hold points, launch risk, and go/no-go framing.', meta: 'Planned' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Status posture',
            title: 'Decision framing',
            copy: 'This space gives status colors more weight than decorative actions.',
            body: [
              createMetricGrid([
                { label: 'Gate state', value: 'Unknown', copy: 'Later threads can bind go/hold decisions to real job output.' },
                { label: 'Top risk', value: 'Pending', copy: 'Prominent slot for the leading blocker or review concern.' },
                { label: 'Next action', value: 'Pending', copy: 'Short operator-facing follow-up instruction.' },
              ]),
            ],
          }),
        ],
        canvas: [
          createCard({
            kicker: 'Decision canvas',
            title: 'Review board',
            copy: 'A calmer review surface makes evidence, status, and action items easy to scan.',
            surface: 'canvas',
            body: [
              createFlowRail([
                { kicker: 'Signal', title: 'Geometry and model facts', copy: 'Collect inspection or metadata facts from the model lane.' },
                { kicker: 'Assessment', title: 'Manufacturing and launch review', copy: 'Surface DFM, readiness, and risk summaries.', tone: 'warn' },
                { kicker: 'Decision', title: 'Actionable recommendation', copy: 'Capture go, hold, or revise guidance with traceable outputs.', tone: 'ok' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Stubbed surfaces',
            title: 'Review details',
            copy: 'Reserved zones for artifact-backed review rather than generic dashboard cards.',
            surface: 'canvas',
            body: [
              el('div', {
                className: 'split-subgrid',
                children: [
                  createEmptyState({
                    icon: '!',
                    title: 'Risk panel',
                    copy: 'Top issues, blockers, and likely bottlenecks.',
                  }),
                  createEmptyState({
                    icon: 'OK',
                    title: 'Decision notes',
                    copy: 'Recommended actions and release notes.',
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    },
  },
  artifacts: {
    label: 'Artifacts',
    summary: 'Traceable outputs, manifests, reports, and export collection.',
    render(state) {
      return workspaceShell({
        kicker: 'Artifacts workspace',
        title: 'Outputs Need Their Own Operational Surface',
        description: 'Exports, manifests, and reports deserve a traceability-oriented layout rather than a small appendix under the main tool panel.',
        badges: [
          { label: 'Manifest-ready layout', tone: 'ok' },
          { label: 'Job history pending', tone: 'warn' },
          { label: 'Export board placeholder', tone: 'info' },
        ],
        controls: [
          createCard({
            kicker: 'Artifact classes',
            title: 'What this workspace will collect',
            copy: 'The repository already emits many outputs. This shell gives them a place to land.',
            body: [
              createArtifactList([
                { title: 'Model exports', meta: 'STEP, STL, generated geometry', path: 'output/<job>/model.*' },
                { title: 'Drawing outputs', meta: 'SVG, BOM CSV, plan artifacts', path: 'output/<job>/drawing.*' },
                { title: 'Review and report artifacts', meta: 'PDF, JSON, review pack, readiness bundles', path: 'output/<job>/reports/*' },
              ]),
            ],
          }),
          createCard({
            kicker: 'Traceability',
            title: 'Job and manifest posture',
            copy: 'Artifact provenance can remain visible even before deep wiring lands.',
            body: [
              createMetricGrid([
                { label: 'Current job', value: state.jobLabel, copy: 'Top-bar job placeholder is mirrored here.' },
                { label: 'Manifest view', value: 'Reserved', copy: 'Job manifest and artifact metadata can dock here.' },
                { label: 'Publish state', value: 'Reserved', copy: 'Future share/export actions belong here, not the canvas.' },
              ]),
            ],
          }),
        ],
        canvas: [
          createCanvasCard({
            kicker: 'Artifact board',
            title: 'Output gallery placeholder',
            copy: 'A traceable artifact wall is easier to scan than mixed inline download links.',
            emptyState: createEmptyState({
              icon: '[]',
              title: 'Artifact board placeholder',
              copy: 'Future threads can mount job manifests, previews, and export actions here using the existing local API jobs model.',
            }),
          }),
          createCard({
            kicker: 'Handoff notes',
            title: 'Why this structure matters later',
            copy: 'A dedicated artifact workspace lets later threads add previews and provenance without changing the studio frame again.',
            surface: 'canvas',
            body: [
              createList([
                { label: 'No silent downloads', copy: 'Artifact actions can stay explicit and source-backed.', meta: 'Intentional' },
                { label: 'Manifest-first view', copy: 'Use artifact metadata as the organizing spine for previews and actions.', meta: 'Structural' },
                { label: 'Job history', copy: 'Historical runs can fit here without contaminating workspace-specific control surfaces.', meta: 'Planned' },
              ]),
            ],
          }),
        ],
      });
    },
  },
};
