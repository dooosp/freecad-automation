import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createLocalApiServer } from '../src/server/local-api-server.js';

const ROOT = resolve(import.meta.dirname, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-local-api-drawing-'));
const jobsDir = join(tmpRoot, 'jobs');

function assertNoLeakedPathStrings(payload, blocked = []) {
  const serialized = JSON.stringify(payload);
  blocked.filter(Boolean).forEach((value) => {
    assert.equal(serialized.includes(String(value)), false, `Payload leaked path-like value: ${value}`);
  });
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

const configToml = 'name = "demo"\n[[shapes]]\nid = "body"\ntype = "box"\nlength = 10\nwidth = 10\nheight = 10\n';

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
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- /tmp/demo-sheet_plan.toml --></svg>',
        bom: [],
        annotations: ['Saved editable plan at /tmp/demo-sheet_plan.toml'],
        qa_summary: { score: 92 },
        dimensions: [
          {
            id: 'WIDTH',
            value_mm: 42,
            feature: 'body_width',
            required: true,
          },
        ],
        logs: ['Saved editable plan to /tmp/demo-sheet_plan.toml before rendering.'],
        plan_path: '/tmp/demo-sheet_plan.toml',
        artifacts: {
          plan_toml: '/tmp/demo-sheet_plan.toml',
          dimension_map: '/tmp/demo-sheet_dimension_map.json',
          working_dir: '/tmp/preview-workdir',
        },
        run_log: {
          path: '/tmp/demo-sheet_run_log.json',
        },
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
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- /tmp/demo-sheet_plan.toml --></svg>',
        bom: [],
        annotations: ['Saved editable plan at /tmp/demo-sheet_plan.toml'],
        qa_summary: { score: 92 },
        dimensions: [
          {
            id: 'WIDTH',
            value_mm: 45,
            feature: 'body_width',
            required: true,
          },
        ],
        logs: ['Re-rendered from /tmp/demo-sheet_plan.toml after dimension update.'],
        plan_path: '/tmp/demo-sheet_plan.toml',
        artifacts: {
          plan_toml: '/tmp/demo-sheet_plan.toml',
          dimension_map: '/tmp/demo-sheet_dimension_map.json',
          working_dir: '/tmp/preview-workdir',
        },
        run_log: {
          path: '/tmp/demo-sheet_run_log.json',
        },
      },
    };
  },
  async getTrackedDrawPlan({ previewId, configToml: requestedConfigToml }) {
    if (previewId !== 'preview-1') {
      return { drawingPlan: null, reason: 'preview_not_found' };
    }
    if (requestedConfigToml !== configToml) {
      return { drawingPlan: null, reason: 'config_changed' };
    }
    return {
      drawingPlan: {
        dim_intents: [
          {
            id: 'WIDTH',
            value_mm: 45,
            feature: 'body_width',
            required: true,
          },
        ],
      },
      reason: 'preserved',
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
      config_toml: configToml,
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
  assert.equal(previewPayload.preview.preview_reference, 'drawing-preview:preview-1');
  assert.equal(previewPayload.preview.editable_plan_reference, 'preview-plan:preview-1');
  assert.equal(previewPayload.preview.editable_plan_available, true);
  assert.equal(previewPayload.preview.dimension_editing_available, true);
  assert.equal(previewPayload.preview.tracked_draw_bridge_available, true);
  assert.equal(previewPayload.preview.artifact_capabilities.editable_plan, true);
  assert.equal(previewPayload.preview.artifact_capabilities.dimension_map, true);
  assert.equal('plan_path' in previewPayload.preview, false);
  assert.equal('artifacts' in previewPayload.preview, false);
  assert.equal('logs' in previewPayload.preview, false);
  assert.equal('run_log' in previewPayload.preview, false);
  assert.equal(previewPayload.preview.svg.includes('/tmp/demo-sheet_plan.toml'), false);
  assert.equal(previewPayload.preview.annotations[0].includes('/tmp/demo-sheet_plan.toml'), false);
  assertNoLeakedPathStrings(previewPayload, [
    '/tmp/demo-sheet_plan.toml',
    '/tmp/demo-sheet_dimension_map.json',
    '/tmp/demo-sheet_run_log.json',
    '/tmp/preview-workdir',
  ]);

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
  assert.equal(updatePayload.preview.preview_reference, 'drawing-preview:preview-1');
  assert.equal(updatePayload.preview.editable_plan_reference, 'preview-plan:preview-1');
  assert.equal(updatePayload.preview.editable_plan_available, true);
  assert.equal('plan_path' in updatePayload.preview, false);
  assert.equal('artifacts' in updatePayload.preview, false);
  assert.equal('logs' in updatePayload.preview, false);
  assert.equal('run_log' in updatePayload.preview, false);
  assert.equal(updatePayload.preview.svg.includes('/tmp/demo-sheet_plan.toml'), false);
  assert.equal(updatePayload.preview.annotations[0].includes('/tmp/demo-sheet_plan.toml'), false);
  assertNoLeakedPathStrings(updatePayload, [
    '/tmp/demo-sheet_plan.toml',
    '/tmp/demo-sheet_dimension_map.json',
    '/tmp/demo-sheet_run_log.json',
    '/tmp/preview-workdir',
  ]);

  const trackedResponse = await fetch(`${baseUrl}/api/studio/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'draw',
      config_toml: configToml,
      drawing_preview_id: 'preview-1',
      drawing_settings: {
        views: ['front', 'top'],
        scale: '1:2',
      },
    }),
  });
  assert.equal(trackedResponse.status, 202);
  const trackedPayload = await trackedResponse.json();
  assert.equal(trackedPayload.ok, true);
  assert.equal(trackedPayload.job.type, 'draw');
  assert.equal(trackedPayload.job.request.config.drawing_plan.dim_intents[0].value_mm, 45);
  assert.equal(trackedPayload.job.request.options.studio.drawing_settings.scale, '1:2');
  assert.equal(trackedPayload.job.request.options.studio.preview_plan.preserved, true);
  assert.equal(trackedPayload.job.request.options.studio.preview_plan.reason, 'preserved');

  console.log('local-api-studio-drawing.test.js: ok');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}
