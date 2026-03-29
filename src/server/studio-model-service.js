import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

import { validateConfigDocument } from '../../lib/config-schema.js';
import { runScript } from '../../lib/runner.js';
import { createDesignService } from '../api/design.js';
import { createModel } from '../api/model.js';

function countNested(items = [], key) {
  return items.reduce((total, item) => total + (Array.isArray(item?.[key]) ? item[key].length : 0), 0);
}

function buildConfigOverview(config = {}) {
  const partCount = Array.isArray(config.parts) ? config.parts.length : 0;
  const shapeCount = (Array.isArray(config.shapes) ? config.shapes.length : 0) + countNested(config.parts, 'shapes');
  const operationCount = (Array.isArray(config.operations) ? config.operations.length : 0) + countNested(config.parts, 'operations');
  const isAssembly = partCount > 0 && Boolean(config.assembly);

  return {
    name: config.name || 'unnamed',
    mode: isAssembly ? 'assembly' : 'part',
    part_count: partCount,
    shape_count: shapeCount,
    operation_count: operationCount,
    export_formats: Array.isArray(config.export?.formats) ? config.export.formats : [],
    has_drawing: Boolean(config.drawing),
    has_motion: Boolean(config.assembly?.joints || config.motion),
    has_fem: Boolean(config.fem),
  };
}

function normalizeBuildSettings(settings = {}, isAssembly = false) {
  return {
    include_step: settings.include_step !== false,
    include_stl: settings.include_stl !== false,
    per_part_stl: isAssembly ? settings.per_part_stl !== false : false,
  };
}

function resolveSingleExportPath(previewDir, exports = [], format = 'stl') {
  const entry = exports.find((item) => String(item?.format || '').toLowerCase() === format);
  if (!entry?.path) return null;
  return join(previewDir, basename(String(entry.path).replace(/\\/g, '/')));
}

export function createStudioModelService({ projectRoot }) {
  const previews = new Map();
  const designService = createDesignService();

  async function cleanupPreview(id) {
    const preview = previews.get(id);
    if (!preview) return;
    previews.delete(id);
    await rm(preview.previewDir, { recursive: true, force: true }).catch(() => {});
  }

  async function trimPreviews(maxEntries = 6) {
    while (previews.size > maxEntries) {
      const [oldestId] = previews.keys();
      await cleanupPreview(oldestId);
    }
  }

  function parseAndValidateConfigToml(configToml) {
    const raw = parseTOML(configToml);
    const validation = validateConfigDocument(raw, { filepath: 'studio:model-preview' });
    return {
      config: validation.config,
      summary: validation.summary,
      valid: validation.valid,
      overview: buildConfigOverview(validation.config),
    };
  }

  function createLoggedRunner(logs) {
    return (script, input, options = {}) => runScript(script, input, {
      ...options,
      onStderr: (text) => {
        const trimmed = String(text || '').trim();
        if (trimmed) logs.push(trimmed);
        if (typeof options.onStderr === 'function') options.onStderr(text);
      },
    });
  }

  return {
    async dispose() {
      await Promise.allSettled([...previews.keys()].map((id) => cleanupPreview(id)));
    },
    getPreviewModelPath(id) {
      return previews.get(id)?.singleModelPath || null;
    },
    getPreviewPartPath(id, index) {
      return previews.get(id)?.partFiles?.[index]?.resolvedPath || null;
    },
    async validateConfigToml(configToml) {
      const source = String(configToml || '').trim();
      if (!source) {
        throw new Error('Config TOML is required.');
      }

      let parsed;
      try {
        parsed = parseAndValidateConfigToml(source);
      } catch (error) {
        throw new Error(`TOML parse error: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!parsed.valid) {
        throw new Error(parsed.summary.errors.join(' | '));
      }

      return {
        config: parsed.config,
        summary: parsed.summary,
        overview: parsed.overview,
      };
    },
    async designFromPrompt(description) {
      const source = String(description || '').trim();
      if (!source) {
        throw new Error('Prompt description is required.');
      }

      const result = await designService({
        freecadRoot: projectRoot,
        runScript,
        loadConfig: async () => ({}),
        mode: 'design',
        description: source,
      });

      let validation = null;
      if (result?.toml) {
        try {
          validation = await this.validateConfigToml(result.toml);
        } catch (error) {
          validation = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        toml: result?.toml || '',
        report: result?.report || null,
        validation,
      };
    },
    async buildPreview({ configToml, buildSettings = {} }) {
      const source = String(configToml || '').trim();
      if (!source) {
        throw new Error('Config TOML is required.');
      }

      const { config, summary, overview } = await this.validateConfigToml(source);
      const previewDir = await mkdtemp(join(tmpdir(), 'fcad-studio-preview-'));
      try {
        const isAssembly = overview.mode === 'assembly';
        const settings = normalizeBuildSettings(buildSettings, isAssembly);
        const formats = new Set(
          Array.isArray(config.export?.formats)
            ? config.export.formats.map((item) => String(item).toLowerCase())
            : []
        );

        if (settings.include_stl) formats.add('stl');
        if (settings.include_step) formats.add('step');

        const previewConfig = {
          ...config,
          export: {
            ...(config.export || {}),
            formats: [...formats],
            directory: previewDir,
            ...(isAssembly ? { per_part_stl: settings.per_part_stl } : {}),
          },
        };

        const logs = [];
        const result = await createModel({
          freecadRoot: projectRoot,
          runScript: createLoggedRunner(logs),
          loadConfig: async () => previewConfig,
          config: previewConfig,
        });

        if (!result?.success) {
          throw new Error(result?.error || 'Build failed.');
        }

        const previewId = randomUUID();
        const partFiles = (result.assembly?.part_files || []).map((partFile, index) => {
          const normalizedPath = String(partFile.path || '').replace(/\\/g, '/');
          return {
            ...partFile,
            index,
            resolvedPath: join(previewDir, basename(normalizedPath)),
            asset_url: `/api/studio/model-previews/${previewId}/parts/${index}`,
          };
        });
        const singleModelPath = partFiles.length > 0
          ? null
          : resolveSingleExportPath(previewDir, result.exports || [], 'stl');

        previews.set(previewId, {
          previewDir,
          singleModelPath,
          partFiles,
        });
        await trimPreviews();

        return {
          preview: {
            id: previewId,
            built_at: new Date().toISOString(),
            settings,
            overview,
            validation: {
              warnings: summary.warnings,
              changed_fields: summary.changed_fields,
              deprecated_fields: summary.deprecated_fields,
            },
            logs,
            model: result.model || null,
            assembly: result.assembly
              ? {
                  ...result.assembly,
                  part_files: partFiles.map(({ resolvedPath, ...item }) => item),
                }
              : null,
            motion_data: result.motion_data || null,
            model_asset_url: singleModelPath
              ? `/api/studio/model-previews/${previewId}/model`
              : null,
          },
        };
      } catch (error) {
        await rm(previewDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    },
  };
}
