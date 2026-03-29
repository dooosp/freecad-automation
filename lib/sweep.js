const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_SWEEP_JOBS = ['create', 'cost'];
const SUPPORTED_SWEEP_JOBS = new Set(['create', 'cost', 'fem', 'report']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureFiniteNumber(label, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a finite number`);
  }
  return numeric;
}

function ensureOptionalString(label, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value.trim();
}

function ensurePlainObject(label, value) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function ensureStringList(label, values, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}array`);
  }

  return values.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

function decimalPlaces(value) {
  const text = String(value);
  if (/[eE]/.test(text)) {
    const [mantissa, exponentText] = text.split(/[eE]/);
    const exponent = Number(exponentText);
    const fraction = (mantissa.split('.')[1] || '').length;
    return Math.max(0, fraction - exponent);
  }
  return (text.split('.')[1] || '').length;
}

function uniqueNumericValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const numeric = ensureFiniteNumber('Sweep parameter value', value);
    const key = String(numeric);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(numeric);
  }
  return result;
}

function expandRangeValues(path, range) {
  if (!isPlainObject(range)) {
    throw new Error(`Sweep parameter ${path} range must be an object`);
  }

  const start = ensureFiniteNumber(`${path} range.start`, range.start);
  const stop = ensureFiniteNumber(`${path} range.stop`, range.stop ?? range.end);
  const step = ensureFiniteNumber(`${path} range.step`, range.step);
  if (step === 0) {
    throw new Error(`Sweep parameter ${path} range.step must not be 0`);
  }

  const ascending = stop >= start;
  if ((ascending && step < 0) || (!ascending && step > 0)) {
    throw new Error(`Sweep parameter ${path} range.step must move from start to stop`);
  }

  const scale = 10 ** Math.max(decimalPlaces(start), decimalPlaces(stop), decimalPlaces(step));
  const scaledStart = Math.round(start * scale);
  const scaledStop = Math.round(stop * scale);
  const scaledStep = Math.round(step * scale);

  const values = [];
  if (ascending) {
    for (let current = scaledStart; current <= scaledStop; current += scaledStep) {
      values.push(Number((current / scale).toFixed(12)));
    }
  } else {
    for (let current = scaledStart; current >= scaledStop; current += scaledStep) {
      values.push(Number((current / scale).toFixed(12)));
    }
  }

  if (values.length === 0) {
    throw new Error(`Sweep parameter ${path} produced no values`);
  }

  return uniqueNumericValues(values);
}

function normalizeParameterDefinition(path, definition) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Sweep parameters require a non-empty path');
  }

  const trimmedPath = path.trim();
  let values;

  if (Array.isArray(definition)) {
    values = uniqueNumericValues(definition);
  } else if (isPlainObject(definition)) {
    if (Array.isArray(definition.values)) {
      values = uniqueNumericValues(definition.values);
    } else if (isPlainObject(definition.range) || definition.start !== undefined || definition.stop !== undefined || definition.end !== undefined) {
      values = expandRangeValues(trimmedPath, definition.range || definition);
    } else {
      throw new Error(`Sweep parameter ${trimmedPath} must declare values or range`);
    }
  } else {
    throw new Error(`Sweep parameter ${trimmedPath} must be an array or object`);
  }

  if (values.length === 0) {
    throw new Error(`Sweep parameter ${trimmedPath} must expand to at least one value`);
  }

  return {
    path: trimmedPath,
    values,
  };
}

function normalizeParameterList(rawParameters) {
  if (Array.isArray(rawParameters)) {
    return rawParameters.map((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new Error(`Sweep parameter entry ${index + 1} must be an object`);
      }
      return normalizeParameterDefinition(entry.path, entry);
    });
  }

  if (isPlainObject(rawParameters)) {
    return Object.entries(rawParameters).map(([path, definition]) => normalizeParameterDefinition(path, definition));
  }

  throw new Error('Sweep spec must include parameters as an object map or an array');
}

