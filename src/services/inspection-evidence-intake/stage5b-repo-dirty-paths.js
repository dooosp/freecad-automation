const PR170_CANONICAL_GENERATED_CONTROL_PATH = /^docs\/examples\/[^/]+\/(?:evidence\/evidence_graph\.json|runtime\/runtime_fingerprint\.json|inspection\/qif_lite_focused_checks\.xml)$/;

function normalizeRepoPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function gitStatusLinePath(line) {
  const text = String(line || '').trim();
  if (!text) return '';
  let path = /^[ MADRCU?!]{2}\s/.test(text) ? text.slice(3).trim() : text;
  if (path.includes(' -> ')) {
    path = path.split(' -> ').pop().trim();
  }
  return normalizeRepoPath(path.replace(/^"|"$/g, ''));
}

export function isPr170GeneratedControlDirtyPath(line) {
  return PR170_CANONICAL_GENERATED_CONTROL_PATH.test(gitStatusLinePath(line));
}

export function splitStage5bCanonicalDirtyPaths(dirtyPaths = []) {
  const canonical = dirtyPaths.filter((line) => gitStatusLinePath(line).startsWith('docs/examples/'));
  const pr170GeneratedControlDirtyPaths = canonical.filter(isPr170GeneratedControlDirtyPath);
  const canonicalPackageDirtyPaths = canonical.filter((line) => !isPr170GeneratedControlDirtyPath(line));
  return {
    canonicalPackageDirtyPaths,
    pr170GeneratedControlDirtyPaths,
  };
}
