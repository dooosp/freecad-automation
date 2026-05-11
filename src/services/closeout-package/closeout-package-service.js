import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SUPPORTED_MODE = 'software-demo';
const CANONICAL_STATUS = 'canonical-package';

const SOURCE_ARTIFACTS = Object.freeze([
  Object.freeze({
    artifact_type: 'package_readme',
    path: (slug) => `docs/examples/${slug}/README.md`,
  }),
  Object.freeze({
    artifact_type: 'package_config',
    path: (slug) => `docs/examples/${slug}/config.toml`,
  }),
  Object.freeze({
    artifact_type: 'review_pack',
    path: (slug) => `docs/examples/${slug}/review/review_pack.json`,
  }),
  Object.freeze({
    artifact_type: 'readiness_report',
    path: (slug) => `docs/examples/${slug}/readiness/readiness_report.json`,
    required: true,
  }),
  Object.freeze({
    artifact_type: 'standard_docs_manifest',
    path: (slug) => `docs/examples/${slug}/standard-docs/standard_docs_manifest.json`,
  }),
  Object.freeze({
    artifact_type: 'release_bundle_manifest',
    path: (slug) => `docs/examples/${slug}/release/release_bundle_manifest.json`,
  }),
  Object.freeze({
    artifact_type: 'release_bundle_checksums',
    path: (slug) => `docs/examples/${slug}/release/release_bundle_checksums.sha256`,
  }),
  Object.freeze({
    artifact_type: 'reopen_notes',
    path: (slug) => `docs/examples/${slug}/reopen-notes.md`,
  }),
]);

const PACK_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: 'closeout',
    artifactType: 'software_demo_closeout_manifest',
    directorySuffix: 'software-demo-closeout',
    manifestName: 'closeout_manifest.json',
    markdownName: 'closeout_summary.md',
    title: 'Software/Demo Closeout Summary',
    emphasis: 'Closeout packet for local software/demo review.',
  }),
  Object.freeze({
    key: 'portfolio',
    artifactType: 'software_demo_portfolio_manifest',
    directorySuffix: 'portfolio-pack',
    manifestName: 'portfolio_manifest.json',
    markdownName: 'portfolio_case_draft.md',
    title: 'Portfolio Case Draft Summary',
    emphasis: 'Portfolio draft material for explaining the package workflow honestly.',
  }),
  Object.freeze({
    key: 'interview',
    artifactType: 'software_demo_interview_manifest',
    directorySuffix: 'interview-demo-pack',
    manifestName: 'interview_demo_manifest.json',
    markdownName: 'interview_demo_talking_points.md',
    title: 'Interview/Demo Talking Points',
    emphasis: 'Interview talking points for the package boundary and evidence gate.',
  }),
]);

const BOUNDARY_LINES = Object.freeze([
  'This is software/demo closeout only.',
  'Generated artifacts are review/demo evidence only.',
  'No physical part inspection was completed.',
  'No supplier/lab/CMM/manual inspection evidence was attached.',
  'Production readiness remains held.',
  'Release bundle presence is not readiness proof.',
  'Future Stage 5B requires genuine completed inspection evidence attached through the canonical review-context path.',
]);

const GENERATED_ARTIFACT_BOUNDARY = BOUNDARY_LINES.join(' ');

const FORBIDDEN_BOUNDARY_PATTERNS = Object.freeze([
  /\bis production[- ]ready\b/i,
  /\bproduction_ready["']?\s*:\s*true\b/i,
  /\binspection complete\b/i,
  /\bStage 5B complete\b/i,
  /\brelease bundle proves readiness\b/i,
  /\bCAD-derived values are physical measurements\b/i,
  /\bgenerated (?:docs|documents|reports|screenshots|release bundles?) are inspection evidence\b/i,
]);

function normalizePath(pathValue) {
  return String(pathValue || '').replace(/\\/g, '/');
}

function repoRelative(projectRoot, filePath) {
  return normalizePath(relative(projectRoot, filePath));
}

function isInside(parentDir, childPath) {
  const rel = relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    throw new Error('Unsafe package slug: slug is required');
  }
  if (
    slug.includes('..') ||
    slug.includes('/') ||
    slug.includes('\\') ||
    slug.includes(sep) ||
    isAbsolute(slug) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    throw new Error(`Unsafe package slug: ${slug}`);
  }
}

