import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const shellSource = readFileSync(resolve(ROOT, 'public/js/studio-shell.js'), 'utf8');

assert.match(shellSource, /import\('\.\/studio\/model-workspace\.js'\)/);
assert.match(shellSource, /import\('\.\/studio\/drawing-workspace\.js'\)/);
assert.doesNotMatch(shellSource, /from '\.\/studio\/model-workspace\.js'/);
assert.doesNotMatch(shellSource, /from '\.\/studio\/drawing-workspace\.js'/);

console.log('studio-shell-bootstrap.test.js: ok');
