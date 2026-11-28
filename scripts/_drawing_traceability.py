"""Bounded links from drawing dimensions to FreeCAD measurements.

The caller supplies get_metadata(final_shape) from the live drawing run.
Config-only feature inference is not sufficient for these links.
"""

import math

from intent_compiler import classify_part_type
from feature_extractor import BRACKET_VERTICAL_INTENTS, named_bracket_boxes
from _dim_plan import _style_bucket


def _same(a, b):
    return (isinstance(a, (int, float)) and not isinstance(a, bool)
            and isinstance(b, (int, float)) and not isinstance(b, bool)
            and math.isfinite(a) and math.isfinite(b) and abs(a - b) <= 1e-6)


def _vector_equal(a, b):
    return (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))
            and len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b)))


def resolve_named_top_hole_diameters(config, shape, object_id, project_edge, top_groups, *, intents=None):
    """Bind explicit individual cutter names to a complete final cylindrical wall."""
    specs = {spec['id']: spec for spec in config.get('shapes', [])}
    declared = {d.get('feature') for d in config.get('drawing_intent', {}).get('required_dimensions', [])
                if isinstance(d, dict) and d.get('dimension_type') == 'diameter'
                and 'hole' in (str(d.get('id', '')) + ' ' + str(d.get('label', ''))).lower()}
    cutters = {op.get('tool') for op in config.get('operations', [])
               if op.get('op') == 'cut' and isinstance(op.get('tool'), str)}
    visible = [edge['circ'] for group in (0, 2, 5, 8) for edge in top_groups.get(group, []) if edge.get('circ')]
    result = {}
    if intents is None:
        intents = config.get('drawing_plan', {}).get('dim_intents', [])
    for intent in intents:
        name = intent.get('feature', '')
        if (intent.get('view') != 'top' or intent.get('style') != 'diameter' or ',' in name
                or (name not in cutters and name not in declared)):
            continue
        binding = {'status': 'unresolved', 'reason': 'named_hole_geometry_unresolved', 'source': 'freecad_runtime',
                   'model_object_id': object_id, 'feature_id': name, 'measurement': 'legacy_cylindrical_diameter'}
        result[('top', intent['id'], name)] = binding
        spec = specs.get(name, {})
        if (spec.get('type') != 'cylinder' or spec.get('rotation')
                or not any(op.get('op') == 'cut' and op.get('tool') == name for op in config.get('operations', []))
                or not shape.isValid() or len(shape.Solids) != 1):
            continue
        x, y = spec.get('position', [0, 0, 0])[:2]
        radius = spec['radius']
        candidates = []
        for index, face in enumerate(shape.Faces, 1):
            surface, bb = face.Surface, face.BoundBox
            if (type(surface).__name__ != 'Cylinder' or not _same(surface.Radius, radius)
                    or not _vector_equal(list(surface.Center)[:2], [x, y])
                    or not _vector_equal(list(map(abs, surface.Axis)), [0, 0, 1]) or bb.ZLength <= 1e-6
                    or not _vector_equal([bb.XMin, bb.YMin, bb.XMax, bb.YMax], [x-radius, y-radius, x+radius, y+radius])
                    or not math.isclose(face.Area, 2*math.pi*radius*bb.ZLength, rel_tol=1e-8, abs_tol=1e-6)):
                continue
            u0, u1, v0, v1 = face.ParameterRange
            point, normal = face.valueAt((u0+u1)/2, (v0+v1)/2), face.normalAt((u0+u1)/2, (v0+v1)/2)
            if not _same(((point.x-x)*normal.x+(point.y-y)*normal.y)/radius, -1):
                continue
            rims = [edge for edge in face.Edges if type(edge.Curve).__name__ == 'Circle' and edge.isClosed()
                    and _same(edge.Curve.Radius, radius) and _same(edge.Length, 2*math.pi*radius)
                    and _vector_equal(list(edge.Curve.Center)[:2], [x, y])]
            if len(rims) != 2:
                continue
            upper = max(rims, key=lambda edge: edge.Curve.Center.z)
            _, _, circles, _ = project_edge(upper)
            if len(circles) != 1 or not any(_vector_equal(circles[0], circle) for circle in visible):
                continue
            refs = [i for i, edge in enumerate(shape.Edges, 1) if edge.isSame(upper)]
            if len(refs) != 1:
                continue
            candidates.append({'face_ref': f'{object_id}:Face{index}', 'edge_ref': f'{object_id}:Edge{refs[0]}',
                'radius_mm': surface.Radius, 'z_range_mm': [bb.ZMin, bb.ZMax], 'surface_role': 'inward_hole',
                'center_uv': list(circles[0][:2]), 'circle_uv_mm': list(circles[0]), 'measured_mm': 2*surface.Radius})
        if len(candidates) == 1:
            binding.update(status='resolved', reason=None, visible_circle_proof='final_projection', **candidates[0])
    return result


