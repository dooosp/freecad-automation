#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT, 'output');
const EXAMPLE_LIBRARY_MANIFEST = resolve(ROOT, 'docs', 'examples', 'example-library-manifest.json');

const GENERATED_FILE_PATTERNS = [
  /^demo_/,
  /_manifest\.json$/i,
  /_artifact-manifest\.json$/i,
  /^artifact-manifest\.json$/i,
  /_report\.pdf$/i,
  /_report_summary\.json$/i,
  /_drawing_intent\.json$/i,
  /_feature_catalog\.json$/i,
  /_extracted_drawing_semantics\.json$/i,
  /_drawing\.svg$/i,
  /_drawing_quality\.json$/i,
  /_create_quality\.json$/i,
  /_qa(?:_before|_issues)?\.json$/i,
  /_repair_report\.json$/i,
  /_run_log\.json$/i,
  /_traceability\.json$/i,
  /_layout_report\.json$/i,
  /_dimension_map\.json$/i,
  /_dim_conflicts\.json$/i,
  /_dedupe_diagnostics\.json$/i,
  /_effective_config\.json$/i,
  /_plan\.(?:json|toml)$/i,
  /\.(?:step|stp|stl|brep|fcstd|dxf)$/i,
];

const SOURCE_ALLOWED_DIRS = new Set([
  '.git',
  'node_modules',
  'output',
]);

function toRepoPath(path) {
  return relative(ROOT, resolve(ROOT, path)).split(sep).join('/');
}

function isUnderOutput(path) {
  const resolved = resolve(ROOT, path);
  return resolved === OUTPUT_DIR || resolved.startsWith(`${OUTPUT_DIR}${sep}`);
}

function looksGenerated(path) {
  const name = basename(path);
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isExpectedFixture(path) {
  const repoPath = toRepoPath(path);
  return repoPath.startsWith('tests/fixtures/') && basename(repoPath).startsWith('expected_');
}

function getCuratedExampleRoots() {
  if (!existsSync(EXAMPLE_LIBRARY_MANIFEST)) return new Set();
  try {
    const manifest = JSON.parse(readFileSync(EXAMPLE_LIBRARY_MANIFEST, 'utf8'));
    const examples = Array.isArray(manifest.examples) ? manifest.examples : [];
    return new Set(
      examples
        .filter((example) => (
          example?.status === 'canonical-package'
          || example?.current_coverage?.standard_docs_manifest === true
          || example?.current_coverage?.generated_cad === true
          || example?.current_coverage?.review_pack === true
          || example?.current_coverage?.release_bundle_zip === true
        ))
        .map((example) => example.docs_example_root || (example.slug ? `docs/examples/${example.slug}` : null))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

const CURATED_EXAMPLE_ROOTS = getCuratedExampleRoots();

function isCuratedExamplePackageArtifact(path) {
  const repoPath = toRepoPath(path);
  for (const root of CURATED_EXAMPLE_ROOTS) {
    if (repoPath === root || repoPath.startsWith(`${root}/`)) return true;
  }
  return false;
}

function listOutputArtifacts() {
  const artifacts = [];
  if (!existsSync(OUTPUT_DIR)) return artifacts;

  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      const repoPath = toRepoPath(absPath);
      if (entry.isDirectory()) {
        visit(absPath);
      } else if (entry.isFile() && looksGenerated(repoPath)) {
        const stats = statSync(absPath);
        artifacts.push({ path: repoPath, size_bytes: stats.size });
      }
    }
  };

  visit(OUTPUT_DIR);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function parseGitStatusLine(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
  return { status, path: path.replace(/^"|"$/g, '') };
}

function listUnexpectedGeneratedFiles() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git status failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseGitStatusLine)
    .filter(({ path }) => {
      const firstSegment = path.split('/')[0];
      if (isExpectedFixture(path)) return false;
      if (isCuratedExamplePackageArtifact(path)) return false;
      return !SOURCE_ALLOWED_DIRS.has(firstSegment) && !isUnderOutput(path) && looksGenerated(path);
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

const outputArtifacts = listOutputArtifacts();
const unexpected = listUnexpectedGeneratedFiles();
const sourceTreeClean = unexpected.length === 0;

console.log('Generated artifact paths:');
if (outputArtifacts.length === 0) {
  console.log('  (none under output/)');
} else {
  for (const artifact of outputArtifacts) {
    console.log(`  ${artifact.path} (${artifact.size_bytes} bytes)`);
  }
}

console.log(`Source tree clean: ${sourceTreeClean ? 'yes' : 'no'}`);
console.log('Unexpected generated files outside output/:');
if (unexpected.length === 0) {
  console.log('  (none)');
} else {
  for (const entry of unexpected) {
    console.log(`  ${entry.status.trim() || '??'} ${entry.path}`);
  }
}

if (!sourceTreeClean) {
  process.exit(1);
}
