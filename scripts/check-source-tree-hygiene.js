#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /(?:^|[-_.])screenshot[-_.].*\.(?:png|jpe?g|webp)$/i,
  /\.(?:png|jpe?g|webp)$/i,
  /\.zip$/i,
];

const SOURCE_ALLOWED_DIRS = new Set([
  '.git',
  'node_modules',
  'output',
]);

const FORBIDDEN_TRACKED_LOCAL_PREFIXES = Object.freeze([
  'local/stage5b-candidate-evidence-inbox/',
  'local/inspection-evidence-quarantine/',
]);

// These are curated, reviewed source control materials despite their generated-looking suffixes.
const CURATED_SOURCE_CONTROL_FILES = new Set([
  'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
  'configs/examples/manufacturing/hinge_block_synthetic_inspection_v1/inspection_plan.json',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/01-en-prerun.png',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/02-ko-prerun.png',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/03-en-success-timeline.png',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/04-ko-handoff.png',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/05-en-trust-lerobot-gap.png',
  'docs/portfolio/manufacturing-robotics-demo/screenshots/06-ko-blocked-mismatch.png',
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

function isAllowedFixtureArtifact(path) {
  const repoPath = toRepoPath(path);
  return (
    /^tests\/fixtures\/imports\/[^/]+\.(?:step|stp|fcstd)$/i.test(repoPath)
    || /^tests\/fixtures\/sample_part\.(?:step|stp)$/i.test(repoPath)
  );
}

export function isCuratedSourceControlMaterial(path) {
  return CURATED_SOURCE_CONTROL_FILES.has(toRepoPath(path));
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
    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const packageArtifactPatterns = [
      new RegExp(`^${escapedRoot}/cad/[^/]+\\.(?:step|stp|stl|brep|fcstd)$`, 'i'),
      new RegExp(`^${escapedRoot}/drawing/[^/]+_drawing\\.svg$`, 'i'),
      new RegExp(`^${escapedRoot}/drawing/[^/]+_drawing_intent\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/drawing/[^/]+_extracted_drawing_semantics\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/drawing/[^/]+_feature_catalog\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/quality/[^/]+_create_quality\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/quality/[^/]+_drawing_quality\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/quality/[^/]+_drawing_qa\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/release/release_bundle_manifest\\.json$`, 'i'),
      new RegExp(`^${escapedRoot}/release/release_bundle\\.zip$`, 'i'),
      new RegExp(`^${escapedRoot}/standard-docs(?:-[^/]+)?/standard_docs_manifest\\.json$`, 'i'),
    ];
    if (packageArtifactPatterns.some((pattern) => pattern.test(repoPath))) return true;
  }
  return false;
}

function isAllowedTrackedGeneratedArtifact(path) {
  return isExpectedFixture(path)
    || isAllowedFixtureArtifact(path)
    || isCuratedExamplePackageArtifact(path)
    || isCuratedSourceControlMaterial(path);
}

export function listOutputArtifacts({ statFile = statSync } = {}) {
  const artifacts = [];
  if (!existsSync(OUTPUT_DIR)) return artifacts;

  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      const repoPath = toRepoPath(absPath);
      if (entry.isDirectory()) {
        visit(absPath);
      } else if (entry.isFile() && looksGenerated(repoPath)) {
        let stats;
        try {
          stats = statFile(absPath);
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
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

export function listUnexpectedGeneratedFiles() {
  const statusResult = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (statusResult.status !== 0) {
    throw new Error(`git status failed: ${(statusResult.stderr || statusResult.stdout || '').trim()}`);
  }

  const trackedResult = spawnSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (trackedResult.status !== 0) {
    throw new Error(`git ls-files failed: ${(trackedResult.stderr || trackedResult.stdout || '').trim()}`);
  }

  const unexpected = new Map();

  String(statusResult.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseGitStatusLine)
    .filter(({ path }) => {
      const firstSegment = path.split('/')[0];
      if (isAllowedTrackedGeneratedArtifact(path)) return false;
      return !SOURCE_ALLOWED_DIRS.has(firstSegment) && !isUnderOutput(path) && looksGenerated(path);
    })
    .forEach((entry) => unexpected.set(entry.path, entry));

  String(trackedResult.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !isAllowedTrackedGeneratedArtifact(path) && !isUnderOutput(path) && looksGenerated(path))
    .forEach((path) => {
      if (!unexpected.has(path)) unexpected.set(path, { status: 'tracked', path });
    });

  String(trackedResult.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => FORBIDDEN_TRACKED_LOCAL_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .forEach((path) => unexpected.set(path, { status: 'tracked-private-evidence', path }));

  return [...unexpected.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function main() {
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
  console.log('Unexpected generated files outside output/ or fixture/package allowlists:');
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
