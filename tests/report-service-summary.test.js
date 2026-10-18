import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { createReportService } from '../src/services/report/report-service.js';
import { buildOutputManifest } from '../lib/output-manifest.js';
import { loadConfigWithDiagnostics } from '../lib/config-schema.js';
import { createHash } from 'node:crypto';
import { createDfmService } from '../src/services/analysis/dfm-service.js';
import { captureReportInput, readVerifiedReportQuality } from '../src/services/report/report-provenance.js';

// Synthetic filesystem evidence with a stub PDF renderer; no FreeCAD validation.
async function provenanceFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcad-report-provenance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { name: 'provenance', shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }] };
  const configPath = join(directory, 'source.json');
  const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  writeJson(configPath, config);
  const paths = {};
  for (const [key, command, filename] of [
    ['create_quality', 'create', 'provenance_manifest.json'],
    ['drawing_quality', 'draw', 'provenance_drawing_manifest.json'],
  ]) {
    const path = join(directory, `provenance_${key}.json`);
    const manifestPath = join(directory, filename);
    writeJson(path, { status: 'pass', score: 100, blocking_issues: [], warnings: [] });
    const manifest = await buildOutputManifest({
      projectRoot: process.cwd(), command, inputPath: configPath,
      outputs: [{ path, kind: command === 'create' ? 'model.create-quality' : 'drawing.quality-json' }],
      linkedArtifacts: { quality_json: path }, status: 'pass',
      runtimeDiagnostics: { available: false, status: 'synthetic_fixture', probe_status: 'not_invoked' },
    });
    writeJson(manifestPath, manifest);
    paths[key] = { path, manifestPath, manifest };
  }
  const payloads = [];
  const report = createReportService({
    loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
    getFreeCADRuntimeFn: () => ({ available: false }),
  });
  const dfm = await createDfmService({
    loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
    runPythonJsonScriptFn: async () => ({ status: 'pass', score: 100, checks: [] }),
  })({ freecadRoot: process.cwd(), config });
  const run = (extra = {}) => report({
    freecadRoot: process.cwd(), configPath, config, outputDir: directory,
    includeDrawing: false, includeTolerance: false, includeCost: false,
    analysisResults: { dfm },
    runScript: async (_script, payload) => {
      payloads.push(payload);
      return { success: true, path: join(directory, 'provenance_report.pdf') };
    },
    ...extra,
  });
  return { directory, config, configPath, paths, payloads, run, writeJson, dfm };
}

test('synthetic: changed config at the same path cannot inherit a previous quality pass', async (t) => {
  const fixture = await provenanceFixture(t);
  fixture.config.shapes[0].length = 20;
  fixture.writeJson(fixture.configPath, fixture.config);
  const result = await fixture.run();
  for (const summary of [fixture.payloads[0]._decision_summary, result.report_summary]) {
    assert.equal(summary.overall_status, 'incomplete');
    assert.notEqual(summary.ready_for_manufacturing_review, true);
    assert.equal(summary.surfaces.create_quality.provenance.reason, 'input_sha256_mismatch');
    assert.equal(summary.surfaces.drawing_quality.provenance.reason, 'input_sha256_mismatch');
  }
});

test('synthetic: a matching input manifest cannot bless replaced quality bytes', async (t) => {
  const fixture = await provenanceFixture(t);
  fixture.writeJson(fixture.paths.create_quality.path, { status: 'pass', score: 99 });
  const result = await fixture.run();
  assert.equal(result.report_summary.overall_status, 'incomplete');
  assert.equal(result.report_summary.surfaces.create_quality.provenance.reason, 'quality_sha256_mismatch');
});

