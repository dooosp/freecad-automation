import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

function getTemplatesDir(freecadRoot) {
  return join(freecadRoot, 'configs', 'report-templates');
}

export function validateTemplateName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export async function listReportTemplates(freecadRoot) {
  const templatesDir = getTemplatesDir(freecadRoot);
  const files = await readdir(templatesDir);
  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  const templates = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const content = await readFile(join(templatesDir, file), 'utf8');
        const data = JSON.parse(content);
        return {
          name: file.replace('.json', ''),
          description: data.description || '',
          label: data.label || file.replace('.json', ''),
        };
      } catch {
        return null;
      }
    })
  );

  return templates.filter(Boolean);
}

export async function getReportTemplate(freecadRoot, name) {
  const content = await readFile(join(getTemplatesDir(freecadRoot), `${name}.json`), 'utf8');
  return { name, ...JSON.parse(content) };
}

export async function createReportTemplate(freecadRoot, name, templateData) {
  const templatePath = join(getTemplatesDir(freecadRoot), `${name}.json`);
  const now = new Date().toISOString();
  const template = { name, ...templateData, created: now, updated: now };
  await writeFile(templatePath, JSON.stringify(template, null, 2), 'utf8');
  return { success: true, name };
}

export async function updateReportTemplate(freecadRoot, name, templateData) {
  const templatePath = join(getTemplatesDir(freecadRoot), `${name}.json`);
  const existing = await readFile(templatePath, 'utf8');
  const current = JSON.parse(existing);
  const updated = {
    ...current,
    ...templateData,
    name,
    created: current.created,
    updated: new Date().toISOString(),
  };
  await writeFile(templatePath, JSON.stringify(updated, null, 2), 'utf8');
  return { success: true };
}

export async function deleteReportTemplate(freecadRoot, name) {
  await unlink(join(getTemplatesDir(freecadRoot), `${name}.json`));
  return { success: true };
}
