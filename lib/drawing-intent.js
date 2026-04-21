import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const DRAWING_INTENT_MISSING_SEMANTICS_POLICIES = Object.freeze([
  'advisory',
  'enforced',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeDrawingIntent(intent = null) {
  if (!isPlainObject(intent)) return null;
  const normalized = structuredClone(intent);
  if (!DRAWING_INTENT_MISSING_SEMANTICS_POLICIES.includes(normalized.missing_semantics_policy)) {
    normalized.missing_semantics_policy = 'advisory';
  }
  return normalized;
}

export function getDrawingIntent(config = null) {
  return normalizeDrawingIntent(config?.drawing_intent);
}

export function hasDrawingIntent(config = null) {
  return getDrawingIntent(config) !== null;
}

export async function writeDrawingIntent(intentPath, intent) {
  const normalized = normalizeDrawingIntent(intent);
  if (!normalized) return null;
  const resolvedPath = resolve(intentPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return resolvedPath;
}
