import { t, translateAttributeValue, translateText } from '../i18n/index.js';

function appendChildren(parent, children = []) {
  children.filter(Boolean).forEach((child) => parent.append(child));
  return parent;
}

export function el(tagName, options = {}) {
  const {
    className,
    text,
    html,
    attrs = {},
    dataset = {},
    children = [],
  } = options;

  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = translateText(text);
  if (html !== undefined) node.innerHTML = html;
  Object.entries(attrs).forEach(([name, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(name, translateAttributeValue(String(value)));
  });
  Object.entries(dataset).forEach(([name, value]) => {
    if (value !== undefined && value !== null) node.dataset[name] = String(value);
  });
  appendChildren(node, children);
  return node;
}

export function createPill(label, tone = 'info') {
  return el('span', {
    className: `pill pill-status-${tone}`,
    text: label,
  });
}

export function createBadgeRow(labels = []) {
  return el('div', {
    className: 'badge-row',
    children: labels.map(({ label, tone }) => createPill(label, tone)),
  });
}

export function createSectionHeader({ kicker, title, description, badges = [] }) {
  const textGroup = el('div', {
    children: [
      kicker ? el('p', { className: 'section-kicker', text: kicker }) : null,
      el('h2', { className: 'section-title', text: title }),
      description ? el('p', { className: 'section-description', text: description }) : null,
    ],
  });

  return el('header', {
    className: 'section-header',
    children: [
      el('div', {
        className: 'section-header-row',
        children: [
          textGroup,
          badges.length > 0 ? createBadgeRow(badges) : null,
        ],
      }),
    ],
  });
}

export function createList(items = []) {
  return el('div', {
    className: 'list-stack',
    children: items.map((item) =>
      el('div', {
        className: 'list-item',
        children: [
          el('div', {
            children: [
              el('p', { className: 'list-label', text: item.label }),
              item.copy ? el('p', { className: 'list-copy', text: item.copy }) : null,
            ],
          }),
          item.meta ? el('span', { className: 'pill', text: item.meta }) : null,
        ],
      })
    ),
  });
}

export function createMetricGrid(metrics = []) {
  return el('div', {
    className: 'metric-grid',
    children: metrics.map((metric) =>
      el('div', {
        className: 'metric-row',
        children: [
          el('div', {
            children: [
              el('p', { className: 'metric-label', text: metric.label }),
              metric.copy ? el('p', { className: 'metric-copy', text: metric.copy }) : null,
            ],
          }),
          el('span', { className: 'metric-value', text: metric.value }),
        ],
      })
    ),
  });
}

export function createInfoGrid(items = []) {
  return el('dl', {
    className: 'info-grid',
    children: items.map((item) =>
      el('div', {
        className: 'info-row',
        children: [
          el('dt', { className: 'info-label', text: item.label }),
          el('dd', {
            className: 'info-value-wrap',
            children: [
              el('div', { className: 'info-value', text: item.value ?? 'Unavailable' }),
              item.note ? el('p', { className: 'info-note', text: item.note }) : null,
            ],
          }),
        ],
      })
    ),
  });
}

export function createButton({
  label,
  action,
  tone = 'default',
  disabled = false,
  attrs = {},
  dataset = {},
}) {
  return el('button', {
    className: `action-button${tone !== 'default' ? ` action-button-${tone}` : ''}`,
    text: label,
    attrs: {
      type: 'button',
      ...attrs,
      ...(disabled ? { disabled: true } : {}),
    },
    dataset: {
      action,
      ...dataset,
    },
  });
}

function createActionVariant(options = {}, tone = 'default', kind = 'secondary') {
  if (options.href && !options.disabled) {
    return el('a', {
      className: `action-button${tone !== 'default' ? ` action-button-${tone}` : ''}`,
      text: options.label,
      attrs: {
        href: options.href,
        ...(options.attrs || {}),
      },
      dataset: {
        actionKind: kind,
        ...(options.action ? { action: options.action } : {}),
        ...(options.dataset || {}),
      },
    });
  }
  const button = createButton({
    ...options,
    tone,
    dataset: {
      actionKind: kind,
      ...(options.dataset || {}),
    },
  });
  return button;
}

export function createPrimaryAction(options = {}) {
  return createActionVariant(options, 'primary', 'primary');
}

export function createSecondaryAction(options = {}) {
  return createActionVariant(options, 'ghost', 'secondary');
}

export function createTertiaryAction(options = {}) {
  return createActionVariant(options, 'ghost', 'tertiary');
}

export function createTaskStepper({
  label = 'Task progress',
  steps = [],
} = {}) {
  return el('ol', {
    className: 'task-stepper',
    attrs: { 'aria-label': label },
    children: steps.map((step, index) =>
      el('li', {
        className: 'task-step',
        attrs: step.state === 'current' ? { 'aria-current': 'step' } : {},
        dataset: {
          stepId: step.id,
          state: step.state || 'upcoming',
        },
        children: [
          el('span', { className: 'task-step-index', text: step.state === 'complete' ? '✓' : String(index + 1) }),
          el('span', { className: 'task-step-label', text: step.label }),
        ],
      })
    ),
  });
}

function summaryValue(value, fallback = 'None') {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : fallback;
  if (value && typeof value === 'object') {
    return [value.type || value.value, value.detail || value.label].filter(Boolean).join(' · ') || fallback;
  }
  return value == null || value === '' ? fallback : String(value);
}

export function createActionSummary({
  actionId,
  title = 'Review action',
  description = '',
  requiredInputs = [],
  expectedOutputs = [],
  launchesFreeCAD = 'unknown',
  fileEffects = 'none',
  networkAccess = 'no',
  provider = 'None',
  cost = 'none',
  humanConfirmationRequired = true,
  safetyNotes = '',
  blockedReason = '',
  recoveryAction = null,
} = {}) {
  return el('section', {
    className: 'action-summary',
    attrs: { 'aria-labelledby': actionId ? `${actionId}-title` : undefined },
    dataset: { actionSummary: actionId || 'action' },
    children: [
      el('header', {
        className: 'action-summary-header',
        children: [
          el('p', { className: 'eyebrow', text: t('studio.action-summary.eyebrow') }),
          el('h3', { className: 'action-summary-title', text: title, attrs: { id: actionId ? `${actionId}-title` : undefined } }),
          description ? el('p', { className: 'action-summary-copy', text: description }) : null,
        ],
      }),
      createInfoGrid([
        { label: t('studio.action-summary.required-input'), value: summaryValue(requiredInputs) },
        { label: t('studio.action-summary.expected-output'), value: summaryValue(expectedOutputs) },
        { label: t('studio.action-summary.launches-freecad'), value: summaryValue(launchesFreeCAD, 'Unknown') },
        { label: t('studio.action-summary.file-changes'), value: summaryValue(fileEffects) },
        { label: t('studio.action-summary.network-access'), value: summaryValue(networkAccess) },
        { label: t('studio.action-summary.provider'), value: summaryValue(provider) },
        { label: t('studio.action-summary.cost'), value: summaryValue(cost) },
        { label: t('studio.action-summary.confirmation'), value: humanConfirmationRequired ? 'Yes' : 'No' },
      ]),
      safetyNotes ? el('p', { className: 'action-summary-safety', text: safetyNotes }) : null,
      blockedReason
        ? createInlineStatus({
            title: 'Action unavailable',
            copy: blockedReason,
            tone: 'warn',
            action: recoveryAction,
          })
        : null,
    ],
  });
}

export function createInlineStatus({
  title,
  copy,
  tone = 'info',
  action = null,
  live = 'polite',
  attrs = {},
} = {}) {
  return el('div', {
    className: 'inline-status',
    attrs: {
      role: tone === 'bad' ? 'alert' : 'status',
      'aria-live': live,
      ...attrs,
    },
    dataset: { tone },
    children: [
      el('div', {
        className: 'inline-status-copy',
        children: [
          title ? el('p', { className: 'inline-status-title', text: title }) : null,
          copy ? el('p', { className: 'inline-status-message', text: copy }) : null,
        ],
      }),
      action ? createSecondaryAction(action) : null,
    ],
  });
}

export function createCostAndSideEffectNotice({
  title = 'Check side effects',
  copy = '',
  items = [],
  tone = 'warn',
} = {}) {
  return el('aside', {
    className: 'side-effect-notice',
    attrs: { 'aria-label': title },
    dataset: { tone },
    children: [
      el('p', { className: 'side-effect-title', text: title }),
      copy ? el('p', { className: 'side-effect-copy', text: copy }) : null,
      items.length > 0
        ? el('ul', {
            className: 'side-effect-list',
            children: items.map((item) => el('li', { text: item })),
          })
        : null,
    ],
  });
}

export function createMenuItem({
  label,
  action,
  href,
  disabled = false,
  destructive = false,
  attrs = {},
  dataset = {},
} = {}) {
  const tagName = href && !disabled ? 'a' : 'button';
  return el(tagName, {
    className: `overflow-menu-item${destructive ? ' overflow-menu-item-destructive' : ''}`,
    text: label,
    attrs: {
      role: 'menuitem',
      tabindex: '-1',
      ...(tagName === 'a' ? { href } : { type: 'button' }),
      ...attrs,
      ...(disabled ? { 'aria-disabled': 'true', disabled: tagName === 'button' ? true : undefined } : {}),
    },
    dataset: {
      menuItem: 'true',
      action,
      ...dataset,
    },
  });
}

let overflowMenuSequence = 0;

export function createOverflowMenu({
  label = 'More actions',
  items = [],
  id = '',
} = {}) {
  const menuId = id || `studio-overflow-menu-${++overflowMenuSequence}`;
  const trigger = el('button', {
    className: 'overflow-menu-trigger',
    text: '⋯',
    attrs: {
      type: 'button',
      'aria-label': label,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': menuId,
    },
  });
  const menu = el('div', {
    className: 'overflow-menu-popover',
    attrs: { id: menuId, role: 'menu', hidden: true },
    children: items.map((item) => createMenuItem(item)),
  });
  const wrapper = el('div', {
    className: 'overflow-menu',
    children: [trigger, menu],
  });

  const ownerDocument = wrapper.ownerDocument;
  let outsidePointerListening = false;
  const handleOutsidePointer = (event) => {
    if (!wrapper.isConnected) {
      ownerDocument.removeEventListener('pointerdown', handleOutsidePointer);
      outsidePointerListening = false;
      return;
    }
    if (!wrapper.contains(event.target)) closeMenu();
  };
  const startOutsidePointerListener = () => {
    if (outsidePointerListening) return;
    outsidePointerListening = true;
    ownerDocument.addEventListener('pointerdown', handleOutsidePointer);
  };
  const stopOutsidePointerListener = () => {
    if (!outsidePointerListening) return;
    outsidePointerListening = false;
    ownerDocument.removeEventListener('pointerdown', handleOutsidePointer);
  };
  const enabledItems = () => [...menu.querySelectorAll('[data-menu-item="true"]')]
    .filter((item) => item.getAttribute('aria-disabled') !== 'true' && !item.disabled);
  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    stopOutsidePointerListener();
    if (restoreFocus) trigger.focus();
  };
  const openMenu = ({ focus = 'first' } = {}) => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    startOutsidePointerListener();
    const candidates = enabledItems();
    const next = focus === 'last' ? candidates.at(-1) : candidates[0];
    next?.focus();
  };

  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu({ restoreFocus: true });
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu({ focus: 'last' });
    }
  });
  menu.addEventListener('keydown', (event) => {
    const candidates = enabledItems();
    const currentIndex = candidates.indexOf(event.target);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if (candidates.length === 0) return;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % candidates.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + candidates.length) % candidates.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = candidates.length - 1;
    else return;
    event.preventDefault();
    candidates[nextIndex]?.focus();
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('[data-menu-item="true"]')) closeMenu();
  });

  return wrapper;
}

