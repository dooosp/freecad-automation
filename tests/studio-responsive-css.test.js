import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(ROOT, 'public/css/studio.css'), 'utf8');
const redesignMarker = '/* freecad-studio-redesign-v3 overrides */';
const redesignStart = css.indexOf(redesignMarker);

function mediaBlock(source, condition, startIndex = 0) {
  const mediaStart = source.indexOf(`@media (${condition})`, startIndex);
  assert.notEqual(mediaStart, -1, `Expected @media (${condition}) after redesign overrides.`);

  const openBrace = source.indexOf('{', mediaStart);
  assert.notEqual(openBrace, -1, `Expected @media (${condition}) to have an opening brace.`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(mediaStart, index + 1);
    }
  }

  throw new Error(`Expected @media (${condition}) to have a closing brace.`);
}

function assertRule(block, selector, declarationPattern) {
  const selectorIndex = block.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Expected ${selector} in responsive CSS block.`);
  const ruleEnd = block.indexOf('}', selectorIndex);
  assert.notEqual(ruleEnd, -1, `Expected ${selector} to have a closing rule.`);
  const rule = block.slice(selectorIndex, ruleEnd);
  assert.match(rule, declarationPattern, `Expected ${selector} to include ${declarationPattern}.`);
}

assert.notEqual(redesignStart, -1, 'Expected the Studio redesign override marker.');

const narrowBlock = mediaBlock(css, 'max-width: 920px', redesignStart);
assertRule(narrowBlock, '.studio-shell', /grid-template-columns:\s*1fr;/);
assertRule(narrowBlock, '.studio-sidebar', /border-right:\s*0;/);
assertRule(narrowBlock, '.studio-sidebar', /border-bottom:\s*1px solid/);
assertRule(narrowBlock, '.app-bar', /grid-template-columns:\s*1fr;/);
assertRule(narrowBlock, '.workspace-root', /min-width:\s*0;/);
assertRule(narrowBlock, '.canonical-package-grid', /grid-template-columns:\s*1fr;/);
assertRule(narrowBlock, '.canonical-package-card-header', /grid-template-columns:\s*1fr;/);
assertRule(narrowBlock, '.canonical-artifact-ref', /grid-template-columns:\s*1fr;/);
assertRule(narrowBlock, '.canonical-artifact-path-actions', /justify-items:\s*start;/);
assertRule(narrowBlock, '.canonical-path', /text-align:\s*left;/);
assertRule(narrowBlock, '.canonical-artifact-actions', /justify-content:\s*flex-start;/);

const compactBlock = mediaBlock(css, 'max-width: 640px', redesignStart);
assertRule(compactBlock, '.workspace-root', /padding:\s*1rem;/);
assertRule(compactBlock, '.app-bar', /padding:\s*1rem;/);
assertRule(compactBlock, '.studio-sidebar', /padding:\s*1rem;/);

console.log('studio-responsive-css.test.js: ok');
