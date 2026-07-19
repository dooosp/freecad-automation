import {
  deriveStudioWorkspaceSelection,
  parseStudioLocationState,
  routeSupportsSelectedJob,
  serializeStudioLocationState,
} from './studio-state.js';

export function createStudioShellRouting(app) {
  function setRoute(nextRoute, { focus = false, hash = false, selectedJobId } = {}) {
    const nextLocation = deriveStudioWorkspaceSelection(
      {
        route: app.state.route,
        selectedJobId: app.state.selectedJobId,
      },
      {
        route: nextRoute,
        ...(selectedJobId !== undefined ? { selectedJobId } : {}),
      }
    );

    app.state.route = nextLocation.route;
    app.state.selectedJobId = nextLocation.selectedJobId;

    if (hash) {
      const nextHash = serializeStudioLocationState(nextLocation);
      if (app.window.location.hash !== nextHash) {
        app.window.location.hash = nextHash;
        return;
      }
    }

    app.commitRender();
    if (focus) app.elements.workspaceRoot.focus();
  }

  function navigateTo(route, options = {}) {
    app.state.pendingFocus = options.pendingFocus || null;
    setRoute(route, {
      focus: true,
      hash: true,
      ...(options.selectedJobId !== undefined ? { selectedJobId: options.selectedJobId } : {}),
    });
  }

  async function syncSelectedJobFromLocation() {
    if (!routeSupportsSelectedJob(app.state.route) || !app.state.selectedJobId) return;

    if (app.state.data.activeJob.summary?.id === app.state.selectedJobId) {
      return;
    }

    if (
      app.state.data.activeJob.status === 'loading'
      && app.state.data.activeJob.summary?.id === app.state.selectedJobId
    ) {
      return;
    }

    await app.openJob(app.state.selectedJobId, { route: app.state.route });
  }

  function handleHashChange() {
    const nextLocation = parseStudioLocationState(app.window.location);
    const shouldFocusWorkspaceRoot = !app.state.pendingFocus;
    app.state.route = nextLocation.route;
    app.state.selectedJobId = nextLocation.selectedJobId;
    app.commitRender();
    syncSelectedJobFromLocation().catch(() => {});
    if (shouldFocusWorkspaceRoot) app.elements.workspaceRoot.focus();
  }

  function handleNavKeydown(event) {
    const visibleNavLinks = app.elements.navLinks.filter((link) => {
      const disclosure = link.closest('details');
      return !disclosure || disclosure.open;
    });
    const currentIndex = visibleNavLinks.findIndex((link) => link === app.document.activeElement);
    if (currentIndex === -1) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      visibleNavLinks[(currentIndex + 1) % visibleNavLinks.length].focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      visibleNavLinks[(currentIndex - 1 + visibleNavLinks.length) % visibleNavLinks.length].focus();
    }
  }

  function findActionTarget(target) {
    return target instanceof app.window.Element ? target.closest('[data-action]') : null;
  }

  return {
    setRoute,
    navigateTo,
    syncSelectedJobFromLocation,
    handleHashChange,
    handleNavKeydown,
    findActionTarget,
  };
}
