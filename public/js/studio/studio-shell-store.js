import { parseStudioLocationState } from './studio-state.js';

export const RECENT_JOBS_LIMIT = 12;
export const JOB_MONITOR_POLL_MS = 2000;

export function createStudioShellRuntime() {
  return {
    activeWorkspaceController: null,
    jobMonitorTimer: null,
    workspaceRenderEpoch: 0,
    modelWorkspaceModulePromise: null,
    drawingWorkspaceModulePromise: null,
    jobMonitorErrors: new Map(),
  };
}

export function createStudioShellState(locationLike = {}) {
  const initialLocationState = parseStudioLocationState(locationLike);

  return {
    route: initialLocationState.route,
    selectedJobId: initialLocationState.selectedJobId,
    connectionState: 'placeholder',
    connectionLabel: 'checking',
    runtimeTone: 'info',
    runtimeToneLabel: 'checking',
    pendingFocus: null,
    data: {
      landing: null,
      health: {
        status: 'loading',
        reachable: false,
        available: false,
        runtimeSummary: '',
        runtimePath: '',
        pythonVersion: '',
        freecadVersion: '',
        projectRoot: '',
        checkedAt: null,
        warnings: [],
        errors: [],
        fallbackMessage: '',
      },
      examples: {
        status: 'loading',
        items: [],
        selectedId: '',
        sourceLabel: 'configs/examples',
        message: '',
      },
      recentJobs: {
        status: 'loading',
        items: [],
        message: '',
      },
      jobMonitor: {
        items: [],
        lastPollTime: null,
      },
      completionNotice: null,
      model: {
        sourceType: '',
        sourceName: '',
        sourcePath: '',
        configText: '',
        promptText: '',
        promptMode: false,
        editingEnabled: false,
        buildState: 'idle',
        buildSummary: '',
        errorMessage: '',
        buildLog: [],
        validation: {
          warnings: [],
          changed_fields: [],
          deprecated_fields: [],
        },
        overview: null,
        preview: null,
        assistant: {
          busy: false,
          error: '',
          report: null,
        },
        reportOptions: {
          includeDrawing: true,
          includeTolerance: true,
          includeDfm: false,
          includeCost: false,
          profileName: '',
          open: false,
        },
        trackedRun: {
          type: '',
          lastJobId: '',
          status: 'idle',
          submitting: false,
          error: '',
        },
        profileCatalog: {
          status: 'idle',
          items: [],
          message: '',
        },
        buildSettings: {
          include_step: true,
          include_stl: true,
          per_part_stl: true,
        },
        controls: {
          wireframe: false,
          edges: true,
          opacity: 100,
        },
      },
      drawing: {
        status: 'idle',
        summary: 'Generate drawing to open the sheet-first workbench.',
        errorMessage: '',
        preview: null,
        settings: {
          views: ['front', 'top', 'right', 'iso'],
          scale: 'auto',
          section_assist: false,
          detail_assist: false,
        },
        history: [],
        historyIndex: -1,
        trackedRun: {
          lastJobId: '',
          status: 'idle',
          submitting: false,
          error: '',
          preservedEditedPreview: false,
          previewPlanRequested: false,
          preserveReason: '',
          submittedDrawingSettings: null,
        },
      },
      activeJob: {
        status: 'idle',
        summary: null,
        artifacts: [],
        manifest: null,
        storage: null,
        errorMessage: '',
      },
      review: {
        status: 'idle',
        jobId: '',
        cards: [],
        selectedCardId: '',
        errorMessage: '',
        cache: {},
      },
      artifactsWorkspace: {
        selectedArtifactId: '',
        previewStatus: 'idle',
        previewText: '',
        previewArtifactId: '',
        previewError: '',
        compare: {
          jobId: '',
          status: 'idle',
          errorMessage: '',
          job: null,
          artifacts: [],
        },
        cache: {},
      },
    },
    logs: [
      {
        status: 'Studio shell',
        message: 'Studio is the preferred browser review console. Start from context ingest, tracked artifacts, or a recent decision package.',
        tone: 'info',
        time: 'boot',
      },
    ],
  };
}
