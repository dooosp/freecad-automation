import {
  appendLabeledValue,
  appendReviewValue,
  clearElement,
  makeElement,
} from './dom.js';

export function renderModelInfo(modelInfoElement, model, fem) {
  if (!modelInfoElement || !model) return;

  clearElement(modelInfoElement);
  modelInfoElement.appendChild(makeElement('h3', { text: 'Model' }));
  appendLabeledValue(modelInfoElement, 'Name:', model.name || '\u2014');
  if (model.volume !== undefined) {
    appendLabeledValue(modelInfoElement, 'Volume:', `${Number(model.volume).toLocaleString()} mm\u00b3`);
  }
  if (model.faces !== undefined) {
    appendLabeledValue(modelInfoElement, 'Faces:', String(model.faces));
    appendLabeledValue(modelInfoElement, 'Edges:', String(model.edges ?? '\u2014'));
  }
  if (model.bounding_box) {
    const size = model.bounding_box.size;
    appendLabeledValue(
      modelInfoElement,
      'Size:',
      `${size[0].toFixed(1)} \u00d7 ${size[1].toFixed(1)} \u00d7 ${size[2].toFixed(1)} mm`,
    );
  }

  if (fem) {
    const section = makeElement('div', { className: 'fem-section' });
    section.appendChild(makeElement('h3', { text: 'FEM Results' }));
    appendLabeledValue(section, 'Material:', fem.material?.name || '\u2014');
    if (fem.mesh) {
      appendLabeledValue(
        section,
        'Mesh:',
        `${fem.mesh.nodes?.toLocaleString() ?? '\u2014'} nodes, ${fem.mesh.elements?.toLocaleString() ?? '\u2014'} elements`,
      );
    }
    if (fem.results) {
      const results = fem.results;
      if (results.displacement) {
        appendLabeledValue(section, 'Max disp:', `${results.displacement.max.toFixed(4)} mm`);
      }
      if (results.von_mises) {
        appendLabeledValue(section, 'Max stress:', `${results.von_mises.max.toFixed(2)} MPa`);
      }
      if (results.safety_factor !== undefined) {
        const safetyFactor = results.safety_factor;
        const color = safetyFactor >= 2 ? 'var(--success)' : safetyFactor >= 1 ? 'var(--warning)' : 'var(--error)';
        appendLabeledValue(section, 'Safety factor:', String(safetyFactor), { color });
      }
    }
    modelInfoElement.appendChild(section);
  }

  modelInfoElement.classList.add('open');
}

export function hideModelInfo(modelInfoElement) {
  modelInfoElement?.classList.remove('open');
}

export function renderReview(reviewPanelElement, report) {
  if (!reviewPanelElement || !report) return;

  clearElement(reviewPanelElement);
  reviewPanelElement.appendChild(makeElement('h3', { text: 'Design Review' }));

  if (report.mechanism_type) {
    appendReviewValue(reviewPanelElement, 'Type:', report.mechanism_type);
  }
  if (report.dof !== undefined) {
    appendReviewValue(reviewPanelElement, 'DOF:', String(report.dof));
  }

  if (report.motion_chain && report.motion_chain.length > 0) {
    const labelRow = makeElement('div');
    labelRow.appendChild(makeElement('span', { className: 'review-label', text: 'Motion Chain:' }));
    reviewPanelElement.appendChild(labelRow);
    const list = makeElement('ul', { className: 'review-chain' });
    for (const step of report.motion_chain) {
      list.appendChild(makeElement('li', { text: step }));
    }
    reviewPanelElement.appendChild(list);
  }

  if (report.materials_assigned && Object.keys(report.materials_assigned).length > 0) {
    const labelRow = makeElement('div');
    labelRow.appendChild(makeElement('span', { className: 'review-label', text: 'Materials:' }));
    reviewPanelElement.appendChild(labelRow);
    const table = makeElement('table', { className: 'review-materials' });
    for (const [part, material] of Object.entries(report.materials_assigned)) {
      const row = document.createElement('tr');
      row.append(
        makeElement('td', { text: part }),
        makeElement('td', { text: material }),
      );
      table.appendChild(row);
    }
    reviewPanelElement.appendChild(table);
  }

  if (report.recommendation) {
    reviewPanelElement.appendChild(makeElement('div', {
      className: 'review-recommendation',
      text: report.recommendation,
    }));
  }

  reviewPanelElement.classList.add('open');
}

export function hideReview(reviewPanelElement) {
  reviewPanelElement?.classList.remove('open');
}

function buildProgressBar(chars) {
  const pct = Math.min(100, Math.round((chars / 8000) * 100));
  const bar = makeElement('div', { className: 'stream-bar' });
  const fill = makeElement('div', { className: 'stream-bar-fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  return bar;
}

export function showStreamPreview(streamPreviewElement, chars, startedAt = Date.now()) {
  if (!streamPreviewElement) return;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  clearElement(streamPreviewElement);
  streamPreviewElement.append(
    buildProgressBar(chars),
    makeElement('span', { className: 'stream-stats', text: `${chars.toLocaleString()} chars · ${elapsed}s elapsed` }),
  );
  streamPreviewElement.classList.add('open');
}

export function hideStreamPreview(streamPreviewElement) {
  streamPreviewElement?.classList.remove('open');
}

export function createReviewRenderer({ modelInfoElement, reviewPanelElement, streamPreviewElement }) {
  return {
    renderModelInfo(model, fem) {
      renderModelInfo(modelInfoElement, model, fem);
    },
    hideModelInfo() {
      hideModelInfo(modelInfoElement);
    },
    renderReview(report) {
      renderReview(reviewPanelElement, report);
    },
    hideReview() {
      hideReview(reviewPanelElement);
    },
    showStreamPreview(chars, startedAt) {
      showStreamPreview(streamPreviewElement, chars, startedAt);
    },
    hideStreamPreview() {
      hideStreamPreview(streamPreviewElement);
    },
  };
}
