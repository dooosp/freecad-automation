import { readFileSync } from 'node:fs';

import Ajv from 'ajv';

export const C_ARTIFACT_SCHEMA_VERSION = '1.0';
export const C_CONTRACT_VERSION = 'c2';

const SCHEMA_SPECS = [
  {
    kind: 'c_artifact_common',
    file: new URL('../schemas/c_artifact_common.schema.json', import.meta.url),
  },
  {
    kind: 'product_review',
    file: new URL('../schemas/product_review.schema.json', import.meta.url),
  },
  {
    kind: 'line_plan',
    file: new URL('../schemas/line_plan.schema.json', import.meta.url),
  },
  {
    kind: 'investment_review',
    file: new URL('../schemas/investment_review.schema.json', import.meta.url),
  },
  {
    kind: 'process_plan',
    file: new URL('../schemas/process_plan.schema.json', import.meta.url),
  },
  {
    kind: 'quality_risk',
    file: new URL('../schemas/quality_risk.schema.json', import.meta.url),
  },
  {
    kind: 'quality_risk_pack',
    file: new URL('../schemas/quality_risk_pack.schema.json', import.meta.url),
  },
  {
    kind: 'readiness_report',
    file: new URL('../schemas/readiness_report.schema.json', import.meta.url),
  },
  {
    kind: 'stabilization_review',
    file: new URL('../schemas/stabilization_review.schema.json', import.meta.url),
  },
  {
    kind: 'docs_manifest',
    file: new URL('../schemas/docs_manifest.schema.json', import.meta.url),
  },
  {
    kind: 'standard_docs_manifest',
    file: new URL('../schemas/standard_docs_manifest.schema.json', import.meta.url),
  },
  {
    kind: 'release_bundle_manifest',
    file: new URL('../schemas/release_bundle_manifest.schema.json', import.meta.url),
  },
];

const ajv = new Ajv({
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
    .filter(([kind]) => kind !== 'c_artifact_common')
    .map(([kind, schema]) => [kind, ajv.getSchema(schema.$id) || ajv.compile(schema)])
);

const C_COMMAND_CONTRACTS = Object.freeze({
  'process-plan': {
    layer: 'C',
    command: 'process-plan',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'process_plan',
    primary_output: 'process_plan.json',
    required_inputs: ['review_pack'],
    optional_inputs: ['config'],
    derived_outputs: [],
    notes: [
      'Process-plan JSON is the machine-readable source of truth for this downstream C output.',
      'Canonical C2 process planning consumes review-pack priorities and recommended actions rather than re-implementing D scoring, linkage, or geometry logic.',
    ],
  },
  'quality-risk': {
    layer: 'C',
    command: 'quality-risk',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'quality_risk',
    primary_output: 'quality_risk.json',
    required_inputs: ['review_pack'],
    optional_inputs: ['config'],
    derived_outputs: [],
    notes: [
      'Quality-risk JSON remains a downstream readiness artifact and should propagate upstream evidence metadata when available.',
      'Canonical C2 quality-risk assembly consumes D linkage and review-priority outputs instead of recreating them.',
    ],
  },
  'readiness-report': {
    layer: 'C',
    command: 'readiness-report',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'readiness_report',
    primary_output: 'readiness_report.json',
    required_inputs: ['review_pack'],
    optional_inputs: ['config', 'process_plan', 'quality_risk'],
    derived_outputs: ['readiness_markdown', 'docs_manifest', 'release_bundle_manifest'],
    notes: [
      'readiness_report.json is the canonical C artifact.',
      'Markdown, checklists, and release packaging must derive from canonical JSON rather than becoming the source of truth.',
      'Canonical C2 readiness assembly packages D review-pack evidence plus C outputs without recomputing D decision logic.',
    ],
  },
  'stabilization-review': {
    layer: 'C',
    command: 'stabilization-review',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'stabilization_review',
    primary_output: 'stabilization_review.json',
    required_inputs: ['baseline_readiness_report', 'candidate_readiness_report'],
    optional_inputs: ['baseline_review_pack', 'candidate_review_pack', 'runtime', 'config'],
    derived_outputs: [],
    notes: [
      'Stabilization-review JSON is a downstream launch-readiness artifact and must not re-implement D decisions.',
      'Canonical C2 stabilization review compares readiness artifacts across revisions or releases and explains the reasons for change.',
    ],
  },
  'generate-standard-docs': {
    layer: 'C',
    command: 'generate-standard-docs',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'docs_manifest',
    primary_output: 'standard_docs_manifest.json',
    required_inputs: ['config'],
    optional_inputs: ['runtime', 'readiness_report', 'review_pack'],
    derived_outputs: [
      'process_flow.md',
      'control_plan_draft.csv',
      'inspection_checksheet_draft.csv',
      'work_instruction_draft.md',
      'pfmea_seed.csv',
    ],
    notes: [
      'The docs manifest JSON inventories user-facing drafts derived from canonical readiness JSON.',
    ],
  },
  pack: {
    layer: 'C',
    command: 'pack',
    contract_version: C_CONTRACT_VERSION,
    canonical_artifact_kind: 'release_bundle_manifest',
    primary_output: 'release_bundle_manifest.json',
    required_inputs: ['readiness_report'],
    optional_inputs: ['docs_manifest', 'stabilization_review', 'review_pack'],
    derived_outputs: ['release_bundle'],
    notes: [
      'The release-bundle manifest packages canonical C outputs without replacing canonical JSON as the source of truth.',
    ],
  },
});

function normalizeInstancePath(error) {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    const separator = basePath.endsWith('/') ? '' : '/';
    return `${basePath}${separator}${error.params.missingProperty}`.replace(/\/+/g, '/');
  }
  return basePath;
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${normalizeInstancePath(error)} ${error.message}`.trim());
}

export class CArtifactSchemaValidationError extends Error {
  constructor(kind, errors, options = {}) {
    const contextLabel = options.command ? ` for ${options.command}` : '';
    const pathLabel = options.path ? ` (${options.path})` : '';
    super(`Schema validation failed for ${kind}${contextLabel}${pathLabel}: ${errors.join(' | ')}`);
    this.name = 'CArtifactSchemaValidationError';
    this.kind = kind;
    this.errors = errors;
    this.command = options.command || null;
    this.path = options.path || null;
  }
}

export function getCCommandContract(command) {
  const contract = C_COMMAND_CONTRACTS[command];
  return contract ? JSON.parse(JSON.stringify(contract)) : null;
}

export function validateCArtifact(kind, artifact) {
  const validator = validatorsByKind.get(kind);
  if (!validator) {
    throw new Error(`Unknown C artifact schema kind: ${kind}`);
  }

  const valid = validator(artifact);
  return {
    ok: valid === true,
    errors: valid ? [] : formatSchemaErrors(validator.errors || []),
  };
}

export function assertValidCArtifact(kind, artifact, options = {}) {
  const validation = validateCArtifact(kind, artifact);
  if (!validation.ok) {
    throw new CArtifactSchemaValidationError(kind, validation.errors, options);
  }
  return artifact;
}