for (const [name, change, reason] of [
  ['missing manifest', (entry) => rmSync(entry.manifestPath), 'manifest_missing'],
  ['malformed manifest', (entry) => writeFileSync(entry.manifestPath, '{'), 'manifest_invalid'],
  ['missing output hash', (entry) => {
    entry.manifest.outputs[0].sha256 = null;
    writeFileSync(entry.manifestPath, JSON.stringify(entry.manifest));
  }, 'output_record_unverifiable'],
  ['wrong command', (entry) => {
    entry.manifest.command = 'report';
    writeFileSync(entry.manifestPath, JSON.stringify(entry.manifest));
  }, 'manifest_command_mismatch'],
  ['failed producing run', (entry) => {
    entry.manifest.status = 'fail';
    writeFileSync(entry.manifestPath, JSON.stringify(entry.manifest));
  }, 'manifest_run_failed'],
  ['producing run errors despite pass status', (entry) => {
    entry.manifest.errors = ['Execution failed before producing this quality.'];
    writeFileSync(entry.manifestPath, JSON.stringify(entry.manifest));
  }, 'manifest_run_failed'],
]) {
  test(`synthetic: ${name} does not establish current quality`, async (t) => {
    const fixture = await provenanceFixture(t);
    change(fixture.paths.create_quality);
    const result = await fixture.run();
    assert.notEqual(result.report_summary.ready_for_manufacturing_review, true);
    assert.equal(result.report_summary.surfaces.create_quality.available, false);
    assert.equal(result.report_summary.surfaces.create_quality.provenance.reason, reason);
  });
}

test('synthetic: intact input and output hashes retain their producing runs', async (t) => {
  const fixture = await provenanceFixture(t);
  const result = await fixture.run();
  assert.equal(result.report_summary.overall_status, 'pass');
  assert.equal(result.report_summary.ready_for_manufacturing_review, true);
  for (const key of ['create_quality', 'drawing_quality']) {
    assert.equal(result.report_summary.surfaces[key].status, 'pass');
    assert.equal(result.report_summary.surfaces[key].provenance.status, 'verified');
    assert.equal(result.report_summary.surfaces[key].provenance.run_id, fixture.paths[key].manifest.run_id);
  }
});

test('synthetic: supplied DFM without current-input provenance cannot establish readiness', async (t) => {
  const fixture = await provenanceFixture(t);
  const result = await fixture.run({ analysisResults: { dfm: { status: 'pass', score: 100, checks: [] } } });
  assert.equal(result.report_summary.overall_status, 'incomplete');
  assert.equal(result.report_summary.surfaces.dfm.provenance.reason, 'analysis_provenance_missing');
  assert.equal(fixture.payloads[0].dfm_results.status, 'pass', 'supplied historical diagnostics remain readable');
});

test('synthetic: DFM for another config cannot establish current readiness', async (t) => {
  const fixture = await provenanceFixture(t);
  const config = structuredClone(fixture.config);
  config.shapes[0].length = 99;
  const dfm = await createDfmService({
    loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
    runPythonJsonScriptFn: async () => ({ status: 'pass', score: 100, checks: [] }),
  })({ freecadRoot: process.cwd(), config });
  const result = await fixture.run({ analysisResults: { dfm } });
  assert.equal(result.report_summary.overall_status, 'incomplete');
  assert.equal(result.report_summary.surfaces.dfm.provenance.reason, 'analysis_input_mismatch');
});

test('synthetic: changed DFM result cannot reuse a valid provenance record', async (t) => {
  const fixture = await provenanceFixture(t);
  fixture.dfm.score = 99;
  const result = await fixture.run();
  assert.equal(result.report_summary.overall_status, 'incomplete');
  assert.equal(result.report_summary.surfaces.dfm.provenance.reason, 'analysis_result_mismatch');
});

test('synthetic: malformed DFM run identity is unverifiable', async (t) => {
  const fixture = await provenanceFixture(t);
  fixture.dfm.report_provenance.run_id = 42;
  const result = await fixture.run();
  assert.equal(result.report_summary.overall_status, 'incomplete');
  assert.equal(result.report_summary.surfaces.dfm.provenance.reason, 'analysis_provenance_invalid');
});

