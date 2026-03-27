export const CANONICAL_CONFIG_SCHEMA_ID = 'https://freecad-automation.dev/schemas/config-v1.json';

const numberSchema = { type: 'number' };
const integerSchema = { type: 'integer' };
const stringSchema = { type: 'string' };
const booleanSchema = { type: 'boolean' };
const nullableNumberSchema = { type: ['number', 'null'] };
const nullableStringSchema = { type: ['string', 'null'] };
const nullableBooleanSchema = { type: ['boolean', 'null'] };

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

const drawingMetaSchema = objectSchema({
  part_name: stringSchema,
  material: stringSchema,
  units: stringSchema,
  tolerance_grade: stringSchema,
  tolerance: stringSchema,
  surface_roughness_default: stringSchema,
  drawing_no: stringSchema,
  designed_by: stringSchema,
});

const drawingStyleSchema = objectSchema({
  show_hidden: booleanSchema,
  show_centerlines: booleanSchema,
  show_dimensions: booleanSchema,
});

const drawingSurfaceFinishFaceSchema = objectSchema({
  location: vector2Schema,
  value: stringSchema,
  view: stringSchema,
  a: stringSchema,
  c: stringSchema,
  d: stringSchema,
  e: stringSchema,
});

const drawingDatumSchema = objectSchema({
  name: stringSchema,
  kind: stringSchema,
  selector: stringSchema,
  reason: stringSchema,
});

const drawingKeyDimensionSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  feature: stringSchema,
  view: stringSchema,
  style: stringSchema,
  reason: stringSchema,
});

const drawingThreadSchema = objectSchema({
  diameter: numberSchema,
  pitch: numberSchema,
  label: stringSchema,
  hole_id: stringSchema,
});

const drawingRevisionSchema = objectSchema({
  rev: stringSchema,
  date: stringSchema,
  description: stringSchema,
  by: stringSchema,
});

const drawingFeatureToleranceSchema = objectSchema({
  feature_id: stringSchema,
  value: numberSchema,
  value_mm: numberSchema,
  tolerance_grade: stringSchema,
  tolerance: stringSchema,
  fit: stringSchema,
  surface_finish: stringSchema,
});

