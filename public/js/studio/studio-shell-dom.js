import { createLogEntry } from './renderers.js';
import { renderJobsCenter } from './jobs-center.js';
import {
  routeSupportsSelectedJob,
  serializeStudioLocationState,
  shouldExpandAdvancedNavigation,
} from './studio-state.js';
import { workspaceDefinitions } from './workspaces.js';
import { RECENT_JOBS_LIMIT } from './studio-shell-store.js';
import { applyTranslations, t, translateText } from '../i18n/index.js';

export function bindStudioShellElements(documentRef = document) {
  const skipLink = documentRef.querySelector('.skip-link');
  const workspaceRoot = documentRef.getElementById('workspace-root');
  const sidebar = documentRef.getElementById('studio-sidebar');
  const sidebarScrim = documentRef.getElementById('studio-sidebar-scrim');
  const navToggle = documentRef.getElementById('studio-nav-toggle');
  const studioMain = documentRef.querySelector('.studio-main');
  const advancedWorkNavigation = documentRef.getElementById('advanced-work-navigation');
  const advancedModeToggle = documentRef.getElementById('advanced-mode-toggle');
  const completionNoticeHost = documentRef.getElementById('completion-notice-host');
  const workspaceSummary = documentRef.getElementById('workspace-summary');
  const runtimeBadge = documentRef.getElementById('runtime-badge');
  const projectBadge = documentRef.getElementById('project-badge');
  const connectionBadge = documentRef.getElementById('connection-badge');
  const jobBadge = documentRef.getElementById('job-badge');
  const jobsToggle = documentRef.getElementById('jobs-toggle');
  const jobsClose = documentRef.getElementById('jobs-close');
  const jobsDrawer = documentRef.getElementById('jobs-drawer');
  const jobsCenterContent = documentRef.getElementById('jobs-center-content');
  const logToggle = documentRef.getElementById('log-toggle');
  const logClose = documentRef.getElementById('log-close');
  const logDrawer = documentRef.getElementById('log-drawer');
  const logFeed = documentRef.getElementById('log-feed');
  const workspaceNav = documentRef.getElementById('workspace-nav');
  const navLinks = [...documentRef.querySelectorAll('.nav-link')];

  return {
    skipLink,
    workspaceRoot,
    sidebar,
    sidebarScrim,
    navToggle,
    studioMain,
    advancedWorkNavigation,
    advancedModeToggle,
    completionNoticeHost,
    workspaceSummary,
    runtimeBadge,
    projectBadge,
    connectionBadge,
    jobBadge,
    jobsToggle,
    jobsClose,
    jobsDrawer,
    jobsCenterContent,
    logToggle,
    logClose,
    logDrawer,
    logFeed,
    workspaceNav,
    navLinks,
    requiredShellElements: Object.freeze([
      ['skip-link', skipLink],
      ['workspace-root', workspaceRoot],
      ['studio-sidebar', sidebar],
      ['studio-sidebar-scrim', sidebarScrim],
      ['studio-nav-toggle', navToggle],
      ['studio-main', studioMain],
      ['advanced-work-navigation', advancedWorkNavigation],
      ['advanced-mode-toggle', advancedModeToggle],
      ['workspace-summary', workspaceSummary],
      ['runtime-badge', runtimeBadge],
      ['project-badge', projectBadge],
      ['connection-badge', connectionBadge],
      ['job-badge', jobBadge],
      ['jobs-toggle', jobsToggle],
      ['jobs-close', jobsClose],
      ['jobs-drawer', jobsDrawer],
      ['jobs-center-content', jobsCenterContent],
      ['log-toggle', logToggle],
      ['log-close', logClose],
      ['log-drawer', logDrawer],
      ['log-feed', logFeed],
      ['workspace-nav', workspaceNav],
    ]),
  };
}

