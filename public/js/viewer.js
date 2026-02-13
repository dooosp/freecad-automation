import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// --- DOM ---
const viewport = document.getElementById('viewport');
const editor = document.getElementById('config-editor');
const examplesSelect = document.getElementById('examples');
const btnBuild = document.getElementById('btn-build');
const btnClear = document.getElementById('btn-clear');
const btnScreenshot = document.getElementById('btn-screenshot');
const chkWireframe = document.getElementById('chk-wireframe');
const statusEl = document.getElementById('status');
const modelInfoEl = document.getElementById('model-info');
const partsListEl = document.getElementById('parts-list');
const sliderOpacity = document.getElementById('slider-opacity');
const designInput = document.getElementById('design-input');
const btnDesign = document.getElementById('btn-design');
const reviewPanel = document.getElementById('review-panel');
const streamPreview = document.getElementById('stream-preview');

// --- Drawing DOM ---
const btnDraw = document.getElementById('btn-draw');
const drawingOverlay = document.getElementById('drawing-overlay');
const drawingContainer = document.getElementById('drawing-container');
const drawingBom = document.getElementById('drawing-bom');
const btnDrawClose = document.getElementById('btn-draw-close');
const btnDrawZin = document.getElementById('btn-draw-zin');
const btnDrawZout = document.getElementById('btn-draw-zout');
const btnDrawFit = document.getElementById('btn-draw-fit');
const drawZoomLabel = document.getElementById('draw-zoom-label');

// --- Drawing State ---
let drawZoom = 1;
let drawPanX = 0;
let drawPanY = 0;
let drawDragging = false;
let drawDragStart = { x: 0, y: 0 };
let drawPanStart = { x: 0, y: 0 };

// --- Animation DOM ---
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');
const timeline = document.getElementById('timeline');
const timeDisplay = document.getElementById('time-display');
const animControls = document.getElementById('animation-controls');

// --- Animation State ---
let motionData = null;
let motionPlaying = false;
let motionTime = 0;
let motionSpeed = 1.0;
let initialStates = new Map();
const clock = new THREE.Clock(false);

// --- PBR Material Definitions ---
const MATERIAL_DEFS = {
  steel:          { color: 0x8a8d91, metalness: 0.85, roughness: 0.35 },
  aluminum:       { color: 0xb0b8c0, metalness: 0.75, roughness: 0.28 },
  dark_steel:     { color: 0x4a4e54, metalness: 0.9,  roughness: 0.4  },
  painted_green:  { color: 0x2e7d32, metalness: 0.15, roughness: 0.55 },
  painted_orange: { color: 0xe65100, metalness: 0.1,  roughness: 0.5  },
  painted_yellow: { color: 0xf9a825, metalness: 0.12, roughness: 0.48 },
  painted_blue:   { color: 0x1565c0, metalness: 0.12, roughness: 0.5  },
  rubber:         { color: 0x1a1a1a, metalness: 0.0,  roughness: 0.9  },
  brass:          { color: 0xc5a54e, metalness: 0.85, roughness: 0.3  },
  cast_iron:      { color: 0x5c5c5c, metalness: 0.6,  roughness: 0.7  },
};
const PALETTE_ORDER = [
  'painted_blue','aluminum','painted_orange','steel',
  'painted_green','dark_steel','brass','painted_yellow',
];

function createPartMaterial(materialName, index) {
  const def = MATERIAL_DEFS[materialName]
    || MATERIAL_DEFS[PALETTE_ORDER[index % PALETTE_ORDER.length]];
  return new THREE.MeshStandardMaterial({
    color: def.color,
    metalness: def.metalness,
    roughness: def.roughness,
    transparent: true,
    opacity: sliderOpacity ? sliderOpacity.value / 100 : 1.0,
  });
}

// --- Edge Rendering ---
const EDGE_THRESHOLD = 30;
const EDGE_COLOR = 0x1a1a2e;
let edgesVisible = true;

// --- Three.js Scene ---
let scene, camera, renderer, controls;
let currentMesh = null;       // legacy single-part mesh
let assemblyGroup = null;     // THREE.Group for assembly
let partMeshes = [];          // [{mesh, material, label, id, edgeLines, edgeMat}]
let selectedPartIndex = -1;
let pendingManifest = null;   // waiting for binary STLs
let receivedPartCount = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Lights stored for dynamic repositioning
let keyLight, fillLight, rimLight, groundPlane;

