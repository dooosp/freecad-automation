import { clearElement, makeElement } from './dom.js';
import { t } from '../i18n/index.js';

export function createAssemblyPartControls({ element, sceneState, getParts, saved = {} }) {
  let rows = [];

  function remember() {
    saved.selectedPartIndex = sceneState.selectedPartIndex;
    saved.hiddenPartIndices = getParts().flatMap((part, index) => part.mesh.visible ? [] : [index]);
  }

  function sync() {
    getParts().forEach((part, index) => {
      const selected = index === sceneState.selectedPartIndex;
      part.material.emissive.setHex(selected ? 0x264f78 : 0x000000);
      if (part.edgeLines) part.edgeLines.visible = part.mesh.visible && sceneState.edgesVisible;
      const row = rows[index];
      if (!row) return;
      row.item.className = `part-item${selected ? ' selected' : ''}${part.mesh.visible ? '' : ' part-hidden'}`;
      row.select.setAttribute('aria-pressed', String(selected));
      row.visibility.checked = part.mesh.visible;
    });
  }

  function select(index) {
    const valid = Number.isInteger(index) && index >= 0 && index < getParts().length;
    sceneState.selectedPartIndex = valid && index !== sceneState.selectedPartIndex ? index : -1;
    sync();
    remember();
  }

  function build(previewId = null) {
    clearElement(element);
    rows = [];
    const restore = previewId != null && previewId === saved.previewId;
    const parts = getParts();
    sceneState.selectedPartIndex = restore && Number.isInteger(saved.selectedPartIndex)
      && saved.selectedPartIndex >= 0 && saved.selectedPartIndex < parts.length ? saved.selectedPartIndex : -1;
    const hidden = new Set(restore && Array.isArray(saved.hiddenPartIndices) ? saved.hiddenPartIndices : []);
    saved.previewId = previewId;
    if (parts.length) element.appendChild(makeElement('h3', { text: 'Parts' }));

    parts.forEach((part, index) => {
      part.mesh.visible = !hidden.has(index);
      const name = part.label || part.id || t('viewer.partName', { number: index + 1 });
      const item = makeElement('div', { className: 'part-item' });
      item.dataset.index = String(index);
      const selectButton = makeElement('button', { className: 'part-select' });
      selectButton.type = 'button';
      const swatch = makeElement('span', { className: 'part-swatch' });
      swatch.style.background = `#${part.material.color.getHexString()}`;
      swatch.setAttribute('aria-hidden', 'true');
      const label = makeElement('span', { className: 'part-label' });
      label.textContent = name;
      selectButton.append(swatch, label);
      selectButton.addEventListener('click', () => select(index));

      const visibilityLabel = makeElement('label', { className: 'part-visibility' });
      const visibility = makeElement('input');
      visibility.type = 'checkbox';
      visibility.setAttribute('aria-label', t('viewer.showPart', { name }));
      visibility.addEventListener('change', () => {
        part.mesh.visible = visibility.checked;
        sync();
        remember();
      });
      visibilityLabel.append(visibility, makeElement('span', { text: t('viewer.visible') }));
      item.append(selectButton, visibilityLabel);
      element.appendChild(item);
      rows.push({ item, select: selectButton, visibility });
    });
    sync();
    remember();
  }

  return { build, select, sync };
}