export function createResultCard({
  title,
  meta = '',
  copy = '',
  primaryAction,
  menuItems = [],
  menuLabel = `More actions for ${title}`,
  attrs = {},
  dataset = {},
} = {}) {
  return el('article', {
    className: 'result-card',
    attrs,
    dataset,
    children: [
      el('div', {
        className: 'result-card-copy',
        children: [
          el('h3', { className: 'result-card-title', text: title }),
          meta ? el('p', { className: 'result-card-meta', text: meta }) : null,
          copy ? el('p', { className: 'result-card-description', text: copy }) : null,
        ],
      }),
      el('div', {
        className: 'result-card-actions',
        children: [
          primaryAction ? createPrimaryAction(primaryAction) : null,
          createOverflowMenu({ label: menuLabel, items: menuItems }),
        ],
      }),
    ],
  });
}

export function createEmptyStateWithNextAction({
  icon = '·',
  title,
  copy,
  action = null,
} = {}) {
  const emptyState = createEmptyState({ icon, title, copy });
  if (action) emptyState.append(createPrimaryAction(action));
  emptyState.classList.add('empty-state-with-action');
  return emptyState;
}

export function createActionGrid(cards = []) {
  return el('div', {
    className: 'action-grid',
    children: cards.map((card) =>
      el('article', {
        className: 'action-card',
        dataset: { tone: card.tone || 'info' },
        children: [
          el('div', {
            className: 'action-card-header',
            children: [
              card.kicker ? el('p', { className: 'eyebrow', text: card.kicker }) : null,
              el('h4', { className: 'action-title', text: card.title }),
              card.copy ? el('p', { className: 'action-copy', text: card.copy }) : null,
            ],
          }),
          card.meta ? el('p', { className: 'action-meta', text: card.meta }) : null,
          card.controls ? el('div', { className: 'action-controls', children: card.controls }) : null,
        ],
      })
    ),
  });
}