const drawingSchema = objectSchema({
  units: stringSchema,
  title: stringSchema,
  scale: {
    anyOf: [stringSchema, numberSchema],
  },
  views: stringArraySchema,
  meta: drawingMetaSchema,
  style: drawingStyleSchema,
  dimension_style: objectSchema({
    type: stringSchema,
  }),
  section: objectSchema({
    plane: stringSchema,
    offset: numberSchema,
  }),
  ks_standard: objectSchema({
    fit_class: stringSchema,
    general_tolerance: stringSchema,
  }),
  surface_finish: objectSchema({
    default: stringSchema,
    machining: stringSchema,
    faces: {
      type: 'array',
      items: drawingSurfaceFinishFaceSchema,
    },
  }),
  chamfer: objectSchema({
    format: stringSchema,
    show: booleanSchema,
  }),
  tolerances: objectSchema({
    general: stringSchema,
    holes: stringSchema,
    shafts: stringSchema,
  }),
  gdt: objectSchema({
    mode: stringSchema,
  }),
  notes: objectSchema({
    general: stringArraySchema,
    placement: stringSchema,
  }, {
    additionalProperties: {
      anyOf: [stringSchema, stringArraySchema],
    },
  }),
  datums: {
    type: 'array',
    items: drawingDatumSchema,
  },
  key_dims: {
    type: 'array',
    items: drawingKeyDimensionSchema,
  },
  threads: {
    type: 'array',
    items: drawingThreadSchema,
  },
  thread_specs: {
    type: 'array',
    items: drawingThreadSchema,
  },
  revisions: {
    type: 'array',
    items: drawingRevisionSchema,
  },
  feature_tolerances: {
    type: 'array',
    items: drawingFeatureToleranceSchema,
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

const standardsSchema = objectSchema({
  profile: stringSchema,
  default_standard: stringSchema,
  document_note: stringSchema,
  standards_reference: stringArraySchema,
});

const productionSchema = objectSchema({
  sites: stringArraySchema,
  annual_volume: numberSchema,
  target_ct_sec: numberSchema,
  automation_mode: stringSchema,
  pilot_lot: numberSchema,
  automation_candidates: stringArraySchema,
});

const qualitySchema = objectSchema({
  traceability: objectSchema({
    serial_level: stringSchema,
    record_linkage: stringSchema,
    label_strategy: stringSchema,
    label_area: stringSchema,
    retention_note: stringSchema,
  }),
  critical_dimensions: {
    type: 'array',
    items: objectSchema({
      id: stringSchema,
      name: stringSchema,
      feature: stringSchema,
      target_mm: numberSchema,
      nominal_mm: numberSchema,
      value_mm: numberSchema,
      tolerance: stringSchema,
      tolerance_grade: stringSchema,
      spec: stringSchema,
      rationale: stringSchema,
      reason: stringSchema,
    }),
  },
  gates: {
    type: 'array',
    items: objectSchema({
      gate_id: stringSchema,
      name: stringSchema,
      stage: stringSchema,
      objective: stringSchema,
      check: stringSchema,
      evidence: stringArraySchema,
    }),
  },
  functional_test_points: {
    type: 'array',
    items: objectSchema({
      id: stringSchema,
      name: stringSchema,
      check: stringSchema,
      objective: stringSchema,
      location: stringSchema,
      location_hint: stringSchema,
      area: stringSchema,
      rationale: stringSchema,
      reason: stringSchema,
    }),
  },
});

const drawingPlanPlacementSchema = objectSchema({
  side: stringSchema,
  angle_deg: numberSchema,
  offset_mm: numberSchema,
});

const drawingPlanDimensionIntentSchema = objectSchema({
  id: stringSchema,
  feature: stringSchema,
  view: stringSchema,
  style: stringSchema,
  required: booleanSchema,
  priority: integerSchema,
  reason: stringSchema,
  placement: drawingPlanPlacementSchema,
  value_mm: nullableNumberSchema,
  confidence: nullableStringSchema,
  source: nullableStringSchema,
  review: nullableBooleanSchema,
  process_step: stringSchema,
  tolerance_grade: stringSchema,
});

const drawingPlanSchema = objectSchema({
  schema_version: stringSchema,
  part_type: stringSchema,
  profile: stringSchema,
  views: objectSchema({
    enabled: stringArraySchema,
    layout: stringSchema,
    options: objectSchema({}, { additionalProperties: drawingStyleSchema }),
  }),
  datums: {
    type: 'array',
    items: drawingDatumSchema,
  },
  dimensioning: objectSchema({
    scheme: stringSchema,
    baseline_datum: stringSchema,
    avoid_redundant: booleanSchema,
    auto_plan_dedupe: stringSchema,
    redundancy_tol_mm: numberSchema,
    qa_weight_preset: stringSchema,
    required_only: booleanSchema,
  }),
  dim_intents: {
    type: 'array',
    items: drawingPlanDimensionIntentSchema,
  },
  style: objectSchema({
    stroke_profile: stringSchema,
    dim_offset: numberSchema,
  }),
  process: objectSchema({
    sequence: stringArraySchema,
  }),
  notes: objectSchema({
    general: stringArraySchema,
    placement: stringSchema,
  }, {
    additionalProperties: {
      anyOf: [stringSchema, stringArraySchema],
    },
  }),
  scale: objectSchema({
    mode: stringSchema,
    min: numberSchema,
    max: numberSchema,
  }),
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
    standards: standardsSchema,
    manufacturing: objectSchema({
      process: stringSchema,
      material: stringSchema,
      batch_size: numberSchema,
    }),
    production: productionSchema,
    quality: qualitySchema,
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
    drawing_plan: drawingPlanSchema,
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
