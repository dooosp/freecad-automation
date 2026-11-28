import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { migrateConfigDocument } from '../../lib/config-schema.js';
import { buildOutputManifest } from '../../lib/output-manifest.js';
import { createReportService } from '../../src/services/report/report-service.js';

export async function createReportEvidenceFixture() {
  const root = resolve(import.meta.dirname, '../..');
  await mkdir(join(root, 'tmp/codex'), { recursive: true });
  const directory = await mkdtemp(join(root, 'tmp/codex/report-evidence-test-'));
  const configPath = join(directory, 'part.json');
  const rawConfig = {
    name: 'part',
    shapes: [{ id: 'plate', type: 'box', length: 40, width: 20, height: 8 }],
    export: { directory, formats: ['step'] },
  };
  const config = migrateConfigDocument(rawConfig, { filepath: configPath }).config;
  const paths = {
    create: join(directory, 'part_create_quality.json'),
    drawing: join(directory, 'part_drawing_quality.json'),
    semantics: join(directory, 'part_extracted_drawing_semantics.json'),
    svg: join(directory, 'part_drawing.svg'),
    createManifest: join(directory, 'part_manifest.json'),
    drawingManifest: join(directory, 'part_drawing_manifest.json'),
    pdf: join(directory, 'part_report.pdf'),
  };
  const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  await writeJson(configPath, rawConfig);
  await writeJson(paths.create, { status: 'pass', geometry: { valid_shape: true }, blocking_issues: [], warnings: [] });
  await writeJson(paths.drawing, {
    status: 'pass', score: 96, views: { overlap_count: 0 },
    dimensions: { missing_required_intents: [], conflict_count: 0 },
    traceability: { coverage_percent: 100 }, blocking_issues: [], warnings: [],
    extracted_drawing_semantics_file: paths.semantics,
  });
  await writeJson(paths.semantics, { artifact_type: 'extracted_drawing_semantics', status: 'pass' });
  await writeFile(paths.svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>8</text></svg>');
  async function writeManifests() {
    for (const [command, manifestPath, outputs] of [
      ['create', paths.createManifest, [{ path: paths.create, kind: 'model.create-quality-json' }]],
      ['draw', paths.drawingManifest, [
        { path: paths.drawing, kind: 'drawing.quality-json' },
        { path: paths.svg, kind: 'drawing.svg' },
        { path: paths.semantics, kind: 'drawing.extracted-semantics-json' },
      ]],
    ]) {
      const manifest = await buildOutputManifest({
        projectRoot: root, command, commandArgs: [configPath, ...(command === 'draw' ? ['--bom'] : []), '--strict-quality'],
        inputPath: configPath, outputs, status: 'pass',
        runtimeDiagnostics: { available: true, executable_detected: true, probe_status: 'usable', status: 'ready' },
      });
      await writeJson(manifestPath, manifest);
    }
  }
  await writeManifests();
  const generate = createReportService({
    loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
    getFreeCADRuntimeFn: () => ({ mode: 'native', available: true }),
  });
  return {
    root, directory, configPath, config, rawConfig, paths, writeJson, readJson, writeManifests,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    async report({ config: suppliedConfig = config, configPath: suppliedPath = configPath, duringRender = async () => {} } = {}) {
      let pdfSummary;
      const result = await generate({
        freecadRoot: root, configPath: suppliedPath, config: suppliedConfig, outputDir: directory,
        analysisResults: { dfm: { score: 96, issues: [], summary: { errors: 0, warnings: 0 } } },
        runScript: async (script, payload) => {
          pdfSummary = structuredClone(payload._decision_summary);
          await duringRender(payload);
          await writeFile(paths.pdf, '%PDF-fixture');
          return { success: true, path: paths.pdf };
        },
      });
      return { result, summary: await readJson(result.summary_json), pdfSummary };
    },
  };
}

// Pure summary tests model already-verified inputs; obtain their proof from the real
// file/manifest verifier instead of declaring a passing provenance object by hand.
export async function verifiedReportProvenance() {
  const fixture = await createReportEvidenceFixture();
  try {
    const { summary } = await fixture.report();
    return {
      create_quality: summary.surfaces.create_quality.evidence_provenance,
      drawing_quality: summary.surfaces.drawing_quality.evidence_provenance,
    };
  } finally { await fixture.cleanup(); }
}
