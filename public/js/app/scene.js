import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clearElement, makeElement } from './dom.js';

const EDGE_THRESHOLD = 30;
const EDGE_COLOR = 0x1a1a2e;

const MATERIAL_DEFS = {
  steel: { color: 0x8a8d91, metalness: 0.85, roughness: 0.35 },
  aluminum: { color: 0xb0b8c0, metalness: 0.75, roughness: 0.28 },
  dark_steel: { color: 0x4a4e54, metalness: 0.9, roughness: 0.4 },
  painted_green: { color: 0x2e7d32, metalness: 0.15, roughness: 0.55 },
  painted_orange: { color: 0xe65100, metalness: 0.1, roughness: 0.5 },
  painted_yellow: { color: 0xf9a825, metalness: 0.12, roughness: 0.48 },
  painted_blue: { color: 0x1565c0, metalness: 0.12, roughness: 0.5 },
  rubber: { color: 0x1a1a1a, metalness: 0, roughness: 0.9 },
  brass: { color: 0xc5a54e, metalness: 0.85, roughness: 0.3 },
  cast_iron: { color: 0x5c5c5c, metalness: 0.6, roughness: 0.7 },
};

const PALETTE_ORDER = [
  'painted_blue', 'aluminum', 'painted_orange', 'steel',
  'painted_green', 'dark_steel', 'brass', 'painted_yellow',
];