export function normalizeSweepSpec(rawSpec = {}) {
  if (!isPlainObject(rawSpec)) {
    throw new Error('Sweep spec root must be an object');
  }

  const requestedName = ensureOptionalString('Sweep spec name', rawSpec.name);
  const requestedDescription = ensureOptionalString('Sweep spec description', rawSpec.description);
  const parameters = normalizeParameterList(rawSpec.parameters);
  if (parameters.length === 0) {
    throw new Error('Sweep spec must declare at least one parameter');
  }

  const jobSource = rawSpec.jobs === undefined ? DEFAULT_SWEEP_JOBS : rawSpec.jobs;
  const jobs = [...new Set(ensureStringList('Sweep spec jobs', jobSource))];
  for (const job of jobs) {
    if (!SUPPORTED_SWEEP_JOBS.has(job)) {
      throw new Error(`Unsupported sweep job: ${job}`);
    }
  }

  const objectives = rawSpec.objectives === undefined
    ? {}
    : { ...ensurePlainObject('Sweep spec objectives', rawSpec.objectives) };
  if (objectives.stress_threshold_mpa !== undefined) {
    objectives.stress_threshold_mpa = ensureFiniteNumber('objectives.stress_threshold_mpa', objectives.stress_threshold_mpa);
  }

  const execution = rawSpec.execution === undefined
    ? {}
    : { ...ensurePlainObject('Sweep spec execution', rawSpec.execution) };
  if (execution.profile !== undefined) {
    execution.profile = ensureOptionalString('execution.profile', execution.profile);
  }
  if (execution.material !== undefined) {
    execution.material = ensureOptionalString('execution.material', execution.material);
  }
  if (execution.process !== undefined) {
    execution.process = ensureOptionalString('execution.process', execution.process);
  }
  if (execution.batch_size !== undefined) {
    execution.batch_size = ensureFiniteNumber('execution.batch_size', execution.batch_size);
  }

  return {
    name: requestedName || 'parameter_sweep',
    description: requestedDescription || '',
    jobs,
    parameters,
    objectives,
    execution,
  };
}

export function parseSweepPath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Sweep path must be a non-empty string');
  }

  const input = path.trim();
  const segments = [];
  let cursor = 0;

  while (cursor < input.length) {
    const char = input[cursor];
    if (char === '.') {
      cursor += 1;
      continue;
    }

    if (char === '[') {
      const close = input.indexOf(']', cursor);
      if (close === -1) {
        throw new Error(`Invalid sweep path ${input}: missing closing ]`);
      }
      const indexText = input.slice(cursor + 1, close);
      if (!/^\d+$/.test(indexText)) {
        throw new Error(`Invalid sweep path ${input}: array indices must be integers`);
      }
      segments.push(Number(indexText));
      cursor = close + 1;
      continue;
    }

    let end = cursor;
    while (end < input.length && input[end] !== '.' && input[end] !== '[') {
      end += 1;
    }
    const segment = input.slice(cursor, end);
    if (!segment) {
      throw new Error(`Invalid sweep path ${input}`);
    }
    if (UNSAFE_PATH_SEGMENTS.has(segment)) {
      throw new Error(`Unsafe sweep path segment is not allowed: ${segment}`);
    }
    segments.push(segment);
    cursor = end;
  }

  return segments;
}

function readValueAtSegments(target, segments, path) {
  let current = target;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        throw new Error(`Sweep path ${path} does not exist`);
      }
      current = current[segment];
      continue;
    }

    if (!isPlainObject(current) && !Array.isArray(current)) {
      throw new Error(`Sweep path ${path} does not exist`);
    }
    if (!Object.hasOwn(current, segment)) {
      throw new Error(`Sweep path ${path} does not exist`);
    }
    current = current[segment];
  }
  return current;
}

export function getValueAtPath(target, path) {
  const segments = Array.isArray(path) ? path : parseSweepPath(path);
  return readValueAtSegments(target, segments, typeof path === 'string' ? path : segments.join('.'));
}

export function applySweepOverrides(baseConfig, overrides = {}) {
  const nextConfig = structuredClone(baseConfig);

  for (const [path, value] of Object.entries(overrides)) {
    const numericValue = ensureFiniteNumber(`Override ${path}`, value);
    const segments = parseSweepPath(path);
    const parentSegments = segments.slice(0, -1);
    const leaf = segments.at(-1);
    const parent = parentSegments.length === 0
      ? nextConfig
      : readValueAtSegments(nextConfig, parentSegments, path);

    const currentValue = readValueAtSegments(nextConfig, segments, path);
    if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
      throw new Error(`Sweep path ${path} must point to an existing numeric value`);
    }

    if (typeof leaf === 'number') {
      if (!Array.isArray(parent) || leaf < 0 || leaf >= parent.length) {
        throw new Error(`Sweep path ${path} does not exist`);
      }
      parent[leaf] = numericValue;
    } else {
      if (!Object.hasOwn(parent, leaf)) {
        throw new Error(`Sweep path ${path} does not exist`);
      }
      parent[leaf] = numericValue;
    }
  }

  return nextConfig;
}

function cartesianProduct(parameters, index = 0, current = {}, combinations = []) {
  if (index >= parameters.length) {
    combinations.push({ ...current });
    return combinations;
  }

  const parameter = parameters[index];
  for (const value of parameter.values) {
    current[parameter.path] = value;
    cartesianProduct(parameters, index + 1, current, combinations);
  }
  delete current[parameter.path];
  return combinations;
}

