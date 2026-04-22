import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const DRAWING_INTENT_MISSING_SEMANTICS_POLICIES = Object.freeze([
  'advisory',
  'enforced',
]);

export const SUPPORTED_DRAWING_VIEW_KINDS = Object.freeze([
  'orthographic',
  'isometric',
  'section',
  'detail',
]);

const EXPLICITLY_UNSUPPORTED_DRAWING_VIEW_KINDS = new Set([
  'auxiliary',
  'broken_out_section',
  'removed_section',
]);

const STANDARD_VIEW_ALIASES = Object.freeze({
  front: ['front', 'frontview', 'elevation'],
  top: ['top', 'topview', 'plan'],
  right: ['right', 'rightview', 'side', 'sideview'],
  left: ['left', 'leftview'],
  bottom: ['bottom', 'bottomview', 'base', 'baseview'],
  iso: ['iso', 'isometric', 'isometricview'],
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeComparable(value = null) {
  return normalizeText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, '') || null;
}

function normalizeSlug(value = null) {
  return normalizeText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function uniqueByComparable(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeComparable(item?.id ?? item?.label ?? item?.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeExplicitViewKind(value = null) {
  const comparable = normalizeComparable(value);
  if (!comparable) return null;
  if (comparable === 'orthographic') return 'orthographic';
  if (comparable === 'isometric' || comparable === 'iso') return 'isometric';
  if (comparable === 'section' || comparable === 'sectionview') return 'section';
  if (comparable === 'detail' || comparable === 'detailview') return 'detail';
  if (comparable === 'auxiliary' || comparable === 'auxiliaryview') return 'auxiliary';
  if (comparable === 'brokenoutsection' || comparable === 'brokenout') return 'broken_out_section';
  if (comparable === 'removedsection' || comparable === 'removed') return 'removed_section';
  return null;
}

function detectStandardViewId(value = null) {
  const comparable = normalizeComparable(value);
  if (!comparable) return null;
  for (const [viewId, aliases] of Object.entries(STANDARD_VIEW_ALIASES)) {
    if (aliases.some((alias) => normalizeComparable(alias) === comparable)) {
      return viewId;
    }
  }
  return null;
}

function inferDrawingViewKind(value = null) {
  const comparable = normalizeComparable(value);
  if (!comparable) return 'unknown';
  if (comparable.startsWith('section')) return 'section';
  if (comparable.startsWith('detail')) return 'detail';
  if (comparable.startsWith('auxiliary')) return 'auxiliary';
  if (comparable.startsWith('brokenout')) return 'broken_out_section';
  if (comparable.startsWith('removed')) return 'removed_section';
  if (detectStandardViewId(value) === 'iso') return 'isometric';
  if (detectStandardViewId(value)) return 'orthographic';
  return 'unknown';
}

function firstKnownViewKind(...values) {
  return values.find((value) => value && value !== 'unknown') || 'unknown';
}

function extractViewIdentity(value = null, kind = 'unknown') {
  const text = normalizeText(value);
  if (!text || (kind !== 'section' && kind !== 'detail')) return null;

  let remainder = text
    .replace(/^(section|detail)\s*/i, '')
    .replace(/\bview\b/gi, '')
    .trim();
  if (!remainder) return null;

  const slug = remainder
    .replace(/[()]/g, ' ')
    .replace(/[:/]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!slug) return null;

  const compact = slug.replace(/\s+/g, '');
  if (/^[A-Za-z]{2}$/.test(compact)) {
    return `${compact[0].toUpperCase()}-${compact[1].toUpperCase()}`;
  }
  if (/^[A-Za-z]$/.test(compact)) {
    return compact.toUpperCase();
  }
  return slug.toUpperCase();
}

function defaultViewLabel({ id = null, kind = 'unknown', identity = null } = {}) {
  if (kind === 'section' && identity) return `Section ${identity}`;
  if (kind === 'detail' && identity) return `Detail ${identity}`;
  if (id === 'iso') return 'Isometric';
  if (id) return id;
  return null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeDrawingIntent(intent = null) {
  if (!isPlainObject(intent)) return null;
  const normalized = structuredClone(intent);
  if (!DRAWING_INTENT_MISSING_SEMANTICS_POLICIES.includes(normalized.missing_semantics_policy)) {
    normalized.missing_semantics_policy = 'advisory';
  }
  return normalized;
}

export function getDrawingIntent(config = null) {
  return normalizeDrawingIntent(config?.drawing_intent);
}

export function hasDrawingIntent(config = null) {
  return getDrawingIntent(config) !== null;
}

export function normalizeDrawingViewDescriptor(value = null) {
  const input = isPlainObject(value) ? value : { id: value, label: value };
  const rawId = normalizeText(input.id ?? input.view ?? input.key ?? input.name);
  const rawLabel = normalizeText(input.label ?? input.title ?? input.text ?? rawId);
  const explicitKind = normalizeExplicitViewKind(input.view_kind ?? input.kind ?? input.type);
  const inferredKind = explicitKind || firstKnownViewKind(
    inferDrawingViewKind(rawId),
    inferDrawingViewKind(rawLabel)
  );
  const standardViewId = detectStandardViewId(rawId) || detectStandardViewId(rawLabel);
  const identity = normalizeText(input.identity)
    || extractViewIdentity(rawId, inferredKind)
    || extractViewIdentity(rawLabel, inferredKind);

  let normalizedId = rawId;
  if (standardViewId) {
    normalizedId = standardViewId;
  } else if ((inferredKind === 'section' || inferredKind === 'detail') && identity) {
    normalizedId = `${inferredKind}_${normalizeSlug(identity)}`;
  } else if (!normalizedId && inferredKind !== 'unknown') {
    normalizedId = inferredKind;
  } else if (!normalizedId && rawLabel) {
    normalizedId = normalizeSlug(rawLabel);
  }

  const label = rawLabel || defaultViewLabel({ id: normalizedId, kind: inferredKind, identity }) || normalizedId;

  return {
    ...input,
    id: normalizedId || null,
    label: label || null,
    view_kind: inferredKind,
    identity: identity || null,
    source_view: normalizeText(input.source_view),
    feature: normalizeText(input.feature ?? input.feature_id),
  };
}

export function normalizeDrawingViewRequirement(value = null, defaultRequired = false) {
  const descriptor = normalizeDrawingViewDescriptor(value);
  if (!descriptor.id && !descriptor.label) return null;
  const optional = descriptor.optional === true || descriptor.required === false;
  const required = descriptor.required === true || descriptor.critical === true || (!optional && defaultRequired);
  return {
    ...descriptor,
    required,
    optional: optional || !required,
  };
}

export function collectRequiredDrawingViews(drawingIntent = {}) {
  return uniqueByComparable(
    asArray(
      drawingIntent.required_views
        ?? drawingIntent.views?.required
        ?? drawingIntent.views
    )
      .map((item) => normalizeDrawingViewRequirement(item, true))
      .filter((entry) => entry?.required && !entry?.optional)
  );
}

export function collectRecommendedDrawingViews(drawingIntent = {}) {
  return uniqueByComparable(
    asArray(
      drawingIntent.recommended_views
        ?? drawingIntent.views?.recommended
    )
      .map((item) => normalizeDrawingViewRequirement(item, false))
      .filter(Boolean)
  );
}

export function viewRequirementMatches(requirement = null, candidate = null) {
  const left = normalizeDrawingViewDescriptor(requirement);
  const right = normalizeDrawingViewDescriptor(candidate);
  if (!left.id || !right.id) return false;

  if (left.view_kind === 'section' || left.view_kind === 'detail') {
    if (left.view_kind !== right.view_kind) return false;
    if (left.identity && right.identity) {
      return normalizeSlug(left.identity) === normalizeSlug(right.identity);
    }
    return normalizeComparable(left.id) === normalizeComparable(right.id);
  }

  if (left.view_kind === 'orthographic' || left.view_kind === 'isometric') {
    return normalizeComparable(left.id) === normalizeComparable(right.id);
  }

  return normalizeComparable(left.id) === normalizeComparable(right.id);
}

export function isExplicitlyUnsupportedDrawingView(requirement = null) {
  const descriptor = normalizeDrawingViewDescriptor(requirement);
  return EXPLICITLY_UNSUPPORTED_DRAWING_VIEW_KINDS.has(descriptor.view_kind);
}

export async function writeDrawingIntent(intentPath, intent) {
  const normalized = normalizeDrawingIntent(intent);
  if (!normalized) return null;
  const resolvedPath = resolve(intentPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return resolvedPath;
}