// Default material for legacy single-part
let defaultMaterial;

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  camera = new THREE.PerspectiveCamera(35, viewport.clientWidth / viewport.clientHeight, 0.1, 10000);
  camera.position.set(150, 100, 150);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewport.appendChild(renderer.domElement);

  // PBR environment map
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // Lights — Hemisphere + Key(shadow) + Fill + Rim
  const hemi = new THREE.HemisphereLight(0xc8d0e0, 0x282c34, 0.4);
  scene.add(hemi);

  keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(100, 200, 150);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0002;
  scene.add(keyLight);
  scene.add(keyLight.target);

  fillLight = new THREE.DirectionalLight(0x8ab4f8, 0.4);
  fillLight.position.set(-80, 60, -60);
  scene.add(fillLight);

  rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
  rimLight.position.set(0, 10, -150);
  scene.add(rimLight);

  // Shadow-receiving ground plane
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  groundPlane = new THREE.Mesh(groundGeo, groundMat);
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = -0.1;
  groundPlane.receiveShadow = true;
  scene.add(groundPlane);

  // Grid + Axes
  const grid = new THREE.GridHelper(300, 30, 0x30363d, 0x21262d);
  grid.material.opacity = 0.4;
  grid.material.transparent = true;
  scene.add(grid);

  const axes = new THREE.AxesHelper(50);
  scene.add(axes);

  // Default material (PBR)
  defaultMaterial = new THREE.MeshStandardMaterial({
    color: 0x58a6ff,
    metalness: 0.5,
    roughness: 0.4,
  });

  // Resize
  window.addEventListener('resize', onResize);

  // Raycaster events
  renderer.domElement.addEventListener('click', onViewportClick);
  renderer.domElement.addEventListener('mousemove', onViewportHover);

  // Render loop
  animate();
}

function onResize() {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (motionPlaying && motionData) {
    const delta = clock.getDelta();
    motionTime += delta * motionSpeed;
    if (motionTime >= motionData.duration) {
      motionTime = motionData.loop ? motionTime % motionData.duration : motionData.duration;
      if (!motionData.loop) {
        motionPlaying = false;
        clock.stop();
      }
    }
    applyMotionFrame(motionTime);
    updateTimelineUI();
  }
  controls.update();
  renderer.render(scene, camera);
}

// --- STL Loading (legacy single-part) ---
function loadSTL(arrayBuffer) {
  clearAssembly();
  if (currentMesh) {
    if (currentMesh.userData.edgeLines) {
      currentMesh.userData.edgeLines.geometry.dispose();
    }
    if (currentMesh.userData.edgeMat) {
      currentMesh.userData.edgeMat.dispose();
    }
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
  }

  const loader = new STLLoader();
  let geometry = loader.parse(arrayBuffer);
  geometry = mergeVertices(geometry);
  geometry.computeVertexNormals();

  currentMesh = new THREE.Mesh(geometry, defaultMaterial);
  currentMesh.castShadow = true;
  currentMesh.receiveShadow = true;
  scene.add(currentMesh);

  // Edge lines for single-part
  const edgeGeo = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD);
  const edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.visible = edgesVisible;
  currentMesh.add(edgeLines);
  currentMesh.userData.edgeLines = edgeLines;
  currentMesh.userData.edgeMat = edgeMat;

  partsListEl.innerHTML = '';
  fitCamera(currentMesh);
}

// --- Assembly Part Loading ---
function prepareAssembly(manifest) {
  clearScene();
  pendingManifest = manifest;
  receivedPartCount = 0;

  assemblyGroup = new THREE.Group();
  scene.add(assemblyGroup);
  partMeshes = [];
  selectedPartIndex = -1;
}

function addPartMesh(arrayBuffer) {
  if (!pendingManifest) return;
  const index = receivedPartCount;
  const partInfo = pendingManifest[index];
  if (!partInfo) return;

  const loader = new STLLoader();
  let geometry = loader.parse(arrayBuffer);
  geometry = mergeVertices(geometry);
  geometry.computeVertexNormals();

  const mat = createPartMaterial(partInfo.material, index);

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.userData.partIndex = index;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  assemblyGroup.add(mesh);

  // Edge lines
  const edgeGeo = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD);
  const edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.visible = edgesVisible;
  mesh.add(edgeLines);

  partMeshes.push({ mesh, material: mat, label: partInfo.label, id: partInfo.id, edgeLines, edgeMat });

  receivedPartCount++;

  // All parts loaded → fit camera + build parts list
  if (receivedPartCount >= pendingManifest.length) {
    fitCamera(assemblyGroup);
    buildPartsList();
    pendingManifest = null;
  }
}

function buildPartsList() {
  let html = '<h3>Parts</h3>';
  for (let i = 0; i < partMeshes.length; i++) {
    const p = partMeshes[i];
    const color = '#' + p.material.color.getHexString();
    const cls = i === selectedPartIndex ? 'part-item selected' : 'part-item';
    html += `<div class="${cls}" data-index="${i}">`;
    html += `<span class="part-swatch" style="background:${color}"></span>`;
    html += `<span class="part-label">${p.label}</span>`;
    html += '</div>';
  }
  partsListEl.innerHTML = html;

  // Click events on part items
  partsListEl.querySelectorAll('.part-item').forEach(el => {
    el.addEventListener('click', () => {
      selectPart(parseInt(el.dataset.index));
    });
  });
}