for (const [label, override] of [['process', { process: 'casting' }], ['standard', { standard: 'ISO' }]]) {
  test(`synthetic: DFM ${label} override cannot attest the unchanged source config`, async (t) => {
    const fixture = await provenanceFixture(t);
    const dfm = await createDfmService({
      loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
      runPythonJsonScriptFn: async (_root, _script, input) => {
        assert.equal(label === 'process' ? input.manufacturing.process : input.standard, override[label]);
        return { status: 'pass', score: 100, checks: [] };
      },
    })({ freecadRoot: process.cwd(), config: fixture.config, ...override });
    const result = await fixture.run({ analysisResults: { dfm } });
    assert.equal(result.report_summary.overall_status, 'incomplete');
    assert.equal(result.report_summary.surfaces.dfm.provenance.reason, 'analysis_effective_input_mismatch');
  });
}

test('synthetic: matching effective DFM standard remains usable by the report', async (t) => {
  const fixture = await provenanceFixture(t);
  const dfm = await createDfmService({
    loadShopProfileFn: async () => null, loadRuleProfileFn: async () => null,
    runPythonJsonScriptFn: async (_root, _script, input) => {
      assert.equal(input.standard, 'ISO');
      return { status: 'pass', score: 100, checks: [] };
    },
  })({ freecadRoot: process.cwd(), config: fixture.config, standard: 'ISO' });
  const result = await fixture.run({ analysisResults: { dfm, standard: 'ISO' } });
  assert.equal(fixture.payloads[0].standard, 'ISO');
  assert.equal(result.report_summary.overall_status, 'pass');
});

async function failedDrawFixture(t, { replaceInput = false } = {}) {
  const fixture = await provenanceFixture(t);
  fixture.config.shapes[0].length = 20;
  fixture.config.export = { directory: fixture.directory };
  fixture.writeJson(fixture.configPath, fixture.config);
  const consumedBytes = readFileSync(fixture.configPath);
  const root = resolve(import.meta.dirname, '..');
  const source = `
    import { writeFileSync } from 'node:fs';
    export function createDrawingService() { return async () => {}; }
    export async function runDrawPipeline({ configPath, loadConfig }) {
      const input = await loadConfig(configPath);
      if (${replaceInput}) {
        input.shapes[0].length = 99;
        writeFileSync(configPath, JSON.stringify(input));
      }
      throw new Error('synthetic drawing failure before quality generation');
    }
  `;
  const preload = join(fixture.directory, 'stub-drawing.mjs');
  writeFileSync(preload, `
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      if (url === ${JSON.stringify(pathToFileURL(join(root, 'src/api/drawing.js')).href)}) {
        return { format: 'module', shortCircuit: true, source: ${JSON.stringify(source)} };
      }
      return nextLoad(url, context);
    } });
  `);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'bin/fcad.js'), 'draw', fixture.configPath], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, FREECAD_PYTHON: join(fixture.directory, 'unavailable-freecad') },
  });
  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.match(run.stderr, /synthetic drawing failure before quality generation/);
  const manifest = JSON.parse(readFileSync(fixture.paths.drawing_quality.manifestPath, 'utf8'));
  return { ...fixture, consumedBytes, manifest };
}

test('synthetic CLI: a failed draw cannot certify leftover passing quality', async (t) => {
  const fixture = await failedDrawFixture(t);
  const evidence = await readVerifiedReportQuality({
    qualityPath: fixture.paths.drawing_quality.path,
    manifestPath: fixture.paths.drawing_quality.manifestPath,
    command: 'draw', inputRecord: await captureReportInput(fixture.configPath, fixture.config),
  });
  assert.equal(fixture.manifest.status, 'fail');
  assert.equal(evidence.provenance.status, 'unverified');
  assert.equal(evidence.provenance.reason, 'manifest_run_failed');
  assert.equal(evidence.provenance.reported_status, 'pass');
  assert.match(evidence.provenance.manifest_errors.join(' '), /synthetic drawing failure/);
});

