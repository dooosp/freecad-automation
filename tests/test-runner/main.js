import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHarness } from '../test-runner-harness.js';
import { CORE_CASE_LAYERS, FULL_ONLY_CASE_LAYERS } from '../test-runner-layers.js';
import { createCaseRegistry } from './registry.js';
import { describeFreeCADRuntime, hasFreeCADRuntime, OUTPUT_DIR } from './shared.js';

export function parseProfileArg(argv = process.argv, env = process.env) {
  const raw = argv.find((arg) => arg.startsWith('--profile='));
  const profile = raw ? raw.split('=')[1] : (env.FCAD_TEST_PROFILE || 'core');
  if (profile === 'core' || profile === 'full') return profile;
  console.warn(`Unknown profile '${profile}', falling back to 'core'`);
  return 'core';
}

export function parseLayerIdsArg(argv = process.argv, env = process.env) {
  const raw = argv.find((arg) => arg.startsWith('--layers='));
  const layerValue = raw ? raw.slice('--layers='.length) : env.FCAD_TEST_LAYERS;
  if (!layerValue) return null;
  const layerIds = layerValue
    .split(',')
    .map((layerId) => layerId.trim())
    .filter(Boolean);
  return layerIds.length > 0 ? layerIds : null;
}

export function materializeLayers(layerDefs, caseRegistry) {
  return layerDefs.map((layer) => ({
    ...layer,
    cases: layer.caseNames.map((name) => {
      const fn = caseRegistry.get(name);
      if (typeof fn !== 'function') {
        throw new Error(`Unknown integration test case: ${name}`);
      }
      return [name, fn];
    }),
  }));
}

export async function main({ argv = process.argv, env = process.env } = {}) {
  const harness = createHarness();
  const { runCase, getResults, assert } = harness;
  const caseRegistry = createCaseRegistry(assert);

  console.log('FreeCAD Automation - Integration Tests');
  console.log('='.repeat(40));

  const profile = parseProfileArg(argv, env);
  console.log(`Profile: ${profile}`);
  console.log(`Runtime: ${describeFreeCADRuntime()}`);

  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!hasFreeCADRuntime()) {
    console.warn('FreeCAD runtime not available; running runtime-independent checks only.');
  }

  const runtimeReady = hasFreeCADRuntime();
  const requestedLayerIds = parseLayerIdsArg(argv, env);
  const selectedLayers = profile === 'full' && runtimeReady
    ? [...CORE_CASE_LAYERS, ...FULL_ONLY_CASE_LAYERS]
    : CORE_CASE_LAYERS;
  const availableLayerIds = new Set(selectedLayers.map((layer) => layer.id));

  if (requestedLayerIds) {
    const unknownLayerIds = requestedLayerIds.filter((layerId) => !availableLayerIds.has(layerId));
    if (unknownLayerIds.length > 0) {
      throw new Error(`Unknown runtime test layer(s): ${unknownLayerIds.join(', ')}`);
    }
    if (!runtimeReady && requestedLayerIds.some((layerId) => layerId !== 'runtime')) {
      throw new Error(`Requested runtime-backed layer(s) require a FreeCAD runtime: ${requestedLayerIds.join(', ')}`);
    }
  }

  const filteredLayers = requestedLayerIds
    ? selectedLayers.filter((layer) => requestedLayerIds.includes(layer.id))
    : selectedLayers;
  const layers = materializeLayers(filteredLayers, caseRegistry);

  for (const layer of layers) {
    if (!runtimeReady && layer.id !== 'runtime') continue;

    console.log(`
--- Layer: ${layer.label} ---`);
    for (const [name, fn] of layer.cases) {
      await runCase(name, fn);
    }
  }

  const { passed, failed } = getResults();
  console.log(`
${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
