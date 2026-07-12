import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const CANONICAL_READINESS_PATTERN = /^docs\/examples\/([^/]+)\/readiness\/readiness_report\.(json|md)$/;

function mutationError(code, message) {
  const error = new Error(message);
  error.name = 'CanonicalPackageMutationError';
  error.code = code;
  return error;
}

function normalizedRelative(root, target) {
  const value = relative(root, target).replace(/\\/g, '/');
  if (value === '' || value.startsWith('../') || value === '..' || isAbsolute(value)) return null;
  return value;
}

async function assertRealDirectory(pathValue, expectedParent, label) {
  let info;
  try {
    info = await lstat(pathValue);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw mutationError('canonical_readiness_boundary_missing', `${label} does not exist`);
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw mutationError('unsafe_canonical_readiness_boundary', `${label} must be a real directory`);
  }
  const real = await realpath(pathValue);
  if (real !== pathValue || dirname(real) !== expectedParent) {
    throw mutationError('canonical_readiness_boundary_escape', `${label} escaped its canonical parent`);
  }
  return real;
}

async function assertSafeExistingTarget(pathValue, expectedParent, label) {
  try {
    const info = await lstat(pathValue);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
      throw mutationError('unsafe_canonical_readiness_target', `${label} must be a regular non-symlink, non-hardlinked file`);
    }
    const real = await realpath(pathValue);
    if (real !== pathValue || dirname(real) !== expectedParent) {
      throw mutationError('canonical_readiness_target_escape', `${label} escaped its canonical directory`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function canonicalReadinessIdentities(root) {
  const examples = join(root, 'docs', 'examples');
  let entries;
  try {
    entries = await readdir(examples, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const identities = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    for (const filename of ['readiness_report.json', 'readiness_report.md']) {
      const pathValue = join(examples, entry.name, 'readiness', filename);
      try {
        const info = await stat(pathValue);
        if (info.isFile()) identities.push({ path: pathValue, dev: info.dev, ino: info.ino });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return identities;
}

async function assertNoCanonicalReadinessAlias(root, pathValues) {
  const identities = await canonicalReadinessIdentities(root);
  for (const pathValue of pathValues) {
    let info;
    let real;
    try {
      [info, real] = await Promise.all([stat(pathValue), realpath(pathValue)]);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const realRelative = normalizedRelative(root, real);
    if (realRelative && CANONICAL_READINESS_PATTERN.test(realRelative)) {
      throw mutationError(
        'unsafe_canonical_readiness_alias',
        'Canonical readiness JSON and Markdown must be addressed only by their canonical paths'
      );
    }
    if (identities.some((identity) => identity.dev === info.dev && identity.ino === info.ino)) {
      throw mutationError(
        'unsafe_canonical_readiness_hardlink',
        'Canonical readiness JSON and Markdown must not be written through hardlink aliases'
      );
    }
  }
}

export async function resolveCanonicalReadinessMutationBoundary(projectRoot, outputJsonPath) {
  const requestedRoot = resolve(projectRoot);
  const root = await realpath(requestedRoot);
  const requestedTarget = resolve(outputJsonPath);
  if (!/\.json$/i.test(requestedTarget)) {
    throw mutationError('readiness_output_extension_invalid', 'Readiness JSON output must end in .json');
  }
  const requestedMarkdown = requestedTarget.replace(/\.json$/i, '.md');
  const requestedRelative = normalizedRelative(requestedRoot, requestedTarget);
  const match = requestedRelative?.match(/^docs\/examples\/([^/]+)\/readiness\/readiness_report\.json$/);
  if (!match) {
    await assertNoCanonicalReadinessAlias(root, [requestedTarget, requestedMarkdown]);
    return null;
  }
  const target = join(root, requestedRelative);

  const docs = await assertRealDirectory(join(root, 'docs'), root, 'Canonical docs directory');
  const examples = await assertRealDirectory(join(docs, 'examples'), docs, 'Canonical examples directory');
  const packageRoot = await assertRealDirectory(join(examples, match[1]), examples, 'Canonical package directory');
  const readiness = await assertRealDirectory(join(packageRoot, 'readiness'), packageRoot, 'Canonical readiness directory');
  const inspection = await assertRealDirectory(join(packageRoot, 'inspection'), packageRoot, 'Canonical inspection directory');
  const markdown = join(readiness, 'readiness_report.md');
  await assertSafeExistingTarget(target, readiness, 'Canonical readiness JSON');
  await assertSafeExistingTarget(markdown, readiness, 'Canonical readiness Markdown');

  return {
    root,
    packageSlug: match[1],
    packageRoot,
    inspection,
    attachment: join(inspection, 'inspection_evidence_attachment.json'),
    json: target,
    markdown,
  };
}

async function readOptional(pathValue) {
  try {
    return await readFile(pathValue);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicReplace(pathValue, content) {
  const target = resolve(pathValue);
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o644 });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  return target;
}

export async function withCanonicalPackageMutationLock(inspectionDirectory, callback) {
  const inspection = await realpath(resolve(inspectionDirectory));
  const lockPath = join(inspection, '.inspection-evidence-mutation.lock');
  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw mutationError(
        'inspection_evidence_mutation_locked',
        'Another inspection-evidence attachment or readiness mutation is already in progress for this package'
      );
    }
    throw error;
  }
  try {
    return await callback();
  } finally {
    await lockHandle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

export async function withCanonicalReadinessWriteGuard(projectRoot, outputJsonPath, callback) {
  const boundary = await resolveCanonicalReadinessMutationBoundary(projectRoot, outputJsonPath);
  if (!boundary) return callback(null);
  return withCanonicalPackageMutationLock(boundary.inspection, async () => {
    try {
      await lstat(boundary.attachment);
      throw mutationError(
        'inspection_evidence_readiness_authorization_required',
        'Canonical readiness cannot be written by a regular readiness command after inspection evidence attachment; use the separately authorized regeneration operation'
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return callback(boundary);
  });
}

export async function writeReadinessArtifactPair({
  projectRoot,
  outputJsonPath,
  jsonContent,
  markdownContent,
}) {
  return withCanonicalReadinessWriteGuard(projectRoot, outputJsonPath, async (boundary) => {
    const jsonPath = boundary?.json || resolve(outputJsonPath);
    const markdownPath = boundary?.markdown || jsonPath.replace(/\.json$/i, '.md');
    const originalJson = await readOptional(jsonPath);
    const originalMarkdown = await readOptional(markdownPath);
    try {
      await atomicReplace(jsonPath, jsonContent);
      await atomicReplace(markdownPath, markdownContent);
      return { json: jsonPath, markdown: markdownPath };
    } catch (error) {
      if (originalJson !== null) await atomicReplace(jsonPath, originalJson).catch(() => {});
      else await rm(jsonPath, { force: true }).catch(() => {});
      if (originalMarkdown !== null) await atomicReplace(markdownPath, originalMarkdown).catch(() => {});
      else await rm(markdownPath, { force: true }).catch(() => {});
      throw error;
    }
  });
}