function selectPart(index) {
  // Deselect previous
  if (selectedPartIndex >= 0 && selectedPartIndex < partMeshes.length) {
    partMeshes[selectedPartIndex].material.emissive.setHex(0x000000);
  }

  if (index === selectedPartIndex) {
    // Toggle off
    selectedPartIndex = -1;
  } else {
    selectedPartIndex = index;
    if (index >= 0 && index < partMeshes.length) {
      partMeshes[index].material.emissive.setHex(0x264f78);
    }
  }
  buildPartsList();
}

// --- Raycaster ---
function onViewportClick(event) {
  if (partMeshes.length === 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = partMeshes.map(p => p.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const idx = intersects[0].object.userData.partIndex;
    selectPart(idx);
  } else {
    selectPart(-1);
  }
}

function onViewportHover(event) {
  if (partMeshes.length === 0) {
    renderer.domElement.style.cursor = 'default';
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = partMeshes.map(p => p.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    renderer.domElement.style.cursor = 'pointer';
    const idx = intersects[0].object.userData.partIndex;
    setStatus(`Part: ${partMeshes[idx].label}`, 'success');
  } else {
    renderer.domElement.style.cursor = 'default';
  }
}

// --- Opacity ---
function updateOpacity(val) {
  for (const p of partMeshes) {
    p.material.opacity = val;
  }
}

// --- Camera ---
function fitCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 2;

  controls.target.copy(center);
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
  camera.lookAt(center);
  controls.update();

  // Reposition key light and shadow camera to match model bounds
  if (keyLight) {
    keyLight.position.set(center.x + maxDim, center.y + maxDim * 1.5, center.z + maxDim);
    keyLight.target.position.copy(center);
    keyLight.target.updateMatrixWorld();
    const s = maxDim * 1.5;
    keyLight.shadow.camera.left = -s;
    keyLight.shadow.camera.right = s;
    keyLight.shadow.camera.top = s;
    keyLight.shadow.camera.bottom = -s;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = maxDim * 5;
    keyLight.shadow.camera.updateProjectionMatrix();
  }

  // Move ground plane to model bottom
  if (groundPlane) {
    groundPlane.position.y = box.min.y - 0.1;
  }
}

// --- WebSocket ---
let ws = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => setStatus('Connected', 'success');

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      if (pendingManifest) {
        addPartMesh(event.data);
      } else {
        loadSTL(event.data);
      }
      return;
    }

    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'progress':
        setStatus(msg.text, 'progress');
        break;

      case 'stream_chunk':
        setStatus(msg.text, 'progress');
        showStreamPreview(msg.chars);
        break;

      case 'metadata':
        showModelInfo(msg.model, msg.fem);
        break;

      case 'parts_manifest':
        prepareAssembly(msg.parts);
        setStatus(`Loading ${msg.parts.length} parts...`, 'progress');
        break;

      case 'motion_data':
        motionData = msg;
        captureInitialStates();
        showAnimationControls();
        setStatus('Motion data loaded — press Play', 'success');
        break;

      case 'drawing_result':
        showDrawing(msg.svg, msg.bom, msg.scale);
        lastDrawPlanPath = msg.plan_path || '';
        initDimEditing();
        setStatus(`Drawing ready (${msg.scale})`, 'success');
        btnBuild.disabled = false;
        btnDesign.disabled = false;
        break;

      case 'dimension_updated':
        addEditHistory(msg.dim_id, msg.old_value, msg.new_value);
        break;

      case 'dimensions_list':
        // Could be used for a dimension panel
        break;

      case 'design_result':
        editor.value = msg.toml || '';
        hideStreamPreview();
        showReviewPanel(msg.report);
        break;

      case 'complete':
        setStatus(motionData ? 'Build complete — motion ready' : 'Build complete', 'success');
        btnBuild.disabled = false;
        btnDesign.disabled = false;
        break;

      case 'error':
        setStatus(msg.message, 'error');
        btnBuild.disabled = false;
        btnDesign.disabled = false;
        break;
    }
  };

  ws.onclose = () => {
    setStatus('Disconnected — reconnecting...', 'error');
    setTimeout(connectWS, 2000);
  };
}

function buildModel() {
  const toml = editor.value.trim();
  if (!toml) return setStatus('Config is empty', 'error');
  if (!ws || ws.readyState !== WebSocket.OPEN) return setStatus('Not connected', 'error');

  btnBuild.disabled = true;
  modelInfoEl.classList.remove('open');
  setStatus('Sending build request...', 'progress');

  ws.send(JSON.stringify({ action: 'build', config: toml }));
}

