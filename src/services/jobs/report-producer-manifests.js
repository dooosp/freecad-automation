import { writeFile } from 'node:fs/promises';
import { buildOutputManifest, collectRepoContext, writeOutputManifest } from '../../../lib/output-manifest.js';
import {
  buildDrawLinkedArtifactsFromSvg,
  createOutputEntriesFromExports,
  createOutputEntriesFromPartFiles,
  createOutputEntry,
} from '../../cli/output-artifacts.js';
import { deriveReportArtifactPaths } from '../report/decision-report-summary.js';

export function beginTrackedReportProducer(projectRoot) {
  return { projectRoot, repoContext: collectRepoContext(projectRoot), startedAt: new Date().toISOString() };
}

async function saveProducerManifest({ run, command, path, source, effectiveInput, outputs, linkedArtifacts, quality }) {
  const warnings = [...(quality?.warnings || []), ...(quality?.blocking_issues || [])]
    .map((item) => typeof item === 'string' ? item : item?.message)
    .filter(Boolean);
  if (quality?.status !== 'pass') warnings.unshift(`${command} quality status: ${quality?.status || 'unknown'}.`);
  const manifest = await buildOutputManifest({
    projectRoot: run.projectRoot, repoContext: run.repoContext, command, commandArgs: [source.path],
    inputPath: source.path, inputRecord: source, effectiveInput, outputs, linkedArtifacts, warnings,
    status: warnings.length ? 'warning' : 'pass',
    timings: { startedAt: run.startedAt, finishedAt: new Date().toISOString() },
  });
  await writeOutputManifest(path, manifest);
}

export async function saveTrackedCreateProof({ run, outputDir, runtimeConfig, source, result, quality }) {
  const paths = deriveReportArtifactPaths({ outputDir, configName: runtimeConfig.name });
  await writeFile(paths.create_effective_config, JSON.stringify(runtimeConfig, null, 2));
  await saveProducerManifest({
    run, path: paths.create_manifest, command: 'create', source,
    effectiveInput: {
      schema_version: '1.0', authored_config_kind: 'model.effective-config-json',
      runtime_config_kind: 'model.effective-config-json', sources: [{ role: 'config', ...source }],
      recipe: { kind: 'create-v1' },
    },
    outputs: [
      ...createOutputEntriesFromExports(result.exports), ...createOutputEntriesFromPartFiles(result.assembly?.part_files),
      createOutputEntry('model.create-quality-json', quality.path),
      createOutputEntry('model.effective-config-json', paths.create_effective_config),
    ],
    linkedArtifacts: { quality_json: quality.path }, quality: quality.report,
  });
}

export async function saveTrackedDrawingProof({ run, outputDir, configName, result }) {
  const source = result.effective_input?.sources?.find((entry) => entry.role === 'config');
  // A custom renderer may not provide an exact runtime snapshot. Keep its existing report unverified.
  if (!source || !result.authored_config_path || !result.effective_config_path) return;
  const paths = deriveReportArtifactPaths({ outputDir, configName });
  const drawings = createOutputEntriesFromExports(result.drawing_paths, 'drawing');
  const svgRecord = drawings.find(({ kind }) => kind === 'drawing.svg');
  const svg = svgRecord?.path || result.svg_path || result.drawing_path;
  if (!svgRecord && svg) drawings.push(createOutputEntry('drawing.svg', svg));
  await saveProducerManifest({
    run, path: paths.drawing_manifest, command: 'draw',
    source: { path: source.path, sha256: source.sha256, size_bytes: source.size_bytes },
    effectiveInput: result.effective_input,
    outputs: [
      ...drawings,
      createOutputEntry('drawing.quality-json', result.drawing_quality_path),
      createOutputEntry('drawing.extracted-semantics-json', result.extracted_drawing_semantics_path),
      createOutputEntry('drawing.intent-json', result.drawing_intent_json),
      createOutputEntry('drawing.feature-catalog-json', result.feature_catalog_json),
      createOutputEntry('drawing.authored-config-json', result.authored_config_path),
      createOutputEntry('drawing.effective-config-json', result.effective_config_path),
    ].filter(Boolean),
    linkedArtifacts: buildDrawLinkedArtifactsFromSvg(svg), quality: result.drawing_quality,
  });
}
