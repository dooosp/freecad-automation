import { dirname, join, parse, resolve } from 'node:path';

export function safeFilenameComponent(value, defaultValue = 'unnamed') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

export function createOutputEntry(kind, path) {
  if (!kind || !path) return null;
  return { kind, path };
}

export function createOutputEntriesFromExports(exports = [], prefix = 'model') {
  return (exports || [])
    .filter((entry) => entry?.format && entry?.path)
    .map((entry) => createOutputEntry(`${prefix}.${String(entry.format).toLowerCase()}`, entry.path))
    .filter(Boolean);
}

export function createOutputEntriesFromPartFiles(partFiles = [], kind = 'model.part-stl') {
  return (partFiles || [])
    .filter((entry) => entry?.path)
    .map((entry) => createOutputEntry(kind, entry.path))
    .filter(Boolean);
}

export function createCliOutputArtifactHelpers({
  buildDefaultOutputDir = null,
  projectRoot = process.cwd(),
} = {}) {
  const resolveOutputDir = typeof buildDefaultOutputDir === 'function'
    ? buildDefaultOutputDir
    : (preferredPath) => (preferredPath ? resolve(preferredPath) : resolve(projectRoot, 'output'));

  function buildExpectedModelOutputs(config = {}) {
    const exportConfig = config.export || {};
    const formats = Array.isArray(exportConfig.formats) ? exportConfig.formats : [];
    if (formats.length === 0) return [];
    const outputDir = resolveOutputDir(exportConfig.directory);
    const stem = safeFilenameComponent(config.name, 'unnamed');
    return formats.map((format) => createOutputEntry(`model.${String(format).toLowerCase()}`, join(outputDir, `${stem}.${format}`)));
  }

  function buildExpectedFemOutputs(config = {}) {
    const outputDir = resolveOutputDir(config.export?.directory);
    const stem = safeFilenameComponent(config.name, 'unnamed');
    return [
      createOutputEntry('analysis.fem.fcstd', join(outputDir, `${stem}.FCStd`)),
      ...buildExpectedModelOutputs(config).map((entry) => ({
        ...entry,
        kind: entry.kind.replace(/^model\./, 'analysis.fem.'),
      })),
    ].filter(Boolean);
  }

  function buildExpectedToleranceOutputs(config = {}) {
    if (!config?.tolerance?.csv) return [];
    const outputDir = resolveOutputDir(config.export?.directory);
    const stem = safeFilenameComponent(config.name, 'unnamed');
    return [
      createOutputEntry('analysis.tolerance.csv', join(outputDir, `${stem}_tolerance.csv`)),
    ];
  }

  function buildExpectedReportOutputs(config = {}) {
    const outputDir = config._report_output_dir
      ? resolveOutputDir(config._report_output_dir)
      : resolve(projectRoot, 'output');
    const stem = safeFilenameComponent(config.name, 'unnamed');
    return [
      createOutputEntry('report.pdf', join(outputDir, `${stem}_report.pdf`)),
      createOutputEntry('report.summary-json', join(outputDir, `${stem}_report_summary.json`)),
    ];
  }

  function buildExpectedDrawArtifacts(config = {}) {
    const outputDir = resolveOutputDir(config.export?.directory);
    const stem = safeFilenameComponent(config.name, 'unnamed');
    const svgPath = join(outputDir, `${stem}_drawing.svg`);
    return {
      primaryOutputPath: svgPath,
      outputs: [
        createOutputEntry('drawing.svg', svgPath),
        createOutputEntry('drawing.quality-json', svgPath.replace(/\.svg$/i, '_quality.json')),
        createOutputEntry('drawing.extracted-semantics-json', join(outputDir, `${stem}_extracted_drawing_semantics.json`)),
        createOutputEntry('drawing.intent-json', join(outputDir, `${stem}_drawing_intent.json`)),
        createOutputEntry('drawing.feature-catalog-json', join(outputDir, `${stem}_feature_catalog.json`)),
        config?.drawing?.dxf ? createOutputEntry('drawing.dxf', join(outputDir, `${stem}_front.dxf`)) : null,
        config?.drawing?.bom_csv ? createOutputEntry('drawing.csv', join(outputDir, `${stem}_bom.csv`)) : null,
      ].filter(Boolean),
      linkedArtifacts: {
        qa_json: svgPath.replace(/\.svg$/i, '_qa.json'),
        run_log_json: join(outputDir, `${stem}_run_log.json`),
        traceability_json: join(outputDir, `${stem}_traceability.json`),
        planner_json: join(outputDir, `${stem}_drawing_planner.json`),
        extracted_drawing_semantics_json: join(outputDir, `${stem}_extracted_drawing_semantics.json`),
        drawing_intent_json: join(outputDir, `${stem}_drawing_intent.json`),
        feature_catalog_json: join(outputDir, `${stem}_feature_catalog.json`),
        quality_json: svgPath.replace(/\.svg$/i, '_quality.json'),
      },
    };
  }

  return {
    buildExpectedDrawArtifacts,
    buildExpectedFemOutputs,
    buildExpectedModelOutputs,
    buildExpectedReportOutputs,
    buildExpectedToleranceOutputs,
  };
}

export function buildDrawLinkedArtifactsFromSvg(svgPath) {
  if (!svgPath) return {};
  const normalizedPath = svgPath.replace(/\\/g, '/');
  const stem = parse(normalizedPath).name.replace(/_drawing$/i, '');
  const dir = dirname(normalizedPath);
  return {
    qa_json: normalizedPath.replace(/\.svg$/i, '_qa.json'),
    run_log_json: join(dir, `${stem}_run_log.json`),
    traceability_json: join(dir, `${stem}_traceability.json`),
    planner_json: join(dir, `${stem}_drawing_planner.json`),
    extracted_drawing_semantics_json: join(dir, `${stem}_extracted_drawing_semantics.json`),
    drawing_intent_json: join(dir, `${stem}_drawing_intent.json`),
    feature_catalog_json: join(dir, `${stem}_feature_catalog.json`),
    quality_json: normalizedPath.replace(/\.svg$/i, '_quality.json'),
  };
}
