import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';

const pathKey = (path) => JSON.stringify(path);
const horizontal = (char) => char === ' ' || char === '\t';

// The TOML parser validates grammar first. This scanner only locates boundaries;
// it never searches text inside strings or composite values for assignments.
function skipString(source, start) {
  const quote = source[start];
  const multiline = source.startsWith(quote.repeat(3), start);
  let cursor = start + (multiline ? 3 : 1);
  while (cursor < source.length) {
    if (quote === '"' && source[cursor] === '\\') {
      cursor += 2;
    } else if (source[cursor] === quote) {
      if (!multiline) return cursor + 1;
      let end = cursor;
      while (source[end] === quote) end += 1;
      if (end - cursor >= 3) return end;
      cursor = end;
    } else {
      cursor += 1;
    }
  }
  throw new Error('Unsupported unterminated TOML string');
}

function readKey(source, start, delimiter) {
  const parts = [];
  let cursor = start;
  while (cursor < source.length) {
    while (horizontal(source[cursor])) cursor += 1;
    const begin = cursor;
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = skipString(source, cursor);
      parts.push(parse(`key = ${source.slice(begin, cursor)}`).key);
    } else {
      while (cursor < source.length && /[A-Za-z0-9_-]/.test(source[cursor])) cursor += 1;
      if (cursor === begin) throw new Error('Unsupported TOML key');
      parts.push(source.slice(begin, cursor));
    }
    while (horizontal(source[cursor])) cursor += 1;
    if (source[cursor] === delimiter) return { parts, end: cursor + 1 };
    if (source[cursor] !== '.') throw new Error('Unsupported TOML key separator');
    cursor += 1;
  }
  throw new Error('Unsupported unterminated TOML key');
}

function valueEnd(source, start) {
  const closers = [];
  let cursor = start;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === '#') {
      if (!closers.length) break;
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      continue;
    }
    if (!closers.length && (char === '\r' || char === '\n')) break;
    if (char === '[' || char === '{') closers.push(char === '[' ? ']' : '}');
    if (char === ']' || char === '}') {
      if (closers.pop() !== char) throw new Error('Unsupported TOML value boundary');
    }
    cursor += 1;
  }
  if (closers.length) throw new Error('Unsupported unterminated TOML value');
  let end = cursor;
  while (horizontal(source[end - 1])) end -= 1;
  return { end, next: cursor };
}

function locateValues(source) {
  const spans = new Map();
  const activeArrays = new Map();
  let context = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) { cursor += 1; continue; }
    if (source[cursor] === '#') {
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      continue;
    }
    if (source[cursor] === '[') {
      const array = source[cursor + 1] === '[';
      const key = readKey(source, cursor + (array ? 2 : 1), ']');
      cursor = key.end + (array ? 1 : 0);
      context = [];
      for (const [index, part] of key.parts.entries()) {
        context.push(part);
        const id = pathKey(context);
        if (array && index === key.parts.length - 1) {
          activeArrays.set(id, (activeArrays.get(id) ?? -1) + 1);
        }
        if (activeArrays.has(id)) context.push(activeArrays.get(id));
      }
      continue;
    }
    const key = readKey(source, cursor, '=');
    cursor = key.end;
    while (horizontal(source[cursor])) cursor += 1;
    const value = valueEnd(source, cursor);
    const id = pathKey([...context, ...key.parts]);
    if (spans.has(id)) throw new Error('Duplicate TOML target span');
    spans.set(id, { start: cursor, end: value.end });
    cursor = value.next;
  }
  return spans;
}

function readPath(object, path) {
  let current = object;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)
        || Array.isArray(current) !== (typeof key === 'number')) {
      throw new Error(`Missing numeric target: ${pathKey(path)}`);
    }
    current = current[key];
  }
  return current;
}

/** Replace finite numeric assignment values; preserve every unrelated source byte.
 * Paths address parsed TOML objects, using numeric indexes for arrays of tables.
 * Numbers inside inline tables/arrays are deliberately unsupported. Throws instead
 * of returning partial edits when a target cannot be mapped unambiguously.
 */
export function patchTomlNumericValues(source, patches) {
  if (typeof source !== 'string' || !Array.isArray(patches)) {
    throw new TypeError('Expected TOML source and numeric patches');
  }
  const requested = new Set();
  for (const patch of patches) {
    if (!patch || !Array.isArray(patch.path) || !patch.path.length
        || patch.path.some((key) => typeof key !== 'string' && !(Number.isSafeInteger(key) && key >= 0))
        || typeof patch.value !== 'number' || !Number.isFinite(patch.value)) {
      throw new TypeError('Expected a target path and finite numeric value');
    }
    const id = pathKey(patch.path);
    if (requested.has(id)) throw new Error(`Duplicate target patch: ${id}`);
    requested.add(id);
  }
  const original = parse(source);
  if (!patches.length) return source;
  const spans = locateValues(source);
  // Reparse to preserve smol-toml's date subtype in the semantic comparison.
  const expected = parse(source);
  const replacements = patches.map(({ path, value }) => {
    const previous = readPath(original, path);
    const span = spans.get(pathKey(path));
    if (typeof previous !== 'number' || !Number.isFinite(previous) || !span) {
      throw new Error(`Unsupported numeric target span: ${pathKey(path)}`);
    }
    // Verify both the semantic path and the complete source token before editing.
    if (!Object.is(parse(`value = ${source.slice(span.start, span.end)}`).value, previous)) {
      throw new Error(`Ambiguous numeric target span: ${pathKey(path)}`);
    }
    let parent = expected;
    for (const key of path.slice(0, -1)) parent = parent[key];
    parent[path.at(-1)] = value;
    return { ...span, text: Object.is(value, -0) ? '-0.0' : String(value) };
  });
  let result = source;
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  if (!isDeepStrictEqual(parse(result), expected)) {
    throw new Error('Numeric patches changed unexpected TOML values');
  }
  return result;
}
