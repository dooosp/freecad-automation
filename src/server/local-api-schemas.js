import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';

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

const nullableBoolean = {
  type: ['boolean', 'null'],
};

const artifactRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['job_id', 'artifact_id'],
  properties: {
    job_id: { type: 'string', minLength: 1 },
    artifact_id: { type: 'string', minLength: 1 },
  },
};

const localApiJobRequestSchema = {
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
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'review-context' },
        context_path: { type: 'string', minLength: 1 },
        model_path: { type: 'string', minLength: 1 },
        bom_path: { type: 'string', minLength: 1 },
        inspection_path: { type: 'string', minLength: 1 },
        quality_path: { type: 'string', minLength: 1 },
        compare_to_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
      anyOf: [
        { required: ['context_path'] },
        { required: ['model_path'] },
      ],
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'baseline_path', 'candidate_path'],
      properties: {
        type: { const: 'compare-rev' },
        baseline_path: { type: 'string', minLength: 1 },
        candidate_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'review_pack_path'],
      properties: {
        type: { const: 'readiness-pack' },
        review_pack_path: { type: 'string', minLength: 1 },
        process_plan_path: { type: 'string', minLength: 1 },
        quality_risk_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'baseline_path', 'candidate_path'],
      properties: {
        type: { const: 'stabilization-review' },
        baseline_path: { type: 'string', minLength: 1 },
        candidate_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'config_path'],
      properties: {
        type: { const: 'generate-standard-docs' },
        config_path: { type: 'string', minLength: 1 },
        readiness_report_path: { type: 'string', minLength: 1 },
        review_pack_path: { type: 'string', minLength: 1 },
        process_plan_path: { type: 'string', minLength: 1 },
        quality_risk_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
      oneOf: [
        { required: ['readiness_report_path'] },
        { required: ['review_pack_path'] },
      ],
      not: {
        required: ['readiness_report_path', 'review_pack_path'],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'readiness_report_path'],
      properties: {
        type: { const: 'pack' },
        readiness_report_path: { type: 'string', minLength: 1 },
        docs_manifest_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
  ],
};

const publicJobRequestSchema = {
  $id: 'fcad.publicJobRequest',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'inspect' },
        artifact_ref: artifactRefSchema,
        source_job_id: { type: 'string', minLength: 1 },
        source_artifact_id: { type: 'string', minLength: 1 },
        source_artifact_type: { type: 'string', minLength: 1 },
        source_label: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { enum: ['create', 'draw', 'report'] },
        config: { type: 'object' },
        artifact_ref: artifactRefSchema,
        source_job_id: { type: 'string', minLength: 1 },
        source_artifact_id: { type: 'string', minLength: 1 },
        source_artifact_type: { type: 'string', minLength: 1 },
        source_label: { type: 'string', minLength: 1 },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: {
          enum: [
            'review-context',
            'compare-rev',
            'readiness-pack',
            'stabilization-review',
            'generate-standard-docs',
            'pack',
          ],
        },
        context_path: { type: 'string', minLength: 1 },
        model_path: { type: 'string', minLength: 1 },
        bom_path: { type: 'string', minLength: 1 },
        inspection_path: { type: 'string', minLength: 1 },
        quality_path: { type: 'string', minLength: 1 },
        compare_to_path: { type: 'string', minLength: 1 },
        baseline_path: { type: 'string', minLength: 1 },
        candidate_path: { type: 'string', minLength: 1 },
        review_pack_path: { type: 'string', minLength: 1 },
        readiness_report_path: { type: 'string', minLength: 1 },
        process_plan_path: { type: 'string', minLength: 1 },
        quality_risk_path: { type: 'string', minLength: 1 },
        docs_manifest_path: { type: 'string', minLength: 1 },
        config_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
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

const jobCapabilitiesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cancellation_supported', 'retry_supported'],
  properties: {
    cancellation_supported: { type: 'boolean' },
    retry_supported: { type: 'boolean' },
  },
};

const storageFileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['exists', 'size_bytes'],
  properties: {
    exists: { type: 'boolean' },
    size_bytes: nullableInteger,
  },
};

const artifactEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'key',
    'type',
    'scope',
    'stability',
    'file_name',
    'extension',
    'content_type',
    'exists',
    'size_bytes',
    'capabilities',
    'links',
    'contract',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    key: { type: 'string', minLength: 1 },
    type: nullableString,
    scope: nullableString,
    stability: nullableString,
    file_name: { type: 'string', minLength: 1 },
    extension: { type: 'string' },
    content_type: { type: 'string', minLength: 1 },
    exists: { type: 'boolean' },
    size_bytes: nullableInteger,
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['can_open', 'can_download', 'browser_safe'],
      properties: {
        can_open: { type: 'boolean' },
        can_download: { type: 'boolean' },
        browser_safe: { type: 'boolean' },
      },
    },
    links: {
      type: 'object',
      additionalProperties: false,
      required: ['open', 'download'],
      properties: {
        open: { type: 'string', minLength: 1 },
        download: { type: 'string', minLength: 1 },
        api: { type: 'string', minLength: 1 },
      },
    },
    contract: {
      anyOf: [
        { type: 'null' },
        { type: 'object' },
      ],
    },
  },
};

const runtimeDiagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'diagnostics_version',
    'status',
    'available',
    'platform',
    'description',
    'source',
    'mode',
    'path_style',
    'executable',
    'python_executable',
    'runtime_executable',
    'gui_executable',
    'checked_candidates',
    'selected_runtime',
    'detected_runtime_paths',
    'env_overrides',
    'version_details',
    'command_classes',
    'capability_map',
    'warnings',
    'errors',
    'support_boundary_note',
    'next_steps',
    'remediation',
  ],
  properties: {
    diagnostics_version: { type: 'string', minLength: 1 },
    status: { enum: ['ready', 'runtime_not_detected'] },
    available: { type: 'boolean' },
    platform: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    source: { type: 'string' },
    mode: { type: 'string' },
    path_style: { type: 'string' },
    executable: { type: 'string' },
    python_executable: { type: 'string' },
    runtime_executable: { type: 'string' },
    gui_executable: { type: 'string' },
    checked_candidates: {
      type: 'array',
      items: { type: 'string' },
    },
    selected_runtime: {
      type: 'object',
      additionalProperties: false,
      required: [
        'summary',
        'source',
        'mode',
        'path_style',
        'executable',
        'bundle_root',
        'install_root',
        'runtime_executable',
        'python_executable',
        'gui_executable',
      ],
      properties: {
        summary: { type: 'string', minLength: 1 },
        source: { type: 'string' },
        mode: { type: 'string' },
        path_style: { type: 'string' },
        executable: { type: 'string' },
        bundle_root: { type: 'string' },
        install_root: { type: 'string' },
        runtime_executable: { type: 'string' },
        python_executable: { type: 'string' },
        gui_executable: { type: 'string' },
      },
    },
    detected_runtime_paths: {
      type: 'object',
      additionalProperties: false,
      required: ['checked_candidates', 'selected_candidates'],
      properties: {
        checked_candidates: {
          type: 'array',
          items: { type: 'string' },
        },
        selected_candidates: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    env_overrides: {
      type: 'object',
      additionalProperties: false,
      required: ['resolution_order', 'values'],
      properties: {
        resolution_order: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        values: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'value', 'selected'],
            properties: {
              name: { type: 'string', minLength: 1 },
              value: nullableString,
              selected: { type: 'boolean' },
            },
          },
        },
      },
    },
    version_details: {
      type: 'object',
      additionalProperties: false,
      required: ['python', 'freecad'],
      properties: {
        python: {
          type: 'object',
          additionalProperties: false,
          required: ['executable', 'version', 'platform', 'source', 'error'],
          properties: {
            executable: { type: 'string' },
            version: nullableString,
            platform: nullableString,
            source: nullableString,
            error: nullableString,
          },
        },
        freecad: {
          type: 'object',
          additionalProperties: false,
          required: ['executable', 'version', 'home_path', 'module_path', 'source', 'error'],
          properties: {
            executable: { type: 'string' },
            version: nullableString,
            home_path: nullableString,
            module_path: nullableString,
            source: nullableString,
            error: nullableString,
          },
        },
      },
    },
    command_classes: {
      type: 'object',
      additionalProperties: false,
      required: ['diagnostics', 'freecad_backed', 'plain_python_or_node', 'mixed_or_conditional'],
      properties: {
        diagnostics: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        freecad_backed: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        plain_python_or_node: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        mixed_or_conditional: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'note'],
            properties: {
              name: { type: 'string', minLength: 1 },
              note: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    capability_map: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['classification', 'requires_freecad_runtime', 'note'],
        properties: {
          classification: { type: 'string', minLength: 1 },
          requires_freecad_runtime: nullableBoolean,
          note: nullableString,
        },
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    errors: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    support_boundary_note: nullableString,
    next_steps: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    remediation: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
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
    'retried_from_job_id',
    'request',
    'diagnostics',
    'artifacts',
    'manifest',
    'result',
    'status_history',
    'storage',
    'execution',
    'capabilities',
    'links',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: {
      enum: [
        'create',
        'draw',
        'inspect',
        'report',
        'review-context',
        'compare-rev',
        'readiness-pack',
        'stabilization-review',
        'generate-standard-docs',
        'pack',
      ],
    },
    status: { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
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
    retried_from_job_id: nullableString,
    request: publicJobRequestSchema,
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
      required: ['files'],
      properties: {
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
    execution: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'contract_version',
            'command',
            'layer',
            'reentry_target',
            'canonical_output',
            'lifecycle_state',
            'raw_state',
            'compatible',
            'legacy_aliases',
          ],
          properties: {
            contract_version: { type: 'string', minLength: 1 },
            command: { type: 'string', minLength: 1 },
            layer: { type: 'string', minLength: 1 },
            reentry_target: nullableString,
            canonical_output: { type: 'string', minLength: 1 },
            lifecycle_state: nullableString,
            raw_state: nullableString,
            compatible: { type: 'boolean' },
            legacy_aliases: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
          },
        },
      ],
    },
    capabilities: jobCapabilitiesSchema,
    links: {
      type: 'object',
      additionalProperties: false,
      required: ['self', 'artifacts', 'cancel', 'retry'],
      properties: {
        self: { type: 'string', minLength: 1 },
        artifacts: { type: 'string', minLength: 1 },
        cancel: { type: 'string', minLength: 1 },
        retry: { type: 'string', minLength: 1 },
      },
    },
  },
};

