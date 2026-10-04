import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';
import { validateConfigDocument } from '../../lib/config-schema.js';
import { patchTomlNumericValues } from './toml-numeric-spans.js';

const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const digest = (source) => createHash('sha256').update(source).digest('hex');
const requireMatch = (condition) => { if (!condition) throw new Error('Unsupported model parameter profile.'); };
const at = (value, path) => path.reduce((entry, key) => entry[key], value);
const put = (value, path, number) => { at(value, path.slice(0, -1))[path.at(-1)] = number; };
const emptyOrAbsent = (value) => value == null || (Array.isArray(value) && value.length === 0);
const REQUIRED_DIMENSION_KEYS = new Set(['id', 'feature', 'label', 'dimension_type', 'value_mm', 'required', 'view', 'reason']);
const PLANNED_DIMENSION_KEYS = new Set(['id', 'feature', 'view', 'style', 'required', 'priority', 'value_mm', 'reason', 'source', 'placement_side', 'placement_offset_mm']);
const CRITICAL_DIMENSION_KEYS = new Set(['id', 'name', 'feature', 'target_mm', 'tolerance', 'rationale']);

function knownDeclaration(row, allowedKeys) {
  // A second nominal/target alias could remain stale in downstream consumers.
  requireMatch(plain(row) && Object.keys(row).every((key) => allowedKeys.has(key)));
}

function indexedRows(rows, ids) {
  requireMatch(Array.isArray(rows) && rows.length === ids.length);
  const result = new Map(rows.map((row, index) => [row?.id, { row, index }]));
  requireMatch(result.size === ids.length && ids.every((id) => result.has(id)));
  return result;
}

function shapeMatches(shape, fixed, variableKeys = []) {
  requireMatch(plain(shape));
  requireMatch(isDeepStrictEqual(Object.keys(shape).sort(), [...Object.keys(fixed), ...variableKeys].sort()));
  for (const [key, value] of Object.entries(fixed)) requireMatch(isDeepStrictEqual(shape[key], value));
  for (const key of variableKeys) requireMatch(finite(shape[key]) && shape[key] > 0);
}

function declarations(config, ids, features, values) {
  const required = indexedRows(config.drawing_intent?.required_dimensions, ids);
  const planned = indexedRows(config.drawing_plan?.dim_intents, ids);
  return ids.map((id, index) => {
    const requirement = required.get(id);
    const intent = planned.get(id);
    knownDeclaration(requirement.row, REQUIRED_DIMENSION_KEYS);
    knownDeclaration(intent.row, PLANNED_DIMENSION_KEYS);
    requireMatch(requirement.row.feature === features[index] && requirement.row.dimension_type === 'diameter'
      && requirement.row.required === true && requirement.row.value_mm === values[index]);
    requireMatch(intent.row.feature === features[index] && intent.row.style === 'diameter'
      && intent.row.required === true && intent.row.value_mm === values[index]);
    return [
      ['drawing_intent', 'required_dimensions', requirement.index, 'value_mm'],
      ['drawing_plan', 'dim_intents', intent.index, 'value_mm'],
    ];
  });
}

function field(id, value, minimum, maximum, targets) {
  requireMatch(finite(value) && finite(minimum) && value > minimum && (maximum === null || (finite(maximum) && value < maximum)));
  return { id, value_mm: value, unit: 'mm', min_exclusive: minimum, max_exclusive: maximum, targets };
}

function bracketProfile(config) {
  const shapes = indexedRows(config.shapes, ['plate', 'hole_left', 'hole_right']);
  const plate = shapes.get('plate');
  const left = shapes.get('hole_left');
  const right = shapes.get('hole_right');
  shapeMatches(plate.row, { id: 'plate', type: 'box' }, ['length', 'width', 'height']);
  shapeMatches(left.row, { id: 'hole_left', type: 'cylinder', position: [30, 30, -2] }, ['radius', 'height']);
  shapeMatches(right.row, { id: 'hole_right', type: 'cylinder', position: [125, 70, -2] }, ['radius', 'height']);
  requireMatch(left.row.height === plate.row.height + 4 && right.row.height === plate.row.height + 4);
  requireMatch(isDeepStrictEqual(config.operations, [
    { op: 'cut', base: 'plate', tool: 'hole_left', result: 'body' },
    { op: 'cut', base: 'body', tool: 'hole_right', result: 'body' },
    { op: 'chamfer', target: 'body', size: 1, result: 'final' },
  ]));
  requireMatch(emptyOrAbsent(config.quality?.critical_dimensions));
  const diameters = [left.row.radius * 2, right.row.radius * 2];
  const declared = declarations(config, ['HOLE_LEFT_DIA', 'HOLE_RIGHT_DIA'], ['hole_left', 'hole_right'], diameters);
  const { length, width, height } = plate.row;
  const clearance = 1; // Existing fixed chamfer; these are geometric limits, not manufacturing approval.
  const separation = Math.hypot(125 - 30, 70 - 30);
  const maxDiameter = (hole, other) => {
    const [x, y] = hole.position;
    return 2 * Math.min(x - clearance, length - x - clearance, y - clearance, width - y - clearance, separation - other.radius - 2 * clearance);
  };
  return {
    id: 'bracket',
    fields: [
      field('plate_length_mm', length, Math.max(30 + left.row.radius + clearance, 125 + right.row.radius + clearance), null, [[['shapes', plate.index, 'length'], 1, 0]]),
      field('plate_width_mm', width, Math.max(30 + left.row.radius + clearance, 70 + right.row.radius + clearance), null, [[['shapes', plate.index, 'width'], 1, 0]]),
      field('plate_thickness_mm', height, 2 * clearance, null, [
        [['shapes', plate.index, 'height'], 1, 0], [['shapes', left.index, 'height'], 1, 4], [['shapes', right.index, 'height'], 1, 4],
      ]),
      field('left_hole_diameter_mm', diameters[0], 0, maxDiameter(left.row, right.row), [
        [['shapes', left.index, 'radius'], 0.5, 0], ...declared[0].map((path) => [path, 1, 0]),
      ]),
      field('right_hole_diameter_mm', diameters[1], 0, maxDiameter(right.row, left.row), [
        [['shapes', right.index, 'radius'], 0.5, 0], ...declared[1].map((path) => [path, 1, 0]),
      ]),
    ],
  };
}

