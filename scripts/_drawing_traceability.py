"""Bounded links from flat-plate drawing dimensions to FreeCAD measurements.

The caller supplies get_metadata(final_shape) from the live drawing run.
Config-only feature inference is not sufficient for these links.
"""

import math

from intent_compiler import _is_flat_mounting_plate, classify_part_type
from _dim_plan import _style_bucket


def _same(a, b):
    return (isinstance(a, (int, float)) and not isinstance(a, bool)
            and isinstance(b, (int, float)) and not isinstance(b, bool)
            and math.isfinite(a) and math.isfinite(b) and abs(a - b) <= 1e-6)


def _vector_equal(a, b):
    return (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))
            and len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b)))


_LINEAR_FEATURES = {
    'base_length': (0, {'front': 'overall_width', 'top': 'overall_width'}),
    'base_width': (1, {'top': 'overall_height', 'right': 'overall_width'}),
    'overall_height': (2, {'front': 'overall_height', 'right': 'overall_height'}),
    'base_thickness': (2, {'front': 'overall_height', 'right': 'overall_height'}),
}


def _annotation(dimension, auto_dimensions):
    if dimension.get('rendered') and dimension.get('status') == 'rendered':
        return dimension
    match = dimension.get('dedupe_match', {})
    if (dimension.get('status') != 'skipped_duplicate'
            or match.get('policy') != 'smart' or match.get('source') != 'auto_dimensions'):
        return None
    candidates = [a for a in auto_dimensions if a.get('dim_id') == match.get('auto_dim_id')]
    if len(candidates) != 1:
        return None
    auto = candidates[0]
    if (auto.get('status') != 'rendered' or auto.get('view') != dimension.get('view')
            or not auto.get('svg_element_id')
            or auto.get('category') != match.get('auto_category')
            or not _same(dimension.get('value_mm'), auto.get('value_mm'))
            or not _same(dimension.get('value_mm'), match.get('auto_value_mm'))):
        return None
    return auto


def _dimension_holes(intent, measured_holes):
    """Preserve whole-pattern semantics unless a valid group is explicit."""
    if 'member_feature_ids' not in intent:
        return measured_holes
    members = intent['member_feature_ids']
    if (not isinstance(members, list) or not members
            or not all(isinstance(member, str) and member for member in members)
            or len(set(members)) != len(members)):
        return []
    selected = set(members)
    if not selected.issubset({hole['id'] for hole, _ in measured_holes}):
        return []
    return [(hole, face) for hole, face in measured_holes if hole['id'] in selected]


def _plate_body(config, metadata):
    """Qualify the bounded recipe and measured body independently of its holes."""
    # Inline boolean tools are supported by the runtime, but are outside this
    # classifier's named-shape recipe. Preserve drawing generation for them.
    if any(not isinstance(op.get('tool'), str) for op in config.get('operations', [])
           if op.get('op') == 'cut'):
        return
    if (classify_part_type(config) not in {'plate', 'bushing_plate'}
            or not metadata.get('valid_shape')
            or metadata.get('solid_count') != 1):
        return
    boxes = [s for s in config['shapes'] if s.get('type') == 'box']
    holes = [s for s in config['shapes'] if s.get('type') == 'cylinder']
    # Many-hole plates keep their legacy template classification. Evidence
    # eligibility depends on the same bounded recipe, not the template name.
    if not _is_flat_mounting_plate(config, boxes, holes):
        return
    box = boxes[0]
    bbox = metadata.get('bbox', {})
    sizes = [box[key] for key in ('length', 'width', 'height')]
    if (not _vector_equal(bbox.get('size'), sizes)
            or not _vector_equal(bbox.get('min'), box.get('position', [0, 0, 0]))):
        return
    return box


def measure_plate_holes(config, metadata):
    """Return complete, uniquely measured holes, or None for unsupported input."""
    if _plate_body(config, metadata) is None:
        return None
    holes = [s for s in config['shapes'] if s.get('type') == 'cylinder']
    bbox = metadata['bbox']

    # Validate each configured cylindrical cut against the final shape, not the
    # cut tool. Missing, partial, split, or ambiguous faces remain unproven.
    measured_holes = []
    for hole in holes:
        position = hole.get('position', [0, 0, 0])
        candidates = []
        for face in metadata.get('cylindrical_faces', []):
            axis = face.get('axis') or []
            face_bbox = face.get('bbox', {})
            area = face.get('area_mm2')
            # A cylindrical surface can also be an open edge notch. Require
            # the full circumference, allowing only metadata rounding (4 dp).
            full_area = 2 * math.pi * hole['radius'] * bbox['size'][2]
            complete = (isinstance(area, (int, float)) and not isinstance(area, bool)
                        and area > 0 and math.isclose(area, full_area, rel_tol=1e-6, abs_tol=1e-4)
                        and _vector_equal((face_bbox.get('min') or [])[:2],
                                          [v - hole['radius'] for v in position[:2]])
                        and _vector_equal((face_bbox.get('max') or [])[:2],
                                          [v + hole['radius'] for v in position[:2]]))
            if (len(axis) == 3 and _same(axis[0], 0) and _same(axis[1], 0)
                    and complete
                    and _same(abs(axis[2]), 1)
                    and _vector_equal((face.get('center_mm') or [])[:2], position[:2])
                    and _same(face.get('diameter_mm'), 2 * hole['radius'])
                    and _same((face_bbox.get('min') or [None] * 3)[2], bbox['min'][2])
                    and _same((face_bbox.get('max') or [None] * 3)[2], bbox['max'][2])):
                candidates.append(face)
        if len(candidates) != 1:
            return None
        measured_holes.append((hole, candidates[0]))
    if len({f['face_index'] for _, f in measured_holes}) != len(measured_holes):
        return None
    return measured_holes


