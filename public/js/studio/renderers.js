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
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  Object.entries(attrs).forEach(([name, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value));
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
