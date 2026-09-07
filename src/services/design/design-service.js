import { join } from 'node:path';
import { validateCadToml } from '../../../lib/cad-config-validation.js';
import { createModel } from '../model/create-service.js';
import { writeFile, mkdir, unlink } from 'node:fs/promises';

export function createDesignService({
  designFromTextFn,
  reviewTomlFn,
  validateTomlFn = validateCadToml,
  createModelFn = createModel,
  writeFileFn = writeFile,
  mkdirFn = mkdir,
  unlinkFn = unlink,
} = {}) {
  return async function runDesignTask({
    freecadRoot,
    runScript,
    loadConfig,
    mode,
    description,
    toml,
  }) {
    if (!mode) throw new Error('mode required (design|review|build)');

    if (mode === 'design') {
      if (!description) throw new Error('description required for design mode');
      const designFn = designFromTextFn
        || (await import(`${freecadRoot}/scripts/design-reviewer.js`)).designFromText;
      return designFn(description);
    }

    if (mode === 'review') {
      if (!toml) throw new Error('toml required for review mode');

      const reviewFn = reviewTomlFn
        || (await import(`${freecadRoot}/scripts/design-reviewer.js`)).reviewToml;
      const validateFn = validateTomlFn;

      const tmpDir = join(freecadRoot, 'configs', 'generated');
      await mkdirFn(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, `review_${Date.now()}.toml`);
      await writeFileFn(tmpPath, toml, 'utf8');

      try {
        const validation = validateFn(toml);
        const review = await reviewFn(tmpPath);
        return { ...review, validation };
      } finally {
        await unlinkFn(tmpPath).catch(() => {});
      }
    }

    if (mode === 'build') {
      if (!toml) throw new Error('toml required for build mode');
      const validation = validateTomlFn(toml);
      if (!validation.valid) throw new Error(`CAD config validation failed: ${validation.errors.join('; ')}`);

      const outDir = join(freecadRoot, 'configs', 'generated');
      await mkdirFn(outDir, { recursive: true });
      const configPath = join(outDir, `design_${Date.now()}.toml`);
      await writeFileFn(configPath, toml, 'utf8');

      const result = await createModelFn({ freecadRoot, runScript, loadConfig, configPath });
      return { ...result, configPath: configPath.replace(`${freecadRoot}/`, '') };
    }

    throw new Error(`unknown mode: ${mode}`);
  };
}

export const runDesignTask = createDesignService();
