import {
  LOCAL_API_CONFIG_JOB_COMMANDS,
  LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS,
} from '../../shared/command-manifest.js';

const artifactRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['job_id', 'artifact_id'],
  properties: {
    job_id: { type: 'string', minLength: 1, maxLength: 128 },
    artifact_id: { type: 'string', minLength: 1, maxLength: 128 },
  },
};

export const localApiJobRequestSchema = {
  $id: 'fcad.jobRequest',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'inspect' },
        file_path: { type: 'string', minLength: 1 },
        artifact_ref: artifactRefSchema,
        options: { type: 'object' },
      },
      oneOf: [
        { required: ['file_path'] },
        { required: ['artifact_ref'] },
      ],
      not: {
        required: ['file_path', 'artifact_ref'],
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
      required: ['type', 'package_id', 'review_pack_path', 'readiness_report_path'],
      properties: {
        type: { const: 'evidence-graph' },
        package_id: { type: 'string', minLength: 1 },
        review_pack_path: { type: 'string', minLength: 1 },
        readiness_report_path: { type: 'string', minLength: 1 },
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
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'evidence-readiness-audit' },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'inspection-evidence-intake' },
        options: { type: 'object' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'inspection-evidence-promotion-dry-run' },
        intake_report_path: { type: 'string', minLength: 1 },
        intake_report_artifact_ref: artifactRefSchema,
        options: { type: 'object' },
      },
      oneOf: [
        { required: ['intake_report_path'] },
        { required: ['intake_report_artifact_ref'] },
      ],
      not: {
        required: ['intake_report_path', 'intake_report_artifact_ref'],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'stage5b-evidence-audit' },
        options: { type: 'object' },
      },
    },
  ],
};

export const publicJobRequestSchema = {
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
        package_id: { type: 'string', minLength: 1 },
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