// --- UI ---
function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function showModelInfo(model, fem) {
  if (!model) return;

  let html = '<h3>Model</h3>';
  html += `<div><span class="label">Name:</span> <span class="value">${model.name || '\u2014'}</span></div>`;
  if (model.volume !== undefined) {
    html += `<div><span class="label">Volume:</span> <span class="value">${Number(model.volume).toLocaleString()} mm\u00b3</span></div>`;
  }
  if (model.faces !== undefined) {
    html += `<div><span class="label">Faces:</span> <span class="value">${model.faces}</span> &nbsp; <span class="label">Edges:</span> <span class="value">${model.edges}</span></div>`;
  }
  if (model.bounding_box) {
    const s = model.bounding_box.size;
    html += `<div><span class="label">Size:</span> <span class="value">${s[0].toFixed(1)} \u00d7 ${s[1].toFixed(1)} \u00d7 ${s[2].toFixed(1)} mm</span></div>`;
  }

  if (fem) {
    html += '<div class="fem-section"><h3>FEM Results</h3>';
    html += `<div><span class="label">Material:</span> <span class="value">${fem.material?.name || '\u2014'}</span></div>`;
    if (fem.mesh) {
      html += `<div><span class="label">Mesh:</span> <span class="value">${fem.mesh.nodes?.toLocaleString()} nodes, ${fem.mesh.elements?.toLocaleString()} elements</span></div>`;
    }
    if (fem.results) {
      const r = fem.results;
      if (r.displacement) {
        html += `<div><span class="label">Max disp:</span> <span class="value">${r.displacement.max.toFixed(4)} mm</span></div>`;
      }
      if (r.von_mises) {
        html += `<div><span class="label">Max stress:</span> <span class="value">${r.von_mises.max.toFixed(2)} MPa</span></div>`;
      }
      if (r.safety_factor !== undefined) {
        const sf = r.safety_factor;
        const color = sf >= 2 ? 'var(--success)' : sf >= 1 ? 'var(--warning)' : 'var(--error)';
        html += `<div><span class="label">Safety factor:</span> <span class="value" style="color:${color}">${sf}</span></div>`;
      }
    }
    html += '</div>';
  }

  modelInfoEl.innerHTML = html;
  modelInfoEl.classList.add('open');
}

function takeScreenshot() {
  const canvas = renderer.domElement;
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freecad-viewer.png';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function clearAssembly() {
  if (assemblyGroup) {
    for (const p of partMeshes) {
      p.mesh.geometry.dispose();
      p.material.dispose();
      if (p.edgeLines) {
        p.edgeLines.geometry.dispose();
      }
      if (p.edgeMat) {
        p.edgeMat.dispose();
      }
    }
    scene.remove(assemblyGroup);
    assemblyGroup = null;
    partMeshes = [];
    selectedPartIndex = -1;
  }
  pendingManifest = null;
  receivedPartCount = 0;
  partsListEl.innerHTML = '';
  // Reset motion state
  motionData = null;
  motionPlaying = false;
  motionTime = 0;
  initialStates.clear();
  clock.stop();
  hideAnimationControls();
}

function clearScene() {
  if (currentMesh) {
    if (currentMesh.userData.edgeLines) {
      currentMesh.userData.edgeLines.geometry.dispose();
    }
    if (currentMesh.userData.edgeMat) {
      currentMesh.userData.edgeMat.dispose();
    }
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh = null;
  }
  clearAssembly();
  modelInfoEl.classList.remove('open');
  setStatus('Scene cleared');
}

async function loadExamples() {
  try {
    const res = await fetch('/api/examples');
    const examples = await res.json();
    for (const ex of examples) {
      const opt = document.createElement('option');
      opt.value = ex.content;
      opt.textContent = ex.name;
      examplesSelect.appendChild(opt);
    }
  } catch {
    // examples not available
  }
}

// --- AI Design ---
let streamStartTime = 0;

function designModel() {
  const desc = designInput.value.trim();
  if (!desc) return setStatus('Enter a mechanism description', 'error');
  if (!ws || ws.readyState !== WebSocket.OPEN) return setStatus('Not connected', 'error');

  btnDesign.disabled = true;
  btnBuild.disabled = true;
  reviewPanel.classList.remove('open');
  hideStreamPreview();
  streamStartTime = Date.now();
  setStatus('Sending design request...', 'progress');

  ws.send(JSON.stringify({ action: 'design', description: desc }));
}

function showStreamPreview(chars) {
  if (!streamPreview) return;
  const elapsed = ((Date.now() - streamStartTime) / 1000).toFixed(0);
  const bar = buildProgressBar(chars);
  streamPreview.innerHTML = `${bar}<span class="stream-stats">${chars.toLocaleString()} chars &middot; ${elapsed}s elapsed</span>`;
  streamPreview.classList.add('open');
}

function buildProgressBar(chars) {
  // Estimate ~8k chars for a typical design, cap at 100%
  const pct = Math.min(100, Math.round((chars / 8000) * 100));
  return `<div class="stream-bar"><div class="stream-bar-fill" style="width:${pct}%"></div></div>`;
}

function hideStreamPreview() {
  if (streamPreview) streamPreview.classList.remove('open');
}

