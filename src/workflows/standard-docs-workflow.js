import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createStandardDocTemplateService } from '../services/report/standard-doc-template-service.js';
import { loadShopProfile } from '../services/config/profile-service.js';
import { runReadinessReportWorkflow } from './readiness-report-workflow.js';

async function writeTextFile(filePath, content) {
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

export function createStandardDocsWorkflow() {
  const generateStandardDocs = createStandardDocTemplateService();

  return async function runStandardDocsWorkflow({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    options = {},
  }) {
    const loadedConfig = config ?? await loadConfig(configPath);
    const siteProfile = options.siteProfile || await loadShopProfile(freecadRoot, options.profileName || null, { silent: true });
    const report = options.report || await runReadinessReportWorkflow({
      freecadRoot,
      runScript,
      loadConfig,
      configPath,
      config: loadedConfig,
      options,
    });

    const defaultDir = resolve(freecadRoot, 'output', `${report.part?.name || 'part'}_standard_docs`);
    const outDir = resolve(options.outDir || defaultDir);
    await mkdir(outDir, { recursive: true });

    const documents = generateStandardDocs(report, { siteProfile });
    const artifacts = {};
    for (const [filename, content] of Object.entries(documents)) {
      artifacts[filename] = await writeTextFile(join(outDir, filename), content);
    }

    const manifest = {
      schema_version: '0.1',
      workflow: 'standard_docs_generation',
      generated_at: new Date().toISOString(),
      draft_notice: 'Generated planning aid only. Engineering review required before controlled-document use.',
      part: report.part,
      site_profile: siteProfile
        ? {
            name: siteProfile.name || siteProfile.label || siteProfile.site?.name || null,
            label: siteProfile.label || null,
          }
        : null,
      documents: Object.entries(artifacts).map(([filename, path]) => ({ filename, path })),
    };

    artifacts.manifest = await writeTextFile(
      join(outDir, 'standard_docs_manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    return {
      report,
      out_dir: outDir,
      artifacts,
      manifest,
    };
  };
}

export const runStandardDocsWorkflow = createStandardDocsWorkflow();