export function initScene({
  viewport,
  partsListElement,
  opacityInput,
  state,
  onStatus = () => {},
  onResetScene = () => {},
  onFrame = () => {},
}) {
  const sceneState = state.scene;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let scene;
  let camera;
  let renderer;
  let controls;
  let currentMesh = null;
  let assemblyGroup = null;
  let partMeshes = [];
  let keyLight;
  let fillLight;
  let rimLight;
  let groundPlane;
  let defaultMaterial;

  function createPartMaterial(materialName, index) {
    const def = MATERIAL_DEFS[materialName]
      || MATERIAL_DEFS[PALETTE_ORDER[index % PALETTE_ORDER.length]];
    return new THREE.MeshStandardMaterial({
      color: def.color,
      metalness: def.metalness,
      roughness: def.roughness,
      transparent: true,
      opacity: opacityInput ? Number(opacityInput.value) / 100 : 1,
    });
  }

  function buildPartsList() {
    clearElement(partsListElement);
    partsListElement.appendChild(makeElement('h3', { text: 'Parts' }));

    for (let index = 0; index < partMeshes.length; index += 1) {
      const part = partMeshes[index];
      const item = makeElement('div', {
        className: index === sceneState.selectedPartIndex ? 'part-item selected' : 'part-item',
      });
      item.dataset.index = String(index);

      const swatch = makeElement('span', { className: 'part-swatch' });
      swatch.style.background = `#${part.material.color.getHexString()}`;
      item.appendChild(swatch);
      item.appendChild(makeElement('span', {
        className: 'part-label',
        text: part.label || part.id || `Part ${index + 1}`,
      }));
      partsListElement.appendChild(item);
    }

    partsListElement.querySelectorAll('.part-item').forEach((element) => {
      element.addEventListener('click', () => {
        selectPart(Number.parseInt(element.dataset.index, 10));
      });
    });
  }

  function selectPart(index) {
    if (sceneState.selectedPartIndex >= 0 && sceneState.selectedPartIndex < partMeshes.length) {
      partMeshes[sceneState.selectedPartIndex].material.emissive.setHex(0x000000);
    }

    if (index === sceneState.selectedPartIndex) {
      sceneState.selectedPartIndex = -1;
    } else {
      sceneState.selectedPartIndex = index;
      if (index >= 0 && index < partMeshes.length) {
        partMeshes[index].material.emissive.setHex(0x264f78);
      }
    }

    buildPartsList();
  }

  function fitCamera(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2;

    controls.target.copy(center);
    camera.position.set(center.x + distance * 0.7, center.y + distance * 0.5, center.z + distance * 0.7);
    camera.lookAt(center);
    controls.update();

    if (keyLight) {
      keyLight.position.set(center.x + maxDim, center.y + maxDim * 1.5, center.z + maxDim);
      keyLight.target.position.copy(center);
      keyLight.target.updateMatrixWorld();
      const shadowSize = maxDim * 1.5;
      keyLight.shadow.camera.left = -shadowSize;
      keyLight.shadow.camera.right = shadowSize;
      keyLight.shadow.camera.top = shadowSize;
      keyLight.shadow.camera.bottom = -shadowSize;
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = maxDim * 5;
      keyLight.shadow.camera.updateProjectionMatrix();
    }

    if (groundPlane) {
      groundPlane.position.y = box.min.y - 0.1;
    }
  }

  function disposeCurrentMesh() {
    if (!currentMesh) return;
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

  function clearAssembly() {
    if (assemblyGroup) {
      for (const part of partMeshes) {
        part.mesh.geometry.dispose();
        part.material.dispose();
        if (part.edgeLines) {
          part.edgeLines.geometry.dispose();
        }
        if (part.edgeMat) {
          part.edgeMat.dispose();
        }
      }
      scene.remove(assemblyGroup);
      assemblyGroup = null;
      partMeshes = [];
      sceneState.selectedPartIndex = -1;
    }
    sceneState.pendingManifest = null;
    sceneState.receivedPartCount = 0;
    clearElement(partsListElement);
    onResetScene();
  }

  function clearScene() {
    disposeCurrentMesh();
    clearAssembly();
  }

  function loadStl(arrayBuffer) {
    clearAssembly();
    disposeCurrentMesh();

    const loader = new STLLoader();
    let geometry = loader.parse(arrayBuffer);
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();

    currentMesh = new THREE.Mesh(geometry, defaultMaterial);
    currentMesh.castShadow = true;
    currentMesh.receiveShadow = true;
    scene.add(currentMesh);

    const edgeGeometry = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.visible = sceneState.edgesVisible;
    currentMesh.add(edgeLines);
    currentMesh.userData.edgeLines = edgeLines;
    currentMesh.userData.edgeMat = edgeMaterial;

    clearElement(partsListElement);
    fitCamera(currentMesh);
  }

  function prepareAssembly(manifest) {
    clearScene();
    sceneState.pendingManifest = manifest;
    sceneState.receivedPartCount = 0;

    assemblyGroup = new THREE.Group();
    scene.add(assemblyGroup);
    partMeshes = [];
    sceneState.selectedPartIndex = -1;
  }

  function addPartMesh(arrayBuffer) {
    if (!sceneState.pendingManifest) return;
    const index = sceneState.receivedPartCount;
    const partInfo = sceneState.pendingManifest[index];
    if (!partInfo) return;

    const loader = new STLLoader();
    let geometry = loader.parse(arrayBuffer);
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();

    const material = createPartMaterial(partInfo.material, index);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.partIndex = index;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    assemblyGroup.add(mesh);

    const edgeGeometry = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.visible = sceneState.edgesVisible;
    mesh.add(edgeLines);

    partMeshes.push({
      mesh,
      material,
      label: partInfo.label,
      id: partInfo.id,
      edgeLines,
      edgeMat: edgeMaterial,
    });

    sceneState.receivedPartCount += 1;

    if (sceneState.receivedPartCount >= sceneState.pendingManifest.length) {
      fitCamera(assemblyGroup);
      buildPartsList();
      sceneState.pendingManifest = null;
    }
  }

  function setWireframe(enabled) {
    defaultMaterial.wireframe = enabled;
    for (const part of partMeshes) {
      part.material.wireframe = enabled;
    }
  }

  function setEdgesVisible(visible) {
    sceneState.edgesVisible = visible;
    for (const part of partMeshes) {
      if (part.edgeLines) part.edgeLines.visible = visible;
    }
    if (currentMesh?.userData.edgeLines) {
      currentMesh.userData.edgeLines.visible = visible;
    }
  }

  function updateOpacity(value) {
    for (const part of partMeshes) {
      part.material.opacity = value;
    }
  }

  function takeScreenshot() {
    const canvas = renderer.domElement;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'freecad-viewer.png';
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  function onViewportClick(event) {
    if (partMeshes.length === 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = partMeshes.map((part) => part.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      selectPart(intersects[0].object.userData.partIndex);
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
    const meshes = partMeshes.map((part) => part.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      renderer.domElement.style.cursor = 'pointer';
      const index = intersects[0].object.userData.partIndex;
      onStatus(`Part: ${partMeshes[index].label}`, 'success');
    } else {
      renderer.domElement.style.cursor = 'default';
    }
  }

  function onResize() {
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    onFrame();
    controls.update();
    renderer.render(scene, camera);
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  camera = new THREE.PerspectiveCamera(35, viewport.clientWidth / viewport.clientHeight, 0.1, 10000);
  camera.position.set(150, 100, 150);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewport.appendChild(renderer.domElement);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  const hemisphere = new THREE.HemisphereLight(0xc8d0e0, 0x282c34, 0.4);
  scene.add(hemisphere);

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

  const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
  const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.25 });
  groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = -0.1;
  groundPlane.receiveShadow = true;
  scene.add(groundPlane);

  const grid = new THREE.GridHelper(300, 30, 0x30363d, 0x21262d);
  grid.material.opacity = 0.4;
  grid.material.transparent = true;
  scene.add(grid);

  scene.add(new THREE.AxesHelper(50));

  defaultMaterial = new THREE.MeshStandardMaterial({
    color: 0x58a6ff,
    metalness: 0.5,
    roughness: 0.4,
  });

  renderer.domElement.addEventListener('click', onViewportClick);
  renderer.domElement.addEventListener('mousemove', onViewportHover);
  window.addEventListener('resize', onResize);
  animate();

  return {
    addPartMesh,
    clearScene,
    getPartMeshes() {
      return partMeshes;
    },
    hasPendingManifest() {
      return Boolean(sceneState.pendingManifest);
    },
    loadStl,
    prepareAssembly,
    setEdgesVisible,
    setWireframe,
    takeScreenshot,
    updateOpacity,
  };
}
