import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import {
  CANONICAL_ARTIFACT_CONTENT_KINDS,
  CANONICAL_ARTIFACT_KEYS,
} from './canonical-artifact-key-contract.js';
import { LOCAL_API_JOB_COMMANDS } from '../shared/command-manifest.js';
import {
  localApiJobRequestSchema,
  publicJobRequestSchema,
} from './schemas/local-api-job-request-schemas.js';
import { runtimeDiagnosticsSchema } from './schemas/runtime-diagnostics-schema.js';

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

const stringArraySchema = {
  type: 'array',
  items: { type: 'string' },
};

const routePathSchema = {
  type: 'string',
  minLength: 1,
  pattern: '^/',
};

const nullableRoutePathSchema = {
  anyOf: [
    { type: 'null' },
    routePathSchema,
  ],
};

const looseObjectSchema = {
  type: 'object',
  additionalProperties: true,
};

const nullableLooseObjectSchema = {
  anyOf: [
    { type: 'null' },
    looseObjectSchema,
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

const manifestSchema = {
  anyOf: [
    { type: 'null' },
    artifactManifestSchema,
  ],
};

const publicDisplayPathSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'string',
      minLength: 1,
      not: {
        anyOf: [
          { pattern: '^/' },
          { pattern: '^[A-Za-z]:[\\\\/]' },
          { pattern: '^~' },
          { pattern: '(^|/)\\.\\.(/|$)' },
        ],
      },
    },
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
    type: { enum: LOCAL_API_JOB_COMMANDS },
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

const landingEndpointSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'health',
    'jobs',
    'job',
    'cancel_job',
    'retry_job',
    'artifacts',
    'artifact_open',
    'artifact_download',
    'artifact_content',
  ],
  properties: {
    health: routePathSchema,
    jobs: routePathSchema,
    job: routePathSchema,
    cancel_job: routePathSchema,
    retry_job: routePathSchema,
    artifacts: routePathSchema,
    artifact_open: routePathSchema,
    artifact_download: routePathSchema,
    artifact_content: routePathSchema,
  },
};

const studioRouteBundleSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'validate_config',
    'design',
    'model_preview',
    'import_bootstrap',
    'model_asset',
    'model_part',
    'drawing_preview',
    'drawing_dimensions',
  ],
  properties: {
    validate_config: routePathSchema,
    design: routePathSchema,
    model_preview: routePathSchema,
    import_bootstrap: routePathSchema,
    model_asset: routePathSchema,
    model_part: routePathSchema,
    drawing_preview: routePathSchema,
    drawing_dimensions: routePathSchema,
  },
};

const studioTrackedRouteBundleSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'submit',
    'status',
    'cancel',
    'retry',
    'artifacts',
    'artifact_open',
  ],
  properties: {
    submit: routePathSchema,
    status: routePathSchema,
    cancel: routePathSchema,
    retry: routePathSchema,
    artifacts: routePathSchema,
    artifact_open: routePathSchema,
  },
};

const landingResponseSchema = {
  $id: 'fcad.landingResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'api_version',
    'ok',
    'status',
    'service',
    'mode',
    'project_root',
    'jobs_dir',
    'endpoints',
    'studio',
    'api_info',
    'viewer',
    'examples',
    'notes',
  ],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    status: { const: 'ok' },
    service: { const: LOCAL_API_SERVICE },
    mode: { const: 'local_api' },
    project_root: { type: 'string', minLength: 1 },
    jobs_dir: { type: 'string', minLength: 1 },
    endpoints: landingEndpointSchema,
    studio: {
      type: 'object',
      additionalProperties: false,
      required: [
        'available',
        'preferred_path',
        'path',
        'tracked_jobs_path',
        'preview_routes',
        'tracked_routes',
        'note',
      ],
      properties: {
        available: { type: 'boolean' },
        preferred_path: routePathSchema,
        path: routePathSchema,
        tracked_jobs_path: routePathSchema,
        preview_routes: studioRouteBundleSchema,
        tracked_routes: studioTrackedRouteBundleSchema,
        note: { type: 'string', minLength: 1 },
      },
    },
    api_info: {
      type: 'object',
      additionalProperties: false,
      required: ['available', 'path'],
      properties: {
        available: { type: 'boolean' },
        path: routePathSchema,
      },
    },
    viewer: {
      type: 'object',
      additionalProperties: false,
      required: ['available', 'command', 'npm_script'],
      properties: {
        available: { type: 'boolean' },
        command: { type: 'string', minLength: 1 },
        npm_script: { type: 'string', minLength: 1 },
      },
    },
    examples: {
      type: 'object',
      additionalProperties: false,
      required: ['health_curl'],
      properties: {
        health_curl: { type: 'string', minLength: 1 },
      },
    },
    notes: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
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

