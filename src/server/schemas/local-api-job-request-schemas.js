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

const compareRevisionCompanionPathProperties = {
  baseline_readiness_path: { type: 'string', minLength: 1 },
  candidate_readiness_path: { type: 'string', minLength: 1 },
  baseline_config_path: { type: 'string', minLength: 1 },
  candidate_config_path: { type: 'string', minLength: 1 },
  baseline_evidence_envelope_path: { type: 'string', minLength: 1 },
  candidate_evidence_envelope_path: { type: 'string', minLength: 1 },
  baseline_evidence_receipt_path: { type: 'string', minLength: 1 },
  candidate_evidence_receipt_path: { type: 'string', minLength: 1 },
};

export const localApiJobRequestSchema = {
  $id: 'fcad.jobRequest',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'review_pack_path', 'scope'],
      properties: {
        type: { const: 'inspection-plan' },
        review_pack_path: { type: 'string', minLength: 1 },
        revision_impact_path: { type: 'string', minLength: 1 },
        readiness_report_path: { type: 'string', minLength: 1 },
        config_path: { type: 'string', minLength: 1 },
        requirements_path: { type: 'string', minLength: 1 },
        scope: { enum: ['full', 'delta'] },
        options: {
          type: 'object',
          properties: {
            proof_lineage: { const: true },
          },
        },
      },
      allOf: [
        {
          if: {
            required: ['options'],
            properties: {
              options: { required: ['proof_lineage'] },
            },
          },
          then: { required: ['config_path'] },
        },
      ],
    },
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
        config_path: { type: 'string', minLength: 1 },
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
        options: {
          type: 'object',
          properties: {
            proof_lineage: { const: true },
          },
        },
      },
      anyOf: [
        { required: ['context_path'] },
        { required: ['model_path'] },
      ],
      allOf: [
        {
          if: {
            required: ['options'],
            properties: {
              options: { required: ['proof_lineage'] },
            },
          },
          then: { required: ['config_path'] },
        },
        {
          if: { required: ['config_path'] },
          then: {
            required: ['options'],
            properties: {
              options: { required: ['proof_lineage'] },
            },
          },
        },
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
        ...compareRevisionCompanionPathProperties,
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
        options: {
          type: 'object',
          properties: {
            proof_lineage: { const: true },
          },
        },
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
        options: {
          type: 'object',
          properties: {
            proof_lineage: { const: true },
          },
        },
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
        options: {
          type: 'object',
          properties: {
            proof_lineage: { const: true },
          },
        },
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
  allOf: [
    {
      if: {
        required: ['type'],
        properties: {
          type: {
            not: {
              enum: ['review-context', 'readiness-pack', 'generate-standard-docs', 'inspection-plan', 'pack'],
            },
          },
        },
      },
      then: {
        properties: {
          options: {
            not: { required: ['proof_lineage'] },
          },
        },
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
        ...compareRevisionCompanionPathProperties,
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
  allOf: [
    {
      if: {
        required: ['options'],
        properties: {
          options: { required: ['proof_lineage'] },
        },
      },
      then: {
        properties: {
          type: { enum: ['review-context', 'readiness-pack', 'generate-standard-docs', 'inspection-plan', 'pack'] },
          options: {
            properties: {
              proof_lineage: { const: true },
            },
          },
        },
      },
    },
  ],
};
