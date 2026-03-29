import { translateText } from '../i18n/index.js';

const SVG_ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'pattern', 'clipPath',
  'line', 'polyline', 'polygon', 'path', 'rect', 'circle', 'ellipse',
  'text', 'tspan', 'title', 'desc',
]);

const SVG_ALLOWED_ATTRS = new Set([
  'class', 'id', 'viewbox', 'xmlns', 'xmlns:xlink',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'd', 'transform',
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor',
  'dominant-baseline', 'preserveaspectratio',
  'vector-effect',
  'marker-start', 'marker-mid', 'marker-end',
  'patternunits', 'patterncontentunits',
]);

const SVG_ALLOWED_STYLE_PROPS = new Set([
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor',
  'dominant-baseline', 'display', 'visibility',
]);

export function makeElement(tag, { className, text } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = translateText(text);
  return element;
}

export function clearElement(element) {
  element?.replaceChildren();
}

export function appendLabeledValue(parent, label, value, valueOptions = {}) {
  const row = makeElement('div');
  const labelEl = makeElement('span', { className: 'label', text: label });
  const valueEl = makeElement('span', { className: valueOptions.className || 'value', text: value });
  if (valueOptions.color) valueEl.style.color = valueOptions.color;
  row.append(labelEl, document.createTextNode(' '), valueEl);
  parent.appendChild(row);
  return row;
}

export function appendReviewValue(parent, label, value) {
  const row = makeElement('div');
  row.append(
    makeElement('span', { className: 'review-label', text: label }),
    document.createTextNode(' '),
    makeElement('span', { className: 'review-value', text: value }),
  );
  parent.appendChild(row);
  return row;
}

export function showStatus(statusElement, text, type = '') {
  if (!statusElement) return;
  statusElement.textContent = translateText(text);
  statusElement.className = `status ${type}`;
}

export function createStatusPresenter(statusElement) {
  return {
    showStatus(text, type = '') {
      showStatus(statusElement, text, type);
    },
  };
}

function sanitizeInlineStyle(styleText) {
  return String(styleText)
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const separatorIndex = rule.indexOf(':');
      if (separatorIndex === -1) return null;
      const property = rule.slice(0, separatorIndex).trim().toLowerCase();
      const value = rule.slice(separatorIndex + 1).trim();
      if (!SVG_ALLOWED_STYLE_PROPS.has(property)) return null;
      if (/(?:url\s*\(|expression|javascript:|data:)/i.test(value)) return null;
      return `${property}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function isSafeSvgReference(value) {
  return typeof value === 'string' && value.startsWith('#');
}

function sanitizeSvgElement(root) {
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;

  const nodes = [root];
  while (nodes.length > 0) {
    const node = nodes.pop();
    const tag = node.tagName.toLowerCase();
    if (!SVG_ALLOWED_TAGS.has(tag)) {
      node.remove();
      continue;
    }

    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const isDataAttr = name.startsWith('data-') || name.startsWith('aria-');
      if (name.startsWith('on')) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'href' || name === 'xlink:href') && !isSafeSvgReference(value)) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'style') {
        const safeStyle = sanitizeInlineStyle(value);
        if (safeStyle) node.setAttribute('style', safeStyle);
        else node.removeAttribute(attribute.name);
        continue;
      }
      if (!isDataAttr && !SVG_ALLOWED_ATTRS.has(name)) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (/(?:javascript:|data:text\/html|vbscript:)/i.test(value)) {
        node.removeAttribute(attribute.name);
      }
    }

    nodes.push(...[...node.children]);
  }

  return root;
}

export function buildSafeSvg(svgMarkup) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return null;
  }

  const safeRoot = sanitizeSvgElement(doc.documentElement);
  return safeRoot ? document.importNode(safeRoot, true) : null;
}
