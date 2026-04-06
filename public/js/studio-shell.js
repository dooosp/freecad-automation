import {
  bootStudioShell,
  localizedBootMessage,
  reportStudioBootFailure,
} from './studio/studio-shell-core.js';

function loadModelWorkspaceModule() {
  return import('./studio/model-workspace.js');
}

function loadDrawingWorkspaceModule() {
  return import('./studio/drawing-workspace.js');
}

try {
  bootStudioShell({
    loadModelWorkspaceModule,
    loadDrawingWorkspaceModule,
  });
} catch (error) {
  reportStudioBootFailure(localizedBootMessage('assets'), error);
}