function showReviewPanel(report) {
  if (!report || !reviewPanel) return;

  let html = '<h3>Design Review</h3>';

  if (report.mechanism_type) {
    html += `<div><span class="review-label">Type:</span> <span class="review-value">${report.mechanism_type}</span></div>`;
  }
  if (report.dof !== undefined) {
    html += `<div><span class="review-label">DOF:</span> <span class="review-value">${report.dof}</span></div>`;
  }

  if (report.motion_chain && report.motion_chain.length > 0) {
    html += '<div><span class="review-label">Motion Chain:</span></div>';
    html += '<ul class="review-chain">';
    for (const step of report.motion_chain) {
      html += `<li>${step}</li>`;
    }
    html += '</ul>';
  }

  if (report.materials_assigned && Object.keys(report.materials_assigned).length > 0) {
    html += '<div><span class="review-label">Materials:</span></div>';
    html += '<table class="review-materials">';
    for (const [part, mat] of Object.entries(report.materials_assigned)) {
      html += `<tr><td>${part}</td><td>${mat}</td></tr>`;
    }
    html += '</table>';
  }

  if (report.recommendation) {
    html += `<div class="review-recommendation">${report.recommendation}</div>`;
  }

  reviewPanel.innerHTML = html;
  reviewPanel.classList.add('open');
}

// --- Events ---
btnDesign.addEventListener('click', designModel);
designInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    designModel();
  }
});
btnBuild.addEventListener('click', buildModel);
btnClear.addEventListener('click', clearScene);
btnScreenshot.addEventListener('click', takeScreenshot);

chkWireframe.addEventListener('change', () => {
  defaultMaterial.wireframe = chkWireframe.checked;
  for (const p of partMeshes) {
    p.material.wireframe = chkWireframe.checked;
  }
});

const chkEdges = document.getElementById('chk-edges');
if (chkEdges) {
  chkEdges.addEventListener('change', () => {
    edgesVisible = chkEdges.checked;
    // Toggle on assembly parts
    for (const p of partMeshes) {
      if (p.edgeLines) p.edgeLines.visible = edgesVisible;
    }
    // Toggle on single-part mesh
    if (currentMesh && currentMesh.userData.edgeLines) {
      currentMesh.userData.edgeLines.visible = edgesVisible;
    }
  });
}

if (sliderOpacity) {
  sliderOpacity.addEventListener('input', () => {
    updateOpacity(sliderOpacity.value / 100);
  });
}

examplesSelect.addEventListener('change', () => {
  if (examplesSelect.value) {
    editor.value = examplesSelect.value;
  }
});

// Tab key in textarea
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
  // Ctrl+Enter to build
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    buildModel();
  }
});

// --- Animation Functions ---

function captureInitialStates() {
  initialStates.clear();
  for (const p of partMeshes) {
    initialStates.set(p.id, {
      pos: p.mesh.position.clone(),
      quat: p.mesh.quaternion.clone(),
    });
  }
}

function showAnimationControls() {
  if (animControls) animControls.classList.add('visible');
}

function hideAnimationControls() {
  if (animControls) animControls.classList.remove('visible');
}

function applyMotionFrame(t) {
  if (!motionData || !motionData.parts) return;
  for (const p of partMeshes) {
    const partMotion = motionData.parts[p.id];
    if (!partMotion) continue;
    const initial = initialStates.get(p.id);
    if (!initial) continue;

    if (partMotion.type === 'revolute') {
      const angle = getAngleAtTime(partMotion.keyframes, t);
      applyRevoluteTransform(p.mesh, partMotion.axis, partMotion.anchor, angle, initial);
    } else if (partMotion.type === 'prismatic') {
      const disp = getDisplacementAtTime(partMotion.keyframes, t);
      applyPrismaticTransform(p.mesh, partMotion.axis, disp, initial);
    } else if (partMotion.type === 'cylindrical') {
      const angle = getAngleAtTime(partMotion.keyframes, t);
      const disp = getDisplacementAtTime(partMotion.keyframes, t);
      applyRevoluteTransform(p.mesh, partMotion.axis, partMotion.anchor, angle, initial);
      // Apply prismatic on top of revolute
      const axisVec = new THREE.Vector3(...partMotion.axis).normalize();
      p.mesh.position.addScaledVector(axisVec, disp);
    } else if (partMotion.type === 'floating') {
      // Floating link: per-keyframe moving anchor + delta rotation
      const angle = getAngleAtTime(partMotion.keyframes, t);
      const kfAnchor = getAnchorAtTime(partMotion.keyframes, t);
      const initAnchor = partMotion.anchor;
      applyFloatingTransform(p.mesh, partMotion.axis, initAnchor, kfAnchor, angle, initial);
    }
  }
}

function applyRevoluteTransform(mesh, axis, anchor, angleDeg, initial) {
  const rad = THREE.MathUtils.degToRad(angleDeg);
  const axisVec = new THREE.Vector3(...axis).normalize();
  const anchorVec = new THREE.Vector3(...anchor);

  // Reset to initial state
  mesh.position.copy(initial.pos);
  mesh.quaternion.copy(initial.quat);

  // Rotate position around anchor
  const offset = mesh.position.clone().sub(anchorVec);
  offset.applyAxisAngle(axisVec, rad);
  mesh.position.copy(anchorVec).add(offset);

  // Apply self rotation
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(axisVec, rad);
  mesh.quaternion.premultiply(rotQuat);
}