export function localizedBootMessage(key = 'assets', {
  documentRef = document,
  navigatorRef = navigator,
} = {}) {
  const locale = String(documentRef.documentElement.lang || navigatorRef.language || '')
    .trim()
    .toLowerCase()
    .startsWith('ko')
    ? 'ko'
    : 'en';
  const messages = {
    en: {
      assets: 'Studio assets failed to load. Try reload and check the server static routes.',
      contract: 'Studio shell markup did not match the expected browser contract. Reload and check the server static routes.',
    },
    ko: {
      assets: 'Studio \uc790\uc0b0\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68\ud558\uac70\ub098 \uc11c\ubc84 \uc815\uc801 \ub77c\uc6b0\ud2b8\ub97c \ud655\uc778\ud558\uc138\uc694.',
      contract: 'Studio \uc178 \ub9c8\ud06c\uc5c5\uc774 \uc608\uc0c1\ud55c \ube0c\ub77c\uc6b0\uc800 \uacc4\uc57d\uacfc \ub9de\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68\ud558\uac70\ub098 \uc11c\ubc84 \uc815\uc801 \ub77c\uc6b0\ud2b8\ub97c \ud655\uc778\ud558\uc138\uc694.',
    },
  };
  return messages[locale]?.[key] || messages.en[key];
}

export function showStudioBootWarning(message = localizedBootMessage('assets'), {
  windowRef = window,
} = {}) {
  if (typeof windowRef.__studioShowBootWarning === 'function') {
    windowRef.__studioShowBootWarning(message);
  }
}

export function hideStudioBootWarning({ windowRef = window } = {}) {
  if (typeof windowRef.__studioHideBootWarning === 'function') {
    windowRef.__studioHideBootWarning();
  }
}

export function markStudioBooted({ windowRef = window } = {}) {
  windowRef.__studioBooted = true;
  hideStudioBootWarning({ windowRef });
}

export function reportStudioBootFailure(message = localizedBootMessage('assets'), error = null, {
  windowRef = window,
} = {}) {
  showStudioBootWarning(message, { windowRef });
  if (error) {
    console.error(error);
  }
}

export function ensureShellContract(elements, {
  windowRef = window,
  documentRef = document,
  navigatorRef = navigator,
} = {}) {
  const HTMLElementCtor = windowRef.HTMLElement;
  const missing = elements.requiredShellElements
    .filter(([, element]) => !(element instanceof HTMLElementCtor))
    .map(([id]) => id);

  if (missing.length === 0) return true;

  reportStudioBootFailure(localizedBootMessage('contract', {
    documentRef,
    navigatorRef,
  }), null, {
    windowRef,
  });
  console.error(`Studio shell markup contract mismatch. Missing elements: ${missing.join(', ')}`);
  return false;
}

function setBadgeText(element, text, title = text) {
  element.textContent = text;
  element.title = title;
}

function setBadgeTone(element, tone = 'info') {
  element.dataset.tone = tone;
}

function createCompletionActionButton(documentRef, action = {}) {
  const button = documentRef.createElement('button');
  button.className = `action-button action-button-${action.tone === 'primary' ? 'primary' : 'ghost'}`;
  button.type = 'button';
  button.dataset.action = action.action || 'open-job';
  if (action.jobId) button.dataset.jobId = action.jobId;
  if (action.route) button.dataset.route = action.route;
  button.textContent = action.label || 'Open Jobs center';
  return button;
}

function completionNoticeKey(notice, locale = '') {
  if (!notice) return JSON.stringify([locale, null]);

  const messageParts = Array.isArray(notice.messageParts) && notice.messageParts.length > 0
    ? notice.messageParts
    : [notice.message];
  const actions = Array.isArray(notice.actions)
    ? notice.actions.map((action = {}) => ([
      action.label || '',
      action.action || '',
      action.tone || '',
      action.jobId || '',
      action.route || '',
    ]))
    : [];

  return JSON.stringify([
    locale,
    notice.jobId || '',
    notice.tone || '',
    notice.title || '',
    messageParts.filter(Boolean),
    notice.primaryRoute || '',
    notice.primaryLabel || '',
    notice.secondaryRoute || '',
    notice.secondaryLabel || '',
    actions,
  ]);
}

