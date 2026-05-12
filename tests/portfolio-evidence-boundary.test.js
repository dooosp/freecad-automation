import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORTFOLIO_INDEX = 'docs/portfolio/README.md';
const ROOT_README = 'README.md';

const PORTFOLIO_CASES = Object.freeze([
  {
    slug: 'quality-pass-bracket',
    title: 'Quality Pass Bracket Software/Demo Case Study',
    path: 'docs/portfolio/quality-pass-bracket-software-demo-case.md',
  },
  {
    slug: 'plate-with-holes',
    title: 'Plate With Holes Software/Demo Case Study',
    path: 'docs/portfolio/plate-with-holes-software-demo-case.md',
  },
]);

const REQUIRED_BOUNDARY_PHRASES = Object.freeze([
  'software/demo closeout only',
  'No physical part inspection',
  'No supplier inspection',
  'No lab inspection',
  'No CMM inspection',
  'No manual caliper inspection',
  'No gauge inspection',
  'No first-article evidence',
  'review/demo evidence only',
  'not inspection evidence',
  'Production readiness remains held',
  'inspection_evidence',
  'release bundle is transport/review material, not readiness proof',
  'Future Stage 5B requires genuine completed inspection evidence',
]);

const FORBIDDEN_OVERCLAIMS = Object.freeze([
  /\bproduction-ready:\s*(?:yes|true)\b/i,
  /\bproduction_ready["']?\s*:\s*true\b/i,
  /\binspection complete\b/i,
  /\binspection completed\b/i,
  /\bStage 5B complete\b/i,
  /\bStage 5B completed\b/i,
  /\brelease bundle proves readiness\b/i,
  /\brelease bundles? (?:prove|proves|proved) readiness\b/i,
  /\bCAD-derived values are physical measurements\b/i,
  /\bCAD-derived values are real measurements\b/i,
  /\bgenerated (?:CAD|drawings?|docs|documents|reports?|screenshots?|release bundles?) are inspection evidence\b/i,
  /\breadiness (?:passed|passes|has passed) despite missing `?inspection_evidence`?/i,
]);

function readText(repoRelativePath) {
  return readFileSync(resolve(ROOT, repoRelativePath), 'utf8');
}

function readJson(repoRelativePath) {
  return JSON.parse(readText(repoRelativePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readinessTruth(slug) {
  const readiness = readJson(`docs/examples/${slug}/readiness/readiness_report.json`);
  const summary = readiness.readiness_summary ?? readiness;
  const missingInputs =
    readiness.review_pack?.uncertainty_coverage_report?.missing_inputs
    ?? readiness.process_plan?.summary?.missing_inputs
    ?? readiness.quality_risk?.summary?.missing_inputs
    ?? readiness.missing_inputs
    ?? [];

  return {
    status: summary.status,
    score: summary.score,
    gateDecision: summary.gate_decision,
    missingInputs,
  };
}

function assertContains(text, phrase, label) {
  assert.match(text, new RegExp(escapeRegExp(phrase), 'i'), `${label} should include "${phrase}"`);
}

function assertNoAbsoluteLocalPaths(label, text) {
  assert.doesNotMatch(text, /\/(?:Users|home|tmp|private|var)\//, `${label} should not contain POSIX local absolute paths`);
  assert.doesNotMatch(text, /[A-Za-z]:\\/, `${label} should not contain Windows absolute paths`);
}

function assertNoForbiddenClaims(label, text) {
  for (const pattern of FORBIDDEN_OVERCLAIMS) {
    assert.doesNotMatch(text, pattern, `${label} should not overclaim with pattern ${pattern}`);
  }
}

function resolveMarkdownLinks(repoRelativePath) {
  const text = readText(repoRelativePath);
  const baseDir = dirname(repoRelativePath);
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target && !/^(?:https?:|mailto:|#)/i.test(target))
    .filter((target) => extname(target) || target.endsWith('/'));

  for (const target of links) {
    const resolved = resolve(ROOT, baseDir, target);
    assert.equal(
      existsSync(resolved),
      true,
      `${repoRelativePath} has unresolved local markdown link: ${target}`
    );
  }
}

function extractSection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing section ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return nextHeading === -1 ? markdown.slice(contentStart) : markdown.slice(contentStart, nextHeading);
}

function assertCaseTruth(caseConfig) {
  assert.equal(existsSync(resolve(ROOT, caseConfig.path)), true, `${caseConfig.path} should exist`);

  const text = readText(caseConfig.path);
  const truth = readinessTruth(caseConfig.slug);
  const label = caseConfig.path;

  assertContains(text, truth.status, label);
  assertContains(text, String(truth.score), label);
  assertContains(text, truth.gateDecision, label);
  for (const missingInput of truth.missingInputs) {
    assertContains(text, missingInput, label);
  }
  assertContains(text, 'Production-ready | no', label);

  for (const phrase of REQUIRED_BOUNDARY_PHRASES) {
    assertContains(text, phrase, label);
  }

  assertNoForbiddenClaims(label, text);
  assertNoAbsoluteLocalPaths(label, text);
  resolveMarkdownLinks(caseConfig.path);
}

for (const portfolioCase of PORTFOLIO_CASES) {
  assertCaseTruth(portfolioCase);
}

const portfolioIndex = readText(PORTFOLIO_INDEX);
const rootReadme = readText(ROOT_README);

for (const portfolioCase of PORTFOLIO_CASES) {
  const caseFilename = portfolioCase.path.split('/').at(-1);
  assert.match(
    portfolioIndex,
    new RegExp(`\\[${escapeRegExp(portfolioCase.title)}\\]\\(${escapeRegExp(caseFilename)}\\)`),
    `${PORTFOLIO_INDEX} should link ${portfolioCase.title}`
  );
  assert.match(
    rootReadme,
    new RegExp(`\\[${escapeRegExp(portfolioCase.title)}\\]\\(\\.\\/${escapeRegExp(portfolioCase.path)}\\)`),
    `${ROOT_README} should link ${portfolioCase.title}`
  );
}

for (const docPath of [
  PORTFOLIO_INDEX,
  ...PORTFOLIO_CASES.map((portfolioCase) => portfolioCase.path),
]) {
  const text = readText(docPath);
  assertNoForbiddenClaims(docPath, text);
  assertNoAbsoluteLocalPaths(docPath, text);
  resolveMarkdownLinks(docPath);
}

const rootPortfolioSection = extractSection(rootReadme, '## Portfolio Case Study');
assertNoForbiddenClaims(`${ROOT_README} Portfolio Case Study`, rootPortfolioSection);
assertNoAbsoluteLocalPaths(`${ROOT_README} Portfolio Case Study`, rootPortfolioSection);
resolveMarkdownLinks(ROOT_README);

const trackedOutputFiles = execFileSync('git', ['ls-files', 'output'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
assert.equal(trackedOutputFiles, '', 'generated output artifacts should not be tracked');

console.log('portfolio-evidence-boundary.test.js: ok');