async function readJsonIfAvailable(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadExampleLibrary(projectRoot) {
  const manifestPath = join(projectRoot, 'docs', 'examples', 'example-library-manifest.json');
  return await readJsonIfAvailable(manifestPath);
}

function findCanonicalExample(libraryManifest, slug) {
  if (!Array.isArray(libraryManifest?.examples)) return null;
  return libraryManifest.examples.find((example) => (
    example?.slug === slug && example?.status === CANONICAL_STATUS
  )) || null;
}

function collectMissingInputs(value, result = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectMissingInputs(entry, result));
    return result;
  }

  if (!value || typeof value !== 'object') {
    return result;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'missing_inputs' && Array.isArray(entry)) {
      entry.filter((item) => typeof item === 'string' && item.trim()).forEach((item) => result.add(item));
      continue;
    }
    collectMissingInputs(entry, result);
  }

  return result;
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, strings));
    return strings;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, strings));
  }

  return strings;
}

function extractReadinessTruth(readinessReport) {
  const readinessSummary = readinessReport?.readiness_summary || {};
  const missingInputs = [...collectMissingInputs(readinessReport)].sort();
  const productionReady = readinessReport?.production_ready === true
    || readinessReport?.readiness_summary?.production_ready === true;

  return {
    readiness_status: readinessSummary.status || readinessReport?.status || 'unknown',
    score: readinessSummary.score ?? readinessReport?.score ?? null,
    gate_decision: readinessSummary.gate_decision || readinessReport?.gate_decision || 'unknown',
    missing_inputs: missingInputs,
    production_ready: productionReady,
  };
}

function collectSourceRefs({ projectRoot, slug }) {
  return SOURCE_ARTIFACTS
    .map((artifact) => {
      const sourcePath = artifact.path(slug);
      const absPath = resolve(projectRoot, sourcePath);
      return {
        artifact_type: artifact.artifact_type,
        path: normalizePath(sourcePath),
        exists: existsSync(absPath),
        required: artifact.required === true,
      };
    })
    .filter((ref) => ref.exists || ref.required);
}

function collectWarnings({ readinessReport, reviewPack, sourceRefs, truth, strictBoundary }) {
  const warnings = new Set([
    ...BOUNDARY_LINES,
    'No inspection evidence was created or attached by this generator.',
    'Canonical package artifacts were read only and were not regenerated.',
  ]);

  for (const warning of [
    ...(Array.isArray(readinessReport?.warnings) ? readinessReport.warnings : []),
    ...(Array.isArray(reviewPack?.warnings) ? reviewPack.warnings : []),
  ]) {
    if (typeof warning === 'string' && warning.trim()) warnings.add(warning);
  }

  sourceRefs
    .filter((ref) => ref.required && !ref.exists)
    .forEach((ref) => warnings.add(`Missing required source artifact: ${ref.path}`));

  if (!truth.missing_inputs.includes('inspection_evidence')) {
    const message = 'Readiness truth did not list inspection_evidence as missing.';
    if (strictBoundary) throw new Error(message);
    warnings.add(message);
  }

  if (truth.production_ready) {
    const message = 'Source package claims production readiness; software/demo closeout generation is not allowed.';
    if (strictBoundary) throw new Error(message);
    warnings.add(message);
  }

  return [...warnings];
}

function assertGeneratedBoundary(value, label) {
  const text = typeof value === 'string' ? value : collectStrings(value).join('\n');
  for (const pattern of FORBIDDEN_BOUNDARY_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Generated ${label} crosses evidence boundary: ${pattern}`);
    }
  }
}

function buildManifest({
  artifactType,
  slug,
  mode,
  generatedAt,
  sourceRefs,
  truth,
  files,
  warnings,
}) {
  return {
    artifact_type: artifactType,
    package_id: slug,
    mode,
    generated_at: generatedAt,
    source_refs: sourceRefs,
    readiness_status: truth.readiness_status,
    score: truth.score,
    gate_decision: truth.gate_decision,
    missing_inputs: truth.missing_inputs,
    production_ready: false,
    inspection_evidence_created: false,
    inspection_evidence_attached: false,
    canonical_artifacts_regenerated: false,
    generated_artifact_boundary: GENERATED_ARTIFACT_BOUNDARY,
    files,
    warnings,
  };
}

function markdownList(values) {
  if (!Array.isArray(values) || values.length === 0) return '- none';
  return values.map((value) => `- ${value}`).join('\n');
}

function buildMarkdown({
  title,
  emphasis,
  slug,
  sourceRefs,
  truth,
  warnings,
}) {
  const availableSources = sourceRefs
    .filter((ref) => ref.exists)
    .map((ref) => `${ref.artifact_type}: \`${ref.path}\``);

  return [
    `# ${slug} ${title}`,
    '',
    emphasis,
    '',
    '## Boundary',
    '',
    ...BOUNDARY_LINES.map((line) => `- ${line}`),
    '',
    'Generated CAD, drawing, review, readiness, standard-doc, release, portfolio, and demo materials remain review/demo evidence only. They do not replace a completed physical, supplier, lab, CMM, or manual inspection record.',
    '',
    '## Readiness Truth',
    '',
    `- Readiness status: \`${truth.readiness_status}\``,
    `- Score: \`${truth.score}\``,
    `- Gate decision: \`${truth.gate_decision}\``,
    `- Missing inputs: \`${truth.missing_inputs.join(', ') || 'none recorded'}\``,
    '- Production ready: `false`',
    '- Inspection evidence created: `false`',
    '- Inspection evidence attached: `false`',
    '- Canonical artifacts regenerated: `false`',
    '',
    '## Source Refs',
    '',
    markdownList(availableSources),
    '',
    '## Warnings',
    '',
    markdownList(warnings),
    '',
  ].join('\n');
}

