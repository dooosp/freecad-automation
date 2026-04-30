import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { LOCAL_API_SERVICE, LOCAL_API_VERSION } from './local-api-contract.js';
import {
  CANONICAL_ARTIFACT_CONTENT_KINDS,
  CANONICAL_ARTIFACT_KEYS,
} from './canonical-artifact-key-contract.js';
import {
  LOCAL_API_CONFIG_JOB_COMMANDS,
  LOCAL_API_JOB_COMMANDS,
  LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS,
} from '../shared/command-manifest.js';

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
        type: { enum: LOCAL_API_CONFIG_JOB_COMMANDS },
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
        create_quality_path: { type: 'string', minLength: 1 },
        drawing_quality_path: { type: 'string', minLength: 1 },
        drawing_qa_path: { type: 'string', minLength: 1 },
        drawing_intent_path: { type: 'string', minLength: 1 },
        feature_catalog_path: { type: 'string', minLength: 1 },
        dfm_report_path: { type: 'string', minLength: 1 },
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
      required: ['type', 'config_path', 'readiness_report_path'],
      properties: {
        type: { const: 'generate-standard-docs' },
        config_path: { type: 'string', minLength: 1 },
        readiness_report_path: { type: 'string', minLength: 1 },
        options: { type: 'object' },
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
        type: { enum: LOCAL_API_CONFIG_JOB_COMMANDS },
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
        type: { enum: LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS },
        artifact_ref: artifactRefSchema,
        source_job_id: { type: 'string', minLength: 1 },
        source_artifact_id: { type: 'string', minLength: 1 },
        source_artifact_type: { type: 'string', minLength: 1 },
        source_label: { type: 'string', minLength: 1 },
        context_path: { type: 'string', minLength: 1 },
        model_path: { type: 'string', minLength: 1 },
        bom_path: { type: 'string', minLength: 1 },
        inspection_path: { type: 'string', minLength: 1 },
        quality_path: { type: 'string', minLength: 1 },
        create_quality_path: { type: 'string', minLength: 1 },
        drawing_quality_path: { type: 'string', minLength: 1 },
        drawing_qa_path: { type: 'string', minLength: 1 },
        drawing_intent_path: { type: 'string', minLength: 1 },
        feature_catalog_path: { type: 'string', minLength: 1 },
        dfm_report_path: { type: 'string', minLength: 1 },
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
  health: ajv.compile(healthResponseSchema),
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
