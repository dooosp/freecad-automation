import { createLogEntry } from './studio/renderers.js';
import { workspaceDefinitions } from './studio/workspaces.js';

const workspaceRoot = document.getElementById('workspace-root');
const workspaceSummary = document.getElementById('workspace-summary');
const runtimeBadge = document.getElementById('runtime-badge');
const projectBadge = document.getElementById('project-badge');
const connectionBadge = document.getElementById('connection-badge');
const jobBadge = document.getElementById('job-badge');
const logToggle = document.getElementById('log-toggle');
const logClose = document.getElementById('log-close');
const logDrawer = document.getElementById('log-drawer');
const logFeed = document.getElementById('log-feed');
const navLinks = [...document.querySelectorAll('.nav-link')];

const state = {
  route: normalizeRoute(window.location.hash),
  connectionState: 'placeholder',
  connectionLabel: 'pending',
  runtimeTone: 'warn',
  runtimeToneLabel: 'pending',
  runtimeBadgeText: 'Runtime pending',
  projectBadgeText: 'Project root placeholder',
  projectBadgeTitle: 'Project root placeholder',
  connectionBadgeText: 'Connection pending',
  jobLabel: 'Idle',
  jobBadgeText: 'No active job',
  logs: [
    {
      status: 'Studio shell',
      message: 'Workspace frame initialized in structure-first mode.',
      tone: 'info',
      time: 'boot',
    },
    {
      status: 'Parallel rollout',
      message: 'Legacy viewer behavior remains intact while workspaces migrate in later threads.',
      tone: 'warn',
      time: 'plan',
    },
  ],
};

function normalizeRoute(hashValue) {
  const cleaned = String(hashValue || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
  return workspaceDefinitions[cleaned] ? cleaned : 'start';
}

function setBadgeText(element, text, title = text) {
  element.textContent = text;
  element.title = title;
}

function summarizePath(rawPath) {
  if (!rawPath) return 'Project root placeholder';
  const segments = String(rawPath).split('/').filter(Boolean);
  if (segments.length <= 2) return rawPath;
  return `Project ${segments.slice(-2).join('/')}`;
}

function syncChrome() {
  const workspace = workspaceDefinitions[state.route];
  document.title = `${workspace.label} | FreeCAD Automation Studio`;
  workspaceSummary.textContent = workspace.summary;
  setBadgeText(runtimeBadge, state.runtimeBadgeText);
  setBadgeText(projectBadge, state.projectBadgeText, state.projectBadgeTitle);
  setBadgeText(connectionBadge, state.connectionBadgeText);
  setBadgeText(jobBadge, state.jobBadgeText);

  navLinks.forEach((link) => {
    const isActive = link.dataset.route === state.route;
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderWorkspace() {
  workspaceRoot.replaceChildren(workspaceDefinitions[state.route].render(state));
}

function renderLogs() {
  logFeed.replaceChildren(...state.logs.map((entry) => createLogEntry(entry)));
}

function addLog(entry) {
  state.logs.unshift(entry);
  if (state.logs.length > 8) state.logs.length = 8;
  renderLogs();
}

function setRoute(nextRoute, { focus = false } = {}) {
  state.route = workspaceDefinitions[nextRoute] ? nextRoute : 'start';
  syncChrome();
  renderWorkspace();
  if (focus) workspaceRoot.focus();
}

function setLogDrawer(open) {
  logDrawer.classList.toggle('is-open', open);
  logToggle.setAttribute('aria-expanded', String(open));
}

async function hydrateShellStatus() {
  try {
    const landingResponse = await fetch('/', {
      headers: { accept: 'application/json' },
    });

    if (landingResponse.ok) {
      const landing = await landingResponse.json();
      if (landing && landing.mode === 'local_api') {
        state.connectionState = 'connected';
        state.connectionLabel = 'connected';
        state.connectionBadgeText = 'Local API connected';
        state.projectBadgeTitle = landing.project_root || 'Project root ready';
        state.projectBadgeText = summarizePath(landing.project_root);
        addLog({
          status: 'Connection',
          message: 'Local API landing payload detected. Studio can grow on the non-legacy serve path.',
          tone: 'ok',
          time: 'api',
        });
      }
    }
  } catch {
    state.connectionState = 'placeholder';
    state.connectionLabel = 'placeholder';
    state.connectionBadgeText = 'Shell-only mode';
    addLog({
      status: 'Connection',
      message: 'No local API payload detected. Studio remains usable as a static shell.',
      tone: 'warn',
      time: 'api',
    });
  }

  try {
    const healthResponse = await fetch('/health', {
      headers: { accept: 'application/json' },
    });
    if (!healthResponse.ok) throw new Error('Health request failed');
    const health = await healthResponse.json();
    const runtimeAvailable = Boolean(health?.runtime?.available);
    const runtimeDescription = health?.runtime?.description || 'Runtime placeholder';
    state.runtimeTone = runtimeAvailable ? 'ok' : 'warn';
    state.runtimeToneLabel = runtimeAvailable ? 'ready' : 'pending';
    state.runtimeBadgeText = runtimeAvailable ? 'Runtime ready' : 'Runtime check required';
    addLog({
      status: runtimeAvailable ? 'Runtime ready' : 'Runtime pending',
      message: runtimeDescription,
      tone: runtimeAvailable ? 'ok' : 'warn',
      time: 'health',
    });
  } catch {
    state.runtimeTone = 'warn';
    state.runtimeToneLabel = 'pending';
    state.runtimeBadgeText = 'Runtime pending';
  }

  syncChrome();
  renderWorkspace();
}

function handleHashChange() {
  setRoute(normalizeRoute(window.location.hash), { focus: true });
}

function handleNavKeydown(event) {
  const currentIndex = navLinks.findIndex((link) => link === document.activeElement);
  if (currentIndex === -1) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    navLinks[(currentIndex + 1) % navLinks.length].focus();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    navLinks[(currentIndex - 1 + navLinks.length) % navLinks.length].focus();
  }
}

window.addEventListener('hashchange', handleHashChange);
document.getElementById('workspace-nav').addEventListener('keydown', handleNavKeydown);
logToggle.addEventListener('click', () => setLogDrawer(!logDrawer.classList.contains('is-open')));
logClose.addEventListener('click', () => setLogDrawer(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && logDrawer.classList.contains('is-open')) {
    setLogDrawer(false);
    logToggle.focus();
  }
});

syncChrome();
renderWorkspace();
renderLogs();
hydrateShellStatus();