async function writeJson(filePath, document) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
}

async function loadPackageContext({ projectRoot, slug, mode, strictBoundary }) {
  assertSafeSlug(slug);
  if (mode !== SUPPORTED_MODE) {
    throw new Error(`Unsupported closeout mode: ${mode}. Supported mode: ${SUPPORTED_MODE}`);
  }

  const examplesRoot = resolve(projectRoot, 'docs', 'examples');
  const packageDir = resolve(examplesRoot, slug);
  if (!isInside(examplesRoot, packageDir)) {
    throw new Error(`Unsafe package slug: ${slug}`);
  }

  const libraryManifest = await loadExampleLibrary(projectRoot);
  if (libraryManifest) {
    const canonicalExample = findCanonicalExample(libraryManifest, slug);
    if (!canonicalExample) {
      throw new Error(`Unknown or unsupported canonical package slug: ${slug}`);
    }
  } else if (!existsSync(packageDir)) {
    throw new Error(`Unknown canonical package slug: ${slug}`);
  }

  const readinessPath = join(packageDir, 'readiness', 'readiness_report.json');
  if (!existsSync(readinessPath)) {
    throw new Error(`Required readiness report missing for ${slug}: ${repoRelative(projectRoot, readinessPath)}`);
  }

  const readinessReport = JSON.parse(await readFile(readinessPath, 'utf8'));
  const reviewPack = await readJsonIfAvailable(join(packageDir, 'review', 'review_pack.json'));
  const truth = extractReadinessTruth(readinessReport);
  const sourceRefs = collectSourceRefs({ projectRoot, slug });
  const warnings = collectWarnings({
    readinessReport,
    reviewPack,
    sourceRefs,
    truth,
    strictBoundary,
  });

  return {
    packageDir,
    readinessReport,
    reviewPack,
    truth: {
      ...truth,
      production_ready: false,
    },
    sourceRefs,
    warnings,
  };
}

export async function generateCloseoutPackage({
  slug,
  mode,
  outDir = 'output',
  projectRoot = process.cwd(),
  strictBoundary = false,
} = {}) {
  const normalizedMode = mode || SUPPORTED_MODE;
  const resolvedProjectRoot = resolve(projectRoot);
  const outputRoot = isAbsolute(outDir) ? outDir : resolve(resolvedProjectRoot, outDir);
  const context = await loadPackageContext({
    projectRoot: resolvedProjectRoot,
    slug,
    mode: normalizedMode,
    strictBoundary,
  });
  const generatedAt = new Date().toISOString();
  const packs = [];

  for (const definition of PACK_DEFINITIONS) {
    const directoryName = `${slug}-${definition.directorySuffix}`;
    const packDir = join(outputRoot, directoryName);
    const files = [definition.manifestName, definition.markdownName];
    const manifest = buildManifest({
      artifactType: definition.artifactType,
      slug,
      mode: normalizedMode,
      generatedAt,
      sourceRefs: context.sourceRefs,
      truth: context.truth,
      files,
      warnings: context.warnings,
    });
    const markdown = buildMarkdown({
      title: definition.title,
      emphasis: definition.emphasis,
      slug,
      sourceRefs: context.sourceRefs,
      truth: context.truth,
      warnings: context.warnings,
    });

    assertGeneratedBoundary(manifest, `${definition.key} manifest`);
    assertGeneratedBoundary(markdown, `${definition.key} markdown`);

    const manifestPath = join(packDir, definition.manifestName);
    const markdownPath = join(packDir, definition.markdownName);
    await writeJson(manifestPath, manifest);
    await writeText(markdownPath, markdown);

    packs.push({
      key: definition.key,
      directory_name: directoryName,
      directory_path: packDir,
      manifest_path: manifestPath,
      markdown_path: markdownPath,
      files,
    });
  }

  return {
    package_id: slug,
    mode: normalizedMode,
    out_dir: outputRoot,
    readiness_status: context.truth.readiness_status,
    score: context.truth.score,
    gate_decision: context.truth.gate_decision,
    missing_inputs: context.truth.missing_inputs,
    production_ready: false,
    inspection_evidence_created: false,
    inspection_evidence_attached: false,
    canonical_artifacts_regenerated: false,
    packs,
    warnings: context.warnings,
  };
}
