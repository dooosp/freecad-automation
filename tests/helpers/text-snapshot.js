import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function normalizeAbsolutePaths(text) {
  return String(text)
    .replace(/[A-Za-z]:(?:\\[^"<>\n]+)+/g, '__ABS_PATH__')
    .replace(/\/(?:Users|home|tmp|var|private)\/[^"<>\n]+/g, '__ABS_PATH__');
}

export function normalizeTimestamps(text) {
  return String(text)
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '__TIMESTAMP__')
    .replace(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/g, '__TIMESTAMP__');
}

export function normalizeTextSnapshot(text) {
  const normalized = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${normalized}\n`;
}

function buildDiffSnippet(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      const start = Math.max(0, index - 2);
      const end = Math.min(max, index + 3);
      const lines = [`First diff at line ${index + 1}:`];
      for (let line = start; line < end; line += 1) {
        lines.push(`- ${expectedLines[line] ?? ''}`);
        lines.push(`+ ${actualLines[line] ?? ''}`);
      }
      return lines.join('\n');
    }
  }
  return 'No textual diff available.';
}

export function assertTextSnapshot(snapshotName, text, {
  snapshotDir,
  extension = '.txt',
  normalize = normalizeTextSnapshot,
  label = 'Text',
  update = process.env.UPDATE_SNAPSHOTS === '1',
} = {}) {
  const normalized = normalize(text);
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const snapshotPath = join(snapshotDir, `${snapshotName}${normalizedExtension}`);

  if (update || !existsSync(snapshotPath)) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, normalized, 'utf8');
    return { updated: true, snapshotPath };
  }

  const expected = readFileSync(snapshotPath, 'utf8');
  assert.equal(
    normalized,
    expected,
    `${label} snapshot mismatch for ${snapshotName}\n${buildDiffSnippet(expected, normalized)}\nSnapshot: ${snapshotPath}`
  );
  return { updated: false, snapshotPath };
}
