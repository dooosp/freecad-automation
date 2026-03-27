import {
  assertTextSnapshot,
  normalizeAbsolutePaths,
  normalizeTextSnapshot,
  normalizeTimestamps,
} from './text-snapshot.js';

function normalizeVolatileAttribute(attrName, attrValue) {
  if (/timestamp|generated-at|generated_at|date/i.test(attrName)) {
    return '__TIMESTAMP__';
  }
  if (/path|filename|source/i.test(attrName)) {
    return '__ABS_PATH__';
  }
  if (/build-id|build_id|session|uuid/i.test(attrName)) {
    return '__VOLATILE__';
  }
  return attrValue;
}

function normalizeVolatileIds(text) {
  const seen = new Map();
  let sequence = 1;
  const normalizeId = (value) => {
    if (!/^(?:clipPath|mask|filter|linearGradient|radialGradient)\d+$/i.test(value)
      && !/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value)
      && !/(?:view|group|node)-[0-9a-f-]{8,}/i.test(value)) {
      return value;
    }
    if (!seen.has(value)) {
      seen.set(value, `__ID_${sequence++}__`);
    }
    return seen.get(value);
  };

  return text
    .replace(/\bid="([^"]+)"/g, (_match, value) => `id="${normalizeId(value)}"`)
    .replace(/url\(#([^)]+)\)/g, (_match, value) => `url(#${normalizeId(value)})`)
    .replace(/\bclip-path="url\(#([^)]+)\)"/g, (_match, value) => `clip-path="url(#${normalizeId(value)})"`)
    .replace(/\bhref="#([^"]+)"/g, (_match, value) => `href="#${normalizeId(value)}"`)
    .replace(/\bxlink:href="#([^"]+)"/g, (_match, value) => `xlink:href="#${normalizeId(value)}"`);
}

export function normalizeSvgSnapshot(svgText) {
  let normalized = String(svgText).replace(/\r\n/g, '\n');
  normalized = normalized.replace(/<!--[\s\S]*?-->/g, '');
  normalized = normalized.replace(/\s+(data-[a-z0-9_-]+|inkscape:export-filename|sodipodi:docname|freecad:[a-z0-9_-]+)="([^"]*)"/gi, (_match, attrName, attrValue) => {
    return ` ${attrName}="${normalizeVolatileAttribute(attrName, attrValue)}"`;
  });
  normalized = normalizeAbsolutePaths(normalized);
  normalized = normalizeTimestamps(normalized);
  normalized = normalizeVolatileIds(normalized);
  normalized = normalized.replace(/>\s+</g, '>\n<');
  return normalizeTextSnapshot(normalized);
}

export function assertSvgSnapshot(snapshotName, svgText, { snapshotDir, update = process.env.UPDATE_SNAPSHOTS === '1' } = {}) {
  return assertTextSnapshot(snapshotName, svgText, {
    snapshotDir,
    extension: '.normalized.svg',
    normalize: normalizeSvgSnapshot,
    label: 'SVG',
    update,
  });
}
