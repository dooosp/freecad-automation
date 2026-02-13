import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { parse as parseTOML, stringify as tomlStringify } from 'smol-toml';

/**
 * Update a dim_intent value_mm in a TOML plan file.
 *
 * WARNING: smol-toml stringify does not preserve comments.
 * A backup is created at `${tomlPath}.bak` before writing.
 *
 * @param {string} tomlPath - Path to the TOML plan file
 * @param {string} dimId - The dim_intent id to update
 * @param {number} newValue - New value_mm
 * @returns {Promise<{ok: boolean, oldValue?: number, error?: string}>}
 */
export async function updateDimIntent(tomlPath, dimId, newValue) {
  if (typeof newValue !== 'number' || isNaN(newValue)) {
    return { ok: false, error: `Invalid value: ${newValue}` };
  }
  if (newValue <= 0) {
    return { ok: false, error: `value_mm must be positive, got ${newValue}` };
  }

  const raw = await readFile(tomlPath, 'utf8');
  const data = parseTOML(raw);

  const plan = data.drawing_plan;
  if (!plan || !plan.dim_intents) {
    return { ok: false, error: 'No drawing_plan.dim_intents found' };
  }

  const intent = plan.dim_intents.find(d => d.id === dimId);
  if (!intent) {
    return { ok: false, error: `dim_intent '${dimId}' not found` };
  }

  const oldValue = intent.value_mm;
  intent.value_mm = newValue;

  // Backup original
  await copyFile(tomlPath, tomlPath + '.bak');

  // Write updated TOML
  await writeFile(tomlPath, tomlStringify(data), 'utf8');

  return { ok: true, oldValue };
}

/**
 * Read all dim_intents from a TOML plan file.
 * @param {string} tomlPath
 * @returns {Promise<Array<{id: string, value_mm: number, feature: string, required: boolean}>>}
 */
export async function readDimIntents(tomlPath) {
  const raw = await readFile(tomlPath, 'utf8');
  const data = parseTOML(raw);
  const intents = data.drawing_plan?.dim_intents || [];
  return intents.map(d => ({
    id: d.id,
    value_mm: d.value_mm,
    feature: d.feature || '',
    required: !!d.required,
  }));
}