function hingeProfile(config) {
  const ids = ['base_block', 'left_ear', 'right_ear', 'hinge_pin_left', 'hinge_pin_right', 'mount_hole_left', 'mount_hole_right'];
  const shapes = indexedRows(config.shapes, ids);
  const specifications = [
    { id: 'base_block', type: 'box', length: 90, width: 50, height: 12 },
    { id: 'left_ear', type: 'box', length: 22, width: 14, height: 26, position: [10, 32, 12] },
    { id: 'right_ear', type: 'box', length: 22, width: 14, height: 26, position: [58, 32, 12] },
    { id: 'hinge_pin_left', type: 'cylinder', height: 24, position: [21, 28, 27], direction: [0, 1, 0] },
    { id: 'hinge_pin_right', type: 'cylinder', height: 24, position: [69, 28, 27], direction: [0, 1, 0] },
    { id: 'mount_hole_left', type: 'cylinder', height: 18, position: [24, 14, -3] },
    { id: 'mount_hole_right', type: 'cylinder', height: 18, position: [66, 14, -3] },
  ];
  specifications.forEach((specification, index) => shapeMatches(shapes.get(specification.id).row, specification, index < 3 ? [] : ['radius']));
  requireMatch(isDeepStrictEqual(config.operations, [
    { op: 'fuse', base: 'base_block', tool: 'left_ear', result: 'body' },
    { op: 'fuse', base: 'body', tool: 'right_ear', result: 'body' },
    { op: 'cut', base: 'body', tool: 'hinge_pin_left', result: 'body' },
    { op: 'cut', base: 'body', tool: 'hinge_pin_right', result: 'body' },
    { op: 'cut', base: 'body', tool: 'mount_hole_left', result: 'body' },
    { op: 'cut', base: 'body', tool: 'mount_hole_right', result: 'final' },
  ]));
  const pin = shapes.get('hinge_pin_left').row.radius * 2;
  const mounting = shapes.get('mount_hole_left').row.radius * 2;
  requireMatch(shapes.get('hinge_pin_right').row.radius * 2 === pin && shapes.get('mount_hole_right').row.radius * 2 === mounting);
  const features = ['hinge_pin_left,hinge_pin_right', 'mount_hole_left,mount_hole_right'];
  const declared = declarations(config, ['HINGE_PIN_DIA', 'MOUNTING_HOLE_DIA'], features, [pin, mounting]);
  const critical = indexedRows(config.quality?.critical_dimensions, ['cd-01', 'cd-02']);
  for (const [index, id] of ['cd-01', 'cd-02'].entries()) {
    knownDeclaration(critical.get(id).row, CRITICAL_DIMENSION_KEYS);
    requireMatch(critical.get(id).row.feature === features[index] && critical.get(id).row.target_mm === [pin, mounting][index]);
    declared[index].push(['quality', 'critical_dimensions', critical.get(id).index, 'target_mm']);
  }
  const earClearance = (ear, hole) => Math.min(hole.position[0] - ear.position[0], ear.position[0] + ear.length - hole.position[0], hole.position[2] - ear.position[2], ear.position[2] + ear.height - hole.position[2]);
  const maxPin = 2 * Math.min(earClearance(shapes.get('left_ear').row, shapes.get('hinge_pin_left').row), earClearance(shapes.get('right_ear').row, shapes.get('hinge_pin_right').row));
  const base = shapes.get('base_block').row;
  const mountingClearance = (hole) => Math.min(hole.position[0], base.length - hole.position[0], hole.position[1], base.width - hole.position[1]);
  const maxMounting = Math.min(2 * mountingClearance(shapes.get('mount_hole_left').row), 2 * mountingClearance(shapes.get('mount_hole_right').row), 66 - 24);
  return {
    id: 'hinge_block',
    fields: [
      field('hinge_pin_diameter_mm', pin, 0, maxPin, [
        ...['hinge_pin_left', 'hinge_pin_right'].map((id) => [['shapes', shapes.get(id).index, 'radius'], 0.5, 0]), ...declared[0].map((path) => [path, 1, 0]),
      ]),
      field('mounting_hole_diameter_mm', mounting, 0, maxMounting, [
        ...['mount_hole_left', 'mount_hole_right'].map((id) => [['shapes', shapes.get(id).index, 'radius'], 0.5, 0]), ...declared[1].map((path) => [path, 1, 0]),
      ]),
    ],
  };
}