function variantIdAt(index, totalCount) {
  const width = Math.max(3, String(totalCount).length);
  return `variant-${String(index + 1).padStart(width, '0')}`;
}

export function expandSweepVariants(baseConfig, sweepSpec) {
  const parameters = sweepSpec.parameters.map((parameter) => {
    const currentValue = getValueAtPath(baseConfig, parameter.path);
    if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
      throw new Error(`Sweep path ${parameter.path} must point to an existing numeric value`);
    }
    return {
      ...parameter,
      base_value: currentValue,
    };
  });

  const combinations = cartesianProduct(parameters);
  return combinations.map((overrides, index) => ({
    variant_id: variantIdAt(index, combinations.length),
    ordinal: index + 1,
    overrides,
    config: applySweepOverrides(baseConfig, overrides),
  }));
}

function pickMinimumVariant(variants, metricKey) {
  const ranked = variants
    .filter((variant) => Number.isFinite(variant.metrics?.[metricKey]))
    .sort((a, b) => a.metrics[metricKey] - b.metrics[metricKey]);

  if (ranked.length === 0) return null;
  const winner = ranked[0];
  return {
    variant_id: winner.variant_id,
    value: winner.metrics[metricKey],
    overrides: winner.overrides,
  };
}

export function buildSweepSummary({
  name,
  description = '',
  baseConfigPath,
  matrixPath,
  outputDir,
  jobs,
  parameters,
  objectives = {},
  variants = [],
}) {
  const successful = variants.filter((variant) => variant.success);
  const failed = variants.filter((variant) => !variant.success);
  const threshold = Number.isFinite(objectives.stress_threshold_mpa) ? objectives.stress_threshold_mpa : null;
  const thresholdEligible = successful.filter((variant) => typeof variant.metrics?.stress_threshold_pass === 'boolean');
  const thresholdPassed = thresholdEligible.filter((variant) => variant.metrics.stress_threshold_pass === true);
  const thresholdFailed = thresholdEligible.filter((variant) => variant.metrics.stress_threshold_pass === false);

  return {
    name,
    description,
    base_config_path: baseConfigPath,
    matrix_path: matrixPath,
    output_dir: outputDir,
    generated_at: new Date().toISOString(),
    jobs,
    parameter_space: {
      parameter_count: parameters.length,
      parameters,
      combination_count: variants.length,
    },
    objectives,
    variants,
    summary: {
      successful_variants: successful.length,
      failed_variants: failed.length,
      best_by_min_mass: pickMinimumVariant(successful, 'estimated_mass_kg'),
      best_by_min_cost: pickMinimumVariant(successful, 'unit_cost'),
      stress_threshold: threshold === null ? null : {
        threshold_mpa: threshold,
        measured_variants: thresholdEligible.length,
        pass_count: thresholdPassed.length,
        fail_count: thresholdFailed.length,
        passing_variants: thresholdPassed.map((variant) => variant.variant_id),
        failing_variants: thresholdFailed.map((variant) => variant.variant_id),
      },
    },
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildSweepCsv(summaryDocument) {
  const parameterHeaders = summaryDocument.parameter_space.parameters.map((parameter) => parameter.path);
  const artifactHeaders = [...new Set(summaryDocument.variants.flatMap((variant) => Object.keys(variant.artifacts || {})))].sort();
  const headers = [
    'variant_id',
    'status',
    'error_count',
    'total_runtime_ms',
    ...parameterHeaders,
    'model_volume_mm3',
    'estimated_mass_kg',
    'unit_cost',
    'max_von_mises_mpa',
    'safety_factor',
    'stress_threshold_pass',
    ...artifactHeaders,
  ];

  const lines = [headers.map(csvEscape).join(',')];
  for (const variant of summaryDocument.variants) {
    const row = {
      variant_id: variant.variant_id,
      status: variant.success ? 'ok' : 'error',
      error_count: Array.isArray(variant.errors) ? variant.errors.length : 0,
      total_runtime_ms: variant.runtime_ms?.total ?? '',
      model_volume_mm3: variant.metrics?.model_volume_mm3 ?? '',
      estimated_mass_kg: variant.metrics?.estimated_mass_kg ?? '',
      unit_cost: variant.metrics?.unit_cost ?? '',
      max_von_mises_mpa: variant.metrics?.max_von_mises_mpa ?? '',
      safety_factor: variant.metrics?.safety_factor ?? '',
      stress_threshold_pass: variant.metrics?.stress_threshold_pass ?? '',
    };

    for (const header of parameterHeaders) {
      row[header] = variant.overrides?.[header] ?? '';
    }
    for (const header of artifactHeaders) {
      row[header] = variant.artifacts?.[header] ?? '';
    }

    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }

  return `${lines.join('\n')}\n`;
}
