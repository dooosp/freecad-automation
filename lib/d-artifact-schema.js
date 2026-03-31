import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

export const D_ARTIFACT_SCHEMA_VERSION = '1.0';
export const D_ANALYSIS_VERSION = 'd1';

const SCHEMA_SPECS = [
  {
    kind: 'd_artifact_common',
    file: new URL('../schemas/d_artifact_common.schema.json', import.meta.url),
  },
  {
    kind: 'geometry_intelligence',
    file: new URL('../schemas/geometry_intelligence.schema.json', import.meta.url),
  },
  {
    kind: 'manufacturing_hotspots',
    file: new URL('../schemas/manufacturing_hotspots.schema.json', import.meta.url),
  },
  {
    kind: 'inspection_linkage',
    file: new URL('../schemas/inspection_linkage.schema.json', import.meta.url),
  },
  {
    kind: 'quality_linkage',
    file: new URL('../schemas/quality_linkage.schema.json', import.meta.url),
  },
  {
    kind: 'review_priorities',
    file: new URL('../schemas/review_priorities.schema.json', import.meta.url),
  },
  {
    kind: 'review_pack',
    file: new URL('../schemas/review_pack.schema.json', import.meta.url),
  },
  {
    kind: 'revision_comparison',
    file: new URL('../schemas/revision_comparison.schema.json', import.meta.url),
  },
];

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const schemasByKind = new Map();

for (const spec of SCHEMA_SPECS) {
  const schema = JSON.parse(readFileSync(spec.file, 'utf8'));
  schemasByKind.set(spec.kind, schema);
  ajv.addSchema(schema, schema.$id);
}

const validatorsByKind = new Map(
  [...schemasByKind.entries()]
    .filter(([kind]) => kind !== 'd_artifact_common')
    .map(([kind, schema]) => [kind, ajv.getSchema(schema.$id) || ajv.compile(schema)])
);

function normalizeInstancePath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => {
    const path = normalizeInstancePath(error);
    return `${path} ${error.message}`.trim();
  });
}

export class ArtifactSchemaValidationError extends Error {
  constructor(kind, errors, options = {}) {
    const contextLabel = options.command ? ` for ${options.command}` : '';
    const pathLabel = options.path ? ` (${options.path})` : '';
    super(`Schema validation failed for ${kind}${contextLabel}${pathLabel}: ${errors.join(' | ')}`);
    this.name = 'ArtifactSchemaValidationError';
    this.kind = kind;
    this.errors = errors;
    this.command = options.command || null;
    this.path = options.path || null;
  }
}

export function buildSourceArtifactRef(artifactType, path, role, label = null) {
  return {
    artifact_type: artifactType,
    path: path || null,
    role,
    label,
  };
}

export function validateDArtifact(kind, artifact) {
  const validator = validatorsByKind.get(kind);
  if (!validator) {
    throw new Error(`Unknown D artifact schema kind: ${kind}`);
  }

  const valid = validator(artifact);
  return {
    ok: valid === true,
    errors: valid ? [] : formatSchemaErrors(validator.errors || []),
  };
}

export function assertValidDArtifact(kind, artifact, options = {}) {
  const validation = validateDArtifact(kind, artifact);
  if (!validation.ok) {
    throw new ArtifactSchemaValidationError(kind, validation.errors, options);
  }
  return artifact;
}
