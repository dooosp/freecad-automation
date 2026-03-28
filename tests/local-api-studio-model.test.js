import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-model-'));
const jobsDir = join(tmpRoot, 'jobs');
const previewDir = join(tmpRoot, 'preview-assets');
const modelPath = join(previewDir, 'preview-model.stl');
const partPath = join(previewDir, 'preview-part-0.stl');

mkdirSync(previewDir, { recursive: true });
writeFileSync(modelPath, 'solid preview-model\nendsolid preview-model\n', 'utf8');
writeFileSync(partPath, 'solid preview-part\nendsolid preview-part\n', 'utf8');

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

const fakeModelService = {
  async buildPreview() {
    return {
      preview: {
        id: 'model-preview-1',
        built_at: '2026-03-28T12:00:00.000Z',
        settings: {
          include_step: true,
          include_stl: true,
          per_part_stl: true,
        },
        overview: {
          name: 'demo-assembly',
          mode: 'assembly',
          part_count: 1,
          shape_count: 2,
          operation_count: 0,
          export_formats: ['step', 'stl'],
        },
        validation: {
          warnings: [],
          changed_fields: [],
          deprecated_fields: [],
        },
        logs: ['preview ok'],
        assembly: {
          part_files: [
            {
              id: 'body',
              label: 'Body',
              index: 0,
              size_bytes: 40,
              asset_url: '/api/studio/model-previews/model-preview-1/parts/0',
            },
          ],
        },
        motion_data: null,
        model_asset_url: '/api/studio/model-previews/model-preview-1/model',
      },
    };
  },
  getPreviewModelPath(id) {
    return id === 'model-preview-1' ? modelPath : null;
  },
  getPreviewPartPath(id, index) {
    return id === 'model-preview-1' && index === 0 ? partPath : null;
  },
  async validateConfigToml() {
    return {
      config: {},
      summary: {
        warnings: [],
        changed_fields: [],
        deprecated_fields: [],
      },
      overview: {
        name: 'demo-assembly',
        mode: 'assembly',
      },
    };
  },
  async designFromPrompt() {
    return {
      toml: '',
      report: null,
      validation: null,
    };
  },
  async dispose() {},
};

const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir,
  studioModelServiceFactory() {
    return fakeModelService;
  },
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const previewResponse = await fetch(`${baseUrl}/api/studio/model-preview`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: 'name = "demo-assembly"\n[[parts]]\nid = "body"\n',
      build_settings: {
        include_step: true,
        include_stl: true,
        per_part_stl: true,
      },
    }),
  });
  assert.equal(previewResponse.status, 200);
  const previewPayload = await previewResponse.json();
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.preview.id, 'model-preview-1');
  assert.equal(previewPayload.preview.model_asset_url, '/api/studio/model-previews/model-preview-1/model');
  assert.equal(previewPayload.preview.assembly.part_files[0].asset_url, '/api/studio/model-previews/model-preview-1/parts/0');

  const modelAssetResponse = await fetch(`${baseUrl}/api/studio/model-previews/model-preview-1/model`);
  assert.equal(modelAssetResponse.status, 200);
  assert.equal(modelAssetResponse.headers.get('content-type'), 'model/stl');
  assert.match(await modelAssetResponse.text(), /solid preview-model/);

  const modelPartResponse = await fetch(`${baseUrl}/api/studio/model-previews/model-preview-1/parts/0`);
  assert.equal(modelPartResponse.status, 200);
  assert.equal(modelPartResponse.headers.get('content-type'), 'model/stl');
  assert.match(await modelPartResponse.text(), /solid preview-part/);

  const missingAssetResponse = await fetch(`${baseUrl}/api/studio/model-previews/missing/model`, {
    headers: {
      accept: 'application/json',
    },
  });
  assert.equal(missingAssetResponse.status, 404);
  const missingPayload = await missingAssetResponse.json();
  assert.equal(missingPayload.ok, false);

  console.log('local-api-studio-model.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
