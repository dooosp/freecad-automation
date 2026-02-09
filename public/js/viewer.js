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

// --- Three.js Scene ---
let scene, camera, renderer, controls, currentMesh, material;

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

  // Material
  material = new THREE.MeshPhongMaterial({
    color: 0x58a6ff,
    specular: 0x222222,
    shininess: 40,
    flatShading: false,
  });

  // Resize
  window.addEventListener('resize', onResize);

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
  controls.update();
  renderer.render(scene, camera);
}

// --- STL Loading ---
function loadSTL(arrayBuffer) {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
  }

  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);
  geometry.computeVertexNormals();

  currentMesh = new THREE.Mesh(geometry, material);
  scene.add(currentMesh);

  fitCamera(currentMesh);
}

function fitCamera(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
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
      loadSTL(event.data);
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

      case 'complete':
        setStatus('Build complete', 'success');
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
  html += `<div><span class="label">Name:</span> <span class="value">${model.name || '—'}</span></div>`;
  if (model.volume !== undefined) {
    html += `<div><span class="label">Volume:</span> <span class="value">${Number(model.volume).toLocaleString()} mm³</span></div>`;
  }
  if (model.faces !== undefined) {
    html += `<div><span class="label">Faces:</span> <span class="value">${model.faces}</span> &nbsp; <span class="label">Edges:</span> <span class="value">${model.edges}</span></div>`;
  }
  if (model.bounding_box) {
    const s = model.bounding_box.size;
    html += `<div><span class="label">Size:</span> <span class="value">${s[0].toFixed(1)} × ${s[1].toFixed(1)} × ${s[2].toFixed(1)} mm</span></div>`;
  }

  if (fem) {
    html += '<div class="fem-section"><h3>FEM Results</h3>';
    html += `<div><span class="label">Material:</span> <span class="value">${fem.material?.name || '—'}</span></div>`;
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

function clearScene() {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh = null;
  }
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
  material.wireframe = chkWireframe.checked;
});

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

// --- Init ---
initScene();
connectWS();
loadExamples();
