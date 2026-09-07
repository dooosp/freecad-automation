// Deterministic execution semantics; canonical parsing/schema stay in config-schema.
import { parseConfigText, validateConfigDocument } from './config-schema.js';

const SUPPORTED_SHAPE_TYPES = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'torus',
  'revolution', 'extrusion', 'loft', 'sweep', 'import',
  'library/ball_bearing', 'library/spur_gear', 'library/stepped_shaft',
  'library/helical_gear', 'library/disc_cam', 'library/pulley',
  'library/coil_spring', 'library/robot_base', 'library/robot_link',
  'library/robot_wrist', 'library/tool_flange',
]);

const SUPPORTED_SINGLE_PART_OPERATION_NAMES = new Set([
  'fuse', 'cut', 'common', 'fillet', 'chamfer', 'shell', 'circular_pattern',
]);

const SUPPORTED_ASSEMBLY_OPERATION_NAMES = new Set([
  'fuse', 'cut', 'common', 'fillet', 'chamfer', 'circular_pattern',
]);

function opName(op = {}) {
  return typeof op.op === 'string' ? op.op : op.type;
}

function validateRotationArray(rotation, label, errors) {
  if (!Array.isArray(rotation) || (rotation.length !== 3 && rotation.length !== 4) || rotation.some(value => !Number.isFinite(value))) {
    errors.push(`${label} rotation must have 3 or 4 numeric elements`);
  }
}

function validateShapeList(shapes, scopeLabel, errors) {
  const shapeIds = new Set();
  if (!Array.isArray(shapes) || shapes.length === 0) {
    errors.push(`${scopeLabel} has no shapes`);
    return shapeIds;
  }

  for (const shape of shapes) {
    const id = shape?.id;
    const type = shape?.type;

    if (!id) {
      errors.push(`${scopeLabel} shape must have a nonempty id`);
    } else if (shapeIds.has(id)) {
      errors.push(`${scopeLabel} has duplicate shape id "${id}"`);
    } else {
      shapeIds.add(id);
    }

    if (!SUPPORTED_SHAPE_TYPES.has(type)) {
      errors.push(`${scopeLabel} shape "${id || '?'}" uses unsupported type "${type}"`);
    }

    if (shape?.rotation !== undefined) {
      validateRotationArray(shape.rotation, `${scopeLabel} shape "${id || '?'}"`, errors);
    }
  }

  return shapeIds;
}

function validateOperationList(operations, availableIds, scopeLabel, errors, supportedOps) {
  if (!Array.isArray(operations)) return;

  for (const operation of operations) {
    const op = opName(operation);
    if (!op) {
      errors.push(`${scopeLabel} operation is missing canonical "op" field`);
      continue;
    }
    if (!supportedOps.has(op)) {
      errors.push(`${scopeLabel} operation "${op}" is not supported`);
      continue;
    }

    if (['fuse', 'cut', 'common'].includes(op)) {
      if (typeof operation.base !== 'string' || !availableIds.has(operation.base)) {
        errors.push(`${scopeLabel} operation "${op}" references unknown base "${operation.base}"`);
      }
      if (operation.tool && typeof operation.tool === 'object') {
        const inlineShape = { ...operation.tool, id: operation.tool.id || 'inline_tool' };
        const inlineValidation = validateConfigDocument({ name: 'inline_tool', shapes: [inlineShape] });
        errors.push(...inlineValidation.summary.errors);
        validateShapeList([inlineShape], scopeLabel, errors);
      } else if (typeof operation.tool !== 'string' || !availableIds.has(operation.tool)) {
        errors.push(`${scopeLabel} operation "${op}" references unknown tool "${operation.tool}"`);
      }
      if (typeof operation.result === 'string') availableIds.add(operation.result);
    } else if (['fillet', 'chamfer', 'shell', 'circular_pattern'].includes(op)) {
      if (typeof operation.target !== 'string' || !availableIds.has(operation.target)) {
        errors.push(`${scopeLabel} operation "${op}" references unknown target "${operation.target}"`);
      }
      if (typeof operation.result === 'string') availableIds.add(operation.result);
    }
  }
}