def resolve_named_plate_hole_datums(config, shape, object_id, diameter_bindings, project_top):
    """Resolve the existing explicit QP aliases; do not infer arbitrary datums."""
    strategy = config.get('drawing_intent', {}).get('datum_strategy', {})
    if (strategy.get('primary'), strategy.get('secondary'), strategy.get('tertiary')) != (
            'plate_top_face', 'left_mounting_hole', 'right_mounting_hole'):
        return {}
    result = {name: {'status': 'unresolved', 'view': 'top', 'source': 'freecad_runtime'} for name in 'ABC'}
    declared = config.get('drawing_intent', {}).get('required_dimensions', [])
    for letter, feature, intent_id in [('B', 'hole_left', 'HOLE_LEFT_DIA'), ('C', 'hole_right', 'HOLE_RIGHT_DIA')]:
        if not any(d.get('id') == intent_id and d.get('feature') == feature for d in declared):
            continue
        matches = [b for b in diameter_bindings.values() if b.get('feature_id') == feature
                   and b.get('status') == 'resolved' and b.get('measurement') == 'legacy_cylindrical_diameter']
        if len(matches) == 1:
            binding = matches[0]
            result[letter].update(status='resolved', feature_id=feature, geometry_ref=binding['edge_ref'],
                face_ref=binding['face_ref'], point_3d_mm=[*binding['center_uv'], binding['z_range_mm'][1]],
                point_uv_mm=binding['center_uv'])
    boxes = [s for s in config.get('shapes', []) if s.get('id') == 'plate' and s.get('type') == 'box']
    if len(boxes) == 1 and not boxes[0].get('rotation') and shape.isValid():
        z = boxes[0].get('position', [0, 0, 0])[2]+boxes[0]['height']
        faces = [(i, f) for i, f in enumerate(shape.Faces, 1) if type(f.Surface).__name__ == 'Plane'
                 and _same(f.BoundBox.ZMin, z) and _same(f.BoundBox.ZMax, z)
                 and _vector_equal(list(f.normalAt(0, 0)), [0, 0, 1])]
        if len(faces) == 1:
            from FreeCAD import Vector
            index, face = faces[0]
            bb = face.BoundBox
            point = [(bb.XMin+bb.XMax)/2, (bb.YMin+bb.YMax)/2, z]
            groups, bounds, _, _ = project_top(face)
            if (groups and _vector_equal(list(bounds), [bb.XMin, bb.YMin, bb.XMax, bb.YMax])
                    and face.isInside(Vector(*point), 1e-6, True)):
                result['A'].update(status='resolved', feature_id='plate_top_face',
                    geometry_ref=f'{object_id}:Face{index}', point_3d_mm=point, point_uv_mm=point[:2],
                    reference_kind='plane_surface_point')
    return result