test('synthetic CLI: failed draw manifest preserves consumed bytes when the source path changes', async (t) => {
  const fixture = await failedDrawFixture(t, { replaceInput: true });
  assert.equal(fixture.manifest.input.sha256, createHash('sha256').update(fixture.consumedBytes).digest('hex'));
  assert.equal(fixture.manifest.input.size_bytes, fixture.consumedBytes.length);
});

test('synthetic: config provenance hashes the bytes parsed before later path replacement', async (t) => {
  const fixture = await provenanceFixture(t);
  const consumed = readFileSync(fixture.configPath);
  const loaded = await loadConfigWithDiagnostics(fixture.configPath, { captureInputRecord: true });
  fixture.writeJson(fixture.configPath, { ...fixture.config, shapes: [] });
  assert.equal(loaded.inputRecord?.sha256, createHash('sha256').update(consumed).digest('hex'));
  assert.equal(loaded.inputRecord?.size_bytes, consumed.length);
  assert.equal(loaded.config.shapes.length, 1);
});

test('synthetic: config provenance hashes original bytes before UTF-8 decoding', async (t) => {
  const fixture = await provenanceFixture(t);
  const bytes = Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  writeFileSync(fixture.configPath, bytes);
  const loaded = await loadConfigWithDiagnostics(fixture.configPath, { captureInputRecord: true });
  assert.equal(loaded.inputRecord.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(loaded.inputRecord.size_bytes, bytes.length);
});

test('synthetic CLI: manifest hashes produced quality even if its file changes before publication', (t) => {
  const root = resolve(import.meta.dirname, '..');
  const directory = mkdtempSync(join(tmpdir(), 'fcad-cli-quality-provenance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'input.json');
  const qualityPath = join(directory, 'probe_create_quality.json');
  const consumedQualityPath = join(directory, 'produced-quality.json');
  writeFileSync(configPath, JSON.stringify({
    name: 'probe', shapes: [{ id: 'body', type: 'box', length: 10, width: 10, height: 10 }],
    export: { directory, formats: ['step'] },
  }));
  const runnerSource = `
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    export async function runScript(script, input) {
      if (script !== 'create_model.py') throw new Error('Unexpected synthetic script: ' + script);
      const path = join(input.export.directory, input.name + '.step');
      writeFileSync(path, 'synthetic STEP');
      return { success: true, exports: [{ format: 'step', path }], model: {
        valid_shape: true, volume: 1000, faces: 6, edges: 12,
        bounding_box: { min: [0,0,0], max: [10,10,10], size: [10,10,10] },
      } };
    }
  `;
  const artifactUrl = pathToFileURL(join(root, 'lib/artifact-manifest.js')).href;
  const artifactSource = `
    export * from ${JSON.stringify(`${artifactUrl}?real`)};
    import { writeArtifactManifest as writeReal } from ${JSON.stringify(`${artifactUrl}?real`)};
    import { readFileSync, writeFileSync } from 'node:fs';
    export async function writeArtifactManifest(path, manifest) {
      const result = await writeReal(path, manifest);
      writeFileSync(${JSON.stringify(consumedQualityPath)}, readFileSync(${JSON.stringify(qualityPath)}));
      writeFileSync(${JSON.stringify(qualityPath)}, JSON.stringify({ status: 'pass' }));
      return result;
    }
  `;
  const preload = join(directory, 'stub-boundaries.mjs');
  writeFileSync(preload, `
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      if (url === ${JSON.stringify(pathToFileURL(join(root, 'lib/runner.js')).href)}) {
        return { format: 'module', shortCircuit: true, source: ${JSON.stringify(runnerSource)} };
      }
      if (url === ${JSON.stringify(artifactUrl)}) {
        return { format: 'module', shortCircuit: true, source: ${JSON.stringify(artifactSource)} };
      }
      return nextLoad(url, context);
    } });
  `);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'bin/fcad.js'), 'create', configPath], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, FREECAD_PYTHON: join(directory, 'unavailable-freecad') },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const manifest = JSON.parse(readFileSync(join(directory, 'probe_manifest.json'), 'utf8'));
  const record = manifest.outputs.find((output) => output.path === qualityPath);
  const producedBytes = readFileSync(consumedQualityPath);
  assert.equal(record.sha256, createHash('sha256').update(producedBytes).digest('hex'));
  assert.equal(record.size_bytes, producedBytes.length);
});

