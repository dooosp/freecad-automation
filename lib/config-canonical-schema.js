export const CANONICAL_CONFIG_SCHEMA_ID = 'https://freecad-automation.dev/schemas/config-v1.json';

const numberSchema = { type: 'number' };
const integerSchema = { type: 'integer' };
const stringSchema = { type: 'string' };
const booleanSchema = { type: 'boolean' };

const vector2Schema = {
  type: 'array',
  items: numberSchema,
  minItems: 2,
  maxItems: 2,
};

const vector3Schema = {
  type: 'array',
  items: numberSchema,
  minItems: 3,
  maxItems: 3,
};

const stringArraySchema = {
  type: 'array',
  items: stringSchema,
};

const objectSchema = (properties = {}, options = {}) => ({
  type: 'object',
  properties,
  additionalProperties: options.additionalProperties ?? true,
  ...(options.required ? { required: options.required } : {}),
});

const shapeSchema = objectSchema({
  id: stringSchema,
  type: stringSchema,
  position: vector3Schema,
  axis: vector3Schema,
  center: vector3Schema,
  direction: vector3Schema,
  axis_point: vector3Schema,
  radius: numberSchema,
  length: numberSchema,
  width: numberSchema,
  height: numberSchema,
  material: stringSchema,
  profile_start: vector2Schema,
}, { required: ['id', 'type'] });

const operationSchema = objectSchema({
  op: stringSchema,
  type: stringSchema,
  base: stringSchema,
  tool: {
    anyOf: [
      stringSchema,
      objectSchema(),
    ],
  },
  target: stringSchema,
  result: stringSchema,
  radius: numberSchema,
  size: numberSchema,
  thickness: numberSchema,
  faces: {
    type: 'array',
    items: {
      anyOf: [integerSchema, stringSchema],
    },
  },
  edges: {
    type: 'array',
    items: {
      anyOf: [integerSchema, stringSchema],
    },
  },
  axis: vector3Schema,
  center: vector3Schema,
  count: integerSchema,
  angle: numberSchema,
  include_original: booleanSchema,
}, {
  allOf: undefined,
});

operationSchema.anyOf = [
  { required: ['op'] },
  { required: ['type'] },
];

const exportSchema = objectSchema({
  directory: stringSchema,
  formats: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['step', 'stl', 'brep', 'dxf', 'svg', 'pdf'],
    },
    uniqueItems: true,
  },
  per_part_stl: booleanSchema,
  step: booleanSchema,
  stl: booleanSchema,
  brep: booleanSchema,
  dxf: booleanSchema,
  svg: booleanSchema,
  pdf: booleanSchema,
});

const drawingSchema = objectSchema({
  units: stringSchema,
  title: stringSchema,
  scale: {
    anyOf: [stringSchema, numberSchema],
  },
  views: stringArraySchema,
  meta: objectSchema({
    part_name: stringSchema,
    material: stringSchema,
    units: stringSchema,
    tolerance_grade: stringSchema,
    tolerance: stringSchema,
    surface_roughness_default: stringSchema,
    drawing_no: stringSchema,
  }),
  style: objectSchema(),
  dimension_style: objectSchema(),
  ks_standard: objectSchema(),
  surface_finish: objectSchema(),
  chamfer: objectSchema(),
  tolerances: objectSchema(),
  gdt: objectSchema(),
  notes: objectSchema(),
  threads: {
    type: 'array',
    items: objectSchema(),
  },
  thread_specs: {
    type: 'array',
    items: objectSchema(),
  },
  revisions: {
    type: 'array',
    items: objectSchema(),
  },
  feature_tolerances: {
    type: 'array',
    items: objectSchema(),
  },
});

const femSchema = objectSchema({
  analysis_type: stringSchema,
  num_modes: integerSchema,
  material: objectSchema(),
  mesh: objectSchema(),
  constraints: {
    type: 'array',
    items: objectSchema({
      type: stringSchema,
      faces: {
        type: 'array',
        items: {
          anyOf: [integerSchema, stringSchema],
        },
      },
      magnitude: numberSchema,
      direction: vector3Schema,
    }),
  },
});

const toleranceSchema = objectSchema({
  monte_carlo: booleanSchema,
  mc_samples: integerSchema,
  pairs: {
    type: 'array',
    items: objectSchema(),
  },
  fits: {
    type: 'array',
    items: objectSchema(),
  },
});

const partSchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  name: stringSchema,
  final: stringSchema,
  process: stringSchema,
  material: stringSchema,
  position: vector3Schema,
  rotation: vector3Schema,
  shapes: {
    type: 'array',
    items: shapeSchema,
  },
  operations: {
    type: 'array',
    items: operationSchema,
  },
  export: exportSchema,
}, { required: ['id'] });

const assemblySchema = objectSchema({
  parts: {
    type: 'array',
    items: objectSchema({
      ref: stringSchema,
      label: stringSchema,
      position: vector3Schema,
      rotation: vector3Schema,
      children: {
        type: 'array',
        items: objectSchema(),
      },
    }, { required: ['ref'] }),
  },
  mates: {
    type: 'array',
    items: objectSchema(),
  },
});

export const configV1Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: CANONICAL_CONFIG_SCHEMA_ID,
  title: 'freecad-automation config v1',
  type: 'object',
  additionalProperties: true,
  properties: {
    config_version: {
      type: 'integer',
      enum: [1],
      default: 1,
    },
    name: stringSchema,
    final: stringSchema,
    standard: stringSchema,
    material: stringSchema,
    process: stringSchema,
    batch_size: numberSchema,
    product: objectSchema(),
    standards: objectSchema({
      profile: stringSchema,
    }),
    manufacturing: objectSchema({
      process: stringSchema,
      material: stringSchema,
      batch_size: numberSchema,
    }),
    production: objectSchema(),
    quality: objectSchema(),
    shapes: {
      type: 'array',
      items: shapeSchema,
    },
    operations: {
      type: 'array',
      items: operationSchema,
    },
    parts: {
      type: 'array',
      items: partSchema,
    },
    assembly: assemblySchema,
    drawing: drawingSchema,
    drawing_plan: objectSchema(),
    fem: femSchema,
    tolerance: toleranceSchema,
    export: exportSchema,
    import: objectSchema({
      source_step: stringSchema,
      template_only: booleanSchema,
    }),
    bom: {
      type: 'array',
      items: objectSchema(),
    },
    exceptions: objectSchema(),
    part: objectSchema(),
  },
};

export const SUPPORTED_CONFIG_FIELD_GROUPS = [
  {
    field: 'config_version',
    description: 'Explicit user-facing schema version. Version 1 is the current canonical form.',
  },
  {
    field: 'name, final, shapes, operations',
    description: 'Core single-part modeling fields used by create/draw/report workflows.',
  },
  {
    field: 'parts, assembly',
    description: 'Assembly modeling fields for tolerance and multi-part workflows.',
  },
  {
    field: 'manufacturing, standards, product, production, quality, batch_size',
    description: 'Production-engineering and planning context used by DFM, cost, readiness, and rule-profile selection.',
  },
  {
    field: 'drawing, drawing_plan',
    description: 'Drawing metadata, views, style, notes, and compiled plan inputs.',
  },
  {
    field: 'fem, tolerance',
    description: 'Analysis-specific sections for FEM and tolerance workflows.',
  },
  {
    field: 'export, import',
    description: 'Artifact output/input controls. Legacy export booleans are still migrated.',
  },
];