export function createStudioShellDomController(app) {
  let lastCompletionNoticeKey = null;

  function syncChrome() {
    const workspace = workspaceDefinitions[app.state.route];
    const {
      document: documentRef,
      elements,
      state,
    } = app;

    documentRef.title = `${t(workspace.labelI18nKey)} | ${t('studio.title')}`;
    elements.workspaceSummary.textContent = t(workspace.summaryI18nKey);
    setBadgeText(elements.runtimeBadge, translateText(state.runtimeBadgeText));
    elements.runtimeBadge.hidden = state.route === 'start';
    setBadgeText(
      elements.projectBadge,
      translateText(state.projectBadgeText),
      translateText(state.projectBadgeTitle)
    );
    setBadgeText(elements.connectionBadge, translateText(state.connectionBadgeText));
    setBadgeText(
      elements.jobBadge,
      translateText(state.jobBadgeText),
      translateText(state.jobBadgeTitle || state.jobBadgeText)
    );
    setBadgeTone(elements.jobBadge, state.jobBadgeTone || 'info');

    elements.navLinks.forEach((link) => {
      const linkRoute = link.dataset.route || 'start';
      link.setAttribute('href', serializeStudioLocationState({
        route: linkRoute,
        selectedJobId: routeSupportsSelectedJob(linkRoute) ? state.selectedJobId : '',
      }));
      const isActive = link.dataset.route === state.route;
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    elements.advancedModeToggle.checked = state.experienceMode === 'advanced';
    elements.advancedWorkNavigation.open = shouldExpandAdvancedNavigation({
      route: state.route,
      experienceMode: state.experienceMode,
    });
  }

  function renderCompletionNotice() {
    const { completionNoticeHost } = app.elements;
    const notice = app.state.data.completionNotice;

    if (!completionNoticeHost) return;

    const nextCompletionNoticeKey = completionNoticeKey(
      notice,
      app.document.documentElement.lang || ''
    );
    if (nextCompletionNoticeKey === lastCompletionNoticeKey) return;

    if (!notice) {
      completionNoticeHost.hidden = true;
      completionNoticeHost.replaceChildren();
      completionNoticeHost.dataset.i18nPreserve = 'true';
      lastCompletionNoticeKey = nextCompletionNoticeKey;
      return;
    }

    completionNoticeHost.removeAttribute('data-i18n-preserve');
    completionNoticeHost.hidden = false;
    completionNoticeHost.replaceChildren(app.document.createElement('div'));
    const container = completionNoticeHost.firstElementChild;
    container.className = 'completion-notice';
    container.dataset.tone = notice.tone || 'info';

    const copy = app.document.createElement('div');
    copy.className = 'completion-notice-copy';

    const title = app.document.createElement('p');
    title.className = 'completion-notice-title';
    title.textContent = notice.title;
    copy.append(title);

    const messageParts = Array.isArray(notice.messageParts) && notice.messageParts.length > 0
      ? notice.messageParts
      : [notice.message];
    messageParts.filter(Boolean).forEach((part) => {
      const message = app.document.createElement('p');
      message.className = 'completion-notice-message';
      message.textContent = part;
      copy.append(message);
    });

    const actions = app.document.createElement('div');
    actions.className = 'completion-notice-actions';

    if (Array.isArray(notice.actions) && notice.actions.length > 0) {
      notice.actions.forEach((action) => {
        actions.append(createCompletionActionButton(app.document, action));
      });
    } else if (notice.primaryRoute) {
      const primaryButton = app.document.createElement('button');
      primaryButton.className = 'action-button action-button-primary';
      primaryButton.type = 'button';
      primaryButton.dataset.action = 'open-job';
      primaryButton.dataset.jobId = notice.jobId;
      primaryButton.dataset.route = notice.primaryRoute;
      primaryButton.textContent = notice.primaryLabel;
      actions.append(primaryButton);

      if (notice.secondaryRoute) {
        const secondaryButton = app.document.createElement('button');
        secondaryButton.className = 'action-button action-button-ghost';
        secondaryButton.type = 'button';
        secondaryButton.dataset.action = 'open-job';
        secondaryButton.dataset.jobId = notice.jobId;
        secondaryButton.dataset.route = notice.secondaryRoute;
        secondaryButton.textContent = notice.secondaryLabel;
        actions.append(secondaryButton);
      }
    }

    const dismissButton = app.document.createElement('button');
    dismissButton.className = 'action-button action-button-ghost';
    dismissButton.type = 'button';
    dismissButton.dataset.action = 'dismiss-completion-notice';
    dismissButton.dataset.jobId = notice.jobId;
    dismissButton.textContent = translateText('Dismiss');
    actions.append(dismissButton);

    container.append(copy, actions);
    applyTranslations(completionNoticeHost);
    completionNoticeHost.dataset.i18nPreserve = 'true';
    lastCompletionNoticeKey = nextCompletionNoticeKey;
  }

  function renderJobsDrawer() {
    app.elements.jobsCenterContent.replaceChildren(renderJobsCenter({
      recentJobs: app.state.data.recentJobs.items || [],
      jobMonitor: app.state.data.jobMonitor || {},
      activeJobId: app.state.data.activeJob.summary?.id || '',
      limit: RECENT_JOBS_LIMIT,
    }));
    applyTranslations(app.elements.jobsCenterContent);
  }

  function renderLogs() {
    app.elements.logFeed.replaceChildren(...app.state.logs.map((entry) => createLogEntry(entry)));
    applyTranslations(app.elements.logFeed);
  }

  function setLogDrawer(open, { focusEntry = false } = {}) {
    app.elements.logDrawer.classList.toggle('is-open', open);
    app.elements.logToggle.setAttribute('aria-expanded', String(open));
    if (open && focusEntry) app.elements.logClose.focus();
  }

  function setJobsDrawer(open, { focusEntry = false } = {}) {
    app.elements.jobsDrawer.classList.toggle('is-open', open);
    app.elements.jobsToggle.setAttribute('aria-expanded', String(open));
    if (open && focusEntry) app.elements.jobsClose.focus();
  }

  function setSidebar(open, { restoreFocus = false } = {}) {
    const {
      navToggle,
      skipLink,
      sidebar,
      sidebarScrim,
      studioMain,
    } = app.elements;
    sidebar.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    sidebarScrim.hidden = !open;
    studioMain.inert = open;
    skipLink.inert = open;
    app.document.body.classList.toggle('sidebar-open', open);

    if (open) {
      const activeLink = sidebar.querySelector('.nav-link[aria-current="page"]')
        || sidebar.querySelector('.nav-link');
      const focusActiveLink = () => {
        if (sidebar.classList.contains('is-open') && !sidebar.contains(app.document.activeElement)) {
          activeLink?.focus();
        }
      };
      app.window.requestAnimationFrame(focusActiveLink);
      app.window.setTimeout(focusActiveLink, 100);
    } else if (restoreFocus) {
      navToggle.focus();
    }
  }

  function sidebarFocusableElements() {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'summary',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return [...app.elements.sidebar.querySelectorAll(selector)]
      .filter((element) => {
        const closedDisclosure = element.closest('details:not([open])');
        if (closedDisclosure && element.tagName !== 'SUMMARY') return false;
        return element.getClientRects().length > 0;
      });
  }

  function containSidebarFocus(event) {
    if (event.key !== 'Tab' || !app.elements.sidebar.classList.contains('is-open')) return false;

    const focusable = sidebarFocusableElements();
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return false;

    const active = app.document.activeElement;
    const focusEscaped = !app.elements.sidebar.contains(active);
    if (event.shiftKey && (active === first || focusEscaped)) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (active === last || focusEscaped)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function applyPendingFocus() {
    if (!app.state.pendingFocus) return;

    const pendingFocus = app.state.pendingFocus;
    const selector = pendingFocus === 'prompt'
      ? '[data-field="prompt-text"]'
      : pendingFocus === 'config'
        ? '[data-field="config-text"]'
        : pendingFocus === 'guided-model'
          ? '[data-model-guided-step]:not([hidden])'
          : pendingFocus === 'import'
            ? '[data-import-guided-step]:not([hidden])'
            : null;
    const focusTarget = () => {
      if (selector) {
        const target = app.elements.workspaceRoot.querySelector(selector);
        const activeElement = app.document.activeElement;
        const focusStayedInWorkspace = activeElement !== app.elements.workspaceRoot
          && app.elements.workspaceRoot.contains(activeElement);
        if (
          target instanceof app.window.HTMLElement
          && activeElement !== target
          && !target.contains(activeElement)
          && !focusStayedInWorkspace
        ) {
          target.focus();
        }
      }
    };
    app.state.pendingFocus = null;
    app.window.requestAnimationFrame(() => {
      focusTarget();
      app.window.requestAnimationFrame(focusTarget);
    });
    app.window.setTimeout(focusTarget, 100);
  }

  return {
    syncChrome,
    renderCompletionNotice,
    renderJobsDrawer,
    renderLogs,
    setLogDrawer,
    setJobsDrawer,
    setSidebar,
    containSidebarFocus,
    applyPendingFocus,
  };
}
