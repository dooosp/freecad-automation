import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(ROOT, 'public/css/studio.css'), 'utf8');
const beginnerMarker = '/* beginner UX final cascade after the v3 theme overrides */';
const beginnerStart = css.indexOf(beginnerMarker);
const manufacturingMarker = '/* Manufacturing Robotics Data stays inside Review and reuses tracked artifact links. */';
const manufacturingStart = css.indexOf(manufacturingMarker);

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

assert.notEqual(beginnerStart, -1, 'Expected the beginner UX final cascade marker.');
assert.notEqual(manufacturingStart, -1, 'Expected the Manufacturing Robotics Data responsive marker.');

const narrowBlock = mediaBlock(css, 'max-width: 920px', beginnerStart);
assertRule(narrowBlock, '.studio-shell', /display:\s*block;/);
assertRule(narrowBlock, '.studio-sidebar', /position:\s*fixed;/);
assertRule(narrowBlock, '.studio-sidebar', /transform:\s*translateX\(-105%\);/);
assertRule(narrowBlock, '.studio-sidebar', /visibility:\s*hidden;/);
assertRule(narrowBlock, '.studio-sidebar', /border-bottom:\s*0;/);
assertRule(narrowBlock, '.studio-sidebar.is-open', /transform:\s*translateX\(0\);/);
assertRule(narrowBlock, '.studio-sidebar.is-open', /visibility:\s*visible;/);
assertRule(narrowBlock, '.app-bar', /grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/);
assert.match(css, /\.studio-sidebar-scrim:not\(\[hidden\]\)[\s\S]*?position:\s*fixed;/);
assert.match(css, /\.home-start-grid[\s\S]*?grid-template-columns:\s*1fr;/);
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);

const compactBlock = mediaBlock(css, 'max-width: 640px', beginnerStart);
assertRule(compactBlock, '.studio-sidebar', /padding:\s*1rem;/);
assertRule(
  compactBlock,
  '.action-button',
  /min-height:\s*44px;/,
);
assertRule(
  compactBlock,
  '.overflow-menu-trigger',
  /min-width:\s*44px;/,
);

const reducedMotionBlock = mediaBlock(css, 'prefers-reduced-motion: reduce');
assertRule(reducedMotionBlock, '*', /transition-duration:\s*0\.01ms\s*!important;/);
assertRule(reducedMotionBlock, '*', /animation-duration:\s*0\.01ms\s*!important;/);
assertRule(reducedMotionBlock, '*', /animation-iteration-count:\s*1\s*!important;/);

assert.match(css, /\.manufacturing-robotics-timeline-layout[\s\S]*?grid-template-columns:\s*minmax\(15rem, 0\.8fr\) minmax\(0, 1\.35fr\);/);
assert.match(css, /\.manufacturing-action-button[\s\S]*?overflow-wrap:\s*anywhere;/);
assert.match(css, /\.manufacturing-action-button[\s\S]*?min-height:\s*44px;/);
const manufacturingNarrowBlock = mediaBlock(css, 'max-width: 920px', manufacturingStart);
assertRule(manufacturingNarrowBlock, '.manufacturing-robotics-timeline-layout', /grid-template-columns:\s*1fr;/);
assertRule(manufacturingNarrowBlock, '.manufacturing-robotics-panel-grid', /grid-template-columns:\s*1fr;/);
assertRule(manufacturingNarrowBlock, '.manufacturing-lerobot-grid', /grid-template-columns:\s*1fr;/);
const manufacturingCompactBlock = mediaBlock(css, 'max-width: 640px', manufacturingStart);
assertRule(manufacturingCompactBlock, '.manufacturing-robotics-output-list', /grid-template-columns:\s*1fr;/);
assertRule(manufacturingCompactBlock, '.manufacturing-robotics-primary-action', /width:\s*100%;/);
assertRule(manufacturingCompactBlock, '.manufacturing-action-button', /min-height:\s*44px;/);

console.log('studio-responsive-css.test.js: ok');
