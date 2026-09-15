// Small DOM adapter for drawing controller tests; no rendering or browser automation.
export class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.attrs = new Map();
    const classes = new Set();
    this.classList = { add: (...values) => values.forEach((v) => classes.add(v)), remove: (v) => classes.delete(v), contains: (v) => classes.has(v) };
    this.clientWidth = 400;
    this.clientHeight = 300;
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
  removeChild(node) { this.children = this.children.filter((child) => child !== node); node.parentNode = null; }
  set textContent(value) { this.replaceChildren({ nodeValue: String(value), children: [] }); }
  get textContent() { return this.children.map((child) => child.nodeValue ?? child.textContent).join(''); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  hasAttribute(name) { return this.attrs.has(name); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  matches(selector) {
    return selector.split(',').some((part) => {
      part = part.trim();
      if (part === '*') return true;
      if (part.startsWith('.')) return this.className?.split(' ').includes(part.slice(1));
      const match = part.match(/^(\w+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
      if (!match) return false;
      const [, tag, attr, value] = match;
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const actual = attr?.startsWith('data-') ? this.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(attr);
      return !attr || (value === undefined ? actual != null : actual === value);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest?.(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap((child) => child instanceof TestElement ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get isContentEditable() { const value = this.getAttribute('contenteditable'); return value === 'false' ? false : value != null || Boolean(this.parentElement?.isContentEditable); }
  focus() { document.activeElement = this; }
  select() {}
}

export function installDrawingTestDom() {
  const saved = new Map(['document', 'window', 'Element', 'HTMLElement', 'NodeFilter', 'DOMParser'].map((key) => [key, globalThis[key]]));
  const document = new TestElement('document');
  document.documentElement = new TestElement('html');
  document.createElement = (tag) => new TestElement(tag);
  document.importNode = (node) => node;
  document.createTreeWalker = (root) => {
    const nodes = [];
    const visit = (node) => { for (const child of node.children || []) { if ('nodeValue' in child) nodes.push(child); else visit(child); } };
    visit(root);
    return { nextNode: () => nodes.shift() || null };
  };
  Object.assign(globalThis, {
    document, window: new TestElement('window'), Element: TestElement, HTMLElement: TestElement,
    NodeFilter: { SHOW_TEXT: 4 },
    DOMParser: class {
      parseFromString() {
        const svg = new TestElement('svg');
        svg.setAttribute('viewBox', '0 0 400 300');
        svg.viewBox = { baseVal: { width: 400, height: 300 } };
        return { documentElement: svg, getElementsByTagName: () => [] };
      }
    },
  });
  return () => { for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}

export function drawingWorkspaceRoot() {
  const root = new TestElement();
  const hooks = ['summary', 'canvas', 'annotations', 'qa', 'dimensions', 'history', 'zoom-label', 'stage'];
  for (const hook of hooks) { const element = new TestElement(); element.dataset.hook = `drawing-${hook}`; root.append(element); }
  const card = new TestElement();
  card.className = 'studio-card';
  const bom = new TestElement();
  bom.dataset.hook = 'drawing-bom';
  card.append(bom);
  root.append(card);
  return root;
}
