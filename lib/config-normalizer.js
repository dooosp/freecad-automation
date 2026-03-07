function normalizeOperationSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return spec;
  }

  const normalized = { ...spec };
  if (normalized.op === undefined && typeof normalized.type === 'string') {
    normalized.op = normalized.type;
  }
  return normalized;
}

export function normalizeConfig(value, parentKey = '') {
  if (Array.isArray(value)) {
    if (parentKey === 'operations') {
      return value.map((item) => normalizeOperationSpec(item));
    }
    return value.map((item) => normalizeConfig(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeConfig(entry, key);
  }
  return normalized;
}

export { normalizeOperationSpec };