const examplesResponseSchema = {
  $id: 'fcad.examplesResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'examples'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'content'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const configProfilesResponseSchema = {
  $id: 'fcad.configProfilesResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'profiles'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'label'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          label: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const studioValidationSummarySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['warnings'],
  properties: {
    warnings: stringArraySchema,
    changed_fields: stringArraySchema,
    deprecated_fields: stringArraySchema,
    errors: stringArraySchema,
  },
};

const studioOverviewSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['name', 'mode'],
  properties: {
    name: { type: 'string', minLength: 1 },
    mode: { type: 'string', minLength: 1 },
    part_count: { type: 'integer', minimum: 0 },
    shape_count: { type: 'integer', minimum: 0 },
    operation_count: { type: 'integer', minimum: 0 },
    export_formats: {
      type: 'array',
      items: { type: 'string' },
    },
    has_drawing: { type: 'boolean' },
    has_motion: { type: 'boolean' },
    has_fem: { type: 'boolean' },
  },
};

const studioValidateConfigResponseSchema = {
  $id: 'fcad.studioValidateConfigResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'validation', 'overview'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    validation: studioValidationSummarySchema,
    overview: studioOverviewSchema,
  },
};

const studioDesignResponseSchema = {
  $id: 'fcad.studioDesignResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'toml', 'report', 'validation'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    toml: { type: 'string' },
    report: true,
    validation: {
      anyOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: true },
      ],
    },
  },
};

const studioModelPreviewSchema = {
  type: 'object',
  additionalProperties: true,
  required: [
    'id',
    'built_at',
    'settings',
    'overview',
    'validation',
    'logs',
    'assembly',
    'motion_data',
    'model_asset_url',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    built_at: { type: 'string', minLength: 1 },
    settings: {
      type: 'object',
      additionalProperties: false,
      required: ['include_step', 'include_stl', 'per_part_stl'],
      properties: {
        include_step: { type: 'boolean' },
        include_stl: { type: 'boolean' },
        per_part_stl: { type: 'boolean' },
      },
    },
    overview: studioOverviewSchema,
    validation: studioValidationSummarySchema,
    logs: stringArraySchema,
    model: true,
    assembly: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: true,
          properties: {
            part_files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['id', 'index', 'asset_url'],
                not: {
                  anyOf: [
                    { required: ['path'] },
                    { required: ['resolvedPath'] },
                  ],
                },
                properties: {
                  id: { type: 'string', minLength: 1 },
                  index: { type: 'integer', minimum: 0 },
                  asset_url: routePathSchema,
                },
              },
            },
          },
        },
      ],
    },
    motion_data: true,
    model_asset_url: nullableRoutePathSchema,
  },
};

const studioModelPreviewResponseSchema = {
  $id: 'fcad.studioModelPreviewResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'preview'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    preview: studioModelPreviewSchema,
  },
};

const bootstrapSourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model_path', 'bom_path', 'inspection_path', 'quality_path'],
  properties: {
    model_path: publicDisplayPathSchema,
    bom_path: publicDisplayPathSchema,
    inspection_path: publicDisplayPathSchema,
    quality_path: publicDisplayPathSchema,
  },
};

const bootstrapTrackedReviewSeedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['context_path', 'model_path'],
  properties: {
    context_path: publicDisplayPathSchema,
    model_path: publicDisplayPathSchema,
    bom_path: publicDisplayPathSchema,
    inspection_path: publicDisplayPathSchema,
    quality_path: publicDisplayPathSchema,
  },
};

const bootstrapArtifactSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'path', 'file_name'],
  properties: {
    key: { type: 'string', minLength: 1 },
    path: publicDisplayPathSchema,
    file_name: { type: 'string', minLength: 1 },
  },
};

const studioImportBootstrapResponseSchema = {
  $id: 'fcad.studioImportBootstrapResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'api_version',
    'ok',
    'session_id',
    'source',
    'bootstrap',
    'tracked_review_seed',
    'artifacts',
  ],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    session_id: { type: 'string', minLength: 1 },
    source: bootstrapSourceSchema,
    bootstrap: looseObjectSchema,
    tracked_review_seed: bootstrapTrackedReviewSeedSchema,
    artifacts: {
      type: 'array',
      items: bootstrapArtifactSchema,
    },
  },
};

const studioDrawingPreviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'drawn_at',
    'settings',
    'overview',
    'validation',
    'svg',
    'bom',
    'views',
    'scale',
    'qa_summary',
    'annotations',
    'dimensions',
    'preview_reference',
    'editable_plan_reference',
    'editable_plan_available',
    'dimension_editing_available',
    'tracked_draw_bridge_available',
    'artifact_capabilities',
  ],
  properties: {
    id: { type: 'string' },
    drawn_at: { type: 'string' },
    settings: looseObjectSchema,
    overview: looseObjectSchema,
    validation: looseObjectSchema,
    svg: { type: 'string' },
    bom: { type: 'array', items: true },
    views: { type: 'array', items: true },
    scale: true,
    qa_summary: nullableLooseObjectSchema,
    annotations: { type: 'array', items: true },
    dimensions: { type: 'array', items: true },
    preview_reference: { type: 'string', minLength: 1 },
    editable_plan_reference: { type: 'string' },
    editable_plan_available: { type: 'boolean' },
    dimension_editing_available: { type: 'boolean' },
    tracked_draw_bridge_available: { type: 'boolean' },
    artifact_capabilities: {
      type: 'object',
      additionalProperties: false,
      required: [
        'editable_plan',
        'traceability',
        'layout_report',
        'repair_report',
        'dimension_map',
        'dimension_conflicts',
        'run_log',
      ],
      properties: {
        editable_plan: { type: 'boolean' },
        traceability: { type: 'boolean' },
        layout_report: { type: 'boolean' },
        repair_report: { type: 'boolean' },
        dimension_map: { type: 'boolean' },
        dimension_conflicts: { type: 'boolean' },
        run_log: { type: 'boolean' },
      },
    },
  },
};

const studioDrawingPreviewResponseSchema = {
  $id: 'fcad.studioDrawingPreviewResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'preview'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    update: {
      type: 'object',
      additionalProperties: true,
      required: ['dim_id', 'old_value', 'new_value', 'history_op'],
      properties: {
        dim_id: { type: 'string', minLength: 1 },
        old_value: true,
        new_value: true,
        history_op: { type: 'string', minLength: 1 },
      },
    },
    preview: studioDrawingPreviewSchema,
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

const relativePathSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'string',
      minLength: 1,
      not: {
        anyOf: [
          { pattern: '^/' },
          { pattern: '^[A-Za-z]:[\\\\/]' },
          { pattern: '^~' },
          { pattern: '(^|/)\\.\\.(/|$)' },
          { pattern: '^output/' },
          { pattern: '^tmp/' },
        ],
      },
    },
  ],
};

const canonicalPackageBoundarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'release_bundle_presence_does_not_mean_production_ready',
    'quality_drawing_evidence_does_not_satisfy_inspection_evidence',
    'packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached',
  ],
  properties: {
    release_bundle_presence_does_not_mean_production_ready: { type: 'string', minLength: 1 },
    quality_drawing_evidence_does_not_satisfy_inspection_evidence: { type: 'string', minLength: 1 },
    packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached: { type: 'string', minLength: 1 },
  },
};

const canonicalPackageStudioBoundarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'checked_in_canonical_packages_are_read_only_docs_packages',
    'tracked_job_artifact_reopen_remains_separate',
  ],
  properties: {
    checked_in_canonical_packages_are_read_only_docs_packages: { type: 'string', minLength: 1 },
    tracked_job_artifact_reopen_remains_separate: { type: 'string', minLength: 1 },
  },
};

const canonicalArtifactCatalogEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'key',
    'label',
    'path_field',
    'path',
    'content_kind',
    'text_preview_allowed',
    'download_allowed',
    'warning_required',
    'warning',
    'path_must_be_repo_relative',
    'optional',
    'available',
    'production_ready',
  ],
  properties: {
    key: { enum: CANONICAL_ARTIFACT_KEYS },
    label: { type: 'string', minLength: 1 },
    path_field: {
      enum: [
        'readme_path',
        'review_pack_path',
        'readiness_report_path',
        'standard_docs_manifest_path',
        'release_manifest_path',
        'release_checksums_path',
        'release_bundle_path',
        'reopen_notes_path',
        'collection_guide_path',
      ],
    },
    path: relativePathSchema,
    content_kind: { enum: CANONICAL_ARTIFACT_CONTENT_KINDS },
    text_preview_allowed: { type: 'boolean' },
    download_allowed: { type: 'boolean' },
    warning_required: { type: 'boolean' },
    warning: nullableString,
    path_must_be_repo_relative: { const: true },
    optional: { type: 'boolean' },
    available: { type: 'boolean' },
    production_ready: nullableBoolean,
  },
};