def _vertical_corner_edge(final_shape, expected):
    """Find a unique final edge between the two named orthogonal wall planes."""
    height = expected[1][2] - expected[0][2]
    candidates = []
    for index, edge in enumerate(final_shape.Edges, 1):
        if type(edge.Curve).__name__ not in ('Line', 'LineSegment') or len(edge.Vertexes) != 2:
            continue
        points = sorted([list(vertex.Point) for vertex in edge.Vertexes], key=lambda p: p[2])
        if (all(_vector_equal(a, b) for a, b in zip(points, expected))
                and _same(edge.Length, height)):
            candidates.append((index, edge, points))
    if len(candidates) != 1:
        return None
    index, edge, points = candidates[0]
    # The selected edge must still join the two outer planar side faces.
    adjacent = [face for face in final_shape.Faces if any(edge.isSame(e) for e in face.Edges)]
    if len(adjacent) != 2 or any(type(face.Surface).__name__ != 'Plane' for face in adjacent):
        return None
    normals = [list(map(abs, face.normalAt(0, 0))) for face in adjacent]
    if not all(any(_vector_equal(n, axis) for n in normals) for axis in ([1, 0, 0], [0, 1, 0])):
        return None
    return index, edge, points


def resolve_front_plate_thickness(config, final_shape, model_object_id, project_edge):
    """Bind only front THK/plate to its surviving right-front vertical edge."""
    intents = [d for d in config.get('drawing_plan', {}).get('dim_intents', [])
               if d.get('id') == 'THK' and d.get('feature') == 'plate'
               and d.get('view') == 'front' and d.get('style', 'linear') == 'linear']
    if not intents:
        return {}
    binding = {'status': 'unresolved', 'reason': 'linear_anchor_unresolved',
               'source': 'freecad_runtime', 'feature_id': 'plate',
               'model_object_id': model_object_id, 'measurement': 'final_edge'}
    result = {('front', 'THK', 'plate'): binding}
    boxes = [s for s in config.get('shapes', []) if s.get('id') == 'plate' and s.get('type') == 'box']
    if (len(intents) != 1 or len(boxes) != 1 or boxes[0].get('rotation')
            or not final_shape.isValid() or len(final_shape.Solids) != 1):
        return result
    box = boxes[0]
    x, y, z = box.get('position', [0, 0, 0])
    x += box['length']
    measured = _vertical_corner_edge(final_shape, [[x, y, z], [x, y, z + box['height']]])
    if measured is None:
        return result
    index, edge, points = measured
    groups, bounds, _, _ = project_edge(edge)
    if (not groups or not _same(bounds[0], bounds[2])
            or not _same(bounds[3] - bounds[1], edge.Length)):
        return result
    binding.update(status='resolved', reason=None, edge_ref=f'{model_object_id}:Edge{index}',
                   measured_mm=edge.Length, endpoints_3d_mm=points,
                   endpoints_uv_mm=[[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                   bounds=list(bounds))
    return result


def _measure_bracket_web_fillet(config, shape, object_id, x, y, z, width, front_arcs):
    """Find the declared web-root blend and its actual projected front arc."""
    start, end = [x, y, z], [x, y + width, z]
    radii = [op['radius'] for op in config.get('operations', []) if op.get('op') == 'fillet'
             and any((_vector_equal(a, start) and _vector_equal(b, end))
                     or (_vector_equal(b, start) and _vector_equal(a, end))
                     for a, b in op.get('edge_segments', []))]
    if len(radii) != 1:
        return None
    radius = radii[0]
    center = [x + radius, z + radius]
    faces = []
    for index, face in enumerate(shape.Faces, 1):
        surface, bb = face.Surface, face.BoundBox
        if (type(surface).__name__ != 'Cylinder' or not _same(surface.Radius, radius)
                or not _vector_equal(list(map(abs, surface.Axis)), [0, 1, 0])
                or not _vector_equal([surface.Center.x, surface.Center.z], center)
                or not _vector_equal([bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
                                     [x, y, z, x + radius, y + width, z + radius])
                or not _same(face.Area, math.pi * radius * width / 2)):
            continue
        u0, u1, v0, v1 = face.ParameterRange
        u, v = (u0 + u1) / 2, (v0 + v1) / 2
        point, normal = face.valueAt(u, v), face.normalAt(u, v)
        if _same(((point.x-center[0])*normal.x + (point.z-center[1])*normal.z) / radius, -1):
            faces.append((index, surface.Radius))
    arcs = [(u, v, mx, my) for u, v, r, mx, my, group in front_arcs
            if group in (0, 2) and _same(r, radius) and _vector_equal([u, v], center)]
    if len(faces) != 1 or len(arcs) != 1:
        return None
    u, v, mx, my = arcs[0]
    return {'status': 'resolved', 'reason': None, 'measured_mm': faces[0][1],
            'face_ref': f'{object_id}:Face{faces[0][0]}',
            'center_uv_mm': [u, v], 'arc_point_uv_mm': [mx, my]}


def resolve_bracket_drawing_bindings(config, shape, object_id, intents, view_data, project_top):
    """Resolve the box bracket's named Z spans and one visible mounting bore."""
    if config.get('drawing_plan', {}).get('part_type') != 'bracket':
        return {}
    boxes = named_bracket_boxes(config)
    if not boxes:
        return {}
    base, web = boxes
    x, y, bottom = base.get('position', [0, 0, 0])
    wx, wy, shoulder = web.get('position', [0, 0, 0])
    base_top = bottom + base['height']
    top = shoulder + web['height']
    base_right, web_right = x + base['length'], wx + web['length']
    valid = (shape.isValid() and len(shape.Solids) == 1
             and _vector_equal([wx, wy, shoulder], [x, y, base_top])
             and bottom < base_top < top and x < web_right < base_right)
    fillet = (_measure_bracket_web_fillet(config, shape, object_id, web_right, y, base_top, web['width'],
                                          view_data.get('front', {}).get('arcs', [])) if valid else None)
    # At the rounded inner corner the vertical edge starts above the base.
    # The surviving outer edge still spans from the base top to the web top.
    web_height_x = x if fillet else web_right
    points = {
        'HEIGHT': ([[x, y, bottom], [x, y, base_top], [x, y, top]], object_id),
        'THK': ([[base_right, y, bottom], [base_right, y, base_top]], base['id']),
        'WEB_H': ([[web_height_x, y, base_top], [web_height_x, y, top]], web['id']),
    }
    result = {}
    for intent in intents:
        dim_id, feature, view = intent.get('id'), intent.get('feature'), intent.get('view')
        if (dim_id == 'FILLET' and intent.get('required')
                and any(op.get('op') == 'fillet' and op.get('edge_segments') for op in config.get('operations', []))):
            binding = {'status': 'unresolved', 'reason': 'fillet_reference_geometry_unresolved',
                       'source': 'freecad_runtime', 'measurement': 'bracket_fillet_radius',
                       'model_object_id': object_id, 'feature_id': 'vertical_leg_root'}
            result[(view, dim_id, feature)] = binding
            if (feature, view, intent.get('style')) != ('fillet_radius', 'front', 'radius'):
                binding['reason'] = 'fillet_reference_definition_mismatch'
            elif fillet:
                binding.update(fillet)
            continue
        if dim_id not in BRACKET_VERTICAL_INTENTS:
            continue
        chain, feature_id = points[dim_id]
        binding = {'status': 'unresolved', 'reason': 'bracket_reference_geometry_unresolved',
                   'source': 'freecad_runtime', 'measurement': 'bracket_vertical_reference',
                   'model_object_id': object_id, 'feature_id': feature_id, 'axis': 'v'}
        result[(view, dim_id, feature)] = binding
        if (feature, view) != BRACKET_VERTICAL_INTENTS[dim_id] or intent.get('style') != 'linear':
            binding['reason'] = 'bracket_reference_definition_mismatch'
            continue
        if not valid or (dim_id == 'HEIGHT' and not _vector_equal(
                [shape.BoundBox.ZMin, shape.BoundBox.ZMax], [bottom, top])):
            continue
        edges = [_vertical_corner_edge(shape, [start, end]) for start, end in zip(chain, chain[1:])]
        if not all(edges):
            continue
        horizontal = 0 if view == 'front' else 1
        projected = [[[p[horizontal], p[2]] for p in edge[2]] for edge in edges]
        groups = view_data.get(view, {}).get('groups', {})
        visible = [sorted(line['pts'], key=lambda p: p[1]) for group in (0, 2) for line in groups.get(group, [])
                   if not line.get('circ') and len(line['pts']) == 2]
        if not all(any(_vector_equal(segment[0], a) and _vector_equal(segment[1], b)
                       for a, b in visible) for segment in projected):
            continue
        xyz = [edges[0][2][0], edges[-1][2][1]]
        uv = [projected[0][0], projected[-1][1]]
        binding.update(status='resolved', reason=None, measured_mm=xyz[1][2]-xyz[0][2],
                       edge_refs=[f'{object_id}:Edge{edge[0]}' for edge in edges],
                       endpoints_3d_mm=xyz, endpoints_uv_mm=uv, bounds=[*uv[0], *uv[1]])

    hole_intents = [d for d in intents if (d.get('id'), d.get('view'), d.get('feature'), d.get('style'))
                    == ('HOLE_DIA', 'top', 'mounting_hole_diameter', 'diameter')]
    if len(hole_intents) == 1:
        intent = hole_intents[0]
        key = ('top', 'HOLE_DIA', intent['feature'])
        result[key] = {'status': 'unresolved', 'reason': 'bracket_mounting_bore_unresolved',
                       'source': 'freecad_runtime', 'measurement': 'legacy_cylindrical_diameter',
                       'model_object_id': object_id}
        if not valid:
            return result
        cutters = [op.get('tool') for op in config.get('operations', []) if op.get('op') == 'cut']
        holes = [s for s in config.get('shapes', []) if s.get('type') == 'cylinder' and s['id'] in cutters]
        bindings = resolve_named_top_hole_diameters(
            config, shape, object_id, project_top, view_data.get('top', {}).get('groups', {}),
            intents=[{**intent, 'feature': s['id']} for s in holes])
        # The diameter callout points to one measured full-depth base bore.
        # A partial opening into the web cannot supply that target.
        for binding in bindings.values():
            if (binding['status'] == 'resolved'
                    and _vector_equal(binding['z_range_mm'], [bottom, base_top])):
                result[key] = binding
                break
    return result


def _measure_standoff_member(final_shape, spec, plate_top, model_object_id):
    """Identify one complete additive cylinder in the final solid, not its tool."""
    if (spec.get('type') != 'cylinder' or spec.get('rotation')
            or not _vector_equal(spec.get('direction', [0, 0, 1]), [0, 0, 1])):
        return None
    x, y, z = spec.get('position', [0, 0, 0])
    radius, height = spec['radius'], spec['height']
    if not _same(z, plate_top):
        return None
    candidates = []
    for index, face in enumerate(final_shape.Faces, 1):
        surface, bb = face.Surface, face.BoundBox
        if type(surface).__name__ != 'Cylinder':
            continue
        if (not _vector_equal(list(surface.Center)[:2], [x, y])
                or not _vector_equal(list(map(abs, surface.Axis)), [0, 0, 1])
                or not _same(surface.Radius, radius)
                or not _vector_equal([bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
                                     [x-radius, y-radius, z, x+radius, y+radius, z+height])
                or not math.isclose(face.Area, 2 * math.pi * surface.Radius * bb.ZLength,
                                    rel_tol=1e-8, abs_tol=1e-6)):
            continue
        u0, u1, v0, v1 = face.ParameterRange
        point = face.valueAt((u0+u1)/2, (v0+v1)/2)
        normal = face.normalAt((u0+u1)/2, (v0+v1)/2)
        # Hole walls point inward. A standoff side must point radially outward.
        if not _same(((point.x-x)*normal.x + (point.y-y)*normal.y)/radius, 1):
            continue
        circles = []
        for edge in face.Edges:
            curve = edge.Curve
            if (type(curve).__name__ != 'Circle' or not edge.isClosed()
                    or not _same(curve.Radius, radius)
                    or not _same(edge.Length, 2*math.pi*radius)
                    or not _vector_equal(list(curve.Center)[:2], [x, y])
                    or not _vector_equal(list(map(abs, curve.Axis)), [0, 0, 1])):
                continue
            z_edge = curve.Center.z
            if not any(_same(z_edge, level) for level in [bb.ZMin, bb.ZMax]):
                continue
            # Both circular boundaries must join surviving horizontal material.
            planes = [f for f in final_shape.Faces if type(f.Surface).__name__ == 'Plane'
                      and _same(f.BoundBox.ZMin, z_edge) and _same(f.BoundBox.ZMax, z_edge)
                      and any(edge.isSame(e) for e in f.Edges)]
            refs = [i for i, e in enumerate(final_shape.Edges, 1) if edge.isSame(e)]
            if len(planes) == 1 and len(refs) == 1:
                circles.append((z_edge, edge, refs[0]))
        circles.sort(key=lambda item: item[0])
        if len(circles) != 2 or not _same(circles[0][0], bb.ZMin) or not _same(circles[1][0], bb.ZMax):
            continue
        evidence = {'feature_id': spec['id'], 'face_ref': f'{model_object_id}:Face{index}',
                    'center_xy_mm': list(surface.Center)[:2], 'radius_mm': surface.Radius,
                    'z_range_mm': [bb.ZMin, bb.ZMax], 'height_mm': bb.ZLength,
                    'lower_edge_ref': f'{model_object_id}:Edge{circles[0][2]}',
                    'upper_edge_ref': f'{model_object_id}:Edge{circles[1][2]}'}
        candidates.append((evidence, circles[0][1], circles[1][1]))
    return candidates[0] if len(candidates) == 1 else None


def resolve_front_standoff_height(config, final_shape, model_object_id, project_edge, front_groups):
    """Resolve the four PCB standoffs and one actually visible right silhouette."""
    intents = [d for d in config.get('drawing_plan', {}).get('dim_intents', [])
               if d.get('id') == 'STANDOFF_HEIGHT' and d.get('view') == 'front'
               and d.get('style', 'linear') == 'linear']
    if not intents:
        return {}
    feature = intents[0].get('feature', '')
    member_ids = sorted(part.strip() for part in feature.split(','))
    binding = {'status': 'unresolved', 'reason': 'linear_anchor_unresolved', 'source': 'freecad_runtime',
               'feature_id': feature, 'member_feature_ids': member_ids,
               'model_object_id': model_object_id, 'measurement': 'standoff_cylindrical_faces', 'axis': 'v'}
    result = {('front', 'STANDOFF_HEIGHT', d.get('feature', '')): binding for d in intents}
    if (len(intents) != 1 or member_ids != ['standoff1', 'standoff2', 'standoff3', 'standoff4']
            or not final_shape.isValid() or len(final_shape.Solids) != 1):
        return result
    specs = {s['id']: s for s in config.get('shapes', [])}
    plate = specs.get('plate', {})
    if plate.get('type') != 'box' or plate.get('rotation') or any(i not in specs for i in member_ids):
        return result
    # Require all four named primitives to enter the final body additively.
    fused = {key: set() for key in specs}
    for op in config.get('operations', []):
        if op.get('op') not in ('fuse', 'cut') or not isinstance(op.get('tool'), str):
            return result
        added = set(fused.get(op['base'], set()))
        if op['op'] == 'fuse':
            added |= fused.get(op['tool'], set()) | ({op['base'], op['tool']} & set(member_ids))
        fused[op.get('result', op['base'])] = added
    if fused.get(model_object_id) != set(member_ids):
        binding.update(reason='standoff_member_geometry_unresolved',
                       unresolved_member_ids=sorted(set(member_ids) - fused.get(model_object_id, set())))
        return result
    plate_top = plate.get('position', [0, 0, 0])[2] + plate['height']
    measured = [_measure_standoff_member(final_shape, specs[i], plate_top, model_object_id) for i in member_ids]
    if any(member is None for member in measured):
        binding.update(reason='standoff_member_geometry_unresolved',
                       unresolved_member_ids=[key for key, member in zip(member_ids, measured) if member is None],
                       members=[member[0] for member in measured if member is not None])
        return result
    members = [member[0] for member in measured]
    binding['members'] = members
    if len({m['face_ref'] for m in members}) != 4:
        binding.update(reason='standoff_member_geometry_unresolved', unresolved_member_ids=member_ids)
        return result
    if not all(_same(m['height_mm'], members[0]['height_mm']) for m in members):
        binding['reason'] = 'standoff_group_height_mismatch'
        return result
    binding['reason'] = 'standoff_projection_unresolved'
    # Deterministic representative: leftmost column, then frontmost member.
    representative = min(measured, key=lambda m: (*m[0]['center_xy_mm'], m[0]['feature_id']))
    member, lower, upper = representative
    x = member['center_xy_mm'][0] + member['radius_mm']
    y = member['center_xy_mm'][1]
    points = [[x, y, z] for z in member['z_range_mm']]
    import Part
    from FreeCAD import Vector
    if any(edge.distToShape(Part.Vertex(Vector(*point)))[0] > 1e-6
           for edge, point in zip((lower, upper), points)):
        return result
    projections = [project_edge(edge) for edge in (lower, upper)]
    if any(not p[0] or not _same(p[1][1], p[1][3]) for p in projections):
        return result
    # Circle-only HLR discretization can miss the left extremum; use the exact
    # right point only when both real circle projections and visible HLR agree.
    uv = [[p[1][2], p[1][1]] for p in projections]
    if not _same(uv[0][0], uv[1][0]) or not _same(uv[1][1]-uv[0][1], member['height_mm']):
        return result
    visible = []
    for group in (0, 2):
        for edge in front_groups.get(group, []):
            pts = sorted(edge.get('pts', []), key=lambda p: p[1])
            if len(pts) == 2 and all(_vector_equal(a, b) for a, b in zip(pts, uv)):
                visible.append(group)
    if not visible:
        return result
    coincident = [m['feature_id'] for m in members
                  if _same(m['center_xy_mm'][0]+m['radius_mm'], x)
                  and _vector_equal(m['z_range_mm'], member['z_range_mm'])]
    binding.update(status='resolved', reason=None, measured_mm=member['height_mm'],
                   representative_feature_id=member['feature_id'], coincident_member_ids=coincident,
                   selected_side='right', projection_group_index=visible[0],
                   endpoints_3d_mm=points, endpoints_uv_mm=uv,
                   bounds=[uv[0][0], uv[0][1], uv[1][0], uv[1][1]])
    return result


def link_front_plate_thickness(telemetry, traceability):
    """Publish the final-edge link only after its bound annotation rendered."""
    for dimension in telemetry.get('plan_dimensions', []):
        binding = dimension.get('runtime_binding')
        if not binding:
            continue
        for link in traceability['links']:
            if link.get('dim_id') != dimension.get('dim_id') or link.get('feature_key') != 'plate':
                continue
            link['feature_id'] = None
            if (binding.get('status') == 'resolved' and dimension.get('rendered')
                    and dimension.get('status') == 'rendered'
                    and _same(dimension.get('value_mm'), binding.get('measured_mm'))):
                link.update(feature_id='plate', source='freecad_runtime',
                            evidence={**binding, 'model_value_mm': binding['measured_mm']},
                            drawing_object_id=dimension.get('drawing_object_id'),
                            represented_by=dimension.get('dim_id'))
                if not any(f.get('feature_id') == 'plate' for f in traceability['features']):
                    traceability['features'].append({'feature_id': 'plate', 'type': 'primary_body',
                                                    'source': 'freecad_runtime'})
    traceability['summary'].update(
        feature_count=len(traceability['features']),
        linked_dimensions=sum(bool(link.get('feature_id')) for link in traceability['links']),
        unresolved_dimensions=[link['dim_id'] for link in traceability['links'] if not link.get('feature_id')],
    )


def link_front_standoff_height(telemetry, traceability):
    """Keep the entire measured group linked, or leave the whole group unresolved."""
    for dimension in telemetry.get('plan_dimensions', []):
        binding = dimension.get('runtime_binding') or {}
        if binding.get('measurement') != 'standoff_cylindrical_faces':
            continue
        for link in traceability['links']:
            if link.get('dim_id') != 'STANDOFF_HEIGHT' or link.get('feature_key') != binding.get('feature_id'):
                continue
            link['feature_id'] = None
            if (binding.get('status') == 'resolved' and dimension.get('rendered')
                    and dimension.get('status') == 'rendered'
                    and _same(dimension.get('value_mm'), binding.get('measured_mm'))):
                group_id = binding['feature_id']
                link.update(feature_id=group_id, source='freecad_runtime',
                            evidence={**binding, 'model_value_mm': binding['measured_mm']},
                            drawing_object_id=dimension.get('drawing_object_id'),
                            represented_by=dimension.get('dim_id'))
                if not any(f.get('feature_id') == group_id for f in traceability['features']):
                    traceability['features'].append({'feature_id': group_id, 'type': 'standoff_group',
                                                    'source': 'freecad_runtime'})
    traceability['summary'].update(
        feature_count=len(traceability['features']),
        linked_dimensions=sum(bool(link.get('feature_id')) for link in traceability['links']),
        unresolved_dimensions=[link['dim_id'] for link in traceability['links'] if not link.get('feature_id')],
    )


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


def link_plate_runtime_dimensions(config, model_object_id, metadata, view_data, telemetry, traceability):
    """Link the supported single-box plate and named bracket's base footprint.

    Unmatched dimensions retain their unresolved state. Hole groups must have
    equal diameters and one full-height cylindrical face per configured hole.
    Face references are local to this run, not stable across model revisions.
    """
    # Inline boolean tools are supported by the runtime, but are outside this
    # classifier's named-shape recipe. Preserve drawing generation for them.
    if any(not isinstance(op.get('tool'), str) for op in config.get('operations', [])
           if op.get('op') == 'cut'):
        return
    part_type = classify_part_type(config)
    bracket = named_bracket_boxes(config) if part_type == 'bracket' else None
    if ((part_type != 'plate' and not bracket) or not metadata.get('valid_shape')
            or metadata.get('solid_count') != 1):
        return
    box = bracket[0] if bracket else next(s for s in config['shapes'] if s.get('type') == 'box')
    holes = [] if bracket else [s for s in config['shapes'] if s.get('type') == 'cylinder']
    bbox = metadata.get('bbox', {})
    sizes = [box[key] for key in ('length', 'width', 'height')]
    size_axes = 2 if bracket else 3
    if (not _vector_equal((bbox.get('size') or [])[:size_axes], sizes[:size_axes])
            or not _vector_equal(bbox.get('min'), box.get('position', [0, 0, 0]))):
        return

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
            measured_holes = []
            break
        measured_holes.append((hole, candidates[0]))
    if len({f['face_index'] for _, f in measured_holes}) != len(measured_holes):
        measured_holes = []

    links = {link['dim_id']: link for link in traceability['links']}
    for dimension in telemetry.get('plan_dimensions', []):
        feature = dimension.get('feature')
        if bracket and feature not in ('base_length', 'base_width'):
            continue
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
            if not all(_same(value, face['diameter_mm']) for _, face in measured_holes):
                continue
            center = annotation.get('center_uv')
            anchors = [(hole, face) for hole, face in measured_holes
                       if _vector_equal(center, hole.get('position', [0, 0, 0])[:2])]
            if len(anchors) != 1:
                continue
            if not any(_vector_equal(center, circle[:2]) and _same(value, 2 * circle[2])
                       for circle in view_data.get(view, {}).get('circles', [])):
                continue
            resolved = anchors[0][0]['id']
            evidence.update(measurement='cylindrical_faces', center_uv=center,
                            member_feature_ids=[h['id'] for h, _ in measured_holes],
                            centers_xy=[h.get('position', [0, 0, 0])[:2] for h, _ in measured_holes],
                            face_refs=[f'{model_object_id}:Face{f["face_index"]}' for _, f in measured_holes])
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
