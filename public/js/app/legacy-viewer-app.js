import {
  buildFromToml,
  connectLegacyWs,
  createAnimationController,
  createDrawingRenderer,
  createReviewRenderer,
  createStatusPresenter,
  createViewerStore,
  drawFromToml,
  initScene,
} from './index.js';

async function loadExamples(examplesSelect) {
  try {
    const response = await fetch('/api/examples');
    const examples = await response.json();
    for (const example of examples) {
      const option = document.createElement('option');
      option.value = example.content;
      option.textContent = example.name;
      examplesSelect.appendChild(option);
    }
  } catch {
    // Examples are optional on the current serve path.
  }
}

export function mountLegacyViewer(elements) {
  const store = createViewerStore();
  const { state } = store;
  const status = createStatusPresenter(elements.statusElement);
  const reviewRenderer = createReviewRenderer({
    modelInfoElement: elements.modelInfoElement,
    reviewPanelElement: elements.reviewPanelElement,
    streamPreviewElement: elements.streamPreviewElement,
  });

  let animationController = null;
  let wsClient = null;

  const sceneController = initScene({
    viewport: elements.viewport,
    partsListElement: elements.partsListElement,
    opacityInput: elements.opacityInput,
    state,
    onStatus: status.showStatus,
    onResetScene: () => animationController?.clearMotion(),
    onFrame: () => animationController?.tick(),
  });

  animationController = createAnimationController({
    state,
    getPartMeshes: () => sceneController.getPartMeshes(),
    animationControlsElement: elements.animationControlsElement,
    playButton: elements.playButton,
    pauseButton: elements.pauseButton,
    resetButton: elements.resetButton,
    timelineInput: elements.timelineInput,
    timeDisplayElement: elements.timeDisplayElement,
    speedButtons: elements.speedButtons,
    onStatus: status.showStatus,
  });

  const drawingRenderer = createDrawingRenderer({
    state,
    drawingOverlayElement: elements.drawingOverlayElement,
    drawingContainerElement: elements.drawingContainerElement,
    drawingBomElement: elements.drawingBomElement,
    drawZoomLabelElement: elements.drawZoomLabelElement,
    closeButton: elements.drawCloseButton,
    zoomInButton: elements.drawZoomInButton,
    zoomOutButton: elements.drawZoomOutButton,
    fitButton: elements.drawFitButton,
    onStatus: status.showStatus,
    sendDimensionUpdate(payload) {
      wsClient?.updateDimension(payload);
    },
    getConfigToml() {
      return elements.editor.value;
    },
  });

  wsClient = connectLegacyWs({
    onOpen() {
      status.showStatus('Connected', 'success');
    },
    onClose() {
      status.showStatus('Disconnected — reconnecting...', 'error');
    },
    onError(message) {
      status.showStatus(message.message, 'error');
      drawingRenderer.clearPendingEdit();
      elements.buildButton.disabled = false;
      elements.designButton.disabled = false;
    },
    onBinary(arrayBuffer) {
      if (sceneController.hasPendingManifest()) {
        sceneController.addPartMesh(arrayBuffer);
      } else {
        sceneController.loadStl(arrayBuffer);
      }
    },
    onProgress(message) {
      status.showStatus(message.text, 'progress');
    },
    onStreamChunk(message) {
      status.showStatus(message.text, 'progress');
      reviewRenderer.showStreamPreview(message.chars, state.design.streamStartTime);
    },
    onMetadata(message) {
      reviewRenderer.renderModelInfo(message.model, message.fem);
    },
    onPartsManifest(message) {
      sceneController.prepareAssembly(message.parts);
      status.showStatus(`Loading ${message.parts.length} parts...`, 'progress');
    },
    onMotionData(message) {
      animationController.setMotionData(message);
    },
    onDrawingResult(message) {
      drawingRenderer.showDrawing(message.svg, message.bom, message.scale, message.plan_path || '');
      status.showStatus(`Drawing ready (${message.scale})`, 'success');
      elements.buildButton.disabled = false;
      elements.designButton.disabled = false;
    },
    onDimensionUpdated(message) {
      drawingRenderer.handleDimensionUpdated(message);
    },
    onDesignResult(message) {
      elements.editor.value = message.toml || '';
      reviewRenderer.hideStreamPreview();
      reviewRenderer.renderReview(message.report);
    },
    onComplete() {
      status.showStatus(
        animationController.hasMotionData() ? 'Build complete — motion ready' : 'Build complete',
        'success',
      );
      elements.buildButton.disabled = false;
      elements.designButton.disabled = false;
    },
    onWarning(message) {
      status.showStatus(message.message, 'progress');
    },
  });

  function buildModel() {
    const toml = elements.editor.value.trim();
    if (!toml) {
      status.showStatus('Config is empty', 'error');
      return;
    }
    if (!wsClient.isOpen()) {
      status.showStatus('Not connected', 'error');
      return;
    }

    elements.buildButton.disabled = true;
    reviewRenderer.hideModelInfo();
    status.showStatus('Sending build request...', 'progress');
    buildFromToml(wsClient, toml);
  }

  function requestDrawing() {
    const toml = elements.editor.value.trim();
    if (!toml) {
      status.showStatus('Config is empty', 'error');
      return;
    }
    if (!wsClient.isOpen()) {
      status.showStatus('Not connected', 'error');
      return;
    }

    elements.buildButton.disabled = true;
    status.showStatus('Generating drawing...', 'progress');
    drawFromToml(wsClient, toml);
  }

  function designModel() {
    const description = elements.designInput.value.trim();
    if (!description) {
      status.showStatus('Enter a mechanism description', 'error');
      return;
    }
    if (!wsClient.isOpen()) {
      status.showStatus('Not connected', 'error');
      return;
    }

    elements.designButton.disabled = true;
    elements.buildButton.disabled = true;
    reviewRenderer.hideReview();
    reviewRenderer.hideStreamPreview();
    state.design.streamStartTime = Date.now();
    status.showStatus('Sending design request...', 'progress');
    wsClient.designFromPrompt(description);
  }

  function clearScene() {
    sceneController.clearScene();
    reviewRenderer.hideModelInfo();
    status.showStatus('Scene cleared');
  }

  elements.designButton.addEventListener('click', designModel);
  elements.designInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      designModel();
    }
  });
  elements.buildButton.addEventListener('click', buildModel);
  elements.clearButton.addEventListener('click', clearScene);
  elements.screenshotButton.addEventListener('click', () => sceneController.takeScreenshot());
  elements.drawButton.addEventListener('click', requestDrawing);

  elements.wireframeInput.addEventListener('change', () => {
    sceneController.setWireframe(elements.wireframeInput.checked);
  });

  elements.edgesInput?.addEventListener('change', () => {
    sceneController.setEdgesVisible(elements.edgesInput.checked);
  });

  elements.opacityInput?.addEventListener('input', () => {
    sceneController.updateOpacity(Number(elements.opacityInput.value) / 100);
  });

  elements.examplesSelect.addEventListener('change', () => {
    if (elements.examplesSelect.value) {
      elements.editor.value = elements.examplesSelect.value;
    }
  });

  elements.editor.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = elements.editor.selectionStart;
      elements.editor.value = `${elements.editor.value.substring(0, start)}  ${elements.editor.value.substring(elements.editor.selectionEnd)}`;
      elements.editor.selectionStart = start + 2;
      elements.editor.selectionEnd = start + 2;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      buildModel();
    }
  });

  loadExamples(elements.examplesSelect);

  return {
    sceneController,
    animationController,
    drawingRenderer,
    reviewRenderer,
    wsClient,
  };
}
