import { buildSafeSvg, clearElement, makeElement } from './dom.js';

export function renderBom(bomElement, bom) {
  if (!bomElement) return;

  if (bom && bom.length > 0) {
    clearElement(bomElement);
    bomElement.appendChild(makeElement('h4', { text: 'Bill of Materials' }));
    const table = document.createElement('table');
    const headerRow = document.createElement('tr');
    for (const title of ['#', 'Part', 'Material', 'Qty']) {
      headerRow.appendChild(makeElement('th', { text: title }));
    }
    table.appendChild(headerRow);

    bom.forEach((item, index) => {
      const row = document.createElement('tr');
      row.append(
        makeElement('td', { text: String(index + 1) }),
        makeElement('td', { text: item.id || '?' }),
        makeElement('td', { text: item.material || '-' }),
        makeElement('td', { text: String(item.count || 1) }),
      );
      table.appendChild(row);
    });

    bomElement.appendChild(table);
    bomElement.classList.add('open');
    return;
  }

  clearElement(bomElement);
  bomElement.classList.remove('open');
}

export function createDrawingRenderer({
  state,
  drawingOverlayElement,
  drawingContainerElement,
  drawingBomElement,
  drawZoomLabelElement,
  closeButton,
  zoomInButton,
  zoomOutButton,
  fitButton,
  onStatus = () => {},
  sendDimensionUpdate = () => {},
  getConfigToml = () => '',
  onDrawingStateChange = () => {},
}) {
  const drawingState = state.drawing;
  const dimensionState = state.dimensions;

  function syncDrawingState() {
    onDrawingStateChange({
      drawing: drawingState,
      dimensions: dimensionState,
    });
  }

  function updateEditPanel() {
    if (!drawZoomLabelElement) return;
    const count = dimensionState.history.length;
    drawZoomLabelElement.textContent = count > 0
      ? `${Math.round(drawingState.zoom * 100)}% | ${count} edit(s)`
      : `${Math.round(drawingState.zoom * 100)}%`;
    syncDrawingState();
  }

  function updateDrawingTransform() {
    const svgElement = drawingContainerElement.querySelector('svg');
    if (!svgElement) return;

    const viewBox = svgElement.getAttribute('viewBox');
    if (viewBox) {
      const [, , viewWidth, viewHeight] = viewBox.split(/\s+/).map(Number);
      svgElement.style.width = `${viewWidth}px`;
      svgElement.style.height = `${viewHeight}px`;
    }

    svgElement.style.transform = `translate(${drawingState.panX}px, ${drawingState.panY}px) scale(${drawingState.zoom})`;
    updateEditPanel();
  }

  function fitDrawing() {
    const svgElement = drawingContainerElement.querySelector('svg');
    if (!svgElement) return;

    const containerWidth = drawingContainerElement.clientWidth;
    const containerHeight = drawingContainerElement.clientHeight;
    const svgWidth = svgElement.viewBox.baseVal.width || svgElement.clientWidth;
    const svgHeight = svgElement.viewBox.baseVal.height || svgElement.clientHeight;

    if (svgWidth === 0 || svgHeight === 0) return;
    drawingState.zoom = Math.min(containerWidth / svgWidth, containerHeight / svgHeight) * 0.95;
    drawingState.panX = (containerWidth - svgWidth * drawingState.zoom) / 2;
    drawingState.panY = (containerHeight - svgHeight * drawingState.zoom) / 2;
    updateDrawingTransform();
  }

  function closeDrawing() {
    drawingOverlayElement.classList.remove('open');
    drawingBomElement.classList.remove('open');
    syncDrawingState();
  }

  function closeDimEdit() {
    if (dimensionState.input?.parentNode) {
      dimensionState.input.parentNode.removeChild(dimensionState.input);
    }
    dimensionState.input = null;
    dimensionState.editing = false;
    syncDrawingState();
  }

  function addEditHistory(dimId, oldValue, newValue) {
    if (dimensionState.index < dimensionState.history.length - 1) {
      dimensionState.history = dimensionState.history.slice(0, dimensionState.index + 1);
    }
    dimensionState.history.push({ dimId, oldValue, newValue });
    dimensionState.index = dimensionState.history.length - 1;
    updateEditPanel();
  }

  function undoDimEdit() {
    if (dimensionState.index < 0 || dimensionState.pending) return;
    const entry = dimensionState.history[dimensionState.index];
    dimensionState.pending = { op: 'undo', dimId: entry.dimId };
    sendDimensionUpdate({
      dimId: entry.dimId,
      valueMm: entry.oldValue,
      planPath: drawingState.lastPlanPath || '',
      configToml: getConfigToml(),
      historyOp: 'undo',
    });
    onStatus(`Undo: ${entry.dimId} → ${entry.oldValue}`, 'progress');
  }

  function redoDimEdit() {
    if (dimensionState.index >= dimensionState.history.length - 1 || dimensionState.pending) return;
    const entry = dimensionState.history[dimensionState.index + 1];
    dimensionState.pending = { op: 'redo', dimId: entry.dimId };
    sendDimensionUpdate({
      dimId: entry.dimId,
      valueMm: entry.newValue,
      planPath: drawingState.lastPlanPath || '',
      configToml: getConfigToml(),
      historyOp: 'redo',
    });
    onStatus(`Redo: ${entry.dimId} → ${entry.newValue}`, 'progress');
  }

  function submitDimEdit(input) {
    const dimId = input.dataset.dimId;
    const origValue = Number.parseFloat(input.dataset.origValue);
    const newValue = Number.parseFloat(input.value);

    if (Number.isNaN(newValue) || newValue <= 0) {
      onStatus(`Invalid value: ${input.value}`, 'error');
      closeDimEdit();
      return;
    }

    if (newValue === origValue) {
      closeDimEdit();
      return;
    }

    if (dimensionState.pending) {
      onStatus('Please wait for current edit to finish', 'progress');
      closeDimEdit();
      return;
    }

    dimensionState.pending = { op: 'edit', dimId };
    sendDimensionUpdate({
      dimId,
      valueMm: newValue,
      planPath: drawingState.lastPlanPath || '',
      configToml: getConfigToml(),
      historyOp: 'edit',
    });
    onStatus(`Updating ${dimId}: ${origValue} → ${newValue}...`, 'progress');
    closeDimEdit();
  }

  function openDimEdit(textElement) {
    closeDimEdit();
    dimensionState.editing = true;

    const dimId = textElement.getAttribute('data-dim-id');
    const valueMm = Number.parseFloat(textElement.getAttribute('data-value-mm'));
    if (!dimId || Number.isNaN(valueMm)) {
      dimensionState.editing = false;
      return;
    }

    const containerRect = drawingContainerElement.getBoundingClientRect();
    const textRect = textElement.getBoundingClientRect();

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.min = '0.01';
    input.value = String(valueMm);
    input.className = 'dim-edit-input';
    input.style.position = 'absolute';
    input.style.left = `${textRect.left - containerRect.left - 5}px`;
    input.style.top = `${textRect.top - containerRect.top - 5}px`;
    input.style.width = `${Math.max(60, textRect.width + 20)}px`;
    input.style.zIndex = '1000';
    input.style.fontSize = '14px';
    input.style.padding = '2px 4px';
    input.style.border = '2px solid #0066cc';
    input.style.borderRadius = '3px';
    input.style.background = '#fff';
    input.style.color = '#000';
    input.dataset.dimId = dimId;
    input.dataset.origValue = String(valueMm);

    drawingContainerElement.style.position = 'relative';
    drawingContainerElement.appendChild(input);
    dimensionState.input = input;
    input.focus();
    input.select();

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submitDimEdit(input);
      } else if (event.key === 'Escape') {
        closeDimEdit();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => closeDimEdit(), 150);
    });
  }

  function initDimensionEditing({ preserveHistory = false } = {}) {
    if (!preserveHistory) {
      dimensionState.history = [];
      dimensionState.index = -1;
    }
    dimensionState.pending = null;
    closeDimEdit();

    const svgElement = drawingContainerElement.querySelector('svg');
    if (!svgElement) return;

    const dimTexts = svgElement.querySelectorAll('text[data-dim-id]');
    dimTexts.forEach((element) => {
      element.style.cursor = 'pointer';

      element.addEventListener('mouseenter', () => {
        if (dimensionState.editing) return;
        element.setAttribute('data-orig-fill', element.getAttribute('fill') || '#000');
        element.setAttribute('fill', '#0066cc');
        element.style.fontWeight = 'bold';
      });

      element.addEventListener('mouseleave', () => {
        if (dimensionState.editing) return;
        element.setAttribute('fill', element.getAttribute('data-orig-fill') || '#000');
        element.style.fontWeight = '';
      });

      element.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        openDimEdit(element);
      });
    });
    syncDrawingState();
  }

  function showDrawing(svg, bom, scale, planPath = '') {
    if (!svg) {
      onStatus('No SVG in drawing result', 'error');
      return;
    }

    clearElement(drawingContainerElement);
    const safeSvg = buildSafeSvg(svg);
    if (!safeSvg) {
      onStatus('Drawing SVG could not be rendered safely', 'error');
      return;
    }

    drawingContainerElement.appendChild(safeSvg);
    const preserveHistory = Boolean(planPath)
      && planPath === drawingState.lastPlanPath
      && dimensionState.history.length > 0;
    drawingState.zoom = 1;
    drawingState.panX = 0;
    drawingState.panY = 0;
    drawingState.lastPlanPath = planPath;
    updateDrawingTransform();
    drawingOverlayElement.classList.add('open');
    renderBom(drawingBomElement, bom);
    initDimensionEditing({ preserveHistory });
    syncDrawingState();
  }

  function handleDimensionUpdated(message) {
    if ((message.history_op || 'edit') === 'edit') {
      addEditHistory(message.dim_id, message.old_value, message.new_value);
    } else if (message.history_op === 'undo') {
      if (dimensionState.index >= 0) dimensionState.index -= 1;
      updateEditPanel();
    } else if (message.history_op === 'redo') {
      if (dimensionState.index < dimensionState.history.length - 1) dimensionState.index += 1;
      updateEditPanel();
    }
    dimensionState.pending = null;
    syncDrawingState();
  }

  function clearPendingEdit() {
    dimensionState.pending = null;
    syncDrawingState();
  }

  function handleZoomInClick() {
    drawingState.zoom = Math.min(drawingState.zoom * 1.25, 10);
    updateDrawingTransform();
  }

  function handleZoomOutClick() {
    drawingState.zoom = Math.max(drawingState.zoom / 1.25, 0.1);
    updateDrawingTransform();
  }

  function handleContainerMouseDown(event) {
    if (event.button !== 0) return;
    drawingState.dragging = true;
    drawingState.dragStart = { x: event.clientX, y: event.clientY };
    drawingState.panStart = { x: drawingState.panX, y: drawingState.panY };
    drawingContainerElement.classList.add('grabbing');
    event.preventDefault();
  }

  function handleDimensionMouseDown(event) {
    if (event.target.closest('text[data-dim-id]')) {
      event.stopPropagation();
    }
  }

  function handleWindowMouseMove(event) {
    if (!drawingState.dragging) return;
    drawingState.panX = drawingState.panStart.x + (event.clientX - drawingState.dragStart.x);
    drawingState.panY = drawingState.panStart.y + (event.clientY - drawingState.dragStart.y);
    updateDrawingTransform();
  }

  function handleWindowMouseUp() {
    drawingState.dragging = false;
    drawingContainerElement?.classList.remove('grabbing');
  }

  function handleContainerWheel(event) {
    event.preventDefault();
    const rect = drawingContainerElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const oldZoom = drawingState.zoom;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    drawingState.zoom = Math.max(0.1, Math.min(10, drawingState.zoom * factor));

    drawingState.panX = mouseX - (mouseX - drawingState.panX) * (drawingState.zoom / oldZoom);
    drawingState.panY = mouseY - (mouseY - drawingState.panY) * (drawingState.zoom / oldZoom);
    updateDrawingTransform();
  }

  function handleDocumentKeydown(event) {
    if (!drawingOverlayElement.classList.contains('open')) return;

    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoDimEdit();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redoDimEdit();
    }
  }

  closeButton?.addEventListener('click', closeDrawing);
  fitButton?.addEventListener('click', fitDrawing);
  zoomInButton?.addEventListener('click', handleZoomInClick);
  zoomOutButton?.addEventListener('click', handleZoomOutClick);
  drawingContainerElement?.addEventListener('mousedown', handleContainerMouseDown);
  drawingContainerElement?.addEventListener('mousedown', handleDimensionMouseDown, true);
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup', handleWindowMouseUp);
  drawingContainerElement?.addEventListener('wheel', handleContainerWheel, { passive: false });
  document.addEventListener('keydown', handleDocumentKeydown);

  return {
    clearPendingEdit,
    closeDrawing,
    destroy() {
      closeButton?.removeEventListener('click', closeDrawing);
      fitButton?.removeEventListener('click', fitDrawing);
      zoomInButton?.removeEventListener('click', handleZoomInClick);
      zoomOutButton?.removeEventListener('click', handleZoomOutClick);
      drawingContainerElement?.removeEventListener('mousedown', handleContainerMouseDown);
      drawingContainerElement?.removeEventListener('mousedown', handleDimensionMouseDown, true);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      drawingContainerElement?.removeEventListener('wheel', handleContainerWheel, { passive: false });
      document.removeEventListener('keydown', handleDocumentKeydown);
    },
    fitDrawing,
    getPlanPath() {
      return drawingState.lastPlanPath;
    },
    handleDimensionUpdated,
    showDrawing,
  };
}