export function createArtifactList(items = []) {
  return el('div', {
    className: 'artifact-list',
    children: items.map((item) =>
      el('article', {
        className: 'artifact-item',
        children: [
          el('div', {
            children: [
              el('p', { className: 'artifact-title', text: item.title }),
              el('p', { className: 'artifact-meta', text: item.meta }),
            ],
          }),
          el('span', { className: 'artifact-path', text: item.path }),
        ],
      })
    ),
  });
}

export function createFlowRail(nodes = []) {
  return el('div', {
    className: 'flow-rail',
    children: nodes.map((node) =>
      el('article', {
        className: 'flow-node',
        dataset: { tone: node.tone || 'info' },
        children: [
          el('p', { className: 'eyebrow', text: node.kicker }),
          el('h3', { className: 'card-title', text: node.title }),
          el('p', { className: 'card-copy', text: node.copy }),
        ],
      })
    ),
  });
}

export function createEmptyState({ icon = '·', title, copy }) {
  return el('div', {
    className: 'empty-state',
    children: [
      el('div', { className: 'empty-state-icon', text: icon }),
      el('h3', { text: title }),
      el('p', { text: copy }),
    ],
  });
}

export function createCard({
  kicker,
  title,
  copy,
  body = [],
  badges = [],
  surface = 'panel',
}) {
  const bodyChildren = Array.isArray(body) ? body : [body];
  return el('article', {
    className: 'studio-card',
    attrs: { 'data-surface': surface },
    children: [
      el('div', {
        className: 'card-header',
        children: [
          el('div', {
            className: 'card-title-row',
            children: [
              el('div', {
                children: [
                  kicker ? el('p', { className: 'card-kicker', text: kicker }) : null,
                  el('h3', { className: 'card-title', text: title }),
                ],
              }),
              badges.length > 0 ? createBadgeRow(badges) : null,
            ],
          }),
          copy ? el('p', { className: 'card-copy', text: copy }) : null,
        ],
      }),
      el('div', {
        className: surface === 'canvas' ? 'canvas-stack' : 'card-body',
        children: bodyChildren,
      }),
    ],
  });
}