export function validateCadToml(tomlStr) {
  const errors = [];

  let config;
  try {
    config = parseConfigText(tomlStr).parsed;
    const validation = validateConfigDocument(config);
    if (!validation.valid) return { valid: false, errors: validation.summary.errors, config };
  } catch (err) {
    return { valid: false, errors: [`TOML parse error: ${err.message}`], config: null };
  }

  if (!config.name) errors.push('Config must have a nonempty name');

  const hasSinglePart = Array.isArray(config.shapes) && config.shapes.length > 0;
  const parts = Array.isArray(config.parts) ? config.parts : [];
  const hasAssemblyParts = parts.length > 0;
  const hasAssemblySection = !!config.assembly;

  if (!hasSinglePart && !hasAssemblyParts) {
    errors.push('Config must define either top-level [[shapes]] or [[parts]]');
  }
  if (hasSinglePart && hasAssemblyParts) {
    errors.push('Config mixes single-part [[shapes]] with assembly [[parts]]');
  }
  if (hasAssemblyParts !== hasAssemblySection) {
    errors.push('Assembly mode requires both top-level [[parts]] and [assembly]');
  }

  if (hasSinglePart) {
    const shapeIds = validateShapeList(config.shapes, 'Config', errors);
    validateOperationList(
      config.operations,
      shapeIds,
      'Config',
      errors,
      SUPPORTED_SINGLE_PART_OPERATION_NAMES,
    );
    if (config.final !== undefined && !shapeIds.has(config.final)) {
      errors.push(`Config final "${config.final}" does not match any known shape/result id`);
    }
  }

  const partIds = new Set();
  for (const p of parts) {
    if (!p.id) {
      errors.push('Part missing "id" field');
      continue;
    }
    if (partIds.has(p.id)) {
      errors.push(`Duplicate part id "${p.id}"`);
      continue;
    }
    partIds.add(p.id);

    const shapeIds = validateShapeList(p.shapes, `Part "${p.id}"`, errors);
    validateOperationList(
      p.operations,
      shapeIds,
      `Part "${p.id}"`,
      errors,
      SUPPORTED_ASSEMBLY_OPERATION_NAMES,
    );
    if (p.final !== undefined && !shapeIds.has(p.final)) {
      errors.push(`Part "${p.id}" final "${p.final}" does not match any known shape/result id`);
    }
  }

  const assembly = config.assembly;
  if (assembly) {
    const asmParts = assembly.parts || [];
    if (asmParts.length === 0) errors.push('Assembly has no parts');
    for (const ap of asmParts) {
      if (!ap.ref) errors.push('Assembly part missing "ref"');
      if (ap.ref && !partIds.has(ap.ref)) errors.push(`Assembly references unknown part "${ap.ref}"`);
    }
    if (assembly.joints !== undefined && !Array.isArray(assembly.joints)) {
      errors.push('Assembly joints must be an array');
    }
    for (const joint of Array.isArray(assembly.joints) ? assembly.joints : []) {
      if (!joint.id) errors.push('Assembly joint missing "id"');
      if (!joint.part) errors.push(`Assembly joint "${joint.id || '?'}" missing "part"`);
      if (joint.part && !partIds.has(joint.part)) {
        errors.push(`Assembly joint "${joint.id || '?'}" references unknown part "${joint.part}"`);
      }
      if (!Array.isArray(joint.axis) || joint.axis.length !== 3 || joint.axis.some(value => !Number.isFinite(value))) {
        errors.push(`Assembly joint "${joint.id || '?'}" must define 3-element axis`);
      }
      if (!Array.isArray(joint.anchor) || joint.anchor.length !== 3 || joint.anchor.some(value => !Number.isFinite(value))) {
        errors.push(`Assembly joint "${joint.id || '?'}" must define 3-element anchor`);
      }
    }
    if (assembly.couplings !== undefined && !Array.isArray(assembly.couplings)) {
      errors.push('Assembly couplings must be an array');
    }
    for (const coupling of Array.isArray(assembly.couplings) ? assembly.couplings : []) {
      if (!coupling.type) errors.push('Assembly coupling missing "type"');
      if (!coupling.driver) errors.push(`Assembly coupling "${coupling.type || '?'}" missing "driver"`);
      if (!coupling.follower) errors.push(`Assembly coupling "${coupling.type || '?'}" missing "follower"`);
    }
  }

  return { valid: errors.length === 0, errors, config };
}
