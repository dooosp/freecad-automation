import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-drawing-'));
const jobsDir = join(tmpRoot, 'jobs');

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

const fakeDrawingService = {
  async buildPreview() {
    return {
      preview: {
        id: 'preview-1',
        drawn_at: '2026-03-28T12:00:00.000Z',
        overview: {
          name: 'demo-sheet',
          scale: '1:2',
          views: ['front', 'top'],
        },
        scale: '1:2',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
        bom: [],
        annotations: [],
        qa_summary: { score: 92 },
        dimensions: [],
        plan_path: '/tmp/demo-sheet_plan.toml',
      },
    };
  },
  async updateDimension() {
    return {
      update: {
        dim_id: 'WIDTH',
        old_value: 42,
        new_value: 45,
        history_op: 'edit',
      },
      preview: {
        id: 'preview-1',
        drawn_at: '2026-03-28T12:01:00.000Z',
        overview: {
          name: 'demo-sheet',
          scale: '1:2',
          views: ['front', 'top'],
        },
        scale: '1:2',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
        bom: [],
        annotations: [],
        qa_summary: { score: 92 },
        dimensions: [],
        plan_path: '/tmp/demo-sheet_plan.toml',
      },
    };
  },
  async dispose() {},
};

const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir,
  studioDrawingServiceFactory() {
    return fakeDrawingService;
  },
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const previewResponse = await fetch(`${baseUrl}/api/studio/drawing-preview`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      config_toml: 'name = "demo"\n[[shapes]]\nid = "body"\ntype = "box"\nlength = 10\nwidth = 10\nheight = 10\n',
      drawing_settings: {
        views: ['front', 'top'],
        scale: '1:2',
      },
    }),
  });
  assert.equal(previewResponse.status, 200);
  const previewPayload = await previewResponse.json();
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.preview.id, 'preview-1');
  assert.equal(previewPayload.preview.scale, '1:2');

  const updateResponse = await fetch(`${baseUrl}/api/studio/drawing-previews/preview-1/dimensions`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      dim_id: 'WIDTH',
      value_mm: 45,
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updatePayload = await updateResponse.json();
  assert.equal(updatePayload.ok, true);
  assert.equal(updatePayload.update.dim_id, 'WIDTH');
  assert.equal(updatePayload.update.new_value, 45);

  console.log('local-api-studio-drawing.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