const healthResponseSchema = {
  $id: 'fcad.healthResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'status', 'service', 'jobs_dir', 'runtime'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    status: { const: 'ok' },
    service: { const: LOCAL_API_SERVICE },
    jobs_dir: { type: 'string', minLength: 1 },
    runtime: runtimeDiagnosticsSchema,
  },
};

const jobResponseSchema = {
  $id: 'fcad.jobResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'job'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    job: jobSchema,
  },
};

const jobsResponseSchema = {
  $id: 'fcad.jobsResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'jobs'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    jobs: {
      type: 'array',
      items: jobSchema,
    },
  },
};

const artifactsResponseSchema = {
  $id: 'fcad.artifactsResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'job_id', 'artifacts', 'manifest', 'storage'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
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

const jobActionResponseSchema = {
  $id: 'fcad.jobActionResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'action', 'job'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'status', 'message', 'source_job_id', 'retry_job_id'],
      properties: {
        type: { enum: ['cancel', 'retry'] },
        status: { enum: ['cancelled', 'queued'] },
        message: { type: 'string', minLength: 1 },
        source_job_id: { type: 'string', minLength: 1 },
        retry_job_id: nullableString,
      },
    },
    job: jobSchema,
  },
};

const errorResponseSchema = {
  $id: 'fcad.errorResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'error'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: false },
    error: errorSchema,
  },
};

const validateJobRequestSchema = ajv.compile(localApiJobRequestSchema);
const responseValidators = {
  health: ajv.compile(healthResponseSchema),
  job: ajv.compile(jobResponseSchema),
  jobs: ajv.compile(jobsResponseSchema),
  artifacts: ajv.compile(artifactsResponseSchema),
  job_action: ajv.compile(jobActionResponseSchema),
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
