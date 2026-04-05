import { createLogEntry } from './renderers.js';
import { renderJobsCenter } from './jobs-center.js';
import { routeSupportsSelectedJob, serializeStudioLocationState } from './studio-state.js';
import { workspaceDefinitions } from './workspaces.js';
import { RECENT_JOBS_LIMIT } from './studio-shell-store.js';
import { applyTranslations, t, translateText } from '../i18n/index.js';

export function bindStudioShellElements(documentRef = document) {
  const workspaceRoot = documentRef.getElementById('workspace-root');
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
    workspaceRoot,
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
      ['workspace-root', workspaceRoot],
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
      assets: 'Studio 자산을 불러오지 못했습니다. 새로고침하거나 서버 정적 라우트를 확인하세요.',
      contract: 'Studio 셸 마크업이 예상한 브라우저 계약과 맞지 않습니다. 새로고침하거나 서버 정적 라우트를 확인하세요.',
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

export function createStudioShellDomController(app) {
  function syncChrome() {
    const workspace = workspaceDefinitions[app.state.route];
    const {
      document: documentRef,
      elements,
      state,
    } = app;

    documentRef.title = `${translateText(workspace.label)} | ${t('studio.title')}`;
    elements.workspaceSummary.textContent = translateText(workspace.summary);
    setBadgeText(elements.runtimeBadge, translateText(state.runtimeBadgeText));
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
  }

  function renderCompletionNotice() {
    const { completionNoticeHost } = app.elements;
    const notice = app.state.data.completionNotice;

    if (!completionNoticeHost) return;

    if (!notice) {
      completionNoticeHost.hidden = true;
      completionNoticeHost.replaceChildren();
      return;
    }

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

    const message = app.document.createElement('p');
    message.className = 'completion-notice-message';
    message.textContent = notice.message;
    copy.append(message);

    const actions = app.document.createElement('div');
    actions.className = 'completion-notice-actions';

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

    const dismissButton = app.document.createElement('button');
    dismissButton.className = 'action-button action-button-ghost';
    dismissButton.type = 'button';
    dismissButton.dataset.action = 'dismiss-completion-notice';
    dismissButton.dataset.jobId = notice.jobId;
    dismissButton.textContent = translateText('Dismiss');
    actions.append(dismissButton);

    container.append(copy, actions);
    applyTranslations(completionNoticeHost);
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

  function setLogDrawer(open) {
    app.elements.logDrawer.classList.toggle('is-open', open);
    app.elements.logToggle.setAttribute('aria-expanded', String(open));
  }

  function setJobsDrawer(open) {
    app.elements.jobsDrawer.classList.toggle('is-open', open);
    app.elements.jobsToggle.setAttribute('aria-expanded', String(open));
  }

  function applyPendingFocus() {
    if (!app.state.pendingFocus) return;

    app.window.requestAnimationFrame(() => {
      const selector = app.state.pendingFocus === 'prompt'
        ? '[data-field="prompt-text"]'
        : app.state.pendingFocus === 'config'
          ? '[data-field="config-text"]'
          : null;
      if (selector) {
        const target = app.elements.workspaceRoot.querySelector(selector);
        if (target instanceof app.window.HTMLElement) target.focus();
      }
      app.state.pendingFocus = null;
    });
  }

  return {
    syncChrome,
    renderCompletionNotice,
    renderJobsDrawer,
    renderLogs,
    setLogDrawer,
    setJobsDrawer,
    applyPendingFocus,
  };
}
