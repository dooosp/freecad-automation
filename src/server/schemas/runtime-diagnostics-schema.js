const nullableString = {
  type: ['string', 'null'],
};

const nullableBoolean = {
  type: ['boolean', 'null'],
};

export const runtimeDiagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'diagnostics_version',
    'artifact_class',
    'inspection_evidence_status',
    'readiness_effect',
    'hard_evidence_rule',
    'status',
    'available',
    'executable_detected',
    'probe_status',
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
    artifact_class: { const: 'runtime_diagnostics' },
    inspection_evidence_status: { const: 'not_inspection_evidence' },
    readiness_effect: { const: 'no_readiness_change' },
    hard_evidence_rule: { type: 'string', minLength: 1 },
    status: { enum: ['ready', 'runtime_not_detected', 'runtime_probe_failed'] },
    available: { type: 'boolean' },
    executable_detected: { type: 'boolean' },
    probe_status: { enum: ['usable', 'not_detected', 'failed'] },
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