const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-report-summary-'));

try {
  const createQualityPath = join(TMP_DIR, 'service_probe_create_quality.json');
  const drawingQualityPath = join(TMP_DIR, 'service_probe_drawing_quality.json');
  const extractedSemanticsPath = join(TMP_DIR, 'service_probe_extracted_drawing_semantics.json');
  const pdfPath = join(TMP_DIR, 'service_probe_report.pdf');

  writeFileSync(createQualityPath, `${JSON.stringify({
    status: 'fail',
    geometry: {
      valid_shape: false,
    },
    blocking_issues: ['Generated model shape is invalid.'],
    warnings: [],
  }, null, 2)}\n`, 'utf8');
  writeFileSync(drawingQualityPath, `${JSON.stringify({
    status: 'fail',
    score: 71,
    extracted_drawing_semantics_file: extractedSemanticsPath,
    views: {
      overlap_count: 0,
    },
    dimensions: {
      missing_required_intents: ['HOLE_DIA'],
      conflict_count: 1,
    },
    traceability: {
      coverage_percent: 66.67,
    },
    blocking_issues: [
      { code: 'required-dimension-coverage', message: 'HOLE_DIA missing' },
      { code: 'dimension-conflicts', message: 'Dimension conflict count 1 exceeds the allowed maximum 0.' },
    ],
    warnings: [],
    recommended_actions: ['Add or map the missing required dimension intent(s): HOLE_DIA.'],
    semantic_quality: {
      extracted_evidence: {
        status: 'partial',
        advisory_only: true,
        path: extractedSemanticsPath,
        matched_required_dimensions: 0,
        matched_required_notes: 0,
        matched_required_views: 1,
        unknowns: ['Required dimension not reliably extracted: HOLE_DIA.'],
        limitations: ['Advisory-only foundation.'],
      },
    },
  }, null, 2)}\n`, 'utf8');
  writeFileSync(extractedSemanticsPath, `${JSON.stringify({
    artifact_type: 'extracted_drawing_semantics',
    status: 'partial',
    decision: 'advisory',
    coverage: {
      required_dimensions_total: 1,
      required_dimensions_extracted: 0,
      required_notes_total: 0,
      required_notes_extracted: 0,
      required_views_total: 1,
      required_views_extracted: 1,
    },
    unknowns: ['Required dimension not reliably extracted: HOLE_DIA.'],
    limitations: ['Advisory-only foundation.'],
  }, null, 2)}\n`, 'utf8');

  const configPath = join(TMP_DIR, 'service_probe.json');
  writeFileSync(configPath, JSON.stringify({
    name: 'service_probe',
    drawing_intent: {
      part_type: 'service_probe', required_views: ['top'],
      required_dimensions: [{ id: 'HOLE_DIA', feature: 'hole1', required: true }],
      missing_semantics_policy: 'advisory',
    },
    export: { directory: TMP_DIR },
  }));
  for (const [command, path, manifestPath] of [
    ['create', createQualityPath, join(TMP_DIR, 'service_probe_manifest.json')],
    ['draw', drawingQualityPath, join(TMP_DIR, 'service_probe_drawing_manifest.json')],
  ]) {
    writeFileSync(manifestPath, JSON.stringify(await buildOutputManifest({
      projectRoot: process.cwd(), command, inputPath: configPath,
      outputs: [{ path, kind: `${command}.quality-json` }],
      status: 'pass', runtimeDiagnostics: { available: false, status: 'synthetic_fixture' },
    })));
  }

  let capturedPayload = null;

  const generateReport = createReportService({
    loadShopProfileFn: async () => null,
    loadRuleProfileFn: async () => null,
    getFreeCADRuntimeFn: () => ({
      mode: 'macos-bundle',
      available: true,
    }),
    readFileFn: async (filePath, encoding) => {
      if (encoding === 'utf8') {
        return readFileSync(filePath, 'utf8');
      }
      return Buffer.from('pdf-bytes');
    },
  });

  const result = await generateReport({
    freecadRoot: process.cwd(),
    configPath,
    outputDir: TMP_DIR,
    runScript: async (script, payload) => {
      assert.equal(script, 'engineering_report.py');
      capturedPayload = payload;
      return {
        success: true,
        path: pdfPath,
        size_bytes: 1234,
      };
    },
    loadConfig: async () => ({
      name: 'service_probe',
      drawing_intent: {
        part_type: 'service_probe',
        required_views: ['top'],
        required_dimensions: [
          { id: 'HOLE_DIA', feature: 'hole1', required: true },
        ],
        missing_semantics_policy: 'advisory',
      },
      export: { directory: TMP_DIR },
    }),
    config: {
      name: 'service_probe',
      drawing_intent: {
        part_type: 'service_probe',
        required_views: ['top'],
        required_dimensions: [
          { id: 'HOLE_DIA', feature: 'hole1', required: true },
        ],
        missing_semantics_policy: 'advisory',
      },
      export: { directory: TMP_DIR },
    },
    includeDrawing: false,
    includeDfm: true,
    includeTolerance: false,
    includeCost: false,
    analysisResults: {
      dfm: {
        score: 64,
        issues: [
          {
            severity: 'critical',
            suggested_fix: 'Increase wall thickness around the drilled feature.',
            message: 'Thin wall around hole1 violates the machining minimum.',
          },
        ],
        summary: {
          errors: 1,
          warnings: 0,
          severity_counts: {
            critical: 1,
            major: 0,
            minor: 0,
            info: 0,
          },
          top_fixes: [
            {
              rule_id: 'DFM-01',
              suggested_fix: 'Increase wall thickness around the drilled feature.',
            },
          ],
        },
      },
    },
  });

  assert.ok(capturedPayload?._decision_summary, 'expected report payload to include decision summary');
  assert.ok(capturedPayload?._report_artifacts, 'expected report payload to include report artifact references');
  assert.equal(capturedPayload._decision_summary.overall_status, 'fail');
  assert.equal(capturedPayload._decision_summary.ready_for_manufacturing_review, false);
  assert.equal(result.summary_json.endsWith('_report_summary.json'), true);
  assert.equal(result.drawing_intent_json.endsWith('_drawing_intent.json'), true);
  assert.equal(result.feature_catalog_json.endsWith('_feature_catalog.json'), true);

  const summary = JSON.parse(readFileSync(result.summary_json, 'utf8'));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'create_quality' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'drawing_quality' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'drawing_intent' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'feature_catalog' && artifact.status === 'available'), true);
  assert.equal(summary.artifacts_referenced.some((artifact) => artifact.key === 'extracted_drawing_semantics' && artifact.status === 'available'), true);
  const drawingIntent = JSON.parse(readFileSync(result.drawing_intent_json, 'utf8'));
  assert.equal(drawingIntent.part_type, 'service_probe');
  assert.equal(summary.feature_catalog.available, true);
  const featureCatalog = JSON.parse(readFileSync(result.feature_catalog_json, 'utf8'));
  assert.equal(featureCatalog.artifact_type, 'feature_catalog');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('report-service-summary.test.js: ok');