function getAngleAtTime(keyframes, t) {
  if (!keyframes || keyframes.length === 0) return 0;
  if (t <= keyframes[0].t) return keyframes[0].angle;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.angle;

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t < keyframes[i + 1].t) {
      const alpha = (t - keyframes[i].t) / (keyframes[i + 1].t - keyframes[i].t);
      return keyframes[i].angle + alpha * (keyframes[i + 1].angle - keyframes[i].angle);
    }
  }
  return last.angle;
}

function getDisplacementAtTime(keyframes, t) {
  if (!keyframes || keyframes.length === 0) return 0;
  if (t <= keyframes[0].t) return keyframes[0].displacement || 0;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.displacement || 0;

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t < keyframes[i + 1].t) {
      const alpha = (t - keyframes[i].t) / (keyframes[i + 1].t - keyframes[i].t);
      const d0 = keyframes[i].displacement || 0;
      const d1 = keyframes[i + 1].displacement || 0;
      return d0 + alpha * (d1 - d0);
    }
  }
  return last.displacement || 0;
}

function applyPrismaticTransform(mesh, axis, displacement, initial) {
  mesh.position.copy(initial.pos);
  mesh.quaternion.copy(initial.quat);
  const axisVec = new THREE.Vector3(...axis).normalize();
  mesh.position.addScaledVector(axisVec, displacement);
}

function applyFloatingTransform(mesh, axis, initAnchor, kfAnchor, angleDeg, initial) {
  // Floating link: translate by anchor delta, then rotate around new anchor
  mesh.position.copy(initial.pos);
  mesh.quaternion.copy(initial.quat);

  // 1. Translate by anchor movement
  const dx = kfAnchor[0] - initAnchor[0];
  const dy = kfAnchor[1] - initAnchor[1];
  const dz = kfAnchor[2] - initAnchor[2];
  mesh.position.add(new THREE.Vector3(dx, dy, dz));

  // 2. Rotate around new anchor by delta angle
  const rad = THREE.MathUtils.degToRad(angleDeg);
  const axisVec = new THREE.Vector3(...axis).normalize();
  const anchorVec = new THREE.Vector3(...kfAnchor);
  const offset = mesh.position.clone().sub(anchorVec);
  offset.applyAxisAngle(axisVec, rad);
  mesh.position.copy(anchorVec).add(offset);
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(axisVec, rad);
  mesh.quaternion.premultiply(rotQuat);
}

function getAnchorAtTime(keyframes, t) {
  if (!keyframes || keyframes.length === 0) return [0, 0, 0];
  if (t <= keyframes[0].t) return keyframes[0].anchor || [0, 0, 0];
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.anchor || [0, 0, 0];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t < keyframes[i + 1].t) {
      const alpha = (t - keyframes[i].t) / (keyframes[i + 1].t - keyframes[i].t);
      const a0 = keyframes[i].anchor || [0, 0, 0];
      const a1 = keyframes[i + 1].anchor || [0, 0, 0];
      return [
        a0[0] + alpha * (a1[0] - a0[0]),
        a0[1] + alpha * (a1[1] - a0[1]),
        a0[2] + alpha * (a1[2] - a0[2]),
      ];
    }
  }
  return last.anchor || [0, 0, 0];
}

function updateTimelineUI() {
  if (!motionData) return;
  if (timeline) {
    timeline.value = Math.round((motionTime / motionData.duration) * 1000);
  }
  if (timeDisplay) {
    timeDisplay.textContent = motionTime.toFixed(1) + 's';
  }
}

function resetMotion() {
  motionPlaying = false;
  motionTime = 0;
  clock.stop();
  if (motionData) {
    applyMotionFrame(0);
    updateTimelineUI();
  }
}

// Animation control events
if (btnPlay) {
  btnPlay.addEventListener('click', () => {
    if (!motionData) return;
    motionPlaying = true;
    clock.start();
  });
}

if (btnPause) {
  btnPause.addEventListener('click', () => {
    motionPlaying = false;
    clock.stop();
  });
}

if (btnReset) {
  btnReset.addEventListener('click', resetMotion);
}

if (timeline) {
  timeline.addEventListener('input', () => {
    if (!motionData) return;
    motionPlaying = false;
    clock.stop();
    motionTime = (timeline.value / 1000) * motionData.duration;
    applyMotionFrame(motionTime);
    if (timeDisplay) timeDisplay.textContent = motionTime.toFixed(1) + 's';
  });
}

// Speed buttons
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    motionSpeed = parseFloat(btn.dataset.speed) || 1.0;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

// --- Drawing Functions ---

function requestDrawing() {
  const toml = editor.value.trim();
  if (!toml) return setStatus('Config is empty', 'error');
  if (!ws || ws.readyState !== WebSocket.OPEN) return setStatus('Not connected', 'error');

  btnBuild.disabled = true;
  setStatus('Generating drawing...', 'progress');
  ws.send(JSON.stringify({ action: 'draw', config: toml }));
}