export function createStatusStrip(items = []) {
  return el('div', {
    className: 'status-strip',
    children: items.map((item) =>
      el('article', {
        className: 'status-block',
        children: [
          el('h3', { text: item.label }),
          el('p', { text: item.copy }),
        ],
      })
    ),
  });
}

export function createDisclosure({ summary, body = [], open = false }) {
  return el('details', {
    className: 'disclosure',
    attrs: open ? { open: true } : {},
    children: [
      el('summary', { className: 'disclosure-summary', text: summary }),
      el('div', { className: 'disclosure-body', children: Array.isArray(body) ? body : [body] }),
    ],
  });
}

export function createSplitPane({ controls = [], canvas = [] }) {
  return el('section', {
    className: 'split-pane',
    children: [
      el('div', { className: 'pane-stack', children: controls }),
      el('div', { className: 'pane-stack', children: canvas }),
    ],
  });
}

export function createLogEntry(entry) {
  return el('article', {
    className: 'log-entry',
    dataset: { tone: entry.tone || 'info' },
    children: [
      el('div', {
        children: [
          el('div', { className: 'log-status', text: entry.status }),
          el('p', { className: 'log-message', text: entry.message }),
        ],
      }),
      el('span', { className: 'log-meta', text: entry.time }),
    ],
  });
}