def diameter_group_centers(config, metadata):
    """Map explicit diameter intents to verified XY centers; invalid groups to []."""
    measured = measure_plate_holes(config, metadata)
    result = {}
    for intent in config.get('drawing_plan', {}).get('dim_intents', []):
        if 'member_feature_ids' not in intent:
            continue
        group = _dimension_holes(intent, measured or [])
        centers = []
        if (intent.get('feature') == 'mounting_hole_diameter'
                and intent.get('style') == 'diameter' and group
                and all(_same(intent.get('value_mm'), face['diameter_mm']) for _, face in group)):
            centers = [face['center_mm'][:2] for _, face in group]
        result[intent.get('id', '')] = centers
    return result


def link_plate_runtime_dimensions(config, model_object_id, metadata, view_data, telemetry, traceability):
    """Link measured body and hole dimensions to their current SVG annotations.

    Invalid holes do not discard independent evidence for the body bounds.
    Explicit diameter groups remain bounded by complete measured faces and
    their rendered anchors. Face references are local to this run.
    """
    box = _plate_body(config, metadata)
    if box is None:
        return
    bbox = metadata['bbox']
    measured_holes = measure_plate_holes(config, metadata) or []

    links = {link['dim_id']: link for link in traceability['links']}
    intents = {intent.get('id'): intent for intent in config.get('drawing_plan', {}).get('dim_intents', [])}
    for dimension in telemetry.get('plan_dimensions', []):
        feature = dimension.get('feature')
        link = links.get(dimension.get('dim_id'))
        annotation = _annotation(dimension, telemetry.get('auto_dimensions', []))
        if link is None or annotation is None:
            continue
        view = dimension.get('view')
        bounds = view_data.get(view, {}).get('bounds')
        value = dimension.get('value_mm')
        evidence = {'source': 'freecad_runtime', 'model_object_id': model_object_id,
                    'model_value_mm': value}
        resolved = None
        if feature in _LINEAR_FEATURES and dimension.get('style') == 'linear' and bounds:
            axis, categories = _LINEAR_FEATURES[feature]
            category = categories.get(view)
            if not category or not _same(value, bbox['size'][axis]):
                continue
            projected = bounds[2] - bounds[0] if category == 'overall_width' else bounds[3] - bounds[1]
            if not _same(value, projected):
                continue
            if annotation.get('source') == 'auto' and annotation.get('category') != category:
                continue
            if annotation.get('source') == 'plan':
                bucket = _style_bucket({**dimension, 'id': dimension['dim_id']}, view)
                if bucket != ('linear_h' if category == 'overall_width' else 'linear_v'):
                    continue
            evidence.update(measurement='bounding_box', axis='XYZ'[axis], bbox=bbox)
            resolved = box['id']
        elif (feature == 'mounting_hole_diameter' and dimension.get('style') == 'diameter'
              and view == 'top' and measured_holes):
            group = _dimension_holes(intents.get(dimension.get('dim_id'), {}), measured_holes)
            if not group or not all(_same(value, face['diameter_mm']) for _, face in group):
                continue
            center = annotation.get('center_uv')
            anchors = [(hole, face) for hole, face in group
                       if _vector_equal(center, hole.get('position', [0, 0, 0])[:2])]
            if len(anchors) != 1:
                continue
            if not any(_vector_equal(center, circle[:2]) and _same(value, 2 * circle[2])
                       for circle in view_data.get(view, {}).get('circles', [])):
                continue
            resolved = anchors[0][0]['id']
            evidence.update(measurement='cylindrical_faces', center_uv=center,
                            member_feature_ids=[h['id'] for h, _ in group],
                            centers_xy=[h.get('position', [0, 0, 0])[:2] for h, _ in group],
                            face_refs=[f'{model_object_id}:Face{f["face_index"]}' for _, f in group])
        if resolved:
            link.update(feature_id=resolved, source='freecad_runtime', evidence=evidence,
                        drawing_object_id=annotation.get('drawing_object_id'),
                        svg_element_id=annotation.get('svg_element_id'),
                        represented_by=annotation.get('dim_id'))
    if any(link.get('feature_id') == box['id'] for link in traceability['links']):
        traceability['features'].append({'feature_id': box['id'], 'type': 'primary_body',
                                        'source': 'freecad_runtime', 'bbox': bbox})
    traceability['summary'].update(
        feature_count=len(traceability['features']),
        linked_dimensions=sum(bool(link.get('feature_id')) for link in traceability['links']),
        unresolved_dimensions=[link['dim_id'] for link in traceability['links'] if not link.get('feature_id')],
    )