function showDrawing(svg, bom, scale) {
  if (!svg) return setStatus('No SVG in drawing result', 'error');

  drawingContainer.innerHTML = svg;
  drawZoom = 1;
  drawPanX = 0;
  drawPanY = 0;
  updateDrawingTransform();
  drawingOverlay.classList.add('open');

  // BOM table
  if (bom && bom.length > 0) {
    let html = '<h4>Bill of Materials</h4><table><tr><th>#</th><th>Part</th><th>Material</th><th>Qty</th></tr>';
    bom.forEach((item, i) => {
      html += `<tr><td>${i + 1}</td><td>${item.id || '?'}</td><td>${item.material || '-'}</td><td>${item.count || 1}</td></tr>`;
    });
    html += '</table>';
    drawingBom.innerHTML = html;
    drawingBom.classList.add('open');
  } else {
    drawingBom.classList.remove('open');
  }
}

function closeDrawing() {
  drawingOverlay.classList.remove('open');
  drawingBom.classList.remove('open');
}

function fitDrawing() {
  const svgEl = drawingContainer.querySelector('svg');
  if (!svgEl) return;

  const cw = drawingContainer.clientWidth;
  const ch = drawingContainer.clientHeight;
  const sw = svgEl.viewBox.baseVal.width || svgEl.clientWidth;
  const sh = svgEl.viewBox.baseVal.height || svgEl.clientHeight;

  if (sw === 0 || sh === 0) return;
  drawZoom = Math.min(cw / sw, ch / sh) * 0.95;
  drawPanX = (cw - sw * drawZoom) / 2;
  drawPanY = (ch - sh * drawZoom) / 2;
  updateDrawingTransform();
}

function updateDrawingTransform() {
  const svgEl = drawingContainer.querySelector('svg');
  if (!svgEl) return;

  // Remove fixed width/height to allow CSS transform to control size
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const [, , vw, vh] = vb.split(/\s+/).map(Number);
    svgEl.style.width = vw + 'px';
    svgEl.style.height = vh + 'px';
  }

  svgEl.style.transform = `translate(${drawPanX}px, ${drawPanY}px) scale(${drawZoom})`;
  if (drawZoomLabel) drawZoomLabel.textContent = Math.round(drawZoom * 100) + '%';
}

// Drawing event listeners
if (btnDraw) btnDraw.addEventListener('click', requestDrawing);
if (btnDrawClose) btnDrawClose.addEventListener('click', closeDrawing);
if (btnDrawFit) btnDrawFit.addEventListener('click', fitDrawing);

if (btnDrawZin) btnDrawZin.addEventListener('click', () => {
  drawZoom = Math.min(drawZoom * 1.25, 10);
  updateDrawingTransform();
});

if (btnDrawZout) btnDrawZout.addEventListener('click', () => {
  drawZoom = Math.max(drawZoom / 1.25, 0.1);
  updateDrawingTransform();
});

// Pan with mouse drag
if (drawingContainer) {
  drawingContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drawDragging = true;
    drawDragStart = { x: e.clientX, y: e.clientY };
    drawPanStart = { x: drawPanX, y: drawPanY };
    drawingContainer.classList.add('grabbing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!drawDragging) return;
    drawPanX = drawPanStart.x + (e.clientX - drawDragStart.x);
    drawPanY = drawPanStart.y + (e.clientY - drawDragStart.y);
    updateDrawingTransform();
  });

  window.addEventListener('mouseup', () => {
    drawDragging = false;
    if (drawingContainer) drawingContainer.classList.remove('grabbing');
  });

  // Zoom with mouse wheel
  drawingContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = drawingContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = drawZoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    drawZoom = Math.max(0.1, Math.min(10, drawZoom * factor));

    // Zoom towards cursor
    drawPanX = mx - (mx - drawPanX) * (drawZoom / oldZoom);
    drawPanY = my - (my - drawPanY) * (drawZoom / oldZoom);
    updateDrawingTransform();
  }, { passive: false });
}

// --- Dimension Editing ---

let dimEditHistory = [];       // [{dim_id, oldValue, newValue}]
let dimEditIndex = -1;         // current position in history
let dimEditInput = null;       // active <input> element
let dimEditing = false;        // true while editing

function initDimEditing() {
  dimEditHistory = [];
  dimEditIndex = -1;
  closeDimEdit();

  const svgEl = drawingContainer.querySelector('svg');
  if (!svgEl) return;

  // Find all dimension text elements with data-dim-id
  const dimTexts = svgEl.querySelectorAll('text[data-dim-id]');
  dimTexts.forEach(el => {
    el.style.cursor = 'pointer';

    el.addEventListener('mouseenter', () => {
      if (dimEditing) return;
      el.setAttribute('data-orig-fill', el.getAttribute('fill') || '#000');
      el.setAttribute('fill', '#0066cc');
      el.style.fontWeight = 'bold';
    });

    el.addEventListener('mouseleave', () => {
      if (dimEditing) return;
      el.setAttribute('fill', el.getAttribute('data-orig-fill') || '#000');
      el.style.fontWeight = '';
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openDimEdit(el);
    });
  });
}

