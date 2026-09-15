export function updateSceneOpacity(defaultMaterial, partMeshes, value) {
  defaultMaterial.opacity = value;
  const transparent = value < 1;
  if (defaultMaterial.transparent !== transparent) {
    defaultMaterial.transparent = transparent;
    defaultMaterial.needsUpdate = true;
  }
  for (const part of partMeshes) {
    part.material.opacity = value;
  }
}