const canonicalPackageSchema = {
  type: 'object',
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: {
          readiness: {
            type: 'object',
            properties: {
              inspection_evidence_missing: { const: true },
            },
            required: ['inspection_evidence_missing'],
          },
        },
      },
      then: {
        properties: {
          readiness: {
            type: 'object',
            properties: {
              status: { const: 'needs_more_evidence' },
              gate_decision: { const: 'hold_for_evidence_completion' },
              missing_inputs: {
                type: 'array',
                contains: { const: 'inspection_evidence' },
              },
            },
            required: ['status', 'gate_decision', 'missing_inputs'],
          },
          inspection_evidence_path: { type: 'null' },
        },
      },
    },
  ],
  required: [
    'slug',
    'name',
    'package_path',
    'readme_path',
    'readiness',
    'artifacts',
    'artifact_catalog',
    'evidence_boundary',
    'studio_boundary',
    'collection_guide_path',
    'inspection_evidence_path',
  ],
  properties: {
    slug: {
      enum: [
        'quality-pass-bracket',
        'plate-with-holes',
        'motor-mount',
        'controller-housing-eol',
        'hinge-block',
      ],
    },
    name: { type: 'string', minLength: 1 },
    package_path: relativePathSchema,
    readme_path: relativePathSchema,
    readiness: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'score',
        'gate_decision',
        'missing_inputs',
        'inspection_evidence_missing',
        'source_of_truth_path',
      ],
      properties: {
        status: { type: ['string', 'null'] },
        score: { type: ['number', 'null'] },
        gate_decision: { type: ['string', 'null'] },
        missing_inputs: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        inspection_evidence_missing: { type: 'boolean' },
        source_of_truth_path: relativePathSchema,
      },
    },
    artifacts: {
      type: 'object',
      additionalProperties: false,
      required: [
        'review_pack_path',
        'readiness_report_path',
        'standard_docs_manifest_path',
        'release_manifest_path',
        'release_checksums_path',
        'release_bundle_path',
        'reopen_notes_path',
      ],
      properties: {
        review_pack_path: relativePathSchema,
        readiness_report_path: relativePathSchema,
        standard_docs_manifest_path: relativePathSchema,
        release_manifest_path: relativePathSchema,
        release_checksums_path: relativePathSchema,
        release_bundle_path: relativePathSchema,
        reopen_notes_path: relativePathSchema,
      },
    },
    artifact_catalog: {
      type: 'array',
      minItems: CANONICAL_ARTIFACT_KEYS.length,
      maxItems: CANONICAL_ARTIFACT_KEYS.length,
      items: canonicalArtifactCatalogEntrySchema,
    },
    evidence_boundary: canonicalPackageBoundarySchema,
    studio_boundary: canonicalPackageStudioBoundarySchema,
    collection_guide_path: relativePathSchema,
    inspection_evidence_path: relativePathSchema,
  },
};

const canonicalPackagesResponseSchema = {
  $id: 'fcad.canonicalPackagesResponse',
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'ok', 'status', 'service', 'packages'],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    status: { const: 'ok' },
    service: { const: LOCAL_API_SERVICE },
    packages: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: canonicalPackageSchema,
    },
  },
};

const canonicalArtifactPreviewResponseSchema = {
  $id: 'fcad.canonicalArtifactPreviewResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'api_version',
    'ok',
    'slug',
    'artifact_key',
    'path',
    'content_kind',
    'content_type',
    'size_bytes',
    'truncated',
    'content',
    'warnings',
  ],
  properties: {
    api_version: { const: LOCAL_API_VERSION },
    ok: { const: true },
    slug: {
      enum: [
        'quality-pass-bracket',
        'plate-with-holes',
        'motor-mount',
        'controller-housing-eol',
        'hinge-block',
      ],
    },
    artifact_key: { enum: CANONICAL_ARTIFACT_KEYS },
    path: relativePathSchema,
    content_kind: { enum: ['json', 'markdown', 'text', 'manifest', 'checksum'] },
    content_type: {
      enum: [
        'application/json; charset=utf-8',
        'text/markdown; charset=utf-8',
        'text/plain; charset=utf-8',
      ],
    },
    size_bytes: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
    content: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
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
  landing: ajv.compile(landingResponseSchema),
  health: ajv.compile(healthResponseSchema),
  examples: ajv.compile(examplesResponseSchema),
  config_profiles: ajv.compile(configProfilesResponseSchema),
  studio_validate_config: ajv.compile(studioValidateConfigResponseSchema),
  studio_design: ajv.compile(studioDesignResponseSchema),
  studio_model_preview: ajv.compile(studioModelPreviewResponseSchema),
  studio_import_bootstrap: ajv.compile(studioImportBootstrapResponseSchema),
  studio_drawing_preview: ajv.compile(studioDrawingPreviewResponseSchema),
  job: ajv.compile(jobResponseSchema),
  jobs: ajv.compile(jobsResponseSchema),
  artifacts: ajv.compile(artifactsResponseSchema),
  canonical_packages: ajv.compile(canonicalPackagesResponseSchema),
  canonical_artifact_preview: ajv.compile(canonicalArtifactPreviewResponseSchema),
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