function openDimEdit(textEl) {
  closeDimEdit();
  dimEditing = true;

  const dimId = textEl.getAttribute('data-dim-id');
  const valueMm = parseFloat(textEl.getAttribute('data-value-mm'));
  if (!dimId || isNaN(valueMm)) return;

  // Get position of text element relative to container
  const svgEl = drawingContainer.querySelector('svg');
  const containerRect = drawingContainer.getBoundingClientRect();
  const textRect = textEl.getBoundingClientRect();

  // Create input overlay
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.min = '0.01';
  input.value = valueMm;
  input.className = 'dim-edit-input';
  input.style.position = 'absolute';
  input.style.left = (textRect.left - containerRect.left - 5) + 'px';
  input.style.top = (textRect.top - containerRect.top - 5) + 'px';
  input.style.width = Math.max(60, textRect.width + 20) + 'px';
  input.style.zIndex = '1000';
  input.style.fontSize = '14px';
  input.style.padding = '2px 4px';
  input.style.border = '2px solid #0066cc';
  input.style.borderRadius = '3px';
  input.style.background = '#fff';
  input.style.color = '#000';
  input.dataset.dimId = dimId;
  input.dataset.origValue = valueMm;

  drawingContainer.style.position = 'relative';
  drawingContainer.appendChild(input);
  dimEditInput = input;
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitDimEdit(input);
    } else if (e.key === 'Escape') {
      closeDimEdit();
    }
  });

  input.addEventListener('blur', () => {
    // Small delay to allow click on other dim
    setTimeout(() => closeDimEdit(), 150);
  });
}

function submitDimEdit(input) {
  const dimId = input.dataset.dimId;
  const origValue = parseFloat(input.dataset.origValue);
  const newValue = parseFloat(input.value);

  if (isNaN(newValue) || newValue <= 0) {
    setStatus(`Invalid value: ${input.value}`, 'error');
    closeDimEdit();
    return;
  }

  if (newValue === origValue) {
    closeDimEdit();
    return;
  }

  // Send update to server
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'update_dimension',
      dim_id: dimId,
      value_mm: newValue,
      plan_path: lastDrawPlanPath || '',
      config_toml: editor.value,
    }));
    setStatus(`Updating ${dimId}: ${origValue} → ${newValue}...`, 'progress');
  }

  closeDimEdit();
}

function closeDimEdit() {
  if (dimEditInput && dimEditInput.parentNode) {
    dimEditInput.parentNode.removeChild(dimEditInput);
  }
  dimEditInput = null;
  dimEditing = false;
}

function addEditHistory(dimId, oldValue, newValue) {
  // Truncate future entries if we've undone
  if (dimEditIndex < dimEditHistory.length - 1) {
    dimEditHistory = dimEditHistory.slice(0, dimEditIndex + 1);
  }
  dimEditHistory.push({ dimId, oldValue, newValue });
  dimEditIndex = dimEditHistory.length - 1;
  updateEditPanel();
}

function undoDimEdit() {
  if (dimEditIndex < 0) return;
  const entry = dimEditHistory[dimEditIndex];
  dimEditIndex--;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'update_dimension',
      dim_id: entry.dimId,
      value_mm: entry.oldValue,
      plan_path: lastDrawPlanPath || '',
      config_toml: editor.value,
    }));
    setStatus(`Undo: ${entry.dimId} → ${entry.oldValue}`, 'progress');
  }
}

function redoDimEdit() {
  if (dimEditIndex >= dimEditHistory.length - 1) return;
  dimEditIndex++;
  const entry = dimEditHistory[dimEditIndex];

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'update_dimension',
      dim_id: entry.dimId,
      value_mm: entry.newValue,
      plan_path: lastDrawPlanPath || '',
      config_toml: editor.value,
    }));
    setStatus(`Redo: ${entry.dimId} → ${entry.newValue}`, 'progress');
  }
}

function updateEditPanel() {
  // Show edit count in toolbar
  const count = dimEditHistory.length;
  if (count > 0 && drawZoomLabel) {
    drawZoomLabel.textContent = `${Math.round(drawZoom * 100)}% | ${count} edit(s)`;
  }
}

// Keyboard shortcuts for undo/redo in drawing mode
document.addEventListener('keydown', (e) => {
  if (!drawingOverlay || !drawingOverlay.classList.contains('open')) return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoDimEdit();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redoDimEdit();
  }
});

// Prevent pan from starting when clicking on a dimension text
if (drawingContainer) {
  drawingContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest('text[data-dim-id]')) {
      e.stopPropagation();
    }
  }, true);
}

// Track last plan path for dimension updates
let lastDrawPlanPath = '';

// --- Init ---
initScene();
connectWS();
loadExamples();