function identifyProfile(config) {
  try {
    requireMatch(plain(config) && ['quality_pass_bracket', 'hinge_block'].includes(config.name));
    requireMatch(['parts', 'assembly', 'import', 'transform', 'transforms', 'placement', 'position', 'rotation', 'scale', 'patterns'].every((key) => !Object.hasOwn(config, key)));
    requireMatch(config.final === undefined || config.final === 'final');
    requireMatch(['dimensions', 'dimension_requirements', 'dim_intents', 'optional_dimensions', 'reference_dimensions']
      .every((key) => emptyOrAbsent(config.drawing_intent?.[key])));
    requireMatch(['feature_tolerances', 'threads', 'thread_specs', 'key_dims']
      .every((key) => emptyOrAbsent(config.drawing?.[key])));
    return config.name === 'quality_pass_bracket' ? bracketProfile(config) : hingeProfile(config);
  } catch {
    return null;
  }
}

function publicFields(profile) {
  return profile.fields.map(({ targets: _targets, ...descriptor }) => descriptor);
}

export function evaluateModelParameters(request) {
  if (!plain(request) || !['inspect', 'apply'].includes(request.mode)) throw new Error('mode must be inspect or apply.');
  const allowed = request.mode === 'inspect' ? ['mode', 'config_toml'] : ['mode', 'config_toml', 'source_sha256', 'changes'];
  if (Object.keys(request).some((key) => !allowed.includes(key))) throw new Error('Model parameters request contains unsupported fields.');
  const source = request.config_toml;
  if (typeof source !== 'string' || !source.trim()) throw new Error('Config TOML is required.');
  const sourceSha = digest(source);
  if (request.mode === 'apply') {
    if (request.source_sha256 !== sourceSha) throw new Error('Model parameter source changed; inspect the current draft again.');
    if (!plain(request.changes) || Object.values(request.changes).some((value) => !finite(value))) throw new Error('changes must contain finite JSON numbers.');
  }
  let parsed;
  let reason = 'invalid_config';
  let profile = null;
  try {
    parsed = parse(source);
    if (validateConfigDocument(parsed, { filepath: 'studio:model-parameters' }).valid) {
      reason = 'unsupported_configuration';
      profile = identifyProfile(parsed);
    }
    if (profile) {
      const probes = profile.fields.flatMap((entry) => entry.targets.map(([path]) => ({ path, value: at(parsed, path) })));
      try { patchTomlNumericValues(source, probes); } catch { profile = null; reason = 'unsupported_source'; }
    }
  } catch { profile = null; }
  const response = { supported: Boolean(profile), profile_id: profile?.id || null, source_sha256: sourceSha, fields: profile ? publicFields(profile) : [] };
  if (!profile) {
    if (request.mode === 'apply') throw new Error('This configuration requires the TOML editor; the model parameter profile is unsupported.');
    return { ...response, reason };
  }
  if (request.mode === 'inspect') return response;
  const known = new Map(profile.fields.map((entry) => [entry.id, entry]));
  if (Object.keys(request.changes).some((key) => !known.has(key))) throw new Error('changes contains an unsupported model parameter.');
  // Preserve TOML date subtypes in unrelated metadata during semantic comparison.
  const expected = parse(source);
  const patches = [];
  for (const [id, value] of Object.entries(request.changes)) {
    for (const [path, factor, offset] of known.get(id).targets) {
      const number = value * factor + offset;
      if (!finite(number)) throw new Error('Model parameter exceeds finite geometric limits.');
      if (at(expected, path) !== number) {
        patches.push({ path, value: number });
        put(expected, path, number);
      }
    }
  }
  const candidateProfile = identifyProfile(expected);
  if (!candidateProfile) throw new Error('Model parameters exceed the supported geometric bounds or conflict with declared dimensions.');
  const candidate = patches.length ? patchTomlNumericValues(source, patches) : source;
  const reparsed = parse(candidate);
  if (!isDeepStrictEqual(reparsed, expected) || !validateConfigDocument(reparsed, { filepath: 'studio:model-parameters' }).valid) {
    throw new Error('Model parameter candidate failed configuration validation.');
  }
  return { ...response, fields: publicFields(candidateProfile), config_toml: candidate, candidate_sha256: digest(candidate), changed: candidate !== source };
}
