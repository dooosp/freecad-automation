import assert from 'node:assert/strict';

import { renderEvidenceGraphSummary } from '../public/js/studio/evidence-graph-panel.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTestElement(tagName) {
  return {
    tagName: String(tagName).toLowerCase(),
    className: '',
    textContent: '',
    dataset: {},
    attributes: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    get outerHTML() {
      const classAttribute = this.className ? ` class="${escapeHtml(this.className)}"` : '';
      const dataAttributes = Object.entries(this.dataset)
        .map(([key, value]) => ` data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeHtml(value)}"`)
        .join('');
      const attributes = Object.entries(this.attributes)
        .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
        .join('');
      const childHtml = this.children
        .map((child) => (typeof child === 'string' ? escapeHtml(child) : child.outerHTML || escapeHtml(child.textContent || '')))
        .join('');
      return `<${this.tagName}${classAttribute}${dataAttributes}${attributes}>${escapeHtml(this.textContent)}${childHtml}</${this.tagName}>`;
    },
  };
}

globalThis.document = {
  createElement: createTestElement,
};

const panel = renderEvidenceGraphSummary({
  summary: {
    inspection_evidence_record_count: 0,
    generated_artifact_count: 5,
    readiness_gate_decision: 'hold_for_evidence_completion',
    readiness_status: 'needs_more_evidence',
  },
});

const html = panel.outerHTML;
assert.match(html, /needs_more_evidence/);
assert.match(html, /hold_for_evidence_completion/);
assert.match(html, /Inspection evidence records: 0/);
assert.match(html, /generated review\/control metadata.*do not satisfy inspection_evidence/i);

console.log('studio-evidence-graph-panel.test.js: ok');
