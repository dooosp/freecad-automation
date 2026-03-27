import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import { configV1Schema } from './config-canonical-schema.js';
import { normalizeConfig } from './config-normalizer.js';

export const CURRENT_CONFIG_VERSION = 1;
export const SUPPORTED_CONFIG_VERSIONS = new Set([CURRENT_CONFIG_VERSION]);

const LEGACY_EXPORT_FORMAT_FLAGS = ['step', 'stl', 'brep', 'dxf', 'svg', 'pdf'];
const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
const validateCanonicalV1 = ajv.compile(configV1Schema);

function createDiagnostics() {
  return {
    errors: [],
    warnings: [],
    changed_fields: [],
    deprecated_fields: [],
    manual_follow_up: [],
  };
}

function pathLabel(path) {
  if (!Array.isArray(path) || path.length === 0) return 'root';
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      if (index === 0) return String(segment);
      return `.${segment}`;
    })
    .join('');
}

function pointerToPath(pointer = '') {
  if (!pointer) return ['root'];
  return ['root', ...pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment) => (segment.match(/^\d+$/) ? Number(segment) : segment))];
}

function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function cloneConfig(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dedupeStringArray(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string'))];
}

function formatAjvError(error) {
  const basePath = pathLabel(pointerToPath(error.instancePath));

  if (error.keyword === 'required') {
    return `${basePath} must include \`${error.params?.missingProperty}\`.`;
  }

  if (error.keyword === 'type') {
    return `${basePath} must be ${error.params?.type}.`;
  }

  if (error.keyword === 'enum') {
    const allowed = Array.isArray(error.params?.allowedValues) ? error.params.allowedValues.join(', ') : 'an allowed value';
    return `${basePath} must be one of: ${allowed}.`;
  }

  if (error.keyword === 'minItems') {
    return `${basePath} must contain at least ${error.params?.limit} item(s).`;
  }

  if (error.keyword === 'maxItems') {
    return `${basePath} must contain at most ${error.params?.limit} item(s).`;
  }

  if (error.keyword === 'uniqueItems') {
    return `${basePath} must not contain duplicate values.`;
  }

  if (error.keyword === 'anyOf' && /operations/.test(error.instancePath || '')) {
    return `${basePath} must include \`op\` (or legacy \`type\`) as a string.`;
  }

  if (error.keyword === 'anyOf') {
    return `${basePath} must match one of the supported config shapes.`;
  }

  return `${basePath} ${error.message || 'is invalid.'}`;
}

export function parseConfigText(text, filepath = '') {
  const ext = extname(filepath).toLowerCase();
  if (ext === '.json') {
    return { format: 'json', parsed: JSON.parse(text) };
  }
  if (ext === '.toml' || !ext) {
    return { format: 'toml', parsed: parseTOML(text) };
  }
  throw new Error(`Unsupported config format: ${ext} (use .toml or .json)`);
}

export async function readRawConfigFile(filepath) {
  const text = await readFile(filepath, 'utf8');
  const { format, parsed } = parseConfigText(text, filepath);
  return { text, format, parsed };
}

export function serializeConfig(config, format = 'toml') {
  if (format === 'json') {
    return `${JSON.stringify(config, null, 2)}\n`;
  }
  return stringifyTOML(config);
}

function collectLegacyExportFormats(exportConfig = {}) {
  return LEGACY_EXPORT_FORMAT_FLAGS.filter((key) => exportConfig[key] === true);
}

function visitOperationLists(config, visitor, path = ['root']) {
  if (!isPlainObject(config)) return;

  if (Array.isArray(config.operations)) {
    visitor(config.operations, path.concat('operations'));
  }

  if (Array.isArray(config.parts)) {
    config.parts.forEach((part, index) => {
      visitOperationLists(part, visitor, path.concat('parts', index));
    });
  }
}

function applyCanonicalDefaults(config, diagnostics) {
  if (!isPlainObject(config)) return;

  if (isPlainObject(config.export) && config.export.formats === undefined) {
    config.export.formats = ['step'];
    diagnostics.changed_fields.push('Added default root.export.formats = ["step"]');
  }

  if (isPlainObject(config.export) && Array.isArray(config.export.formats)) {
    const dedupedFormats = dedupeStringArray(config.export.formats);
    if (dedupedFormats.length !== config.export.formats.length) {
      config.export.formats = dedupedFormats;
      diagnostics.changed_fields.push('Deduplicated root.export.formats');
    }
  }

  if (isPlainObject(config.drawing) && config.drawing.units === undefined) {
    config.drawing.units = 'mm';
    diagnostics.changed_fields.push('Added default root.drawing.units = "mm"');
  }

  if (isPlainObject(config.fem) && config.fem.analysis_type === undefined) {
    config.fem.analysis_type = 'static';
    diagnostics.changed_fields.push('Added default root.fem.analysis_type = "static"');
  }
}

function validateCanonicalSchema(config, diagnostics) {
  const valid = validateCanonicalV1(config);
  if (valid) return;

  for (const error of validateCanonicalV1.errors || []) {
    pushUnique(diagnostics.errors, formatAjvError(error));
  }
}

function validateCommonSemantics(config, diagnostics) {
  if (!isPlainObject(config)) {
    pushUnique(diagnostics.errors, 'Config root must be an object.');
    return;
  }

  const hasShapes = Array.isArray(config.shapes) && config.shapes.length > 0;
  const hasParts = Array.isArray(config.parts) && config.parts.length > 0;
  const hasImportTemplate = typeof config.import?.source_step === 'string';
  if (!hasShapes && !hasParts && !hasImportTemplate) {
    pushUnique(
      diagnostics.warnings,
      'Config does not define top-level `shapes`, `parts`, or `import.source_step`; create/draw/report commands may not have enough geometry input.'
    );
  }

  visitOperationLists(config, (operations, path) => {
    operations.forEach((operation, index) => {
      if (!isPlainObject(operation)) return;
      const opPath = pathLabel(path.concat(index));
      if (typeof operation.op === 'string' && typeof operation.type === 'string' && operation.op !== operation.type) {
        diagnostics.manual_follow_up.push(
          `${opPath}.op (${JSON.stringify(operation.op)}) differs from deprecated ${opPath}.type (${JSON.stringify(operation.type)}); confirm the canonical value is correct.`
        );
      }
    });
  });

  if (typeof config.material === 'string'
    && typeof config.manufacturing?.material === 'string'
    && config.material !== config.manufacturing.material) {
    diagnostics.manual_follow_up.push(
      `root.material (${JSON.stringify(config.material)}) differs from root.manufacturing.material (${JSON.stringify(config.manufacturing.material)}); keep only the canonical field once downstream consumers are updated.`
    );
  }

  if (typeof config.process === 'string'
    && typeof config.manufacturing?.process === 'string'
    && config.process !== config.manufacturing.process) {
    diagnostics.manual_follow_up.push(
      `root.process (${JSON.stringify(config.process)}) differs from root.manufacturing.process (${JSON.stringify(config.manufacturing.process)}); keep only the canonical field once downstream consumers are updated.`
    );
  }
}

export function migrateConfigDocument(rawConfig, { filepath = '' } = {}) {
  const diagnostics = createDiagnostics();

  if (!isPlainObject(rawConfig)) {
    diagnostics.errors.push('Config root must be an object.');
    return {
      config: rawConfig,
      summary: {
        filepath,
        input_version: null,
        target_version: CURRENT_CONFIG_VERSION,
        ...diagnostics,
      },
    };
  }

  const migrated = cloneConfig(rawConfig);
  const inputVersion = Number.isInteger(migrated.config_version) ? migrated.config_version : null;

  if (inputVersion !== null && !SUPPORTED_CONFIG_VERSIONS.has(inputVersion)) {
    diagnostics.errors.push(
      `Unsupported config_version ${inputVersion}. Supported versions: ${[...SUPPORTED_CONFIG_VERSIONS].join(', ')}.`
    );
  }

  if (inputVersion === null) {
    migrated.config_version = CURRENT_CONFIG_VERSION;
    diagnostics.changed_fields.push(`Added root.config_version = ${CURRENT_CONFIG_VERSION}`);
    diagnostics.deprecated_fields.push('Missing root.config_version (legacy unversioned config).');
  }

  if (typeof migrated.material === 'string') {
    migrated.manufacturing = isPlainObject(migrated.manufacturing) ? migrated.manufacturing : {};
    if (migrated.manufacturing.material === undefined) {
      migrated.manufacturing.material = migrated.material;
      diagnostics.changed_fields.push('Copied root.material -> root.manufacturing.material');
    }
    diagnostics.deprecated_fields.push('root.material is compatibility-only; prefer root.manufacturing.material.');
  }

  if (typeof migrated.process === 'string') {
    migrated.manufacturing = isPlainObject(migrated.manufacturing) ? migrated.manufacturing : {};
    if (migrated.manufacturing.process === undefined) {
      migrated.manufacturing.process = migrated.process;
      diagnostics.changed_fields.push('Copied root.process -> root.manufacturing.process');
    }
    diagnostics.deprecated_fields.push('root.process is compatibility-only; prefer root.manufacturing.process.');
  }

  visitOperationLists(migrated, (operations, path) => {
    operations.forEach((operation, index) => {
      if (!isPlainObject(operation)) return;
      const opPath = pathLabel(path.concat(index));
      if (operation.op === undefined && typeof operation.type === 'string') {
        operation.op = operation.type;
        diagnostics.changed_fields.push(`Copied ${opPath}.type -> ${opPath}.op`);
      }
      if (typeof operation.type === 'string') {
        diagnostics.deprecated_fields.push(`${opPath}.type is compatibility-only; prefer ${opPath}.op.`);
      }
    });
  });

  if (isPlainObject(migrated.export)) {
    const legacyFormats = collectLegacyExportFormats(migrated.export);
    if (legacyFormats.length > 0) {
      const currentFormats = Array.isArray(migrated.export.formats) ? migrated.export.formats : [];
      const mergedFormats = dedupeStringArray([...currentFormats, ...legacyFormats]);
      if (mergedFormats.length !== currentFormats.length || migrated.export.formats === undefined) {
        migrated.export.formats = mergedFormats;
        diagnostics.changed_fields.push(
          `Merged legacy root.export.{${legacyFormats.join(', ')}} flags into root.export.formats`
        );
      }
      diagnostics.deprecated_fields.push(
        `Legacy root.export.{${legacyFormats.join(', ')}} boolean flags are compatibility-only; prefer root.export.formats.`
      );
    }
  }

  applyCanonicalDefaults(migrated, diagnostics);

  const normalized = normalizeConfig(migrated);
  validateCanonicalSchema(normalized, diagnostics);
  validateCommonSemantics(normalized, diagnostics);

  for (const entry of diagnostics.deprecated_fields) {
    pushUnique(diagnostics.warnings, `Deprecated field: ${entry}`);
  }
  for (const entry of diagnostics.manual_follow_up) {
    pushUnique(diagnostics.warnings, `Manual follow-up: ${entry}`);
  }

  return {
    config: normalized,
    summary: {
      filepath,
      input_version: inputVersion,
      target_version: CURRENT_CONFIG_VERSION,
      ...diagnostics,
    },
  };
}

export function validateConfigDocument(rawConfig, options = {}) {
  const { config, summary } = migrateConfigDocument(rawConfig, options);
  return {
    valid: summary.errors.length === 0,
    config,
    summary,
  };
}

function formatValidationMessage(filepath, summary) {
  const lines = [
    filepath ? `Config validation failed for ${filepath}:` : 'Config validation failed:',
  ];
  for (const error of summary.errors) {
    lines.push(`- ${error}`);
  }
  return lines.join('\n');
}

export async function loadConfigWithDiagnostics(filepath, options = {}) {
  const { parsed, format } = await readRawConfigFile(filepath);
  const validation = validateConfigDocument(parsed, { filepath });
  if (!validation.valid) {
    throw new Error(formatValidationMessage(filepath, validation.summary));
  }

  if (typeof options.onWarning === 'function') {
    for (const warning of validation.summary.warnings) {
      options.onWarning(warning, validation.summary);
    }
  }

  return {
    ...validation,
    format,
  };
}
