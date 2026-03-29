export function connectLegacyWs({
  locationValue = window.location,
  reconnectDelayMs = 2000,
  onOpen = () => {},
  onClose = () => {},
  onError = () => {},
  onWarning = () => {},
  onBinary = () => {},
  onProgress = () => {},
  onStreamChunk = () => {},
  onMetadata = () => {},
  onPartsManifest = () => {},
  onMotionData = () => {},
  onDrawingResult = () => {},
  onDimensionUpdated = () => {},
  onDimensionsList = () => {},
  onDesignResult = () => {},
  onComplete = () => {},
}) {
  let socket = null;
  let shouldReconnect = true;

  function connect() {
    const protocol = locationValue.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${locationValue.host}`);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => onOpen();

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        onBinary(event.data);
        return;
      }

      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'progress':
          onProgress(message);
          break;
        case 'stream_chunk':
          onStreamChunk(message);
          break;
        case 'metadata':
          onMetadata(message);
          break;
        case 'parts_manifest':
          onPartsManifest(message);
          break;
        case 'motion_data':
          onMotionData(message);
          break;
        case 'drawing_result':
          onDrawingResult(message);
          break;
        case 'dimension_updated':
          onDimensionUpdated(message);
          break;
        case 'dimensions_list':
          onDimensionsList(message);
          break;
        case 'design_result':
          onDesignResult(message);
          break;
        case 'warning':
          onWarning(message);
          break;
        case 'complete':
          onComplete(message);
          break;
        case 'error':
          onError(message);
          break;
        default:
          break;
      }
    };

    socket.onclose = () => {
      onClose();
      if (shouldReconnect) {
        window.setTimeout(connect, reconnectDelayMs);
      }
    };
  }

  function sendJson(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  connect();

  return {
    buildFromToml(toml) {
      return sendJson({ action: 'build', config: toml });
    },
    close() {
      shouldReconnect = false;
      socket?.close();
    },
    designFromPrompt(description) {
      return sendJson({ action: 'design', description });
    },
    drawFromToml(toml) {
      return sendJson({ action: 'draw', config: toml });
    },
    getDimensions(planPath = '') {
      return sendJson({ action: 'get_dimensions', plan_path: planPath });
    },
    isOpen() {
      return socket?.readyState === WebSocket.OPEN;
    },
    updateDimension({ dimId, valueMm, planPath = '', configToml = '', historyOp = 'edit' }) {
      return sendJson({
        action: 'update_dimension',
        dim_id: dimId,
        value_mm: valueMm,
        plan_path: planPath,
        config_toml: configToml,
        history_op: historyOp,
      });
    },
  };
}

export function buildFromToml(client, toml) {
  return client.buildFromToml(toml);
}

export function drawFromToml(client, toml) {
  return client.drawFromToml(toml);
}
