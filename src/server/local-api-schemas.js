import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const artifactManifestSchema = JSON.parse(
  readFileSync(new URL('../../schemas/artifact-manifest.schema.json', import.meta.url), 'utf8')
);

const nullableString = {
  type: ['string', 'null'],
};

const nullableInteger = {
  type: ['integer', 'null'],
  minimum: 0,
};

const jobRequestSchema = {
  $id: 'fcad.jobRequest',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'file_path'],
      properties: {
        type: { const: 'inspect' },
        file_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { enum: ['create', 'draw', 'report'] },
        config_path: { type: 'string', minLength: 1 },
        config: { type: 'object' },
        options: { type: 'object' },
      },
      oneOf: [
        { required: ['config_path'] },
        { required: ['config'] },
      ],
      not: {
        required: ['config_path', 'config'],
      },
    },
  ],
};

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'messages'],
  properties: {
    code: { type: 'string', minLength: 1 },
    messages: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
};

const statusHistorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'at'],
  properties: {
    status: { type: 'string', minLength: 1 },
    at: { type: 'string', minLength: 1 },
    detail: { type: ['string', 'null'] },
  },
};

const storageFileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'exists', 'size_bytes'],
  properties: {
    path: { type: 'string', minLength: 1 },
    exists: { type: 'boolean' },
    size_bytes: nullableInteger,
  },
};

const artifactEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'path', 'type', 'scope', 'stability', 'exists', 'size_bytes'],
  properties: {
    key: { type: 'string', minLength: 1 },
    path: { type: 'string', minLength: 1 },
    type: nullableString,
    scope: nullableString,
    stability: nullableString,
    exists: { type: 'boolean' },
    size_bytes: nullableInteger,
  },
};

const manifestSchema = {
  anyOf: [
    { type: 'null' },
    artifactManifestSchema,
  ],
};

const jobSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'type',
    'status',
    'created_at',
    'updated_at',
    'started_at',
    'finished_at',
    'error',
    'request',
    'diagnostics',
    'artifacts',
    'manifest',
    'result',
    'status_history',
    'storage',
    'links',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { enum: ['create', 'draw', 'inspect', 'report'] },
    status: { enum: ['queued', 'running', 'succeeded', 'failed'] },
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    started_at: nullableString,
    finished_at: nullableString,
    error: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1 },
          },
        },
      ],
    },
    request: { type: 'object' },
    diagnostics: { type: 'object' },
    artifacts: { type: 'object' },
    manifest: manifestSchema,
    result: true,
    status_history: {
      type: 'array',
      items: statusHistorySchema,
    },
    storage: {
      type: 'object',
      additionalProperties: false,
      required: ['root', 'files'],
      properties: {
        root: { type: 'string', minLength: 1 },
        files: {
          type: 'object',
          additionalProperties: false,
          required: ['job', 'request', 'log', 'manifest'],
          properties: {
            job: storageFileSchema,
            request: storageFileSchema,
            log: storageFileSchema,
            manifest: storageFileSchema,
          },
        },
      },
    },
    links: {
      type: 'object',
      additionalProperties: false,
      required: ['self', 'artifacts'],
      properties: {
        self: { type: 'string', minLength: 1 },
        artifacts: { type: 'string', minLength: 1 },
      },
    },
  },
};

const healthResponseSchema = {
  $id: 'fcad.healthResponse',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'status', 'service', 'jobs_dir', 'runtime'],
  properties: {
    ok: { const: true },
    status: { const: 'ok' },
    service: { const: 'fcad-local-api' },
    jobs_dir: { type: 'string', minLength: 1 },
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: [
        'available',
        'mode',
        'source',
        'path_style',
        'executable',
        'python_executable',
        'runtime_executable',
        'gui_executable',
        'checked_candidates',
        'description',
      ],
      properties: {
        available: { type: 'boolean' },
        mode: { type: 'string' },
        source: { type: 'string' },
        path_style: { type: 'string' },
        executable: { type: 'string' },
        python_executable: { type: 'string' },
        runtime_executable: { type: 'string' },
        gui_executable: { type: 'string' },
        checked_candidates: {
          type: 'array',
          items: { type: 'string' },
        },
        description: { type: 'string', minLength: 1 },
      },
    },
  },
};

const jobResponseSchema = {
  $id: 'fcad.jobResponse',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'job'],
  properties: {
    ok: { const: true },
    job: jobSchema,
  },
};

const artifactsResponseSchema = {
  $id: 'fcad.artifactsResponse',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'job_id', 'artifacts', 'manifest', 'storage'],
  properties: {
    ok: { const: true },
    job_id: { type: 'string', minLength: 1 },
    artifacts: {
      type: 'array',
      items: artifactEntrySchema,
    },
    manifest: manifestSchema,
    storage: jobSchema.properties.storage,
  },
};

const errorResponseSchema = {
  $id: 'fcad.errorResponse',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'error'],
  properties: {
    ok: { const: false },
    error: errorSchema,
  },
};

const validateJobRequestSchema = ajv.compile(jobRequestSchema);
const responseValidators = {
  health: ajv.compile(healthResponseSchema),
  job: ajv.compile(jobResponseSchema),
  artifacts: ajv.compile(artifactsResponseSchema),
  error: ajv.compile(errorResponseSchema),
};

function formatInstancePath(error) {
  return error.instancePath || '/';
}

export function formatAjvErrors(errors = []) {
  return errors.map((error) => {
    const location = formatInstancePath(error);
    if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
      return `${location} has unsupported property "${error.params.additionalProperty}"`;
    }
    if (error.keyword === 'required' && error.params?.missingProperty) {
      return `${location} is missing required property "${error.params.missingProperty}"`;
    }
    return `${location} ${error.message}`;
  });
}

export function validateLocalApiJobRequest(body) {
  const valid = validateJobRequestSchema(body);
  return {
    ok: valid === true,
    errors: valid ? [] : formatAjvErrors(validateJobRequestSchema.errors),
  };
}

export function validateLocalApiResponse(kind, payload) {
  const validator = responseValidators[kind];
  if (!validator) {
    throw new Error(`Unknown local API response validator: ${kind}`);
  }
  const valid = validator(payload);
  return {
    ok: valid === true,
    errors: valid ? [] : formatAjvErrors(validator.errors),
  };
}
