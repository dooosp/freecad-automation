import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

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

// --- Part Colors ---
const PART_COLORS = [
  0x58a6ff, 0x3fb950, 0xd29922, 0xf85149,
  0xbc8cff, 0x39d2c0, 0xff7b72, 0x79c0ff,
];

// --- Three.js Scene ---
let scene, camera, renderer, controls;
let currentMesh = null;       // legacy single-part mesh
let assemblyGroup = null;     // THREE.Group for assembly
let partMeshes = [];          // [{mesh, material, label, id}]
let selectedPartIndex = -1;
let pendingManifest = null;   // waiting for binary STLs
let receivedPartCount = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Default material for legacy single-part
let defaultMaterial;

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 10000);
  camera.position.set(150, 100, 150);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  viewport.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(100, 200, 150);
  scene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0x58a6ff, 0.3);
  backLight.position.set(-100, -50, -100);
  scene.add(backLight);

  // Grid + Axes
  const grid = new THREE.GridHelper(300, 30, 0x30363d, 0x21262d);
  scene.add(grid);

  const axes = new THREE.AxesHelper(50);
  scene.add(axes);

  // Default material
  defaultMaterial = new THREE.MeshPhongMaterial({
    color: 0x58a6ff,
    specular: 0x222222,
    shininess: 40,
    flatShading: false,
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
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
  }

  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);
  geometry.computeVertexNormals();

  currentMesh = new THREE.Mesh(geometry, defaultMaterial);
  scene.add(currentMesh);

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
  const geometry = loader.parse(arrayBuffer);
  geometry.computeVertexNormals();

  const color = PART_COLORS[index % PART_COLORS.length];
  const mat = new THREE.MeshPhongMaterial({
    color,
    specular: 0x222222,
    shininess: 40,
    flatShading: false,
    transparent: true,
    opacity: sliderOpacity ? sliderOpacity.value / 100 : 1.0,
  });

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.userData.partIndex = index;
  assemblyGroup.add(mesh);
  partMeshes.push({ mesh, material: mat, label: partInfo.label, id: partInfo.id });

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
    const color = '#' + PART_COLORS[i % PART_COLORS.length].toString(16).padStart(6, '0');
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

      case 'complete':
        setStatus(motionData ? 'Build complete — motion ready' : 'Build complete', 'success');
        btnBuild.disabled = false;
        break;

      case 'error':
        setStatus(msg.message, 'error');
        btnBuild.disabled = false;
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

// --- Events ---
btnBuild.addEventListener('click', buildModel);
btnClear.addEventListener('click', clearScene);
btnScreenshot.addEventListener('click', takeScreenshot);

chkWireframe.addEventListener('change', () => {
  defaultMaterial.wireframe = chkWireframe.checked;
  for (const p of partMeshes) {
    p.material.wireframe = chkWireframe.checked;
  }
});

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

// --- Init ---
initScene();
connectWS();
loadExamples();
