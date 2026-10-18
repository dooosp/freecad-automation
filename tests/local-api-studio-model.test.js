import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

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

async function verifyConfigFormats() {
  const { server: configServer, studioModelService } = createLocalApiServer({
    projectRoot: ROOT,
    jobsDir: join(tmpRoot, 'config-jobs'),
  });
  try {
    const port = await listen(configServer);
    const configToml = `
name = "format-compat"
material = "AL6061"
[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 4
[[operations]]
type = "fillet"
target = "body"
radius = 1
[drawing]
views = ["front"]
[export]
step = true
`;
    const configJson = JSON.stringify({
      name: 'format-compat',
      material: 'AL6061',
      shapes: [{ id: 'body', type: 'box', length: 20, width: 10, height: 4 }],
      operations: [{ type: 'fillet', target: 'body', radius: 1 }],
      drawing: { views: ['front'] },
      export: { step: true },
    });
    const tomlValidation = await studioModelService.validateConfigToml(configToml);
    const jsonValidation = await studioModelService.validateConfigToml(` \n${configJson}\n `);
    assert.deepEqual(jsonValidation, tomlValidation,
      'JSON and TOML must share canonical normalization and diagnostics');
    assert.equal(jsonValidation.config.config_version, 1);
    assert.equal(jsonValidation.config.operations[0].op, 'fillet');
    assert.equal(jsonValidation.config.manufacturing.material, 'AL6061');
    assert.equal(jsonValidation.config.drawing.units, 'mm');
    assert.deepEqual(jsonValidation.config.export.formats, ['step']);
    assert.equal(jsonValidation.overview.shape_count, 1);
    assert.equal(jsonValidation.overview.operation_count, 1);
    assert.ok(jsonValidation.summary.deprecated_fields.length > 0);

    const tableFirst = await studioModelService.validateConfigToml('[export]\nformats = ["step"]');
    assert.deepEqual(tableFirst.config.export.formats, ['step'], 'TOML tables must not be treated as JSON arrays');

    for (const configText of ['shapes = "not-an-array"', '{"shapes":"not-an-array"}']) {
      await assert.rejects(studioModelService.validateConfigToml(configText), /root\.shapes must be array/);
      await assert.rejects(studioModelService.buildPreview({ configToml: configText }), /root\.shapes must be array/);
    }
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      for (const configText of [`[metadata]\n${key} = "unsafe"`, `{"metadata":{"${key}":"unsafe"}}`]) {
        await assert.rejects(studioModelService.validateConfigToml(configText), /Unsafe config key/);
        await assert.rejects(studioModelService.buildPreview({ configToml: configText }), /Unsafe config key/);
      }
    }

    async function postConfig(route, configText) {
      const response = await fetch(`http://127.0.0.1:${port}/api/studio/${route}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ config_toml: configText }),
      });
      return { status: response.status, payload: await response.json() };
    }
    const tomlResponse = await postConfig('validate-config', configToml);
    const jsonResponse = await postConfig('validate-config', configJson);
    assert.equal(jsonResponse.status, 200);
    assert.equal(validateLocalApiResponse('studio_validate_config', jsonResponse.payload).ok, true);
    assert.deepEqual(jsonResponse, tomlResponse, 'legacy config_toml API field accepts either format');

    const malformedJson = '{"name":"format-compat",}';
    for (const [route, code] of [['validate-config', 'invalid_config'], ['model-preview', 'model_preview_failed']]) {
      const invalidResponse = await postConfig(route, malformedJson);
      assert.equal(invalidResponse.status, 400, `${route} must classify malformed JSON as an input error`);
      assert.equal(invalidResponse.payload.error.code, code);
      assert.match(invalidResponse.payload.error.messages.join('\n'), /JSON parse error:.*(?:position|line|property name)/i);
    }
  } finally {
    await new Promise((resolveClose) => configServer.close(resolveClose));
    await studioModelService.dispose();
  }
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

  const validationResponse = await fetch(`${baseUrl}/api/studio/validate-config`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: 'name = "demo-assembly"\n[[parts]]\nid = "body"\n',
    }),
  });
  assert.equal(validationResponse.status, 200);
  const validationPayload = await validationResponse.json();
  assert.equal(validateLocalApiResponse('studio_validate_config', validationPayload).ok, true);

  const designResponse = await fetch(`${baseUrl}/api/studio/design`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      description: 'a small assembly bracket',
    }),
  });
  assert.equal(designResponse.status, 200);
  assert.equal(validateLocalApiResponse('studio_design', await designResponse.json()).ok, true);

  const invalidPreviewSettingsResponse = await fetch(`${baseUrl}/api/studio/model-preview`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: 'name = "demo-assembly"\n[[parts]]\nid = "body"\n',
      build_settings: 'oops',
    }),
  });
  assert.equal(invalidPreviewSettingsResponse.status, 400);
  const invalidPreviewSettingsPayload = await invalidPreviewSettingsResponse.json();
  assert.equal(invalidPreviewSettingsPayload.ok, false);
  assert.equal(invalidPreviewSettingsPayload.error.code, 'invalid_request');
  assert.match(invalidPreviewSettingsPayload.error.messages.join('\n'), /build_settings.*object/i);

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
  assert.equal(validateLocalApiResponse('studio_model_preview', previewPayload).ok, true);
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.preview.id, 'model-preview-1');
  assert.equal(previewPayload.preview.model_asset_url, '/api/studio/model-previews/model-preview-1/model');
  assert.equal(previewPayload.preview.assembly.part_files[0].asset_url, '/api/studio/model-previews/model-preview-1/parts/0');
  assert.equal('path' in previewPayload.preview.assembly.part_files[0], false);
  assert.equal('resolvedPath' in previewPayload.preview.assembly.part_files[0], false);
  const unsafePreviewPayload = structuredClone(previewPayload);
  unsafePreviewPayload.preview.assembly.part_files[0].path = '/tmp/private-part.stl';
  assert.equal(validateLocalApiResponse('studio_model_preview', unsafePreviewPayload).ok, false);

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

  await verifyConfigFormats();

  console.log('local-api-studio-model.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
