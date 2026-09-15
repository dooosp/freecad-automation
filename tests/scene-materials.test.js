import assert from 'node:assert/strict';
import { updateSceneOpacity } from '../public/js/app/scene-materials.js';

// Exercise production material mutation without a WebGL renderer. The single
// mesh uses defaultMaterial, whose opacity and transparent fields control alpha.
const defaultMaterial = { opacity: 1, transparent: false, wireframe: false };
const parts = [{
  mesh: { visible: false },
  edgeLines: { visible: false },
  material: { opacity: 1, transparent: true, wireframe: true, emissive: 0x264f78 },
}];

for (const [opacity, transparent] of [[0.1, true], [0.54, true], [1, false]]) {
  const wasTransparent = defaultMaterial.transparent;
  defaultMaterial.needsUpdate = false;
  updateSceneOpacity(defaultMaterial, [], opacity);
  assert.equal(defaultMaterial.opacity, opacity, 'single-model material must reflect the slider');
  assert.equal(defaultMaterial.transparent, transparent, 'alpha blending must follow single-model opacity');
  assert.equal(defaultMaterial.needsUpdate, wasTransparent !== transparent,
    'changing opaque/transparent mode invalidates the cached material program');
  assert.equal(defaultMaterial.wireframe, false);
  updateSceneOpacity(defaultMaterial, parts, opacity);
  assert.equal(parts[0].material.opacity, opacity, 'assembly opacity keeps working');
  assert.equal(parts[0].material.transparent, true, 'preserve assembly material configuration');
  assert.equal(parts[0].material.wireframe, true);
  assert.equal(parts[0].material.emissive, 0x264f78);
  assert.equal(parts[0].mesh.visible, false);
  assert.equal(parts[0].edgeLines.visible, false);
}

console.log('scene-materials.test.js: ok');
