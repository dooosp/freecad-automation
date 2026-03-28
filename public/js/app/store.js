export function createViewerStore() {
  const state = {
    scene: {
      edgesVisible: true,
      selectedPartIndex: -1,
      pendingManifest: null,
      receivedPartCount: 0,
    },
    drawing: {
      zoom: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      dragStart: { x: 0, y: 0 },
      panStart: { x: 0, y: 0 },
      lastPlanPath: '',
    },
    animation: {
      motionData: null,
      motionPlaying: false,
      motionTime: 0,
      motionSpeed: 1,
      initialStates: new Map(),
    },
    dimensions: {
      history: [],
      index: -1,
      input: null,
      editing: false,
      pending: null,
    },
    design: {
      streamStartTime: 0,
    },
  };

  const listeners = new Set();

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(reason = 'update') {
      for (const listener of listeners) {
        listener(state, reason);
      }
    },
  };
}
